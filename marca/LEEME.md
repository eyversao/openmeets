# Marca de OpenMeets

Qué hay aquí:

- `manual.html` y `manual.pdf`: el manual de marca (A4 apaisado, 14 páginas). El PDF se imprime desde el HTML.
- `simbolo*.svg`, `logotipo-*.svg`, `favicon.svg`: el símbolo (disco abierto) y el logotipo en horizontal, vertical y blanco. El texto del logotipo está trazado, no necesita fuentes.
- `animacion.html` y `web/js/marca.js`: la animación del símbolo (entrada, carga, vivo).
- `conceptos/`: los tres símbolos que se descartaron. `_build/`: HTML de apoyo para los PNG, el banner y el GIF del README (`escenario.js` dibuja la barra y los discos para los dos).
- `instalador/`: la interfaz del instalador de Windows (`ui/`, con su contrato con Rust en `ui/CONTRATO.md`), sus textos en `instalador.md` y el icono `openmeets.ico`.
- `generar.py`: genera los SVG, `web/js/marca.js` y los iconos de la web.

## Regenerar

```
python marca/generar.py
```

Necesita Python 3 y `fontTools`. Escribe los SVG, `web/js/marca.js` y el HTML de `_build/`, y después llama a `marca/render.cjs`, que genera con Chrome (Playwright) los íconos de `web/iconos/`, `web/og.png` y `marca/manual.pdf`.

Los banners (2000×516, esquinas redondas) y los GIF en bucle de los README, uno por idioma, salen de `_build/banner-readme.html` y `_build/gif-readme.html` y van a `docs/readme/media/` (`banner-<idioma>.png`, `openmeets-<idioma>.gif`). Necesita ffmpeg:

```
node marca/gif-readme.cjs                 # en, es y zh
node marca/gif-readme.cjs es              # un idioma
SOLO_BANNER=1 node marca/gif-readme.cjs   # solo los banners
```

Para ver un instante del GIF en el navegador: `_build/gif-readme.html?l=es&t=6.2` (t en segundos, de 0 a 10).

El instalador:

```
node marca/instalador/icono.cjs       # openmeets.ico (16 a 256 px)
node marca/instalador/textos-md.cjs   # instalador.md desde ui/textos.js
```

`marca/instalador/ui/index.html` se abre con doble clic en modo demo (`?modo=desinstalar`, `?idioma=en`, `?fallo=1`).

Para repetir solo los PNG y el PDF:

```
node marca/render.cjs
```

`render.cjs` carga Playwright desde la ruta de `require` de la primera línea: cámbiala por la de tu instalación.

Las reglas de uso (área de respeto, tamaños mínimos, colores) están en el manual. Los colores y tipografías de la app viven en `web/css/tokens.css`.
