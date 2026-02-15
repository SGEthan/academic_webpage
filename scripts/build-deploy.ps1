param(
  [string]$SiteRoot = "",
  [string]$OutDirName = "_deploy"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($SiteRoot)) {
  $SiteRoot = Split-Path -Parent $PSScriptRoot
}

$outDir = Join-Path $SiteRoot $OutDirName
$galleryBuilder = Join-Path $SiteRoot "scripts/build-gallery.ps1"

if (Test-Path $galleryBuilder) {
  Write-Host "Building gallery thumbnails and manifest..."
  powershell -ExecutionPolicy Bypass -File $galleryBuilder -SiteRoot $SiteRoot
}

if (Test-Path $outDir) {
  Remove-Item -Recurse -Force $outDir
}
New-Item -ItemType Directory -Path $outDir | Out-Null

$copyList = @(
  "index.html",
  "publications.html",
  "gallery.html",
  "styles.css",
  "script.js",
  "assets",
  "bibtex"
)

foreach ($relPath in $copyList) {
  $src = Join-Path $SiteRoot $relPath
  if (Test-Path $src) {
    Copy-Item -Path $src -Destination $outDir -Recurse -Force
  } else {
    Write-Host "Skip missing path: $relPath"
  }
}

Write-Host ""
Write-Host "Deploy folder generated:"
Write-Host "  $outDir"
Write-Host "Upload everything inside this folder to your school homepage."
