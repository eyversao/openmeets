// Compara el servidor Node con el binario de Rust: arranque, memoria y peticiones/s (/api/info, un estático y el index).
// Uso: node scripts/bench-nativo.mjs   (antes: npm run nativo)
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exe = join(raiz, 'nativo', 'target', 'release', process.platform === 'win32' ? 'openmeets.exe' : 'openmeets');
const libre = () => new Promise(ok => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const dormir = ms => new Promise(r => setTimeout(r, ms));
const rss = pid => {
  try {
    const t = process.platform === 'win32' ? execSync(`powershell -NoProfile -Command "(Get-Process -Id ${pid}).WorkingSet64"`, { encoding: 'utf8' }) : String(Number(execSync(`ps -o rss= -p ${pid}`, { encoding: 'utf8' })) * 1024);
    return Number(t.trim()) / 1048576;
  } catch { return NaN; }
};

async function carga(puerto, ruta, seg = 5, conc = 64) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: conc });
  let n = 0;
  const fin = Date.now() + seg * 1000;
  const uno = () => new Promise(ok => http.get({ host: '127.0.0.1', port: puerto, path: ruta, agent }, r => { r.resume(); r.on('end', () => { n++; ok(); }); }).on('error', ok));
  await Promise.all(Array.from({ length: conc }, async () => { while (Date.now() < fin) await uno(); }));
  return Math.round(n / seg);
}

async function medir(nombre, cmd, args) {
  const datos = mkdtempSync(join(tmpdir(), 'om-bench-'));
  const puerto = await libre();
  const t0 = performance.now();
  const p = spawn(cmd, [...args, '--sin-navegador', '--puerto', String(puerto), '--datos', datos], { stdio: 'ignore' });
  // El arranque se mide con la línea del registro que se escribe cuando ya escucha (Windows tarda ~1 s en rechazar una conexión a un puerto cerrado).
  const listo = () => { try { return readFileSync(join(datos, 'openmeets.log'), 'utf8').includes('navegador omitido'); } catch { return false; } };
  while (!listo()) await dormir(2);
  const arranque = Math.round(performance.now() - t0);
  await dormir(500);
  const mem0 = rss(p.pid);
  const info = await carga(puerto, '/api/info');
  const est = await carga(puerto, '/js/app.js');
  const idx = await carga(puerto, '/');
  const mem1 = rss(p.pid);
  console.log(JSON.stringify({ nombre, arranqueMs: arranque, memReposoMB: Math.round(mem0), memTrasCargaMB: Math.round(mem1), reqSegInfo: info, reqSegEstatico: est, reqSegIndex: idx }));
  p.kill();
  await dormir(300);
}

const solo = process.argv[2]; // «node» o «rust» para medir uno solo
if (solo !== 'rust') await medir('node', process.execPath, [join(raiz, 'servidor', 'openmeets.mjs')]);
if (solo !== 'node') await medir('rust', exe, []);
process.exit(0);
