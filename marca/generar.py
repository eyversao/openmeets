"""OpenMeets - generador del kit de marca (Python stdlib + fontTools para el trazado del texto).
Uso:  python marca/generar.py
  -> SVG en marca/, datos del logotipo en web/js/marca.js, HTML de apoyo en marca/_build/
     y luego llama a marca/render.cjs (PNG, favicon.ico, og.png, manual.pdf).
"""
import os, re, struct, subprocess, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.transformPen import TransformPen

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARCA = os.path.join(RAIZ, 'marca'); WEB = os.path.join(RAIZ, 'web')
TINTA, PAPEL, BLANCO = '#111111', '#F5F5F2', '#FFFFFF'

ARCO = 'M49.34 18.46 A22 22 0 1 1 42.33 12.58'


def cuerpo(color):
    return (f'<path d="{ARCO}" fill="none" stroke="{color}" stroke-width="9" stroke-linecap="butt"/>'
            f'<circle cx="32" cy="32" r="6" fill="{color}"/>')


def escribir(ruta, texto):
    with open(ruta, 'w', encoding='utf-8', newline='\n') as f:
        f.write(texto)


def n(v):
    s = f'{v:.2f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


# ---------- logotipo: "openmeets" en Geist 600 a trazado ----------
FUENTE = TTFont(os.path.join(WEB, 'fuentes', 'geist-latin-600-normal.woff2'))
GS, CMAP, UPM = FUENTE.getGlyphSet(), FUENTE.getBestCmap(), FUENTE['head'].unitsPerEm
XH = FUENTE['OS/2'].sxHeight
TRACK = -0.035 * UPM
K_SIMBOLO = 1.45      # diametro exterior del simbolo / altura de x
GAP = 0.27 * UPM      # aire entre simbolo y texto


def texto_trazado(txt, x0, base):
    """(d, xmax, ymin, ymax) en coords SVG (y hacia abajo); texto desde x0 con linea base `base`."""
    pen = SVGPathPen(GS, ntos=n)
    x = x0; ymin = 1e9; ymax = -1e9; xmax = x0
    for ch in txt:
        g = CMAP[ord(ch)]
        GS[g].draw(TransformPen(pen, (1, 0, 0, -1, x, base)))
        bp = BoundsPen(GS); GS[g].draw(bp)
        if bp.bounds:
            ymin = min(ymin, base - bp.bounds[3]); ymax = max(ymax, base - bp.bounds[1])
            xmax = max(xmax, x + bp.bounds[2])
        x += GS[g].width + TRACK
    return pen.getCommands(), xmax, ymin, ymax


def lado_x(txt):
    bp = BoundsPen(GS); GS[CMAP[ord(txt[0])]].draw(bp); return bp.bounds[0]


def disenar_horizontal():
    diam = K_SIMBOLO * XH; ss = diam / 53.0          # el anillo visible mide 53 de 64
    cy = -XH / 2; cx = diam / 2
    sx, sy = cx - 32 * ss, cy - 32 * ss
    tx0 = diam + GAP - lado_x('openmeets')
    d, xmax, ymin, ymax = texto_trazado('openmeets', tx0, 0)
    return dict(ss=ss, sx=sx, sy=sy, d=d, xmax=xmax, top=min(ymin, cy - diam / 2), bot=max(ymax, cy + diam / 2))


H = disenar_horizontal()


def svg_horizontal(color):
    w = H['xmax']; h = H['bot'] - H['top']; oy = H['top']
    t = f'translate({n(H["sx"])} {n(H["sy"])}) scale({n(H["ss"])})'
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 {n(oy)} {n(w)} {n(h)}" width="{n(w/10)}" height="{n(h/10)}" role="img" aria-label="OpenMeets">'
           f'<title>OpenMeets</title><g transform="{t}">{cuerpo(color)}</g><path d="{H["d"]}" fill="{color}"/></svg>\n')
    return svg, (w, h)


def svg_vertical(color):
    sd = 3.1 * XH; ss = sd / 53.0
    xl = lado_x('openmeets')
    _, xmax0, _, _ = texto_trazado('openmeets', 0, 0)
    ancho_t = xmax0 - xl
    w = max(sd, ancho_t); cx = w / 2
    base = sd + 0.55 * UPM + XH
    d, _, _, ymax = texto_trazado('openmeets', cx - ancho_t / 2 - xl, base)
    sx, sy = cx - 32 * ss, sd / 2 - 32 * ss
    t = f'translate({n(sx)} {n(sy)}) scale({n(ss)})'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n(w)} {n(ymax)}" width="{n(w/10)}" height="{n(ymax/10)}" role="img" aria-label="OpenMeets">'
            f'<title>OpenMeets</title><g transform="{t}">{cuerpo(color)}</g><path d="{d}" fill="{color}"/></svg>\n')


def svg_simbolo(color):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" role="img" aria-label="OpenMeets">'
            f'<title>OpenMeets</title>{cuerpo(color)}</svg>\n')


def svg_favicon():
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 4 56 56"><style>path{stroke:#111}circle{fill:#111}'
            '@media (prefers-color-scheme:dark){path{stroke:#F5F5F2}circle{fill:#F5F5F2}}</style>'
            f'<path d="{ARCO}" fill="none" stroke-width="9"/><circle cx="32" cy="32" r="6"/></svg>\n')


# ---------- marca.js: datos del logotipo (a px con font-size 100) ----------
def parchear_marca_js():
    k = 0.1
    w = H['xmax'] * k; h = (H['bot'] - H['top']) * k
    nums = lambda s: re.sub(r'-?\d+(?:\.\d+)?', lambda m: n(float(m.group()) * k), s)
    d = nums(H['d'])
    bloque = ("/*TRAZADO*/\nconst LOGO = { w: %s, h: %s, sx: %s, sy: %s, ss: %s, ty: %s, d: '%s' };\n/*FIN*/"
              % (n(w), n(h), n(H['sx'] * k), n((H['sy'] - H['top']) * k), n(H['ss'] * k), n(-H['top'] * k), d))
    ruta = os.path.join(WEB, 'js', 'marca.js')
    src = open(ruta, encoding='utf-8').read()
    src = re.sub(r'/\*TRAZADO\*/.*?/\*FIN\*/', lambda m: bloque, src, flags=re.S)
    escribir(ruta, src)
    # copia no-modulo para las demos que se abren con file:// (los modulos no cargan desde file://)
    escribir(os.path.join(MARCA, 'marca-demo.js'), re.sub(r'^export ', '', src, flags=re.M))


# ---------- HTML de apoyo para los PNG ----------
def html_icono(lado, pct):
    s = lado * pct / (53 / 64)
    return (f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0}}body{{width:{lado}px;height:{lado}px;background:{PAPEL};display:grid;place-items:center}}'
            f'svg{{width:{s}px;height:{s}px}}</style><svg viewBox="0 0 64 64">{cuerpo(TINTA)}</svg>')


def html_ico(lado):
    return (f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:transparent}}body{{width:{lado}px;height:{lado}px}}'
            f'.t{{width:{lado}px;height:{lado}px;background:{PAPEL};border-radius:{lado*0.22}px;display:grid;place-items:center;box-sizing:border-box;border:{max(1,lado//32)}px solid #DADAD4}}'
            f'svg{{width:{lado*0.78}px;height:{lado*0.78}px}}</style><div class="t"><svg viewBox="4 4 56 56">{cuerpo(TINTA)}</svg></div>')


def html_og():
    log, (w, h) = svg_horizontal(TINTA)
    logo = log.replace(f'width="{n(w/10)}" height="{n(h/10)}"', f'width="310" height="{n(310*h/w)}"')
    return f'''<!doctype html><meta charset="utf-8"><style>
@font-face{{font-family:InstSerif;src:url(../../web/fuentes/instrument-serif-latin-400-normal.woff2)}}
@font-face{{font-family:GeistMono;src:url(../../web/fuentes/geist-mono-latin-400-normal.woff2)}}
html,body{{margin:0}}body{{width:1200px;height:630px;background:{PAPEL};color:{TINTA};position:relative;overflow:hidden}}
.logo{{position:absolute;left:84px;top:72px}}.logo svg{{display:block}}
h1{{position:absolute;left:84px;top:190px;margin:0;width:1032px;font:400 104px/1.06 InstSerif;letter-spacing:-.015em}}
mark{{background:linear-gradient(transparent 14%,#D9F84A 14%,#D9F84A 86%,transparent 86%);color:{TINTA};padding:0 .1em;margin:0 -.05em}}
.pie{{position:absolute;left:84px;right:84px;bottom:56px;display:flex;justify-content:space-between;font:400 22px GeistMono;color:#3C3C38;border-top:1px solid #DADAD4;padding-top:22px}}
</style><div class="logo">{logo}</div>
<h1>Competencias de powerlifting en vivo, <mark>abiertas</mark>.</h1>
<div class="pie"><span>Código abierto · gratis · en tu red local</span><span>Creado por Eyver Gomez (@eyversao)</span></div>'''


def main():
    for nombre, txt in [
        ('simbolo.svg', svg_simbolo(TINTA)), ('simbolo-blanco.svg', svg_simbolo(BLANCO)),
        ('logotipo-horizontal.svg', svg_horizontal(TINTA)[0]), ('logotipo-vertical.svg', svg_vertical(TINTA)),
        ('logotipo-blanco.svg', svg_horizontal(BLANCO)[0]), ('favicon.svg', svg_favicon())]:
        escribir(os.path.join(MARCA, nombre), txt)
    escribir(os.path.join(WEB, 'favicon.svg'), svg_favicon())
    parchear_marca_js()
    b = os.path.join(MARCA, '_build'); os.makedirs(b, exist_ok=True)
    os.makedirs(os.path.join(WEB, 'iconos'), exist_ok=True)
    escribir(os.path.join(b, 'icono-192.html'), html_icono(192, 0.60))
    escribir(os.path.join(b, 'icono-512.html'), html_icono(512, 0.60))
    escribir(os.path.join(b, 'icono-maskable-512.html'), html_icono(512, 0.52))
    escribir(os.path.join(b, 'apple-touch-180.html'), html_icono(180, 0.60))
    for l in (16, 32, 48):
        escribir(os.path.join(b, f'ico-{l}.html'), html_ico(l))
    escribir(os.path.join(b, 'og.html'), html_og())
    r = subprocess.run(['node', os.path.join(MARCA, 'render.cjs')], cwd=RAIZ)
    if r.returncode:
        sys.exit(r.returncode)
    pngs = [open(os.path.join(b, f'ico-{l}.png'), 'rb').read() for l in (16, 32, 48)]
    cab = struct.pack('<HHH', 0, 1, 3); off = 6 + 16 * 3; ent = b''; datos = b''
    for l, p in zip((16, 32, 48), pngs):
        ent += struct.pack('<BBBBHHII', l, l, 0, 0, 1, 32, len(p), off + len(datos)); datos += p
    with open(os.path.join(WEB, 'favicon.ico'), 'wb') as f:
        f.write(cab + ent + datos)
    print('marca lista')


if __name__ == '__main__':
    main()
