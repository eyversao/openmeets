/* ============================================================
   OPENMEETS — Códigos QR (puro, sin dependencias, sin red)
   Codifica texto en bytes (UTF-8), corrección M, versiones 1 a 10 (hasta 213 bytes: sobra para un enlace de juez).
   Sale de la idea de VettaPro (que cargaba @zxing/library); aquí es un codificador propio de unas 120 líneas.
   qr(texto) → { tam, fila(y) → boolean[] , modulo(x, y) }   ·   qrTrazo(texto, { margen }) → { tam, d } para un <path>
   ============================================================ */

const ECC_M = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];  // palabras de corrección por bloque, versión 1..10
const BLOQUES_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];        // bloques por versión

const modulosDatos = v => {
  let r = (16 * v + 128) * v + 64;
  if (v >= 2) { const n = Math.floor(v / 7) + 2; r -= (25 * n - 10) * n - 55; if (v >= 7) r -= 36; }
  return r;
};
const palabrasDatos = v => Math.floor(modulosDatos(v) / 8) - ECC_M[v - 1] * BLOQUES_M[v - 1];
/** Bytes que caben como máximo en la versión v. */
const capacidad = v => palabrasDatos(v) - 1 - (v < 10 ? 1 : 2);

function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z; }
function divisorRS(grado) {
  const r = new Array(grado).fill(0); r[grado - 1] = 1;
  let raiz = 1;
  for (let i = 0; i < grado; i++) { for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], raiz); if (j + 1 < r.length) r[j] ^= r[j + 1]; } raiz = gfMul(raiz, 2); }
  return r;
}
function restoRS(datos, div) {
  const r = div.map(() => 0);
  for (const b of datos) { const f = b ^ r.shift(); r.push(0); div.forEach((c, i) => { r[i] ^= gfMul(c, f); }); }
  return r;
}

function posicionesAlineacion(v, tam) {
  if (v === 1) return [];
  const n = Math.floor(v / 7) + 2;
  const paso = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let p = tam - 7; r.length < n; p -= paso) r.splice(1, 0, p);
  return r;
}

const MASCARAS = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0];

function penalizacion(m, tam) {
  let p = 0;
  const lineas = [];
  for (let y = 0; y < tam; y++) lineas.push(m[y].map(b => (b ? '1' : '0')).join(''));
  for (let x = 0; x < tam; x++) lineas.push(m.map(f => (f[x] ? '1' : '0')).join(''));
  for (const l of lineas) {
    for (const mt of l.matchAll(/(0{5,}|1{5,})/g)) p += 3 + (mt[0].length - 5);
    for (const pat of ['10111010000', '00001011101']) for (let i = l.indexOf(pat); i >= 0; i = l.indexOf(pat, i + 1)) p += 40;
  }
  for (let y = 0; y < tam - 1; y++) for (let x = 0; x < tam - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
  const negros = m.reduce((s, f) => s + f.filter(Boolean).length, 0);
  p += Math.floor(Math.abs(negros * 20 - tam * tam * 10) / (tam * tam)) * 10;
  return p;
}

/** Codifica `texto` y devuelve la matriz de módulos. Lanza si pasa de 213 bytes. */
export function qr(texto) {
  const bytes = [...new TextEncoder().encode(String(texto))];
  let v = 1;
  while (v <= 10 && bytes.length > capacidad(v)) v++;
  if (v > 10) throw new Error('El enlace es demasiado largo para el QR');
  const tam = v * 4 + 17;

  // Bits de datos: modo bytes, longitud, datos, terminador y relleno.
  const bits = [];
  const poner = (valor, n) => { for (let i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
  poner(4, 4); poner(bytes.length, v < 10 ? 8 : 16); bytes.forEach(b => poner(b, 8));
  const total = palabrasDatos(v) * 8;
  poner(0, Math.min(4, total - bits.length));
  poner(0, (8 - (bits.length % 8)) % 8);
  const datos = [];
  for (let i = 0; i < bits.length; i += 8) datos.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xEC; datos.length < palabrasDatos(v); pad ^= 0xEC ^ 0x11) datos.push(pad);

  // Corrección de errores e intercalado.
  const nb = BLOQUES_M[v - 1], ecc = ECC_M[v - 1], crudo = Math.floor(modulosDatos(v) / 8);
  const cortos = nb - (crudo % nb), largoCorto = Math.floor(crudo / nb), div = divisorRS(ecc);
  const bloques = [];
  for (let i = 0, k = 0; i < nb; i++) {
    const d = datos.slice(k, k + largoCorto - ecc + (i < cortos ? 0 : 1)); k += d.length;
    const e = restoRS(d, div);
    if (i < cortos) d.push(0);
    bloques.push(d.concat(e));
  }
  const final = [];
  for (let i = 0; i < bloques[0].length; i++) bloques.forEach((b, j) => { if (i !== largoCorto - ecc || j >= cortos) final.push(b[i]); });

  // Patrones fijos.
  const m = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const fijo = Array.from({ length: tam }, () => new Array(tam).fill(false));
  const set = (x, y, c) => { m[y][x] = c; fijo[y][x] = true; };
  for (let i = 0; i < tam; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [tam - 4, 3], [3, tam - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
      if (x >= 0 && x < tam && y >= 0 && y < tam) set(x, y, d !== 2 && d !== 4);
    }
  }
  const al = posicionesAlineacion(v, tam);
  al.forEach((ax, i) => al.forEach((ay, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }));
  const formato = mascara => {
    const d = (0 << 3) | mascara; // corrección M = 00
    let r = d; for (let i = 0; i < 10; i++) r = (r << 1) ^ ((r >>> 9) * 0x537);
    const f = ((d << 10) | r) ^ 0x5412, b = i => ((f >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, b(i));
    set(8, 7, b(6)); set(8, 8, b(7)); set(7, 8, b(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, b(i));
    for (let i = 0; i < 8; i++) set(tam - 1 - i, 8, b(i));
    for (let i = 8; i < 15; i++) set(8, tam - 15 + i, b(i));
    set(8, tam - 8, true);
  };
  formato(0);
  if (v >= 7) {
    let r = v; for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
    const f = (v << 12) | r;
    for (let i = 0; i < 18; i++) { const c = ((f >>> i) & 1) === 1, a = tam - 11 + (i % 3), b = Math.floor(i / 3); set(a, b, c); set(b, a, c); }
  }

  // Datos en zigzag.
  for (let i = 0, derecha = tam - 1; derecha >= 1; derecha -= 2) {
    if (derecha === 6) derecha = 5;
    for (let vert = 0; vert < tam; vert++) for (let j = 0; j < 2; j++) {
      const x = derecha - j, y = ((derecha + 1) & 2) === 0 ? tam - 1 - vert : vert;
      if (!fijo[y][x] && i < final.length * 8) { m[y][x] = ((final[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
    }
  }

  // La máscara de menor penalización.
  const aplicar = k => { for (let y = 0; y < tam; y++) for (let x = 0; x < tam; x++) if (!fijo[y][x] && MASCARAS[k](x, y)) m[y][x] = !m[y][x]; };
  let mejor = 0, mejorP = Infinity;
  for (let k = 0; k < 8; k++) { aplicar(k); formato(k); const p = penalizacion(m, tam); if (p < mejorP) { mejorP = p; mejor = k; } aplicar(k); }
  aplicar(mejor); formato(mejor);
  return { tam, version: v, mascara: mejor, fila: y => m[y].slice(), modulo: (x, y) => !!m[y]?.[x] };
}

/** Trazo SVG (un rectángulo por tramo de módulos) con margen blanco: viewBox «0 0 tam tam». */
export function qrTrazo(texto, { margen = 2 } = {}) {
  const q = qr(texto);
  let d = '';
  for (let y = 0; y < q.tam; y++) {
    for (let x = 0; x < q.tam; x++) {
      if (!q.modulo(x, y)) continue;
      let l = 1; while (x + l < q.tam && q.modulo(x + l, y)) l++;
      d += `M${x + margen} ${y + margen}h${l}v1h-${l}z`;
      x += l - 1;
    }
  }
  return { tam: q.tam + margen * 2, d };
}
