/* ============================================================
   OPENMEETS — Perfiles de atleta (puro: corre igual en el servidor y en la web)
   Une las apariciones de una persona en todos los meets del servidor. La ficha se agrupa por
   `atletaId` (si el atleta del meet lo trae), por una asignación del organizador (fusionar o separar)
   o, si no hay ninguna, por nombre sin tildes + sexo.
   ============================================================ */

import { normalizarNombre, mejor, total, puntos, pesoDe, clasificacion, anilloAtleta, ORDEN_LEV } from './competencia.js';

const ID = { test: x => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(x) };

/** Identificador de la ficha por nombre y sexo: «jose-perez-m». '' si el atleta no tiene nombre. */
export function slugAuto(a) {
  const base = normalizarNombre(a?.nombre).replace(/ /g, '-').slice(0, 56).replace(/-+$/, '');
  return base ? `${base}-${a.sexo === 'F' ? 'f' : 'm'}` : '';
}
/** Clave de una aparición (un atleta en un meet): la usan las asignaciones del organizador. */
export const claveApar = (meetId, aid) => `${meetId}|${aid}`;

/** Ficha a la que pertenece un atleta de un meet: asignación del organizador > atletaId > nombre y sexo. */
export function slugDe(meetId, a, asignaciones = {}) {
  const x = asignaciones[claveApar(meetId, a.id)];
  if (ID.test(x)) return x;
  return ID.test(a?.atletaId) ? a.atletaId : slugAuto(a);
}

const porFecha = (x, y) => String(x.meet.fecha || '').localeCompare(String(y.meet.fecha || '')) || (x.meet.creado || 0) - (y.meet.creado || 0);

/** Map slug → { slug, apariciones: [{ meet, a }] } (de la más antigua a la más reciente). */
export function agruparAtletas(meets, asignaciones = {}) {
  const g = new Map();
  for (const meet of meets || []) for (const a of meet.atletas || []) {
    const slug = slugDe(meet.id, a, asignaciones);
    if (!slug) continue;
    if (!g.has(slug)) g.set(slug, { slug, apariciones: [] });
    g.get(slug).apariciones.push({ meet, a });
  }
  for (const x of g.values()) x.apariciones.sort(porFecha);
  return g;
}

const unicos = l => [...new Set(l.filter(Boolean))];
const categoriaDe = a => [a.division || 'Open', a.clase ? `${a.clase} kg` : ''].filter(Boolean).join(' · ');

/** Fila de lista: lo justo para el buscador. */
export function resumenLista(grupo) {
  const ult = grupo.apariciones[grupo.apariciones.length - 1];
  const mejorTotal = Math.max(0, ...grupo.apariciones.map(x => total(x.a)));
  return {
    slug: grupo.slug, nombre: ult.a.nombre, sexo: ult.a.sexo === 'F' ? 'F' : 'M', club: ult.a.club || '', meets: grupo.apariciones.length,
    ultimaFecha: ult.meet.fecha || '', mejorTotal,
  };
}

/** Puesto de cada atleta en su categoría dentro de un meet: Map aid → { puesto, de }. */
function puestosDe(meet) {
  const m = new Map();
  for (const g of clasificacion(meet.atletas || [])) for (const f of g.filas) m.set(f.a.id, { puesto: f.puesto, de: g.filas.length });
  return m;
}

/**
 * Ficha completa. `records` es la tabla de récords (para los que posee).
 * @returns {{ slug, nombre, sexo, clubs, categorias, meets, historial, mejores, progresion, ultimo, records }}
 */
export function perfilDe(grupo, records = []) {
  const ap = grupo.apariciones, ult = ap[ap.length - 1];
  const filas = ap.map(({ meet, a }) => {
    const formula = meet.formula || 'GL', tot = total(a), p = puestosDe(meet).get(a.id) || {};
    return {
      meetId: meet.id, meetNombre: meet.nombre, fecha: meet.fecha || '', aid: a.id, categoria: categoriaDe(a), division: a.division || 'Open', clase: a.clase || '',
      equipamiento: a.equipamiento === 'equipado' ? 'equipado' : 'raw', peso: pesoDe(a) || null, club: a.club || '', nombre: a.nombre,
      S: mejor(a, 'S'), B: mejor(a, 'B'), D: mejor(a, 'D'), total: tot, puntos: tot ? Math.round(puntos(a, formula) * 100) / 100 : 0,
      formula: formula === 'IPF' ? 'GL' : formula, puesto: tot ? p.puesto ?? null : null, de: p.de || 0, federacion: meet.federacion || '',
    };
  });
  const mejores = {};
  for (const k of [...ORDEN_LEV, 'total', 'puntos']) {
    let b = null;
    for (const f of filas) if (f[k] > 0 && (!b || f[k] > b.kg)) b = { kg: f[k], fecha: f.fecha, meetId: f.meetId, meet: f.meetNombre };
    mejores[k] = b;
  }
  const nombres = new Set(ap.map(x => normalizarNombre(x.a.nombre)));
  const sexo = ult.a.sexo === 'F' ? 'F' : 'M';
  return {
    slug: grupo.slug, nombre: ult.a.nombre, sexo,
    clubs: unicos([...ap].reverse().map(x => x.a.club)), categorias: unicos([...ap].reverse().map(x => categoriaDe(x.a))), meets: ap.length,
    historial: [...filas].reverse(),
    mejores,
    progresion: filas.filter(f => f.total > 0).map(f => ({ fecha: f.fecha, meetId: f.meetId, meet: f.meetNombre, total: f.total, puntos: f.puntos })),
    ultimo: { meetId: ult.meet.id, meet: ult.meet.nombre, fecha: ult.meet.fecha || '', aid: ult.a.id, anillo: anilloAtleta(ult.a) },
    records: (records || []).filter(r => r.sexo === sexo && nombres.has(normalizarNombre(r.atleta))),
  };
}
