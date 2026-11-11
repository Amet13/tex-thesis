#!/bin/sh
# Tests install.sh against a local fake release served over HTTP.
# Cases: a good download installs a working file; a tampered one installs nothing; a
# release with gzip copies installs from the .gz; a tampered .gz installs nothing.
set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
pid=""
cleanup() {
  [ -z "$pid" ] || kill "$pid" 2>/dev/null || true
  rm -rf "$work"
}
trap cleanup EXIT HUP INT TERM

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64 | Linux-amd64) asset=overfull-linux-x64 ;;
  Linux-aarch64 | Linux-arm64) asset=overfull-linux-arm64 ;;
  Darwin-arm64) asset=overfull-darwin-arm64 ;;
  Darwin-x86_64) asset=overfull-darwin-x64 ;;
  *) echo "test-install: unsupported platform, skipped"; exit 0 ;;
esac

if command -v sha256sum >/dev/null 2>&1; then sum() { sha256sum "$1" | cut -d ' ' -f 1; }
else sum() { shasum -a 256 "$1" | cut -d ' ' -f 1; }; fi

good="$work/good"
bad="$work/bad"
mkdir -p "$good" "$bad"
printf '#!/bin/sh\necho "overfull 0.0.0-test"\n' > "$good/$asset"
printf '%s  %s\n' "$(sum "$good/$asset")" "$asset" > "$good/SHA256SUMS"
# The tampered release has the genuine checksum for different file content.
cp "$good/SHA256SUMS" "$bad/SHA256SUMS"
printf '#!/bin/sh\necho tampered\n' > "$bad/$asset"

serve() { # serve <dir> <port>
  (cd "$1" && exec python3 -m http.server "$2" --bind 127.0.0.1 >/dev/null 2>&1) &
  pid=$!
  i=0
  while ! python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$2/SHA256SUMS')" 2>/dev/null; do
    i=$((i + 1))
    [ "$i" -lt 50 ] || { echo "test-install: server did not start" >&2; exit 1; }
    sleep 0.2
  done
}
stop() { kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; pid=""; }

port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"

echo "case 1: good download installs a working file"
serve "$good" "$port"
OVERFULL_BASE_URL="http://127.0.0.1:$port" OVERFULL_INSTALL_DIR="$work/out1/bin" sh "$root/install.sh"
out="$("$work/out1/bin/overfull" --version)"
[ "$out" = "overfull 0.0.0-test" ] || { echo "FAIL: unexpected version output: $out" >&2; exit 1; }
stop

echo "case 2: tampered download fails and installs nothing"
serve "$bad" "$port"
if OVERFULL_BASE_URL="http://127.0.0.1:$port" OVERFULL_INSTALL_DIR="$work/out2/bin" sh "$root/install.sh"; then
  echo "FAIL: install.sh succeeded on a tampered download" >&2
  exit 1
fi
[ ! -e "$work/out2/bin/overfull" ] || { echo "FAIL: a file was installed" >&2; exit 1; }
stop

echo "case 3: a release with a .gz copy installs from it"
gz="$work/gz"
mkdir -p "$gz"
printf '#!/bin/sh\necho "overfull 0.0.0-gz"\n' > "$gz/$asset"
gzip -9 -c "$gz/$asset" > "$gz/$asset.gz"
printf '%s  %s\n%s  %s\n' "$(sum "$gz/$asset")" "$asset" "$(sum "$gz/$asset.gz")" "$asset.gz" > "$gz/SHA256SUMS"
mv "$gz/$asset" "$work/plain-not-served"
serve "$gz" "$port"
OVERFULL_BASE_URL="http://127.0.0.1:$port" OVERFULL_INSTALL_DIR="$work/out3/bin" sh "$root/install.sh"
out="$("$work/out3/bin/overfull" --version)"
[ "$out" = "overfull 0.0.0-gz" ] || { echo "FAIL: unexpected version output: $out" >&2; exit 1; }
stop

echo "case 4: a .gz that does not match its checksum installs nothing"
gzip -9 -c "$bad/$asset" > "$gz/$asset.gz"
serve "$gz" "$port"
if OVERFULL_BASE_URL="http://127.0.0.1:$port" OVERFULL_INSTALL_DIR="$work/out4/bin" sh "$root/install.sh"; then
  echo "FAIL: install.sh succeeded on a tampered .gz" >&2
  exit 1
fi
[ ! -e "$work/out4/bin/overfull" ] || { echo "FAIL: a file was installed" >&2; exit 1; }
stop

echo "test-install: ok"
