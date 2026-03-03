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

# ---------- STEP 0b: Fix Gradle wrapper if corrupted ----------
Write-Host "`n=== Step 0b: Validating Gradle wrapper ===" -ForegroundColor Cyan
$wrapperJar = "android\gradle\wrapper\gradle-wrapper.jar"
$needsDownload = $false

if (-not (Test-Path $wrapperJar)) {
    Write-Host "  Wrapper jar missing." -ForegroundColor Yellow
    $needsDownload = $true
} else {
    # Quick check: a valid jar starts with PK (zip magic bytes)
    $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $wrapperJar))
    if ($bytes.Length -lt 2 -or $bytes[0] -ne 0x50 -or $bytes[1] -ne 0x4B) {
        Write-Host "  Wrapper jar is corrupt (not a valid ZIP/JAR)." -ForegroundColor Yellow
        $needsDownload = $true
    }
}

if ($needsDownload) {
    Write-Host "  Downloading fresh gradle-wrapper.jar (8.14.3)..." -ForegroundColor Yellow
    $wrapperUrl = "https://raw.githubusercontent.com/gradle/gradle/v8.14.3/gradle/wrapper/gradle-wrapper.jar"
    try {
        Invoke-WebRequest -Uri $wrapperUrl -OutFile $wrapperJar -UseBasicParsing
        Write-Host "  Downloaded OK." -ForegroundColor Green
    } catch {
        Write-Host "  URL 1 failed, trying alternative..." -ForegroundColor Yellow
        try {
            $altUrl = "https://services.gradle.org/distributions/gradle-8.14.3-bin.zip"
            $zipPath = "$env:TEMP\gradle-8.14.3-bin.zip"
            Invoke-WebRequest -Uri $altUrl -OutFile $zipPath -UseBasicParsing
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            $zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
            $entry = $zip.Entries | Where-Object { $_.FullName -like "*/gradle-wrapper.jar" } | Select-Object -First 1
            if ($entry) {
                $stream = $entry.Open()
                $fs = [System.IO.File]::Create((Resolve-Path $wrapperJar))
                $stream.CopyTo($fs)
                $fs.Close()
                $stream.Close()
                Write-Host "  Extracted from distribution OK." -ForegroundColor Green
            }
            $zip.Dispose()
            Remove-Item $zipPath -ErrorAction SilentlyContinue
        } catch {
            throw "Cannot obtain gradle-wrapper.jar. Download Gradle 8.14.3 manually from https://gradle.org/releases/ and copy lib/gradle-wrapper.jar to android/gradle/wrapper/"
        }
    }
} else {
    Write-Host "  Gradle wrapper OK."
}

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
Push-Location android
try {
    .\gradlew.bat assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Gradle build failed" }
} finally {
    Pop-Location
}

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
