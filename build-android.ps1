#!/usr/bin/env pwsh
<#
  ONE-COMMAND ANDROID RELEASE BUILD
  Usage:  powershell -ExecutionPolicy Bypass -File .\build-android.ps1
  Output: android\app\build\outputs\apk\release\app-release-unsigned.apk
#>
$ErrorActionPreference = "Stop"

# ---------- STEP 0: Find and use JDK 21 ----------
Write-Host "`n=== Step 0: Checking JDK 21 ===" -ForegroundColor Cyan

# Auto-detect JDK 21 from common install locations
$jdk21 = $null
$searchPaths = @(
    "C:\Program Files\Eclipse Adoptium",
    "C:\Program Files\Java",
    "C:\Program Files\Microsoft\jdk",
    "C:\Program Files\Zulu"
)
foreach ($base in $searchPaths) {
    if (Test-Path $base) {
        $match = Get-ChildItem -Path $base -Directory | Where-Object { $_.Name -match "21" } | Select-Object -First 1
        if ($match) { $jdk21 = $match.FullName; break }
    }
}

if ($jdk21) {
    $env:JAVA_HOME = $jdk21
    Write-Host "  Found JDK 21: $env:JAVA_HOME" -ForegroundColor Green
} else {
    # Fallback: check if system java is already 21
    $ErrorActionPreference = "SilentlyContinue"
    $sysJava = & java -version 2>&1 | Select-Object -First 1
    $ErrorActionPreference = "Stop"
    if ($sysJava -match "21\.") {
        Write-Host "  System java is JDK 21 (using JAVA_HOME=$env:JAVA_HOME)" -ForegroundColor Yellow
        Write-Host "  TIP: If build fails, find your JDK 21 folder and set JAVA_HOME manually." -ForegroundColor Yellow
    } else {
        throw "JDK 21 not found. Install Adoptium JDK 21 from https://adoptium.net/"
    }
}
Write-Host "  JAVA_HOME = $env:JAVA_HOME"

# ---------- STEP 0b: Prepare local Gradle (bypass wrapper) ----------
Write-Host "`n=== Step 0b: Preparing local Gradle 8.14.3 ===" -ForegroundColor Cyan
$gradleVersion = "8.14.3"
$gradleRoot = ".gradle-local"
$gradleHome = Join-Path $gradleRoot "gradle-$gradleVersion"
$GRADLE_BAT = Join-Path $gradleHome "bin\gradle.bat"

if (-not (Test-Path $GRADLE_BAT)) {
    New-Item -ItemType Directory -Force -Path $gradleRoot | Out-Null
    $zipPath = Join-Path $env:TEMP "gradle-$gradleVersion-bin.zip"
    $gradleUrl = "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip"

    Write-Host "  Downloading Gradle $gradleVersion..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $gradleUrl -OutFile $zipPath -UseBasicParsing

    Write-Host "  Extracting Gradle..." -ForegroundColor Yellow
    if (Test-Path $gradleHome) { Remove-Item -Recurse -Force $gradleHome }
    Expand-Archive -Path $zipPath -DestinationPath $gradleRoot -Force
    Remove-Item $zipPath -ErrorAction SilentlyContinue
}

if (-not (Test-Path $GRADLE_BAT)) {
    throw "Local Gradle setup failed: $GRADLE_BAT not found"
}
Write-Host "  Using: $GRADLE_BAT" -ForegroundColor Green

# ---------- STEP 1: Install npm deps ----------
Write-Host "`n=== Step 1: npm ci ===" -ForegroundColor Cyan
npm ci --prefer-offline
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

# ---------- STEP 2: Build web app ----------
Write-Host "`n=== Step 2: Building web app ===" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Vite build failed" }

# ---------- STEP 3: Capacitor sync ----------
Write-Host "`n=== Step 3: Capacitor sync ===" -ForegroundColor Cyan
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }

# ---------- STEP 3b: Reset project-local Gradle cache ----------
Write-Host "`n=== Step 3b: Resetting project-local Gradle cache ===" -ForegroundColor Cyan
$projectGradleHome = (Resolve-Path ".").Path + "\.gradle-user-home"
$env:GRADLE_USER_HOME = $projectGradleHome

if (Test-Path $projectGradleHome) {
    Remove-Item -Recurse -Force $projectGradleHome -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $projectGradleHome | Out-Null
Write-Host "  GRADLE_USER_HOME = $projectGradleHome"

# ---------- STEP 4: Gradle release build ----------
Write-Host "`n=== Step 4: Gradle assembleDebug ===" -ForegroundColor Cyan
& $GRADLE_BAT -g $projectGradleHome -p android assembleDebug --no-daemon --refresh-dependencies
if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }

# ---------- DONE ----------
$apk = "android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apk) {
    $size = [math]::Round((Get-Item $apk).Length / 1MB, 2)
    Write-Host "`n=== SUCCESS ===" -ForegroundColor Green
    Write-Host "  APK: $apk ($size MB)"
} else {
    Write-Host "`n=== Build completed but APK not found at expected path ===" -ForegroundColor Yellow
    Write-Host "  Check: android\app\build\outputs\"
}
