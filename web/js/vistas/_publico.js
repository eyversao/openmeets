/* ============================================================
   OPENMEETS — Piezas compartidas de las vistas públicas (inicio, meet, seguir)
   Arriba, lógica pura (se prueba en Node); abajo, el panel «En vivo» que usan
   la página del meet y el seguimiento de LiftingCast.
   ============================================================ */

import { el, hace, hora, numero, kg as kgTxt, puntos as fmtPuntos, plural } from '../util.js';
import { t } from '../i18n.js';
import * as C from '../nucleo/competencia.js';
import * as L from '../nucleo/luces-estado.js';
import { pildora, anillo, boton } from '../ui.js';

/* ---------- Lógica pura ---------- */

export const hoyISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Mismo criterio que el servidor: cerrado o fecha pasada = terminada; con atleta en tarima = en vivo. */
export function estadoDe(m, hoy = hoyISO()) {
  if (m.cerrado) return 'terminada';
  if (Object.values(m.vivo || {}).some(v => v && v.actual)) return 'en-vivo';
  const fin = m.fechaFin || m.fecha;
  return fin && String(fin) < hoy ? 'terminada' : 'programada';
}

const coincide = (m, q) => !q || [m.nombre, m.ciudad, m.pais, m.federacion].some(x => C.normalizarNombre(x).includes(C.normalizarNombre(q)));

/** Reparte el listado en { vivo, proximas, historial } con búsqueda y filtros por año y federación. */
export function agruparMeets(lista = [], { busqueda = '', anio = '', federacion = '', pais = '', ciudad = '' } = {}) {
  const ok = lista.filter(m => coincide(m, busqueda.trim()) && (!anio || String(m.fecha || '').slice(0, 4) === anio) && (!federacion || m.federacion === federacion) && (!pais || m.pais === pais) && (!ciudad || m.ciudad === ciudad));
  const desc = (a, b) => String(b.fecha).localeCompare(String(a.fecha));
  return {
    vivo: ok.filter(m => m.estado === 'en-vivo').sort(desc),
    proximas: ok.filter(m => m.estado === 'programada').sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))),
    historial: ok.filter(m => m.estado === 'terminada').sort(desc),
  };
}

/** Años, federaciones, países y ciudades presentes en el listado, para los filtros (las ciudades, del país elegido si hay uno). */
export function opcionesFiltro(lista = [], pais = '') {
  const anios = [...new Set(lista.map(m => String(m.fecha || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const federaciones = [...new Set(lista.map(m => m.federacion).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  const unicos = campo => [...new Set(lista.filter(m => campo !== 'ciudad' || !pais || m.pais === pais).map(m => m[campo]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  return { anios, federaciones, paises: unicos('pais'), ciudades: unicos('ciudad') };
}

/** Intentos con peso declarado y sin resultado en el grupo que levanta: { faltan, total, grupo }. */
export function progresoGrupo(atletas = [], plataforma, v) {
  if (!v?.lev) return null;
  const lista = C.delGrupo(atletas, { plataforma, sesion: v.sesion, grupo: v.grupo }).filter(a => (a.levantes || C.ORDEN_LEV).includes(v.lev));
  let faltan = 0, total = 0;
  for (const a of lista) for (const i of (a.intentos?.[v.lev] || []).slice(0, 3)) if (Number(i?.kg) > 0) { total++; if (i.r !== 1 && i.r !== -1) faltan++; }
  return total ? { faltan, total, grupo: v.grupo || '' } : null;
}

/** Atletas agrupados por plataforma, sesión y grupo, en el orden en que compiten. */
export function gruposDeAtletas(atletas = [], plataformas = []) {
  const por = new Map();
  for (const a of atletas) {
    const k = `${a.plataforma || ''}|${a.sesion || ''}|${a.grupo || ''}`;
    if (!por.has(k)) por.set(k, { plataforma: a.plataforma || '', sesion: a.sesion || '', grupo: a.grupo || '', atletas: [] });
    por.get(k).atletas.push(a);
  }
  const pos = p => { const i = plataformas.indexOf(p); return i < 0 ? 99 : i; };
  return [...por.values()]
    .sort((x, y) => pos(x.plataforma) - pos(y.plataforma) || x.plataforma.localeCompare(y.plataforma) || String(x.sesion).localeCompare(String(y.sesion), 'es', { numeric: true }) || String(x.grupo).localeCompare(String(y.grupo)))
    .map(g => ({ ...g, atletas: g.atletas.sort((a, b) => (Number(a.lote) || 9999) - (Number(b.lote) || 9999) || a.nombre.localeCompare(b.nombre, 'es')) }));
}

/** Mejores de cada sexo por puntos de la fórmula del meet: { F: [{a, valor}], M: [...] }. */
export function mejoresPorSexo(atletas = [], formula = 'GL', n = 3) {
  const todos = C.mejoresPorFormula(atletas, formula);
  return { F: todos.filter(x => x.a.sexo === 'F').slice(0, n), M: todos.filter(x => x.a.sexo !== 'F').slice(0, n) };
}

/** Marca personal de cada atleta con los meets anteriores: Map(aid → marca). Solo meets de fecha anterior. */
export function marcasDeAtletas(atletas = [], historial = [], fecha = '') {
  const previos = historial.filter(h => !fecha || !h.fecha || String(h.fecha) < String(fecha));
  const mapa = new Map();
  for (const a of atletas) { const m = C.marcaPersonal(a.nombre, previos); if (m) mapa.set(a.id, m); }
  return mapa;
}

/** Qué marcas supera hoy un atleta frente a su marca personal: { S, B, D, total } de booleanos. */
export function marcasSuperadas(a, marca) {
  return { S: C.superaMarca(marca, 'S', C.mejor(a, 'S')), B: C.superaMarca(marca, 'B', C.mejor(a, 'B')), D: C.superaMarca(marca, 'D', C.mejor(a, 'D')), total: C.superaMarca(marca, 'total', C.total(a)) };
}

/** Récords del meet por atleta: Map(aid → { S, B, D, total }) con los levantamientos en que tiene el récord de su categoría. */
export function recordsPorAtleta(atletas = []) {
  const mapa = new Map();
  for (const r of C.recordsDelMeet(atletas)) for (const k of ['S', 'B', 'D', 'total']) if (r[k]) { const x = mapa.get(r[k].aid) || {}; x[k] = true; mapa.set(r[k].aid, x); }
  return mapa;
}

/* ---------- Panel «En vivo» (una plataforma) ---------- */

const NOMBRE_LEV = { S: 'Sentadilla', B: 'Press banca', D: 'Peso muerto' };
const LEV_LC = { sq: 'S', bp: 'B', dl: 'D' };
const POS = ['izq', 'cen', 'der'];

/** Lo que el panel necesita, a partir del vivo de un meet de OpenMeets. */
export function vistaVivoOM(plataforma, v, atletas = [], marcas = new Map()) {
  const est = L.estadoLuces(v);
  const a = (est.revelado && v?.juzgado) || v?.actual; // en el revelado, quien se juzgó
  const lev = v?.lev || null;
  const atl = a?.aid ? atletas.find(x => x.id === a.aid) : null;
  return {
    plataforma, lev, sesion: v?.sesion, grupo: v?.grupo, est, lucesTs: v?.lucesTs || 0,
    actual: a ? { nombre: a.nombre, kg: a.kg, n: Number(a.n) || 0, rec: C.recValido(a.rec), recEtiqueta: C.etiquetaRecord(a.rec, a.recTexto), mp: !!(lev && atl && C.superaMarca(marcas.get(atl.id), lev, a.kg)) } : null,
    siguientes: (v?.siguientes || []).slice(0, 4).map(s => ({ nombre: s.nombre, kg: s.kg })),
    progreso: progresoGrupo(atletas, plataforma, v),
  };
}

/** Lo mismo a partir de un elemento `enTarima` del resumen de LiftingCast. */
export function vistaVivoLC(e, siguientes = []) {
  const l = e.luces || { votados: {}, revelado: false, tarjetas: { izq: [], cen: [], der: [] } };
  const rojas = POS.filter(p => l[p] === 'roja').length;
  const est = { votados: l.votados || {}, revelado: !!l.revelado, luces: { izq: l.izq || null, cen: l.cen || null, der: l.der || null }, tarjetas: l.tarjetas || { izq: [], cen: [], der: [] }, resultado: l.revelado ? (rojas >= 2 ? -1 : 1) : null, rec: null };
  const i = e.intento;
  return {
    plataforma: e.plataforma, lev: i ? LEV_LC[i.lev] || null : null, est, lucesTs: 0,
    actual: i ? { nombre: i.nombre, kg: i.kg, n: Math.max(0, (Number(i.n) || 1) - 1), rec: false, mp: false } : null,
    siguientes: siguientes.slice(0, 4).map(nombre => ({ nombre })), progreso: null,
  };
}

/** Las tres luces de los jueces (pre-marcado, revelado y tarjetas) con los estilos de luces.css. */
export function bloqueLuces(est, lev) {
  const aria = est.revelado ? (est.resultado === 1 ? t('Intento válido') : t('Intento nulo')) : t('Esperando la decisión');
  return el('div.ev-luces.grandes', { role: 'status', 'aria-label': aria }, C.POSICIONES.map(([p, nombre]) => {
    const luz = est.luces[p];
    const clase = [luz || '', !luz && est.votados[p] ? 'votado' : '', est.revelado ? 'revela' : ''].filter(Boolean).join(' ');
    return el('div.ev-luzcol', {}, [
      el('div.ev-luz', { class: clase, title: t(nombre) }),
      el('div.ev-tarjetas', {}, est.tarjetas[p].map(c => el('i.ev-tarjeta', { class: c, title: C.TARJETAS[c]?.[lev] || c }))),
    ]);
  }));
}

const ordinal = n => t('{n}.º intento', { n: n + 1 });

/**
 * Panel de una plataforma. `celebrados` (Set) evita repetir el brillo en cada repintado:
 * solo la primera vez que se ve un resultado válido (con más brillo si es récord o marca personal).
 */
export function panelEnVivo(vista, { celebrados = new Set() } = {}) {
  const { plataforma, lev, actual, est, siguientes, progreso } = vista;
  const res = L.textoResultado(est);
  const clave = `${plataforma}|${vista.lucesTs}|${actual?.nombre}|${actual?.n}`;
  const celebra = !!(res && est.resultado === 1 && !celebrados.has(clave));
  if (celebra) {
    celebrados.add(clave);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(40);
  }
  const especial = celebra && (est.rec === true || actual?.mp);
  const detalleLev = [lev ? t(NOMBRE_LEV[lev]) : '', vista.sesion ? t('Sesión {s}', { s: vista.sesion }) : '', vista.grupo ? t('Grupo {g}', { g: vista.grupo }) : ''].filter(Boolean).join(' · ');

  return el(`section.pub-tarima${celebra ? '.celebra' : ''}${especial ? '.celebra-fuerte' : ''}`, { 'aria-label': plataforma }, [
    el('header.pub-tarima-cab', {}, [el('h3', { text: plataforma }), detalleLev ? el('span.pub-tarima-lev', { text: detalleLev }) : null]),
    actual ? el('div.pub-actual', {}, [
      el('div.pub-actual-datos', {}, [
        el('p.etiqueta', { text: t('En tarima') }),
        el('p.pub-actual-nombre', { text: actual.nombre }),
        el('p.pub-actual-kg.datos', {}, [`${numero(actual.kg, { max: 2 })} kg`, el('small', { text: ` · ${ordinal(actual.n)}` })]),
        el('div.pub-insignias', {}, [
          actual.rec ? pildora({ texto: actual.rec === 'otro' ? actual.recEtiqueta : t(actual.recEtiqueta), tono: 'mal' }) : null,
          actual.mp ? pildora({ texto: t('Intento de marca personal'), tono: 'senal', icono: 'trofeo' }) : null,
        ]),
      ]),
      el('div.pub-luces', {}, [
        bloqueLuces(est, lev),
        res ? el('div.ev-resultado', { class: `${res.clase}${est.rec === true ? ' rec' : ''}` }, [el('b', { text: t(res.clase === 'valido' ? 'Válido' : 'Nulo') }), est.rec === true ? el('span.rec', { text: t('Récord') }) : null]) : null,
      ]),
    ]) : el('p.suave.pub-sin-atleta', { text: t('No hay nadie en la tarima ahora mismo.') }),
    siguientes.length ? el('div.pub-siguen', {}, [
      el('p.etiqueta', { text: t('Siguen') }),
      el('ol.pub-siguen-lista', {}, siguientes.map(s => el('li', {}, [el('span.truncar', { text: s.nombre }), s.kg ? el('b.datos', { text: `${numero(s.kg, { max: 2 })} kg` }) : null]))),
    ]) : null,
    progreso ? fraseProgreso(progreso) : null,
  ]);
}

/** «Faltan 14 intentos en el Grupo B» con una barra del avance del grupo. */
export function fraseProgreso({ faltan, total, grupo }) {
  const hechos = total - faltan;
  const texto = faltan === 0
    ? (grupo ? t('El Grupo {g} terminó este levantamiento.', { g: grupo }) : t('Este grupo terminó el levantamiento.'))
    : (grupo ? t(faltan === 1 ? 'Falta 1 intento en el Grupo {g}' : 'Faltan {n} intentos en el Grupo {g}', { n: faltan, g: grupo }) : t(faltan === 1 ? 'Falta 1 intento' : 'Faltan {n} intentos', { n: faltan }));
  return el('div.pub-progreso', {}, [
    el('p.pequeno', { text: texto }),
    el('div.pub-barra', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': hechos, 'aria-label': texto }, [el('span', { style: { width: `${Math.round((hechos / total) * 100)}%` } })]),
  ]);
}

/** «Última actualización: 14:05 (hace 3 min)». */
export const textoActualizado = ms => (ms ? t('Última actualización: {h} ({hace})', { h: hora(ms), hace: hace(ms) }) : '');


/* ---------- Pico y final: tarjeta final del atleta y resumen del meet terminado ---------- */

const NOMBRE_REC = { S: 'sentadilla', B: 'press banca', D: 'peso muerto', total: 'total' };
const sistemaTxt = f => (f === 'IPF' ? 'GL' : f);

/** Total, puntos y chips (puesto, marca personal, récords) de un atleta que ya terminó. */
export function resumenFinalAtleta(a, { atletas = [], formula = 'GL', marca = null } = {}) {
  const f = C.tarjetaFinal(a, atletas, formula);
  const mp = !!marca && marcasSuperadas(a, marca).total;
  const recs = Object.keys(f.records).map(k => t(NOMBRE_REC[k]));
  return el('div.fin-resumen', {}, [
    f.total
      ? el('p.fin-total.datos', {}, [kgTxt(f.total), el('small', { text: ` · ${fmtPuntos(f.puntos)} ${sistemaTxt(formula)}` })])
      : el('p.fin-total.suave', { text: t('Terminó sin total válido') }),
    el('div.fin-chips', {}, [
      f.puesto ? pildora({ texto: t('{n}.º de {m} en {cat}', { n: f.puesto, m: f.de, cat: f.categoria }), tono: f.puesto === 1 ? 'senal' : 'neutro' }) : null,
      mp ? pildora({ texto: t('Marca personal'), tono: 'senal', icono: 'trofeo' }) : null,
      recs.length ? pildora({ texto: t('Récord del meet: {l}', { l: recs.join(', ') }), tono: 'senal' }) : null,
    ]),
  ]);
}

/** Anillo completo (con su animación corta si `nueva`) + total y puesto: la tarjeta final de un atleta. */
export function tarjetaFinalAtleta(a, o = {}) {
  const ring = anillo(a, { tam: 64 });
  ring.classList.add('completa');
  return el(`article.fin-tarjeta${o.nueva ? '.nueva' : ''}`, { 'aria-label': t('Tarjeta final de {nombre}', { nombre: a.nombre }) }, [
    ring,
    el('div.fin-datos', {}, [
      el('p.etiqueta', { text: t('Terminó sus 9 intentos') }),
      el('b.fin-nombre', { text: a.nombre }),
      resumenFinalAtleta(a, o),
    ]),
  ]);
}

/** Lo que queda del meet al terminar: cifras, podio por categoría (top 3), mejor levantador por sexo, equipo ganador y CSV. */
export function resumenMeetPublico(r, { formula = 'GL', urlCsv = '' } = {}) {
  const sis = sistemaTxt(formula);
  const mejor = (titulo, x) => x ? el('li.fin-mejor', {}, [el('small.suave', { text: titulo }), el('b', {}, [el('span.resaltado', { text: x.a.nombre })]), el('span.datos', { text: `${fmtPuntos(x.valor)} ${sis} · ${kgTxt(C.total(x.a))}` })]) : null;
  return el('section.pub-final', { 'aria-label': t('Resumen del meet') }, [
    el('p.etiqueta', { text: t('Meet terminado') }),
    el('h2.titular.pub-final-titulo', { text: t('Así terminó el meet') }),
    el('p.pub-final-cifras.datos', { text: [plural(r.atletas, 'atleta', 'atletas'), plural(r.intentos, 'intento', 'intentos'), `${r.pct} % ${t('válidos')}`, plural(r.records, 'récord', 'récords')].join(' · ') }),
    (r.mejores.F || r.mejores.M || r.equipo) ? el('ul.fin-mejores', {}, [
      mejor(t('Mejor levantadora'), r.mejores.F), mejor(t('Mejor levantador'), r.mejores.M),
      r.equipo ? el('li.fin-mejor', {}, [el('small.suave', { text: t('Equipo ganador') }), el('b', { text: r.equipo.club }), el('span.datos', { text: t('{n} puntos', { n: numero(r.equipo.puntos) }) })]) : null,
    ]) : null,
    r.podios.length ? el('div.fin-podios', {}, r.podios.map(g => el('div.fin-podio', {}, [
      el('h3.fin-podio-cat', { text: g.nombre }),
      el('ol', {}, g.filas.map(f => el('li', {}, [el('span.res-puesto.datos', { class: f.puesto === 1 ? 'primero' : '', text: f.puesto }), el('span.truncar', { text: f.a.nombre }), el('b.datos', { text: kgTxt(f.total) })]))),
    ]))) : null,
    urlCsv ? el('div.fila', {}, [boton({ texto: t('Descargar resultados CSV'), icono: 'descargar', variante: 'primario', href: urlCsv, download: '' })]) : null,
  ]);
}
