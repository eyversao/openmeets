// OpenMeets · exportación en el formato de OpenPowerlifting (entries + meet en un solo CSV). Puro, sin disco.
// Convenciones (https://openpowerlifting.gitlab.io/opl-csv/bulk-csv-format.html): intentos fallidos en negativo,
// intentos sin declarar en blanco, Place numérico o DQ / NS, clase «83» y «120+», Tested «Yes» o vacío.
import { clasificacion, total, mejor, ORDEN_LEV, pesoDe } from '../web/js/nucleo/competencia.js';
import { celda } from './calculo.mjs';

/** Federaciones que hacen control de dopaje: solo ahí se escribe Tested = Yes (en las demás se deja vacío). */
export const FEDERACIONES_TESTEADAS = ['IPF', 'FCLP'];

export const COLUMNAS = [
  'Name', 'Sex', 'Event', 'Equipment', 'Age', 'Division', 'BodyweightKg', 'WeightClassKg',
  'Squat1Kg', 'Squat2Kg', 'Squat3Kg', 'Squat4Kg', 'Best3SquatKg',
  'Bench1Kg', 'Bench2Kg', 'Bench3Kg', 'Bench4Kg', 'Best3BenchKg',
  'Deadlift1Kg', 'Deadlift2Kg', 'Deadlift3Kg', 'Deadlift4Kg', 'Best3DeadliftKg',
  'TotalKg', 'Place', 'Tested', 'Country', 'Federation', 'Date', 'MeetCountry', 'MeetState', 'MeetTown', 'MeetName',
];

/** '-83' → '83' · '+120' → '120+' · '83 kg' → '83'. */
export function claseOpl(clase) {
  const c = String(clase ?? '').replace(/kg/gi, '').replace(',', '.').trim();
  if (!c) return '';
  if (c.startsWith('+')) return `${c.slice(1)}+`;
  return c.replace(/^-/, '');
}

/** 'SBD', 'BD', 'B'… según los levantamientos que compite. */
export const eventoOpl = a => ORDEN_LEV.filter(l => (a.levantes || ORDEN_LEV).includes(l)).join('') || 'SBD';

/** Edad en años cumplidos el día del meet; vacío si no hay fecha de nacimiento. */
export function edadEn(nacimiento, fechaMeet) {
  const n = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nacimiento || ''), f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaMeet || '');
  if (!n || !f) return '';
  let e = Number(f[1]) - Number(n[1]);
  if (Number(f[2]) < Number(n[2]) || (Number(f[2]) === Number(n[2]) && Number(f[3]) < Number(n[3]))) e--;
  return e >= 0 && e < 120 ? e : '';
}

/** Un intento: kg positivo si fue válido, negativo si fue nulo, vacío si falta resultado o fue un pase. */
const valor = i => (i && Number(i.kg) > 0 ? (i.r === 1 ? Number(i.kg) : i.r === -1 ? -Number(i.kg) : '') : '');

function lugar(a, puesto) {
  if (puesto) return puesto;
  const levo = ORDEN_LEV.some(l => (a.intentos?.[l] || []).some(i => i && (i.r === 1 || i.r === -1)));
  return levo ? 'DQ' : 'NS';
}

/** El CSV completo de un meet. Una fila por atleta, en el orden de su categoría. */
export function openPowerliftingCSV(meet) {
  const tested = FEDERACIONES_TESTEADAS.includes(String(meet.federacion || '').toUpperCase()) ? 'Yes' : '';
  const filas = clasificacion(meet.atletas || []).flatMap(g => g.filas.map(({ a, puesto }) => {
    const celdas = ORDEN_LEV.flatMap(l => {
      const lista = a.intentos?.[l] || [];
      return [0, 1, 2, 3].map(n => valor(lista[n])).concat([(a.levantes || ORDEN_LEV).includes(l) ? mejor(a, l) || '' : '']);
    });
    return [
      a.nombre, a.sexo === 'F' ? 'F' : 'M', eventoOpl(a), a.equipamiento === 'equipado' ? 'Multi-ply' : 'Raw',
      edadEn(a.nacimiento, meet.fecha), a.division || 'Open', pesoDe(a) || '', claseOpl(a.clase),
      ...celdas, total(a) || '', lugar(a, puesto), tested, a.pais || '', meet.federacion || '', meet.fecha || '',
      meet.pais || '', '', meet.ciudad || '', meet.nombre || '',
    ];
  }));
  return `${[COLUMNAS, ...filas].map(f => f.map(celda).join(',')).join('\r\n')}\r\n`;
}
