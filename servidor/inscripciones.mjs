// OpenMeets · inscripciones. Configuración pública en meet.inscripciones; inscritos y contactos PRIVADOS en <datos>/inscripciones/<meet>.json.
// Quien se inscribe NO entra al meet (ni a la vista pública, el canal o el CSV) hasta que el organizador lo confirma.
// Rutas: GET /api/inscripciones/abiertas · GET|POST /api/meets/:id/inscripciones · GET .../estado · PUT .../config · PATCH .../:iid · GET .../inscripciones.csv
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { crearLimitador } from './acceso.mjs';
import { celda } from './calculo.mjs';
import { estadoApertura, contarCupos, cabe, claveDuplicado, csvInscripciones, ESTADOS } from '../web/js/nucleo/inscripcion.js';
import { MAX_INSCRITOS, limpiarConfig, validarInscripcion, MENSAJE_DUPLICADO, codigoInscripcion, itemNuevo, atletaDeInscripcion } from '../web/js/nucleo/inscribir.js';

export { MAX_INSCRITOS, limpiarConfig };

export function crear({ almacen, datos }) {
  const carpeta = join(datos, 'inscripciones');
  mkdirSync(carpeta, { recursive: true });
  const limite = crearLimitador({ max: 5, ventana: 60 * 60 * 1000 }); // 5 inscripciones por hora y por IP
  const cache = new Map();
  const ruta = id => join(carpeta, `${id}.json`);
  const leer = id => {
    if (!cache.has(id)) { let x = null; try { x = JSON.parse(readFileSync(ruta(id), 'utf8')); } catch { /* aún no hay */ } cache.set(id, Array.isArray(x?.items) ? x : { items: [] }); }
    return cache.get(id);
  };
  const guardarArchivo = id => { const tmp = `${ruta(id)}.tmp`; writeFileSync(tmp, JSON.stringify(leer(id))); renameSync(tmp, ruta(id)); };

  const abiertaDe = m => estadoApertura(m.inscripciones);
  const publico = m => { const c = m.inscripciones || null; const cupos = contarCupos(leer(m.id).items); return { config: c, ...abiertaDe(m), cupos: { total: c?.cupoTotal ?? null, ocupados: cupos.ocupados, espera: cupos.espera, porClase: cupos.porClase } }; };

  return async function inscripciones(ctx) {
    const { partes, metodo, org, res, json, mal, leerCuerpo, txt, num, fecha, url, objeto, meetVisible, requiereOrg, guardar, ipDe } = ctx;
    if (partes[0] === 'inscripciones' && partes[1] === 'abiertas' && partes.length === 2 && metodo === 'GET') {
      const ids = almacen.listar().filter(m => m.publico !== false && abiertaDe(m).abierta).map(m => m.id);
      json(res, 200, ids); return true;
    }
    if (partes[0] !== 'meets' || !(partes[2] === 'inscripciones' || partes[2] === 'inscripciones.csv')) return false;
    const id = partes[1];
    const m = meetVisible(id, org);
    const sub = partes[3];

    if (partes[2] === 'inscripciones.csv') {
      requiereOrg(org);
      if (metodo !== 'GET' || partes.length !== 3) mal(405, 'Método no permitido');
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${id}-inscripciones.csv"`, 'Cache-Control': 'no-store' });
      res.end(csvInscripciones(leer(id).items, celda)); return true;
    }

    if (sub === 'estado' && partes.length === 4) {
      if (metodo !== 'GET') mal(405, 'Método no permitido');
      json(res, 200, { ok: true, ...publico(m) }); return true;
    }

    if (sub === 'config' && partes.length === 4) {
      requiereOrg(org);
      if (metodo !== 'PUT') mal(405, 'Método no permitido');
      const cfg = limpiarConfig(await leerCuerpo(ctx.req), ctx);
      guardar(m, mm => { mm.inscripciones = cfg; });
      ctx.tiempo.emitir(id, { tipo: 'meet-cambio', campos: { inscripciones: cfg } });
      json(res, 200, { ok: true, config: cfg }); return true;
    }

    if (!sub) {
      if (metodo === 'GET') { requiereOrg(org); json(res, 200, { ok: true, items: leer(id).items, ...publico(m) }); return true; }
      if (metodo !== 'POST') mal(405, 'Método no permitido');
      return await inscribir(ctx, m);
    }

    if (partes.length === 4 && metodo === 'PATCH') {
      requiereOrg(org);
      const item = leer(id).items.find(x => x.id === sub);
      if (!item) mal(404, 'No encuentro esa inscripción');
      const b = await leerCuerpo(ctx.req, 4096);
      if (!objeto(b)) mal(400, 'Cuerpo no válido');
      if (b.estado !== undefined && !ESTADOS.includes(b.estado)) mal(400, 'Estado no válido');
      const antes = item.estado;
      if (b.estado !== undefined && b.estado !== antes) {
        if (b.estado === 'confirmado') { if (!item.aid) alta(ctx, m, item); } else if (antes === 'confirmado') baja(ctx, m, item);
        item.estado = b.estado;
      }
      if (b.pagado !== undefined) item.pagado = !!b.pagado;
      if (b.nota !== undefined) item.nota = txt(b.nota, 300);
      item.ts = Date.now();
      guardarArchivo(id);
      json(res, 200, { ok: true, item, ...publico(m) }); return true;
    }
    mal(404, 'Ruta desconocida');
  };

  /** El atleta entra a la lista del meet (misma forma que cualquier atleta; aperturas estimadas como primer intento). */
  function alta(ctx, m, item) {
    if ((m.atletas || []).length >= 1000) ctx.mal(400, 'Un meet admite hasta 1000 atletas');
    let atleta;
    ctx.guardar(m, mm => {
      const lote = Math.max(0, ...(mm.atletas ||= []).map(a => Number(a.lote) || 0)) + 1;
      atleta = atletaDeInscripcion(item, mm, lote);
      mm.atletas.push(atleta);
    });
    item.aid = atleta.id;
    ctx.tiempo.emitir(m.id, { tipo: 'atleta', atleta });
  }
  function baja(ctx, m, item) {
    const aid = item.aid; if (!aid) return;
    ctx.guardar(m, mm => { mm.atletas = (mm.atletas || []).filter(a => a.id !== aid); delete (mm.aplausos || {})[aid]; });
    ctx.tiempo.emitir(m.id, { tipo: 'atleta', atleta: { id: aid, eliminado: true } });
    item.aid = null;
  }

  async function inscribir(ctx, m) {
    const { res, json, mal, leerCuerpo, ipDe, req } = ctx;
    const cfg = m.inscripciones;
    const campos = validarInscripcion(m, await leerCuerpo(req, 16 * 1024), ctx);
    const dato = leer(m.id);
    const llave = claveDuplicado(campos.nombre, campos.nacimiento);
    if (dato.items.some(i => i.estado !== 'rechazado' && claveDuplicado(i.nombre, i.nacimiento) === llave)) mal(409, MENSAJE_DUPLICADO);
    if (dato.items.length >= MAX_INSCRITOS) mal(409, 'Este meet ya no recibe más inscripciones.');
    if (!limite.intentar(ipDe(req))) mal(429, 'Ya enviaste varias inscripciones desde esta conexión. Espera una hora o pídele al organizador que te inscriba.');

    const cupos = contarCupos(dato.items);
    const estado = cabe(cfg, cupos, campos.sexo, campos.clase) ? 'pendiente' : 'espera';
    const item = itemNuevo(campos, estado, codigoInscripcion(c => dato.items.some(i => i.codigo === c)));
    dato.items.push(item);
    guardarArchivo(m.id);
    json(res, 201, { ok: true, codigo: item.codigo, estado, clase: campos.clase, division: campos.division, precio: cfg.precio || 0, moneda: cfg.moneda || '', pagoUrl: cfg.pagoUrl || '' });
    return true;
  }
}
