/* ============================================================
   OPENMEETS — Kit de interfaz
   Los mismos componentes para lo mismo en toda la app (principio 2).
   Cada función devuelve un nodo del DOM; los estilos están en css/componentes.css.
   ============================================================ */

import { el, anadir, $$ } from './util.js';
import { t, idioma, fijarIdioma, IDIOMAS } from './i18n.js';
import { anilloAtleta } from './nucleo/competencia.js';

/* ---------- Iconos (trazo 1,75, sin emojis) ---------- */

const R = (...p) => p.map(d => `<path d="${d}"/>`).join('');
const C = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const RECT = (x, y, w, h, r = 0) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;
const WIFI = R('M2.5 9a14 14 0 0 1 19 0', 'M5.6 12.5a9.5 9.5 0 0 1 12.8 0', 'M8.8 16a5 5 0 0 1 6.4 0', 'M12 19.4h.01');

export const ICONOS = {
  inicio: R('M3 11l9-8 9 8', 'M5 9.5V20h14V9.5'),
  calendario: RECT(4, 5, 16, 15, 2) + R('M4 10h16', 'M8 3v4', 'M16 3v4'),
  usuarios: C(9, 8, 3) + R('M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6', 'M16 5.2a3 3 0 0 1 0 5.6', 'M18 14.3c1.8.8 3 2.6 3 5.7'),
  usuario: C(12, 8, 4) + R('M4 21c0-4 3.6-7 8-7s8 3 8 7'),
  plus: R('M12 5v14', 'M5 12h14'),
  menos: R('M5 12h14'),
  x: R('M6 6l12 12', 'M18 6L6 18'),
  check: R('M5 12.5l4.5 4.5L19 7'),
  'chevron-der': R('M9 5l7 7-7 7'),
  'chevron-izq': R('M15 5l-7 7 7 7'),
  'chevron-abajo': R('M5 9l7 7 7-7'),
  'chevron-arriba': R('M5 15l7-7 7 7'),
  'flecha-der': R('M5 12h14', 'M13 6l6 6-6 6'),
  'flecha-izq': R('M19 12H5', 'M11 6l-6 6 6 6'),
  buscar: C(11, 11, 6.5) + R('M20 20l-4.2-4.2'),
  ajustes: R('M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9') + C(15, 7, 2) + C(9, 17, 2),
  sol: C(12, 12, 4) + R('M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'M5.6 5.6L7 7', 'M17 17l1.4 1.4', 'M5.6 18.4L7 17', 'M17 7l1.4-1.4'),
  luna: R('M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'),
  globo: C(12, 12, 9) + R('M3 12h18', 'M12 3c3 3 3 15 0 18', 'M12 3c-3 3-3 15 0 18'),
  wifi: WIFI,
  'wifi-off': WIFI + R('M3 3l18 18'),
  pantalla: RECT(3, 4.5, 18, 12, 2) + R('M8 20.5h8', 'M12 16.5v4'),
  luces: C(5.5, 12, 2.5) + C(12, 12, 2.5) + C(18.5, 12, 2.5),
  juez: R('M6 20h12', 'M12 4v16', 'M5 8h14', 'M5 8l-2.5 6a2.5 2.5 0 0 0 5 0L5 8z', 'M19 8l-2.5 6a2.5 2.5 0 0 0 5 0L19 8z'),
  trofeo: R('M8 4h8v5a4 4 0 0 1-8 0V4z', 'M8 6H4v1a4 4 0 0 0 4 4', 'M16 6h4v1a4 4 0 0 1-4 4', 'M12 13v4', 'M8 21h8', 'M10 17h4'),
  barra: R('M2 12h20', 'M6 7v10', 'M9.5 9v6', 'M18 7v10', 'M14.5 9v6'),
  descargar: R('M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'),
  subir: R('M12 16V5', 'M7 9l5-5 5 5', 'M5 20h14'),
  copiar: RECT(9, 9, 11, 11, 2) + R('M5 15V6a2 2 0 0 1 2-2h8'),
  enlace: R('M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'),
  deshacer: R('M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'),
  reloj: C(12, 13, 8) + R('M12 9v4l3 2', 'M9 2.5h6'),
  play: R('M7 5l12 7-12 7z'),
  pausa: R('M8 5v14', 'M16 5v14'),
  alerta: R('M12 3.5L22 20.5H2L12 3.5z', 'M12 10v5', 'M12 18h.01'),
  info: C(12, 12, 9) + R('M12 11v6', 'M12 7.5h.01'),
  menu: R('M4 7h16', 'M4 12h16', 'M4 17h16'),
  mas: R('M5 12h.01', 'M12 12h.01', 'M19 12h.01'),
  editar: R('M4 20l1-4L16 5l3 3L8 19l-4 1z', 'M14 7l3 3'),
  papelera: R('M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13', 'M10 11v6', 'M14 11v6'),
  ojo: R('M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z') + C(12, 12, 3),
  aplauso: R('M7 11v9H4v-9h3z', 'M7 11l4-8c1.5 0 2.5 1 2.5 2.5V9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7'),
  candado: RECT(5, 11, 14, 10, 2) + R('M8 11V8a4 4 0 0 1 8 0v3'),
  rayo: R('M13 3L5 14h6l-1 7 8-11h-6l1-7z'),
  pin: R('M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z') + C(12, 10, 2.5),
  documento: R('M7 3h7l5 5v13H7z', 'M14 3v5h5'),
  'en-vivo': C(12, 12, 2) + R('M7.8 7.8a6 6 0 0 0 0 8.4', 'M16.2 7.8a6 6 0 0 1 0 8.4', 'M4.9 4.9a10 10 0 0 0 0 14.2', 'M19.1 4.9a10 10 0 0 1 0 14.2'),
  nube: R('M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 18 9.5 4.3 4.3 0 0 1 17.5 18H7z'),
  refrescar: R('M20 11a8 8 0 0 0-14.5-3.5L4 9', 'M4 4v5h5', 'M4 13a8 8 0 0 0 14.5 3.5L20 15', 'M20 20v-5h-5'),
};

/** Icono SVG inline. `titulo` lo hace accesible; sin título queda oculto a lectores de pantalla. */
export function icono(nombre, { tam = 20, titulo = '', clase = '' } = {}) {
  const svg = el('svg', {
    class: `icono${clase ? ' ' + clase : ''}`, viewBox: '0 0 24 24', width: tam, height: tam, fill: 'none', stroke: 'currentColor',
    'stroke-width': '1.75', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    role: titulo ? 'img' : null, 'aria-label': titulo || null, 'aria-hidden': titulo ? null : 'true', focusable: 'false',
    html: ICONOS[nombre] || ICONOS.info,
  });
  return svg;
}

let uid = 0;
const nuevoId = (p = 'om') => `${p}-${++uid}`;

/* ---------- Botón ---------- */

/**
 * boton({ texto, icono, iconoDer, variante: 'primario'|'secundario'|'fantasma'|'peligro', tam: 'normal'|'chico'|'grande',
 *         onclick, href, tipo, deshabilitado, cargando, ancho, etiqueta })
 * Con `href` es un enlace (el router lo intercepta). `b.cargando(true)` pone el spinner y bloquea.
 */
export function boton({ texto = '', icono: ic, iconoDer, variante = 'secundario', tam = 'normal', onclick, href, tipo = 'button', deshabilitado, cargando, ancho, etiqueta, ...resto } = {}) {
  const enlace = !!href;
  const b = el(enlace ? 'a' : 'button', {
    class: `boton boton-${variante}${tam !== 'normal' ? ' boton-' + tam : ''}${ancho ? ' boton-ancho' : ''}${!texto ? ' boton-solo-icono' : ''}`,
    href: enlace ? href : null, type: enlace ? null : tipo, 'aria-label': etiqueta || (!texto ? ic : null), onclick, ...resto,
  }, [ic ? icono(ic) : null, texto ? el('span.boton-texto', { text: texto }) : null, iconoDer ? icono(iconoDer) : null]);
  if (!texto && ic && !etiqueta) b.setAttribute('aria-label', ic);
  b.cargando = si => {
    b.classList.toggle('cargando', !!si);
    b.setAttribute('aria-busy', si ? 'true' : 'false');
    if (!enlace) b.disabled = !!si || b.dataset.bloqueado === '1';
  };
  b.bloquear = si => { b.dataset.bloqueado = si ? '1' : ''; if (!enlace) b.disabled = !!si; };
  if (deshabilitado) b.bloquear(true);
  if (cargando) b.cargando(true);
  return b;
}

/** Ejecuta una acción asíncrona con el botón en «cargando»; si falla, avisa con un toast de error. */
export async function conCarga(b, fn) {
  b.cargando(true);
  try { return await fn(); } catch (e) { toast(e?.message || t('No se pudo completar la acción.'), { tipo: 'error' }); return undefined; } finally { b.cargando(false); }
}

/* ---------- Campos ---------- */

function envolverCampo({ etiqueta, ayuda, error }, control, id, clase = '') {
  const ayudaId = `${id}-ayuda`, errorId = `${id}-error`;
  const w = el(`div.campo${clase ? '.' + clase : ''}`, {}, [
    etiqueta ? el('label.campo-etiqueta', { for: id, text: etiqueta }) : null,
    control,
    ayuda ? el('p.campo-ayuda', { id: ayudaId, text: ayuda }) : null,
    el('p.campo-error', { id: errorId, role: 'alert', hidden: true }),
  ]);
  const desc = [ayuda ? ayudaId : null, errorId].filter(Boolean).join(' ');
  control.setAttribute('aria-describedby', desc);
  w.ponerError = msg => {
    const p = w.querySelector('.campo-error');
    p.textContent = msg || ''; p.hidden = !msg;
    w.classList.toggle('con-error', !!msg);
    control.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  if (error) w.ponerError(error);
  return w;
}

/**
 * campo({ etiqueta, nombre, tipo, valor, ayuda, error, placeholder, requerido, multilinea, filas, modo, onInput, onChange, ... })
 * Devuelve un contenedor con `.entrada` (el input), `.valor()`, `.poner(v)` y `.ponerError(texto)`.
 */
export function campo({ etiqueta, nombre, tipo = 'text', valor = '', ayuda, error, placeholder, requerido, multilinea, filas = 3, modo, onInput, onChange, deshabilitado, autocompletar, ...resto } = {}) {
  const id = nuevoId('campo');
  const control = el(multilinea ? 'textarea.entrada' : 'input.entrada', {
    id, name: nombre, type: multilinea ? null : tipo, placeholder, required: requerido, rows: multilinea ? filas : null, inputmode: modo, disabled: deshabilitado,
    autocomplete: autocompletar || 'off', ...resto,
  });
  control.value = valor ?? '';
  if (onInput) control.addEventListener('input', e => onInput(control.value, e));
  if (onChange) control.addEventListener('change', e => onChange(control.value, e));
  const w = envolverCampo({ etiqueta, ayuda, error }, control, id);
  w.entrada = control;
  w.valor = () => control.value;
  w.poner = v => { control.value = v ?? ''; };
  control.addEventListener('input', () => { if (w.classList.contains('con-error')) w.ponerError(''); });
  return w;
}

/** select({ etiqueta, opciones: [{ valor, texto }] | ['a','b'], valor, ayuda, onChange }) */
export function select({ etiqueta, opciones = [], valor, ayuda, error, onChange, nombre, deshabilitado, ...resto } = {}) {
  const id = nuevoId('sel');
  const control = el('select.entrada.selector', { id, name: nombre, disabled: deshabilitado, ...resto },
    opciones.map(o => { const x = typeof o === 'object' ? o : { valor: o, texto: o }; return el('option', { value: x.valor, text: x.texto }); }));
  if (valor !== undefined && valor !== null) control.value = String(valor);
  if (onChange) control.addEventListener('change', e => onChange(control.value, e));
  const w = envolverCampo({ etiqueta, ayuda, error }, control, id, 'campo-selector');
  w.entrada = control; w.valor = () => control.value; w.poner = v => { control.value = v; };
  return w;
}

/** interruptor({ etiqueta, ayuda, valor, onChange }) — un checkbox con role="switch". */
export function interruptor({ etiqueta, ayuda, valor = false, onChange, deshabilitado, nombre } = {}) {
  const id = nuevoId('int');
  const entrada = el('input.interruptor-entrada', { type: 'checkbox', role: 'switch', id, name: nombre, checked: !!valor, disabled: deshabilitado, 'aria-describedby': ayuda ? `${id}-ayuda` : null });
  if (onChange) entrada.addEventListener('change', e => onChange(entrada.checked, e));
  const w = el('label.interruptor', { for: id }, [
    el('span.interruptor-texto', {}, [el('span.interruptor-etiqueta', { text: etiqueta }), ayuda ? el('span.campo-ayuda', { id: `${id}-ayuda`, text: ayuda }) : null]),
    entrada, el('span.interruptor-pista', { 'aria-hidden': 'true' }, [el('span.interruptor-bola')]),
  ]);
  w.entrada = entrada; w.valor = () => entrada.checked; w.poner = v => { entrada.checked = !!v; };
  return w;
}

/** segmentado({ opciones: [{ valor, texto, icono }], valor, onChange, etiqueta }) — radiogroup de una sola elección. */
export function segmentado({ opciones = [], valor, onChange, etiqueta, clase = '' } = {}) {
  let actual = valor ?? opciones[0]?.valor;
  const botones = opciones.map(o => el('button.segmento', { type: 'button', role: 'radio', dataset: { valor: o.valor } }, [o.icono ? icono(o.icono) : null, el('span', { text: o.texto })]));
  const w = el(`div.segmentado${clase ? '.' + clase : ''}`, { role: 'radiogroup', 'aria-label': etiqueta || null }, botones);
  const pintar = () => botones.forEach(b => { const on = b.dataset.valor === String(actual); b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; b.classList.toggle('activo', on); });
  const poner = (v, avisar = true) => { actual = v; pintar(); if (avisar) onChange?.(v); };
  botones.forEach((b, i) => {
    b.addEventListener('click', () => poner(opciones[i].valor));
    b.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const j = (i + d + botones.length) % botones.length;
      botones[j].focus(); poner(opciones[j].valor);
    });
  });
  pintar();
  w.valor = () => actual;
  w.poner = v => poner(v, false);
  return w;
}

/* ---------- Tarjeta, píldoras y pestañas ---------- */

/** tarjeta({ titulo, texto, hijos, href, onclick, clase }) — con href u onclick es interactiva (toda la tarjeta). */
export function tarjeta({ titulo, texto, hijos, href, onclick, clase = '', nivel = 3 } = {}) {
  const interactiva = !!(href || onclick);
  const nodo = el(href ? 'a' : onclick ? 'button' : 'div', { class: `tarjeta${interactiva ? ' interactiva' : ''}${clase ? ' ' + clase : ''}`, href, type: onclick && !href ? 'button' : null, onclick });
  anadir(nodo, [titulo ? el(`h${nivel}.tarjeta-titulo`, { text: titulo }) : null, texto ? el('p.tarjeta-texto', { text: texto }) : null, hijos]);
  return nodo;
}

/** pildora({ texto, tono: 'neutro'|'ok'|'mal'|'aviso'|'info'|'senal', icono, punto }) — estado en una palabra. */
export const pildora = ({ texto, tono = 'neutro', icono: ic, punto } = {}) => el(`span.pildora.pildora-${tono}`, {}, [punto ? el('span.pildora-punto', { 'aria-hidden': 'true' }) : null, ic ? icono(ic, { tam: 14 }) : null, texto]);

const ESTADOS_MEET = { 'en-vivo': ['En vivo', 'senal', true], programada: ['Programada', 'neutro', false], terminada: ['Terminada', 'neutro', false] };
/** Píldora del estado de un meet: 'en-vivo' | 'programada' | 'terminada'. */
export function pildoraEstadoMeet(estado) {
  const [texto, tono, punto] = ESTADOS_MEET[estado] || ESTADOS_MEET.programada;
  const p = pildora({ texto: t(texto), tono, punto });
  if (estado === 'en-vivo') p.classList.add('en-vivo');
  return p;
}

/** pestanas({ items: [{ id, texto, href, conteo }], activa, onChange, etiqueta }) — con href son enlaces; sin él, botones. */
export function pestanas({ items = [], activa, onChange, etiqueta } = {}) {
  const w = el('nav.pestanas', { 'aria-label': etiqueta || t('Secciones') });
  const lista = el('div.pestanas-lista', { role: onChange && !items.some(i => i.href) ? 'tablist' : null });
  let actual = activa ?? items[0]?.id;
  const nodos = items.map(i => {
    const hijos = [i.texto, i.conteo ? el('span.pestana-conteo', { text: i.conteo }) : null];
    const n = i.href ? el('a.pestana', { href: i.href, dataset: { id: i.id } }, hijos) : el('button.pestana', { type: 'button', role: 'tab', dataset: { id: i.id }, onclick: () => { poner(i.id); onChange?.(i.id); } }, hijos);
    return n;
  });
  const pintar = () => nodos.forEach(n => { const on = n.dataset.id === String(actual); n.classList.toggle('activa', on); if (n.tagName === 'A') { if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current'); } else n.setAttribute('aria-selected', on ? 'true' : 'false'); });
  const poner = id => { actual = id; pintar(); nodos.find(n => n.dataset.id === String(id))?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); };
  anadir(lista, nodos); w.append(lista); pintar();
  w.poner = poner;
  return w;
}

/* ---------- Estados: cargando, vacío, error, conexión ---------- */

/** esqueleto({ lineas, forma: 'texto'|'tarjeta'|'fila'|'circulo', alto }) — el hueco con la forma de lo que viene. */
export function esqueleto({ lineas = 3, forma = 'texto', alto, ancho } = {}) {
  const base = { 'aria-hidden': 'true' };
  if (forma === 'texto') return el('div.esqueleto-grupo', { ...base, 'aria-busy': 'true' }, Array.from({ length: lineas }, (_, i) => el('div.esqueleto.esq-linea', { style: { width: i === lineas - 1 ? '60%' : '100%' } })));
  return el(`div.esqueleto.esq-${forma}`, { ...base, style: { height: alto ? `${alto}px` : null, width: ancho ? `${ancho}px` : null } });
}
/** Varias tarjetas o filas de esqueleto, con la región marcada como ocupada para lectores de pantalla. */
export function esqueletoLista(n = 3, forma = 'tarjeta') {
  return el('div.esqueleto-lista', { role: 'status', 'aria-busy': 'true', 'aria-label': t('Cargando') }, Array.from({ length: n }, () => esqueleto({ forma })));
}

/** vacio({ icono, titulo, texto, accion: { texto, onclick | href, icono } }) — siempre con la siguiente acción. */
export function vacio({ icono: ic = 'calendario', titulo, texto, accion, acciones = [] } = {}) {
  const lista = [accion, ...acciones].filter(Boolean);
  return el('div.estado.estado-vacio', {}, [
    el('div.estado-icono', {}, [icono(ic, { tam: 28 })]),
    el('h3.estado-titulo', { text: titulo }),
    texto ? el('p.estado-texto', { text: texto }) : null,
    lista.length ? el('div.estado-acciones', {}, lista.map((a, i) => boton({ variante: i === 0 ? 'primario' : 'secundario', ...a }))) : null,
  ]);
}

/** errorEstado({ titulo, texto, pasos: ['…'], reintentar: fn, detalle }) — qué pasó y qué hacer. */
export function errorEstado({ titulo = t('Algo no salió bien'), texto, pasos = [], reintentar, detalle } = {}) {
  return el('div.estado.estado-error', { role: 'alert' }, [
    el('div.estado-icono', {}, [icono('alerta', { tam: 28 })]),
    el('h3.estado-titulo', { text: titulo }),
    texto ? el('p.estado-texto', { text: texto }) : null,
    pasos.length ? el('ol.estado-pasos', {}, pasos.map(p => el('li', { text: p }))) : null,
    reintentar ? el('div.estado-acciones', {}, [boton({ texto: t('Reintentar'), icono: 'refrescar', variante: 'primario', onclick: reintentar })]) : null,
    detalle ? el('p.estado-detalle', { text: detalle }) : null,
  ]);
}

const TEXTO_CONEXION = { conectado: 'Conectado', reconectando: 'Reconectando…', 'sin-red': 'Sin conexión' };
/** Píldora del estado de la conexión: 'conectado' | 'reconectando' | 'sin-red'. `p.poner(estado, detalle)` la actualiza. */
export function pildoraConexion(estado = 'conectado') {
  const txt = el('span.conexion-texto');
  const p = el('span.conexion', { role: 'status', 'aria-live': 'polite' }, [el('span.conexion-punto', { 'aria-hidden': 'true' }), txt]);
  p.poner = (e, detalle) => {
    const k = TEXTO_CONEXION[e] ? e : 'conectado';
    p.dataset.estado = k;
    txt.textContent = t(TEXTO_CONEXION[k]);
    p.title = detalle || '';
  };
  p.poner(estado);
  return p;
}

/* ---------- Anillo de 9 segmentos ---------- */

const NOMBRE_ESTADO = { ok: 'válidos', mal: 'nulos', pendiente: 'por levantar', vacio: 'sin peso' };
function arco(cx, cy, r, a0, a1) {
  const p = a => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * Anillo de completar: 9 segmentos (3 levantamientos × 3 intentos) coloreados por resultado.
 * anillo(atleta | segmentos[{ lev, n, estado }], { tam, centro })
 */
export function anillo(origen, { tam = 44, centro = '', titulo } = {}) {
  const segs = Array.isArray(origen) ? origen : anilloAtleta(origen);
  const grupo = 120, hueco = 14, interno = 4, largo = (grupo - hueco - interno * 2) / 3;
  const cuenta = {};
  const paths = segs.map((s, k) => {
    const g = Math.floor(k / 3), i = k % 3;
    const a0 = -90 + g * grupo + hueco / 2 + i * (largo + interno);
    cuenta[s.estado] = (cuenta[s.estado] || 0) + 1;
    return `<path class="seg ${s.estado}" d="${arco(50, 50, 40, a0, a0 + largo)}"/>`;
  }).join('');
  const resumen = titulo || Object.entries(cuenta).filter(([, n]) => n).map(([e, n]) => `${n} ${t(NOMBRE_ESTADO[e] || e)}`).join(', ');
  return el('svg', {
    class: 'anillo', viewBox: '0 0 100 100', width: tam, height: tam, role: 'img', 'aria-label': `${t('Intentos')}: ${resumen}`,
    html: `${paths}${centro ? `<text x="50" y="50" class="anillo-centro" text-anchor="middle" dominant-baseline="central">${String(centro).replace(/[<>&]/g, '')}</text>` : ''}`,
  });
}

/* ---------- Celda de intento y tarjeta de meet (los mismos en todas partes) ---------- */

/** celdaIntento({ kg, r: 1|-1|null, actual, texto }) — válido con marca, nulo tachado, actual resaltado. */
export function celdaIntento({ kg, r = null, actual = false, texto } = {}) {
  const estado = r === 1 ? 'ok' : r === -1 ? 'mal' : Number(kg) > 0 ? 'pendiente' : 'vacio';
  const etiqueta = { ok: t('válido'), mal: t('nulo'), pendiente: t('por levantar'), vacio: t('sin peso') }[estado];
  return el(`span.celda-intento.${estado}${actual ? '.actual' : ''}`, { 'aria-label': `${texto ?? kg ?? ''} ${etiqueta}`.trim() }, [
    estado === 'ok' ? icono('check', { tam: 14 }) : estado === 'mal' ? icono('x', { tam: 14 }) : null,
    el('span.celda-intento-kg', { text: texto ?? (Number(kg) > 0 ? String(kg).replace('.', idioma() === 'en' ? '.' : ',') : '—') }),
  ]);
}

/** tarjetaMeet(meet, { href }) — para listas de meets (inicio, organizar, seguir). Requiere `numero`/`rangoFechas` ya formateados por el llamador si se quiere otro texto. */
export function tarjetaMeet(m, { href, hijos } = {}) {
  const lugar = [m.sede, m.ciudad, m.pais].filter(Boolean).join(' · ');
  return el('a.tarjeta.interactiva.tarjeta-meet', { href: href ?? `/meets/${encodeURIComponent(m.id)}` }, [
    el('div.tarjeta-meet-cab', {}, [pildoraEstadoMeet(m.estado), m.federacion ? el('span.tarjeta-meet-fed', { text: m.federacion }) : null]),
    el('h3.tarjeta-titulo', { text: m.nombre || t('Meet sin nombre') }),
    el('p.tarjeta-texto', { text: [m.fechaTexto, lugar].filter(Boolean).join(' · ') }),
    hijos,
  ]);
}

/* ---------- Superpuestos: modal, hoja, toast, menú ---------- */

const FOCO = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let abiertos = 0;

function superpuesta(clase, { titulo, contenido, acciones = [], alCerrar, cerrable = true, descripcion } = {}) {
  const previo = document.activeElement;
  const idT = nuevoId('titulo');
  const cuerpo = el('div.modal-cuerpo', {}, [descripcion ? el('p.modal-descripcion', { text: descripcion }) : null, contenido]);
  const cerrarBtn = cerrable ? boton({ icono: 'x', variante: 'fantasma', etiqueta: t('Cerrar'), onclick: () => cerrar() }) : null;
  const caja = el(`div.${clase}`, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titulo ? idT : null, tabindex: '-1' }, [
    el('div.modal-cab', {}, [clase === 'hoja' ? el('span.hoja-asa', { 'aria-hidden': 'true' }) : null, titulo ? el('h2.modal-titulo', { id: idT, text: titulo }) : null, cerrarBtn]),
    cuerpo,
    acciones.length ? el('div.modal-acciones', {}, acciones.map(a => {
      const b = boton({ variante: 'secundario', ...a, onclick: async e => { if (a.onclick) { const r = await a.onclick(e, b); if (r === false || a.cerrar === false) return; } cerrar(); } });
      return b;
    })) : null,
  ]);
  const fondo = el('div.modal-fondo', {}, [caja]);
  let cerrado = false;
  function cerrar() {
    if (cerrado) return; cerrado = true;
    document.removeEventListener('keydown', teclas, true);
    fondo.classList.add('saliendo');
    const quitar = () => { fondo.remove(); if (--abiertos <= 0) { abiertos = 0; document.documentElement.classList.remove('sin-scroll'); } previo?.focus?.(); alCerrar?.(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) quitar(); else setTimeout(quitar, 180);
  }
  function teclas(e) {
    if (e.key === 'Escape' && cerrable) { e.stopPropagation(); e.preventDefault(); cerrar(); return; }
    if (e.key !== 'Tab') return;
    const f = $$(FOCO, caja).filter(n => n.offsetParent !== null);
    if (!f.length) { e.preventDefault(); caja.focus(); return; }
    const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === a || document.activeElement === caja)) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }
  fondo.addEventListener('mousedown', e => { if (e.target === fondo && cerrable) cerrar(); });
  document.addEventListener('keydown', teclas, true);
  document.body.append(fondo);
  abiertos++; document.documentElement.classList.add('sin-scroll');
  requestAnimationFrame(() => { fondo.classList.add('visible'); const p = $$(FOCO, cuerpo)[0] || cerrarBtn || caja; p.focus?.({ preventScroll: true }); });
  return { el: caja, cuerpo, cerrar };
}

/** modal({ titulo, contenido, acciones: [{ texto, variante, onclick, cerrar }], alCerrar, cerrable }) → { el, cerrar } */
export const modal = o => superpuesta('modal', o);
/** hoja(...) — igual que modal, pero sube desde abajo en el teléfono. */
export const hoja = o => superpuesta('hoja', o);

/** Confirmación de una acción (borrar, quitar acceso…). Devuelve una promesa de true/false. */
export function confirmar({ titulo, texto, confirmar: etiqueta = t('Confirmar'), peligro = false } = {}) {
  return new Promise(ok => {
    let res = false;
    modal({ titulo, contenido: el('p', { text: texto || '' }), alCerrar: () => ok(res), acciones: [
      { texto: t('Cancelar'), variante: 'fantasma' },
      { texto: etiqueta, variante: peligro ? 'peligro' : 'primario', onclick: () => { res = true; } },
    ] });
  });
}

function zonaToasts() {
  let z = document.getElementById('toasts');
  if (!z) { z = el('div.toasts', { id: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false' }); document.body.append(z); }
  return z;
}

/**
 * toast(texto, { tipo: 'ok'|'error'|'info', deshacer: fn, ms })
 * Con `deshacer` muestra «Deshacer» durante 6 s (principio 1). Devuelve { cerrar }.
 */
export function toast(texto, { tipo = 'info', deshacer, ms = deshacer ? 6000 : tipo === 'error' ? 8000 : 4000, accion } = {}) {
  const z = zonaToasts();
  let h = 0, cerrado = false;
  const quitar = () => { if (cerrado) return; cerrado = true; clearTimeout(h); n.classList.add('saliendo'); setTimeout(() => n.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180); };
  const n = el(`div.toast.toast-${tipo}`, { role: tipo === 'error' ? 'alert' : 'status' }, [
    icono(tipo === 'ok' ? 'check' : tipo === 'error' ? 'alerta' : 'info', { tam: 18 }),
    el('span.toast-texto', { text: texto }),
    deshacer ? boton({ texto: t('Deshacer'), icono: 'deshacer', variante: 'fantasma', tam: 'chico', onclick: async () => { quitar(); try { await deshacer(); } catch (e) { toast(e?.message || t('No se pudo deshacer.'), { tipo: 'error' }); } } }) : null,
    accion ? boton({ texto: accion.texto, variante: 'fantasma', tam: 'chico', onclick: () => { quitar(); accion.onclick?.(); } }) : null,
    boton({ icono: 'x', variante: 'fantasma', tam: 'chico', etiqueta: t('Cerrar'), onclick: quitar }),
  ]);
  const programar = () => { clearTimeout(h); h = setTimeout(quitar, ms); };
  n.addEventListener('mouseenter', () => clearTimeout(h)); n.addEventListener('mouseleave', programar);
  n.addEventListener('focusin', () => clearTimeout(h)); n.addEventListener('focusout', programar);
  z.append(n);
  while (z.children.length > 3) z.firstElementChild.remove();
  programar();
  return { cerrar: quitar };
}

/**
 * menuContextual(ancla, items: [{ texto, icono, onclick, peligro, separador }]) → { cerrar }
 * Se abre bajo el elemento `ancla`; flechas para moverse, Esc o clic fuera para cerrar.
 */
export function menuContextual(ancla, items = []) {
  const previo = document.activeElement;
  const m = el('div.menu', { role: 'menu' }, items.map(i => i.separador ? el('hr.menu-sep') : el('button.menu-item', {
    type: 'button', role: 'menuitem', class: i.peligro ? 'peligro' : '',
    onclick: () => { cerrar(); i.onclick?.(); },
  }, [i.icono ? icono(i.icono, { tam: 18 }) : null, el('span', { text: i.texto })])));
  document.body.append(m);
  const r = ancla.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  const izq = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
  const abajo = r.bottom + 6 + h > innerHeight - 8 && r.top - 6 - h > 8;
  m.style.left = `${izq}px`; m.style.top = `${abajo ? r.top - 6 - h : r.bottom + 6}px`;
  const botones = $$('.menu-item', m);
  botones[0]?.focus();
  let cerrado = false;
  function cerrar() { if (cerrado) return; cerrado = true; document.removeEventListener('mousedown', fuera, true); document.removeEventListener('keydown', tecla, true); m.remove(); previo?.focus?.(); }
  const fuera = e => { if (!m.contains(e.target)) cerrar(); };
  const tecla = e => {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return; }
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (d) { e.preventDefault(); const i = botones.indexOf(document.activeElement); botones[(i + d + botones.length) % botones.length]?.focus(); }
    if (e.key === 'Tab') cerrar();
  };
  setTimeout(() => document.addEventListener('mousedown', fuera, true));
  document.addEventListener('keydown', tecla, true);
  return { cerrar };
}

/* ---------- Idioma y tema ---------- */

/** Selector de idioma (Español / English). Cambiarlo repinta la app. */
export function selectorIdioma() {
  return segmentado({ etiqueta: t('Idioma'), valor: idioma(), opciones: Object.entries(IDIOMAS).map(([valor, texto]) => ({ valor, texto })), onChange: l => fijarIdioma(l) });
}

const CLAVE_TEMA = 'openmeets.tema';
/** 'auto' | 'claro' | 'oscuro' */
export function temaGuardado() { try { return localStorage.getItem(CLAVE_TEMA) || 'auto'; } catch { return 'auto'; } }
export function fijarTema(tema) {
  try { if (tema === 'auto') localStorage.removeItem(CLAVE_TEMA); else localStorage.setItem(CLAVE_TEMA, tema); } catch { /* sin almacenamiento */ }
  aplicarTema(tema);
}
/** Pone data-tema en <html>; 'auto' lo quita y manda el sistema. */
export function aplicarTema(tema = temaGuardado()) {
  if (tema === 'claro' || tema === 'oscuro') document.documentElement.dataset.tema = tema; else delete document.documentElement.dataset.tema;
}
/** ¿Se ve oscuro ahora mismo? */
export const esOscuro = () => document.documentElement.dataset.tema === 'oscuro' || (document.documentElement.dataset.tema !== 'claro' && matchMedia('(prefers-color-scheme: dark)').matches);
/** Selector de tema (Automático / Claro / Oscuro). */
export function selectorTema() {
  return segmentado({ etiqueta: t('Tema'), valor: temaGuardado(), opciones: [{ valor: 'auto', texto: t('Automático') }, { valor: 'claro', texto: t('Claro'), icono: 'sol' }, { valor: 'oscuro', texto: t('Oscuro'), icono: 'luna' }], onChange: fijarTema });
}
