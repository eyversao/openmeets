/* ============================================================
   OPENMEETS — Barra cargada (la de VettaPro) y franja de lectura rápida
   barraVisual: el mismo dibujo, colores IPF, collarín y manga. Se escala a su caja.
   franjaDiscos: un tramo por peso de disco, con «25 kg ×4» debajo para leerlo de un vistazo.
   cargaVisual: las dos juntas más la línea de barra y collarines y el aviso si no se puede cargar.
   ============================================================ */

import { el } from '../util.js';
import { t } from '../i18n.js';
import { specKg, agruparDiscos } from '../nucleo/discos.js';

const ANCHO = 476;
const ALTO = 260;
const coma = n => String(Math.round(Number(n) * 100) / 100).replace('.', ',');

/** Colores del meet por peso: { kg: '#hex' }. */
export const coloresDe = meet => Object.fromEntries((meet?.discos || []).filter(d => d?.color).map(d => [Number(d.kg), d.color]));

/** @param {number[]} discos kilos por lado, de mayor a menor. */
export function barraVisual(discos, { seguro = true, colores = {} } = {}) {
  const pila = el('div.ag-pila', {}, discos.map((w, i) => {
    const p = specKg(w);
    const color = colores[w] || p.color;
    const claro = w >= 5 && color !== '#FFFFFF';
    return el('div.ag-disco', { style: { height: (p.height / 100) * ALTO + 'px', width: p.thickness * 2 + 'px', zIndex: String(50 - i), animationDelay: i * 40 + 'ms' } },
      el('div.ag-disco-cara', { style: { backgroundColor: color } }, [
        el('div.ag-brillo'),
        el('span', { style: { color: claro ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.6)' }, text: `${coma(w)} KG` }),
      ]));
  }));
  if (seguro) pila.append(el('div.ag-seguro', {}, el('i')));
  const eje = el('div.ag-eje', {}, [el('div.ag-barra'), el('div.ag-manga'), el('div.ag-tope'), pila]);
  eje.style.setProperty('--grosor', '29px');
  const caja = el('div.barra-visual', { role: 'img', 'aria-label': t('Discos por lado: {discos}', { discos: discos.map(coma).join(', ') || t('barra sola') }) }, eje);

  // El dibujo tiene medidas fijas: se escala para caber en cualquier caja.
  const ajustar = () => {
    const { width, height } = caja.getBoundingClientRect();
    if (!width || !height) return;
    eje.style.transform = `scale(${Math.min(width / ANCHO, height / ALTO)})`;
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(ajustar).observe(caja);
  return caja;
}

/**
 * Franja segmentada: ancho de cada tramo proporcional a su cantidad; cada disco lleva su peso con el
 * contraste que le toca; debajo, «25 kg ×4» (×N = discos de ese peso a cada lado).
 */
export function franjaDiscos(discos, { colores = {} } = {}) {
  const tramos = agruparDiscos(discos, colores);
  return el('div.franja-discos', { role: 'list', 'aria-label': t('Discos por cada lado') }, tramos.map(x => el('div.franja-tramo', { role: 'listitem', style: { flexGrow: String(x.n) } }, [
    el('div.franja-color', { style: { backgroundColor: x.color, color: x.texto } }, Array.from({ length: x.n }, () => el('span', { text: coma(x.kg) }))),
    el('p.franja-txt.datos', {}, [el('b', { text: coma(x.kg) }), ' kg ', el('span.franja-n', { text: `×${x.n}` })]),
  ])));
}

/**
 * @param {{ discos: number[], barra: number, collar: number, sobra: number }} carga
 * @param {{ meet?: object, grande?: boolean }} opc  `grande`: pantalla de tarima (se lee desde lejos).
 */
export function cargaVisual(carga, { meet = null, grande = false } = {}) {
  const colores = coloresDe(meet);
  const c = carga || { discos: [], barra: 0, collar: 0, sobra: 0 };
  return el('div.carga-visual', { class: grande ? 'grande' : '' }, [
    el('div.carga-fila', {}, [
      barraVisual(c.discos, { seguro: c.collar > 0, colores }),
      el('div.carga-info', {}, [
        el('p.franja-barra.datos', { text: c.collar > 0 ? t('Barra {kg} kg + collarines {c} kg', { kg: coma(c.barra), c: coma(c.collar) }) : t('Barra {kg} kg, sin collarines', { kg: coma(c.barra) }) }),
        c.sobra > 0 ? el('p.franja-aviso', { role: 'alert', text: t('No se puede cargar con los discos disponibles: sobran {kg} kg por cargar.', { kg: coma(c.sobra) }) }) : null,
      ]),
    ]),
    c.discos.length ? franjaDiscos(c.discos, { colores }) : el('p.franja-sola', { text: t('Barra sola') }),
  ]);
}
