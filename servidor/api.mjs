// OpenMeets · rutas /api/*. La validación vive en web/js/nucleo/validar.js (la comparte la versión en la nube) y se reexporta aquí.
import { randomBytes } from 'node:crypto';
import { idSeguro } from './almacen.mjs';
import { cabeceraCookie, COOKIE, leerCookies, iguales, crearLimitador, pinValido } from './acceso.mjs';
import { estadoMeet, resumenMeet, resultadosCSV } from './calculo.mjs';
import {
  LIMITES, MAX_ATLETAS, POS, ErrorApi, mal, txt, num, fecha, objeto, url, limpiarIntento, limpiarAtleta, limpiarCampos, idNuevo, meetNuevo, meetImportado,
  sinPrivado, anotar, limpiarRegie, cambiosDeResultados,
} from '../web/js/nucleo/validar.js';

export { LIMITES, ErrorApi, limpiarIntento, limpiarAtleta, limpiarCampos, idNuevo, meetNuevo, meetImportado, sinPrivado, limpiarRegie };
const vistaMeet = (m, org) => (org ? m : sinPrivado(m));

/* ---------- Cuerpo y respuestas ---------- */
function leerCuerpo(req, limite = LIMITES.normal) {
  return new Promise((ok, no) => {
    const tipo = String(req.headers['content-type'] || '');
    if (!/^application\/json\b/i.test(tipo)) return no(new ErrorApi(415, 'El cuerpo debe ser JSON (Content-Type: application/json)'));
    let n = 0; const trozos = [];
    req.on('data', c => { n += c.length; if (n <= limite) trozos.push(c); });
    req.on('end', () => {
      if (n > limite) return no(new ErrorApi(413, 'La petición es demasiado grande'));
      try { ok(JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}')); } catch { no(new ErrorApi(400, 'JSON no válido')); }
    });
    req.on('error', no);
  });
}
const json = (res, estado, obj, extra = {}) => { res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra }); res.end(JSON.stringify(obj)); };
const ipDe = req => req.socket?.remoteAddress || '?';

/** Origin distinto del Host en una petición que cambia datos = otra página intentando usar este servidor. */
export function origenAjeno(req) {
  const o = req.headers.origin;
  if (!o) return false;
  try { return new URL(o).host !== req.headers.host; } catch { return true; }
}

export function crearApi({ almacen, acceso, tiempo, version = '1.0.0', puerto = () => 0, ips = () => [], extensiones = [], datos = '' }) {
  const aplausos = crearLimitador({ max: 1, ventana: 10000 });

  const meetVisible = (id, org) => {
    const m = almacen.leer(id);
    if (!m || (m.publico === false && !org)) mal(404, 'No encuentro ese meet');
    return m;
  };
  const requiereOrg = org => { if (!org) mal(403, 'Solo el organizador puede hacer esto. Entra con el PIN que muestra la consola.'); };
  const entradas = crearLimitador({ max: 10, ventana: 60000 });
  const guardar = (m, f) => almacen.guardarParcial(m.id, f);

  async function manejar(req, res, u) {
    const metodo = req.method;
    const p = u.pathname.replace(/\/+$/, '') || '/';
    const partes = p.split('/').slice(2).map(s => { try { return decodeURIComponent(s); } catch { return ''; } }); // tras /api
    let org = acceso.esOrganizador(req, partes);
    const escribe = metodo !== 'GET' && metodo !== 'HEAD';
    if (!org && acceso.elevar(req, metodo, partes)) org = true; // rol de equipo con permiso para esta ruta (servidor/federacion.mjs)
    if (escribe && origenAjeno(req)) mal(403, 'Petición de otro origen rechazada');

    /* --- extensiones (servidor/extensiones.mjs): cada una atiende sus rutas y devuelve true --- */
    const ctx = { req, res, u, partes, metodo, org, escribe, almacen, acceso, tiempo, datos, version, json, mal, leerCuerpo, guardar, meetVisible, requiereOrg, ipDe, txt, num, fecha, url, objeto, idSeguro, anotar, sinPrivado };
    for (const ext of extensiones) if (await ext(ctx)) return;

    /* --- info y sesión --- */
    if (partes[0] === 'info' && metodo === 'GET' && partes.length === 1) return json(res, 200, { app: 'OpenMeets', version, puerto: puerto(), ips: ips(), organizador: org });
    if (partes[0] === 'sesion' && partes.length === 1) {
      if (metodo === 'DELETE') { acceso.cerrarSesion(leerCookies(req.headers.cookie)[COOKIE]); return json(res, 200, { ok: true }, { 'Set-Cookie': cabeceraCookie('', { borrar: true }) }); }
      if (metodo !== 'POST') mal(405, 'Método no permitido');
      const b = await leerCuerpo(req, 1024);
      const r = acceso.iniciarSesion(ipDe(req), b?.pin);
      if (r.limitado) mal(429, 'Demasiados intentos. Espera un minuto y vuelve a probar.');
      if (!r.ok) mal(401, 'PIN incorrecto');
      return json(res, 200, { ok: true, organizador: true }, { 'Set-Cookie': cabeceraCookie(r.token) });
    }
    if (partes[0] === 'pin' && partes.length === 1) {
      requiereOrg(org);
      if (metodo === 'GET') return json(res, 200, { ok: true, pin: acceso.pin });
      if (metodo === 'PUT') { const b = await leerCuerpo(req, 1024); if (b?.pin !== undefined && !pinValido(b.pin)) mal(400, 'El PIN debe tener 6 dígitos'); return json(res, 200, { ok: true, pin: acceso.cambiarPin(b?.pin) }, { 'Set-Cookie': cabeceraCookie('', { borrar: true }) }); }
      mal(405, 'Método no permitido');
    }
    if (partes[0] !== 'meets') mal(404, 'Ruta desconocida');

    /* --- /api/meets --- */
    if (partes.length === 1) {
      if (metodo === 'GET') {
        const todas = org && u.searchParams.get('todas') === '1';
        const lista = almacen.listar().filter(m => todas || m.publico !== false)
          .map(m => resumenMeet(m))
          .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
        return json(res, 200, lista);
      }
      if (metodo === 'POST') {
        requiereOrg(org);
        const m = meetNuevo(await leerCuerpo(req), id => almacen.existe(id));
        anotar(m, 'Meet creado');
        almacen.crear(m);
        return json(res, 201, m);
      }
      mal(405, 'Método no permitido');
    }
    if (partes[1] === 'importar' && partes.length === 2) {
      requiereOrg(org);
      if (metodo !== 'POST') mal(405, 'Método no permitido');
      const m = meetImportado(await leerCuerpo(req, LIMITES.importar));
      almacen.importar(m, { reemplazar: u.searchParams.get('reemplazar') === '1' });
      return json(res, 201, m);
    }

    const id = partes[1];
    if (!idSeguro(id)) mal(404, 'No encuentro ese meet');
    const m = meetVisible(id, org);
    const sub = partes[2];

    if (!sub) {
      if (metodo === 'GET') return json(res, 200, { ...vistaMeet(m, org), estado: estadoMeet(m) });
      requiereOrg(org);
      if (metodo === 'PATCH') {
        const c = limpiarCampos(await leerCuerpo(req));
        const { privado, ...publicos } = c;
        const estabaCerrado = !!m.cerrado;
        guardar(m, mm => {
          Object.assign(mm, publicos);
          if (privado) mm.privado = { ...(mm.privado || {}), ...privado };
          if (c.cerrado !== undefined && c.cerrado !== estabaCerrado) anotar(mm, c.cerrado ? 'Meet terminado' : 'Meet reabierto');
        });
        tiempo.emitir(id, { tipo: 'meet-cambio', campos: publicos });
        return json(res, 200, { ...m, estado: estadoMeet(m) });
      }
      if (metodo === 'DELETE') { tiempo.emitir(id, { tipo: 'meet-cambio', campos: { eliminado: true } }); almacen.borrar(id); return json(res, 200, { ok: true }); }
      mal(405, 'Método no permitido');
    }

    if (sub === 'atletas') {
      requiereOrg(org);
      const aid = partes[3];
      if (partes.length === 3 && metodo === 'POST') {
        const b = await leerCuerpo(req, LIMITES.lote);
        if (!Array.isArray(b?.atletas)) mal(400, 'Falta la lista «atletas»');
        const lista = b.atletas.slice(0, MAX_ATLETAS).map(a => limpiarAtleta({ ...a, id: idSeguro(a?.id) ? a.id : `at-${randomBytes(4).toString('hex')}` }));
        if (new Set(lista.map(a => a.id)).size !== lista.length) mal(400, 'Hay atletas con el mismo identificador');
        guardar(m, mm => {
          const por = new Map((mm.atletas || []).map(a => [a.id, a]));
          for (const a of lista) por.set(a.id, a);
          if (por.size > MAX_ATLETAS) mal(400, `Un meet admite hasta ${MAX_ATLETAS} atletas`);
          mm.atletas = [...por.values()];
          anotar(mm, `${lista.length} atletas importados`);
        });
        for (const a of lista) tiempo.emitir(id, { tipo: 'atleta', atleta: a });
        return json(res, 200, { ok: true, atletas: lista.length });
      }
      if (partes.length === 4 && metodo === 'PUT') {
        if (!idSeguro(aid)) mal(400, 'Identificador de atleta no válido');
        const a = limpiarAtleta(await leerCuerpo(req), aid);
        guardar(m, mm => {
          const i = (mm.atletas ||= []).findIndex(x => x.id === aid);
          if (i < 0 && mm.atletas.length >= MAX_ATLETAS) mal(400, `Un meet admite hasta ${MAX_ATLETAS} atletas`);
          if (i < 0) { mm.atletas.push(a); anotar(mm, `${a.nombre || 'Atleta'} se unió al meet`); } else { cambiosDeResultados(mm.atletas[i], a).forEach(t => anotar(mm, t)); mm.atletas[i] = a; }
        });
        tiempo.emitir(id, { tipo: 'atleta', atleta: a });
        return json(res, 200, a);
      }
      if (partes.length === 4 && metodo === 'DELETE') {
        const previo = (m.atletas || []).find(x => x.id === aid);
        if (!previo) mal(404, 'No encuentro ese atleta');
        guardar(m, mm => { mm.atletas = mm.atletas.filter(x => x.id !== aid); delete (mm.aplausos || {})[aid]; anotar(mm, `${previo.nombre || 'Atleta'} salió del meet`); });
        tiempo.emitir(id, { tipo: 'atleta', atleta: { id: aid, eliminado: true } });
        return json(res, 200, { ok: true });
      }
      mal(405, 'Método no permitido');
    }

    if (sub === 'resultados.csv' && metodo === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}-resultados.csv"`, 'Cache-Control': 'no-store' });
      return res.end(resultadosCSV(m));
    }
    if (sub === 'export.json' && metodo === 'GET') {
      requiereOrg(org);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}.json"`, 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(almacen.exportar(id)));
    }

    if (sub === 'aplauso' && metodo === 'POST') {
      const b = await leerCuerpo(req, 1024);
      if (!idSeguro(b?.aid) || !(m.atletas || []).some(a => a.id === b.aid)) mal(404, 'No encuentro ese atleta');
      if (!aplausos.intentar(`${ipDe(req)}|${id}|${b.aid}`)) mal(429, 'Ya aplaudiste hace un momento. Espera unos segundos.');
      let n = 0;
      guardar(m, mm => { mm.aplausos ||= {}; n = mm.aplausos[b.aid] = (mm.aplausos[b.aid] || 0) + 1; });
      tiempo.emitir(id, { tipo: 'aplauso', aid: b.aid, n });
      return json(res, 200, { ok: true, n });
    }

    if (sub === 'canal' && partes.length === 3) {
      if (metodo === 'GET') {
        const inicial = [{ tipo: 'meet', meet: { ...vistaMeet(m, org), estado: estadoMeet(m) } }];
        for (const [plataforma, datos] of Object.entries(m.vivo || {})) inicial.push({ tipo: 'vivo', plataforma, datos });
        for (const [plataforma, datos] of Object.entries(m.regie || {})) inicial.push({ tipo: 'regie', plataforma, datos });
        return tiempo.conectar(id, req, res, org ? 'organizador' : 'publico', inicial);
      }
      if (metodo === 'POST') return await publicar(req, res, m, org);
      mal(405, 'Método no permitido');
    }
    mal(404, 'Ruta desconocida');
  }

  async function publicar(req, res, m, org) {
    const b = await leerCuerpo(req, LIMITES.canal);
    if (!objeto(b)) mal(400, 'Mensaje no válido');
    const id = m.id;
    const codigoOk = c => typeof c === 'string' && c.length > 0 && !!m.privado?.codigoJuez && iguales(c, m.privado.codigoJuez);
    switch (b.tipo) {
      case 'vivo': {
        requiereOrg(org);
        const plataforma = txt(b.plataforma, 40);
        if (!plataforma || !objeto(b.datos)) mal(400, 'Falta la plataforma o los datos del vivo');
        const previo = m.vivo?.[plataforma];
        if (previo && (Number(previo.version) || 0) > (Number(b.datos.version) || 0)) return json(res, 200, { ok: true, ignorado: true });
        guardar(m, mm => { (mm.vivo ||= {})[plataforma] = b.datos; });
        tiempo.limpiarVotos(id, plataforma, b.datos.turno);
        tiempo.emitir(id, { tipo: 'vivo', plataforma, datos: b.datos });
        return json(res, 200, { ok: true });
      }
      case 'regie': {
        requiereOrg(org);
        const plataforma = txt(b.plataforma, 40);
        if (!plataforma || !objeto(b.datos)) mal(400, 'Falta la plataforma o los datos de la regie');
        const datos = limpiarRegie(b.datos);
        guardar(m, mm => { (mm.regie ||= {})[plataforma] = datos; });
        tiempo.emitir(id, { tipo: 'regie', plataforma, datos });
        return json(res, 200, { ok: true });
      }
      case 'limpiar': {
        requiereOrg(org);
        const plataforma = txt(b.plataforma, 40);
        if (!plataforma) mal(400, 'Falta la plataforma');
        tiempo.limpiarVotos(id, plataforma);
        tiempo.emitir(id, { tipo: 'limpiar', plataforma });
        return json(res, 200, { ok: true });
      }
      case 'voto': {
        const v = b.voto;
        if (!objeto(v) || !codigoOk(v.codigo)) mal(403, 'Código de jueces incorrecto');
        if (typeof v.plataforma !== 'string' || !POS.includes(v.pos) || !['blanca', 'roja'].includes(v.voto)) mal(400, 'Voto no válido');
        const tarjetas = Array.isArray(v.tarjetas) ? v.tarjetas.filter(t => ['roja', 'azul', 'amarilla'].includes(t)).slice(0, 3) : [];
        const limpio = { plataforma: txt(v.plataforma, 40), pos: v.pos, voto: v.voto, tarjetas, turno: typeof v.turno === 'string' ? v.turno.slice(0, 80) : null, via: txt(String(v.via || 'local'), 20), dispositivo: txt(v.dispositivo, 40), secreto: txt(v.secreto, 80), ts: num(v.ts, 0, 9e15, Date.now()) };
        const k = `${limpio.plataforma}|${v.pos}|${limpio.dispositivo}`;
        const actual = tiempo.votoDe(id, k);
        if (actual && actual.turno === limpio.turno) return json(res, 200, { ok: true, repetido: true }); // el primero cuenta
        tiempo.guardarVoto(id, k, limpio);
        tiempo.emitir(id, { tipo: 'voto', voto: limpio });
        return json(res, 200, { ok: true });
      }
      case 'presencia': {
        const d = b.datos;
        if (!objeto(d) || !codigoOk(d.codigo)) mal(403, 'Código de jueces incorrecto');
        if (typeof d.plataforma !== 'string' || !POS.includes(d.pos)) mal(400, 'Presencia no válida');
        const limpio = { plataforma: txt(d.plataforma, 40), pos: d.pos, bateria: num(d.bateria, 0, 100), via: txt(String(d.via || 'local'), 20), dispositivo: txt(d.dispositivo, 40), nombre: txt(d.nombre, 60), huella: txt(d.huella, 80), ts: Date.now() };
        tiempo.guardarPresencia(id, `${limpio.plataforma}|${d.pos}|${limpio.dispositivo}`, limpio);
        if (limpio.huella) guardar(m, mm => {
          const c = ((mm.privado ||= {}).juecesConocidos ||= {});
          if (c[limpio.huella] || Object.keys(c).length < 50) c[limpio.huella] = { pos: d.pos, nombre: limpio.nombre, ts: limpio.ts };
        });
        tiempo.emitir(id, { tipo: 'presencia', datos: limpio });
        return json(res, 200, { ok: true });
      }
      default: mal(400, 'Tipo de mensaje desconocido');
    }
  }

  /** Devuelve true si la petición era de la API (y ya se respondió). */
  return async function api(req, res, u) {
    if (!u.pathname.startsWith('/api/') && u.pathname !== '/api') return false;
    try { await manejar(req, res, u); } catch (e) {
      if (res.headersSent) { try { res.end(); } catch { /* ya cerrada */ } return true; }
      const estado = e instanceof ErrorApi || e.estado ? e.estado : 500;
      if (estado === 500) console.error('Error en la API:', e);
      json(res, estado, { ok: false, error: estado === 500 ? 'Error interno del servidor' : e.message });
    }
    return true;
  };
}
