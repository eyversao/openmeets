// Barra olímpica y discos IPF vistos de canto, en SVG. La usan el banner y el GIF del README.
// barra(svg, { cx, cy, largo, k }) dibuja la barra centrada en (cx, cy) y devuelve
// { grupo, piezas: [{ r, i, lado }] } para animar la carga (i = 0..4 discos, 5 = collarín).
// Carga: 25 + 25 + 20 + 15 + 10 por lado + collarines 2,5 + barra 20 = 215 kg.
window.DISCOS = [['#E5352B', 176, 30], ['#E5352B', 176, 30], ['#2563EB', 176, 26], ['#F5C400', 156, 22], ['#1E9E4A', 134, 18]];
window.SUMA = [50, 50, 40, 30, 20, 5]; // kg que añade cada pieza contando los dos lados

window.barra = (svg, { cx = 600, cy = 100, largo = 960, k = 1, id = 'b' } = {}) => {
  const NS = 'http://www.w3.org/2000/svg';
  const el = (n, a, p = svg) => { const e = document.createElementNS(NS, n); for (const x in a) e.setAttribute(x, a[x]); p.append(e); return e; };
  const tono = (c, f) => { const n = parseInt(c.slice(1), 16), g = v => Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f);
    return `rgb(${g(n >> 16 & 255)},${g(n >> 8 & 255)},${g(n & 255)})`; };
  const defs = el('defs', {});
  const grad = (gid, stops, vertical) => { const gr = el('linearGradient', { id: id + gid, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0 }, defs);
    stops.forEach(([o, c]) => el('stop', { offset: o, 'stop-color': c }, gr)); };
  grad('cromo', [[0, '#4A4A45'], [.35, '#EDEDE7'], [.55, '#9A9A94'], [1, '#2E2E2A']], true);
  window.DISCOS.forEach(([c], i) => grad('d' + i, [[0, tono(c, .36)], [.26, c], [.5, tono(c, 1.2)], [.8, tono(c, .7)], [1, tono(c, .34)]]));
  el('rect', { width: 2, height: 6, fill: '#00000066' },
    el('pattern', { id: id + 'mol', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs));

  const grupo = el('g', { transform: `translate(${cx} ${cy}) scale(${k})` });
  const g = el('g', {}, grupo);
  const m = largo / 2, manga = m - 186; // de la manga hacia fuera van los discos
  el('rect', { x: -m, y: -6, width: largo, height: 12, rx: 6, fill: `url(#${id}cromo)` }, g);
  el('rect', { x: -170, y: -6, width: 340, height: 12, fill: `url(#${id}mol)` }, g);
  for (const x of [-manga - 14, manga]) el('rect', { x, y: -16, width: 14, height: 32, rx: 3, fill: `url(#${id}cromo)` }, g);
  const piezas = [];
  for (const lado of [-1, 1]) {
    let x = lado < 0 ? -manga - 14 : manga + 14;
    window.DISCOS.forEach(([, alto, ancho], i) => {
      const px = lado < 0 ? x - ancho - 2 : x + 2, pg = el('g', {}, g);
      el('rect', { x: px, y: -alto / 2, width: ancho, height: alto, rx: 5, fill: `url(#${id}d${i})` }, pg);
      el('rect', { x: px + 3, y: -alto / 2 + 3, width: ancho - 6, height: 2, rx: 1, fill: '#ffffff55' }, pg);
      piezas.push({ r: pg, i, lado }); x += lado * (ancho + 2);
    });
    const c = lado < 0 ? x - 18 : x + 2;
    piezas.push({ r: el('rect', { x: c, y: -20, width: 16, height: 40, rx: 4, fill: `url(#${id}cromo)` }, g), i: window.DISCOS.length, lado });
  }
  return { grupo, g, piezas };
};
