/* ============================================================
   OPENMEETS — Categorías de peso y de edad de cada federación
   Cada federación tiene las suyas: no se mezclan. Datos de sus reglamentos
   (campo `fuente`). Cambian pocas veces; al cambiar, se edita aquí.
   Clases: '-59' = hasta 59 kg · '+120' = más de 120 kg.
   ============================================================ */

const M5 = ['-52', '-56', '-60', '-67.5', '-75', '-82.5', '-90', '-100', '-110', '-125', '-140', '+140']; // hombres: WRPF, USAPL, WPC, GPC, IPL
const F_DEL_90 = ['-44', '-48', '-52', '-56', '-60', '-67.5', '-75', '-82.5', '-90', '+90'];
const F_DEL_110 = ['-44', '-48', '-52', '-56', '-60', '-67.5', '-75', '-82.5', '-90', '-100', '-110', '+110'];

const d = (nombre, edad) => ({ nombre, edad });
const maestros5 = [d('Master 40-44', '40-44'), d('Master 45-49', '45-49'), d('Master 50-54', '50-54'), d('Master 55-59', '55-59'), d('Master 60-64', '60-64'), d('Master 65-69', '65-69'), d('Master 70-74', '70-74'), d('Master 75-79', '75-79'), d('Master 80+', '80+')];
const teen3 = [d('Teen 13-15', '13-15'), d('Teen 16-17', '16-17'), d('Teen 18-19', '18-19')];

const IPF = {
  fuente: 'Reglamento técnico de la IPF, vigente desde el 01/03/2026',
  nota: 'La edad cuenta por año calendario: eres Sub-Junior desde que cumples 14 hasta el 31 de diciembre del año en que cumples 18; Junior y Máster, de enero a diciembre.',
  pesos: { M: ['-59', '-66', '-74', '-83', '-93', '-105', '-120', '+120'], F: ['-47', '-52', '-57', '-63', '-69', '-76', '-84', '+84'] },
  // Una clase más liviana solo para Sub-Junior y Junior.
  juvenil: { divisiones: ['Sub-Junior', 'Junior'], M: ['-53'], F: ['-43'] },
  divisiones: [d('Sub-Junior', '14-18'), d('Junior', '19-23'), d('Open', '19+'), d('Master 1', '40-49'), d('Master 2', '50-59'), d('Master 3', '60-69'), d('Master 4', '70+')],
};

export const CATEGORIAS = {
  IPF,
  IPL: {
    fuente: 'IPL (según powerliftingrecords.com, mayo de 2026): confirma con el reglamento de tu campeonato',
    nota: 'Los récords de máster se llevan por bandas de 5 años.',
    pesos: { M: M5, F: F_DEL_110 },
    divisiones: [d('Junior 15-19', '15-19'), d('Junior 20-23', '20-23'), d('Open', '13+'), ...maestros5],
  },
  WRPF: {
    fuente: 'Reglamento de la WRPF, 02/02/2026',
    nota: 'La edad cuenta el día de la competencia. Sub-Junior es de 17 a 19 años (incluye al que cumple 18) y Teenage, de 14 a 16.',
    pesos: { M: M5, F: F_DEL_90 },
    divisiones: [d('Teenage', '14-16'), d('Sub-Junior', '17-19'), d('Junior', '20-23'), d('Open', '24-39'), d('Master 1', '40-49'), d('Master 2', '50-59'), d('Master 3', '60-69'), d('Master 4', '70-79'), d('Master 5', '80+')],
  },
  WPC: {
    fuente: 'Reglamento de la WPC, 2025',
    nota: 'La edad cuenta el día de la competencia. Sub Master (33-39) es solo para récords: compite en Open.',
    pesos: { M: M5, F: F_DEL_110 },
    divisiones: [...teen3, d('Junior', '20-23'), d('Open', '13+'), ...maestros5],
  },
  USAPL: {
    fuente: 'Reglamento de USA Powerlifting, versión 2026.2 (09/02/2026)',
    nota: 'La edad cuenta desde el día del cumpleaños. Open es para todo el que tenga 14 años o más, además de su división de edad. Además existen Master 6 (90-99) y Master 7 (100-109).',
    pesos: { M: M5, F: ['-44', '-48', '-52', '-56', '-60', '-65', '-70', '-75', '-82.5', '-90', '-100', '+100'] },
    divisiones: [d('Teen 1', '14-15'), d('Teen 2', '16-17'), d('Teen 3', '18-19'), d('Junior', '20-23'), d('Open', '14+'), d('Master 1', '40-49'), d('Master 2', '50-59'), d('Master 3', '60-69'), d('Master 4', '70-79'), d('Master 5', '80-89')],
  },
  GPC: {
    fuente: 'Reglamento de la GPC (edición de Australia, febrero de 2025)',
    nota: 'La edad cuenta el primer día del campeonato. Sub Master (33-39) es solo para récords: compite en Open.',
    pesos: { M: M5, F: F_DEL_110 },
    divisiones: [...teen3, d('Junior', '20-23'), d('Open', '24-39'), ...maestros5],
  },
  FCLP: {
    fuente: 'Federación Colombiana de Levantamiento de Potencia: usa las divisiones de la IPF (Sub-junior, Junior, Open, Master I-IV) en su ranking',
    nota: 'Divisiones como las de la IPF; confirma con el reglamento de tu campeonato.',
    pesos: IPF.pesos, juvenil: IPF.juvenil, divisiones: IPF.divisiones,
  },
};

/** Competencias sin reglamento propio (locales, amateur, otras): todas las clases, ordenadas, y las divisiones de la IPF. */
const orden = (a, b) => (a[0] === '+') - (b[0] === '+') || parseFloat(a.slice(1)) - parseFloat(b.slice(1));
const unir = sexo => [...new Set(Object.values(CATEGORIAS).flatMap(f => [...f.pesos[sexo], ...(f.juvenil?.[sexo] || [])]))].sort(orden);
for (const nombre of ['Local', 'Amateur', 'Otra']) {
  CATEGORIAS[nombre] = { fuente: 'Sin reglamento fijo: elige la clase que use tu campeonato', nota: '', pesos: { M: unir('M'), F: unir('F') }, divisiones: IPF.divisiones.map(x => d(x.nombre, '')) };
}

export const FEDERACIONES = Object.keys(CATEGORIAS);
export const categoriasDe = fed => CATEGORIAS[fed] || CATEGORIAS.Otra;
const sx = s => (s === 'F' ? 'F' : 'M');

/** Clases de peso de esa federación para ese sexo; Sub-Junior y Junior de la IPF suman la más liviana. */
export function clasesDe(fed, sexo, division = 'Open') {
  const c = categoriasDe(fed);
  return c.juvenil?.divisiones.includes(division) ? [...c.juvenil[sx(sexo)], ...c.pesos[sx(sexo)]] : c.pesos[sx(sexo)];
}

/** Todas las clases que la federación puede tener (para ordenar tablas, sin importar la división). */
export const todasLasClases = (fed, sexo) => { const c = categoriasDe(fed); return [...(c.juvenil?.[sx(sexo)] || []), ...c.pesos[sx(sexo)]]; };

export const divisionesDe = fed => categoriasDe(fed).divisiones;
export const etiquetaDivision = x => (x.edad ? `${x.nombre} (${x.edad})` : x.nombre);

/** La clase más cercana por encima del peso corporal (la última, si pasa de todas). */
export function claseMasCercana(fed, sexo, bw, division = 'Open') {
  const l = clasesDe(fed, sexo, division);
  if (!(Number(bw) > 0)) return l[Math.floor(l.length / 2)];
  return l.find(c => c[0] === '-' && Number(bw) <= Number(c.slice(1))) || l[l.length - 1];
}
