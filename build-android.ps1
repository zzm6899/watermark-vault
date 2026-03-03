#!/usr/bin/env pwsh
<#
  ONE-COMMAND ANDROID RELEASE BUILD
  Usage:  powershell -ExecutionPolicy Bypass -File .\build-android.ps1
  Output: android\app\build\outputs\apk\release\app-release-unsigned.apk
#>
$ErrorActionPreference = "Stop"

# ---------- CONFIG ----------
$JAVA_HOME_OVERRIDE = "C:\Program Files\Eclipse Adoptium\jdk-21.0.7.6-hotspot"

# ---------- STEP 0: Validate JDK ----------
Write-Host "`n=== Step 0: Checking JDK 21 ===" -ForegroundColor Cyan
if (Test-Path $JAVA_HOME_OVERRIDE) {
    $env:JAVA_HOME = $JAVA_HOME_OVERRIDE
    Write-Host "  JAVA_HOME -> $env:JAVA_HOME"
} else {
    Write-Host "  WARNING: $JAVA_HOME_OVERRIDE not found, using system JAVA_HOME ($env:JAVA_HOME)" -ForegroundColor Yellow
}
$ErrorActionPreference = "SilentlyContinue"
$jver = & java -version 2>&1 | Select-Object -First 1
$ErrorActionPreference = "Stop"
Write-Host "  $jver"

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
Write-Host "`n=== Step 1: npm install ===" -ForegroundColor Cyan
npm install --prefer-offline
if ($LASTEXITCODE -ne 0) { throw "npm install failed" }

# ---------- STEP 2: Build web app ----------
Write-Host "`n=== Step 2: Building web app ===" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "Vite build failed" }

# ---------- STEP 3: Capacitor sync ----------
Write-Host "`n=== Step 3: Capacitor sync ===" -ForegroundColor Cyan
npx cap sync android
if ($LASTEXITCODE -ne 0) { throw "cap sync failed" }

# ---------- STEP 4: Gradle release build ----------
Write-Host "`n=== Step 4: Gradle assembleRelease ===" -ForegroundColor Cyan
& $GRADLE_BAT -p android assembleRelease --no-daemon
if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }

# ---------- DONE ----------
$apk = "android\app\build\outputs\apk\release\app-release-unsigned.apk"
if (Test-Path $apk) {
    $size = [math]::Round((Get-Item $apk).Length / 1MB, 2)
    Write-Host "`n=== SUCCESS ===" -ForegroundColor Green
    Write-Host "  APK: $apk ($size MB)"
} else {
    Write-Host "`n=== Build completed but APK not found at expected path ===" -ForegroundColor Yellow
    Write-Host "  Check: android\app\build\outputs\"
}
