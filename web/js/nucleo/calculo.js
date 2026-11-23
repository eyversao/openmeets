// OpenMeets · cálculos de meets (estado, resumen, CSV). Puros: los usan el servidor local y la versión en la nube (navegador).
import { clasificacion, total, mejor, puntos, pesoDe, ORDEN_LEV } from './competencia.js';

export const hoyISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 'en-vivo' | 'programada' | 'terminada', calculado a partir del meet (nunca se guarda). */
export function estadoMeet(meet, hoy = hoyISO()) {
  if (meet.cerrado) return 'terminada';
  const enVivo = Object.values(meet.vivo || {}).some(v => v && v.actual);
  if (enVivo) return 'en-vivo';
  const fin = meet.fechaFin || meet.fecha;
  if (fin && String(fin) < hoy) return 'terminada';
  return 'programada';
}

/** Resumen público para el listado. */
export const resumenMeet = (m, hoy) => ({
  id: m.id, nombre: m.nombre, fecha: m.fecha || '', fechaFin: m.fechaFin || '', sede: m.sede || '', ciudad: m.ciudad || '', pais: m.pais || '',
  federacion: m.federacion || '', estado: estadoMeet(m, hoy), atletas: (m.atletas || []).length, plataformas: m.plataformas || [],
  publico: m.publico !== false,
});

/** Celda de CSV: comillas dobles, y un apóstrofo delante si el texto parece una fórmula de Excel. */
export function celda(v) {
  if (v === null || v === undefined) return '';
  let t = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\r\n]/.test(t) || t !== String(v) ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * resultados.csv: puesto por categoría, datos del atleta, los 9 intentos, mejores, total y puntos.
 * Intentos: «120» válido, «-120» nulo, «(120)» declarado sin resultado, vacío sin declarar.
 */
export function resultadosCSV(meet) {
  const formula = meet.formula || 'GL';
  const cab = ['Puesto', 'Categoría', 'Nombre', 'Club', 'Sexo', 'División', 'Equipamiento', 'Clase', 'Peso corporal', 'Plataforma',
    ...ORDEN_LEV.flatMap(l => [1, 2, 3].map(n => `${l}${n}`)), 'Mejor S', 'Mejor B', 'Mejor D', 'Total', `Puntos ${formula}`];
  const val = i => (i && Number(i.kg) > 0 ? (i.r === 1 ? Number(i.kg) : i.r === -1 ? -Number(i.kg) : `(${Number(i.kg)})`) : '');
  const filas = clasificacion(meet.atletas || []).flatMap(g => g.filas.map(({ a, puesto, total: t }) => [
    puesto ?? 'DSQ', g.nombre, a.nombre, a.club, a.sexo, a.division, a.equipamiento, a.clase, pesoDe(a) || '', a.plataforma,
    ...ORDEN_LEV.flatMap(l => [0, 1, 2].map(n => val(a.intentos?.[l]?.[n]))),
    ...ORDEN_LEV.map(l => mejor(a, l) || ''), t || '', t ? Math.round(puntos(a, formula) * 100) / 100 : '',
  ]));
  return '﻿' + [cab, ...filas].map(f => f.map(celda).join(',')).join('\r\n') + '\r\n';
}

export { total, mejor, puntos };
