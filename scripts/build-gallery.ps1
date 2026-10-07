param(
  [string]$SiteRoot = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($SiteRoot)) {
  $SiteRoot = Split-Path -Parent $PSScriptRoot
}

# Prefer the cross-platform builder: it preserves metadata and generates WebP
# thumbnails, display images, and intrinsic dimensions without changing originals.
foreach ($pythonName in @("python3", "python")) {
  $pythonCommand = Get-Command $pythonName -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    & $pythonCommand.Source -c "from PIL import Image" 2>$null
    if ($LASTEXITCODE -eq 0) {
      & $pythonCommand.Source (Join-Path $PSScriptRoot "build-gallery.py") --site-root $SiteRoot
      if ($LASTEXITCODE -ne 0) { throw "Gallery generation failed." }
      exit 0
    }
  }
}

$galleryDir = Join-Path $SiteRoot "assets/gallery"
$thumbDir = Join-Path $galleryDir "thumbs"
$manifestPath = Join-Path $galleryDir "gallery.json"

if (-not (Test-Path $galleryDir)) {
  Write-Host "Gallery directory not found: $galleryDir"
  exit 0
}

if (-not (Test-Path $thumbDir)) {
  New-Item -ItemType Directory -Path $thumbDir | Out-Null
}

Add-Type -AssemblyName System.Drawing

function Get-RelPath([string]$fullPath, [string]$basePath) {
  $rel = Resolve-Path -LiteralPath $fullPath | ForEach-Object { $_.Path.Replace((Resolve-Path -LiteralPath $basePath).Path, "") }
  $rel = $rel.TrimStart('\', '/')
  return $rel -replace '\\', '/'
}

function Get-TitleFromName([string]$name) {
  $withoutExt = [System.IO.Path]::GetFileNameWithoutExtension($name)
  $title = $withoutExt -replace '[_\-]+', ' '
  return (Get-Culture).TextInfo.ToTitleCase($title.ToLower())
}

function Resize-ToThumbnail([string]$src, [string]$dest, [int]$maxWidth = 1280, [int]$quality = 92) {
  $img = [System.Drawing.Image]::FromFile($src)
  try {
    $newWidth = [Math]::Min($maxWidth, $img.Width)
    $ratio = $newWidth / [double]$img.Width
    $newHeight = [Math]::Max(1, [int][Math]::Round($img.Height * $ratio))

    $bmp = New-Object System.Drawing.Bitmap $newWidth, $newHeight
    try {
      $gfx = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $gfx.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $gfx.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $gfx.Clear([System.Drawing.Color]::White)
        $gfx.DrawImage($img, 0, 0, $newWidth, $newHeight)
      } finally {
        $gfx.Dispose()
      }

      $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageDecoders() |
        Where-Object { $_.MimeType -eq "image/jpeg" } |
        Select-Object -First 1
      if ($jpegCodec) {
        $encoder = [System.Drawing.Imaging.Encoder]::Quality
        $encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
        $encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter($encoder, [long]$quality)
        $bmp.Save($dest, $jpegCodec, $encoderParams)
        $encoderParams.Dispose()
      } else {
        $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Jpeg)
      }
    } finally {
      $bmp.Dispose()
    }
  } finally {
    $img.Dispose()
  }
}

# Clean old generated thumbnails
Get-ChildItem -Path $thumbDir -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue

$allowed = @(".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp", ".svg")
$sourceFiles = Get-ChildItem -Path $galleryDir -File | Where-Object {
  $ext = $_.Extension.ToLower()
  ($allowed -contains $ext) -and ($_.Name -ne "gallery.json")
} | Sort-Object Name

$items = @()
foreach ($file in $sourceFiles) {
  $ext = $file.Extension.ToLower()
  $thumbName = ""
  $thumbAbs = ""

  if ($ext -eq ".svg") {
    $thumbName = $file.Name
    $thumbAbs = Join-Path $thumbDir $thumbName
    Copy-Item -LiteralPath $file.FullName -Destination $thumbAbs -Force
  } else {
    $thumbName = "{0}.jpg" -f [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $thumbAbs = Join-Path $thumbDir $thumbName
    try {
      Resize-ToThumbnail -src $file.FullName -dest $thumbAbs
    } catch {
      # Fallback: if conversion fails, use original as thumbnail path
      $thumbName = $file.Name
      $thumbAbs = Join-Path $thumbDir $thumbName
      Copy-Item -LiteralPath $file.FullName -Destination $thumbAbs -Force
    }
  }

  $srcRel = "assets/gallery/$($file.Name)"
  $thumbRel = "assets/gallery/thumbs/$thumbName"
  $title = Get-TitleFromName -name $file.Name

  $items += [ordered]@{
    src = $srcRel
    thumb = $thumbRel
    alt = $title
    caption = $title
  }
}

$json = $items | ConvertTo-Json -Depth 4
Set-Content -LiteralPath $manifestPath -Value $json -Encoding UTF8

Write-Host "Generated gallery manifest: $manifestPath"
Write-Host "Processed items: $($items.Count)"
