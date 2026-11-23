/* OpenMeets (nube) · modelo de datos en Firestore. Funciones puras: de un meet completo a documentos y de documentos a meet.
   meets/{id}                       meet público + dueno + n (atletas) + enVivo
   meets/{id}/atletas/{aid}         un atleta
   meets/{id}/vivo|regie/{plat}     { plataforma, datos }
   meets/{id}/aplausos/{aid}        { n }
   meets/{id}/actividad/{auto}      { ts, texto }
   meets/{id}/privado/datos         { codigoJuez, juecesConocidos }   (solo dueño)
   meets/{id}/votos|presencia/{k}   voto o presencia del juez, con `codigo`   (escribe cualquiera con el código; lee el dueño)
   meets/{id}/inscripciones/{iid}   inscrito (crea el público; lee y edita el dueño)
   meets/{id}/publico/cupos         { ocupados, espera, porClase } para el formulario público */
import { estadoMeet } from '../nucleo/calculo.js';
import { clavePlat } from '../canal.js';

export const SUBCOLECCIONES = ['atletas', 'vivo', 'regie', 'aplausos', 'actividad', 'privado', 'votos', 'presencia', 'inscripciones', 'publico'];
const FUERA_DEL_DOC = ['atletas', 'vivo', 'regie', 'aplausos', 'actividad', 'privado'];

/** Quita lo que no es un valor de Firestore (undefined, NaN). Conserva los centinelas (increment). */
export function sinIndefinidos(v) {
  if (Array.isArray(v)) return v.map(x => (x === undefined ? null : sinIndefinidos(x)));
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = sinIndefinidos(x);
    return o;
  }
  return typeof v === 'number' && !Number.isFinite(v) ? null : v;
}

/** Campos del documento meets/{id} a partir de un meet. */
export function docDeMeet(m, { dueno, n = 0, enVivo = false } = {}) {
  const o = {};
  for (const [k, v] of Object.entries(m)) if (!FUERA_DEL_DOC.includes(k)) o[k] = v;
  return sinIndefinidos({ ...o, dueno, n, enVivo });
}

export const docVivo = (plataforma, datos) => ({ plataforma, datos: sinIndefinidos(datos) });
export const idPlat = clavePlat;

/** ¿Hay alguna plataforma en vivo? (para el bit `enVivo` del listado). */
export const hayVivo = vivos => Object.values(vivos || {}).some(v => v && v.datos ? v.datos.actual : v?.actual);

/** Estado del meet a partir de su documento (sin cargar el vivo). */
export const estadoDeDoc = (d, hoy) => estadoMeet({ ...d, vivo: d.enVivo ? { x: { actual: true } } : {} }, hoy);

/** Documentos de una colección { id, d } → mapa { plataforma: datos }. */
export const mapaPlat = filas => Object.fromEntries(filas.map(f => [f.d.plataforma, f.d.datos]));

/** Meet completo (la forma que devuelve GET /api/meets/:id) a partir del documento y sus subcolecciones. */
export function armarMeet(doc, { atletas = [], vivo = [], regie = [], aplausos = [], actividad = [], privado = null } = {}) {
  const { n, enVivo, dueno, ...pub } = doc;
  const m = {
    ...pub,
    atletas: atletas.map(f => f.d),
    vivo: mapaPlat(vivo), regie: mapaPlat(regie),
    aplausos: Object.fromEntries(aplausos.map(f => [f.id, Number(f.d.n) || 0])),
    actividad: actividad.map(f => ({ ts: f.d.ts, texto: f.d.texto })).sort((a, b) => a.ts - b.ts),
  };
  if (privado) m.privado = privado;
  return m;
}

/** Campos públicos que viajan en un 'meet-cambio' cuando cambia el documento. */
export const camposPublicos = doc => { const { n, enVivo, dueno, ...pub } = doc; return pub; };

/** Id de documento para votos y presencias: plataforma, posición y dispositivo, solo con caracteres seguros. */
export const claveJuez = (plataforma, pos, dispositivo) => `${clavePlat(plataforma)}__${pos}__${String(dispositivo || '').replace(/[^\w-]/g, '')}`.slice(0, 120);

export async function hashHex(texto, largo = 24) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('').slice(0, largo);
}
