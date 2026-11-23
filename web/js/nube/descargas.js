/* OpenMeets (nube) · descargas. Los enlaces <a href="/api/meets/:id/resultados.csv"> de las vistas no tienen servidor detrás:
   un solo listener los intercepta, pide los datos a las rutas del navegador y descarga el archivo. */

const RUTA = /^\/api\/meets\/([^/]+)\/(resultados\.csv|inscripciones\.csv|export\.json)$/;

/** { id, nombre, mime } si el href es una descarga de la API; si no, null. */
export function reconocer(href, origen = 'http://x') {
  let u;
  try { u = new URL(href, origen); } catch { return null; }
  const m = RUTA.exec(u.pathname);
  if (!m) return null;
  const id = decodeURIComponent(m[1]);
  return m[2] === 'export.json'
    ? { id, ruta: u.pathname, nombre: `${id}.json`, mime: 'application/json;charset=utf-8' }
    : { id, ruta: u.pathname, nombre: `${id}-${m[2]}`, mime: 'text/csv;charset=utf-8' };
}

/** Contenido del archivo: el CSV ya viene como texto; el JSON de copia, con sangría. */
export async function construir(d, pedir) {
  const r = await pedir('GET', d.ruta);
  return { nombre: d.nombre, mime: d.mime, texto: typeof r === 'string' ? r : JSON.stringify(r) };
}

export function guardar({ nombre, mime, texto }, doc = document) {
  const url = URL.createObjectURL(new Blob([texto], { type: mime }));
  const a = Object.assign(doc.createElement('a'), { href: url, download: nombre });
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function instalarDescargas(pedir, { doc = document, aviso = () => {} } = {}) {
  doc.addEventListener('click', e => {
    const a = e.target?.closest?.('a[href]');
    const d = a && reconocer(a.getAttribute('href'));
    if (!d) return;
    e.preventDefault();
    construir(d, pedir).then(f => guardar(f, doc), err => aviso(err?.message || 'No se pudo preparar la descarga.'));
  }, true);
}
