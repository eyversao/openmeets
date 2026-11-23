// OpenMeets · archivos de web/ (o del ejecutable, con `leer`). Rutas sin extensión caen en index.html.
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.map': 'application/json',
};

/** Ruta absoluta dentro de `raiz` o null si intenta salirse (../, bytes nulos, codificación rota). */
export function resolverRuta(raiz, ruta) {
  let rel;
  try { rel = decodeURIComponent(ruta); } catch { return null; }
  if (rel.includes('\0') || rel.split(/[\\/]/).includes('..')) return null;
  const base = resolve(raiz);
  const archivo = resolve(join(base, rel));
  return archivo === base || archivo.startsWith(base + sep) ? archivo : null;
}

const COMPRIMIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.svg', '.txt', '.csv', '.map']);
const comprimidos = new Map(); // «ruta|etag|codificación» → Buffer; cada archivo se comprime una vez por versión

export function crearEstatico({ carpeta, leer } = {}) {
  const raiz = resolve(carpeta || '.');
  const cabecera = (nombre, esIndex, etag) => {
    const ext = extname(nombre).toLowerCase();
    const cab = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' };
    cab['Cache-Control'] = esIndex || ext === '.html' || /(^|[\\/])sw\.js$/.test(nombre) ? 'no-store' : 'no-cache';
    if (etag) cab.ETag = etag;
    return cab;
  };
  const enviar = (req, res, nombre, datos, esIndex, etag) => {
    const cab = cabecera(nombre, esIndex, etag);
    const ext = extname(nombre).toLowerCase();
    const acepta = String(req.headers['accept-encoding'] || '');
    const cod = datos.length > 512 && COMPRIMIBLE.has(ext) ? (/\bbr\b/.test(acepta) ? 'br' : /\bgzip\b/.test(acepta) ? 'gzip' : '') : '';
    if (COMPRIMIBLE.has(ext)) cab.Vary = 'Accept-Encoding';
    if (cod) {
      cab['Content-Encoding'] = cod;
      if (etag) cab.ETag = etag.replace(/"$/, `-${cod}"`);
      const clave = `${nombre}|${etag}|${cod}`;
      let z = etag && comprimidos.get(clave);
      if (!z) {
        z = cod === 'br' ? brotliCompressSync(datos, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: datos.length } }) : gzipSync(datos, { level: 9 });
        if (etag) { if (comprimidos.size > 400) comprimidos.clear(); comprimidos.set(clave, z); }
      }
      datos = z;
    }
    if (cab.ETag && req.headers['if-none-match'] === cab.ETag && cab['Cache-Control'] !== 'no-store') { res.writeHead(304, cab); return res.end(); }
    res.writeHead(200, { ...cab, 'Content-Length': datos.length });
    res.end(req.method === 'HEAD' ? undefined : datos);
  };
  const no = (res, n, t) => { res.writeHead(n, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(t); };

  return async function servir(req, res, pathname) {
    // Modo ejecutable: `leer(ruta relativa)` devuelve un Buffer o null, sin tocar el disco.
    if (leer) {
      let rel;
      try { rel = decodeURIComponent(pathname).replace(/^\/+/, ''); } catch { return no(res, 400, 'Petición no válida'); }
      if (rel.includes('\0') || rel.split(/[\\/]/).includes('..')) return no(res, 403, 'Prohibido');
      let nombre = rel === '' || rel.endsWith('/') ? `${rel}index.html` : rel;
      let datos = await leer(nombre), esIndex = false;
      if (!datos) {
        if (extname(rel) && extname(rel) !== '.html') return no(res, 404, 'No existe');
        nombre = 'index.html'; esIndex = true; datos = await leer(nombre);
      }
      if (!datos) return no(res, 404, 'No existe');
      return enviar(req, res, nombre, datos, esIndex, `"${createHash('sha1').update(datos).digest('hex').slice(0, 16)}"`);
    }
    const archivo0 = resolverRuta(raiz, pathname);
    if (!archivo0) return no(res, 403, 'Prohibido');
    let archivo = archivo0, esIndex = false, s;
    try {
      s = await stat(archivo);
      if (s.isDirectory()) { archivo = join(archivo, 'index.html'); s = await stat(archivo); }
      if (!s.isFile()) throw new Error('no es archivo');
    } catch {
      if (extname(pathname) && extname(pathname) !== '.html') return no(res, 404, 'No existe');
      archivo = join(raiz, 'index.html'); esIndex = true;
      try { s = await stat(archivo); } catch { return no(res, 404, 'Falta web/index.html'); }
    }
    try { enviar(req, res, archivo, await readFile(archivo), esIndex, `W/"${s.size}-${Math.floor(s.mtimeMs)}"`); } catch { no(res, 404, 'No existe'); }
  };
}
