/* Página pública de un meet: En vivo, Resultados, Atletas, Equipos y Mejor levantador. Todo por el canal en tiempo real. */
import { el, reemplazar, rangoFechas, plural, kg, puntos as fmtPuntos, numero, hoy, hora } from '../util.js';
import { t } from '../i18n.js';
import { abrirCanal } from '../canal.js';
import { abrirImagenRedes } from './tarjeta-render.js';
import { boton, pildoraEstadoMeet, pestanas, vacio, errorEstado, esqueletoLista, celdaIntento, anillo, toast, icono, pildora } from '../ui.js';
import * as C from '../nucleo/competencia.js';
import * as L from '../nucleo/luces-estado.js';
import { sistemaDe, EXPLICA } from '../nucleo/puntajes.js';
import { estadoApertura } from '../nucleo/inscripcion.js';
import { estadoDe, gruposDeAtletas, mejoresPorSexo, marcasDeAtletas, marcasSuperadas, recordsPorAtleta, vistaVivoOM, panelEnVivo, textoActualizado, tarjetaFinalAtleta, resumenFinalAtleta, resumenMeetPublico } from './_publico.js';
import { pildorasRecord, pildorasTotal, cargarRecordsMeet } from './_records.js';
import { slugAuto } from '../nucleo/perfiles.js';

const TABS = ['vivo', 'resultados', 'atletas', 'equipos', 'mejor'];
const ESPERA_APLAUSO = 10000;
const urlWeb = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; } };

export default async function (ctx) {
  const { raiz, params, api, app, consulta } = ctx;
  const id = params.id;
  app.titulo(t('Meet'));
  reemplazar(raiz, el('div.contenedor', {}, esqueletoLista(3)));

  let meet;
  try { meet = await api.meet(id); } catch (e) {
    const noExiste = e.estado === 404;
    reemplazar(raiz, el('div.contenedor', {}, errorEstado({
      titulo: noExiste ? t('No encontramos este meet') : t('No logramos abrir este meet'), texto: noExiste ? e.message : t('Tu teléfono no llegó a OpenMeets. Suele ser la red, no tú.'),
      pasos: noExiste ? [t('Puede que el organizador lo haya ocultado o que el enlace esté mal escrito.')] : [t('Revisa que estés en la misma Wi-Fi que la mesa.'), t('Si sigue igual, pídele al organizador que abra OpenMeets en su equipo.')],
      reintentar: noExiste ? null : () => app.navegar(location.pathname + location.search, { reemplazar: true }),
    })));
    if (noExiste) reemplazar(raiz.querySelector('.estado'), [...raiz.querySelector('.estado').childNodes, el('div.estado-acciones', {}, [boton({ texto: t('Ir al inicio'), icono: 'inicio', variante: 'primario', href: '/' })])]);
    return;
  }

  const s = { meet, tab: TABS.includes(consulta.get('t')) ? consulta.get('t') : 'vivo', historial: [], aplaudidos: {}, ultima: Date.now(), celebrados: new Set(), vistos: null, llegadas: new Map(), animadas: new Set() };
  const canal = abrirCanal(id, { rol: 'publico' });
  const desvincular = app.vincularCanal(canal);
  ctx.alSalir(() => { desvincular(); canal.cerrar(); clearInterval(pulso); clearTimeout(pend); });

  const cab = el('header.cabecera-vista.pub-cab');
  const actualizado = el('p.pequeno.suave.pub-actualizado', { role: 'status' });
  const barra = pestanas({ etiqueta: t('Secciones del meet'), activa: s.tab, onChange: ir, items: [
    { id: 'vivo', texto: t('En vivo') }, { id: 'resultados', texto: t('Resultados') }, { id: 'atletas', texto: t('Atletas') },
    { id: 'equipos', texto: t('Equipos') }, { id: 'mejor', texto: t('Mejor levantador') },
  ] });
  const contenido = el('div.pub-contenido', { id: 'pub-contenido' });
  const zFinal = el('div.pub-final-zona');
  const casco = el('div.contenedor', {}, [cab, zFinal, barra, actualizado, contenido]);
  reemplazar(raiz, casco);

  /* ---- datos derivados ---- */
  const marcas = () => marcasDeAtletas(s.meet.atletas || [], s.historial, s.meet.fecha);
  const formula = () => s.meet.formula || 'GL';
  const estado = () => estadoDe(s.meet, hoy());

  /* ---- cabecera ---- */
  function pintarCabecera() {
    const m = s.meet;
    const lugar = [m.sede, m.ciudad, m.pais].filter(Boolean).join(' · ');
    const stream = urlWeb(m.stream);
    reemplazar(cab, [
      el('div.fila', {}, [pildoraEstadoMeet(estado()), m.federacion ? el('span.tarjeta-meet-fed', { text: m.federacion }) : null]),
      el('h1.titular.pub-titulo', { text: m.nombre }),
      el('p.subtitulo', { text: [rangoFechas(m.fecha, m.fechaFin), lugar].filter(Boolean).join(' · ') }),
      m.descripcion ? el('p.suave.pub-descripcion', { text: m.descripcion }) : null,
      el('div.fila', {}, [
        estadoApertura(m.inscripciones).abierta && estado() !== 'terminada' ? boton({ texto: t('Inscribirme'), icono: 'check', variante: 'primario', href: `/meets/${encodeURIComponent(id)}/inscripcion` }) : null,
        boton({ texto: t('Pantalla'), icono: 'pantalla', variante: 'primario', href: `/meets/${encodeURIComponent(id)}/pantalla` }),
        stream ? boton({ texto: t('Ver la transmisión'), icono: 'enlace', variante: 'secundario', href: stream, target: '_blank', rel: 'noopener noreferrer' }) : null,
        estado() === 'terminada' ? null : boton({ texto: t('Descargar resultados CSV'), icono: 'descargar', variante: 'secundario', href: api.urlResultadosCsv(id), download: '' }),
      ]),
    ]);
  }

  /* ---- pico y final: quién terminó y cómo terminó el meet ---- */
  function seguirTerminados() {
    const ahora = (s.meet.atletas || []).filter(C.atletaTermino).map(a => a.id);
    if (s.vistos) for (const x of ahora) if (!s.vistos.has(x)) s.llegadas.set(x, Date.now());
    s.vistos = new Set(ahora);
  }
  const opcionesFinal = a => ({ atletas: s.meet.atletas || [], formula: formula(), marca: marcas().get(a.id) });
  /** Se anima solo la primera vez que se pinta, y solo si acaba de llegar. */
  const esNueva = a => { const nueva = s.llegadas.has(a.id) && !s.animadas.has(a.id); if (nueva) s.animadas.add(a.id); return nueva; };
  function pintarFinal() {
    const r = C.resumenMeet(s.meet.atletas || [], formula());
    reemplazar(zFinal, estado() === 'terminada' && r.intentos ? resumenMeetPublico(r, { formula: formula(), urlCsv: api.urlResultadosCsv(id) }) : null);
  }
  function ir(tab) {
    s.tab = tab;
    try { history.replaceState({}, '', `${location.pathname}?t=${tab}`); } catch { /* sin historial */ }
    pintarContenido();
  }

  /* ---- pestaña: en vivo ---- */
  function tabVivo() {
    const m = s.meet, mc = marcas();
    const plats = (m.plataformas?.length ? m.plataformas : Object.keys(m.vivo || {}));
    const paneles = plats.map(p => {
      const v = m.vivo?.[p];
      return v?.actual || v?.siguientes?.length ? panelEnVivo(vistaVivoOM(p, v, m.atletas || [], mc), { celebrados: s.celebrados })
        : el('section.pub-tarima', {}, [el('header.pub-tarima-cab', {}, [el('h3', { text: p })]), el('p.suave.pub-sin-atleta', { text: t('No hay nadie en la tarima ahora mismo.') })]);
    });
    if (estado() === 'terminada') return el('div.apilar', {}, [
      vacio({ icono: 'trofeo', titulo: t('Ya no hay nadie en la tarima'), texto: t('El meet terminó. Arriba tienes cómo quedó y aquí los resultados de cada categoría.'), accion: { texto: t('Ver resultados'), icono: 'flecha-der', onclick: () => ir('resultados') } }),
    ]);
    const fin = (m.atletas || []).filter(C.atletaTermino).sort((x, y) => (s.llegadas.get(y.id) || 0) - (s.llegadas.get(x.id) || 0));
    const hayVivo = plats.some(p => m.vivo?.[p]?.actual);
    return el('div.apilar', {}, [
      !hayVivo ? vacio({
        icono: 'reloj', titulo: t('Todavía no hay nadie en la tarima'),
        texto: m.fecha ? t('Este meet es el {f}. Cuando empiece verás aquí al atleta, sus luces y quién sigue. Puedes dejar esta página abierta: se actualiza sola.', { f: rangoFechas(m.fecha, m.fechaFin) }) : t('Cuando empiece verás aquí al atleta, sus luces y quién sigue. Puedes dejar esta página abierta: se actualiza sola.'),
        accion: { texto: t('Ver la lista de atletas'), icono: 'usuarios', onclick: () => ir('atletas') },
      }) : null,
      el('div.rejilla-2', {}, paneles),
      fin.length ? el('section.apilar', { 'aria-label': t('Ya terminaron') }, [
        el('h2.pub-seccion-titulo', {}, [el('span', { text: t('Ya terminaron') }), el('span.pestana-conteo', { text: fin.length })]),
        el('div.rejilla-2', {}, fin.slice(0, 4).map(a => tarjetaFinalAtleta(a, { ...opcionesFinal(a), nueva: esNueva(a) }))),
        fin.length > 4 ? el('p.pequeno.suave', { text: t('Y {n} más en la pestaña Atletas.', { n: fin.length - 4 }) }) : null,
      ]) : null,
    ]);
  }

  /* ---- pestaña: resultados ---- */
  function filaResultado({ a, puesto, total }, mc, rec, formulaMeet) {
    const marca = mc.get(a.id), sup = marca ? marcasSuperadas(a, marca) : {};
    const r = rec.get(a.id) || {};
    const pts = total ? C.puntos(a, formulaMeet) : 0;
    const levs = C.ORDEN_LEV.filter(l => (a.levantes || C.ORDEN_LEV).includes(l));
    return el('li.res-fila', {}, [
      el('div.res-cab', {}, [
        el('span.res-puesto.datos', { class: puesto === 1 ? 'primero' : '', text: puesto ?? '—', 'aria-label': puesto ? t('Puesto {n}', { n: puesto }) : t('Sin puesto') }),
        el('div.res-nombre', {}, [
          el('b', {}, [enlaceAtleta(a)]), sup.total ? el('span.res-mp', { title: t('Marca personal'), 'aria-label': t('Marca personal') }, [icono('trofeo', { tam: 14 }), '★']) : null,
          el('small.suave', { text: [a.club, a.peso ? kg(a.peso) : ''].filter(Boolean).join(' · ') }),
        ]),
        el('div.res-total', {}, [el('b.datos', { text: total ? kg(total) : '—' }), el('small.suave.datos', { text: total ? `${fmtPuntos(pts)} ${formulaMeet === 'IPF' ? 'GL' : formulaMeet}` : '' })]),
      ]),
      total ? boton({ texto: t('Imagen para redes'), icono: 'descargar', variante: 'fantasma', etiqueta: t('Imagen para redes de {nombre}', { nombre: a.nombre }), onclick: () => abrirImagenRedes(s.meet, 'atleta', { aid: a.id }, { nombreBase: a.nombre }) }) : null,
      pildorasTotal(recsDe(a)),
      el('div.res-levs', {}, levs.map(l => el('div.res-lev', {}, [
        el('p.res-lev-nombre', {}, [el('span', { text: t(C.LEVANTES[l]) }), C.mejor(a, l) ? el('b.datos', { text: kg(C.mejor(a, l)) }) : null,
          r[l] ? pildora({ texto: t('Récord'), tono: 'senal' }) : null, ...pildorasRecord(recsDe(a), l), r[l] && (a.intentos?.[l] || []).some(i => i.r === 1 && C.recValido(i.rec)) ? boton({ texto: t('Imagen del récord'), variante: 'fantasma', etiqueta: t('Imagen del récord de {nombre}', { nombre: a.nombre }), onclick: () => abrirImagenRedes(s.meet, 'record', { aid: a.id, lev: l }, { nombreBase: a.nombre }) }) : null, sup[l] ? el('span.res-mp', { 'aria-label': t('Marca personal') }, '★') : null]),
        el('div.res-celdas', {}, [0, 1, 2].map(n => { const i = a.intentos?.[l]?.[n]; return celdaIntento({ kg: i?.kg, r: i?.r ?? null, actual: !!(s.meet.vivo && Object.values(s.meet.vivo).some(v => v?.actual?.aid === a.id && v.lev === l && Number(v.actual.n) === n)) }); })),
      ]))),
    ]);
  }
  function tabResultados() {
    const m = s.meet, grupos = C.clasificacion(m.atletas || []);
    if (!grupos.length) return vacio({ icono: 'trofeo', titulo: t('Aún no hay resultados'), texto: t('Aparecerán aquí en cuanto el organizador cargue a los atletas y empiecen los intentos.') });
    const mc = marcas(), rec = recordsPorAtleta(m.atletas || []), f = formula();
    return el('div.apilar-grande', {}, [
      el('p.pequeno.suave', { text: t('Puntos con la fórmula {f}. Verde: válido · rojo tachado: nulo · gris: por levantar. R: récord del meet · ★: marca personal.', { f: f === 'IPF' ? 'GL' : f }) }),
      ...grupos.map(g => el('section.apilar', { 'aria-label': g.nombre }, [
        el('h2.pub-seccion-titulo', {}, [el('span', { text: g.nombre }), el('span.pestana-conteo', { text: g.filas.length })]),
        g.filas.some(x => x.puesto) ? el('div.fila', {}, boton({ texto: t('Imagen del podio'), icono: 'descargar', variante: 'fantasma', onclick: () => abrirImagenRedes(s.meet, 'podio', { categoria: g.nombre }, { nombreBase: g.nombre }) })) : null,
        el('ol.res-lista', {}, g.filas.map(fila => filaResultado(fila, mc, rec, f))),
      ])),
    ]);
  }

  /* ---- pestaña: atletas ---- */
  function aplauso(a) {
    const n = s.meet.aplausos?.[a.id] || 0;
    const b = boton({
      texto: String(n), icono: 'aplauso', variante: 'secundario', etiqueta: t('Aplaudir a {nombre} ({n})', { nombre: a.nombre, n }), 'data-foco': `ap-${a.id}`,
      onclick: async () => {
        if (Date.now() - (s.aplaudidos[a.id] || 0) < ESPERA_APLAUSO) { toast(t('Ya aplaudiste hace un momento. Espera unos segundos.'), { tipo: 'info' }); return; }
        b.cargando(true);
        try {
          const r = await api.aplaudir(id, a.id);
          s.aplaudidos[a.id] = Date.now();
          s.meet = { ...s.meet, aplausos: { ...(s.meet.aplausos || {}), [a.id]: r?.n ?? n + 1 } };
          pintarContenido();
        } catch (e) {
          if (e.estado === 429) s.aplaudidos[a.id] = Date.now();
          toast(e.message, { tipo: e.estado === 429 ? 'info' : 'error' });
          b.cargando(false);
        }
      },
    });
    b.classList.add('pub-aplauso');
    return b;
  }
  function tabAtletas() {
    const m = s.meet, grupos = gruposDeAtletas(m.atletas || [], m.plataformas || []);
    if (!grupos.length) return vacio({ icono: 'usuarios', titulo: t('Todavía no hay atletas'), texto: t('El organizador publicará la lista antes del meet. Vuelve más tarde: esta página se actualiza sola.'), accion: { texto: t('Volver a En vivo'), icono: 'flecha-der', onclick: () => ir('vivo') } });
    const rec = recordsPorAtleta(m.atletas || []);
    return el('div.apilar-grande', {}, grupos.map(g => el('section.apilar', {}, [
      el('h2.pub-seccion-titulo', {}, [el('span', { text: [g.plataforma, g.sesion ? t('Sesión {s}', { s: g.sesion }) : '', g.grupo ? t('Grupo {g}', { g: g.grupo }) : ''].filter(Boolean).join(' · ') || t('Sin plataforma') }), el('span.pestana-conteo', { text: g.atletas.length })]),
      el('ul.atl-lista', {}, g.atletas.map(a => el('li.atl-fila', {}, [
        (() => { const r = anillo(a, { tam: 48 }); if (C.atletaTermino(a)) { r.classList.add('completa'); if (esNueva(a)) r.classList.add('nueva'); } return r; })(),
        el('div.atl-datos', {}, [
          el('b', {}, [enlaceAtleta(a)]),
          el('small.suave', { text: [a.club, a.division, a.clase ? `${a.clase} kg` : '', a.equipamiento === 'equipado' ? t('Equipado') : ''].filter(Boolean).join(' · ') }),
          C.atletaTermino(a) ? resumenFinalAtleta(a, opcionesFinal(a)) : rec.get(a.id)?.total ? el('span', {}, [pildora({ texto: t('Récord del meet'), tono: 'senal' })]) : null,
        ]),
        aplauso(a),
      ]))),
    ])));
  }

  /* ---- pestaña: equipos ---- */
  function tabEquipos() {
    const eq = C.puntosEquipo(s.meet.atletas || []);
    if (!eq.length) return vacio({ icono: 'usuarios', titulo: t('Aún no hay puntos de equipo'), texto: t('Cuentan los atletas con club y un total válido. Los diez primeros de cada categoría suman 12, 9, 8, 7, 6, 5, 4, 3, 2 y 1 puntos.') });
    return el('div.apilar', {}, [
      el('p.pequeno.suave', { text: t('Los diez primeros de cada categoría suman 12, 9, 8, 7, 6, 5, 4, 3, 2 y 1 puntos para su club.') }),
      el('ol.eq-lista', {}, eq.map((c, i) => el('li.eq-fila', {}, [
        el('details', {}, [
          el('summary', {}, [el('span.res-puesto.datos', { text: i + 1 }), el('b.truncar', { text: c.club }), el('span.suave.pequeno', { text: plural(c.atletas, 'atleta', 'atletas') }), el('b.datos.eq-puntos', { text: numero(c.puntos) })]),
          el('ul.eq-detalle', {}, c.detalle.map(d => el('li', {}, [el('span', { text: `${d.puesto}.º ${d.nombre}` }), el('small.suave', { text: d.categoria }), el('b.datos', { text: `+${d.puntos}` })]))),
        ]),
      ]))),
    ]);
  }

  /* ---- pestaña: mejor levantador ---- */
  function tabMejor() {
    const f = formula(), sis = sistemaDe(f), m = mejoresPorSexo(s.meet.atletas || [], f);
    if (!m.F.length && !m.M.length) return vacio({ icono: 'trofeo', titulo: t('Todavía no hay mejor levantador'), texto: t('Se decide por puntos cuando haya totales válidos.') });
    const bloque = (titulo, filas) => filas.length ? el('section.apilar', {}, [
      el('h2.pub-seccion-titulo', {}, [el('span', { text: titulo })]),
      el('ol.mej-lista', {}, filas.map(({ a, valor }, i) => el('li.mej-fila', { class: i === 0 ? 'primero' : '' }, [
        el('span.res-puesto.datos', { text: i + 1 }),
        el('div.res-nombre', {}, [i === 0 ? el('b', {}, [el('span.resaltado', { text: a.nombre })]) : el('b', { text: a.nombre }), el('small.suave', { text: [a.club, kg(C.total(a))].filter(Boolean).join(' · ') })]),
        el('b.datos', { text: fmtPuntos(valor) }),
      ]))),
    ]) : null;
    return el('div.apilar-grande', {}, [
      el('p.pequeno.suave', { text: `${t('Puntos {f}', { f: sis })}. ${t(EXPLICA[sis] || '')}` }),
      el('div.rejilla-2', {}, [bloque(t('Mujeres'), m.F), bloque(t('Hombres'), m.M)]),
    ]);
  }

  /* ---- pintar ---- */
  const VISTAS = { vivo: tabVivo, resultados: tabResultados, atletas: tabAtletas, equipos: tabEquipos, mejor: tabMejor };
  const textoEstado = () => (canal.estado() === 'sin-red' ? t('Sin conexión. Mostrando lo último, de las {h}. Se reconecta solo.', { h: hora(s.ultima) }) : textoActualizado(s.ultima));
  function pintarContenido() {
    const foco = document.activeElement?.dataset?.foco;
    reemplazar(contenido, VISTAS[s.tab]());
    actualizado.textContent = textoEstado();
    if (foco) contenido.querySelector(`[data-foco="${CSS.escape(foco)}"]`)?.focus({ preventScroll: true });
  }
  function pintarTodo() { app.titulo(s.meet.nombre); seguirTerminados(); pintarCabecera(); pintarFinal(); pintarContenido(); }
  let pend = 0;
  const programar = () => { if (!pend) pend = setTimeout(() => { pend = 0; pintarTodo(); }, 120); };

  canal.escucharMeet(m => { s.meet = m; s.ultima = Date.now(); programar(); refrescarRecords(); });
  canal.alEstado(() => { actualizado.textContent = textoEstado(); });
  // Las luces caducan a los 12 s aunque no llegue nada nuevo: repinta solo si cambian.
  let firma = '';
  const pulso = setInterval(() => {
    const f = Object.values(s.meet.vivo || {}).map(v => L.firmaLuces(L.estadoLuces(v))).join('/') + estado();
    if (f !== firma) { if (firma && s.tab === 'vivo') programar(); firma = f; }
    actualizado.textContent = textoEstado();
  }, 1000);

  /* ---- récords de la tabla que salieron en este meet, y enlace a la ficha de cada atleta ---- */
  function recsDe(a) { return s.recs?.get(a.id); }
  function enlaceAtleta(a) { return slugAuto(a) ? el('a.pub-atleta-enlace', { href: `/atletas/${slugAuto(a)}?m=${encodeURIComponent(id)}&a=${encodeURIComponent(a.id)}`, text: a.nombre }) : a.nombre; }
  function refrescarRecords(espera = 1200) {
    clearTimeout(s.recTimer);
    s.recTimer = setTimeout(async () => {
      try { const m = await cargarRecordsMeet(id), f = JSON.stringify([...m]); if (f !== s.recFirma) { s.recFirma = f; s.recs = m; programar(); } } catch { /* sin la tabla de récords la página funciona igual */ }
    }, espera);
  }
  app.estilos('records');
  ctx.alSalir(() => clearTimeout(s.recTimer));
  pintarTodo();
  refrescarRecords(0);

  // Marcas personales: meets terminados de este servidor, solo lectura y sin bloquear la pantalla.
  api.meets().then(async lista => {
    const previos = lista.filter(x => x.id !== id && x.estado === 'terminada').slice(0, 12);
    const todos = await Promise.allSettled(previos.map(x => api.meet(x.id)));
    s.historial = todos.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
    if (s.historial.length) programar();
  }).catch(() => { /* sin historial no hay marcas personales; no es un error para el público */ });
}
