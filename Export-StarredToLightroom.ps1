#Requires -Version 5.1
<#
.SYNOPSIS
    Matches starred Watermark Vault photos to your NEF files and writes
    5-star XMP sidecar files so Lightroom / Capture One pick them up automatically.

.DESCRIPTION
    Workflow:
      1. In Watermark Vault Admin → Albums → click the ★ button on an album
         to download a .txt file of starred filenames (e.g. starred_session_2025-03-05.txt)
      2. Copy your NEF card dump to your editing drive
      3. Run this script:
           .\Export-StarredToLightroom.ps1 -StarredTxt "C:\path\to\starred_session.txt" -NefFolder "D:\shoots\2025-03-05"
      4. Open Lightroom → filter by ★★★★★ → only client picks shown

.PARAMETER StarredTxt
    Path to the .txt file exported from Watermark Vault Admin.

.PARAMETER NefFolder
    Folder containing your flat NEF dump from the card.

.PARAMETER OutputFolder
    Where to copy matched NEFs + XMP sidecars.
    Defaults to a "_starred" subfolder inside NefFolder.

.PARAMETER CopyNefs
    If set, copies matched NEFs to OutputFolder.
    If not set, writes XMP sidecars IN PLACE next to the original NEFs.

.PARAMETER NefExtension
    RAW file extension to match. Defaults to NEF (Nikon).
    Change to ARW for Sony, CR3 for Canon, RAF for Fuji, etc.

.EXAMPLE
    # Write XMP sidecars in-place (no copy) — simplest, open folder directly in Lightroom
    .\Export-StarredToLightroom.ps1 -StarredTxt ".\starred_emma-portraits_2025-03-05.txt" -NefFolder "D:\shoots\raw"

.EXAMPLE
    # Copy starred NEFs + sidecars to a new folder
    .\Export-StarredToLightroom.ps1 -StarredTxt ".\starred_session.txt" -NefFolder "D:\shoots\raw" -CopyNefs
#>

param(
    [Parameter(Mandatory)]
    [string]$StarredTxt,

    [Parameter(Mandatory)]
    [string]$NefFolder,

    [string]$OutputFolder = "",

    [switch]$CopyNefs,

    [string]$NefExtension = "NEF"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Validate inputs ───────────────────────────────────────────────────────────
if (-not (Test-Path $StarredTxt)) {
    Write-Error "Starred file not found: $StarredTxt"
    exit 1
}
if (-not (Test-Path $NefFolder)) {
    Write-Error "NEF folder not found: $NefFolder"
    exit 1
}

# ── Read starred filenames ────────────────────────────────────────────────────
$starredLines = Get-Content $StarredTxt | Where-Object { $_ -notmatch "^#" -and $_.Trim() -ne "" }
if ($starredLines.Count -eq 0) {
    Write-Warning "No filenames found in $StarredTxt (all lines were comments or blank)"
    exit 0
}

Write-Host ""
Write-Host "  Watermark Vault → Lightroom XMP Export" -ForegroundColor Cyan
Write-Host "  ───────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Starred list : $StarredTxt ($($starredLines.Count) entries)" -ForegroundColor Gray
Write-Host "  NEF folder   : $NefFolder" -ForegroundColor Gray
Write-Host "  Extension    : .$NefExtension" -ForegroundColor Gray
Write-Host ""

# Build a lookup: base filename (no extension, lowercase) → full NEF path
$nefLookup = @{}
Get-ChildItem -Path $NefFolder -Filter "*.$NefExtension" | ForEach-Object {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($_.Name).ToLower()
    $nefLookup[$base] = $_.FullName
}

if ($nefLookup.Count -eq 0) {
    Write-Warning "No .$NefExtension files found in $NefFolder"
    exit 0
}
Write-Host "  Found $($nefLookup.Count) .$NefExtension files in folder" -ForegroundColor Gray
Write-Host ""

# ── Set up output folder if copying ──────────────────────────────────────────
if ($CopyNefs) {
    if ($OutputFolder -eq "") {
        $OutputFolder = Join-Path $NefFolder "_starred"
    }
    if (-not (Test-Path $OutputFolder)) {
        New-Item -ItemType Directory -Path $OutputFolder | Out-Null
        Write-Host "  Created output folder: $OutputFolder" -ForegroundColor Gray
    }
}

# ── XMP sidecar template (5 stars, label = Red for quick ID in Lightroom) ────
function New-XmpSidecar {
    param([string]$BaseName)
    # xmp:Rating = 5 → 5 stars in Lightroom, Capture One, darktable, RawTherapee
    # xmp:Label = "Red" → red colour label in Lightroom (optional, remove if unwanted)
    return @"
<?xpacket begin='' id='W5M0MpCehiHzreSzNTczkc9d'?>
<x:xmpmeta xmlns:x='adobe:ns:meta/' x:xmptk='Watermark Vault Export'>
  <rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'>
    <rdf:Description rdf:about=''
        xmlns:xmp='http://ns.adobe.com/xap/1.0/'
        xmlns:dc='http://purl.org/dc/elements/1.1/'>
      <xmp:Rating>5</xmp:Rating>
      <xmp:Label>Red</xmp:Label>
      <dc:description>
        <rdf:Alt>
          <rdf:li xml:lang='x-default'>Starred by client in Watermark Vault</rdf:li>
        </rdf:Alt>
      </dc:description>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end='w'?>
"@
}

# ── Match and process ─────────────────────────────────────────────────────────
$matched   = 0
$notFound  = @()

foreach ($line in $starredLines) {
    $line = $line.Trim()
    # Strip any extension from the starred filename to get the base name
    $base = [System.IO.Path]::GetFileNameWithoutExtension($line).ToLower()

    if ($nefLookup.ContainsKey($base)) {
        $nefPath = $nefLookup[$base]
        $xmpContent = New-XmpSidecar -BaseName $base

        if ($CopyNefs) {
            # Copy NEF to output folder
            $destNef = Join-Path $OutputFolder ([System.IO.Path]::GetFileName($nefPath))
            Copy-Item -Path $nefPath -Destination $destNef -Force
            # Write XMP next to copied NEF
            $xmpPath = [System.IO.Path]::ChangeExtension($destNef, "xmp")
        } else {
            # Write XMP in-place next to original NEF
            $xmpPath = [System.IO.Path]::ChangeExtension($nefPath, "xmp")
        }

        $xmpContent | Set-Content -Path $xmpPath -Encoding UTF8 -NoNewline
        Write-Host "  ✓  $([System.IO.Path]::GetFileName($nefPath))" -ForegroundColor Green
        $matched++
    } else {
        $notFound += $line
        Write-Host "  ✗  $line  (no matching .$NefExtension found)" -ForegroundColor Yellow
    }
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ───────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  Matched  : $matched of $($starredLines.Count)" -ForegroundColor Cyan

if ($CopyNefs) {
    Write-Host "  Output   : $OutputFolder" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Open '$OutputFolder' in Lightroom and filter by ★★★★★" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "  XMP sidecars written in-place in: $NefFolder" -ForegroundColor White
    Write-Host "  Open that folder in Lightroom and filter by ★★★★★" -ForegroundColor White
}

if ($notFound.Count -gt 0) {
    Write-Host ""
    Write-Host "  Not matched ($($notFound.Count)) — filenames in txt but no NEF found:" -ForegroundColor Yellow
    $notFound | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkYellow }
    Write-Host ""
    Write-Host "  Tip: Check the NEF folder path, or that you copied the right card dump." -ForegroundColor DarkGray
}
Write-Host ""
