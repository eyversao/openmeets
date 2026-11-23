/* ============================================================
   OPENMEETS — Lógica pura del organizador (sin DOM ni red; se prueba en Node)
   Importar atletas desde CSV con errores por fila, orden de la lista, progreso del grupo,
   enlaces de los jueces y direcciones de la red local.
   ============================================================ */

import { nuevoAtleta, ORDEN_LEV, claseDe, delGrupo, plantillaCSV, mejoresPorFormula, total, recordsDelMeet, puntosEquipo } from '../../nucleo/competencia.js';

export { plantillaCSV };

const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/* ---------- CSV ---------- */

/** Texto CSV (o con ; o tabulador) → { sep, cabecera: string[], filas: string[][] }. Respeta comillas. */
export function partirCSV(texto) {
  const t = String(texto ?? '').replace(/^﻿/, '');
  const primera = t.split(/\r?\n/, 1)[0] || '';
  const cuenta = c => (primera.match(new RegExp(c === '\t' ? '\t' : `\\${c}`, 'g')) || []).length;
  const sep = [',', ';', '\t'].map(c => [c, cuenta(c)]).sort((a, b) => b[1] - a[1])[0];
  const separador = sep[1] ? sep[0] : ',';
  const filas = [];
  let f = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === separador) { f.push(c); c = ''; }
    else if (ch === '\n') { f.push(c); filas.push(f); f = []; c = ''; }
    else if (ch !== '\r') c += ch;
  }
  if (c || f.length) { f.push(c); filas.push(f); }
  const cabecera = (filas.shift() || []).map(x => x.trim());
  return { sep: separador, cabecera, filas: filas.filter(x => x.some(y => y.trim())) };
}

/** Nombre de columna (como lo escriba quien arma el archivo) → campo interno. */
const ALIAS = {
  nombre: ['nombre', 'atleta', 'name', 'nombre completo', 'athlete'],
  sexo: ['sexo', 'sex', 'genero', 'gender'],
  club: ['club', 'equipo', 'team'],
  division: ['division', 'divisiones', 'categoria de edad', 'age division'],
  equipamiento: ['equipamiento', 'modalidad', 'equipment', 'equipo de levantamiento'],
  clase: ['clase', 'categoria', 'categoria de peso', 'clase de peso', 'weight class', 'weightclass'],
  plataforma: ['plataforma', 'tarima', 'platform'],
  sesion: ['sesion', 'session'],
  grupo: ['grupo', 'flight', 'group'],
  lote: ['lote', 'lot', 'lot number'],
  peso: ['peso', 'peso corporal', 'bodyweight', 'bw', 'peso del atleta'],
  nacimiento: ['nacimiento', 'fecha de nacimiento', 'fecha nacimiento', 'birth', 'birthdate', 'dob', 'nacimiento aaaa mm dd'],
  S1: ['s1', 'apertura s', 'apertura sentadilla', 'sentadilla', 'squat', 'squat opener', 'apertura squat'],
  B1: ['b1', 'apertura b', 'apertura banca', 'banca', 'bench', 'bench opener', 'press banca'],
  D1: ['d1', 'apertura d', 'apertura peso muerto', 'peso muerto', 'deadlift', 'deadlift opener'],
  rackS: ['racks', 'rack s', 'rack sentadilla', 'rack squat', 'rack_s'],
  rackB: ['rackb', 'rack b', 'rack banca', 'rack bench', 'rack_b'],
};
const CAMPO_DE = Object.fromEntries(Object.entries(ALIAS).flatMap(([campo, l]) => l.map(a => [norm(a), campo])));

const sexoDe = v => { const s = norm(v); if (/^(f|m)$/.test(s)) return s.toUpperCase(); if (/^(mujer|femenino|female|dama|woman|femenina)/.test(s)) return 'F'; if (/^(hombre|masculino|male|varon|man|caballero)/.test(s)) return 'M'; return null; };
const equipoDe = v => (/equip|multi|single/i.test(String(v ?? '')) && !/sin equip|no equip|unequip/i.test(String(v ?? '')) ? 'equipado' : 'raw');
const numero = v => { const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.'); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : NaN; };

/** Fecha en AAAA-MM-DD o DD/MM/AAAA → 'AAAA-MM-DD' (o null si no se entiende). */
export function fechaNacimiento(v) {
  const s = String(v ?? '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  let [a, mm, d] = m ? [m[1], m[2], m[3]] : [];
  if (!m) { m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); if (m) [d, mm, a] = [m[1], m[2], m[3]]; }
  if (!m) return null;
  const f = new Date(Number(a), Number(mm) - 1, Number(d));
  if (f.getFullYear() !== Number(a) || f.getMonth() !== Number(mm) - 1 || f.getDate() !== Number(d)) return null;
  return `${a}-${String(mm).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Analiza un CSV de atletas. Devuelve la vista previa: cada fila con su atleta (o null), errores (la fila no se importa)
 * y avisos (se importa igual). Las filas con `omitir` ya existen en el meet.
 * @returns {{ sep, columnas: {texto, campo|null}[], filas: {n, atleta, errores, avisos, omitir}[], ok, conErrores, omitidas, plataformasNuevas: string[] }}
 */
export function analizarCSV(texto, { federacion = 'IPF', plataformas = [], existentes = [] } = {}) {
  const { sep, cabecera, filas } = partirCSV(texto);
  const columnas = cabecera.map(t => ({ texto: t, campo: CAMPO_DE[norm(t)] || null }));
  const idx = Object.fromEntries(columnas.map((c, i) => [c.campo, i]).filter(([k]) => k && k !== 'null'));
  const salida = [];
  const vistos = new Set(existentes.map(a => norm(a.nombre)));
  const nuevasPlat = new Set();
  if (!('nombre' in idx)) return { sep, columnas, filas: [], ok: 0, conErrores: 0, omitidas: 0, plataformasNuevas: [], error: 'No encuentro la columna «nombre». La primera línea debe llevar los títulos de las columnas.' };

  filas.forEach((cols, k) => {
    const n = k + 2; // número de línea en el archivo (la 1 es la cabecera)
    const get = c => (c in idx ? String(cols[idx[c]] ?? '').trim() : '');
    const errores = [], avisos = [];
    const nombre = get('nombre').replace(/\s+/g, ' ');
    if (!nombre) errores.push('Falta el nombre');
    const sexo = sexoDe(get('sexo'));
    if (!sexo) errores.push(get('sexo') ? `Sexo «${get('sexo')}» no válido (usa M o F)` : 'Falta el sexo (M o F)');
    const peso = numero(get('peso'));
    if (Number.isNaN(peso)) errores.push(`Peso corporal «${get('peso')}» no es un número`);
    else if (peso === null) avisos.push('Sin peso corporal: se pondrá en el pesaje');
    else if (peso < 20 || peso > 300) errores.push(`Peso corporal ${peso} kg fuera de lo normal (20 a 300)`);
    let nacimiento = null;
    if (get('nacimiento')) { nacimiento = fechaNacimiento(get('nacimiento')); if (!nacimiento) avisos.push(`Fecha de nacimiento «${get('nacimiento')}» no entendida: se ignora`); }
    const intentos = {};
    for (const l of ORDEN_LEV) {
      const v = numero(get(`${l}1`));
      if (Number.isNaN(v)) errores.push(`Apertura ${l}1 «${get(`${l}1`)}» no es un número`);
      else if (v !== null && (v < 0 || v > 600)) errores.push(`Apertura ${l}1 ${v} kg fuera de lo normal`);
      else if (v !== null && v > 0 && Math.abs(v / 2.5 - Math.round(v / 2.5)) > 1e-9) avisos.push(`Apertura ${l}1 ${v} kg no es múltiplo de 2,5`);
      intentos[l] = v;
    }
    let plataforma = get('plataforma') || plataformas[0] || 'Tarima 1';
    if (get('plataforma') && plataformas.length && !plataformas.includes(plataforma)) { avisos.push(`La tarima «${plataforma}» no existe en el meet: se añadirá`); nuevasPlat.add(plataforma); }
    const omitir = !!nombre && vistos.has(norm(nombre));
    if (omitir) avisos.push('Ya hay un atleta con ese nombre: se omite');
    if (nombre) vistos.add(norm(nombre));
    let atleta = null;
    if (!errores.length) {
      const division = get('division') || 'Open';
      atleta = nuevoAtleta({
        nombre, sexo, club: get('club'), division, equipamiento: equipoDe(get('equipamiento')), peso, clase: get('clase'),
        plataforma, sesion: get('sesion') || '1', grupo: get('grupo') || 'A', lote: numero(get('lote')), nacimiento,
        rack: { S: numero(get('rackS')) || null, B: numero(get('rackB')) || null },
      });
      if (!atleta.clase) atleta.clase = peso ? claseDe(sexo, peso, division, federacion || 'IPF') : '';
      for (const l of ORDEN_LEV) atleta.intentos[l][0].kg = intentos[l] > 0 ? intentos[l] : null;
    }
    salida.push({ n, atleta, errores, avisos, omitir });
  });
  const usables = salida.filter(f => f.atleta && !f.omitir);
  return { sep, columnas, filas: salida, ok: usables.length, conErrores: salida.filter(f => f.errores.length).length, omitidas: salida.filter(f => f.omitir).length, plataformasNuevas: [...nuevasPlat] };
}

const idAtleta = () => `at-${[...(globalThis.crypto?.getRandomValues(new Uint8Array(5)) || Array.from({ length: 5 }, () => Math.random() * 256 | 0))].map(x => x.toString(16).padStart(2, '0')).join('')}`;
/** Atletas listos para guardar: con id propio y lote seguido al mayor del meet cuando el archivo no lo trae. */
export function prepararImportacion(analisis, existentes = []) {
  let lote = Math.max(0, ...existentes.map(a => Number(a.lote) || 0));
  return analisis.filas.filter(f => f.atleta && !f.omitir).map(f => {
    const a = { ...f.atleta, id: idAtleta() };
    if (!(Number(a.lote) > 0)) a.lote = ++lote; else lote = Math.max(lote, Number(a.lote));
    return a;
  });
}

/* ---------- Orden y grupos ---------- */

const cmpTexto = (a, b) => String(a).localeCompare(String(b), 'es', { numeric: true });
/** Plataforma, sesión, grupo, lote y nombre: el orden natural de una hoja de pesaje. */
export const ordenarAtletas = lista => [...lista].sort((a, b) => cmpTexto(a.plataforma, b.plataforma) || cmpTexto(a.sesion, b.sesion) || cmpTexto(a.grupo, b.grupo) || (Number(a.lote) || 9999) - (Number(b.lote) || 9999) || cmpTexto(a.nombre, b.nombre));
export const siguienteLote = lista => Math.max(0, ...lista.map(a => Number(a.lote) || 0)) + 1;
export const sesionesDe = (lista, plataforma) => [...new Set(lista.filter(a => !plataforma || a.plataforma === plataforma).map(a => String(a.sesion || '1')))].sort(cmpTexto);
export const gruposDe = (lista, plataforma, sesion) => [...new Set(lista.filter(a => (!plataforma || a.plataforma === plataforma) && (!sesion || String(a.sesion) === String(sesion))).map(a => a.grupo || 'A'))].sort(cmpTexto);

/**
 * Cuánto falta en un grupo. Un intento «cuenta» cuando tiene resultado o es un pase (0 kg declarado).
 * `segmentos` son 9 (3 levantamientos × 3 rondas) para el anillo: ok = todos hechos, pendiente = faltan, vacio = nadie levanta.
 */
export function progresoGrupo(atletas, { plataforma, sesion, grupo } = {}) {
  const lista = delGrupo(atletas, { plataforma, sesion, grupo });
  let total = 0, hechos = 0;
  const segmentos = ORDEN_LEV.flatMap(lev => [0, 1, 2].map(n => {
    const quienes = lista.filter(a => (a.levantes || ORDEN_LEV).includes(lev));
    const hecho = i => i && (i.r === 1 || i.r === -1 || (i.kg === 0));
    const h = quienes.filter(a => hecho(a.intentos?.[lev]?.[n])).length;
    total += quienes.length; hechos += h;
    return { lev, n, estado: !quienes.length ? 'vacio' : h === quienes.length ? 'ok' : 'pendiente' };
  }));
  return { total, hechos, faltan: total - hechos, atletas: lista.length, porcentaje: total ? Math.round((hechos / total) * 100) : 0, segmentos };
}

/** Texto de intentos que faltan: «Faltan 14 intentos en el Grupo B». */
export const textoFaltan = (p, grupo) => (!p.atletas ? '' : p.faltan === 0 ? `Grupo ${grupo} completo` : `Faltan ${p.faltan} ${p.faltan === 1 ? 'intento' : 'intentos'} en el Grupo ${grupo}`);

/* ---------- Enlaces de los jueces ---------- */

const esLocal = h => /^(localhost|127\.|\[?::1\]?$)/.test(h);

/**
 * Direcciones desde donde los teléfonos pueden abrir OpenMeets: las de la red local si el organizador entró por localhost;
 * si entró por una IP o un nombre, ese mismo origen. @returns {string[]} sin barra final.
 */
export function basesParaTelefonos({ origen, ips = [], puerto } = {}) {
  let u; try { u = new URL(origen); } catch { return []; }
  if (!esLocal(u.hostname)) return [u.origin];
  const p = puerto || u.port || (u.protocol === 'https:' ? 443 : 80);
  return ips.length ? ips.map(ip => `${u.protocol}//${ip}:${p}`) : [u.origin];
}

export const POS_JUEZ = [['izq', 'Izquierda'], ['cen', 'Principal'], ['der', 'Derecha']];

/** Enlace de un juez (lo arma juez-datos.js): `/juez/:id?t=<tarima>&p=<izq|cen|der>&c=<código>`. */
export { enlaceJuez } from '../juez-datos.js';

/* ---------- Formato ---------- */

/** «3:05» o «90» → segundos; null si no se entiende. */
export function leerTiempo(txt) {
  const t = String(txt ?? '').trim().replace(',', '.');
  const m = /^(\d{1,3}):([0-5]?\d)$/.exec(t);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return /^\d{1,5}$/.test(t) ? Number(t) : null;
}

/** Fecha 'AAAA-MM-DD' de hoy en hora local. */
export function hoyISO(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

/* ---------- Discos ---------- */

export const DISCOS_ESTANDAR = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5, 0.25].map(kg => ({ kg, pares: kg >= 5 ? 4 : 2 }));

/**
 * Discos por lado para un peso, con la barra y el collar del meet y solo los discos (y pares) que hay.
 * Sin lista de discos usa los estándar sin límite. `sobra` > 0 si el peso no se puede cargar exacto.
 * @returns {{ discos: number[], barra: number, collar: number, sobra: number }}
 */
export function cargaDiscos(kg, meet = {}, lev) {
  const barra = lev === 'S' && Number(meet.barraSentadilla) > 0 ? Number(meet.barraSentadilla) : Number(meet.barra) || 20;
  let collar = Number.isFinite(Number(meet.collar)) ? Number(meet.collar) : 2.5;
  const inventario = (Array.isArray(meet.discos) && meet.discos.some(d => Number(d?.kg) > 0) ? meet.discos : DISCOS_ESTANDAR.map(d => ({ ...d, pares: 99 })))
    .filter(d => Number(d?.kg) > 0).map(d => ({ kg: Number(d.kg), pares: Math.floor(Number(d.pares ?? 99)) })).sort((a, b) => b.kg - a.kg);
  let lado = (Number(kg) - barra - collar * 2) / 2;
  if (lado < 0) { lado = (Number(kg) - barra) / 2; collar = 0; }
  const discos = [];
  if (lado > 0) for (const d of inventario) { let n = d.pares; while (n > 0 && lado >= d.kg - 1e-9) { discos.push(d.kg); lado -= d.kg; n--; } }
  return { discos, barra, collar, sobra: Math.max(0, Math.round(lado * 2 * 100) / 100) };
}

/* ---------- Final del meet (pico-final) ---------- */

/** Cifras del cierre: atletas, intentos dirigidos, % válidos, récords, mejor levantador por sexo y equipo ganador. */
export function resumenFinal(atletas = [], formula = 'GL') {
  const f = formula === 'IPF' ? 'GL' : formula;
  let intentos = 0, validos = 0;
  for (const a of atletas) for (const l of ORDEN_LEV) for (const i of (a.intentos?.[l] || []).slice(0, 3)) if (i && (i.r === 1 || i.r === -1)) { intentos++; if (i.r === 1) validos++; }
  const mejorDe = sexo => { const m = mejoresPorFormula(atletas.filter(a => a.sexo === sexo), f)[0]; return m ? { nombre: m.a.nombre, puntos: Math.round(m.valor * 100) / 100, total: total(m.a) } : null; };
  const records = recordsDelMeet(atletas).reduce((n, r) => n + ['S', 'B', 'D', 'total'].filter(k => r[k]).length, 0);
  const equipo = puntosEquipo(atletas)[0] || null;
  return { atletas: atletas.length, conTotal: atletas.filter(a => total(a) > 0).length, intentos, validos, porcentaje: intentos ? Math.round((validos / intentos) * 100) : 0, records, mejorM: mejorDe('M'), mejorF: mejorDe('F'), equipo };
}
