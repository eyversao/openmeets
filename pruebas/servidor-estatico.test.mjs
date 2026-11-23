// Estático: respaldo a index.html, MIME, traversal, 404 con extensión, modo ejecutable (leer).
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearEstatico, resolverRuta } from '../servidor/estatico.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'om-est-'));
const web = join(tmp, 'web');
mkdirSync(join(web, 'js'), { recursive: true });
writeFileSync(join(web, 'index.html'), '<!doctype html><title>OM</title>');
writeFileSync(join(web, 'js', 'app.js'), 'export default 1');
writeFileSync(join(web, 'sw.js'), '//sw');
writeFileSync(join(web, 'js', 'grande.js'), 'export const x = 1;\n'.repeat(200));
writeFileSync(join(tmp, 'secreto.txt'), 'SECRETO');

assert.equal(resolverRuta(web, '/js/app.js'), join(web, 'js', 'app.js'));
for (const x of ['/../secreto.txt', '/js/../../secreto.txt', '/%2e%2e/secreto.txt', '/%00', '/js/..%2f..%2fsecreto.txt', '/%E0%A4%A']) assert.equal(resolverRuta(web, x), null, x);

function levantar(opciones) {
  const servir = crearEstatico(opciones);
  const s = http.createServer((req, res) => servir(req, res, new URL(req.url, 'http://x').pathname));
  return new Promise(ok => s.listen(0, '127.0.0.1', () => ok({ s, puerto: s.address().port })));
}
// Petición cruda: no normaliza «../» como lo hace fetch.
const cruda = (puerto, path, cab = {}) => new Promise((ok, no) => {
  http.get({ host: '127.0.0.1', port: puerto, path, headers: cab }, res => { const t = []; res.on('data', c => t.push(c)); res.on('end', () => ok({ estado: res.statusCode, cab: res.headers, texto: Buffer.concat(t).toString() })); }).on('error', no);
});

const { s, puerto } = await levantar({ carpeta: web });
try {
  let r = await cruda(puerto, '/');
  assert.equal(r.estado, 200); assert.match(r.cab['content-type'], /text\/html/); assert.match(r.texto, /OM/);
  r = await cruda(puerto, '/meet/copa-1/pantalla'); // ruta de la app sin extensión
  assert.equal(r.estado, 200); assert.match(r.texto, /OM/, 'respaldo a index.html');
  assert.equal(r.cab['cache-control'], 'no-store');
  r = await cruda(puerto, '/js/app.js');
  assert.match(r.cab['content-type'], /text\/javascript/); assert.ok(r.cab.etag);
  assert.equal((await cruda(puerto, '/js/app.js', { 'If-None-Match': r.cab.etag })).estado, 304);
  assert.equal((await cruda(puerto, '/sw.js')).cab['cache-control'], 'no-store');
  // compresión: gzip si lo aceptan, ETag propio por codificación y 304 con él; sin cabecera, texto plano
  const plano = await cruda(puerto, '/js/grande.js');
  assert.equal(plano.cab['content-encoding'], undefined); assert.equal(plano.cab.vary, 'Accept-Encoding');
  const gz = await new Promise(ok => http.get({ host: '127.0.0.1', port: puerto, path: '/js/grande.js', headers: { 'Accept-Encoding': 'gzip' } }, res => { const t = []; res.on('data', c => t.push(c)); res.on('end', () => ok({ cab: res.headers, cuerpo: Buffer.concat(t) })); }));
  assert.equal(gz.cab['content-encoding'], 'gzip'); assert.ok(gz.cuerpo.length < plano.texto.length / 4);
  assert.equal((await import('node:zlib')).gunzipSync(gz.cuerpo).toString(), plano.texto);
  assert.notEqual(gz.cab.etag, plano.cab.etag);
  assert.equal((await cruda(puerto, '/js/grande.js', { 'Accept-Encoding': 'gzip', 'If-None-Match': gz.cab.etag })).estado, 304);
  assert.equal((await cruda(puerto, '/js/no-existe.js')).estado, 404, 'archivo con extensión que falta = 404');
  for (const x of ['/../secreto.txt', '/js/../../secreto.txt', '/%2e%2e/secreto.txt', '/..%2fsecreto.txt']) {
    r = await cruda(puerto, x);
    assert.ok(!r.texto.includes('SECRETO'), `${x} no filtra (${r.estado})`);
  }
} finally { s.close(); }

// Modo ejecutable: leer() entrega los archivos
const archivos = { 'index.html': Buffer.from('<title>EXE</title>'), 'js/a.js': Buffer.from('1') };
const exe = await levantar({ leer: rel => archivos[rel] || null });
try {
  assert.match((await cruda(exe.puerto, '/')).texto, /EXE/);
  assert.match((await cruda(exe.puerto, '/otra/ruta')).texto, /EXE/);
  assert.equal((await cruda(exe.puerto, '/js/a.js')).estado, 200);
  assert.equal((await cruda(exe.puerto, '/js/b.js')).estado, 404);
  assert.ok([403, 404].includes((await cruda(exe.puerto, '/../x.js')).estado));
} finally { exe.s.close(); rmSync(tmp, { recursive: true, force: true }); }
console.log('estático: ok');
