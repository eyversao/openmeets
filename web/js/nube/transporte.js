/* ============================================================
   OPENMEETS (nube) — Transporte del canal en vivo sobre Firestore.
   Reemplaza al SSE y a los POST de canal.js: mismos mensajes ('meet', 'atleta', 'meet-cambio', 'vivo', 'regie', 'aplauso', 'voto', 'presencia'),
   así que mesa, pantalla, HUD y jueces no cambian. Usa solo el adaptador de bd.js (get/set/del/lote/escuchar).
   ============================================================ */
import { ErrorApi, mal, limpiarRegie, limpiarVoto, limpiarPresencia, objeto, txt } from '../nucleo/validar.js';
import { armarMeet, camposPublicos, docVivo, idPlat, claveJuez } from './modelo.js';

const sinCodigo = ({ codigo, ...resto }) => resto;

/** Un cambio de documento → mensaje del canal (o null). Pura. `nombre`: atletas | vivo | regie | aplausos | votos | presencia. */
export function mensajeDeCambio(nombre, c) {
  const d = c.d, quitado = c.tipo === 'removed';
  switch (nombre) {
    case 'atletas': return quitado ? { tipo: 'atleta', atleta: { id: c.id, eliminado: true }, eliminado: true } : { tipo: 'atleta', atleta: d };
    case 'vivo': return quitado || !d?.datos ? null : { tipo: 'vivo', plataforma: d.plataforma, datos: d.datos };
    case 'regie': return quitado || !d?.datos ? null : { tipo: 'regie', plataforma: d.plataforma, datos: d.datos };
    case 'aplausos': return { tipo: 'aplauso', aid: c.id, n: quitado ? 0 : Number(d.n) || 0 };
    case 'votos': return quitado ? null : { tipo: 'voto', voto: sinCodigo(d) };
    case 'presencia': return quitado ? null : { tipo: 'presencia', datos: sinCodigo(d) };
    default: return null;
  }
}

const conEstado = (msg, estado) => new ErrorApi(estado, msg);
const tiempo = (ms, msg) => new Promise((_, no) => setTimeout(() => no(new Error(msg)), ms));

export function crearTransporte(db, meetId, { espera = 250, enLinea = () => globalThis.navigator?.onLine !== false, sinServidorMs = 6000 } = {}) {
  const base = `meets/${meetId}`;
  const vivos = {};          // plataforma → datos (vivo conocido)
  const votos = new Map();   // id de documento → voto (solo el dueño los lee)
  const enviados = new Map(); // voto ya mandado: clave → turno
  const presencias = new Map();
  let conocidos = {};        // huellas de jueces (privado/datos.juecesConocidos)
  let enVivoDoc = false;
  const pendVivo = new Map();

  /* ---------- enviar ---------- */
  async function escribirVivo(plataforma, datos) {
    const previo = vivos[plataforma];
    if (previo && (Number(previo.version) || 0) > (Number(datos.version) || 0)) return;
    vivos[plataforma] = datos;
    await db.set(`${base}/vivo/${idPlat(plataforma)}`, docVivo(plataforma, datos));
    const borrar = [...votos].filter(([, v]) => v.plataforma === plataforma && v.turno !== datos.turno);
    if (borrar.length) { borrar.forEach(([k]) => votos.delete(k)); await db.lote(borrar.map(([k]) => ({ op: 'del', ruta: `${base}/votos/${k}` }))); }
    const hay = Object.values(vivos).some(v => v && v.actual);
    if (hay !== enVivoDoc) { enVivoDoc = hay; await db.update(base, { enVivo: hay }); }
  }
  /** El vivo se publica varias veces por segundo (reloj, kilos): se agrupa y solo se escribe el último cada `espera` ms. */
  const vivoAgrupado = (plataforma, datos) => new Promise((ok, no) => {
    const p = pendVivo.get(plataforma);
    if (p) { p.datos = datos; p.res.push([ok, no]); return; }
    const e = { datos, res: [[ok, no]] };
    pendVivo.set(plataforma, e);
    setTimeout(async () => {
      pendVivo.delete(plataforma);
      try { await escribirVivo(plataforma, e.datos); e.res.forEach(([o]) => o(true)); } catch (er) { e.res.forEach(([, n]) => n(er)); }
    }, espera);
  });

  async function enviar(m) {
    if (!objeto(m)) mal(400, 'Mensaje no válido');
    switch (m.tipo) {
      case 'vivo': {
        const plataforma = txt(m.plataforma, 40);
        if (!plataforma || !objeto(m.datos)) mal(400, 'Falta la plataforma o los datos del vivo');
        return vivoAgrupado(plataforma, m.datos);
      }
      case 'regie': {
        const plataforma = txt(m.plataforma, 40);
        if (!plataforma || !objeto(m.datos)) mal(400, 'Falta la plataforma o los datos de la regie');
        return db.set(`${base}/regie/${idPlat(plataforma)}`, docVivo(plataforma, limpiarRegie(m.datos)));
      }
      case 'limpiar': {
        const plataforma = txt(m.plataforma, 40);
        if (!plataforma) mal(400, 'Falta la plataforma');
        const borrar = [...votos].filter(([, v]) => v.plataforma === plataforma);
        borrar.forEach(([k]) => votos.delete(k));
        if (borrar.length) await db.lote(borrar.map(([k]) => ({ op: 'del', ruta: `${base}/votos/${k}` })));
        return true;
      }
      case 'voto': {
        const v = m.voto;
        const codigo = txt(String(v?.codigo ?? m.codigo ?? ''), 40);
        if (!codigo) mal(403, 'Código de jueces incorrecto');
        const limpio = limpiarVoto(v);
        const id = claveJuez(limpio.plataforma, limpio.pos, limpio.dispositivo);
        if (enviados.get(id) === limpio.turno) return { repetido: true }; // el primero cuenta
        try { await Promise.race([db.set(`${base}/votos/${id}`, { ...limpio, codigo }), tiempo(4000, 'sin red')]); } catch (e) {
          if (e?.code === 'permission-denied') throw conEstado('Código de jueces incorrecto', 403);
          throw e; // sin red: canal.js lo guarda en su cola y lo reenvía
        }
        enviados.set(id, limpio.turno);
        return true;
      }
      case 'presencia': {
        const d = m.datos;
        const codigo = txt(String(d?.codigo ?? m.codigo ?? ''), 40);
        if (!codigo) mal(403, 'Código de jueces incorrecto');
        const limpio = limpiarPresencia(d);
        const id = claveJuez(limpio.plataforma, limpio.pos, limpio.dispositivo);
        const ant = presencias.get(id);
        // se escribe al cambiar algo o cada 12 s: el pulso de 5 s de cada juez gastaría la cuota gratuita
        if (ant && limpio.ts - ant.ts < 12000 && ant.bateria === limpio.bateria && ant.nombre === limpio.nombre && ant.pos === limpio.pos) return true;
        presencias.set(id, limpio);
        try { await db.set(`${base}/presencia/${id}`, { ...limpio, codigo }); } catch (e) { if (e?.code === 'permission-denied') throw conEstado('Código de jueces incorrecto', 403); throw e; }
        return true;
      }
      default: mal(400, 'Tipo de mensaje desconocido');
    }
  }

  /* ---------- suscribir ---------- */
  function suscribir(alMensaje, alEstado) {
    let cerrado = false, ya = false, owner = false, estado = '', temporizador = null, deCache = true, falloDeLectura = false;
    const bajas = [];
    const atletas = new Map(), vivosDoc = new Map(), regies = new Map(), aplausos = new Map(), actividad = new Map();
    let meetDoc = null, privado = null;
    const esperados = new Set(['meet', 'usuario', 'atletas', 'vivo', 'regie', 'aplausos', 'actividad']);
    let uid = null;
    const primeros = new Set();

    const pon = e => { if (e !== estado) { estado = e; alEstado?.(e); } };
    const evaluar = () => {
      clearTimeout(temporizador);
      if (!enLinea()) return pon('sin-red');
      if (!deCache && !falloDeLectura) return pon('conectado');
      pon('reconectando');
      temporizador = setTimeout(() => { if (!cerrado && (deCache || falloDeLectura) && enLinea()) pon('sin-red'); }, sinServidorMs);
    };
    const emitir = m => { if (m && !cerrado) alMensaje(m); };
    const armado = () => ({ ...armarMeet(meetDoc, {
      atletas: [...atletas].map(([id, d]) => ({ id, d })), vivo: [...vivosDoc].map(([id, d]) => ({ id, d })), regie: [...regies].map(([id, d]) => ({ id, d })),
      aplausos: [...aplausos].map(([id, d]) => ({ id, d })), actividad: [...actividad].map(([id, d]) => ({ id, d })), privado,
    }), mio: owner });
    const comprobarListo = () => {
      if (ya || !meetDoc || ![...esperados].every(n => primeros.has(n))) return;
      ya = true;
      emitir({ tipo: 'meet', meet: armado() });
      for (const d of vivosDoc.values()) emitir({ tipo: 'vivo', plataforma: d.plataforma, datos: d.datos });
      for (const d of regies.values()) emitir({ tipo: 'regie', plataforma: d.plataforma, datos: d.datos });
    };
    const alerta = s => {
      if (s.error) { falloDeLectura = true; evaluar(); return true; }
      if (falloDeLectura) falloDeLectura = false;
      return false;
    };

    const colección = (nombre, destino, opciones) => bajas.push(db.escuchar(`${base}/${nombre}`, opciones || {}, s => {
      if (cerrado || alerta(s)) return;
      for (const c of s.cambios) {
        if (c.tipo === 'removed') destino?.delete(c.id); else destino?.set(c.id, c.d);
        if (nombre === 'vivo' && c.tipo !== 'removed' && c.d?.datos) vivos[c.d.plataforma] = c.d.datos;
        if (ya) emitir(mensajeDeCambio(nombre, c));
      }
      primeros.add(nombre);
      comprobarListo();
    }));

    // públicas
    colección('atletas', atletas);
    colección('vivo', vivosDoc);
    colección('regie', regies);
    colección('aplausos', aplausos);
    bajas.push(db.escuchar(`${base}/actividad`, { orden: ['ts', 'desc'], limite: 200 }, s => {
      if (cerrado || alerta(s)) return;
      for (const c of s.cambios) { if (c.tipo === 'removed') actividad.delete(c.id); else actividad.set(c.id, c.d); }
      primeros.add('actividad');
      if (ya && s.cambios.length) emitir({ tipo: 'meet-cambio', campos: { actividad: [...actividad.values()].map(d => ({ ts: d.ts, texto: d.texto })).sort((a, b) => a.ts - b.ts) } });
      comprobarListo();
    }));

    // el dueño además lee privado, votos y presencia (las reglas no dejan a nadie más)
    const revisarDueno = () => { if (!cerrado && meetDoc && uid && uid === meetDoc.dueno) abrirDueno(); };
    const abrirDueno = () => {
      if (owner) return;
      owner = true; esperados.add('privado');
      bajas.push(db.escuchar(`${base}/privado/datos`, {}, s => {
        if (cerrado || alerta(s)) return;
        for (const c of s.cambios) { privado = c.tipo === 'removed' ? null : c.d; conocidos = { ...(privado?.juecesConocidos || {}) }; }
        primeros.add('privado');
        if (ya && s.cambios.length) emitir({ tipo: 'meet-cambio', campos: { privado } });
        comprobarListo();
      }));
      bajas.push(db.escuchar(`${base}/votos`, {}, s => {
        if (cerrado || alerta(s)) return;
        for (const c of s.cambios) { if (c.tipo === 'removed') votos.delete(c.id); else votos.set(c.id, c.d); emitir(mensajeDeCambio('votos', c)); }
      }));
      bajas.push(db.escuchar(`${base}/presencia`, {}, s => {
        if (cerrado || alerta(s)) return;
        for (const c of s.cambios) {
          emitir(mensajeDeCambio('presencia', c));
          const d = c.d;
          if (c.tipo === 'removed' || !d?.huella) continue;
          const k = conocidos[d.huella];
          if ((k || Object.keys(conocidos).length < 50) && (!k || k.pos !== d.pos || k.nombre !== d.nombre)) {
            conocidos[d.huella] = { pos: d.pos, nombre: d.nombre, ts: d.ts };
            Promise.resolve(db.set(`${base}/privado/datos`, { juecesConocidos: { [d.huella]: conocidos[d.huella] } }, { merge: true })).catch(() => {});
          }
        }
      }));
    };

    bajas.push(db.escuchar(base, {}, s => {
      if (cerrado) return;
      if (alerta(s)) return;
      deCache = !!s.deCache; evaluar();
      for (const c of s.cambios) {
        if (c.tipo === 'removed') { if (ya) emitir({ tipo: 'meet-cambio', campos: { eliminado: true } }); continue; }
        const primera = !meetDoc;
        meetDoc = c.d; enVivoDoc = !!c.d.enVivo;
        if (primera) primeros.add('meet');
        else if (ya) emitir({ tipo: 'meet-cambio', campos: camposPublicos(c.d) });
      }
      revisarDueno();
      comprobarListo();
    }));
    // quién soy (Auth solo está cargado si hubo sesión): si soy el dueño, se abren privado, votos y presencia antes de dar el meet por listo
    Promise.resolve(db.usuario()).then(u => { uid = u?.uid ?? null; }, () => {}).then(() => { primeros.add('usuario'); revisarDueno(); comprobarListo(); });

    const ev = () => evaluar();
    try { globalThis.addEventListener?.('online', ev); globalThis.addEventListener?.('offline', ev); } catch { /* sin eventos */ }
    evaluar();
    return () => {
      cerrado = true; clearTimeout(temporizador);
      for (const b of bajas) { try { b(); } catch { /* ya cerrada */ } }
      try { globalThis.removeEventListener?.('online', ev); globalThis.removeEventListener?.('offline', ev); } catch { /* sin eventos */ }
    };
  }

  return { enviar, suscribir };
}

/** Versión para canal.js: carga el SDK solo cuando el canal se abre y devuelve el transporte al instante. */
export function transporteDiferido(cargarBd, meetId, opciones) {
  let real = null;
  const prom = () => (real ||= cargarBd().then(db => crearTransporte(db, meetId, opciones)));
  return {
    enviar: m => prom().then(t => t.enviar(m)),
    suscribir(alMensaje, alEstado) {
      let baja = null, cerrado = false;
      prom().then(t => { if (!cerrado) baja = t.suscribir(alMensaje, alEstado); }, () => alEstado?.('sin-red'));
      return () => { cerrado = true; baja?.(); };
    },
  };
}
