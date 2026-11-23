// Organizador: importar CSV con errores por fila, orden, progreso del grupo y enlaces de juez.
import assert from 'node:assert/strict';
const L = await import(new URL('../web/js/vistas/organizar/logica.js', import.meta.url).href);
const C = await import(new URL('../web/js/nucleo/competencia.js', import.meta.url).href);

// partirCSV: separador, comillas y BOM
const p = L.partirCSV('﻿nombre;sexo;club\n"Díaz; Ana";F;"Club ""Norte"""\n\n');
assert.equal(p.sep, ';'); assert.deepEqual(p.cabecera, ['nombre', 'sexo', 'club']); assert.equal(p.filas.length, 1);
assert.equal(p.filas[0][0], 'Díaz; Ana'); assert.equal(p.filas[0][2], 'Club "Norte"');

// analizarCSV: la plantilla de la app se importa sin errores
const plantilla = L.analizarCSV(L.plantillaCSV(), { federacion: 'IPF', plataformas: ['Tarima 1'] });
assert.equal(plantilla.ok, 1); assert.equal(plantilla.conErrores, 0);
assert.equal(plantilla.filas[0].atleta.intentos.S[0].kg, 120); assert.equal(plantilla.filas[0].atleta.clase, '-63');

// errores por fila, avisos y omitidos
const csv = [
  'Atleta,Sexo,Peso corporal,Apertura S,Banca,Peso muerto,Tarima,Nacimiento,Equipo de levantamiento',
  'Ana Díaz,mujer,62.4,100,50,120,Tarima 1,12/05/1997,raw',
  ',F,70,100,50,120,Tarima 1,,',            // sin nombre
  'Luis Mora,X,80,150,100,180,Tarima 1,,',    // sexo no válido
  'Pedro Gil,M,abc,150,100,180,Tarima 1,,',   // peso no numérico
  'Eva Ríos,F,57,87.3,45,,Tarima 2,31/02/2000,equipado', // apertura rara, tarima nueva, fecha imposible
  'ANA DIAZ,F,62,100,50,120,Tarima 1,,',      // repetida en el archivo
  'Sara Paz,F,,,,,,,',                        // sin peso ni aperturas
  'Jorge Roa,M,90,200,130,230,Tarima 1,,',    // ya existe
].join('\n');
const a = L.analizarCSV(csv, { federacion: 'IPF', plataformas: ['Tarima 1'], existentes: [{ nombre: 'jorge roa' }] });
assert.equal(a.filas.length, 8);
const f = n => a.filas.find(x => x.n === n);
assert.equal(f(2).atleta.sexo, 'F'); assert.equal(f(2).atleta.nacimiento, '1997-05-12'); assert.equal(f(2).atleta.intentos.B[0].kg, 50);
assert.match(f(3).errores[0], /nombre/); assert.match(f(4).errores[0], /Sexo/); assert.match(f(5).errores[0], /Peso corporal/);
assert.ok(f(6).atleta && f(6).avisos.length === 3, 'Eva: múltiplo de 2,5, tarima nueva y fecha');
assert.equal(f(6).atleta.equipamiento, 'equipado'); assert.deepEqual(a.plataformasNuevas, ['Tarima 2']);
assert.ok(f(7).omitir, 'repetida dentro del archivo'); assert.ok(f(9).omitir, 'ya existía');
assert.equal(f(8).atleta.peso, null); assert.equal(f(8).atleta.clase, ''); assert.equal(f(8).atleta.intentos.S[0].kg, null);
assert.equal(a.ok, 3); assert.equal(a.conErrores, 3); assert.equal(a.omitidas, 2);
assert.equal(L.analizarCSV('foo,bar\n1,2').error?.includes('nombre'), true);

// prepararImportacion: ids únicos y lotes seguidos
const prep = L.prepararImportacion(a, [{ lote: 7 }]);
assert.equal(prep.length, 3); assert.equal(new Set(prep.map(x => x.id)).size, 3); assert.deepEqual(prep.map(x => x.lote), [8, 9, 10]);
assert.ok(prep.every(x => /^at-[0-9a-f]{10}$/.test(x.id)));

// fechas
assert.equal(L.fechaNacimiento('2001-2-3'), '2001-02-03'); assert.equal(L.fechaNacimiento('3/2/2001'), '2001-02-03'); assert.equal(L.fechaNacimiento('31/02/2001'), null);

// orden y grupos
const at = (nombre, plataforma, sesion, grupo, lote) => C.nuevoAtleta({ nombre, plataforma, sesion, grupo, lote });
const lista = [at('C', 'Tarima 1', '2', 'A', 1), at('B', 'Tarima 1', '1', 'B', 2), at('A', 'Tarima 1', '1', 'A', 10), at('D', 'Tarima 1', '1', 'A', 3)];
assert.deepEqual(L.ordenarAtletas(lista).map(x => x.nombre), ['D', 'A', 'B', 'C']);
assert.deepEqual(L.sesionesDe(lista, 'Tarima 1'), ['1', '2']); assert.deepEqual(L.gruposDe(lista, 'Tarima 1', '1'), ['A', 'B']); assert.equal(L.siguienteLote(lista), 11);

// progreso del grupo
const g = [at('X', 'T', '1', 'A', 1), at('Y', 'T', '1', 'A', 2), at('Z', 'T', '1', 'B', 3)];
assert.equal(L.progresoGrupo(g, { plataforma: 'T', sesion: '1', grupo: 'A' }).faltan, 18);
g[0].intentos.S[0] = { kg: 100, r: 1 }; g[1].intentos.S[0] = { kg: 90, r: -1 }; g[1].intentos.S[1] = { kg: 0, r: null };
const pr = L.progresoGrupo(g, { plataforma: 'T', sesion: '1', grupo: 'A' });
assert.equal(pr.hechos, 3); assert.equal(pr.faltan, 15); assert.equal(pr.segmentos[0].estado, 'ok'); assert.equal(pr.segmentos[1].estado, 'pendiente'); assert.equal(pr.segmentos.length, 9);
assert.equal(L.textoFaltan(pr, 'A'), 'Faltan 15 intentos en el Grupo A');
assert.equal(L.progresoGrupo([], {}).total, 0);

// enlaces
assert.deepEqual(L.basesParaTelefonos({ origen: 'http://localhost:5050', ips: ['192.168.1.20', '10.0.0.4'], puerto: 5050 }), ['http://192.168.1.20:5050', 'http://10.0.0.4:5050']);
assert.deepEqual(L.basesParaTelefonos({ origen: 'http://192.168.1.20:5050', ips: ['10.0.0.4'], puerto: 5050 }), ['http://192.168.1.20:5050']);
assert.deepEqual(L.basesParaTelefonos({ origen: 'http://localhost:5050', ips: [] }), ['http://localhost:5050']);
assert.equal(L.enlaceJuez('http://192.168.1.20:5050/', 'copa-ab12', 'Tarima 1', 'izq', '123456'), 'http://192.168.1.20:5050/juez/copa-ab12?t=Tarima%201&p=izq&c=123456');

// tiempo
assert.equal(L.leerTiempo('1:30'), 90); assert.equal(L.leerTiempo('45'), 45); assert.equal(L.leerTiempo('x'), null);
console.log('organizar-logica: bien');

// discos con inventario
const c1 = L.cargaDiscos(142.5, { barra: 20, collar: 2.5 });
assert.equal(c1.discos.reduce((s, d) => s + d, 0) * 2 + 20 + 5, 142.5); assert.equal(c1.sobra, 0);
const c2 = L.cargaDiscos(100, { barra: 20, collar: 0, discos: [{ kg: 20, pares: 1 }, { kg: 10, pares: 1 }] });
assert.deepEqual(c2.discos, [20, 10]); assert.equal(c2.sobra, 20, 'faltan discos');
assert.equal(L.cargaDiscos(60, { barra: 20, barraSentadilla: 25, collar: 2.5 }, 'S').barra, 25);
console.log('organizar-logica (discos): bien');

// resumen final
const mk = (n, sexo, club, S, B, D, peso) => { const a = C.nuevoAtleta({ nombre: n, sexo, club, peso }); [['S', S], ['B', B], ['D', D]].forEach(([l, v]) => v.forEach(([k, r], i) => { a.intentos[l][i] = { kg: k, r }; })); return a; };
const rf = L.resumenFinal([mk('Ana', 'F', 'N', [[100, 1], [105, 1], [110, -1]], [[50, 1], [55, -1], [55, -1]], [[120, 1], [125, 1], [130, -1]], 62), mk('Leo', 'M', 'S', [[200, 1], [210, -1], [210, -1]], [[120, 1], [125, 1], [130, 1]], [[220, 1], [230, 1], [240, 1]], 90)]);
assert.equal(rf.atletas, 2); assert.equal(rf.intentos, 18); assert.equal(rf.validos, 12); assert.equal(rf.porcentaje, 67);
assert.equal(rf.mejorF.nombre, 'Ana'); assert.equal(rf.mejorM.nombre, 'Leo'); assert.ok(rf.equipo.club && rf.records > 0);
assert.equal(L.resumenFinal([]).intentos, 0);
console.log('organizar-logica (resumen): bien');
