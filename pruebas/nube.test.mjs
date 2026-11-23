// Versión en la nube: detección de modo, rutas en el navegador, transporte del canal y descargas, con un Firestore falso en memoria.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configValida, leerConfigNube } from '../web/js/nube/modo.js';
import { crearRutas, MSG_NO } from '../web/js/nube/rutas.js';
import { crearTransporte, mensajeDeCambio, transporteDiferido } from '../web/js/nube/transporte.js';
import { reconocer, construir } from '../web/js/nube/descargas.js';
import { armarMeet, claveJuez, docDeMeet } from '../web/js/nube/modelo.js';
import { abrirCanal } from '../web/js/canal.js';
import { leerConfig } from '../scripts/nube-build.mjs';

/* ---------- Firestore falso (la interfaz de web/js/nube/bd.js) ---------- */
function bdFalsa({ usuario = null } = {}) {
  const docs = new Map(); // ruta → datos
  const oyentes = new Set();
  const esperadas = [];
  const bd = { usuarioActual: usuario, escrituras: 0, docs };
  const nivel = r => r.split('/').length;
  const hijos = ruta => [...docs.keys()].filter(k => k.startsWith(`${ruta}/`) && nivel(k) === nivel(ruta) + 1);
  const campo = (d, k) => k.split('.').reduce((x, p) => x?.[p], d);
  const clon = x => JSON.parse(JSON.stringify(x));
  const aplicar = (viejo, nuevo, merge) => {
    const salida = merge ? clon(viejo || {}) : {};
    const fusionar = (dest, src) => {
      for (const [k, v] of Object.entries(src)) {
        if (v && typeof v === 'object' && '__inc' in v) dest[k] = (Number(dest[k]) || 0) + v.__inc;
        else if (v && typeof v === 'object' && !Array.isArray(v) && merge && dest[k] && typeof dest[k] === 'object') fusionar(dest[k], v);
        else if (v && typeof v === 'object' && !Array.isArray(v)) { dest[k] = {}; fusionar(dest[k], v); }
        else dest[k] = clon(v);
      }
    };
    fusionar(salida, nuevo);
    return salida;
  };
  const avisar = (ruta, antes, despues) => {
    for (const o of oyentes) {
      if (o.ruta === ruta && nivel(ruta) % 2 === 0) o.fn({ deCache: o.deCache, cambios: [despues ? { tipo: antes ? 'modified' : 'added', id: ruta.split('/').pop(), d: clon(despues) } : { tipo: 'removed', id: ruta.split('/').pop() }] });
      else if (nivel(ruta) === nivel(o.ruta) + 1 && ruta.startsWith(`${o.ruta}/`)) o.fn({ deCache: o.deCache, cambios: [{ tipo: despues ? (antes ? 'modified' : 'added') : 'removed', id: ruta.split('/').pop(), d: despues ? clon(despues) : undefined }] });
    }
  };
  const escribir = (ruta, datos, merge) => {
    const antes = docs.get(ruta);
    if (/\/inscripciones\/[^/]+$/.test(ruta) && antes && !bd.usuarioActual) throw Object.assign(new Error('denegado'), { code: 'permission-denied' });
    const despues = aplicar(antes, datos, merge);
    docs.set(ruta, despues); bd.escrituras++;
    avisar(ruta, antes, despues);
  };
  const filtrar = (filas, donde = []) => filas.filter(([, d]) => donde.every(([k, op, v]) => op === '==' && campo(d, k) === v));
  Object.assign(bd, {
    config: { apiKey: 'k', projectId: 'p' },
    inc: n => ({ __inc: n }),
    async usuario() { return bd.usuarioActual; },
    async salir() { bd.usuarioActual = null; },
    async get(ruta) { const d = docs.get(ruta); return d ? clon(d) : null; },
    async list(ruta, { donde, orden, limite } = {}) {
      let filas = filtrar(hijos(ruta).map(k => [k, docs.get(k)]), donde);
      if (orden) filas.sort(([, a], [, b]) => (orden[1] === 'desc' ? b[orden[0]] - a[orden[0]] : a[orden[0]] - b[orden[0]]));
      if (limite) filas = filas.slice(0, limite);
      return filas.map(([k, d]) => ({ id: k.split('/').pop(), d: clon(d) }));
    },
    async contar(ruta, donde) { return filtrar(hijos(ruta).map(k => [k, docs.get(k)]), donde).length; },
    async set(ruta, datos, { merge = false } = {}) { escribir(ruta, datos, merge); },
    async update(ruta, datos) { if (!docs.has(ruta)) throw Object.assign(new Error('no existe'), { code: 'not-found' }); escribir(ruta, datos, true); },
    async del(ruta) { const antes = docs.get(ruta); docs.delete(ruta); avisar(ruta, antes, null); },
    async lote(ops) { for (const o of ops) { if (o.op === 'del') await bd.del(o.ruta); else if (o.op === 'update') await bd.update(o.ruta, o.datos); else await bd.set(o.ruta, o.datos, { merge: !!o.merge }); } },
    escuchar(ruta, opciones, fn) {
      const o = { ruta, fn, deCache: false };
      oyentes.add(o);
      if (nivel(ruta) % 2 === 0) fn({ deCache: false, cambios: [docs.has(ruta) ? { tipo: 'added', id: ruta.split('/').pop(), d: clon(docs.get(ruta)) } : { tipo: 'removed', id: ruta.split('/').pop() }] });
      else fn({ deCache: false, cambios: hijos(ruta).map(k => ({ tipo: 'added', id: k.split('/').pop(), d: clon(docs.get(k)) })) });
      esperadas.push(o);
      return () => oyentes.delete(o);
    },
    oyentes: () => [...oyentes],
  });
  return bd;
}

const yo = { uid: 'u1', email: 'a@b.co', nombre: 'Ana', foto: '' };
const falla = async (p, estado, trozo) => { try { await p; } catch (e) { assert.equal(e.estado, estado, `${e.message}`); if (trozo) assert.match(e.message, trozo); return; } assert.fail('debía fallar'); };
const almacen = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
let reloj = 1_700_000_000_000;
const ahora = () => reloj;

/* ---------- 1. detección de modo ---------- */
assert.equal(configValida({ apiKey: 'a', projectId: 'p' })?.projectId, 'p');
for (const x of [null, [], 'x', {}, { apiKey: 'a' }, { projectId: 'p' }, { apiKey: 1, projectId: 'p' }]) assert.equal(configValida(x), null);
assert.deepEqual(await leerConfigNube(async () => ({ ok: true, json: async () => ({ apiKey: 'a', projectId: 'p' }) })), { apiKey: 'a', projectId: 'p' });
assert.equal(await leerConfigNube(async () => ({ ok: false, json: async () => ({}) })), null, '404');
assert.equal(await leerConfigNube(async () => ({ ok: true, json: async () => { throw new SyntaxError('html'); } })), null, 'el index.html del rewrite no es JSON');
assert.equal(await leerConfigNube(async () => { throw new Error('sin red'); }), null);

/* ---------- 2. rutas ---------- */
{
  const bd = bdFalsa();
  const pedir = crearRutas({ db: bd, almacen: almacen(), ahora });

  // info y rutas que no existen en la nube
  assert.deepEqual({ ...(await pedir('GET', '/api/info')), firebase: undefined }, { app: 'OpenMeets', version: '1.0.0', puerto: 0, ips: [], organizador: false, modo: 'cuentas', cuentas: true, usuario: null, firebase: undefined });
  for (const r of ['/api/records', '/api/atletas', '/api/nube/estado', '/api/rol', '/api/meets/abc-123/locutor']) await falla(pedir('GET', r), 404, new RegExp(MSG_NO.slice(0, 30)));

  // crear: hace falta cuenta
  await falla(pedir('POST', '/api/meets', { nombre: 'Copa' }), 401);
  bd.usuarioActual = yo;
  const info = await pedir('GET', '/api/info');
  assert.equal(info.organizador, true); assert.equal(info.usuario.email, 'a@b.co');
  await falla(pedir('POST', '/api/meets', { nombre: '' }), 400);
  const m = await pedir('POST', '/api/meets', { nombre: 'Copa Ñandú 2026', fecha: '2026-12-01', plataformas: ['Tarima 1', 'Tarima 2'] });
  assert.match(m.id, /^copa-nandu-2026-[0-9a-f]{6}$/);
  assert.match(m.privado.codigoJuez, /^\d{6}$/);
  const raiz = bd.docs.get(`meets/${m.id}`);
  assert.equal(raiz.dueno, 'u1'); assert.equal(raiz.n, 0); assert.equal(raiz.enVivo, false);
  for (const k of ['atletas', 'vivo', 'regie', 'aplausos', 'actividad', 'privado']) assert.ok(!(k in raiz), `${k} no va en el documento del meet`);
  assert.equal(bd.docs.get(`meets/${m.id}/privado/datos`).codigoJuez, m.privado.codigoJuez);

  // listado: públicos vs míos
  await pedir('POST', '/api/meets', { nombre: 'Privado', publico: false, fecha: '2027-01-01' });
  assert.equal((await pedir('GET', '/api/meets')).length, 1, 'el privado no sale en el listado público');
  const mias = await pedir('GET', '/api/meets?todas=1');
  assert.equal(mias.length, 2); assert.ok(mias.every(x => x.mio)); assert.equal(mias[0].fecha, '2027-01-01', 'ordenado por fecha, el más nuevo primero');
  assert.equal(mias[1].estado === 'programada' || mias[1].estado === 'terminada', true);

  // atletas
  const ruta = `/api/meets/${m.id}`;
  const ana = { id: 'ana', nombre: 'Ana Gil', sexo: 'F', peso: 60, intentos: { S: [{ kg: 100 }], B: [], D: [] } };
  const guardada = await pedir('PUT', `${ruta}/atletas/ana`, ana);
  assert.equal(guardada.nombre, 'Ana Gil');
  assert.equal(bd.docs.get(`meets/${m.id}`).n, 1);
  await pedir('PUT', `${ruta}/atletas/ana`, { ...ana, intentos: { S: [{ kg: 100, r: 1 }], B: [], D: [] } });
  assert.equal(bd.docs.get(`meets/${m.id}`).n, 1, 'reescribir no suma');
  assert.ok([...bd.docs].some(([k, d]) => k.includes('/actividad/') && /Ana Gil: sentadilla 1 · 100 kg · válido/.test(d.texto)), 'el resultado queda en la actividad');
  await falla(pedir('PUT', `${ruta}/atletas/MAL ID`, ana), 400);
  const lote = await pedir('POST', `${ruta}/atletas`, { atletas: [{ nombre: 'Luis Paz', sexo: 'M' }, { id: 'ana', nombre: 'Ana Gil', sexo: 'F' }] });
  assert.equal(lote.atletas, 2);
  assert.equal(bd.docs.get(`meets/${m.id}`).n, 2);
  await falla(pedir('POST', `${ruta}/atletas`, { atletas: [{ id: 'x', nombre: 'A' }, { id: 'x', nombre: 'B' }] }), 400, /mismo identificador/);

  // GET del meet: forma del servidor
  const completo = await pedir('GET', ruta);
  assert.equal(completo.mio, true); assert.equal(completo.atletas.length, 2); assert.ok(completo.estado);
  assert.equal(completo.privado.codigoJuez, m.privado.codigoJuez);
  assert.ok(!('dueno' in completo) && !('n' in completo) && !('enVivo' in completo));
  assert.ok(completo.actividad.length >= 3 && completo.actividad.every((x, i, a) => !i || a[i - 1].ts <= x.ts));
  bd.usuarioActual = { ...yo, uid: 'otra' };
  const ajeno = await pedir('GET', ruta);
  assert.equal(ajeno.mio, false); assert.ok(!('privado' in ajeno), 'el público no ve el código de jueces');
  await falla(pedir('PUT', `${ruta}/atletas/ana`, ana), 403);
  await falla(pedir('PATCH', ruta, { nombre: 'Robo' }), 403);
  await falla(pedir('DELETE', ruta), 403);
  await falla(pedir('GET', `${ruta}/export.json`), 403);

  // aplauso: 1 cada 10 s
  await pedir('POST', `${ruta}/aplauso`, { aid: 'ana' });
  assert.equal(bd.docs.get(`meets/${m.id}/aplausos/ana`).n, 1);
  await falla(pedir('POST', `${ruta}/aplauso`, { aid: 'ana' }), 429);
  reloj += 11000;
  await pedir('POST', `${ruta}/aplauso`, { aid: 'ana' });
  assert.equal(bd.docs.get(`meets/${m.id}/aplausos/ana`).n, 2);
  await falla(pedir('POST', `${ruta}/aplauso`, { aid: 'no ok' }), 404);

  // PATCH, CSV y copia
  bd.usuarioActual = yo;
  const cambiado = await pedir('PATCH', ruta, { cerrado: true, codigoJuez: '999999', hud: { a: 1 } });
  assert.equal(cambiado.estado, 'terminada');
  assert.equal(bd.docs.get(`meets/${m.id}/privado/datos`).codigoJuez, '999999');
  assert.ok([...bd.docs].some(([k, d]) => k.includes('/actividad/') && d.texto === 'Meet terminado'));
  const csv = await pedir('GET', `${ruta}/resultados.csv`);
  assert.ok(csv.startsWith('﻿Puesto,') && csv.includes('Ana Gil'));
  const copia = await pedir('GET', `${ruta}/export.json`);
  assert.equal(copia.id, m.id); assert.equal(copia.atletas.length, 2); assert.ok(!('mio' in copia));
  await falla(pedir('POST', '/api/meets/importar', copia), 409);
  const reimp = await pedir('POST', '/api/meets/importar?reemplazar=1', { ...copia, atletas: [copia.atletas[0]] });
  assert.equal(reimp.atletas.length, 1);
  assert.equal([...bd.docs.keys()].filter(k => k.startsWith(`meets/${m.id}/atletas/`)).length, 1, 'reemplazar borra los atletas anteriores');
  const otro = await pedir('POST', '/api/meets/importar', { ...copia, id: 'copia-2' });
  assert.equal(otro.id, 'copia-2');

  // atleta fuera
  await pedir('DELETE', `${ruta}/atletas/ana`);
  assert.equal(bd.docs.has(`meets/${m.id}/aplausos/ana`), false);
  await falla(pedir('DELETE', `${ruta}/atletas/ana`), 404);

  // límite de meets por cuenta
  for (let i = 0; i < 47; i++) bd.docs.set(`meets/relleno-${i}`, { dueno: 'u1', publico: false });
  await falla(pedir('POST', '/api/meets', { nombre: 'Uno de más' }), 400, /hasta 50/);

  // borrar
  await pedir('DELETE', '/api/meets/copia-2');
  assert.ok(![...bd.docs.keys()].some(k => k.startsWith('meets/copia-2')));
}

/* ---------- 3. inscripciones ---------- */
{
  const bd = bdFalsa({ usuario: yo });
  const mem = almacen();
  const pedir = crearRutas({ db: bd, almacen: mem, ahora });
  const m = await pedir('POST', '/api/meets', { nombre: 'Open Club', federacion: 'IPF', fecha: '2027-06-01' });
  const ins = `/api/meets/${m.id}/inscripciones`;
  const cfg = await pedir('PUT', `${ins}/config`, { abiertas: true, cupoTotal: 2, precio: 50000, moneda: 'cop', equipamiento: ['raw'] });
  assert.equal(cfg.config.moneda, 'COP');
  await falla(pedir('PUT', `${ins}/config`, { abiertas: true, pagoUrl: 'ftp://x' }), 400);

  bd.usuarioActual = null; // un visitante
  assert.deepEqual(await pedir('GET', '/api/inscripciones/abiertas'), [m.id]);
  const est = await pedir('GET', `${ins}/estado`);
  assert.equal(est.abierta, true); assert.equal(est.cupos.total, 2); assert.equal(est.cupos.ocupados, 0);
  await falla(pedir('GET', ins), 403);
  const form = { nombre: 'Luis Perez', sexo: 'M', nacimiento: '2000-01-01', division: 'Open', equipamiento: 'raw', pesoEstimado: 80, contacto: 'luis@correo.com', acepto: true };
  await falla(pedir('POST', ins, { ...form, acepto: false }), 400, /reglamento/);
  await falla(pedir('POST', ins, { ...form, equipamiento: 'equipado' }), 400, /equipamiento/);
  const r1 = await pedir('POST', ins, form);
  assert.equal(r1.estado, 'pendiente'); assert.match(r1.codigo, /^[A-HJKMNP-Z2-9]{6}$/); assert.equal(r1.precio, 50000);
  await falla(pedir('POST', ins, form), 409, /Ya hay una inscripción/);
  await pedir('POST', ins, { ...form, nombre: 'Marta Diaz', sexo: 'F', nacimiento: '1999-05-05', pesoEstimado: 60 });
  reloj += 1000;
  const r3 = await pedir('POST', ins, { ...form, nombre: 'Pablo Ruiz', nacimiento: '1998-02-02' });
  assert.equal(r3.estado, 'espera', 'con el cupo lleno va a la lista de espera');
  assert.deepEqual({ o: bd.docs.get(`meets/${m.id}/publico/cupos`).ocupados, e: bd.docs.get(`meets/${m.id}/publico/cupos`).espera }, { o: 2, e: 1 });
  for (let i = 0; i < 2; i++) await pedir('POST', ins, { ...form, nombre: `Extra Numero${'ab'[i]}`, nacimiento: `1990-01-0${i + 1}` }).catch(() => {});
  await falla(pedir('POST', ins, { ...form, nombre: 'Sexta Persona', nacimiento: '1991-01-01' }), 429, /varias inscripciones/);

  // el organizador gestiona
  bd.usuarioActual = yo;
  const lista = await pedir('GET', ins);
  assert.equal(lista.items.length >= 3, true);
  const luis = lista.items.find(i => i.nombre === 'Luis Perez');
  const conf = await pedir('PATCH', `${ins}/${luis.id}`, { estado: 'confirmado', pagado: true, nota: 'ok' });
  assert.equal(conf.item.estado, 'confirmado'); assert.ok(conf.item.aid);
  assert.equal(bd.docs.get(`meets/${m.id}/atletas/${conf.item.aid}`).nombre, 'Luis Perez');
  assert.equal(bd.docs.get(`meets/${m.id}`).n, 1);
  await pedir('PATCH', `${ins}/${luis.id}`, { estado: 'pendiente' });
  assert.equal(bd.docs.has(`meets/${m.id}/atletas/${conf.item.aid}`), false, 'al desconfirmar sale del meet');
  await falla(pedir('PATCH', `${ins}/${luis.id}`, { estado: 'raro' }), 400);
  await falla(pedir('PATCH', `${ins}/in-no-existe`, { nota: 'x' }), 404);
  const csv = await pedir('GET', `/api/meets/${m.id}/inscripciones.csv`);
  assert.ok(csv.includes('Luis Perez') && csv.includes('luis@correo.com'));
  // contador público corregido desde la lista completa
  bd.docs.set(`meets/${m.id}/publico/cupos`, { ocupados: 99, espera: 0, porClase: {} });
  await pedir('GET', ins);
  assert.ok(bd.docs.get(`meets/${m.id}/publico/cupos`).ocupados < 99);
}

/* ---------- 4. transporte del canal ---------- */
assert.deepEqual(mensajeDeCambio('atletas', { tipo: 'removed', id: 'a1' }), { tipo: 'atleta', atleta: { id: 'a1', eliminado: true }, eliminado: true });
assert.deepEqual(mensajeDeCambio('aplausos', { tipo: 'modified', id: 'a1', d: { n: 3 } }), { tipo: 'aplauso', aid: 'a1', n: 3 });
assert.deepEqual(mensajeDeCambio('vivo', { tipo: 'added', id: 'T', d: { plataforma: 'T 1', datos: { version: 2 } } }), { tipo: 'vivo', plataforma: 'T 1', datos: { version: 2 } });
assert.equal(mensajeDeCambio('vivo', { tipo: 'removed', id: 'T' }), null);
assert.deepEqual(mensajeDeCambio('votos', { tipo: 'added', id: 'k', d: { pos: 'izq', voto: 'roja', codigo: '123456' } }), { tipo: 'voto', voto: { pos: 'izq', voto: 'roja' } }, 'el código de jueces no sale en el voto');
assert.equal(claveJuez('Tarima 1', 'izq', 'd 1!'), 'Tarima_1__izq__d1');

{
  const bd = bdFalsa({ usuario: yo });
  const pedir = crearRutas({ db: bd, almacen: almacen(), ahora });
  const m = await pedir('POST', '/api/meets', { nombre: 'Canal' });
  await pedir('PUT', `/api/meets/${m.id}/atletas/ana`, { id: 'ana', nombre: 'Ana Gil', sexo: 'F' });
  const codigo = m.privado.codigoJuez;

  // la mesa (dueño)
  const t = crearTransporte(bd, m.id, { espera: 0 });
  const msgs = [], estados = [];
  const baja = t.suscribir(x => msgs.push(x), e => estados.push(e));
  await new Promise(r => setTimeout(r, 10));
  assert.equal(msgs[0].tipo, 'meet', 'primero el meet completo');
  assert.equal(msgs[0].meet.atletas.length, 1); assert.equal(msgs[0].meet.mio, true); assert.equal(msgs[0].meet.privado.codigoJuez, codigo);
  assert.equal(estados.at(-1), 'conectado');
  const n0 = msgs.length;
  await pedir('PUT', `/api/meets/${m.id}/atletas/luis`, { id: 'luis', nombre: 'Luis Paz', sexo: 'M' });
  assert.ok(msgs.slice(n0).some(x => x.tipo === 'atleta' && x.atleta.id === 'luis'));
  await pedir('DELETE', `/api/meets/${m.id}/atletas/luis`);
  assert.ok(msgs.some(x => x.tipo === 'atleta' && x.eliminado && x.atleta.id === 'luis'));
  assert.ok(msgs.some(x => x.tipo === 'meet-cambio' && x.campos.actividad), 'la actividad llega como meet-cambio');
  await pedir('PATCH', `/api/meets/${m.id}`, { nombre: 'Canal 2' });
  assert.ok(msgs.some(x => x.tipo === 'meet-cambio' && x.campos.nombre === 'Canal 2' && !('dueno' in x.campos) && !('n' in x.campos)));

  // vivo: agrupado, versión creciente y bit enVivo
  await Promise.all([1, 2, 3].map(v => t.enviar({ tipo: 'vivo', plataforma: 'Tarima 1', datos: { version: v, actual: 'ana', turno: 't1' } })));
  assert.equal(bd.docs.get(`meets/${m.id}/vivo/Tarima_1`).datos.version, 3, 'solo se escribe el último');
  assert.equal(bd.docs.get(`meets/${m.id}`).enVivo, true);
  await t.enviar({ tipo: 'vivo', plataforma: 'Tarima 1', datos: { version: 2, actual: null } });
  assert.equal(bd.docs.get(`meets/${m.id}/vivo/Tarima_1`).datos.version, 3, 'una versión menor se ignora');
  assert.ok(msgs.some(x => x.tipo === 'vivo' && x.datos.version === 3));
  await t.enviar({ tipo: 'vivo', plataforma: 'Tarima 1', datos: { version: 9, actual: null, turno: 't2' } });
  assert.equal(bd.docs.get(`meets/${m.id}`).enVivo, false, 'enVivo vuelve a falso cuando ya no hay nadie en tarima');
  await t.enviar({ tipo: 'regie', plataforma: 'Tarima 1', datos: { escena: 'podio', logos: 'x', v: 5 } });
  assert.equal(bd.docs.get(`meets/${m.id}/regie/Tarima_1`).datos.escena, 'podio');
  assert.ok(msgs.some(x => x.tipo === 'regie'));

  // un juez (sin cuenta): código, votos y presencia
  const juez = crearTransporte(bd, m.id, { espera: 0 });
  const v = { plataforma: 'Tarima 1', pos: 'izq', voto: 'blanca', turno: 't2', dispositivo: 'tel1' };
  await assert.rejects(juez.enviar({ tipo: 'voto', voto: v }), e => e.estado === 403);
  await assert.rejects(juez.enviar({ tipo: 'voto', voto: { ...v, pos: 'arriba' }, codigo }), e => e.estado === 400);
  await juez.enviar({ tipo: 'voto', voto: v, codigo });
  assert.equal(bd.docs.get(`meets/${m.id}/votos/Tarima_1__izq__tel1`).codigo, codigo);
  assert.deepEqual(await juez.enviar({ tipo: 'voto', voto: { ...v, voto: 'roja' }, codigo }), { repetido: true }, 'el primero cuenta');
  assert.equal(bd.docs.get(`meets/${m.id}/votos/Tarima_1__izq__tel1`).voto, 'blanca');
  assert.ok(msgs.some(x => x.tipo === 'voto' && x.voto.voto === 'blanca' && !('codigo' in x.voto)), 'el dueño recibe el voto');
  const antes = bd.escrituras;
  const p = { plataforma: 'Tarima 1', pos: 'izq', dispositivo: 'tel1', nombre: 'Juez Uno', huella: 'h1', bateria: 80 };
  await juez.enviar({ tipo: 'presencia', datos: p, codigo });
  await juez.enviar({ tipo: 'presencia', datos: p, codigo });
  assert.equal(bd.escrituras - antes >= 1 && bd.docs.get(`meets/${m.id}/presencia/Tarima_1__izq__tel1`).nombre === 'Juez Uno', true);
  assert.equal(bd.escrituras - antes <= 3, true, 'el pulso repetido no escribe cada vez');
  assert.ok(msgs.some(x => x.tipo === 'presencia' && x.datos.huella === 'h1'));
  assert.equal(bd.docs.get(`meets/${m.id}/privado/datos`).juecesConocidos.h1.nombre, 'Juez Uno', 'la huella queda en jueces conocidos');

  // limpiar borra los votos de la plataforma
  await t.enviar({ tipo: 'limpiar', plataforma: 'Tarima 1' });
  assert.equal(bd.docs.has(`meets/${m.id}/votos/Tarima_1__izq__tel1`), false);

  // un espectador no ve votos ni privado
  bd.usuarioActual = null;
  const pub = crearTransporte(bd, m.id, { espera: 0 });
  const mp = [];
  pub.suscribir(x => mp.push(x), () => {});
  await new Promise(r => setTimeout(r, 10));
  assert.equal(mp[0].tipo, 'meet'); assert.equal(mp[0].meet.mio, false); assert.ok(!('privado' in mp[0].meet));
  baja();
}

// estado de conexión: desde la caché = reconectando; con el servidor = conectado; sin red = sin-red
{
  const bd = bdFalsa();
  bd.docs.set('meets/x1', { id: 'x1', nombre: 'X', publico: true, dueno: 'z', n: 0, enVivo: false });
  let linea = true;
  const t = crearTransporte(bd, 'x1', { enLinea: () => linea, sinServidorMs: 20 });
  const estados = [];
  const baja = t.suscribir(() => {}, e => estados.push(e));
  for (const o of bd.oyentes()) o.fn({ deCache: true, cambios: [] });
  assert.equal(estados.at(-1), 'reconectando');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(estados.at(-1), 'sin-red', 'si el servidor no contesta en un rato, sin red');
  for (const o of bd.oyentes()) if (o.ruta === 'meets/x1') o.fn({ deCache: false, cambios: [] });
  assert.equal(estados.at(-1), 'conectado');
  baja();
}

/* ---------- 5. canal.js con transporte ---------- */
{
  const enviados = [];
  let alMsg = null, bajas = 0;
  const transporte = { enviar: async m => { enviados.push(m); return true; }, suscribir(f, e) { alMsg = f; e('conectado'); return () => { bajas++; }; } };
  const canal = abrirCanal('cop-1', { rol: 'mesa', transporte, deps: { BroadcastChannel: null, EventSource: class { constructor() { throw new Error('no debe usar SSE'); } } } });
  assert.equal(canal.estado(), 'conectado');
  const vistos = [];
  canal.escucharMeet(m => vistos.push(m));
  alMsg({ tipo: 'meet', meet: { id: 'cop-1', atletas: [], vivo: {} } });
  alMsg({ tipo: 'atleta', atleta: { id: 'a', nombre: 'A' } });
  assert.equal(vistos.at(-1).atletas.length, 1);
  canal.publicarVivo('Tarima 1', { actual: 'a' });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(enviados[0].tipo, 'vivo'); assert.equal(enviados[0].plataforma, 'Tarima 1');
  const juez = abrirCanal('cop-1', { rol: 'juez', codigo: '123456', transporte, deps: { BroadcastChannel: null, almacen: almacen() } });
  const r = await juez.enviarVoto({ plataforma: 'Tarima 1', pos: 'izq', voto: 'blanca', turno: 't', dispositivo: 'd' });
  assert.equal(r.ok, true);
  assert.equal(enviados.at(-1).codigo, '123456');
  canal.cerrar(); juez.cerrar();
  assert.equal(bajas >= 1, true);
  // el diferido devuelve la baja al instante aunque el SDK aún no esté cargado
  let baja2 = null;
  const dif = transporteDiferido(async () => bdFalsa(), 'nada');
  baja2 = dif.suscribir(() => {}, () => {});
  assert.equal(typeof baja2, 'function'); baja2();
}

/* ---------- 6. descargas ---------- */
assert.equal(reconocer('/api/meets/abc-1/resultados.csv').nombre, 'abc-1-resultados.csv');
assert.equal(reconocer('http://localhost/api/meets/abc-1/export.json').nombre, 'abc-1.json');
assert.equal(reconocer('/api/meets/abc-1/inscripciones.csv').mime, 'text/csv;charset=utf-8');
for (const h of ['/api/meets/abc-1', '/meets/abc-1/resultados.csv', '/api/meets/a/b/resultados.csv', 'javascript:1']) assert.equal(reconocer(h), null);
{
  const f = await construir(reconocer('/api/meets/abc-1/export.json'), async () => ({ id: 'abc-1' }));
  assert.deepEqual(JSON.parse(f.texto), { id: 'abc-1' });
  const c = await construir(reconocer('/api/meets/abc-1/resultados.csv'), async () => 'a,b');
  assert.equal(c.texto, 'a,b');
}

/* ---------- 7. modelo y configuración de despliegue ---------- */
{
  const doc = docDeMeet({ id: 'a', nombre: 'N', atletas: [1], vivo: {}, privado: {}, actividad: [], aplausos: {}, hud: { x: undefined, y: 1 } }, { dueno: 'u', n: 1 });
  assert.deepEqual(doc, { id: 'a', nombre: 'N', hud: { y: 1 }, dueno: 'u', n: 1, enVivo: false });
  const m = armarMeet({ id: 'a', n: 2, enVivo: true, dueno: 'u', nombre: 'N' }, { aplausos: [{ id: 'x', d: { n: 4 } }], vivo: [{ id: 'T', d: { plataforma: 'T 1', datos: { v: 1 } } }] });
  assert.deepEqual({ ...m }, { id: 'a', nombre: 'N', atletas: [], vivo: { 'T 1': { v: 1 } }, regie: {}, aplausos: { x: 4 }, actividad: [] });
  const dir = mkdtempSync(join(tmpdir(), 'om-nube-'));
  const f = join(dir, 'c.json');
  writeFileSync(f, JSON.stringify({ apiKey: 'k', projectId: 'p', authDomain: 'a' }));
  assert.equal(leerConfig(f).projectId, 'p');
  writeFileSync(f, JSON.stringify({ firebaseConfig: { apiKey: 'k', projectId: 'q' } }));
  assert.equal(leerConfig(f).projectId, 'q');
  writeFileSync(f, '{}');
  assert.throws(() => leerConfig(f), /apiKey y projectId/);
  rmSync(dir, { recursive: true, force: true });
}

console.log('nube: ok');
