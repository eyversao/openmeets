/* ============================================================
   OPENMEETS — Pestaña «Pesaje» (/organizar/:id/pesaje): pensada para tableta, botones grandes.
   Busca al atleta, registra peso corporal, categoría automática (avisa si cambia), aperturas, racks, revisión y firma.
   Pico y final: al pesar al último aparece «Pesaje cerrado» con el resumen y «Generar grupos y lotes».
   ============================================================ */

import { el, reemplazar, contiene, leerNumero, clonar, hora, numero } from '../../util.js';
import { t } from '../../i18n.js';
import { boton, campo, interruptor, segmentado, modal, toast, vacio, pildora, icono } from '../../ui.js';
import { ORDEN_LEV } from '../../nucleo/competencia.js';
import { estaPesado, resumenPesaje, revisarCategoria, repartirGrupos } from '../../nucleo/inscripcion.js';
import { ordenarAtletas } from './logica.js';

const LEV = { S: 'Sentadilla', B: 'Banca', D: 'Peso muerto' };
const CLAVE_POR = 'openmeets.pesadoPor';
const guardado = () => { try { return localStorage.getItem(CLAVE_POR) || ''; } catch { return ''; } };
const recordar = v => { try { localStorage.setItem(CLAVE_POR, v); } catch { /* sin almacenamiento */ } };
const nombreClase = a => (a.clase ? `${a.sexo === 'F' ? t('Mujeres') : t('Hombres')} ${a.clase} kg` : t('Sin clase'));

export function montar(st) {
  st.ctx.app.estilos('inscripciones');
  const fed = () => st.meet.federacion || 'IPF';
  const e = { sel: null, filtro: 'todos', texto: '' };
  const anillo = el('div.pes-anillo', { role: 'img' });
  const cierre = el('div.pes-cierre');
  const lista = el('div.pes-lista', { role: 'list' });
  const panel = el('section.pes-panel', { 'aria-label': t('Pesaje del atleta') });
  const barra = el('div.pes-barra');

  const atletas = () => st.atletas();
  const siguiente = tras => { const l = ordenarAtletas(atletas()); const i = tras ? l.findIndex(a => a.id === tras) : -1; return [...l.slice(i + 1), ...l.slice(0, i + 1)].find(a => !estaPesado(a) && a.id !== tras) || null; };

  /* ---------- progreso y cierre ---------- */
  function pintarProgreso() {
    const r = resumenPesaje(atletas());
    const p = r.total ? Math.round((r.pesados / r.total) * 100) : 0;
    anillo.style.setProperty('--p', `${p}%`);
    anillo.setAttribute('aria-label', t('Pesados {n} de {total}', { n: r.pesados, total: r.total }));
    reemplazar(anillo, [el('div.pes-anillo-centro', {}, [el('strong.datos', { text: `${r.pesados}/${r.total}` }), el('span.etiqueta', { text: t('Pesados') })])]);
    if (!r.completo) { cierre.replaceChildren(); cierre.hidden = true; return; }
    cierre.hidden = false;
    reemplazar(cierre, el('section.panel.pes-cierre-tarjeta', { role: 'status' }, [
      el('div.estado-icono.ins-listo-icono', {}, [icono('check', { tam: 28 })]),
      el('h2.estado-titulo', { text: t('Pesaje cerrado') }),
      el('p.estado-texto', { text: t('{n} atletas pesados y con su categoría asignada. Ya puedes armar los grupos.', { n: r.pesados }) }),
      el('div.tabla-caja', {}, el('table.tabla', {}, [
        el('thead', {}, el('tr', {}, [t('Categoría'), t('Atletas'), t('Peso')].map(h => el('th', { text: h })))),
        el('tbody', {}, r.categorias.map(c => el('tr', {}, [el('td', { text: c.categoria }), el('td.datos', { text: c.n }), el('td.datos', { text: c.n > 1 ? `${numero(c.min, { max: 1 })}–${numero(c.max, { max: 1 })} kg` : `${numero(c.max, { max: 1 })} kg` })]))),
      ])),
      el('div.fila.pes-cierre-acciones', {}, [
        boton({ texto: t('Generar grupos y lotes'), icono: 'rayo', variante: 'primario', tam: 'grande', onclick: grupos }),
        boton({ texto: t('Ir a la mesa'), icono: 'flecha-der', variante: 'secundario', tam: 'grande', onclick: () => st.irA('mesa') }),
      ]),
    ]));
  }

  function grupos() {
    const tope = campo({ etiqueta: t('Máximo de atletas por grupo'), valor: '12', modo: 'numeric', ayuda: t('Se reparten parejo, de la categoría más liviana a la más pesada, hombres primero. Los lotes se sortean dentro de cada grupo.') });
    const previa = el('div.pes-previa', { 'aria-live': 'polite' });
    const calcular = () => {
      const n = Math.floor(leerNumero(tope.valor()));
      if (!(n >= 1 && n <= 100)) { previa.textContent = t('Escribe un número entre 1 y 100.'); return null; }
      const r = repartirGrupos(atletas(), { tope: n });
      const por = {}; r.forEach(x => { const k = `${x.plataforma} · ${t('Grupo')} ${x.grupo}`; por[k] = (por[k] || 0) + 1; });
      previa.textContent = Object.entries(por).map(([k, v]) => `${k}: ${v}`).join(' · ');
      return r;
    };
    tope.entrada.addEventListener('input', calcular);
    const m = modal({ titulo: t('Generar grupos y lotes'), contenido: el('div.formulario', {}, [tope, previa]), acciones: [
      { texto: t('Cancelar'), variante: 'fantasma' },
      { texto: t('Aplicar'), variante: 'primario', icono: 'check', cerrar: false, onclick: () => {
        const r = calcular(); if (!r) return false;
        const previos = new Map(atletas().map(a => [a.id, { plataforma: a.plataforma, sesion: a.sesion, grupo: a.grupo, lote: a.lote }]));
        for (const x of r) { const a = atletas().find(z => z.id === x.id); if (a) { Object.assign(a, { plataforma: x.plataforma, sesion: x.sesion, grupo: x.grupo, lote: x.lote }); st.ponerAtleta(a); } }
        m.cerrar();
        toast(t('Grupos y lotes listos para {n} atletas.', { n: r.length }), { tipo: 'ok', accion: { texto: t('Abrir la mesa'), onclick: () => st.irA('mesa') }, deshacer: () => { for (const [id, v] of previos) { const a = atletas().find(z => z.id === id); if (a) { Object.assign(a, v); st.ponerAtleta(a); } } } });
        return false;
      } },
    ] });
    calcular();
  }

  /* ---------- lista ---------- */
  function pintarLista() {
    const todos = ordenarAtletas(atletas());
    const q = e.texto.trim();
    const vis = todos.filter(a => (e.filtro === 'todos' || (e.filtro === 'pendientes') === !estaPesado(a)) && (!q || contiene(`${a.nombre} ${a.club}`, q) || String(a.lote) === q.replace('#', '')));
    if (!todos.length) { reemplazar(lista, vacio({ icono: 'usuarios', titulo: t('Aún no hay atletas para pesar'), texto: t('Confirma inscripciones o añade atletas y vuelve aquí el día del pesaje.'), accion: { texto: t('Ir a Inscripciones'), icono: 'flecha-der', onclick: () => st.irA('inscripciones') } })); return; }
    if (!vis.length) { reemplazar(lista, vacio({ icono: 'buscar', titulo: t('Nadie coincide'), texto: t('Busca por nombre, club o número de lote.'), accion: { texto: t('Quitar filtros'), onclick: () => { Object.assign(e, { filtro: 'todos', texto: '' }); pintarBarra(); pintarLista(); } } })); return; }
    reemplazar(lista, vis.map(a => el('button.pes-item', { type: 'button', role: 'listitem', 'aria-current': e.sel === a.id ? 'true' : null, dataset: { id: a.id, pesado: estaPesado(a) ? '1' : '0' }, onclick: () => elegir(a.id) }, [
      el('span.pes-item-lote.datos', { text: a.lote ? `#${a.lote}` : '—' }),
      el('span.pes-item-quien', {}, [el('strong.truncar', { text: a.nombre }), el('span.suave.pequeno.truncar', { text: [nombreClase(a), a.club].filter(Boolean).join(' · ') })]),
      estaPesado(a) ? pildora({ texto: `${numero(a.peso, { max: 2 })} kg · ${hora(a.pesaje.hora)}`, tono: 'ok', icono: 'check' }) : pildora({ texto: t('Sin pesar'), tono: 'neutro' }),
    ])));
  }
  function pintarBarra() {
    const buscar = campo({ etiqueta: t('Buscar atleta'), tipo: 'search', valor: e.texto, placeholder: t('Nombre, club o lote'), onInput: v => { e.texto = v; pintarLista(); } });
    const f = segmentado({ etiqueta: t('Mostrar'), opciones: [{ valor: 'todos', texto: t('Todos') }, { valor: 'pendientes', texto: t('Sin pesar') }, { valor: 'pesados', texto: t('Pesados') }], valor: e.filtro, onChange: v => { e.filtro = v; pintarLista(); } });
    reemplazar(barra, [buscar, f]);
  }

  /* ---------- panel de pesaje ---------- */
  function elegir(id) { e.sel = id; pintarLista(); pintarPanel(); panel.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }

  function pintarPanel() {
    const a = atletas().find(x => x.id === e.sel);
    if (!a) { reemplazar(panel, vacio({ icono: 'usuario', titulo: t('Elige a quién pesar'), texto: t('Toca un nombre de la lista o búscalo por nombre o lote.') })); return; }
    const antes = clonar(a);
    const grande = c => { c.entrada.classList.add('pes-grande'); return c; };
    const peso = grande(campo({ etiqueta: t('Peso corporal (kg)'), modo: 'decimal', valor: estaPesado(a) ? String(a.peso ?? '').replace('.', ',') : '', placeholder: '0,0', ayuda: a.peso && !estaPesado(a) ? t('Se inscribió con {kg} kg.', { kg: numero(a.peso, { max: 2 }) }) : undefined, autocompletar: 'off' }));
    const aviso = el('div.pes-aviso', { 'aria-live': 'polite' });
    const leerPeso = () => { const n = leerNumero(peso.valor()); return n > 0 ? n : 0; };
    const revisar = () => {
      const p = leerPeso();
      if (!p) { reemplazar(aviso, el('p.suave', { text: t('Escribe el peso y la categoría se asigna sola.') })); aviso.dataset.estado = ''; return; }
      const r = revisarCategoria(fed(), a, p);
      aviso.dataset.estado = r.estado;
      const nombre = c => `${a.sexo === 'F' ? t('Mujeres') : t('Hombres')} ${c} kg`;
      reemplazar(aviso, r.estado === 'fuera'
        ? [icono('alerta'), el('span', { text: t('Ese peso no entra en ninguna categoría. Revísalo: debe estar entre 20 y 300 kg.') })]
        : r.estado === 'cambia'
          ? [icono('alerta'), el('span', {}, [t('Cambia de categoría: '), el('strong', { text: nombre(r.antes) }), ' → ', el('strong', { text: nombre(r.clase) }), t('. Avísale al atleta.')])]
          : [icono('check'), el('span', {}, [t('Categoría: '), el('strong', { text: nombre(r.clase) })])]);
    };
    peso.entrada.addEventListener('input', revisar);
    const paso = (c, d) => { const v = leerNumero(c.valor()) || 0; c.poner(String(Math.max(0, Math.round((v + d) * 100) / 100)).replace('.', ',')); };
    const aper = Object.fromEntries(ORDEN_LEV.map(l => [l, grande(campo({ etiqueta: t(LEV[l]), modo: 'decimal', valor: a.intentos?.[l]?.[0]?.kg ?? '', autocompletar: 'off', ayuda: t('Primer intento') }))]));
    const rack = { S: grande(campo({ etiqueta: t('Rack sentadilla'), modo: 'numeric', valor: a.rack?.S ?? '' })), B: grande(campo({ etiqueta: t('Rack banca'), modo: 'numeric', valor: a.rack?.B ?? '' })) };
    const equipo = interruptor({ etiqueta: t('Equipo revisado'), ayuda: t('Ropa, muñequeras, rodilleras y calzado.'), valor: a.pesaje?.equipo });
    const licencia = interruptor({ etiqueta: t('Licencia o documento visto'), valor: a.pesaje?.licencia });
    const por = grande(campo({ etiqueta: t('Pesado por'), valor: a.pesaje?.por || guardado(), maxlength: 60, placeholder: t('Tu nombre'), autocompletar: 'name' }));
    const guardar = boton({ texto: estaPesado(a) ? t('Guardar de nuevo') : t('Guardar pesaje'), icono: 'check', variante: 'primario', tam: 'grande', ancho: true, onclick: () => {
      const p = leerPeso();
      if (!(p >= 20 && p <= 300)) { peso.ponerError(t('Escribe un peso entre 20 y 300 kg.')); peso.entrada.focus(); return; }
      const nums = {};
      for (const [k, c] of [...Object.entries(aper), ['rS', rack.S], ['rB', rack.B]]) { const v = c.valor().trim() === '' ? null : leerNumero(c.valor()); if (v !== null && !(v >= 0 && v <= 1000)) { c.ponerError(t('Escribe un número válido.')); c.entrada.focus(); return; } nums[k] = v; }
      const r = revisarCategoria(fed(), a, p);
      Object.assign(a, { peso: p, clase: r.clase, rack: { ...a.rack, S: nums.rS, B: nums.rB }, pesaje: { hora: Date.now(), por: por.valor().trim(), equipo: equipo.valor(), licencia: licencia.valor() } });
      for (const l of ORDEN_LEV) (a.intentos[l] ||= [{}, {}, {}])[0].kg = nums[l];
      recordar(por.valor().trim());
      st.ponerAtleta(a);
      const sig = siguiente(a.id);
      toast(t('{nombre} pesado: {kg} kg · {c}.', { nombre: a.nombre, kg: numero(p, { max: 2 }), c: nombreClase(a) }), { tipo: 'ok', deshacer: () => { Object.assign(a, antes); st.ponerAtleta(a); pintarTodo(); } });
      e.sel = sig && !resumenPesaje(atletas()).completo ? sig.id : null;
      pintarTodo(); if (e.sel) panel.scrollIntoView?.({ block: 'nearest' });
    } });
    const conPasos = (c, d = 2.5) => el('div.pes-con-pasos', {}, [boton({ icono: 'menos', variante: 'secundario', etiqueta: t('Restar {n} kg', { n: d }), onclick: () => paso(c, -d) }), c, boton({ icono: 'plus', variante: 'secundario', etiqueta: t('Sumar {n} kg', { n: d }), onclick: () => paso(c, d) })]);
    reemplazar(panel, [
      el('header.pes-panel-cab', {}, [el('div', {}, [el('h2.titular.pes-nombre', { text: a.nombre }), el('p.suave', { text: [a.lote ? `#${a.lote}` : '', a.sexo === 'F' ? t('Mujer') : t('Hombre'), a.club, a.division, a.equipamiento === 'equipado' ? t('Equipado') : 'Raw'].filter(Boolean).join(' · ') })]), estaPesado(a) ? pildora({ texto: t('Pesado a las {h}', { h: hora(a.pesaje.hora) }), tono: 'ok', icono: 'check' }) : pildora({ texto: t('Sin pesar'), tono: 'aviso' })]),
      el('div.pes-bloque', {}, [peso, aviso]),
      el('div.pes-bloque', {}, [el('h3.org-sub', { text: t('Aperturas (primer intento)') }), el('div.pes-tres', {}, ORDEN_LEV.map(l => conPasos(aper[l])))]),
      el('div.pes-bloque', {}, [el('h3.org-sub', { text: t('Alturas de rack') }), el('div.formulario-fila', {}, [rack.S, rack.B])]),
      el('div.pes-bloque', {}, [el('h3.org-sub', { text: t('Revisión') }), equipo, licencia, por]),
      guardar,
    ]);
    revisar();
    setTimeout(() => peso.entrada.focus({ preventScroll: true }), 30);
  }

  function pintarTodo() { pintarProgreso(); pintarLista(); pintarPanel(); }

  const nodo = el('div.pes', {}, [
    el('div.pes-cab', {}, [anillo, el('div.pes-cab-texto', {}, [el('h2.org-sec-titulo', { text: t('Modo pesaje') }), el('p.suave.pequeno', { text: t('Pesa, asigna categoría y deja listas las aperturas. Todo se guarda al tocar «Guardar pesaje».') })])]),
    cierre,
    el('div.pes-rejilla', {}, [el('div.pes-izq', {}, [barra, lista]), panel]),
  ]);
  pintarBarra(); pintarTodo();
  let tocando = 0;
  const baja = st.escuchar(() => { clearTimeout(tocando); tocando = setTimeout(() => { pintarProgreso(); if (!document.activeElement?.closest?.('.pes-panel')) pintarLista(); }, 80); });
  return { nodo, salir: () => { baja(); clearTimeout(tocando); }, alActivar: () => { pintarProgreso(); pintarLista(); } };
}
