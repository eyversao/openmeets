/* ============================================================
   OPENMEETS — Aplicación: router de URLs limpias (history API, sin #), marco común,
   píldora de conexión, tema e idioma.

   Cada vista es un módulo en js/vistas/ con un export por defecto:
     export default async function (ctx) { ...pinta en ctx.raiz...; return limpiezaOpcional; }
   ctx = {
     raiz,                 // contenedor vacío de la vista
     params,               // { id, pestana } según la ruta (pestana por defecto: 'resumen')
     consulta,             // URLSearchParams
     ruta,                 // { nombre, ruta }
     api, t, app,          // cliente REST, traducción y servicios de la app
     alSalir(fn),          // registra una limpieza al salir de la vista (canales, temporizadores…)
   }
   ctx.app = { navegar(url, { reemplazar }), titulo(texto), vincularCanal(canal), info(), estilos(nombre),
               toast, esOrganizador(), recargarInfo(), ruta }
   ============================================================ */

import { el, $, reemplazar } from './util.js';
import { t, iniciarIdioma, alCambiarIdioma, idioma, fijarIdioma, IDIOMAS } from './i18n.js';
import { api } from './api.js';
import { detectarNube } from './nube/modo.js';
import { cargarRol, aplicarRol, adaptarMarco } from './vistas/federacion/rol.js';
import { icono, pildoraConexion, errorEstado, boton, esqueletoLista, toast, aplicarTema, temaGuardado, fijarTema, esOscuro, menuContextual } from './ui.js';

/* ---------- Rutas ---------- */

/** Orden importa: la primera que coincide gana. `oscuro`: la tarima y el juez siempre en oscuro. `marco: false`: pantalla completa. */
export const RUTAS = [
  { nombre: 'inicio', patron: '/', cargar: () => import('./vistas/inicio.js'), titulo: 'Inicio', nav: 'inicio' },
  { nombre: 'pantalla', patron: '/meets/:id/pantalla', cargar: () => import('./vistas/pantalla.js'), titulo: 'Pantalla', marco: false, oscuro: true },
  { nombre: 'hud', patron: '/meets/:id/hud', cargar: () => import('./vistas/hud.js'), titulo: 'HUD', marco: false, oscuro: true },
  { nombre: 'inscripcion', patron: '/meets/:id/inscripcion', cargar: () => import('./vistas/inscripcion.js'), titulo: 'Inscripción', nav: 'inicio' },
  { nombre: 'locutor', patron: '/meets/:id/locutor', cargar: () => import('./vistas/federacion/locutor.js'), titulo: 'Locutor', marco: false, oscuro: true },
  { nombre: 'acta', patron: '/meets/:id/acta', cargar: () => import('./vistas/federacion/acta.js'), titulo: 'Acta de resultados', marco: false },
  { nombre: 'entrar', patron: '/entrar', cargar: () => import('./vistas/federacion/entrar.js'), titulo: 'Entrar' },
  { nombre: 'meet', patron: '/meets/:id', cargar: () => import('./vistas/meet.js'), titulo: 'Meet', nav: 'inicio' },
  { nombre: 'juez', patron: '/juez/:id', cargar: () => import('./vistas/juez.js'), titulo: 'Juez', marco: false, oscuro: true },
  { nombre: 'organizar', patron: '/organizar', cargar: () => import('./vistas/organizar/index.js'), titulo: 'Organizar', nav: 'organizar' },
  { nombre: 'organizar-meet', patron: '/organizar/:id/:pestana?', cargar: () => import('./vistas/organizar/meet.js'), titulo: 'Organizar', nav: 'organizar' },
  { nombre: 'atletas', patron: '/atletas', cargar: () => import('./vistas/atletas.js'), titulo: 'Atletas', nav: 'inicio' },
  { nombre: 'atleta', patron: '/atletas/:slug', cargar: () => import('./vistas/atleta.js'), titulo: 'Atleta', nav: 'inicio' },
  { nombre: 'records', patron: '/records', cargar: () => import('./vistas/records.js'), titulo: 'Récords', nav: 'inicio' },
  { nombre: 'seguir', patron: '/seguir', cargar: () => import('./vistas/seguir.js'), titulo: 'Seguir en LiftingCast', nav: 'seguir' },
  { nombre: 'ajustes', patron: '/ajustes', cargar: () => import('./vistas/ajustes.js'), titulo: 'Ajustes', nav: 'ajustes' },
];

const compilar = patron => {
  const nombres = [];
  const re = patron.replace(/\/:(\w+)(\?)?/g, (_, n, opc) => { nombres.push(n); return opc ? '(?:/([^/]+))?' : '/([^/]+)'; });
  return { re: new RegExp(`^${re === '/' ? '/?' : re}/?$`), nombres };
};
const COMPILADAS = RUTAS.map(r => ({ ...r, ...compilar(r.patron) }));

/** Empareja una ruta ('/meets/ab12') con su vista y parámetros; null si no existe. */
export function resolver(pathname) {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const r of COMPILADAS) {
    const m = r.re.exec(p);
    if (!m) continue;
    const params = {};
    r.nombres.forEach((n, i) => { if (m[i + 1] !== undefined) params[n] = decodeURIComponent(m[i + 1]); });
    if (r.nombre === 'organizar-meet') params.pestana ||= 'resumen';
    return { ruta: r, params };
  }
  return null;
}

/* ---------- Estado de la app ---------- */

let infoServidor = null;
let estadoSondeo = 'reconectando';
let canalVinculado = null, desvincular = null;
let fallosSondeo = 0, temporizadorSondeo = 0;
let pildora, aviso, principal, marco;
let limpiezas = [];
let token = 0;
let rutaActual = null;
const estilosCargados = new Set();

const estadoEfectivo = () => (canalVinculado ? canalVinculado.estado() : estadoSondeo);

function pintarConexion() {
  const e = estadoEfectivo();
  if (infoServidor?.modo === 'nube' && !document.documentElement.dataset.modo) { document.documentElement.dataset.modo = 'nube'; estilos('nube'); } // hub: sin Organizar ni mesa
  pildora?.poner(e, infoServidor ? `OpenMeets ${infoServidor.version || ''}`.trim() : '');
  if (aviso) {
    aviso.hidden = e !== 'sin-red';
    document.documentElement.classList.toggle('sin-red', e === 'sin-red');
  }
}

async function sondear() {
  clearTimeout(temporizadorSondeo);
  try {
    infoServidor = await api.info();
    fallosSondeo = 0; estadoSondeo = 'conectado';
  } catch {
    fallosSondeo++;
    estadoSondeo = navigator.onLine === false || fallosSondeo >= 2 ? 'sin-red' : 'reconectando';
  }
  pintarConexion();
  temporizadorSondeo = setTimeout(sondear, estadoSondeo === 'conectado' ? 20000 : Math.min(8000, 1500 * (fallosSondeo + 1)));
}

/* ---------- Servicios para las vistas ---------- */

export function navegar(url, { reemplazar: rep = false } = {}) {
  const u = new URL(url, location.href);
  if (u.origin !== location.origin) { location.href = u.href; return; }
  const destino = u.pathname + u.search + u.hash;
  if (destino !== location.pathname + location.search + location.hash) history[rep ? 'replaceState' : 'pushState']({}, '', destino);
  pintar();
}

function vincularCanal(canal) {
  desvincular?.();
  canalVinculado = canal;
  const baja = canal.alEstado(pintarConexion);
  desvincular = () => { baja(); if (canalVinculado === canal) canalVinculado = null; desvincular = null; pintarConexion(); };
  pintarConexion();
  return desvincular;
}

/** Carga css/<nombre>.css una sola vez (publico, organizar, pantalla, juez…). */
function estilos(nombre) {
  if (estilosCargados.has(nombre)) return;
  estilosCargados.add(nombre);
  document.head.append(el('link', { rel: 'stylesheet', href: `/css/${nombre}.css` }));
}

const servicios = {
  navegar, titulo: texto => { document.title = texto ? `${texto} · OpenMeets` : 'OpenMeets'; }, vincularCanal, estilos, toast,
  info: () => infoServidor, esOrganizador: () => !!infoServidor?.organizador,
  recargarInfo: async () => { await sondear(); return infoServidor; },
  get ruta() { return rutaActual; },
};

/* ---------- Marco: barra superior, navegación y pie ---------- */

const NAV = [
  { id: 'inicio', texto: 'Inicio', href: '/', icono: 'inicio' },
  { id: 'organizar', texto: 'Organizar', href: '/organizar', icono: 'barra' },
  { id: 'seguir', texto: 'Seguir', href: '/seguir', icono: 'en-vivo' },
  { id: 'ajustes', texto: 'Ajustes', href: '/ajustes', icono: 'ajustes' },
];

function construirMarco(raiz) {
  pildora = pildoraConexion(estadoEfectivo());
  const botonIdioma = boton({ texto: idioma().toUpperCase(), icono: 'globo', variante: 'fantasma', etiqueta: t('Idioma'), onclick: e => {
    menuContextual(e.currentTarget, Object.entries(IDIOMAS).map(([k, nombre]) => ({ texto: nombre, icono: k === idioma() ? 'check' : null, onclick: () => fijarIdioma(k) })));
  } });
  botonIdioma.classList.add('barra-idioma');
  const botonTema = boton({ icono: esOscuro() ? 'sol' : 'luna', variante: 'fantasma', etiqueta: t('Cambiar entre tema claro y oscuro'), onclick: () => {
    fijarTema(esOscuro() ? 'claro' : 'oscuro');
    botonTema.replaceChildren(icono(esOscuro() ? 'sol' : 'luna'));
  } });
  aviso = el('div.aviso-red', { role: 'alert', hidden: true }, [
    icono('wifi-off'),
    el('div.aviso-red-texto', {}, [
      el('strong', { text: t('No hay conexión con OpenMeets') }),
      el('span', { text: t('Se muestra lo último que llegó. Comprueba que el programa sigue abierto en el equipo de la mesa y que estás en la misma Wi-Fi. Se reintenta solo.') }),
    ]),
    boton({ texto: t('Reintentar'), icono: 'refrescar', variante: 'secundario', tam: 'chico', onclick: () => { fallosSondeo = 0; sondear(); } }),
  ]);
  principal = el('main.principal', { id: 'principal', tabindex: '-1' });
  marco = el('div.marco', {}, [
    el('a.saltar', { href: '#principal', 'data-externo': '', onclick: e => { e.preventDefault(); principal.focus(); } }, t('Saltar al contenido')),
    el('header.barra', {}, [
      el('div.barra-fila', {}, [
        el('a.marca', { href: '/', 'aria-label': 'OpenMeets' }, [el('span.marca-texto', { text: 'OpenMeets' })]),
        el('div.barra-acciones', {}, [pildora, botonIdioma, botonTema]),
      ]),
      el('nav.nav', { 'aria-label': t('Principal') }, el('div.nav-lista', {}, NAV.map(n => el('a.nav-enlace', { href: n.href, dataset: { nav: n.id } }, [icono(n.icono, { tam: 18 }), el('span', { text: t(n.texto) })])))),
    ]),
    aviso, principal,
    el('footer.pie', {}, [el('span', { text: 'OpenMeets · MIT · © 2026 Eyver Gomez (@eyversao)' })]),
  ]);
  reemplazar(raiz, marco);
  pintarConexion();
}

function marcarNavegacion(nav) {
  $('.nav', marco)?.querySelectorAll('.nav-enlace').forEach(a => { if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}

/* ---------- Pintar la ruta actual ---------- */

function salirDeLaVista() {
  const ls = limpiezas; limpiezas = [];
  for (const f of ls) { try { f(); } catch (e) { console.warn('[openmeets] limpieza de vista', e); } }
}

async function pintar() {
  const mio = ++token;
  salirDeLaVista();
  const url = new URL(location.href);
  const res = resolver(url.pathname);
  rutaActual = res ? { nombre: res.ruta.nombre, ruta: url.pathname, params: res.params } : { nombre: '404', ruta: url.pathname, params: {} };

  marco.classList.toggle('sin-marco', res?.ruta.marco === false);
  if (res?.ruta.oscuro) document.documentElement.dataset.tema = 'oscuro'; else aplicarTema();
  marcarNavegacion(res?.ruta.nav);
  servicios.titulo(res ? t(res.ruta.titulo) : t('No encontrada'));
  window.scrollTo(0, 0);

  if (!res) {
    reemplazar(principal, el('div.contenedor.vista', {}, errorEstado({ titulo: t('No encontramos esta página'), texto: t('El enlace puede estar mal escrito o el meet ya no existe.'), pasos: [t('Vuelve al inicio y entra desde la lista de meets.')] })));
    principal.querySelector('.estado-acciones')?.remove();
    principal.querySelector('.estado').append(el('div.estado-acciones', {}, [boton({ texto: t('Ir al inicio'), icono: 'inicio', variante: 'primario', href: '/' })]));
    return;
  }

  reemplazar(principal, el('div.contenedor.vista', {}, esqueletoLista(3)));
  try {
    const mod = await res.ruta.cargar();
    if (mio !== token) return;
    const raiz = el('div.vista', { dataset: { vista: res.ruta.nombre } });
    reemplazar(principal, raiz);
    const ctx = { raiz, params: res.params, consulta: url.searchParams, ruta: rutaActual, api, t, app: servicios, alSalir: f => { if (mio === token) limpiezas.push(f); else try { f(); } catch { /* ya salió */ } } };
    const limpieza = await mod.default(ctx);
    if (mio !== token) { try { limpieza?.(); } catch { /* ya salió */ } return; }
    if (typeof limpieza === 'function') limpiezas.push(limpieza);
    if (!principal.contains(document.activeElement) || document.activeElement === document.body) principal.focus({ preventScroll: true });
  } catch (e) {
    if (mio !== token) return;
    console.error('[openmeets] vista', e);
    reemplazar(principal, el('div.contenedor.vista', {}, errorEstado({
      titulo: t('No se pudo abrir esta pantalla'), texto: t('Algo falló al cargarla. Vuelve a intentarlo; si sigue igual, recarga la página.'),
      reintentar: () => pintar(), detalle: e?.message,
    })));
  }
}

/* ---------- Arranque ---------- */

const EXCLUIDOS = [/^\/api\//, /^\/docs(\/|$)/, /^\/marca(\/|$)/, /\.[a-z0-9]{2,5}$/i];

function interceptarEnlaces() {
  document.addEventListener('click', e => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('a[href]');
    if (!a || a.target || a.hasAttribute('download') || a.hasAttribute('data-externo')) return;
    const u = new URL(a.href, location.href);
    if (u.origin !== location.origin || EXCLUIDOS.some(r => r.test(u.pathname))) return;
    e.preventDefault();
    navegar(u.pathname + u.search + u.hash);
  });
  window.addEventListener('popstate', pintar);
}

async function arrancar() {
  const nube = detectarNube(); // en paralelo con el idioma; solo hay nube si existe /nube.json (despliegue de Firebase)
  cargarRol(); // /api/rol sale ya, sin esperar al resto del arranque (en la nube no se pide)
  await iniciarIdioma();
  if (await nube) await (await import('./nube/inicio.js')).iniciar({ aviso: m => toast(m, { tipo: 'error' }) });
  await aplicarRol(); // acceso de equipo: entra directo a lo suyo
  aplicarTema(temaGuardado());
  const raiz = $('#app');
  construirMarco(raiz); adaptarMarco(raiz);
  interceptarEnlaces();
  alCambiarIdioma(() => { const desv = desvincular; construirMarco(raiz); adaptarMarco(raiz); void desv; if (canalVinculado) pildora.poner(canalVinculado.estado()); pintar(); });
  window.addEventListener('online', () => { fallosSondeo = 0; sondear(); });
  window.addEventListener('offline', () => { estadoSondeo = 'sin-red'; pintarConexion(); });
  sondear();
  await pintar();
  // El service worker se registra con la página ya pintada y en reposo: su precarga de ~100 archivos no compite con el primer pintado.
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const registrar = () => navigator.serviceWorker.register('/sw.js').catch(() => { /* sin sw.js o sin contexto seguro: la web funciona igual */ });
    const cuando = () => (window.requestIdleCallback ? requestIdleCallback(registrar, { timeout: 5000 }) : setTimeout(registrar, 2000));
    if (document.readyState === 'complete') cuando(); else addEventListener('load', cuando, { once: true });
  }
}

if (typeof document !== 'undefined') arrancar();
