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
        Write-Host "  JDK 21 not found locally. Downloading a project-local Temurin JDK 21..." -ForegroundColor Yellow
        $jdkRoot = ".jdk-local"
        $jdkZip = Join-Path $env:TEMP "temurin-jdk21.zip"
        $jdkUrl = "https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
        New-Item -ItemType Directory -Force -Path $jdkRoot | Out-Null
        Invoke-WebRequest -Uri $jdkUrl -OutFile $jdkZip -UseBasicParsing
        Expand-Archive -Path $jdkZip -DestinationPath $jdkRoot -Force
        Remove-Item $jdkZip -ErrorAction SilentlyContinue
        $jdk21 = Get-ChildItem -Path $jdkRoot -Directory | Where-Object { $_.Name -match "jdk-21" } | Select-Object -First 1
        if (-not $jdk21) { throw "Downloaded JDK 21 but could not locate extracted jdk-21 directory." }
        $env:JAVA_HOME = $jdk21.FullName
        Write-Host "  Using project-local JDK 21: $env:JAVA_HOME" -ForegroundColor Green
    }
}
Write-Host "  JAVA_HOME = $env:JAVA_HOME"

# ---------- STEP 0b: Prepare Android SDK ----------
Write-Host "`n=== Step 0b: Checking Android SDK ===" -ForegroundColor Cyan
$sdkDir = $env:ANDROID_HOME
if (-not $sdkDir) { $sdkDir = $env:ANDROID_SDK_ROOT }
if (-not $sdkDir -or -not (Test-Path $sdkDir)) {
    $defaultSdk = "C:\Users\24681\AppData\Local\Android\Sdk"
    if (Test-Path $defaultSdk) { $sdkDir = $defaultSdk }
}
if (-not $sdkDir -or -not (Test-Path $sdkDir)) {
    Write-Host "  Android SDK not found. Downloading command-line tools locally..." -ForegroundColor Yellow
    $sdkDir = (Resolve-Path ".").Path + "\.android-sdk"
    $cmdlineRoot = Join-Path $sdkDir "cmdline-tools"
    $latestDir = Join-Path $cmdlineRoot "latest"
    $sdkZip = Join-Path $env:TEMP "android-commandlinetools.zip"
    $sdkUrl = "https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip"
    New-Item -ItemType Directory -Force -Path $cmdlineRoot | Out-Null
    Invoke-WebRequest -Uri $sdkUrl -OutFile $sdkZip -UseBasicParsing
    $tmpExtract = Join-Path $env:TEMP "android-commandlinetools"
    if (Test-Path $tmpExtract) { Remove-Item -Recurse -Force $tmpExtract }
    Expand-Archive -Path $sdkZip -DestinationPath $tmpExtract -Force
    if (Test-Path $latestDir) { Remove-Item -Recurse -Force $latestDir }
    Move-Item -Path (Join-Path $tmpExtract "cmdline-tools") -Destination $latestDir
    Remove-Item $sdkZip -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $tmpExtract -ErrorAction SilentlyContinue
}
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir
$sdkManager = Join-Path $sdkDir "cmdline-tools\latest\bin\sdkmanager.bat"
if (-not (Test-Path $sdkManager)) {
    throw "Android SDK manager not found at $sdkManager"
}
Write-Host "  ANDROID_HOME = $env:ANDROID_HOME" -ForegroundColor Green
Write-Host "  Installing required SDK packages..." -ForegroundColor Yellow
& $sdkManager --sdk_root=$sdkDir "platform-tools" "platforms;android-35" "build-tools;35.0.0"
if ($LASTEXITCODE -ne 0) { throw "Android SDK package install failed" }
"y`n" * 100 | & $sdkManager --sdk_root=$sdkDir --licenses | Out-Host
if ($LASTEXITCODE -ne 0) { throw "Android SDK license acceptance failed" }

$escapedSdkDir = $sdkDir.Replace("\", "\\")
Set-Content -Path "android\local.properties" -Value "sdk.dir=$escapedSdkDir" -Encoding ASCII

# ---------- STEP 0c: Prepare local Gradle (bypass wrapper) ----------
Write-Host "`n=== Step 0c: Preparing local Gradle 8.14.3 ===" -ForegroundColor Cyan
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

# ---------- STEP 4: Gradle debug build ----------
Write-Host "`n=== Step 4: Gradle assembleDebug ===" -ForegroundColor Cyan
& $GRADLE_BAT -g $projectGradleHome -p android assembleDebug --no-daemon --refresh-dependencies
if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }

# ---------- STEP 5: Copy APK to easy-access folder ----------
$apk = "android\app\build\outputs\apk\debug\app-debug.apk"
if (Test-Path $apk) {
    $outDir = "artifacts\android"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $outApk = Join-Path $outDir "PhotoFlow-debug.apk"
    Copy-Item -Path $apk -Destination $outApk -Force
    $size = [math]::Round((Get-Item $apk).Length / 1MB, 2)
    Write-Host "`n=== SUCCESS ===" -ForegroundColor Green
    Write-Host "  APK: $outApk ($size MB)"
} else {
    Write-Host "`n=== Build completed but APK not found at expected path ===" -ForegroundColor Yellow
    Write-Host "  Check: android\app\build\outputs\"
}
