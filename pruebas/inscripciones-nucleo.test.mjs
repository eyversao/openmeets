// Reglas puras de inscripciones y pesaje: división por edad, cupos, categoría tras el pesaje y reparto en grupos.
import assert from 'node:assert/strict';
import { divisionPorEdad, edadEn, estadoApertura, cabe, contarCupos, revisarCategoria, resumenPesaje, repartirGrupos, mensajeConfirmacion, categoriaPropuesta, claveDuplicado } from '../web/js/nucleo/inscripcion.js';

// edad: IPF cuenta por año calendario; el resto, el día del meet
assert.equal(edadEn('2008-12-31', '2026-06-01'), 17);
assert.equal(edadEn('2008-12-31', '2026-06-01', { porAnio: true }), 18);
assert.equal(divisionPorEdad('IPF', '2008-12-31', '2026-06-01'), 'Sub-Junior');
assert.equal(divisionPorEdad('IPF', '2005-05-05', '2026-06-01'), 'Junior');
assert.equal(divisionPorEdad('IPF', '1996-05-05', '2026-06-01'), 'Open');
assert.equal(divisionPorEdad('IPF', '1980-01-01', '2026-06-01'), 'Master 1');
assert.equal(divisionPorEdad('WRPF', '2011-01-01', '2026-06-01'), 'Teenage');
assert.equal(divisionPorEdad('Local', '1990-01-01', '2026-06-01'), null, 'sin regla por edad la elige el atleta');
assert.equal(divisionPorEdad('IPF', 'basura', '2026-06-01'), null);

// apertura y cierre
const cfg = { abiertas: true, cierre: '2026-06-01T18:00', cupoTotal: 2, cupoCategoria: 1 };
assert.equal(estadoApertura(cfg, new Date('2026-06-01T17:59').getTime()).abierta, true);
assert.deepEqual(estadoApertura(cfg, new Date('2026-06-01T18:00').getTime()), { abierta: false, motivo: 'cierre' });
assert.deepEqual(estadoApertura({ abiertas: false }), { abierta: false, motivo: 'apagada' });
assert.equal(estadoApertura(undefined).abierta, false);

// cupos: total y por categoría; la lista de espera y los rechazados no ocupan lugar
const items = [{ estado: 'pendiente', sexo: 'M', clase: '-83' }, { estado: 'espera', sexo: 'M', clase: '-83' }, { estado: 'rechazado', sexo: 'F', clase: '-57' }];
const cu = contarCupos(items);
assert.equal(cu.ocupados, 1); assert.equal(cu.espera, 1);
assert.equal(cabe(cfg, cu, 'M', '-83'), false, 'categoría llena');
assert.equal(cabe(cfg, cu, 'F', '-57'), true);
assert.equal(cabe({ ...cfg, cupoCategoria: null, cupoTotal: 1 }, cu, 'F', '-57'), false, 'cupo total lleno');

// categoría propuesta y revisión en el pesaje
assert.equal(categoriaPropuesta('IPF', 'M', 82.3, 'Open'), '-83');
assert.equal(categoriaPropuesta('IPF', 'M', 0, 'Open'), '');
const a = { sexo: 'M', clase: '-83', division: 'Open' };
assert.deepEqual(revisarCategoria('IPF', a, 82.9), { estado: 'igual', clase: '-83', antes: '-83' });
assert.equal(revisarCategoria('IPF', a, 85).estado, 'cambia');
assert.equal(revisarCategoria('IPF', a, 85).clase, '-93');
assert.equal(revisarCategoria('IPF', a, 400).estado, 'fuera');
assert.equal(revisarCategoria('IPF', a, 0).estado, 'fuera');

// resumen del pesaje por categoría
const at = [
  { id: 'a', sexo: 'M', clase: '-83', peso: 80, pesaje: { hora: 1 } }, { id: 'b', sexo: 'M', clase: '-83', peso: 82, pesaje: { hora: 2 } },
  { id: 'c', sexo: 'F', clase: '-57', peso: 56, pesaje: { hora: 3 } }, { id: 'd', sexo: 'M', clase: '-93' },
];
let r = resumenPesaje(at);
assert.equal(r.pesados, 3); assert.equal(r.total, 4); assert.equal(r.completo, false);
assert.deepEqual(r.categorias.map(c => [c.categoria, c.n]), [['Hombres -83', 2], ['Mujeres -57', 1]]);
assert.equal(resumenPesaje(at.slice(0, 3)).completo, true);
assert.equal(resumenPesaje([]).completo, false);

// grupos: tope por grupo, parejos, de liviano a pesado y lotes únicos dentro del grupo
const muchos = Array.from({ length: 13 }, (_, i) => ({ id: `x${i}`, nombre: `N${i}`, sexo: i % 4 === 0 ? 'F' : 'M', clase: i % 4 === 0 ? '-57' : (i % 2 ? '-74' : '-93'), peso: 60 + i, plataforma: 'Tarima 1' }));
const rep = repartirGrupos(muchos, { tope: 6, azar: () => 0.5 });
assert.equal(rep.length, 13);
const porGrupo = Object.groupBy ? Object.groupBy(rep, x => x.grupo) : rep.reduce((o, x) => ((o[x.grupo] ||= []).push(x), o), {});
assert.deepEqual(Object.keys(porGrupo).sort(), ['A', 'B', 'C']);
for (const g of Object.values(porGrupo)) { assert.ok(g.length <= 6); assert.equal(new Set(g.map(x => x.lote)).size, g.length); }
assert.equal(rep.find(x => x.id === 'x1').grupo <= rep.find(x => x.id === 'x2').grupo, true, 'los hombres más livianos van antes');
assert.deepEqual(repartirGrupos([], {}), []);

// mensajes
const meet = { nombre: 'Copa Ñandú', fecha: '2026-06-01', ciudad: 'Cali', inscripciones: { precio: 80000, moneda: 'COP', pagoUrl: 'https://pagos.example/x', instrucciones: 'Envía el comprobante.' } };
const it = { nombre: 'Ana Pérez', codigo: 'K7M2QX', estado: 'pendiente', sexo: 'F', clase: '-57', division: 'Open', equipamiento: 'raw' };
assert.match(mensajeConfirmacion(meet, it), /80000 COP.*https:\/\/pagos\.example\/x/);
assert.match(mensajeConfirmacion(meet, { ...it, estado: 'confirmado' }), /confirmada.*Mujeres -57/s);
assert.match(mensajeConfirmacion(meet, { ...it, estado: 'espera' }), /lista de espera/);
assert.equal(claveDuplicado('  Ana  PÉREZ ', '2000-01-01'), claveDuplicado('ana perez', '2000-01-01'));
console.log('inscripciones-nucleo: ok');
