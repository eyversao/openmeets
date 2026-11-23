/* ============================================================
   OPENMEETS — Pantalla de tarima  (/meets/:id/pantalla)
   Siempre oscura, para TV o proyector a pantalla completa. Pre-marcado, luces juntas,
   VÁLIDO/NULO, récord, reloj, carga de discos y siguientes. Sin red: se queda la última
   imagen con su hora y se reconecta sola. También exporta las piezas que usa el HUD.
   ============================================================ */

import { el, hora, plural, puntos as fmtPuntos, kg as fmtKg } from '../util.js';
import { t } from '../i18n.js';
import { api } from '../api.js';
import { pildoraConexion, boton, errorEstado } from '../ui.js';
import { abrirCanal } from '../canal.js';
import * as C from '../nucleo/competencia.js';
import * as L from '../nucleo/luces-estado.js';
import { cargaVisual } from './barra-visual.js';
import * as S from '../nucleo/sonidos.js';
import { plataformaElegida, plataformasDe, vistaTarima, momentoTarima, crearRevisorSonidos, ETIQUETA_ESTADO } from './pantalla-datos.js';

const NOMBRE_POS = Object.fromEntries(C.POSICIONES);
const kgTxt = kg => String(Number(kg) || 0).replace('.', ',');
const CREDITO = 'OpenMeets · creado por Eyver Gomez (@eyversao)';
const sis = f => (f === 'IPF' ? 'GL' : f);

/* ---------- Pico y final: lo que ocupa la tarima cuando no hay atleta ---------- */

const filaPodio = (i, f, formula) => el('li.tv-pod', { class: i === 0 ? 'primero' : '' }, [
  el('span.tv-pod-n.num', { text: i + 1 }),
  el('div.tv-pod-datos', {}, [el('b', { text: f.nombre }), f.club ? el('small', { text: f.club }) : null]),
  el('div.tv-pod-cifras', {}, [el('b.num', { text: fmtKg(f.total) }), f.puntos > 0 ? el('small.num', { text: `${fmtPuntos(f.puntos)} ${sis(formula)}` }) : null]),
]);

/** Grupo terminado, meet terminado o espera útil. Siempre hay algo que leer desde lejos. */
export function vistaFinal(mo, meet) {
  if (mo.tipo === 'grupo') return [
    el('p.tv-meta', { text: t('Final del grupo') }),
    el('h2.tv-final-titulo', { text: mo.grupo ? t('Grupo {g} terminado', { g: mo.grupo }) : t('Grupo terminado') }),
    mo.mejores.length ? el('p.tv-club', { text: t('Los 3 mejores del grupo') }) : el('p.tv-club', { text: t('Nadie sumó un total válido en este grupo. Gracias por levantar.') }),
    mo.mejores.length ? el('ol.tv-podio', {}, mo.mejores.map((f, i) => filaPodio(i, f, mo.formula))) : null,
    el('p.tv-final-pie', { text: t('El siguiente grupo sale en cuanto la mesa lo prepare.') }),
  ];
  if (mo.tipo === 'meet') {
    const r = mo.resumen, mej = (titulo, x) => x ? el('li.tv-mejor', {}, [el('small', { text: titulo }), el('b', {}, [el('span.resaltado', { text: x.a.nombre })]), el('span.num', { text: `${fmtPuntos(x.valor)} ${sis(mo.formula)}` })]) : null;
    return [
      el('p.tv-meta', { text: t('Final del meet') }),
      el('h2.tv-final-titulo', { text: t('Meet terminado') }),
      r.intentos ? el('p.tv-club', { text: [plural(r.atletas, 'atleta', 'atletas'), plural(r.intentos, 'intento', 'intentos'), `${r.pct} % ${t('válidos')}`, plural(r.records, 'récord', 'récords')].join(' · ') }) : el('p.tv-club', { text: t('Gracias por estar aquí.') }),
      el('div.tv-final-cols', {}, [
        r.podioGeneral.length ? el('div.tv-final-col', {}, [el('p.tv-meta', { text: t('Podio por puntos') }), el('ol.tv-podio', {}, r.podioGeneral.map((x, i) => filaPodio(i, { nombre: x.a.nombre, club: x.a.club, total: C.total(x.a), puntos: x.valor }, mo.formula)))]) : null,
        (r.mejores.F || r.mejores.M || r.equipo) ? el('ul.tv-final-col.tv-mejores', {}, [mej(t('Mejor levantadora'), r.mejores.F), mej(t('Mejor levantador'), r.mejores.M),
          r.equipo ? el('li.tv-mejor', {}, [el('small', { text: t('Equipo ganador') }), el('b', { text: r.equipo.club }), el('span.num', { text: t('{n} puntos', { n: r.equipo.puntos }) })]) : null]) : null,
      ]),
      el('p.tv-credito', { text: CREDITO }),
    ];
  }
  if (mo.tipo === 'carga') return [el('p.tv-espera', { text: t('Cargando el meet…') })];
  /* Espera: quién viene y cómo va el grupo */
  const sinNada = !mo.siguientes.length && !mo.clasif.length;
  return [
    el('h2.tv-final-titulo.suave', { text: sinNada && !mo.atletas ? meet?.nombre || 'OpenMeets' : t('Esperando al siguiente atleta') }),
    sinNada ? el('p.tv-club', { text: t('Esta pantalla se actualiza sola. Cuando la mesa llame a un atleta, aparecerá aquí.') }) : null,
    el('div.tv-final-cols', {}, [
      mo.siguientes.length ? el('div.tv-final-col', {}, [el('p.tv-meta', { text: t('Viene ahora') }), el('ol.tv-podio', {}, mo.siguientes.map((x, i) => el('li.tv-pod', { class: i === 0 ? 'primero' : '' }, [el('span.tv-pod-n.num', { text: i + 1 }), el('div.tv-pod-datos', {}, [el('b', { text: x.nombre })]), x.kg ? el('div.tv-pod-cifras', {}, [el('b.num', { text: `${kgTxt(x.kg)} kg` })]) : null])))]) : null,
      mo.clasif.length ? el('div.tv-final-col', {}, [el('p.tv-meta', { text: mo.grupo ? t('Clasificación del grupo {g}', { g: mo.grupo }) : t('Clasificación ahora') }), el('ol.tv-podio', {}, mo.clasif.map((f, i) => filaPodio(i, f, mo.formula)))]) : null,
    ]),
  ];
}

/* ---------- Piezas compartidas con el HUD ---------- */

/** Tres luces: vacía, anillo al votar (pre-marcado, sin color) y color + tarjetas al votar los tres. */
export function bloqueLuces(est, { grandes = true } = {}) {
  const aria = est.revelado ? (est.resultado === 1 ? t('Intento válido') : t('Intento nulo')) : t('Esperando la decisión de los jueces');
  return el(`div.ev-luces${grandes ? '.grandes' : ''}`, { role: 'status', 'aria-label': aria }, C.POSICIONES.map(([p, nombre]) => {
    const luz = est.luces[p];
    const clase = [luz || '', !luz && est.votados[p] ? 'votado' : '', est.revelado ? 'revela' : ''].filter(Boolean).join(' ');
    return el('div.ev-luzcol', {}, [
      el('div.ev-luz', { class: clase, title: t(nombre) }),
      el('div.ev-tarjetas', {}, est.tarjetas[p].map(c => el('i.ev-tarjeta', { class: c }))),
    ]);
  }));
}

/** Aviso de récord (rojo, mayúsculas). Titila antes y al lograrlo; «NO RÉCORD» queda fijo. `vt` es vistaTarima. */
export function bloqueRecord(vt, clase = 'tv-record') {
  if (!vt.recFase) return null;
  const txt = vt.recFase === 'no' ? t('NO RÉCORD') : vt.recNivel === 'otro' ? vt.recEtiqueta : t(vt.recEtiqueta);
  return el('div', { class: `${clase} ${vt.recFase}`, role: 'status' }, [el('span', { text: txt })]);
}

export const bloqueResultado = r => (r ? el('div.ev-resultado', { class: `${r.clase}${r.logrado ? ' rec' : ''}`, role: 'status' }, [el('b', { text: t(r.texto) }), r.rec ? el('small.rec', { text: t(r.rec === 'RÉCORD' ? 'RÉCORD' : 'No récord') }) : null]) : null);

export const bloqueMotivos = motivos => (motivos.length
  ? el('div.ev-motivos', {}, motivos.map(x => el('span', {}, [el('i.ev-tarjeta', { class: x.color }), `${t(NOMBRE_POS[x.pos])}: ${t(x.motivo)}`])))
  : null);

/** Reloj que se mueve con sus data-*: `poner(reloj)` actualiza el estado sin repintar. */
export function nodoReloj(clase = 'ev-reloj') {
  const n = el('div', { class: clase, role: 'timer', 'aria-label': t('Reloj del intento') });
  n.poner = rl => { Object.assign(n.dataset, L.datosReloj(rl)); L.refrescarReloj(n); };
  return n;
}

/* ---------- Conexión con el meet (la usan la pantalla y el HUD) ---------- */

/**
 * Abre el canal, sigue el vivo de una plataforma y revisa los sonidos.
 * `alCambio()` se llama con cada novedad y cada segundo (las luces caducan solas a los 12 s).
 */
export function conectarTarima(id, { plataforma = '', alCambio = () => {}, alTic = () => {} } = {}) {
  const canal = abrirCanal(id, { rol: 'pantalla' });
  const s = { meet: null, vivos: {}, pedida: plataforma, error: null, sonido: false };
  const avisar = () => { try { alCambio(); } catch (e) { console.warn('[openmeets] pantalla', e); } };
  const tocar = f => () => { if (s.sonido) f(); };
  const revisor = crearRevisorSonidos({ chicharra: tocar(S.chicharra), valido: tocar(S.valido), pitido: tocar(S.pitido), final: tocar(S.final) });
  const api0 = {
    s, canal,
    plataforma: () => plataformaElegida(s.meet, s.vivos, s.pedida),
    plataformas: () => plataformasDe(s.meet, s.vivos),
    vivo() { const p = api0.plataforma(); return s.vivos[p] || s.meet?.vivo?.[p] || null; },
    elegir(p) { s.pedida = p; avisar(); },
    /** Con un gesto del usuario: los navegadores no dejan sonar antes. */
    sonido(si) { if (si) { S.activar(true); S.desbloquear(); } s.sonido = !!si; avisar(); },
    cerrar() { clearInterval(pulso); clearInterval(tic); canal.cerrar(); },
  };
  canal.escucharMeet(m => { s.meet = m; avisar(); });
  canal.escucharVivo(v => { s.vivos = v; avisar(); revisor(api0.vivo()); });
  canal.alEstado(avisar);
  api.meet(id).then(m => { if (!s.meet) { s.meet = m; avisar(); } }, e => { if (e.estado === 404 && !s.meet) { s.error = e; avisar(); } });
  const pulso = setInterval(avisar, 1000);
  const tic = setInterval(() => { revisor(api0.vivo()); alTic(); }, 250);
  return api0;
}

/* ---------- Vista ---------- */

export default async function (ctx) {
  const { id } = ctx.params;
  ctx.app.titulo(t('Pantalla'));
  const html = document.documentElement;
  html.classList.add('sin-scroll');
  const raiz = ctx.raiz;
  raiz.classList.add('evp', 'evp-tv');

  /* Zonas: se repintan solo si cambia su contenido, para no repetir animaciones cada segundo. */
  const zTitulo = el('div.tv-titulo'), zAtleta = el('section.tv-atleta', { 'aria-live': 'polite' });
  const zReloj = nodoReloj('ev-reloj tv-reloj'), zLuces = el('div.tv-luces'), zRes = el('div.tv-res'), zMotivos = el('div.tv-motivos');
  const zDecision = el('section.tv-decision', {}, [zReloj, zLuces, zRes, zMotivos]);
  const zSigue = el('footer.tv-sigue');
  const aviso = el('div.tv-aviso', { role: 'status', 'aria-live': 'polite', hidden: true });
  const pildora = pildoraConexion('reconectando');
  const bSonido = boton({ texto: t('Activar sonido'), variante: 'secundario', tam: 'chico', 'aria-pressed': 'false' });
  const bPantalla = boton({ texto: t('Pantalla completa'), icono: 'pantalla', variante: 'secundario', tam: 'chico' });
  const controles = el('div.tv-controles', {}, [pildora, bSonido, document.fullscreenEnabled ? bPantalla : null]);
  const zFinal = el('section.tv-final', { 'aria-live': 'polite', hidden: true });
  raiz.replaceChildren(el('header.tv-cab', {}, [zTitulo, controles]), aviso, el('main.tv-cuerpo', {}, [zAtleta, zDecision, zFinal]), zSigue);

  const poner = (zona, firma, hacer) => { if (zona._f !== firma) { zona._f = firma; zona.replaceChildren(...[].concat(hacer()).filter(Boolean)); } };

  function pintar() {
    const T = tarima;
    const meet = T.s.meet;
    if (T.s.error) {
      raiz.replaceChildren(el('div.tv-error', {}, errorEstado({ titulo: t('No encontramos este meet'), texto: t('El enlace puede estar mal escrito o el meet ya no existe.'), pasos: [t('Pide a la mesa el enlace de la pantalla o escanea otra vez su código QR.')] })));
      return;
    }
    const p = T.plataforma(), plats = T.plataformas(), v = T.vivo();
    const vt = vistaTarima(meet, v);
    const mo = momentoTarima(meet, v, p);
    const estado = mo.tipo === 'meet' ? 'terminado' : vt.estado;
    const conexion = T.canal.estado();
    pildora.poner(conexion);

    /* Sin red: la última imagen se queda y se dice de cuándo es. */
    const ult = T.canal.ultimaHora();
    aviso.hidden = conexion === 'conectado';
    aviso.textContent = conexion === 'conectado' ? '' : (ult ? t('Sin conexión con OpenMeets. Última imagen a las {hora}. Se reconecta sola.', { hora: hora(ult) }) : t('Conectando con OpenMeets. Se reintenta solo.'));

    poner(zTitulo, JSON.stringify([meet?.nombre, p, plats, vt.levNombre, vt.tanda, estado]), () => [
      el('h1.tv-meet', { text: meet?.nombre || 'OpenMeets' }),
      el('div.tv-sub', {}, [
        plats.length > 1
          ? el('label.tv-plat', {}, [el('span', { text: t('Plataforma') }), el('select', { onchange: e => { const u = new URL(location.href); u.searchParams.set('t', e.target.value); history.replaceState({}, '', u); T.elegir(e.target.value); } }, plats.map(x => el('option', { value: x, text: x, selected: x === p })))])
          : el('span', { text: p }),
        vt.levNombre ? el('span', { text: t(vt.levNombre) }) : null,
        vt.tanda ? el('span', { text: t('Tanda {t}', { t: vt.tanda }) }) : null,
        el('span.tv-estado', { class: estado, text: t(ETIQUETA_ESTADO[estado]) }),
      ]),
    ]);

    poner(zAtleta, JSON.stringify([!!meet, vt.hayAtleta, vt.nombre, vt.club, vt.categoria, vt.lev, vt.intento, vt.kg, vt.recFase, vt.recEtiqueta, vt.rack, vt.carga]), () => (!vt.hayAtleta
      ? [meet ? el('p.tv-espera', { text: t('Esperando al siguiente atleta') }) : el('p.tv-espera', { text: t('Cargando el meet…') })]
      : [
        bloqueRecord(vt),
        el('p.tv-meta', {}, [vt.levNombre ? t(vt.levNombre) : null, vt.intento ? t('{n}.º intento', { n: vt.intento }) : null, vt.rack ? t('Rack {n}', { n: vt.rack }) : null].filter(Boolean).join(' · ')),
        el('h2.tv-nombre', { text: vt.nombre }),
        el('p.tv-club', { text: [vt.club, vt.categoria].filter(Boolean).join(' · ') }),
        el('div.tv-kg', {}, [el('span.tv-kg-num', { text: kgTxt(vt.kg) }), el('span.tv-kg-u', { text: 'kg' })]),
        el('div.tv-discos', {}, cargaVisual(vt.carga, { meet, grande: true })),
      ]));

    const final = mo.tipo !== 'atleta';
    zAtleta.hidden = final; zDecision.hidden = final; zFinal.hidden = !final;
    zFinal.dataset.tipo = mo.tipo;
    if (final) poner(zFinal, JSON.stringify(mo), () => vistaFinal(mo, meet));

    zReloj.poner(vt.reloj);
    zReloj.hidden = !vt.hayAtleta;
    poner(zLuces, L.firmaLuces(vt.est) + vt.est.revelado, () => bloqueLuces(vt.est));
    poner(zRes, JSON.stringify(vt.resultado), () => bloqueResultado(vt.resultado));
    poner(zMotivos, JSON.stringify(vt.motivos), () => bloqueMotivos(vt.motivos));
    zDecision.dataset.estado = vt.estado;
    zDecision.classList.toggle('valido', vt.estado === 'decision' && vt.resultado?.clase === 'valido');
    zDecision.classList.toggle('nulo', vt.estado === 'decision' && vt.resultado?.clase === 'nulo');

    poner(zSigue, JSON.stringify(vt.siguientes), () => (vt.siguientes.length
      ? [el('span.tv-sigue-t', { text: t('Siguen') }), ...vt.siguientes.map(x => el('div.tv-sig', {}, [el('b', { text: x.nombre }), el('span.num', { text: `${kgTxt(x.kg)} kg` })]))]
      : []));
    zSigue.hidden = final || !vt.siguientes.length;
  }

  const tarima = conectarTarima(id, { plataforma: ctx.consulta.get('t') || '', alCambio: pintar });

  bSonido.addEventListener('click', () => {
    const si = !tarima.s.sonido;
    tarima.sonido(si);
    bSonido.setAttribute('aria-pressed', String(si));
    bSonido.querySelector('.boton-texto').textContent = si ? t('Sonido activado') : t('Activar sonido');
  });
  const alPantalla = () => { bPantalla.querySelector('.boton-texto').textContent = document.fullscreenElement ? t('Salir de pantalla completa') : t('Pantalla completa'); };
  bPantalla.addEventListener('click', () => { (document.fullscreenElement ? document.exitFullscreen() : html.requestFullscreen?.())?.catch?.(() => {}); });
  document.addEventListener('fullscreenchange', alPantalla);

  /* Pantalla encendida (si el navegador deja) y de nuevo al volver a la pestaña. */
  let lock = null;
  const pedirPantalla = async () => {
    try {
      if (!navigator.wakeLock || document.visibilityState !== 'visible' || lock) return;
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener?.('release', () => { lock = null; });
    } catch { lock = null; }
  };
  document.addEventListener('visibilitychange', pedirPantalla);
  pedirPantalla();

  pintar();
  ctx.alSalir(() => {
    tarima.cerrar();
    document.removeEventListener('fullscreenchange', alPantalla);
    document.removeEventListener('visibilitychange', pedirPantalla);
    try { lock?.release(); } catch { /* ya liberada */ }
    html.classList.remove('sin-scroll');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  });
}
