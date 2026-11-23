/* ============================================================
   OPENMEETS — Escenas del HUD de transmisión
   La franja del atleta en tarima y los paneles de la regie (siguientes, clasificación, podio, mejor levantador,
   récord, pausa, patrocinadores). Los usan el HUD (/meets/:id/hud) y las miniaturas de la regie.
   ============================================================ */

import { el, puntos as fmtPuntos, kg as fmtKg } from '../util.js';
import { t } from '../i18n.js';
import * as C from '../nucleo/competencia.js';
import * as L from '../nucleo/luces-estado.js';
import { logoActual } from '../nucleo/regie.js';
import { bloqueLuces, bloqueResultado, bloqueRecord, nodoReloj } from './pantalla.js';

const coma = n => String(n).replace('.', ',');
const sis = f => (f === 'IPF' ? 'GL' : f);

/** Franja del atleta en tarima. `pintar(vt)` la actualiza sin repintar lo que no cambió; `visible` la oculta con transición. */
export function crearFranjaAtleta(pos) {
  const zAtleta = el('div.hud-atleta'), zKg = el('div.hud-kg'), zLuces = el('div.hud-luces'), zRes = el('div.hud-res');
  const reloj = nodoReloj('ev-reloj hud-reloj');
  const franja = el('section.hud', { class: `${pos} fuera`, 'aria-live': 'polite' }, [zAtleta, zKg, zLuces, zRes, reloj]);
  const poner = (z, f, hacer) => { if (z._f !== f) { z._f = f; z.replaceChildren(...[].concat(hacer()).filter(Boolean)); } };
  return {
    franja,
    pintar(vt) {
      if (!vt.hayAtleta) return;
      poner(zAtleta, JSON.stringify([vt.nombre, vt.club, vt.levNombre, vt.intento, vt.rack]), () => [
        el('b.hud-nombre', { text: vt.nombre }),
        el('span.hud-meta', { text: [vt.club, vt.levNombre && t(vt.levNombre), vt.intento ? t('{n}.º intento', { n: vt.intento }) : ''].filter(Boolean).join(' · ') }),
      ]);
      poner(zKg, JSON.stringify([vt.kg, vt.recFase, vt.recEtiqueta]), () => [el('b.hud-kg-num', { text: coma(vt.kg) }), el('small', { text: 'kg' }), bloqueRecord(vt, 'hud-rec')]);
      poner(zLuces, L.firmaLuces(vt.est) + vt.est.revelado, () => bloqueLuces(vt.est, { grandes: false }));
      poner(zRes, JSON.stringify(vt.resultado), () => bloqueResultado(vt.resultado));
      reloj.poner(vt.reloj);
      franja.classList.toggle('valido', vt.estado === 'decision' && vt.resultado?.clase === 'valido');
      franja.classList.toggle('nulo', vt.estado === 'decision' && vt.resultado?.clase === 'nulo');
    },
    visible(si) { franja.classList.toggle('fuera', !si); },
  };
}

const cab = (titulo, sub) => el('header.hud-p-cab', {}, [el('b', { text: t(titulo) }), sub ? el('span', { text: sub }) : null]);
const filaLista = (n, nombre, cifra, extra, primero) => el('li.hud-p-fila', { class: primero ? 'primero' : '' }, [
  el('span.hud-p-n.num', { text: n }), el('span.hud-p-nombre', {}, [el('b', { text: nombre }), extra ? el('small', { text: extra }) : null]), el('span.hud-p-cifra.num', { text: cifra }),
]);

/** Panel de una escena con sus datos (de `datosEscena`). Devuelve null si no hay nada que enseñar. `ahora` rige la rotación de logos. */
export function construirEscena(id, d, pos = 'abajo', ahora = Date.now()) {
  if (!d) return null;
  const caja = (clase, hijos) => el('section', { class: `hud-panel ${clase} ${pos}` }, hijos);
  switch (id) {
    case 'siguientes': return caja('p-lista', [cab(d.titulo, d.sub && t(d.sub)), el('ol.hud-p-lista', {}, d.filas.map((f, i) => filaLista(i + 1, f.nombre, f.kg ? `${coma(f.kg)} kg` : '—', '', i === 0)))]);
    case 'clasif': case 'podio': return caja('p-lista', [cab(d.titulo, d.sub), el('ol.hud-p-lista', {}, d.filas.map((f, i) => filaLista(f.puesto, f.nombre, fmtKg(f.total), [f.club, f.puntos > 0 ? `${fmtPuntos(f.puntos)} ${sis(d.formula)}` : ''].filter(Boolean).join(' · '), i === 0)))]);
    case 'mejor': return caja('p-mejor', [cab(d.titulo), el('div.hud-p-dos', {}, [[t('Mejor levantadora'), d.F], [t('Mejor levantador'), d.M]].filter(x => x[1]).map(([r, x]) => el('div.hud-p-mejor', {}, [
      el('small', { text: r }), el('b.resaltado', { text: x.nombre }), el('span.num', { text: `${fmtPuntos(x.valor)} ${sis(d.formula)} · ${fmtKg(x.total)}` })])))]);
    case 'record': return caja('p-record', [
      el('b.hud-p-rec-etiqueta', { text: d.etiqueta === 'RÉCORD' || /^RÉCORD /.test(d.etiqueta) ? t(d.etiqueta) : d.etiqueta }),
      el('div.hud-p-rec-cuerpo', {}, [el('b.hud-p-rec-kg.num', { text: coma(d.kg) }), el('small', { text: 'kg' }), el('span.hud-p-rec-lev', { text: t(C.LEVANTES[d.lev] || '') })]),
      el('p.hud-p-rec-nombre', {}, [el('b', { text: d.nombre }), d.club ? el('span', { text: ` · ${d.club}` }) : null]),
    ]);
    case 'pausa': return caja('p-pausa', [el('p.hud-p-pausa', { text: d.texto })]);
    case 'patro': {
      const logo = logoActual(d.logos, d.seg, ahora);
      return caja('p-patro', [el('img.hud-p-logo', { src: logo, alt: t('Patrocinador'), decoding: 'async' })]);
    }
    default: return null;
  }
}
