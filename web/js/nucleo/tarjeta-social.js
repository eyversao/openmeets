/* ============================================================
   OPENMEETS — Tarjetas para redes: diseño (lógica pura, se prueba en Node)
   Calcula bloques { k:'rect'|'texto'|'anillo'|'logo', … } para un lienzo de 1080×1350 (feed) o 1080×1920 (historia).
   Quien dibuja (web/js/vistas/tarjeta-render.js) solo recorre los bloques con Canvas 2D. `medir(texto, tam, peso, fam)` → px:
   en el navegador es measureText; en Node, una aproximación. Los textos largos se reducen y, si aún no caben, se parten y cortan con «…».
   ============================================================ */

import * as C from './competencia.js';

export const FORMATOS = { feed: { w: 1080, h: 1350 }, historia: { w: 1080, h: 1920 } };
/** Los colores de marca fijos (tokens.css en claro/oscuro): la tarjeta siempre es oscura para verse igual en cualquier red. */
export const PALETA = { fondo: '#0E0E0D', papel: '#F5F5F2', tinta: '#111111', gris: '#9A9A94', linea: '#2E2E2B', lima: '#D9F84A', rojo: '#E5352B', ok: '#3DBE7A', mal: '#FF6B60', pend: '#6B6B66' };
export const FUENTES = { ui: 'Geist, system-ui, sans-serif', datos: '"Geist Mono", ui-monospace, monospace', titular: '"Instrument Serif", Georgia, serif' };
export const fuenteCss = b => `${b.peso} ${b.tam}px ${FUENTES[b.fam]}`;
export const MARGEN = 80;

export const medirAprox = (texto, tam, peso, fam) => String(texto).length * tam * (fam === 'datos' ? 0.6 : fam === 'titular' ? 0.42 : 0.55);

const coma = n => String(Number(n) || 0).replace('.', ',');
const kgTxt = n => (Number(n) > 0 ? `${coma(Math.round(Number(n) * 100) / 100)} kg` : '—');

/** Parte `texto` en líneas de ancho ≤ `ancho` (una palabra más larga que la línea se corta por letras). */
export function envolver(texto, ancho, medir) {
  const lineas = [];
  let l = '';
  const m = s => medir(s);
  for (const palabra of String(texto).split(/\s+/).filter(Boolean)) {
    let p = palabra;
    while (m(p) > ancho && p.length > 1) { // palabra enorme
      let n = p.length - 1;
      while (n > 1 && m(p.slice(0, n)) > ancho) n--;
      if (l) { lineas.push(l); l = ''; }
      lineas.push(p.slice(0, n)); p = p.slice(n);
    }
    if (!l) l = p; else if (m(`${l} ${p}`) <= ancho) l += ` ${p}`; else { lineas.push(l); l = p; }
  }
  if (l) lineas.push(l);
  return lineas;
}

/** Ajusta un texto a `ancho` × `lineasMax`: baja el cuerpo de `tam` hasta `tamMin` y, si no cabe, corta con «…». → { lineas, tam } */
export function ajustar(texto, { tam, tamMin = Math.round(tam * 0.5), ancho, lineasMax = 1, peso = 600, fam = 'ui', medir = medirAprox }) {
  const t = String(texto ?? '').trim();
  if (!t) return { lineas: [], tam };
  for (let s = tam; s >= tamMin; s -= 2) {
    const lineas = envolver(t, ancho, x => medir(x, s, peso, fam));
    if (lineas.length <= lineasMax) return { lineas, tam: s };
  }
  const m = x => medir(x, tamMin, peso, fam);
  const lineas = envolver(t, ancho, m).slice(0, lineasMax);
  let u = lineas[lineas.length - 1];
  while (u.length > 1 && m(`${u}…`) > ancho) u = u.slice(0, -1);
  lineas[lineas.length - 1] = `${u.replace(/[\s.,;:-]+$/, '')}…`;
  return { lineas, tam: tamMin };
}

/** Constructor de bloques con cursor vertical. */
function lienzo(formato, medir) {
  const { w, h } = FORMATOS[formato];
  const bloques = [];
  const ancho = w - MARGEN * 2;
  const K = { w, h, formato, bloques, ancho, medir };
  K.rect = (x, y, ww, hh, color, r = 0) => bloques.push({ k: 'rect', x, y, w: ww, h: hh, color, r });
  /** Texto ajustado; devuelve la y de debajo. `alinear`: izq | cen | der respecto a `x` (por defecto el margen izquierdo). */
  K.texto = (texto, y, o) => {
    const { tam, peso = 600, fam = 'ui', color = 'papel', lineasMax = 1, alinear = 'izq', x = alinear === 'cen' ? w / 2 : alinear === 'der' ? w - MARGEN : MARGEN, anchoMax = ancho, interlinea = 1.08 } = o;
    const r = ajustar(texto, { tam, tamMin: o.tamMin, ancho: anchoMax, lineasMax, peso, fam, medir });
    r.lineas.forEach((t, i) => bloques.push({ k: 'texto', texto: t, x, y: y + i * r.tam * interlinea, tam: r.tam, peso, fam, color, alinear, ancho: anchoMax }));
    return y + r.lineas.length * r.tam * interlinea;
  };
  /** Texto sobre una píldora de color (resaltado lima con texto tinta, o rojo de récord con texto papel). */
  K.chip = (texto, y, { tam, fondo = 'lima', color = 'tinta', peso = 700, fam = 'ui', x = MARGEN, anchoMax = ancho }) => {
    const pad = Math.round(tam * 0.35);
    const r = ajustar(texto, { tam, tamMin: Math.round(tam * 0.55), ancho: anchoMax - pad * 2, lineasMax: 1, peso, fam, medir });
    const tw = Math.min(anchoMax, Math.ceil(medir(r.lineas[0] || '', r.tam, peso, fam)) + pad * 2);
    K.rect(x, y, tw, r.tam * 1.2 + pad, PALETA[fondo] ? fondo : 'lima', Math.round(tam * 0.18));
    bloques.push({ k: 'texto', texto: r.lineas[0] || '', x: x + pad, y: y + pad / 2 + r.tam * 0.05, tam: r.tam, peso, fam, color, alinear: 'izq', ancho: tw - pad * 2 });
    return y + r.tam * 1.2 + pad;
  };
  return K;
}

/** Marco común: logo y nombre del meet arriba, crédito «openmeets» abajo. Devuelve { y0 (donde empieza el contenido), y1 (donde acaba) }. */
function marco(K, { meet, lugar }) {
  const seguro = K.formato === 'historia' ? 170 : 0; // zonas que tapa la interfaz de las historias
  const top = MARGEN + seguro;
  K.rect(0, 0, K.w, K.h, 'fondo');
  K.bloques.push({ k: 'logo', x: MARGEN, y: top, tam: 56 });
  K.texto('openmeets', top + 8, { tam: 38, peso: 600, color: 'papel', x: MARGEN + 76 });
  K.texto(meet || '', top + 80, { tam: 34, peso: 500, color: 'gris', lineasMax: 1 });
  const pie = K.h - MARGEN - seguro;
  K.rect(MARGEN, pie - 58, K.ancho, 2, 'linea');
  K.texto([lugar, 'openmeets'].filter(Boolean).join(' · '), pie - 36, { tam: 28, peso: 500, color: 'gris' });
  return { y0: top + 170, y1: pie - 90 };
}

/** Reparto vertical: lo que sobra en la historia se reparte entre bloques. */
const holgura = K => (K.h - FORMATOS.feed.h) / 3;

/* ---------- Tarjetas ---------- */

/** Prueba el diseño con cuerpos cada vez más pequeños hasta que el contenido cabe encima del pie. */
function ajustado(construir, formato, medir) {
  let ultimo;
  for (const s of [1, 0.9, 0.8, 0.7, 0.6]) {
    const K = lienzo(formato, medir);
    const { y1, fin } = construir(K, s);
    ultimo = { w: K.w, h: K.h, bloques: K.bloques };
    if (fin <= y1) break;
  }
  return ultimo;
}

/** Récord: { etiqueta, kg, lev:'S'|'B'|'D', nombre, club?, categoria?, meet, lugar? } */
export function tarjetaRecord(d, formato = 'feed', medir = medirAprox) {
  return ajustado((K, s) => {
    const g = holgura(K), S = v => Math.round(v * s);
    let { y0, y1 } = marco(K, d);
    y0 += g;
    y0 = K.chip(String(d.etiqueta || 'RÉCORD').toUpperCase(), y0, { tam: S(52), fondo: 'rojo', color: 'papel' }) + S(50) + g;
    const kgTam = ajustar(coma(d.kg), { tam: S(330), tamMin: 120, ancho: K.ancho - 150, fam: 'datos', peso: 500, medir });
    K.texto(coma(d.kg), y0, { tam: kgTam.tam, peso: 500, fam: 'datos', anchoMax: K.ancho - 150 });
    const wk = medir(coma(d.kg), kgTam.tam, 500, 'datos');
    K.texto('kg', y0 + kgTam.tam * 0.52, { tam: S(64), peso: 500, fam: 'datos', color: 'gris', x: MARGEN + wk + 16 });
    y0 += kgTam.tam * 1.05 + S(20);
    y0 = K.texto(C.LEVANTES[d.lev] || '', y0, { tam: S(110), peso: 400, fam: 'titular', color: 'papel', lineasMax: 1 }) + S(40) + g;
    y0 = K.texto(d.nombre, y0, { tam: S(84), peso: 700, lineasMax: 2, tamMin: 40, interlinea: 1.05 }) + S(18);
    y0 = K.texto([d.club, d.categoria].filter(Boolean).join(' · '), y0, { tam: S(40), peso: 500, color: 'gris', lineasMax: 2, tamMin: 24 });
    return { y1, fin: y0 };
  }, formato, medir);
}

/** Resultado de un atleta: { nombre, club?, categoria?, S, B, D, total, puntos, formula, puesto, de, anillo:[{lev,n,estado}], meet, lugar? } */
export function tarjetaAtleta(d, formato = 'feed', medir = medirAprox) {
  return ajustado((K, s) => {
    const g = holgura(K), S = v => Math.round(v * s);
    let { y0, y1 } = marco(K, d);
    y0 += g * 0.6;
    y0 = K.texto(d.nombre, y0, { tam: S(92), peso: 700, lineasMax: 2, tamMin: 40, interlinea: 1.04 }) + S(10);
    y0 = K.texto([d.club, d.categoria].filter(Boolean).join(' · '), y0, { tam: S(38), peso: 500, color: 'gris', lineasMax: 2, tamMin: 24 }) + S(50) + g * 0.6;
    const R = S(230), cx = K.w / 2, cy = y0 + R + S(20);
    K.bloques.push({ k: 'anillo', cx, cy, r: R, grosor: S(38), segmentos: (d.anillo || []).map(x => ({ ...x, color: x.estado === 'ok' ? 'ok' : x.estado === 'mal' ? 'mal' : x.estado === 'pendiente' ? 'pend' : 'linea' })) });
    K.texto(Number(d.total) > 0 ? coma(d.total) : '—', cy - S(78), { tam: S(150), peso: 500, fam: 'datos', alinear: 'cen', x: cx, anchoMax: R * 1.5 });
    K.texto(Number(d.total) > 0 ? 'kg total' : 'sin total', cy + S(82), { tam: S(36), peso: 500, color: 'gris', alinear: 'cen', x: cx, anchoMax: R * 1.5 });
    y0 = cy + R + S(70) + g * 0.6;
    const cw = K.ancho / 3;
    [['Sentadilla', d.S], ['Banca', d.B], ['Peso muerto', d.D]].forEach(([n, v], i) => {
      const x = MARGEN + cw * i;
      K.texto(kgTxt(v), y0, { tam: S(56), peso: 500, fam: 'datos', x, anchoMax: cw - 20 });
      K.texto(n, y0 + S(70), { tam: S(30), peso: 500, color: 'gris', x, anchoMax: cw - 20 });
    });
    y0 += S(150) + g * 0.5;
    const f = d.formula === 'IPF' ? 'GL' : d.formula;
    const partes = [d.puesto ? `${d.puesto}.º de ${d.de}` : '', Number(d.puntos) > 0 ? `${coma(Math.round(d.puntos * 100) / 100)} ${f}` : ''].filter(Boolean);
    if (partes.length) y0 = K.chip(partes.join(' · '), y0, { tam: S(48), fondo: 'lima', color: 'tinta' });
    return { y1, fin: y0 };
  }, formato, medir);
}

/** Podio de categoría: { categoria, filas:[{puesto, nombre, club?, total}], meet, lugar? } (hasta 3) */
export function tarjetaPodio(d, formato = 'feed', medir = medirAprox) {
  return ajustado((K, s) => {
    const g = holgura(K), S = v => Math.round(v * s);
    let { y0, y1 } = marco(K, d);
    y0 += g * 0.5;
    K.texto('Podio', y0, { tam: S(40), peso: 600, color: 'gris' });
    y0 = K.texto(d.categoria, y0 + S(52), { tam: S(76), peso: 700, lineasMax: 2, tamMin: 40, interlinea: 1.05 }) + S(50) + g * 0.5;
    const filas = (d.filas || []).slice(0, 3), alto = S(230) + g * 0.3;
    filas.forEach((f, i) => {
      const y = y0 + i * alto;
      K.rect(MARGEN, y, K.ancho, alto - 24, i === 0 ? 'lima' : 'linea', 26);
      const c = i === 0 ? 'tinta' : 'papel', c2 = i === 0 ? 'tinta' : 'gris';
      K.texto(String(f.puesto), y + S(38), { tam: S(120), peso: 500, fam: 'datos', color: c, x: MARGEN + 36, anchoMax: 100 });
      const xn = MARGEN + 170, ancN = K.ancho - 170 - 260 - 24;
      const yb = K.texto(f.nombre, y + S(40), { tam: S(54), peso: 700, color: c, x: xn, anchoMax: ancN, lineasMax: 2, tamMin: 28, interlinea: 1.05 });
      K.texto(f.club || '', yb + 6, { tam: S(30), peso: 500, color: c2, x: xn, anchoMax: ancN, tamMin: 20 });
      K.texto(kgTxt(f.total), y + S(70), { tam: S(52), peso: 500, fam: 'datos', color: c, alinear: 'der', x: MARGEN + K.ancho - 30, anchoMax: 260, tamMin: 28 });
    });
    if (!filas.length) y0 = K.texto('Todavía sin totales válidos', y0, { tam: 44, color: 'gris', lineasMax: 2 }); else y0 += filas.length * alto - 24;
    return { y1, fin: y0 };
  }, formato, medir);
}

/** Datos de cada tarjeta a partir del meet (los mismos que enseña la página pública). null si no hay nada que mostrar. */
export function datosTarjeta(tipo, meet, ref = {}) {
  const atletas = meet?.atletas || [];
  const base = { meet: meet?.nombre || '', lugar: [meet?.ciudad, meet?.pais].filter(Boolean).join(', ') };
  const formula = meet?.formula || 'GL';
  const categoriaDe = a => [a.division, a.sexo === 'F' ? 'Mujeres' : 'Hombres', a.clase ? (/^\d/.test(String(a.clase)) ? `${a.clase} kg` : a.clase) : ''].filter(Boolean).join(' · ');
  if (tipo === 'atleta') {
    const a = atletas.find(x => x.id === ref.aid);
    if (!a) return null;
    const tf = C.tarjetaFinal(a, atletas, formula);
    return { ...base, nombre: a.nombre, club: a.club || '', categoria: categoriaDe(a), S: C.mejor(a, 'S'), B: C.mejor(a, 'B'), D: C.mejor(a, 'D'), total: tf.total, puntos: tf.puntos, formula, puesto: tf.puesto, de: tf.de, anillo: C.anilloAtleta(a) };
  }
  if (tipo === 'podio') {
    const g = C.clasificacion(atletas).find(x => x.nombre === ref.categoria);
    const filas = (g?.filas || []).filter(f => f.puesto).slice(0, 3).map(f => ({ puesto: f.puesto, nombre: f.a.nombre, club: f.a.club || '', total: f.total }));
    return filas.length ? { ...base, categoria: g.nombre, filas } : null;
  }
  if (tipo === 'record') {
    const a = atletas.find(x => x.id === ref.aid);
    const lev = ref.lev;
    const i = a && lev ? (a.intentos?.[lev] || []).filter(x => x.r === 1 && C.recValido(x.rec)).sort((x, y) => y.kg - x.kg)[0] : null;
    return a && i ? { ...base, etiqueta: C.etiquetaRecord(i.rec, i.recTexto), kg: Number(i.kg), lev, nombre: a.nombre, club: a.club || '', categoria: categoriaDe(a) } : null;
  }
  return null;
}

export const TARJETAS = { record: tarjetaRecord, atleta: tarjetaAtleta, podio: tarjetaPodio };

/** Récords válidos del meet: [{ aid, lev, nombre, etiqueta, kg }] (para ofrecer el botón «Imagen para redes»). */
export function recordsConImagen(atletas = []) {
  const out = [];
  for (const a of atletas) for (const lev of C.ORDEN_LEV) {
    const i = (a.intentos?.[lev] || []).filter(x => x.r === 1 && C.recValido(x.rec)).sort((x, y) => y.kg - x.kg)[0];
    if (i) out.push({ aid: a.id, lev, nombre: a.nombre, etiqueta: C.etiquetaRecord(i.rec, i.recTexto), kg: Number(i.kg) });
  }
  return out;
}

/** Nombre del archivo: «openmeets-record-laura-diaz-feed.png». */
export const nombreArchivo = (tipo, texto, formato) => `openmeets-${tipo}-${C.normalizarNombre(texto).replace(/ /g, '-').slice(0, 40) || 'meet'}-${formato}.png`;
