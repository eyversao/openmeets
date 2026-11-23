/* Ficha de un atleta: meets, mejores marcas, progresión, anillo del último meet y récords que posee. */
import { el, reemplazar, kg, puntos as fmtPuntos, fecha, plural, rebote, numero } from '../util.js';
import { t } from '../i18n.js';
import { pedir } from '../api.js';
import { boton, campo, vacio, errorEstado, esqueletoLista, anillo, pildora, modal, toast, confirmar } from '../ui.js';
import { NOMBRE_LEV_REC } from '../nucleo/records.js';
import { claveApar } from '../nucleo/perfiles.js';
import { textoNivel } from './_records.js';

const LEV_TXT = { S: 'Sentadilla', B: 'Press banca', D: 'Peso muerto', total: 'Total', puntos: 'Puntos' };
const mesAnio = f => (f ? fecha(f, { month: 'short', year: 'numeric' }) : '');

/** Gráfica simple de línea (SVG propio): `serie` = [{ fecha, valor, meet }]. */
export function grafica(serie, { titulo, formato = x => numero(x, { max: 1 }) }) {
  const W = 320, H = 150, L = 46, R = 10, T = 14, B = 28;
  const vals = serie.map(p => p.valor);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
  const ts = serie.map(p => Date.parse(p.fecha));
  const porTiempo = serie.length > 1 && ts.every(Number.isFinite) && ts[ts.length - 1] > ts[0];
  const x = i => (serie.length === 1 ? L + (W - L - R) / 2 : L + (W - L - R) * (porTiempo ? (ts[i] - ts[0]) / (ts[ts.length - 1] - ts[0]) : i / (serie.length - 1)));
  const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const resumen = `${titulo}: ${serie.map(p => `${mesAnio(p.fecha)} ${formato(p.valor)}`).join(', ')}`;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': resumen }, [
    el('line', { class: 'rc-g-eje', x1: L, x2: W - R, y1: y(lo + pad), y2: y(lo + pad) }),
    el('line', { class: 'rc-g-eje', x1: L, x2: W - R, y1: y(hi - pad), y2: y(hi - pad) }),
    el('text', { class: 'rc-g-texto', x: L - 6, y: y(hi - pad) + 4, 'text-anchor': 'end', text: formato(hi - pad) }),
    el('text', { class: 'rc-g-texto', x: L - 6, y: y(lo + pad) + 4, 'text-anchor': 'end', text: formato(lo + pad) }),
    el('text', { class: 'rc-g-texto', x: L, y: H - 8, 'text-anchor': serie.length === 1 ? 'middle' : 'start', ...(serie.length === 1 ? { x: x(0) } : {}), text: mesAnio(serie[0].fecha) }),
    serie.length > 1 ? el('text', { class: 'rc-g-texto', x: W - R, y: H - 8, 'text-anchor': 'end', text: mesAnio(serie[serie.length - 1].fecha) }) : null,
    serie.length > 1 ? el('polyline', { class: 'rc-g-linea', points: serie.map((p, i) => `${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ') }) : null,
    ...serie.map((p, i) => el('circle', { class: `rc-g-punto${i === serie.length - 1 ? ' ultimo' : ''}`, cx: x(i).toFixed(1), cy: y(p.valor).toFixed(1), r: 4.5 }, [el('title', { text: `${p.meet} · ${mesAnio(p.fecha)} · ${formato(p.valor)}` })])),
  ]);
  return el('figure.rc-grafica', { style: { margin: 0 } }, [el('figcaption.etiqueta', { text: titulo }), svg]);
}

export default async function (ctx) {
  const { raiz, params, consulta, app } = ctx;
  app.estilos('records');
  app.titulo(t('Atleta'));
  reemplazar(raiz, el('div.contenedor', {}, esqueletoLista(3)));

  const consultaApar = consulta.get('m') && consulta.get('a') ? `?m=${encodeURIComponent(consulta.get('m'))}&a=${encodeURIComponent(consulta.get('a'))}` : '';
  let perfil;
  async function cargar(slug = params.slug) {
    const j = await pedir('GET', `/api/atletas/${encodeURIComponent(slug)}${slug === params.slug ? consultaApar : ''}`);
    if (j.redirigir) { app.navegar(`/atletas/${encodeURIComponent(j.redirigir)}`, { reemplazar: true }); return null; }
    return j.perfil;
  }
  try { perfil = await cargar(); } catch (e) {
    const noExiste = e.estado === 404;
    reemplazar(raiz, el('div.contenedor', {}, errorEstado({
      titulo: noExiste ? t('No encontramos esta ficha') : t('No logramos abrir esta ficha'), texto: e.message,
      pasos: noExiste ? [t('Busca al atleta por su nombre en la lista.')] : [t('Revisa que estés en la misma Wi-Fi que la mesa.')],
      reintentar: noExiste ? null : () => app.navegar(location.pathname + location.search, { reemplazar: true }),
    })));
    if (noExiste) raiz.querySelector('.estado')?.append(el('div.estado-acciones', {}, [boton({ texto: t('Ver a todos los atletas'), icono: 'usuarios', variante: 'primario', href: '/atletas' })]));
    return;
  }
  if (!perfil) return;
  pintar();

  function pintar() {
    const p = perfil, org = app.esOrganizador();
    app.titulo(p.nombre);
    const marca = k => {
      const m = p.mejores[k];
      return el('div.rc-marca', {}, [
        el('span.etiqueta', { text: t(LEV_TXT[k]) }),
        el('b.rc-celda-kg.datos', { text: m ? (k === 'puntos' ? fmtPuntos(m.kg) : kg(m.kg)) : '—' }),
        el('small', { text: m ? `${mesAnio(m.fecha)} · ${m.meet}` : t('Sin marca válida') }),
      ]);
    };
    const hayProgreso = p.progresion.length > 0;
    reemplazar(raiz, el('div.contenedor.apilar-grande', {}, [
      el('header.rc-ficha-cab', {}, [
        el('a.org-atras', { href: '/atletas' }, [t('Todos los atletas')]),
        el('h1.titular', {}, [el('span.resaltado', { text: p.nombre })]),
        el('div.fila', {}, [
          pildora({ texto: p.sexo === 'F' ? t('Mujer') : t('Hombre'), tono: 'neutro' }),
          ...p.clubs.slice(0, 3).map(c => pildora({ texto: c, tono: 'neutro' })),
          el('span.suave.pequeno', { text: plural(p.meets, 'meet', 'meets') }),
        ]),
        p.categorias.length ? el('p.suave.pequeno', { text: `${t('Categorías')}: ${p.categorias.join(' · ')}` }) : null,
        org ? el('div.fila', {}, [boton({ texto: t('Fusionar con otra ficha'), icono: 'usuarios', variante: 'secundario', onclick: fusionar })]) : null,
      ]),
      el('section.apilar', { 'aria-label': t('Mejores marcas') }, [
        el('h2.pub-seccion-titulo', {}, [el('span', { text: t('Mejores marcas') })]),
        el('div.rc-marcas', {}, ['S', 'B', 'D', 'total', 'puntos'].map(marca)),
      ]),
      el('section.apilar', { 'aria-label': t('Progresión') }, [
        el('h2.pub-seccion-titulo', {}, [el('span', { text: t('Progresión') })]),
        hayProgreso ? el('div.rc-graficas', {}, [
          grafica(p.progresion.map(x => ({ fecha: x.fecha, valor: x.total, meet: x.meet })), { titulo: t('Total (kg)') }),
          grafica(p.progresion.map(x => ({ fecha: x.fecha, valor: x.puntos, meet: x.meet })), { titulo: t('Puntos'), formato: x => numero(x, { dec: 1 }) }),
        ]) : vacio({ icono: 'barra', titulo: t('Aún no hay totales válidos'), texto: t('La gráfica aparece cuando este atleta termine un meet con un total válido.') }),
      ]),
      el('section.apilar', { 'aria-label': t('Último meet') }, [
        el('h2.pub-seccion-titulo', {}, [el('span', { text: t('Último meet') })]),
        el('a.rc-ultimo', { href: `/meets/${encodeURIComponent(p.ultimo.meetId)}` }, [
          anillo(p.ultimo.anillo, { tam: 64 }),
          el('div', {}, [el('b', { text: p.ultimo.meet }), el('p.suave.pequeno', { text: [mesAnio(p.ultimo.fecha), t('Anillo de sus 9 intentos')].filter(Boolean).join(' · ') })]),
        ]),
      ]),
      el('section.apilar', { 'aria-label': t('Récords') }, [
        el('h2.pub-seccion-titulo', {}, [el('span', { text: t('Récords que posee') }), el('span.pestana-conteo', { text: p.records.length })]),
        p.records.length ? el('ul.rc-lista', {}, p.records.map(r => el('li', {}, el('a.rc-fila', { href: `/records?q=${encodeURIComponent(p.nombre)}` }, [
          el('div', {}, [el('b', { text: `${t(NOMBRE_LEV_REC[r.lev])} · ${r.clase ? `${r.clase} kg` : t('Todas las clases')}` }), el('small', { text: `${r.federacion} · ${textoNivel(r)} · ${r.division}${r.homologado ? '' : ` · ${t('por homologar')}`}` })]),
          el('div.rc-fila-total.datos', { text: kg(r.kg) }),
        ])))) : el('p.suave', { text: t('Todavía no posee ningún récord de la tabla de este servidor.') }),
      ]),
      el('section.apilar', { 'aria-label': t('Historial') }, [
        el('h2.pub-seccion-titulo', {}, [el('span', { text: t('Historial de meets') }), el('span.pestana-conteo', { text: p.historial.length })]),
        el('ol.rc-historial-meets', {}, p.historial.map(h => fila(h, org))),
      ]),
    ]));
  }

  function fila(h, org) {
    const cel = (k, texto) => el('div', {}, [el('small', { text: texto }), el('b.datos', { text: h[k] ? kg(h[k]) : '—' })]);
    return el('li.rc-meet', {}, [
      el('div.rc-meet-cab', {}, [
        el('a', { href: `/meets/${encodeURIComponent(h.meetId)}?t=resultados`, text: h.meetNombre }),
        el('span.suave.pequeno', { text: [mesAnio(h.fecha), h.federacion].filter(Boolean).join(' · ') }),
      ]),
      el('p.suave.pequeno', { text: [h.categoria, h.equipamiento === 'equipado' ? t('Equipado') : 'Raw', h.peso ? kg(h.peso) : '', h.puesto ? t('Puesto {n} de {de}', { n: h.puesto, de: h.de }) : ''].filter(Boolean).join(' · ') }),
      el('div.rc-meet-levs', {}, [cel('S', t('Sentadilla')), cel('B', t('Banca')), cel('D', t('Peso muerto')), el('div', {}, [el('small', { text: `${t('Total')} · ${h.total ? `${fmtPuntos(h.puntos)} ${h.formula}` : ''}` }), el('b.datos', { text: h.total ? kg(h.total) : '—' })])]),
      org && perfil.historial.length > 1 ? el('div', {}, [boton({ texto: t('No es esta persona'), variante: 'fantasma', tam: 'chico', onclick: () => separar(h) })]) : null,
    ]);
  }

  /* ---- organizador: fusionar fichas o separar un homónimo ---- */
  const poner = set => pedir('PUT', '/api/atletas/asignaciones', { set });
  async function separar(h) {
    const base = perfil.slug.slice(0, 44);
    const nueva = `${base}-${Math.random().toString(36).slice(2, 7)}`;
    if (!(await confirmar({ titulo: t('¿Separar este meet?'), texto: t('«{m}» pasará a una ficha nueva, como si fuera otra persona con el mismo nombre. Puedes deshacerlo.', { m: h.meetNombre }), confirmar: t('Separar') }))) return;
    const k = claveApar(h.meetId, h.aid);
    try {
      await poner({ [k]: nueva });
      toast(t('Separado. Ahora es otra ficha.'), { tipo: 'ok', deshacer: async () => { await poner({ [k]: perfil.slug }); await recargar(); }, accion: { texto: t('Ver la ficha nueva'), onclick: () => app.navegar(`/atletas/${nueva}`) } });
      await recargar();
    } catch (e) { toast(e.message, { tipo: 'error' }); }
  }
  async function recargar() { try { perfil = await cargar(perfil.slug); if (perfil) pintar(); } catch { app.navegar(location.pathname, { reemplazar: true }); } }

  async function fusionar() {
    let todos = [];
    const lista = el('ul.rc-lista', { style: { maxHeight: '50vh', overflow: 'auto' } });
    const estado = el('p.suave.pequeno', { role: 'status', text: t('Cargando…') });
    const pintarLista = q => {
      const n = (x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase())(q || '');
      const f = todos.filter(x => x.slug !== perfil.slug && (!n || `${x.nombre} ${x.club}`.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(n))).slice(0, 30);
      estado.textContent = f.length ? '' : t('No hay otras fichas con ese nombre.');
      reemplazar(lista, f.map(x => el('li', {}, el('button.rc-fila', { type: 'button', style: { width: '100%', textAlign: 'left' }, onclick: () => elegir(x) }, [
        el('div', {}, [el('b', { text: x.nombre }), el('small', { text: [x.club, plural(x.meets, 'meet', 'meets')].filter(Boolean).join(' · ') })]),
        el('span.suave.pequeno', { text: t('Fusionar') }),
      ]))));
    };
    const buscar = campo({ etiqueta: t('Busca la otra ficha'), tipo: 'search', placeholder: t('Nombre o club'), onInput: rebote(pintarLista, 120) });
    const m = modal({ titulo: t('Fusionar con otra ficha'), descripcion: t('Elige la ficha de la misma persona (por ejemplo, con el nombre escrito distinto). Sus meets pasan a esta ficha.'), contenido: el('div.apilar', {}, [buscar, estado, lista]), acciones: [{ texto: t('Cancelar'), variante: 'fantasma' }] });
    try { todos = (await pedir('GET', '/api/atletas')).atletas; pintarLista(''); } catch (e) { estado.textContent = e.message; }
    async function elegir(x) {
      m.cerrar();
      if (!(await confirmar({ titulo: t('¿Fusionar las fichas?'), texto: t('«{otra}» se une a «{esta}». Puedes deshacerlo.', { otra: x.nombre, esta: perfil.nombre }), confirmar: t('Fusionar') }))) return;
      try {
        const otra = (await pedir('GET', `/api/atletas/${encodeURIComponent(x.slug)}`)).perfil;
        const claves = otra.historial.map(h => claveApar(h.meetId, h.aid));
        await poner(Object.fromEntries(claves.map(k => [k, perfil.slug])));
        toast(t('Fichas fusionadas.'), { tipo: 'ok', deshacer: async () => { await poner(Object.fromEntries(claves.map(k => [k, x.slug]))); await recargar(); } });
        await recargar();
      } catch (e) { toast(e.message, { tipo: 'error' }); }
    }
  }
}
