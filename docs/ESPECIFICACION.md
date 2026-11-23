# OpenMeets — especificación (fuente de verdad para todos los bloques)

OpenMeets es una app independiente y de código abierto para organizar, dirigir, juzgar, mostrar y seguir competencias
de powerlifting EN VIVO. Creador: **Eyver Gomez (@eyversao)**. Licencia MIT (© 2026 Eyver Gomez).
Tiene dos formas de uso con la misma web:
- **App local de Windows** (la mesa en el gimnasio, sin internet): `openmeets.exe`, un servidor en Rust (`nativo/`) con la web
  embebida, que se instala con `OpenMeets-Setup.exe` (instalador propio en Rust, `instalador/`). Guarda todo en disco y sirve
  la web a la mesa, las pantallas, los teléfonos de los jueces y el público en la red local.
- **Nube** en https://openmeets.web.app: Firebase Hosting + Firestore + Auth con Google, sin servidor (`web/js/nube/*`,
  `firestore.rules`). Las reglas de Firestore son la seguridad.
El servidor Node (`servidor/`, solo stdlib, `npm start`) queda como servidor de desarrollo multiplataforma y como base de las
pruebas; el Rust cumple el mismo contrato (`OPENMEETS_SERVIDOR=rust npm test`). El almacenamiento local va detrás de una
interfaz (`almacen.mjs`).

Sale de VettaPro: reutiliza y ADAPTA (sin Firebase) sus módulos de competencia:
`src/js/competencia.js`, `reloj-tarima.js`, `sonidos-tarima.js`, `luces-estado.js`, `mesa-votos.js`, `mesa-canal.js`,
`jueces-acceso.js` (con SHA-256 en JS puro), `jueces-mandos.js`, `liftingcast.js`, `puntajes.js`,
`datos/federaciones-categorias.js`, `views/eventos.js` (mesa de control, jueces, resultados), `views/evento-publico.js`
(pantalla, juez, público), `views/hud.js`, `views/barra-visual.js`, `views/luces-vivo.js`, `discos-spec.js`;
`servicios/mesa-local/servidor.mjs` y `app-pc.mjs`, `scripts/mesa-pc.mjs`; `servicios/jueces/*` (sketches y LEEME);
y sus pruebas en `pruebas/`. Léelos antes de escribir. No copies nada de Firebase, cuentas, pagos ni marca VettaPro.

## Estructura
```
OpenMeets/
  README.md (EN) · docs/readme/README_es.md · docs/readme/README_zh.md · LICENSE · start.bat · .gitignore
  package.json (scripts: start, test, nativo, nube:build, nube:desplegar, reglas)
  nativo/     servidor en Rust (openmeets.exe con la web embebida)
  instalador/ instalador de Windows en Rust (OpenMeets-Setup.exe)
  firestore.rules · firebase.json · .firebaserc   la nube
  servidor/   openmeets.mjs (arranque) · almacen.mjs · api.mjs · tiempo-real.mjs · acceso.mjs · estatico.mjs · calculo.mjs · extensiones
  web/        index.html · manifest.webmanifest · sw.js · favicon/íconos
              css/ tokens.css (marca) · base.css · componentes.css · luces.css · publico.css · organizar.css · pantalla.css · juez.css
              js/  app.js (router de URLs limpias) · api.js · canal.js · util.js · ui.js · i18n.js (+ i18n/en.json)
                   nucleo/ (módulos puros portados)
                   vistas/ inicio.js · meet.js · pantalla.js · hud.js · juez.js · seguir.js · organizar/*.js
  marca/      logos SVG · fuentes woff2 · manual.html · generar.py
  docs/       sitio estático de documentación (guías + técnico + marca), mismo sistema visual
  mandos/     sketches .ino + LEEME.md
  scripts/    nube-build.mjs (prepara publico/ para Hosting) · sw-lista.mjs · precarga.mjs
  pruebas/    *.test.mjs (node puro) · correr.mjs
```
Sin paso de compilación en local: la web son módulos ES servidos tal cual (solo la nube se empaqueta con esbuild). Funciona en Chrome, Edge, Safari y Firefox recientes.

## Arranque y roles
- Instalar con `OpenMeets-Setup.exe` (sin administrador, accesos directos, se desinstala desde Aplicaciones de Windows con opción de borrar datos). `start.bat` arranca `nativo\target\release\openmeets.exe` si existe y si no Node. `npm start` → `node servidor/openmeets.mjs [--puerto 5050] [--datos <dir>] [--sin-navegador]`. Datos por defecto:
  `%LOCALAPPDATA%\OpenMeets\datos` (en Mac/Linux `~/.openmeets`). Escucha en 0.0.0.0. Abre el navegador en `http://localhost:5050/`.
  Consola en español: IPs de la LAN, PIN de organizador, pasos (Firewall en redes privadas, misma Wi-Fi/hotspot).
- **Organizador**: cualquier petición desde loopback; desde otro equipo, con el PIN de 6 dígitos que imprime la consola
  (`POST /api/sesion {pin}` → cookie HttpOnly `om_sesion`, SameSite=Strict). El PIN se puede cambiar en Ajustes.
- **Juez**: enlace con el código de jueces del meet + aprobación en la mesa (modos 'abierta' | 'mesa' | 'codigo', igual que VettaPro:
  identidad del teléfono, huella SHA-256, código de 6 dígitos, recordar juez, votos firmados con el secreto).
- **Público**: lectura de lo que es público; puede mandar «aplausos» (ver gamificación).

## Modelo de datos (un archivo JSON por meet: `<datos>/meets/<id>.json`, escritura atómica tmp+rename y copia `.bak`)
```
meet = { id, nombre, fecha 'YYYY-MM-DD', fechaFin?, sede, ciudad, pais, organizador (texto), descripcion, stream (URL),
  federacion, modo: 'IPF'|'otra', aprobacion: 'abierta'|'mesa'|'codigo', unidades: 'kg', formula: 'GL'|'DOTS'|'Wilks'|'IPF',
  barra: 20, barraSentadilla?: 25, collar: 2.5, discos: [{kg, pares, color}], relojes: [60, 180], pararAlVotar: true,
  plataformas: ['Tarima 1'], publico: true, cerrado: false (el organizador lo marca terminado), hud: {…},
  atletas: [atleta], vivo: { [plataforma]: vivo }, aplausos: { [aid]: n }, actividad: [{ts, texto}] (últimos 500),
  privado: { codigoJuez, juecesConocidos: {huella:{pos,nombre,ts}} }, creado, actualizado }
atleta = { id, nombre, sexo 'M'|'F', nacimiento?, club, division ('Open','Junior','Sub-Junior','Master 1'…), equipamiento 'raw'|'equipado',
  peso (corporal), clase, plataforma, sesion, grupo (flight), lote, rack: {S, B},
  intentos: { S: [i,i,i], B: [i,i,i], D: [i,i,i] } }   i = { kg, r: 1|-1|null, rec, alFinal, cambios, historial:[{ts,de,a,motivo}] }
vivo = el mismo contrato de VettaPro (plataforma, sesion, grupo, lev, ronda, actual, siguientes, turno, modo, aprobacion, reloj,
  relojHasta, votados, luces, lucesTs, resultadoRec, sonido, jueces, accesos, version, ts)
```
Estado derivado del meet: 'en-vivo' si alguna plataforma tiene `actual` y no está cerrado; 'programada' si fecha ≥ hoy y no
empezó; 'terminada' si cerrado o fecha < hoy. Historial: los meets nunca se borran solos.

## API (JSON; errores {ok:false, error:'texto en español'})
```
GET    /api/info                         {app:'OpenMeets', version, puerto, ips, organizador: bool}
POST   /api/sesion {pin}                 cookie de organizador
GET    /api/meets                        lista pública [{id,nombre,fecha,fechaFin,ciudad,pais,federacion,estado,atletas,plataformas}]
                                         (?todas=1 para el organizador: incluye no públicos)
POST   /api/meets                        (org) crear → meet
GET    /api/meets/:id                    meet sin `privado` (el organizador lo recibe con privado)
PATCH  /api/meets/:id                    (org) campos del meet (no atletas ni vivo)
DELETE /api/meets/:id                    (org) mueve el archivo a <datos>/papelera
PUT    /api/meets/:id/atletas/:aid       (org) crear/actualizar atleta
POST   /api/meets/:id/atletas            (org) lote: {atletas:[…]} (importación CSV la hace el cliente)
DELETE /api/meets/:id/atletas/:aid       (org)
GET    /api/meets/:id/resultados.csv     público
POST   /api/meets/:id/aplauso {aid}      público; máx. 1 cada 10 s por IP y atleta
GET    /api/meets/:id/canal              SSE. Eventos `data: {tipo, …}`: 'meet' (meet público completo al conectar),
                                         'atleta' {atleta}, 'meet-cambio' {campos}, 'vivo' {plataforma, datos},
                                         'aplauso' {aid, n}; SOLO organizador: 'voto' {voto}, 'presencia' {datos}, 'limpiar' {plataforma}
POST   /api/meets/:id/canal              org: {tipo:'vivo', plataforma, datos} · {tipo:'limpiar', plataforma}
                                         juez (con codigo de jueces): {tipo:'voto', voto} · {tipo:'presencia', datos}
GET    /api/meets/:id/export.json        (org) copia completa · POST /api/meets/importar (org) restaurar
```
El servidor persiste el vivo y los atletas en el archivo del meet (escritura con espera de 300 ms agrupada), así que al
reiniciar no se pierde nada. Ping SSE cada 15 s. Límite de 256 KB por petición (64 KB en canal).

## Principios de diseño (de los vídeos de Tim Gabe; obligatorios)
1. **Todos los estados diseñados**: cargando (esqueletos), vacío (con la siguiente acción), error (qué pasó y qué hacer),
   sin conexión (último dato con su hora y reintento solo), éxito. El estado del sistema siempre visible (píldora de conexión).
   **Deshacer** en acciones de la mesa: marcar resultado, cambiar peso, borrar atleta, quitar acceso (toast con «Deshacer» 6 s).
   El juez sabe siempre si su toque funcionó (enviado / en cola / no llegó y reintentando).
2. **Un solo producto**: los mismos componentes para lo mismo en todas partes (fila de atleta, celda de intento, luces,
   píldora de estado, tarjeta de meet). Mismo vocabulario en toda la app.
3. **Recuperación de fallos como momento premium**: juez sin red → «Tu voto está en cola, se enviará al volver» y se envía
   solo; servidor caído → aviso con pasos; pantalla sin datos → última imagen con hora; lista vacía → qué hacer.
4. **Anticipación → revelación → celebración**: pre-marcado (anticipación), luces juntas (revelación), y celebración
   sobria solo en válido/récord/marca personal (brillo, vibración en el teléfono). Nunca en nulo más allá de la chicharra.
5. **Anillos de completar**: anillo de 9 segmentos por atleta (3 levantamientos × 3 intentos, coloreados por resultado) y
   progreso por grupo/plataforma («Faltan 14 intentos en el Grupo B»).
6. **Competencia real, no teatro**: marca personal automática (mismo nombre en meets anteriores de este servidor),
   récords del meet por categoría, puntos (GL/DOTS) y «Mejor levantador». SIN puntos inventados, insignias ni rachas.
7. **Competiciones locales que se pueden ganar**: clasificación por categoría, división y club (puntos de equipo 12-9-8-7…),
   y «aplausos» del público a cada atleta (contador discreto; como los kudos de Strava).

## Marca (la define la sesión principal; usar SIEMPRE las variables de web/css/tokens.css, nunca colores sueltos)
Dirección «abierto y limpio»: papel `--papel`, tinta `--tinta`, grises, un único acento de señal `--senal` (lima de
resaltador, solo como fondo de resaltado con texto tinta, nunca texto lima sobre blanco), y colores semánticos de jueces
`--luz-blanca`, `--luz-roja`, `--tarjeta-azul`, `--tarjeta-amarilla`, más `--ok`, `--mal`. Tipografías: `--f-ui` (grotesk),
`--f-datos` (mono con cifras tabulares), `--f-titular` (serif editorial para titulares grandes). Modo claro por defecto
y oscuro (la pantalla de tarima siempre oscura). Controles de 44 px, 390 px sin scroll horizontal, `prefers-reduced-motion`.
Textos en español por defecto con inglés disponible (`i18n.js` simple: diccionario clave=español).

## Principio 8 · Pico y final (Tim Gabe, «The Tiny Design Rule Behind Top 1% Apps»; regla pico-final de Kahneman)
La gente recuerda una experiencia por su momento más intenso (pico) y por cómo termina (final); el resto pesa poco.
Diseña con intención UN pico por recorrido y un FINAL con cierre; nunca dejes que un recorrido «se caiga» sin cierre.
Recorrido por rol (pico → final):
- **Organizador**: crear meet → atletas → mesa → cerrar. Pico: el primer revelado de luces en la mesa. Final: al cerrar el
  meet, tarjeta de resumen construida delante de ti (atletas, intentos, válidos %, récords del meet, mejor levantador por
  sexo, equipo ganador) con «Descargar resultados», «Ver página pública» y un mensaje que reconoce el trabajo
  («Meet terminado. 142 intentos dirigidos sin perder uno»). Crear el primer meet también cierra con un paso siguiente claro.
- **Atleta / público**: pico = válido, récord o marca personal (ya hay brillo sobrio). Final: tras el último intento de un
  atleta, su anillo se completa y aparece su tarjeta final (total, puntos, puesto en su categoría, MP si la hay). Cuando el
  meet termina, la página pública abre con un podio/resumen arriba en lugar de la vista en vivo vacía.
- **Juez**: pico = su voto revelado junto a los otros. Final: al terminar el grupo/sesión o el meet, pantalla de cierre
  («Gracias, juzgaste 27 intentos») en vez de quedarse en espera muda.
- **Pantalla de tarima**: final del grupo → «Grupo B terminado» con los 3 mejores; final del meet → podio/mejor levantador
  y créditos de OpenMeets, nunca una pantalla en blanco.
- **Aspiradora (momentos negativos)**: esperas (juez esperando aprobación, pantalla sin atleta, cargando), errores y
  formularios largos (importar CSV) llevan microcopia que acompaña y una acción útil; las esperas se usan (p. ej. la
  pantalla sin atleta muestra quién viene y la clasificación) en vez de espacio muerto.
- Sobrio: sin confeti ni emojis; el pico es luz/brillo, vibración corta y copia que reconoce; respeta prefers-reduced-motion.
