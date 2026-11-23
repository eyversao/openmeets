/* ============================================================
   OPENMEETS — Sonidos de tarima, sintetizados con WebAudio (sin archivos)
   Todo en try/catch: sin AudioContext (Node, navegador viejo) no hace nada.
   ============================================================ */

const CLAVE = 'openmeets-sonido';
let ctx = null;

const guardado = () => { try { if (typeof document === 'undefined') return true; return globalThis.localStorage?.getItem(CLAVE) !== '0'; } catch { return true; } };
let encendido = guardado();

export const activo = () => encendido;
export function activar(si) {
  encendido = !!si;
  try { if (typeof document !== 'undefined') globalThis.localStorage?.setItem(CLAVE, si ? '1' : '0'); } catch { /* sin almacenamiento */ }
}

function contexto() {
  try {
    if (!ctx) { const A = globalThis.AudioContext || globalThis.webkitAudioContext; if (!A) return null; ctx = new A(); }
    return ctx;
  } catch { return null; }
}

/** El navegador exige un gesto del usuario: llámalo desde un clic. */
export function desbloquear() {
  try {
    const c = contexto();
    if (!c) return false;
    if (c.state === 'suspended') c.resume();
    const o = c.createOscillator(), g = c.createGain();
    g.gain.value = 0.0001; o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.02);
    return true;
  } catch { return false; }
}

/** Una nota: frecuencia, inicio y duración en segundos, forma de onda y volumen. */
function nota(freq, ini, dur, tipo = 'sine', vol = 0.4) {
  const c = contexto();
  if (!c) return;
  const t = c.currentTime + ini;
  const o = c.createOscillator(), g = c.createGain();
  o.type = tipo;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
  g.gain.setValueAtTime(vol, t + Math.max(0.02, dur - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(c.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

const sonar = f => { if (!encendido) return; try { const c = contexto(); if (!c) return; if (c.state === 'suspended') c.resume(); f(); } catch { /* sin audio */ } };

/** Chicharra de nulo: buzzer grave de un segundo. */
export const chicharra = () => sonar(() => { nota(110, 0, 1, 'sawtooth', 0.45); nota(116, 0, 1, 'square', 0.25); nota(55, 0, 1, 'sine', 0.35); });
/** Válido: tono limpio y ascendente. */
export const valido = () => sonar(() => { nota(880, 0, 0.18, 'sine', 0.35); nota(1320, 0.14, 0.45, 'sine', 0.35); });
/** Pitido corto (avisos a 30 y 10 s). */
export const pitido = () => sonar(() => nota(1000, 0, 0.15, 'square', 0.25));
/** Fin de tiempo: tres pitidos. */
export const final = () => sonar(() => { [0, 0.3, 0.6].forEach(t => nota(1000, t, 0.2, 'square', 0.3)); });
