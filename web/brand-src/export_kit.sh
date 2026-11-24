#!/bin/sh
# Export the web icon set from the kit masters (run build_kit.py first). From anywhere: sh web/brand-src/export_kit.sh
# Uses the logo-design skill's export_variants.py and render_png.py (headless Chrome). Their temp files and the
# browser profile go to a private mktemp folder (HOME and TMPDIR point there), removed on exit.
set -eu
SKILL="${LOGO_SKILL:-$HOME/.claude/plugins/cache/logo-design-skill/logo-design/1.4.5/skills/logo-design}"
S="$SKILL/scripts"
cd "$(dirname "$0")"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/home" "$T/tmp"
run() { HOME="$T/home" TMPDIR="$T/tmp" python3 "$@"; }
OUT=../public/brand
rm -rf "$OUT"
mkdir -p "$OUT"

# 1. Mark variants (black, white, red, square, app icon) and the PNG app/PWA icons. The tiles keep the light-on-dark
#    colours (white bowl, red spine) of the thinned reversed master.
run "$S/export_variants.py" kit/dossier-mark.svg --name dossier-mark --title Dossier --mono "#e5484d" \
  --icon-bg "#141416" --icon-fg keep --favicon-source kit/dossier-mark-reversed.svg --web-icons --out-dir "$OUT"

# 2. Favicon: the 16 px pixel-grid cut on its own dark tile (readable on light and dark tabs). It replaces the
#    transparent favicon files of step 1. The manifest and head tags are hand-kept (web/public/site.webmanifest,
#    web/index.html), so the generated ones are dropped.
run "$S/render_png.py" --backend chrome kit/dossier-favicon.svg --ico ../public/favicon.ico --ico-sizes 16 32 48
for s in 16 32 48; do
  run "$S/render_png.py" --backend chrome kit/dossier-favicon.svg -o "$OUT/favicon-$s.png" --size "$s"
done
cp kit/dossier-favicon.svg "$OUT/favicon.svg"
rm -f "$OUT/favicon.ico" "$OUT/site.webmanifest" "$OUT/head-snippet.html" "$OUT/dossier-mark-favicon.svg"

# 3. Lockup one-colour versions, and the colour masters as they are.
run "$S/export_variants.py" kit/dossier-lockup.svg --name dossier-lockup --title Dossier --only black white mono \
  --mono "#e5484d" --out-dir "$OUT"
cp kit/dossier-mark-color.svg kit/dossier-mark-reversed.svg kit/dossier-lockup-color.svg \
  kit/dossier-lockup-reversed.svg kit/dossier-wordmark.svg kit/dossier-wordmark-reversed.svg "$OUT/"
ls "$OUT"
