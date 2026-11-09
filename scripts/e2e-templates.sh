#!/usr/bin/env bash
# Build every template inside the Overfull image and run its own preflight.
# Usage: scripts/e2e-templates.sh <image> <out-dir> [template...]
# A template passes when `overfull check` exits 0 (no errors).
set -euo pipefail

image="${1:?usage: e2e-templates.sh <image> <out-dir> [template...]}"
out="${2:?usage: e2e-templates.sh <image> <out-dir> [template...]}"
shift 2
templates=("$@")
if [ ${#templates[@]} -eq 0 ]; then
  templates=(thesis paper slides)
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
# Extra `docker run` arguments, e.g. proxy settings: E2E_DOCKER_ARGS="-e HTTPS_PROXY=..."
read -r -a extra <<< "${E2E_DOCKER_ARGS:-}"
mkdir -p "$out"
out="$(cd "$out" && pwd)"
failed=()

for t in "${templates[@]}"; do
  dir="$out/$t"
  rm -rf "$dir"
  cp -R "$root/templates/$t" "$dir"
  echo "::group::$t: build"
  if ! docker run --rm "${extra[@]}" -v "$dir:/work" -w /work "$image" overfull build; then
    echo "::endgroup::"
    echo "✕ $t: build failed"
    failed+=("$t")
    continue
  fi
  echo "::endgroup::"
  echo "::group::$t: check"
  set +e
  docker run --rm "${extra[@]}" -v "$dir:/work" -w /work "$image" overfull check --json --fail-on error > "$dir/overfull-report.json"
  status=$?
  docker run --rm "${extra[@]}" -v "$dir:/work" -w /work "$image" overfull check --fail-on never
  set -e
  echo "::endgroup::"
  if [ "$status" -ne 0 ]; then
    echo "✕ $t: preflight failed (exit $status)"
    failed+=("$t")
  else
    echo "✓ $t"
  fi
done

if [ ${#failed[@]} -gt 0 ]; then
  echo "Failed templates: ${failed[*]}"
  exit 1
fi
