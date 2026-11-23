/* ============================================================
   OPENMEETS — HUD para transmisión  (/meets/:id/hud?t=<plataforma>&pos=abajo|arriba&escala=1&sonido=1)
   Fondo transparente para una fuente de navegador de OBS: franja con atleta, intento, peso,
   luces y reloj, y las escenas que manda la regie (siguientes, clasificación, podio, récord, pausa, patrocinadores).
   En AUTO sigue el vivo solo; sin atleta ni escena no dibuja nada.
   ============================================================ */

import { el } from '../util.js';
import { t } from '../i18n.js';
import { conectarTarima } from './pantalla.js';
import { vistaTarima, parametrosHud } from './pantalla-datos.js';
import { crearFranjaAtleta, construirEscena } from './hud-escenas.js';
import { REGIE_INICIAL, escenaEfectiva, datosEscena, logoActual } from '../nucleo/regie.js';

export default async function (ctx) {
  const { id } = ctx.params;
  const par = parametrosHud(ctx.consulta);
  ctx.app.titulo(t('HUD'));
  const html = document.documentElement;
  html.classList.add('sin-scroll', 'hud-transparente');
  const raiz = ctx.raiz;
  raiz.classList.add('hud-raiz');
  raiz.style.setProperty('--hud-escala', String(par.escala));

  const fa = crearFranjaAtleta(par.pos);
  const capa = el('div.hud-capa');
  const sinRed = el('span.hud-sinred', { hidden: true, text: t('Sin conexión') });
  raiz.replaceChildren(fa.franja, capa, sinRed);

  let regie = REGIE_INICIAL, desde = Date.now(), panel = null, firma = '';
  /** Cambia el panel con entrada y salida suaves (CSS); la franja del atleta se oculta aparte. */
  function ponerPanel(escena, d) {
    const f = d ? escena + (escena === 'patro' ? d.logos.indexOf(logoActual(d.logos, d.seg)) : JSON.stringify(d)) : '';
    if (f === firma) return;
    firma = f;
    const viejo = panel; panel = null;
    if (viejo) { viejo.classList.add('sale'); setTimeout(() => viejo.remove(), 400); }
    const nuevo = d && construirEscena(escena, d, par.pos);
    if (nuevo) { panel = nuevo; capa.append(nuevo); requestAnimationFrame(() => requestAnimationFrame(() => nuevo.classList.add('entra'))); }
  }

  function pintar() {
    const T = tarima;
    const vivo = T.vivo(), vt = vistaTarima(T.s.meet, vivo), esc = escenaEfectiva(regie, vt, vivo, Date.now(), desde);
    sinRed.hidden = T.canal.estado() === 'conectado';
    fa.visible(esc === 'atleta' && vt.hayAtleta);
    if (esc === 'atleta') fa.pintar(vt);
    ponerPanel(esc, esc === 'atleta' || esc === 'oculto' ? null : datosEscena(esc, T.s.meet, vt, vivo, regie));
  }

  const tarima = conectarTarima(id, { plataforma: par.plataforma, alCambio: pintar });
  const quitarRegie = tarima.canal.escucharRegie(m => {
    const r = m[tarima.plataforma()] || (par.plataforma ? null : Object.values(m)[0]);
    if (r && r.v !== regie.v) { regie = r; desde = Date.now(); pintar(); }
  });
  if (par.sonido) tarima.sonido(true);
  pintar();
  ctx.alSalir(() => { quitarRegie(); tarima.cerrar(); html.classList.remove('sin-scroll', 'hud-transparente'); });
}
