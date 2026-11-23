// LiftingCast en vivo: enlace → id, orden de salida y lectura del feed de cambios.
import assert from 'node:assert/strict';
const L = await import(new URL('../web/js/nucleo/liftingcast.js', import.meta.url).href);

assert.equal(L.idDeEnlace('https://liftingcast.com/meets/m2fhnvo8ubi8/results'), 'm2fhnvo8ubi8');
assert.equal(L.idDeEnlace('m2fhnvo8ubi8'), 'm2fhnvo8ubi8');
assert.equal(L.idDeEnlace('https://otra.com/meets/abc'), null);

const lif = (id, name, flight, lot) => ({ _id: id, name, session: 4, flight, lot, platformId: 'p1' });
const att = (lid, lift, n, weight, result) => ({ _id: `a${n}${lift[0]}-${lid}`, lifterId: lid, liftName: lift, attemptNumber: String(n), weight, result });
const docs = {};
[lif('l1', 'Eyver Gomez', 'B', 122), lif('l2', 'Samuel Mira', 'B', 123), lif('l3', 'Otro', 'B', 50), lif('l4', 'Juan Palacio', 'C', 121),
  att('l3', 'squat', 1, 200, 'good'), att('l1', 'squat', 1, 202.5), att('l2', 'squat', 1, 227.5), att('l4', 'squat', 1, 215),
  att('l3', 'squat', 2, 210), att('l1', 'bench', 1, 127.5),
  { _id: 'p1', name: 'MEDALLO', currentAttemptId: 'a1s-l1', clockState: 'started' },
].forEach(d => { docs[d._id] = d; });

const r = L.resumen(docs, ['Eyver Gómez', 'samuel mira', 'Juan Palacio']);
assert.deepEqual(r.enTarima[0].intento, { nombre: 'Eyver Gomez', lev: 'sq', n: 1, kg: 202.5 });
const por = Object.fromEntries(r.atletas.map(a => [a.nombre, a]));
assert.equal(por['Eyver Gomez'].faltan, 0, 'en tarima ahora');
assert.equal(por['Samuel Mira'].faltan, 1, 'mismo flight, más kilos: después de Eyver');
// El flight B termina su 1.ª ronda (Samuel) y su 2.ª (Otro, 210) antes de que salga el flight C.
assert.equal(por['Juan Palacio'].faltan, 3);
assert.deepEqual(por['Samuel Mira'].siguiente, { lev: 'sq', n: 1, kg: 227.5 });
assert.equal(r.atletas.length, 3, 'busca sin tildes ni mayúsculas');
assert.deepEqual(r.siguientes, ['Eyver Gomez', 'Samuel Mira', 'Otro', 'Juan Palacio'], 'próximos en salir, sin repetir');
// Sin nada en tarima (antes de empezar) no se cuenta toda la competencia: «aún no empieza».
const quieto = L.resumen({ ...docs, p1: { _id: 'p1', name: 'MEDALLO' } }, ['Juan Palacio']).atletas[0];
assert.equal(quieto.espera, true);
assert.equal(quieto.faltan, null);
assert.deepEqual(quieto.siguiente, { lev: 'sq', n: 1, kg: 215 });
assert.equal(quieto.vuelo, null, 'nada en tarima: sin punto');
assert.equal(por['Eyver Gomez'].vuelo, 'ahora');

// Punto en vivo: tanda 1 (A, B) en la mañana y tanda 2 (C) en la sesión siguiente.
const tandas = {};
[{ ...lif('l5', 'Ana', 'A', 1) }, { ...lif('l6', 'Eyver Gomez', 'B', 2) }, { ...lif('l7', 'Juan Palacio', 'C', 3), session: 5 },
  att('l5', 'squat', 1, 100), att('l6', 'squat', 1, 202.5), att('l5', 'dead', 1, 150), att('l6', 'dead', 1, 245), att('l7', 'squat', 1, 215),
].forEach(d => { tandas[d._id] = d; });
const vuelos = cur => {
  const r = L.resumen({ ...tandas, p1: { _id: 'p1', name: 'MEDALLO', currentAttemptId: cur } }, ['Eyver Gomez', 'Juan Palacio']);
  return [L.vueloDe(r, 'Eyver Gómez'), L.vueloDe(r, 'juan palacio')];
};
assert.deepEqual(vuelos('a1s-l5'), ['siguiente', null], 'A en sentadilla: B ya está en vivo, C no');
assert.deepEqual(vuelos('a1s-l6'), ['ahora', null]);
assert.deepEqual(vuelos('a1d-l6'), ['ahora', 'siguiente'], 'peso muerto del B: C ya está en vivo');


// Jueces, luces con pre-marcado, tarjetas, jurado, discos, rack y ritmo.
const juez = (k, decision, cards = null) => ({ _id: `r${k}-p1`, platformId: 'p1', position: k, decision, cards });
const base = { ...docs, p1: { _id: 'p1', name: 'MEDALLO', currentAttemptId: 'a1s-l1', clockState: 'started', clockTimerLength: 60000, barAndCollarsWeight: 25 } };
const con = (...js) => ({ ...base, ...Object.fromEntries(js.map(j => [j._id, j])) });
const luces = (...js) => L.resumen(con(...js), []).enTarima[0].luces;
let lz = luces(juez('left', null), juez('head', null), juez('right', null));
assert.deepEqual(lz.votados, { izq: false, cen: false, der: false });
assert.equal(lz.revelado, false);
lz = luces(juez('left', 'good'), juez('head', null), juez('right', 'bad', { red: true }));
assert.deepEqual(lz.votados, { izq: true, cen: false, der: true });
assert.equal(lz.revelado, false);
assert.deepEqual([lz.izq, lz.cen, lz.der], [null, null, null], 'sin los 3 votos no se revela ningún color');
assert.deepEqual(lz.tarjetas, { izq: [], cen: [], der: [] });
lz = luces(juez('left', 'good'), juez('head', 'bad', { red: false, blue: true }), juez('right', 'bad', { red: true, yellow: true }));
assert.equal(lz.revelado, true);
assert.deepEqual([lz.izq, lz.cen, lz.der], ['blanca', 'roja', 'roja']);
assert.deepEqual(lz.tarjetas, { izq: [], cen: ['azul'], der: ['roja', 'amarilla'] });
assert.equal(L.resumen(base, []).enTarima[0].luces.revelado, false, 'sin documentos de jueces');
assert.equal(L.resumen(base, []).enTarima[0].relojMs, 60000);
assert.equal(L.motivoTarjeta('sq', 'roja'), 'Sin profundidad o pies movidos');
assert.equal(L.motivoTarjeta('sq', 'verde'), null);

// Intento ya decidido: los 3 jueces, tarjetas y jurado.
const decidido = { ...docs['a1s-l1'], result: 'bad', decisions: { left: { decision: 'good', cards: null }, head: { decision: 'bad', cards: { red: true } }, right: { decision: 'bad', cards: { blue: true, red: false } } }, juryOverride: { decision: 'good' } };
const ra = L.resumen({ ...base, [decidido._id]: decidido, 'a1d-l1': { _id: 'a1d-l1', lifterId: 'l1', liftName: 'dead', attemptNumber: '1', weight: 200 } }, ['Eyver Gomez']).atletas[0].lev;
assert.deepEqual(ra.sq[0].jueces, [{ luz: 'blanca', tarjetas: [] }, { luz: 'roja', tarjetas: ['roja'] }, { luz: 'roja', tarjetas: ['azul'] }]);
assert.equal(ra.sq[0].jurado, true);
assert.equal(ra.dl[0].jueces, null, 'sin decisiones: sin puntos');
assert.equal(ra.dl[0].jurado, false);

// Discos por lado con los pares de la competencia, rack y estimado.
const comp = { _id: 'm1', federation: 'IPF', plates: { plate_25: { pairsCount: 2, weight: 25, color: '#c00' }, plate_20: { pairsCount: 0, weight: 20 }, plate_5: { pairsCount: 1, weight: 5, color: '#fff' }, plate_1_25: { pairsCount: 1, weight: 1.25 } } };
const rc = L.resumen({ ...base, m1: comp, l1: { ...docs.l1, squatRackHeight: '16', benchRackHeight: '10/3' } }, ['Eyver Gomez']);
assert.equal(rc.competencia.federacion, 'IPF');
assert.deepEqual(rc.competencia.platos.map(x => x.kg), [25, 5, 1.25], 'solo los discos que hay');
assert.deepEqual(L.discosPorLado(185, rc.competencia, 25).discos.map(x => x.kg), [25, 25, 5, 1.25], '80 por lado: usa todos los discos que hay');
assert.equal(L.discosPorLado(185, rc.competencia, 25).falta, 23.75, 'lo que no alcanzan los discos');
assert.deepEqual(L.discosPorLado(85, rc.competencia, 25).discos.map(x => x.kg), [25, 5], '30 por lado');
assert.equal(L.discosPorLado(10, rc.competencia, 25), null, 'menos que la barra');
assert.deepEqual(rc.atletas[0].rack, { sq: '16', bp: '10/3' });
assert.equal(rc.atletas[0].estimadoSeg, 0, 'en tarima: 0 s');
const sam = L.resumen(base, ['Samuel Mira']).atletas[0];
assert.equal(sam.estimadoSeg, 60, '1 intento × 60 s por defecto');
assert.equal(L.resumen(base, ['Samuel Mira'], { segPorIntento: { p1: 90 } }).atletas[0].estimadoSeg, 90, 'con el ritmo medido');

// Feed: lee todo, recibe un cambio (el 1.º de Eyver vale) y corta.
let llamadas = 0;
const cambios = [];
const fetchFn = async url => {
  llamadas++;
  if (url.includes('_all_docs')) return { json: async () => ({ update_seq: '1', rows: Object.values(docs).map(d => ({ id: d._id, doc: d })) }) };
  if (llamadas === 2) return { json: async () => ({ last_seq: '2', results: [{ id: 'a1s-l1', doc: { ...docs['a1s-l1'], result: 'good' } }] }) };
  await new Promise(r => setTimeout(r, 50));
  return { json: async () => ({ last_seq: '2', results: [] }) };
};
const cortar = L.conectar('m2fhnvo8ubi8', ['Eyver Gomez'], x => cambios.push(x), { fetchFn });
await new Promise(r => setTimeout(r, 30));
cortar();
assert.equal(cambios.length, 2, 'una vez al leer y otra con el cambio');
assert.equal(cambios[1].atletas[0].lev.sq[0].r, 1);
console.log('OK  liftingcast: enlace, orden de salida y feed');
