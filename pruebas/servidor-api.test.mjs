// API: meets, atletas, listado con estado, CSV, aplausos, canal (votos y SSE por rol), sesión por PIN, export/import.
// Para probar a un cliente que NO es loopback se conecta a la IP de la red local de este equipo (si no hay red, esas partes se omiten).
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearApp } from './_servidor.mjs';
import { ipsLAN } from '../servidor/acceso.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'om-api-'));
const web = join(tmp, 'web'); mkdirSync(web);
writeFileSync(join(web, 'index.html'), '<title>OM</title>');
const app = crearApp({ datos: join(tmp, 'datos'), web, espera: 50 });
const puerto = await app.escuchar(0, '0.0.0.0');
const local = `http://127.0.0.1:${puerto}`;
const lan = ipsLAN()[0] ? `http://${ipsLAN()[0]}:${puerto}` : null;

const pedir = async (base, ruta, { metodo = 'GET', cuerpo, cab = {}, crudo } = {}) => {
  const r = await fetch(base + ruta, { method: metodo, headers: { ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...cab }, body: crudo ?? (cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined) });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = null; }
  return { estado: r.status, cab: r.headers, texto: t, json: j };
};
const org = (ruta, o) => pedir(local, ruta, o);
const hoy = new Date(); const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dias = n => iso(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + n));

try {
  // --- info
  let r = await org('/api/info');
  assert.equal(r.json.app, 'OpenMeets'); assert.equal(r.json.puerto, puerto); assert.equal(r.json.organizador, true); assert.ok(Array.isArray(r.json.ips));

  // --- crear meet y validaciones
  r = await org('/api/meets', { metodo: 'POST', cuerpo: { nombre: 'Copa Ñandú 2026', fecha: dias(10), federacion: 'IPF', formula: 'GL' } });
  assert.equal(r.estado, 201);
  const m = r.json;
  assert.match(m.id, /^copa-nandu-2026-[0-9a-f]{6}$/);
  assert.match(m.privado.codigoJuez, /^\d{6}$/);
  assert.deepEqual(m.plataformas, ['Tarima 1']);
  const id = m.id;
  assert.equal((await org('/api/meets', { metodo: 'POST', cuerpo: { fecha: '2026-01-01' } })).estado, 400, 'sin nombre');
  assert.equal((await org('/api/meets', { metodo: 'POST', cuerpo: { nombre: 'x', fecha: 'mañana' } })).estado, 400, 'fecha mala');
  assert.equal((await org('/api/meets', { metodo: 'POST', crudo: '{"nombre":"x"}', cab: { 'Content-Type': 'text/plain' } })).estado, 415, 'solo JSON');
  assert.equal((await org('/api/meets', { metodo: 'POST', cuerpo: { nombre: 'x' }, cab: { Origin: 'http://malo.example' } })).estado, 403, 'origen ajeno');
  assert.equal((await org('/api/meets', { metodo: 'POST', crudo: 'x'.repeat(300 * 1024), cab: { 'Content-Type': 'application/json' } })).estado, 413, 'tamaño');
  assert.equal((await org('/api/meets', { metodo: 'POST', crudo: '{rota', cab: { 'Content-Type': 'application/json' } })).estado, 400);
  assert.equal((await org('/api/meets/../etc')).estado, 404);
  assert.equal((await org('/api/meets/NO_VALE')).estado, 404);

  // --- listado y estado calculado
  const pasado = (await org('/api/meets', { metodo: 'POST', cuerpo: { nombre: 'Pasado', fecha: dias(-30) } })).json;
  const oculto = (await org('/api/meets', { metodo: 'POST', cuerpo: { nombre: 'Privado', fecha: dias(5), publico: false } })).json;
  r = await org('/api/meets');
  const est = Object.fromEntries(r.json.map(x => [x.id, x.estado]));
  assert.equal(est[id], 'programada'); assert.equal(est[pasado.id], 'terminada'); assert.equal(est[oculto.id], undefined, 'no público no sale');
  assert.deepEqual(Object.keys(r.json[0]).sort(), ['atletas', 'ciudad', 'estado', 'fecha', 'fechaFin', 'federacion', 'id', 'nombre', 'pais', 'plataformas', 'publico', 'sede']);
  assert.equal((await org('/api/meets?todas=1')).json.length, 3, 'el organizador ve todos');

  // --- atletas
  const intentos = {
    S: [{ kg: 200, r: 1 }, { kg: 210, r: -1 }, { kg: 210, r: 1 }],
    B: [{ kg: 120, r: 1 }, { kg: 125, r: 1 }, { kg: 130, r: -1 }],
    D: [{ kg: 230, r: 1 }, { kg: 240, r: 1 }, { kg: 250, r: null }],
  };
  r = await org(`/api/meets/${id}/atletas/ana-1`, { metodo: 'PUT', cuerpo: { nombre: 'Ana', sexo: 'F', club: '=HYPERLINK("x")', division: 'Open', equipamiento: 'raw', peso: 62.4, clase: '63', plataforma: 'Tarima 1', intentos, extra: 'no pasa' } });
  assert.equal(r.estado, 200); assert.equal(r.json.id, 'ana-1'); assert.equal(r.json.extra, undefined);
  r = await org(`/api/meets/${id}/atletas`, { metodo: 'POST', cuerpo: { atletas: [
    { id: 'beto-1', nombre: 'Beto', sexo: 'M', club: 'Club A', peso: 82, clase: '83', intentos: { S: [{ kg: 180, r: 1 }], B: [{ kg: 100, r: 1 }], D: [{ kg: 200, r: 1 }] } },
    { nombre: 'Sin id', sexo: 'M', peso: 90, clase: '93' },
  ] } });
  assert.equal(r.json.atletas, 2);
  assert.equal((await org(`/api/meets/${id}/atletas/..%2Fx`, { metodo: 'PUT', cuerpo: { nombre: 'x' } })).estado, 400);
  assert.equal((await org(`/api/meets/${id}/atletas/Mala_Id`, { metodo: 'PUT', cuerpo: { nombre: 'x' } })).estado, 400);
  assert.equal((await org(`/api/meets/${id}/atletas`, { metodo: 'POST', cuerpo: { atletas: [{ id: 'a' }, { id: 'a' }] } })).estado, 400, 'ids repetidos');
  let g = (await org(`/api/meets/${id}`)).json;
  assert.equal(g.atletas.length, 3);
  assert.equal(g.estado, 'programada');
  assert.ok(g.actividad.length >= 3);
  assert.equal((await org(`/api/meets/${id}/atletas/sin-id`, { metodo: 'DELETE' })).estado, 404);
  const sinId = g.atletas.find(a => a.nombre === 'Sin id');
  assert.match(sinId.id, /^at-/);
  assert.equal((await org(`/api/meets/${id}/atletas/${sinId.id}`, { metodo: 'DELETE' })).estado, 200);

  // --- CSV
  r = await org(`/api/meets/${id}/resultados.csv`);
  assert.match(r.cab.get('content-type'), /text\/csv/);
  assert.ok(r.texto.startsWith('Puesto,Categoría,Nombre,Club'), 'cabecera');
  assert.deepEqual([...new Uint8Array(await (await fetch(local + `/api/meets/${id}/resultados.csv`)).arrayBuffer()).slice(0, 3)], [0xEF, 0xBB, 0xBF], 'BOM para Excel');
  const filas = r.texto.trim().split('\r\n');
  assert.equal(filas.length, 3);
  const cab = filas[0].split(',');
  for (const c of ['S1', 'S3', 'B1', 'D3', 'Total', 'Puntos GL', 'Clase', 'División']) assert.ok(cab.includes(c), c);
  const ana = filas.find(f => f.includes('Ana'));
  assert.ok(ana.startsWith('1,'), 'primera de su categoría');
  assert.ok(ana.includes(',200,-210,210,120,125,-130,230,240,(250),'), 'intentos con su resultado');
  assert.ok(ana.includes(',210,125,240,575,'), 'mejores y total');
  assert.ok(ana.includes(`"'=HYPERLINK`), 'neutraliza fórmulas de Excel');
  assert.match(ana.split(',').pop(), /^\d+(\.\d+)?$/, 'puntos');

  // --- aplausos
  r = await pedir(local, `/api/meets/${id}/aplauso`, { metodo: 'POST', cuerpo: { aid: 'ana-1' } });
  assert.equal(r.estado, 200); assert.equal(r.json.n, 1);
  assert.equal((await pedir(local, `/api/meets/${id}/aplauso`, { metodo: 'POST', cuerpo: { aid: 'ana-1' } })).estado, 429, 'máx. 1 cada 10 s');
  assert.equal((await pedir(local, `/api/meets/${id}/aplauso`, { metodo: 'POST', cuerpo: { aid: 'beto-1' } })).json.n, 1, 'otro atleta sí');
  assert.equal((await pedir(local, `/api/meets/${id}/aplauso`, { metodo: 'POST', cuerpo: { aid: 'nadie' } })).estado, 404);
  assert.equal((await org(`/api/meets/${id}`)).json.aplausos['ana-1'], 1);

  // --- canal: vivo (organizador) y votos con código de jueces
  const codigo = m.privado.codigoJuez;
  const canal = cuerpo => org(`/api/meets/${id}/canal`, { metodo: 'POST', cuerpo });
  assert.equal((await canal({ tipo: 'vivo', plataforma: 'Tarima 1', datos: { version: 2, turno: 't1', actual: { aid: 'ana-1' } } })).estado, 200);
  assert.equal((await canal({ tipo: 'vivo', plataforma: 'Tarima 1', datos: { version: 1, turno: 't0' } })).json.ignorado, true, 'versión vieja se ignora');
  assert.equal((await org(`/api/meets?todas=1`)).json.find(x => x.id === id).estado, 'en-vivo');
  assert.equal((await canal({ tipo: 'voto', voto: { codigo: '000000' === codigo ? '111111' : '000000', plataforma: 'Tarima 1', pos: 'izq', voto: 'blanca' } })).estado, 403, 'código malo');
  const voto = { codigo, plataforma: 'Tarima 1', pos: 'izq', voto: 'blanca', turno: 't1', dispositivo: 'd1' };
  assert.equal((await canal({ tipo: 'voto', voto })).json.ok, true);
  assert.equal((await canal({ tipo: 'voto', voto })).json.repetido, true, 'el primero cuenta');
  assert.equal((await canal({ tipo: 'voto', voto: { ...voto, voto: 'verde', dispositivo: 'd2' } })).estado, 400);
  assert.equal((await canal({ tipo: 'presencia', datos: { codigo, plataforma: 'Tarima 1', pos: 'izq', dispositivo: 'd1', nombre: 'Juez', huella: 'h1', bateria: 80 } })).estado, 200);
  assert.equal((await canal({ tipo: 'nada' })).estado, 400);
  await org(`/api/meets/${id}`, { metodo: 'PATCH', cuerpo: { cerrado: true } });
  assert.equal((await org(`/api/meets?todas=1`)).json.find(x => x.id === id).estado, 'terminada', 'cerrado = terminada');
  await org(`/api/meets/${id}`, { metodo: 'PATCH', cuerpo: { cerrado: false } });

  // --- PATCH
  r = await org(`/api/meets/${id}`, { metodo: 'PATCH', cuerpo: { ciudad: 'Cali', formula: 'DOTS', barra: 25, id: 'otro', atletas: [] } });
  assert.equal(r.json.ciudad, 'Cali'); assert.equal(r.json.formula, 'DOTS'); assert.equal(r.json.id, id); assert.equal(r.json.atletas.length, 2);
  assert.equal((await org(`/api/meets/${id}`, { metodo: 'PATCH', cuerpo: { stream: 'javascript:alert(1)' } })).json.stream, '');

  // --- export / importar / borrar
  const copia = (await org(`/api/meets/${id}/export.json`)).json;
  assert.equal(copia.id, id); assert.ok(copia.privado);
  assert.equal((await org('/api/meets/importar', { metodo: 'POST', cuerpo: copia })).estado, 409, 'ya existe');
  assert.equal((await org('/api/meets/importar?reemplazar=1', { metodo: 'POST', cuerpo: copia })).estado, 201);
  assert.equal((await org('/api/meets/importar', { metodo: 'POST', cuerpo: { id: 'otro-meet', nombre: 'Restaurado', atletas: copia.atletas } })).json.atletas.length, 2);
  assert.equal((await org(`/api/meets/${oculto.id}`, { metodo: 'DELETE' })).estado, 200);
  assert.equal((await org(`/api/meets/${oculto.id}`)).estado, 404);
  assert.ok(readdirSync(join(tmp, 'datos', 'papelera')).some(f => f.startsWith(oculto.id)), 'papelera');

  // --- cambio de PIN
  const pin0 = (await org('/api/pin')).json.pin; assert.match(pin0, /^\d{6}$/);
  assert.equal((await org('/api/pin', { metodo: 'PUT', cuerpo: { pin: 'abc' } })).estado, 400);
  assert.equal((await org('/api/pin', { metodo: 'PUT', cuerpo: { pin: '135790' } })).json.pin, '135790');

  // --- desde otro equipo (no loopback)
  await org('/api/meets/otro-meet', { metodo: 'PATCH', cuerpo: { publico: false } });
  if (lan) {
    r = await pedir(lan, '/api/info'); assert.equal(r.json.organizador, false);
    assert.equal((await pedir(lan, '/api/meets', { metodo: 'POST', cuerpo: { nombre: 'x' } })).estado, 403);
    assert.equal((await pedir(lan, `/api/meets/${id}/atletas/ana-1`, { metodo: 'PUT', cuerpo: { nombre: 'x' } })).estado, 403);
    assert.equal((await pedir(lan, `/api/meets/${id}/export.json`)).estado, 403);
    assert.equal((await pedir(lan, '/api/pin')).estado, 403);
    assert.equal((await pedir(lan, `/api/meets/${id}/canal`, { metodo: 'POST', cuerpo: { tipo: 'vivo', plataforma: 'x', datos: {} } })).estado, 403, 'el vivo es de la mesa');
    assert.equal((await pedir(lan, `/api/meets/${id}/canal`, { metodo: 'POST', cuerpo: { tipo: 'voto', voto: { ...voto, dispositivo: 'tel', pos: 'der' } } })).json.ok, true, 'un juez con código sí puede votar');
    assert.equal((await pedir(lan, `/api/meets/${oculto.id}`)).estado, 404);
    assert.equal((await pedir(lan, '/api/meets?todas=1')).json.length, 2, 'todas=1 no sirve sin ser organizador');
    const pub = (await pedir(lan, `/api/meets/${id}`)).json;
    assert.equal(pub.privado, undefined, 'el público no ve el código de jueces');
    assert.equal(pub.atletas.length, 2);
    assert.equal((await pedir(lan, `/api/meets/${id}/resultados.csv`)).estado, 200);
    assert.equal((await pedir(lan, `/api/meets/${id}/aplauso`, { metodo: 'POST', cuerpo: { aid: 'ana-1' } })).json.n, 2);

    // sesión por PIN: cookie HttpOnly y límite de intentos
    assert.equal((await pedir(lan, '/api/sesion', { metodo: 'POST', cuerpo: { pin: '000000' } })).estado, 401);
    r = await pedir(lan, '/api/sesion', { metodo: 'POST', cuerpo: { pin: '135790' } });
    assert.equal(r.estado, 200);
    const ck = r.cab.get('set-cookie'); assert.match(ck, /om_sesion=/); assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/);
    const cookie = ck.split(';')[0];
    assert.equal((await pedir(lan, '/api/info', { cab: { Cookie: cookie } })).json.organizador, true);
    assert.equal((await pedir(lan, `/api/meets/${id}/export.json`, { cab: { Cookie: cookie } })).estado, 200);
    assert.equal((await pedir(lan, `/api/meets/${id}`, { cab: { Cookie: cookie } })).json.privado.codigoJuez, codigo);
    for (let i = 0; i < 3; i++) await pedir(lan, '/api/sesion', { metodo: 'POST', cuerpo: { pin: '000000' } });
    assert.equal((await pedir(lan, '/api/sesion', { metodo: 'POST', cuerpo: { pin: '135790' } })).estado, 429, 'más de 5 intentos por minuto');

    // --- SSE: el público no recibe votos ni presencia; el organizador sí
    const leerSSE = (base, ruta) => new Promise(ok => {
      const u = new URL(base + ruta); const msgs = [];
      const req = http.get({ host: u.hostname, port: u.port, path: u.pathname }, res => {
        let buf = '';
        res.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n\n')) >= 0) { const bloque = buf.slice(0, i); buf = buf.slice(i + 2); const l = bloque.split('\n').find(x => x.startsWith('data: ')); if (l) msgs.push(JSON.parse(l.slice(6))); } });
        ok({ msgs, cerrar: () => req.destroy() });
      });
    });
    const sPub = await leerSSE(lan, `/api/meets/${id}/canal`);
    const sOrg = await leerSSE(local, `/api/meets/${id}/canal`);
    await new Promise(r2 => setTimeout(r2, 200));
    assert.equal(sPub.msgs[0].tipo, 'meet'); assert.equal(sPub.msgs[0].meet.privado, undefined, 'meet público sin privado');
    assert.equal(sOrg.msgs[0].tipo, 'meet'); assert.ok(sOrg.msgs[0].meet.privado);
    await canal({ tipo: 'vivo', plataforma: 'Tarima 1', datos: { version: 9, turno: 't9', actual: { aid: 'beto-1' } } });
    await canal({ tipo: 'voto', voto: { codigo, plataforma: 'Tarima 1', pos: 'cen', voto: 'roja', turno: 't9', dispositivo: 'd9' } });
    await canal({ tipo: 'presencia', datos: { codigo, plataforma: 'Tarima 1', pos: 'cen', dispositivo: 'd9' } });
    await org(`/api/meets/${id}/atletas/ana-1`, { metodo: 'PUT', cuerpo: { nombre: 'Ana', sexo: 'F', peso: 62.4 } });
    await org(`/api/meets/${id}`, { metodo: 'PATCH', cuerpo: { sede: 'Coliseo', privado: { codigoJuez: '777777' } } });
    await new Promise(r2 => setTimeout(r2, 250));
    const tp = sPub.msgs.map(x => x.tipo), to = sOrg.msgs.map(x => x.tipo);
    assert.deepEqual([...new Set(tp)].sort(), ['atleta', 'meet', 'meet-cambio', 'vivo']);
    assert.ok(to.includes('voto') && to.includes('presencia'), 'la mesa recibe votos y presencia');
    assert.ok(!JSON.stringify(sPub.msgs).includes('777777'), 'el código nuevo no se filtra al público');
    sPub.cerrar(); sOrg.cerrar();
  } else console.log('  (sin red local: se omiten las pruebas de cliente no loopback)');

  // --- guardado en disco tras la espera
  await new Promise(r2 => setTimeout(r2, 200));
  assert.ok(readdirSync(join(tmp, 'datos', 'meets')).some(f => f === `${id}.json`));
  console.log('api: ok');
} finally {
  await app.cerrar();
  rmSync(tmp, { recursive: true, force: true });
}
