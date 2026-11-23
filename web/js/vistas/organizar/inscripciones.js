/* ============================================================
   OPENMEETS — Pestaña «Inscripciones»: configurar, ver quién se inscribió, confirmar, pagos, lista de espera y mensajes.
   Los contactos solo viven aquí (y en el CSV privado). Al confirmar, la persona entra a la lista de atletas del meet.
   ============================================================ */

import { el, reemplazar, contiene, copiar } from '../../util.js';
import { t } from '../../i18n.js';
import { ins } from '../../inscripciones-api.js';
import { boton, campo, select, segmentado, interruptor, modal, toast, vacio, errorEstado, esqueletoLista, pildora, menuContextual, icono } from '../../ui.js';
import { divisionesDe, todasLasClases } from '../../nucleo/federaciones.js';
import { ETIQUETA_ESTADO, contarCupos, estadoApertura, mensajeConfirmacion } from '../../nucleo/inscripcion.js';
import { basesParaTelefonos } from './logica.js';
import { avisoError } from './comun.js';

const TONO = { pendiente: 'aviso', confirmado: 'ok', espera: 'info', rechazado: 'mal' };
const FILTROS = [['todos', 'Todos'], ['pendiente', 'Pendientes'], ['confirmado', 'Confirmados'], ['espera', 'Lista de espera'], ['rechazado', 'Rechazados']];
const PLANTILLA = { abiertas: false, cierre: '', cupoTotal: '', cupoCategoria: '', divisiones: [], clases: [], equipamiento: ['raw', 'equipado'], precio: 0, moneda: 'COP', pagoUrl: '', reglamentoUrl: '', instrucciones: '', preguntas: [] };

export function montar(st) {
  st.ctx.app.estilos('inscripciones');
  const fed = () => st.meet.federacion || 'IPF';
  const e = { sub: 'inscritos', filtro: 'todos', sinPagar: false, texto: '', datos: null, fallo: null };
  const nodo = el('div.apilar.ins-org');
  const cuerpo = el('div.apilar');
  let reloj = 0;

  /* ---------- carga ---------- */
  async function cargar() {
    try { e.datos = await ins.lista(st.id); e.fallo = null; } catch (er) { e.fallo = er; }
    pintar();
  }
  const cfg = () => st.meet.inscripciones || null;
  const enlace = () => {
    const base = basesParaTelefonos({ origen: location.origin, ips: st.ctx.app.info()?.ips || [], puerto: st.ctx.app.info()?.puerto })[0] || location.origin;
    return `${base}/meets/${encodeURIComponent(st.id)}/inscripcion`;
  };

  /* ---------- acciones ---------- */
  async function cambiar(it, campos, { ok, deshacer } = {}) {
    const antes = { estado: it.estado, pagado: it.pagado };
    try {
      const r = await ins.cambiar(st.id, it.id, campos);
      Object.assign(it, r.item);
      if (e.datos) Object.assign(e.datos, { cupos: r.cupos });
      pintar();
      if (ok) toast(ok, { tipo: 'ok', deshacer: deshacer ? () => cambiar(it, { estado: antes.estado, pagado: antes.pagado }) : undefined });
    } catch (er) { avisoError(er); }
  }
  const confirmar = it => cambiar(it, { estado: 'confirmado' }, { ok: t('{nombre} quedó confirmado y ya está en la lista de atletas.', { nombre: it.nombre }), deshacer: true });
  const rechazar = it => { const m = campo({ etiqueta: t('Motivo (opcional, sale en el mensaje)'), multilinea: true, filas: 2, valor: it.nota || '' });
    modal({ titulo: t('Rechazar a {nombre}', { nombre: it.nombre }), contenido: m, acciones: [{ texto: t('Cancelar'), variante: 'fantasma' }, { texto: t('Rechazar'), variante: 'peligro', onclick: () => { cambiar(it, { estado: 'rechazado', nota: m.valor() }, { ok: t('{nombre} fue rechazado.', { nombre: it.nombre }), deshacer: true }); } }] }); };
  function mensaje(it) {
    const texto = mensajeConfirmacion(st.meet, it);
    const area = el('textarea.entrada.ins-mensaje', { readonly: true, rows: 9, 'aria-label': t('Mensaje para copiar') }); area.value = texto;
    modal({ titulo: t('Mensaje para {nombre}', { nombre: it.nombre }), descripcion: t('Cópialo y pégalo en WhatsApp o en un correo. OpenMeets no envía nada.'), contenido: el('div.apilar-chico', {}, [area, el('p.pequeno.suave', {}, [icono('usuario', { tam: 14 }), ` ${it.contacto}`])]),
      acciones: [{ texto: t('Cerrar'), variante: 'fantasma' }, { texto: t('Copiar mensaje'), icono: 'copiar', variante: 'primario', cerrar: false, onclick: async () => { toast((await copiar(texto)) ? t('Mensaje copiado.') : t('No se pudo copiar: selecciónalo y cópialo.'), { tipo: 'ok' }); return false; } }] });
  }

  /* ---------- lista ---------- */
  function fila(it) {
    const precio = cfg()?.precio > 0;
    const acciones = [];
    if (it.estado === 'pendiente' || it.estado === 'espera') acciones.push(boton({ texto: t('Confirmar'), icono: 'check', variante: 'primario', tam: 'chico', onclick: () => confirmar(it) }));
    if (it.estado === 'rechazado') acciones.push(boton({ texto: t('Reactivar'), icono: 'deshacer', variante: 'secundario', tam: 'chico', onclick: () => cambiar(it, { estado: 'pendiente' }) }));
    if (precio && it.estado !== 'rechazado') acciones.push(boton({ texto: it.pagado ? t('Quitar pago') : t('Marcar pagado'), variante: 'secundario', tam: 'chico', onclick: () => cambiar(it, { pagado: !it.pagado }, { ok: it.pagado ? undefined : t('Pago de {nombre} marcado.', { nombre: it.nombre }) }) }));
    acciones.push(boton({ icono: 'mas', variante: 'fantasma', etiqueta: t('Más acciones de {nombre}', { nombre: it.nombre }), onclick: ev => menuContextual(ev.currentTarget, [
      { texto: t('Copiar mensaje'), icono: 'copiar', onclick: () => mensaje(it) },
      it.estado !== 'pendiente' && it.estado !== 'rechazado' ? { texto: t('Volver a pendiente'), icono: 'deshacer', onclick: () => cambiar(it, { estado: 'pendiente' }) } : null,
      it.estado !== 'espera' && it.estado !== 'rechazado' ? { texto: t('Pasar a lista de espera'), icono: 'usuarios', onclick: () => cambiar(it, { estado: 'espera' }, { ok: t('{nombre} pasó a la lista de espera.', { nombre: it.nombre }), deshacer: true }) } : null,
      it.estado !== 'rechazado' ? { texto: t('Rechazar'), icono: 'x', onclick: () => rechazar(it) } : null,
    ].filter(Boolean)) }));
    const extra = (it.respuestas || []).map(r => `${r.texto}: ${r.valor}`);
    return el('article.ins-fila', { dataset: { id: it.id, estado: it.estado } }, [
      el('div.ins-fila-quien', {}, [
        el('div.fila-juntos.ins-fila-nombre', {}, [el('strong.truncar', { text: it.nombre }), pildora({ texto: t(ETIQUETA_ESTADO[it.estado]), tono: TONO[it.estado] }), precio && it.estado !== 'rechazado' ? pildora({ texto: it.pagado ? t('Pagado') : t('Sin pagar'), tono: it.pagado ? 'ok' : 'neutro' }) : null]),
        el('span.suave.pequeno', { text: [it.sexo === 'F' ? t('Mujer') : t('Hombre'), it.club, it.division, it.clase ? `${it.clase} kg` : '', it.equipamiento === 'equipado' ? t('Equipado') : 'Raw'].filter(Boolean).join(' · ') }),
        el('span.pequeno.ins-contacto', {}, [icono('usuario', { tam: 14 }), el('span.datos', { text: it.contacto }), el('span.datos.suave', { text: ` · ${it.codigo}` })]),
        extra.length ? el('span.suave.pequeno', { text: extra.join(' · ') }) : null,
        it.nota ? el('span.suave.pequeno', { text: `${t('Nota')}: ${it.nota}` }) : null,
      ]),
      el('div.ins-fila-acciones', {}, acciones),
    ]);
  }

  function contadores() {
    const items = e.datos?.items || [];
    const c = contarCupos(items);
    const cuenta = est => items.filter(i => i.estado === est).length;
    const c0 = cfg();
    return el('div.ins-resumen', {}, [
      el('div.ins-numero', {}, [el('strong.datos', { text: c0?.cupoTotal ? `${c.ocupados}/${c0.cupoTotal}` : String(c.ocupados) }), el('span.suave.pequeno', { text: c0?.cupoTotal ? t('lugares ocupados') : t('inscritos') })]),
      el('div.ins-numero', {}, [el('strong.datos', { text: String(cuenta('confirmado')) }), el('span.suave.pequeno', { text: t('confirmados') })]),
      el('div.ins-numero', {}, [el('strong.datos', { text: String(items.filter(i => i.estado === 'pendiente' && c0?.precio > 0 && !i.pagado).length) }), el('span.suave.pequeno', { text: t('sin pagar') })]),
      el('div.ins-numero', {}, [el('strong.datos', { text: String(cuenta('espera')) }), el('span.suave.pequeno', { text: t('en espera') })]),
    ]);
  }

  function vistaInscritos() {
    if (e.fallo && !e.datos) return errorEstado({ titulo: t('No se pudieron traer las inscripciones'), texto: e.fallo.message, reintentar: cargar });
    if (!e.datos) return esqueletoLista(3);
    const items = e.datos.items;
    const ap = estadoApertura(cfg());
    const barra = el('div.ins-barra', {}, [
      el('div.ins-enlace-caja', {}, [el('span.etiqueta', { text: t('Enlace para inscribirse') }), el('code.datos.ins-url', { text: enlace() })]),
      el('div.fila', {}, [
        boton({ texto: t('Copiar enlace'), icono: 'copiar', variante: 'secundario', tam: 'chico', onclick: async () => toast((await copiar(enlace())) ? t('Enlace copiado.') : t('No se pudo copiar el enlace.'), { tipo: 'ok' }) }),
        boton({ texto: t('Abrir formulario'), icono: 'enlace', variante: 'secundario', tam: 'chico', href: `/meets/${encodeURIComponent(st.id)}/inscripcion`, target: '_blank', rel: 'noopener', 'data-externo': '' }),
        boton({ texto: t('Exportar CSV privado'), icono: 'descargar', variante: 'secundario', tam: 'chico', href: ins.urlCsv(st.id), download: '', 'data-externo': '' }),
      ]),
    ]);
    const estado = el('p.ins-estado-apertura', {}, [pildora({ texto: ap.abierta ? t('Inscripciones abiertas') : ap.motivo === 'cierre' ? t('Inscripciones cerradas por fecha') : t('Inscripciones cerradas'), tono: ap.abierta ? 'ok' : 'neutro', punto: true }),
      !ap.abierta ? boton({ texto: t('Configurar'), variante: 'fantasma', tam: 'chico', onclick: () => irA('config') }) : null]);
    if (!items.length) return el('div.apilar', {}, [estado, barra, vacio({ icono: 'usuarios', titulo: t('Aún no se ha inscrito nadie'), texto: ap.abierta ? t('Comparte el enlace con tus atletas: cada inscripción aparece aquí al instante.') : t('Abre las inscripciones en «Configurar» y comparte el enlace.'), accion: ap.abierta ? { texto: t('Copiar enlace'), icono: 'copiar', onclick: async () => toast((await copiar(enlace())) ? t('Enlace copiado.') : t('No se pudo copiar el enlace.'), { tipo: 'ok' }) } : { texto: t('Configurar inscripciones'), icono: 'ajustes', onclick: () => irA('config') } })]);
    const vis = items.filter(i => (e.filtro === 'todos' || i.estado === e.filtro) && (!e.sinPagar || (i.estado === 'pendiente' && !i.pagado)) && (!e.texto || contiene(`${i.nombre} ${i.club} ${i.codigo}`, e.texto))).sort((a, b) => b.creado - a.creado);
    const filtros = el('div.ins-filtros', { role: 'group', 'aria-label': t('Filtrar por estado') }, [
      ...FILTROS.map(([k, txt]) => { const n = k === 'todos' ? items.length : items.filter(i => i.estado === k).length; const b = el('button.ins-chip', { type: 'button', 'aria-pressed': String(e.filtro === k && !e.sinPagar), onclick: () => { e.filtro = k; e.sinPagar = false; pintar(); } }, [t(txt), el('span.pestana-conteo', { text: n })]); return b; }),
      cfg()?.precio > 0 ? el('button.ins-chip', { type: 'button', 'aria-pressed': String(e.sinPagar), onclick: () => { e.sinPagar = !e.sinPagar; e.filtro = 'todos'; pintar(); } }, [t('Pendiente de pago'), el('span.pestana-conteo', { text: items.filter(i => i.estado === 'pendiente' && !i.pagado).length })]) : null,
    ]);
    const buscar = campo({ etiqueta: t('Buscar'), tipo: 'search', valor: e.texto, placeholder: t('Nombre, club o código'), onInput: v => { e.texto = v; pintarFilas(); } });
    const filas = el('div.ins-lista', { id: 'ins-filas' });
    const pintarFilas = () => {
      const v = items.filter(i => (e.filtro === 'todos' || i.estado === e.filtro) && (!e.sinPagar || (i.estado === 'pendiente' && !i.pagado)) && (!e.texto || contiene(`${i.nombre} ${i.club} ${i.codigo}`, e.texto))).sort((a, b) => b.creado - a.creado);
      reemplazar(filas, v.length ? v.map(fila) : vacio({ icono: 'buscar', titulo: t('Nadie coincide con ese filtro'), accion: { texto: t('Quitar filtros'), onclick: () => { Object.assign(e, { filtro: 'todos', sinPagar: false, texto: '' }); pintar(); } } }));
    };
    reemplazar(filas, vis.length ? vis.map(fila) : []); pintarFilas();
    return el('div.apilar', {}, [estado, contadores(), barra, filtros, buscar, filas]);
  }

  /* ---------- configurar ---------- */
  function vistaConfig() {
    const c = { ...PLANTILLA, ...(cfg() || {}) };
    const abiertas = interruptor({ etiqueta: t('Inscripciones abiertas'), ayuda: t('Apágalas para pausar el formulario sin borrar nada.'), valor: c.abiertas });
    const cierre = campo({ etiqueta: t('Cierre (fecha y hora)'), tipo: 'datetime-local', valor: c.cierre, ayuda: t('Hora de este equipo. Vacío = sin fecha de cierre.') });
    const cupoTotal = campo({ etiqueta: t('Cupo total'), modo: 'numeric', valor: c.cupoTotal ?? '', placeholder: t('Sin límite'), ayuda: t('Pasado el cupo, la gente queda en lista de espera.') });
    const cupoCategoria = campo({ etiqueta: t('Cupo por categoría (opcional)'), modo: 'numeric', valor: c.cupoCategoria ?? '', placeholder: t('Sin límite'), ayuda: t('Máximo por sexo y clase de peso.') });
    const lista = (nombre, opciones, marcadas, ayuda) => {
      const cajas = opciones.map(o => { const i = el('input', { type: 'checkbox', value: o.valor, checked: marcadas.includes(o.valor) }); return { i, nodo: el('label.ins-chk', {}, [i, el('span', { text: o.texto })]) }; });
      const nodo = el('fieldset.ins-lista-chk', {}, [el('legend.campo-etiqueta', { text: nombre }), el('p.campo-ayuda', { text: ayuda }), el('div.ins-chk-rejilla', {}, cajas.map(x => x.nodo))]);
      nodo.valores = () => cajas.filter(x => x.i.checked).map(x => x.i.value);
      return nodo;
    };
    const divisiones = lista(t('Divisiones permitidas'), divisionesDe(fed()).map(d => ({ valor: d.nombre, texto: d.nombre })), c.divisiones, t('Si no marcas ninguna, se admiten todas.'));
    const clasesTodas = [...new Set([...todasLasClases(fed(), 'M'), ...todasLasClases(fed(), 'F')])];
    const clases = lista(t('Categorías de peso permitidas'), clasesTodas.map(x => ({ valor: x, texto: x })), c.clases, t('Si no marcas ninguna, se admiten todas.'));
    const equipo = segmentado({ etiqueta: t('Equipamiento'), opciones: [{ valor: 'ambos', texto: t('Raw y equipado') }, { valor: 'raw', texto: 'Raw' }, { valor: 'equipado', texto: t('Equipado') }], valor: c.equipamiento.length === 2 ? 'ambos' : c.equipamiento[0] });
    const precio = campo({ etiqueta: t('Precio'), modo: 'decimal', valor: c.precio || '', placeholder: '0', ayuda: t('0 o vacío = gratis.') });
    const moneda = campo({ etiqueta: t('Moneda'), valor: c.moneda, maxlength: 5, placeholder: 'COP' });
    const pagoUrl = campo({ etiqueta: t('Enlace de pago'), tipo: 'url', valor: c.pagoUrl, placeholder: 'https://', ayuda: t('Mercado Pago, Nequi, un enlace de transferencia… OpenMeets no cobra ni guarda datos de pago: solo muestra el enlace.') });
    const reglamentoUrl = campo({ etiqueta: t('Enlace al reglamento (opcional)'), tipo: 'url', valor: c.reglamentoUrl, placeholder: 'https://' });
    const instr = campo({ etiqueta: t('Instrucciones para quien se inscribe'), multilinea: true, filas: 3, valor: c.instrucciones, maxlength: 1000, ayuda: t('Salen en el formulario y en el mensaje de confirmación. Por ejemplo: cómo enviar el comprobante.') });
    let preguntas = c.preguntas.map(p => ({ ...p }));
    const cajaPreguntas = el('div.apilar-chico');
    const pintarPreguntas = () => reemplazar(cajaPreguntas, [
      ...preguntas.map((p, i) => el('div.ins-pregunta', {}, [
        campo({ etiqueta: `${t('Pregunta')} ${i + 1}`, valor: p.texto, maxlength: 120, onInput: v => { p.texto = v; } }),
        select({ etiqueta: t('Tipo'), opciones: [{ valor: 'texto', texto: t('Texto') }, { valor: 'si-no', texto: t('Sí / No') }], valor: p.tipo, onChange: v => { p.tipo = v; } }),
        interruptor({ etiqueta: t('Obligatoria'), valor: p.obligatoria, onChange: v => { p.obligatoria = v; } }),
        boton({ icono: 'papelera', variante: 'fantasma', etiqueta: t('Quitar pregunta {n}', { n: i + 1 }), onclick: () => { preguntas.splice(i, 1); pintarPreguntas(); } }),
      ])),
      preguntas.length < 8 ? boton({ texto: t('Añadir pregunta'), icono: 'plus', variante: 'secundario', tam: 'chico', onclick: () => { preguntas.push({ texto: '', tipo: 'texto', obligatoria: false }); pintarPreguntas(); } }) : el('p.suave.pequeno', { text: t('Máximo 8 preguntas.') }),
    ]);
    pintarPreguntas();
    const estadoGuardado = el('span.suave.pequeno.org-estado-guardado', { role: 'status' });
    const guardar = boton({ texto: t('Guardar configuración'), icono: 'check', variante: 'primario', onclick: async () => {
      const numero = (cmp, nombre) => { const v = cmp.valor().trim().replace(',', '.'); if (v === '') return ''; const n = Number(v); if (!Number.isFinite(n)) { cmp.ponerError(t('{campo} debe ser un número.', { campo: nombre })); return NaN; } return n; };
      const cT = numero(cupoTotal, t('El cupo')), cC = numero(cupoCategoria, t('El cupo')), pr = numero(precio, t('El precio'));
      if ([cT, cC, pr].some(Number.isNaN)) return;
      guardar.cargando(true);
      try {
        const r = await ins.guardarConfig(st.id, { abiertas: abiertas.valor(), cierre: cierre.valor(), cupoTotal: cT, cupoCategoria: cC, divisiones: divisiones.valores(), clases: clases.valores(), equipamiento: equipo.valor() === 'ambos' ? ['raw', 'equipado'] : [equipo.valor()], precio: pr === '' ? 0 : pr, moneda: moneda.valor(), pagoUrl: pagoUrl.valor(), reglamentoUrl: reglamentoUrl.valor(), instrucciones: instr.valor(), preguntas: preguntas.filter(p => p.texto.trim()) });
        st.meet.inscripciones = r.config; st.avisar();
        estadoGuardado.textContent = t('Guardado a las {h}', { h: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
        toast(t('Configuración guardada.'), { tipo: 'ok', accion: { texto: t('Ver inscritos'), onclick: () => irA('inscritos') } });
      } catch (er) { avisoError(er); } finally { guardar.cargando(false); }
    } });
    return el('div.apilar.ins-config', {}, [
      el('section.panel.ins-bloque', {}, [el('h2.org-sub', { text: t('Apertura') }), abiertas, el('div.formulario-fila', {}, [cierre, cupoTotal, cupoCategoria])]),
      el('section.panel.ins-bloque', {}, [el('h2.org-sub', { text: t('Quién puede inscribirse') }), divisiones, clases, equipo]),
      el('section.panel.ins-bloque', {}, [el('h2.org-sub', { text: t('Pago') }), el('div.formulario-fila', {}, [precio, moneda]), pagoUrl, reglamentoUrl, instr]),
      el('section.panel.ins-bloque', {}, [el('h2.org-sub', { text: t('Preguntas extra (opcional)') }), cajaPreguntas]),
      el('div.org-barra-guardar', {}, [estadoGuardado, guardar]),
    ]);
  }

  /* ---------- marco ---------- */
  const selector = segmentado({ etiqueta: t('Vista'), opciones: [{ valor: 'inscritos', texto: t('Inscritos') }, { valor: 'config', texto: t('Configurar') }], valor: e.sub, onChange: v => irA(v) });
  function irA(v) { e.sub = v; selector.poner(v); pintar(); }
  function pintar() {
    if (e.sub === 'config') { if (cuerpo.dataset.vista === 'config') return; cuerpo.dataset.vista = 'config'; reemplazar(cuerpo, vistaConfig()); return; }
    cuerpo.dataset.vista = 'inscritos';
    const foco = document.activeElement?.matches?.('.ins-org input[type=search]');
    reemplazar(cuerpo, vistaInscritos());
    if (foco) cuerpo.querySelector('input[type=search]')?.focus();
  }
  reemplazar(nodo, [selector, cuerpo]);
  pintar(); cargar();
  const sondear = () => { clearInterval(reloj); reloj = setInterval(() => { if (!document.hidden && e.sub === 'inscritos' && !document.activeElement?.closest?.('.ins-org')) cargar(); }, 15000); };
  return { nodo, alActivar: () => { cargar(); sondear(); }, alDesactivar: () => clearInterval(reloj), salir: () => clearInterval(reloj) };
}
