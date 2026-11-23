// API de récords y perfiles: tabla, CSV, récord automático al decidir un intento en la mesa, fichas y fusión.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearApp } from './_servidor.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'om-rec-'));
const web = join(tmp, 'web'); mkdirSync(web);
writeFileSync(join(web, 'index.html'), '<title>OM</title>');
const datos = join(tmp, 'datos');
let app = crearApp({ datos, web, espera: 20 });
let puerto = await app.escuchar(0, '127.0.0.1');
let base = `http://127.0.0.1:${puerto}`;
const pedir = async (ruta, { metodo = 'GET', cuerpo, cab = {} } = {}) => {
  const r = await fetch(base + ruta, { method: metodo, headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...cab }, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* texto */ }
  return { estado: r.status, json: j, texto: t, cab: r.headers };
};
const esperar = ms => new Promise(r => setTimeout(r, ms));

try {
  /* ---- tabla de récords ---- */
  const base1 = { federacion: 'IPF', nivel: 'nacional', sexo: 'M', division: 'Open', equipamiento: 'raw', clase: '-83', lev: 'S', kg: 200, atleta: 'Juan Récord', fecha: '2024-05-01', meet: 'Nacional 2024', fuente: 'https://ipf.example/r' };
  let r = await pedir('/api/records');
  assert.equal(r.estado, 200); assert.deepEqual(r.json.records, []);
  r = await pedir('/api/records', { metodo: 'POST', cuerpo: base1 });
  assert.equal(r.estado, 201); const rc = r.json.record; assert.match(rc.id, /^rc-/); assert.equal(rc.homologado, true);
  assert.equal((await pedir('/api/records', { metodo: 'POST', cuerpo: base1 })).estado, 409, 'misma clave');
  assert.equal((await pedir('/api/records', { metodo: 'POST', cuerpo: { ...base1, kg: 0 } })).estado, 400);
  assert.equal((await pedir('/api/records', { metodo: 'POST', cuerpo: { ...base1, nivel: 'otro', nivelTexto: '' } })).estado, 400);
  assert.equal((await pedir('/api/records', { metodo: 'POST', cuerpo: base1, cab: { Origin: 'http://malo.example' } })).estado, 403, 'origen ajeno');
  await pedir('/api/records', { metodo: 'POST', cuerpo: { ...base1, nivel: 'mundial', kg: 230, atleta: 'Mundial' } });
  await pedir('/api/records', { metodo: 'POST', cuerpo: { ...base1, lev: 'B', kg: 150 } });
  await pedir('/api/records', { metodo: 'POST', cuerpo: { ...base1, sexo: 'F', clase: '-63', kg: 120, atleta: 'Ana' } });
  r = await pedir('/api/records?federacion=ipf&sexo=M&lev=S');
  assert.deepEqual(r.json.records.map(x => [x.nivel, x.kg]), [['mundial', 230], ['nacional', 200]]);
  assert.equal((await pedir('/api/records?q=ana')).json.records.length, 1);

  // editar: corregir un dato y marcar un titular nuevo (el anterior pasa al historial)
  r = await pedir(`/api/records/${rc.id}`, { metodo: 'PUT', cuerpo: { fuente: 'otra fuente' } });
  assert.equal(r.json.record.fuente, 'otra fuente'); assert.deepEqual(r.json.record.historial, []);
  r = await pedir(`/api/records/${rc.id}`, { metodo: 'PUT', cuerpo: { kg: 205, atleta: 'Nuevo Titular', fecha: '2025-01-01', nuevoTitular: true } });
  assert.deepEqual(r.json.record.historial.map(h => [h.kg, h.atleta]), [[200, 'Juan Récord']]);
  assert.equal((await pedir(`/api/records/${rc.id}`, { metodo: 'PUT', cuerpo: { lev: 'B', kg: 205 } })).estado, 409, 'choca con otro');
  // borrar y deshacer (restaurar con su id e historial)
  r = await pedir(`/api/records/${rc.id}`, { metodo: 'DELETE' });
  assert.equal(r.estado, 200); const borrado = r.json.record;
  assert.equal((await pedir(`/api/records/${rc.id}`)).estado, 404);
  r = await pedir('/api/records', { metodo: 'POST', cuerpo: borrado });
  assert.equal(r.estado, 201); assert.equal(r.json.record.id, rc.id); assert.equal(r.json.record.historial.length, 1);

  // CSV: exportar, importar en simulacro y de verdad
  const csv = (await pedir('/api/records/export.csv')).texto;
  assert.match(csv, /federacion/); assert.match(csv, /Nuevo Titular/);
  r = await pedir('/api/records/importar', { metodo: 'POST', cuerpo: { csv, simular: true } });
  assert.deepEqual([r.json.nuevos, r.json.actualizados, r.json.iguales, r.json.simulado], [0, 0, 4, true]);
  const nuevoCsv = `${csv}"IPF",regional,,M,Open,raw,-83,S,190,"Regional Rey",2025-02-02,Reg,,,si\r\n"IPF",marte,,M,Open,raw,-83,S,1,"x",,,,,si\r\n`;
  r = await pedir('/api/records/importar', { metodo: 'POST', cuerpo: { csv: nuevoCsv } });
  assert.deepEqual([r.json.nuevos, r.json.iguales, r.json.erroresTotal], [1, 4, 1]);
  assert.equal((await pedir('/api/records')).json.records.length, 5);
  assert.equal((await pedir('/api/records/importar', { metodo: 'POST', cuerpo: {} })).estado, 400);
  assert.equal((await pedir('/api/records/plantilla.csv')).estado, 200);
  // persistencia atómica
  assert.ok(existsSync(join(datos, 'records.json')) && !existsSync(join(datos, 'records.json.tmp')));
  assert.equal(JSON.parse(readFileSync(join(datos, 'records.json'), 'utf8')).records.length, 5);

  /* ---- récord automático desde la mesa ---- */
  const m = (await pedir('/api/meets', { metodo: 'POST', cuerpo: { nombre: 'Copa Automática', fecha: '2026-03-01', federacion: 'IPF', sede: 'Coliseo', ciudad: 'Cali' } })).json;
  const at = (id, nombre, extra = {}) => ({ id, nombre, sexo: 'M', club: 'Club', division: 'Open', equipamiento: 'raw', peso: 82, clase: '-83', intentos: { S: [{ kg: 207.5, r: null }, { kg: null }, { kg: null }], B: [{ kg: 100 }], D: [{ kg: 150 }] }, ...extra });
  const url = `/api/meets/${m.id}/atletas/pedro`;
  assert.equal((await pedir(url, { metodo: 'PUT', cuerpo: at('pedro', 'Pedro Pérez') })).estado, 200);
  await esperar(50);
  assert.equal((await pedir('/api/records?meetId=' + m.id)).json.records.length, 0, 'solo con intento válido');
  // el mismo guardado sin cambio de decisión no registra
  await pedir(url, { metodo: 'PUT', cuerpo: at('pedro', 'Pedro Pérez') });
  const dec = at('pedro', 'Pedro Pérez'); dec.intentos.S[0].r = 1;
  assert.equal((await pedir(url, { metodo: 'PUT', cuerpo: dec })).estado, 200);
  await esperar(80);
  r = await pedir('/api/records?meetId=' + m.id);
  const nuevos = r.json.records;
  assert.deepEqual(nuevos.map(x => x.nivel).sort(), ['nacional', 'regional'], 'supera el nacional (205) y el regional (190), no el mundial (230)');
  const nac = nuevos.find(x => x.nivel === 'nacional');
  assert.deepEqual([nac.kg, nac.atleta, nac.homologado, nac.meet, nac.fecha], [207.5, 'Pedro Pérez', false, 'Copa Automática', '2026-03-01']);
  assert.deepEqual(nac.historial.map(h => [h.kg, h.atleta]), [[205, 'Nuevo Titular'], [200, 'Juan Récord']], 'quién lo tuvo antes');
  const act = (await pedir(`/api/meets/${m.id}`)).json.actividad.map(x => x.texto);
  assert.ok(act.some(t => /Récord Nacional|Récord nacional/i.test(t)), 'queda en la actividad del meet');
  // repetir el mismo guardado no duplica
  await pedir(url, { metodo: 'PUT', cuerpo: dec }); await esperar(50);
  assert.equal((await pedir('/api/records?meetId=' + m.id)).json.records.length, 2);
  // sin federación en el meet no hay récords
  const sinFed = (await pedir('/api/meets', { metodo: 'POST', cuerpo: { nombre: 'Sin fed', fecha: '2026-03-02' } })).json;
  const d2 = at('pedro', 'Pedro Pérez'); d2.intentos.S[0].r = 1;
  await pedir(`/api/meets/${sinFed.id}/atletas/pedro`, { metodo: 'PUT', cuerpo: d2 }); await esperar(50);
  assert.equal((await pedir('/api/records?meetId=' + sinFed.id)).json.records.length, 0);

  /* ---- perfiles ---- */
  const crearMeet = async (nombre, fecha, atletas, extra = {}) => {
    const mm = (await pedir('/api/meets', { metodo: 'POST', cuerpo: { nombre, fecha, federacion: 'WRPF', ...extra } })).json;
    for (const a of atletas) assert.equal((await pedir(`/api/meets/${mm.id}/atletas/${a.id}`, { metodo: 'PUT', cuerpo: a })).estado, 200);
    return mm;
  };
  const lev = (id, nombre, s, b, d, extra = {}) => at(id, nombre, { intentos: { S: [{ kg: s, r: 1 }], B: [{ kg: b, r: 1 }], D: [{ kg: d, r: 1 }] }, ...extra });
  const mA = await crearMeet('Perfil A', '2025-01-10', [lev('x1', 'Carlos Díaz', 150, 100, 180), lev('y1', 'Carla Díaz', 90, 50, 110, { sexo: 'F' })]);
  const mB = await crearMeet('Perfil B', '2025-06-10', [lev('x2', 'CARLOS  DIAZ', 160, 105, 190)]);
  const mC = await crearMeet('Perfil C', '2026-01-10', [lev('x3', 'Carlos Díaz', 170, 110, 200)]);
  const oculto = await crearMeet('Perfil oculto', '2026-02-10', [lev('x4', 'Carlos Díaz', 300, 300, 300)], { publico: false });
  r = await pedir('/api/atletas?q=diaz');
  assert.equal(r.json.total, 2); assert.equal(r.json.atletas[0].slug, 'carlos-diaz-m'); assert.equal(r.json.atletas[0].meets, 3);
  r = await pedir('/api/atletas/carlos-diaz-m');
  const p = r.json.perfil;
  assert.equal(p.meets, 3, 'los meets no públicos no cuentan'); assert.equal(p.mejores.total.kg, 480); assert.equal(p.mejores.total.meet, 'Perfil C');
  assert.deepEqual(p.progresion.map(x => x.total), [430, 455, 480]);
  assert.deepEqual(p.historial.map(h => h.meetNombre), ['Perfil C', 'Perfil B', 'Perfil A']);
  assert.equal(p.ultimo.anillo.length, 9);
  assert.equal((await pedir('/api/atletas/no-existe-m')).estado, 404);
  assert.equal((await pedir('/api/atletas/NO VALE')).estado, 404);
  // separar un homónimo y volver a fusionarlo (con Deshacer)
  r = await pedir('/api/atletas/asignaciones', { metodo: 'PUT', cuerpo: { set: { [`${mA.id}|x1`]: 'carlos-diaz-2' } } });
  assert.equal(r.estado, 200);
  assert.equal((await pedir('/api/atletas/carlos-diaz-m')).json.perfil.meets, 2);
  assert.equal((await pedir('/api/atletas/carlos-diaz-2')).json.perfil.meets, 1);
  r = await pedir(`/api/atletas/carlos-diaz-m?m=${mA.id}&a=x1`);
  assert.equal(r.json.redirigir, 'carlos-diaz-2', 'el enlace viejo apunta a donde quedó');
  assert.equal((await pedir('/api/atletas/asignaciones', { metodo: 'PUT', cuerpo: { set: { 'malo': 'x' } } })).estado, 400);
  assert.equal((await pedir('/api/atletas/asignaciones', { metodo: 'PUT', cuerpo: { set: { [`${mA.id}|x1`]: 'NO VALE' } } })).estado, 400);
  await pedir('/api/atletas/asignaciones', { metodo: 'PUT', cuerpo: { set: { [`${mA.id}|x1`]: null } } });
  assert.equal((await pedir('/api/atletas/carlos-diaz-m')).json.perfil.meets, 3);
  assert.equal((await pedir('/api/atletas/carlos-diaz-2')).estado, 404);
  // fusionar a Carla (F) con Carlos escribiendo su ficha
  await pedir('/api/atletas/asignaciones', { metodo: 'PUT', cuerpo: { set: { [`${mA.id}|y1`]: 'carlos-diaz-m' } } });
  assert.equal((await pedir('/api/atletas/carlos-diaz-m')).json.perfil.meets, 4);
  assert.ok(existsSync(join(datos, 'atletas.json')));
  void mB; void mC; void oculto;

  /* ---- reiniciar: todo sigue ahí ---- */
  await app.cerrar?.();
} finally {
  try { await app.cerrar?.(); } catch { /* ya cerrado */ }
}
app = crearApp({ datos, web, espera: 20 });
puerto = await app.escuchar(0, '127.0.0.1'); base = `http://127.0.0.1:${puerto}`;
try {
  const tras = (await pedir('/api/records?nivel=nacional&lev=S&sexo=M')).json.records;
  assert.deepEqual([(await pedir('/api/records')).json.records.length, tras[0].kg, tras[0].homologado], [5, 207.5, false], 'la tabla y el récord automático sobreviven al reinicio');
  assert.equal((await pedir('/api/atletas/carlos-diaz-m')).json.perfil.meets, 4, 'las asignaciones sobreviven al reinicio');
} finally { await app.cerrar?.(); rmSync(tmp, { recursive: true, force: true }); }
console.log('records-api: ok');
