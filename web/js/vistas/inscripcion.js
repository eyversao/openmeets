/* ============================================================
   OPENMEETS — /meets/:id/inscripcion · formulario público de inscripción
   Estados: cargando, no existe, aún no abre, cerrada, abierta, cupo lleno (lista de espera), enviando, error, enviado.
   Pico y final: la pantalla de confirmación con el código y lo que sigue. Los datos de contacto solo los ve el organizador.
   ============================================================ */

import { el, reemplazar, rangoFechas, copiar, hoy } from '../util.js';
import { t } from '../i18n.js';
import { ins } from '../inscripciones-api.js';
import { boton, campo, select, segmentado, interruptor, errorEstado, esqueletoLista, vacio, toast, icono, pildora } from '../ui.js';
import { divisionesDe } from '../nucleo/federaciones.js';
import { divisionPorEdad, categoriaPropuesta, cabe, estadoApertura } from '../nucleo/inscripcion.js';

const cierreTexto = c => { const d = new Date(c); return Number.isNaN(d.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(d); };
const nombreClase = (sexo, clase) => (clase ? `${sexo === 'F' ? t('Mujeres') : t('Hombres')} ${clase} kg` : '');

export default async function (ctx) {
  const { raiz, params, api, app } = ctx;
  const id = params.id;
  app.estilos('inscripciones');
  app.titulo(t('Inscripción'));
  reemplazar(raiz, el('div.contenedor.contenedor-estrecho', {}, esqueletoLista(3)));

  const volver = () => boton({ texto: t('Ver el meet'), icono: 'flecha-izq', variante: 'secundario', href: `/meets/${encodeURIComponent(id)}` });
  const salida = nodo => reemplazar(raiz, el('div.contenedor.contenedor-estrecho.ins-pagina', {}, nodo));

  let meet, est;
  try { [meet, est] = await Promise.all([api.meet(id), ins.estado(id)]); } catch (e) {
    const noExiste = e.estado === 404;
    salida(errorEstado({ titulo: noExiste ? t('No encontramos este meet') : t('No logramos abrir la inscripción'), texto: noExiste ? e.message : t('Tu teléfono no llegó a OpenMeets. Suele ser la red, no tú.'),
      pasos: noExiste ? [t('Puede que el organizador lo haya ocultado o que el enlace esté mal escrito.')] : [t('Revisa tu conexión a internet o a la Wi-Fi del recinto.'), t('Vuelve a intentarlo en un momento.')],
      reintentar: noExiste ? null : () => app.navegar(location.pathname, { reemplazar: true }) }));
    return;
  }
  app.titulo(`${t('Inscripción')} · ${meet.nombre}`);
  const cfg = est.config || {};
  const fed = meet.federacion || 'IPF';
  const lugar = [meet.sede, meet.ciudad, meet.pais].filter(Boolean).join(' · ');
  const cabecera = el('header.ins-cab', {}, [
    el('p.etiqueta', { text: t('Inscripción') }),
    el('h1.titular.ins-titulo', { text: meet.nombre }),
    el('p.subtitulo', { text: [rangoFechas(meet.fecha, meet.fechaFin), lugar, meet.federacion].filter(Boolean).join(' · ') }),
  ]);

  const ap = estadoApertura(cfg);
  if (!ap.abierta) {
    const nunca = !est.config;
    salida([cabecera, vacio({
      icono: 'calendario',
      titulo: ap.motivo === 'cierre' ? t('Las inscripciones cerraron') : nunca ? t('Las inscripciones aún no abren') : t('Las inscripciones están en pausa'),
      texto: ap.motivo === 'cierre' ? t('Cerraron el {cuando}. Si todavía quieres competir, escríbele al organizador: a veces queda un lugar.', { cuando: cierreTexto(cfg.cierre) }) : t('El organizador todavía no las ha abierto. Vuelve a esta página más tarde o pregúntale cuándo salen.'),
      accion: { texto: t('Ver el meet'), icono: 'flecha-izq', href: `/meets/${encodeURIComponent(id)}` },
    })]);
    return;
  }

  /* ---------- formulario ---------- */
  const permitidas = divisionesDe(fed).filter(d => !cfg.divisiones?.length || cfg.divisiones.includes(d.nombre));
  const equipos = cfg.equipamiento?.length ? cfg.equipamiento : ['raw', 'equipado'];
  const nombre = campo({ etiqueta: t('Nombre y apellido'), requerido: true, autocompletar: 'name', maxlength: 80 });
  let sexo = 'M';
  const sx = segmentado({ etiqueta: t('Sexo'), opciones: [{ valor: 'M', texto: t('Hombre') }, { valor: 'F', texto: t('Mujer') }], valor: sexo, onChange: v => { sexo = v; actualizar(); } });
  const nac = campo({ etiqueta: t('Fecha de nacimiento'), tipo: 'date', requerido: true, autocompletar: 'bday', max: hoy(), onChange: () => sugerirDivision(true) });
  const div = select({ etiqueta: t('División'), opciones: permitidas.map(d => ({ valor: d.nombre, texto: d.edad ? `${d.nombre} (${d.edad})` : d.nombre })), onChange: () => { divisionTocada = true; actualizar(); } });
  let divisionTocada = false;
  const club = campo({ etiqueta: t('Club o equipo (opcional)'), maxlength: 80 });
  const peso = campo({ etiqueta: t('Peso corporal estimado (kg)'), modo: 'decimal', requerido: true, placeholder: '82,5', onInput: () => actualizar() });
  const claseNota = el('p.ins-clase', { 'aria-live': 'polite' });
  let equipo = equipos[0];
  const eq = segmentado({ etiqueta: t('Equipamiento'), opciones: equipos.map(e => ({ valor: e, texto: e === 'raw' ? 'Raw' : t('Equipado') })), valor: equipo, onChange: v => { equipo = v; } });
  const aper = ['S', 'B', 'D'].map(l => campo({ etiqueta: { S: t('Sentadilla'), B: t('Banca'), D: t('Peso muerto') }[l] + ' (kg)', modo: 'decimal', placeholder: t('Opcional') }));
  const contacto = campo({ etiqueta: t('Correo o teléfono'), requerido: true, autocompletar: 'email', ayuda: t('Solo lo ve el organizador. Lo usa para confirmarte; nunca aparece en la página del meet.') });
  const preguntas = (cfg.preguntas || []).map(p => ({ p, c: p.tipo === 'si-no'
    ? select({ etiqueta: p.texto + (p.obligatoria ? '' : ` (${t('opcional')})`), opciones: [{ valor: '', texto: t('Elige…') }, { valor: 'si', texto: t('Sí') }, { valor: 'no', texto: 'No' }] })
    : campo({ etiqueta: p.texto + (p.obligatoria ? '' : ` (${t('opcional')})`), maxlength: 200 }) }));
  const acepto = interruptor({ etiqueta: t('Acepto el reglamento del meet'), ayuda: t('Declaro que mis datos son verdaderos y que compito bajo mi responsabilidad.') });
  const reglamento = cfg.reglamentoUrl ? el('a.ins-enlace', { href: cfg.reglamentoUrl, target: '_blank', rel: 'noopener noreferrer', text: t('Leer el reglamento') }) : null;
  const aviso = el('div.ins-aviso', { role: 'status', hidden: true });
  const errorForm = el('p.campo-error.ins-error', { role: 'alert', hidden: true });
  const enviar = boton({ texto: t('Inscribirme'), icono: 'check', variante: 'primario', tam: 'grande', tipo: 'submit', ancho: true });

  function sugerirDivision(forzar) {
    const s = divisionPorEdad(fed, nac.valor(), meet.fecha || hoy());
    if (s && permitidas.some(d => d.nombre === s) && (forzar ? !divisionTocada : true)) { div.poner(s); }
    div.querySelector('.campo-ayuda')?.remove();
    const a = el('p.campo-ayuda', { text: s ? t('Sugerida por tu edad. Cámbiala si compites en otra.') : nac.valor() ? t('Elige tu división: este reglamento no la define por edad.') : '' });
    if (a.textContent) div.insertBefore(a, div.querySelector('.campo-error'));
    actualizar();
  }
  const clasePropuesta = () => categoriaPropuesta(fed, sexo, Number(peso.valor().replace(',', '.')), div.valor());
  /** Categoría propuesta y si el cupo se acabó (entonces se queda en lista de espera). */
  function actualizar() {
    const clase = clasePropuesta();
    const llenaTotal = !!(cfg.cupoTotal && est.cupos.ocupados >= cfg.cupoTotal);
    const llenaCat = clase && !cabe({ cupoCategoria: cfg.cupoCategoria }, { ocupados: 0, porClase: est.cupos.porClase }, sexo, clase);
    const noAdmitida = clase && cfg.clases?.length && !cfg.clases.includes(clase);
    claseNota.replaceChildren(clase ? el('span', {}, [t('Tu categoría propuesta: '), el('strong.datos', { text: nombreClase(sexo, clase) })]) : el('span.suave', { text: t('Escribe tu peso y te digo en qué categoría competirías.') }));
    claseNota.classList.toggle('ins-clase-mal', !!noAdmitida);
    if (noAdmitida) claseNota.append(el('span', { text: ` · ${t('este meet no admite esa categoría')}` }));
    const espera = llenaTotal || llenaCat;
    aviso.hidden = !espera;
    if (espera) reemplazar(aviso, [icono('usuarios'), el('span', { text: llenaTotal ? t('El cupo del meet está lleno. Puedes inscribirte igual: quedarás en lista de espera y te avisamos si se libera un lugar.') : t('El cupo de tu categoría está lleno. Puedes inscribirte igual: quedarás en lista de espera.') })]);
    enviar.querySelector('.boton-texto').textContent = espera ? t('Anotarme en la lista de espera') : t('Inscribirme');
  }

  const form = el('form.formulario.ins-form', { novalidate: true }, [
    el('section.panel.ins-bloque', {}, [el('h2.org-sub', { text: t('Tú') }), nombre, el('div.formulario-fila', {}, [el('div.campo', {}, [el('span.campo-etiqueta', { text: t('Sexo') }), sx]), nac]), club]),
    el('section.panel.ins-bloque', {}, [el('h2.org-sub', { text: t('Cómo vas a competir') }), div, el('div.formulario-fila', {}, [peso, el('div.campo', {}, [el('span.campo-etiqueta', { text: t('Categoría') }), claseNota])]), el('div.campo', {}, [el('span.campo-etiqueta', { text: t('Equipamiento') }), eq])]),
    el('section.panel.ins-bloque', {}, [el('h2.org-sub', { text: t('Tus marcas (opcional)') }), el('p.suave.pequeno', { text: t('Tus mejores marcas o las aperturas que piensas hacer. Ayuda a armar los grupos; puedes cambiarlas en el pesaje.') }), el('div.formulario-fila.ins-tres', {}, aper)]),
    el('section.panel.ins-bloque', {}, [el('h2.org-sub', { text: t('Contacto') }), contacto, ...preguntas.map(x => x.c)]),
    el('section.panel.ins-bloque', {}, [acepto, reglamento]),
    aviso, errorForm, enviar,
  ]);

  const leerPeso = () => { const n = Number(peso.valor().trim().replace(',', '.')); return Number.isFinite(n) ? n : NaN; };
  function validar() {
    let primero = null;
    const falla = (c, msg) => { c.ponerError(msg); primero ||= c; };
    if (nombre.valor().trim().split(/\s+/).filter(Boolean).length < 2) falla(nombre, t('Escribe tu nombre y tu apellido.'));
    if (!nac.valor()) falla(nac, t('Escribe tu fecha de nacimiento.'));
    else if (nac.valor() > hoy() || nac.valor() < '1920-01-01') falla(nac, t('Esa fecha no parece correcta.'));
    const p = leerPeso();
    if (!(p >= 20 && p <= 300)) falla(peso, t('Escribe tu peso en kg, entre 20 y 300.'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contacto.valor().trim()) && contacto.valor().replace(/\D/g, '').length < 7) falla(contacto, t('Escribe un correo o un teléfono válido.'));
    for (const l of aper) { const v = l.valor().trim().replace(',', '.'); if (v && !(Number(v) >= 1 && Number(v) <= 600)) falla(l, t('Entre 1 y 600 kg.')); }
    for (const { p: q, c } of preguntas) if (q.obligatoria && !c.valor().trim()) falla(c, t('Esta respuesta es obligatoria.'));
    if (!acepto.valor()) { errorForm.textContent = t('Para inscribirte debes aceptar el reglamento.'); errorForm.hidden = false; primero ||= acepto.entrada; } else errorForm.hidden = true;
    return primero;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const primero = validar();
    if (primero) { (primero.entrada || primero).focus(); return; }
    enviar.cargando(true);
    try {
      const respuestas = Object.fromEntries(preguntas.map(({ p, c }) => [p.id, c.valor().trim()]));
      const aperturas = Object.fromEntries(['S', 'B', 'D'].map((l, i) => [l, aper[i].valor().trim().replace(',', '.')]).filter(([, v]) => v));
      const r = await ins.inscribir(id, { nombre: nombre.valor(), sexo, nacimiento: nac.valor(), club: club.valor(), division: div.valor(), equipamiento: equipo, pesoEstimado: leerPeso(), contacto: contacto.valor(), acepto: acepto.valor(), aperturas, respuestas });
      confirmacion(r);
    } catch (er) {
      errorForm.textContent = er.sinConexion ? er.message : `${er.message}`;
      errorForm.hidden = false;
      errorForm.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      toast(er.message, { tipo: 'error' });
    } finally { enviar.cargando(false); }
  });

  /* ---------- enviado: pico y final ---------- */
  function confirmacion(r) {
    const espera = r.estado === 'espera';
    const paga = r.precio > 0;
    window.scrollTo(0, 0);
    salida([
      cabecera,
      el('section.panel.ins-listo', { role: 'status' }, [
        el('div.estado-icono.ins-listo-icono', {}, [icono(espera ? 'usuarios' : 'check', { tam: 28 })]),
        el('h2.estado-titulo', { text: espera ? t('Estás en la lista de espera') : t('Recibimos tu inscripción') }),
        el('p.estado-texto', { text: espera ? t('El cupo estaba lleno. Si se libera un lugar, el organizador te escribe.') : t('El organizador la revisa y te confirma por el contacto que dejaste.') }),
        el('div.ins-codigo', {}, [el('span.etiqueta', { text: t('Tu código de inscripción') }), el('strong.datos.ins-codigo-valor', { text: r.codigo, 'aria-label': r.codigo.split('').join(' ') })]),
        el('p.suave.pequeno', { text: t('Guárdalo: lo necesitas para cualquier consulta. Categoría: {c} · {d}.', { c: nombreClase(sexo, r.clase) || '—', d: r.division }) }),
        el('div.fila.ins-listo-acciones', {}, [
          boton({ texto: t('Copiar código'), icono: 'copiar', variante: 'secundario', onclick: async () => { const ok = await copiar(r.codigo); toast(ok ? t('Código copiado.') : t('No se pudo copiar: anótalo.'), { tipo: ok ? 'ok' : 'error' }); } }),
          !espera && paga && r.pagoUrl ? boton({ texto: t('Ir al pago'), icono: 'enlace', variante: 'primario', href: r.pagoUrl, target: '_blank', rel: 'noopener noreferrer' }) : null,
        ]),
        !espera && paga ? el('p.pequeno', { text: r.pagoUrl ? t('Valor: {v} {m}. Pagas en el enlace del organizador; OpenMeets no cobra ni guarda datos de pago. Tu cupo se confirma cuando el organizador vea el pago.', { v: r.precio, m: r.moneda }) : t('Valor: {v} {m}. El organizador te dirá cómo pagar.', { v: r.precio, m: r.moneda }) }) : null,
        cfg.instrucciones && !espera ? el('p.pequeno.ins-instr', { text: cfg.instrucciones }) : null,
        el('div.fila', {}, [volver()]),
      ]),
    ]);
  }

  const encabezado = [];
  if (cfg.precio > 0 || cfg.cierre || cfg.cupoTotal) {
    const fila = [];
    if (cfg.precio > 0) fila.push(pildora({ texto: `${cfg.precio} ${cfg.moneda || ''}`.trim(), tono: 'info' }));
    if (cfg.cierre) fila.push(pildora({ texto: t('Cierran el {cuando}', { cuando: cierreTexto(cfg.cierre) }), tono: 'aviso' }));
    if (cfg.cupoTotal) fila.push(pildora({ texto: t('{n} de {total} lugares', { n: Math.min(est.cupos.ocupados, cfg.cupoTotal), total: cfg.cupoTotal }), tono: est.cupos.ocupados >= cfg.cupoTotal ? 'mal' : 'neutro' }));
    encabezado.push(el('div.fila-juntos.ins-datos', {}, fila));
  }
  if (cfg.instrucciones) encabezado.push(el('p.pequeno.ins-instr', { text: cfg.instrucciones }));
  salida([cabecera, ...encabezado, form]);
  sugerirDivision(false);
  actualizar();
  return () => {};
}
