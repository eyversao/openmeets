/* OpenMeets · ¿versión en la nube o servidor local?
   /nube.json solo existe en el despliegue de Firebase Hosting (lo escribe scripts/nube-build.mjs). Si responde un JSON con
   apiKey y projectId, la app usa Firestore; con cualquier otra cosa (404, el index.html del rewrite, sin red) sigue en modo local. */

/** Config válida de Firebase o null. */
export const configValida = j => (j && typeof j === 'object' && !Array.isArray(j) && typeof j.apiKey === 'string' && typeof j.projectId === 'string' ? j : null);

export async function leerConfigNube(f) {
  try {
    const r = await f('/nube.json', { cache: 'no-cache' });
    return r.ok ? configValida(await r.json()) : null;
  } catch { return null; }
}

let prom = null;
/** Se consulta una sola vez. En Node (pruebas) y sin fetch no hay nube. */
export const detectarNube = () => (prom ||= typeof document === 'undefined' || typeof fetch !== 'function' ? Promise.resolve(null) : leerConfigNube(globalThis.__nube ? () => globalThis.__nube : fetch.bind(globalThis))); // index.html ya la pidió en cuando empezó a cargar
