# Installs the overfull CLI from GitHub Releases (Windows, x64).
#
#   irm https://amet13.github.io/overfull/install.ps1 | iex
#
# Environment:
#   OVERFULL_VERSION      release tag to install, e.g. v3.1.0 (default: latest)
#   OVERFULL_INSTALL_DIR  target directory (default: %LOCALAPPDATA%\overfull\bin)
#   OVERFULL_BASE_URL     download base URL (for tests; overrides the release URL)
#
# The download is checked against the release's SHA256SUMS. Nothing is
# installed when the checksum does not match or is missing.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Fail([string]$Message) {
  throw "overfull install: $Message"
}

$arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
if ($arch -ne 'X64') {
  Fail "no Windows build for $arch. Use overfull.cjs with Node.js 26 or Docker: https://github.com/amet13/overfull/releases"
}
$asset = 'overfull-win-x64.exe'

if ($env:OVERFULL_BASE_URL) {
  $base = $env:OVERFULL_BASE_URL.TrimEnd('/')
} elseif ($env:OVERFULL_VERSION) {
  $base = "https://github.com/amet13/overfull/releases/download/$($env:OVERFULL_VERSION)"
} else {
  $base = 'https://github.com/amet13/overfull/releases/latest/download'
}

if ($env:OVERFULL_INSTALL_DIR) {
  $dir = $env:OVERFULL_INSTALL_DIR
} else {
  $dir = Join-Path $env:LOCALAPPDATA 'overfull\bin'
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("overfull-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading $asset from $base"
  Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile (Join-Path $tmp $asset)
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')

  $want = $null
  foreach ($line in Get-Content -LiteralPath (Join-Path $tmp 'SHA256SUMS')) {
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $asset) {
      $want = $parts[0].ToLowerInvariant()
      break
    }
  }
  if (-not $want) { Fail "SHA256SUMS has no entry for $asset" }
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $tmp $asset)).Hash.ToLowerInvariant()
  if ($got -ne $want) { Fail "checksum mismatch for $asset (expected $want, got $got); nothing installed" }

  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $exe = Join-Path $dir 'overfull.exe'
  Copy-Item -Force -LiteralPath (Join-Path $tmp $asset) -Destination $exe
} finally {
  Remove-Item -Recurse -Force -LiteralPath $tmp -ErrorAction SilentlyContinue
}

Write-Host "Installed $exe"
$onPath = ($env:PATH -split ';') | Where-Object { $_.TrimEnd('\') -ieq $dir.TrimEnd('\') }
if (-not $onPath) {
  Write-Host "$dir is not on your PATH. Run this once, then open a new terminal:"
  Write-Host "  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';$dir', 'User')"
}
& $exe --version
if ($LASTEXITCODE -ne 0) { Write-Warning "overfull --version exited with $LASTEXITCODE" }
