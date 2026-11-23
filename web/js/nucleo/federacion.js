/* ============================================================
   OPENMEETS — Modo federación: datos puros del panel central y de la hoja del locutor
   Sin DOM. Los textos van como plantilla en español + datos; la vista los pasa por t().
   ============================================================ */

import * as C from './competencia.js';
import * as L from './luces-estado.js';
import * as R from './reloj.js';

export const PARADA_MS = 3 * 60 * 1000;
const POS_NOMBRE = { izq: 'izquierdo', cen: 'principal', der: 'derecho' };
const MEDALLA = { 1: 'oro', 2: 'plata', 3: 'bronce' };
const ORDINAL = ['primero', 'segundo', 'tercero', 'cuarto'];

const alerta = (tipo, clave, datos = {}) => ({ tipo, clave, datos, texto: clave.replace(/\{(\w+)\}/g, (_, k) => datos[k] ?? '') });

/** Intentos hechos y pendientes de un grupo de atletas (un intento cuenta si tiene resultado o un peso declarado). */
export function progresoDe(atletas) {
  let hechos = 0, pendientes = 0;
  for (const a of atletas) for (const l of a.levantes || C.ORDEN_LEV) for (let n = 0; n < 3; n++) {
    const i = a.intentos?.[l]?.[n];
    if (!i) continue;
    if (i.r === 1 || i.r === -1) hechos++; else if (Number(i.kg) > 0) pendientes++;
  }
  const total = hechos + pendientes;
  return { hechos, pendientes, total, pct: total ? Math.round((hechos / total) * 100) : 0 };
}

/** Lo último que se juzgó en la plataforma: del vivo (con su hora) o, si ya pasó, de la actividad del meet. */
function ultimoDe(meet, vivo, atletasP) {
  const r = vivo?.luces?.resultado;
  if (vivo?.juzgado && (r === 1 || r === -1)) return { nombre: vivo.juzgado.nombre, kg: vivo.juzgado.kg, n: vivo.juzgado.n, resultado: r, ts: vivo.lucesTs || 0 };
  const nombres = new Set(atletasP.map(a => `${a.nombre}:`));
  for (const x of [...(meet.actividad || [])].reverse()) {
    const m = /^(.+?): .* · ([\d.,]+) kg · (válido|nulo)$/.exec(x.texto || '');
    if (m && nombres.has(`${m[1]}:`)) return { nombre: m[1], kg: Number(m[2].replace(',', '.')), n: null, resultado: m[3] === 'válido' ? 1 : -1, ts: x.ts || 0 };
  }
  return null;
}

/**
 * Estado de una plataforma para el panel central.
 * estado: 'sin-datos' · 'espera' · 'activa' · 'parada' (más de 3 min sin movimiento con intentos pendientes) · 'terminada'.
 */
export function estadoPlataforma(meet, plataforma, vivo, ahora = Date.now()) {
  const atletasP = (meet.atletas || []).filter(a => a.plataforma === plataforma);
  const grupoAtletas = vivo && (vivo.grupo || vivo.sesion) ? C.delGrupo(atletasP, { sesion: vivo.sesion, grupo: vivo.grupo }) : atletasP;
  const progreso = { ...progresoDe(grupoAtletas), grupo: vivo?.grupo ? `${vivo.sesion || ''}${vivo.grupo}` : '' };
  const rl = vivo ? L.relojDe(vivo, vivo.relojHasta) : null;
  const reloj = rl ? { estado: rl.estado, restante: R.restante(rl, ahora) } : null;
  const corre = reloj?.estado === 'corre';
  const alertas = [];
  const base = { plataforma, actual: vivo?.actual || null, lev: vivo?.lev || '', reloj, progreso, ultimo: ultimoDe(meet, vivo, atletasP), jueces: [], alertas, ts: vivo?.ts || 0 };
  if (!vivo) return { ...base, estado: meet.cerrado ? 'terminada' : 'sin-datos' };
  base.jueces = ['izq', 'cen', 'der'].map(pos => ({ pos, nombre: POS_NOMBRE[pos], conectado: !!vivo.jueces?.[pos]?.conectado, via: vivo.jueces?.[pos]?.via || null, bateria: vivo.jueces?.[pos]?.bateria ?? null }));
  if (meet.cerrado) return { ...base, estado: 'terminada' };
  const parada = progreso.pendientes > 0 && !corre && vivo.ts > 0 && ahora - vivo.ts > PARADA_MS;
  if (parada) alertas.push(alerta('parada', 'Sin movimiento desde hace {min} min', { min: Math.floor((ahora - vivo.ts) / 60000) }));
  if (vivo.actual) for (const j of base.jueces) if (!j.conectado) alertas.push(alerta('juez', 'Juez {pos} sin conexión', { pos: j.nombre }));
  const estado = parada ? 'parada' : vivo.actual ? 'activa' : progreso.total > 0 && progreso.pendientes === 0 ? 'terminada' : 'espera';
  return { ...base, estado };
}

/** Alertas que no son de una plataforma: la conexión con el servidor y la nube. */
export function alertasGlobales({ conexion = 'conectado', nube = null } = {}) {
  const out = [];
  if (conexion === 'sin-red') out.push(alerta('red', 'Sin conexión con el servidor de la mesa'));
  if (nube?.configurado && nube.estado === 'sin-conexion') out.push(alerta('nube', 'La nube no responde: los cambios esperan en la cola'));
  return out;
}

/* ---------------- Locutor ---------------- */

const sumaMejores = (a, salvo) => (a.levantes || C.ORDEN_LEV).filter(l => l !== salvo).reduce((s, l) => s + C.mejor(a, l), 0);
const totalActual = a => sumaMejores(a);
/** Primer múltiplo de 2,5 que alcanza (o, con `estricto`, supera) x. */
export const multiplo = (x, estricto) => { const k = x / 2.5, e = Math.round(k * 1e6) / 1e6; return (Number.isInteger(e) ? (estricto ? e + 1 : e) : Math.ceil(e)) * 2.5; };

/**
 * Lo que necesita el speaker para anunciar el intento en tarima.
 * `marcas`: { [aid]: marcaPersonal | null } (del servidor). Devuelve { hayAtleta:false, siguientes } si no hay nadie.
 */
export function datosLocutor(meet, vivo, marcas = {}) {
  const atletas = meet.atletas || [];
  const siguientes = (vivo?.siguientes || []).slice(0, 3).map(s => {
    const a = atletas.find(x => x.nombre === s.nombre);
    return { nombre: s.nombre, club: a?.club || '', kg: Number(s.kg) || 0, n: s.n != null ? Number(s.n) + 1 : 0 };
  });
  const act = vivo?.actual;
  if (!act) return { hayAtleta: false, siguientes };
  const a = atletas.find(x => x.id === act.aid);
  const lev = vivo.lev || '';
  const kg = Number(act.kg) || 0;
  const grupo = a ? C.clasificacion(atletas).find(g => g.filas.some(f => f.a.id === a.id)) : null;
  const otros = grupo ? grupo.filas.map(f => f.a).filter(x => x.id !== a.id) : [];
  const mio = a ? totalActual(a) : 0, miPeso = a ? C.pesoDe(a) || 999 : 999;
  const delante = o => totalActual(o) > mio || (totalActual(o) === mio && (C.pesoDe(o) || 999) < miPeso);
  const puesto = a ? 1 + otros.filter(delante).length : null;
  const ordenados = [...otros].sort((x, y) => totalActual(y) - totalActual(x) || (C.pesoDe(x) || 999) - (C.pesoDe(y) || 999));

  let necesita = null;
  if (a && puesto > 1) {
    const objetivo = puesto > 3 ? 3 : puesto - 1;
    const rival = ordenados[objetivo - 1];
    if (rival) {
      const lig = (C.pesoDe(a) || 999) < (C.pesoDe(rival) || 999); // a igual total gana el más ligero
      const need = multiplo(totalActual(rival) - sumaMejores(a, lev), !lig);
      necesita = { puesto: objetivo, medalla: MEDALLA[objetivo], kg: need, alcanza: kg >= need };
    }
  }
  const proyectado = a ? 1 + otros.filter(o => totalActual(o) > sumaMejores(a, lev) + Math.max(C.mejor(a, lev), kg)).length : null;
  const m = marcas[act.aid] || null;
  const rec = C.recValido(act.rec);
  const record = rec ? { nivel: typeof rec === 'string' ? rec : '', etiqueta: C.etiquetaRecord(act.rec, act.recTexto) } : null;
  const marca = m && m[lev] > 0 ? { kg: m[lev], total: m.total, superaMarca: C.superaMarca(m, lev, kg) } : null;
  const n = act.n != null ? Number(act.n) : 0;
  const d = {
    hayAtleta: true, nombre: act.nombre || a?.nombre || '', club: act.club || a?.club || '', categoria: grupo?.nombre || '',
    lev, levNombre: C.LEVANTES[lev] || '', intento: n + 1, ordinal: ORDINAL[n] || '', kg, rack: act.rack || (lev ? a?.rack?.[lev] : '') || '',
    record, marca, puesto, de: grupo?.filas.length || 0, proyectado, necesita, siguientes, plataforma: vivo.plataforma || '',
  };
  d.frases = frasesLocutor(d);
  return d;
}

/** Frases sugeridas como { clave (plantilla en español), datos }. */
export function frasesLocutor(d) {
  const f = [];
  const kg = String(d.kg).replace('.', ',');
  const cab = { plataforma: d.plataforma, nombre: d.nombre, club: d.club, categoria: d.categoria, ordinal: d.ordinal, lev: (d.levNombre || '').toLowerCase(), kg };
  f.push({ clave: d.club ? 'En la plataforma {plataforma}: {nombre}, de {club}, categoría {categoria}. Su {ordinal} intento de {lev}, con {kg} kilos.' : 'En la plataforma {plataforma}: {nombre}, categoría {categoria}. Su {ordinal} intento de {lev}, con {kg} kilos.', datos: cab });
  if (d.record) f.push({ clave: d.record.nivel ? 'Atención: este intento es por un récord {nivel}.' : 'Atención: este intento es por un récord.', datos: { nivel: d.record.nivel } });
  if (d.marca?.superaMarca) f.push({ clave: 'Va por su marca personal: la anterior es de {kg} kilos.', datos: { kg: String(d.marca.kg).replace('.', ',') } });
  if (d.puesto) f.push({ clave: d.puesto === 1 ? 'Es el líder de su categoría.' : 'Va en el puesto {puesto} de {de} de su categoría.', datos: { puesto: d.puesto, de: d.de } });
  if (d.necesita) f.push({ clave: d.necesita.alcanza ? 'Con {kg} kilos pelea el {medalla}.' : 'Necesita {necesita} kilos en el {ordinal} para el {medalla}.', datos: { kg, necesita: String(d.necesita.kg).replace('.', ','), ordinal: d.ordinal, medalla: d.necesita.medalla } });
  return f;
}
