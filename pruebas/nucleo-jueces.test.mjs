// Mesa de jueces: votos con tarjetas, reloj de tarima y fusión del canal (sin red ni navegador).
import assert from 'node:assert/strict';
const base = new URL('../web/js/nucleo/', import.meta.url).href;
const C = await import(`${base}competencia.js`);
const R = await import(`${base}reloj.js`);
const M = await import(new URL("../web/js/canal.js", import.meta.url).href);
const S = await import(`${base}sonidos.js`);

/* normalizarVoto */
assert.deepEqual(C.normalizarVoto('blanca', 'IPF'), { luz: 'blanca', tarjetas: [] });
assert.deepEqual(C.normalizarVoto('roja', 'IPF'), { luz: 'roja', tarjetas: ['roja'] });
assert.deepEqual(C.normalizarVoto('roja', 'otra'), { luz: 'roja', tarjetas: [] });
assert.deepEqual(C.normalizarVoto('roja'), { luz: 'roja', tarjetas: [] }, 'sin modo = strings viejos sin tarjeta');
assert.deepEqual(C.normalizarVoto('azul', 'otra'), { luz: 'roja', tarjetas: ['azul'] });
assert.deepEqual(C.normalizarVoto('amarilla', 'IPF'), { luz: 'roja', tarjetas: ['amarilla'] });
assert.deepEqual(C.normalizarVoto({ voto: 'roja', tarjetas: ['azul', 'verde'] }, 'IPF'), { luz: 'roja', tarjetas: ['azul'] });
assert.deepEqual(C.normalizarVoto({ luz: 'blanca', tarjetas: ['roja'] }, 'IPF'), { luz: 'blanca', tarjetas: [] });
assert.equal(C.normalizarVoto('verde'), null);
assert.equal(C.normalizarVoto(undefined), null);

/* decision con strings (como antes), objetos y modo */
assert.equal(C.decision({ izq: 'blanca', cen: 'blanca', der: 'roja' }), 1);
assert.equal(C.decision({ izq: 'blanca', cen: 'roja', der: 'roja' }), -1);
assert.equal(C.decision({ izq: 'blanca', cen: 'blanca' }), null);
assert.equal(C.decision({}), null);
assert.equal(C.decision(), null);
assert.equal(C.decision({ izq: { voto: 'blanca' }, cen: { luz: 'blanca' }, der: 'azul' }, 'IPF'), 1);
assert.equal(C.decision({ izq: 'amarilla', cen: 'azul', der: 'blanca' }, 'IPF'), -1);
assert.equal(C.decision({ izq: 'blanca', cen: 'blanca', der: 'basura' }), null);

/* tarjetasDe */
assert.deepEqual(C.tarjetasDe({ izq: 'blanca', cen: 'roja', der: 'azul' }, 'IPF'), { izq: [], cen: ['roja'], der: ['azul'] });
assert.deepEqual(C.tarjetasDe({ izq: 'blanca', cen: 'roja' }, 'otra'), { izq: [], cen: [], der: [] });
assert.deepEqual(C.tarjetasDe({ izq: { voto: 'roja', tarjetas: ['roja', 'amarilla'] } }, 'IPF').izq, ['roja', 'amarilla']);

/* turnoDe y tablas */
assert.equal(C.turnoDe({ aid: 'at_1', n: 2 }, 'S'), 'at_1_S_2');
assert.equal(C.turnoDe({ aid: 'at_1', n: 0 }, 'B'), 'at_1_B_0');
assert.equal(C.turnoDe(null, 'S'), null);
assert.equal(C.turnoDe({ aid: 'a' }, 'S'), null);
assert.deepEqual(C.BOTONES, ['blanca', 'roja', 'azul', 'amarilla']);
for (const t of ['roja', 'azul', 'amarilla']) for (const l of ['S', 'B', 'D']) assert.ok(C.TARJETAS[t][l].length > 3 && C.TARJETAS[t][l].length < 60, `${t} ${l}`);
assert.match(C.TARJETAS.roja.S, /profundidad/i);

/* reloj-tarima */
let r = R.relojNuevo(60);
assert.deepEqual(r, { estado: 'listo', hasta: null, restante: 60000, duracion: 60000 });
assert.equal(R.restante(r, 5000), 60000);
const r1 = R.iniciar(r, 1000);
assert.equal(r1.estado, 'corre'); assert.equal(r1.hasta, 61000);
assert.equal(r.estado, 'listo', 'no muta');
assert.equal(R.restante(r1, 11000), 50000);
assert.equal(R.restante(r1, 99999), 0);
assert.equal(R.iniciar(r1, 5000), r1, 'iniciar corriendo no cambia');
const r2 = R.pausar(r1, 21000);
assert.equal(r2.estado, 'pausa'); assert.equal(r2.restante, 40000); assert.equal(r2.hasta, null);
assert.equal(R.restante(r2, 90000), 40000);
assert.equal(R.pausar(r2, 30000), r2);
const r3 = R.iniciar(r2, 30000);
assert.equal(r3.hasta, 70000);
const r4 = R.parar(r3);
assert.deepEqual(r4, { estado: 'listo', hasta: null, restante: 60000, duracion: 60000 });
const r5 = R.fijar(r4, 180);
assert.deepEqual(r5, { estado: 'listo', hasta: null, restante: 180000, duracion: 180000 });
const agotado = R.iniciar({ estado: 'pausa', hasta: null, restante: 0, duracion: 60000 }, 0);
assert.equal(agotado.hasta, 60000, 'sin tiempo reinicia con la duración');
assert.equal(R.texto(60000), '1:00'); assert.equal(R.texto(59001), '1:00'); assert.equal(R.texto(59000), '0:59');
assert.equal(R.texto(0), '0:00'); assert.equal(R.texto(-5), '0:00'); assert.equal(R.texto(180000), '3:00'); assert.equal(R.texto(9000), '0:09');
assert.deepEqual(R.desdeVivo({ reloj: { estado: 'pausa', hasta: null, restante: 12000, duracion: 60000 } }), { estado: 'pausa', hasta: null, restante: 12000, duracion: 60000 });
const viejo = R.desdeVivo({ relojHasta: 50000 }, 20000);
assert.equal(viejo.estado, 'corre'); assert.equal(R.restante(viejo, 20000), 30000);
assert.equal(R.desdeVivo({}).estado, 'listo'); assert.equal(R.desdeVivo(null).restante, 60000);

/* sonidos: sin AudioContext no falla */
S.desbloquear(); S.chicharra(); S.valido(); S.pitido(); S.final();
S.activar(false); assert.equal(S.activo(), false); S.activar(true); assert.equal(S.activo(), true);

/* mesa-canal: fusión por version */
assert.equal(M.fundirVivo(undefined, { version: 1 }).version, 1);
assert.equal(M.fundirVivo({ version: 5, a: 1 }, { version: 3, a: 2 }).a, 1, 'versión menor no pisa');
assert.equal(M.fundirVivo({ version: 5, a: 1 }, { version: 9, a: 2 }).a, 2);
assert.equal(M.fundirVivo({ version: 5, a: 1 }, { version: 5, a: 2 }).a, 1, 'igual versión: se queda el actual');
const m1 = M.fundirMapa({ T1: { version: 4 } }, { T1: { version: 2 }, T2: { version: 1 } });
assert.equal(m1.cambio, true); assert.equal(m1.mapa.T1.version, 4); assert.equal(m1.mapa.T2.version, 1);
assert.equal(M.fundirMapa(m1.mapa, { T1: { version: 4 } }).cambio, false);
assert.equal(M.fundirPresencia({ k: { ts: 5 } }, { k: { ts: 3 } }).cambio, false);
assert.equal(M.fundirPresencia({ k: { ts: 5 } }, { k: { ts: 8 } }).mapa.k.ts, 8);
assert.equal(M.clavePresencia('Tarima 1', 'izq'), 'Tarima_1__izq');

/* deduplicado de votos */
const d = M.crearDedup();
const voto = { plataforma: 'Tarima 1', pos: 'izq', turno: 'a_S_0' };
assert.equal(d.nuevo(voto), true); assert.equal(d.nuevo({ ...voto, voto: 'roja' }), false, 'el primero cuenta');
assert.equal(d.nuevo({ ...voto, turno: 'a_S_1' }), true); assert.equal(d.nuevo({ ...voto, pos: 'cen' }), true);
d.olvidar('Tarima 1'); assert.equal(d.nuevo(voto), true, 'tras limpiar se puede votar de nuevo');

console.log('jueces: todo bien');
