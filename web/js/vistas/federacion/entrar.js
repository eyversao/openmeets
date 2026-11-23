/* ============================================================
   OPENMEETS — /entrar: entrar con el PIN de un acceso de equipo (director, mesa, pesaje, locutor, solo lectura)
   El enlace del QR trae «#<acceso>.<PIN>» (el fragmento nunca viaja al servidor) y entra solo.
   ============================================================ */

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { pedir } from '../../api.js';
import { boton, campo, icono } from '../../ui.js';
import { destinoPorRol, cargarRol } from './rol.js';

const ENLACE = /^#?(r-[0-9a-f]{10})\.(\d{6})$/;

export default async function (ctx) {
  ctx.app.estilos('federacion');
  ctx.app.titulo(t('Entrar con tu acceso'));
  const pin = campo({ etiqueta: t('PIN de tu acceso'), modo: 'numeric', autocompletar: 'one-time-code', maxlength: 6, placeholder: '000000', ayuda: t('Son 6 dígitos. Te los dio el organizador del meet (o salen en el código QR que escaneaste).') });
  pin.entrada.classList.add('fed-pin');
  const boton1 = boton({ texto: t('Entrar'), icono: 'candado', variante: 'primario', tipo: 'submit', ancho: true });
  let acceso;
  const entrar = async (v, id) => {
    boton1.cargando(true);
    try {
      const r = await pedir('POST', '/api/rol/entrar', { pin: v, ...(id ? { id } : {}) });
      history.replaceState({}, '', '/entrar');
      const rol = await cargarRol(true);
      location.href = destinoPorRol({ ...rol, rol: r.rol, meetId: r.meetId }, '/') || '/';
    } catch (e) { pin.ponerError(e.message); pin.entrada.select(); } finally { boton1.cargando(false); }
  };
  const f = el('form.formulario.fed-entrar-form', { novalidate: true, onsubmit: e => {
    e.preventDefault();
    const v = pin.valor().replace(/\D/g, '');
    if (v.length !== 6) { pin.ponerError(t('Escribe los 6 dígitos del PIN.')); pin.entrada.focus(); return; }
    entrar(v, acceso);
  } }, [pin, boton1]);
  ctx.raiz.append(el('div.contenedor.contenedor-estrecho', {}, [
    el('header.cabecera-vista', {}, [el('h1.titular', {}, [el('span.resaltado', { text: t('Entrar con tu acceso') })]), el('p.subtitulo', { text: t('Para mesa, pesaje, locutor, director técnico o solo lectura. El organizador usa su propio PIN en Organizar.') })]),
    el('div.panel.fed-entrar', {}, [el('div.estado-icono', {}, [icono('candado', { tam: 28 })]), f]),
  ]));
  const m = ENLACE.exec(location.hash);
  if (m) { acceso = m[1]; pin.poner(m[2]); history.replaceState({}, '', '/entrar'); await entrar(m[2], m[1]); } else pin.entrada.focus();
}
