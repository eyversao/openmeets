/* ============================================================
   OPENMEETS — Canal en vivo de un meet
   El mismo estado viaja por dos vías y se funde por `version`:
     1. mismo navegador   BroadcastChannel('openmeets-<id>')
     2. servidor local    GET /api/meets/:id/canal (SSE) + POST al mismo
   Sin nube. Los votos sin red se guardan en una cola y se reenvían solos.
   Mensajes: { tipo: 'meet'|'atleta'|'meet-cambio'|'vivo'|'aplauso'|'voto'|'presencia'|'limpiar', ... }
   ============================================================ */

/* ---------- Lógica pura (se prueba en Node) ---------- */

export const clavePlat = p => String(p).replace(/[^\p{L}\p{N}]+/gu, '_');
/** Con `dispositivo` cada teléfono tiene su propia clave: dos teléfonos en la misma posición no se pisan. */
export const clavePresencia = (plataforma, pos, dispositivo) => `${clavePlat(plataforma)}__${pos}${dispositivo ? `__${String(dispositivo).replace(/[^\w-]/g, '')}` : ''}`;
export const claveVoto = v => `${v.plataforma}|${v.pos}|${v.turno ?? ''}|${v.dispositivo ?? ''}`;

/** Se queda con el vivo de mayor `version`; a igual versión, el que ya estaba. */
export const fundirVivo = (actual, nuevo) => (!nuevo ? actual : !actual || (Number(nuevo.version) || 0) > (Number(actual.version) || 0) ? nuevo : actual);

/** Funde un mapa { plataforma: vivo } con otro; devuelve { mapa, cambio }. */
export function fundirMapa(mapa, entrante) {
  const salida = { ...mapa };
  let cambio = false;
  for (const [p, v] of Object.entries(entrante || {})) {
    const f = fundirVivo(salida[p], v);
    if (f !== salida[p]) { salida[p] = f; cambio = true; }
  }
  return { mapa: salida, cambio };
}

/** Funde presencias por clave y `ts` más reciente. */
export function fundirPresencia(mapa, entrante) {
  const salida = { ...mapa };
  let cambio = false;
  for (const [k, v] of Object.entries(entrante || {})) {
    if (!salida[k] || (Number(v.ts) || 0) > (Number(salida[k].ts) || 0)) { salida[k] = v; cambio = true; }
  }
  return { mapa: salida, cambio };
}

/** Deduplicador de votos (plataforma|pos|turno|dispositivo): el primero cuenta. `olvidar(p)` permite repetir una plataforma. */
export function crearDedup() {
  const vistos = new Set();
  return {
    nuevo(v) { const k = claveVoto(v); if (vistos.has(k)) return false; vistos.add(k); return true; },
    olvidar(plataforma) { for (const k of [...vistos]) if (k.startsWith(`${plataforma}|`)) vistos.delete(k); },
  };
}

/** Espera creciente para reconectar: 1, 2, 4, 8, 15 s (tope). */
export const esperaReconexion = (intento, [primera, tope] = [1000, 15000]) => Math.min(tope, primera * 2 ** Math.max(0, intento));

/** Aplica un mensaje 'meet' | 'atleta' | 'meet-cambio' | 'vivo' | 'aplauso' a una copia del meet. Devuelve el meet nuevo o el mismo si no cambia. */
export function aplicarAlMeet(meet, m) {
  if (!m || typeof m !== 'object') return meet;
  if (m.tipo === 'meet' && m.meet) return { ...m.meet };
  if (!meet) return meet;
  if (m.tipo === 'atleta' && m.atleta?.id) {
    const atletas = [...(meet.atletas || [])];
    const i = atletas.findIndex(a => a.id === m.atleta.id);
    if (m.eliminado || m.borrado) { if (i >= 0) atletas.splice(i, 1); } else if (i >= 0) atletas[i] = m.atleta; else atletas.push(m.atleta);
    return { ...meet, atletas };
  }
  if (m.tipo === 'meet-cambio' && m.campos && typeof m.campos === 'object') return { ...meet, ...m.campos };
  if (m.tipo === 'vivo' && m.plataforma && m.datos) {
    const f = fundirVivo(meet.vivo?.[m.plataforma], m.datos);
    return f === meet.vivo?.[m.plataforma] ? meet : { ...meet, vivo: { ...(meet.vivo || {}), [m.plataforma]: f } };
  }
  if (m.tipo === 'aplauso' && m.aid) return { ...meet, aplausos: { ...(meet.aplausos || {}), [m.aid]: Number(m.n) || 0 } };
  return meet;
}

/* ---------- Canal ---------- */

const conTiempo = (promesa, ms) => new Promise((ok, mal) => {
  const t = setTimeout(() => mal(new Error('tiempo agotado')), ms);
  promesa.then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); mal(e); });
});

const almacenPorDefecto = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** Versión en la nube: en lugar del SSE y los POST, otro transporte { enviar(m), suscribir(alMensaje, alEstado) → baja } (web/js/nube/transporte.js). */
let transporteGlobal = null;
export const fijarTransporte = fabrica => { transporteGlobal = fabrica; };

/**
 * Abre el canal de un meet.
 * @param {string} meetId
 * @param {{ rol?: 'mesa'|'pantalla'|'juez'|'publico', codigo?: string, base?: string, deps?: object }} opciones
 *   `codigo`: código de jueces (rol 'juez'); `base`: origen del servidor ('' = el mismo origen de la página).
 */
export function abrirCanal(meetId, opciones = {}) {
  const { rol = 'publico', deps = {} } = opciones;
  const BC = deps.BroadcastChannel ?? globalThis.BroadcastChannel;
  const ES = deps.EventSource ?? globalThis.EventSource;
  const f = deps.fetch ?? globalThis.fetch?.bind(globalThis);
  const base = String(opciones.base ?? '').replace(/\/+$/, '');
  const ruta = `${base}/api/meets/${encodeURIComponent(meetId)}/canal`;
  const espera = deps.espera ?? [1000, 15000];
  const almacen = deps.almacen ?? almacenPorDefecto();
  const enNavegador = typeof globalThis.addEventListener === 'function';
  const claveCola = `openmeets.cola.${meetId}`;
  const transporte = opciones.transporte ?? transporteGlobal?.(meetId, opciones) ?? null;
  let bajaTransporte = null;

  let cerrado = false;
  let versionLocal = 0;
  let estado = 'reconectando';
  let fallos = 0;
  let ultimo = 0;
  let meet = null;
  let vivos = {};
  let presencias = {};
  let regies = {};
  const dedup = crearDedup();
  const fnMeet = new Set(), fnVivo = new Set(), fnVoto = new Set(), fnPres = new Set(), fnAplauso = new Set(), fnRegie = new Set(), fnEstado = new Set(), fnCola = new Set();

  const avisar = (set, ...a) => set.forEach(fn => { try { fn(...a); } catch { /* escucha rota */ } });
  const ponerEstado = e => { if (e !== estado) { estado = e; avisar(fnEstado, estado); } };

  /* ---- emisión local ---- */
  const emitirMeet = () => avisar(fnMeet, meet);
  const emitirVivo = entrante => {
    const r = fundirMapa(vivos, entrante);
    if (!r.cambio) return;
    vivos = r.mapa;
    if (meet) { meet = { ...meet, vivo: { ...(meet.vivo || {}), ...entrante, ...vivos } }; }
    avisar(fnVivo, { ...vivos });
  };
  const emitirVoto = v => {
    if (!v || !v.plataforma || !v.pos || !dedup.nuevo(v)) return;
    avisar(fnVoto, v);
  };
  const emitirPresencia = entrante => {
    const r = fundirPresencia(presencias, entrante);
    if (!r.cambio) return;
    presencias = r.mapa;
    avisar(fnPres, { ...presencias });
  };

  const alMensaje = m => {
    if (!m || typeof m !== 'object') return;
    ultimo = Date.now();
    if (m.tipo === 'meet' || m.tipo === 'atleta' || m.tipo === 'meet-cambio') {
      const nuevo = aplicarAlMeet(meet, m);
      if (nuevo !== meet) { meet = nuevo; if (m.tipo === 'meet' && meet.vivo) { const r = fundirMapa(vivos, meet.vivo); vivos = r.mapa; if (r.cambio) avisar(fnVivo, { ...vivos }); } emitirMeet(); }
    } else if (m.tipo === 'vivo' && m.plataforma && m.datos) {
      emitirVivo({ [m.plataforma]: m.datos });
      emitirMeet();
    } else if (m.tipo === 'aplauso' && m.aid) {
      meet = aplicarAlMeet(meet, m);
      avisar(fnAplauso, { aid: m.aid, n: Number(m.n) || 0 });
      if (meet) emitirMeet();
    } else if (m.tipo === 'voto' && m.voto) emitirVoto(m.voto);
    else if (m.tipo === 'presencia' && m.datos?.plataforma) emitirPresencia({ [clavePresencia(m.datos.plataforma, m.datos.pos, m.datos.dispositivo)]: m.datos });
    else if (m.tipo === 'limpiar' && m.plataforma) dedup.olvidar(m.plataforma);
    else if (m.tipo === 'regie' && m.plataforma && m.datos && (Number(m.datos.v) || 0) >= (Number(regies[m.plataforma]?.v) || 0)) { regies = { ...regies, [m.plataforma]: m.datos }; avisar(fnRegie, { ...regies }); }
  };

  /* ---- mismo navegador ---- */
  let bc = null;
  try {
    if (BC) { bc = new BC(`openmeets-${meetId}`); bc.onmessage = e => alMensaje(e.data); }
  } catch { bc = null; }
  const aBC = m => { try { bc?.postMessage(m); } catch { /* canal cerrado */ } };

  /* ---- servidor: POST ---- */
  const aServidor = async m => {
    if (transporte) { await transporte.enviar(rol === 'juez' && opciones.codigo ? { ...m, codigo: opciones.codigo } : m); return true; } // el estado lo da suscribir()
    if (!f) throw new Error('sin red');
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    try {
      const cuerpo = rol === 'juez' && opciones.codigo ? { ...m, codigo: opciones.codigo } : m;
      const r = await conTiempo(f(ruta, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), signal: ctl?.signal, credentials: 'same-origin' }), 5000);
      if (!r.ok) {
        const e = new Error(`servidor ${r.status}`);
        e.estado = r.status;
        throw e;
      }
      fallos = 0;
      if (estado !== 'conectado') ponerEstado('conectado');
      return true;
    } catch (e) {
      ctl?.abort();
      if (!(e.estado >= 400 && e.estado < 500)) { fallos++; if (fallos >= 3 || globalThis.navigator?.onLine === false) ponerEstado('sin-red'); else ponerEstado('reconectando'); }
      throw e;
    }
  };

  /* ---- cola de votos sin red (persistente) ---- */
  let cola = [];
  try { cola = JSON.parse(almacen?.getItem(claveCola) || '[]').filter(v => v && v.plataforma && v.pos); } catch { cola = []; }
  const guardarCola = () => { try { almacen?.setItem(claveCola, JSON.stringify(cola)); } catch { /* sin almacenamiento */ } avisar(fnCola, cola.length); };
  let temporizadorCola = null, intentoCola = 0, vaciando = false;
  async function vaciarCola() {
    if (cerrado || vaciando || !cola.length) return;
    vaciando = true;
    try {
      while (cola.length) {
        const v = cola[0];
        try { await aServidor({ tipo: 'voto', voto: v }); } catch (e) {
          if (e.estado >= 400 && e.estado < 500) { /* el servidor lo rechazó: no sirve reintentar */ } else throw e;
        }
        cola.shift(); guardarCola(); intentoCola = 0;
      }
    } catch {
      programarCola();
    } finally { vaciando = false; }
  }
  function programarCola() {
    if (cerrado || temporizadorCola || !cola.length) return;
    temporizadorCola = setTimeout(() => { temporizadorCola = null; vaciarCola(); }, esperaReconexion(intentoCola++, espera));
    temporizadorCola.unref?.();
  }
  if (enNavegador) { try { globalThis.addEventListener('online', () => { intentoCola = 0; vaciarCola(); }); } catch { /* sin eventos */ } }

  /* ---- vivos sin enviar (organizador): solo el último de cada plataforma ---- */
  const vivosPend = new Map();
  let temporizadorVivo = null, intentoVivo = 0;
  async function vaciarVivos() {
    for (const [p, d] of [...vivosPend]) {
      try { await aServidor({ tipo: 'vivo', plataforma: p, datos: d }); if (vivosPend.get(p) === d) vivosPend.delete(p); intentoVivo = 0; } catch (e) { if (!(e.estado >= 400 && e.estado < 500)) { programarVivo(); return; } vivosPend.delete(p); }
    }
  }
  function programarVivo() {
    if (cerrado || temporizadorVivo || !vivosPend.size) return;
    temporizadorVivo = setTimeout(() => { temporizadorVivo = null; vaciarVivos(); }, esperaReconexion(intentoVivo++, espera));
    temporizadorVivo.unref?.();
  }

  /* ---- servidor: SSE con reconexión de espera creciente ---- */
  let es = null, intento = 0, reintento = null;
  function conectar() {
    if (transporte && !cerrado) {
      bajaTransporte = transporte.suscribir(alMensaje, e => { ponerEstado(e); if (e === 'conectado') { intentoCola = 0; fallos = 0; vaciarCola(); vaciarVivos(); } });
      return;
    }
    if (cerrado || !ES) return;
    try { es = new ES(ruta, { withCredentials: true }); } catch { es = null; programar(); return; }
    es.onopen = () => {
      intento = 0; fallos = 0; ponerEstado('conectado');
      intentoCola = 0; vaciarCola(); vaciarVivos();
    };
    es.onmessage = e => { try { alMensaje(JSON.parse(e.data)); } catch { /* mensaje ilegible */ } };
    es.onerror = () => {
      ponerEstado(globalThis.navigator?.onLine === false || intento >= 2 ? 'sin-red' : 'reconectando');
      try { es?.close(); } catch { /* ya cerrado */ }
      es = null;
      programar();
    };
  }
  function programar() {
    if (cerrado || reintento) return;
    reintento = setTimeout(() => { reintento = null; conectar(); }, esperaReconexion(intento++, espera));
    reintento.unref?.();
  }
  conectar();

  /* ---- API ---- */
  const api = {
    /** fn(meet) con el meet completo al conectar y en cada cambio (atleta, campos, vivo, aplausos). */
    escucharMeet(fn) { fnMeet.add(fn); if (meet) { try { fn(meet); } catch { /* escucha rota */ } } return () => fnMeet.delete(fn); },
    /** fn({ [plataforma]: vivo }) */
    escucharVivo(fn) {
      fnVivo.add(fn);
      if (Object.keys(vivos).length) { try { fn({ ...vivos }); } catch { /* escucha rota */ } }
      return () => fnVivo.delete(fn);
    },
    /** Organizador: publica el vivo de una plataforma (sube `version`); si el servidor no responde, se reenvía el último al volver. */
    publicarVivo(plataforma, datos) {
      versionLocal = Math.max(Date.now(), versionLocal + 1);
      const d = { ...datos, plataforma, version: Math.max(Number(datos?.version) || 0, versionLocal) };
      versionLocal = d.version;
      emitirVivo({ [plataforma]: d });
      emitirMeet();
      aBC({ tipo: 'vivo', plataforma, datos: d });
      vivosPend.set(plataforma, d);
      aServidor({ tipo: 'vivo', plataforma, datos: d }).then(() => { if (vivosPend.get(plataforma) === d) vivosPend.delete(plataforma); }, () => programarVivo());
      return d;
    },
    /**
     * Juez: manda un voto. Nunca lanza: devuelve { ok, enCola, via }.
     * Sin red, queda en la cola (persistente) y se reenvía solo.
     */
    async enviarVoto(voto) {
      const v = { ...voto, ts: voto.ts || Date.now() };
      aBC({ tipo: 'voto', voto: v });
      try {
        await aServidor({ tipo: 'voto', voto: v });
        return { ok: true, enCola: false, via: 'servidor' };
      } catch (e) {
        if (e.estado >= 400 && e.estado < 500) return { ok: false, enCola: false, via: null, error: e.message, estado: e.estado };
        if (!cola.some(x => claveVoto(x) === claveVoto(v))) { cola.push(v); guardarCola(); }
        programarCola();
        return { ok: false, enCola: true, via: null };
      }
    },
    escucharVotos(fn) { fnVoto.add(fn); return () => fnVoto.delete(fn); },
    limpiarVotos(plataforma) {
      dedup.olvidar(plataforma);
      aBC({ tipo: 'limpiar', plataforma });
      aServidor({ tipo: 'limpiar', plataforma }).catch(() => {});
    },
    enviarPresencia(d) {
      const datos = { ...d, ts: Date.now() };
      aBC({ tipo: 'presencia', datos });
      aServidor({ tipo: 'presencia', datos }).catch(() => {});
    },
    /** Organizador: publica la regie del HUD de una plataforma ({modo, escena, …}); lo recibe el HUD, también el que se conecte tarde. */
    publicarRegie(plataforma, datos) {
      const d = { ...datos, v: Math.max(Date.now(), (Number(regies[plataforma]?.v) || 0) + 1) };
      alMensaje({ tipo: 'regie', plataforma, datos: d });
      aBC({ tipo: 'regie', plataforma, datos: d });
      return aServidor({ tipo: 'regie', plataforma, datos: d });
    },
    /** fn({ [plataforma]: regie }) al conectar y con cada cambio. */
    escucharRegie(fn) { fnRegie.add(fn); if (Object.keys(regies).length) { try { fn({ ...regies }); } catch { /* escucha rota */ } } return () => fnRegie.delete(fn); },
    escucharPresencia(fn) { fnPres.add(fn); return () => fnPres.delete(fn); },
    /** fn({ aid, n }) por cada aplauso nuevo. */
    escucharAplausos(fn) { fnAplauso.add(fn); return () => fnAplauso.delete(fn); },
    /** 'conectado' | 'reconectando' | 'sin-red' */
    estado: () => estado,
    alEstado(fn) { fnEstado.add(fn); return () => fnEstado.delete(fn); },
    /** Votos guardados sin enviar, y aviso cuando cambian. */
    votosEnCola: () => cola.length,
    alCola(fn) { fnCola.add(fn); return () => fnCola.delete(fn); },
    /** ms de la última noticia del servidor (0 = ninguna): «última imagen a las…». */
    ultimaHora: () => ultimo,
    meet: () => meet,
    cerrar() {
      cerrado = true;
      clearTimeout(reintento); clearTimeout(temporizadorCola); clearTimeout(temporizadorVivo);
      try { es?.close(); } catch { /* ya cerrado */ }
      try { bajaTransporte?.(); } catch { /* ya cerrado */ }
      try { bc?.close(); } catch { /* ya cerrado */ }
      fnMeet.clear(); fnVivo.clear(); fnVoto.clear(); fnPres.clear(); fnAplauso.clear(); fnRegie.clear(); fnEstado.clear(); fnCola.clear();
    },
  };
  return api;
}
