#!/bin/sh
# Renders the first page of each built template PDF to site/public/previews/<name>.png
# for the /templates/ page. Needs poppler (pdftoppm). Run from the repo root
# after building the templates, e.g. `make -C templates/thesis build`.
set -eu
out=site/public/previews
mkdir -p "$out"
for t in thesis paper slides; do
  pdf=$(ls templates/$t/*.pdf 2>/dev/null | head -n 1 || true)
  [ -n "$pdf" ] || { echo "skip $t: no PDF"; continue; }
  pdftoppm -f 1 -l 1 -png -singlefile -scale-to-x 850 -scale-to-y -1 "$pdf" "$out/$t"
  echo "wrote $out/$t.png"
done
