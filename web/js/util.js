/* ============================================================
   OPENMEETS — utilidades base: DOM, números, fechas y nombres
   ============================================================ */

import { idioma, t } from './i18n.js';
import { normalizarNombre } from './nucleo/competencia.js';

export { normalizarNombre };

/* ---------- DOM ---------- */

const SVG = 'http://www.w3.org/2000/svg';
const SVG_ETIQUETAS = new Set(['svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'text', 'title', 'defs', 'use']);

/**
 * Fábrica de elementos.
 *   el('div.tarjeta.relleno', { onclick }, [hijo, 'texto'])
 *   el('button', { class: 'boton', text: 'Hola', 'aria-label': 'x', dataset: { id: 1 } })
 * Props: class, text, style (objeto o texto), dataset, on<evento>, cualquier atributo; false/null/undefined se omiten.
 * `html` existe solo para SVG propio y texto fijo de confianza: nunca le pases datos del usuario.
 */
export function el(spec, props = {}, hijos = []) {
  const [etiqueta, ...clases] = String(spec).split('.');
  const tag = etiqueta || 'div';
  const nodo = SVG_ETIQUETAS.has(tag) ? document.createElementNS(SVG, tag) : document.createElement(tag);
  if (clases.length) nodo.setAttribute('class', clases.join(' '));
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') nodo.setAttribute('class', (nodo.getAttribute('class') ? nodo.getAttribute('class') + ' ' : '') + v);
    else if (k === 'text') nodo.textContent = v;
    else if (k === 'html') nodo.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(nodo.style, v);
    else if (k === 'dataset') Object.assign(nodo.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') nodo.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) nodo.setAttribute(k, '');
    else nodo.setAttribute(k, String(v));
  }
  anadir(nodo, hijos);
  return nodo;
}

/** Añade hijos: nodos, textos, números o listas (anidadas); ignora vacíos. */
export function anadir(nodo, hijos) {
  for (const h of Array.isArray(hijos) ? hijos.flat(Infinity) : [hijos]) {
    if (h === null || h === undefined || h === false || h === '') continue;
    nodo.append(h instanceof Node ? h : document.createTextNode(String(h)));
  }
  return nodo;
}

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
/** Vacía un nodo y, si se pasan hijos, los pone. */
export function reemplazar(nodo, hijos = []) { nodo.replaceChildren(); return anadir(nodo, hijos); }

/** Retrasa una función hasta que pasan `ms` sin llamadas. */
export function rebote(fn, ms = 250) {
  let h = 0;
  const f = (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); };
  f.cancelar = () => clearTimeout(h);
  return f;
}

/** Copia texto al portapapeles (con alternativa para http en la red local). */
export async function copiar(texto) {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sin permiso o sin https */ }
  try {
    const a = el('textarea', { style: { position: 'fixed', opacity: '0' }, readonly: true }); a.value = texto;
    document.body.append(a); a.select(); const ok = document.execCommand('copy'); a.remove(); return ok;
  } catch { return false; }
}

/* ---------- Números ---------- */

const LOCALES = { es: 'es', en: 'en' };
export const localeActual = () => LOCALES[idioma()] || 'es';

/** Número con la coma o el punto decimal del idioma: 142.5 → «142,5» (es) / «142.5» (en). */
export function numero(n, { dec = 0, max = dec, min = 0 } = {}) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return new Intl.NumberFormat(localeActual(), { minimumFractionDigits: Math.min(min, max), maximumFractionDigits: max }).format(x);
}
/** Kilos: «142,5 kg»; sin decimales si es entero. */
export const kg = n => (Number(n) > 0 ? `${numero(n, { max: 2 })} kg` : '—');
/** Puntos de fórmula con dos decimales. */
export const puntos = n => (Number(n) > 0 ? numero(n, { dec: 2 }) : '—');
/** Texto a número aceptando coma o punto: «142,5» → 142.5; vacío → null. */
export function leerNumero(texto) {
  const s = String(texto ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
/** Plural simple por clave: plural(2, 'atleta', 'atletas') → «2 atletas». */
export const plural = (n, uno, varios) => `${numero(n)} ${n === 1 ? t(uno) : t(varios)}`;

/* ---------- Fechas ---------- */

const aFecha = f => {
  if (f instanceof Date) return f;
  if (typeof f === 'number') return new Date(f);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(f || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(f);
};
const valida = d => d instanceof Date && !Number.isNaN(d.getTime());

/** «22 nov 2026». Acepta 'YYYY-MM-DD', milisegundos o Date. */
export function fecha(f, opciones = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const d = aFecha(f);
  return valida(d) ? new Intl.DateTimeFormat(localeActual(), opciones).format(d).replace(/\./g, '') : '';
}
/** «sábado 22 de noviembre». */
export const fechaLarga = f => fecha(f, { weekday: 'long', day: 'numeric', month: 'long' });
/** Rango «22–23 nov 2026» o una sola fecha. */
export function rangoFechas(ini, fin) {
  if (!fin || fin === ini) return fecha(ini);
  const a = aFecha(ini), b = aFecha(fin);
  if (!valida(a) || !valida(b)) return fecha(ini);
  // formatRange ordena día/mes según el idioma («1–2 ene 2027» / «Jan 1–2, 2027»).
  return new Intl.DateTimeFormat(localeActual(), { day: 'numeric', month: 'short', year: 'numeric' }).formatRange(a, b).replace(/\./g, '');
}
/** «14:05» a partir de milisegundos. */
export const hora = ms => (ms ? new Intl.DateTimeFormat(localeActual(), { hour: '2-digit', minute: '2-digit' }).format(new Date(ms)) : '');
/** 'YYYY-MM-DD' de hoy en hora local. */
export function hoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** «hace 3 min», «hace 2 h». */
export function hace(ms, ahora = Date.now()) {
  const s = Math.max(0, Math.round((ahora - ms) / 1000));
  if (s < 10) return t('ahora mismo');
  if (s < 60) return t('hace {n} s', { n: s });
  if (s < 3600) return t('hace {n} min', { n: Math.round(s / 60) });
  if (s < 86400) return t('hace {n} h', { n: Math.round(s / 3600) });
  return t('hace {n} d', { n: Math.round(s / 86400) });
}
/** Edad en años cumplidos (a una fecha) desde 'YYYY-MM-DD'. */
export function edad(nacimiento, ref = new Date()) {
  const n = aFecha(nacimiento);
  if (!valida(n)) return null;
  let e = ref.getFullYear() - n.getFullYear();
  if (ref.getMonth() < n.getMonth() || (ref.getMonth() === n.getMonth() && ref.getDate() < n.getDate())) e--;
  return e;
}

/* ---------- Textos ---------- */

/** Identificador corto para una URL o un id. */
export const slug = s => normalizarNombre(s).replace(/ /g, '-');
/** Iniciales de un nombre: «Ana Díaz» → «AD». */
export const iniciales = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('');
/** Compara dos textos sin tildes ni mayúsculas (para filtros de búsqueda). */
export const contiene = (texto, busqueda) => normalizarNombre(texto).includes(normalizarNombre(busqueda));
/** Clone profundo de datos JSON. */
export const clonar = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
