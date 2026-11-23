// Competencia: marca personal, récords del meet, puntos de equipo, anillo y atleta con el modelo de OpenMeets.
import assert from 'node:assert/strict';
const C = await import(new URL('../web/js/nucleo/competencia.js', import.meta.url).href);
const intento = (kg, r) => ({ kg, r, rec: false, alFinal: false });
const atleta = (nombre, S, B, D, o = {}) => C.nuevoAtleta({ nombre, intentos: { S: S.map(([k, r]) => intento(k, r)), B: B.map(([k, r]) => intento(k, r)), D: D.map(([k, r]) => intento(k, r)) }, ...o });

// nuevoAtleta / peso y equipamiento
const a0 = C.nuevoAtleta({ nombre: 'Ana', sexo: 'F', peso: 62.4 });
assert.equal(a0.equipamiento, 'raw'); assert.equal(a0.peso, 62.4); assert.equal(C.pesoDe({ bw: 80 }), 80, 'acepta bw viejo');
assert.equal(C.claseDe('F', 62.4), '-63');

// total, puntos
const ana = atleta('Ana Díaz', [[100, 1], [105, 1], [110, -1]], [[50, 1], [55, -1], [55, -1]], [[120, 1], [130, 1], [135, -1]], { sexo: 'F', peso: 62.4, club: 'Norte', division: 'Open' });
assert.equal(C.total(ana), 105 + 50 + 130);
assert.ok(C.puntos(ana, 'GL') > 0 && C.puntos(ana, 'DOTS') > 0 && C.puntos(ana, 'IPF') === C.puntos(ana, 'GL'));
const quemada = atleta('Q', [[100, -1], [100, -1], [100, -1]], [[50, 1], [0, null], [0, null]], [[100, 1], [0, null], [0, null]]);
assert.equal(C.total(quemada), 0);

// marcaPersonal
const meets = [
  { id: 'm1', nombre: 'Copa A', fecha: '2026-03-01', atletas: [atleta('ANA DIAZ', [[95, 1]], [[45, 1]], [[110, 1]]), atleta('Otro', [[200, 1]], [[100, 1]], [[250, 1]])] },
  { id: 'm2', nombre: 'Copa B', fecha: '2026-06-01', atletas: [atleta('Ana  Díaz', [[100, 1]], [[50, 1]], [[125, 1]])] },
];
const pb = C.marcaPersonal('ana diaz', meets);
assert.equal(pb.S, 100); assert.equal(pb.B, 50); assert.equal(pb.D, 125); assert.equal(pb.total, 275); assert.equal(pb.meets, 2); assert.equal(pb.meetTotal, 'Copa B');
assert.equal(C.marcaPersonal('Nadie', meets), null); assert.equal(C.marcaPersonal('', meets), null);
assert.equal(C.normalizarNombre('  José  PÉREZ '), 'jose perez');
assert.ok(C.superaMarca(pb, 'S', 102.5) && !C.superaMarca(pb, 'S', 100) && !C.superaMarca(null, 'S', 300));

// recordsDelMeet
const lista = [
  ana,
  atleta('Bea', [[90, 1]], [[60, 1]], [[100, 1]], { sexo: 'F', peso: 61, club: 'Sur' }),
  atleta('Juan', [[200, 1]], [[120, 1]], [[240, 1]], { sexo: 'M', peso: 82, club: 'Norte' }),
];
const rec = C.recordsDelMeet(lista);
const f63 = rec.find(r => r.sexo === 'F' && r.clase === '-63' && r.division === 'Open');
assert.equal(f63.S.nombre, 'Ana Díaz'); assert.equal(f63.B.nombre, 'Bea'); assert.equal(f63.D.kg, 130); assert.equal(f63.total.kg, 285);
assert.equal(rec.length, 2);

// puntosEquipo: 12-9-8-... por categoría
const mk = (n, kg, club, peso = 80) => atleta(n, [[kg, 1]], [[kg / 2, 1]], [[kg, 1]], { sexo: 'M', peso, club });
const eq = C.puntosEquipo([mk('a', 200, 'X'), mk('b', 190, 'Y'), mk('c', 180, 'X'), mk('d', 170, ''), mk('e', 0, 'Z'), mk('f', 150, 'Z', 100)]);
const x = eq.find(e => e.club === 'X'), y = eq.find(e => e.club === 'Y');
assert.equal(x.puntos, 12 + 8); assert.equal(y.puntos, 9); assert.equal(eq[0].club, 'X');
assert.equal(eq.find(e => e.club === 'Z').puntos, 12, 'Z gana su categoría de -105; el de 0 no puntúa');
assert.ok(!eq.some(e => e.club === ''), 'sin club no cuenta');
const once = Array.from({ length: 11 }, (_, i) => mk('n' + i, 100 + i * 5, 'C' + i));
assert.equal(C.puntosEquipo(once).length, 10, 'solo los diez primeros puntúan');

// anilloAtleta
const ring = C.anilloAtleta(ana);
assert.equal(ring.length, 9);
assert.deepEqual(ring.slice(0, 3).map(s => s.estado), ['ok', 'ok', 'mal']);
assert.deepEqual(ring.slice(3, 6).map(s => s.estado), ['ok', 'mal', 'mal']);
const nuevo = C.nuevoAtleta({ nombre: 'N' }); nuevo.intentos.S[0].kg = 100;
assert.deepEqual(C.anilloAtleta(nuevo).slice(0, 2).map(s => s.estado), ['pendiente', 'vacio']);
assert.deepEqual(C.anilloAtleta(nuevo)[4], { lev: 'B', n: 1, estado: 'vacio' });

// CSV con el modelo nuevo
const leidos = C.leerCSV(C.plantillaCSV());
assert.equal(leidos.length, 1); assert.equal(leidos[0].peso, 62.4); assert.equal(leidos[0].equipamiento, 'raw'); assert.equal(leidos[0].intentos.S[0].kg, 120); assert.equal(leidos[0].clase, '-63');
assert.match(C.resultadosCSV(lista), /Ana Díaz/);

// cola
const q = C.cola([ana, atleta('Z', [[100, null]], [[0, null]], [[0, null]])], 'S');
assert.equal(q.orden[0].a.nombre, 'Z');
console.log('competencia: todo bien');

// Pico y final: quién terminó, su tarjeta final y el resumen del meet
{
  const I = (kg, r = null) => ({ kg, r });
  const nueve = r => ({ S: [I(100, r), I(110, r), I(120, r)], B: [I(60, r), I(65, r), I(70, r)], D: [I(120, r), I(130, r), I(140, r)] });
  const A = { id: 'a', nombre: 'Ana', sexo: 'F', club: 'X', division: 'Open', clase: '63', peso: 62, intentos: nueve(1) };
  const B = { id: 'b', nombre: 'Bea', sexo: 'F', club: 'X', division: 'Open', clase: '63', peso: 62, intentos: { ...nueve(1), D: [I(100, 1), I(110), I(120)] } };
  assert.equal(C.atletaTermino(A), true);
  assert.equal(C.atletaTermino(B), false, 'con intentos pendientes no terminó');
  assert.equal(C.atletaTermino({ ...A, intentos: { S: [I(100, 1), I(0), I(0)], B: [I(60, 1), I(0), I(0)], D: [I(120, 1), I(0), I(0)] } }), true, 'los pases (0 kg) cuentan');
  assert.equal(C.atletaTermino({ ...A, intentos: { S: [I(100, 1), I(null), I(null)], B: [], D: [] } }), false, 'sin declarar no terminó');
  const tf = C.tarjetaFinal(A, [A, B], 'GL');
  assert.equal(tf.total, 330); assert.equal(tf.puesto, 1); assert.equal(tf.de, 2); assert.equal(tf.records.total, true);
  const r = C.resumenMeet([A, B], 'GL');
  assert.deepEqual([r.atletas, r.intentos, r.pct], [2, 16, 100]);
  assert.equal(r.podios[0].filas.length, 2); assert.equal(r.mejores.F.a.id, 'a'); assert.equal(r.mejores.M, null); assert.equal(r.equipo.club, 'X');
}

// Récord por nivel: etiqueta, compatibilidad con `true` y valores no válidos
assert.deepEqual(['mundial', 'nacional', 'ibero', 'regional'].map(n => C.etiquetaRecord(n)), ['RÉCORD MUNDIAL', 'RÉCORD NACIONAL', 'RÉCORD IBEROAMERICANO', 'RÉCORD REGIONAL']);
assert.equal(C.etiquetaRecord(true), 'RÉCORD'); assert.equal(C.etiquetaRecord(false), ''); assert.equal(C.etiquetaRecord('xx'), '');
assert.equal(C.etiquetaRecord('otro', ' Récord Panamericano '), 'RÉCORD PANAMERICANO'); assert.equal(C.etiquetaRecord('otro', ''), 'RÉCORD');
assert.equal(C.etiquetaRecord('otro', 'x'.repeat(60)).length, C.MAX_REC_TEXTO);
assert.equal(C.recValido(true), true); assert.equal(C.recValido('ibero'), 'ibero'); assert.equal(C.recValido('galáctico'), false); assert.equal(C.recValido(undefined), false);
