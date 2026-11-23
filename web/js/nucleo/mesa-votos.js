/* ============================================================
   OPENMEETS — Lógica pura de la mesa de control (votos y jueces)
   Sin DOM ni red: se prueba en Node (pruebas/mesa-votos.test.mjs).
   ============================================================ */

import { POSICIONES, normalizarVoto, decision, tarjetasDe } from './competencia.js';
import { clavePlat } from '../canal.js';

export const CADUCA_PRESENCIA_MS = 12000;

/**
 * Acepta un voto si es de esta tarima y de este turno, y si ese juez aún no votó en él.
 * `votos` es { pos: { luz, tarjetas, via, ts } }. Devuelve el mapa nuevo o null si no cuenta.
 */
export function aceptarVoto(votos, v, { plataforma, turno, modo }) {
  if (!v || v.plataforma !== plataforma || !turno || v.turno !== turno) return null;
  if (!POSICIONES.some(([p]) => p === v.pos) || votos[v.pos]) return null;
  const n = normalizarVoto({ voto: v.voto, tarjetas: v.tarjetas }, modo);
  if (!n) return null;
  return { ...votos, [v.pos]: { ...n, via: v.via || 'red', ts: v.ts || Date.now() } };
}

/** Quién ya votó, sin el color: lo que se publica antes de la revelación. */
export const votados = votos => Object.fromEntries(POSICIONES.map(([p]) => [p, !!votos[p]]));

/** Con los tres votos, las luces y el resultado; si faltan, null. */
export function revelacion(votos, modo) {
  const entrada = Object.fromEntries(POSICIONES.map(([p]) => [p, votos[p] ? { luz: votos[p].luz, tarjetas: votos[p].tarjetas } : null]));
  const resultado = decision(entrada, modo);
  if (resultado === null) return null;
  return {
    resultado,
    luces: { izq: votos.izq.luz, cen: votos.cen.luz, der: votos.der.luz, resultado, tarjetas: tarjetasDe(entrada, modo) },
  };
}

/** Texto 'm:ss' o segundos sueltos → segundos (o null si no se entiende). */
export function leerTiempo(txt) {
  const t = String(txt ?? '').trim().replace(',', '.');
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d{1,5}$/.test(t)) return Number(t);
  return null;
}

/**
 * Estado de cada juez: une la presencia de los teléfonos (clave 'Tarima_1__izq') con los mandos del driver.
 * Devuelve { izq|cen|der: { via, conectado, bateria, ts } }.
 */
export function estadoJueces(presencias = {}, dispositivos = [], plataforma, ahora = Date.now(), admite = null) {
  const salida = {};
  const base = clavePlat(plataforma);
  for (const [pos] of POSICIONES) {
    const cand = [];
    // Clave 'Tarima_1__izq' (viejo) o 'Tarima_1__izq__<dispositivo>': cada teléfono por separado.
    for (const [k, p] of Object.entries(presencias)) {
      if (k !== `${base}__${pos}` && !k.startsWith(`${base}__${pos}__`)) continue;
      if (admite && !admite(p, pos)) continue; // teléfono sin aprobar: no cuenta como juez conectado
      cand.push({ via: p.via || 'red', conectado: ahora - (Number(p.ts) || 0) < CADUCA_PRESENCIA_MS, bateria: p.bateria ?? null, ts: Number(p.ts) || 0 });
    }
    for (const d of dispositivos) {
      if (d.pos !== pos) continue;
      cand.push({ via: d.tipo || 'mando', conectado: !!d.conectado, bateria: d.bateria ?? null, ts: Number(d.ts) || 0 });
    }
    // Manda el conectado; entre iguales, el latido más reciente.
    cand.sort((a, b) => (b.conectado - a.conectado) || (b.ts - a.ts));
    salida[pos] = cand[0] || { via: null, conectado: false, bateria: null, ts: 0 };
  }
  return salida;
}
