// Renderiza con Chrome (Playwright): PNG de iconos/og desde marca/_build/*.html y el manual a PDF.
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.OPENMEETS_PLAYWRIGHT || 'playwright');
const raiz = path.resolve(__dirname, '..'), b = path.join(__dirname, '_build');
const url = p => 'file:///' + p.replace(/\\/g, '/');
(async () => {
  const br = await chromium.launch({ channel: 'chrome' });
  const w = n => path.join(raiz, 'web', n);
  const hechos = [
    ['icono-192', 192, 192, w('iconos/icono-192.png'), true],
    ['icono-512', 512, 512, w('iconos/icono-512.png'), true],
    ['icono-maskable-512', 512, 512, w('iconos/icono-maskable-512.png'), true],
    ['apple-touch-180', 180, 180, w('iconos/apple-touch-180.png'), true],
    ['ico-16', 16, 16, path.join(b, 'ico-16.png'), false],
    ['ico-32', 32, 32, path.join(b, 'ico-32.png'), false],
    ['ico-48', 48, 48, path.join(b, 'ico-48.png'), false],
    ['og', 1200, 630, w('og.png'), true]];
  for (const [n, ancho, alto, out, opaco] of hechos) {
    const pg = await br.newPage({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1 });
    await pg.goto(url(path.join(b, n + '.html')));
    await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(150);
    await pg.screenshot({ path: out, omitBackground: !opaco }); await pg.close();
  }
  const man = path.join(__dirname, 'manual.html');
  if (fs.existsSync(man)) {
    const pg = await br.newPage(); await pg.goto(url(man));
    await pg.evaluate(() => document.fonts.ready); await pg.waitForTimeout(600);
    await pg.pdf({ path: path.join(__dirname, 'manual.pdf'), printBackground: true, preferCSSPageSize: true });
  }
  await br.close();
})();
