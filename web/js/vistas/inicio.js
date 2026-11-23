/* Inicio: listado público de meets (en vivo, próximas, historial) con búsqueda y filtros. */
import { el, reemplazar, rebote, hora, rangoFechas, plural } from '../util.js';
import { t } from '../i18n.js';
import { boton, campo, select, tarjetaMeet, esqueletoLista, vacio, errorEstado, icono } from '../ui.js';
import { logotipo, simbolo } from '../marca.js';
import { agruparMeets, opcionesFiltro } from './_publico.js';
import { ins } from '../inscripciones-api.js';

const PERIODO_SONDEO = 20000;

export default async function (ctx) {
  const { raiz, api, app } = ctx;
  app.titulo(t('Inicio'));
  const filtro = { busqueda: '', anio: '', federacion: '', pais: '', ciudad: '' };
  let datos = null, horaDato = 0, fallo = null, firmaOpciones = '';

  const lista = el('div.apilar-grande');
  const controles = el('div.pub-filtros', { hidden: true });
  const org = app.esOrganizador();

  reemplazar(raiz, el('div.contenedor', {}, [
    el('header.cabecera-vista.pub-hero', {}, [
      logotipo({ alto: 40, animar: 'entrada' }),
      el('h1.titular', {}, [t('Mira cada intento '), el('span.resaltado', { text: t('en vivo') })]),
      el('p.subtitulo', { text: t('Resultados, luces de los jueces y marcas al momento, desde tu teléfono y sin cuenta.') }),
      el('div.fila', {}, [
        org ? boton({ texto: t('Crear un meet'), icono: 'plus', variante: 'primario', href: '/organizar' }) : null,
        boton({ texto: t('Seguir en LiftingCast'), icono: 'en-vivo', variante: org ? 'secundario' : 'primario', href: '/seguir' }),
        boton({ texto: t('Atletas'), icono: 'usuarios', variante: 'secundario', href: '/atletas' }),
        boton({ texto: t('Récords'), icono: 'trofeo', variante: 'secundario', href: '/records' }),
      ]),
    ]),
    controles,
    lista,
  ]));

  /* ---- filtros (se recrean solo si cambian los años o federaciones disponibles) ---- */
  function pintarControles() {
    const op = opcionesFiltro(datos || [], filtro.pais);
    const firma = JSON.stringify(op);
    if (firma === firmaOpciones) return;
    firmaOpciones = firma;
    if (filtro.anio && !op.anios.includes(filtro.anio)) filtro.anio = '';
    if (filtro.federacion && !op.federaciones.includes(filtro.federacion)) filtro.federacion = '';
    if (filtro.pais && !op.paises.includes(filtro.pais)) filtro.pais = '';
    if (filtro.ciudad && !op.ciudades.includes(filtro.ciudad)) filtro.ciudad = '';
    const buscar = campo({ etiqueta: t('Buscar'), tipo: 'search', valor: filtro.busqueda, placeholder: t('Nombre, ciudad o federación'), onInput: rebote(v => { filtro.busqueda = v; pintarLista(); }, 150) });
    const anio = select({ etiqueta: t('Año'), valor: filtro.anio, opciones: [{ valor: '', texto: t('Todos') }, ...op.anios.map(a => ({ valor: a, texto: a }))], onChange: v => { filtro.anio = v; pintarLista(); } });
    const fed = select({ etiqueta: t('Federación'), valor: filtro.federacion, opciones: [{ valor: '', texto: t('Todas') }, ...op.federaciones.map(f => ({ valor: f, texto: f }))], onChange: v => { filtro.federacion = v; pintarLista(); } });
    const pais = select({ etiqueta: t('País'), valor: filtro.pais, opciones: [{ valor: '', texto: t('Todos') }, ...op.paises.map(p => ({ valor: p, texto: p }))], onChange: v => { filtro.pais = v; filtro.ciudad = ''; firmaOpciones = ''; pintarControles(); pintarLista(); } });
    const ciudad = select({ etiqueta: t('Ciudad'), valor: filtro.ciudad, opciones: [{ valor: '', texto: t('Todas') }, ...op.ciudades.map(c => ({ valor: c, texto: c }))], onChange: v => { filtro.ciudad = v; pintarLista(); } });
    const foco = document.activeElement?.closest?.('.pub-filtros') && document.activeElement.type === 'search';
    reemplazar(controles, [buscar, op.anios.length > 1 ? anio : null, op.federaciones.length > 1 ? fed : null, op.paises.length > 1 ? pais : null, op.ciudades.length > 1 ? ciudad : null]);
    if (foco) buscar.entrada.focus();
  }

  const seccion = (titulo, meets, { vivo = false } = {}) => meets.length ? el('section.apilar', { 'aria-label': titulo }, [
    el('h2.pub-seccion-titulo', {}, [vivo ? simbolo({ tam: 22, animar: 'vivo' }) : null, el('span', { text: titulo }), el('span.pestana-conteo', { text: meets.length })]),
    el('div.rejilla', {}, meets.map(m => tarjetaMeet({ ...m, fechaTexto: rangoFechas(m.fecha, m.fechaFin) }, {
      hijos: [el('p.tarjeta-meta.suave', {}, [plural(m.atletas || 0, 'atleta', 'atletas'), (m.plataformas?.length || 0) > 1 ? ` · ${plural(m.plataformas.length, 'plataforma', 'plataformas')}` : '']),
        inscAbiertas.has(m.id) ? el('a.boton.boton-primario.boton-chico', { href: `/meets/${encodeURIComponent(m.id)}/inscripcion` }, [icono('check'), el('span.boton-texto', { text: t('Inscribirme') })]) : null],
    }))),
  ]) : null;

  function pintarLista() {
    controles.hidden = !datos?.length;
    if (!datos) {
      reemplazar(lista, fallo
        ? errorEstado({ titulo: t('No logramos traer los meets'), texto: t('Tu teléfono no llegó a OpenMeets. Suele ser la red, no tú.'), detalle: fallo.message, pasos: [t('Revisa que estés en la misma Wi-Fi que la mesa.'), t('Si sigue igual, pídele al organizador que abra OpenMeets en su equipo.')], reintentar: () => cargar() })
        : esqueletoLista(3));
      return;
    }
    const aviso = fallo ? el('div.pub-aviso', { role: 'status' }, [icono('wifi-off'), el('span', { text: t('Sin conexión. Mostrando lo último, de las {h}. Se reintenta solo.', { h: hora(horaDato) }) })]) : null;
    if (!datos.length) {
      reemplazar(lista, [aviso, vacio({
        icono: 'calendario', titulo: t('Aún no hay meets'),
        texto: org ? t('Crea tu primer meet, súbele los atletas y dirígelo desde la mesa.') : t('Cuando el organizador publique un meet, aparecerá aquí con sus resultados en vivo.'),
        accion: org ? { texto: t('Crea tu primer meet'), icono: 'plus', href: '/organizar' } : { texto: t('Seguir un meet de LiftingCast'), icono: 'en-vivo', href: '/seguir' },
      })]);
      return;
    }
    const g = agruparMeets(datos, filtro);
    const hay = g.vivo.length + g.proximas.length + g.historial.length;
    reemplazar(lista, [aviso, hay ? [
      seccion(t('En vivo'), g.vivo, { vivo: true }),
      seccion(t('Próximas'), g.proximas),
      seccion(t('Historial'), g.historial),
    ] : vacio({
      icono: 'buscar', titulo: t('Nada coincide con tu búsqueda'), texto: t('Prueba con otro nombre o quita los filtros.'),
      accion: { texto: t('Quitar filtros'), icono: 'x', onclick: () => { filtro.busqueda = ''; filtro.anio = ''; filtro.federacion = ''; filtro.pais = ''; filtro.ciudad = ''; firmaOpciones = ''; pintarControles(); pintarLista(); } },
    })]);
  }

  let inscAbiertas = new Set();
  async function cargar() {
    const abiertas = ins.abiertas(); // en paralelo con la lista
    try { datos = await api.meets(); horaDato = Date.now(); fallo = null; } catch (e) { fallo = e; }
    inscAbiertas = new Set(await abiertas);
    pintarControles();
    pintarLista();
  }

  pintarLista();
  await cargar();
  const h = setInterval(() => { if (!document.hidden) cargar(); }, PERIODO_SONDEO);
  return () => clearInterval(h);
}
