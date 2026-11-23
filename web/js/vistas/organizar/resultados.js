/* ============================================================
   OPENMEETS — Pestaña «Resultados»: clasificación por categoría, mejor levantador, puntos de equipo y CSV
   ============================================================ */

import { el, reemplazar, numero } from '../../util.js';
import { t } from '../../i18n.js';
import { boton, toast, vacio, confirmar } from '../../ui.js';
import * as C from '../../nucleo/competencia.js';
import { api } from '../../api.js';
import { descargar, avisoError } from './comun.js';
import { mostrarCierre } from './cierre.js';

const kg = n => (n > 0 ? numero(n, { max: 2 }) : '—');

export function montar(st) {
  const cuerpo = el('div.apilar-grande');
  const sec = (titulo, hijos, nota) => el('section.panel.org-seccion', {}, [el('h2.org-sec-titulo', { text: titulo }), nota ? el('p.suave.pequeno', { text: nota }) : null, ...hijos]);

  function pintar() {
    const atletas = st.atletas();
    const formula = st.meet.formula === 'IPF' ? 'GL' : st.meet.formula || 'GL';
    const conTotal = atletas.filter(a => C.total(a) > 0).length;
    if (!atletas.length) { reemplazar(cuerpo, vacio({ icono: 'trofeo', titulo: t('Aún no hay resultados'), texto: t('Aparecen aquí a medida que se marcan los intentos en la mesa.'), accion: { texto: t('Ir a Atletas'), icono: 'usuarios', onclick: () => st.irA('atletas') } })); return; }
    const mejores = C.mejoresPorFormula(atletas, formula);
    const equipos = C.puntosEquipo(atletas);
    const clas = C.clasificacion(atletas);
    reemplazar(cuerpo, [
      el('div.fila', {}, [
        boton({ texto: t('Descargar resultados (CSV)'), icono: 'descargar', variante: 'secundario', href: api.urlResultadosCsv(st.id), download: `${st.id}-resultados.csv`, 'data-externo': '' }),
        boton({ texto: t('Acta oficial (imprimir o PDF)'), icono: 'documento', variante: 'secundario', href: `/meets/${encodeURIComponent(st.id)}/acta`, target: '_blank', rel: 'noopener', 'data-externo': '' }),
        boton({ texto: t('OpenPowerlifting (CSV)'), icono: 'descargar', variante: 'secundario', href: `/api/meets/${encodeURIComponent(st.id)}/openpowerlifting.csv`, download: `${st.id}-openpowerlifting.csv`, 'data-externo': '' }),
        boton({ texto: t('Copia completa (.json)'), icono: 'documento', variante: 'secundario', onclick: async () => { try { descargar(`${st.id}.json`, JSON.stringify(await api.exportar(st.id), null, 1), 'application/json'); } catch (e) { avisoError(e); } } }),
        boton({ texto: st.meet.cerrado ? t('Reabrir el meet') : t('Terminar el meet'), icono: 'trofeo', variante: st.meet.cerrado ? 'secundario' : 'primario', onclick: async () => {
          const nuevo = !st.meet.cerrado;
          if (nuevo && !(await confirmar({ titulo: t('Terminar el meet'), texto: t('Queda como terminado en la lista y en la página pública. Podrás reabrirlo.'), confirmar: t('Terminar meet') }))) return;
          try { await st.cambiarMeet({ cerrado: nuevo }); if (nuevo) mostrarCierre(st); else toast(nuevo ? t('Meet terminado.') : t('Meet reabierto.'), { tipo: 'ok', deshacer: () => st.cambiarMeet({ cerrado: !nuevo }) }); } catch (e) { avisoError(e); }
        } }),
      ]),
      !conTotal ? el('p.suave', { text: t('Todavía nadie tiene un total válido: la clasificación se llena al terminar los tres levantamientos.') }) : null,
      mejores.length ? sec(t('Mejor levantador'), [el('ol.org-podio', {}, mejores.slice(0, 5).map((x, i) => el('li', { class: i === 0 ? 'resaltado-fila' : '' }, [el('span.org-puesto.datos', { text: i + 1 }), el('span.truncar', {}, [el('strong', { text: x.a.nombre }), el('span.suave.pequeno', { text: ` ${x.a.club || ''}` })]), el('span.datos', { text: `${kg(C.total(x.a))} kg` }), el('strong.datos', { text: numero(x.valor, { dec: 2 }) })])))], t('Ordenado por {f} (total ajustado al peso corporal).', { f: formula })) : null,
      ...clas.map(g => sec(g.nombre, [el('div.tabla-caja', {}, el('table.tabla', {}, [
        el('thead', {}, el('tr', {}, [['#', ''], [t('Atleta'), ''], [t('Club'), ''], ['S', 'num'], ['B', 'num'], ['D', 'num'], [t('Total'), 'num'], [formula, 'num']].map(([h, c]) => el('th', { class: c, text: h })))),
        el('tbody', {}, g.filas.map(({ a, puesto, total }) => el('tr', {}, [el('td.datos', { text: puesto ?? '—' }), el('td', {}, el('strong', { text: a.nombre })), el('td', { text: a.club || '' }), ...C.ORDEN_LEV.map(l => el('td.num.datos', { text: kg(C.mejor(a, l)) })), el('td.num.datos', {}, el('strong', { text: total ? kg(total) : t('Sin total') })), el('td.num.datos', { text: total ? numero(C.puntos(a, formula), { dec: 2 }) : '—' })]))),
      ]))])),
      equipos.length ? sec(t('Puntos de equipo'), [el('div.tabla-caja', {}, el('table.tabla', {}, [
        el('thead', {}, el('tr', {}, [t('Club'), t('Atletas'), t('Puntos')].map((h, i) => el('th', { class: i ? 'num' : '', text: h })))),
        el('tbody', {}, equipos.map(c => el('tr', {}, [el('td', {}, el('strong', { text: c.club })), el('td.num.datos', { text: c.atletas }), el('td.num.datos', {}, el('strong', { text: c.puntos }))]))),
      ]))], t('12-9-8-7-6-5-4-3-2-1 puntos a los diez primeros de cada categoría. Solo cuentan atletas con total válido y club.')) : null,
    ]);
  }
  pintar();
  let h = 0;
  const baja = st.escuchar(() => { if (st.tab !== 'resultados') return; clearTimeout(h); h = setTimeout(pintar, 120); });
  return { nodo: cuerpo, alActivar: pintar, salir: baja };
}
