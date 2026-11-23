/* Récords de la tabla en las vistas públicas: los que salieron en un meet y sus píldoras (nivel y «por homologar»). */
import { el } from '../util.js';
import { t } from '../i18n.js';
import { pedir } from '../api.js';
import { pildora } from '../ui.js';
import { NOMBRE_NIVEL } from '../nucleo/records.js';

/** Nombre del nivel para mostrar: «Nacional», «Panamericano»… */
export const textoNivel = r => (r.nivel === 'otro' ? r.nivelTexto : t(NOMBRE_NIVEL[r.nivel] || r.nivel));

/** Map aid → récords de la tabla que ese atleta puso en este meet. */
export async function cargarRecordsMeet(meetId) {
  const j = await pedir('GET', `/api/records?meetId=${encodeURIComponent(meetId)}`);
  const m = new Map();
  for (const r of j.records || []) if (r.aid) { if (!m.has(r.aid)) m.set(r.aid, []); m.get(r.aid).push(r); }
  return m;
}

const una = r => pildora({ texto: `${t('Récord')} ${textoNivel(r).toLowerCase()}${r.homologado ? '' : ` · ${t('por homologar')}`}`, tono: r.homologado ? 'senal' : 'aviso' });

/** Píldoras de los récords de ese levantamiento ('S' | 'B' | 'D'). */
export const pildorasRecord = (lista, lev) => (lista || []).filter(r => r.lev === lev).map(una);
/** Fila con los récords de total, o null. */
export function pildorasTotal(lista) {
  const l = (lista || []).filter(r => r.lev === 'total');
  return l.length ? el('div.fila', { 'aria-label': t('Récords del total') }, [el('span.etiqueta', { text: t('Total') }), ...l.map(una)]) : null;
}
