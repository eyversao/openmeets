/* ============================================================
   OPENMEETS — Teléfono del juez  (/juez/:id?t=<plataforma>&p=<izq|cen|der>&c=<código>)
   Botones enormes: VÁLIDO y, según el modo, ROJA/AZUL/AMARILLA (IPF) o NULO.
   Antes de votar: nombre del juez (la primera vez) y aprobación de la mesa (modo mesa o código).
   El juez sabe siempre si su toque funcionó: Enviado · En cola (reintento solo) · No llegó.
   ============================================================ */

import { el } from '../util.js';
import { t } from '../i18n.js';
import { errorEstado, pildoraConexion, boton } from '../ui.js';
import { abrirCanal } from '../canal.js';
import * as C from '../nucleo/competencia.js';
import * as L from '../nucleo/luces-estado.js';
import * as A from '../nucleo/jueces-acceso.js';
import { parametrosJuez, botonesJuez, armarVoto, resumenEnvio, accesoJuez, NOMBRE_JUEZ, anotarVoto, votosJuzgados, cierreJuez } from './juez-datos.js';

const vibrar = patron => { try { if (!matchMedia('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(patron); } catch { /* sin vibración */ } };

export default async function (ctx) {
  const { id } = ctx.params;
  const { plataforma, pos, codigo, valido } = parametrosJuez(ctx.consulta);
  ctx.app.titulo(t('Juez'));
  const raiz = ctx.raiz;
  raiz.classList.add('evp', 'evj', 'evj-mando');

  if (!valido) {
    raiz.replaceChildren(errorEstado({ titulo: t('Enlace incompleto'), texto: t('Este enlace no trae la tarima, la posición o el código de jueces.'), pasos: [t('Pide a la mesa un enlace nuevo o escanea otra vez su código QR.')] }));
    return;
  }

  const canal = abrirCanal(id, { rol: 'juez', codigo });
  const ident = A.identidad(id);
  const s = { meet: null, v: null, votado: null, turno: null, envio: { estado: 'idle', texto: '' }, bateria: null, huella: '', corta: '', cod: '', celebrado: '', cierreVisto: '', cierreMostrado: '' };
  const via = () => 'local';
  let modoPuesto = null;
  const botones = {};

  const titulo = el('b.evj-titulo', { text: `${t(NOMBRE_JUEZ[pos])} · ${plataforma}` });
  const pildora = pildoraConexion(canal.estado());
  const atleta = el('span.evj-atleta', { text: t('Esperando atleta') });
  const estado = el('p.evj-estado', { role: 'status', 'aria-live': 'polite' });
  const envio = el('p.evj-envio', { role: 'status', 'aria-live': 'polite', hidden: true });
  const aviso = el('p.evj-aviso', { role: 'alert', hidden: true });
  const codigoNum = el('b.evj-codigo-num', { 'aria-label': t('Tu código de emparejamiento') });
  const accesoTxt = el('span.evj-acceso-txt');
  const acceso = el('section.evj-acceso', {}, [el('small', { text: t('Tu código') }), codigoNum, accesoTxt]);
  const cierre = el('section.evj-cierre', { hidden: true, role: 'status', 'aria-live': 'polite' });
  const cabecera = () => el('div.evj-cab', {}, [titulo, pildora, atleta]);

  A.huella(ident.secreto).then(h => { s.huella = h; s.corta = A.corta(h); s.cod = A.formatoCodigo(A.codigoPar(h)); presencia(); pintar(); })
    .catch(() => { aviso.textContent = t('Este navegador no permite emparejar el teléfono. Abre este mismo enlace en Chrome o Safari.'); aviso.hidden = false; });

  const modoActual = () => L.modoDe(s.v, s.meet);
  const etiqueta = b => (b === 'blanca' ? t('VÁLIDO') : modoPuesto === 'IPF' ? `${t('NULO')} · ${t(botonesJuez('IPF').find(x => x.id === b)?.texto || '')}` : t('NULO'));

  function armar(modo) {
    modoPuesto = modo;
    raiz.classList.toggle('otra', modo !== 'IPF');
    for (const k of Object.keys(botones)) delete botones[k];
    const bt = b => (botones[b.id] = el('button.evj-bt', { type: 'button', class: b.id, onclick: () => enviar(b.id) }, t(b.texto)));
    const lista = botonesJuez(modo);
    const zona = modo === 'IPF' ? [bt(lista[0]), el('div.evj-fila', {}, lista.slice(1).map(bt))] : lista.map(bt);
    raiz.replaceChildren(cabecera(), acceso, cierre, estado, envio, aviso, ...zona);
  }

  /* Primera vez: el juez escribe su nombre (queda en este teléfono). */
  function pedirNombre() {
    const campo = el('input.evj-nombre-in', { type: 'text', maxlength: '60', autocomplete: 'name', placeholder: t('Tu nombre'), 'aria-label': t('Tu nombre') });
    const seguir = () => {
      const n = campo.value.trim();
      if (!n) { campo.focus(); return; }
      ident.nombre = A.guardarNombre(id, n).nombre;
      modoPuesto = null; presencia(); pintar();
    };
    campo.addEventListener('keydown', e => { if (e.key === 'Enter') seguir(); });
    raiz.replaceChildren(el('div.evj-cab', {}, [titulo, pildora]), el('section.evj-nombre', {}, [
      el('h1', { text: t('¿Cómo te llamas?') }),
      el('p', { text: t('La mesa verá tu nombre para aprobar tu teléfono.') }),
      campo,
      el('button.evj-bt-nombre', { type: 'button', onclick: seguir }, t('Continuar')),
    ]));
    modoPuesto = 'nombre';
    setTimeout(() => campo.focus({ preventScroll: true }), 80);
  }

  function pintar() {
    if (!ident.nombre) { if (modoPuesto !== 'nombre') pedirNombre(); return; }
    const v = s.v, a = v?.actual;
    const modo = modoActual();
    if (modo !== modoPuesto || !botones.blanca?.isConnected) armar(modo);
    const turno = a ? (v.turno || C.turnoDe(a, v.lev)) : null;
    if (turno !== s.turno) { s.turno = turno; s.votado = null; s.envio = { estado: 'idle', texto: '' }; }
    const est = L.estadoLuces(v);
    const revelado = est.revelado;
    const yaVoto = !!s.votado || (!!turno && !!v?.votados?.[pos] && (!v.turno || v.turno === turno));
    const ac = accesoJuez(v, s.meet, s.corta);
    pildora.poner(canal.estado());

    acceso.className = `evj-acceso ${ac.estado}`;
    acceso.hidden = ac.estado === 'abierta';
    acceso.querySelector('small').hidden = !ac.mostrarCodigo;
    codigoNum.hidden = !ac.mostrarCodigo;
    codigoNum.textContent = s.cod || '··· ···';
    accesoTxt.textContent = ac.estado === 'ok' ? t('Aprobado por la mesa')
      : ac.estado === 'no' ? t('La mesa no aprobó este teléfono. Habla con el operador: puede aprobarte otra vez.')
        : ac.modo === 'codigo' ? t('Dile este código al operador de la mesa. Cuando lo escriba, podrás votar; esta pantalla se desbloquea sola.') : t('Ya ven tu nombre en la mesa. Pídele al operador que te apruebe; esta pantalla se desbloquea sola.');
    atleta.textContent = a ? `${a.nombre} · ${String(a.kg).replace('.', ',')} kg` : t('Esperando atleta');

    const res = L.textoResultado(est);
    estado.hidden = !ac.puede;
    estado.className = `evj-estado${res ? ` ${res.clase}` : yaVoto ? ' hecho' : ''}`;
    estado.textContent = res ? t(res.clase === 'valido' ? 'Intento VÁLIDO' : 'Intento NULO')
      : s.votado ? t('Votaste: {voto}', { voto: etiqueta(s.votado) }) : yaVoto ? t('Tu voto ya está en la mesa') : !a ? t('Espera al siguiente intento') : t('Tu voto');
    for (const [b, n] of Object.entries(botones)) {
      n.disabled = !ac.puede || !a || yaVoto || revelado;
      n.classList.toggle('on', s.votado === b);
    }

    /* Final: terminó el grupo o el meet. Se muestra una vez por cierre; el botón deja seguir esperando. */
    const c = cierreJuez(s.meet, v, plataforma);
    if (!c) { s.cierreMostrado = ''; s.cierreVisto = ''; }
    const verCierre = !!c && ac.puede && s.cierreVisto !== c.clave;
    raiz.classList.toggle('evj-final', verCierre);
    cierre.hidden = !verCierre;
    if (verCierre && s.cierreMostrado !== c.clave) { s.cierreMostrado = c.clave; pintarCierre(c); vibrar(40); }

    /* Celebración sobria solo en válido (nunca en nulo). */
    if (res?.clase === 'valido' && yaVoto && s.celebrado !== turno) {
      s.celebrado = turno;
      raiz.classList.add('celebra'); vibrar([30, 50, 30]);
      setTimeout(() => raiz.classList.remove('celebra'), 1600);
    }

    const sinRed = canal.estado() === 'sin-red';
    const e = s.envio.estado === 'idle' && yaVoto && !s.votado ? { estado: 'enviado', texto: 'Enviado' } : s.envio;
    envio.hidden = e.estado === 'idle';
    envio.className = `evj-envio ${e.estado}`;
    envio.textContent = e.estado === 'fallo' ? `${t(e.texto)}. ${t('Vuelve a tocar tu botón.')}` : t(e.texto || '');
    aviso.textContent = sinRed ? t('Sin conexión. Conéctate a la Wi-Fi de la mesa: tu voto se guarda y se envía solo al volver.') : '';
    aviso.hidden = !sinRed;
  }

  function pintarCierre(c) {
    const n = votosJuzgados(id).length;
    const sigue = c.tipo === 'grupo'
      ? boton({ texto: t('Esperar al próximo grupo'), icono: 'reloj', variante: 'primario', ancho: true, onclick: () => { s.cierreVisto = c.clave; pintar(); } })
      : boton({ texto: t('Ver los resultados'), icono: 'trofeo', variante: 'primario', ancho: true, href: `/meets/${encodeURIComponent(id)}` });
    cierre.replaceChildren(
      el('h1', { text: n ? t(n === 1 ? 'Gracias, juzgaste 1 intento' : 'Gracias, juzgaste {n} intentos', { n }) : t('Gracias por estar en la mesa') }),
      el('p', { text: c.tipo === 'meet' ? t('El meet terminó. Gracias por juzgar con calma y atención.') : (c.grupo ? t('El Grupo {g} terminó. Cada intento tuvo su decisión gracias a ti.', { g: c.grupo }) : t('El grupo terminó. Cada intento tuvo su decisión gracias a ti.')) }),
      sigue,
    );
  }

  async function enviar(b) {
    const v = s.v;
    if (!s.turno || s.votado || !accesoJuez(v, s.meet, s.corta).puede || L.estadoLuces(v).revelado) return;
    const voto = armarVoto({ plataforma, pos, codigo, turno: s.turno, boton: b, modo: modoPuesto, ident, via: via() });
    s.votado = b;
    anotarVoto(id, voto.turno);
    s.envio = { estado: 'enviando', texto: 'Enviando…' };
    vibrar(40);
    pintar();
    pedirPantalla();
    const r = await canal.enviarVoto(voto);
    if (s.turno !== voto.turno) return;
    s.envio = resumenEnvio(r);
    if (s.envio.estado === 'fallo') { s.votado = null; anotarVoto(id, voto.turno, { quitar: true }); vibrar([80, 60, 80]); }
    pintar();
  }

  /* Pantalla encendida mientras se juzga (solo con contexto seguro); se pide otra vez al volver a la app. */
  let lock = null;
  async function pedirPantalla() {
    try {
      if (!window.isSecureContext || !navigator.wakeLock || document.visibilityState !== 'visible' || lock) return;
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener?.('release', () => { lock = null; });
    } catch { lock = null; }
  }
  document.addEventListener('visibilitychange', pedirPantalla);
  pedirPantalla();

  try {
    navigator.getBattery?.().then(b => {
      const f = () => { s.bateria = Math.max(0, Math.min(100, Math.round(b.level * 100))); };
      f(); b.addEventListener?.('levelchange', f);
    }).catch(() => {});
  } catch { /* sin batería */ }

  function presencia() {
    if (!ident.nombre || !s.huella) return;
    try { canal.enviarPresencia({ plataforma, pos, bateria: s.bateria, via: via(), codigo, dispositivo: ident.dispositivo, nombre: ident.nombre, huella: s.huella }); } catch { /* sin canal */ }
  }

  canal.alEstado(pintar);
  canal.alCola(n => { if (n === 0 && s.envio.estado === 'cola') { s.envio = { estado: 'enviado', texto: 'Enviado' }; pintar(); } });
  canal.escucharMeet(m => { s.meet = m; pintar(); });
  canal.escucharVivo(m => { s.v = m[plataforma] || null; pintar(); });
  if (canal.votosEnCola()) s.envio = { estado: 'cola', texto: 'En cola: se enviará al volver la red' };
  presencia();
  const pulso = setInterval(() => { presencia(); pintar(); }, 5000);
  pintar();

  ctx.alSalir(() => {
    clearInterval(pulso);
    canal.cerrar();
    document.removeEventListener('visibilitychange', pedirPantalla);
    try { lock?.release(); } catch { /* ya liberada */ }
  });
}
