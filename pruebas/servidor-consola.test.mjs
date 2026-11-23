// Consola de arranque: líneas puras con y sin color, ancho, QR y detección de color.
import assert from 'node:assert/strict';
const { lineasConsola, detectarColor, sinColor, simbolo, logotipo, qrBloques, aviso } = await import(new URL('../servidor/consola.mjs', import.meta.url).href);

const d = { version: '1.0.0', local: 'http://localhost:5050/', ips: ['192.168.100.100', '10.0.0.7'], puerto: 5050, pin: '123456', datos: 'C:\Users\Eyver\AppData\Local\OpenMeets\datos', registro: 'C:\Users\Eyver\AppData\Local\OpenMeets\datos\openmeets.log' };

const plano = lineasConsola({ ...d, color: false });
const txt = plano.join('\n');
assert.ok(!/\x1b/.test(txt), 'sin color no hay secuencias ANSI');
assert.ok(plano.every(l => [...l].length <= 80), 'ancho ≤ 80 sin color');
for (const t of ['versión 1.0.0', 'por Eyver Gomez (@eyversao)', 'En este equipo', 'http://localhost:5050/', 'Teléfonos y pantallas', 'http://192.168.100.100:5050/', 'http://10.0.0.7:5050/', 'PIN de organizador', '123456', 'Pasos', 'Datos y registro', 'openmeets.log', 'Ctrl+C']) assert.ok(txt.includes(t), `falta «${t}»`);
assert.ok(!txt.includes('Escanea'), 'sin color no hay QR');

const color = lineasConsola({ ...d, color: true, truecolor: true });
const c = color.join('\n');
assert.ok(c.includes('\x1b[1;38;2;17;17;17;48;2;217;248;74m 123456 '), 'el PIN va con el resaltador lima');
assert.ok(c.includes('Escanea el QR'));
assert.ok(color.every(l => [...sinColor(l)].length <= 80), 'ancho ≤ 80 con color');
assert.ok(lineasConsola({ ...d, color: true, truecolor: false }).join('').includes('48;5;191'), 'degrada a 256 colores');
assert.equal(lineasConsola({ ...d, ips: [], color: true }).join('').includes('Escanea'), false, 'sin red no hay QR');
assert.match(sinColor(lineasConsola({ ...d, ips: [] }).join('\n')), /Sin red/);

// Dibujo: símbolo con abertura arriba a la derecha y buje al centro; logotipo de 4 filas; QR cuadrado con fondo claro.
const s = simbolo(16);
assert.equal(s.length, 8); assert.ok(s.every(f => [...f].length === 16));
assert.ok(s[0].slice(8).includes('▄') && /^ +$/.test(s[0].slice(0, 3)), 'la fila superior es un arco');
assert.equal(logotipo().length, 4);
const q = qrBloques('http://192.168.1.2:5050/');
assert.ok(q.every(f => [...f].length === q[0].length) && q.length === Math.ceil(q[0].length / 2));

// Detección de color
const tty = { isTTY: true }, pipe = { isTTY: false };
assert.equal(detectarColor({}, tty).color, true);
assert.equal(detectarColor({}, pipe).color, false);
assert.equal(detectarColor({ NO_COLOR: '1', FORCE_COLOR: '1' }, tty).color, false, 'NO_COLOR manda');
assert.equal(detectarColor({ FORCE_COLOR: '1' }, pipe).color, true);
assert.equal(detectarColor({ FORCE_COLOR: '0' }, tty).color, false);
assert.equal(detectarColor({ TERM: 'dumb' }, tty).color, false);
assert.match(aviso('x', { color: false }), /■ x/);
console.log('servidor-consola: ok');
