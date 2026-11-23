// Arranque real: proceso aparte en un puerto libre con datos temporales; instancia única; datos persisten al reiniciar.
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUST, EXE } from './_servidor.mjs';

const script = fileURLToPath(new URL('../servidor/openmeets.mjs', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'om-arranque-'));
const libre = () => new Promise(ok => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const puerto = await libre();
const esperarInfo = async () => {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${puerto}/api/info`); if (r.ok) return r.json(); } catch { /* aún no */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('el servidor no arrancó');
};
const lanzar = () => { const p = spawn(RUST ? EXE : process.execPath, [...(RUST ? [] : [script]), '--sin-navegador', '--puerto', String(puerto), '--datos', tmp], { stdio: ['ignore', 'pipe', 'pipe'] }); p.salida = ''; p.stdout.on('data', d => { p.salida += d; }); p.stderr.on('data', d => { p.salida += d; }); return p; };
const parar = p => new Promise(ok => { if (p.exitCode !== null || p.signalCode !== null) return ok(); p.once('exit', ok); p.kill(); });

let p1, p2;
try {
  p1 = lanzar();
  const info = await esperarInfo();
  assert.equal(info.app, 'OpenMeets'); assert.equal(info.puerto, puerto);
  assert.match(p1.salida, /PIN de organizador/);
  const pin = JSON.parse(readFileSync(join(tmp, 'config.json'), 'utf8')).pin;
  assert.match(pin, /^\d{6}$/); assert.ok(p1.salida.includes(pin), 'la consola muestra el PIN');

  const r = await fetch(`http://127.0.0.1:${puerto}/api/meets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre: 'Copa Arranque', fecha: '2030-01-01' }) });
  assert.equal(r.status, 201);
  const { id } = await r.json();
  assert.equal((await (await fetch(`http://127.0.0.1:${puerto}/api/meets`)).json()).length, 1);

  // Instancia única: un segundo arranque en el mismo puerto avisa y sale limpio
  const seg = spawnSync(RUST ? EXE : process.execPath, [...(RUST ? [] : [script]), '--sin-navegador', '--puerto', String(puerto), '--datos', tmp], { encoding: 'utf8', timeout: 15000 });
  assert.equal(seg.status, 0); assert.match(seg.stdout, /ya está abierto/);

  await parar(p1);
  assert.ok(existsSync(join(tmp, 'meets', `${id}.json`)), 'el meet quedó en disco');
  assert.match(readFileSync(join(tmp, 'openmeets.log'), 'utf8'), /OpenMeets/);

  // Reinicio: no se pierde nada y el PIN se conserva
  p2 = lanzar();
  await esperarInfo();
  assert.equal((await (await fetch(`http://127.0.0.1:${puerto}/api/meets`)).json())[0].id, id);
  assert.equal(JSON.parse(readFileSync(join(tmp, 'config.json'), 'utf8')).pin, pin);
  console.log('arranque: ok');
} finally {
  if (p1) await parar(p1);
  if (p2) await parar(p2);
  rmSync(tmp, { recursive: true, force: true });
}
