// Mide cuánto tarda en escuchar un servidor: intenta conectar cada 20 ms (con tope de 30 ms por intento, porque Windows tarda ~1 s en rechazar un puerto cerrado).
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exe = process.argv[2];
const libre = () => new Promise(ok => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => ok(p)); }); });
const intento = puerto => new Promise(ok => { const s = net.connect(puerto, '127.0.0.1'); const t = setTimeout(() => { s.destroy(); ok(false); }, 30); s.on('connect', () => { clearTimeout(t); s.destroy(); ok(true); }); s.on('error', () => { clearTimeout(t); ok(false); }); });
const puerto = await libre();
const t0 = performance.now();
const p = exe.endsWith('.mjs')
  ? spawn(process.execPath, [exe, '--sin-navegador', '--puerto', String(puerto), '--datos', mkdtempSync(join(tmpdir(), 'om-ar-'))], { stdio: 'ignore' })
  : spawn(exe, ['--sin-navegador', '--puerto', String(puerto), '--datos', mkdtempSync(join(tmpdir(), 'om-ar-'))], { stdio: 'ignore' });
while (!(await intento(puerto))) await new Promise(r => setTimeout(r, 20));
console.log(`escucha tras ${Math.round(performance.now() - t0)} ms`);
p.kill();
process.exit(0);
