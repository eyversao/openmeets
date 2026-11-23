// Datos de la pantalla de tarima y el HUD: plataforma, discos del meet, vista, sonidos y parámetros.
import assert from 'node:assert/strict';
const D = await import(new URL('../web/js/vistas/pantalla-datos.js', import.meta.url).href);

// Plataforma: la pedida, si no la que tiene atleta, si no la primera
const meet = { plataformas: ['Tarima 1', 'Tarima 2'], barra: 20, collar: 2.5, atletas: [{ id: 'a1', nombre: 'Ana', club: 'Club Sur', division: 'Open', sexo: 'F', clase: '63', rack: { S: 12 } }] };
assert.equal(D.plataformaElegida(meet, {}, 'Tarima 2'), 'Tarima 2');
assert.equal(D.plataformaElegida(meet, { 'Tarima 2': { actual: { aid: 'a1' } } }, 'No existe'), 'Tarima 2');
assert.equal(D.plataformaElegida(meet, {}, ''), 'Tarima 1');
assert.equal(D.plataformaElegida(null, {}, ''), '');

// Discos: estándar y con los del meet (pares limitados)
assert.deepEqual(D.cargaDiscos(142.5, meet, 'S').discos, [25, 25, 5, 2.5, 1.25]);
assert.deepEqual(D.cargaDiscos(100, meet, 'S').discos, [25, 10, 2.5]);
const limitado = { ...meet, discos: [{ kg: 25, pares: 1 }, { kg: 10, pares: 4 }, { kg: 5, pares: 2 }] };
assert.deepEqual(D.cargaDiscos(180, limitado, 'S').discos, [25, 10, 10, 10, 10, 5, 5]);
assert.deepEqual(D.cargaDiscos(140, limitado, 'S').discos, [25, 10, 10, 10]);
assert.equal(D.cargaDiscos(140, limitado, 'S').sobra, 5);
assert.equal(D.cargaDiscos(20, meet, 'S').discos.length, 0);
assert.equal(D.cargaDiscos(100, { ...meet, barraSentadilla: 25 }, 'S').barra, 25);
assert.equal(D.cargaDiscos(100, { ...meet, barraSentadilla: 25 }, 'B').barra, 20);

// Vista: atleta con club y categoría del meet
const t0 = 1_700_000_000_000;
const vivo = { lev: 'S', sesion: 1, grupo: 'A', actual: { aid: 'a1', nombre: 'Ana', kg: 100, n: 1 }, turno: 'a1_S_1', modo: 'IPF', votados: { izq: true, cen: false, der: false }, siguientes: [{ nombre: 'Bea', kg: 90, n: 0 }] };
let v = D.vistaTarima(meet, vivo, t0);
assert.equal(v.nombre, 'Ana'); assert.equal(v.club, 'Club Sur'); assert.equal(v.categoria, 'Open · Mujeres · 63 kg');
assert.equal(v.intento, 2); assert.equal(v.rack, 12); assert.equal(v.tanda, '1A'); assert.equal(v.estado, 'listo');
assert.equal(v.est.votados.izq, true); assert.equal(v.est.revelado, false); assert.equal(v.resultado, null);
assert.equal(v.siguientes.length, 1);

// Revelado: tarjetas, resultado y récord; las luces caducan a los 12 s
const rev = { ...vivo, luces: { izq: 'blanca', cen: 'roja', der: 'roja', resultado: -1, tarjetas: { izq: [], cen: ['azul'], der: ['roja'] } }, lucesTs: t0, actual: { ...vivo.actual, rec: true }, resultadoRec: false };
v = D.vistaTarima(meet, rev, t0 + 2000);
assert.equal(v.estado, 'decision'); assert.equal(v.resultado.texto, 'NULO'); assert.equal(v.resultado.rec, 'No récord');
assert.equal(v.motivos.length, 2);
assert.equal(D.vistaTarima(meet, rev, t0 + 20000).estado, 'listo');

// Sin vivo ni meet: en espera
v = D.vistaTarima(null, null, t0);
assert.equal(v.estado, 'espera'); assert.equal(v.hayAtleta, false);

// Sonidos: el nulo suena una sola vez; un sonido viejo (al abrir la pantalla) no suena
const toques = [];
const rev1 = D.crearRevisorSonidos({ chicharra: () => toques.push('chicharra'), valido: () => toques.push('valido'), pitido: () => toques.push('pitido'), final: () => toques.push('final') });
const sn = { ...vivo, sonido: { tipo: 'nulo', ts: t0 } };
rev1(sn, t0 + 500); rev1(sn, t0 + 800);
assert.deepEqual(toques, ['chicharra']);
rev1({ ...vivo, sonido: { tipo: 'valido', ts: t0 + 9000 } }, t0 + 9100);
assert.deepEqual(toques, ['chicharra', 'valido']);
const toques2 = [];
const rev2 = D.crearRevisorSonidos({ chicharra: () => toques2.push('c'), valido: () => toques2.push('v'), pitido: () => toques2.push('p'), final: () => toques2.push('f') });
rev2({ ...vivo, sonido: { tipo: 'nulo', ts: t0 - 60000 } }, t0);
assert.deepEqual(toques2, []);

// HUD: parámetros por query
assert.deepEqual(D.parametrosHud('t=Tarima%201&pos=arriba&escala=1,5&sonido=1'), { plataforma: 'Tarima 1', pos: 'arriba', escala: 1.5, sonido: true });
assert.deepEqual(D.parametrosHud(''), { plataforma: '', pos: 'abajo', escala: 1, sonido: false });
assert.equal(D.parametrosHud('escala=99').escala, 2);
console.log('pantalla-datos: ok');

// Pico y final de la tarima: espera útil, grupo terminado y meet terminado
{
  const I = (kg, r = null) => ({ kg, r });
  const nueve = r => ({ S: [I(100, r), I(110, r), I(120, r)], B: [I(60, r), I(65, r), I(70, r)], D: [I(120, r), I(130, r), I(140, r)] });
  const at = (id, grupo, r) => ({ id, nombre: id, sexo: 'M', club: 'C', division: 'Open', clase: '83', peso: 80, plataforma: 'T1', sesion: '1', grupo, intentos: nueve(r) });
  const a = at('a', 'A', 1), b = at('b', 'B', null);
  assert.equal(D.momentoTarima(null, null).tipo, 'carga');
  assert.equal(D.momentoTarima({ atletas: [a, b] }, { actual: { aid: 'a' } }, 'T1').tipo, 'atleta');
  const g = D.momentoTarima({ atletas: [a, b] }, { grupo: 'A', sesion: '1', siguientes: [] }, 'T1');
  assert.equal(g.tipo, 'grupo'); assert.equal(g.mejores[0].nombre, 'a');
  const e = D.momentoTarima({ atletas: [a, b] }, { grupo: 'B', sesion: '1', siguientes: [{ nombre: 'b', kg: 100 }] }, 'T1');
  assert.equal(e.tipo, 'espera'); assert.equal(e.siguientes[0].nombre, 'b');
  assert.equal(D.momentoTarima({ atletas: [a, at('c', 'A', 1)] }, null, 'T1').tipo, 'meet', 'todos terminaron');
  assert.equal(D.momentoTarima({ atletas: [a, b], cerrado: true }, { actual: { aid: 'b' } }, 'T1').tipo, 'meet', 'cerrado manda');
  assert.equal(D.momentoTarima({ atletas: [] }, null, 'T1').tipo, 'espera', 'sin atletas, espera');
}

// Durante el revelado la tarima muestra a quien se juzgó, no al siguiente que ya está en `actual`.
{
  const { vistaTarima: vt2 } = await import('../web/js/vistas/pantalla-datos.js');
  const ahora = Date.now();
  const vivo = { lev: 'B', actual: { aid: 'b', nombre: 'Siguiente', kg: 72.5, n: 2 }, juzgado: { aid: 'a', nombre: 'Juzgada', kg: 65, n: 2, rec: true },
    luces: { izq: 1, cen: 1, der: -1, resultado: 1, tarjetas: { izq: [], cen: [], der: ['azul'] } }, lucesTs: ahora - 1000, resultadoRec: true };
  const r = vt2({ atletas: [] }, vivo, ahora);
  if (r.nombre !== 'Juzgada' || r.kg !== 65 || r.est.rec !== true) throw new Error('el revelado debe mostrar a la atleta juzgada y su récord');
  const tarde = vt2({ atletas: [] }, vivo, ahora + 20000);
  if (tarde.nombre !== 'Siguiente') throw new Error('tras el revelado vuelve el atleta actual');
  console.log('OK  revelado muestra a quien se juzgó');
}

// Récord por nivel en la tarima: aviso antes de levantar, celebración si es válido, «no» si es nulo; `true` = RÉCORD
{
  const ahora = 1e12, mt = { atletas: [] };
  const luces = (res, rec) => ({ luces: { izq: res, cen: res, der: res, resultado: res === 'blanca' ? 1 : -1, tarjetas: { izq: [], cen: [], der: [] } }, lucesTs: ahora - 1000, resultadoRec: rec });
  const base = { lev: 'S', actual: { aid: 'a', nombre: 'Ana', kg: 100, n: 0, rec: 'mundial' } };
  const antes = D.vistaTarima(mt, base, ahora);
  assert.deepEqual([antes.rec, antes.recNivel, antes.recEtiqueta, antes.recFase], [true, 'mundial', 'RÉCORD MUNDIAL', 'aviso']);
  const ok = D.vistaTarima(mt, { ...base, juzgado: base.actual, ...luces('blanca', true) }, ahora);
  assert.deepEqual([ok.recEtiqueta, ok.recFase], ['RÉCORD MUNDIAL', 'logrado']);
  const no = D.vistaTarima(mt, { ...base, juzgado: base.actual, ...luces('roja', false) }, ahora);
  assert.equal(no.recFase, 'no'); assert.equal(no.recEtiqueta, 'RÉCORD MUNDIAL');
  const otro = D.vistaTarima(mt, { ...base, actual: { ...base.actual, rec: 'otro', recTexto: 'Récord departamental' } }, ahora);
  assert.deepEqual([otro.recNivel, otro.recEtiqueta], ['otro', 'RÉCORD DEPARTAMENTAL']);
  const viejo = D.vistaTarima(mt, { ...base, actual: { ...base.actual, rec: true } }, ahora);
  assert.deepEqual([viejo.rec, viejo.recNivel, viejo.recEtiqueta, viejo.recFase], [true, '', 'RÉCORD', 'aviso']);
  const sin = D.vistaTarima(mt, { ...base, actual: { ...base.actual, rec: false } }, ahora);
  assert.deepEqual([sin.rec, sin.recEtiqueta, sin.recFase], [false, '', '']);
  console.log('OK  récord por nivel en la tarima');
}
