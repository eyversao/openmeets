// GIF en bucle del README, uno por idioma: captura marca/_build/gif-readme.html cuadro a cuadro y lo une con ffmpeg.
// Uso: node marca/gif-readme.cjs [en es zh]   →   docs/readme/media/openmeets-<idioma>.gif y banner-<idioma>.png
// El dominio del banner sale de OPENMEETS_DOMINIO (por defecto openmeets.web.app). SOLO_BANNER=1 salta los GIF.
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
const { chromium } = require(process.env.OPENMEETS_PLAYWRIGHT || 'playwright'); // npm i -D playwright, o OPENMEETS_PLAYWRIGHT con la ruta a uno instalado
const FPS = 20, SUB = 3, ANCHO = 960; // SUB subcuadros por cuadro: se mezclan (tmix) para el desenfoque de movimiento
const raiz = path.resolve(__dirname, '..'), salida = path.join(raiz, 'docs', 'readme', 'media');
const escena = 'file:///' + path.join(__dirname, '_build', 'gif-readme.html').replace(/\\/g, '/');
(async () => {
  fs.mkdirSync(salida, { recursive: true });
  const br = await chromium.launch({ channel: 'chrome' });
  for (const l of process.argv.slice(2).length ? process.argv.slice(2) : ['en', 'es', 'zh']) {
    const banner = await br.newPage({ viewport: { width: 2000, height: 516 } });
    await banner.goto(`${escena.replace('gif-readme', 'banner-readme')}?l=${l}&d=${encodeURIComponent(process.env.OPENMEETS_DOMINIO || 'openmeets.web.app')}`);
    await banner.evaluate(() => document.fonts.ready); await banner.waitForTimeout(200);
    await banner.screenshot({ path: path.join(salida, `banner-${l}.png`), omitBackground: true }); // esquinas redondas await banner.close();
    if (process.env.SOLO_BANNER) continue;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'om-gif-'));
    const pg = await br.newPage({ viewport: { width: 1200, height: 600 } });
    await pg.goto(`${escena}?l=${l}`); await pg.evaluate(() => document.fonts.ready);
    const n = Math.round(await pg.evaluate(() => window.DURACION) * FPS * SUB);
    for (let i = 0; i < n; i++) {
      await pg.evaluate(t => window.pintar(t), i / (FPS * SUB));
      await pg.screenshot({ path: path.join(tmp, `f${String(i).padStart(4, '0')}.png`) });
    }
    await pg.close();
    const gif = path.join(salida, `openmeets-${l}.gif`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS * SUB), '-i', path.join(tmp, 'f%04d.png'),
      '-vf', `tmix=frames=${SUB},select='not(mod(n+1\,${SUB}))',setpts=N/${FPS}/TB,scale=${ANCHO}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
      '-r', String(FPS), '-loop', '0', gif], { stdio: 'inherit' });
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(gif, (fs.statSync(gif).size / 1048576).toFixed(2) + ' MB');
  }
  await br.close();
})();
