/* ============================================================
   OPENMEETS — Acceso de jueces con teléfono (identidad, huella, código y registro de la mesa)
   Sin DOM ni red; usa WebCrypto (sirve en el navegador y en Node). Se prueba en pruebas/jueces-acceso.test.mjs.
   - El teléfono guarda un secreto aleatorio; su huella es SHA-256(secreto).
   - El código de 6 dígitos sale del FINAL de la huella; lo público (huella corta) son los 12 primeros hex,
     así que la huella corta no revela el código.
   - La mesa nunca muestra el código: el operador lo escribe y la mesa lo compara.
   ============================================================ */

const POS = ['izq', 'cen', 'der'];
const hex = u8 => [...u8].map(x => x.toString(16).padStart(2, '0')).join('');
const uuid = () => globalThis.crypto.randomUUID?.() || hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));

const almacenPorDefecto = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const leer = (alm, k) => { try { return JSON.parse(alm?.getItem(k) || 'null'); } catch { return null; } };
const escribir = (alm, k, v) => { try { alm?.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

/** Identidad del teléfono para este evento: { dispositivo, secreto, nombre }. Se crea una vez y se guarda. */
export function identidad(eventoId, almacen = almacenPorDefecto()) {
  const k = `openmeets.juez.${eventoId}`;
  const g = leer(almacen, k);
  if (g && typeof g.dispositivo === 'string' && /^[0-9a-f]{64}$/.test(g.secreto || '')) return { nombre: '', ...g };
  const nueva = { dispositivo: uuid().slice(0, 40), secreto: hex(globalThis.crypto.getRandomValues(new Uint8Array(32))), nombre: '' };
  escribir(almacen, k, nueva);
  return nueva;
}
export function guardarNombre(eventoId, nombre, almacen = almacenPorDefecto()) {
  const id = identidad(eventoId, almacen);
  id.nombre = String(nombre || '').trim().slice(0, 60);
  escribir(almacen, `openmeets.juez.${eventoId}`, id);
  return id;
}

/* SHA-256 en JS puro: en la red local el teléfono abre http://192.168… (no es contexto seguro) y ahí
   el navegador no da crypto.subtle. getRandomValues sí funciona sin https. */
const K256 = Uint32Array.from('428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5 d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174 e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da 983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967 27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85 a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070 19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3 748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2'.split(' ').map(x => parseInt(x, 16)));
export function sha256Puro(bytes) {
  const l = bytes.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
  m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(n - 4, (l * 8) >>> 0); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
  const h = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64), r = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) w[i] = (w[i - 16] + (r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10))) >>> 0;
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((x, i) => { h[i] = (h[i] + x) >>> 0; });
  }
  return [...h].map(x => x.toString(16).padStart(8, '0')).join('');
}

/** SHA-256 del secreto, en hexadecimal (64 caracteres). */
export async function huella(secreto) {
  const datos = new TextEncoder().encode(String(secreto));
  const sutil = globalThis.crypto?.subtle;
  if (!sutil) return sha256Puro(datos);
  return hex(new Uint8Array(await sutil.digest('SHA-256', datos)));
}
/** Los 12 primeros hex: es pública (va en el vivo). */
export const corta = h => String(h || '').slice(0, 12);
/** Código de 6 dígitos derivado del final de la huella (no de los 12 públicos). */
export function codigoPar(h) {
  const t = String(h || '').slice(-12);
  if (!/^[0-9a-f]{12}$/.test(t)) return '';
  return String(parseInt(t, 16) % 1000000).padStart(6, '0');
}
export const formatoCodigo = c => (c && c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c || '');
/** ¿El texto que escribió el operador es el código de esa huella? Ignora espacios y guiones. */
export const codigoCoincide = (h, tecleado) => { const c = codigoPar(h); return !!c && String(tecleado ?? '').replace(/\D/g, '') === c; };

/**
 * ¿El voto de un teléfono viene de un dispositivo aprobado para esa posición?
 * `aprobados`: lista de huellas (completas o cortas) de esa posición, o un mapa { pos: lista | { huella: … } }.
 */
export async function verificarVoto(voto, aprobados) {
  if (!voto || typeof voto.secreto !== 'string' || !voto.secreto) return false;
  let lista = aprobados;
  if (lista && !Array.isArray(lista)) lista = lista[voto.pos];
  if (lista && !Array.isArray(lista)) lista = Object.keys(lista);
  if (!lista?.length) return false;
  const h = await huella(voto.secreto);
  return lista.some(x => x === h || x === corta(h));
}

/** Estado que ve el teléfono: 'abierta' | 'ok' | 'no' | 'espera'. */
export function estadoAcceso(vivo, evento, huellaCorta) {
  const modo = vivo?.aprobacion || evento?.aprobacion || 'mesa';
  if (modo === 'abierta') return 'abierta';
  const a = vivo?.accesos?.[huellaCorta];
  return a === 'ok' ? 'ok' : a === 'no' ? 'no' : 'espera';
}
export const puedeVotar = e => e === 'abierta' || e === 'ok';
export const modoAprobacion = evento => (['abierta', 'mesa', 'codigo'].includes(evento?.aprobacion) ? evento.aprobacion : 'mesa');

/** Solo en 'abierta' la mesa acepta votos de teléfono sin comprobar. */
export const necesitaAprobacion = evento => modoAprobacion(evento) !== 'abierta';

/**
 * Registro de la mesa: aprobados por tarima y posición, rechazados y jueces conocidos.
 * Se guarda en el almacén (sin internet) y los conocidos se copian a privado/config por `guardarConocidos`.
 */
export function crearRegistro(eventoId, { almacen = almacenPorDefecto(), guardarConocidos = null, ahora = Date.now } = {}) {
  const k = `openmeets.mesa.acceso.${eventoId}`;
  const g = leer(almacen, k) || {};
  const s = { aprob: g.aprob || {}, no: g.no || {}, conocidos: g.conocidos || {} };
  const guardar = () => escribir(almacen, k, s);
  const claveP = p => String(p);
  const aprobDe = (p, pos) => (s.aprob[claveP(p)] ||= {})[pos] ||= {};
  return {
    estado: s,
    /** Une los conocidos de privado/config (lo del servidor manda sobre el almacén local si trae algo). */
    cargarConocidos(c) { if (c && typeof c === 'object') { s.conocidos = { ...s.conocidos, ...c }; guardar(); } },
    conocidos: () => Object.entries(s.conocidos).map(([h, v]) => ({ huella: h, ...v })),
    esConocido: (h, pos) => !!s.conocidos[h] && (!pos || s.conocidos[h].pos === pos),
    estadoDe(p, pos, h) {
      if (s.aprob[p]?.[pos]?.[h]) return 'ok';
      if (s.no[p]?.[h]) return 'no';
      return 'espera';
    },
    /** ¿Alguna aprobación de este dispositivo en esa tarima (cualquier posición)? Para el panel de jueces. */
    admite: (p, pos, h) => !!s.aprob[p]?.[pos]?.[h],
    aprobar(p, pos, h, { nombre = '', dispositivo = '', recordar = false } = {}) {
      if (!POS.includes(pos) || !h) return false;
      aprobDe(p, pos)[h] = { nombre: String(nombre).slice(0, 60), dispositivo: String(dispositivo).slice(0, 40), ts: ahora() };
      if (s.no[p]) delete s.no[p][h];
      if (recordar) { s.conocidos[h] = { pos, nombre: String(nombre).slice(0, 60), ts: ahora() }; guardarConocidos?.({ ...s.conocidos }); }
      guardar();
      return true;
    },
    rechazar(p, h) { (s.no[p] ||= {})[h] = ahora(); for (const pos of POS) if (s.aprob[p]?.[pos]) delete s.aprob[p][pos][h]; guardar(); },
    /** Quita el acceso: vuelve a quedar como solicitud nueva. */
    quitar(p, pos, h) { if (s.aprob[p]?.[pos]) delete s.aprob[p][pos][h]; guardar(); },
    olvidar(h) { delete s.conocidos[h]; guardar(); guardarConocidos?.({ ...s.conocidos }); },
    /** Huellas aprobadas de una posición (lista para verificarVoto). */
    aprobadosDe: (p, pos) => Object.keys(s.aprob[p]?.[pos] || {}),
    aprobados: () => Object.entries(s.aprob).flatMap(([p, m]) => Object.entries(m).flatMap(([pos, hs]) => Object.entries(hs).map(([h, v]) => ({ plataforma: p, pos, huella: h, ...v })))),
    /** Mapa público { huellaCorta: 'ok'|'no' } de una tarima, para vivo.accesos. */
    accesos(p) {
      const o = {};
      for (const pos of POS) for (const h of Object.keys(s.aprob[p]?.[pos] || {})) o[corta(h)] = 'ok';
      for (const h of Object.keys(s.no[p] || {})) if (!o[corta(h)]) o[corta(h)] = 'no';
      return o;
    },
    /**
     * Solicitudes vigentes: presencias con huella que aún no están aprobadas ni rechazadas.
     * `presencias` es el mapa del canal; cada una trae { plataforma, pos, dispositivo, nombre, huella, ts }.
     */
    solicitudes(presencias = {}, { maxMs = 20000 } = {}) {
      const t = ahora();
      return Object.values(presencias)
        .filter(x => x && x.huella && x.dispositivo && POS.includes(x.pos) && t - (Number(x.ts) || 0) < maxMs && this.estadoDe(x.plataforma, x.pos, x.huella) === 'espera')
        .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
    },
    /** Presencias de dispositivos conocidos aún sin aprobar en esa posición: se aprueban solas. */
    paraAutoAprobar(presencias = {}) {
      return this.solicitudes(presencias).filter(x => this.esConocido(x.huella, x.pos));
    },
  };
}
