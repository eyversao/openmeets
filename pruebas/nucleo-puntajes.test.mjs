// Puntajes: GL, DOTS, Wilks, total para una meta y siguiente cifra (lógica pura).
import assert from 'node:assert/strict';
const P = await import(new URL('../web/js/nucleo/puntajes.js', import.meta.url).href);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('OK  ' + m); };

const t = P.totalPara(400, 'DOTS', 82.5, 'M');
ok(P.puntaje('DOTS', t, 82.5, 'M') >= 400 && P.puntaje('DOTS', t - 2.5, 82.5, 'M') < 400, `totalPara da el mínimo que llega a 400 DOTS (${t} kg)`);
ok(t % 2.5 === 0, 'el total va en saltos de 2,5 kg');
const s = P.siguienteCifra('DOTS', 600, 82.5, 'M');
ok(s.cifra % 50 === 0 && P.puntaje('DOTS', 600 + s.kg, 82.5, 'M') >= s.cifra, `siguiente cifra: +${s.kg} kg para ${s.cifra} DOTS`);
const g = P.siguienteCifra('GL', 600, 82.5, 'M');
ok(g.cifra % 10 === 0, 'GL redondea de 10 en 10');
ok(P.siguienteCifra('DOTS', 0, 82.5, 'M') === null, 'sin total no hay cifra');
ok(Math.abs(P.puntaje('GL', 600, 82.5, 'M') - P.ipfGL(600, 82.5, 'M', 'classic')) < 1e-9, 'GL = IPF GL Points');
ok(P.puntaje('IPF', 600, 82.5, 'M') === P.puntaje('GL', 600, 82.5, 'M'), 'IPF se calcula con GL');
ok(P.puntaje('Wilks', 600, 82.5, 'M') > 0 && P.puntaje('DOTS', 600, 30, 'M') === 0, 'Wilks da puntos y un peso de 30 kg no puntúa');
ok(P.puntaje('GL', 500, 70, 'M', 'equipado') !== P.puntaje('GL', 500, 70, 'M', 'raw'), 'equipado y raw puntúan distinto');
console.log(`\n${n} pruebas de puntajes bien`);
