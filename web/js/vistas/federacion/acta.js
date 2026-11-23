/* ============================================================
   OPENMEETS — Acta de resultados oficiales  (/meets/:id/acta)
   Clasificación por categoría con la firma del director técnico. Se imprime o se guarda en PDF (@media print).
   ============================================================ */

import { el, rangoFechas, numero } from '../../util.js';
import { t } from '../../i18n.js';
import { api } from '../../api.js';
import { boton, errorEstado } from '../../ui.js';
import * as C from '../../nucleo/competencia.js';

const kg = n => (n > 0 ? numero(n, { max: 2 }) : '—');

export default async function (ctx) {
  ctx.app.estilos('federacion');
  ctx.app.titulo(t('Acta de resultados'));
  const raiz = ctx.raiz;
  raiz.classList.add('fed-acta');
  let m;
  try { m = await api.meet(ctx.params.id); } catch (e) { raiz.append(el('div.contenedor', {}, errorEstado({ titulo: t('No se pudo abrir el acta'), texto: e.message }))); return; }
  const formula = m.formula === 'IPF' ? 'GL' : m.formula || 'GL';
  const clas = C.clasificacion((m.atletas || []).filter(a => a.intentos));
  const lugar = [m.sede, m.ciudad, m.pais].filter(Boolean).join(', ');
  const firmas = el('div.acta-firmas', {}, [
    el('div.acta-firma', {}, [el('span.acta-linea'), el('span', { text: t('Director técnico') }), el('span.suave.pequeno', { text: t('Nombre y firma') })]),
    el('div.acta-firma', {}, [el('span.acta-linea'), el('span', { text: t('Fecha y sello') })]),
  ]);
  raiz.append(el('div.contenedor.acta-hoja', {}, [
    el('div.acta-barra.no-imprimir', {}, [boton({ texto: t('Imprimir o guardar PDF'), icono: 'descargar', variante: 'primario', onclick: () => window.print() }), boton({ texto: t('Volver'), variante: 'fantasma', href: `/organizar/${encodeURIComponent(m.id)}/resultados` })]),
    el('header.acta-cab', {}, [
      el('p.acta-tipo', { text: t('Acta de resultados oficiales') }),
      el('h1.acta-titulo', { text: m.nombre }),
      el('p.acta-sub', { text: [m.federacion, m.fecha ? rangoFechas(m.fecha, m.fechaFin) : '', lugar].filter(Boolean).join(' · ') }),
      m.cerrado ? null : el('p.acta-borrador.no-imprimir', { text: t('El meet aún no está terminado: estos resultados son provisionales.') }),
    ]),
    ...(clas.length ? clas.map(g => el('section.acta-cat', {}, [
      el('h2.acta-cat-nombre', { text: g.nombre }),
      el('table.acta-tabla', {}, [
        el('thead', {}, el('tr', {}, ['#', t('Atleta'), t('Club'), t('Peso'), 'S', 'B', 'D', t('Total'), formula].map((h, i) => el('th', { class: i > 2 ? 'num' : '', text: h })))),
        el('tbody', {}, g.filas.map(({ a, puesto, total }) => el('tr', {}, [
          el('td.datos', { text: puesto ?? 'DQ' }), el('td', {}, el('strong', { text: a.nombre })), el('td', { text: a.club || '' }), el('td.num.datos', { text: kg(C.pesoDe(a)) }),
          ...C.ORDEN_LEV.map(l => el('td.num.datos', { text: kg(C.mejor(a, l)) })),
          el('td.num.datos', {}, el('strong', { text: total ? kg(total) : '—' })), el('td.num.datos', { text: total ? numero(C.puntos(a, formula), { dec: 2 }) : '—' }),
        ]))),
      ]),
    ])) : [el('p.suave', { text: t('Todavía no hay atletas en este meet.') })]),
    el('p.acta-pie.pequeno', { text: t('Generada por OpenMeets. Mejores intentos válidos; DQ: sin total válido. Puntos por {f}.', { f: formula }) }),
    firmas,
  ]));
  return () => raiz.classList.remove('fed-acta');
}
