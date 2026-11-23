// Calcula la tabla de precarga de módulos que va en web/index.html (bloque /*PRECARGA*/…/*FIN*/): los módulos que app.js importa
// siempre («base») y los de la vista de cada ruta, para bajarlos en paralelo en vez de en cascada. Lo escribe scripts/sw-lista.mjs.
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const WEB = resolve(import.meta.dirname, '..', 'web');
const IMPORTA = /^\s*(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]|^\s*import\s*['"](\.[^'"]+)['"]/gm;

/** Cierre de imports estáticos de un módulo (rutas absolutas, sin repetir). */
export function cierre(archivo, vistos = new Set()) {
  if (vistos.has(archivo)) return vistos;
  vistos.add(archivo);
  for (const m of readFileSync(archivo, 'utf8').matchAll(IMPORTA)) cierre(resolve(dirname(archivo), m[1] || m[2]), vistos);
  return vistos;
}

/** Misma conversión de patrón a regex que usa app.js para resolver rutas. */
const regexDe = patron => {
  const re = patron.replace(/\/:(\w+)(\?)?/g, (_, n, opc) => (opc ? '(?:/([^/]+))?' : '/([^/]+)'));
  return `^${re === '/' ? '/?' : re}/?$`;
};

/** Rutas de app.js: patrón como regex (texto) y módulo de la vista (ruta absoluta). */
export function rutasDeApp() {
  const app = join(WEB, 'js', 'app.js');
  return [...readFileSync(app, 'utf8').matchAll(/patron: '([^']+)', cargar: \(\) => import\('(\.[^']+)'\)/g)].map(([, patron, mod]) => ({ re: regexDe(patron), vista: resolve(dirname(app), mod) }));
}

export function tabla() {
  const app = join(WEB, 'js', 'app.js');
  const url = f => '/' + relative(WEB, f).split(sep).join('/');
  const base = [...cierre(app)].filter(f => f !== app);
  const enBase = new Set(base);
  return { base: base.map(url), rutas: rutasDeApp().map(({ re, vista }) => [re, [...cierre(vista)].filter(f => !enBase.has(f)).map(url)]) };
}

export const bloque = t => `/*PRECARGA*/${JSON.stringify(t)}/*FIN*/`;
export const BLOQUE = /\/\*PRECARGA\*\/[\s\S]*?\/\*FIN\*\//;

/** CSS que todas las páginas necesitan, en orden; sw-lista.mjs los une en web/css/app.css (una sola petición en vez de nueve). */
export const CSS_GLOBALES = ['tokens', 'base', 'componentes', 'luces', 'marca', 'publico', 'barra-visual', 'pantalla', 'juez'];
export const cssUnido = () => `/* GENERADO por scripts/sw-lista.mjs a partir de ${CSS_GLOBALES.map(n => n + '.css').join(', ')}: no lo edites. */\n` + CSS_GLOBALES.map(n => readFileSync(join(WEB, 'css', n + '.css'), 'utf8')).join('\n');
