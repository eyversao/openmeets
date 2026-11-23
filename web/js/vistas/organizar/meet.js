/* ============================================================
   OPENMEETS — /organizar/:id/:pestaña
   Marco del meet: carga el meet, abre el canal en vivo, guarda atletas sin perder nada
   y reparte el trabajo entre las pestañas (datos, atletas, mesa, jueces, resultados).
   Las pestañas ya abiertas quedan montadas: la mesa sigue contando votos aunque mires otra.
   ============================================================ */

import { el, reemplazar, clonar } from '../../util.js';
import { t } from '../../i18n.js';
import { api } from '../../api.js';
import { abrirCanal } from '../../canal.js';
import { crearDriver } from '../../nucleo/jueces-mandos.js';
import { crearRegistro } from '../../nucleo/jueces-acceso.js';
import { boton, pestanas, pildoraEstadoMeet, vacio, errorEstado, esqueletoLista, toast, icono } from '../../ui.js';
import { cargarCss, cabecera, pantallaPin, enlaceExterno, avisoError } from './comun.js';
import { pildoraNube } from '../nube-ui.js';
import { cargarRol, esRolDeEquipo, TABS_DE_ROL } from '../federacion/rol.js';

const TABS = [
  { id: 'datos', texto: 'Datos', carga: () => import('./datos.js') },
  { id: 'atletas', texto: 'Atletas', carga: () => import('./atletas.js') },
  { id: 'inscripciones', texto: 'Inscripciones', carga: () => import('./inscripciones.js') },
  { id: 'pesaje', texto: 'Pesaje', carga: () => import('./pesaje.js') },
  { id: 'mesa', texto: 'Mesa', carga: () => import('./mesa.js') },
  { id: 'jueces', texto: 'Jueces', carga: () => import('./jueces.js') },
  { id: 'resultados', texto: 'Resultados', carga: () => import('./resultados.js') },
  { id: 'regie', texto: 'Transmisión', carga: () => import('./regie.js') },
  { id: 'central', texto: 'Central', carga: () => import('./central.js') },
  { id: 'equipo', texto: 'Equipo', carga: () => import('./equipo.js') },
];
let TABS_VISIBLES = TABS; // con un rol de equipo, solo las pestañas de su rol (modo federación)
const REINTENTO_MS = 3000;
const PROTEGIDO_MS = 4000;

/** 'en-vivo' | 'programada' | 'terminada' con lo que sabe la mesa ahora mismo. */
function estadoLocal(meet, vivos) {
  if (meet.cerrado) return 'terminada';
  if (Object.values(vivos || {}).some(v => v && v.actual)) return 'en-vivo';
  const fin = meet.fechaFin || meet.fecha;
  const h = new Date();
  const hoy = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
  return fin && fin < hoy ? 'terminada' : 'programada';
}

function crearEstado(ctx, meet) {
  const id = meet.id;
  const st = {
    ctx, id, meet, vivos: { ...(meet.vivo || {}) }, presencias: {}, tab: null,
    tocados: new Map(),            // aid → Infinity (guardando) o ms del último guardado: protege lo local de ecos viejos
    cadenas: new Map(),            // aid → promesa: los guardados de un atleta salen en orden
    fallidos: new Set(), reintento: 0, avisoRed: 0,
    oyentes: new Set(), presOyentes: new Set(), panes: {}, driver: null, registro: null, canal: null,
  };
  st.atletas = () => st.meet.atletas || (st.meet.atletas = []);
  st.escuchar = fn => { st.oyentes.add(fn); return () => st.oyentes.delete(fn); };
  st.avisar = () => st.oyentes.forEach(fn => { try { fn(st.meet); } catch (e) { console.warn('[openmeets] escucha', e); } });

  /** Guarda un atleta en el servidor. Si no hay red, lo reintenta solo hasta lograrlo (la mesa no pierde resultados). */
  st.guardarAtleta = a => {
    st.tocados.set(a.id, Infinity);
    const previa = st.cadenas.get(a.id) || Promise.resolve();
    const p = previa.then(async () => {
      const actual = st.atletas().find(x => x.id === a.id) || a;
      try { await api.guardarAtleta(id, actual); st.fallidos.delete(a.id); st.tocados.set(a.id, Date.now()); } catch (e) {
        if (e.estado >= 400 && e.estado < 500 && e.estado !== 429) { st.tocados.delete(a.id); avisoError(e); return; }
        st.fallidos.add(a.id);
        if (Date.now() - st.avisoRed > 20000) { st.avisoRed = Date.now(); toast(t('Sin conexión: tus cambios están guardados aquí y se enviarán solos al volver la red.'), { tipo: 'error' }); }
        programarReintento();
      }
    });
    st.cadenas.set(a.id, p);
    return p;
  };
  function programarReintento() {
    if (st.reintento || !st.fallidos.size) return;
    st.reintento = setTimeout(async () => {
      st.reintento = 0;
      for (const aid of [...st.fallidos]) { const a = st.atletas().find(x => x.id === aid); if (!a) { st.fallidos.delete(aid); continue; } await st.guardarAtleta(a); }
      programarReintento();
    }, REINTENTO_MS);
  }
  /** Ppone o cambia un atleta en la lista local y lo guarda. */
  st.ponerAtleta = a => {
    const l = st.atletas(); const i = l.findIndex(x => x.id === a.id);
    if (i < 0) l.push(a); else l[i] = a;
    st.avisar();
    return st.guardarAtleta(a);
  };
  st.quitarAtleta = async aid => {
    const l = st.atletas(); const i = l.findIndex(x => x.id === aid);
    if (i < 0) return;
    l.splice(i, 1); st.tocados.delete(aid); st.fallidos.delete(aid);
    st.avisar();
    await api.borrarAtleta(id, aid);
  };
  /** PATCH de campos del meet; actualiza lo local con lo que aceptó el servidor. */
  st.cambiarMeet = async campos => {
    const r = await api.cambiarMeet(id, campos);
    const { privado, ...publicos } = campos;
    Object.assign(st.meet, publicos);
    if (privado) st.meet.privado = { ...(st.meet.privado || {}), ...privado };
    if (r && typeof r === 'object' && r.estado) st.meet.estado = r.estado;
    st.avisar();
    return st.meet;
  };
  st.plataformas = () => (st.meet.plataformas?.length ? st.meet.plataformas : ['Tarima 1']);
  st.irA = tab => st.mostrar?.(tab);
  return st;
}

/** Une el meet que llega por el canal con lo local: lo recién tocado aquí manda sobre un eco viejo. */
function fundirMeet(st, entrante) {
  const ahora = Date.now();
  const locales = new Map(st.atletas().map(a => [a.id, a]));
  const protegido = aid => { const ts = st.tocados.get(aid); return ts === Infinity || (ts && ahora - ts < PROTEGIDO_MS); };
  const lista = (entrante.atletas || []).filter(a => a && !a.eliminado && a.intentos).map(a => (protegido(a.id) && locales.has(a.id) ? locales.get(a.id) : a));
  for (const [aid, a] of locales) if (protegido(aid) && !lista.some(x => x.id === aid)) lista.push(a);   // creado aquí y aún sin eco
  const { vivo, ...resto } = entrante;
  st.meet = { ...st.meet, ...resto, atletas: lista, privado: entrante.privado || st.meet.privado };
}

function montarMarco(ctx, meet) {
  const st = crearEstado(ctx, meet);
  st.driver = crearDriver({ escribiendo: e => !!e.target?.matches?.('input, textarea, select'), alVotar: (pos, boton, senal, via) => (st.tab === 'jueces' ? st.alPrueba?.(pos, boton, senal, via) : st.tab === 'mesa' ? st.alVoto?.(pos, boton, senal, via) : undefined) });
  st.driver.iniciar();
  st.registro = crearRegistro(meet.id);              // aprobaciones de jueces: se guardan en este navegador, no en el servidor
  st.canal = abrirCanal(meet.id, { rol: 'mesa' });
  const baja = ctx.app.vincularCanal(st.canal);
  const nube = pildoraNube(meet.id);
  const quitar = [
    st.canal.escucharMeet(m => { if (m && m.id === st.id) { fundirMeet(st, m); st.avisar(); pintarCabecera(); } }),
    st.canal.escucharVivo(v => { st.vivos = v; pintarCabecera(); }),
    st.canal.escucharPresencia(p => { st.presencias = p; st.presOyentes.forEach(fn => fn(p)); }),
  ];

  /* ---- marco visual ---- */
  const cab = el('div.org-cab-meet');
  const cuerpo = el('div.org-pestanas-cuerpo');
  const nav = el('div.org-nav');
  const raiz = el('div.contenedor.org-meet-vista', {}, [cab, nav, cuerpo]);

  function pintarCabecera() {
    const m = st.meet;
    const estado = estadoLocal(m, st.vivos);
    const plat = m.plataformas?.[0] || 'Tarima 1';
    reemplazar(cab, [
      cabecera({
        titulo: m.nombre || t('Meet sin nombre'), atras: { href: '/organizar', texto: t('Todos los meets') },
        sub: undefined,
        acciones: [pildoraEstadoMeet(estado), nube.nodo, enlaceExterno(`/meets/${encodeURIComponent(m.id)}/pantalla?t=${encodeURIComponent(st.filtroPlataforma || plat)}`, t('Pantalla'), 'pantalla'), enlaceExterno(`/meets/${encodeURIComponent(m.id)}`, t('Página pública'), 'ojo')],
      }),
    ]);
  }

  async function mostrar(id, { urlReemplazar = true } = {}) {
    const def = TABS_VISIBLES.find(x => x.id === id) || TABS_VISIBLES[1] || TABS_VISIBLES[0];
    const tabId = def.id;
    st.tab = tabId;
    if (urlReemplazar) history.replaceState({}, '', `/organizar/${encodeURIComponent(st.id)}/${tabId}`);
    barra.poner(tabId);
    document.title = `${t(def.texto)} · ${st.meet.nombre} · OpenMeets`;
    for (const [k, p] of Object.entries(st.panes)) { const visible = k === tabId; p.caja.hidden = !visible; if (!visible && p.vista?.alDesactivar) p.vista.alDesactivar(); }
    let p = st.panes[tabId];
    if (!p) {
      const caja = el('section.org-pane', { id: `pane-${tabId}`, 'aria-label': t(def.texto) }, esqueletoLista(2));
      p = st.panes[tabId] = { caja, vista: null };
      cuerpo.append(caja);
      try {
        const mod = await def.carga();
        p.vista = await mod.montar(st);
        reemplazar(caja, p.vista.nodo);
      } catch (e) {
        console.error('[openmeets] pestaña', tabId, e);
        delete st.panes[tabId]; caja.remove();
        const c = el('section.org-pane', {}, errorEstado({ titulo: t('No se pudo abrir esta pestaña'), texto: e.message, reintentar: () => { c.remove(); mostrar(tabId, { urlReemplazar: false }); } }));
        cuerpo.append(c);
        return;
      }
    }
    p.caja.hidden = st.tab !== tabId;
    if (st.tab === tabId) p.vista?.alActivar?.();
  }
  st.mostrar = mostrar;

  const barra = pestanas({ items: TABS_VISIBLES.map(x => ({ id: x.id, texto: t(x.texto) })), activa: 'atletas', etiqueta: t('Secciones del meet'), onChange: id => mostrar(id) });
  nav.append(barra);
  pintarCabecera();
  reemplazar(ctx.raiz, raiz);

  const limpiar = () => {
    clearTimeout(st.reintento);
    quitar.forEach(f => f());
    for (const p of Object.values(st.panes)) { try { p.vista?.salir?.(); } catch (e) { console.warn('[openmeets] salir', e); } }
    try { st.driver.detener(); } catch { /* ya detenido */ }
    baja?.();
    nube.parar();
    st.canal.cerrar();
  };
  return { st, limpiar, mostrar };
}

export default async function (ctx) {
  await cargarCss(ctx);
  const id = ctx.params.id;
  let limpieza = null;
  ctx.app.titulo(t('Organizar'));

  const cargar = async () => {
    reemplazar(ctx.raiz, el('div.contenedor', {}, esqueletoLista(3)));
    const info = ctx.app.info() || (await ctx.app.recargarInfo().catch(() => null));
    const rolEq = await cargarRol();
    if (info && !info.organizador && !esRolDeEquipo(rolEq)) { reemplazar(ctx.raiz, pantallaPin(ctx, cargar)); return; }
    if (esRolDeEquipo(rolEq) && rolEq.meetId !== id) { location.href = '/'; return; }
    TABS_VISIBLES = esRolDeEquipo(rolEq) ? TABS.filter(x => (TABS_DE_ROL[rolEq.rol] || []).includes(x.id)) : info?.cuentas ? TABS.filter(x => x.id !== 'equipo') : TABS; // en la nube no hay roles de equipo
    let meet;
    try { meet = await api.meet(id); } catch (e) {
      if (e.sinPermiso) { reemplazar(ctx.raiz, pantallaPin(ctx, cargar)); return; }
      reemplazar(ctx.raiz, el('div.contenedor', {}, e.estado === 404
        ? vacio({ icono: 'calendario', titulo: t('No encuentro este meet'), texto: t('Puede que lo hayas borrado o que el enlace esté mal escrito.'), accion: { texto: t('Ver todos mis meets'), icono: 'flecha-izq', href: '/organizar' } })
        : errorEstado({ titulo: t('No se pudo abrir el meet'), texto: e.message, pasos: [t('Comprueba que OpenMeets sigue abierto en el equipo de la mesa.')], reintentar: cargar })));
      return;
    }
    if (info?.cuentas && !meet.mio) {
      reemplazar(ctx.raiz, el('div.contenedor', {}, vacio({ icono: 'candado', titulo: t('Esta competencia es de otra cuenta'), texto: t('Solo la cuenta que la creó puede dirigirla. Puedes seguirla desde su página pública.'), accion: { texto: t('Ver la página pública'), icono: 'flecha-der', href: `/meets/${encodeURIComponent(id)}` } })));
      return;
    }
    meet.atletas = (meet.atletas || []).filter(a => a && a.intentos);
    const m = montarMarco(ctx, meet);
    limpieza = m.limpiar;
    const pedida = ctx.params.pestana;
    await m.mostrar(TABS_VISIBLES.some(x => x.id === pedida) ? pedida : (meet.atletas.length ? 'mesa' : 'atletas'), { urlReemplazar: !TABS_VISIBLES.some(x => x.id === pedida) });
  };
  await cargar();
  return () => { limpieza?.(); limpieza = null; };
}
