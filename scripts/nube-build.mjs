// Prepara publico/ para Firebase Hosting: copia web/, la empaqueta para la nube y escribe publico/nube.json con la configuración web de Firebase.
// La configuración (pública, pero no se sube al repositorio) se lee de OPENMEETS_FIREBASE_CONFIG o, si no está, de
// %USERPROFILE%\Documents\OpenMeets\firebase-config.json. Uso: node scripts/nube-build.mjs   (o npm run nube:build)
// Empaquetado (solo la nube; el modo local sirve web/ tal cual): esbuild junta los módulos en trozos con hash en el nombre
// (publico/a/, caché «immutable»), une el CSS global en un solo archivo y reescribe index.html y sw.js con esos nombres.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { BLOQUE, CSS_GLOBALES, bloque, rutasDeApp } from './precarga.mjs';

const RAIZ = resolve(import.meta.dirname, '..');
const configEn = nombre => join(homedir(), 'Documents', nombre, 'firebase-config.json');
const POR_DEFECTO = existsSync(configEn('OpenMeets')) ? configEn('OpenMeets') : configEn('OpenMeet'); // carpeta antigua sin «s»

/** Config web de Firebase (acepta el JSON suelto o con un envoltorio { config } o { firebaseConfig }). */
export function leerConfig(ruta) {
  const j = JSON.parse(readFileSync(ruta, 'utf8'));
  const c = j.firebaseConfig || j.config || j;
  if (typeof c.apiKey !== 'string' || typeof c.projectId !== 'string') throw new Error(`${ruta} no tiene apiKey y projectId`);
  return c;
}

const recorrer = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? recorrer(join(d, e.name)) : [join(d, e.name)]));
const url = (destino, f) => '/' + relative(destino, f).split(sep).join('/');
const hash = b => createHash('sha1').update(b).digest('hex').slice(0, 10);
const minCss = (esbuild, t) => esbuild.transformSync(t, { loader: 'css', minify: true, legalComments: 'none' }).code;

// i18n.js busca el diccionario junto al módulo (import.meta.url); empaquetado ese módulo vive en /a/, así que se apunta a /js/i18n/.
const aDiccionario = { name: 'diccionario', setup(b) {
  b.onLoad({ filter: /[\\/]js[\\/]i18n\.js$/ }, args => {
    const viejo = 'new URL(`./i18n/${l}.json`, import.meta.url)';
    const t = readFileSync(args.path, 'utf8');
    if (!t.includes(viejo)) throw new Error('i18n.js cambió: ajusta el plugin «diccionario» de scripts/nube-build.mjs');
    return { contents: t.replace(viejo, '`/js/i18n/${l}.json`'), loader: 'js' };
  });
} };

async function empaquetar(esbuild, destino, config) {
  const web = join(RAIZ, 'web');
  const r = await esbuild.build({
    entryPoints: [join(web, 'js', 'app.js')], bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2020', legalComments: 'none',
    outdir: join(destino, 'a'), entryNames: 'app-[hash]', chunkNames: '[name]-[hash]', metafile: true, plugins: [aDiccionario], logLevel: 'warning',
  });
  const salidas = Object.entries(r.metafile.outputs).map(([ruta, o]) => ({ ruta: resolve(ruta), o }));
  const de = f => salidas.find(s => s.o.entryPoint && resolve(s.o.entryPoint) === f) || null;
  const estaticos = (s, vistos = new Set()) => { // trozo + todos los que importa con import estático
    if (vistos.has(s.ruta)) return vistos;
    vistos.add(s.ruta);
    for (const i of s.o.imports) if (i.kind === 'import-statement') { const h = salidas.find(x => x.ruta === resolve(i.path)); if (h) estaticos(h, vistos); }
    return vistos;
  };
  const entrada = de(join(web, 'js', 'app.js'));
  // app.js pide nube/inicio.js tras detectar la nube: en la nube sus trozos también se precargan, para no esperar a pedirlos en cascada.
  const base = [...new Set([...estaticos(entrada), ...estaticos(de(join(web, 'js', 'nube', 'inicio.js')))])].filter(f => f !== entrada.ruta);
  const enBase = new Set(base);
  const rutas = rutasDeApp().map(({ re, vista }) => [re, [...estaticos(de(vista))].filter(f => f !== entrada.ruta && !enBase.has(f)).map(f => url(destino, f))]);

  // CSS global: el mismo que web/css/app.css (CSS_GLOBALES) más los dos de la nube, que iniciar() añadiría tarde y moverían el diseño.
  const index = readFileSync(join(web, 'index.html'), 'utf8');
  const css = [...CSS_GLOBALES.map(n => `/css/${n}.css`), '/css/cuentas.css', '/css/nube.css'].map(u => readFileSync(join(web, u), 'utf8')).join('\n');
  const min = minCss(esbuild, css);
  const nombreCss = `app-${hash(min)}.css`;
  writeFileSync(join(destino, 'a', nombreCss), min);
  for (const f of recorrer(join(destino, 'css'))) writeFileSync(f, minCss(esbuild, readFileSync(f, 'utf8'))); // los que cargan las vistas bajo demanda

  // JS sueltos fuera (todo va empaquetado) salvo los diccionarios, que se piden con fetch.
  rmSync(join(destino, 'js'), { recursive: true, force: true });
  cpSync(join(web, 'js', 'i18n'), join(destino, 'js', 'i18n'), { recursive: true });

  const gs = ['<link rel="preconnect" href="https://www.gstatic.com" crossorigin>'];
  if (!config.emulador) gs.push('<link rel="preconnect" href="https://firestore.googleapis.com" crossorigin>');
  let html = index;
  html = html.replace('href="/css/app.css"', `href="/a/${nombreCss}"`);
  html = html.replace('<script type="module" src="/js/app.js"></script>', `<script type="module" src="${url(destino, entrada.ruta)}"></script>`)
    .replace(BLOQUE, () => bloque({ base: base.map(f => url(destino, f)), rutas: rutas }))
    .replace('  <link rel="manifest"', `  ${gs.join('\n  ')}\n  <link rel="manifest"`);
  if (html.includes('/js/app.js') || html.includes('/css/tokens.css')) throw new Error('index.html: quedaron referencias sin reescribir');
  writeFileSync(join(destino, 'index.html'), html);

  // Service worker: la lista de archivos de la nube (con los nombres con hash) y una versión que cambia con ellos.
  const archivos = recorrer(destino).map(f => url(destino, f)).filter(u => u !== '/sw.js' && u !== '/index.html' && u !== '/nube.json' && !/\.(map|mov|mp4|psd)$/i.test(u)).sort();
  const lista = ['/', ...archivos];
  const ver = hash(html + archivos.map(u => u + readFileSync(join(destino, u))).join('\0'));
  const sw = join(destino, 'sw.js');
  const t = readFileSync(sw, 'utf8');
  writeFileSync(sw, t.replace(/\/\*LISTA\*\/[\s\S]*\/\*FIN\*\//, () => `/*LISTA*/\nconst VERSION = '${ver}';\nconst ARCHIVOS = [\n${lista.map(f => `  '${f}',`).join('\n')}\n];\n/*FIN*/`));
  return { trozos: salidas.length, css: nombreCss };
}

export async function construir({ destino = join(RAIZ, 'publico'), config = process.env.OPENMEETS_FIREBASE_CONFIG || process.env.OPENMEET_FIREBASE_CONFIG || POR_DEFECTO, empaquetado = true } = {}) {
  if (!existsSync(config)) throw new Error(`No encuentro la configuración de Firebase en ${config}. Indica otra con OPENMEETS_FIREBASE_CONFIG.`);
  const c = leerConfig(config);
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });
  cpSync(join(RAIZ, 'web'), destino, { recursive: true });
  writeFileSync(join(destino, 'nube.json'), JSON.stringify(c));
  let esbuild = null;
  if (empaquetado) try { esbuild = await import('esbuild'); } catch { console.warn('esbuild no está instalado (npm install): publico/ queda sin empaquetar, más lento.'); }
  const emp = esbuild ? await empaquetar(esbuild, destino, c) : null;
  return { destino, proyecto: c.projectId, empaquetado: emp };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  try { const r = await construir(); console.log(`publico/ listo para el proyecto ${r.proyecto}${r.empaquetado ? ` (${r.empaquetado.trozos} trozos, ${r.empaquetado.css})` : ' (sin empaquetar)'}`); } catch (e) { console.error(e.message); process.exit(1); }
}
