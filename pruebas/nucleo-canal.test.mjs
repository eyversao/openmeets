// Canal: fusión, meet en vivo por SSE, votos con cola sin red y estado de conexión (con dependencias falsas).
import assert from 'node:assert/strict';
const M = await import(new URL('../web/js/canal.js', import.meta.url).href);
const pausa = (ms = 15) => new Promise(ok => setTimeout(ok, ms));

assert.equal(M.fundirVivo({ version: 5, a: 1 }, { version: 3, a: 2 }).a, 1);
assert.equal(M.fundirVivo({ version: 5, a: 1 }, { version: 9, a: 2 }).a, 2);
assert.equal(M.fundirVivo({ version: 5, a: 1 }, { version: 5, a: 2 }).a, 1);
const m1 = M.fundirMapa({ T1: { version: 4 } }, { T1: { version: 2 }, T2: { version: 1 } });
assert.equal(m1.cambio, true); assert.equal(m1.mapa.T1.version, 4); assert.equal(m1.mapa.T2.version, 1);
assert.equal(M.fundirPresencia({ k: { ts: 5 } }, { k: { ts: 3 } }).cambio, false);
assert.equal(M.clavePresencia('Tarima 1', 'izq'), 'Tarima_1__izq');
assert.equal(M.clavePresencia('Tarima 1', 'izq', 'd-1'), 'Tarima_1__izq__d-1');
assert.deepEqual([0, 1, 2, 3, 4, 5].map(i => M.esperaReconexion(i)), [1000, 2000, 4000, 8000, 15000, 15000]);
const d = M.crearDedup(); const v0 = { plataforma: 'T', pos: 'izq', turno: 't' };
assert.ok(d.nuevo(v0) && !d.nuevo(v0)); d.olvidar('T'); assert.ok(d.nuevo(v0));

// aplicarAlMeet
let m = M.aplicarAlMeet(null, { tipo: 'meet', meet: { id: 'x', atletas: [{ id: 'a1', nombre: 'A' }] } });
m = M.aplicarAlMeet(m, { tipo: 'atleta', atleta: { id: 'a2', nombre: 'B' } });
m = M.aplicarAlMeet(m, { tipo: 'atleta', atleta: { id: 'a1', nombre: 'A2' } });
m = M.aplicarAlMeet(m, { tipo: 'meet-cambio', campos: { nombre: 'Copa' } });
m = M.aplicarAlMeet(m, { tipo: 'aplauso', aid: 'a1', n: 3 });
m = M.aplicarAlMeet(m, { tipo: 'vivo', plataforma: 'T1', datos: { version: 2 } });
assert.equal(m.atletas.length, 2); assert.equal(m.atletas[0].nombre, 'A2'); assert.equal(m.nombre, 'Copa'); assert.equal(m.aplausos.a1, 3); assert.equal(m.vivo.T1.version, 2);

// SSE y BroadcastChannel falsos
const bcs = [];
class BCFalso { constructor(n) { this.n = n; bcs.push(this); } postMessage(x) { bcs.filter(b => b !== this && b.n === this.n).forEach(b => b.onmessage?.({ data: JSON.parse(JSON.stringify(x)) })); } close() {} }
const ess = [];
class ESFalso { constructor(url) { this.url = url; ess.push(this); } close() { this.cerrado = true; } emitir(o) { this.onmessage?.({ data: JSON.stringify(o) }); } }
const almacen = () => { const mm = new Map(); return { getItem: k => mm.get(k) ?? null, setItem: (k, v) => mm.set(k, String(v)) }; };
let red = true; const posts = [];
const fetchFalso = async (url, o) => { if (!red) throw new Error('sin red'); posts.push([url, JSON.parse(o.body)]); return { ok: true, status: 200 }; };
const comun = { BroadcastChannel: BCFalso, EventSource: ESFalso, fetch: fetchFalso, espera: [5, 20] };
const almJuez = almacen();

const mesa = M.abrirCanal('m1', { rol: 'mesa', base: 'http://x', deps: { ...comun, almacen: almacen() } });
const pantalla = M.abrirCanal('m1', { rol: 'pantalla', base: 'http://x', deps: { ...comun, almacen: almacen() } });
assert.equal(ess[0].url, 'http://x/api/meets/m1/canal');
assert.equal(mesa.estado(), 'reconectando');
const estados = []; mesa.alEstado(e => estados.push(e));
ess[0].onopen(); assert.equal(mesa.estado(), 'conectado');

const meets = []; mesa.escucharMeet(x => meets.push(x));
ess[0].emitir({ tipo: 'meet', meet: { id: 'm1', atletas: [] } });
ess[0].emitir({ tipo: 'atleta', atleta: { id: 'a1' } });
assert.equal(meets.at(-1).atletas.length, 1);
const aplausos = []; mesa.escucharAplausos(x => aplausos.push(x)); ess[0].emitir({ tipo: 'aplauso', aid: 'a1', n: 2 });
assert.deepEqual(aplausos, [{ aid: 'a1', n: 2 }]);

// vivo: mesa -> pantalla por BroadcastChannel y al servidor
const vistos = []; pantalla.escucharVivo(x => vistos.push(x));
const pub = mesa.publicarVivo('T1', { turno: 'a_S_0' });
await pausa();
assert.equal(vistos.at(-1).T1.version, pub.version);
assert.ok(posts.some(([, b]) => b.tipo === 'vivo' && b.plataforma === 'T1'));

// votos: el servidor los manda al organizador, una sola vez
const recibidos = []; mesa.escucharVotos(x => recibidos.push(x));
const vt = { plataforma: 'T1', pos: 'izq', voto: 'blanca', turno: 'a_S_0' };
ess[0].emitir({ tipo: 'voto', voto: vt }); ess[0].emitir({ tipo: 'voto', voto: vt });
assert.equal(recibidos.length, 1);

// juez sin red: cola, y se reenvía sola al volver
const juez = M.abrirCanal('m1', { rol: 'juez', codigo: '123456', base: 'http://x', deps: { ...comun, almacen: almJuez } });
red = false; posts.length = 0;
const r1 = await juez.enviarVoto({ plataforma: 'T1', pos: 'cen', voto: 'roja', turno: 'a_S_0', dispositivo: 'd1' });
assert.deepEqual([r1.ok, r1.enCola], [false, true]); assert.equal(juez.votosEnCola(), 1);
await pausa(30); assert.equal(juez.votosEnCola(), 1, 'sigue en cola mientras no hay red');
red = true; await pausa(80);
assert.equal(juez.votosEnCola(), 0, 'se envió sola');
const enviado = posts.find(([, b]) => b.tipo === 'voto');
assert.equal(enviado[1].codigo, '123456'); assert.equal(enviado[1].voto.pos, 'cen');
const r2 = await juez.enviarVoto({ plataforma: 'T1', pos: 'cen', voto: 'blanca', turno: 'a_S_1', dispositivo: 'd1' });
assert.deepEqual([r2.ok, r2.via], [true, 'servidor']);

// la cola sobrevive a recargar la página
red = false;
await juez.enviarVoto({ plataforma: 'T1', pos: 'cen', voto: 'roja', turno: 'a_S_2', dispositivo: 'd1' });
juez.cerrar();
const juez2 = M.abrirCanal('m1', { rol: 'juez', base: 'http://x', deps: { ...comun, almacen: almJuez } });
assert.equal(juez2.votosEnCola(), 1, 'cola persistente');

// caída del SSE: reconecta con espera creciente
const n0 = ess.length;
ess[0].onerror(); assert.notEqual(mesa.estado(), 'conectado');
await pausa(40); assert.ok(ess.length > n0, 'volvió a abrir el SSE');
ess.at(-1).onopen(); assert.equal(mesa.estado(), 'conectado');
assert.ok(estados.includes('reconectando'));
[mesa, pantalla, juez2].forEach(c => c.cerrar());
console.log('canal: todo bien');
