# OpenMeets nativo (Rust)

Reemplazo del servidor Node (`servidor/*.mjs`) para la versión local (modo mesa en la red del gimnasio).
Mismo contrato: rutas `/api/*`, JSON, canal SSE, argumentos, carpeta y formato de datos, consola con QR.
La web (`../web`) va embebida en el binario: `openmeets.exe` es un único archivo.

## Compilar

```
npm run nativo            # cargo build --release --manifest-path nativo/Cargo.toml
cargo test                # dentro de nativo/
```

Resultado: `nativo/target/release/openmeets.exe` (LTO fat, strip, panic = abort, sin `unsafe`).

## Usar

```
openmeets [--puerto 5050] [--datos <carpeta>] [--web <carpeta>] [--sin-navegador] [--ayuda]
```

- Datos por defecto: `%LOCALAPPDATA%\OpenMeets\datos` (se migra `...\OpenMeet\datos` si existe). Los datos de la versión Node se abren sin migrar.
- `--web <carpeta>`: sirve la web desde disco en vez de la embebida (para desarrollar).
- `OPENMEETS_ESPERA_MS`: espera de la escritura agrupada (300 por defecto; la usan las pruebas).
- No incluye el modo nube del servidor Node: la nube es Firestore desde el navegador.

## Arquitectura

| Módulo | Equivale a |
|---|---|
| `main.rs` | `openmeets.mjs` (argumentos, migración, instancia única, señales, navegador) |
| `api.rs` | `api.mjs` (rutas, canal de jueces, respuestas de error) |
| `validar.rs`, `calculo.rs` | `web/js/nucleo/{validar,calculo,competencia,puntajes,federaciones}.js` |
| `almacen.rs`, `acceso.rs`, `tiempo.rs`, `estatico.rs` | `almacen`, `acceso`, `tiempo-real`, `estatico` |
| `inscripciones.rs`, `records.rs`, `records_logica.rs`, `perfiles.rs`, `federacion.rs` | extensiones (inscripciones, récords, perfiles, roles y auditoría, OpenPowerlifting) |
| `consola.rs` | `consola.mjs` (ASCII, QR con el crate `qrcode`) |

Los meets se manejan como `serde_json::Value` (con `preserve_order`) para conservar campos, orden y tipos del JSON que escribía Node.
Tokio + axum (solo como servidor HTTP/1; el enrutado es propio), gzip de los estáticos en memoria con caché.

## Paridad

`OPENMEETS_SERVIDOR=rust npm test` lanza este binario en las pruebas por HTTP (`pruebas/_servidor.mjs`).
Las pruebas que importan módulos internos de Node (acceso, almacén, estático, tiempo real, migración, federación-lógica) siguen contra Node;
sus equivalentes en Rust son las pruebas unitarias de `cargo test`.
