"""Generate the Dossier logo concept SVGs (needs fontTools).

Usage, from web/brand-src: python3 generate_concepts.py concepts v3
The wordmark is Manrope SemiBold (SIL OFL 1.1) outlined to paths, cap height 100, tracking -24 units.
"""
import math, sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FONT = ROOT + "/assets/fonts/Manrope/Manrope-SemiBold.ttf"
OUT = sys.argv[1]
V = sys.argv[2] if len(sys.argv) > 2 else "v1"
INK, RED, BG = "#000", "#e5484d", "#141416"


def f(x):
    s = f"{x:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def rrect(x0, y0, x1, y1, r):
    return (f"M{f(x0+r)} {f(y0)}H{f(x1-r)}A{r} {r} 0 0 1 {f(x1)} {f(y0+r)}V{f(y1-r)}"
            f"A{r} {r} 0 0 1 {f(x1-r)} {f(y1)}H{f(x0+r)}A{r} {r} 0 0 1 {f(x0)} {f(y1-r)}"
            f"V{f(y0+r)}A{r} {r} 0 0 1 {f(x0+r)} {f(y0)}Z")


# ---------------------------------------------------------------- wordmark
def wordmark(cap=100, track=-24, x0=0.0, baseline=0.0):
    font = TTFont(FONT)
    gs, cmap, hmtx = font.getGlyphSet(), font.getBestCmap(), font["hmtx"]
    s = cap / font["OS/2"].sCapHeight
    x, parts = 0.0, []
    for ch in "Dossier":
        name = cmap[ord(ch)]
        pen = SVGPathPen(gs, ntos=f)
        gs[name].draw(TransformPen(pen, (s, 0, 0, -s, x0 + x * s, baseline)))
        parts.append(pen.getCommands())
        x += hmtx[name][0] + track
    width = (x - track) * s
    return " ".join(parts), width


# ---------------------------------------------------------------- symbols
def concept_a(v):
    """Bound D: spine bar + bowl, separated by one gap. Spine = accent."""
    top, bot = 24, 232
    if v == "v1":
        sx0, sx1, gap, st = 32, 76, 24, 44
    elif v == "v2":
        sx0, sx1, gap, st = 36, 80, 16, 44
    else:
        sx0, sx1, gap, st = 36, 80, 16, 44
    bx = sx1 + gap
    R = (bot - top) / 2
    cy = (top + bot) / 2
    # bowl: flat run then semicircle; right extreme = cx + R
    cx = 224 - R + (2 if v != "v1" else 0)  # v2+: 2 unit overshoot on the round side
    ri = R - st
    bowl = (f"M{f(bx)} {top}H{f(cx)}A{f(R)} {f(R)} 0 0 1 {f(cx)} {bot}H{f(bx)}V{f(bot-st)}H{f(cx)}"
            f"A{f(ri)} {f(ri)} 0 0 0 {f(cx)} {f(top+st)}H{f(bx)}Z")
    if v == "v1":
        spine = f"M{sx0} {top}H{sx1}V{bot}H{sx0}Z"
    else:
        # v2+: spine slightly taller than the bowl (a binding), with the UI's soft corner
        spine = rrect(sx0, top - 8, sx1, bot + 8, 6)
    return [("bowl", bowl, False), ("accent", spine, True)]


def concept_b(v):
    """Sealed stack: flap + body slabs with a round closure button bridging the gap."""
    cx, cy = 128, 128
    if v == "v1":
        t = (32, 40, 208, 104); b = (48, 152, 224, 216); rb, rc, rad = 32, 48, 14
    elif v == "v2":
        t = (32, 44, 224, 104); b = (32, 152, 224, 212); rb, rc, rad = 34, 52, 14
    else:
        t = (32, 40, 224, 116); b = (32, 140, 224, 216); rb, rc, rad = 28, 44, 16
    shapes = []
    for (x0, y0, x1, y1), edge in ((t, "bottom"), (b, "top")):
        yy = y1 if edge == "bottom" else y0
        dy = abs(yy - cy)
        dx = math.sqrt(rc * rc - dy * dy)
        r = rad
        if edge == "bottom":
            d = (f"M{f(x0+r)} {f(y0)}H{f(x1-r)}A{r} {r} 0 0 1 {f(x1)} {f(y0+r)}V{f(y1-r)}"
                 f"A{r} {r} 0 0 1 {f(x1-r)} {f(y1)}H{f(cx+dx)}A{rc} {rc} 0 0 0 {f(cx-dx)} {f(y1)}"
                 f"H{f(x0+r)}A{r} {r} 0 0 1 {f(x0)} {f(y1-r)}V{f(y0+r)}A{r} {r} 0 0 1 {f(x0+r)} {f(y0)}Z")
        else:
            d = (f"M{f(x0+r)} {f(y0)}H{f(cx-dx)}A{rc} {rc} 0 0 0 {f(cx+dx)} {f(y0)}H{f(x1-r)}"
                 f"A{r} {r} 0 0 1 {f(x1)} {f(y0+r)}V{f(y1-r)}A{r} {r} 0 0 1 {f(x1-r)} {f(y1)}"
                 f"H{f(x0+r)}A{r} {r} 0 0 1 {f(x0)} {f(y1-r)}V{f(y0+r)}A{r} {r} 0 0 1 {f(x0+r)} {f(y0)}Z")
        shapes.append(("slab", d, False))
    button = f"M{cx-rb} {cy}A{rb} {rb} 0 1 0 {cx+rb} {cy}A{rb} {rb} 0 1 0 {cx-rb} {cy}Z"
    shapes.append(("accent", button, True))
    return shapes


def concept_c(v):
    """Tabbed monogram: a jacket with a D cut out of it, one index tab on its edge."""
    if v == "v1":
        j = (24, 24, 208, 232); rj = 28
        dx0, dy0, dy1, dw = 66, 68, 188, 100
        tab = (208, 48, 236, 100); rt = 0
    elif v == "v2":
        j = (28, 28, 204, 228); rj = 32
        dx0, dy0, dy1, dw = 72, 76, 180, 88
        tab = (196, 40, 236, 96); rt = 8
    else:
        j = (24, 28, 200, 228); rj = 32
        dx0, dy0, dy1, dw = 68, 76, 180, 88
        tab = (192, 60, 232, 124); rt = 10
    R = (dy1 - dy0) / 2
    cxh = dx0 + dw - R
    hole = (f"M{dx0} {dy0}V{dy1}H{f(cxh)}A{f(R)} {f(R)} 0 0 0 {f(cxh)} {dy0}Z")
    jacket = rrect(*j, rj) + hole
    tx0, ty0, tx1, ty1 = tab
    if v == "v1":
        tabd = f"M{tx0} {ty0}H{tx1}V{ty1}H{tx0}Z"
        return [("jacket", jacket, False), ("accent", tabd, True)]
    # v2+: tab is a rounded bar that tucks behind the jacket edge; only its outer part shows
    tabd = (f"M{f(j[2])} {ty0}H{f(tx1-rt)}A{rt} {rt} 0 0 1 {tx1} {ty0+rt}V{ty1-rt}"
            f"A{rt} {rt} 0 0 1 {f(tx1-rt)} {ty1}H{f(j[2])}Z")
    return [("jacket", jacket, False), ("accent", tabd, True)]


CONCEPTS = {"a": ("Bound D", concept_a), "b": ("Sealed stack", concept_b), "c": ("Tabbed monogram", concept_c)}


def svg(viewbox, w, h, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" width="{w}" height="{h}" '
            f'role="img" aria-labelledby="title">\n  <title id="title">{title}</title>\n{body}</svg>\n')


def paths(shapes, mode, dx=0):
    out = []
    tr = f' transform="translate({dx} 0)"' if dx else ""
    for pid, d, acc in shapes:
        fill = INK if mode == "black" else (RED if acc else "#fff")
        out.append(f'  <path id="{pid}"{tr} fill="{fill}" fill-rule="evenodd" d="{d}"/>\n')
    return "".join(out)


os.makedirs(OUT, exist_ok=True)
wm_d, wm_w = wordmark(cap=100, track=-24, x0=0, baseline=0)
for key, (name, fn) in CONCEPTS.items():
    shapes = fn(V)
    stem = f"{OUT}/concept-{key}-{V}"
    open(stem + ".svg", "w").write(svg("0 0 256 256", 256, 256, f"Dossier concept {key.upper()}: {name}", paths(shapes, "black")))
    dark = f'  <rect width="256" height="256" fill="{BG}"/>\n' + paths(shapes, "dark")
    open(stem + "-dark.svg", "w").write(svg("0 0 256 256", 256, 256, f"Dossier concept {key.upper()} on dark", dark))
    # lockup: symbol, gap, wordmark with cap height 100 centred on the symbol
    gap, cap = 52, 100
    base = 128 + cap / 2
    d2, w2 = wordmark(cap=cap, track=-24, x0=256 + gap, baseline=base)
    W = int(math.ceil(256 + gap + w2 + 8))
    body = paths(shapes, "black") + f'  <path id="wordmark" fill="{INK}" d="{d2}"/>\n'
    open(f"{OUT}/concept-{key}-lockup-{V}.svg", "w").write(svg(f"0 0 {W} 256", W, 256, f"Dossier lockup, concept {key.upper()}", body))
    bodyd = f'  <rect width="{W}" height="256" fill="{BG}"/>\n' + paths(shapes, "dark") + f'  <path id="wordmark" fill="#fff" d="{d2}"/>\n'
    open(f"{OUT}/concept-{key}-lockup-{V}-dark.svg", "w").write(svg(f"0 0 {W} 256", W, 256, f"Dossier lockup on dark, concept {key.upper()}", bodyd))
print("ok", V, "wordmark width", round(wm_w, 1))
