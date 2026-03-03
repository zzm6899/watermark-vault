#!/usr/bin/env pwsh
<#
  ONE-COMMAND ANDROID RELEASE BUILD
  Usage:  .\build-android.ps1
  Output: android\app\build\outputs\apk\release\app-release-unsigned.apk
#>
$ErrorActionPreference = "Stop"

# ---------- CONFIG ----------
$JAVA_HOME_OVERRIDE = "C:\Program Files\Eclipse Adoptium\jdk-21.0.7.6-hotspot"
# Adjust above if your JDK 21 path differs.
# Run: dir "C:\Program Files\Eclipse Adoptium" to check.

# ---------- STEP 0: Validate JDK ----------
Write-Host "`n=== Step 0: Checking JDK 21 ===" -ForegroundColor Cyan
if (Test-Path $JAVA_HOME_OVERRIDE) {
    $env:JAVA_HOME = $JAVA_HOME_OVERRIDE
    Write-Host "  JAVA_HOME -> $env:JAVA_HOME"
} else {
    Write-Host "  WARNING: $JAVA_HOME_OVERRIDE not found, using system JAVA_HOME ($env:JAVA_HOME)" -ForegroundColor Yellow
}
$jver = & java -version 2>&1 | Select-Object -First 1
Write-Host "  $jver"

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
