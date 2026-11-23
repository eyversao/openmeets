/* ============================================================
   OPENMEETS — Pestaña «Mesa»: la mesa de control (portada de la «Dirigir» de VettaPro, sin nube)
   Reloj, peso, luces con pre-marcado, jueces por todas las vías (teléfono, mando, teclado, simulador),
   Deshacer en cada acción que cambia algo, y el vivo publicado por el canal del meet.
   ============================================================ */

import { el, reemplazar, clonar, kg as kgTexto, hace, hora, leerNumero, numero } from '../../util.js';
import { t } from '../../i18n.js';
import { boton, select, segmentado, interruptor, modal, toast, vacio, pildora, pildoraConexion, anillo, icono, menuContextual, campo } from '../../ui.js';
import * as C from '../../nucleo/competencia.js';
import * as R from '../../nucleo/reloj.js';
import * as S from '../../nucleo/sonidos.js';
import * as V from '../../nucleo/mesa-votos.js';
import * as A from '../../nucleo/jueces-acceso.js';
import { cargaVisual } from '../barra-visual.js';
import { sesionesDe, gruposDe, progresoGrupo, textoFaltan, cargaDiscos } from './logica.js';
import { pedirValor, pulsacionLarga } from './comun.js';
import { avisoRecord } from './records-aviso.js';
import { leerTiempo } from './logica.js';

const VIAS = { local: 'Red local', red: 'Red', bluetooth: 'Bluetooth', usb: 'USB', teclado: 'Teclado', mando: 'Mando', simulador: 'Simulador' };
const BOTON_TXT = { blanca: 'Válido', roja: 'Nulo', azul: 'Azul', amarilla: 'Amarilla' };
const nombreRes = r => (r === 1 ? 'Válido' : r === -1 ? 'Nulo' : 'Sin decisión');
const coma = n => numero(n, { max: 2 });

export function montar(st) {
  const f = { plataforma: st.plataformas()[0], sesion: '1', grupo: 'A', lev: 'S' };
  const canal = st.canal;
  const raiz = el('div.apilar.org-mesa');
  const barra = el('div.org-interruptores');
  const controles = el('div.org-controles');
  const host = el('div.apilar');
  const relojEl = el('div.org-reloj.datos', { role: 'timer', tabindex: '0' });
  const chips = el('div.org-chips');
  const lucesHost = el('div.ev-luces.grandes');
  const resultadoEl = el('div.ev-resultado');
  const panelJueces = el('div.org-jueces-estado');
  const simulador = el('div.org-simulador');
  const aviso = el('div.org-aviso-solicitudes');

  let primerRevelado = true, votos = {}, turnoVotos = null, reloj = R.relojNuevo(60), ultFirma = '', toastPeso = null, simulando = false, montado = true;
  const modo = () => st.meet.modo || (st.meet.federacion === 'IPF' ? 'IPF' : 'otra');
  const relojes = () => (Array.isArray(st.meet.relojes) && st.meet.relojes.length ? st.meet.relojes : [60, 180]);
  const pararAlVotar = () => st.meet.pararAlVotar !== false;
  const delGrupo = () => C.delGrupo(st.atletas(), f);
  const vivo = () => st.vivos[f.plataforma] || st.meet.vivo?.[f.plataforma] || {};
  const abierta = () => !A.necesitaAprobacion(st.meet);

  function normalizar() {
    if (!st.plataformas().includes(f.plataforma)) f.plataforma = st.plataformas()[0];
    const ses = sesionesDe(st.atletas(), f.plataforma);
    if (!ses.includes(f.sesion)) f.sesion = ses[0] || '1';
    const gr = gruposDe(st.atletas(), f.plataforma, f.sesion);
    if (!gr.includes(f.grupo)) f.grupo = gr[0] || 'A';
  }
  function relojInicial() {
    const v = vivo();
    if (v.reloj || v.relojHasta) { const r = R.desdeVivo(v); return r.estado === 'corre' && r.hasta < Date.now() ? R.parar(r) : r; }
    return R.relojNuevo(relojes()[0]);
  }
  function actualDe(c = C.cola(delGrupo(), f.lev)) {
    const p = c.orden[0];
    return p ? { aid: p.a.id, nombre: p.a.nombre, club: p.a.club, kg: p.kg, n: p.n, rack: p.a.rack?.[f.lev] ?? '', ...datosRec(p.a.intentos[f.lev][p.n]) } : null;
  }
  /** `rec` (false | true | nivel) y, para «otro», `recTexto`: lo que viaja en actual y juzgado. */
  const datosRec = i => { const rec = C.recValido(i.rec); return rec === 'otro' && i.recTexto ? { rec, recTexto: i.recTexto } : { rec }; };
  function ponerRecord(i, a, rec, recTexto) {
    i.rec = rec;
    if (rec === 'otro') i.recTexto = recTexto ?? i.recTexto ?? ''; else delete i.recTexto;
    st.ponerAtleta(a); publicar();
  }
  const turnoActual = () => C.turnoDe(actualDe(), f.lev);
  function sincronizarTurno() { const x = turnoActual(); if (x !== turnoVotos) { turnoVotos = x; votos = {}; } return x; }
  const estadoJ = () => V.estadoJueces(st.presencias, st.driver.dispositivos(), f.plataforma, Date.now(), (p, pos) => abierta() || st.registro.admite(f.plataforma, pos, p.huella));

  /** Publica TODO el vivo por el canal; lo que no cambia se conserva del último vivo. */
  function publicar(extra = {}) {
    const c = C.cola(delGrupo(), f.lev);
    const actual = actualDe(c);
    sincronizarTurno();
    const prev = vivo();
    const d = {
      sesion: f.sesion, grupo: f.grupo, lev: f.lev, ronda: c.ronda, actual,
      siguientes: c.orden.slice(1, 7).map(x => ({ nombre: x.a.nombre, kg: x.kg, n: x.n })),
      turno: C.turnoDe(actual, f.lev), modo: modo(), aprobacion: A.modoAprobacion(st.meet), accesos: st.registro.accesos(f.plataforma),
      reloj, relojHasta: reloj.estado === 'corre' ? reloj.hasta : null, votados: V.votados(votos), jueces: estadoJ(),
      luces: prev.luces ?? null, lucesTs: prev.lucesTs ?? null, resultadoRec: prev.resultadoRec ?? null, sonido: prev.sonido ?? null,
      siguienteHasta: prev.siguienteHasta ?? null, siguienteDe: prev.siguienteDe ?? null, juzgado: prev.juzgado ?? null, ts: Date.now(), ...extra,
    };
    const pub = canal.publicarVivo(f.plataforma, d);
    st.vivos = { ...st.vivos, [f.plataforma]: pub };
    return pub;
  }
  st.mesa = { publicar, plataforma: () => f.plataforma };

  /* ---------- resultado de un intento ---------- */
  function marcar(r, luces = null) {
    const p = C.cola(delGrupo(), f.lev).orden[0];
    if (!p) return;
    const i = p.a.intentos[f.lev][p.n];
    if (i.r !== null && i.r !== undefined) return;
    const antes = clonar(p.a);
    // La tarima sigue mostrando a quien se juzgó mientras se ven las luces, aunque `actual` ya sea el siguiente.
    const juzgado = { aid: p.a.id, nombre: p.a.nombre, club: p.a.club, kg: p.kg, n: p.n, rack: p.a.rack?.[f.lev] ?? '', ...datosRec(i) };
    i.r = r;
    st.ponerAtleta(p.a);
    votos = {}; canal.limpiarVotos(f.plataforma);
    reloj = R.parar(reloj);
    const ts = Date.now();
    if (S.activo()) (r === 1 ? S.valido : S.chicharra)();
    if (luces && primerRevelado) { primerRevelado = false; picoSobrio(r); }
    publicar({ luces: luces || { izq: null, cen: null, der: null, resultado: r, tarjetas: { izq: [], cen: [], der: [] } }, lucesTs: ts, resultadoRec: i.rec ? r === 1 : null, sonido: { tipo: r === 1 ? 'valido' : 'nulo', ts }, siguienteHasta: ts + 60000, siguienteDe: p.a.nombre, juzgado });
    pintarEnVivo();
    toast(`${p.a.nombre} · ${coma(p.kg)} kg · ${r === 1 ? t('válido') : t('nulo')}`, { tipo: r === 1 ? 'ok' : 'info', deshacer: () => {
      st.ponerAtleta(antes); votos = {}; canal.limpiarVotos(f.plataforma); reloj = R.parar(reloj);
      publicar({ luces: null, lucesTs: null, resultadoRec: null, sonido: null, siguienteHasta: null, siguienteDe: null, juzgado: null });
      pintarEnVivo();
    } });
  }

  /** Pico del recorrido: el primer revelado de luces de la mesa. Brillo sobrio, vibración corta y una línea que lo reconoce. */
  function picoSobrio(r) {
    const panel = lucesHost.closest('.org-luces-panel');
    panel?.classList.remove('org-pico'); void panel?.offsetWidth; panel?.classList.add('org-pico');
    try { navigator.vibrate?.(r === 1 ? [30] : [60]); } catch { /* sin vibración */ }
    toast(t('Primer revelado de luces: la mesa ya funciona de punta a punta.'), { tipo: 'ok' });
  }

  /** Un voto, venga de un teléfono, de un mando o del simulador. */
  function recibir(v) {
    const turno = sincronizarTurno();
    const nuevo = V.aceptarVoto(votos, v, { plataforma: f.plataforma, turno, modo: modo() });
    if (!nuevo) return;
    votos = nuevo;
    if (pararAlVotar() && reloj.estado === 'corre') reloj = R.pausar(reloj);
    const rev = V.revelacion(votos, modo());
    if (rev) { marcar(rev.resultado, rev.luces); return; }
    publicar();                    // pre-marcado: solo se publica quién votó, nunca el color
    pintarLuces(true); tic();
  }
  async function recibirRemoto(v) {
    if (!abierta()) { const ok = await A.verificarVoto(v, st.registro.aprobadosDe(v.plataforma, v.pos)).catch(() => false); if (!ok) return; }
    recibir(v);
  }
  const votoLocal = (pos, boton, via) => recibir({ plataforma: f.plataforma, pos, voto: boton, turno: turnoActual(), via, ts: Date.now() });
  st.alVoto = (pos, b, _s, via) => votoLocal(pos, b, via || 'mando');

  /* ---------- reloj ---------- */
  const setReloj = r => { reloj = r; publicar(); tic(); };
  const iniciarReloj = () => { S.desbloquear(); setReloj(R.iniciar(reloj)); };
  const pausarReloj = () => setReloj(R.pausar(reloj));
  const pararReloj = () => setReloj(R.parar(reloj));
  const alternarReloj = () => (reloj.estado === 'corre' ? pausarReloj() : iniciarReloj());
  const editarReloj = () => pedirValor({ titulo: t('Tiempo del reloj'), etiqueta: t('Minutos y segundos'), valor: R.texto(R.restante(reloj)), ayuda: t('Ejemplo: 1:00, 3:00 o 90 segundos.'),
    aceptar: x => { const s = leerTiempo(x); if (s === null || s < 1) { toast(t('Escribe un tiempo como 1:00.'), { tipo: 'error' }); return false; } setReloj(R.fijar(reloj, s)); return true; } });
  pulsacionLarga(relojEl, editarReloj);
  relojEl.addEventListener('keydown', e => { if (e.key === 'Enter') editarReloj(); });
  function pintarChips() {
    reemplazar(chips, [...relojes().map(s => el('button.org-chip', { type: 'button', class: reloj.duracion === s * 1000 ? 'activo' : '', onclick: () => { setReloj(R.fijar(reloj, s)); pintarChips(); } }, R.texto(s * 1000))),
      boton({ icono: 'editar', variante: 'fantasma', tam: 'chico', etiqueta: t('Editar los tiempos'), onclick: () => pedirValor({ titulo: t('Tiempos del reloj'), etiqueta: t('Preajustes'), valor: relojes().map(s => R.texto(s * 1000)).join(', '), ayuda: t('Hasta cuatro, separados por coma. Ejemplo: 1:00, 3:00.'),
        aceptar: x => { const l = x.split(/[,;\s]+/).filter(Boolean).map(leerTiempo); if (!l.length || l.length > 4 || l.some(s => s === null || s < 1)) { toast(t('Escribe de uno a cuatro tiempos, como 1:00, 3:00.'), { tipo: 'error' }); return false; } st.cambiarMeet({ relojes: l }).then(pintarChips).catch(e => toast(e.message, { tipo: 'error' })); return true; } }) })]);
  }
  function tic() {
    const v = R.restante(reloj);
    const txt = R.texto(v);
    if (relojEl.textContent !== txt) relojEl.textContent = txt;
    relojEl.classList.toggle('corre', reloj.estado === 'corre'); relojEl.classList.toggle('pausa', reloj.estado === 'pausa'); relojEl.classList.toggle('fin', reloj.estado === 'corre' && v <= 10000);
    relojEl.setAttribute('aria-label', t('Reloj {tiempo}. Doble clic para cambiar el tiempo.', { tiempo: txt }));
  }

  /* ---------- luces, jueces ---------- */
  function pintarLuces(forzar = false) {
    const v = vivo();
    const mostrar = !!(v.luces && v.lucesTs && Date.now() - v.lucesTs < 12000);
    const firma = JSON.stringify([mostrar && v.lucesTs, mostrar && v.luces?.resultado, votos]);
    if (!forzar && firma === ultFirma) return;
    ultFirma = firma;
    reemplazar(lucesHost, C.POSICIONES.map(([p, n]) => {
      const voto = votos[p], luz = mostrar ? v.luces[p] : null;
      const tarjetas = mostrar ? v.luces.tarjetas?.[p] || [] : [];
      return el('div.ev-luzcol', {}, [
        el('div.ev-luz', { class: luz ? `${luz} revela` : voto ? 'votado' : '', role: 'img', 'aria-label': `${t(n)}: ${luz ? t(luz === 'blanca' ? 'válido' : 'nulo') : voto ? t('ya votó') : t('esperando')}` }),
        el('small.org-luz-via', { text: voto?.via ? t(VIAS[voto.via] || voto.via) : t(n) }),
        tarjetas.length ? el('div.ev-tarjetas', {}, tarjetas.map(c => el('i.ev-tarjeta', { class: c, title: c }))) : null,
      ]);
    }));
    if (mostrar && v.luces.resultado) {
      const ok = v.luces.resultado === 1;
      resultadoEl.className = `ev-resultado ${ok ? 'valido' : 'nulo'}${v.resultadoRec ? ' rec' : ''}`;
      reemplazar(resultadoEl, [el('b', { text: ok ? t('VÁLIDO') : t('NULO') }), v.resultadoRec != null ? el('small.rec', { text: v.resultadoRec ? t('Récord') : t('No récord') }) : null]);
    } else { resultadoEl.className = 'ev-resultado'; reemplazar(resultadoEl, []); }
  }
  function pintarJueces() {
    const e = estadoJ();
    reemplazar(panelJueces, C.POSICIONES.map(([pos, n]) => {
      const j = e[pos];
      return el('div.org-juez', { class: j.conectado ? 'conectado' : '' }, [
        el('strong', {}, [el('i.org-punto', { class: j.conectado ? 'ok' : 'mal' }), t(n)]),
        el('span.pequeno', { text: j.via ? `${t(VIAS[j.via] || j.via)} · ${j.conectado ? t('conectado') : t('sin señal')}` : t('Sin conectar') }),
        el('span.pequeno.suave', { text: [j.bateria != null ? `${t('Batería')} ${Math.round(j.bateria)} %` : null, j.ts ? hace(j.ts) : null].filter(Boolean).join(' · ') || ' ' }),
      ]);
    }));
    const sol = abierta() ? [] : st.registro.solicitudes(st.presencias);
    reemplazar(aviso, sol.length ? el('div.org-solicitudes', {}, [icono('juez'), el('span', { text: t('{n} juez(ces) esperan que los apruebes.', { n: sol.length }) }), boton({ texto: t('Revisar'), variante: 'secundario', tam: 'chico', onclick: () => st.irA('jueces') })]) : []);
  }
  function pintarSimulador() {
    simulador.hidden = !simulando;
    if (!simulando) { reemplazar(simulador, []); return; }
    const botones = modo() === 'IPF' ? C.BOTONES : C.BOTONES.slice(0, 2);
    reemplazar(simulador, C.POSICIONES.map(([pos, n]) => el('div.org-sim-juez', {}, [el('strong.pequeno', { text: t(n) }), el('div.org-sim-botones', {}, botones.map(b => el('button.org-sim', { type: 'button', class: b, 'aria-label': `${t(n)}: ${t(BOTON_TXT[b])}`, onclick: () => votoLocal(pos, b, 'simulador') }, t(BOTON_TXT[b]))))])));
  }
  /** Selector del nivel de récord del intento en tarima; «Otro» abre un campo de texto (hasta 40 caracteres). */
  function selectorRecord(p) {
    const i = p?.a.intentos[f.lev][p.n];
    const rec = C.recValido(i?.rec);
    const ops = [{ valor: '', texto: t('Ninguno') }, ...(rec === true ? [{ valor: 'true', texto: t('Récord') }] : []), { valor: 'mundial', texto: t('Mundial') }, { valor: 'nacional', texto: t('Nacional') }, { valor: 'ibero', texto: t('Iberoamericano') }, { valor: 'regional', texto: t('Regional') }, { valor: 'otro', texto: t('Otro…') }];
    const cambia = v => { const q = C.cola(delGrupo(), f.lev).orden[0]; if (!q) return; ponerRecord(q.a.intentos[f.lev][q.n], q.a, v === 'true' ? true : v || false); pintarEnVivo(); };
    const texto = rec === 'otro' ? el('input.entrada', { type: 'text', maxlength: C.MAX_REC_TEXTO, value: i.recTexto || '', placeholder: t('Ej.: Récord Panamericano'), 'aria-label': t('Texto del récord'),
      oninput: e => { const q = C.cola(delGrupo(), f.lev).orden[0]; if (q) ponerRecord(q.a.intentos[f.lev][q.n], q.a, 'otro', e.target.value.slice(0, C.MAX_REC_TEXTO)); }, onchange: () => pintarEnVivo() }) : null;
    return el('div.apilar', {}, [select({ etiqueta: t('Intento de récord'), opciones: ops, valor: rec === true ? 'true' : rec || '', deshabilitado: !p, onChange: cambia }), texto]);
  }
  function pintarBarra() {
    const p = C.cola(delGrupo(), f.lev).orden[0];
    reemplazar(barra, [
      el('div.campo', {}, [el('span.campo-etiqueta', { text: t('Modo de jueces') }), segmentado({ opciones: [{ valor: 'IPF', texto: t('IPF (tarjetas)') }, { valor: 'otra', texto: t('Otra') }], valor: modo(), onChange: v => { st.cambiarMeet({ modo: v }).then(() => { pintarSimulador(); publicar(); }).catch(e => toast(e.message, { tipo: 'error' })); } })]),
      selectorRecord(p),
      avisoRecord({ p, lev: f.lev, meet: st.meet, app: st.ctx.app, onMarcar: (nv, tx) => { const q = C.cola(delGrupo(), f.lev).orden[0]; if (q) { ponerRecord(q.a.intentos[f.lev][q.n], q.a, nv, tx); pintarEnVivo(); } } }),
      interruptor({ etiqueta: t('Parar el reloj al primer voto'), valor: pararAlVotar(), onChange: v => st.cambiarMeet({ pararAlVotar: v }).catch(e => toast(e.message, { tipo: 'error' })) }),
      interruptor({ etiqueta: t('Sonido'), valor: S.activo(), onChange: v => { S.activar(v); if (v) { S.desbloquear(); S.pitido(); } } }),
      interruptor({ etiqueta: t('Simulador de jueces'), valor: simulando, onChange: v => { simulando = v; pintarSimulador(); } }),
    ]);
  }
  function pintarControles() {
    normalizar();
    const sel = (etiqueta, ops, k, tr) => select({ etiqueta, opciones: ops.map(v => ({ valor: v, texto: tr ? tr(v) : v })), valor: f[k], onChange: v => {
      f[k] = v; votos = {}; turnoVotos = null; if (k === 'plataforma') { normalizar(); reloj = relojInicial(); }
      pintarControles(); pintarEnVivo(); publicar({ luces: null, lucesTs: null, resultadoRec: null });
    } });
    reemplazar(controles, [sel(t('Plataforma'), st.plataformas(), 'plataforma'), sel(t('Sesión'), sesionesDe(st.atletas(), f.plataforma).length ? sesionesDe(st.atletas(), f.plataforma) : [f.sesion], 'sesion'),
      sel(t('Grupo'), gruposDe(st.atletas(), f.plataforma, f.sesion).length ? gruposDe(st.atletas(), f.plataforma, f.sesion) : [f.grupo], 'grupo'), sel(t('Levantamiento'), C.ORDEN_LEV, 'lev', v => t(C.LEVANTES[v]))]);
  }

  /* ---------- peso ---------- */
  function cambiarKg(a, l, n, v, { avisar = true } = {}) {
    const i = a.intentos[l][n];
    const bloqueo = C.bloqueoCambioPeso(i, v, C.pesoMinimo(a, l, n));
    if (bloqueo) { toast(bloqueo, { tipo: 'error' }); return false; }
    const antes = { kg: i.kg, cambios: i.cambios };
    C.cambiarPeso(i, v);
    st.ponerAtleta(a); publicar();
    if (avisar && antes.kg !== v) {
      toastPeso?.cerrar();
      toastPeso = toast(t('{nombre}: {de} → {a} kg', { nombre: a.nombre, de: coma(antes.kg), a: coma(v) }), { deshacer: () => { i.kg = antes.kg; if (antes.cambios === undefined) delete i.cambios; else i.cambios = antes.cambios; st.ponerAtleta(a); publicar(); pintarEnVivo(); } });
    }
    return true;
  }
  function celdaIntento(a, l, n) {
    const i = a.intentos[l][n];
    const inp = el('input.entrada.org-mini', { type: 'text', inputmode: 'decimal', value: i.kg ?? '', 'aria-label': t('Intento {n} de {nombre}', { n: n + 1, nombre: a.nombre }), class: i.r === 1 ? 'buena' : i.r === -1 ? 'mala' : '',
      onchange: e => { const x = e.target.value.trim() === '' ? null : leerNumero(e.target.value); if (x !== null && !(x >= 0 && x <= 1000)) { e.target.value = i.kg ?? ''; return; } if (!cambiarKg(a, l, n, x)) e.target.value = i.kg ?? ''; } });
    const menu = boton({ icono: 'mas', variante: 'fantasma', tam: 'chico', etiqueta: t('Opciones del intento {n} de {nombre}', { n: n + 1, nombre: a.nombre }), onclick: ev => {
      const decidido = i.r === 1 || i.r === -1;
      const cambia = (fn, texto) => { const antes = clonar(a); fn(); st.ponerAtleta(a); publicar(); pintarEnVivo(); toast(texto, { deshacer: () => { st.ponerAtleta(antes); publicar(); pintarEnVivo(); } }); };
      menuContextual(ev.currentTarget, [
        ...(decidido ? [{ texto: t('Cambiar decisión'), icono: 'refrescar', onclick: () => cambiarDecision(a, l, n, i) }] : [{ texto: t('Marcar válido'), icono: 'check', onclick: () => cambia(() => { i.r = 1; }, t('Marcado como válido.')) }, { texto: t('Marcar nulo'), icono: 'x', onclick: () => cambia(() => { i.r = -1; }, t('Marcado como nulo.')) }]),
        ...(C.fueCambiado(i) ? [{ texto: t('Ver cambios de decisión'), icono: 'documento', onclick: () => verHistorial(i) }] : []),
        { texto: i.alFinal ? t('Volver a su orden') : t('Mover al final de la ronda'), icono: 'flecha-der', onclick: () => cambia(() => { i.alFinal = !i.alFinal; i.r = null; }, t('Orden cambiado.')) },
        ...[['mundial', 'Récord mundial'], ['nacional', 'Récord nacional'], ['ibero', 'Récord iberoamericano'], ['regional', 'Récord regional']].map(([nv, tx]) => ({ texto: t(tx), icono: 'trofeo', onclick: () => cambia(() => ponerRecord(i, a, nv), t('Listo.')) })),
        { texto: t('Otro récord…'), icono: 'trofeo', onclick: () => pedirValor({ titulo: t('Texto del récord'), etiqueta: t('Ej.: Récord Panamericano'), valor: i.recTexto || '', aceptar: x => { if (!x.trim()) return false; cambia(() => ponerRecord(i, a, 'otro', x.trim().slice(0, C.MAX_REC_TEXTO)), t('Listo.')); return true; } }) },
        ...(i.rec ? [{ texto: t('Quitar récord'), icono: 'x', onclick: () => cambia(() => ponerRecord(i, a, false), t('Listo.')) }] : []),
      ]);
    } });
    return el('td.org-celda', { class: C.fueCambiado(i) ? 'cambiada' : '' }, [inp, menu]);
  }
  function cambiarDecision(a, l, n, i) {
    const nuevo = i.r === 1 ? -1 : 1;
    const motivo = campo({ etiqueta: t('Motivo'), multilinea: true, filas: 3, maxlength: 280, placeholder: t('Qué prueba se presentó'), ayuda: t('Queda en el registro del meet.') });
    const m = modal({ titulo: t('Cambiar decisión'), contenido: el('div.formulario', {}, [el('p', { text: `${a.nombre} · ${t(C.LEVANTES[l])} ${n + 1} · ${coma(i.kg)} kg: ${t(nombreRes(i.r))} → ${t(nombreRes(nuevo))}` }), motivo]), acciones: [
      { texto: t('Cancelar'), variante: 'fantasma' },
      { texto: t('Cambiar a {r}', { r: t(nombreRes(nuevo)) }), variante: 'primario', cerrar: false, onclick: () => {
        const mt = motivo.valor().trim(); if (!mt) { motivo.ponerError(t('Escribe el motivo.')); return false; }
        const antes = clonar(a); C.cambiarDecision(i, nuevo, mt, 'mesa'); st.ponerAtleta(a); publicar(); pintarEnVivo(); m.cerrar();
        toast(t('Decisión cambiada y registrada.'), { tipo: 'ok', deshacer: () => { st.ponerAtleta(antes); publicar(); pintarEnVivo(); } });
        return false;
      } },
    ] });
  }
  function verHistorial(i) {
    modal({ titulo: t('Cambios de decisión'), contenido: el('div.apilar', {}, (i.historial || []).map(h => el('div', {}, [el('strong', { text: `${t(nombreRes(h.de))} → ${t(nombreRes(h.a))}` }), el('p', { text: h.motivo }), el('small.suave', { text: [new Date(h.ts).toLocaleString(), h.por].filter(Boolean).join(' · ') })]))), acciones: [{ texto: t('Cerrar'), variante: 'secundario' }] });
  }

  /* ---------- acciones del intento ---------- */
  function repetirLuces() {
    const v = vivo();
    if (!v.luces) { toast(t('Aún no hay luces que repetir.')); return; }
    const ts = Date.now();
    publicar({ lucesTs: ts, sonido: { tipo: v.luces.resultado === 1 ? 'valido' : 'nulo', ts } }); pintarLuces(true);
  }
  function limpiarVotos() {
    const antes = votos;
    votos = {}; canal.limpiarVotos(f.plataforma); publicar({ luces: null, lucesTs: null, resultadoRec: null }); pintarLuces(true);
    toast(t('Votos borrados: los jueces pueden votar de nuevo.'), { deshacer: () => { votos = antes; publicar(); pintarLuces(true); } });
  }
  function moverAlFinal() {
    const p = C.cola(delGrupo(), f.lev).orden[0]; if (!p) return;
    const i = p.a.intentos[f.lev][p.n];
    i.alFinal = true; votos = {}; canal.limpiarVotos(f.plataforma); st.ponerAtleta(p.a); publicar({ luces: null, lucesTs: null }); pintarEnVivo();
    toast(t('{nombre} pasa al final de la ronda.', { nombre: p.a.nombre }), { deshacer: () => { i.alFinal = false; st.ponerAtleta(p.a); publicar(); pintarEnVivo(); } });
  }
  function siguiente() { votos = {}; reloj = R.parar(reloj); publicar({ luces: null, lucesTs: null, resultadoRec: null }); pintarEnVivo(); }

  const btn = (texto, ic, fn, variante = 'secundario') => boton({ texto, icono: ic, variante, onclick: fn });
  const barraDiscos = p => el('div.org-carga', {}, cargaVisual(cargaDiscos(p.kg, st.meet, f.lev), { meet: st.meet }));

  function pintarEnVivo() {
    normalizar();
    const lista = delGrupo();
    const c = C.cola(lista, f.lev), p = c.orden[0];
    const prog = progresoGrupo(st.atletas(), f);
    const kgBtn = p && el('button.org-kg.datos', { type: 'button', title: t('Doble clic para cambiar el peso'), 'aria-label': t('Peso {kg} kg. Doble clic para cambiarlo.', { kg: coma(p.kg) }), text: `${coma(p.kg)} kg` });
    if (p) {
      pulsacionLarga(kgBtn, () => pedirValor({ titulo: t('Peso del intento'), etiqueta: t('Kilos'), valor: String(p.kg), modo: 'decimal', aceptar: x => { const v = leerNumero(x); if (!(v >= 0) || x === '') { toast(t('Escribe un peso válido.'), { tipo: 'error' }); return false; } if (!cambiarKg(p.a, f.lev, p.n, v)) return false; pintarEnVivo(); return true; } }));
    }
    const paso = d => () => { const v = Math.round((p.kg + d) * 10) / 10; if (v >= 0 && cambiarKg(p.a, f.lev, p.n, v)) pintarEnVivo(); };
    pintarBarra();
    const progreso = prog.atletas ? el('div.org-progreso', {}, [anillo(prog.segmentos, { tam: 48, centro: `${prog.porcentaje}%`, titulo: textoFaltan(prog, f.grupo) }), el('span', { text: textoFaltanT(prog) })]) : null;
    reemplazar(host, [
      progreso,
      el('div.org-mesa-rejilla', {}, [
        el('section.panel.org-actual', {}, p ? [
          el('p.etiqueta', { text: `${t('Ronda')} ${p.n + 1} · ${t(C.LEVANTES[f.lev])}${p.a.intentos[f.lev][p.n].rec ? ` · ${(r => (p.a.intentos[f.lev][p.n].rec === 'otro' ? r : t(r)))(C.etiquetaRecord(p.a.intentos[f.lev][p.n].rec, p.a.intentos[f.lev][p.n].recTexto))}` : ''}` }),
          el('h2.org-nombre', { text: p.a.nombre }), kgBtn,
          el('div.fila', {}, [boton({ texto: '−2,5', variante: 'secundario', etiqueta: t('Bajar 2,5 kg'), onclick: paso(-2.5) }), boton({ texto: '+2,5', variante: 'secundario', etiqueta: t('Subir 2,5 kg'), onclick: paso(2.5) })]),
          el('p.suave.pequeno', { text: [p.a.club, p.a.rack?.[f.lev] ? `${t('Rack')} ${p.a.rack[f.lev]}` : null].filter(Boolean).join(' · ') }),
          barraDiscos(p),
          el('div.org-reloj-caja', {}, [relojEl, el('div.org-reloj-botones', {}, [btn(t('Iniciar'), 'play', iniciarReloj), btn(t('Pausar'), 'pausa', pausarReloj), btn(t('Parar'), 'parar', pararReloj)]), chips]),
          el('div.org-decidir', {}, [boton({ texto: t('Válido (G)'), icono: 'check', variante: 'primario', tam: 'grande', onclick: () => marcar(1) }), boton({ texto: t('Nulo (B)'), icono: 'x', variante: 'peligro', tam: 'grande', onclick: () => marcar(-1) })]),
        ] : [textoVacio(lista, c)]),
        el('div.apilar', {}, [
          el('section.panel.org-luces-panel', {}, [el('h2.org-sec-titulo', { text: t('Jueces') }), lucesHost, resultadoEl, panelJueces, aviso, simulador]),
          p ? el('div.org-acciones', {}, [btn(t('Repetir luces'), 'refrescar', repetirLuces), btn(t('Limpiar votos'), 'x', limpiarVotos), btn(t('Mover al final'), 'flecha-der', moverAlFinal), btn(t('Siguiente'), 'play', siguiente)]) : null,
          c.orden.length > 1 ? el('section.panel', {}, [el('h2.org-sec-titulo', { text: t('Orden de salida') }), el('ol.org-orden', {}, c.orden.slice(1, 10).map(x => el('li', {}, [el('span.truncar', { text: x.a.nombre }), el('span.suave.pequeno', { text: `${x.n + 1}.º` }), el('strong.datos', { text: `${coma(x.kg)} kg` })])))]) : null,
        ]),
      ]),
      lista.length ? el('section.panel', {}, [el('h2.org-sec-titulo', { text: `${t('Intentos del grupo')} · ${t(C.LEVANTES[f.lev])}` }), el('div.tabla-caja', {}, el('table.tabla.org-tabla', {}, [
        el('thead', {}, el('tr', {}, [t('Atleta'), '1.º', '2.º', '3.º', t('Total')].map(h => el('th', { text: h })))),
        el('tbody', {}, [...lista].sort((a, b) => (Number(a.lote) || 0) - (Number(b.lote) || 0)).map(a => el('tr', { class: p?.a.id === a.id ? 'org-sale' : '' }, [el('td', {}, el('strong', { text: a.nombre })), ...[0, 1, 2].map(n => celdaIntento(a, f.lev, n)), el('td.datos', { text: coma(C.total(a)) })]))),
      ]))]) : null,
    ]);
    pintarLuces(true); pintarJueces(); tic();
  }
  const textoFaltanT = prog => (prog.faltan === 0 ? t('Grupo {g} completo', { g: f.grupo }) : t(prog.faltan === 1 ? 'Falta 1 intento en el Grupo {g}' : 'Faltan {n} intentos en el Grupo {g}', { n: prog.faltan, g: f.grupo }));
  function textoVacio(lista, c) {
    if (!st.atletas().length) return vacio({ icono: 'usuarios', titulo: t('Aún no hay atletas'), texto: t('Carga a los atletas para empezar a dirigir.'), accion: { texto: t('Ir a Atletas'), icono: 'usuarios', onclick: () => st.irA('atletas') } });
    if (!lista.length) return vacio({ icono: 'usuarios', titulo: t('Nadie en esta sesión y grupo'), texto: t('Cambia la plataforma, la sesión o el grupo arriba, o asigna atletas en la pestaña Atletas.'), accion: { texto: t('Ir a Atletas'), onclick: () => st.irA('atletas') } });
    if (c.sinPeso.length) return vacio({ icono: 'alerta', titulo: t('Falta el peso de {n} atleta(s)', { n: c.sinPeso.length }), texto: c.sinPeso.map(a => a.nombre).join(', '), accion: { texto: t('Poner pesos en Atletas'), onclick: () => st.irA('atletas') } });
    return vacio({ icono: 'trofeo', titulo: t('Levantamiento terminado'), texto: t('Elige el siguiente levantamiento o grupo arriba.') });
  }

  /* ---------- atajos y ciclo de vida ---------- */
  const atajos = e => {
    if (st.tab !== 'mesa' || !montado || document.querySelector('.modal-fondo')) return;
    if (e.target?.matches?.('input, textarea, select') || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'g') marcar(1); else if (k === 'b') marcar(-1);
    else if (k === 's') iniciarReloj(); else if (k === 'r') pararReloj(); else if (k === 'p') pausarReloj();
    else if (e.key === ' ' && !e.target?.matches?.('button, a')) { e.preventDefault(); alternarReloj(); }
  };
  window.addEventListener('keydown', atajos);
  raiz.addEventListener('pointerdown', () => S.desbloquear(), { once: true });

  const pc = pildoraConexion(canal.estado());
  const quitar = [canal.escucharVotos(recibirRemoto), canal.alEstado(e => pc.poner(e)), st.escuchar(() => { if (document.activeElement?.matches?.('.org-mesa input')) return; normalizar(); clearTimeout(rep); rep = setTimeout(() => { pintarControles(); pintarEnVivo(); if (turnoActual() !== vivo().turno && st.tab === 'mesa') publicar(); }, 50); })];
  let rep = 0;
  const alPres = () => { if (st.tab === 'mesa') pintarJueces(); };
  st.presOyentes.add(alPres);
  const tictac = setInterval(() => { if (st.tab === 'mesa') { tic(); pintarLuces(); } }, 250);
  const latido = setInterval(() => { if (st.tab === 'mesa') pintarJueces(); const sol = st.registro.paraAutoAprobar(st.presencias); sol.forEach(x => { st.registro.aprobar(x.plataforma, x.pos, x.huella, { nombre: x.nombre, dispositivo: x.dispositivo }); st.mesa.publicar(); }); }, 1000);

  reloj = relojInicial();
  pintarChips(); pintarSimulador(); pintarControles(); pintarEnVivo();
  raiz.append(el('div.org-mesa-cab', {}, [pc, el('span.suave.pequeno', { text: t('Atajos: espacio o S iniciar/pausar · P pausar · R parar · G válido · B nulo') })]), barra, controles, host);
  if (st.atletas().length) publicar();

  return {
    nodo: raiz,
    alActivar: () => { pintarControles(); pintarEnVivo(); },
    salir: () => { montado = false; clearInterval(tictac); clearInterval(latido); window.removeEventListener('keydown', atajos); quitar.forEach(q => q()); st.alVoto = null; st.mesa = null; st.presOyentes.delete(alPres); },
  };
}
