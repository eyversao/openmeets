/* ============================================================
   OPENMEETS — Estado de las luces a partir de un vivo (puro, sin DOM)
   Lo usan la pantalla, la página pública y el HUD; se prueba en Node.
   ============================================================ */

import * as C from './competencia.js';
import * as R from './reloj.js';

export const VENTANA_REVELADO = 12000;
const POS = ['izq', 'cen', 'der'];

/** Modo de decisión: el del vivo, si no el del evento, si no 'otra'. */
export const modoDe = (v, e) => v?.modo || e?.modo || (e?.federacion === 'IPF' ? 'IPF' : 'otra');

/**
 * Qué muestran las luces ahora.
 * - votados: pre-marcado (sin color); solo si el turno del vivo coincide con el del atleta actual.
 * - revelado: con `luces` recientes (12 s); entonces hay colores y tarjetas.
 * Un vivo viejo (sin votados/turno) sigue funcionando: sin pre-marcado.
 */
export function estadoLuces(v, ahora = Date.now()) {
  const vacio = { votados: { izq: false, cen: false, der: false }, revelado: false, luces: { izq: null, cen: null, der: null }, tarjetas: { izq: [], cen: [], der: [] }, resultado: null, rec: null };
  if (!v) return vacio;
  const reciente = !!(v.luces && v.lucesTs && ahora - v.lucesTs < VENTANA_REVELADO && ahora - v.lucesTs >= -5000);
  const res = reciente ? (v.luces.resultado === 1 || v.luces.resultado === -1 ? v.luces.resultado : null) : null;
  const hayLuz = reciente && POS.some(p => v.luces[p]);
  if (reciente && (hayLuz || res)) {
    const luces = Object.fromEntries(POS.map(p => [p, v.luces[p] || (res === 1 ? 'blanca' : res === -1 ? 'roja' : null)]));
    const tarjetas = Object.fromEntries(POS.map(p => [p, (Array.isArray(v.luces.tarjetas?.[p]) ? v.luces.tarjetas[p] : []).filter(t => t in C.TARJETAS).slice(0, 3)]));
    const r = res ?? (POS.filter(p => luces[p] === 'blanca').length >= 2 ? 1 : -1);
    return { votados: { izq: true, cen: true, der: true }, revelado: true, luces, tarjetas, resultado: r, rec: (v.juzgado || v.actual)?.rec ? (v.resultadoRec ?? null) : null };
  }
  const turnoActual = v.actual ? C.turnoDe(v.actual, v.lev) : null;
  const vale = !v.turno || !turnoActual || v.turno === turnoActual;
  const votados = Object.fromEntries(POS.map(p => [p, !!(vale && v.votados?.[p])]));
  return { ...vacio, votados };
}

/** Firma corta del estado para saber si hay que repintar. */
export const firmaLuces = est => `${POS.map(p => `${est.votados[p] ? 1 : 0}${est.luces[p] || '-'}${est.tarjetas[p].join('')}`).join('|')}|${est.resultado}|${est.rec}`;

/** Texto del resultado: { texto, clase, rec } o null mientras no haya decisión. */
export function textoResultado(est) {
  if (!est?.revelado || !est.resultado) return null;
  const valido = est.resultado === 1;
  const rec = est.rec === true ? 'RÉCORD' : est.rec === false ? 'No récord' : '';
  return { texto: valido ? 'VÁLIDO' : 'NULO', clase: valido ? 'valido' : 'nulo', rec, logrado: est.rec === true };
}

/** Motivos de las tarjetas por juez: [{ pos, color, motivo }] según el levantamiento (S, B, D). */
export function motivosTarjetas(est, lev) {
  if (!est?.revelado) return [];
  return POS.flatMap(p => est.tarjetas[p].map(color => ({ pos: p, color, motivo: C.TARJETAS[color]?.[lev] || '' })));
}

/**
 * Pitidos del reloj a 30 s, 10 s y 0. `hechos` es un Set por turno: cada umbral suena una sola vez
 * y solo si se cruza con el reloj corriendo (no suena si el reloj arranca ya por debajo).
 * Devuelve la lista de umbrales (en segundos) que deben sonar ahora.
 */
export function pitidosPendientes(ms, corre, hechos) {
  const tocar = [];
  for (const t of [30, 10, 0]) {
    if (ms > t * 1000 || hechos.has(t)) continue;
    hechos.add(t);
    const reciente = t === 0 ? true : ms > t * 1000 - 2000;
    if (corre && reciente) tocar.push(t);
  }
  return tocar;
}

/* ---------- Reloj en pantalla ---------- */

/** Reloj de un vivo (o del formato viejo con solo relojHasta). */
export const relojDe = (v, relojHasta = 0) => R.desdeVivo(v?.reloj || v?.relojHasta ? v : { relojHasta });

/** Atributos data-* de un .ev-reloj para que refrescarReloj lo mueva sin repintar. */
export const datosReloj = rl => ({ estado: rl.estado, hasta: rl.hasta || '', restante: Math.round(rl.restante), duracion: Math.round(rl.duracion) });

/** Clases del reloj: corre / pausa / fin (corriendo y a 10 s o menos). */
export function clasesReloj(rl, ahora = Date.now()) {
  const ms = R.restante(rl, ahora);
  return { corre: rl.estado === 'corre', pausa: rl.estado === 'pausa', fin: rl.estado === 'corre' && ms <= 10000 };
}

/** Pone texto y clases a un nodo .ev-reloj según sus data-*. */
export function refrescarReloj(n, ahora = Date.now()) {
  const rl = { estado: n.dataset.estado || 'listo', hasta: Number(n.dataset.hasta) || null, restante: Number(n.dataset.restante) || 0, duracion: Number(n.dataset.duracion) || 60000 };
  const t = R.texto(R.restante(rl, ahora));
  if (n.textContent !== t) n.textContent = t;
  const c = clasesReloj(rl, ahora);
  for (const k of Object.keys(c)) n.classList.toggle(k, c[k]);
}
