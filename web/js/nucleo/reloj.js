/* ============================================================
   OPENMEETS — Reloj de tarima (puro, sin imports)
   Estado: { estado: 'listo'|'corre'|'pausa', hasta: ms|null, restante: ms, duracion: ms }
   Cada función devuelve un reloj nuevo; el que llega no se modifica.
   ============================================================ */

const ms = seg => Math.max(0, Math.round(Number(seg) || 0)) * 1000;

export const relojNuevo = (seg = 60) => ({ estado: 'listo', hasta: null, restante: ms(seg), duracion: ms(seg) });

/** Empieza o continúa; si no queda tiempo, vuelve a la duración completa. */
export function iniciar(r, ahora = Date.now()) {
  if (r.estado === 'corre') return r;
  const restante = r.restante > 0 ? r.restante : r.duracion;
  return { ...r, estado: 'corre', restante, hasta: ahora + restante };
}

export function pausar(r, ahora = Date.now()) {
  if (r.estado !== 'corre') return r;
  return { ...r, estado: 'pausa', restante: Math.max(0, r.hasta - ahora), hasta: null };
}

/** Detiene y deja el reloj listo con toda la duración. */
export const parar = r => ({ ...r, estado: 'listo', hasta: null, restante: r.duracion });

/** Cambia la duración (en segundos) y deja el reloj listo. */
export const fijar = (r, seg) => ({ estado: 'listo', hasta: null, restante: ms(seg), duracion: ms(seg) });

/** Milisegundos que quedan. */
export const restante = (r, ahora = Date.now()) => (r.estado === 'corre' ? Math.max(0, r.hasta - ahora) : r.restante);

/** 'm:ss' (se redondea hacia arriba, como una cuenta atrás). */
export function texto(msq) {
  const s = Math.ceil(Math.max(0, msq) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Reloj de un objeto vivo; acepta el formato viejo con solo `relojHasta`. */
export function desdeVivo(v, ahora = Date.now()) {
  if (v?.reloj && typeof v.reloj === 'object') {
    const d = v.reloj.duracion > 0 ? v.reloj.duracion : 60000;
    return { estado: v.reloj.estado || 'listo', hasta: v.reloj.hasta ?? null, restante: v.reloj.restante ?? d, duracion: d };
  }
  if (v?.relojHasta > 0) return { estado: 'corre', hasta: v.relojHasta, restante: Math.max(0, v.relojHasta - ahora), duracion: 60000 };
  return relojNuevo(60);
}
