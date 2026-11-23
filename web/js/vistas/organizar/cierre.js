/* ============================================================
   OPENMEETS — Final del meet: tarjeta de resumen que se arma delante de ti (pico-final)
   Cifras que cuentan de una en una, mensaje que reconoce el trabajo, y siguientes pasos.
   ============================================================ */

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { numero } from '../../util.js';
import { boton, modal } from '../../ui.js';
import { api } from '../../api.js';
import { resumenFinal } from './logica.js';

/** Abre la tarjeta de cierre de un meet ya terminado. */
export function mostrarCierre(st) {
  const r = resumenFinal(st.atletas(), st.meet.formula);
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cifra = (valor, etiqueta, sufijo = '') => el('div.org-cierre-cifra', {}, [el('strong.datos', { text: `${numero(valor)}${sufijo}`, dataset: { fin: String(valor), sufijo } }), el('span.suave.pequeno', { text: etiqueta })]);
  const filas = [
    cifra(r.atletas, t('atletas')), cifra(r.intentos, t('intentos dirigidos')), cifra(r.porcentaje, t('de intentos válidos'), ' %'), cifra(r.records, t('récords del meet')),
  ];
  const mejor = (titulo, m) => m ? el('div.org-cierre-linea', {}, [el('span.suave', { text: titulo }), el('strong', { text: m.nombre }), el('span.datos.pequeno', { text: `${numero(m.puntos, { dec: 2 })} ${st.meet.formula === 'IPF' ? 'GL' : st.meet.formula || 'GL'}` })]) : null;
  const mensaje = r.intentos ? (r.intentos === 1 ? t('Meet terminado. 1 intento dirigido, ninguno perdido. Buen trabajo.') : t('Meet terminado. {n} intentos dirigidos, ninguno perdido. Buen trabajo.', { n: r.intentos })) : t('Meet terminado. Cuando dirijas intentos, aquí verás el resumen completo.');
  const items = [
    el('p.org-cierre-mensaje', { text: mensaje }),
    el('div.org-cierre-cifras', {}, filas),
    mejor(t('Mejor levantador'), r.mejorM), mejor(t('Mejor levantadora'), r.mejorF),
    r.equipo ? el('div.org-cierre-linea', {}, [el('span.suave', { text: t('Equipo ganador') }), el('strong', { text: r.equipo.club }), el('span.datos.pequeno', { text: `${r.equipo.puntos} ${t('puntos')}` })]) : null,
  ].filter(Boolean);
  // Se construye delante de ti: cada bloque entra con un pequeño retraso y las cifras suben contando.
  items.forEach((n, i) => { if (!reducido) { n.classList.add('org-cierre-entra'); n.style.animationDelay = `${i * 140}ms`; } });
  const m = modal({ titulo: t('Resumen del meet'), contenido: el('div.org-cierre', {}, items), acciones: [
    { texto: t('Cerrar'), variante: 'fantasma' },
    { texto: t('Ver página pública'), icono: 'ojo', variante: 'secundario', cerrar: false, onclick: () => { window.open(`/meets/${encodeURIComponent(st.id)}`, '_blank', 'noopener'); return false; } },
    { texto: t('Descargar resultados'), icono: 'descargar', variante: 'primario', cerrar: false, onclick: () => { const a = el('a', { href: api.urlResultadosCsv(st.id), download: `${st.id}-resultados.csv`, 'data-externo': '' }); document.body.append(a); a.click(); a.remove(); return false; } },
  ] });
  if (!reducido) m.el.querySelectorAll('[data-fin]').forEach((n, i) => {
    const fin = Number(n.dataset.fin), suf = n.dataset.sufijo, t0 = performance.now() + i * 140, dur = 700;
    const paso = ahora => { const p = Math.min(1, Math.max(0, (ahora - t0) / dur)); n.textContent = `${numero(Math.round(fin * (1 - (1 - p) ** 3)))}${suf}`; if (p < 1 && n.isConnected) requestAnimationFrame(paso); };
    n.textContent = `0${suf}`; requestAnimationFrame(paso);
  });
  return m;
}
