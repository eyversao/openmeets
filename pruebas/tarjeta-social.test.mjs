// Tarjetas para redes: ajuste de textos largos, límites del lienzo y datos de cada tarjeta.
import assert from 'node:assert/strict';
import { ajustar, envolver, tarjetaRecord, tarjetaAtleta, tarjetaPodio, datosTarjeta, FORMATOS, MARGEN, medirAprox, recordsConImagen, nombreArchivo } from '../web/js/nucleo/tarjeta-social.js';
import { nuevoAtleta, anilloAtleta } from '../web/js/nucleo/competencia.js';

// --- ajustar / envolver
const a1 = ajustar('Laura Díaz', { tam: 84, ancho: 920, lineasMax: 2 });
assert.equal(a1.tam, 84); assert.deepEqual(a1.lineas, ['Laura Díaz']);
const largo = 'María de los Ángeles Fernández de la Vega y Rodríguez-Montenegro';
const a2 = ajustar(largo, { tam: 84, tamMin: 44, ancho: 920, lineasMax: 2 });
assert.ok(a2.lineas.length <= 2 && a2.tam < 84, 'el nombre largo baja el cuerpo');
assert.ok(a2.lineas.every(l => medirAprox(l, a2.tam, 700, 'ui') <= 920));
const a3 = ajustar('x'.repeat(300), { tam: 84, tamMin: 44, ancho: 920, lineasMax: 2 });
assert.ok(a3.lineas.length <= 2 && a3.lineas.at(-1).endsWith('…') && a3.lineas.every(l => medirAprox(l, a3.tam, 600, 'ui') <= 920), 'sin espacios: corta con puntos suspensivos');
assert.deepEqual(ajustar('', { tam: 50, ancho: 100 }).lineas, []);
assert.deepEqual(envolver('uno dos tres', 1000, s => s.length * 10), ['uno dos tres']);
assert.deepEqual(envolver('uno dos tres', 80, s => s.length * 10), ['uno dos', 'tres']);

// --- cada tarjeta, en los dos formatos, con textos largos: nada se sale del lienzo ni de su caja
const meetLargo = 'Campeonato Nacional Abierto de Powerlifting Clásico de la Federación Colombiana 2026';
const base = { meet: meetLargo, lugar: 'Santiago de Cali, Colombia' };
const anillo = anilloAtleta(nuevoAtleta({ id: 'a' }));
const diseños = [];
for (const f of Object.keys(FORMATOS)) {
  diseños.push(tarjetaRecord({ ...base, etiqueta: 'RÉCORD NACIONAL', kg: 182.5, lev: 'S', nombre: largo, club: 'Club Deportivo Fuerza y Honor de la Ciudad de Santiago de Cali', categoria: 'Open · Mujeres · 63 kg' }, f));
  diseños.push(tarjetaRecord({ ...base, etiqueta: 'RÉCORD IBEROAMERICANO DE LA FEDERACIÓN INTERNACIONAL', kg: 1000.25, lev: 'D', nombre: 'Ana', club: '' }, f));
  diseños.push(tarjetaAtleta({ ...base, nombre: largo, club: 'Club', categoria: 'Master 1 · Hombres · 120+ kg', S: 182.5, B: 110, D: 205, total: 497.5, puntos: 98.12, formula: 'GL', puesto: 1, de: 12, anillo }, f));
  diseños.push(tarjetaPodio({ ...base, categoria: 'Sub-Junior · Mujeres · 84+ kg y categoría con un nombre larguísimo', filas: [1, 2, 3].map(i => ({ puesto: i, nombre: `${largo} ${i}`, club: 'Club con nombre muy largo para probar el recorte', total: 400 - i * 7.5 })) }, f));
  diseños.push(tarjetaPodio({ ...base, categoria: 'x', filas: [] }, f));
}
for (const d of diseños) {
  assert.ok(d.bloques.length > 5);
  for (const b of d.bloques) {
    if (b.k === 'texto') {
      const w = medirAprox(b.texto, b.tam, b.peso, b.fam);
      const x0 = b.alinear === 'cen' ? b.x - w / 2 : b.alinear === 'der' ? b.x - w : b.x;
      assert.ok(x0 >= 0 && x0 + w <= d.w, `texto «${b.texto}» dentro del ancho (${Math.round(x0)}→${Math.round(x0 + w)})`);
      assert.ok(w <= b.ancho + 0.5, `texto «${b.texto}» cabe en su caja (${Math.round(w)} > ${b.ancho})`);
      assert.ok(b.y >= 0 && b.y + b.tam <= d.h, `texto «${b.texto}» dentro del alto`);
    }
    if (b.k === 'rect') assert.ok(b.x >= 0 && b.x + b.w <= d.w + 0.5 && b.y >= 0 && b.y + b.h <= d.h + 0.5, 'rect dentro del lienzo');
  }
  // columna izquierda sin textos pisándose
  const ts = d.bloques.filter(b => b.k === 'texto' && b.x === MARGEN && b.alinear === 'izq' && b.fam !== 'datos').sort((p, q) => p.y - q.y);
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i].y >= ts[i - 1].y + ts[i - 1].tam * 0.7, `«${ts[i].texto}» no pisa a «${ts[i - 1].texto}»`);
}
assert.ok(diseños.slice(0, 5).every(d => d.h === 1350));
assert.ok(diseños.slice(5).every(d => d.h === 1920));
const rec = diseños[0].bloques.filter(b => b.k === 'texto').map(b => b.texto);
assert.ok(rec.includes('RÉCORD NACIONAL') && rec.includes('182,5') && rec.includes('Sentadilla'), 'récord: etiqueta, kg con coma y levantamiento');
assert.ok(diseños[2].bloques.some(b => b.k === 'anillo' && b.segmentos.length === 9), 'el atleta lleva el anillo de 9 intentos');

// --- datos desde el meet
const ana = nuevoAtleta({ id: 'ana', nombre: 'Laura Díaz', sexo: 'F', division: 'Open', clase: '63', club: 'Cali', peso: 62 });
ana.intentos.S[0] = { kg: 180, r: 1, rec: false }; ana.intentos.S[1] = { kg: 182.5, r: 1, rec: 'nacional' };
ana.intentos.B[0] = { kg: 90, r: 1, rec: false }; ana.intentos.D[0] = { kg: 150, r: 1, rec: false };
const meet = { nombre: 'Copa Abierta Cali', ciudad: 'Cali', pais: 'Colombia', formula: 'GL', atletas: [ana] };
const dr = datosTarjeta('record', meet, { aid: 'ana', lev: 'S' });
assert.equal(dr.etiqueta, 'RÉCORD NACIONAL'); assert.equal(dr.kg, 182.5); assert.equal(dr.nombre, 'Laura Díaz');
assert.equal(datosTarjeta('record', meet, { aid: 'ana', lev: 'B' }), null, 'sin récord en banca no hay tarjeta');
const da = datosTarjeta('atleta', meet, { aid: 'ana' });
assert.equal(da.total, 422.5); assert.equal(da.puesto, 1); assert.equal(da.anillo.length, 9); assert.equal(da.categoria, 'Open · Mujeres · 63 kg');
assert.equal(datosTarjeta('atleta', meet, { aid: 'nadie' }), null);
const dp = datosTarjeta('podio', meet, { categoria: 'Open · Mujeres · 63' });
assert.equal(dp.filas[0].nombre, 'Laura Díaz');
assert.equal(datosTarjeta('podio', meet, { categoria: 'otra' }), null);
assert.equal(recordsConImagen(meet.atletas)[0].kg, 182.5);
assert.equal(nombreArchivo('record', 'Laura Díaz', 'feed'), 'openmeets-record-laura-diaz-feed.png');
console.log('tarjeta-social: ok');
