/* OpenMeets (nube) · adaptador mínimo sobre Firestore y Firebase Auth. Todo el SDK se baja de gstatic bajo demanda (nunca en modo local).
   Interfaz (la usan rutas.js y transporte.js, y las pruebas la sustituyen por una falsa):
     get(ruta) → datos | null            list(ruta, { donde, orden, limite }) → [{ id, d }]      contar(ruta, donde) → n
     set(ruta, datos, { merge })         update(ruta, datos)      del(ruta)      lote([{ op: 'set'|'update'|'del', ruta, datos, merge }])
     inc(n)                              centinela de incremento
     escuchar(ruta, opciones, fn)        fn({ cambios: [{ tipo, id, d }], deCache, error }) → baja
     usuario() → { uid, email, nombre, foto } | null      salir()      config */
import { sinIndefinidos } from './modelo.js';

const VERSION = '12.19.0';
const G = `https://www.gstatic.com/firebasejs/${VERSION}/`;
export const CLAVE_SESION = 'openmeets.cuenta'; // recuerda que hubo login: solo entonces las páginas públicas bajan Firebase Auth
const ESPERA_ESCRITURA = 8000;

const almacen = () => { try { return globalThis.localStorage; } catch { return null; } };
export const huboSesion = () => { try { return almacen()?.getItem(CLAVE_SESION) === '1'; } catch { return false; } };
export const marcarSesion = si => { try { if (si) almacen()?.setItem(CLAVE_SESION, '1'); else almacen()?.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ } };
/** Las pantallas del organizador siempre necesitan saber si hay sesión. */
const paginaDeCuenta = () => /^\/(organizar|ajustes)(\/|$)/.test(globalThis.location?.pathname || '');

/** Una escritura en Firestore se resuelve al confirmarla el servidor; sin red se queda en la cola local, así que no se espera para siempre. */
const sinEsperar = (p, ms = ESPERA_ESCRITURA) => new Promise((ok, no) => {
  const t = setTimeout(ok, ms);
  p.then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); no(e); });
});

/** Las operaciones de datos sobre un Firestore ya creado (`fs` = módulo firebase/firestore, `db` = la instancia). */
export function adaptarFirestore(fs, db) {
  const ref = ruta => (ruta.split('/').length % 2 ? fs.collection(db, ruta) : fs.doc(db, ruta));
  const consulta = (ruta, { donde = [], orden, limite } = {}) => {
    const c = [...donde.map(([k, op, v]) => fs.where(k, op, v))];
    if (orden) c.push(fs.orderBy(orden[0], orden[1] || 'asc'));
    if (limite) c.push(fs.limit(limite));
    return fs.query(ref(ruta), ...c);
  };
  const fila = x => ({ id: x.id, d: x.data() });
  return {
    inc: n => fs.increment(n),
    async get(ruta) { const s = await fs.getDoc(ref(ruta)); return s.exists() ? s.data() : null; },
    async list(ruta, o) { return (await fs.getDocs(consulta(ruta, o))).docs.map(fila); },
    async contar(ruta, donde) { return (await fs.getCountFromServer(consulta(ruta, { donde }))).data().count; },
    set: (ruta, datos, { merge = false } = {}) => sinEsperar(fs.setDoc(ref(ruta), sinIndefinidos(datos), merge ? { merge: true } : {})),
    update: (ruta, datos) => sinEsperar(fs.updateDoc(ref(ruta), sinIndefinidos(datos))),
    del: ruta => sinEsperar(fs.deleteDoc(ref(ruta))),
    async lote(ops) {
      for (let i = 0; i < ops.length; i += 400) {
        const b = fs.writeBatch(db);
        for (const o of ops.slice(i, i + 400)) {
          const r = ref(o.ruta);
          if (o.op === 'del') b.delete(r); else if (o.op === 'update') b.update(r, sinIndefinidos(o.datos)); else if (o.merge) b.set(r, sinIndefinidos(o.datos), { merge: true }); else b.set(r, sinIndefinidos(o.datos));
        }
        await sinEsperar(b.commit());
      }
    },
    escuchar(ruta, opciones, fn) {
      const esDoc = !(ruta.split('/').length % 2);
      let previo = null;
      return fs.onSnapshot(esDoc ? ref(ruta) : consulta(ruta, opciones), { includeMetadataChanges: true }, s => {
        const deCache = s.metadata.fromCache;
        if (!esDoc) return fn({ deCache, cambios: s.docChanges().map(c => ({ tipo: c.type, id: c.doc.id, d: c.doc.data() })) });
        const d = s.exists() ? s.data() : null, txt = JSON.stringify(d);
        const tipo = !d ? 'removed' : previo === null ? 'added' : 'modified';
        const cambia = txt !== previo;
        previo = txt;
        fn({ deCache, cambios: cambia ? [{ tipo, id: s.id, d }] : [] });
      }, error => fn({ error, cambios: [], deCache: true }));
    },
  };
}

/** Conecta Auth al emulador si la config lo pide (una sola vez por instancia). */
export function usarEmulador(auth, inst, config) {
  if (config?.emulador && !inst.emulatorConfig) auth.connectAuthEmulator(inst, 'http://127.0.0.1:9099', { disableWarnings: true });
  return inst;
}

let promesa = null;
export function obtenerBd(config) { return (promesa ||= crear(config)); }

async function crear(config) {
  const conAuth = huboSesion() || paginaDeCuenta();
  let [app, fs, auth] = await Promise.all([import(`${G}firebase-app.js`), import(`${G}firebase-firestore.js`), conAuth ? import(`${G}firebase-auth.js`) : null]);
  const a = app.getApps()[0] || app.initializeApp(config);
  let db;
  try {
    db = fs.initializeFirestore(a, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }), experimentalAutoDetectLongPolling: true });
  } catch {
    try { db = fs.initializeFirestore(a, { localCache: fs.memoryLocalCache(), experimentalAutoDetectLongPolling: true }); } catch { db = fs.getFirestore(a); }
  }
  // pruebas locales: nube.json con "emulador": true apunta a los emuladores de Firebase (nunca en el despliegue real)
  if (config.emulador) fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
  let au = auth ? usarEmulador(auth, auth.getAuth(a), config) : null;
  const cargarAuth = async () => { if (!au) { auth ||= await import(`${G}firebase-auth.js`); au = usarEmulador(auth, auth.getAuth(a), config); } return au; };
  return {
    config,
    ...adaptarFirestore(fs, db),
    /** Usuario con sesión o null. Sin la marca de sesión no se baja Auth. */
    async usuario() {
      if (!au) return null;
      await au.authStateReady?.();
      const u = au.currentUser;
      return u ? { uid: u.uid, email: u.email || '', nombre: u.displayName || '', foto: u.photoURL || '' } : null;
    },
    async salir() { marcarSesion(false); if (au) await auth.signOut(au); },
    /** Tras entrar con Google (cuenta.js ya cargó Auth con la misma app). */
    async enlazarAuth() { await cargarAuth(); },
    recordarSesion: marcarSesion,
  };
}
