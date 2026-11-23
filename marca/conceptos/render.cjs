// Renderiza un HTML a PNG con el Chrome instalado: node render.cjs <playwright> <html> <png> [ancho]
const { chromium } = require(process.argv[2]);
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: Number(process.argv[5]) || 1200, height: 760 } });
  await p.goto('file:///' + process.argv[3]);
  await p.waitForTimeout(500);
  await p.screenshot({ path: process.argv[4], fullPage: true });
  await b.close();
})();
