/* Mesa: antes del intento propone el nivel de récord («Este intento sería RÉCORD NACIONAL (actual 182,5 kg)») con un botón «Marcar». */
import { el, numero } from '../../util.js';
import { t } from '../../i18n.js';
import { pedir } from '../../api.js';
import { boton, confirmar } from '../../ui.js';
import { etiquetaRecord, normalizarNombre } from '../../nucleo/competencia.js';
import { recordsQueSupera } from '../../nucleo/records.js';

const VIGENTE_MS = 15000;
const cache = new Map(); // federación normalizada → { ts, tabla } (la tabla se pide una vez por intento nuevo, no por pintada)
const ORDEN = ['mundial', 'ibero', 'nacional', 'regional', 'otro'];

/** Descarta lo guardado (por ejemplo, tras un récord automático). */
export const olvidarRecords = () => cache.clear();

/**
 * aviso({ p, lev, meet, app, onMarcar })
 * p: { a, n, kg } del intento en tarima; onMarcar(nivel, recTexto) rellena el selector de récord de la mesa.
 * Devuelve un contenedor que se llena solo cuando llega la tabla (oculto si no hay nada que avisar).
 */
export function avisoRecord({ p, lev, meet, app, onMarcar }) {
  const caja = el('div.rc-aviso', { hidden: true, role: 'status' });
  const fed = normalizarNombre(meet?.federacion);
  if (!p || !fed || !(p.kg > 0)) return caja;
  app?.estilos('records');
  const i = p.a.intentos[lev][p.n];

  function pintar(tabla) {
    const c = recordsQueSupera(p.a, lev, p.kg, tabla, meet);
    caja.hidden = !c.length;
    caja.replaceChildren(...c.sort((x, y) => ORDEN.indexOf(x.nivel) - ORDEN.indexOf(y.nivel) || (x.lev === 'total') - (y.lev === 'total')).map(r => {
      const rotulo = etiquetaRecord(r.nivel, r.recTexto);
      const ya = i.rec === r.nivel && (r.nivel !== 'otro' || (i.recTexto || '') === r.recTexto);
      return el('div.rc-aviso-fila', {}, [
        el('span', {}, [r.lev === 'total' ? t('Este total sería ') : t('Este intento sería '), el('b', { text: rotulo }), ` (${t('actual')} ${numero(r.actual, { max: 2 })} kg)`]),
        ya ? el('span.pequeno.suave', { text: t('Ya marcado') }) : boton({ texto: t('Marcar'), icono: 'trofeo', variante: 'secundario', tam: 'chico', etiqueta: t('Marcar el intento como {r}', { r: rotulo }), onclick: async () => {
          if (i.rec && !(await confirmar({ titulo: t('¿Cambiar el récord marcado?'), texto: t('Este intento ya está marcado como {a}. Pasará a {b}.', { a: etiquetaRecord(i.rec, i.recTexto), b: rotulo }), confirmar: t('Cambiar') }))) return;
          onMarcar(r.nivel, r.recTexto);
        } }),
      ]);
    }));
  }

  const c = cache.get(fed);
  if (c) pintar(c.tabla);
  if (!c || Date.now() - c.ts > VIGENTE_MS) {
    pedir('GET', `/api/records?federacion=${encodeURIComponent(meet.federacion)}`)
      .then(j => { cache.set(fed, { ts: Date.now(), tabla: j.records || [] }); pintar(j.records || []); })
      .catch(() => { /* sin la tabla la mesa sigue igual: el aviso es una ayuda */ });
  }
  return caja;
}
