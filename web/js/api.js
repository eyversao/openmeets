/* ============================================================
   OPENMEETS — Cliente REST del servidor local
   Errores en español con qué pasó y qué hacer. Los GET reintentan solos
   (red caída o 5xx) con una espera corta; los demás métodos no, para no duplicar acciones.
   ============================================================ */

import { t } from './i18n.js';
import { detectarNube } from './nube/modo.js';

/** Error de la API: `estado` HTTP (0 = sin conexión), `mensaje` listo para mostrar. */
export class ErrorApi extends Error {
  constructor(mensaje, estado = 0, extra = {}) { super(mensaje); this.name = 'ErrorApi'; this.estado = estado; Object.assign(this, extra); }
  get sinConexion() { return this.estado === 0; }
  get sinPermiso() { return this.estado === 401 || this.estado === 403; }
}

const base = () => String(globalThis.__OPENMEETS_BASE__ || '').replace(/\/+$/, '');
const ESPERA_REINTENTO = [400, 1200];
const TIEMPO_MAX = 10000;
const pausa = ms => new Promise(r => setTimeout(r, ms));

function mensajeDe(estado, servidor) {
  if (servidor) return servidor;
  switch (estado) {
    case 401: case 403: return t('Necesitas el PIN de organizador. Escríbelo en Ajustes o abre OpenMeets desde el equipo de la mesa.');
    case 404: return t('No encontramos eso. Quizá se borró o el enlace está mal escrito.');
    case 409: return t('Alguien más cambió esto a la vez. Recarga y vuelve a intentarlo.');
    case 413: return t('Es demasiado grande para enviarlo de una vez. Divídelo en partes más pequeñas.');
    case 429: return t('Demasiados intentos seguidos. Espera unos segundos y vuelve a probar.');
    default: return estado >= 500 ? t('El servidor tuvo un problema. Vuelve a intentarlo; si sigue igual, revisa la ventana de OpenMeets en la mesa.') : t('No se pudo completar la petición.');
  }
}

/** Versión en la nube (hay /nube.json): las mismas rutas, resueltas en el navegador contra Firestore. */
async function viaNube(metodo, ruta, cuerpo, tipo) {
  try {
    const r = await (await import('./nube/rutas.js')).pedir(metodo, ruta, cuerpo);
    return tipo === 'texto' && typeof r !== 'string' ? JSON.stringify(r) : r;
  } catch (e) { throw new ErrorApi(mensajeDe(e.estado, e.message), e.estado ?? 0); }
}

async function una(metodo, ruta, cuerpo, tipo) {
  if (await detectarNube()) return viaNube(metodo, ruta, cuerpo, tipo);
  const ctl = new AbortController();
  const temporizador = setTimeout(() => ctl.abort(), TIEMPO_MAX);
  let r;
  try {
    r = await fetch(base() + ruta, {
      method: metodo, credentials: 'same-origin', signal: ctl.signal,
      headers: cuerpo !== undefined && tipo === 'json' ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: cuerpo !== undefined ? (tipo === 'json' ? JSON.stringify(cuerpo) : cuerpo) : undefined,
    });
  } catch (e) {
    throw new ErrorApi(ctl.signal.aborted
      ? t('El servidor tardó demasiado en responder. Comprueba que OpenMeets sigue abierto en el equipo de la mesa.')
      : t('No hay conexión con OpenMeets. Comprueba que el programa sigue abierto en el equipo de la mesa y que estás en la misma Wi-Fi.'), 0);
  } finally { clearTimeout(temporizador); }
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = null; }
  if (!r.ok || json?.ok === false) throw new ErrorApi(mensajeDe(r.status, json?.error), r.status, { datos: json });
  return tipo === 'texto' ? texto : json;
}

/** Petición con reintento corto en GET. `opciones.reintentos` fuerza otro número. */
export async function pedir(metodo, ruta, cuerpo, { reintentos = metodo === 'GET' ? ESPERA_REINTENTO.length : 0, tipo = 'json' } = {}) {
  for (let i = 0; ; i++) {
    try { return await una(metodo, ruta, cuerpo, tipo); } catch (e) {
      const recuperable = e instanceof ErrorApi && (e.estado === 0 || e.estado >= 500);
      if (!recuperable || i >= reintentos) throw e;
      await pausa(ESPERA_REINTENTO[i] ?? 1200);
    }
  }
}

const ruta = id => `/api/meets/${encodeURIComponent(id)}`;
/** El servidor puede responder el objeto solo o envuelto ({ ok, meet }): se acepta cualquiera. */
const sacar = (j, clave) => (j && typeof j === 'object' && clave in j ? j[clave] : j);

export const api = {
  /** { app, version, puerto, ips, organizador } */
  info: () => pedir('GET', '/api/info', undefined, { reintentos: 0 }),
  /** Entra como organizador desde otro equipo con el PIN de 6 dígitos de la consola. */
  sesion: pin => pedir('POST', '/api/sesion', { pin: String(pin).trim() }),
  /** Nube (modo cuentas): cambia el ID token de Google por una sesión; salir la cierra. */
  sesionGoogle: idToken => pedir('POST', '/api/sesion', { idToken }),
  salir: () => pedir('DELETE', '/api/sesion'),
  meets: async ({ todas = false } = {}) => sacar(await pedir('GET', `/api/meets${todas ? '?todas=1' : ''}`), 'meets') || [],
  crearMeet: async meet => sacar(await pedir('POST', '/api/meets', meet), 'meet'),
  meet: async id => sacar(await pedir('GET', ruta(id)), 'meet'),
  cambiarMeet: async (id, campos) => sacar(await pedir('PATCH', ruta(id), campos), 'meet'),
  borrarMeet: id => pedir('DELETE', ruta(id)),
  guardarAtleta: async (id, atleta) => sacar(await pedir('PUT', `${ruta(id)}/atletas/${encodeURIComponent(atleta.id)}`, atleta), 'atleta'),
  guardarAtletas: (id, atletas) => pedir('POST', `${ruta(id)}/atletas`, { atletas }),
  borrarAtleta: (id, aid) => pedir('DELETE', `${ruta(id)}/atletas/${encodeURIComponent(aid)}`),
  /** Dirección del CSV de resultados (para un enlace de descarga). */
  urlResultadosCsv: id => `${base()}${ruta(id)}/resultados.csv`,
  urlExportar: id => `${base()}${ruta(id)}/export.json`,
  exportar: id => pedir('GET', `${ruta(id)}/export.json`),
  importar: copia => pedir('POST', '/api/meets/importar', copia),
  /** Público: un aplauso a un atleta (el servidor limita a 1 cada 10 s por IP y atleta). */
  aplaudir: (id, aid) => pedir('POST', `${ruta(id)}/aplauso`, { aid }),
};

export default api;
