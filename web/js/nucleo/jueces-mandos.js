/* ============================================================
   OPENMEETS — Driver de mandos para jueces
   Cualquier aparato se convierte en una señal con nombre, por ejemplo
   «tecla:KeyQ», «mando0:b3», «serie:L1» o «ble:C3». Un mapa reprogramable
   traduce esa señal a { pos: izq|cen|der, voto: blanca|roja|azul|amarilla }.
   Admite teclado (y mandos o presentadores Bluetooth que escriben como teclado),
   gamepads, placas por USB (Web Serial) y mandos OpenMeets por Bluetooth (Web Bluetooth).
   La lógica pura (parsear líneas, mapa, registro de dispositivos) se exporta
   aparte para probarla en Node; el driver solo conecta el navegador con ella.
   ============================================================ */

const CLAVE = 'openmeets.mandos.v1';

export const BOTONES = ['blanca', 'roja', 'azul', 'amarilla'];
export const POSICIONES = { L: 'izq', C: 'cen', R: 'der' };
export const LATIDO_MS = 6000;

// UUID de Nordic UART (el mando escribe en TX 0003) y de batería estándar.
export const NUS_SERVICIO = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

/** Mapa de fábrica. Teclas sin chocar con los atajos de la mesa (G, B, S, R, P, espacio). */
export function mapaDeFabrica() {
  const teclas = { izq: ['KeyQ', 'KeyA', 'Digit1', 'Digit2'], cen: ['KeyW', 'KeyZ', 'Digit3', 'Digit4'], der: ['KeyE', 'KeyC', 'Digit5', 'Digit6'] };
  const m = {};
  for (const [letra, pos] of Object.entries(POSICIONES)) {
    BOTONES.forEach((voto, i) => {
      m[`tecla:${teclas[pos][i]}`] = { pos, voto };
      m[`serie:${letra}${i + 1}`] = { pos, voto };
      m[`ble:${letra}${i + 1}`] = { pos, voto };
    });
  }
  return m;
}
export const MAPA_INICIAL = mapaDeFabrica();

/** Familia de una señal: tecla, mando (cualquier número), serie, ble. */
export const familiaDe = senal => String(senal).split(':')[0].replace(/\d+$/, '');

/** Mezcla el mapa guardado con el de fábrica: lo de fábrica solo entra si nadie lo ha reasignado. */
export function fundirMapa(guardado) {
  const g = guardado && typeof guardado === 'object' ? guardado : {};
  const limpio = Object.fromEntries(Object.entries(g).filter(([, v]) => v && typeof v.pos === 'string' && typeof v.voto === 'string'));
  const m = { ...limpio };
  for (const [s, v] of Object.entries(MAPA_INICIAL)) {
    if (s in m) continue;
    const ocupado = Object.entries(limpio).some(([s2, v2]) => v2.pos === v.pos && v2.voto === v.voto && familiaDe(s2) === familiaDe(s));
    if (!ocupado) m[s] = v;
  }
  return m;
}

export function leerMapa() {
  try { return fundirMapa(JSON.parse(localStorage.getItem(CLAVE) || '{}')); } catch { return { ...MAPA_INICIAL }; }
}
export function guardarMapa(m) { try { localStorage.setItem(CLAVE, JSON.stringify(m)); } catch { /* sin almacenamiento */ } }

/** Asigna una señal a un voto. Cada voto tiene una sola señal por familia (tecla, mando, USB, Bluetooth). */
export function programar(mapa, senal, pos, voto) {
  const fam = familiaDe(senal);
  const m = Object.fromEntries(Object.entries(mapa).filter(([s, v]) => s !== senal && !(v.pos === pos && v.voto === voto && familiaDe(s) === fam)));
  m[senal] = { pos, voto };
  return m;
}

/** Traduce una señal con el mapa → { pos, voto } o null. */
export function aplicarMapa(mapa, senal) {
  const d = mapa?.[senal];
  return d && d.pos && d.voto ? { pos: d.pos, voto: d.voto } : null;
}

/**
 * Una línea del protocolo de texto → evento.
 * L1..L4 / C1..C4 / R1..R4 = botón; BAT:L:87 = batería; HB:L = latido. Otra cosa → null.
 */
export function parsearLinea(linea) {
  const t = String(linea ?? '').trim().toUpperCase();
  let m = /^([LCR])([1-4])$/.exec(t);
  if (m) return { tipo: 'voto', pos: POSICIONES[m[1]], letra: m[1], boton: BOTONES[m[2] - 1], codigo: t };
  m = /^BAT:([LCR]):(\d{1,3})$/.exec(t);
  if (m) return { tipo: 'bateria', pos: POSICIONES[m[1]], letra: m[1], nivel: Math.min(100, Number(m[2])) };
  m = /^HB:([LCR])$/.exec(t);
  if (m) return { tipo: 'latido', pos: POSICIONES[m[1]], letra: m[1] };
  return null;
}

/** Acumula texto que llega a trozos: devuelve las líneas completas y lo que sobra. */
export function separarLineas(resto, texto) {
  const partes = (resto + texto).split(/\r?\n|\r/);
  return { lineas: partes.slice(0, -1).map(l => l.trim()).filter(Boolean), resto: partes[partes.length - 1] };
}

/**
 * Registro de dispositivos. Un dispositivo con latido (ultimoLatido != null) se da por caído
 * si pasan más de `caducidad` ms sin él; los demás valen lo que diga su enlace.
 */
export function crearRegistro({ caducidad = LATIDO_MS } = {}) {
  const disp = new Map();
  const conectadoEn = (d, ahora) => !!d.enlace && (d.ultimoLatido == null || ahora - d.ultimoLatido <= caducidad);
  return {
    actualizar(id, parche, ahora = Date.now()) {
      const d = disp.get(id) || { id, nombre: id, tipo: 'mando', enlace: true, bateria: null, pos: null, ts: ahora, ultimoLatido: null };
      Object.assign(d, parche);
      if (!parche.ts) d.ts = ahora;
      disp.set(id, d);
      return d;
    },
    latido(id, ahora = Date.now(), pos) {
      const d = this.actualizar(id, { ultimoLatido: ahora, enlace: true, ...(pos ? { pos } : {}) }, ahora);
      return d;
    },
    quitar: id => disp.delete(id),
    tiene: id => disp.has(id),
    lista(ahora = Date.now()) {
      return [...disp.values()].map(d => ({ id: d.id, nombre: d.nombre, tipo: d.tipo, conectado: conectadoEn(d, ahora), bateria: d.bateria, pos: d.pos, ts: d.ts }));
    },
  };
}

/** Espera creciente para reconectar: 1, 2, 4, 8, 15, 30 s (tope). */
export const esperaReconexion = intento => Math.min(30000, [1000, 2000, 4000, 8000, 15000][intento] ?? 30000);

export function crearDriver({ alVotar, escribiendo = () => false } = {}) {
  let mapa = leerMapa();
  let aprender = null;
  let activo = false;
  let raf = 0;
  let reloj = 0;
  let firma = '';
  const previo = new Map();
  const registro = crearRegistro();
  const oyentes = new Set();
  const puertos = [];
  const bt = new Map(); // id → { dispositivo, intento, quitado, temporizador }
  let nSerie = 0;

  const dispositivos = () => registro.lista();
  function avisar(forzar) {
    const l = dispositivos();
    const f = JSON.stringify(l.map(d => [d.id, d.conectado, d.bateria, d.pos]));
    if (!forzar && f === firma) return;
    firma = f;
    oyentes.forEach(fn => { try { fn(l); } catch (e) { console.warn('[openmeets] estado de mandos', e); } });
  }

  function emitir(senal, via = 'mando', id) {
    if (aprender) { const f = aprender; aprender = null; f(senal); return true; }
    const dest = aplicarMapa(mapa, senal);
    if (!dest) return false;
    if (id) { registro.actualizar(id, { pos: dest.pos }); avisar(); }
    alVotar?.(dest.pos, dest.voto, senal, via);
    return true;
  }

  /** Una línea del protocolo de un mando USB o Bluetooth. */
  function manejarLinea(linea, via, id) {
    const ev = parsearLinea(linea);
    if (!ev) return;
    if (ev.tipo === 'latido') registro.latido(id, Date.now(), ev.pos);
    else if (ev.tipo === 'bateria') registro.actualizar(id, { bateria: ev.nivel, pos: ev.pos, enlace: true });
    else {
      registro.actualizar(id, { pos: ev.pos, enlace: true });
      emitir(`${via === 'usb' ? 'serie' : 'ble'}:${ev.codigo}`, via, id);
    }
    avisar();
  }

  const onTecla = e => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (!aprender && escribiendo(e))) return;
    if (emitir(`tecla:${e.code}`, 'teclado')) { e.preventDefault(); registro.actualizar('teclado', {}); avisar(); }
  };

  function pollGamepads() {
    if (!activo) return;
    const vistos = new Set();
    for (const g of navigator.getGamepads?.() || []) {
      if (!g) continue;
      const id = `mando${g.index}`;
      vistos.add(id);
      if (!registro.tiene(id)) registro.actualizar(id, { nombre: g.id, tipo: 'mando', enlace: true });
      g.buttons.forEach((b, i) => {
        const k = `${g.index}:${i}`;
        const antes = previo.get(k);
        previo.set(k, b.pressed);
        if (b.pressed && !antes) { registro.actualizar(id, {}); emitir(`mando${g.index}:b${i}`, 'mando', id); }
      });
    }
    for (const d of registro.lista()) if (d.tipo === 'mando' && !vistos.has(d.id)) registro.quitar(d.id);
    avisar();
    raf = requestAnimationFrame(pollGamepads);
  }

  // ---- Bluetooth ----
  async function enlazarBt(entrada) {
    const { dispositivo: d } = entrada;
    const id = `bt:${d.id}`;
    const servidor = await d.gatt.connect();
    const servicio = await servidor.getPrimaryService(NUS_SERVICIO);
    const tx = await servicio.getCharacteristic(NUS_TX);
    let resto = '';
    const deco = new TextDecoder();
    tx.addEventListener('characteristicvaluechanged', ev => {
      const r = separarLineas(resto, deco.decode(ev.target.value));
      resto = r.resto;
      r.lineas.forEach(l => manejarLinea(l, 'bluetooth', id));
    });
    await tx.startNotifications();
    registro.actualizar(id, { enlace: true, ultimoLatido: null });
    // Batería estándar (opcional: si el mando no la trae, se queda en null).
    try {
      const sb = await servidor.getPrimaryService('battery_service');
      const nivel = await sb.getCharacteristic('battery_level');
      const leer = v => registro.actualizar(id, { bateria: v.getUint8(0) });
      leer(await nivel.readValue());
      nivel.addEventListener('characteristicvaluechanged', ev => { leer(ev.target.value); avisar(); });
      await nivel.startNotifications();
    } catch { /* sin batería */ }
    entrada.intento = 0;
    avisar();
  }

  function reconectar(entrada) {
    if (entrada.quitado || !activo || entrada.temporizador) return;
    const id = `bt:${entrada.dispositivo.id}`;
    registro.actualizar(id, { enlace: false });
    avisar();
    const intentar = () => {
      entrada.temporizador = 0;
      if (entrada.quitado || !activo) return;
      enlazarBt(entrada).catch(() => {
        const espera = esperaReconexion(entrada.intento++);
        entrada.temporizador = setTimeout(intentar, espera);
      });
    };
    entrada.temporizador = setTimeout(intentar, esperaReconexion(entrada.intento++));
  }

  return {
    iniciar() {
      if (activo) return;
      activo = true;
      registro.actualizar('teclado', { nombre: 'Teclado', tipo: 'teclado', enlace: true, ts: 0 });
      window.addEventListener('keydown', onTecla);
      if (navigator.getGamepads) raf = requestAnimationFrame(pollGamepads);
      reloj = setInterval(avisar, 2000); // caducidad de latidos
      for (const e of bt.values()) if (!e.dispositivo.gatt?.connected) reconectar(e);
      avisar(true);
    },
    detener() {
      activo = false;
      cancelAnimationFrame(raf);
      clearInterval(reloj);
      window.removeEventListener('keydown', onTecla);
      for (const e of bt.values()) { clearTimeout(e.temporizador); e.temporizador = 0; e.dispositivo.gatt?.disconnect?.(); }
      puertos.splice(0).forEach(p => p.close?.().catch(() => {}));
    },
    /** La siguiente señal, venga de donde venga, se entrega a fn. */
    aprender(fn) { aprender = fn; },
    cancelarAprendizaje() { aprender = null; },
    mapa: () => mapa,
    programar(senal, pos, voto) { mapa = programar(mapa, senal, pos, voto); guardarMapa(mapa); },
    restablecer() { mapa = { ...MAPA_INICIAL }; guardarMapa(mapa); },
    dispositivos,
    /** fn(lista) cada vez que cambia un dispositivo (conexión, batería, latido caducado). Devuelve cómo dejar de oír. */
    alEstado(fn) { oyentes.add(fn); return () => oyentes.delete(fn); },

    /** Placa por USB: cada línea es una señal del protocolo (ver mandos/LEEME.md). Solo Chrome y Edge. */
    soportaSerie: () => typeof navigator !== 'undefined' && 'serial' in navigator,
    async conectarSerie() {
      const puerto = await navigator.serial.requestPort();
      await puerto.open({ baudRate: 115200 });
      puertos.push(puerto);
      const id = `usb${nSerie++}`;
      registro.actualizar(id, { nombre: 'Placa USB', tipo: 'usb', enlace: true });
      avisar();
      const lector = puerto.readable.pipeThrough(new TextDecoderStream()).getReader();
      (async () => {
        let resto = '';
        for (;;) {
          const { value, done } = await lector.read();
          if (done) break;
          const r = separarLineas(resto, value);
          resto = r.resto;
          r.lineas.forEach(l => manejarLinea(l, 'usb', id));
        }
      })().catch(e => console.warn('[openmeets] mando USB', e)).finally(() => { registro.actualizar(id, { enlace: false }); avisar(); });
    },

    /** Mandos Bluetooth OpenMeets (Nordic UART). Solo Chrome y Edge de escritorio y Android. Se pueden conectar varios. */
    soportaBluetooth: () => typeof navigator !== 'undefined' && 'bluetooth' in navigator,
    async conectarBluetooth() {
      const d = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICIO] }, { namePrefix: 'OpenMando' }],
        optionalServices: [NUS_SERVICIO, 'battery_service'],
      });
      const id = `bt:${d.id}`;
      if (!bt.has(id)) {
        const entrada = { dispositivo: d, intento: 0, quitado: false, temporizador: 0 };
        bt.set(id, entrada);
        d.addEventListener('gattserverdisconnected', () => reconectar(entrada));
      }
      const entrada = bt.get(id);
      const letra = /OpenMando-([LCR])/i.exec(d.name || '')?.[1]?.toUpperCase();
      registro.actualizar(id, { nombre: d.name || 'Mando Bluetooth', tipo: 'bluetooth', enlace: false, pos: letra ? POSICIONES[letra] : null });
      await enlazarBt(entrada);
    },
    probar: emitir,
  };
}
