// Login con Google (solo en la nube, modo cuentas). Firebase Auth se carga de gstatic bajo demanda:
// la app local nunca lo descarga. La configuración web llega de /api/info (no va en el repo).
const VERSION = '12.19.0';
let listo = null;
const cargar = config => (listo ||= Promise.all([
  import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`),
  import(`https://www.gstatic.com/firebasejs/${VERSION}/firebase-auth.js`),
  import('./nube/bd.js'),
]).then(([app, auth, bd]) => ({ auth, inst: bd.usarEmulador(auth, auth.getAuth(app.getApps()[0] || app.initializeApp(config)), config) })));

/** Abre la ventana de Google y devuelve el ID token para cambiarlo por una sesión en /api/sesion. */
export async function entrarConGoogle(config) {
  const { auth, inst } = await cargar(config);
  const proveedor = new auth.GoogleAuthProvider();
  proveedor.setCustomParameters({ prompt: 'select_account' });
  return (await auth.signInWithPopup(inst, proveedor)).user.getIdToken();
}

export async function salirDeGoogle(config) {
  try { const { auth, inst } = await cargar(config); await auth.signOut(inst); } catch { /* la sesión del servidor ya se cerró */ }
}

/** El usuario cerró la ventana: no es un error que haya que mostrar. */
export const cancelado = e => ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'].includes(e?.code);
