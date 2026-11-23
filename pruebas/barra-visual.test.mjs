// Barra cargada: discos por lado, agrupación para la franja y contraste del texto.
import assert from 'node:assert/strict';
const D = await import(new URL('../web/js/nucleo/discos.js', import.meta.url).href);
const L = await import(new URL('../web/js/vistas/organizar/logica.js', import.meta.url).href);
const P = await import(new URL('../web/js/vistas/pantalla-datos.js', import.meta.url).href);

const resumen = tramos => tramos.map(x => `${x.kg}x${x.n}`).join(' ');
const meet = { barra: 20, collar: 2.5, barraSentadilla: 25 };

// 202,5 kg con barra 20 y collarines 2,5: (202,5 - 20 - 5) / 2 = 88,75 por lado
for (const carga of [L.cargaDiscos(202.5, meet, 'B'), P.cargaDiscos(202.5, meet, 'B')]) {
  assert.deepEqual([carga.barra, carga.collar, carga.sobra], [20, 2.5, 0]);
  assert.equal(resumen(D.agruparDiscos(carga.discos)), '25x3 10x1 2.5x1 1.25x1');
  assert.equal(carga.discos.reduce((a, b) => a + b, 0), 88.75);
}

// Barra de sentadilla de 25: (202,5 - 25 - 5) / 2 = 86,25
const sen = L.cargaDiscos(202.5, meet, 'S');
assert.equal(sen.barra, 25);
assert.equal(sen.discos.reduce((a, b) => a + b, 0), 86.25);
assert.equal(L.cargaDiscos(202.5, meet, 'B').barra, 20);
assert.equal(P.cargaDiscos(202.5, meet, 'S').barra, 25);

// Peso imposible: con discos de 25 y 5 (pares limitados) no se llega a 61,25 por lado
const pocos = { barra: 20, collar: 2.5, discos: [{ kg: 25, pares: 2 }, { kg: 5, pares: 1 }] };
for (const c of [L.cargaDiscos(150, pocos, 'B'), P.cargaDiscos(150, pocos, 'B')]) {
  assert.equal(resumen(D.agruparDiscos(c.discos)), '25x2 5x1');
  assert.equal(c.sobra, 2 * (62.5 - 55));
}
assert.equal(L.cargaDiscos(70, { ...pocos, collar: 0 }, 'B').sobra, 0);

// Bajo el peso de la barra no hay discos ni collarines
const sola = L.cargaDiscos(20, meet, 'B');
assert.deepEqual([sola.discos.length, sola.sobra], [0, 0]);

// Agrupar: orden de carga y colores (los del meet mandan sobre los reglamentarios)
const t = D.agruparDiscos([25, 25, 5, 2.5, 2.5], { 5: '#123456' });
assert.deepEqual(t.map(x => [x.kg, x.n]), [[25, 2], [5, 1], [2.5, 2]]);
assert.equal(t[0].color, '#DC2626');
assert.equal(t[1].color, '#123456');
assert.deepEqual(D.agruparDiscos([]), []);

// Contraste: claro sobre rojo, azul, verde y negro; oscuro sobre amarillo, blanco y gris claro
for (const w of [25, 20, 10, 2.5]) assert.equal(D.colorTexto(D.specKg(w).color), '#FFFFFF', `${w} kg`);
for (const w of [15, 5, 1.25]) assert.equal(D.colorTexto(D.specKg(w).color), '#111111', `${w} kg`);

console.log('barra-visual: ok');
