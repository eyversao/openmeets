# OpenMeets installer

Builds `OpenMeets-Setup.exe`: one file, no admin rights, frameless rounded WebView2 window (tao + wry).

## Build

    OPENMEETS_PAYLOAD=path/to/openmeets.exe cargo build --release   # -> target/release/openmeets-setup.exe

- `OPENMEETS_PAYLOAD`: app binary to pack (zstd). Default: `prueba/openmeets-prueba.exe`, a stand-in for testing.
- `OPENMEETS_INSTALADOR_UI`: UI folder to embed. Default: `../marca/instalador/ui` if it has an `index.html`, else `ui-provisional`.
- Icon: `../marca/instalador/openmeets.ico` if present, else a generated placeholder.
- `cargo test` runs the logic tests (registry under `HKCU\Software\OpenMeetsPrueba`, extraction, install/uninstall cycle).

## UI contract

UI to Rust: `window.ipc.postMessage(JSON.stringify({ accion, ... }))` with `elegirCarpeta`, `instalar` ({carpeta, escritorio, inicio, abrir}), `abrirApp`, `cerrar`, `minimizar`, `arrastrar`, `desinstalar`.
Rust to UI (global `window.instalador`): `datos({version, carpetaPorDefecto, idioma, modo})` on load, `carpeta(ruta)`, `progreso(porcentaje, texto)`, `listo()`, `error(mensaje)`.
Files are served by a custom protocol (`http://om.localhost/`), no HTTP server.

## Command line

`/S` or `--silencioso` (no window; in Git Bash set `MSYS_NO_PATHCONV=1` or use `--silencioso`), `--carpeta <dir>`, `--sin-escritorio`, `--desinstalar` (also when the exe is named `Desinstalar*`).

## What it touches

- `%LOCALAPPDATA%\Programs\OpenMeets` (or the chosen folder): `openmeets.exe`, `openmeets.ico`, `Desinstalar OpenMeets.exe`.
- `OpenMeets.lnk` in the Start menu and (optional) the desktop.
- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenMeets`.
- Never the user data folder `%LOCALAPPDATA%\OpenMeets\datos`, and no firewall rule (the app asks when needed).
- "App is open" is detected by failing to open the installed exe for writing.
- The uninstaller relaunches from `%TEMP%`; a detached `cmd` deletes the leftovers a couple of seconds later.
- Test overrides: `OPENMEETS_TEST_INICIO`, `OPENMEETS_TEST_ESCRITORIO`, `OPENMEETS_TEST_CLAVE`.

## Added after merging the final UI

- `desinstalar` accepts `borrarDatos` (CLI: `--borrar-datos`); it removes `%LOCALAPPDATA%\OpenMeets\datos` only then (test override: `OPENMEETS_TEST_DATOS`; only a folder named `datos`).
- `datos().idioma` is the system locale name (`es-CO`, `en-US`). `vibrancia` is never sent (Mica/Acrylic not applied; the transparent window keeps the page's own material).
- If OpenMeets is running, install and uninstall refuse with an error and leave everything in place.
- Release build with the real payload: `OPENMEETS_PAYLOAD=../nativo/target/release/openmeets.exe cargo build --release`, copied to `dist/OpenMeets-Setup.exe`.
