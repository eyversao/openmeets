// Arranca el servidor para las pruebas por HTTP: el de Node (por defecto) o el binario de Rust con OPENMEETS_SERVIDOR=rust.
// Misma forma que crearApp de servidor/openmeets.mjs: { escuchar(puerto, host), cerrar(), almacen.leer(id) }.
import net from 'node:net';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearApp as crearNode } from '../servidor/openmeets.mjs';

export const RUST = process.env.OPENMEETS_SERVIDOR === 'rust';
export const EXE = process.env.OPENMEETS_EXE || join(dirname(fileURLToPath(import.meta.url)), '..', 'nativo', 'target', 'release', process.platform === 'win32' ? 'openmeets.exe' : 'openmeets');

const libre = () => new Promise(ok => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const dormir = ms => new Promise(r => setTimeout(r, ms));
const dormirSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function crearRust({ datos, web, espera = 300 }) {
  let hijo = null;
  return {
    async escuchar(puerto = 0) {
      const p = puerto || await libre();
      const args = ['--sin-navegador', '--puerto', String(p), '--datos', datos];
      if (web) args.push('--web', web);
      hijo = spawn(EXE, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, OPENMEETS_ESPERA_MS: String(espera) } });
      hijo.stdout.resume(); hijo.stderr.resume();
      for (let i = 0; i < 100; i++) {
        try { if ((await fetch(`http://127.0.0.1:${p}/api/info`)).ok) return p; } catch { /* aún no */ }
        await dormir(50);
      }
      throw new Error('el servidor de Rust no arrancó');
    },
    async cerrar() {
      if (!hijo) return;
      await dormir(espera * 3 + 50); // el binario guarda tras la espera agrupada; matarlo no vacía (en Windows no hay señal limpia)
      const salio = new Promise(r => hijo.once('exit', r));
      hijo.kill(); await salio; hijo = null;
    },
    // Lectura directa del JSON en disco (da tiempo a la escritura agrupada).
    almacen: { leer(id) { dormirSync(espera * 3 + 50); try { return JSON.parse(readFileSync(join(datos, 'meets', `${id}.json`), 'utf8')); } catch { return null; } } },
  };
}

export const crearApp = o => (RUST ? crearRust(o) : crearNode(o));
