// Mesa de control: aceptar votos, revelación y estado de jueces (sin red ni navegador).
import assert from 'node:assert/strict';
const V = await import(new URL('../web/js/nucleo/mesa-votos.js', import.meta.url).href);
const ctx = { plataforma: 'Tarima 1', turno: 'a1_S_0', modo: 'IPF' };
const voto = (pos, v, extra = {}) => ({ plataforma: 'Tarima 1', pos, voto: v, turno: 'a1_S_0', via: 'nube', ...extra });

let vs = {};
vs = V.aceptarVoto(vs, voto('izq', 'blanca'), ctx);
assert.equal(vs.izq.luz, 'blanca');
assert.equal(V.aceptarVoto(vs, voto('izq', 'roja'), ctx), null, 'el primer voto del juez cuenta');
assert.equal(V.aceptarVoto(vs, voto('cen', 'roja', { turno: 'a2_S_0' }), ctx), null, 'otro turno');
assert.equal(V.aceptarVoto(vs, voto('cen', 'roja', { plataforma: 'Tarima 2' }), ctx), null, 'otra tarima');
assert.equal(V.aceptarVoto(vs, voto('xx', 'roja'), ctx), null, 'posición inválida');
assert.deepEqual(V.votados(vs), { izq: true, cen: false, der: false });
assert.equal(V.revelacion(vs, 'IPF'), null, 'faltan votos');

vs = V.aceptarVoto(vs, voto('cen', 'azul', { via: 'bluetooth' }), ctx);
assert.deepEqual(vs.cen, { luz: 'roja', tarjetas: ['azul'], via: 'bluetooth', ts: vs.cen.ts });
vs = V.aceptarVoto(vs, voto('der', 'roja', { tarjetas: [] }), ctx);
assert.deepEqual(vs.der.tarjetas, ['roja'], 'IPF: roja lleva tarjeta roja');
const r = V.revelacion(vs, 'IPF');
assert.equal(r.resultado, -1);
assert.deepEqual(r.luces.tarjetas, { izq: [], cen: ['azul'], der: ['roja'] });
assert.equal(r.luces.cen, 'roja');

// dos blancas validan
const ok = ['izq', 'cen', 'der'].reduce((m, p, i) => V.aceptarVoto(m, voto(p, i === 2 ? 'roja' : 'blanca'), { ...ctx, modo: 'otra' }), {});
assert.equal(V.revelacion(ok, 'otra').resultado, 1);
assert.deepEqual(ok.der.tarjetas, [], 'modo otra: sin tarjeta');

/* tiempo */
assert.equal(V.leerTiempo('3:00'), 180);
assert.equal(V.leerTiempo('90'), 90);
assert.equal(V.leerTiempo('1:75'), null);
assert.equal(V.leerTiempo('abc'), null);

/* estado de jueces */
const ahora = 100000;
const e = V.estadoJueces(
  { Tarima_1__izq: { via: 'local', bateria: 80, ts: ahora - 3000 }, Tarima_1__cen: { via: 'nube', bateria: 50, ts: ahora - 30000 } },
  [{ id: 'bt:1', tipo: 'bluetooth', conectado: true, bateria: 91, pos: 'cen', ts: ahora - 1000 }, { id: 'u', tipo: 'usb', conectado: false, pos: 'der', ts: 5 }],
  'Tarima 1', ahora,
);
assert.deepEqual(e.izq, { via: 'local', conectado: true, bateria: 80, ts: ahora - 3000 });
assert.equal(e.cen.via, 'bluetooth', 'el mando conectado gana al teléfono caducado');
assert.equal(e.der.conectado, false);
assert.equal(V.estadoJueces({}, [], 'Tarima 1', ahora).izq.via, null);
console.log('mesa-votos OK');
