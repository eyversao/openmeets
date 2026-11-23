// Estado de las luces, resultado, motivos de tarjeta y pitidos del reloj.
import assert from 'node:assert/strict';
const L = await import(new URL('../web/js/nucleo/luces-estado.js', import.meta.url).href);

const actual = { aid: 'a1', nombre: 'X', kg: 100, n: 0 };
const base = { lev: 'S', actual, turno: 'a1_S_0', modo: 'IPF' };
const t0 = 1_000_000;

// Vivo viejo: sin votados ni turno
let e = L.estadoLuces({ actual, lev: 'S' }, t0);
assert.equal(e.revelado, false); assert.deepEqual(e.votados, { izq: false, cen: false, der: false });

// Pre-marcado
e = L.estadoLuces({ ...base, votados: { izq: true, cen: false, der: true } }, t0);
assert.deepEqual(e.votados, { izq: true, cen: false, der: true }); assert.equal(e.revelado, false);
assert.equal(e.luces.izq, null);
// Turno viejo: no se pre-marca
e = L.estadoLuces({ ...base, turno: 'a0_S_2', votados: { izq: true, cen: true, der: true } }, t0);
assert.deepEqual(e.votados, { izq: false, cen: false, der: false });

// Revelado con tarjetas
const luces = { izq: 'blanca', cen: 'roja', der: 'roja', resultado: -1, tarjetas: { izq: [], cen: ['azul'], der: ['roja', 'xx'] } };
const viv = { ...base, luces, lucesTs: t0 };
e = L.estadoLuces(viv, t0 + 3000);
assert.equal(e.revelado, true); assert.equal(e.resultado, -1);
assert.deepEqual(e.tarjetas.der, ['roja']);
assert.deepEqual(L.textoResultado(e), { texto: 'NULO', clase: 'nulo', rec: '', logrado: false });
assert.equal(L.motivosTarjetas(e, 'S').length, 2);
const CT = await import(new URL('../web/js/nucleo/competencia.js', import.meta.url).href); assert.equal(L.motivosTarjetas(e, 'S')[1].motivo, CT.TARJETAS.roja.S);
// Caduca a los 12 s
assert.equal(L.estadoLuces(viv, t0 + 13000).revelado, false);
// Récord
const rv = { ...viv, actual: { ...actual, rec: true }, resultadoRec: true, luces: { ...luces, resultado: 1, izq: 'blanca', cen: 'blanca', der: 'roja' } };
assert.deepEqual(L.textoResultado(L.estadoLuces(rv, t0 + 1)), { texto: 'VÁLIDO', clase: 'valido', rec: 'RÉCORD', logrado: true });
// Solo resultado (compatibilidad)
e = L.estadoLuces({ actual, lev: 'S', luces: { resultado: 1 }, lucesTs: t0 }, t0 + 1);
assert.deepEqual(e.luces, { izq: 'blanca', cen: 'blanca', der: 'blanca' });
assert.equal(L.estadoLuces(null).revelado, false);

// Modo
assert.equal(L.modoDe({ modo: 'otra' }, { modo: 'IPF' }), 'otra');
assert.equal(L.modoDe(null, { federacion: 'IPF' }), 'IPF');
assert.equal(L.modoDe(null, null), 'otra');

// Pitidos: una sola vez por umbral
const h = new Set();
assert.deepEqual(L.pitidosPendientes(45000, true, h), []);
assert.deepEqual(L.pitidosPendientes(29800, true, h), [30]);
assert.deepEqual(L.pitidosPendientes(29500, true, h), []);
assert.deepEqual(L.pitidosPendientes(9900, true, h), [10]);
assert.deepEqual(L.pitidosPendientes(0, true, h), [0]);
assert.deepEqual(L.pitidosPendientes(0, true, h), []);
// Arranca por debajo: no suena el 30
const h2 = new Set();
assert.deepEqual(L.pitidosPendientes(20000, true, h2), []);
assert.deepEqual(L.pitidosPendientes(9990, true, h2), [10]);
// En pausa no suena
assert.deepEqual(L.pitidosPendientes(29900, false, new Set()), []);
console.log('luces-estado: ok');
