#!/bin/sh
# Renders the first page of each template to site/public/previews/:
#   <name>.png       640 px wide, shown on the /templates/ page
#   <name>-full.png  1400 px wide, opened when the preview is clicked
#
# Builds each template in a temporary copy (the templates stay clean) with a
# TeX Live image, then rasterises page 1 with poppler (pdftoppm). Run from the
# repository root:
#   sh site/scripts/previews.sh                 # uses overfull-tex:dev
#   IMAGE=overfull:dev sh site/scripts/previews.sh
set -eu
image=${IMAGE:-overfull-tex:dev}
out=site/public/previews
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out"
for t in thesis paper slides; do
  cp -r "templates/$t" "$tmp/$t"
  docker run --rm -v "$tmp/$t:/work" -w /work "$image" latexmk >"$tmp/$t.log" 2>&1 ||
    { echo "skip $t: build failed (see $tmp/$t.log)"; continue; }
  pdf=$(ls "$tmp/$t"/*.pdf | head -n 1)
  pdftoppm -f 1 -l 1 -png -singlefile -scale-to-x 640 -scale-to-y -1 "$pdf" "$out/$t"
  pdftoppm -f 1 -l 1 -png -singlefile -scale-to-x 1400 -scale-to-y -1 "$pdf" "$out/$t-full"
  echo "wrote $out/$t.png and $out/$t-full.png"
done
