/* ============================================================
   OPENMEETS (nube) — Las rutas de /api/* contra Firestore, dentro del navegador.
   `pedir(metodo, ruta, cuerpo)` devuelve lo mismo que el servidor local y lanza ErrorApi(estado, mensaje), así que
   api.js, inscripciones-api.js y todas las vistas funcionan sin cambios. La seguridad real está en firestore.rules.
   ============================================================ */
import {
  ErrorApi, mal, idSeguro, hexAleatorio, limpiarAtleta, limpiarCampos, meetNuevo, meetImportado, anotar, cambiosDeResultados, MAX_ATLETAS,
} from '../nucleo/validar.js';
import { estadoMeet, resumenMeet, resultadosCSV, celda } from '../nucleo/calculo.js';
import { estadoApertura, contarCupos, cabe, claveDuplicado, csvInscripciones, ESTADOS } from '../nucleo/inscripcion.js';
import { MAX_INSCRITOS, limpiarConfig, validarInscripcion, MENSAJE_DUPLICADO, codigoInscripcion, itemNuevo, atletaDeInscripcion } from '../nucleo/inscribir.js';
import { SUBCOLECCIONES, docDeMeet, docVivo, idPlat, hayVivo, armarMeet, sinIndefinidos, hashHex } from './modelo.js';

export const VERSION = '1.0.0';
export const MSG_NO = 'En la versión en la nube esto no está disponible; usa OpenMeets en tu red local.';
const MAX_MEETS = 50;
const SOLO_DUENO = 'Solo la cuenta que creó esta competencia puede hacer esto.';
const SIN_ATLETA = 'No encuentro ese atleta';
const SIN_MEET = 'No encuentro ese meet';

/** Errores de Firestore → los mismos estados que daría el servidor. */
export function traducir(e, lectura) {
  if (e instanceof ErrorApi) return e;
  switch (e?.code) {
    case 'permission-denied': return lectura ? new ErrorApi(404, SIN_MEET) : new ErrorApi(403, SOLO_DUENO);
    case 'unauthenticated': return new ErrorApi(401, 'Entra con tu cuenta de Google para hacer esto.');
    case 'resource-exhausted': return new ErrorApi(429, 'Se agotó la cuota gratuita de hoy. Vuelve a intentarlo mañana o pasa el proyecto a un plan de pago.');
    case 'unavailable': case 'deadline-exceeded': case 'failed-precondition': case 'cancelled': return new ErrorApi(0, 'Sin conexión con la nube. Se reintenta solo.');
    default: return new ErrorApi(500, 'Error en la nube. Vuelve a intentarlo.');
  }
}

const memoria = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
const almacenLocal = () => { try { return globalThis.localStorage || memoria(); } catch { return memoria(); } };

export function crearRutas({ db, almacen = almacenLocal(), ahora = Date.now } = {}) {
  const duenos = new Map();      // id → uid del dueño (no cambia nunca)
  const atletasEscritos = new Map(); // id/aid → último atleta escrito desde aquí (evita leer antes de cada resultado)
  const b = id => `meets/${id}`;
  const leerOnull = async ruta => { try { return await db.get(ruta); } catch (e) { if (e?.code === 'permission-denied') return null; throw e; } };
  const ocupado = async id => { try { return !!(await db.get(b(id))); } catch (e) { if (e?.code === 'permission-denied') return true; throw e; } };

  async function requiereUsuario() {
    const u = await db.usuario();
    if (!u) mal(401, 'Entra con tu cuenta de Google para crear competencias.');
    return u;
  }
  async function docMeet(id) { const d = await db.get(b(id)); if (!d) mal(404, SIN_MEET); return d; }
  async function dueno(id) {
    const u = await db.usuario();
    if (!duenos.has(id)) duenos.set(id, (await docMeet(id)).dueno);
    if (!u || u.uid !== duenos.get(id)) mal(403, SOLO_DUENO);
    return u;
  }
  const entradaActividad = (id, texto) => { const m = { actividad: [] }; anotar(m, texto); return { op: 'set', ruta: `${b(id)}/actividad/${hexAleatorio(8)}`, datos: m.actividad[0] }; };
  const resumen = (d, usuario) => { const r = resumenMeet({ ...d, atletas: new Array(Number(d.n) || 0), vivo: d.enVivo ? { x: { actual: true } } : {} }); return usuario && d.dueno === usuario.uid ? { ...r, mio: true } : r; };

  /** Meet completo con sus subcolecciones; el dueño recibe además `privado`. */
  async function cargarMeet(id) {
    const doc = await docMeet(id);
    const u = await db.usuario();
    const org = !!u && u.uid === doc.dueno;
    const [atletas, vivo, regie, aplausos, actividad, privado] = await Promise.all([
      db.list(`${b(id)}/atletas`), db.list(`${b(id)}/vivo`), db.list(`${b(id)}/regie`), db.list(`${b(id)}/aplausos`),
      db.list(`${b(id)}/actividad`, { orden: ['ts', 'desc'], limite: 200 }), org ? leerOnull(`${b(id)}/privado/datos`) : null,
    ]);
    if (org && doc.n !== atletas.length) db.update(b(id), { n: atletas.length }).catch(() => {}); // el contador del listado se corrige solo
    return { m: { ...armarMeet(doc, { atletas, vivo, regie, aplausos, actividad, privado }), mio: org }, doc, org };
  }

  /** Documentos de un meet nuevo o importado. */
  function opsDeMeet(m, uid) {
    const base = b(m.id), ops = [];
    ops.push({ op: 'set', ruta: base, datos: docDeMeet(m, { dueno: uid, n: m.atletas.length, enVivo: hayVivo(m.vivo) }) });
    ops.push({ op: 'set', ruta: `${base}/privado/datos`, datos: sinIndefinidos(m.privado) });
    for (const a of m.atletas) ops.push({ op: 'set', ruta: `${base}/atletas/${a.id}`, datos: a });
    for (const [p, d] of Object.entries(m.vivo)) ops.push({ op: 'set', ruta: `${base}/vivo/${idPlat(p)}`, datos: docVivo(p, d) });
    for (const [aid, n] of Object.entries(m.aplausos)) if (n > 0) ops.push({ op: 'set', ruta: `${base}/aplausos/${aid}`, datos: { n } });
    for (const x of m.actividad) ops.push({ op: 'set', ruta: `${base}/actividad/${hexAleatorio(8)}`, datos: x });
    return ops;
  }
  async function borrarSub(id, subs = SUBCOLECCIONES) {
    const ops = [];
    for (const s of subs) for (const f of await db.list(`${b(id)}/${s}`)) ops.push({ op: 'del', ruta: `${b(id)}/${s}/${f.id}` });
    if (ops.length) await db.lote(ops);
  }
  async function contarMios(uid) {
    if ((await db.contar('meets', [['dueno', '==', uid]])) >= MAX_MEETS) mal(400, `Cada cuenta admite hasta ${MAX_MEETS} competencias. Borra alguna antigua.`);
  }

  /* ---------- /api/meets ---------- */
  async function lista(q) {
    const u = await db.usuario();
    const mias = !!u && q.get('todas') === '1';
    const filas = await db.list('meets', { donde: [mias ? ['dueno', '==', u.uid] : ['publico', '==', true]], limite: 200 });
    return filas.map(f => resumen(f.d, u)).sort((x, y) => String(y.fecha).localeCompare(String(x.fecha)));
  }
  async function crear(cuerpo) {
    const u = await requiereUsuario();
    await contarMios(u.uid);
    let m = meetNuevo(cuerpo);
    for (let i = 0; await ocupado(m.id); i++) {
      if (idSeguro(cuerpo.id) || i > 4) mal(409, 'Ya existe un meet con ese identificador');
      m = meetNuevo(cuerpo);
    }
    anotar(m, 'Meet creado');
    await db.lote(opsDeMeet(m, u.uid));
    duenos.set(m.id, u.uid);
    return { ...m, mio: true };
  }
  async function importar(cuerpo, reemplazar) {
    const u = await requiereUsuario();
    const m = meetImportado(cuerpo);
    let previo = null, ajeno = false;
    try { previo = await db.get(b(m.id)); } catch (e) { if (e?.code === 'permission-denied') ajeno = true; else throw e; } // privado y de otra cuenta
    if (previo || ajeno) {
      if (ajeno || previo.dueno !== u.uid || !reemplazar) mal(409, 'Ya existe un meet con ese identificador');
      await borrarSub(m.id, ['atletas', 'vivo', 'regie', 'aplausos', 'actividad', 'votos', 'presencia']);
    } else await contarMios(u.uid);
    await db.lote(opsDeMeet(m, u.uid));
    duenos.set(m.id, u.uid);
    return { ...m, mio: true };
  }

  async function meet(metodo, id, cuerpo) {
    if (metodo === 'GET') { const { m } = await cargarMeet(id); return { ...m, estado: estadoMeet(m) }; }
    await dueno(id);
    if (metodo === 'PATCH') {
      const doc = await docMeet(id);
      const { privado, ...publicos } = limpiarCampos(cuerpo);
      const ops = [{ op: 'update', ruta: b(id), datos: { ...publicos, actualizado: ahora() } }];
      if (privado) ops.push({ op: 'set', ruta: `${b(id)}/privado/datos`, datos: privado, merge: true });
      if (publicos.cerrado !== undefined && publicos.cerrado !== !!doc.cerrado) ops.push(entradaActividad(id, publicos.cerrado ? 'Meet terminado' : 'Meet reabierto'));
      await db.lote(ops);
      const nuevo = { ...doc, ...publicos };
      const { n, enVivo, dueno: _d, ...pub } = nuevo;
      return { ...pub, estado: estadoMeet({ ...nuevo, vivo: enVivo ? { x: { actual: true } } : {} }) };
    }
    if (metodo === 'DELETE') { await borrarSub(id); await db.del(b(id)); duenos.delete(id); return { ok: true }; }
    mal(405, 'Método no permitido');
  }

  /* ---------- atletas ---------- */
  async function atletas(metodo, id, aid, cuerpo, esLote) {
    await dueno(id);
    if (esLote) {
      if (metodo !== 'POST') mal(405, 'Método no permitido');
      if (!Array.isArray(cuerpo?.atletas)) mal(400, 'Falta la lista «atletas»');
      const lista = cuerpo.atletas.slice(0, MAX_ATLETAS).map(a => limpiarAtleta({ ...a, id: idSeguro(a?.id) ? a.id : `at-${hexAleatorio(4)}` }));
      if (new Set(lista.map(a => a.id)).size !== lista.length) mal(400, 'Hay atletas con el mismo identificador');
      const hay = new Set((await db.list(`${b(id)}/atletas`)).map(f => f.id));
      const total = hay.size + lista.filter(a => !hay.has(a.id)).length;
      if (total > MAX_ATLETAS) mal(400, `Un meet admite hasta ${MAX_ATLETAS} atletas`);
      await db.lote([...lista.map(a => ({ op: 'set', ruta: `${b(id)}/atletas/${a.id}`, datos: a })), { op: 'update', ruta: b(id), datos: { n: total, actualizado: ahora() } }, entradaActividad(id, `${lista.length} atletas importados`)]);
      for (const a of lista) atletasEscritos.set(`${id}/${a.id}`, a);
      return { ok: true, atletas: lista.length };
    }
    if (!idSeguro(aid)) mal(400, 'Identificador de atleta no válido');
    const clave = `${id}/${aid}`;
    const previo = async () => atletasEscritos.get(clave) ?? (await leerOnull(`${b(id)}/atletas/${aid}`));
    if (metodo === 'PUT') {
      const a = limpiarAtleta(cuerpo, aid);
      const antes = await previo();
      const ops = [{ op: 'set', ruta: `${b(id)}/atletas/${aid}`, datos: a }];
      if (!antes) {
        if ((await docMeet(id)).n >= MAX_ATLETAS) mal(400, `Un meet admite hasta ${MAX_ATLETAS} atletas`);
        ops.push({ op: 'update', ruta: b(id), datos: { n: db.inc(1) } }, entradaActividad(id, `${a.nombre || 'Atleta'} se unió al meet`));
      } else for (const t of cambiosDeResultados(antes, a)) ops.push(entradaActividad(id, t));
      await db.lote(ops);
      atletasEscritos.set(clave, a);
      return a;
    }
    if (metodo === 'DELETE') {
      const antes = await previo();
      if (!antes) mal(404, SIN_ATLETA);
      await db.lote([{ op: 'del', ruta: `${b(id)}/atletas/${aid}` }, { op: 'del', ruta: `${b(id)}/aplausos/${aid}` }, { op: 'update', ruta: b(id), datos: { n: db.inc(-1) } }, entradaActividad(id, `${antes.nombre || 'Atleta'} salió del meet`)]);
      atletasEscritos.delete(clave);
      return { ok: true };
    }
    mal(405, 'Método no permitido');
  }

  async function aplauso(id, cuerpo) {
    const aid = cuerpo?.aid;
    if (!idSeguro(aid)) mal(404, SIN_ATLETA);
    // shortcut: sin servidor no hay límite por IP; solo 1 cada 10 s por dispositivo. Si se abusa, activar App Check.
    const k = `openmeets.aplauso.${id}.${aid}`;
    if (ahora() - (Number(almacen.getItem(k)) || 0) < 10000) mal(429, 'Ya aplaudiste hace un momento. Espera unos segundos.');
    try { await db.set(`${b(id)}/aplausos/${aid}`, { n: db.inc(1) }, { merge: true }); } catch (e) { if (e?.code === 'permission-denied') mal(404, SIN_ATLETA); throw e; }
    almacen.setItem(k, ahora());
    return { ok: true };
  }

  /* ---------- inscripciones ---------- */
  const infoPublica = (doc, cupos) => {
    const c = doc.inscripciones || null, k = cupos || { ocupados: 0, espera: 0, porClase: {} };
    return { config: c, ...estadoApertura(c), cupos: { total: c?.cupoTotal ?? null, ocupados: k.ocupados || 0, espera: k.espera || 0, porClase: k.porClase || {} } };
  };
  const guardarCupos = (id, items) => { const { ocupados, espera, porClase } = contarCupos(items); return { op: 'set', ruta: `${b(id)}/publico/cupos`, datos: { ocupados, espera, porClase } }; };

  async function inscripciones(metodo, id, sub, cuerpo) {
    if (sub === 'estado') { const doc = await docMeet(id); return { ok: true, ...infoPublica(doc, await leerOnull(`${b(id)}/publico/cupos`)) }; }
    if (!sub && metodo === 'POST') return inscribir(id, cuerpo);
    await dueno(id);
    const doc = await docMeet(id);
    const items = async () => (await db.list(`${b(id)}/inscripciones`)).map(f => f.d).sort((x, y) => (x.creado || 0) - (y.creado || 0));
    if (sub === 'config') {
      if (metodo !== 'PUT') mal(405, 'Método no permitido');
      const cfg = limpiarConfig(cuerpo);
      await db.update(b(id), { inscripciones: cfg, actualizado: ahora() });
      return { ok: true, config: cfg };
    }
    if (!sub) {
      if (metodo !== 'GET') mal(405, 'Método no permitido');
      const lista = await items(), guardados = await leerOnull(`${b(id)}/publico/cupos`), op = guardarCupos(id, lista);
      if (JSON.stringify(op.datos) !== JSON.stringify(guardados)) db.set(op.ruta, op.datos).catch(() => {}); // el contador público se corrige solo
      return { ok: true, items: lista, ...infoPublica(doc, op.datos) };
    }
    if (metodo !== 'PATCH') mal(405, 'Método no permitido');
    if (cuerpo === null || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) mal(400, 'Cuerpo no válido');
    if (cuerpo.estado !== undefined && !ESTADOS.includes(cuerpo.estado)) mal(400, 'Estado no válido');
    const lista = await items();
    const item = lista.find(x => x.id === sub);
    if (!item) mal(404, 'No encuentro esa inscripción');
    const ops = [], antes = item.estado;
    if (cuerpo.estado !== undefined && cuerpo.estado !== antes) {
      if (cuerpo.estado === 'confirmado') {
        if (!item.aid) {
          const hay = await db.list(`${b(id)}/atletas`);
          if (hay.length >= MAX_ATLETAS) mal(400, `Un meet admite hasta ${MAX_ATLETAS} atletas`);
          const a = atletaDeInscripcion(item, doc, Math.max(0, ...hay.map(f => Number(f.d.lote) || 0)) + 1);
          ops.push({ op: 'set', ruta: `${b(id)}/atletas/${a.id}`, datos: a }, { op: 'update', ruta: b(id), datos: { n: hay.length + 1 } });
          item.aid = a.id;
        }
      } else if (antes === 'confirmado' && item.aid) {
        ops.push({ op: 'del', ruta: `${b(id)}/atletas/${item.aid}` }, { op: 'del', ruta: `${b(id)}/aplausos/${item.aid}` }, { op: 'update', ruta: b(id), datos: { n: db.inc(-1) } });
        atletasEscritos.delete(`${id}/${item.aid}`);
        item.aid = null;
      }
      item.estado = cuerpo.estado;
    }
    if (cuerpo.pagado !== undefined) item.pagado = !!cuerpo.pagado;
    if (cuerpo.nota !== undefined) item.nota = String(cuerpo.nota).trim().slice(0, 300);
    item.ts = ahora();
    ops.push({ op: 'set', ruta: `${b(id)}/inscripciones/${item.id}`, datos: item }, guardarCupos(id, lista));
    await db.lote(ops);
    return { ok: true, item, ...infoPublica(doc, ops[ops.length - 1].datos) };
  }

  async function inscribir(id, cuerpo) {
    const doc = await docMeet(id);
    const campos = validarInscripcion(doc, cuerpo);
    // shortcut: sin servidor no hay límite por IP; 5 inscripciones por hora y dispositivo. Si se abusa, activar App Check.
    const hora = (JSON.parse(almacen.getItem('openmeets.inscripciones') || '[]')).filter(t => ahora() - t < 3600000);
    if (hora.length >= 5) mal(429, 'Ya enviaste varias inscripciones desde esta conexión. Espera una hora o pídele al organizador que te inscriba.');
    const cupos = (await leerOnull(`${b(id)}/publico/cupos`)) || { ocupados: 0, espera: 0, porClase: {} };
    if ((cupos.ocupados || 0) + (cupos.espera || 0) >= MAX_INSCRITOS) mal(409, 'Este meet ya no recibe más inscripciones.');
    const estado = cabe(doc.inscripciones, { ocupados: cupos.ocupados || 0, porClase: cupos.porClase || {} }, campos.sexo, campos.clase) ? 'pendiente' : 'espera';
    const item = itemNuevo(campos, estado, codigoInscripcion());
    item.id = `in-${await hashHex(claveDuplicado(campos.nombre, campos.nacimiento))}`; // el mismo nombre y nacimiento dan el mismo documento: el duplicado lo rechazan las reglas
    const k = `${campos.sexo}|${campos.clase}`;
    const sumar = estado === 'pendiente' ? { ocupados: db.inc(1), porClase: { [k]: db.inc(1) } } : { espera: db.inc(1) };
    try { await db.lote([{ op: 'set', ruta: `${b(id)}/inscripciones/${item.id}`, datos: item }, { op: 'set', ruta: `${b(id)}/publico/cupos`, datos: sumar, merge: true }]); } catch (e) {
      if (e?.code === 'permission-denied') mal(409, MENSAJE_DUPLICADO);
      throw e;
    }
    almacen.setItem('openmeets.inscripciones', JSON.stringify([...hora, ahora()]));
    return { ok: true, codigo: item.codigo, estado, clase: campos.clase, division: campos.division, precio: doc.inscripciones.precio || 0, moneda: doc.inscripciones.moneda || '', pagoUrl: doc.inscripciones.pagoUrl || '' };
  }

  /* ---------- despacho ---------- */
  async function despachar(metodo, partes, q, cuerpo) {
    const [a, id, sub, aid] = [partes[0], partes[1], partes[2], partes[3]];
    if (a === 'info' && metodo === 'GET' && partes.length === 1) {
      const usuario = await db.usuario();
      return { app: 'OpenMeets', version: VERSION, puerto: 0, ips: [], organizador: !!usuario, modo: 'cuentas', cuentas: true, usuario, firebase: db.config };
    }
    if (a === 'sesion' && partes.length === 1) {
      if (metodo === 'DELETE') { await db.salir(); return { ok: true }; }
      if (metodo !== 'POST') mal(405, 'Método no permitido');
      await db.enlazarAuth?.(); // cuenta.js ya inició sesión con Google en esta página
      const usuario = await db.usuario();
      if (!usuario) mal(401, 'No se pudo entrar. Vuelve a intentarlo.');
      db.recordarSesion?.(true);
      return { ok: true, organizador: true, usuario };
    }
    if (a === 'inscripciones' && id === 'abiertas' && partes.length === 2 && metodo === 'GET') {
      const filas = await db.list('meets', { donde: [['publico', '==', true], ['inscripciones.abiertas', '==', true]], limite: 100 });
      return filas.filter(f => estadoApertura(f.d.inscripciones).abierta).map(f => f.id);
    }
    if (a !== 'meets') mal(404, MSG_NO);
    if (partes.length === 1) {
      if (metodo === 'GET') return lista(q);
      if (metodo === 'POST') return crear(cuerpo);
      mal(405, 'Método no permitido');
    }
    if (id === 'importar' && partes.length === 2) { if (metodo !== 'POST') mal(405, 'Método no permitido'); return importar(cuerpo, q.get('reemplazar') === '1'); }
    if (!idSeguro(id)) mal(404, SIN_MEET);
    if (!sub) { if (!['GET', 'PATCH', 'DELETE'].includes(metodo)) mal(405, 'Método no permitido'); return meet(metodo, id, cuerpo); }
    if (sub === 'atletas') return atletas(metodo, id, aid, cuerpo, partes.length === 3);
    if (sub === 'aplauso' && metodo === 'POST') return aplauso(id, cuerpo);
    if (sub === 'resultados.csv' && metodo === 'GET') return resultadosCSV((await cargarMeet(id)).m);
    if (sub === 'export.json' && metodo === 'GET') { await dueno(id); const { m } = await cargarMeet(id); const { mio, ...copia } = m; return copia; }
    if (sub === 'inscripciones.csv' && metodo === 'GET') { await dueno(id); return csvInscripciones((await db.list(`${b(id)}/inscripciones`)).map(f => f.d).sort((x, y) => (x.creado || 0) - (y.creado || 0)), celda); }
    if (sub === 'inscripciones' && partes.length <= 4) return inscripciones(metodo, id, aid, cuerpo);
    mal(404, MSG_NO);
  }

  return async function pedir(metodo, ruta, cuerpo) {
    const u = new URL(ruta, 'http://x');
    const partes = u.pathname.replace(/\/+$/, '').split('/').slice(2).map(s => { try { return decodeURIComponent(s); } catch { return ''; } });
    try { return await despachar(metodo, partes, u.searchParams, cuerpo); } catch (e) { throw traducir(e, metodo === 'GET'); }
  };
}

/* ---------- Instancia de la página ---------- */
let instancia = null;
export async function pedir(metodo, ruta, cuerpo) {
  if (!instancia) {
    const { detectarNube } = await import('./modo.js');
    const { obtenerBd } = await import('./bd.js');
    instancia = crearRutas({ db: await obtenerBd(await detectarNube()) });
  }
  return instancia(metodo, ruta, cuerpo);
}
