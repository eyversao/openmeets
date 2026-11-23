// Federación (lógica pura): hash y verificación de PIN, límites, permisos por rol, fusión de atletas, auditoría,
// CSV de OpenPowerlifting con un caso conocido y datos de la vista central y del locutor.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearRoles, elevaPara, fusionarAtleta, cambiosAtleta, instantanea, resumirEscritura, marcasPersonales } from '../servidor/federacion.mjs';
import { openPowerliftingCSV, claseOpl, edadEn, COLUMNAS } from '../servidor/openpowerlifting.mjs';
import { crearLimitador } from '../servidor/acceso.mjs';
import * as F from '../web/js/nucleo/federacion.js';

const tmp = mkdtempSync(join(tmpdir(), 'om-fed-'));
const intento = (kg, r = null) => ({ kg, r, rec: false, alFinal: false });
const atleta = (id, nombre, o = {}) => ({ id, nombre, sexo: 'M', club: 'Club', division: 'Open', equipamiento: 'raw', peso: 82.4, clase: '-83', plataforma: 'Tarima 1', sesion: '1', grupo: 'A', lote: 1, rack: { S: 5, B: 3 },
  intentos: { S: [intento(200, 1), intento(210, -1), intento(210, 1)], B: [intento(130, 1), intento(135, 1), intento(140, -1)], D: [intento(230, 1), intento(240, 1), intento(250, -1)] }, ...o });

try {
  /* ---- PIN: hash scrypt con sal, verificación y caducidad ---- */
  let t = 1000000;
  const roles = crearRoles({ dir: tmp, ahora: () => t });
  const { rol, pin } = roles.crear({ meetId: 'm1', nombre: 'Ana', rol: 'mesa', plataforma: 'Tarima 1', horas: 2 });
  assert.match(pin, /^\d{6}$/);
  const bruto = readFileSync(join(tmp, 'roles.json'), 'utf8');
  assert.ok(!bruto.includes(pin), 'el PIN no se guarda en claro');
  const guardado = JSON.parse(bruto).roles[0];
  assert.match(guardado.hash, /^[0-9a-f]{64}$/); assert.match(guardado.sal, /^[0-9a-f]{32}$/);
  assert.equal(roles.verificar(pin)?.id, rol.id);
  assert.equal(roles.verificar(pin, rol.id)?.id, rol.id);
  assert.equal(roles.verificar(pin, 'r-otro'), null);
  assert.equal(roles.verificar(pin === '000000' ? '000001' : '000000'), null, 'PIN equivocado');
  assert.equal(roles.verificar('12345'), null); assert.equal(roles.verificar(123456), null); assert.equal(roles.verificar('12345a'), null);
  const b = roles.crear({ meetId: 'm1', nombre: 'Luis', rol: 'pesaje' });
  assert.notEqual(roles.listar('m1').length, 0);
  assert.notEqual(JSON.parse(readFileSync(join(tmp, 'roles.json'), 'utf8')).roles[1].sal, guardado.sal, 'cada acceso con su sal');
  // sesión por cookie
  const tok = roles.abrirSesion(roles.verificar(pin));
  assert.equal(roles.deToken(tok).nombre, 'Ana');
  assert.equal(roles.deToken('x'.repeat(48)), null);
  // revocar corta la sesión
  roles.revocar('m1', b.rol.id);
  assert.equal(roles.verificar(b.pin), null, 'revocado no entra');
  // caducidad
  t += 3 * 3600000;
  assert.equal(roles.verificar(pin), null, 'caducado no entra'); assert.equal(roles.deToken(tok), null, 'la sesión caduca con el acceso');
  assert.deepEqual(roles.listar('m1').map(r => r.estado).sort(), ['caducado', 'revocado']);
  // persiste
  assert.equal(crearRoles({ dir: tmp, ahora: () => t }).listar('m1').length, 2);

  /* ---- límite de intentos por IP (el mismo limitador de acceso.mjs) ---- */
  let ahora = 0;
  const lim = crearLimitador({ max: 5, ventana: 60000, ahora: () => ahora });
  for (let i = 0; i < 5; i++) assert.ok(lim.intentar('rol|1.2.3.4'));
  assert.equal(lim.intentar('rol|1.2.3.4'), false, 'el sexto intento se bloquea');
  assert.ok(lim.intentar('rol|9.9.9.9'), 'otra IP no se ve afectada');
  ahora = 61000; assert.ok(lim.intentar('rol|1.2.3.4'), 'pasada la ventana se libera');

  /* ---- permisos por rol ---- */
  const p = r => ({ rol: r, meetId: 'm1', plataforma: 'Tarima 1' });
  const ruta = s => s.split('/');
  assert.ok(elevaPara(p('mesa'), 'POST', ruta('meets/m1/canal')));
  assert.ok(elevaPara(p('mesa'), 'PUT', ruta('meets/m1/atletas/a1')));
  assert.ok(elevaPara(p('mesa'), 'GET', ruta('meets/m1')));
  assert.ok(!elevaPara(p('mesa'), 'PATCH', ruta('meets/m1')), 'la mesa no cambia datos del meet');
  assert.ok(!elevaPara(p('mesa'), 'DELETE', ruta('meets/m1/atletas/a1')));
  assert.ok(!elevaPara(p('mesa'), 'POST', ruta('meets/m1/atletas')), 'ni importa lotes');
  assert.ok(!elevaPara(p('mesa'), 'PUT', ruta('meets/m2/atletas/a1')), 'ni toca otro meet');
  assert.ok(elevaPara(p('pesaje'), 'PUT', ruta('meets/m1/atletas/a1')));
  assert.ok(!elevaPara(p('pesaje'), 'POST', ruta('meets/m1/canal')), 'pesaje no toca el canal');
  assert.ok(elevaPara(p('director'), 'PATCH', ruta('meets/m1')));
  assert.ok(elevaPara(p('director'), 'GET', ruta('meets/m1/export.json')));
  assert.ok(!elevaPara(p('director'), 'DELETE', ruta('meets/m1')), 'el director no borra el meet');
  assert.ok(!elevaPara(p('director'), 'POST', ruta('meets/m1/roles')), 'ni crea accesos');
  assert.ok(!elevaPara(p('director'), 'GET', ruta('pin')), 'ni ve el PIN del organizador');
  assert.ok(!elevaPara(p('director'), 'POST', ruta('meets/importar')));
  for (const r of ['locutor', 'lectura']) for (const m of ['GET', 'PUT', 'POST', 'PATCH', 'DELETE']) assert.ok(!elevaPara(p(r), m, ruta('meets/m1/atletas/a1')) && !elevaPara(p(r), m, ruta('meets/m1')), `${r} ${m}`);

  /* ---- fusión: lo que cada rol puede cambiar ---- */
  const base = atleta('a1', 'Ana Ruiz');
  const editado = JSON.parse(JSON.stringify(base)); editado.nombre = 'Otra'; editado.club = 'X'; editado.peso = 90; editado.intentos.S[1] = intento(215, 1);
  const m1 = fusionarAtleta('mesa', base, editado);
  assert.equal(m1.nombre, 'Ana Ruiz'); assert.equal(m1.peso, 82.4); assert.equal(m1.intentos.S[1].r, 1); assert.equal(m1.intentos.S[1].kg, 215);
  const pes = JSON.parse(JSON.stringify(base)); pes.peso = 82.1; pes.rack.S = 7; pes.nombre = 'Hack';
  const pa = fusionarAtleta('pesaje', base, pes);
  assert.equal(pa.peso, 82.1); assert.equal(pa.rack.S, 7); assert.equal(pa.nombre, 'Ana Ruiz', 'pesaje no cambia el nombre');
  const cambiaRes = JSON.parse(JSON.stringify(base)); cambiaRes.intentos.S[0].r = -1;
  assert.throws(() => fusionarAtleta('pesaje', base, cambiaRes), /no puedes cambiar resultados/, 'pesaje no cambia resultados');
  const abre = atleta('a2', 'Beto', { intentos: { S: [intento(180), intento(0), intento(0)], B: [], D: [] } });
  const abre2 = JSON.parse(JSON.stringify(abre)); abre2.intentos.S[0].kg = 185;
  assert.equal(fusionarAtleta('pesaje', abre, abre2).intentos.S[0].kg, 185, 'pesaje cambia la apertura sin resultado');
  const cerrado = JSON.parse(JSON.stringify(base)); cerrado.intentos.S[0].kg = 999;
  assert.equal(fusionarAtleta('pesaje', base, cerrado).intentos.S[0].kg, 200, 'una apertura ya juzgada no cambia');
  assert.throws(() => fusionarAtleta('lectura', base, base), /no puede escribir/);

  /* ---- auditoría: diferencias y resúmenes ---- */
  const cs = cambiosAtleta(base, editado);
  assert.ok(cs.some(c => c.campo === 'peso' && c.antes === '82.4' && c.despues === '90'));
  assert.ok(cs.some(c => c.campo === 'S2 resultado' && c.antes === 'nulo' && c.despues === 'válido'));
  assert.ok(!JSON.stringify(cs).includes('notas'));
  const meet = { id: 'm1', nombre: 'Copa', plataformas: ['Tarima 1'], atletas: [editado], vivo: {}, privado: { codigoJuez: '111111' } };
  const snap = instantanea({ ...meet, atletas: [base] }, 'PUT', ['meets', 'm1', 'atletas', 'a1']);
  const [e] = resumirEscritura(snap, meet, 'PUT', ['meets', 'm1', 'atletas', 'a1']);
  assert.match(e.resumen, /^Otra: nombre Ana Ruiz→Otra/); assert.ok(e.cambios.length >= 5);
  const sm = instantanea(meet, 'PATCH', ['meets', 'm1']);
  const nuevoM = { ...meet, nombre: 'Copa 2', privado: { codigoJuez: '222222' } };
  const [em] = resumirEscritura(sm, nuevoM, 'PATCH', ['meets', 'm1']);
  assert.match(em.resumen, /nombre Copa→Copa 2/); assert.ok(!JSON.stringify(em).includes('222222') && !JSON.stringify(em).includes('111111'), 'sin el código en la auditoría');
  assert.deepEqual(resumirEscritura(sm, meet, 'PATCH', ['meets', 'm1']), [], 'sin cambios no se anota');

  /* ---- OpenPowerlifting: caso conocido ---- */
  assert.equal(claseOpl('-83'), '83'); assert.equal(claseOpl('+120'), '120+'); assert.equal(claseOpl('-67.5'), '67.5'); assert.equal(claseOpl(''), '');
  assert.equal(edadEn('2000-06-15', '2026-06-14'), 25); assert.equal(edadEn('2000-06-15', '2026-06-15'), 26); assert.equal(edadEn(null, '2026-01-01'), '');
  const ana = atleta('a1', 'Ana Ruiz', { sexo: 'F', nacimiento: '2000-06-15', pais: 'Colombia', peso: 62.4, clase: '-63', division: 'Open' });
  const beto = atleta('a2', 'Beto, el Grande', { club: 'B', nacimiento: '1980-01-01', peso: 130, clase: '+120', levantes: ['B'], division: 'Master 1', intentos: { S: [], B: [intento(150, 1), intento(160, 1), intento(170, -1), intento(0)], D: [] } });
  const cai = atleta('a3', 'Caída', { peso: 74, clase: '-74', intentos: { S: [intento(200, -1), intento(200, -1), intento(200, -1)], B: [], D: [] } });
  const nada = atleta('a4', 'Nada', { peso: 90, clase: '-93', intentos: { S: [], B: [], D: [] } });
  const csv = openPowerliftingCSV({ id: 'x', nombre: 'Copa Prueba', fecha: '2026-06-14', pais: 'Colombia', ciudad: 'Cali', federacion: 'IPF', atletas: [ana, beto, cai, nada] });
  const lineas = csv.trim().split('\r\n');
  assert.equal(lineas[0], COLUMNAS.join(','));
  assert.equal(lineas[0], 'Name,Sex,Event,Equipment,Age,Division,BodyweightKg,WeightClassKg,Squat1Kg,Squat2Kg,Squat3Kg,Squat4Kg,Best3SquatKg,Bench1Kg,Bench2Kg,Bench3Kg,Bench4Kg,Best3BenchKg,Deadlift1Kg,Deadlift2Kg,Deadlift3Kg,Deadlift4Kg,Best3DeadliftKg,TotalKg,Place,Tested,Country,Federation,Date,MeetCountry,MeetState,MeetTown,MeetName');
  const fila = n => lineas.find(l => l.startsWith(n));
  // Ana: S 200 -210 210 · B 130 135 -140 · D 230 240 -250 → mejores 210/135/240 = 585
  assert.equal(fila('Ana Ruiz'), 'Ana Ruiz,F,SBD,Raw,25,Open,62.4,63,200,-210,210,,210,130,135,-140,,135,230,240,-250,,240,585,1,Yes,Colombia,IPF,2026-06-14,Colombia,,Cali,Copa Prueba');
  assert.equal(fila('"Beto, el Grande"'), '"Beto, el Grande",M,B,Raw,46,Master 1,130,120+,,,,,,150,160,-170,,160,,,,,,160,1,Yes,,IPF,2026-06-14,Colombia,,Cali,Copa Prueba');
  assert.match(fila('Caída'), /,-200,-200,-200,,,.*,DQ,Yes,/, 'tres nulos en sentadilla = DQ');
  assert.match(fila('Nada'), /,NS,Yes,/, 'sin intentos = NS');
  assert.ok(!csv.includes('undefined') && !csv.includes('NaN'));
  assert.equal(openPowerliftingCSV({ id: 'y', nombre: 'Otra', fecha: '2026-01-01', federacion: 'WRPF', atletas: [ana] }).split('\r\n')[1].split(',')[25], '', 'sin control de dopaje conocido, Tested vacío');

  /* ---- marcas personales para el locutor ---- */
  const previo = { id: 'p1', nombre: 'Pasado', fecha: '2025-01-01', atletas: [atleta('z', 'ana  RUIZ', { intentos: { S: [intento(190, 1), intento(200, 1), intento(0)], B: [intento(120, 1)], D: [intento(220, 1)] } })] };
  const marcas = marcasPersonales({ id: 'm9', atletas: [base, beto] }, [previo, { id: 'm9', atletas: [] }]);
  assert.equal(marcas.a1.S, 200); assert.equal(marcas.a1.meets, 1); assert.equal(marcas.a2, null);

  /* ---- panel central ---- */
  const ahoraMs = 10 * 60000;
  const vivo = { sesion: '1', grupo: 'A', lev: 'S', actual: { aid: 'a5', nombre: 'Dani', kg: 150, n: 0 }, ts: ahoraMs - 4 * 60000, version: 1,
    jueces: { izq: { conectado: true }, cen: { conectado: false }, der: { conectado: true } }, juzgado: { nombre: 'Ana Ruiz', kg: 200, n: 0 }, luces: { resultado: 1 }, lucesTs: ahoraMs - 20000 };
  const pend = atleta('a5', 'Dani', { intentos: { S: [intento(150), intento(0), intento(0)], B: [], D: [] } });
  const mc = { plataformas: ['Tarima 1', 'Tarima 2'], atletas: [base, pend, atleta('a6', 'Eva', { plataforma: 'Tarima 2' })], actividad: [] };
  const r1 = F.estadoPlataforma(mc, 'Tarima 1', vivo, ahoraMs);
  assert.equal(r1.estado, 'parada'); assert.ok(r1.alertas.some(a => a.tipo === 'parada'), 'más de 3 minutos sin movimiento');
  assert.ok(r1.alertas.some(a => a.tipo === 'juez' && /principal/i.test(a.texto)), 'juez central desconectado');
  assert.equal(r1.ultimo.resultado, 1); assert.equal(r1.actual.nombre, 'Dani');
  assert.ok(r1.progreso.pendientes >= 1 && r1.progreso.hechos >= 1);
  const r2 = F.estadoPlataforma(mc, 'Tarima 2', null, ahoraMs);
  assert.equal(r2.estado, 'sin-datos');
  const rr = F.estadoPlataforma(mc, 'Tarima 1', { ...vivo, ts: ahoraMs - 1000, relojHasta: ahoraMs + 30000, reloj: { estado: 'corre', hasta: ahoraMs + 30000, duracion: 60000 } }, ahoraMs);
  assert.equal(rr.estado, 'activa'); assert.ok(!rr.alertas.some(a => a.tipo === 'parada'));
  assert.equal(F.estadoPlataforma({ ...mc, cerrado: true }, 'Tarima 1', vivo, ahoraMs).alertas.length, 0, 'meet terminado: sin alertas');
  assert.ok(F.alertasGlobales({ conexion: 'sin-red', nube: { configurado: true, estado: 'sin-conexion' } }).length === 2);
  assert.equal(F.alertasGlobales({ conexion: 'conectado', nube: { configurado: false } }).length, 0);

  /* ---- locutor ---- */
  const cat = (id, nombre, kgS, peso) => atleta(id, nombre, { peso, intentos: { S: [intento(kgS, 1), intento(0), intento(0)], B: [intento(100, 1)], D: [intento(150, 1)] } });
  const lider = cat('l1', 'Lider', 260, 80), seg = cat('l2', 'Segundo', 240, 81), ter = cat('l3', 'Tercero', 220, 82);
  const yo = atleta('yo', 'Yo Mismo', { peso: 83, intentos: { S: [intento(180, 1), intento(190), intento(0)], B: [intento(100, 1)], D: [intento(150, 1)] } });
  const ml = { plataformas: ['Tarima 1'], atletas: [lider, seg, ter, yo] };
  const vl = { lev: 'S', actual: { aid: 'yo', nombre: 'Yo Mismo', kg: 190, n: 1, rec: 'nacional' }, siguientes: [{ nombre: 'Lider', kg: 270, n: 1 }, { nombre: 'Segundo', kg: 250, n: 1 }, { nombre: 'Tercero', kg: 230, n: 1 }, { nombre: 'Otro', kg: 300, n: 1 }] };
  const d = F.datosLocutor(ml, vl, { yo: { total: 450, S: 185, B: 100, D: 150, meets: 2 } });
  assert.equal(d.hayAtleta, true); assert.equal(d.intento, 2); assert.equal(d.kg, 190); assert.equal(d.record.nivel, 'nacional');
  assert.equal(d.marca.superaMarca, true, '190 supera la marca de 185');
  assert.equal(d.puesto, 4); assert.equal(d.de, 4);
  // base = B100 + D150 = 250; para el bronce hay que pasar al tercero (220+100+150 = 470): 470 - 250 = 220 → 222,5 por pasos de 2,5
  assert.equal(d.necesita.puesto, 3); assert.equal(d.necesita.medalla, 'bronce'); assert.equal(d.necesita.kg, 222.5); assert.equal(d.necesita.alcanza, false);
  assert.equal(d.siguientes.length, 3);
  const lid = F.datosLocutor(ml, { lev: 'S', actual: { aid: 'l1', nombre: 'Lider', kg: 270, n: 1 }, siguientes: [] }, {});
  assert.equal(lid.puesto, 1); assert.equal(lid.necesita, null); assert.ok(lid.frases.length >= 1);
  assert.equal(F.datosLocutor(ml, { siguientes: [] }, {}).hayAtleta, false);
  console.log('federacion-logica OK');
} finally { rmSync(tmp, { recursive: true, force: true }); }
