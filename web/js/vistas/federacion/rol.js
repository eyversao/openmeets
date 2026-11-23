/* ============================================================
   OPENMEETS — Rol de equipo de quien navega (modo federación)
   Consulta /api/rol una vez y adapta el marco: un usuario «mesa» entra directo a su mesa, «locutor» a su hoja.
   ============================================================ */

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { pedir } from '../../api.js';
import { detectarNube } from '../../nube/modo.js';
import { boton } from '../../ui.js';

let prom = null, actual = { rol: null };
export const rolActual = () => actual;
export const cargarRol = (forzar = false) => {
  // En la nube no hay roles de equipo (es del servidor local): se evita bajar el SDK de Firebase solo para recibir un 404 antes del primer pintado.
  if (forzar || !prom) prom = detectarNube().then(n => (n ? { rol: null } : globalThis.__rol ? globalThis.__rol.then(r => (r.ok ? r.json() : { rol: null })) : pedir('GET', '/api/rol', undefined, { reintentos: 0 }))).then(r => (actual = r), () => (actual = { rol: null }));
  return prom;
};

export const NOMBRE_ROL = { director: 'Director técnico', mesa: 'Mesa', pesaje: 'Pesaje', locutor: 'Locutor', lectura: 'Solo lectura' };
/** Pestañas del organizador que ve cada rol (el organizador y el director ven más). */
export const TABS_DE_ROL = {
  mesa: ['mesa', 'central'], pesaje: ['pesaje', 'atletas'], lectura: ['central', 'resultados'],
  director: ['datos', 'atletas', 'inscripciones', 'pesaje', 'mesa', 'jueces', 'resultados', 'regie', 'central', 'equipo'],
};
export const esRolDeEquipo = r => !!r?.rol && r.rol !== 'organizador' && !!r.meetId;

/** A dónde va cada rol cuando abre la app (inicio u organizar). Nada si ya está en otra pantalla. */
export function destinoPorRol(r, pathname) {
  if (!esRolDeEquipo(r) || (pathname !== '/' && pathname !== '/organizar')) return null;
  const m = encodeURIComponent(r.meetId);
  return { mesa: `/organizar/${m}/mesa`, pesaje: `/organizar/${m}/pesaje`, director: `/organizar/${m}/central`, lectura: `/organizar/${m}/central`, locutor: `/meets/${m}/locutor` }[r.rol] || null;
}

/** Antes del primer pintado: si hay un rol de equipo, cambia la URL de entrada por la suya. */
export async function aplicarRol() {
  const r = await cargarRol();
  const d = destinoPorRol(r, location.pathname);
  if (d) history.replaceState({}, '', d);
}

/** Después de construir el marco: «Organizar» lleva a lo suyo, se quitan Seguir y Ajustes y aparece «Salir». */
export function adaptarMarco(marco) {
  const r = actual;
  if (!esRolDeEquipo(r)) return;
  if (!document.querySelector('link[href="/css/federacion.css"]')) document.head.append(el('link', { rel: 'stylesheet', href: '/css/federacion.css' }));
  const m = encodeURIComponent(r.meetId);
  const inicio = { mesa: `/organizar/${m}/mesa`, pesaje: `/organizar/${m}/pesaje`, director: `/organizar/${m}/central`, lectura: `/organizar/${m}/central`, locutor: `/meets/${m}/locutor` }[r.rol];
  marco.querySelectorAll('.nav-enlace').forEach(a => {
    if (a.dataset.nav === 'seguir' || a.dataset.nav === 'ajustes') a.remove();
    else if (a.dataset.nav === 'organizar') { a.href = inicio; a.querySelector('span').textContent = t(NOMBRE_ROL[r.rol] || 'Equipo'); }
  });
  const acciones = marco.querySelector('.barra-acciones');
  if (acciones && !acciones.querySelector('.barra-salir')) {
    const b = boton({ texto: t('Salir'), icono: 'candado', variante: 'fantasma', tam: 'chico', etiqueta: t('Salir de tu acceso de equipo ({nombre})', { nombre: r.nombre }), onclick: async () => {
      try { await pedir('POST', '/api/rol/salir', {}); } catch { /* ya sin sesión */ }
      location.href = '/';
    } });
    b.classList.add('barra-salir');
    acciones.prepend(b);
  }
}
