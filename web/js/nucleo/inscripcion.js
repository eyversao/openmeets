/* ============================================================
   OPENMEETS — Inscripciones y pesaje: reglas puras (sin DOM ni red; corren igual en Node y en el navegador)
   División por edad, apertura/cierre, cupos, mensajes para copiar y reparto en grupos.
   ============================================================ */

import { divisionesDe, claseMasCercana } from './federaciones.js';

export const ESTADOS = ['pendiente', 'confirmado', 'espera', 'rechazado'];
export const ETIQUETA_ESTADO = { pendiente: 'Pendiente', confirmado: 'Confirmado', espera: 'Lista de espera', rechazado: 'Rechazado' };
const ANIO_CALENDARIO = new Set(['IPF', 'FCLP']); // su reglamento cuenta la edad por año calendario

export const normalizar = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** Clave anti-duplicado: mismo nombre y misma fecha de nacimiento. */
export const claveDuplicado = (nombre, nacimiento) => `${normalizar(nombre)}|${nacimiento}`;

/** '14-18' → [14, 18]; '19+' → [19, 200]; '' → null. */
export function rangoEdad(txt) {
  const s = String(txt ?? '').trim();
  let m = /^(\d{1,3})-(\d{1,3})$/.exec(s); if (m) return [Number(m[1]), Number(m[2])];
  m = /^(\d{1,3})\+$/.exec(s); return m ? [Number(m[1]), 200] : null;
}

/** Edad el día del meet (o, por año calendario, la diferencia de años). null si la fecha no existe. */
export function edadEn(nacimiento, fechaRef, { porAnio = false } = {}) {
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nacimiento || ''), r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaRef || '');
  if (!n || !r) return null;
  if (porAnio) return Number(r[1]) - Number(n[1]);
  let e = Number(r[1]) - Number(n[1]);
  if (Number(r[2]) < Number(n[2]) || (Number(r[2]) === Number(n[2]) && Number(r[3]) < Number(n[3]))) e--;
  return e;
}

/**
 * División sugerida por edad: la de rango más estrecho que contiene la edad (Junior gana a Open).
 * null si la federación no tiene regla por edad (competencias locales) o la edad no cae en ninguna.
 */
export function divisionPorEdad(federacion, nacimiento, fechaMeet) {
  const edad = edadEn(nacimiento, fechaMeet, { porAnio: ANIO_CALENDARIO.has(federacion) });
  if (edad === null || edad < 0) return null;
  let mejor = null;
  for (const d of divisionesDe(federacion)) {
    const r = rangoEdad(d.edad);
    if (!r || edad < r[0] || edad > r[1]) continue;
    if (!mejor || r[1] - r[0] < mejor.span) mejor = { nombre: d.nombre, span: r[1] - r[0] };
  }
  return mejor?.nombre ?? null;
}

/** Categoría de peso propuesta (la más cercana por encima del peso). '' si no hay peso. */
export const categoriaPropuesta = (federacion, sexo, peso, division) => (Number(peso) > 0 ? claseMasCercana(federacion, sexo, Number(peso), division) : '');

/** 'AAAA-MM-DDTHH:MM' (hora local de la mesa) → ms; null si no hay o no vale. */
export function cierreMs(cierre) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(cierre || '')) return null;
  const t = new Date(cierre).getTime();
  return Number.isFinite(t) ? t : null;
}

export const ocupa = it => it.estado === 'pendiente' || it.estado === 'confirmado';
const claveClase = it => `${it.sexo}|${it.clase}`;

/** Cuántos lugares hay usados: total y por categoría (sexo|clase). */
export function contarCupos(items = []) {
  const porClase = {};
  let ocupados = 0, espera = 0;
  for (const it of items) {
    if (ocupa(it)) { ocupados++; porClase[claveClase(it)] = (porClase[claveClase(it)] || 0) + 1; } else if (it.estado === 'espera') espera++;
  }
  return { ocupados, espera, porClase };
}

/** ¿Se puede inscribir alguien ahora? { abierta, motivo: ''|'apagada'|'cierre' } */
export function estadoApertura(cfg, ahora = Date.now()) {
  if (!cfg || !cfg.abiertas) return { abierta: false, motivo: 'apagada' };
  const c = cierreMs(cfg.cierre);
  if (c !== null && ahora >= c) return { abierta: false, motivo: 'cierre' };
  return { abierta: true, motivo: '' };
}

/** ¿Esta inscripción nueva cabe, o va a la lista de espera? */
export function cabe(cfg, cupos, sexo, clase) {
  if (cfg.cupoTotal && cupos.ocupados >= cfg.cupoTotal) return false;
  if (cfg.cupoCategoria && (cupos.porClase[`${sexo}|${clase}`] || 0) >= cfg.cupoCategoria) return false;
  return true;
}

export const PREGUNTA_TIPOS = ['texto', 'si-no'];

/** Texto para copiar y pegar en WhatsApp o correo. Nada se envía desde aquí. */
export function mensajeConfirmacion(meet, it, { pagoUrl = '' } = {}) {
  const cfg = meet.inscripciones || {};
  const primero = String(it.nombre || '').split(/\s+/)[0] || '';
  const donde = [meet.fecha, meet.sede, meet.ciudad].filter(Boolean).join(' · ');
  const precio = cfg.precio > 0 ? `${cfg.precio} ${cfg.moneda || ''}`.trim() : '';
  const url = pagoUrl || cfg.pagoUrl || '';
  const l = [];
  if (it.estado === 'confirmado') {
    l.push(`Hola ${primero}, tu inscripción a ${meet.nombre} está confirmada.`);
    l.push(`Categoría: ${it.clase ? `${it.sexo === 'F' ? 'Mujeres' : 'Hombres'} ${it.clase} kg` : 'por definir'} · ${it.division} · ${it.equipamiento === 'equipado' ? 'Equipado' : 'Raw'}.`);
    if (donde) l.push(`Cuándo y dónde: ${donde}.`);
    l.push('El pesaje te lo avisamos antes del meet. Trae tu documento y tu equipo.');
  } else if (it.estado === 'espera') {
    l.push(`Hola ${primero}, recibimos tu inscripción a ${meet.nombre}, pero el cupo está lleno.`);
    l.push('Quedaste en lista de espera: si se libera un lugar, te escribimos.');
  } else if (it.estado === 'rechazado') {
    l.push(`Hola ${primero}, no pudimos aceptar tu inscripción a ${meet.nombre}.`);
    if (it.nota) l.push(`Motivo: ${it.nota}`);
  } else {
    l.push(`Hola ${primero}, recibimos tu inscripción a ${meet.nombre}.`);
    if (precio) l.push(`Para confirmarla, el pago es ${precio}.${url ? ` Puedes pagar aquí: ${url}` : ''}`);
    else l.push('En cuanto la revisemos te confirmamos.');
    if (cfg.instrucciones) l.push(cfg.instrucciones);
  }
  l.push(`Tu código de inscripción: ${it.codigo}`);
  return l.join('\n');
}

/** CSV privado (con contacto) para el organizador. `celda` escapa cada valor. */
export function csvInscripciones(items, celda) {
  const cab = ['Código', 'Estado', 'Pagado', 'Nombre', 'Sexo', 'Nacimiento', 'Club', 'División', 'Clase', 'Equipamiento', 'Peso estimado', 'Apertura S', 'Apertura B', 'Apertura D', 'Contacto', 'Respuestas', 'Nota', 'Inscrito'];
  const filas = items.map(i => [i.codigo, ETIQUETA_ESTADO[i.estado] || i.estado, i.pagado ? 'Sí' : 'No', i.nombre, i.sexo, i.nacimiento, i.club, i.division, i.clase, i.equipamiento, i.pesoEstimado ?? '',
    i.aperturas?.S ?? '', i.aperturas?.B ?? '', i.aperturas?.D ?? '', i.contacto, (i.respuestas || []).map(r => `${r.texto}: ${r.valor}`).join(' | '), i.nota || '', new Date(i.creado).toISOString()]);
  return '﻿' + [cab, ...filas].map(f => f.map(celda).join(',')).join('\r\n') + '\r\n';
}

/* ---------- Pesaje ---------- */

/** Atleta pesado = tiene la hora del pesaje. */
export const estaPesado = a => !!a?.pesaje?.hora;

/** Resumen del pesaje: pesados/total y, por categoría (sexo + clase), cuántos y el rango de peso. */
export function resumenPesaje(atletas = []) {
  const pesados = atletas.filter(estaPesado);
  const por = new Map();
  for (const a of pesados) {
    const k = `${a.sexo === 'F' ? 'Mujeres' : 'Hombres'} ${a.clase || 'sin clase'}`;
    const g = por.get(k) || { categoria: k, sexo: a.sexo, clase: a.clase, n: 0, min: Infinity, max: 0 };
    g.n++; g.min = Math.min(g.min, a.peso || Infinity); g.max = Math.max(g.max, a.peso || 0); por.set(k, g);
  }
  const claseNum = c => (c ? (c[0] === '+' ? 1e4 : 0) + (parseFloat(String(c).replace(/[^\d.]/g, '')) || 0) : 1e5);
  const categorias = [...por.values()].map(g => ({ ...g, min: g.min === Infinity ? 0 : g.min })).sort((x, y) => (x.sexo === y.sexo ? 0 : x.sexo === 'M' ? -1 : 1) || claseNum(x.clase) - claseNum(y.clase));
  return { total: atletas.length, pesados: pesados.length, completo: atletas.length > 0 && pesados.length === atletas.length, categorias };
}

/** Qué pasa con la categoría tras pesar: 'igual' | 'cambia' | 'fuera'. */
export function revisarCategoria(federacion, a, peso, division = a.division) {
  const p = Number(peso);
  if (!(p >= 20 && p <= 300)) return { estado: 'fuera', clase: '' };
  const clase = claseMasCercana(federacion, a.sexo, p, division || 'Open');
  return { estado: a.clase && a.clase !== clase ? 'cambia' : 'igual', clase, antes: a.clase || '' };
}

const GRUPOS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/**
 * Reparte atletas en grupos de hasta `tope`: por plataforma, hombres y mujeres por separado, de la categoría
 * más liviana a la más pesada y por peso. Los lotes se sortean dentro de cada grupo (`azar` se inyecta para probar).
 * @returns {{ id, plataforma, sesion, grupo, lote }[]}
 */
export function repartirGrupos(atletas, { tope = 12, azar = Math.random } = {}) {
  const t = Math.max(1, Math.floor(tope) || 12);
  const clave = a => (a.clase ? (a.clase[0] === '+' ? 1e4 : 0) + (parseFloat(String(a.clase).replace(/[^\d.]/g, '')) || 0) : 1e5);
  const plats = [...new Set(atletas.map(a => a.plataforma || 'Tarima 1'))];
  const salida = [];
  for (const plataforma of plats) {
    const lista = atletas.filter(a => (a.plataforma || 'Tarima 1') === plataforma)
      .sort((a, b) => (a.sexo === b.sexo ? 0 : a.sexo === 'M' ? -1 : 1) || clave(a) - clave(b) || (a.peso || 0) - (b.peso || 0) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
    const n = Math.ceil(lista.length / t) || 1, tam = Math.ceil(lista.length / n); // grupos parejos, no uno lleno y otro con dos
    for (let g = 0; g * tam < lista.length; g++) {
      const trozo = lista.slice(g * tam, (g + 1) * tam);
      const lotes = trozo.map((_, i) => i + 1);
      for (let i = lotes.length - 1; i > 0; i--) { const j = Math.floor(azar() * (i + 1)); [lotes[i], lotes[j]] = [lotes[j], lotes[i]]; }
      trozo.forEach((a, i) => salida.push({ id: a.id, plataforma, sesion: '1', grupo: GRUPOS[g] || String(g + 1), lote: lotes[i] }));
    }
  }
  return salida;
}
