/* ============================================================
   OPENMEETS — Tabla de récords (pura: corre igual en el servidor y en la web)
   Un récord vigente por federación · nivel · sexo · división · equipamiento · clase · levantamiento,
   con el historial de quién lo tuvo antes. Detecta intentos que superan un récord, registra los
   récords nuevos que salen de la mesa y lee/escribe el CSV de la tabla.
   ============================================================ */

import { mejor, normalizarNombre, ORDEN_LEV, NIVELES_REC, MAX_REC_TEXTO, claseDe, pesoDe } from './competencia.js';

export const LEVS_REC = ['S', 'B', 'D', 'total'];
export const NOMBRE_LEV_REC = { S: 'Sentadilla', B: 'Press banca', D: 'Peso muerto', total: 'Total' };
export const NOMBRE_NIVEL = { mundial: 'Mundial', nacional: 'Nacional', ibero: 'Iberoamericano', regional: 'Regional', otro: 'Otro' };
export const MAX_RECORDS = 5000;
const MAX_HISTORIAL = 50;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const ID = { test: x => typeof x === 'string' && /^[a-z0-9][a-z0-9-]{0,59}$/.test(x) };

const n = x => normalizarNombre(x);
const txt = (x, max) => (typeof x === 'string' || typeof x === 'number' ? String(x).trim().slice(0, max) : '');

/** Clave del récord vigente: dos récords con la misma clave son el mismo (el otro pasa al historial). */
export const claveRecord = r => [n(r.federacion), r.nivel, r.nivel === 'otro' ? n(r.nivelTexto) : '', r.sexo, n(r.division), r.equipamiento, n(r.clase), r.lev].join('|');

/* ---------- Validación ---------- */

const SEXO = v => (/^(f|m[uú]jer|mujeres|fem)/i.test(String(v).trim()) ? 'F' : /^(m|h|hombre|masc)/i.test(String(v).trim()) ? 'M' : null);
const EQUIPO = v => (/^(equip|equipped|multi)/i.test(String(v).trim()) ? 'equipado' : /^(raw|cl[aá]sic|classic|sin ?equip|unequipped)/i.test(String(v).trim()) ? 'raw' : null);
const LEV = v => {
  const s = n(v);
  if (s === 's' || s.startsWith('sentad') || s.startsWith('squat')) return 'S';
  if (s === 'b' || s.startsWith('banca') || s.startsWith('press') || s.startsWith('bench')) return 'B';
  if (s === 'd' || s.startsWith('peso muerto') || s.startsWith('deadlift')) return 'D';
  if (s === 'total' || s === 't') return 'total';
  return null;
};
const NIVEL = v => { const s = n(v); return NIVELES_REC.find(x => x === s) || (s.startsWith('iberoam') ? 'ibero' : null); };

/** Valida y limpia un récord (de la API o de una fila de CSV). → { ok: true, record } | { ok: false, error } */
export function normalizarRecord(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ok: false, error: 'Récord no válido' };
  const federacion = txt(o.federacion, 60);
  if (!federacion) return { ok: false, error: 'Falta la federación' };
  const nivel = NIVEL(o.nivel);
  if (!nivel) return { ok: false, error: 'El nivel debe ser mundial, nacional, ibero, regional u otro' };
  const nivelTexto = nivel === 'otro' ? txt(o.nivelTexto, MAX_REC_TEXTO) : '';
  if (nivel === 'otro' && !nivelTexto) return { ok: false, error: 'Escribe el nombre del nivel (por ejemplo, «Panamericano»)' };
  const sexo = SEXO(o.sexo);
  if (!sexo) return { ok: false, error: 'El sexo debe ser M o F' };
  const equipamiento = EQUIPO(o.equipamiento ?? 'raw');
  if (!equipamiento) return { ok: false, error: 'El equipamiento debe ser raw o equipado' };
  const lev = LEV(o.lev ?? o.levantamiento);
  if (!lev) return { ok: false, error: 'El levantamiento debe ser S, B, D o total' };
  const kgN = typeof o.kg === 'string' ? Number(o.kg.replace(',', '.')) : o.kg;
  if (typeof kgN !== 'number' || !Number.isFinite(kgN) || kgN <= 0 || kgN > 2000) return { ok: false, error: 'El peso debe ser un número entre 0 y 2000 kg' };
  const atleta = txt(o.atleta, 80);
  if (!atleta) return { ok: false, error: 'Falta el nombre del atleta' };
  const fecha = o.fecha ? String(o.fecha).trim() : '';
  if (fecha && !FECHA.test(fecha)) return { ok: false, error: 'La fecha debe ser AAAA-MM-DD' };
  const hom = o.homologado;
  const r = {
    id: ID.test(o.id) ? o.id : '', federacion, nivel, nivelTexto, sexo, division: txt(o.division, 40) || 'Open', equipamiento,
    clase: txt(o.clase, 12), lev, kg: Math.round(kgN * 100) / 100, atleta, fecha, meet: txt(o.meet, 120), lugar: txt(o.lugar, 120), fuente: txt(o.fuente, 200),
    homologado: hom === undefined || hom === '' || hom === null ? true : hom === true || /^(si|sí|s|true|1|yes|y)$/i.test(String(hom).trim()),
  };
  if (ID.test(o.meetId)) r.meetId = o.meetId;
  if (ID.test(o.aid)) r.aid = o.aid;
  r.historial = (Array.isArray(o.historial) ? o.historial : []).slice(0, MAX_HISTORIAL).map(instantanea).filter(h => h.kg > 0);
  return { ok: true, record: r };
}

export const instantanea = r => ({
  kg: Number(r?.kg) || 0, atleta: txt(r?.atleta, 80), fecha: FECHA.test(r?.fecha) ? r.fecha : '', meet: txt(r?.meet, 120), lugar: txt(r?.lugar, 120),
  fuente: txt(r?.fuente, 200), homologado: r?.homologado !== false,
  ...(ID.test(r?.meetId) ? { meetId: r.meetId } : {}), ...(ID.test(r?.aid) ? { aid: r.aid } : {}),
});

/* ---------- Tabla ---------- */

const ORDEN_NIVEL = ['mundial', 'ibero', 'nacional', 'regional', 'otro'];
const numClase = c => { const m = /^([+-]?)(\d+(?:\.\d+)?)/.exec(c || ''); return m ? (m[1] === '+' ? 1e4 : 0) + Number(m[2]) : 1e5; };

/** Orden de lectura: federación, nivel (de mayor a menor), sexo, división, equipamiento, clase y levantamiento. */
export function ordenarRecords(lista) {
  return [...lista].sort((a, b) => a.federacion.localeCompare(b.federacion, 'es')
    || ORDEN_NIVEL.indexOf(a.nivel) - ORDEN_NIVEL.indexOf(b.nivel) || (a.nivelTexto || '').localeCompare(b.nivelTexto || '', 'es')
    || (a.sexo === b.sexo ? 0 : a.sexo === 'F' ? -1 : 1) || a.division.localeCompare(b.division, 'es') || a.equipamiento.localeCompare(b.equipamiento)
    || numClase(a.clase) - numClase(b.clase) || LEVS_REC.indexOf(a.lev) - LEVS_REC.indexOf(b.lev));
}

/** Filtros: federacion, nivel, sexo, division, equipamiento, clase, lev (igualdad sin tildes), q (texto libre), meetId, pendientes ('1'). */
export function filtrarRecords(tabla, f = {}) {
  const eq = (v, w) => !v || n(v) === n(w);
  const q = n(f.q);
  return ordenarRecords(tabla.filter(r => eq(f.federacion, r.federacion) && (!f.nivel || f.nivel === r.nivel) && (!f.sexo || f.sexo === r.sexo)
    && eq(f.division, r.division) && (!f.equipamiento || f.equipamiento === r.equipamiento) && eq(f.clase, r.clase) && (!f.lev || f.lev === r.lev)
    && (!f.meetId || f.meetId === r.meetId) && (!f.pendientes || f.pendientes === '0' || !r.homologado)
    && (!q || n([r.atleta, r.meet, r.lugar, r.fuente, r.federacion, r.nivelTexto, ...(r.historial || []).map(h => h.atleta)].join(' ')).includes(q))));
}

/**
 * Pone un récord en la tabla (muta `tabla`). Si ya hay uno con la misma clave, el anterior pasa al historial,
 * salvo `mismo` (el mismo atleta mejorando su propio récord del mismo meet: se actualiza sin ensuciar el historial).
 * @returns {{ record, cambio: 'nuevo'|'reemplazo'|'actualizado'|'igual' }}
 */
export function registrarRecord(tabla, datos, { id, mismo = false } = {}) {
  const k = claveRecord(datos);
  const r = tabla.find(x => claveRecord(x) === k);
  if (!r) {
    const nuevo = { ...datos, id: datos.id || id || `rc-${Math.random().toString(36).slice(2, 10)}`, historial: datos.historial || [] };
    tabla.push(nuevo);
    return { record: nuevo, cambio: 'nuevo' };
  }
  if (r.kg === datos.kg && n(r.atleta) === n(datos.atleta) && r.fecha === datos.fecha) return { record: r, cambio: 'igual' };
  if (!mismo) r.historial = [instantanea(r), ...(r.historial || [])].slice(0, MAX_HISTORIAL);
  const { id: _i, historial: _h, ...campos } = datos;
  for (const c of ['meetId', 'aid']) delete r[c];
  Object.assign(r, campos);
  return { record: r, cambio: mismo ? 'actualizado' : 'reemplazo' };
}

/* ---------- ¿Este intento supera un récord? ---------- */

const claseDelAtleta = (a, meet) => a.clase || claseDe(a.sexo, pesoDe(a), a.division, meet?.federacion) || '';

/** El récord aplica a este atleta (sexo, división, equipamiento y clase; una clase o división vacía en la tabla vale para todas). */
function aplica(r, a, meet) {
  return n(r.federacion) === n(meet?.federacion) && r.sexo === (a.sexo === 'F' ? 'F' : 'M') && (!r.division || n(r.division) === n(a.division || 'Open'))
    && r.equipamiento === (a.equipamiento === 'equipado' ? 'equipado' : 'raw') && (!r.clase || n(r.clase) === n(claseDelAtleta(a, meet)));
}

/**
 * Récords de la tabla que superaría `kg` en `lev` ('S'|'B'|'D'|'total') para este atleta en este meet.
 * Un empate no cuenta. Si `lev` es un levantamiento y con ese peso el atleta tendría ya un total válido, también mira los récords de total.
 * La barra (20 o 25 kg en sentadilla) no interviene: los pesos son los de la barra cargada.
 * @returns {{ nivel, recTexto, actual, lev, kg, id, registro }[]}
 */
export function recordsQueSupera(atleta, lev, kg, tabla, meet) {
  const out = [], kgN = Number(kg);
  if (!atleta || !(kgN > 0) || !Array.isArray(tabla) || !n(meet?.federacion) || !LEVS_REC.includes(lev)) return out;
  const probar = (l, valor) => { for (const r of tabla) if (r.lev === l && aplica(r, atleta, meet) && valor > r.kg) out.push({ nivel: r.nivel, recTexto: r.nivel === 'otro' ? r.nivelTexto : '', actual: r.kg, lev: l, kg: valor, id: r.id, registro: r }); };
  probar(lev, kgN);
  if (lev !== 'total') {
    const levs = atleta.levantes || ORDEN_LEV;
    const marcas = levs.map(l => Math.max(mejor(atleta, l), l === lev ? kgN : 0));
    if (levs.includes(lev) && marcas.every(x => x > 0)) probar('total', marcas.reduce((s, x) => s + x, 0));
  }
  return out;
}

/**
 * Récords nuevos que dejó la última escritura de un atleta: cada intento que pasó a válido y supera la tabla.
 * Muta `tabla` (registrarRecord) y devuelve lo registrado: [{ record, cambio, previo }]. Quedan por homologar.
 */
export function registrarAutomaticos(tabla, meet, antes, despues) {
  const hechos = [];
  for (const lev of ORDEN_LEV) for (let i = 0; i < 3; i++) {
    const ni = despues?.intentos?.[lev]?.[i];
    if (ni?.r !== 1 || !(Number(ni.kg) > 0) || antes?.intentos?.[lev]?.[i]?.r === 1) continue;
    for (const c of recordsQueSupera(despues, lev, ni.kg, tabla, meet)) {
      const base = c.registro, previo = { kg: base.kg, atleta: base.atleta };
      const mismo = base.meetId === meet.id && base.aid === despues.id;
      const datos = {
        ...base, kg: c.kg, atleta: despues.nombre, fecha: meet.fecha || '', meet: meet.nombre || '', lugar: [meet.sede, meet.ciudad].filter(Boolean).join(', '),
        fuente: 'OpenMeets · mesa', homologado: false, meetId: meet.id, aid: despues.id, historial: undefined,
      };
      hechos.push({ ...registrarRecord(tabla, datos, { mismo }), previo });
    }
  }
  return hechos;
}

/* ---------- CSV ---------- */

export const COLUMNAS_CSV = ['federacion', 'nivel', 'nivel_texto', 'sexo', 'division', 'equipamiento', 'clase', 'levantamiento', 'kg', 'atleta', 'fecha', 'meet', 'lugar', 'fuente', 'homologado'];
const celda = v => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function recordsACSV(lista) {
  const filas = ordenarRecords(lista).map(r => [r.federacion, r.nivel, r.nivelTexto, r.sexo, r.division, r.equipamiento, r.clase, r.lev, r.kg, r.atleta, r.fecha, r.meet, r.lugar, r.fuente, r.homologado ? 'si' : 'no']);
  return '﻿' + [COLUMNAS_CSV, ...filas].map(f => f.map(celda).join(',')).join('\r\n') + '\r\n';
}

export const plantillaRecordsCSV = () => recordsACSV([]) + '"IPF",mundial,,F,Open,raw,-63,S,235.5,"Nombre Apellido",2025-06-14,"Campeonato Mundial","Lugar, País","https://fuente.example/ipf",si\r\n';

function filasCSV(texto) {
  const t = String(texto ?? '').replace(/^﻿/, '');
  const prim = t.split('\n')[0];
  const sep = (prim.match(/;/g) || []).length > (prim.match(/,/g) || []).length ? ';' : ',';
  const filas = []; let f = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { f.push(c); c = ''; }
    else if (ch === '\n') { f.push(c); filas.push(f); f = []; c = ''; }
    else if (ch !== '\r') c += ch;
  }
  if (c || f.length) { f.push(c); filas.push(f); }
  return filas;
}

/** CSV → { records, errores: [{ linea, error }] }. Columnas en COLUMNAS_CSV (sin tildes ni mayúsculas importa poco; el orden da igual). */
export function recordsDeCSV(texto) {
  const filas = filasCSV(texto);
  const cab = (filas.shift() || []).map(x => n(x).replace(/ /g, '_'));
  const records = [], errores = [];
  if (!cab.includes('federacion') || !cab.includes('kg')) return { records, errores: [{ linea: 1, error: 'Faltan las columnas «federacion» y «kg». Descarga la plantilla para ver el formato.' }] };
  filas.forEach((x, i) => {
    if (!x.some(y => y.trim())) return;
    const o = Object.fromEntries(cab.map((k, j) => [k, (x[j] ?? '').trim()]));
    const r = normalizarRecord({ ...o, nivelTexto: o.nivel_texto, lev: o.levantamiento || o.lev });
    if (r.ok) { delete r.record.id; delete r.record.historial; records.push(r.record); } else errores.push({ linea: i + 2, error: r.error });
  });
  return { records, errores };
}

/** Texto de un nivel: «Nacional» o el nombre libre. */
export const nombreNivel = r => (r.nivel === 'otro' ? r.nivelTexto : NOMBRE_NIVEL[r.nivel] || r.nivel);


