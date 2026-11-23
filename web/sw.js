// OpenMeets · service worker. Tras la primera carga la app abre sin internet.
// Estáticos: caché primero y se refrescan en segundo plano. Navegación: red y, si falla, index.html guardado.
// /api/* nunca pasa por aquí (siempre red); tampoco el canal SSE ni ningún POST.
// La lista y la versión las escribe scripts/sw-lista.mjs; no las edites a mano.
/*LISTA*/
const VERSION = '0f1a255b97';
const ARCHIVOS = [
  '/',
  '/css/app.css',
  '/css/barra-visual.css',
  '/css/base.css',
  '/css/componentes.css',
  '/css/cuentas.css',
  '/css/federacion.css',
  '/css/inscripciones.css',
  '/css/juez.css',
  '/css/luces.css',
  '/css/marca.css',
  '/css/nube.css',
  '/css/organizar.css',
  '/css/pantalla.css',
  '/css/publico.css',
  '/css/records.css',
  '/css/regie.css',
  '/css/tokens.css',
  '/favicon.ico',
  '/favicon.svg',
  '/fuentes/geist-latin-400-normal.woff2',
  '/fuentes/geist-latin-500-normal.woff2',
  '/fuentes/geist-latin-600-normal.woff2',
  '/fuentes/geist-latin-700-normal.woff2',
  '/fuentes/geist-mono-latin-400-normal.woff2',
  '/fuentes/geist-mono-latin-500-normal.woff2',
  '/fuentes/instrument-serif-latin-400-italic.woff2',
  '/fuentes/instrument-serif-latin-400-normal.woff2',
  '/iconos/apple-touch-180.png',
  '/iconos/icono-192.png',
  '/iconos/icono-512.png',
  '/iconos/icono-maskable-512.png',
  '/js/api.js',
  '/js/app.js',
  '/js/canal.js',
  '/js/cuenta.js',
  '/js/i18n.js',
  '/js/i18n/en.json',
  '/js/inscripciones-api.js',
  '/js/marca.js',
  '/js/nube/bd.js',
  '/js/nube/descargas.js',
  '/js/nube/inicio.js',
  '/js/nube/modelo.js',
  '/js/nube/modo.js',
  '/js/nube/rutas.js',
  '/js/nube/transporte.js',
  '/js/nucleo/calculo.js',
  '/js/nucleo/competencia.js',
  '/js/nucleo/discos.js',
  '/js/nucleo/federacion.js',
  '/js/nucleo/federaciones.js',
  '/js/nucleo/inscribir.js',
  '/js/nucleo/inscripcion.js',
  '/js/nucleo/jueces-acceso.js',
  '/js/nucleo/jueces-mandos.js',
  '/js/nucleo/liftingcast.js',
  '/js/nucleo/luces-estado.js',
  '/js/nucleo/mesa-votos.js',
  '/js/nucleo/perfiles.js',
  '/js/nucleo/puntajes.js',
  '/js/nucleo/qr.js',
  '/js/nucleo/records.js',
  '/js/nucleo/regie.js',
  '/js/nucleo/reloj.js',
  '/js/nucleo/sonidos.js',
  '/js/nucleo/tarjeta-social.js',
  '/js/nucleo/validar.js',
  '/js/ui.js',
  '/js/util.js',
  '/js/vistas/_pronto.js',
  '/js/vistas/_publico.js',
  '/js/vistas/_records.js',
  '/js/vistas/ajustes.js',
  '/js/vistas/atleta.js',
  '/js/vistas/atletas.js',
  '/js/vistas/barra-visual.js',
  '/js/vistas/federacion/acta.js',
  '/js/vistas/federacion/entrar.js',
  '/js/vistas/federacion/locutor.js',
  '/js/vistas/federacion/rol.js',
  '/js/vistas/hud-escenas.js',
  '/js/vistas/hud.js',
  '/js/vistas/inicio.js',
  '/js/vistas/inscripcion.js',
  '/js/vistas/juez-datos.js',
  '/js/vistas/juez.js',
  '/js/vistas/meet.js',
  '/js/vistas/nube-ui.js',
  '/js/vistas/organizar/atletas.js',
  '/js/vistas/organizar/central.js',
  '/js/vistas/organizar/cierre.js',
  '/js/vistas/organizar/comun.js',
  '/js/vistas/organizar/datos.js',
  '/js/vistas/organizar/equipo.js',
  '/js/vistas/organizar/index.js',
  '/js/vistas/organizar/inscripciones.js',
  '/js/vistas/organizar/jueces.js',
  '/js/vistas/organizar/logica.js',
  '/js/vistas/organizar/meet.js',
  '/js/vistas/organizar/mesa.js',
  '/js/vistas/organizar/pesaje.js',
  '/js/vistas/organizar/records-aviso.js',
  '/js/vistas/organizar/regie.js',
  '/js/vistas/organizar/resultados.js',
  '/js/vistas/pantalla-datos.js',
  '/js/vistas/pantalla.js',
  '/js/vistas/records.js',
  '/js/vistas/seguir.js',
  '/js/vistas/tarjeta-render.js',
  '/manifest.webmanifest',
  '/og.png',
];
/*FIN*/
const CACHE = `openmeets-${VERSION}`;

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // Uno a uno: si un archivo falla, el resto se guarda igual.
    await Promise.all(ARCHIVOS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (/^openmeets?-/.test(k) && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const u = new URL(req.url);
  if (u.origin !== location.origin || u.pathname === '/api' || u.pathname.startsWith('/api/') || u.pathname === '/sw.js' || u.pathname === '/nube.json') return; // otro origen (Firebase, gstatic) y /nube.json pasan directo a la red
  if (req.mode === 'navigate') { e.respondWith(navegar(req)); return; }
  e.respondWith(estatico(req, e));
});

async function navegar(req) {
  const c = await caches.open(CACHE);
  try {
    const r = await Promise.race([fetch(req), new Promise((_, no) => setTimeout(no, 4000))]);
    if (r.ok) c.put('/', r.clone()); // toda ruta de la app es index.html
    return r;
  } catch {
    return (await c.match('/')) || Response.error();
  }
}

async function estatico(req, e) {
  const c = await caches.open(CACHE);
  const guardado = await c.match(req);
  const red = fetch(req).then(r => { if (r.ok && r.type === 'basic') c.put(req, r.clone()); return r; });
  if (guardado) { e.waitUntil(red.catch(() => {})); return guardado; }
  return red.catch(() => new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
}
