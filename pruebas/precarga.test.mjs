// La tabla de precarga de web/index.html (la escribe scripts/sw-lista.mjs) debe coincidir con los imports reales de app.js.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BLOQUE, WEB, bloque, cssUnido, tabla } from '../scripts/precarga.mjs';

const html = readFileSync(join(WEB, 'index.html'), 'utf8');
assert.equal(html.match(BLOQUE)?.[0], bloque(tabla()), 'index.html tiene la tabla de precarga vieja: corre node scripts/sw-lista.mjs');
assert.equal(readFileSync(join(WEB, 'css', 'app.css'), 'utf8'), cssUnido(), 'web/css/app.css desactualizado: corre node scripts/sw-lista.mjs');
const t = tabla();
assert.ok(t.base.includes('/js/ui.js') && t.base.includes('/js/vistas/federacion/rol.js'));
assert.ok(t.rutas.length >= 10 && t.rutas.every(([re, l]) => new RegExp(re) && l.length));
for (const f of ['geist-latin-400-normal', 'instrument-serif-latin-400-normal']) assert.match(html, new RegExp(`preload" href="/fuentes/${f}\.woff2"`));
// la migración de claves antiguas sigue corriendo antes de los módulos
assert.ok(html.indexOf('openmeets.tema') < html.indexOf('type="module"') && /\^openmeet\[\.-\]/.test(html));
new Function(html.match(/<script>([\s\S]*?)<\/script>/)[1]); // el script inline de index.html debe compilar
console.log('precarga: ok');
