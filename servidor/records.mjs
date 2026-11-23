// OpenMeets · récords y perfiles de atleta.
//   /api/records …            tabla de récords (<datos>/records.json). Lectura pública; edición del organizador.
//   /api/atletas …            fichas de atleta armadas con todos los meets públicos de este servidor.
//   PUT /api/meets/:id/atletas/:aid  se vigila (sin tocar api.mjs): si un intento pasa a válido y supera la tabla,
//                                    el récord se registra solo, por homologar, con el anterior en el historial.
import { readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import * as R from '../web/js/nucleo/records.js';
import * as P from '../web/js/nucleo/perfiles.js';
import { normalizarNombre } from '../web/js/nucleo/competencia.js';

const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;
const FILTROS = ['federacion', 'nivel', 'sexo', 'division', 'equipamiento', 'clase', 'lev', 'q', 'meetId', 'pendientes'];

function leerJson(ruta, vacio) {
  for (const f of [ruta, `${ruta}.bak`]) { try { const j = JSON.parse(readFileSync(f, 'utf8')); if (j && typeof j === 'object') return j; } catch { /* probar la copia */ } }
  return vacio;
}
/** Escritura atómica: archivo temporal, copia .bak y rename. */
function escribirJson(ruta, obj) {
  const tmp = `${ruta}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj));
  if (existsSync(ruta)) { try { copyFileSync(ruta, `${ruta}.bak`); } catch { /* sin copia */ } }
  renameSync(tmp, ruta);
}

export function crear({ almacen, tiempo, datos }) {
  const rutaRec = datos ? join(datos, 'records.json') : '';
  const rutaAsig = datos ? join(datos, 'atletas.json') : '';
  const tabla = [];
  let asignaciones = {};
  if (rutaRec) for (const x of leerJson(rutaRec, { records: [] }).records || []) { const r = R.normalizarRecord(x); if (r.ok) tabla.push({ ...r.record, id: r.record.id || `rc-${randomBytes(4).toString('hex')}` }); }
  if (rutaAsig) { const a = leerJson(rutaAsig, {}).asignaciones; if (a && typeof a === 'object') asignaciones = a; }
  const guardarTabla = () => { if (rutaRec) escribirJson(rutaRec, { version: 1, records: tabla }); };
  const guardarAsig = () => { if (rutaAsig) escribirJson(rutaAsig, { version: 1, asignaciones }); };
  const idNuevo = () => `rc-${randomBytes(4).toString('hex')}`;
  const publicos = () => almacen.listar().filter(m => m.publico !== false);
  const lectura = ctx => { const f = {}; for (const k of FILTROS) { const v = ctx.u.searchParams.get(k); if (v) f[k] = ctx.txt(v, 120); } return f; };

  /* ---------- /api/records ---------- */
  async function records(ctx) {
    const { partes, metodo, res, org, mal, json, req, leerCuerpo, requiereOrg } = ctx;
    const [, sub, extra] = partes;
    if (!sub) {
      if (metodo === 'GET') return json(res, 200, { ok: true, records: R.filtrarRecords(tabla, lectura(ctx)) });
      if (metodo === 'POST') {
        requiereOrg(org);
        const b = await leerCuerpo(req, 256 * 1024);
        const v = R.normalizarRecord(b); if (!v.ok) mal(400, v.error);
        const r = v.record;
        if (tabla.length >= R.MAX_RECORDS) mal(400, `La tabla admite hasta ${R.MAX_RECORDS} récords`);
        const igual = tabla.find(x => R.claveRecord(x) === R.claveRecord(r));
        if (igual) mal(409, `Ya hay un récord para esa categoría y levantamiento (${igual.kg} kg de ${igual.atleta}). Edítalo y márcalo como récord nuevo para guardar el anterior en el historial.`);
        if (!r.id || tabla.some(x => x.id === r.id)) r.id = idNuevo();
        tabla.push(r); guardarTabla();
        return json(res, 201, { ok: true, record: r });
      }
      mal(405, 'Método no permitido');
    }
    if (sub === 'export.csv' && metodo === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="records-openmeets.csv"', 'Cache-Control': 'no-store' });
      return res.end(R.recordsACSV(R.filtrarRecords(tabla, lectura(ctx))));
    }
    if (sub === 'plantilla.csv' && metodo === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="plantilla-records.csv"', 'Cache-Control': 'no-store' });
      return res.end(R.plantillaRecordsCSV());
    }
    if (sub === 'importar' && !extra) {
      requiereOrg(org);
      if (metodo !== 'POST') mal(405, 'Método no permitido');
      const b = await leerCuerpo(req, 2 * 1024 * 1024);
      if (typeof b?.csv !== 'string' || !b.csv.trim()) mal(400, 'Falta el contenido del CSV');
      const { records: filas, errores } = R.recordsDeCSV(b.csv);
      const copia = b.simular ? JSON.parse(JSON.stringify(tabla)) : tabla;
      const cuenta = { nuevos: 0, actualizados: 0, iguales: 0 };
      for (const f of filas) {
        if (copia.length >= R.MAX_RECORDS) { errores.push({ linea: 0, error: `Se llegó al máximo de ${R.MAX_RECORDS} récords` }); break; }
        const { cambio } = R.registrarRecord(copia, f, { id: idNuevo() });
        if (cambio === 'nuevo') cuenta.nuevos++; else if (cambio === 'igual') cuenta.iguales++; else cuenta.actualizados++;
      }
      if (!b.simular && (cuenta.nuevos || cuenta.actualizados)) guardarTabla();
      return json(res, 200, { ok: true, simulado: !!b.simular, ...cuenta, errores: errores.slice(0, 50), erroresTotal: errores.length });
    }
    if (!ID.test(sub) || extra) mal(404, 'No encuentro ese récord');
    const i = tabla.findIndex(x => x.id === sub);
    if (metodo === 'GET') { if (i < 0) mal(404, 'No encuentro ese récord'); return json(res, 200, { ok: true, record: tabla[i] }); }
    requiereOrg(org);
    if (i < 0) mal(404, 'No encuentro ese récord');
    if (metodo === 'DELETE') { const [r] = tabla.splice(i, 1); guardarTabla(); return json(res, 200, { ok: true, record: r }); }
    if (metodo === 'PUT') {
      const b = await leerCuerpo(req, 256 * 1024);
      const v = R.normalizarRecord({ ...tabla[i], ...b, id: sub });
      if (!v.ok) mal(400, v.error);
      const r = v.record;
      if (tabla.some((x, j) => j !== i && R.claveRecord(x) === R.claveRecord(r))) mal(409, 'Ya existe otro récord con esa federación, nivel, categoría y levantamiento');
      const previo = tabla[i];
      r.historial = b.nuevoTitular === true ? [R.instantanea(previo), ...previo.historial].slice(0, 50) : previo.historial;
      if (b.nuevoTitular === true) { delete r.meetId; delete r.aid; }
      tabla[i] = r; guardarTabla();
      return json(res, 200, { ok: true, record: r });
    }
    mal(405, 'Método no permitido');
  }

  /* ---------- /api/atletas ---------- */
  async function atletas(ctx) {
    const { partes, metodo, res, org, mal, json, req, leerCuerpo, requiereOrg, u } = ctx;
    const slug = partes[1];
    if (!slug) {
      if (metodo !== 'GET') mal(405, 'Método no permitido');
      const q = normalizarNombre(u.searchParams.get('q') || '');
      let lista = [...P.agruparAtletas(publicos(), asignaciones).values()].map(P.resumenLista);
      if (q) lista = lista.filter(x => normalizarNombre(`${x.nombre} ${x.club}`).includes(q));
      lista.sort((a, b) => b.ultimaFecha.localeCompare(a.ultimaFecha) || a.nombre.localeCompare(b.nombre, 'es'));
      return json(res, 200, { ok: true, atletas: lista.slice(0, 500), total: lista.length });
    }
    if (slug === 'asignaciones' && partes.length === 2) {
      requiereOrg(org);
      if (metodo !== 'PUT') mal(405, 'Método no permitido');
      const b = await leerCuerpo(req, 512 * 1024);
      if (!ctx.objeto(b?.set)) mal(400, 'Falta «set»: { "meet|atleta": "ficha" | null }');
      const nuevo = { ...asignaciones };
      for (const [k, v] of Object.entries(b.set).slice(0, 2000)) {
        if (!/^[a-z0-9][a-z0-9-]{0,59}\|[a-z0-9][a-z0-9-]{0,59}$/.test(k)) mal(400, `Clave no válida: ${ctx.txt(k, 40)}`);
        if (v === null) delete nuevo[k]; else if (ID.test(v)) nuevo[k] = v; else mal(400, 'La ficha debe llevar solo a-z, 0-9 y guiones');
      }
      if (Object.keys(nuevo).length > 20000) mal(400, 'Demasiadas asignaciones');
      asignaciones = nuevo; guardarAsig();
      return json(res, 200, { ok: true });
    }
    if (partes.length !== 2 || !ID.test(slug)) mal(404, 'No encuentro esa ficha');
    if (metodo !== 'GET') mal(405, 'Método no permitido');
    const grupos = P.agruparAtletas(publicos(), asignaciones);
    let g = grupos.get(slug);
    if (!g) {
      // Enlace viejo (la ficha se fusionó o separó): la aparición que se pide dice dónde quedó.
      const m = u.searchParams.get('m'), a = u.searchParams.get('a');
      const nueva = m && a && [...grupos.values()].find(x => x.apariciones.some(y => y.meet.id === m && y.a.id === a));
      if (nueva) return json(res, 200, { ok: true, redirigir: nueva.slug });
      mal(404, 'No encuentro esa ficha. Puede que se haya fusionado con otra o que el meet ya no sea público.');
    }
    const m = u.searchParams.get('m'), a = u.searchParams.get('a');
    if (m && a && !g.apariciones.some(y => y.meet.id === m && y.a.id === a)) {
      const otra = [...grupos.values()].find(x => x.apariciones.some(y => y.meet.id === m && y.a.id === a));
      if (otra) return json(res, 200, { ok: true, redirigir: otra.slug });
    }
    return json(res, 200, { ok: true, perfil: P.perfilDe(g, tabla) });
  }

  /* ---------- récord automático ---------- */
  function vigilarAtleta(ctx) {
    const id = ctx.partes[1], aid = ctx.partes[3];
    const m0 = almacen.existe(id) ? almacen.leer(id) : null;
    const previo = m0?.atletas?.find(x => x.id === aid);
    const antes = previo ? JSON.parse(JSON.stringify({ intentos: previo.intentos })) : null;
    ctx.res.once('finish', () => {
      if (ctx.res.statusCode !== 200) return;
      try {
        const m = almacen.leer(id), despues = m?.atletas?.find(x => x.id === aid);
        if (!despues || !m.federacion) return;
        const hechos = R.registrarAutomaticos(tabla, m, antes, despues);
        if (!hechos.length) return;
        guardarTabla();
        ctx.guardar(m, mm => { for (const h of hechos) ctx.anotar(mm, `Récord ${R.nombreNivel(h.record)} · ${R.NOMBRE_LEV_REC[h.record.lev].toLowerCase()} · ${h.record.kg} kg · ${h.record.atleta} (por homologar)`); });
        tiempo.emitir(id, { tipo: 'meet-cambio', campos: {} });
      } catch (e) { console.error('Récord automático:', e); }
    });
  }

  return async ctx => {
    const { partes, metodo } = ctx;
    if (partes[0] === 'records') { await records(ctx); return true; }
    if (partes[0] === 'atletas') { await atletas(ctx); return true; }
    if (partes[0] === 'meets' && partes[2] === 'atletas' && partes.length === 4 && metodo === 'PUT' && ctx.org) vigilarAtleta(ctx);
    return false;
  };
}
