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
  Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS" -OutFile (Join-Path $tmp 'SHA256SUMS')
  $sums = @{}
  foreach ($line in Get-Content -LiteralPath (Join-Path $tmp 'SHA256SUMS')) {
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -eq 2) { $sums[$parts[1].TrimStart('*')] = $parts[0].ToLowerInvariant() }
  }
  $want = $sums[$asset]
  if (-not $want) { Fail "SHA256SUMS has no entry for $asset" }

  # Releases since 3.2 also ship the executable gzip-compressed (about a third of the
  # size). Both the compressed download and the unpacked file are checked.
  $wantGz = $sums["$asset.gz"]
  if ($wantGz) {
    Write-Host "Downloading $asset.gz from $base"
    $gzPath = Join-Path $tmp "$asset.gz"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset.gz" -OutFile $gzPath
    $gotGz = (Get-FileHash -Algorithm SHA256 -LiteralPath $gzPath).Hash.ToLowerInvariant()
    if ($gotGz -ne $wantGz) { Fail "checksum mismatch for $asset.gz (expected $wantGz, got $gotGz); nothing installed" }
    $in = [System.IO.File]::OpenRead($gzPath)
    try {
      $gunzip = New-Object System.IO.Compression.GZipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
      $out = [System.IO.File]::Create((Join-Path $tmp $asset))
      try { $gunzip.CopyTo($out) } finally { $out.Dispose(); $gunzip.Dispose() }
    } finally { $in.Dispose() }
  } else {
    Write-Host "Downloading $asset from $base"
    Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile (Join-Path $tmp $asset)
  }
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
