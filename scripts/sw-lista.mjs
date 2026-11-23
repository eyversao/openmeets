// Actualiza en web/sw.js la lista de archivos que se guardan para usar OpenMeets sin internet (y la versión de caché).
// Uso: node scripts/sw-lista.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { tabla, bloque as bloquePrecarga, BLOQUE, cssUnido } from './precarga.mjs';

const web = resolve(import.meta.dirname, '..', 'web');
const recorrer = d => readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? recorrer(join(d, e.name)) : [join(d, e.name)]));
const archivos = recorrer(web).map(f => relative(web, f).split(sep).join('/'))
  .filter(f => f !== 'sw.js' && f !== 'index.html' && !/\.(map|mov|mp4|psd)$/i.test(f)).sort();
writeFileSync(join(web, 'css', 'app.css'), cssUnido());
// Tabla de precarga de módulos dentro de index.html (la versión del service worker depende de ella, así que va antes del hash).
const indice = join(web, 'index.html');
const html = readFileSync(indice, 'utf8');
if (!BLOQUE.test(html)) throw new Error('web/index.html no tiene el bloque /*PRECARGA*/.../*FIN*/');
writeFileSync(indice, html.replace(BLOQUE, () => bloquePrecarga(tabla())));
const h = createHash('sha1');
for (const f of [...archivos, 'index.html']) h.update(f).update(readFileSync(join(web, f)));
const version = h.digest('hex').slice(0, 10);
const bloque = `/*LISTA*/\nconst VERSION = '${version}';\nconst ARCHIVOS = [\n${['/', ...archivos.map(f => '/' + f)].map(f => `  '${f}',`).join('\n')}\n];\n/*FIN*/`;
const sw = join(web, 'sw.js');
const t = readFileSync(sw, 'utf8');
if (!/\/\*LISTA\*\/[\s\S]*\/\*FIN\*\//.test(t)) throw new Error('web/sw.js no tiene el bloque /*LISTA*/.../*FIN*/');
writeFileSync(sw, t.replace(/\/\*LISTA\*\/[\s\S]*\/\*FIN\*\//, () => bloque));
console.log(`sw.js: ${archivos.length + 1} archivos, versión ${version}`);
