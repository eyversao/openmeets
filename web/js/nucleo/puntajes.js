/* ============================================================
   OPENMEETS — Puntajes (lógica pura, sin DOM)
   GL (IPF GL Points, fórmula 2020), DOTS y Wilks; el total que pide
   un puntaje y la siguiente cifra redonda.
   ============================================================ */

/**
 * Puntos IPF GL (fórmula oficial 2020).
 * @param {number} total  total levantado (kg)
 * @param {number} bw     peso corporal (kg)
 * @param {'M'|'F'} sex
 * @param {'classic'|'equipped'} equip
 */
export function ipfGL(total, bw, sex = 'M', equip = 'classic') {
  const T = Number(total), B = Number(bw);
  if (!T || !B || B < 35) return 0;
  const C = {
    'M-classic':   [1199.72839, 1025.18162, 0.00921],
    'F-classic':   [610.32796,  1045.59282, 0.03048],
    'M-equipped':  [1236.25115, 1449.21864, 0.01644],
    'F-equipped':  [758.63878,  949.31382,  0.02435],
  }[`${sex}-${equip}`] || [1199.72839, 1025.18162, 0.00921];
  const denom = C[0] - C[1] * Math.exp(-C[2] * B);
  if (denom <= 0) return 0;
  return Math.max(0, T * 100 / denom);
}

const poli = (co, x) => co.reduce((s, c, i) => s + c * x ** i, 0);
const WILKS = { M: [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-06, -1.291e-08], F: [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-05, -9.054e-08] };
const WILKS20 = { M: [47.46178854, 8.472061379, 0.07369410346, -0.001395833811, 7.07665973070743e-06, -1.20804336482315e-08], F: [-125.4255398, 13.71219419, -0.03307250631, -0.001050400051, 9.38773881462799e-06, -2.3334613884954e-08] };
const DOTS = { M: [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093], F: [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706] };
const GL_BANCA = { 'M-classic': [320.98041, 281.40258, 0.01008], 'F-classic': [142.40398, 442.52671, 0.04724], 'M-equipped': [381.22073, 733.79378, 0.02398], 'F-equipped': [221.82209, 357.00377, 0.02937] };

export const SISTEMAS = {
  Wilks: (t, b, s) => (t * 500) / poli(WILKS[s], b),
  'Wilks 2020': (t, b, s) => (t * 600) / poli(WILKS20[s], b),
  GL: (t, b, s, e, banca) => {
    if (!banca) return ipfGL(t, b, s, e);
    const [A, B, C] = GL_BANCA[`${s}-${e}`];
    return (t * 100) / (A - B * Math.exp(-C * b));
  },
  DOTS: (t, b, s) => (t * 500) / poli(DOTS[s], b),
};
/** 'IPF' (opción del meet) se calcula con GL, la fórmula vigente de la IPF. */
export const sistemaDe = f => (f === 'IPF' ? 'GL' : SISTEMAS[f] ? f : 'GL');

/** Qué explica cada puntaje (tablas y rankings). */
export const EXPLICA = {
  DOTS: 'DOTS compara totales entre pesos corporales; lo usan WRPF y muchas federaciones.',
  GL: 'GL (IPF GL Points) es el de la IPF: compara entre pesos y separa raw de equipado.',
  Wilks: 'Wilks es la fórmula clásica que usaban casi todas las federaciones antes de 2020.',
  Total: 'El total es la suma de sentadilla, banca y peso muerto, sin ajustar por peso corporal.',
};

const arriba25 = x => Math.ceil(x / 2.5 - 1e-9) * 2.5;
const sexoDe = s => (s === 'F' ? 'F' : 'M');
const equipoDe = e => (e === 'equipped' || e === 'equipado' ? 'equipped' : 'classic');

/** Puntaje de un total. 0 si faltan datos. */
export function puntaje(sistema, total, bw, sexo = 'M', equipo = 'classic', banca = false) {
  const s = sistemaDe(sistema), t = Number(total), b = Number(bw);
  if (!(t > 0) || !(b >= 35)) return 0;
  return Math.max(0, SISTEMAS[s](t, b, sexoDe(sexo), equipoDe(equipo), banca));
}

/** El total (en saltos de 2,5 kg, hacia arriba) que da ese puntaje con ese peso corporal. */
export function totalPara(meta, sistema, bw, sexo = 'M', equipo = 'classic', banca = false) {
  const por100 = puntaje(sistema, 100, bw, sexo, equipo, banca);
  return Number(meta) > 0 && por100 > 0 ? arriba25((Number(meta) / por100) * 100) : 0;
}

/** «+67,5 kg para 400 DOTS»: la siguiente cifra redonda y los kg que faltan. */
export function siguienteCifra(sistema, total, bw, sexo = 'M', equipo = 'classic') {
  const v = puntaje(sistema, total, bw, sexo, equipo);
  if (!v) return null;
  const paso = sistemaDe(sistema) === 'GL' ? 10 : 50;
  const cifra = (Math.floor(v / paso + 1e-9) + 1) * paso;
  return { cifra, kg: Math.max(2.5, totalPara(cifra, sistema, bw, sexo, equipo) - Number(total)) };
}
