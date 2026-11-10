# Tests install.ps1 against a local fake release served over HTTP (no Pester).
# Cases: a good download installs the file; a tampered one fails and installs nothing.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("overfull-test-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$asset = 'overfull-win-x64.exe'
$server = $null

function Sha([string]$Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }

function Start-Server([string]$Dir, [int]$Port) {
  $py = if (Get-Command python3 -ErrorAction SilentlyContinue) { 'python3' } else { 'python' }
  $p = Start-Process -FilePath $py -ArgumentList @('-m', 'http.server', "$Port", '--bind', '127.0.0.1') `
    -WorkingDirectory $Dir -PassThru -WindowStyle Hidden
  for ($i = 0; $i -lt 50; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/SHA256SUMS" | Out-Null; return $p } catch { Start-Sleep -Milliseconds 200 }
  }
  Stop-Process -Id $p.Id -Force
  throw 'test-install: server did not start'
}

try {
  # Any real executable works as the fake release file.
  $real = Join-Path $env:SystemRoot 'System32\hostname.exe'
  $good = Join-Path $work 'good'
  $bad = Join-Path $work 'bad'
  New-Item -ItemType Directory -Path $good, $bad | Out-Null
  Copy-Item -LiteralPath $real -Destination (Join-Path $good $asset)
  "$(Sha (Join-Path $good $asset))  $asset" | Set-Content -Encoding ascii (Join-Path $good 'SHA256SUMS')
  Copy-Item (Join-Path $good 'SHA256SUMS') (Join-Path $bad 'SHA256SUMS')
  Copy-Item -LiteralPath (Join-Path $env:SystemRoot 'System32\whoami.exe') -Destination (Join-Path $bad $asset)

  $port = Get-Random -Minimum 20000 -Maximum 60000
  $env:OVERFULL_BASE_URL = "http://127.0.0.1:$port"

  Write-Host 'case 1: good download installs the file'
  $server = Start-Server $good $port
  $env:OVERFULL_INSTALL_DIR = Join-Path $work 'out1\bin'
  & (Join-Path $root 'install.ps1')
  $installed = Join-Path $env:OVERFULL_INSTALL_DIR 'overfull.exe'
  if (-not (Test-Path -LiteralPath $installed)) { throw 'FAIL: overfull.exe was not installed' }
  if ((Sha $installed) -ne (Sha (Join-Path $good $asset))) { throw 'FAIL: installed file differs from the release file' }
  Stop-Process -Id $server.Id -Force; $server = $null

  Write-Host 'case 2: tampered download fails and installs nothing'
  $server = Start-Server $bad $port
  $env:OVERFULL_INSTALL_DIR = Join-Path $work 'out2\bin'
  $failed = $false
  try { & (Join-Path $root 'install.ps1') } catch { $failed = $true; Write-Host "expected failure: $($_.Exception.Message)" }
  if (-not $failed) { throw 'FAIL: install.ps1 succeeded on a tampered download' }
  if (Test-Path -LiteralPath (Join-Path $env:OVERFULL_INSTALL_DIR 'overfull.exe')) { throw 'FAIL: a file was installed' }

  Write-Host 'test-install: ok'
} finally {
  if ($server) { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item -Recurse -Force -LiteralPath $work -ErrorAction SilentlyContinue
}
