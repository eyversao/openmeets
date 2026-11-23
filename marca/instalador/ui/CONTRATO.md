# Contrato entre la interfaz del instalador y Rust

La interfaz (`index.html`, `estilos.css`, `textos.js`, `instalador.js`, `logotipo.svg`, `fuentes/`) se muestra en un webview dentro de una ventana **sin marco, transparente y de unos 760 × 480 px**. El redondeo (20 px) y el material los dibuja la propia página: la ventana tiene que ser transparente (`with_transparent(true)` en la ventana y en el webview) para que las esquinas queden limpias.

No usa red ni CDN. Las rutas son relativas, así que hay que servir la carpeta entera: con un protocolo propio de wry (`with_custom_protocol`, por ejemplo `openmeets://ui/index.html`) leyendo los archivos incrustados con `include_dir!`/`include_bytes!`. `with_html` no sirve, porque no resuelve `estilos.css` ni las fuentes.

## De la interfaz a Rust

La página llama `window.ipc.postMessage(JSON.stringify({ accion, ... }))` (el `ipc_handler` de wry).

| `accion` | Datos | Qué hace Rust |
| --- | --- | --- |
| `elegirCarpeta` | — | Abre el diálogo nativo de carpetas (p. ej. `rfd`) y responde con `instalador.carpeta(ruta)`. Si se cancela, no responde. |
| `instalar` | `carpeta` (texto), `escritorio`, `inicio`, `abrir` (booleanos) | Instala. Mientras tanto llama `instalador.progreso(pct, texto)`; al terminar, `instalador.listo()`, o `instalador.error(mensaje)` si falla. Si `abrir` es `true`, abre OpenMeets al terminar. |
| `abrirApp` | — | Abre OpenMeets ya instalado (pantalla «Listo»). |
| `cerrar` | — | Cierra la ventana. Durante la instalación la interfaz desactiva el botón y no lo envía. |
| `minimizar` | — | Minimiza la ventana. |
| `arrastrar` | — | Llama `window.drag_window()`. Se envía al pulsar con el botón principal sobre la cabecera (`data-arrastre`), fuera de los botones. |
| `desinstalar` | `borrarDatos` (booleano) | Quita el programa, accesos directos y la entrada del desinstalador; si `borrarDatos` es `true`, borra también `%LOCALAPPDATA%\OpenMeets\datos`. Responde con `progreso`, `listo` o `error`, igual que `instalar`. |

**Cambio sobre el contrato inicial:** `desinstalar` lleva el campo `borrarDatos` (por defecto `false`). Lo añadí para que la pantalla de confirmación pregunte si borrar también los meets y récords; si Rust lo ignora, el comportamiento es «no borrar datos».

## De Rust a la interfaz

Funciones globales en `window.instalador` (con `webview.evaluate_script(...)`). Existen en cuanto carga `instalador.js`; llama a `datos` después del evento de carga de la página.

| Función | Para qué |
| --- | --- |
| `datos({ version, carpetaPorDefecto, idioma, modo, vibrancia? })` | Primera llamada. `modo`: `'instalar'` o `'desinstalar'` (elige el flujo). `idioma`: código del sistema (`es-CO`, `en-US`…); lo que no empiece por `en` se muestra en español. `vibrancia` (opcional): `true` si aplicaste Mica/Acrylic a la ventana (crate `window-vibrancy`); la página baja la opacidad de su fondo para que se vea el material. |
| `carpeta(ruta)` | Muestra la carpeta elegida. |
| `progreso(porcentaje, texto)` | 0–100 y el paso actual («Copiando archivos…»). El texto lo pone Rust en el idioma de `datos`. |
| `listo()` | Termina: pantalla «Listo» al instalar, «Hecho» al desinstalar. |
| `error(mensaje)` | Pantalla de error con el mensaje en un cuadro seleccionable. Al instalar ofrece «Reintentar» (vuelve a la carpeta). |

Ejemplo:

```rust
webview.evaluate_script(&format!(
    "instalador.datos({})",
    serde_json::json!({ "version": "1.0.0", "carpetaPorDefecto": carpeta, "idioma": idioma, "modo": "instalar" })
))?;
webview.evaluate_script(&format!("instalador.progreso({}, {})", pct, serde_json::to_string(&texto)?))?;
```

Pasa siempre los textos con `serde_json::to_string` para que las comillas y las barras de las rutas de Windows lleguen bien.

## Modo demo

Si `window.ipc` no existe (la página abierta con doble clic en Chrome), la interfaz simula a Rust y muestra la etiqueta DEMO. Parámetros de la URL:

- `?modo=desinstalar` abre el desinstalador.
- `?idioma=en` o `?idioma=es` fuerza el idioma (si no, usa el del navegador).
- `?fallo=1` hace que la instalación termine en error.
- `?vibrancia=1` muestra el fondo más translúcido.

## Teclado y accesibilidad

- Intro activa el botón principal de la pantalla (si el foco no está en otro control); Esc equivale a «Atrás».
- Foco visible en lima en todos los controles. Al cambiar de pantalla, el foco pasa al título para que los lectores de pantalla lo anuncien.
- Las opciones son interruptores (`role="switch"`), la barra es `role="progressbar"` y el paso actual se anuncia con `aria-live`.
- Con `prefers-reduced-motion` no hay transiciones ni giros.
