// Récords y perfiles (lógica pura): recordsQueSupera, registro automático con historial, CSV ida y vuelta, agrupación y fusión de fichas.
import assert from 'node:assert/strict';
import * as R from '../web/js/nucleo/records.js';
import * as P from '../web/js/nucleo/perfiles.js';
import { nuevoAtleta, total, mejor } from '../web/js/nucleo/competencia.js';

const rec = (o = {}) => R.normalizarRecord({ federacion: 'IPF', nivel: 'nacional', sexo: 'M', division: 'Open', equipamiento: 'raw', clase: '-83', lev: 'S', kg: 200, atleta: 'Juan Récord', fecha: '2024-05-01', meet: 'Nacional 2024', ...o }).record;
const atleta = (o = {}) => nuevoAtleta({ id: 'a1', nombre: 'Pedro Pérez', sexo: 'M', clase: '-83', peso: 82, ...o });
const poner = (a, lev, n, kg, r = null) => { a.intentos[lev][n] = { kg, r, rec: false, alFinal: false }; return a; };
const clon = x => JSON.parse(JSON.stringify(x));
const meet = { id: 'm1', nombre: 'Copa', federacion: 'IPF', fecha: '2026-03-01', sede: 'Coliseo', ciudad: 'Cali', barra: 20, barraSentadilla: 25 };

// --- validación
assert.equal(R.normalizarRecord({}).ok, false);
assert.match(R.normalizarRecord({ federacion: 'IPF', nivel: 'galáctico', sexo: 'M', lev: 'S', kg: 1, atleta: 'x' }).error, /nivel/);
assert.match(R.normalizarRecord({ federacion: 'IPF', nivel: 'otro', sexo: 'M', lev: 'S', kg: 1, atleta: 'x' }).error, /nivel/);
assert.equal(R.normalizarRecord({ federacion: 'IPF', nivel: 'nacional', sexo: 'M', lev: 'S', kg: '-5', atleta: 'x' }).ok, false);
assert.equal(R.normalizarRecord({ federacion: 'IPF', nivel: 'nacional', sexo: 'M', lev: 'S', kg: 100, atleta: 'x', fecha: 'ayer' }).ok, false);
const lib = R.normalizarRecord({ federacion: 'IPF', nivel: 'otro', nivelTexto: 'Panamericano', sexo: 'Mujer', lev: 'Peso muerto', kg: '182,5', atleta: 'Ana', equipamiento: 'Equipado' }).record;
assert.deepEqual([lib.sexo, lib.lev, lib.kg, lib.equipamiento, lib.division, lib.homologado], ['F', 'D', 182.5, 'equipado', 'Open', true]);

// --- recordsQueSupera: empates no cuentan, nivel libre, otras categorías no aplican
const tabla = [rec({ id: 'rc-nac' }), rec({ id: 'rc-mun', nivel: 'mundial', kg: 230, atleta: 'Mundial' }), rec({ id: 'rc-lib', nivel: 'otro', nivelTexto: 'Panamericano', kg: 205 }), rec({ id: 'rc-b', lev: 'B', kg: 150 }), rec({ id: 'rc-f', sexo: 'F', kg: 100 }), rec({ id: 'rc-t', lev: 'total', kg: 480 })];
const a = atleta();
assert.deepEqual(R.recordsQueSupera(a, 'S', 200, tabla, meet), [], 'un empate no cuenta');
assert.deepEqual(R.recordsQueSupera(a, 'S', 199.5, tabla, meet), []);
let c = R.recordsQueSupera(a, 'S', 202.5, tabla, meet);
assert.deepEqual(c.map(x => [x.nivel, x.recTexto, x.actual, x.lev]), [['nacional', '', 200, 'S']]);
c = R.recordsQueSupera(a, 'S', 207.5, tabla, meet);
assert.deepEqual(c.map(x => x.recTexto || x.nivel).sort(), ['Panamericano', 'nacional']);
assert.equal(R.recordsQueSupera(a, 'S', 235, tabla, meet).length, 3, 'nacional, libre y mundial');
assert.deepEqual(R.recordsQueSupera(a, 'S', 300, tabla, { ...meet, federacion: 'WRPF' }), [], 'otra federación');
assert.deepEqual(R.recordsQueSupera(a, 'S', 300, tabla, { ...meet, federacion: '' }), []);
assert.deepEqual(R.recordsQueSupera({ ...a, equipamiento: 'equipado' }, 'S', 300, tabla, meet), []);
assert.deepEqual(R.recordsQueSupera({ ...a, clase: '-93' }, 'S', 300, tabla, meet), []);
assert.deepEqual(R.recordsQueSupera({ ...a, division: 'Junior' }, 'S', 300, tabla, meet), []);
assert.equal(R.recordsQueSupera({ ...a, sexo: 'F' }, 'S', 120, tabla, meet).length, 1, 'récord femenino');
assert.deepEqual(R.recordsQueSupera(a, 'S', 0, tabla, meet), []);
// la barra (20 o 25 kg en sentadilla) no interviene: el peso es el cargado
assert.deepEqual(R.recordsQueSupera(a, 'S', 202.5, tabla, { ...meet, barraSentadilla: 20 }).map(x => x.actual), [200]);
assert.deepEqual(R.recordsQueSupera(a, 'S', 202.5, tabla, { ...meet, barraSentadilla: 30, barra: 25 }).map(x => x.actual), [200]);
// total: directo e hipotético (S, B y D con marca válida)
assert.deepEqual(R.recordsQueSupera(a, 'total', 480, tabla, meet), [], 'total empatado');
assert.equal(R.recordsQueSupera(a, 'total', 482.5, tabla, meet)[0].lev, 'total');
const b = atleta(); poner(b, 'S', 0, 200, 1); poner(b, 'B', 0, 140, 1);
assert.deepEqual(R.recordsQueSupera(b, 'D', 140, tabla, meet), [], '200+140+140 = 480 empata');
c = R.recordsQueSupera(b, 'D', 142.5, tabla, meet);
assert.deepEqual(c.map(x => [x.lev, x.kg]), [['total', 482.5]]);
assert.deepEqual(R.recordsQueSupera(atleta(), 'D', 300, tabla, meet), [], 'sin S ni B no hay total hipotético');

// --- registro automático con historial
const t2 = [rec()];
const antes = atleta(); poner(antes, 'S', 0, 202.5, null);
const despues = clon(antes); despues.intentos.S[0].r = 1;
let h = R.registrarAutomaticos(t2, meet, antes, despues);
assert.equal(h.length, 1);
assert.equal(t2.length, 1);
assert.deepEqual([t2[0].kg, t2[0].atleta, t2[0].homologado, t2[0].meetId, t2[0].aid, t2[0].fecha, t2[0].lugar], [202.5, 'Pedro Pérez', false, 'm1', 'a1', '2026-03-01', 'Coliseo, Cali']);
assert.deepEqual(t2[0].historial.map(x => [x.kg, x.atleta]), [[200, 'Juan Récord']], 'el anterior queda en el historial');
assert.equal(R.registrarAutomaticos(t2, meet, despues, despues).length, 0, 'sin cambio no hay récord nuevo');
const nulo = clon(antes); nulo.intentos.S[0].r = -1;
assert.equal(R.registrarAutomaticos([rec()], meet, antes, nulo).length, 0, 'un nulo no registra');
// el mismo atleta mejora su récord del mismo meet: se actualiza sin ensuciar el historial
const mejora = clon(despues); poner(mejora, 'S', 1, 205, 1);
h = R.registrarAutomaticos(t2, meet, despues, mejora);
assert.equal(h[0].cambio, 'actualizado'); assert.equal(t2[0].kg, 205); assert.equal(t2[0].historial.length, 1);
// otro atleta del mismo meet lo supera: el anterior pasa al historial
const otro = atleta({ id: 'a2', nombre: 'Luis Gómez' }); poner(otro, 'S', 0, 210, 1);
R.registrarAutomaticos(t2, meet, atleta({ id: 'a2', nombre: 'Luis Gómez' }), otro);
assert.deepEqual(t2[0].historial.map(x => x.kg), [205, 200]);
// varios niveles a la vez
const t3 = [rec({ nivel: 'nacional', kg: 200 }), rec({ nivel: 'mundial', kg: 205 })];
const x210 = clon(despues); x210.intentos.S[0] = { kg: 210, r: 1 };
assert.equal(R.registrarAutomaticos(t3, meet, antes, x210).length, 2);
assert.deepEqual(t3.map(x => x.kg), [210, 210]);
// total completo
const t4 = [rec({ lev: 'total', kg: 450 })];
const fin = atleta(); poner(fin, 'S', 0, 160, 1); poner(fin, 'B', 0, 110, 1); poner(fin, 'D', 0, 190, null);
const fin2 = clon(fin); fin2.intentos.D[0].r = 1;
R.registrarAutomaticos(t4, meet, fin, fin2);
assert.equal(total(fin2), 460); assert.deepEqual([t4[0].kg, t4[0].lev], [460, 'total']);

// --- CSV ida y vuelta
const lista = [rec(), rec({ nivel: 'otro', nivelTexto: 'Panamericano, "oro"', lev: 'D', kg: 182.5, atleta: 'Ñandú Ibáñez', homologado: false, fuente: 'https://e.org/a?b=1,2', meet: 'Copa; Sur' }), rec({ sexo: 'F', lev: 'total', kg: 410 })];
const csv = R.recordsACSV(lista);
assert.ok(csv.startsWith('﻿"federacion"'));
const { records: vuelta, errores } = R.recordsDeCSV(csv);
assert.deepEqual(errores, []);
const sinId = l => R.ordenarRecords(l).map(({ id, historial, ...r }) => r);
assert.deepEqual(sinId(vuelta), sinId(lista));
const raro = R.recordsDeCSV('federacion;nivel;sexo;levantamiento;kg;atleta\nIPF;nacional;M;sentadilla;200,5;Ana\nIPF;marte;M;S;100;Bob\n\nIPF;nacional;M;S;abc;Cy');
assert.equal(raro.records.length, 1); assert.equal(raro.records[0].kg, 200.5);
assert.deepEqual(raro.errores.map(e => e.linea), [3, 5]);
assert.equal(R.recordsDeCSV('a,b\n1,2').errores.length, 1);
assert.equal(R.recordsDeCSV(R.plantillaRecordsCSV()).records.length, 1, 'la plantilla es válida');

// --- filtros
assert.equal(R.filtrarRecords(lista, { sexo: 'F' }).length, 1);
assert.equal(R.filtrarRecords(lista, { q: 'nandu' }).length, 1, 'búsqueda sin tildes');
assert.equal(R.filtrarRecords(lista, { pendientes: '1' }).length, 1);
assert.equal(R.filtrarRecords(lista, { federacion: 'ipf', nivel: 'nacional' }).length, 2);

// --- perfiles: agrupación por nombre y sexo, atletaId y fusión
const mk = (id, fecha, atletas) => ({ id, nombre: id, fecha, creado: Date.parse(fecha), formula: 'GL', atletas });
const lev = (s, bb, d) => { const x = atleta(); poner(x, 'S', 0, s, 1); poner(x, 'B', 0, bb, 1); poner(x, 'D', 0, d, 1); return x; };
const luis = (id, nombre, sexo, s, bb, d, o = {}) => ({ ...lev(s, bb, d), id, nombre, sexo, club: 'Club Uno', ...o });
const m1 = mk('copa-a', '2025-02-01', [luis('p1', 'José  PÉREZ', 'M', 150, 100, 180), luis('p2', 'Ana Ruiz', 'F', 100, 60, 120)]);
const m2 = mk('copa-b', '2025-09-01', [luis('q1', 'jose perez', 'M', 160, 105, 190, { club: 'Club Dos' }), luis('q2', 'Ana Ruiz', 'M', 150, 100, 180)]);
const m3 = mk('copa-c', '2026-03-01', [luis('r1', 'Jose Pérez', 'M', 165, 110, 195)]);
let g = P.agruparAtletas([m3, m1, m2]);
assert.deepEqual([...g.keys()].sort(), ['ana-ruiz-f', 'ana-ruiz-m', 'jose-perez-m'], 'mismo nombre y distinto sexo son fichas distintas');
const jose = g.get('jose-perez-m');
assert.deepEqual(jose.apariciones.map(x => x.meet.id), ['copa-a', 'copa-b', 'copa-c'], 'de más antigua a más reciente');
const per = P.perfilDe(jose, [rec({ atleta: 'JOSÉ PÉREZ', kg: 100 }), rec({ atleta: 'Otro' })]);
assert.equal(per.meets, 3); assert.equal(per.nombre, 'Jose Pérez');
assert.deepEqual(per.clubs, ['Club Uno', 'Club Dos'].sort((x, y) => per.clubs.indexOf(x) - per.clubs.indexOf(y)));
assert.equal(per.clubs.length, 2);
assert.equal(per.historial[0].meetId, 'copa-c'); assert.equal(per.historial[0].total, 470);
assert.deepEqual([per.mejores.S.kg, per.mejores.B.kg, per.mejores.D.kg, per.mejores.total.kg], [165, 110, 195, 470]);
assert.equal(per.mejores.total.meetId, 'copa-c'); assert.equal(per.mejores.S.fecha, '2026-03-01');
assert.deepEqual(per.progresion.map(x => x.total), [430, 455, 470]);
assert.ok(per.progresion.every(x => x.puntos > 0) && per.mejores.puntos.kg > 0);
assert.equal(per.historial[0].puesto, 1); assert.equal(per.ultimo.anillo.length, 9); assert.equal(per.ultimo.anillo[0].estado, 'ok');
assert.equal(per.records.length, 1, 'récords que posee, por nombre');
// atletaId: une nombres distintos de la misma persona
const m4 = mk('copa-d', '2026-04-01', [luis('s1', 'J. Pérez', 'M', 170, 110, 200, { atletaId: 'jose-perez-m' })]);
assert.equal(P.agruparAtletas([m1, m2, m3, m4]).get('jose-perez-m').apariciones.length, 4);
// asignaciones del organizador: fusionar y separar homónimos
const asig = { 'copa-b|q2': 'ana-ruiz-f', 'copa-a|p1': 'jose-perez-2' };
g = P.agruparAtletas([m1, m2, m3], asig);
assert.equal(g.get('ana-ruiz-f').apariciones.length, 2, 'fusionadas');
assert.equal(g.has('ana-ruiz-m'), false);
assert.equal(g.get('jose-perez-2').apariciones.length, 1, 'separado');
assert.equal(g.get('jose-perez-m').apariciones.length, 2);
assert.equal(P.slugDe('copa-b', m2.atletas[1], asig), 'ana-ruiz-f');
assert.equal(P.slugAuto({ nombre: '   ' }), '');
assert.equal(P.agruparAtletas([mk('z', '2026-01-01', [{ ...atleta(), nombre: '' }])]).size, 0);
const lst = P.resumenLista(g.get('jose-perez-m')); assert.deepEqual([lst.meets, lst.mejorTotal, lst.ultimaFecha], [2, 470, '2026-03-01']);
assert.equal(mejor(lev(1, 2, 3), 'D'), 3);
console.log('records-nucleo: ok');
