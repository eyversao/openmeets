// Icono de Windows de OpenMeets: marca/instalador/openmeets.ico con 16, 20, 24, 32, 40, 48, 64, 128 y 256 px (PNG dentro del ICO).
// Uso: node marca/instalador/icono.cjs   (Chrome vía Playwright, la misma ruta que marca/render.cjs)
// Baldosa tinta con el símbolo «disco abierto» en papel; desde 48 px, con degradado y filo de vidrio.
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.OPENMEETS_PLAYWRIGHT || 'playwright');
const TAMANOS = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const ARCO = 'M49.34 18.46 A22 22 0 1 1 42.33 12.58';

const html = l => {
  const chico = l < 48, radio = l * .225, borde = Math.max(1, l / 64);
  const fondo = chico ? '#111111' : 'radial-gradient(120% 90% at 30% 0%,#2A2A27,#111111 62%,#0A0A09)';
  const filo = chico ? '' : `box-shadow:inset 0 0 0 ${borde}px rgba(255,255,255,.10),inset 0 ${borde}px 0 rgba(255,255,255,.14);`;
  const simbolo = l * (chico ? .80 : .70);
  return `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}
.t{width:${l}px;height:${l}px;border-radius:${radio}px;background:${fondo};${filo}display:grid;place-items:center}
svg{width:${simbolo}px;height:${simbolo}px;display:block}</style>
<div class="t"><svg viewBox="5.5 5.5 53 53"><path d="${ARCO}" fill="none" stroke="#F5F5F2" stroke-width="9"/><circle cx="32" cy="32" r="6" fill="#F5F5F2"/></svg></div>`;
};

(async () => {
  const br = await chromium.launch({ channel: 'chrome' });
  const pngs = [];
  for (const l of TAMANOS) {
    const pg = await br.newPage({ viewport: { width: l, height: l }, deviceScaleFactor: 1 });
    await pg.setContent(html(l));
    pngs.push(await pg.screenshot({ omitBackground: true })); await pg.close();
  }
  await br.close();
  // ICO: cabecera (6) + entradas (16 c/u) + PNG. Ancho/alto 0 = 256.
  const cab = Buffer.alloc(6); cab.writeUInt16LE(0, 0); cab.writeUInt16LE(1, 2); cab.writeUInt16LE(TAMANOS.length, 4);
  let off = 6 + 16 * TAMANOS.length; const ents = [];
  TAMANOS.forEach((l, i) => {
    const e = Buffer.alloc(16); e.writeUInt8(l >= 256 ? 0 : l, 0); e.writeUInt8(l >= 256 ? 0 : l, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(off, 12);
    ents.push(e); off += pngs[i].length;
  });
  const ico = path.join(__dirname, 'openmeets.ico');
  fs.writeFileSync(ico, Buffer.concat([cab, ...ents, ...pngs]));
  fs.writeFileSync(path.join(__dirname, 'openmeets-256.png'), pngs[pngs.length - 1]);
  console.log(ico, (fs.statSync(ico).size / 1024).toFixed(1) + ' KB');
})();
