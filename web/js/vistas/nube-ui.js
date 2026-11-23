/* ============================================================
   OPENMEETS — Nube opcional (cliente): bloque de Ajustes, interruptor por meet y píldora de estado.
   La «nube» es otra instancia de OpenMeets en modo hub. El token nunca vuelve del servidor.
   ============================================================ */

import { el, copiar, hora } from '../util.js';
import { t } from '../i18n.js';
import { pedir } from '../api.js';
import { boton, campo, interruptor, pildora, toast, icono } from '../ui.js';

// Hoja de estilos propia, una sola vez (la usan Ajustes, la pestaña Datos y la cabecera del organizador).
if (typeof document !== 'undefined' && !document.querySelector('link[href="/css/nube.css"]')) document.head.append(el('link', { rel: 'stylesheet', href: '/css/nube.css' }));

const sinReintentos = { reintentos: 0 };
export const estadoNube = () => pedir('GET', '/api/nube/estado', undefined, sinReintentos);
const avisarCambio = () => window.dispatchEvent(new Event('om-nube'));
const HTTP_INSEGURO = /^http:\/\/(?!localhost\b|127\.|\[?::1\])/i;

/** Texto y tono de la píldora según el estado que reporta el servidor local. */
export function textoEstado(e) {
  if (e.estado === 'sin-conexion') return { texto: t('Nube: sin conexión desde {h}', { h: hora(e.desde) }), tono: 'mal' };
  if (e.estado === 'enviando') return { texto: t('Nube: enviando {n}', { n: e.pendientes }), tono: 'aviso' };
  return { texto: t('Nube: al día'), tono: 'ok' };
}

/** Píldora del organizador: solo se ve si este meet está publicado en la nube. */
export function pildoraNube(meetId) {
  const nodo = el('span.nube-pildora', { hidden: true, role: 'status' });
  let vivo = true;
  async function sondear() {
    try {
      const e = await estadoNube();
      if (!vivo) return;
      nodo.hidden = !e.meets.includes(meetId);
      const { texto, tono } = textoEstado(e);
      nodo.replaceChildren(pildora({ texto, tono, punto: true }));
      nodo.title = e.error ? `${t('Se sigue intentando solo.')} ${e.error}` : '';
    } catch { if (vivo) nodo.hidden = true; }
  }
  sondear();
  const h = setInterval(sondear, 2000);
  window.addEventListener('om-nube', sondear);
  return { nodo, parar() { vivo = false; clearInterval(h); window.removeEventListener('om-nube', sondear); } };
}

/** Interruptor «Publicar este meet en la nube» para la pestaña Datos. `st.meet` lleva el meet. */
export function interruptorNube(st) {
  const caja = el('div.nube-meet');
  const enlace = el('div.fila.nube-enlace', { hidden: true });
  let est = null;
  const sw = interruptor({ etiqueta: t('Publicar este meet en la nube'), ayuda: t('Cualquiera con el enlace lo ve desde internet, en vivo. La mesa sigue funcionando sin internet.'), valor: false, onChange: async si => {
    sw.entrada.disabled = true;
    try {
      est = await pedir('PUT', `/api/nube/meets/${encodeURIComponent(st.id)}`, { publicar: si });
      toast(si ? t('Publicando en la nube…') : t('Retirado de la nube.'), { tipo: 'ok' });
      avisarCambio();
    } catch (e) { sw.poner(!si); toast(e.message, { tipo: 'error' }); }
    sw.entrada.disabled = false; pintar();
  } });
  caja.append(sw, enlace);

  function pintar() {
    const privado = st.meet.publico === false;
    const listo = !!est?.configurado;
    sw.entrada.disabled = privado || !listo;
    sw.poner(!!est?.meets.includes(st.id));
    const url = est?.url ? `${est.url}/meets/${encodeURIComponent(st.id)}` : '';
    enlace.hidden = !(url && sw.valor());
    enlace.replaceChildren(el('a.datos', { href: url, target: '_blank', rel: 'noopener noreferrer', 'data-externo': '', text: url }),
      boton({ icono: 'copiar', variante: 'fantasma', tam: 'chico', etiqueta: t('Copiar enlace público'), onclick: async () => toast((await copiar(url)) ? t('Enlace copiado.') : t('No se pudo copiar.'), { tipo: 'info' }) }));
    const msg = !est ? '' : privado ? t('Este meet no es visible para el público: actívalo arriba y guarda para poder publicarlo.') : !listo ? t('Primero configura la nube en Ajustes.') : '';
    caja.querySelector('.nube-nota')?.remove();
    if (msg) caja.append(el('p.suave.pequeno.nube-nota', {}, [msg, !listo && !privado ? [' ', el('a', { href: '/ajustes', text: t('Ir a Ajustes') })] : null]));
  }
  estadoNube().then(e => { est = e; pintar(); }).catch(() => { caja.hidden = true; });
  return { nodo: caja, alMeet: pintar, refrescar: () => estadoNube().then(e => { est = e; pintar(); }).catch(() => {}) };
}

/** Bloque de Ajustes: dirección del hub + token, probar conexión y estado. `bloque` es el helper de ajustes.js. */
export async function bloqueNube(bloque) {
  let e;
  try { e = await estadoNube(); } catch { return null; }
  const url = campo({ etiqueta: t('Dirección de la nube'), tipo: 'url', valor: e.url, placeholder: 'https://openmeets.ejemplo.com', autocompletar: 'off', ayuda: t('La dirección de tu OpenMeets en modo nube. Solo https salvo en pruebas.') });
  const token = campo({ etiqueta: t('Token de sincronización'), tipo: 'password', valor: '', placeholder: e.tieneToken ? t('Guardado (déjalo vacío para conservarlo)') : t('Pégalo desde la consola de la nube'), autocompletar: 'off' });
  const aviso = el('p.pub-aviso.nube-aviso', { role: 'status', hidden: true }, [icono('alerta', { tam: 18 }), el('span', { text: t('Esa dirección usa http: el token viajaría sin cifrar. Usa https en cuanto puedas.') })]);
  const resultado = el('div.nube-resultado', { 'aria-live': 'polite' });
  const estado = el('div.fila.nube-estado');
  const mirarHttp = () => { aviso.hidden = !HTTP_INSEGURO.test(url.valor().trim()); };
  url.entrada.addEventListener('input', mirarHttp); mirarHttp();

  const pintarEstado = est => {
    const { texto, tono } = textoEstado(est);
    estado.replaceChildren(...(est.configurado ? [pildora({ texto, tono, punto: true }), el('span.suave.pequeno', { text: est.meets.length ? t('{n} meets publicados', { n: est.meets.length }) : t('Ningún meet publicado todavía. Actívalo en la pestaña Datos de cada meet.') })] : [el('span.suave.pequeno', { text: t('Sin configurar: la mesa funciona igual, solo en tu red local.') })]));
  };
  pintarEstado(e);

  const bProbar = boton({ texto: t('Probar conexión'), icono: 'wifi', variante: 'secundario', onclick: async () => {
    resultado.replaceChildren(); bProbar.cargando(true);
    try {
      const r = await pedir('POST', '/api/nube/probar', { url: url.valor().trim(), token: token.valor().trim() }, sinReintentos);
      resultado.replaceChildren(pildora({ texto: t('Conexión correcta · {n} meets en la nube', { n: r.meets }), tono: 'ok', icono: 'check' }));
    } catch (err) { resultado.replaceChildren(el('p.nube-error', { role: 'alert', text: err.message })); } finally { bProbar.cargando(false); }
  } });
  const guardar = async () => {
    try {
      const est = await pedir('PUT', '/api/nube/config', { url: url.valor().trim(), token: token.valor().trim() }, sinReintentos);
      token.poner(''); token.entrada.placeholder = est.tieneToken ? t('Guardado (déjalo vacío para conservarlo)') : t('Pégalo desde la consola de la nube');
      pintarEstado(est); avisarCambio();
      toast(est.configurado ? t('Nube guardada.') : t('Nube desconectada.'), { tipo: 'ok' });
    } catch (err) { url.ponerError(err.message); }
  };
  const bGuardar = boton({ texto: t('Guardar'), icono: 'check', variante: 'primario', tipo: 'submit' });
  const bQuitar = boton({ texto: t('Desconectar'), icono: 'x', variante: 'fantasma', onclick: () => { url.poner(''); token.poner(''); mirarHttp(); guardar(); } });
  const reciente = setInterval(async () => { if (!estado.isConnected) return clearInterval(reciente); try { pintarEstado(await estadoNube()); } catch { /* sin servidor local */ } }, 3000);

  return bloque(t('Publicar en la nube'), t('Opcional. La nube es otra copia de OpenMeets en modo nube (en un servidor tuyo) que muestra tus meets al público desde internet. No hace falta cuenta en ningún servicio.'),
    el('form.formulario', { novalidate: true, onsubmit: ev => { ev.preventDefault(); guardar(); } }, [url, token, aviso, el('div.fila', {}, [bGuardar, bProbar, bQuitar]), resultado, estado]),
    el('p.pequeno.suave', {}, [t('Nunca se envían códigos de jueces, votos ni meets privados. Cómo desplegarla: '), el('code.datos', { text: 'docs/nube.html' }), '.']));
}
