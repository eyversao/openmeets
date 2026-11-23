/* ============================================================
   OPENMEETS — Regie del HUD: qué escena muestra la transmisión
   Lógica pura (se prueba en Node). El organizador publica { modo, escena, cat, texto, dur, patro, v } por el canal;
   el HUD llama a `escenaEfectiva` cada segundo y a `datosEscena` para saber qué dibujar.
   ============================================================ */

import * as C from './competencia.js';

export const ESCENAS = [
  { id: 'atleta', texto: 'Atleta en tarima' },
  { id: 'siguientes', texto: 'Siguientes' },
  { id: 'clasif', texto: 'Clasificación' },
  { id: 'podio', texto: 'Podio de categoría' },
  { id: 'mejor', texto: 'Mejor levantador' },
  { id: 'record', texto: 'Récord' },
  { id: 'pausa', texto: 'Pausa' },
  { id: 'patro', texto: 'Patrocinadores' },
  { id: 'oculto', texto: 'Ocultar todo' },
];
export const IDS_ESCENA = ESCENAS.map(e => e.id);
/** Escenas informativas: en AUTO una intervención dura DUR_INTERVENCION s y el HUD vuelve a seguir el vivo. */
export const DUR_INTERVENCION = 15;
/** Ms tras el revelado en que, con récord válido, el HUD enseña la escena Récord (las luces caducan a los 12 s). */
export const VENTANA_RECORD = [4000, 12000];

export const REGIE_INICIAL = { modo: 'auto', escena: '', cat: '', texto: '', dur: 0, patro: { logos: [], seg: 8 }, v: 0 };

/** Estado seguro (lo mismo que valida el servidor). */
export function normalizarRegie(d) {
  const r = d && typeof d === 'object' ? d : {};
  return {
    modo: r.modo === 'manual' ? 'manual' : 'auto',
    escena: IDS_ESCENA.includes(r.escena) ? r.escena : '',
    cat: String(r.cat || '').slice(0, 120), texto: String(r.texto || '').slice(0, 200),
    dur: Math.min(600, Math.max(0, Number(r.dur) || 0)),
    patro: { logos: (Array.isArray(r.patro?.logos) ? r.patro.logos : []).filter(l => typeof l === 'string').slice(0, 8), seg: Math.min(60, Math.max(3, Number(r.patro?.seg) || 8)) },
    v: Number(r.v) || 0,
  };
}

/** Secuencia automática según el vivo: atleta → revelado → récord (si lo logró) → atleta siguiente; sin atleta, los siguientes. */
export function escenaAuto(vt, vivo, ahora = Date.now()) {
  if (!vt?.hayAtleta) return vt?.siguientes?.length ? 'siguientes' : 'oculto';
  if (vt.estado === 'decision' && vt.recFase === 'logrado') {
    const dt = ahora - (Number(vivo?.lucesTs) || 0);
    if (dt >= VENTANA_RECORD[0] && dt < VENTANA_RECORD[1]) return 'record';
  }
  return 'atleta';
}

/**
 * Escena que debe verse ahora. `desde` = ms en que este HUD recibió la regie (la caducidad no depende de relojes ajenos).
 * MANUAL: la escena fijada (o 'atleta'). AUTO: sigue el vivo, salvo una intervención vigente.
 */
export function escenaEfectiva(regie, vt, vivo, ahora = Date.now(), desde = ahora) {
  const r = regie || REGIE_INICIAL;
  if (r.modo === 'manual') return r.escena || 'atleta';
  if (r.escena && !(r.dur > 0 && ahora - desde >= r.dur * 1000)) return r.escena;
  return escenaAuto(vt, vivo, ahora);
}

/* ---------- Datos de cada escena ---------- */

const catDe = (a, atletas) => clasifDe(atletas).find(g => g.filas.some(f => f.a.id === a?.id));
const clasifDe = atletas => C.clasificacion(atletas);
const fila = (f, formula) => ({ puesto: f.puesto, nombre: f.a.nombre, club: f.a.club || '', total: f.total ?? C.total(f.a), puntos: C.puntos(f.a, formula) });

/** Categorías con al menos un total, para elegir el podio. */
export const categoriasConTotal = atletas => clasifDe(atletas).filter(g => g.filas.some(f => f.puesto)).map(g => g.nombre);

/** Último intento de récord válido del meet (por si nadie levanta ahora). */
export function ultimoRecord(atletas = []) {
  let r = null;
  for (const a of atletas) for (const lev of C.ORDEN_LEV) for (const i of a.intentos?.[lev] || []) {
    if (i.r === 1 && C.recValido(i.rec) && Number(i.kg) > 0) r = { nombre: a.nombre, club: a.club || '', lev, kg: Number(i.kg), etiqueta: C.etiquetaRecord(i.rec, i.recTexto), logrado: true };
  }
  return r;
}

/**
 * Lo que dibuja cada escena (sin DOM). `vt` es vistaTarima; `vivo` el vivo de la plataforma.
 * Devuelve null si no hay nada que enseñar (el HUD no pinta nada en vez de un panel vacío).
 */
export function datosEscena(id, meet, vt, vivo, regie = REGIE_INICIAL) {
  const atletas = meet?.atletas || [];
  const formula = meet?.formula === 'IPF' ? 'GL' : meet?.formula || 'GL';
  const aid = (vt?.estado === 'decision' && vivo?.juzgado?.aid) || vivo?.actual?.aid;
  const actual = atletas.find(a => a.id === aid) || null;
  switch (id) {
    case 'siguientes': {
      const l = (vt?.siguientes?.length ? vt.siguientes : (vivo?.siguientes || []).slice(0, 5)).slice(0, 5);
      return l.length ? { titulo: 'Siguientes', sub: vt?.levNombre || '', filas: l.map(x => ({ nombre: x.nombre, kg: Number(x.kg) || 0 })) } : null;
    }
    case 'clasif': case 'podio': {
      const g = (regie.cat && clasifDe(atletas).find(x => x.nombre === regie.cat)) || catDe(actual, atletas) || clasifDe(atletas).find(x => x.filas.some(f => f.puesto));
      const filas = g ? g.filas.filter(f => f.puesto).slice(0, id === 'podio' ? 3 : 5) : [];
      return filas.length ? { titulo: id === 'podio' ? 'Podio' : 'Clasificación', sub: g.nombre, formula, filas: filas.map(f => fila(f, formula)) } : null;
    }
    case 'mejor': {
      const t = C.mejoresPorFormula(atletas, formula);
      const F = t.find(x => x.a.sexo === 'F'), M = t.find(x => x.a.sexo !== 'F');
      const p = x => (x ? { nombre: x.a.nombre, club: x.a.club || '', total: C.total(x.a), valor: x.valor } : null);
      return F || M ? { titulo: 'Mejor levantador', formula, F: p(F), M: p(M) } : null;
    }
    case 'record': {
      if (vt?.hayAtleta && vt.recFase) return { nombre: vt.nombre, club: vt.club, lev: vt.lev, kg: vt.kg, etiqueta: vt.recEtiqueta || 'RÉCORD', logrado: vt.recFase === 'logrado' };
      return ultimoRecord(atletas);
    }
    case 'pausa': return regie.texto ? { texto: regie.texto } : { texto: 'Volvemos en unos minutos' };
    case 'patro': return regie.patro?.logos?.length ? { logos: regie.patro.logos, seg: regie.patro.seg || 8 } : null;
    default: return null;
  }
}

/** Qué logo toca ahora en la rotación de patrocinadores. */
export const logoActual = (logos, seg, ahora = Date.now()) => (logos.length ? logos[Math.floor(ahora / 1000 / Math.max(1, seg)) % logos.length] : null);
