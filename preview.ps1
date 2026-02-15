param(
  [int]$Port = 1313
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$galleryBuilder = Join-Path $root "scripts/build-gallery.ps1"

if (Test-Path $galleryBuilder) {
  Write-Host "Building gallery thumbnails and manifest..."
  powershell -ExecutionPolicy Bypass -File $galleryBuilder -SiteRoot $root
}

function Test-PortInUse {
  param([int]$CheckPort)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect("127.0.0.1", $CheckPort, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(200)
    if ($connected -and $client.Connected) {
      $client.EndConnect($async) | Out-Null
      $client.Close()
      return $true
    }
    $client.Close()
    return $false
  } catch {
    return $false
  }
}

$finalPort = $Port
while (Test-PortInUse -CheckPort $finalPort) {
  $finalPort++
}

if ($finalPort -ne $Port) {
  Write-Host "Port $Port is in use, switched to $finalPort."
}

Write-Host "Preview server root: $root"
Write-Host "Opening browser: http://localhost:$finalPort/"

Start-Process "http://localhost:$finalPort/"
Set-Location $root

if (Get-Command py -ErrorAction SilentlyContinue) {
  py -m http.server $finalPort
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server $finalPort
} else {
  Write-Error "Python was not found. Please install Python 3 first."
}
