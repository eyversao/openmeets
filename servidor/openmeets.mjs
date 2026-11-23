// OpenMeets · arranque. Uso: node servidor/openmeets.mjs [--puerto 5050] [--datos <carpeta>] [--sin-navegador]
// Servidor local (solo Node, sin dependencias): guarda los meets en disco y sirve la web por la red local.
import http from 'node:http';
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, cpSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { crearAlmacen } from './almacen.mjs';
import { crearAcceso, ipsLAN } from './acceso.mjs';
import { crearTiempoReal } from './tiempo-real.mjs';
import { crearEstatico } from './estatico.mjs';
import { crearApi } from './api.mjs';
import { EXTENSIONES } from './extensiones.mjs';
import { lineasConsola, detectarColor, sinColor, aviso, tituloVentana } from './consola.mjs';

export const VERSION = '1.0.0';
export const PUERTO = 5050;
const AQUI = fileURLToPath(new URL('.', import.meta.url));

export const datosPorDefecto = () => (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'OpenMeets', 'datos')
  : join(homedir(), '.openmeets'));

/** Carpeta de datos con el nombre anterior (sin «s»), para migrarla. */
export const datosAntiguos = () => (process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'OpenMeet', 'datos')
  : join(homedir(), '.openmeet'));

/** Si la carpeta nueva no existe y la vieja sí: la renombra; si no puede, la copia (la vieja nunca se borra). */
export function migrarDatos(nueva, vieja) {
  if (existsSync(nueva) || !existsSync(vieja)) return;
  try { mkdirSync(join(nueva, '..'), { recursive: true }); renameSync(vieja, nueva); } catch {
    try { cpSync(vieja, nueva, { recursive: true }); } catch { /* se queda la vieja */ }
  }
}

export function leerArgumentos(argv, env = process.env) {
  const valor = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  return {
    puerto: valor('--puerto') !== undefined ? Number(valor('--puerto')) : PUERTO,
    datos: valor('--datos') ? resolve(valor('--datos')) : datosPorDefecto(),
    web: valor('--web') ? resolve(valor('--web')) : undefined,
    sinNavegador: argv.includes('--sin-navegador'),
    ayuda: argv.includes('--ayuda') || argv.includes('-h') || argv.includes('--help'),
  };
}

/** Crea todo (sin escuchar). `leer(ruta)` sirve la web desde memoria (ejecutable). */
export function crearApp({ datos, web = join(AQUI, '..', 'web'), leer, version = VERSION, espera } = {}) {
  mkdirSync(datos, { recursive: true });
  const almacen = crearAlmacen(datos, espera === undefined ? {} : { espera });
  const acceso = crearAcceso(datos);
  const tiempo = crearTiempoReal();
  const estatico = crearEstatico({ carpeta: web, leer });
  let puerto = 0;
  const api = crearApi({ almacen, acceso, tiempo, version, puerto: () => puerto, ips: ipsLAN, datos, extensiones: EXTENSIONES.map(crear => crear({ almacen, acceso, tiempo, datos })) });

  const servidor = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://x');
      if (await api(req, res, u)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Método no permitido'); }
      await estatico(req, res, u.pathname);
    } catch { try { res.writeHead(500); res.end(); } catch { /* respuesta ya enviada */ } }
  });
  servidor.requestTimeout = 0; // el SSE vive horas

  return {
    servidor, almacen, acceso, tiempo,
    escuchar: (p = PUERTO, host = '0.0.0.0') => new Promise((ok, no) => {
      servidor.once('error', no);
      servidor.listen(p, host, () => { puerto = servidor.address().port; ok(puerto); });
    }),
    cerrar: () => new Promise(ok => {
      tiempo.cerrar();
      almacen.cerrar();
      servidor.closeAllConnections?.();
      servidor.close(() => ok());
    }),
  };
}

async function hayOpenMeets(puerto) {
  try {
    const r = await fetch(`http://127.0.0.1:${puerto}/api/info`, { signal: AbortSignal.timeout(1500) });
    return (await r.json())?.app?.startsWith('OpenMeet'); // acepta también el nombre antiguo (mesas viejas en la red)
  } catch { return false; }
}

function abrirNavegador(url, log) {
  try {
    const opciones = { detached: true, stdio: 'ignore' };
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], opciones).unref();
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], opciones).unref();
    log(`navegador abierto: ${url}`);
  } catch (e) { console.log(`  No pude abrir el navegador (${e.message}). Abre ${url} a mano.`); }
}

export async function main(argv = process.argv.slice(2), { leer, web } = {}) {
  const a = leerArgumentos(argv);
  if (a.ayuda) {
    console.log('\n  OpenMeets · uso: openmeets [--puerto 5050] [--datos <carpeta>] [--sin-navegador]\n');
    return;
  }
  if (!Number.isInteger(a.puerto) || a.puerto < 1 || a.puerto > 65535) { console.error(aviso('El puerto debe ser un número entre 1 y 65535.', detectarColor(process.env, process.stderr))); process.exit(1); }
  if (a.datos === datosPorDefecto()) migrarDatos(a.datos, datosAntiguos());
  mkdirSync(a.datos, { recursive: true });
  const archivoLog = join(a.datos, 'openmeets.log');
  try { if (existsSync(archivoLog) && statSync(archivoLog).size > 1e6) renameSync(archivoLog, `${archivoLog}.1`); } catch { /* sin rotar */ }
  const log = t => { try { appendFileSync(archivoLog, `${new Date().toISOString()} ${t}\n`); } catch { /* sin log */ } };
  const dec = (t = '') => { console.log(t); log(sinColor(String(t)).trim()); };
  const av = t => aviso(t, detectarColor());
  const local = `http://localhost:${a.puerto}/`;

  if (await hayOpenMeets(a.puerto)) {
    dec(av(`OpenMeets ya está abierto en este equipo (puerto ${a.puerto}). Abro el navegador.`));
    if (!a.sinNavegador) abrirNavegador(local, log);
    setTimeout(() => process.exit(0), 1200);
    return;
  }

  const app = crearApp({ datos: a.datos, web: a.web || web, leer });
  try { await app.escuchar(a.puerto); } catch (e) {
    dec(e.code === 'EADDRINUSE'
      ? av(`El puerto ${a.puerto} lo usa otro programa que no es OpenMeets. Ciérralo o usa otro: --puerto ${a.puerto + 1}`)
      : av(`No pude arrancar: ${e.message}`));
    process.exit(1);
  }
  const ips = ipsLAN();
  const modo = detectarColor();
  process.title = tituloVentana(ips.length ? `http://${ips[0]}:${a.puerto}/` : local);
  if (modo.color && process.stdout.isTTY) process.stdout.write(`\x1b]0;${process.title}\x07\x1b[8;46;100t`); // título OSC y ventana de 100×46 (los terminales que no la admiten la ignoran)
  const datosConsola = { version: VERSION, local, ips, puerto: a.puerto, pin: app.acceso.pin, datos: a.datos, registro: archivoLog };
  console.log(lineasConsola({ ...datosConsola, ...modo }).join('\n'));
  lineasConsola({ ...datosConsola, color: false }).forEach(l => { if (l.trim() && !/[▀▄█]/.test(l)) log(l.trim()); });
  if (!a.sinNavegador) abrirNavegador(local, log); else log('navegador omitido (--sin-navegador)');
  const salir = async () => { log('cerrando'); await app.cerrar(); process.exit(0); };
  process.on('SIGINT', salir); process.on('SIGTERM', salir);
  process.on('uncaughtException', e => { log(`error: ${e.stack || e.message}`); console.error(e); });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main().catch(e => { console.error(e); process.exit(1); });
