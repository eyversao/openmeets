// OpenMeets · dibujo de la consola. Funciones puras: devuelven líneas de texto (con o sin color ANSI).
// Marca: disco abierto (marca/simbolo.svg), «openmeets» en bloques, papel/tinta y el lima solo como resaltador (--senal).
import { qr } from '../web/js/nucleo/qr.js';

// [truecolor, 256 colores]
const PALETA = {
  tinta: [[242, 242, 238], 255], gris: [[142, 142, 136], 245], suave: [[201, 201, 195], 251],
  mal: [[255, 107, 96], 209], oscura: [[17, 17, 17], 233], papel: [[245, 245, 242], 255], senal: [[217, 248, 74], 191],
};
const ESC = /\x1b\[[0-9;]*m/g;
export const sinColor = s => String(s).replace(ESC, '');
const ancho = s => [...sinColor(s)].length;
const relleno = (s, n) => s + ' '.repeat(Math.max(0, n - ancho(s)));

/** Qué color admite la consola. NO_COLOR manda; FORCE_COLOR fuerza; si no, solo en terminal real. */
export function detectarColor(env = process.env, salida = process.stdout) {
  let color;
  if (env.NO_COLOR) color = false;
  else if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '') color = !/^(0|false)$/i.test(env.FORCE_COLOR);
  else color = !!salida?.isTTY && env.TERM !== 'dumb';
  // Windows 10+ (conhost y Terminal) admite 24 bits; en el resto, solo si lo declara.
  const truecolor = process.platform === 'win32' || /truecolor|24bit/i.test(env.COLORTERM || '') || (salida?.getColorDepth?.() ?? 0) >= 24;
  return { color, truecolor };
}

function pintores(color, truecolor) {
  const fg = k => (truecolor ? `38;2;${PALETA[k][0].join(';')}` : `38;5;${PALETA[k][1]}`);
  const bg = k => (truecolor ? `48;2;${PALETA[k][0].join(';')}` : `48;5;${PALETA[k][1]}`);
  const envolver = (codigos, t) => (color ? `\x1b[${codigos}m${t}\x1b[0m` : t);
  return {
    tinta: t => envolver(fg('tinta'), t), negrita: t => envolver(`1;${fg('tinta')}`, t), gris: t => envolver(fg('gris'), t),
    suave: t => envolver(fg('suave'), t), mal: t => envolver(`1;${fg('mal')}`, t),
    // Resaltador lima con texto tinta: solo lo importante (URL para teléfonos y PIN).
    senal: t => (color ? envolver(`1;${fg('oscura')};${bg('senal')}`, ` ${t} `) : t),
    qr: t => envolver(`${fg('oscura')};${bg('papel')}`, t),
  };
}

const MEDIOS = ' ▀▄█';

// ---- Símbolo: disco abierto muestreado del trazado de simbolo.svg (medios bloques, 1 columna por píxel) ----
export function simbolo(px = 20) {
  const k = 53 / px, sub = 4;
  const dentro = (x, y) => {
    const dx = x - 32, dy = y - 32, d = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * 180 / Math.PI;
    return d <= 6 || (d >= 17.5 && d <= 26.5 && !(ang > -62 && ang < -38)); // abertura arriba a la derecha
  };
  const pixel = (i, j) => {
    let n = 0;
    for (let a = 0; a < sub; a++) for (let b = 0; b < sub; b++) if (dentro(5.5 + (i + (a + .5) / sub) * k, 5.5 + (j + (b + .5) / sub) * k)) n++;
    return n >= sub * sub / 2;
  };
  const filas = [];
  for (let j = 0; j < px; j += 2) {
    let f = '';
    for (let i = 0; i < px; i++) f += MEDIOS[(pixel(i, j) ? 1 : 0) + (pixel(i, j + 1) ? 2 : 0)];
    filas.push(f);
  }
  return filas;
}

// ---- Logotipo «openmeets» en bloques: 6 px de altura de x + 2 de descendente = 4 filas de texto ----
const GLIFOS = {
  o: ['.###.', '##.##', '##.##', '##.##', '##.##', '.###.'],
  p: ['####.', '##.##', '##.##', '##.##', '##.##', '####.', '##...', '##...'],
  e: ['.###.', '##.##', '#####', '##...', '##.##', '.###.'],
  n: ['####.', '##.##', '##.##', '##.##', '##.##', '##.##'],
  m: ['###.###.', '##.##.##', '##.##.##', '##.##.##', '##.##.##', '##.##.##'],
  t: ['.##..', '#####', '.##..', '.##..', '.##..', '..###'],
  s: ['.####', '##...', '.###.', '...##', '...##', '####.'],
};
export function logotipo(texto = 'openmeets') {
  const px = Array.from({ length: 8 }, () => '');
  [...texto].forEach((ch, n) => {
    const g = GLIFOS[ch], w = g[0].length;
    for (let y = 0; y < 8; y++) px[y] += (g[y] || '.'.repeat(w)) + (n < texto.length - 1 ? '.' : '');
  });
  const filas = [];
  for (let y = 0; y < 8; y += 2) filas.push([...px[y]].map((_, x) => MEDIOS[(px[y][x] === '#' ? 1 : 0) + (px[y + 1][x] === '#' ? 2 : 0)]).join(''));
  return filas;
}

// ---- QR en medios bloques (módulos oscuros sobre fondo claro): se lee con la cámara del teléfono ----
export function qrBloques(texto, margen = 3) {
  const q = qr(texto), n = q.tam + margen * 2;
  const m = (x, y) => x >= margen && y >= margen && x < n - margen && y < n - margen && q.modulo(x - margen, y - margen);
  const filas = [];
  for (let y = 0; y < n; y += 2) {
    let f = '';
    for (let x = 0; x < n; x++) f += MEDIOS[(m(x, y) ? 1 : 0) + (m(x, y + 1) ? 2 : 0)];
    filas.push(f);
  }
  return filas;
}

function envolverTexto(t, max) {
  const lineas = []; let l = '';
  for (const p of t.split(' ')) { if (l && l.length + 1 + p.length > max) { lineas.push(l); l = p; } else l = l ? `${l} ${p}` : p; }
  return l ? [...lineas, l] : lineas;
}

/** Una línea de aviso o error con el estilo de la consola. */
export function aviso(texto, { color = false, truecolor = true } = {}) {
  return `\n  ${pintores(color, truecolor).mal('■')} ${texto}`;
}

/** Todas las líneas de la consola de arranque. `color` y `truecolor` vienen de detectarColor(). */
export function lineasConsola({ version, local, ips = [], puerto, pin, datos, registro, color = false, truecolor = true, ancho: max = 80 }) {
  const c = pintores(color, truecolor);
  const sangria = '  ';
  const out = [''];

  // Cabecera: símbolo a la izquierda, logotipo y créditos a la derecha.
  const logo = logotipo();
  const derecha = { 2: logo[0], 3: logo[1], 4: logo[2], 5: logo[3], 6: `versión ${version}`, 7: 'por Eyver Gomez (@eyversao)' };
  simbolo(16).forEach((f, i) => out.push(sangria + c.tinta(f) + '   ' + (i >= 2 && i <= 5 ? c.tinta(derecha[i]) : c.gris(derecha[i] ?? ''))));
  out.push('');

  // Datos a la izquierda; el QR de la URL para teléfonos, si hay red y color, a la derecha.
  const titulo = t => c.negrita(t);
  let q = [];
  if (color && ips.length) { try { q = qrBloques(`http://${ips[0]}:${puerto}/`).map(f => c.qr(f)); } catch { q = []; } }
  const izq = [
    titulo('En este equipo'),
    '  ' + c.tinta(local),
    '  ' + c.gris('Organizador, sin PIN.'),
    '',
    titulo('Teléfonos y pantallas'),
    ...(ips.length
      ? ips.map((ip, i) => '  ' + (i === 0 ? c.senal(`http://${ip}:${puerto}/`) : c.tinta(`http://${ip}:${puerto}/`)))
      : ['  ' + c.gris('Sin red: conecta el equipo a la Wi-Fi o activa el hotspot.')]),
    ...(q.length ? ['  ' + c.gris('Escanea el QR con la cámara.')] : []),
    '',
    titulo('PIN de organizador'),
    '  ' + c.senal(pin),
    '  ' + c.gris('Solo desde otro equipo.'),
  ];
  const colIzq = Math.min(Math.max(...izq.map(ancho)) + 3, max - 2 - (q.length ? ancho(q[0]) : 0));
  const filas = Math.max(izq.length, q.length);
  for (let i = 0; i < filas; i++) out.push(sangria + (q.length ? relleno(izq[i] ?? '', colIzq) + (q[i] ?? '') : izq[i] ?? ''));
  out.push('');

  out.push(sangria + titulo('Pasos'));
  const pasos = [
    'Windows pregunta por el Firewall: pulsa «Permitir» en redes privadas.',
    'Teléfonos, pantallas y este equipo, en la misma Wi-Fi o en el hotspot.',
    'En el meet, la pestaña Jueces da los enlaces y el código de los jueces.',
  ];
  pasos.forEach((p, i) => envolverTexto(p, max - 9).forEach((l, j) => out.push(sangria + '  ' + (j ? '   ' : c.gris(`${i + 1}  `)) + c.suave(l))));
  out.push('');

  out.push(sangria + titulo('Datos y registro'));
  out.push(sangria + '  ' + c.gris('Datos     ') + c.suave(datos));
  out.push(sangria + '  ' + c.gris('Registro  ') + c.suave(registro));
  out.push('');
  out.push(sangria + c.gris('Para cerrar OpenMeets, cierra esta ventana o pulsa Ctrl+C.'));
  out.push('');
  return out.map(l => l.replace(/ +$/, ''));
}

/** Título de la ventana de la consola. */
export const tituloVentana = url => `OpenMeets · ${url}`;
