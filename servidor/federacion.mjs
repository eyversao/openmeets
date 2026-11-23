// OpenMeets · modo federación: accesos de equipo con PIN propio (director, mesa, pesaje, locutor, solo lectura),
// auditoría de cada escritura, datos para el locutor y exportación al formato de OpenPowerlifting.
// Los roles no reescriben api.mjs: acceso.elevar() deja pasar como organizador SOLO las rutas que su rol permite,
// y este módulo (que va primero) filtra el cuerpo de las escrituras de mesa y pesaje antes de que llegue al núcleo.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { crearLimitador, leerCookies, pinAleatorio, pinValido } from './acceso.mjs';
import { limpiarAtleta, ErrorApi, LIMITES } from './api.mjs';
import { celda } from './calculo.mjs';
import { openPowerliftingCSV } from './openpowerlifting.mjs';
import { mejor, total, ORDEN_LEV, normalizarNombre } from '../web/js/nucleo/competencia.js';

export const COOKIE_ROL = 'om_rol';
export const ROLES = ['director', 'mesa', 'pesaje', 'locutor', 'lectura'];
export const NOMBRE_ROL = { director: 'Director técnico', mesa: 'Mesa', pesaje: 'Pesaje', locutor: 'Locutor', lectura: 'Solo lectura' };
const MAX_ROLES = 100;
const mal = (estado, texto) => { throw new ErrorApi(estado, texto); };
const clonar = x => JSON.parse(JSON.stringify(x));
const NOMBRE_LEV = { S: 'sentadilla', B: 'banca', D: 'peso muerto' };

/* ====================== Roles: almacén con hash scrypt ====================== */

const hashPin = (pin, sal) => scryptSync(String(pin), Buffer.from(sal, 'hex'), 32);
const coincide = (r, pin) => { const a = hashPin(pin, r.sal), b = Buffer.from(r.hash, 'hex'); return a.length === b.length && timingSafeEqual(a, b); };

/** Almacén de accesos de equipo (<datos>/roles.json). El PIN no se guarda: solo su hash scrypt con sal propia. */
export function crearRoles({ dir, ahora = Date.now } = {}) {
  mkdirSync(dir, { recursive: true });
  const archivo = join(dir, 'roles.json');
  let lista = [];
  try { const j = JSON.parse(readFileSync(archivo, 'utf8')); if (Array.isArray(j?.roles)) lista = j.roles; } catch { lista = []; }
  const guardar = () => { const tmp = `${archivo}.tmp`; writeFileSync(tmp, JSON.stringify({ version: 1, roles: lista }, null, 1)); renameSync(tmp, archivo); };
  const activo = r => !r.revocado && r.caduca > ahora();
  const sesiones = new Map(); // token → id del acceso (en memoria: al reiniciar el servidor se vuelve a entrar con el PIN)
  const publico = r => ({ id: r.id, meetId: r.meetId, nombre: r.nombre, rol: r.rol, plataforma: r.plataforma, creado: r.creado, caduca: r.caduca, estado: r.revocado ? 'revocado' : r.caduca <= ahora() ? 'caducado' : 'activo' });

  return {
    /** Crea un acceso y devuelve { rol, pin }: el PIN solo se ve esta vez. */
    crear({ meetId, nombre, rol, plataforma = '', horas = 48 }) {
      if (lista.length >= MAX_ROLES) mal(400, `Hay demasiados accesos en este servidor (máximo ${MAX_ROLES}). Revoca los que ya no uses.`);
      let pin = pinAleatorio();
      for (let i = 0; i < 30 && lista.some(r => activo(r) && coincide(r, pin)); i++) pin = pinAleatorio(); // dos accesos activos nunca comparten PIN
      const sal = randomBytes(16).toString('hex');
      const r = { id: `r-${randomBytes(5).toString('hex')}`, meetId, nombre, rol, plataforma, sal, hash: hashPin(pin, sal).toString('hex'), creado: ahora(), caduca: ahora() + horas * 3600000, revocado: false };
      lista.push(r); guardar();
      return { rol: publico(r), pin };
    },
    /** Comprueba el PIN (con `id` solo ese acceso; sin él, todos los activos). Recorre todos los candidatos sin cortar al primero. */
    verificar(pin, id) {
      if (!pinValido(pin)) return null;
      let hallado = null;
      for (const r of lista) if ((!id || r.id === id) && activo(r) && coincide(r, pin) && !hallado) hallado = r;
      return hallado;
    },
    abrirSesion(r) { const token = randomBytes(24).toString('hex'); sesiones.set(token, r.id); return token; },
    cerrarSesion(token) { sesiones.delete(token); },
    /** El acceso activo de una cookie, o null (y la sesión se borra si el acceso caducó o se revocó). */
    deToken(token) {
      const id = token && sesiones.get(token);
      const r = id && lista.find(x => x.id === id);
      if (r && activo(r)) return r;
      if (token) sesiones.delete(token);
      return null;
    },
    revocar(meetId, id) {
      const r = lista.find(x => x.id === id && x.meetId === meetId);
      if (!r) return null;
      r.revocado = true; guardar();
      for (const [t, rid] of sesiones) if (rid === id) sesiones.delete(t);
      return publico(r);
    },
    listar(meetId) { return lista.filter(r => r.meetId === meetId).map(publico).sort((a, b) => b.creado - a.creado); },
    publico,
    get cantidad() { return lista.length; },
  };
}

/* ====================== Permisos por rol ====================== */

/**
 * ¿Esta ruta pasa como organizador para este rol? `p` = { rol, meetId, plataforma }; `partes` = ruta tras /api.
 * Director: todo su meet menos borrarlo. Mesa: leer el meet y el canal, publicar en el canal y escribir atletas (el cuerpo se filtra aparte).
 * Pesaje: leer el meet y escribir atletas (filtrado). Locutor y lectura: nada (ven lo público).
 */
export function elevaPara(p, metodo, partes) {
  if (!p || partes[0] !== 'meets' || partes[1] !== p.meetId || partes[2] === 'importar') return false;
  const n = partes.length, sub = partes[2];
  if (sub === 'roles') return false; // los accesos solo los gestiona el organizador de verdad
  if (p.rol === 'director') return !(metodo === 'DELETE' && n === 2);
  if (p.rol === 'mesa') return (metodo === 'GET' && (n === 2 || (sub === 'canal' && n === 3))) || (sub === 'canal' && metodo === 'POST' && n === 3) || (sub === 'atletas' && metodo === 'PUT' && n === 4);
  if (p.rol === 'pesaje') return (metodo === 'GET' && n === 2) || (sub === 'atletas' && metodo === 'PUT' && n === 4);
  return false;
}

/**
 * Lo que un rol puede cambiar de un atleta. Devuelve el atleta ya fusionado con lo permitido; lanza 403 si intenta más.
 * Mesa: solo los intentos (pesos y resultados). Pesaje: peso corporal, clase, rack y la apertura de intentos sin resultado.
 */
export function fusionarAtleta(rol, prev, nuevo) {
  const sal = clonar(prev);
  if (rol === 'mesa') { sal.intentos = clonar(nuevo.intentos); return sal; }
  if (rol === 'pesaje') {
    sal.peso = nuevo.peso; sal.clase = nuevo.clase; sal.rack = clonar(nuevo.rack);
    for (const l of ORDEN_LEV) {
      const antes = prev.intentos?.[l] || [], ahora = nuevo.intentos?.[l] || [];
      for (let n = 0; n < Math.max(antes.length, ahora.length); n++) {
        const a = antes[n], b = ahora[n];
        if ((a?.r ?? null) !== (b?.r ?? null)) mal(403, 'Con el rol de pesaje no puedes cambiar resultados. Pídeselo a la mesa.');
        if (!a && b && b.kg > 0) (sal.intentos[l] ||= [])[n] = { kg: b.kg, r: null, rec: false, alFinal: false };
        else if (a && a.r === null && b) sal.intentos[l][n].kg = b.kg;
      }
    }
    return sal;
  }
  mal(403, 'Tu rol no puede escribir atletas');
}

/** Lee el cuerpo SIN consumirlo (lo devuelve a la petición para que el núcleo lo vuelva a leer). */
export async function espiarCuerpo(req, limite = LIMITES.normal, { reponer = true } = {}) {
  if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) throw new ErrorApi(415, 'El cuerpo debe ser JSON (Content-Type: application/json)');
  const largo = Number(req.headers['content-length']);
  if (!Number.isFinite(largo) || largo < 0) throw new ErrorApi(411, 'Falta la longitud de la petición');
  if (largo > limite) throw new ErrorApi(413, 'La petición es demasiado grande');
  const trozos = []; let n = 0;
  if (largo > 0) await new Promise((ok, no) => {
    const leer = () => { let c; while (n < largo && (c = req.read()) !== null) { trozos.push(c); n += c.length; } if (n >= largo) fin(); };
    const fin = () => { req.off('readable', leer); req.off('error', no); req.off('end', fin); ok(); };
    req.on('readable', leer); req.on('error', no); req.on('end', fin);
    leer();
  });
  const buf = Buffer.concat(trozos);
  if (buf.length && reponer) req.unshift(buf);
  try { return { buf, json: JSON.parse(buf.toString('utf8') || '{}') }; } catch { throw new ErrorApi(400, 'JSON no válido'); }
}

/* ====================== Auditoría ====================== */

const etiquetaR = r => (r === 1 ? 'válido' : r === -1 ? 'nulo' : '—');
const CAMPOS_ATLETA = ['nombre', 'sexo', 'nacimiento', 'club', 'division', 'equipamiento', 'peso', 'clase', 'plataforma', 'sesion', 'grupo', 'lote'];

/** Diferencias entre dos versiones de un atleta: [{ campo, antes, despues }]. Sin notas ni datos de contacto. */
export function cambiosAtleta(prev, nuevo) {
  const out = [];
  const ver = v => (v === null || v === undefined || v === '' ? '—' : String(v));
  const cmp = (campo, a, b) => { if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push({ campo, antes: ver(a), despues: ver(b) }); };
  for (const c of CAMPOS_ATLETA) cmp(c, prev?.[c], nuevo?.[c]);
  for (const l of ['S', 'B']) cmp(`rack ${l}`, prev?.rack?.[l], nuevo?.rack?.[l]);
  for (const l of ORDEN_LEV) for (let n = 0; n < 4; n++) {
    const a = prev?.intentos?.[l]?.[n], b = nuevo?.intentos?.[l]?.[n];
    if (!a && !b) continue;
    cmp(`${l}${n + 1} kg`, a?.kg, b?.kg);
    if ((a?.r ?? null) !== (b?.r ?? null)) out.push({ campo: `${l}${n + 1} resultado`, antes: etiquetaR(a?.r), despues: etiquetaR(b?.r) });
    cmp(`${l}${n + 1} récord`, a?.rec || false, b?.rec || false);
  }
  return out;
}

const resumenCambios = cs => cs.slice(0, 4).map(c => `${c.campo} ${c.antes}→${c.despues}`).join(', ') + (cs.length > 4 ? ` y ${cs.length - 4} más` : '');
const CAMPOS_MEET_OCULTOS = new Set(['atletas', 'vivo', 'aplausos', 'actividad', 'privado', 'actualizado', 'estado']);

/** Foto previa de lo que va a tocar una escritura (la comparación se hace al terminar). */
export function instantanea(m, metodo, partes) {
  const sub = partes[2];
  if (!sub) return { tipo: 'meet', campos: Object.fromEntries(Object.entries(m).filter(([k]) => !CAMPOS_MEET_OCULTOS.has(k)).map(([k, v]) => [k, clonar(v ?? null)])), codigo: m.privado?.codigoJuez };
  if (sub === 'atletas') {
    if (partes.length === 4) return { tipo: 'atleta', aid: partes[3], antes: clonar((m.atletas || []).find(a => a.id === partes[3]) || null) };
    return { tipo: 'lote', n: (m.atletas || []).length };
  }
  if (sub === 'canal') return { tipo: 'canal', vivos: Object.fromEntries(Object.entries(m.vivo || {}).map(([p, v]) => [p, { turno: v?.turno || null, lucesTs: v?.lucesTs || null }])) };
  return { tipo: 'otro' };
}

/** Compara la foto con el meet ya cambiado y devuelve las entradas de auditoría (vacío si no hubo nada que anotar). */
export function resumirEscritura(snap, m, metodo, partes) {
  const sub = partes[2];
  const corto = v => { const t = typeof v === 'string' ? v : JSON.stringify(v); return t.length > 80 ? `${t.slice(0, 77)}…` : t; };
  if (snap.tipo === 'meet') {
    if (metodo === 'DELETE') return [{ resumen: 'Borró el meet (queda en la papelera)' }];
    const cambios = Object.entries(m).filter(([k]) => !CAMPOS_MEET_OCULTOS.has(k) && JSON.stringify(m[k] ?? null) !== JSON.stringify(snap.campos[k] ?? null)).map(([k, v]) => ({ campo: k, antes: corto(snap.campos[k] ?? '—'), despues: corto(v ?? '—') }));
    if (m.privado?.codigoJuez !== snap.codigo) cambios.push({ campo: 'código de jueces', antes: '***', despues: '***' });
    return cambios.length ? [{ resumen: `Cambió el meet: ${resumenCambios(cambios)}`, cambios }] : [];
  }
  if (snap.tipo === 'atleta') {
    const ahora = (m.atletas || []).find(a => a.id === snap.aid) || null;
    const nombre = (ahora || snap.antes)?.nombre || snap.aid;
    if (metodo === 'DELETE') return snap.antes ? [{ resumen: `Quitó a ${nombre} del meet` }] : [];
    if (!snap.antes && ahora) return [{ resumen: `Añadió a ${nombre}` }];
    const cambios = cambiosAtleta(snap.antes, ahora);
    return cambios.length ? [{ resumen: `${nombre}: ${resumenCambios(cambios)}`, cambios }] : [];
  }
  if (snap.tipo === 'lote') { const ahora = (m.atletas || []).length; return [{ resumen: `Importó atletas (${snap.n} → ${ahora} en el meet)` }]; }
  if (snap.tipo === 'canal') {
    const out = [];
    for (const [p, v] of Object.entries(m.vivo || {})) {
      const antes = snap.vivos[p] || {};
      if (v?.turno && v.turno !== antes.turno && v.actual) out.push({ resumen: `${p}: en tarima ${v.actual.nombre}, ${v.actual.kg} kg (${(v.lev || '').toUpperCase()}${Number(v.actual.n) + 1})` });
      if (v?.lucesTs && v.lucesTs !== antes.lucesTs && v.luces?.resultado) out.push({ resumen: `${p}: ${v.juzgado?.nombre || 'atleta'} ${v.juzgado?.kg ?? ''} kg, ${etiquetaR(v.luces.resultado)}` });
    }
    return out;
  }
  if (sub === 'roles' || sub === 'aplauso') return [];
  return [{ resumen: `${metodo} /${partes.slice(2).join('/')}` }];
}

/* ====================== Marcas personales (para el locutor) ====================== */

/** { [aid]: { total, S, B, D, meets, fechaTotal, meetTotal } | null } buscando el nombre en meets anteriores (un índice por meet). */
export function marcasPersonales(meet, historial) {
  const indices = historial.filter(h => h.id !== meet.id).map(h => ({ h, por: new Map((h.atletas || []).map(a => [normalizarNombre(a.nombre), a])) }));
  const out = {};
  for (const a of meet.atletas || []) {
    const k = normalizarNombre(a.nombre);
    const m = { total: 0, S: 0, B: 0, D: 0, meets: 0, fechaTotal: null, meetTotal: null };
    if (k) for (const { h, por } of indices) {
      const x = por.get(k);
      if (!x) continue;
      m.meets++;
      for (const l of ORDEN_LEV) m[l] = Math.max(m[l], mejor(x, l));
      const t = total(x);
      if (t > m.total) { m.total = t; m.fechaTotal = h.fecha ?? null; m.meetTotal = h.nombre ?? h.id; }
    }
    out[a.id] = m.meets ? m : null;
  }
  return out;
}

/* ====================== Extensión de la API ====================== */

const nombreDe = p => (p.rol === 'organizador' ? 'Organizador' : `${p.nombre} (${NOMBRE_ROL[p.rol] || p.rol})`);

export function crear({ almacen, acceso, datos }) {
  const roles = crearRoles({ dir: datos });
  const limite = crearLimitador({ max: 5, ventana: 60000 });
  const carpetaAud = join(datos, 'auditoria');
  const archivoAud = id => join(carpetaAud, `${id}.jsonl`);

  const rolDe = req => {
    const r = roles.deToken(leerCookies(req.headers?.cookie)[COOKIE_ROL]);
    return r ? { rol: r.rol, meetId: r.meetId, plataforma: r.plataforma, nombre: r.nombre, rolId: r.id } : null;
  };
  acceso.resolverRol = rolDe;
  acceso.elevar = (req, metodo, partes) => { const p = rolDe(req); return !!p && elevaPara(p, metodo, partes); };

  function auditar(meetId, quien, rol, e) {
    try {
      mkdirSync(carpetaAud, { recursive: true });
      appendFileSync(archivoAud(meetId), `${JSON.stringify({ ts: Date.now(), quien, rol, ...e })}\n`);
    } catch (err) { console.error('No pude anotar en la auditoría:', err.message); }
  }
  function leerAuditoria(meetId, { quien = '', q = '', desde = 0, hasta = 0, limite: max = 500 } = {}) {
    let lineas = [];
    try { lineas = readFileSync(archivoAud(meetId), 'utf8').split('\n').filter(Boolean); } catch { return []; }
    const nq = normalizarNombre(q), nw = normalizarNombre(quien);
    const out = [];
    for (let i = lineas.length - 1; i >= 0 && out.length < max; i--) {
      let e; try { e = JSON.parse(lineas[i]); } catch { continue; }
      if (desde && e.ts < desde) continue;
      if (hasta && e.ts > hasta) continue;
      if (nw && !normalizarNombre(`${e.quien} ${e.rol}`).includes(nw)) continue;
      if (nq && !normalizarNombre(`${e.resumen} ${(e.cambios || []).map(c => c.campo).join(' ')}`).includes(nq)) continue;
      out.push(e);
    }
    return out;
  }
  const filtros = u => ({ quien: u.searchParams.get('quien') || '', q: u.searchParams.get('q') || '', desde: Number(u.searchParams.get('desde')) || 0, hasta: Number(u.searchParams.get('hasta')) || 0, limite: Math.min(5000, Math.max(1, Number(u.searchParams.get('limite')) || 500)) });
  const auditoriaCSV = es => {
    const f = d => new Date(d).toISOString().replace('T', ' ').slice(0, 19);
    return `﻿${[['Fecha', 'Quién', 'Rol', 'Resumen'], ...es.map(e => [f(e.ts), e.quien, e.rol, e.resumen])].map(r => r.map(celda).join(',')).join('\r\n')}\r\n`;
  };

  return async ctx => {
    const { req, res, u, partes, metodo, json, leerCuerpo, requiereOrg, txt, num, idSeguro } = ctx;
    const reales = () => acceso.permisos(req);

    /* ---- /api/rol: quién soy, entrar, salir ---- */
    if (partes[0] === 'rol') {
      if (partes.length === 1 && metodo === 'GET') {
        const p = reales();
        return json(res, 200, p.org ? { ok: true, rol: 'organizador', meetId: null, plataforma: '', nombre: 'Organizador' } : { ok: true, rol: p.rol || null, meetId: p.meetId || null, plataforma: p.plataforma || '', nombre: p.nombre || '' }), true;
      }
      if (partes[1] === 'entrar' && partes.length === 2 && metodo === 'POST') {
        const b = await leerCuerpo(req, 1024);
        if (!limite.intentar(`rol|${ctx.ipDe(req)}`)) mal(429, 'Demasiados intentos. Espera un minuto y vuelve a probar.');
        const id = idSeguro(b?.id) ? b.id : undefined;
        const r = roles.verificar(typeof b?.pin === 'string' ? b.pin.trim() : '', id);
        if (!r) mal(401, 'PIN incorrecto o acceso caducado. Pídele uno nuevo al organizador.');
        if (!almacen.existe(r.meetId)) mal(404, 'El meet de este acceso ya no existe');
        const token = roles.abrirSesion(r);
        const seg = Math.max(60, Math.min(30 * 86400, Math.floor((r.caduca - Date.now()) / 1000)));
        const cookie = `${COOKIE_ROL}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seg}`;
        return json(res, 200, { ok: true, rol: r.rol, meetId: r.meetId, plataforma: r.plataforma, nombre: r.nombre }, { 'Set-Cookie': cookie }), true;
      }
      if (partes[1] === 'salir' && partes.length === 2 && metodo === 'POST') {
        roles.cerrarSesion(leerCookies(req.headers.cookie)[COOKIE_ROL]);
        return json(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE_ROL}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` }), true;
      }
      mal(404, 'Ruta desconocida');
    }

    if (partes[0] !== 'meets' || !idSeguro(partes[1])) return false;
    const id = partes[1], sub = partes[2];
    const real = reales();
    const esOrgReal = real.org;
    const esDirector = real.rol === 'director' && real.meetId === id;

    /* ---- accesos del equipo (solo el organizador de verdad) ---- */
    if (sub === 'roles') {
      if (!esOrgReal) mal(403, 'Solo el organizador puede crear o revocar accesos del equipo. Entra con el PIN que muestra la consola.');
      const m = almacen.leer(id);
      if (!m) mal(404, 'No encuentro ese meet');
      if (partes.length === 3 && metodo === 'GET') return json(res, 200, { ok: true, roles: roles.listar(id) }), true;
      if (partes.length === 3 && metodo === 'POST') {
        const b = await leerCuerpo(req, 2048);
        const nombre = txt(b?.nombre, 60);
        if (!nombre) mal(400, 'Ponle un nombre al acceso (por ejemplo, el de la persona).');
        if (!ROLES.includes(b?.rol)) mal(400, 'El rol debe ser director, mesa, pesaje, locutor o lectura');
        const plataforma = txt(b?.plataforma, 40);
        if (b.rol === 'mesa' && !plataforma) mal(400, 'La mesa necesita una plataforma');
        if (plataforma && !(m.plataformas || []).includes(plataforma)) mal(400, 'Esa plataforma no existe en este meet');
        const horas = num(b?.horas, 1, 720, 48);
        const r = roles.crear({ meetId: id, nombre, rol: b.rol, plataforma, horas });
        auditar(id, 'Organizador', 'organizador', { resumen: `Creó un acceso de ${NOMBRE_ROL[b.rol].toLowerCase()} para ${nombre}${plataforma ? ` (${plataforma})` : ''}` });
        return json(res, 201, { ok: true, ...r }), true;
      }
      if (partes.length === 4 && metodo === 'DELETE') {
        const r = roles.revocar(id, partes[3]);
        if (!r) mal(404, 'No encuentro ese acceso');
        auditar(id, 'Organizador', 'organizador', { resumen: `Revocó el acceso de ${r.nombre} (${NOMBRE_ROL[r.rol].toLowerCase()})` });
        return json(res, 200, { ok: true, rol: r }), true;
      }
      mal(405, 'Método no permitido');
    }

    /* ---- auditoría ---- */
    if ((sub === 'auditoria' || sub === 'auditoria.csv') && partes.length === 3 && metodo === 'GET') {
      if (!esOrgReal && !esDirector) mal(403, 'La auditoría la ven el organizador y el director técnico.');
      if (!almacen.existe(id)) mal(404, 'No encuentro ese meet');
      const es = leerAuditoria(id, filtros(u));
      if (sub === 'auditoria') return json(res, 200, { ok: true, entradas: es }), true;
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}-auditoria.csv"`, 'Cache-Control': 'no-store' });
      res.end(auditoriaCSV(es));
      return true;
    }

    /* ---- exportación OpenPowerlifting y marcas del locutor (público si el meet es público) ---- */
    if (sub === 'openpowerlifting.csv' && metodo === 'GET' && partes.length === 3) {
      const m = ctx.meetVisible(id, ctx.org);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}-openpowerlifting.csv"`, 'Cache-Control': 'no-store' });
      res.end(openPowerliftingCSV(m));
      return true;
    }
    if (sub === 'locutor' && metodo === 'GET' && partes.length === 3) {
      const m = ctx.meetVisible(id, ctx.org);
      const historial = almacen.listar().filter(h => h.id !== id && (h.publico !== false || esOrgReal));
      return json(res, 200, { ok: true, marcas: marcasPersonales(m, historial) }), true;
    }

    /* ---- filtro del cuerpo para mesa y pesaje (la ruta ya pasó como organizador por acceso.elevar) ---- */
    const quien = esOrgReal ? { rol: 'organizador', nombre: '' } : real;
    const filtra = (sub === 'canal' && partes.length === 3 && metodo === 'POST') || (sub === 'atletas' && partes.length === 4 && metodo === 'PUT');
    if (!esOrgReal && (real.rol === 'mesa' || real.rol === 'pesaje') && real.meetId === id && filtra) {
      const reescribe = sub === 'atletas' && partes.length === 4 && metodo === 'PUT';
      const { json: b } = await espiarCuerpo(req, sub === 'canal' ? LIMITES.canal : LIMITES.normal, { reponer: !reescribe }); // si se reescribe, se repone la versión filtrada
      if (sub === 'canal') {
        if (real.rol === 'mesa' && (b?.tipo === 'vivo' || b?.tipo === 'limpiar') && txt(b.plataforma, 40) !== real.plataforma) mal(403, `Tu mesa es «${real.plataforma}»: no puedes mandar a otra plataforma.`);
      } else if (sub === 'atletas' && partes.length === 4 && metodo === 'PUT') {
        const prev = (almacen.leer(id)?.atletas || []).find(a => a.id === partes[3]);
        if (!prev) mal(403, 'Con tu rol no puedes añadir atletas nuevos. Pídeselo al organizador.');
        if (real.rol === 'mesa' && prev.plataforma !== real.plataforma) mal(403, `Tu mesa es «${real.plataforma}», y este atleta compite en «${prev.plataforma || 'ninguna'}».`);
        const fusion = fusionarAtleta(real.rol, prev, limpiarAtleta(b, partes[3]));
        req.unshift(Buffer.from(JSON.stringify(fusion)));
      }
    }

    /* ---- auditoría de toda escritura de organizador o de rol, comparando antes y después ---- */
    if (ctx.escribe && (esOrgReal || real.rol) && (esOrgReal || real.meetId === id) && sub !== 'roles') {
      const m = almacen.leer(id);
      if (m) {
        const snap = instantanea(m, metodo, partes);
        res.once('finish', () => {
          if (res.statusCode >= 400) return;
          const actual = almacen.leer(id) || m;
          for (const e of resumirEscritura(snap, actual, metodo, partes)) auditar(id, nombreDe({ rol: quien.rol, nombre: quien.nombre }), quien.rol, e);
        });
      }
    }
    return false;
  };
}
