// QR propio: forma, determinismo, límites y (si está a mano) igualdad con el escritor de zxing de VettaPro.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { qr, qrTrazo } = await import(new URL('../web/js/nucleo/qr.js', import.meta.url).href);

const enlace = 'http://192.168.1.20:5050/juez/copa-abc123?t=Tarima+1&p=izq&c=123456';
const q = qr(enlace);
assert.equal(q.tam, q.version * 4 + 17); assert.equal(q.version, 5);
// finders en las tres esquinas y temporización alterna en la fila 6
for (const [x0, y0] of [[0, 0], [q.tam - 7, 0], [0, q.tam - 7]]) { assert.ok(q.modulo(x0, y0) && q.modulo(x0 + 6, y0 + 6) && !q.modulo(x0 + 1, y0 + 1) && q.modulo(x0 + 3, y0 + 3)); }
for (let x = 8; x < q.tam - 8; x++) assert.equal(q.modulo(x, 6), x % 2 === 0);
assert.deepEqual(qr(enlace).fila(10), q.fila(10), 'determinista');
assert.ok(qr('a').version === 1 && qr('x'.repeat(213)).version === 10);
assert.throws(() => qr('x'.repeat(214)), /demasiado largo/);
const t = qrTrazo(enlace, { margen: 3 });
assert.equal(t.tam, q.tam + 6); assert.match(t.d, /^M3 3h/);

// Si zxing está a mano (proyecto hermano), la matriz debe ser idéntica a la de su escritor (mismos bytes y misma máscara).
try {
  const Z = createRequire(import.meta.url)(process.env.OPENMEETS_ZXING || '@zxing/library');
  const hints = new Map([[Z.EncodeHintType.MARGIN, 0], [Z.EncodeHintType.ERROR_CORRECTION, 'M']]);
  for (const txt of ['hola', enlace, 'Torneo ñandú: señal']) {
    const m = qr(txt), ref = new Z.QRCodeWriter().encode(txt, Z.BarcodeFormat.QR_CODE, 1, 1, hints);
    assert.equal(ref.getWidth(), m.tam);
    for (let y = 0; y < m.tam; y++) for (let x = 0; x < m.tam; x++) assert.equal(m.modulo(x, y), ref.get(x, y), `${txt} (${x},${y})`);
  }
  console.log('organizar-qr: bien (idéntico al escritor de zxing)');
} catch (e) { if (e.name === 'AssertionError') throw e; console.log('organizar-qr: bien (sin zxing para comparar)'); }
