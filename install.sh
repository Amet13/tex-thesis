#!/bin/sh
# Installs the overfull CLI from GitHub Releases.
#
#   curl -fsSL https://amet13.github.io/overfull/install.sh | sh
#
# Environment:
#   OVERFULL_VERSION      release tag to install, e.g. v3.1.0 (default: latest)
#   OVERFULL_INSTALL_DIR  target directory (default: $HOME/.local/bin)
#   OVERFULL_BASE_URL     download base URL (for tests; overrides the release URL)
#
# The download is checked against the release's SHA256SUMS. Nothing is
# installed when the checksum does not match or cannot be checked. No sudo.
set -eu

repo="amet13/overfull"

err() {
  printf 'overfull install: %s\n' "$*" >&2
  exit 1
}

os="$(uname -s)"
cpu="$(uname -m)"
case "$os" in
  Linux)
    case "$cpu" in
      x86_64 | amd64) asset="overfull-linux-x64" ;;
      aarch64 | arm64) asset="overfull-linux-arm64" ;;
      *) err "no build for Linux on $cpu. Use overfull.cjs with Node.js 26 or the Docker image: https://github.com/$repo/releases" ;;
    esac
    ;;
  Darwin)
    case "$cpu" in
      arm64) asset="overfull-darwin-arm64" ;;
      *) err "no native build for Intel Macs, and the arm64 build does not run under Rosetta. Use overfull.cjs with Node.js 26 or Docker (ghcr.io/amet13/overfull): https://github.com/$repo/releases" ;;
    esac
    ;;
  *) err "unsupported system $os. On Windows use install.ps1. Otherwise use overfull.cjs with Node.js 26 or Docker." ;;
esac

if [ -n "${OVERFULL_BASE_URL:-}" ]; then
  base="${OVERFULL_BASE_URL%/}"
elif [ -n "${OVERFULL_VERSION:-}" ]; then
  base="https://github.com/$repo/releases/download/$OVERFULL_VERSION"
else
  base="https://github.com/$repo/releases/latest/download"
fi

dir="${OVERFULL_INSTALL_DIR:-${HOME:?HOME is not set}/.local/bin}"

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  err "curl or wget is required"
fi

if command -v sha256sum >/dev/null 2>&1; then
  hash_of() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  hash_of() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  err "sha256sum or shasum is required to verify the download"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

printf 'Downloading %s from %s\n' "$asset" "$base"
fetch "$base/$asset" "$tmp/$asset" || err "download of $asset failed"
fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS" || err "download of SHA256SUMS failed"

want="$(awk -v f="$asset" '{ n = $2; sub(/^\*/, "", n); if (n == f) { print $1; exit } }' "$tmp/SHA256SUMS")"
[ -n "$want" ] || err "SHA256SUMS has no entry for $asset"
got="$(hash_of "$tmp/$asset")"
[ "$got" = "$want" ] || err "checksum mismatch for $asset (expected $want, got $got); nothing installed"

mkdir -p "$dir"
chmod +x "$tmp/$asset"
mv -f "$tmp/$asset" "$dir/overfull" 2>/dev/null || { cp "$tmp/$asset" "$dir/overfull" && chmod +x "$dir/overfull"; }

printf 'Installed %s/overfull\n' "$dir"
case ":${PATH:-}:" in
  *":$dir:"*) ;;
  *)
    printf '%s is not on your PATH. Add this line to your shell profile:\n' "$dir"
    printf '  export PATH="%s:$PATH"\n' "$dir"
    ;;
esac
"$dir/overfull" --version
