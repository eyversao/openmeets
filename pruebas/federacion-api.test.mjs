// Federación (API): crear accesos, entrar con PIN desde otro equipo, permisos por rol, límites, auditoría y OpenPowerlifting.
// Los roles de equipo solo existen fuera de loopback, así que se prueba contra la IP de la red local (sin red, esa parte se omite).
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearApp } from './_servidor.mjs';
import { ipsLAN } from '../servidor/acceso.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'om-fedapi-'));
const web = join(tmp, 'web'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<title>OM</title>');
const app = crearApp({ datos: join(tmp, 'datos'), web, espera: 20 });
const puerto = await app.escuchar(0, '0.0.0.0');
const local = `http://127.0.0.1:${puerto}`;
const lan = ipsLAN()[0] ? `http://${ipsLAN()[0]}:${puerto}` : null;

const pedir = async (base, ruta, { metodo = 'GET', cuerpo, cookie } = {}) => {
  const r = await fetch(base + ruta, { method: metodo, headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* no es JSON */ }
  return { estado: r.status, json, texto, cab: r.headers };
};
const org = (ruta, o) => pedir(local, ruta, o);
const intento = (kg, r = null) => ({ kg, r, rec: false, alFinal: false });
const atleta = (id, nombre, plataforma, o = {}) => ({ id, nombre, sexo: 'M', club: 'Club', division: 'Open', equipamiento: 'raw', peso: 82, clase: '-83', plataforma, sesion: '1', grupo: 'A', lote: 1, rack: { S: 4, B: 2 },
  intentos: { S: [intento(100), intento(110), intento(120)], B: [intento(80), intento(85), intento(90)], D: [intento(120), intento(130), intento(140)] }, ...o });

try {
  const meet = (await org('/api/meets', { metodo: 'POST', cuerpo: { nombre: 'Nacional 2026', fecha: '2026-09-01', federacion: 'IPF', ciudad: 'Cali', pais: 'Colombia', plataformas: ['Tarima 1', 'Tarima 2'] } })).json;
  const id = meet.id, base = `/api/meets/${id}`;
  await org(`${base}/atletas/a1`, { metodo: 'PUT', cuerpo: atleta('a1', 'Ana Uno', 'Tarima 1') });
  await org(`${base}/atletas/a2`, { metodo: 'PUT', cuerpo: atleta('a2', 'Beto Dos', 'Tarima 2') });

  /* ---- crear accesos: solo el organizador, validaciones ---- */
  const nuevo = async o => { const r = await org(`${base}/roles`, { metodo: 'POST', cuerpo: o }); assert.equal(r.estado, 201, r.texto); assert.match(r.json.pin, /^\d{6}$/); return r.json; };
  assert.equal((await org(`${base}/roles`, { metodo: 'POST', cuerpo: { nombre: 'X', rol: 'mesa' } })).estado, 400, 'la mesa necesita plataforma');
  assert.equal((await org(`${base}/roles`, { metodo: 'POST', cuerpo: { nombre: 'X', rol: 'rey' } })).estado, 400, 'rol desconocido');
  assert.equal((await org(`${base}/roles`, { metodo: 'POST', cuerpo: { nombre: 'X', rol: 'mesa', plataforma: 'Tarima 9' } })).estado, 400, 'plataforma inexistente');
  assert.equal((await org(`${base}/roles`, { metodo: 'POST', cuerpo: { rol: 'lectura' } })).estado, 400, 'sin nombre');
  const mesa = await nuevo({ nombre: 'Ana Mesa', rol: 'mesa', plataforma: 'Tarima 1', horas: 6 });
  const pesaje = await nuevo({ nombre: 'Pedro Pesaje', rol: 'pesaje' });
  const director = await nuevo({ nombre: 'Diana Directora', rol: 'director' });
  const lectura = await nuevo({ nombre: 'Lola Lectura', rol: 'lectura' });
  const locutor = await nuevo({ nombre: 'Lucho Locutor', rol: 'locutor' });
  const lista = (await org(`${base}/roles`)).json.roles;
  assert.equal(lista.length, 5); assert.ok(!JSON.stringify(lista).match(/hash|sal"|"pin"/), 'la lista no trae hash ni PIN');
  assert.ok(!readFileSync(join(tmp, 'datos', 'roles.json'), 'utf8').includes(mesa.pin), 'el PIN no está en disco');

  if (!lan) { console.log('federacion-api: sin red local, se omite la parte de roles'); } else {
    const ext = (ruta, o) => pedir(lan, ruta, o);
    // el organizador de verdad solo es loopback o PIN: desde la LAN no se pueden crear accesos
    assert.equal((await ext(`${base}/roles`, { metodo: 'POST', cuerpo: { nombre: 'Colado', rol: 'director' } })).estado, 403);
    assert.equal((await ext('/api/rol')).json.rol, null);
    const entrar = async (r, extra = {}) => { const x = await ext('/api/rol/entrar', { metodo: 'POST', cuerpo: { pin: r.pin, ...extra } }); return { ...x, cookie: (x.cab.get('set-cookie') || '').split(';')[0] }; };

    const eMesa = await entrar(mesa, { id: mesa.rol.id });
    assert.equal(eMesa.estado, 200); assert.match(eMesa.cab.get('set-cookie'), /om_rol=[0-9a-f]+; HttpOnly; SameSite=Strict/);
    const ePes = await entrar(pesaje), eDir = await entrar(director), eLec = await entrar(lectura);
    assert.deepEqual([ePes.json.rol, eDir.json.rol, eLec.json.rol], ['pesaje', 'director', 'lectura']);
    assert.deepEqual((await ext('/api/rol', { cookie: eMesa.cookie })).json, { ok: true, rol: 'mesa', meetId: id, plataforma: 'Tarima 1', nombre: 'Ana Mesa' });
    assert.equal((await ext('/api/info', { cookie: eMesa.cookie })).json.organizador, false, 'un rol no es organizador');

    /* ---- límites: el quinto intento cuenta, el sexto se bloquea (5 por minuto y por IP) ---- */
    assert.equal((await entrar({ pin: mesa.pin === '000000' ? '111111' : '000000' })).estado, 401, 'PIN equivocado');
    assert.equal((await entrar(locutor)).estado, 429, 'demasiados intentos');

    /* ---- mesa de la plataforma 1 ---- */
    const c = eMesa.cookie;
    const a1 = (await ext(`${base}`, { cookie: c })).json.atletas.find(a => a.id === 'a1');
    assert.ok((await ext(base, { cookie: c })).json.privado?.codigoJuez, 'la mesa ve el código de jueces');
    const marcado = JSON.parse(JSON.stringify(a1)); marcado.intentos.S[0].r = 1; marcado.nombre = 'Hackeado'; marcado.peso = 200;
    let r = await ext(`${base}/atletas/a1`, { metodo: 'PUT', cuerpo: marcado, cookie: c });
    assert.equal(r.estado, 200, r.texto);
    assert.equal(r.json.intentos.S[0].r, 1); assert.equal(r.json.nombre, 'Ana Uno', 'la mesa no cambia el nombre'); assert.equal(r.json.peso, 82, 'ni el peso corporal');
    assert.equal(app.almacen.leer(id).atletas.find(a => a.id === 'a1').intentos.S[0].r, 1, 'guardado de verdad (el cuerpo llegó al núcleo)');
    const a2 = app.almacen.leer(id).atletas.find(a => a.id === 'a2');
    r = await ext(`${base}/atletas/a2`, { metodo: 'PUT', cuerpo: a2, cookie: c });
    assert.equal(r.estado, 403); assert.match(r.json.error, /Tarima 1/, 'la mesa de la 1 no escribe en la 2');
    assert.equal((await ext(`${base}/atletas/nuevo1`, { metodo: 'PUT', cuerpo: atleta('nuevo1', 'Intruso', 'Tarima 1'), cookie: c })).estado, 403, 'no crea atletas');
    assert.equal((await ext(`${base}/canal`, { metodo: 'POST', cookie: c, cuerpo: { tipo: 'vivo', plataforma: 'Tarima 1', datos: { version: 1, turno: 'a1_S_1', lev: 'S', actual: { aid: 'a1', nombre: 'Ana Uno', kg: 110, n: 1 }, ts: Date.now() } } })).estado, 200, 'canal de su plataforma');
    assert.equal((await ext(`${base}/canal`, { metodo: 'POST', cookie: c, cuerpo: { tipo: 'vivo', plataforma: 'Tarima 2', datos: { version: 1 } } })).estado, 403, 'canal de otra plataforma');
    assert.equal((await ext(`${base}/canal`, { metodo: 'POST', cookie: c, cuerpo: { tipo: 'limpiar', plataforma: 'Tarima 2' } })).estado, 403);
    assert.equal((await ext(`${base}/canal`, { metodo: 'POST', cookie: c, cuerpo: { tipo: 'limpiar', plataforma: 'Tarima 1' } })).estado, 200);
    assert.equal((await ext(base, { metodo: 'PATCH', cuerpo: { nombre: 'Robado' }, cookie: c })).estado, 403, 'la mesa no cambia el meet');
    assert.equal((await ext(`${base}/atletas/a1`, { metodo: 'DELETE', cookie: c })).estado, 403);
    assert.equal((await ext('/api/pin', { cookie: c })).estado, 403, 'ni ve el PIN del organizador');
    assert.equal((await ext(`${base}/roles`, { cookie: c })).estado, 403);
    assert.equal((await ext(`${base}/auditoria`, { cookie: c })).estado, 403);

    /* ---- pesaje ---- */
    const cp = ePes.cookie;
    const pes = JSON.parse(JSON.stringify(app.almacen.leer(id).atletas.find(a => a.id === 'a2'))); pes.peso = 81.6; pes.intentos.S[0].kg = 105;
    r = await ext(`${base}/atletas/a2`, { metodo: 'PUT', cuerpo: pes, cookie: cp });
    assert.equal(r.estado, 200, r.texto); assert.equal(r.json.peso, 81.6); assert.equal(r.json.intentos.S[0].kg, 105);
    const cambiaR = JSON.parse(JSON.stringify(pes)); cambiaR.intentos.S[0].r = 1;
    r = await ext(`${base}/atletas/a2`, { metodo: 'PUT', cuerpo: cambiaR, cookie: cp });
    assert.equal(r.estado, 403); assert.match(r.json.error, /resultados/);
    assert.equal((await ext(`${base}/canal`, { metodo: 'POST', cookie: cp, cuerpo: { tipo: 'limpiar', plataforma: 'Tarima 1' } })).estado, 403, 'pesaje no toca el canal');
    assert.equal((await ext(base, { metodo: 'PATCH', cuerpo: { nombre: 'Robado' }, cookie: cp })).estado, 403);

    /* ---- solo lectura: ve lo público y nada más ---- */
    const cl = eLec.cookie;
    assert.equal((await ext(base, { cookie: cl })).json.privado, undefined, 'sin bloque privado');
    assert.equal((await ext(`${base}/atletas/a1`, { metodo: 'PUT', cuerpo: a1, cookie: cl })).estado, 403);
    assert.equal((await ext(`${base}/canal`, { metodo: 'POST', cookie: cl, cuerpo: { tipo: 'limpiar', plataforma: 'Tarima 1' } })).estado, 403);

    /* ---- director: todo su meet menos borrarlo y los accesos ---- */
    const cd = eDir.cookie;
    assert.equal((await ext(base, { metodo: 'PATCH', cuerpo: { sede: 'Coliseo' }, cookie: cd })).estado, 200);
    assert.equal((await ext(`${base}/atletas/a2`, { metodo: 'PUT', cuerpo: { ...pes, club: 'Nuevo club' }, cookie: cd })).json.club, 'Nuevo club');
    assert.equal((await ext(base, { metodo: 'DELETE', cookie: cd })).estado, 403, 'el director no borra el meet');
    assert.equal((await ext(`${base}/roles`, { metodo: 'POST', cookie: cd, cuerpo: { nombre: 'Otro', rol: 'director' } })).estado, 403, 'ni crea accesos');
    assert.equal((await ext('/api/pin', { cookie: cd })).estado, 403);

    /* ---- auditoría ---- */
    await new Promise(ok => setTimeout(ok, 100));
    let aud = (await org(`${base}/auditoria`)).json.entradas;
    assert.ok(aud.some(e => e.quien === 'Ana Mesa (Mesa)' && /Ana Uno: S1 resultado —→válido/.test(e.resumen)), JSON.stringify(aud.slice(0, 3)));
    assert.ok(aud.some(e => e.quien === 'Pedro Pesaje (Pesaje)' && /peso 82→81.6/.test(e.resumen)));
    assert.ok(aud.some(e => e.quien === 'Diana Directora (Director técnico)' && /sede/.test(e.resumen)));
    assert.ok(aud.some(e => e.quien === 'Organizador' && /Creó un acceso de mesa para Ana Mesa/.test(e.resumen)));
    assert.ok(aud.some(e => /Tarima 1: en tarima Ana Uno, 110 kg \(S2\)/.test(e.resumen)), 'el turno del canal queda anotado');
    assert.ok(!aud.some(e => /Hackeado|Robado/.test(JSON.stringify(e))), 'lo rechazado no se anota');
    assert.ok(!/"ip"|\d+\.\d+\.\d+\.\d+/.test(JSON.stringify(aud)), 'sin IP ni datos de contacto');
    assert.ok(readFileSync(join(tmp, 'datos', 'auditoria', `${id}.jsonl`), 'utf8').trim().split('\n').length >= 6);
    assert.ok((await org(`${base}/auditoria?quien=pesaje`)).json.entradas.every(e => /Pesaje/.test(e.quien)), 'filtro por quién');
    assert.ok((await org(`${base}/auditoria?q=sede`)).json.entradas.length >= 1);
    assert.equal((await org(`${base}/auditoria?desde=${Date.now() + 99999}`)).json.entradas.length, 0, 'filtro por fecha');
    assert.equal((await ext(`${base}/auditoria`, { cookie: cd })).estado, 200, 'el director ve la auditoría');
    const csv = await org(`${base}/auditoria.csv`);
    assert.match(csv.cab.get('content-type'), /text\/csv/); assert.match(csv.texto, /Fecha,Quién,Rol,Resumen/); assert.match(csv.texto, /Ana Mesa/);

    /* ---- revocar corta el acceso al instante ---- */
    assert.equal((await org(`${base}/roles/${mesa.rol.id}`, { metodo: 'DELETE' })).estado, 200);
    assert.equal((await ext(`${base}/atletas/a1`, { metodo: 'PUT', cuerpo: a1, cookie: c })).estado, 403);
    assert.equal((await ext('/api/rol', { cookie: c })).json.rol, null);
    assert.equal((await org(`${base}/roles`)).json.roles.find(x => x.id === mesa.rol.id).estado, 'revocado');
    // salir
    const salida = await ext('/api/rol/salir', { metodo: 'POST', cookie: cd });
    assert.match(salida.cab.get('set-cookie'), /Max-Age=0/);
    assert.equal((await ext('/api/rol', { cookie: cd })).json.rol, null, 'salir cierra la sesión también en el servidor');
    // privado: el locutor no necesita sesión de servidor; lo público es público
    r = await ext(`${base}/locutor`);
    assert.equal(r.estado, 200); assert.deepEqual(Object.keys(r.json.marcas).sort(), ['a1', 'a2']);
  }

  /* ---- OpenPowerlifting: público ---- */
  const opl = await org(`${base}/openpowerlifting.csv`);
  assert.equal(opl.estado, 200); assert.match(opl.cab.get('content-type'), /text\/csv/);
  const [cab, ...filas] = opl.texto.trim().split('\r\n');
  assert.ok(cab.startsWith('Name,Sex,Event,Equipment,Age,Division,BodyweightKg,WeightClassKg,Squat1Kg')); assert.ok(cab.endsWith('MeetCountry,MeetState,MeetTown,MeetName'));
  assert.equal(filas.length, 2); assert.ok(filas[0].includes('Nacional 2026') && filas[0].includes('Cali'));
  assert.equal((await org('/api/meets/no-existe/openpowerlifting.csv')).estado, 404);
  if (lan) assert.equal((await pedir(lan, `${base}/openpowerlifting.csv`)).estado, 200);
  console.log('federacion-api OK');
} finally { await app.cerrar(); rmSync(tmp, { recursive: true, force: true }); }
