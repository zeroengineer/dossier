"""Build the Dossier logo kit masters from concept A "Bound D" v3 (needs fontTools).

Usage, from web/brand-src:  python3 build_kit.py
Writes into kit/ (committed masters) and ../src/components/logo-paths.ts (the paths the app draws inline).
Then run ./export_kit.sh to produce the web icons in ../public.

Geometry (viewBox 0 0 256 256):
- spine: rounded bar x 36..80, y 16..240, r 6 (the red accent, "the binding")
- gap: 16 units
- bowl: x 96.., a flat run of 26 then a half circle R 104 around (122, 128); stroke 44
- reversed (light on dark): the white bowl is thinned by 1 unit per edge against irradiation; the spine keeps its size
- small cut: drawn on a 16 px grid (16 units = 1 px at 16 px) so every edge lands on a pixel; spine 2 px, gap 1 px,
  bowl stroke 2 px, no corner radii. The favicon puts it on a #141416 tile with a 3 px corner.
The wordmark is Manrope SemiBold (SIL OFL 1.1) outlined to paths, cap height 100, tracking -24 units.
"""
import math
import os

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
FONT = os.path.join(ROOT, "assets", "fonts", "Manrope", "Manrope-SemiBold.ttf")
KIT = os.path.join(HERE, "kit")
TS_OUT = os.path.join(ROOT, "web", "src", "components", "logo-paths.ts")
INK, WHITE, RED, BG = "#000", "#fff", "#e5484d", "#141416"


def f(x):
    s = f"{x:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def rrect(x0, y0, x1, y1, r):
    if r == 0:
        return f"M{f(x0)} {f(y0)}H{f(x1)}V{f(y1)}H{f(x0)}Z"
    return (f"M{f(x0+r)} {f(y0)}H{f(x1-r)}A{f(r)} {f(r)} 0 0 1 {f(x1)} {f(y0+r)}V{f(y1-r)}"
            f"A{f(r)} {f(r)} 0 0 1 {f(x1-r)} {f(y1)}H{f(x0+r)}A{f(r)} {f(r)} 0 0 1 {f(x0)} {f(y1-r)}"
            f"V{f(y0+r)}A{f(r)} {f(r)} 0 0 1 {f(x0+r)} {f(y0)}Z")


def bowl(bx, cx, top, bot, st):
    """A D bowl: from x=bx a flat run to cx, a half circle to the bottom, back; stroke st (a real hole)."""
    R = (bot - top) / 2
    ri = R - st
    return (f"M{f(bx)} {f(top)}H{f(cx)}A{f(R)} {f(R)} 0 0 1 {f(cx)} {f(bot)}H{f(bx)}V{f(bot-st)}H{f(cx)}"
            f"A{f(ri)} {f(ri)} 0 0 0 {f(cx)} {f(top+st)}H{f(bx)}Z")


# ---------------------------------------------------------------- symbol geometry
MARK = {  # concept A v3, unchanged: the approved drawing
    "bowl": bowl(96, 122, 24, 232, 44),
    "accent": rrect(36, 16, 80, 240, 6),
}
MARK_REVERSED = {  # light on dark: bowl thinned 1 unit per edge (outer R 103, stroke 42)
    "bowl": bowl(96, 122, 25, 231, 42),
    "accent": MARK["accent"],
}
P = 16  # one pixel at 16 px
SMALL = {  # 16 px cut on the pixel grid: spine x 3..5 px, y 2..14; gap 1 px; bowl x 6..13, y 3..13, stroke 2 px
    "bowl": bowl(6 * P, 8 * P, 3 * P, 13 * P, 2 * P),
    "accent": rrect(3 * P, 2 * P, 5 * P, 14 * P, 0),
}
TILE = rrect(0, 0, 256, 256, 3 * P)


# ---------------------------------------------------------------- wordmark
def wordmark(cap=100, track=-24, x0=0.0, baseline=0.0):
    font = TTFont(FONT)
    gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
    s = cap / font["OS/2"].sCapHeight
    x, parts = 0.0, []
    bounds = BoundsPen(gs)
    for ch in "Dossier":
        name = cmap[ord(ch)]
        tr = (s, 0, 0, -s, x0 + x * s, baseline)
        pen = SVGPathPen(gs, ntos=f)
        gs[name].draw(TransformPen(pen, tr))
        gs[name].draw(TransformPen(bounds, tr))
        parts.append(pen.getCommands())
        x += hmtx[name][0] + track
    return " ".join(parts), bounds.bounds  # (xmin, ymin, xmax, ymax)


def svg(viewbox, w, h, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" width="{w}" height="{h}" '
            f'role="img" aria-labelledby="title">\n  <title id="title">{title}</title>\n{body}</svg>\n')


def shapes(geo, ink, accent, tr=""):
    t = f' transform="{tr}"' if tr else ""
    return (f'  <path id="bowl"{t} fill="{ink}" fill-rule="evenodd" d="{geo["bowl"]}"/>\n'
            f'  <path id="accent"{t} fill="{accent}" fill-rule="evenodd" d="{geo["accent"]}"/>\n')


def write(name, content):
    with open(os.path.join(KIT, name), "w", encoding="utf-8") as fh:
        fh.write(content)
    print("wrote", os.path.join("kit", name))


def main():
    os.makedirs(KIT, exist_ok=True)
    sq = ("0 0 256 256", 256, 256)
    write("dossier-mark.svg", svg(*sq, "Dossier", shapes(MARK, INK, INK)))
    write("dossier-mark-color.svg", svg(*sq, "Dossier", shapes(MARK, INK, RED)))
    write("dossier-mark-reversed.svg", svg(*sq, "Dossier", shapes(MARK_REVERSED, WHITE, RED)))
    write("dossier-mark-small.svg", svg(*sq, "Dossier", shapes(SMALL, INK, INK)))
    write("dossier-mark-small-reversed.svg", svg(*sq, "Dossier", shapes(SMALL, WHITE, RED)))
    write("dossier-favicon.svg", svg(*sq, "Dossier", f'  <path id="tile" fill="{BG}" d="{TILE}"/>\n'
                                     + shapes(SMALL, WHITE, RED)))

    # wordmark alone: tight box around the outlines
    wd, (x0, y0, x1, y1) = wordmark(cap=100, track=-24, x0=0, baseline=100)
    wx0, wy0, ww, wh = math.floor(x0), math.floor(y0), math.ceil(x1) - math.floor(x0), math.ceil(y1) - math.floor(y0)
    wvb = f"{wx0} {wy0} {ww} {wh}"
    write("dossier-wordmark.svg", svg(wvb, ww, wh, "Dossier", f'  <path id="wordmark" fill="{INK}" d="{wd}"/>\n'))
    write("dossier-wordmark-reversed.svg", svg(wvb, ww, wh, "Dossier", f'  <path id="wordmark" fill="{WHITE}" d="{wd}"/>\n'))

    # horizontal lockup: symbol, gap 52, wordmark cap 100 centred on the symbol (as in the concept)
    gap, cap = 52, 100
    ld, (lx0, _, lx1, _) = wordmark(cap=cap, track=-24, x0=256 + gap, baseline=128 + cap / 2)
    W = int(math.ceil(lx1 + 36))  # right margin matches the symbol's left margin
    lvb = (f"0 0 {W} 256", W, 256)
    write("dossier-lockup.svg", svg(*lvb, "Dossier", shapes(MARK, INK, INK) + f'  <path id="wordmark" fill="{INK}" d="{ld}"/>\n'))
    write("dossier-lockup-color.svg", svg(*lvb, "Dossier", shapes(MARK, INK, RED) + f'  <path id="wordmark" fill="{INK}" d="{ld}"/>\n'))
    write("dossier-lockup-reversed.svg", svg(*lvb, "Dossier", shapes(MARK_REVERSED, WHITE, RED)
                                             + f'  <path id="wordmark" fill="{WHITE}" d="{ld}"/>\n'))

    ts = (
        "// Generated by web/brand-src/build_kit.py from the logo kit masters. Do not edit by hand.\n\n"
        "/** The mark (light-on-dark cut, bowl thinned for irradiation), viewBox 0 0 256 256. */\n"
        f'export const MARK_VIEWBOX = "0 0 256 256"\n'
        f'export const MARK_BOWL = "{MARK_REVERSED["bowl"]}"\n'
        "/** The spine: the single red accent. */\n"
        f'export const MARK_SPINE = "{MARK_REVERSED["accent"]}"\n\n'
        "/** The wordmark: Manrope SemiBold outlines, cap height 100. */\n"
        f'export const WORDMARK_VIEWBOX = "{wvb}"\n'
        f'export const WORDMARK = "{wd}"\n'
    )
    with open(TS_OUT, "w", encoding="utf-8") as fh:
        fh.write(ts)
    print("wrote", os.path.relpath(TS_OUT, ROOT))


if __name__ == "__main__":
    main()
