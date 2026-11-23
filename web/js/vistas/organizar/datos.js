/* ============================================================
   OPENMEETS — Pestaña «Datos»: ficha del meet, reglas, barra y discos, relojes, vídeo y cierre.
   Un solo botón guarda todo lo que cambiaste; avisa si hay cambios sin guardar.
   ============================================================ */

import { el, clonar } from '../../util.js';
import { t } from '../../i18n.js';
import { api } from '../../api.js';
import { boton, campo, select, segmentado, interruptor, confirmar, toast, pildora, icono } from '../../ui.js';
import { FEDERACIONES } from '../../nucleo/federaciones.js';
import { specKg } from '../../nucleo/discos.js';
import { texto as textoReloj } from '../../nucleo/reloj.js';
import { leerTiempo, DISCOS_ESTANDAR } from './logica.js';
import { descargar, avisoError } from './comun.js';
import { mostrarCierre } from './cierre.js';
import { interruptorNube } from '../nube-ui.js';

const seg = n => textoReloj(n * 1000);

export function montar(st) {
  const m = () => st.meet;
  const sec = (titulo, texto, hijos) => el('section.panel.org-seccion', {}, [el('h2.org-sec-titulo', { text: titulo }), texto ? el('p.suave.pequeno', { text: texto }) : null, el('div.formulario', {}, hijos)]);
  let sucio = false;
  const estado = el('span.org-estado-guardado');
  const bGuardar = boton({ texto: t('Guardar cambios'), icono: 'check', variante: 'primario', deshabilitado: true, onclick: guardar });
  const marcar = () => { sucio = true; bGuardar.bloquear(false); reemplazarEstado(); };
  const reemplazarEstado = () => estado.replaceChildren(sucio ? pildora({ texto: t('Cambios sin guardar'), tono: 'aviso' }) : '');
  
  /* ---- campos de texto ---- */
  const cTxt = (k, etiqueta, extra = {}) => campo({ etiqueta, valor: m()[k] ?? '', onInput: marcar, ...extra });
  const nombre = cTxt('nombre', t('Nombre del meet'));
  const fecha = cTxt('fecha', t('Fecha'), { tipo: 'date' });
  const fechaFin = cTxt('fechaFin', t('Hasta (si dura más de un día)'), { tipo: 'date' });
  const sede = cTxt('sede', t('Sede')), ciudad = cTxt('ciudad', t('Ciudad')), pais = cTxt('pais', t('País'));
  const organizador = cTxt('organizador', t('Organiza'));
  const descripcion = campo({ etiqueta: t('Descripción'), multilinea: true, filas: 3, valor: m().descripcion || '', onInput: marcar, ayuda: t('Se ve en la página pública del meet.') });
  const stream = cTxt('stream', t('Transmisión en vivo (enlace)'), { tipo: 'url', placeholder: 'https://www.youtube.com/watch?v=…', ayuda: t('Opcional. Si lo pones, el público ve el vídeo junto a los resultados.') });
  const fed = select({ etiqueta: t('Federación o categorías'), opciones: FEDERACIONES, valor: m().federacion || 'Local', onChange: marcar });
  const publico = interruptor({ etiqueta: t('Visible para el público'), ayuda: t('Apagado: solo tú lo ves en tu lista.'), valor: m().publico !== false, onChange: marcar });
  const modo = segmentado({ etiqueta: t('Modo de jueces'), opciones: [{ valor: 'IPF', texto: t('IPF (tarjetas)') }, { valor: 'otra', texto: t('Otra') }], valor: m().modo || 'IPF', onChange: marcar });
  const formula = select({ etiqueta: t('Fórmula de puntos'), opciones: [{ valor: 'GL', texto: 'GL (IPF)' }, { valor: 'DOTS', texto: 'DOTS' }, { valor: 'Wilks', texto: 'Wilks' }], valor: m().formula === 'IPF' ? 'GL' : (m().formula || 'GL'), onChange: marcar });
  const plataformas = campo({ etiqueta: t('Plataformas (separadas por coma)'), valor: st.plataformas().join(', '), onInput: marcar });

  /* ---- barra y discos ---- */
  const barra = campo({ etiqueta: t('Barra (kg)'), tipo: 'number', modo: 'decimal', valor: m().barra ?? 20, onInput: marcar, step: '0.5', min: '5', max: '50' });
  const barraS = campo({ etiqueta: t('Barra de sentadilla (kg)'), tipo: 'number', modo: 'decimal', valor: m().barraSentadilla ?? '', placeholder: t('La misma'), onInput: marcar, step: '0.5', min: '5', max: '50' });
  const collar = campo({ etiqueta: t('Collar (kg cada uno)'), tipo: 'number', modo: 'decimal', valor: m().collar ?? 2.5, onInput: marcar, step: '0.5', min: '0', max: '10' });
  let discos = clonar(m().discos?.length ? m().discos : []);
  const listaDiscos = el('div.org-discos');
  const pintarDiscos = () => {
    listaDiscos.replaceChildren(...(discos.length ? discos.map((d, i) => el('div.org-disco-fila', {}, [
      el('span.org-disco-muestra', { style: { background: specKg(d.kg).color }, 'aria-hidden': 'true' }),
      campo({ etiqueta: t('Disco (kg)'), tipo: 'number', modo: 'decimal', valor: d.kg, step: '0.25', onInput: v => { d.kg = Number(v) || 0; marcar(); } }),
      campo({ etiqueta: t('Pares'), tipo: 'number', modo: 'numeric', valor: d.pares, min: '0', max: '50', onInput: v => { d.pares = Math.max(0, Number(v) || 0); marcar(); } }),
      boton({ icono: 'papelera', variante: 'fantasma', etiqueta: t('Quitar el disco de {kg} kg', { kg: d.kg }), onclick: () => { discos.splice(i, 1); marcar(); pintarDiscos(); } }),
    ])) : [el('p.suave.pequeno', { text: t('Sin lista de discos: la mesa usa los estándar sin límite. Añade los que tengas para que la carga sea real.') })]));
  };
  pintarDiscos();
  const filaDiscos = el('div.fila', {}, [
    boton({ texto: t('Añadir disco'), icono: 'plus', variante: 'secundario', tam: 'chico', onclick: () => { discos.push({ kg: 1.25, pares: 1 }); marcar(); pintarDiscos(); } }),
    boton({ texto: t('Discos estándar'), icono: 'barra', variante: 'fantasma', tam: 'chico', onclick: () => { discos = clonar(DISCOS_ESTANDAR); marcar(); pintarDiscos(); } }),
  ]);

  /* ---- relojes ---- */
  const relojes = campo({ etiqueta: t('Tiempos del reloj'), valor: (m().relojes?.length ? m().relojes : [60, 180]).map(seg).join(', '), onInput: marcar, ayuda: t('Hasta cuatro, separados por coma. Ejemplo: 1:00, 3:00. Salen como botones en la mesa.') });
  const parar = interruptor({ etiqueta: t('Parar el reloj al primer voto'), valor: m().pararAlVotar !== false, onChange: marcar });

  async function guardar() {
    const campos = {};
    if (!nombre.valor().trim()) { nombre.ponerError(t('El meet necesita un nombre.')); nombre.entrada.focus(); return; }
    if (fechaFin.valor() && fecha.valor() && fechaFin.valor() < fecha.valor()) { fechaFin.ponerError(t('No puede ser antes de la fecha de inicio.')); return; }
    const tiempos = relojes.valor().split(/[,;]+/).map(x => x.trim()).filter(Boolean).map(leerTiempo);
    if (!tiempos.length || tiempos.length > 4 || tiempos.some(x => x === null || x < 1)) { relojes.ponerError(t('Escribe de uno a cuatro tiempos, como 1:00, 3:00.')); relojes.entrada.focus(); return; }
    const b = Number(barra.valor()), c = Number(collar.valor());
    if (!(b >= 5 && b <= 50)) { barra.ponerError(t('Entre 5 y 50 kg.')); return; }
    if (!(c >= 0 && c <= 10)) { collar.ponerError(t('Entre 0 y 10 kg.')); return; }
    const limpios = discos.filter(d => d.kg > 0).map(d => ({ kg: d.kg, pares: d.pares, color: specKg(d.kg).color }));
    const lista = plataformas.valor().split(',').map(x => x.trim()).filter(Boolean);
    Object.assign(campos, {
      nombre: nombre.valor().trim(), fecha: fecha.valor(), fechaFin: fechaFin.valor(), sede: sede.valor().trim(), ciudad: ciudad.valor().trim(), pais: pais.valor().trim(),
      organizador: organizador.valor().trim(), descripcion: descripcion.valor().trim(), stream: stream.valor().trim(), federacion: fed.valor(), publico: publico.valor(),
      modo: modo.valor(), formula: formula.valor(), plataformas: lista.length ? lista : ['Tarima 1'], barra: b, collar: c, discos: limpios, relojes: tiempos.map(x => Math.round(x)), pararAlVotar: parar.valor(),
    });
    if (barraS.valor() !== '') campos.barraSentadilla = Number(barraS.valor());
    bGuardar.cargando(true);
    try {
      await st.cambiarMeet(campos);
      if (barraS.valor() === '' && m().barraSentadilla) delete m().barraSentadilla;
      sucio = false; bGuardar.bloquear(true); reemplazarEstado();
      toast(t('Datos guardados.'), { tipo: 'ok' });
    } catch (e) { avisoError(e); } finally { bGuardar.cargando(false); }
  }

  /* ---- cierre y peligro ---- */
  const cerrado = () => !!m().cerrado;
  const bCerrar = boton({ texto: '…', icono: 'trofeo', variante: 'secundario', onclick: async () => {
    const nuevo = !cerrado();
    if (nuevo && !(await confirmar({ titulo: t('Terminar el meet'), texto: t('Queda como terminado en la lista y en la página pública. Podrás reabrirlo cuando quieras.'), confirmar: t('Terminar meet') }))) return;
    try { await st.cambiarMeet({ cerrado: nuevo }); pintarCierre(); if (nuevo) mostrarCierre(st); else toast(nuevo ? t('Meet terminado.') : t('Meet reabierto.'), { tipo: 'ok', deshacer: async () => { await st.cambiarMeet({ cerrado: !nuevo }); pintarCierre(); } }); } catch (e) { avisoError(e); }
  } });
  const estadoCierre = el('p.suave.pequeno');
  const pintarCierre = () => { bCerrar.querySelector('.boton-texto').textContent = cerrado() ? t('Reabrir el meet') : t('Terminar el meet'); estadoCierre.textContent = cerrado() ? t('Este meet está terminado.') : t('Este meet sigue abierto.'); };
  pintarCierre();

  const nube = interruptorNube(st);
  const nodo = el('div.apilar-grande.org-datos', {}, [
    sec(t('El meet'), null, [nombre, el('div.formulario-fila', {}, [fecha, fechaFin]), sede, el('div.formulario-fila', {}, [ciudad, pais]), organizador, descripcion, stream, publico, nube.nodo]),
    sec(t('Reglas y puntos'), t('La federación define las clases de peso y las divisiones de edad de los atletas.'), [el('div.formulario-fila', {}, [fed, formula]), el('div.campo', {}, [el('span.campo-etiqueta', { text: t('Modo de jueces') }), modo]), plataformas]),
    sec(t('Barra y discos'), t('Con esto la mesa y la pantalla calculan los discos de cada intento.'), [el('div.formulario-fila', {}, [barra, barraS, collar]), listaDiscos, filaDiscos]),
    sec(t('Reloj'), null, [relojes, parar]),
    sec(t('Copia y cierre'), t('Guarda una copia completa (atletas, resultados y registro) o marca el meet como terminado.'), [
      el('div.fila', {}, [bCerrar, boton({ texto: t('Descargar copia (.json)'), icono: 'descargar', variante: 'secundario', onclick: async () => { try { descargar(`${st.id}.json`, JSON.stringify(await api.exportar(st.id), null, 1), 'application/json'); } catch (e) { avisoError(e); } } })]), estadoCierre,
    ]),
    el('div.org-barra-guardar', {}, [estado, bGuardar]),
  ]);
  return { nodo, alMeet: () => {}, alActivar: () => nube.refrescar() };
}
