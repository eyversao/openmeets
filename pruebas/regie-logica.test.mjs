// Regie del HUD: secuencia AUTO según el vivo, intervención con caducidad, modo manual, datos de cada escena.
import assert from 'node:assert/strict';
import { escenaAuto, escenaEfectiva, normalizarRegie, datosEscena, logoActual, ultimoRecord, categoriasConTotal, REGIE_INICIAL, DUR_INTERVENCION } from '../web/js/nucleo/regie.js';
import { nuevoAtleta } from '../web/js/nucleo/competencia.js';

const vt = (o = {}) => ({ hayAtleta: true, estado: 'listo', recFase: '', siguientes: [], ...o });
const T0 = 1_000_000;

// --- AUTO: atleta → revelado → récord (si lo logró, 4-12 s tras las luces) → atleta; sin atleta, siguientes; sin nada, oculto
assert.equal(escenaAuto(vt({ estado: 'reloj' }), { lucesTs: 0 }, T0), 'atleta');
assert.equal(escenaAuto(vt({ estado: 'decision' }), { lucesTs: T0 - 5000 }, T0), 'atleta', 'sin récord se queda en el atleta');
assert.equal(escenaAuto(vt({ estado: 'decision', recFase: 'logrado' }), { lucesTs: T0 - 1000 }, T0), 'atleta', 'primero se ven las luces');
assert.equal(escenaAuto(vt({ estado: 'decision', recFase: 'logrado' }), { lucesTs: T0 - 5000 }, T0), 'record');
assert.equal(escenaAuto(vt({ estado: 'decision', recFase: 'logrado' }), { lucesTs: T0 - 13000 }, T0), 'atleta', 'el récord no se queda para siempre');
assert.equal(escenaAuto(vt({ estado: 'decision', recFase: 'no' }), { lucesTs: T0 - 5000 }, T0), 'atleta', 'un récord nulo no se celebra');
assert.equal(escenaAuto(vt({ hayAtleta: false, siguientes: [{ nombre: 'Ana', kg: 100 }] }), null, T0), 'siguientes');
assert.equal(escenaAuto(vt({ hayAtleta: false }), null, T0), 'oculto');

// --- La regie solo interviene: la intervención dura `dur` s desde que llegó; las fijas (dur 0) se quedan
const auto = r => normalizarRegie({ modo: 'auto', ...r });
const v = vt();
assert.equal(escenaEfectiva(auto({}), v, {}, T0, T0), 'atleta');
assert.equal(escenaEfectiva(auto({ escena: 'clasif', dur: DUR_INTERVENCION }), v, {}, T0 + 5000, T0), 'clasif');
assert.equal(escenaEfectiva(auto({ escena: 'clasif', dur: DUR_INTERVENCION }), v, {}, T0 + 16000, T0), 'atleta', 'caduca y vuelve al vivo');
assert.equal(escenaEfectiva(auto({ escena: 'pausa', dur: 0 }), v, {}, T0 + 3_600_000, T0), 'pausa', 'la pausa se queda hasta que se cambie');
assert.equal(escenaEfectiva(auto({ escena: 'oculto' }), v, {}, T0 + 99999, T0), 'oculto');
// --- MANUAL ignora el vivo
const man = r => normalizarRegie({ modo: 'manual', ...r });
assert.equal(escenaEfectiva(man({ escena: 'podio' }), vt({ estado: 'decision', recFase: 'logrado' }), { lucesTs: T0 - 5000 }, T0, T0), 'podio');
assert.equal(escenaEfectiva(man({}), v, {}, T0, T0), 'atleta');
assert.equal(escenaEfectiva(undefined, v, {}, T0, T0), 'atleta');

// --- normalizar: solo campos válidos
const n = normalizarRegie({ modo: 'x', escena: 'hack', cat: 'c'.repeat(500), dur: 9999, patro: { logos: ['a', 3, 'b'], seg: 1 }, extra: 1 });
assert.equal(n.modo, 'auto'); assert.equal(n.escena, ''); assert.equal(n.cat.length, 120); assert.equal(n.dur, 600);
assert.deepEqual(n.patro, { logos: ['a', 'b'], seg: 3 }); assert.ok(!('extra' in n));
assert.deepEqual(normalizarRegie(null), { ...REGIE_INICIAL, patro: { logos: [], seg: 8 } });

// --- datos de escena
const mk = (nombre, sexo, clase, s, b, d, extra = {}) => {
  const a = nuevoAtleta({ nombre, sexo, division: 'Open', clase, peso: 60, ...extra });
  [[s, 'S'], [b, 'B'], [d, 'D']].forEach(([kg, l]) => { a.intentos[l][0] = { kg, r: 1, rec: false, alFinal: false }; });
  return a;
};
const ana = mk('Ana', 'F', '63', 100, 60, 120, { id: 'ana' }), bea = mk('Bea', 'F', '63', 90, 50, 110, { id: 'bea' }), leo = mk('Leo', 'M', '83', 200, 140, 240, { id: 'leo' });
ana.intentos.S[1] = { kg: 105, r: 1, rec: 'nacional', alFinal: false };
const meet = { formula: 'GL', atletas: [ana, bea, leo] };
const sig = datosEscena('siguientes', meet, vt({ hayAtleta: false, siguientes: [{ nombre: 'X', kg: 100 }], levNombre: 'Sentadilla' }), {}, REGIE_INICIAL);
assert.equal(sig.filas[0].nombre, 'X');
assert.equal(datosEscena('siguientes', meet, vt({ siguientes: [] }), {}), null, 'sin siguientes no hay panel vacío');
const cl = datosEscena('clasif', meet, vt(), { actual: { aid: 'bea' } }, REGIE_INICIAL);
assert.equal(cl.sub, 'Open · Mujeres · 63'); assert.deepEqual(cl.filas.map(f => f.nombre), ['Ana', 'Bea'], 'la categoría del atleta en tarima');
const pod = datosEscena('podio', meet, vt(), {}, { ...REGIE_INICIAL, cat: 'Open · Hombres · 83' });
assert.deepEqual(pod.filas.map(f => f.nombre), ['Leo'], 'la categoría elegida');
assert.deepEqual(categoriasConTotal(meet.atletas), ['Open · Hombres · 83', 'Open · Mujeres · 63']);
const mej = datosEscena('mejor', meet, vt(), {}, REGIE_INICIAL);
assert.equal(mej.F.nombre, 'Ana'); assert.equal(mej.M.nombre, 'Leo');
assert.equal(ultimoRecord(meet.atletas).nombre, 'Ana');
assert.equal(datosEscena('record', meet, vt({ hayAtleta: false }), {}, REGIE_INICIAL).etiqueta, 'RÉCORD NACIONAL');
assert.equal(datosEscena('record', meet, vt({ nombre: 'Z', kg: 150, lev: 'D', recFase: 'logrado', recEtiqueta: 'RÉCORD' }), {}, REGIE_INICIAL).nombre, 'Z', 'el del vivo manda');
assert.equal(datosEscena('record', { atletas: [bea] }, vt({ hayAtleta: false }), {}, REGIE_INICIAL), null);
assert.equal(datosEscena('pausa', meet, vt(), {}, { ...REGIE_INICIAL, texto: 'Volvemos en 10 min' }).texto, 'Volvemos en 10 min');
assert.equal(datosEscena('patro', meet, vt(), {}, REGIE_INICIAL), null, 'sin logos no hay escena');
assert.equal(logoActual(['a', 'b', 'c'], 5, 0), 'a'); assert.equal(logoActual(['a', 'b', 'c'], 5, 5000), 'b'); assert.equal(logoActual(['a', 'b', 'c'], 5, 15000), 'a'); assert.equal(logoActual([], 5), null);
console.log('regie-logica: ok');
