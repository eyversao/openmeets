// Escribe marca/instalador/instalador.md con todos los textos de ui/textos.js (es y en), para revisarlos sin abrir el código.
// Uso: node marca/instalador/textos-md.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = { window: {} }; vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'ui', 'textos.js'), 'utf8'), ctx);
const { es, en } = ctx.window.TEXTOS;
const limpio = v => (Array.isArray(v) ? v.join(' · ') : String(v)).replace(/<\/?em>/g, '*').replace(/\|/g, '\\|');
const GRUPOS = [
  ['General', ['pasosInstalar', 'pasosDesinstalar', 'pasosEtiqueta', 'minimizar', 'cerrar', 'continuar', 'atras', 'cancelar']],
  ['Bienvenida', ['bienvenidaHtml', 'bienvenidaTexto', 'rasgos']],
  ['Licencia', ['licenciaHtml', 'licenciaTexto', 'aceptar']],
  ['Carpeta y opciones', ['carpetaHtml', 'carpetaEtiqueta', 'cambiar', 'carpetaNota', 'opcionesEtiqueta', 'escritorio', 'inicio', 'abrir', 'instalar']],
  ['Instalando', ['instalandoHtml', 'instalandoTexto', 'progresoEtiqueta', 'preparando']],
  ['Listo', ['listoHtml', 'listoTexto', 'abrirApp']],
  ['Error', ['errorHtml', 'errorTexto', 'reintentar']],
  ['Desinstalador', ['confirmarHtml', 'confirmarTexto', 'borrarDatos', 'borrarDatosAviso', 'quitar', 'quitandoHtml', 'quitandoTexto', 'hechoHtml', 'hechoTexto', 'hechoTextoSinDatos']],
  ['Solo en el modo demo', ['demoPasos', 'demoQuitar', 'demoAbrir', 'demoCerrar']],
];
let md = '# Textos del instalador de OpenMeets\n\n'
  + 'Generado desde `ui/textos.js` con `node marca/instalador/textos-md.cjs`; para cambiar un texto, edita `textos.js` y vuelve a generar este archivo. '
  + 'Entre asteriscos va la palabra en Instrument Serif cursiva. El idioma sale de `datos({ idioma })`: lo que no empieza por `en` va en español.\n';
for (const [titulo, claves] of GRUPOS) {
  md += `\n## ${titulo}\n\n| Clave | Español | English |\n| --- | --- | --- |\n`;
  for (const k of claves) md += `| \`${k}\` | ${limpio(es[k])} | ${limpio(en[k])} |\n`;
}
md += '\nLa licencia se muestra en inglés (es el texto legal del archivo `LICENSE`).\n';
fs.writeFileSync(path.join(__dirname, 'instalador.md'), md);
console.log('instalador.md listo');
