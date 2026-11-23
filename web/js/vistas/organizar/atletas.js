/* ============================================================
   OPENMEETS — Pestaña «Atletas»: lista editable, importación CSV con vista previa, lotes y aperturas
   ============================================================ */

import { el, reemplazar, clonar, contiene, leerNumero, numero } from '../../util.js';
import { t } from '../../i18n.js';
import { boton, campo, select, segmentado, modal, toast, vacio, pildora, anillo, icono, menuContextual } from '../../ui.js';
import { nuevoAtleta, claseDe, ORDEN_LEV } from '../../nucleo/competencia.js';
import { clasesDe, divisionesDe } from '../../nucleo/federaciones.js';
import { analizarCSV, prepararImportacion, plantillaCSV, ordenarAtletas, siguienteLote, sesionesDe, gruposDe } from './logica.js';
import { descargar, leerArchivo, avisoError } from './comun.js';

const LEV = { S: 'Sentadilla', B: 'Banca', D: 'Peso muerto' };

// Los textos de logica.js (puro, probado en Node) salen en español: se traducen al pintarlos.
const MSGS = ['Sexo «{a}» no válido (usa M o F)', 'Peso corporal «{a}» no es un número', 'Peso corporal {a} kg fuera de lo normal (20 a 300)', 'Fecha de nacimiento «{a}» no entendida: se ignora', 'Apertura {a}1 «{b}» no es un número', 'Apertura {a}1 {b} kg fuera de lo normal', 'Apertura {a}1 {b} kg no es múltiplo de 2,5', 'La tarima «{a}» no existe en el meet: se añadirá'];
const MSG_RE = MSGS.map(k => [k, new RegExp('^' + k.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w)\}/g, '(?<$1>.*)') + '$')]);
const msg = s => { for (const [k, re] of MSG_RE) { const m = s.match(re); if (m) return t(k, m.groups); } return t(s); };

export function montar(st) {
  const filtro = { texto: '', plataforma: '', sesion: '', grupo: '' };
  const lista = el('div.org-atletas');
  const barra = el('div.org-filtros');
  const resumen = el('p.suave.pequeno.org-resumen');
  const fed = () => st.meet.federacion || 'IPF';

  /* ---------- edición de una fila ---------- */
  /** Aplica un cambio, recalcula la clase si era automática, guarda y repinta solo esa fila. */
  function cambiar(a, fn) {
    const antes = a.peso, claseAuto = !a.clase || a.clase === claseDe(a.sexo, antes, a.division, fed());
    fn(a);
    if (claseAuto && a.peso !== antes) a.clase = a.peso > 0 ? claseDe(a.sexo, a.peso, a.division, fed()) : '';
    st.ponerAtleta(a);
  }
  const mini = (a, etiqueta, valor, alCambiar, ancho = 'org-mini') => {
    const i = el('input.entrada.' + ancho, { type: 'text', inputmode: 'decimal', value: valor ?? '', 'aria-label': `${etiqueta}: ${a.nombre}`, autocomplete: 'off',
      onchange: () => { const v = i.value.trim() === '' ? null : leerNumero(i.value); if (v !== null && !(v >= 0 && v <= 1000)) { i.value = valor ?? ''; toast(t('Escribe un número válido.'), { tipo: 'error' }); return; } alCambiar(v); } });
    return i;
  };

  function fila(a) {
    return el('article.org-atleta', { dataset: { id: a.id } }, [
      el('span.org-lote.datos', { text: a.lote ? `#${a.lote}` : '—', title: t('Lote') }),
      el('div.org-atleta-quien', {}, [el('strong.truncar', { text: a.nombre }), el('span.suave.pequeno.truncar', { text: [a.sexo === 'F' ? t('Mujer') : t('Hombre'), a.club, [a.division, a.clase].filter(Boolean).join(' ')].filter(Boolean).join(' · ') })]),
      el('span.org-grupo.datos', { text: `${a.plataforma} · ${a.sesion}${a.grupo}` }),
      el('div.org-atleta-nums', {}, [
        el('label.org-num', {}, [el('span.etiqueta', { text: t('Peso') }), mini(a, t('Peso corporal'), a.peso, v => cambiar(a, x => { x.peso = v; }))]),
        el('label.org-num', {}, [el('span.etiqueta', { text: t('Rack S') }), mini(a, t('Rack de sentadilla'), a.rack?.S, v => cambiar(a, x => { x.rack = { ...x.rack, S: v }; }))]),
        el('label.org-num', {}, [el('span.etiqueta', { text: t('Rack B') }), mini(a, t('Rack de banca'), a.rack?.B, v => cambiar(a, x => { x.rack = { ...x.rack, B: v }; }))]),
        ...ORDEN_LEV.map(l => el('label.org-num', {}, [el('span.etiqueta', { text: `${l}1` }), mini(a, t('Apertura de {lev}', { lev: LEV[l].toLowerCase() }), a.intentos?.[l]?.[0]?.kg, v => cambiar(a, x => { (x.intentos[l] ||= [{}, {}, {}])[0].kg = v; }))])),
      ]),
      anillo(a, { tam: 40 }),
      boton({ icono: 'editar', variante: 'fantasma', etiqueta: t('Editar a {nombre}', { nombre: a.nombre }), onclick: () => editar(a) }),
    ]);
  }

  /* ---------- crear / editar ---------- */
  function editar(a0) {
    const nuevo = !a0;
    const a = a0 ? clonar(a0) : nuevoAtleta({ id: `at-${Math.random().toString(16).slice(2, 12)}`, plataforma: filtro.plataforma || st.plataformas()[0], sesion: filtro.sesion || '1', grupo: filtro.grupo || 'A', lote: siguienteLote(st.atletas()) });
    const f = (k, etiqueta, extra = {}) => campo({ etiqueta, valor: a[k] ?? '', ...extra });
    const nombre = f('nombre', t('Nombre'));
    let sexo = a.sexo;
    const sx = segmentado({ etiqueta: t('Sexo'), opciones: [{ valor: 'M', texto: t('Hombre') }, { valor: 'F', texto: t('Mujer') }], valor: sexo, onChange: v => { sexo = v; repintarClase(); } });
    const eq = segmentado({ etiqueta: t('Equipamiento'), opciones: [{ valor: 'raw', texto: 'Raw' }, { valor: 'equipado', texto: t('Equipado') }], valor: a.equipamiento || 'raw' });
    const club = f('club', t('Club'));
    const nac = f('nacimiento', t('Nacimiento'), { tipo: 'date' });
    const divs = divisionesDe(fed()).map(d => d.nombre);
    const div = select({ etiqueta: t('División'), opciones: [...new Set([...divs, a.division || 'Open'])], valor: a.division || 'Open', onChange: () => repintarClase() });
    const peso = f('peso', t('Peso corporal (kg)'), { modo: 'decimal', onInput: () => repintarClase() });
    const claseSel = select({ etiqueta: t('Clase de peso'), opciones: [], ayuda: t('Se calcula con el peso; cámbiala si pesó distinto.') });
    let claseManual = !!a.clase && a.clase !== claseDe(a.sexo, a.peso, a.division, fed());
    claseSel.entrada.addEventListener('change', () => { claseManual = true; });
    function repintarClase() {
      const p = leerNumero(peso.valor());
      const auto = p > 0 ? claseDe(sexo, p, div.valor(), fed()) : '';
      const ops = ['', ...clasesDe(fed(), sexo, div.valor())];
      claseSel.entrada.replaceChildren(...ops.map(c => el('option', { value: c, text: c || t('Sin clase') })));
      claseSel.poner(claseManual && ops.includes(claseSel.__v) ? claseSel.__v : auto);
      claseSel.__v = claseSel.valor();
    }
    claseSel.entrada.addEventListener('change', () => { claseSel.__v = claseSel.valor(); });
    repintarClase(); if (a.clase) { claseSel.poner(a.clase); claseSel.__v = a.clase; }
    const plat = select({ etiqueta: t('Plataforma'), opciones: [...new Set([...st.plataformas(), a.plataforma])], valor: a.plataforma });
    const sesion = f('sesion', t('Sesión')), grupo = f('grupo', t('Grupo')), lote = f('lote', t('Lote'), { modo: 'numeric' });
    const rS = campo({ etiqueta: t('Rack de sentadilla'), valor: a.rack?.S ?? '', modo: 'numeric' }), rB = campo({ etiqueta: t('Rack de banca'), valor: a.rack?.B ?? '', modo: 'numeric' });
    const ap = ORDEN_LEV.map(l => campo({ etiqueta: t('Apertura de {lev}', { lev: LEV[l].toLowerCase() }), valor: a.intentos?.[l]?.[0]?.kg ?? '', modo: 'decimal' }));
    const cuerpo = el('div.formulario', {}, [
      nombre, el('div.formulario-fila', {}, [el('div.campo', {}, [el('span.campo-etiqueta', { text: t('Sexo') }), sx]), el('div.campo', {}, [el('span.campo-etiqueta', { text: t('Equipamiento') }), eq])]),
      club, el('div.formulario-fila', {}, [nac, div]), el('div.formulario-fila', {}, [peso, claseSel]),
      el('div.formulario-fila', {}, [plat, lote]), el('div.formulario-fila', {}, [sesion, grupo]), el('div.formulario-fila', {}, [rS, rB]),
      el('div.formulario-fila', {}, ap),
    ]);
    const m = modal({ titulo: nuevo ? t('Nuevo atleta') : a.nombre, contenido: cuerpo, acciones: [
      ...(nuevo ? [] : [{ texto: t('Borrar'), icono: 'papelera', variante: 'peligro', onclick: () => { borrar(a0); } }]),
      { texto: t('Cancelar'), variante: 'fantasma' },
      { texto: t('Guardar'), variante: 'primario', cerrar: false, onclick: () => {
        if (!nombre.valor().trim()) { nombre.ponerError(t('Escribe el nombre.')); nombre.entrada.focus(); return false; }
        const p = leerNumero(peso.valor());
        if (peso.valor().trim() && !(p > 0 && p <= 300)) { peso.ponerError(t('Escribe un peso entre 1 y 300 kg.')); return false; }
        const num = c => { const v = leerNumero(c.valor()); return v === null || v < 0 ? null : v; };
        Object.assign(a, { nombre: nombre.valor().trim(), sexo, equipamiento: eq.valor(), club: club.valor().trim(), nacimiento: nac.valor() || null, division: div.valor(), peso: p, clase: claseSel.valor(), plataforma: plat.valor(), sesion: sesion.valor().trim() || '1', grupo: grupo.valor().trim() || 'A', lote: num(lote), rack: { S: num(rS), B: num(rB) } });
        ORDEN_LEV.forEach((l, i) => { (a.intentos[l] ||= [{}, {}, {}])[0].kg = num(ap[i]); });
        st.ponerAtleta(a);
        if (!st.plataformas().includes(a.plataforma)) st.cambiarMeet({ plataformas: [...st.plataformas(), a.plataforma] }).catch(avisoError);
        m.cerrar();
        toast(nuevo ? t('{nombre} se unió al meet.', { nombre: a.nombre }) : t('Cambios guardados.'), { tipo: 'ok' });
        return false;
      } },
    ] });
  }

  function borrar(a) {
    const copia = clonar(a);
    st.quitarAtleta(a.id).catch(avisoError);
    toast(t('{nombre} salió del meet.', { nombre: a.nombre }), { deshacer: () => st.ponerAtleta(copia) });
  }

  /* ---------- importar CSV ---------- */
  function importar() {
    let analisis = null;
    const area = campo({ etiqueta: t('O pega aquí el contenido del CSV'), multilinea: true, filas: 4, placeholder: 'nombre,sexo,club,division,peso,S1,B1,D1' });
    const archivo = el('input', { type: 'file', accept: '.csv,.txt,text/csv', 'aria-label': t('Elegir archivo CSV'), onchange: async e => { const f = e.target.files[0]; if (f) { area.poner(await leerArchivo(f)); revisar(); } } });
    const previa = el('div.org-previa', { 'aria-live': 'polite' });
    const bImportar = boton({ texto: t('Importar'), icono: 'subir', variante: 'primario', deshabilitado: true, cerrar: false });
    function revisar() {
      const txt = area.valor();
      if (!txt.trim()) { analisis = null; reemplazar(previa, el('p.suave.pequeno', { text: t('Elige un archivo o pega el contenido: verás cómo quedaría antes de importar. Si no tienes uno, descarga la plantilla y rellénala en Excel.') })); bImportar.bloquear(true); return; }
      analisis = analizarCSV(txt, { federacion: fed(), plataformas: st.plataformas(), existentes: st.atletas() });
      if (analisis.error) { reemplazar(previa, el('p.campo-error', { role: 'alert', text: msg(analisis.error) })); bImportar.bloquear(true); return; }
      bImportar.bloquear(!analisis.ok);
      bImportar.querySelector('.boton-texto').textContent = analisis.ok ? t('Importar {n} atletas', { n: analisis.ok }) : t('Importar');
      reemplazar(previa, [
        el('div.fila-juntos.org-previa-resumen', {}, [pildora({ texto: t('{n} listos', { n: analisis.ok }), tono: analisis.ok ? 'ok' : 'neutro' }), analisis.conErrores ? pildora({ texto: t('{n} con errores', { n: analisis.conErrores }), tono: 'mal' }) : null, analisis.omitidas ? pildora({ texto: t('{n} omitidos', { n: analisis.omitidas }), tono: 'aviso' }) : null]),
        el('div.tabla-caja', {}, el('table.tabla', {}, [
          el('thead', {}, el('tr', {}, ['Línea', 'Atleta', 'Sexo', 'Peso', 'S1', 'B1', 'D1', 'Estado'].map(h => el('th', { text: t(h) })))),
          el('tbody', {}, analisis.filas.slice(0, 200).map(r => el('tr', { class: r.errores.length ? 'org-fila-mal' : r.omitir ? 'org-fila-aviso' : '' }, [
            el('td.datos', { text: r.n }), el('td', { text: r.atleta?.nombre || '—' }), el('td', { text: r.atleta?.sexo || '' }), el('td.datos', { text: r.atleta?.peso ?? '' }),
            ...ORDEN_LEV.map(l => el('td.datos', { text: r.atleta?.intentos[l][0].kg ?? '' })),
            el('td.org-previa-msg', { text: [...r.errores, ...r.avisos].map(msg).join(' · ') || t('Listo') }),
          ]))),
        ])),
        analisis.filas.length > 200 ? el('p.suave.pequeno', { text: t('Se muestran las primeras 200 líneas.') }) : null,
      ]);
    }
    area.entrada.addEventListener('input', () => revisar());
    revisar();
    const m = modal({ titulo: t('Importar atletas'), contenido: el('div.formulario', {}, [
      el('p.suave.pequeno', { text: t('Un CSV con los títulos en la primera línea. Reconozco nombre, sexo, club, división, peso, tarima, sesión, grupo, lote y las aperturas S1, B1, D1.') }),
      el('div.fila', {}, [archivo, boton({ texto: t('Descargar plantilla'), icono: 'descargar', variante: 'secundario', tam: 'chico', onclick: () => descargar('plantilla-atletas.csv', `﻿${plantillaCSV()}`) })]),
      area, previa,
    ]), acciones: [{ texto: t('Cancelar'), variante: 'fantasma' }] });
    m.el.classList.add('org-ancho');
    bImportar.addEventListener('click', async () => {
      if (!analisis?.ok) return;
      bImportar.cargando(true);
      reemplazar(previa, el('p.suave', { role: 'status', text: t('Guardando a los atletas. Con muchos tarda unos segundos; no cierres esta ventana.') }));
      try {
        const nuevos = prepararImportacion(analisis, st.atletas());
        if (analisis.plataformasNuevas.length) await st.cambiarMeet({ plataformas: [...st.plataformas(), ...analisis.plataformasNuevas] });
        const { api } = await import('../../api.js');
        await api.guardarAtletas(st.id, nuevos);
        nuevos.forEach(a => { if (!st.atletas().some(x => x.id === a.id)) st.atletas().push(a); st.tocados.set(a.id, Date.now()); });
        st.avisar();
        m.cerrar();
        toast(t('{n} atletas importados. Ya puedes abrir la mesa.', { n: nuevos.length }), { tipo: 'ok', accion: { texto: t('Abrir la mesa'), onclick: () => st.irA('mesa') }, deshacer: async () => { for (const a of nuevos) await st.quitarAtleta(a.id); } });
      } catch (e) { avisoError(e); } finally { bImportar.cargando(false); }
    });
    m.el.querySelector('.modal-acciones').append(bImportar);
  }

  /** Sortea los lotes dentro de cada grupo. Deshacer devuelve los anteriores. */
  function sortear() {
    const previos = new Map(st.atletas().map(a => [a.id, a.lote]));
    const porGrupo = new Map();
    st.atletas().forEach(a => { const k = `${a.plataforma}|${a.sesion}|${a.grupo}`; (porGrupo.get(k) || porGrupo.set(k, []).get(k)).push(a); });
    for (const l of porGrupo.values()) {
      const lotes = l.map((_, i) => i + 1);
      for (let i = lotes.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [lotes[i], lotes[j]] = [lotes[j], lotes[i]]; }
      l.forEach((a, i) => { a.lote = lotes[i]; st.ponerAtleta(a); });
    }
    toast(t('Lotes sorteados en cada grupo.'), { tipo: 'ok', deshacer: () => st.atletas().forEach(a => { a.lote = previos.get(a.id) ?? a.lote; st.ponerAtleta(a); }) });
  }

  /* ---------- pintar ---------- */
  function pintar() {
    const todos = st.atletas();
    const plats = st.plataformas();
    const buscar = campo({ etiqueta: t('Buscar'), tipo: 'search', valor: filtro.texto, placeholder: t('Nombre o club'), onInput: v => { filtro.texto = v; pintarLista(); } });
    const selF = (k, etiqueta, valores) => select({ etiqueta, opciones: [{ valor: '', texto: t('Todas') }, ...valores.map(v => ({ valor: v, texto: v }))], valor: filtro[k], onChange: v => { filtro[k] = v; if (k === 'plataforma') { filtro.sesion = ''; filtro.grupo = ''; } if (k === 'sesion') filtro.grupo = ''; pintar(); } });
    reemplazar(barra, [buscar, selF('plataforma', t('Plataforma'), plats), selF('sesion', t('Sesión'), sesionesDe(todos, filtro.plataforma)), selF('grupo', t('Grupo'), gruposDe(todos, filtro.plataforma, filtro.sesion))]);
    pintarLista();
    const f = barra.querySelector('input[type=search]'); void f;
  }
  function pintarLista() {
    const todos = st.atletas();
    const vis = ordenarAtletas(todos).filter(a => (!filtro.plataforma || a.plataforma === filtro.plataforma) && (!filtro.sesion || String(a.sesion) === filtro.sesion) && (!filtro.grupo || a.grupo === filtro.grupo) && (!filtro.texto || contiene(`${a.nombre} ${a.club}`, filtro.texto)));
    resumen.textContent = todos.length ? t('{n} de {total} atletas', { n: vis.length, total: todos.length }) : '';
    if (!todos.length) { reemplazar(lista, vacio({ icono: 'usuarios', titulo: t('Aún no hay atletas'), texto: t('Añádelos uno a uno o importa un CSV con nombre, sexo, peso y aperturas.'), accion: { texto: t('Importar CSV'), icono: 'subir', onclick: importar }, acciones: [{ texto: t('Añadir atleta'), icono: 'plus', onclick: () => editar(null) }] })); return; }
    if (!vis.length) { reemplazar(lista, vacio({ icono: 'buscar', titulo: t('Nadie coincide con ese filtro'), accion: { texto: t('Quitar filtros'), onclick: () => { Object.assign(filtro, { texto: '', plataforma: '', sesion: '', grupo: '' }); pintar(); } } })); return; }
    reemplazar(lista, vis.map(fila));
  }

  const mas = boton({ icono: 'mas', variante: 'secundario', etiqueta: t('Más acciones'), onclick: e => menuContextual(e.currentTarget, [
    { texto: t('Sortear lotes por grupo'), icono: 'rayo', onclick: sortear },
    { texto: t('Descargar plantilla CSV'), icono: 'descargar', onclick: () => descargar('plantilla-atletas.csv', `﻿${plantillaCSV()}`) },
  ]) });
  const nodo = el('div.apilar.org-atletas-vista', {}, [
    el('div.org-barra', {}, [boton({ texto: t('Añadir atleta'), icono: 'plus', variante: 'primario', onclick: () => editar(null) }), boton({ texto: t('Importar CSV'), icono: 'subir', variante: 'secundario', onclick: importar }), mas]),
    barra, resumen, lista,
  ]);
  pintar();
  let tocando = 0;
  const baja = st.escuchar(() => { if (document.activeElement?.closest?.('.org-atletas') && document.activeElement.matches('input')) return; clearTimeout(tocando); tocando = setTimeout(pintarLista, 60); });
  return { nodo, salir: baja, alActivar: pintarLista };
}
