/* ============================================================
   OPENMEETS — Piezas comunes de las vistas del organizador
   Estilos, iconos extra, acceso con PIN, ventana para pedir un valor y descargas.
   ============================================================ */

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { api } from '../../api.js';
import { ICONOS, icono, boton, campo, modal, toast, vacio } from '../../ui.js';

/* Iconos que el kit aún no trae (se registran una vez; `icono('parar')`, `icono('qr')`). */
const R = (...p) => p.map(d => `<path d="${d}"/>`).join('');
ICONOS.parar ||= '<rect x="6" y="6" width="12" height="12" rx="2"/>';
ICONOS.google ||= '<path fill="currentColor" stroke="none" d="M12.48 10.92v3.28h7.84c-.24 1.84-.85 3.19-1.79 4.13-1.15 1.15-2.93 2.4-6.05 2.4-4.83 0-8.6-3.89-8.6-8.72s3.77-8.72 8.6-8.72c2.6 0 4.51 1.03 5.91 2.35l2.31-2.31C18.75 1.44 16.13 0 12.48 0 5.87 0 .31 5.39.31 12s5.56 12 12.17 12c3.57 0 6.27-1.17 8.37-3.36 2.16-2.16 2.84-5.21 2.84-7.67 0-.76-.05-1.47-.17-2.05H12.48z"/>';
ICONOS.qr ||= '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/>' + R('M14 14h3v3', 'M20 14v.01', 'M14 20h.01', 'M17 20h3v-3');

/** Carga css/organizar.css y espera a que esté lista, para no pintar sin estilo. */
export function cargarCss(ctx) {
  ctx.app.estilos('organizar');
  const link = document.querySelector('link[href="/css/organizar.css"]');
  if (!link || link.sheet) return Promise.resolve();
  return new Promise(ok => { link.addEventListener('load', ok, { once: true }); link.addEventListener('error', ok, { once: true }); setTimeout(ok, 1500); });
}

/** Cabecera de una vista: título con resaltador, subtítulo y acciones. */
export function cabecera({ titulo, sub, acciones = [], atras }) {
  return el('header.cabecera-vista.org-cab', {}, [
    atras ? el('a.org-atras', { href: atras.href }, [icono('flecha-izq', { tam: 16 }), atras.texto]) : null,
    el('div.org-cab-fila', {}, [
      el('div.org-cab-texto', {}, [el('h1.titular.org-titular', {}, [el('span.resaltado', { text: titulo })]), sub ? el('p.subtitulo', { text: sub }) : null]),
      acciones.length ? el('div.org-cab-acciones', {}, acciones) : null,
    ]),
  ]);
}

/** Descarga un texto como archivo. */
export function descargar(nombre, contenido, tipo = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const a = el('a', { href: url, download: nombre, 'data-externo': '' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Lee un archivo de texto elegido por quien organiza. */
export const leerArchivo = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => no(new Error(t('No se pudo leer el archivo.'))); r.readAsText(f); });

/**
 * Pide un valor en una ventana pequeña (Enter acepta). `aceptar(texto)` devuelve false para dejarla abierta.
 * Se usa para el tiempo del reloj, el peso de la barra y los preajustes.
 */
export function pedirValor({ titulo, etiqueta, valor = '', ayuda, modo, aceptar, textoAceptar }) {
  const c = campo({ etiqueta, valor, ayuda, modo, autocompletar: 'off' });
  const ok = () => { const r = aceptar(c.valor().trim(), c); if (r === false) return false; m.cerrar(); return true; };
  c.entrada.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
  const m = modal({ titulo, contenido: c, acciones: [
    { texto: t('Cancelar'), variante: 'fantasma' },
    { texto: textoAceptar || t('Guardar'), variante: 'primario', cerrar: false, onclick: () => { ok(); return false; } },
  ] });
  setTimeout(() => { c.entrada.focus(); c.entrada.select?.(); }, 60);
  return m;
}

/** Doble clic o pulsación larga (600 ms) en un elemento. */
export function pulsacionLarga(nodo, fn) {
  let h = 0;
  const parar = () => clearTimeout(h);
  nodo.addEventListener('dblclick', fn);
  nodo.addEventListener('pointerdown', () => { parar(); h = setTimeout(fn, 600); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => nodo.addEventListener(ev, parar));
}

/**
 * Pantalla para entrar como organizador desde otro equipo con el PIN de 6 dígitos que muestra la consola.
 * `alEntrar()` se llama cuando el servidor acepta el PIN.
 */
/** Nube (modo cuentas): en lugar del PIN, entrar con Google. Mismo panel que el del PIN. */
function pantallaCuenta(ctx, alEntrar, info) {
  const error = el('p.campo-error', { role: 'alert' });
  const entrar = boton({ texto: t('Continuar con Google'), icono: 'google', variante: 'primario', ancho: true, onclick: async () => {
    error.textContent = ''; entrar.cargando(true);
    const g = await import('../../cuenta.js');
    try { await api.sesionGoogle(await g.entrarConGoogle(info.firebase)); await ctx.app.recargarInfo(); alEntrar(); } catch (e) { if (!g.cancelado(e)) error.textContent = e?.message || t('No se pudo entrar. Vuelve a intentarlo.'); } finally { entrar.cargando(false); }
  } });
  ctx.app.titulo(t('Organizar'));
  return el('div.contenedor.contenedor-estrecho', {}, [
    cabecera({ titulo: t('Organizar') }),
    el('div.panel.org-pin-caja', {}, [
      el('div.estado-icono', {}, [icono('usuario', { tam: 28 })]),
      el('h2.estado-titulo', { text: t('Crea tus propias competencias') }),
      el('p.estado-texto', { text: t('Entra con tu cuenta de Google para crear y dirigir tus meets. Quien mira, juzga o sigue la competencia no necesita cuenta.') }),
      entrar, error,
      el('p.pequeno.suave', { text: t('Solo guardamos tu nombre y tu correo para saber qué meets son tuyos.') }),
    ]),
  ]);
}

export function pantallaPin(ctx, alEntrar) {
  const info = ctx.app.info();
  if (info?.cuentas) return pantallaCuenta(ctx, alEntrar, info);
  const pin = campo({ etiqueta: t('PIN de organizador'), modo: 'numeric', autocompletar: 'one-time-code', maxlength: 6, placeholder: '000000', ayuda: t('Son 6 dígitos. Salen en la ventana de OpenMeets del equipo de la mesa y en Ajustes de ese equipo.') });
  pin.entrada.classList.add('org-pin');
  const entrar = boton({ texto: t('Entrar'), icono: 'candado', variante: 'primario', tipo: 'submit', ancho: true });
  const f = el('form.formulario.org-pin-form', { novalidate: true, onsubmit: async e => {
    e.preventDefault();
    const v = pin.valor().replace(/\D/g, '');
    if (v.length !== 6) { pin.ponerError(t('Escribe los 6 dígitos del PIN.')); pin.entrada.focus(); return; }
    entrar.cargando(true);
    try { await api.sesion(v); await ctx.app.recargarInfo(); alEntrar(); } catch (er) { pin.ponerError(er.message); pin.entrada.select(); } finally { entrar.cargando(false); }
  } }, [pin, entrar]);
  ctx.app.titulo(t('Organizar'));
  return el('div.contenedor.contenedor-estrecho', {}, [
    cabecera({ titulo: t('Organizar') }),
    el('div.panel.org-pin-caja', {}, [
      el('div.estado-icono', {}, [icono('candado', { tam: 28 })]),
      el('h2.estado-titulo', { text: t('Entra como organizador') }),
      el('p.estado-texto', { text: t('Desde este equipo necesitas el PIN para crear y dirigir meets. Quien mira o sigue la competencia no lo necesita.') }),
      f,
    ]),
  ]);
}

/** Estado vacío estándar con una acción. */
export const sinNada = vacio;

/** Toast de error de una acción que falló, con el mensaje de la API. */
export const avisoError = e => toast(e?.message || t('No se pudo completar la acción.'), { tipo: 'error' });

/** Abre un enlace en otra pestaña (la pantalla de tarima, la página pública). */
export const enlaceExterno = (href, texto, ic) => boton({ texto, icono: ic, variante: 'secundario', tam: 'chico', href, target: '_blank', rel: 'noopener', 'data-externo': '' });
