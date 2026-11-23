/* ============================================================
   OPENMEETS — Idiomas
   El diccionario usa el texto en español como clave: t('Guardar').
   En español devuelve la misma clave; en otro idioma busca en i18n/<idioma>.json
   y, si no existe la clave, deja el español. Sin imports: se prueba en Node.
   Variables con llaves: t('{n} atletas', { n: 12 }).
   ============================================================ */

export const IDIOMAS = { es: 'Español', en: 'English' };
const CLAVE = 'openmeets.idioma';

let actual = 'es';
let diccionario = {};
const oyentes = new Set();

const guardado = () => { try { return globalThis.localStorage?.getItem(CLAVE) || null; } catch { return null; } };
const guardar = l => { try { globalThis.localStorage?.setItem(CLAVE, l); } catch { /* sin almacenamiento */ } };

/** Idioma del navegador si OpenMeets lo tiene; si no, español. */
export function idiomaInicial() {
  const g = guardado();
  if (g && IDIOMAS[g]) return g;
  const n = String(globalThis.navigator?.language || 'es').slice(0, 2).toLowerCase();
  return IDIOMAS[n] ? n : 'es';
}

export const idioma = () => actual;

/** Traduce una clave (texto en español). */
export function t(clave, vars) {
  let s = actual === 'es' ? clave : (diccionario[clave] ?? clave);
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

/** Carga un diccionario (objeto) sin red: útil en pruebas. */
export function usarDiccionario(l, dic) { actual = l; diccionario = dic || {}; }

async function cargarDiccionario(l) {
  if (l === 'es') return {};
  try {
    const r = await fetch(new URL(`./i18n/${l}.json`, import.meta.url));
    return r.ok ? await r.json() : {};
  } catch { return {}; }
}

/** Fija el idioma, lo guarda, carga su diccionario y avisa a quien escuche (la app repinta). */
export async function fijarIdioma(l, { guardarEleccion = true } = {}) {
  if (!IDIOMAS[l]) l = 'es';
  diccionario = await cargarDiccionario(l);
  actual = l;
  if (guardarEleccion) guardar(l);
  if (typeof document !== 'undefined') document.documentElement.lang = l;
  oyentes.forEach(fn => { try { fn(l); } catch { /* escucha rota */ } });
  return l;
}

/** Al arrancar: idioma guardado o del navegador. */
export const iniciarIdioma = () => fijarIdioma(idiomaInicial(), { guardarEleccion: false });

/** fn(idioma) cuando cambia. Devuelve cómo dejar de escuchar. */
export function alCambiarIdioma(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }
