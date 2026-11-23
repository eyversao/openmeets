// API de la regie: solo el organizador publica; se valida y limpia; se guarda y llega al que se conecta tarde.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearApp } from './_servidor.mjs';
import { ipsLAN } from '../servidor/acceso.mjs';
import { limpiarRegie } from '../servidor/api.mjs';

// validación pura
const l = limpiarRegie({ modo: 'manual', escena: 'podio', cat: 'Open', texto: 't'.repeat(999), dur: -5, v: 5, patro: { logos: ['data:image/png;base64,AAAA', 'javascript:alert(1)', 'http://x.test/a.png', 'data:text/html;base64,AAAA', 7], seg: 500 }, extra: 'no' });
assert.equal(l.modo, 'manual'); assert.equal(l.escena, 'podio'); assert.equal(l.texto.length, 200); assert.equal(l.dur, 0); assert.equal(l.patro.seg, 8);
assert.deepEqual(l.patro.logos, ['data:image/png;base64,AAAA', 'http://x.test/a.png']); assert.ok(!('extra' in l));
assert.equal(limpiarRegie({ escena: 'hack', modo: 'x' }).escena, ''); assert.equal(limpiarRegie({ modo: 'x' }).modo, 'auto');

const tmp = mkdtempSync(join(tmpdir(), 'om-regie-'));
const web = join(tmp, 'web'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<title>OM</title>');
const app = crearApp({ datos: join(tmp, 'datos'), web, espera: 50 });
const puerto = await app.escuchar(0, '0.0.0.0');
const local = `http://127.0.0.1:${puerto}`;
const lan = ipsLAN()[0] ? `http://${ipsLAN()[0]}:${puerto}` : null;
const pedir = async (base, ruta, { metodo = 'GET', cuerpo } = {}) => {
  const r = await fetch(base + ruta, { method: metodo, headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = null; }
  return { estado: r.status, json: j, texto: t };
};
/** Lee los primeros eventos SSE de un meet. */
async function leerSse(base, ruta, ms = 300) {
  const ctl = new AbortController(); const r = await fetch(base + ruta, { signal: ctl.signal });
  const lector = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  const fin = Date.now() + ms;
  try { while (Date.now() < fin) { const x = await Promise.race([lector.read(), new Promise(ok => setTimeout(() => ok({ timeout: true }), fin - Date.now()))]); if (x.timeout || x.done) break; buf += dec.decode(x.value); } } catch { /* cortado */ }
  ctl.abort();
  return buf.split('\n').filter(s => s.startsWith('data: ')).map(s => JSON.parse(s.slice(6)));
}

try {
  const m = (await pedir(local, '/api/meets', { metodo: 'POST', cuerpo: { nombre: 'Copa Regie', fecha: '2030-01-01' } })).json;
  const canal = `/api/meets/${m.id}/canal`;
  const cuerpo = { tipo: 'regie', plataforma: 'Tarima 1', datos: { modo: 'manual', escena: 'pausa', texto: 'Volvemos en 10 min', patro: { logos: ['https://x.test/a.png'], seg: 6 } } };

  let r = await pedir(local, canal, { metodo: 'POST', cuerpo });
  assert.equal(r.estado, 200);
  assert.equal((await pedir(local, canal, { metodo: 'POST', cuerpo: { tipo: 'regie', plataforma: '', datos: {} } })).estado, 400, 'falta la plataforma');
  assert.equal((await pedir(local, canal, { metodo: 'POST', cuerpo: { tipo: 'regie', plataforma: 'Tarima 1', datos: 'x' } })).estado, 400, 'datos no válidos');
  const gordo = await pedir(local, canal, { metodo: 'POST', cuerpo: { ...cuerpo, datos: { ...cuerpo.datos, texto: 'x'.repeat(70000) } } });
  assert.equal(gordo.estado, 413, 'más de 64 KB no entra');

  // el que se conecta tarde la recibe (público y organizador), ya limpia
  const ev = await leerSse(local, canal);
  const reg = ev.find(e => e.tipo === 'regie');
  assert.ok(reg, 'el SSE inicial incluye la regie guardada'); assert.equal(reg.plataforma, 'Tarima 1');
  assert.equal(reg.datos.escena, 'pausa'); assert.equal(reg.datos.modo, 'manual'); assert.deepEqual(reg.datos.patro, { logos: ['https://x.test/a.png'], seg: 6 });

  if (lan) {
    assert.equal((await pedir(lan, canal, { metodo: 'POST', cuerpo })).estado, 403, 'un no organizador no toca la regie');
    assert.equal((await pedir(lan, canal, { metodo: 'POST', cuerpo: { ...cuerpo, datos: { escena: 'oculto' } } })).estado, 403);
    const pub = await leerSse(lan, canal);
    assert.ok(pub.some(e => e.tipo === 'regie'), 'el público (HUD en otro equipo) recibe la regie');
    assert.equal((await pedir(local, `/api/meets/${m.id}`)).json.regie['Tarima 1'].escena, 'pausa', 'sigue igual tras el intento ajeno');
  } else console.log('  (sin red local: se omite la prueba 403 desde otro equipo)');
  console.log('regie-api: ok');
} finally {
  await app.cerrar();
  rmSync(tmp, { recursive: true, force: true });
}
