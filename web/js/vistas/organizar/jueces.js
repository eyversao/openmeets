/* ============================================================
   OPENMEETS — Pestaña «Jueces»: aprobación, código, enlaces con QR para cada posición y mandos
   El enlace de cada juez es  /juez/:id?t=<tarima>&p=<izq|cen|der>&c=<código de jueces>.
   ============================================================ */

import { el, reemplazar, copiar, hace } from '../../util.js';
import { t } from '../../i18n.js';
import { boton, campo, select, segmentado, confirmar, toast, vacio, icono } from '../../ui.js';
import * as C from '../../nucleo/competencia.js';
import * as A from '../../nucleo/jueces-acceso.js';
import { qrTrazo } from '../../nucleo/qr.js';
import { basesParaTelefonos, enlaceJuez } from './logica.js';
import { avisoError } from './comun.js';

const VIAS = { local: 'Red local', red: 'Red', bluetooth: 'Bluetooth', usb: 'USB', teclado: 'Teclado', mando: 'Mando', simulador: 'Simulador' };
const BOTON_TXT = { blanca: 'Válido', roja: 'Nulo', azul: 'Azul', amarilla: 'Amarilla' };
const nombrePos = pos => t(C.POSICIONES.find(([p]) => p === pos)?.[1] || pos);
const AYUDA = {
  abierta: 'Cualquier teléfono con el enlace puede votar. Úsalo solo en una red de confianza.',
  mesa: 'Cada teléfono pide permiso: lo aceptas o rechazas aquí. El código es opcional.',
  codigo: 'Cada teléfono muestra un código de 6 dígitos: pídeselo al juez y escríbelo aquí para aprobarlo.',
};

export function montar(st) {
  const registro = st.registro;
  const codigo = () => st.meet.privado?.codigoJuez || '';

  /* ---------- publicar accesos ---------- */
  function publicarAccesos(p) {
    if (st.mesa && st.mesa.plataforma() === p) { st.mesa.publicar(); return; }
    const prev = st.vivos[p] || { plataforma: p };
    st.vivos = { ...st.vivos, [p]: st.canal.publicarVivo(p, { ...prev, aprobacion: A.modoAprobacion(st.meet), accesos: registro.accesos(p) }) };
  }
  const publicarTodos = () => st.plataformas().forEach(publicarAccesos);

  /* ---------- aprobación y solicitudes ---------- */
  const panel = el('div.apilar');
  const ui = {};
  let firma = '';
  function cambiarModo(v) {
    st.cambiarMeet({ aprobacion: v }).then(() => { publicarTodos(); firma = ''; pintarPanel(); }).catch(avisoError);
  }
  function filaSolicitud(x) {
    const u = ui[x.huella] ||= { codigo: '', recordar: false };
    const c = campo({ etiqueta: t('Código de 6 dígitos'), valor: u.codigo, modo: 'numeric', maxlength: 8, placeholder: '000 000', onInput: v => { u.codigo = v; } });
    const aceptar = () => {
      const txt = u.codigo.trim();
      if (A.modoAprobacion(st.meet) === 'codigo' && !txt) { c.ponerError(t('Escribe el código que ve el juez.')); c.entrada.focus(); return; }
      if (txt && !A.codigoCoincide(x.huella, txt)) { c.ponerError(t('Ese código no es el de este teléfono.')); c.entrada.select(); return; }
      registro.aprobar(x.plataforma, x.pos, x.huella, { nombre: x.nombre, dispositivo: x.dispositivo, recordar: u.recordar });
      delete ui[x.huella]; publicarAccesos(x.plataforma); firma = ''; pintarPanel();
      toast(t('{nombre} aprobado.', { nombre: x.nombre || t('Juez') }), { tipo: 'ok', deshacer: () => { registro.quitar(x.plataforma, x.pos, x.huella); publicarAccesos(x.plataforma); firma = ''; pintarPanel(); } });
    };
    const rechazar = () => {
      registro.rechazar(x.plataforma, x.huella); if (registro.esConocido(x.huella)) registro.olvidar(x.huella);
      delete ui[x.huella]; publicarAccesos(x.plataforma); firma = ''; pintarPanel();
      toast(t('Teléfono rechazado.'), { deshacer: () => { registro.quitar(x.plataforma, x.pos, x.huella); registro.estado.no[x.plataforma] && delete registro.estado.no[x.plataforma][x.huella]; publicarAccesos(x.plataforma); firma = ''; pintarPanel(); } });
    };
    return el('div.org-solicitud', {}, [
      el('div.org-solicitud-quien', {}, [el('strong', { text: x.nombre || t('Sin nombre') }), el('span.pequeno.suave', { text: `${x.plataforma} · ${nombrePos(x.pos)} · ${t('teléfono')} ${String(x.dispositivo).slice(0, 4)}` }), el('span.pequeno.suave.org-hace', { dataset: { ts: String(x.ts) }, text: hace(x.ts) })]),
      c,
      el('label.org-recordar', {}, [el('input', { type: 'checkbox', checked: u.recordar, onchange: e => { u.recordar = e.target.checked; } }), el('span', { text: t('Recordar este juez') })]),
      el('div.fila', {}, [boton({ texto: t('Aceptar'), icono: 'check', variante: 'primario', onclick: aceptar }), boton({ texto: t('Rechazar'), icono: 'x', variante: 'secundario', onclick: rechazar })]),
    ]);
  }
  function pintarPanel() {
    const modo = A.modoAprobacion(st.meet);
    if (modo !== 'abierta') for (const x of registro.paraAutoAprobar(st.presencias)) { registro.aprobar(x.plataforma, x.pos, x.huella, { nombre: x.nombre, dispositivo: x.dispositivo }); publicarAccesos(x.plataforma); toast(t('{nombre} reconectado.', { nombre: x.nombre || t('Juez') }), { tipo: 'ok' }); }
    const sol = modo === 'abierta' ? [] : registro.solicitudes(st.presencias);
    const apr = registro.aprobados(), con = registro.conocidos();
    const nueva = JSON.stringify([modo, sol.map(x => `${x.plataforma}|${x.pos}|${x.huella}|${x.nombre}`), apr.map(x => `${x.plataforma}|${x.pos}|${x.huella}`), con.map(x => x.huella)]);
    if (nueva === firma) { panel.querySelectorAll('.org-hace').forEach(n => { n.textContent = hace(Number(n.dataset.ts)); }); return; }
    firma = nueva;
    const grupo = (titulo, filas, vacioTxt) => el('div.apilar-chico', {}, [el('h3.org-sub', { text: titulo }), ...(filas.length ? filas : [el('p.suave.pequeno', { text: vacioTxt })])]);
    reemplazar(panel, [
      segmentado({ etiqueta: t('Cómo se aprueba a los jueces'), opciones: [{ valor: 'abierta', texto: t('Abierta') }, { valor: 'mesa', texto: t('Aprobar en la mesa') }, { valor: 'codigo', texto: t('Con código') }], valor: modo, onChange: cambiarModo }),
      el('p.suave.pequeno', { text: t(AYUDA[modo]) }),
      modo === 'abierta' ? null : grupo(t('Solicitudes'), sol.map(filaSolicitud), t('Nadie espera. Cuando un juez abra su enlace, aparecerá aquí.')),
      modo === 'abierta' ? null : grupo(t('Aprobados'), apr.map(x => el('div.org-fila-simple', {}, [el('span', {}, [el('strong', { text: x.nombre || t('Sin nombre') }), el('span.suave.pequeno', { text: ` ${x.plataforma} · ${nombrePos(x.pos)}` })]),
        boton({ texto: t('Quitar acceso'), variante: 'secundario', tam: 'chico', onclick: () => { registro.quitar(x.plataforma, x.pos, x.huella); const era = registro.esConocido(x.huella); if (era) registro.olvidar(x.huella); publicarAccesos(x.plataforma); firma = ''; pintarPanel(); toast(t('Acceso quitado a {nombre}.', { nombre: x.nombre || t('juez') }), { deshacer: () => { registro.aprobar(x.plataforma, x.pos, x.huella, { nombre: x.nombre, dispositivo: x.dispositivo, recordar: era }); publicarAccesos(x.plataforma); firma = ''; pintarPanel(); } }); } })])), t('Ningún teléfono aprobado todavía.')),
      grupo(t('Jueces recordados'), con.map(x => el('div.org-fila-simple', {}, [el('span', {}, [el('strong', { text: x.nombre || t('Sin nombre') }), el('span.suave.pequeno', { text: ` ${nombrePos(x.pos)}` })]), boton({ texto: t('Olvidar'), variante: 'fantasma', tam: 'chico', onclick: () => { registro.olvidar(x.huella); firma = ''; pintarPanel(); } })])), t('Ninguno. Marca «Recordar este juez» al aceptar para que entre solo la próxima vez.')),
    ]);
  }

  /* ---------- código y enlaces ---------- */
  const enlaces = el('div.apilar-chico');
  const codigoCaja = el('div.org-codigo');
  const info = st.ctx.app.info() || {};
  const bases = basesParaTelefonos({ origen: location.origin, ips: info.ips || [], puerto: info.puerto });
  let base = bases[0] || location.origin;
  const selBase = bases.length > 1 ? select({ etiqueta: t('Dirección de esta red'), opciones: bases, valor: base, ayuda: t('Si el equipo tiene varias redes, usa la de la Wi-Fi donde están los teléfonos.'), onChange: v => { base = v; pintarEnlaces(); } }) : null;

  function filaEnlace(plataforma, pos) {
    const url = enlaceJuez(base, st.id, plataforma, pos, codigo());
    const qrCaja = el('div.org-qr', { hidden: true });
    let hecho = false;
    const bQr = boton({ texto: 'QR', icono: 'qr', variante: 'secundario', tam: 'chico', 'aria-expanded': 'false', onclick: () => {
      qrCaja.hidden = !qrCaja.hidden; bQr.setAttribute('aria-expanded', String(!qrCaja.hidden));
      if (qrCaja.hidden || hecho) return;
      hecho = true;
      try { const q = qrTrazo(url); qrCaja.replaceChildren(el('svg', { class: 'org-qr-svg', viewBox: `0 0 ${q.tam} ${q.tam}`, role: 'img', 'aria-label': t('Código QR del enlace de {pos}', { pos: nombrePos(pos) }), 'shape-rendering': 'crispEdges' }, [el('rect', { width: q.tam, height: q.tam, fill: '#fff' }), el('path', { d: q.d, fill: '#000' })]), el('p.suave.pequeno', { text: t('Apunta la cámara del teléfono del juez.') })); }
      catch { hecho = false; qrCaja.replaceChildren(el('p.suave.pequeno', { text: t('No se pudo dibujar el QR. Copia el enlace.') })); }
    } });
    return el('div.org-enlace', {}, [
      el('div.org-enlace-fila', {}, [
        el('div.org-enlace-quien', {}, [el('strong', { text: `${plataforma} · ${nombrePos(pos)}` }), el('span.datos.pequeno.suave.truncar', { text: url })]),
        el('div.fila-juntos', {}, [boton({ texto: t('Copiar'), icono: 'copiar', variante: 'secundario', tam: 'chico', onclick: async () => toast((await copiar(url)) ? t('Enlace copiado.') : t('No se pudo copiar.'), { tipo: 'ok' }) }), bQr, boton({ icono: 'enlace', variante: 'fantasma', tam: 'chico', etiqueta: t('Abrir el enlace de {pos}', { pos: nombrePos(pos) }), href: url, target: '_blank', rel: 'noopener', 'data-externo': '' })]),
      ]),
      qrCaja,
    ]);
  }
  function pintarEnlaces() {
    const cod = codigo();
    reemplazar(codigoCaja, [
      el('div', {}, [el('span.etiqueta', { text: t('Código de jueces') }), el('div.org-codigo-num.datos', { text: cod ? `${cod.slice(0, 3)} ${cod.slice(3)}`.trim() : '—' })]),
      boton({ texto: t('Cambiar código'), icono: 'refrescar', variante: 'secundario', tam: 'chico', onclick: async () => {
        if (!(await confirmar({ titulo: t('Cambiar el código de jueces'), texto: t('Los enlaces que ya repartiste dejan de funcionar. Tendrás que enviar los nuevos.'), confirmar: t('Cambiar') }))) return;
        const nuevo = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
        try { await st.cambiarMeet({ privado: { codigoJuez: nuevo } }); pintarEnlaces(); toast(t('Código cambiado. Comparte los enlaces nuevos.'), { tipo: 'ok' }); } catch (e) { avisoError(e); }
      } }),
    ]);
    reemplazar(enlaces, [selBase, ...st.plataformas().flatMap(p => C.POSICIONES.map(([pos]) => filaEnlace(p, pos)))]);
  }

  /* ---------- mandos ---------- */
  const driver = st.driver;
  const mandos = el('div.org-mandos');
  const dispositivos = el('div.apilar-chico');
  const prueba = el('div.ev-luces.grandes');
  const votosPrueba = {};
  const pintarPrueba = () => reemplazar(prueba, C.POSICIONES.map(([p, n]) => { const v = votosPrueba[p]; return el('div.ev-luzcol', {}, [el('div.ev-luz', { class: v ? `${v.luz} revela` : '', 'aria-label': `${t(n)}: ${v ? t(v.luz === 'blanca' ? 'válido' : 'nulo') : t('esperando')}` }), el('small.org-luz-via', { text: v ? t(VIAS[v.via] || v.via) : t(n) }), v?.tarjetas.length ? el('div.ev-tarjetas', {}, v.tarjetas.map(c => el('i.ev-tarjeta', { class: c }))) : null]); }));
  st.alPrueba = (pos, boton_, _s, via) => {
    const modo = st.meet.modo || 'IPF';
    const n = C.normalizarVoto(boton_, modo); if (!n) return;
    votosPrueba[pos] = { ...n, via: via || 'mando' }; pintarPrueba();
    toast(`${nombrePos(pos)}: ${t(BOTON_TXT[boton_] || boton_)}`, { tipo: n.luz === 'blanca' ? 'ok' : 'error', ms: 1200 });
  };
  const senalDe = (pos, voto) => Object.entries(driver.mapa()).find(([, v]) => v.pos === pos && v.voto === voto)?.[0] || t('Sin asignar');
  function pintarMandos() {
    reemplazar(mandos, C.POSICIONES.map(([pos]) => el('div.org-mando-juez', {}, [el('h3.org-sub', { text: nombrePos(pos) }), ...C.BOTONES.map(voto => {
      const b = boton({ texto: t('Aprender'), variante: 'secundario', tam: 'chico', onclick: () => { b.querySelector('.boton-texto').textContent = t('Pulsa el botón…'); driver.aprender(senal => { driver.programar(senal, pos, voto); toast(`${senal} = ${nombrePos(pos)}, ${t(BOTON_TXT[voto])}`, { tipo: 'ok' }); pintarMandos(); }); } });
      return el('div.org-fila-simple', {}, [el('span', {}, [el('strong', { text: t(BOTON_TXT[voto]) }), el('span.datos.pequeno.suave', { text: ` ${senalDe(pos, voto)}` })]), b]);
    })])));
  }
  function pintarDispositivos() {
    const d = driver.dispositivos();
    reemplazar(dispositivos, d.length ? d.map(x => el('div.org-fila-simple', {}, [el('span', {}, [el('i.org-punto', { class: x.conectado ? 'ok' : 'mal' }), ` ${x.nombre}${x.pos ? ` · ${nombrePos(x.pos)}` : ''}`]), el('span.pequeno.suave', { text: [t(VIAS[x.tipo] || x.tipo), x.conectado ? t('conectado') : t('sin señal'), x.bateria != null ? `${Math.round(x.bateria)} %` : null].filter(Boolean).join(' · ') })])) : [el('p.suave.pequeno', { text: t('Ningún mando conectado todavía.') })]);
  }
  const fallo = e => { if (e?.name !== 'NotFoundError' && e?.name !== 'AbortError') toast(t('No se pudo conectar.'), { tipo: 'error' }); };
  const dejar = driver.alEstado(pintarDispositivos);

  const sec = (titulo, hijos, acciones) => el('section.panel.org-seccion', {}, [el('div.fila-entre', {}, [el('h2.org-sec-titulo', { text: titulo }), acciones ? el('div.fila', {}, acciones) : null]), ...hijos]);
  const nodo = el('div.apilar-grande', {}, [
    sec(t('Aprobación de jueces'), [panel]),
    sec(t('Enlaces para los teléfonos'), [el('p.suave.pequeno', { text: t('Cada juez abre su enlace (o escanea su QR) en el teléfono, escribe su nombre y espera a que lo apruebes. No necesita cuenta. Los teléfonos y este equipo deben estar en la misma Wi-Fi o punto de acceso.') }), codigoCaja, el('p.suave.pequeno', { text: t('El enlace lleva el código de jueces: no lo publiques.') }), enlaces]),
    sec(t('Mandos'), [
      el('p.suave.pequeno', { text: t('Sirven teclados, mandos de consola, botones USB o Bluetooth y placas Arduino o ESP32. Pulsa «Aprender» y luego el botón físico; el mapa se guarda en este equipo.') }),
      mandos, el('div.apilar-chico', {}, [el('h3.org-sub', { text: t('Dispositivos') }), dispositivos]), el('div.apilar-chico', {}, [el('h3.org-sub', { text: t('Prueba: pulsa un mando') }), prueba]),
      el('details.org-ayuda', {}, [el('summary', { text: t('Ayuda: qué opción usar') }), el('ul.pequeno', {}, [
        el('li', { text: t('Bluetooth y USB solo funcionan en Chrome o Edge de escritorio (localhost o https); no en iPhone ni Firefox.') }),
        el('li', { text: t('Blanca = válido; roja, azul y amarilla = nulo con esa tarjeta (en modo «Otra» no llevan tarjeta).') }),
        el('li', { text: t('El cableado de la placa y de los mandos ESP32 está en la carpeta «mandos» de OpenMeets.') })])]),
    ], [
      driver.soportaSerie() ? boton({ texto: t('Conectar placa USB'), icono: 'enlace', variante: 'secundario', tam: 'chico', onclick: () => driver.conectarSerie().then(() => toast(t('Placa conectada.'), { tipo: 'ok' })).catch(fallo) }) : null,
      driver.soportaBluetooth() ? boton({ texto: t('Conectar mando Bluetooth'), icono: 'enlace', variante: 'secundario', tam: 'chico', onclick: () => driver.conectarBluetooth().then(() => toast(t('Mando conectado.'), { tipo: 'ok' })).catch(fallo) }) : null,
      boton({ texto: t('Restablecer'), variante: 'fantasma', tam: 'chico', onclick: () => { driver.restablecer(); pintarMandos(); } }),
    ].filter(Boolean)),
  ]);

  pintarPanel(); pintarEnlaces(); pintarMandos(); pintarDispositivos(); pintarPrueba();
  st.presOyentes.add(() => { if (st.tab === 'jueces') pintarPanel(); });
  const reloj = setInterval(() => { if (st.tab === 'jueces') pintarPanel(); }, 1000);
  let clave = '';
  const baja = st.escuchar(() => { const k = codigo() + st.plataformas().join('|'); if (k !== clave) { clave = k; pintarEnlaces(); } });
  return { nodo, alActivar: () => { firma = ''; pintarPanel(); pintarEnlaces(); }, salir: () => { clearInterval(reloj); dejar(); baja(); st.alPrueba = null; } };
}
