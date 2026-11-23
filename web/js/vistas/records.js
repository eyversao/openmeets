/* Tabla de récords: vista pública con filtros, búsqueda e historial; el organizador crea, edita, borra (con Deshacer) e importa/exporta CSV. */
import { el, reemplazar, rebote, kg, fecha, plural } from '../util.js';
import { t } from '../i18n.js';
import { pedir } from '../api.js';
import { boton, campo, select, interruptor, modal, toast, vacio, errorEstado, esqueletoLista, pildora } from '../ui.js';
import { filtrarRecords, LEVS_REC, NOMBRE_LEV_REC, NOMBRE_NIVEL, COLUMNAS_CSV } from '../nucleo/records.js';
import { FEDERACIONES, divisionesDe } from '../nucleo/federaciones.js';
import { textoNivel } from './_records.js';

const unicos = (l, f) => [...new Set(l.map(f).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
const sexoTxt = s => (s === 'F' ? t('Mujeres') : t('Hombres'));
const equipoTxt = e => (e === 'equipado' ? t('Equipado') : 'Raw');
const LEV_CORTO = { S: 'Sentadilla', B: 'Banca', D: 'Peso muerto', total: 'Total' };

export default async function (ctx) {
  const { raiz, app, consulta } = ctx;
  app.titulo(t('Récords'));
  app.estilos('records');
  const org = () => app.esOrganizador();
  const filtro = { q: consulta.get('q') || '', federacion: '', nivel: '', sexo: '', equipamiento: '', division: '', pendientes: '' };
  let tabla = null, fallo = null, firmaOpc = '';

  const barra = el('div.rc-barra');
  const controles = el('div.rc-filtros', { hidden: true });
  const lista = el('div.apilar-grande');
  reemplazar(raiz, el('div.contenedor', {}, [
    el('header.cabecera-vista', {}, [
      el('h1.titular', {}, [el('span.resaltado', { text: t('Récords') })]),
      el('p.subtitulo', { text: t('Los récords por federación, nivel, categoría y levantamiento, con quién los tuvo antes.') }),
      barra,
    ]),
    controles, lista,
  ]));

  /* ---- barra de acciones ---- */
  function pintarBarra() {
    reemplazar(barra, [
      el('div.rc-barra-acciones', {}, [
        boton({ texto: t('Ver a los atletas'), icono: 'usuarios', variante: 'secundario', href: '/atletas' }),
        boton({ texto: t('Exportar CSV'), icono: 'descargar', variante: 'secundario', href: '/api/records/export.csv', download: '' }),
      ]),
      org() ? el('div.rc-barra-acciones', {}, [
        boton({ texto: t('Importar CSV'), icono: 'subir', variante: 'secundario', onclick: importar }),
        boton({ texto: t('Nuevo récord'), icono: 'plus', variante: 'primario', onclick: () => formulario() }),
      ]) : null,
    ]);
  }

  /* ---- filtros (se rehacen solo si cambian las opciones disponibles) ---- */
  function pintarControles() {
    const op = { fed: unicos(tabla || [], r => r.federacion), niv: unicos(tabla || [], r => r.nivel), div: unicos(tabla || [], r => r.division) };
    const firma = JSON.stringify(op);
    if (firma === firmaOpc) return;
    firmaOpc = firma;
    for (const [k, l] of [['federacion', op.fed], ['nivel', op.niv], ['division', op.div]]) if (filtro[k] && !l.some(x => x.toLowerCase() === filtro[k].toLowerCase())) filtro[k] = '';
    const todas = t('Todas'), todos = t('Todos');
    const sel = (etiqueta, k, ops, vacioTxt) => select({ etiqueta, valor: filtro[k], opciones: [{ valor: '', texto: vacioTxt }, ...ops], onChange: v => { filtro[k] = v; pintarLista(); } });
    const buscar = campo({ etiqueta: t('Buscar'), tipo: 'search', valor: filtro.q, placeholder: t('Atleta, meet o lugar'), onInput: rebote(v => { filtro.q = v; pintarLista(); }, 150) });
    const foco = document.activeElement?.closest?.('.rc-filtros') && document.activeElement.type === 'search';
    reemplazar(controles, [
      buscar,
      op.fed.length > 1 ? sel(t('Federación'), 'federacion', op.fed.map(x => ({ valor: x, texto: x })), todas) : null,
      op.niv.length > 1 ? sel(t('Nivel'), 'nivel', op.niv.map(x => ({ valor: x, texto: t(NOMBRE_NIVEL[x] || x) })), todos) : null,
      sel(t('Sexo'), 'sexo', [{ valor: 'F', texto: t('Mujeres') }, { valor: 'M', texto: t('Hombres') }], todos),
      sel(t('Equipamiento'), 'equipamiento', [{ valor: 'raw', texto: 'Raw' }, { valor: 'equipado', texto: t('Equipado') }], todos),
      op.div.length > 1 ? sel(t('División'), 'division', op.div.map(x => ({ valor: x, texto: x })), todas) : null,
      sel(t('Homologación'), 'pendientes', [{ valor: '1', texto: t('Por homologar') }], todos),
    ]);
    if (foco) buscar.entrada.focus();
  }

  /* ---- la tabla ---- */
  function agrupar(filas) {
    const fed = new Map();
    for (const r of filas) {
      const nk = `${r.nivel}|${r.nivelTexto}`, bk = `${r.sexo}|${r.division}|${r.equipamiento}`;
      const n = fed.get(r.federacion) || fed.set(r.federacion, new Map()).get(r.federacion);
      const b = n.get(nk) || n.set(nk, new Map()).get(nk);
      const c = b.get(bk) || b.set(bk, new Map()).get(bk);
      const k = c.get(r.clase) || c.set(r.clase, {}).get(r.clase);
      k[r.lev] = r;
    }
    return fed;
  }
  function celda(r, lev, grupo) {
    const cuerpo = r
      ? [el('span.rc-celda-lev', { text: t(LEV_CORTO[lev]) }), el('b.rc-celda-kg.datos', { text: kg(r.kg) }), el('span.rc-celda-quien', { text: r.atleta }), r.homologado ? null : el('span.rc-celda-lev', { text: t('Por homologar') })]
      : [el('span.rc-celda-lev', { text: t(LEV_CORTO[lev]) }), el('span.rc-celda-kg.datos', { text: '—' })];
    if (r) return el('button.rc-celda', { type: 'button', class: r.homologado ? '' : 'pendiente', 'aria-label': `${t(NOMBRE_LEV_REC[lev])} ${kg(r.kg)} ${r.atleta}`, onclick: () => detalle(r) }, cuerpo);
    return org() ? el('button.rc-celda.vacia', { type: 'button', 'aria-label': t('Añadir {lev}', { lev: t(NOMBRE_LEV_REC[lev]) }), onclick: () => formulario({ ...grupo, lev }) }, cuerpo) : el('div.rc-celda.vacia', {}, cuerpo);
  }
  function pintarLista() {
    if (!tabla) {
      reemplazar(lista, fallo
        ? errorEstado({ titulo: t('No logramos traer los récords'), texto: t('Tu teléfono no llegó a OpenMeets. Suele ser la red, no tú.'), detalle: fallo.message, pasos: [t('Revisa que estés en la misma Wi-Fi que la mesa.'), t('Si sigue igual, pídele al organizador que abra OpenMeets en su equipo.')], reintentar: cargar })
        : esqueletoLista(3));
      return;
    }
    controles.hidden = !tabla.length;
    if (!tabla.length) {
      reemplazar(lista, vacio({
        icono: 'trofeo', titulo: t('Aún no hay récords'),
        texto: org() ? t('Crea el primero o importa una tabla con un CSV. Cuando un intento válido supere uno, quedará registrado solo, por homologar.') : t('Cuando el organizador cargue los récords de su federación, aparecerán aquí.'),
        acciones: org() ? [{ texto: t('Nuevo récord'), icono: 'plus', onclick: () => formulario() }, { texto: t('Importar CSV'), icono: 'subir', onclick: importar }] : [],
      }));
      return;
    }
    const filas = filtrarRecords(tabla, filtro);
    if (!filas.length) {
      reemplazar(lista, vacio({ icono: 'buscar', titulo: t('Ningún récord coincide'), texto: t('Prueba con otro nombre o quita los filtros.'), accion: { texto: t('Quitar filtros'), icono: 'x', onclick: () => { Object.keys(filtro).forEach(k => { filtro[k] = ''; }); firmaOpc = ''; pintarControles(); pintarLista(); } } }));
      return;
    }
    const g = agrupar(filas);
    reemplazar(lista, [el('p.pequeno.suave', { role: 'status', text: plural(filas.length, 'récord', 'récords') }), ...[...g].map(([fed, niveles]) => el('section.rc-fed', { 'aria-label': fed }, [
      el('h2.pub-seccion-titulo', {}, [el('span', { text: fed })]),
      ...[...niveles].map(([nk, bloques]) => {
        const [nivel, nivelTexto] = nk.split('|');
        return el('div.rc-nivel', {}, [
          el('h3.rc-nivel-titulo', {}, [el('span', { text: textoNivel({ nivel, nivelTexto }) })]),
          ...[...bloques].map(([bk, clases]) => {
            const [sexo, division, equipamiento] = bk.split('|');
            const base = { federacion: fed, nivel, nivelTexto, sexo, division, equipamiento };
            return el('div.rc-bloque', {}, [
              el('p.rc-bloque-titulo', { text: `${sexoTxt(sexo)} · ${division} · ${equipoTxt(equipamiento)}` }),
              ...[...clases].map(([clase, porLev]) => el('div.rc-clase', {}, [
                el('b.rc-clase-nombre.datos', { text: clase ? `${clase} kg` : t('Todas') }),
                ...LEVS_REC.map(l => celda(porLev[l], l, { ...base, clase })),
              ])),
            ]);
          }),
        ]);
      }),
    ]))]);
  }

  /* ---- detalle e historial de un récord ---- */
  function detalle(r) {
    const quien = (x) => [x.meet, x.lugar].filter(Boolean).join(' · ');
    const fuente = /^https?:\/\//i.test(r.fuente) ? el('a', { href: r.fuente, target: '_blank', rel: 'noopener noreferrer', text: r.fuente }) : r.fuente;
    const cuerpo = el('div.rc-detalle', {}, [
      el('div.fila', {}, [pildora({ texto: textoNivel(r), tono: 'senal' }), r.homologado ? pildora({ texto: t('Homologado'), tono: 'ok' }) : pildora({ texto: t('Por homologar'), tono: 'aviso' })]),
      el('b.rc-kg.datos', { text: kg(r.kg) }),
      el('dl.rc-datos', {}, [
        el('dt', { text: t('Atleta') }), el('dd', {}, [el('a', { href: `/atletas?q=${encodeURIComponent(r.atleta)}`, text: r.atleta })]),
        el('dt', { text: t('Categoría') }), el('dd', { text: `${r.federacion} · ${sexoTxt(r.sexo)} · ${r.division} · ${equipoTxt(r.equipamiento)} · ${r.clase ? `${r.clase} kg` : t('Todas las clases')}` }),
        el('dt', { text: t('Levantamiento') }), el('dd', { text: t(NOMBRE_LEV_REC[r.lev]) }),
        r.fecha ? el('dt', { text: t('Fecha') }) : null, r.fecha ? el('dd', { text: fecha(r.fecha) }) : null,
        quien(r) ? el('dt', { text: t('Meet y lugar') }) : null, quien(r) ? el('dd', {}, [r.meetId ? el('a', { href: `/meets/${encodeURIComponent(r.meetId)}?t=resultados`, text: quien(r) }) : quien(r)]) : null,
        r.fuente ? el('dt', { text: t('Fuente') }) : null, r.fuente ? el('dd', {}, [fuente]) : null,
      ]),
      el('h4', { text: t('Historial: quién lo tuvo antes') }),
      (r.historial || []).length ? el('ol.rc-historial', {}, r.historial.map(h => el('li', {}, [el('b.datos', { text: kg(h.kg) }), el('div', {}, [el('span', { text: h.atleta }), el('small', { text: [h.fecha ? fecha(h.fecha) : '', quien(h)].filter(Boolean).join(' · ') })])])))
        : el('p.suave.pequeno', { text: t('Nadie lo tuvo antes en esta tabla.') }),
    ]);
    modal({ titulo: `${t(NOMBRE_LEV_REC[r.lev])} · ${r.clase ? `${r.clase} kg` : t('Todas')}`, contenido: cuerpo, acciones: org() ? [
      { texto: t('Eliminar'), icono: 'papelera', variante: 'peligro', onclick: () => borrar(r) },
      { texto: t('Editar'), icono: 'editar', variante: 'primario', onclick: () => { setTimeout(() => formulario(r), 220); } },
    ] : [{ texto: t('Cerrar'), variante: 'fantasma' }] });
  }

  async function borrar(r) {
    try {
      const j = await pedir('DELETE', `/api/records/${encodeURIComponent(r.id)}`);
      await cargar();
      toast(t('Récord eliminado.'), { tipo: 'info', deshacer: async () => { await pedir('POST', '/api/records', j.record); await cargar(); } });
    } catch (e) { toast(e.message, { tipo: 'error' }); return false; }
  }

  /* ---- crear / editar ---- */
  function formulario(base = {}) {
    const editar = !!base.id;
    const f = { homologado: base.homologado !== false, ...base };
    const txt = (k, etiqueta, extra = {}) => campo({ etiqueta, valor: f[k] ?? '', ...extra });
    const fed = txt('federacion', t('Federación'), { list: 'rc-feds', requerido: true });
    const feds = el('datalist', { id: 'rc-feds' }, [...new Set([...FEDERACIONES, ...(tabla || []).map(r => r.federacion)])].map(x => el('option', { value: x })));
    const nivel = select({ etiqueta: t('Nivel'), valor: f.nivel || 'nacional', opciones: Object.entries(NOMBRE_NIVEL).map(([v, x]) => ({ valor: v, texto: t(x) })), onChange: v => { nt.hidden = v !== 'otro'; } });
    const nivelTexto = txt('nivelTexto', t('Nombre del nivel'), { placeholder: t('Ej.: Panamericano'), maxlength: 40 });
    const nt = el('div.completo', { hidden: (f.nivel || 'nacional') !== 'otro' }, [nivelTexto]);
    const sexo = select({ etiqueta: t('Sexo'), valor: f.sexo || 'M', opciones: [{ valor: 'M', texto: t('Hombres') }, { valor: 'F', texto: t('Mujeres') }] });
    const division = txt('division', t('División'), { list: 'rc-divs' });
    const divs = el('datalist', { id: 'rc-divs' }, [...new Set([...divisionesDe('IPF').map(d => d.nombre), ...(tabla || []).map(r => r.division)])].map(x => el('option', { value: x })));
    const equipo = select({ etiqueta: t('Equipamiento'), valor: f.equipamiento || 'raw', opciones: [{ valor: 'raw', texto: 'Raw' }, { valor: 'equipado', texto: t('Equipado') }] });
    const clase = txt('clase', t('Clase de peso'), { placeholder: '-83, +120', ayuda: t('Déjala vacía si vale para todas.') });
    const lev = select({ etiqueta: t('Levantamiento'), valor: f.lev || 'S', opciones: LEVS_REC.map(v => ({ valor: v, texto: t(NOMBRE_LEV_REC[v]) })) });
    const kgC = txt('kg', t('Kilos'), { modo: 'decimal', requerido: true });
    const atleta = txt('atleta', t('Atleta'), { requerido: true });
    const fechaC = txt('fecha', t('Fecha'), { tipo: 'date' });
    const meet = txt('meet', t('Meet'));
    const lugar = txt('lugar', t('Lugar'));
    const fuente = txt('fuente', t('Fuente'), { placeholder: t('Enlace o nombre del documento') });
    const hom = interruptor({ etiqueta: t('Homologado'), ayuda: t('Apágalo si todavía falta la confirmación de la federación.'), valor: f.homologado });
    const nuevo = editar ? interruptor({ etiqueta: t('Es un récord nuevo'), ayuda: t('Guarda el titular anterior en el historial. Déjalo apagado si solo corriges un dato.') }) : null;
    const error = el('p.campo-error', { role: 'alert', hidden: true });
    [fed, atleta, fuente, hom, nuevo, error].forEach(x => x?.classList.add('completo'));
    const cuerpo = el('div.rc-form', {}, [fed, nivel, nt, sexo, equipo, division, clase, lev, kgC, atleta, fechaC, meet, lugar, fuente, hom, nuevo, error, feds, divs]);
    modal({ titulo: editar ? t('Editar récord') : t('Nuevo récord'), contenido: cuerpo, acciones: [
      { texto: t('Cancelar'), variante: 'fantasma' },
      { texto: t('Guardar'), variante: 'primario', onclick: async (e, b) => {
        error.hidden = true;
        const cuerpoApi = { federacion: fed.valor(), nivel: nivel.valor(), nivelTexto: nivelTexto.valor(), sexo: sexo.valor(), division: division.valor(), equipamiento: equipo.valor(), clase: clase.valor(), lev: lev.valor(), kg: kgC.valor().replace(',', '.'), atleta: atleta.valor(), fecha: fechaC.valor(), meet: meet.valor(), lugar: lugar.valor(), fuente: fuente.valor(), homologado: hom.valor() };
        b.cargando?.(true);
        try {
          if (editar) await pedir('PUT', `/api/records/${encodeURIComponent(base.id)}`, { ...cuerpoApi, nuevoTitular: nuevo.valor() });
          else await pedir('POST', '/api/records', cuerpoApi);
          toast(t('Récord guardado.'), { tipo: 'ok' });
          await cargar();
        } catch (err) { error.textContent = err.message; error.hidden = false; b.cargando?.(false); return false; }
      } },
    ] });
  }

  /* ---- importar CSV ---- */
  function importar() {
    let csv = '';
    const resumen = el('div.apilar', { 'aria-live': 'polite' });
    const archivo = el('input.entrada', { type: 'file', accept: '.csv,text/csv', 'aria-label': t('Archivo CSV') });
    archivo.addEventListener('change', async () => {
      const a = archivo.files?.[0]; if (!a) return;
      if (a.size > 1.5 * 1024 * 1024) { reemplazar(resumen, el('p.campo-error', { text: t('El archivo pesa más de 1,5 MB. Divídelo en partes.') })); return; }
      csv = await a.text();
      reemplazar(resumen, el('p.suave', { text: t('Revisando…') }));
      try {
        const j = await pedir('POST', '/api/records/importar', { csv, simular: true });
        reemplazar(resumen, [
          el('p', { text: t('{n} nuevos, {a} se actualizan (el anterior pasa al historial) y {i} ya estaban.', { n: j.nuevos, a: j.actualizados, i: j.iguales }) }),
          j.erroresTotal ? el('div', {}, [el('p.campo-error', { text: t('{n} filas con problemas (no se importan):', { n: j.erroresTotal }) }), el('ul.rc-errores', {}, j.errores.map(x => el('li', { text: x.linea ? `${t('Línea')} ${x.linea}: ${x.error}` : x.error })))]) : null,
        ]);
      } catch (e) { csv = ''; reemplazar(resumen, el('p.campo-error', { text: e.message })); }
    });
    modal({ titulo: t('Importar récords desde CSV'), descripcion: t('Cada fila es un récord. Si ya existe uno igual de categoría, el anterior pasa al historial.'), contenido: el('div.rc-importar', {}, [
      el('p.pequeno', { text: t('Columnas (la primera fila lleva los nombres):') }), el('code', { text: COLUMNAS_CSV.join(', ') }),
      el('p.pequeno.suave', { text: t('nivel: mundial, nacional, ibero, regional u otro (con nivel_texto) · sexo: M o F · equipamiento: raw o equipado · levantamiento: S, B, D o total · fecha: AAAA-MM-DD · homologado: si o no.') }),
      boton({ texto: t('Descargar la plantilla'), icono: 'descargar', variante: 'secundario', href: '/api/records/plantilla.csv', download: '' }),
      archivo, resumen,
    ]), acciones: [
      { texto: t('Cancelar'), variante: 'fantasma' },
      { texto: t('Importar'), variante: 'primario', onclick: async () => {
        if (!csv) { reemplazar(resumen, el('p.campo-error', { text: t('Elige primero un archivo CSV.') })); return false; }
        try { const j = await pedir('POST', '/api/records/importar', { csv }); toast(t('Importados: {n} nuevos y {a} actualizados.', { n: j.nuevos, a: j.actualizados }), { tipo: 'ok' }); await cargar(); } catch (e) { reemplazar(resumen, el('p.campo-error', { text: e.message })); return false; }
      } },
    ] });
  }

  async function cargar() {
    try { tabla = (await pedir('GET', '/api/records')).records; fallo = null; } catch (e) { fallo = e; }
    pintarBarra(); pintarControles(); pintarLista();
  }
  pintarBarra(); pintarLista();
  await cargar();
}
