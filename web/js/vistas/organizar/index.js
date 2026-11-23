/* ============================================================
   OPENMEETS — /organizar: todos tus meets
   Lista, crear, duplicar, exportar, importar y borrar (a la papelera, con Deshacer).
   Desde otro equipo pide el PIN de organizador.
   ============================================================ */

import { el, reemplazar, clonar, hoy as _hoy, fecha as _fecha } from '../../util.js';
import { t } from '../../i18n.js';
import { api, pedir } from '../../api.js';
import { boton, campo, select, segmentado, interruptor, modal, confirmar, toast, vacio, errorEstado, esqueletoLista, pildora, pildoraEstadoMeet, menuContextual, icono } from '../../ui.js';
import { rangoFechas } from '../../util.js';
import { FEDERACIONES } from '../../nucleo/federaciones.js';
import { cabecera, cargarCss, pantallaPin, descargar, leerArchivo, avisoError } from './comun.js';
import { hoyISO } from './logica.js';

const FORMULAS = [{ valor: 'GL', texto: 'GL (IPF)' }, { valor: 'DOTS', texto: 'DOTS' }, { valor: 'Wilks', texto: 'Wilks' }];
const modoDeFed = f => (f === 'IPF' || f === 'FCLP' ? 'IPF' : 'otra');

/* ---------- Crear ---------- */

function dialogoCrear(ctx) {
  const nombre = campo({ etiqueta: t('Nombre del meet'), placeholder: t('Copa de Fuerza 2027'), requerido: true });
  const fecha = campo({ etiqueta: t('Fecha'), tipo: 'date', valor: hoyISO() });
  const fechaFin = campo({ etiqueta: t('Hasta (si dura más de un día)'), tipo: 'date' });
  const sede = campo({ etiqueta: t('Sede'), placeholder: t('Coliseo municipal') });
  const ciudad = campo({ etiqueta: t('Ciudad') });
  const pais = campo({ etiqueta: t('País') });
  const fed = select({ etiqueta: t('Federación o categorías'), opciones: FEDERACIONES, valor: 'IPF', ayuda: t('Define las clases de peso y las divisiones de edad. Elige «Local» si no sigues un reglamento.') });
  let modoElegido = false;
  const modo = segmentado({ etiqueta: t('Modo de jueces'), opciones: [{ valor: 'IPF', texto: t('IPF (tarjetas)') }, { valor: 'otra', texto: t('Otra') }], valor: 'IPF', onChange: () => { modoElegido = true; } });
  fed.entrada.addEventListener('change', () => { if (!modoElegido) modo.poner(modoDeFed(fed.valor())); });
  const formula = select({ etiqueta: t('Fórmula de puntos'), opciones: FORMULAS, valor: 'GL' });
  const plataformas = campo({ etiqueta: t('Plataformas (separadas por coma)'), valor: 'Tarima 1', ayuda: t('Una por cada tarima donde se levanta a la vez.') });
  const publico = interruptor({ etiqueta: t('Visible para el público'), ayuda: t('Si lo apagas, solo tú lo ves en esta lista y nadie puede seguirlo.'), valor: true });
  const cuerpo = el('div.formulario', {}, [
    nombre, el('div.formulario-fila', {}, [fecha, fechaFin]), sede, el('div.formulario-fila', {}, [ciudad, pais]),
    el('div.formulario-fila', {}, [fed, formula]), el('div.campo', {}, [el('span.campo-etiqueta', { text: t('Modo de jueces') }), modo]),
    plataformas, publico,
  ]);
  const m = modal({ titulo: t('Nuevo meet'), contenido: cuerpo, acciones: [
    { texto: t('Cancelar'), variante: 'fantasma' },
    { texto: t('Crear meet'), variante: 'primario', icono: 'plus', cerrar: false, onclick: async (e, b) => {
      if (!nombre.valor().trim()) { nombre.ponerError(t('Ponle un nombre al meet.')); nombre.entrada.focus(); return false; }
      if (fechaFin.valor() && fecha.valor() && fechaFin.valor() < fecha.valor()) { fechaFin.ponerError(t('No puede ser antes de la fecha de inicio.')); return false; }
      b.cargando(true);
      try {
        const lista = plataformas.valor().split(',').map(x => x.trim()).filter(Boolean);
        const meet = await api.crearMeet({ nombre: nombre.valor().trim(), fecha: fecha.valor(), fechaFin: fechaFin.valor(), sede: sede.valor().trim(), ciudad: ciudad.valor().trim(), pais: pais.valor().trim(), federacion: fed.valor(), modo: modo.valor(), formula: formula.valor(), plataformas: lista.length ? lista : ['Tarima 1'], publico: publico.valor() });
        m.cerrar();
        toast(t('Meet creado. Siguiente paso: añade a los atletas, a mano o con un CSV.'), { tipo: 'ok', ms: 7000 });
        ctx.app.navegar(`/organizar/${encodeURIComponent(meet.id)}/atletas`);
      } catch (er) { avisoError(er); } finally { b.cargando(false); }
      return false;
    } },
  ] });
  return m;
}

/* ---------- Duplicar, exportar, importar, borrar ---------- */

/** Atleta de una copia: mismos datos y apertura de cada levantamiento, sin resultados. */
const atletaLimpio = a => {
  const x = clonar(a);
  for (const l of ['S', 'B', 'D']) x.intentos[l] = (x.intentos[l] || []).slice(0, 3).map((i, n) => ({ kg: n === 0 ? i.kg ?? null : null, r: null, rec: false, alFinal: false }));
  return x;
};

function dialogoDuplicar(ctx, resumen, recargar) {
  const conAtletas = interruptor({ etiqueta: t('Copiar también a los atletas'), ayuda: t('Se copian sus datos y su apertura, sin resultados.'), valor: true });
  const nombre = campo({ etiqueta: t('Nombre de la copia'), valor: `${resumen.nombre} (${t('copia')})` });
  const m = modal({ titulo: t('Duplicar meet'), contenido: el('div.formulario', {}, [nombre, conAtletas]), acciones: [
    { texto: t('Cancelar'), variante: 'fantasma' },
    { texto: t('Duplicar'), variante: 'primario', icono: 'copiar', cerrar: false, onclick: async (e, b) => {
      b.cargando(true);
      try {
        const o = await api.meet(resumen.id);
        const { id, atletas, vivo, aplausos, actividad, privado, creado, actualizado, estado, ...campos } = o;
        const nuevo = await api.crearMeet({ ...campos, nombre: nombre.valor().trim() || `${o.nombre} (${t('copia')})`, cerrado: false });
        if (conAtletas.valor() && atletas?.length) await api.guardarAtletas(nuevo.id, atletas.map(atletaLimpio));
        m.cerrar();
        toast(t('Copia creada.'), { tipo: 'ok' });
        ctx.app.navegar(`/organizar/${encodeURIComponent(nuevo.id)}/datos`);
      } catch (er) { avisoError(er); } finally { b.cargando(false); }
      return false;
    } },
  ] });
}

async function exportar(resumen) {
  try {
    const copia = await api.exportar(resumen.id);
    descargar(`${resumen.id}.json`, JSON.stringify(copia, null, 1), 'application/json');
    toast(t('Copia guardada en tu carpeta de descargas.'), { tipo: 'ok' });
  } catch (e) { avisoError(e); }
}

async function importarArchivo(archivo, recargar) {
  let copia;
  try { copia = JSON.parse(await leerArchivo(archivo)); } catch { toast(t('Ese archivo no es una copia de OpenMeets.'), { tipo: 'error' }); return; }
  const nombre = copia?.meet?.nombre || copia?.nombre || t('el meet');
  try { await api.importar(copia); } catch (e) {
    if (e.estado !== 409) { avisoError(e); return; }
    if (!(await confirmar({ titulo: t('Ya existe un meet con ese identificador'), texto: t('¿Quieres reemplazarlo con la copia? Lo que hay ahora queda en un archivo de respaldo.'), confirmar: t('Reemplazar'), peligro: true }))) return;
    try { await pedir('POST', '/api/meets/importar?reemplazar=1', copia); } catch (e2) { avisoError(e2); return; }
  }
  toast(t('«{nombre}» importado.', { nombre }), { tipo: 'ok' });
  recargar();
}

async function borrar(resumen, recargar) {
  if (resumen.estado === 'en-vivo' && !(await confirmar({ titulo: t('Este meet está en vivo'), texto: t('Si lo borras, la pantalla y los jueces se quedan sin datos. ¿Seguro?'), confirmar: t('Borrar igual'), peligro: true }))) return;
  let copia;
  try { copia = await api.exportar(resumen.id); } catch (e) { avisoError(e); return; }
  try { await api.borrarMeet(resumen.id); } catch (e) { avisoError(e); return; }
  recargar();
  toast(t('«{nombre}» se movió a la papelera.', { nombre: resumen.nombre }), { deshacer: async () => { await api.importar(copia); recargar(); toast(t('Meet recuperado.'), { tipo: 'ok' }); } });
}

/* ---------- Tarjeta y lista ---------- */

function tarjetaOrg(ctx, m, recargar) {
  const lugar = [m.ciudad, m.pais].filter(Boolean).join(', ');
  const base = `/organizar/${encodeURIComponent(m.id)}`;
  const menu = boton({ icono: 'mas', variante: 'fantasma', etiqueta: t('Más acciones de {nombre}', { nombre: m.nombre }), onclick: e => menuContextual(e.currentTarget, [
    { texto: t('Duplicar'), icono: 'copiar', onclick: () => dialogoDuplicar(ctx, m, recargar) },
    { texto: t('Exportar copia (.json)'), icono: 'descargar', onclick: () => exportar(m) },
    { texto: t('Ver como público'), icono: 'ojo', onclick: () => window.open(`/meets/${encodeURIComponent(m.id)}`, '_blank', 'noopener') },
    { separador: true },
    { texto: t('Borrar'), icono: 'papelera', peligro: true, onclick: () => borrar(m, recargar) },
  ]) });
  return el('article.tarjeta.org-meet', {}, [
    el('div.tarjeta-meet-cab', {}, [pildoraEstadoMeet(m.estado), el('div.fila-juntos', {}, [m.publico === false ? pildora({ texto: t('Privado'), icono: 'candado' }) : null, m.federacion ? el('span.tarjeta-meet-fed', { text: m.federacion }) : null])]),
    el('h2.tarjeta-titulo', {}, [el('a.org-meet-enlace', { href: `${base}/${m.estado === 'en-vivo' ? 'mesa' : 'atletas'}`, text: m.nombre || t('Meet sin nombre') })]),
    el('p.tarjeta-texto', { text: [m.fecha ? rangoFechas(m.fecha, m.fechaFin) : t('Sin fecha'), lugar].filter(Boolean).join(' · ') }),
    el('p.org-meet-datos.datos', { text: `${m.atletas} ${m.atletas === 1 ? t('atleta') : t('atletas')} · ${(m.plataformas || []).length || 1} ${(m.plataformas || []).length > 1 ? t('plataformas') : t('plataforma')}` }),
    el('div.org-meet-acciones', {}, [
      boton({ texto: t('Mesa'), icono: 'luces', variante: m.estado === 'en-vivo' ? 'primario' : 'secundario', tam: 'chico', href: `${base}/mesa` }),
      boton({ texto: t('Atletas'), icono: 'usuarios', variante: 'secundario', tam: 'chico', href: `${base}/atletas` }),
      boton({ texto: t('Datos'), icono: 'ajustes', variante: 'fantasma', tam: 'chico', href: `${base}/datos` }),
      el('span.crece'), menu,
    ]),
  ]);
}

async function pintarLista(ctx, raiz) {
  const filtro = { valor: 'todos' };
  const cuerpo = el('div.apilar');
  const recargar = () => cargar();
  const importar = el('input', { type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': t('Elegir copia .json'), onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) importarArchivo(f, recargar); } });
  reemplazar(raiz, el('div.contenedor', {}, [
    cabecera({ titulo: t('Organizar'), sub: t('Crea el meet, carga a los atletas, dirige la tarima y publica los resultados.'), acciones: [
      boton({ texto: t('Importar copia'), icono: 'subir', variante: 'secundario', onclick: () => importar.click() }),
      boton({ texto: t('Nuevo meet'), icono: 'plus', variante: 'primario', onclick: () => dialogoCrear(ctx) }),
      importar,
    ] }),
    cuerpo,
  ]));
  async function cargar() {
    reemplazar(cuerpo, esqueletoLista(3));
    let lista;
    try { lista = await api.meets({ todas: true }); } catch (e) {
      if (e.sinPermiso) { reemplazar(raiz, pantallaPin(ctx, () => pintarLista(ctx, raiz))); return; }
      reemplazar(cuerpo, errorEstado({ titulo: t('No se pudo cargar tus meets'), texto: e.message, pasos: [t('Comprueba que OpenMeets sigue abierto en el equipo de la mesa.'), t('Si estás en otro equipo, que sea la misma Wi-Fi.')], reintentar: cargar }));
      return;
    }
    if (!lista.length) {
      reemplazar(cuerpo, vacio({ icono: 'trofeo', titulo: t('Aún no tienes ningún meet'), texto: t('Crea el primero en un minuto: nombre, fecha y plataformas. Luego importas a los atletas desde un CSV.'), accion: { texto: t('Crear mi primer meet'), icono: 'plus', onclick: () => dialogoCrear(ctx) }, acciones: [{ texto: t('Importar una copia'), icono: 'subir', onclick: () => importar.click() }] }));
      return;
    }
    const pintar = () => {
      const visibles = lista.filter(m => filtro.valor === 'todos' || m.estado === filtro.valor);
      const filtros = lista.length > 3 ? segmentado({ etiqueta: t('Filtrar por estado'), valor: filtro.valor, opciones: [{ valor: 'todos', texto: t('Todos') }, { valor: 'en-vivo', texto: t('En vivo') }, { valor: 'programada', texto: t('Programados') }, { valor: 'terminada', texto: t('Terminados') }], onChange: v => { filtro.valor = v; pintar(); } }) : null;
      reemplazar(cuerpo, [filtros, visibles.length ? el('div.rejilla', {}, visibles.map(m => tarjetaOrg(ctx, m, recargar))) : vacio({ icono: 'calendario', titulo: t('Ningún meet con ese estado'), accion: { texto: t('Ver todos'), onclick: () => { filtro.valor = 'todos'; pintar(); } } })]);
    };
    pintar();
  }
  await cargar();
}

export default async function (ctx) {
  await cargarCss(ctx);
  ctx.app.titulo(t('Organizar'));
  const info = ctx.app.info() || (await ctx.app.recargarInfo().catch(() => null));
  const raiz = el('div');
  ctx.raiz.append(raiz);
  if (info && !info.organizador) { reemplazar(raiz, pantallaPin(ctx, () => pintarLista(ctx, raiz))); return; }
  await pintarLista(ctx, raiz);
}
