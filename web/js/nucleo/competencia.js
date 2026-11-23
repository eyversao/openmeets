/* ============================================================
   OPENMEETS — Reglas de una competencia de powerlifting
   Sin pantallas ni red: orden de salida, totales, puestos, desempates,
   discos, decisión de los jueces, CSV, marcas personales, récords,
   puntos de equipo y el anillo de 9 intentos.
   ============================================================ */

import { claseMasCercana } from './federaciones.js';
import { puntaje, sistemaDe } from './puntajes.js';

export const LEVANTES = { S: 'Sentadilla', B: 'Press banca', D: 'Peso muerto' };
export const ORDEN_LEV = ['S', 'B', 'D'];
const DISCOS = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5, 0.25];

export const intentoVacio = () => ({ kg: null, r: null, rec: false, alFinal: false });

/** Niveles de récord de un intento: `rec` es false | true (sin nivel) | uno de estos. */
export const NIVELES_REC = ['mundial', 'nacional', 'ibero', 'regional', 'otro'];
const TEXTO_REC = { mundial: 'RÉCORD MUNDIAL', nacional: 'RÉCORD NACIONAL', ibero: 'RÉCORD IBEROAMERICANO', regional: 'RÉCORD REGIONAL' };
export const MAX_REC_TEXTO = 40;
/** Valor de `rec` válido (cualquier otra cosa es false). */
export const recValido = rec => (rec === true || NIVELES_REC.includes(rec) ? rec : false);
/** Rótulo del récord: 'RÉCORD MUNDIAL' …, el texto libre en mayúsculas para 'otro', 'RÉCORD' sin nivel; '' si no va por récord. */
export function etiquetaRecord(rec, recTexto = '') {
  if (!recValido(rec)) return '';
  if (rec === 'otro') return String(recTexto ?? '').trim().slice(0, MAX_REC_TEXTO).toUpperCase() || 'RÉCORD';
  return TEXTO_REC[rec] || 'RÉCORD';
}
const tres = () => [intentoVacio(), intentoVacio(), intentoVacio()];

/** Atleta con el modelo de OpenMeets: { id, nombre, sexo, nacimiento, club, division, equipamiento 'raw'|'equipado', peso, clase, plataforma, sesion, grupo, lote, rack, intentos }. */
export function nuevoAtleta(o = {}) {
  return {
    id: o.id || `at_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    nombre: o.nombre || '', sexo: o.sexo === 'F' ? 'F' : 'M', nacimiento: o.nacimiento || null, club: o.club || '', division: o.division || 'Open',
    equipamiento: o.equipamiento === 'equipado' || o.modalidad === 'equipped' ? 'equipado' : 'raw',
    peso: o.peso ?? o.bw ?? null, clase: o.clase || '',
    lote: o.lote ?? null, plataforma: o.plataforma || 'Tarima 1', sesion: o.sesion || '1', grupo: o.grupo || 'A',
    levantes: o.levantes || ['S', 'B', 'D'], rack: o.rack || {},
    intentos: o.intentos || { S: tres(), B: tres(), D: tres() },
  };
}

/** Peso corporal y equipamiento de un atleta (acepta también los nombres viejos bw / modalidad). */
export const pesoDe = a => Number(a?.peso ?? a?.bw) || 0;
export const equipoDe = a => (a?.equipamiento === 'equipado' || a?.modalidad === 'equipped' ? 'equipped' : 'classic');

/** Categoría según sexo y peso corporal (por defecto IPF; Sub-Junior y Junior tienen una clase más liviana). */
export function claseDe(sexo, bw, division = 'Open', federacion = 'IPF') {
  return bw > 0 ? claseMasCercana(federacion, sexo, bw, division) : '';
}

/** El cuarto intento se levanta, pero no cuenta para el total. */
const validos = l => l.slice(0, 3);
export const mejor = (a, lev) => Math.max(0, ...validos(a.intentos?.[lev] || []).filter(i => i.r === 1 && i.kg > 0).map(i => Number(i.kg)));
const quemado = (a, lev) => {
  const l = validos(a.intentos?.[lev] || []);
  return l.length && l.every(i => i.r === -1 || Number(i.kg) === 0) && l.some(i => i.r === -1);
};
/** Sin ningún intento válido en un levantamiento no hay total. */
export function total(a) {
  const levs = a.levantes || ORDEN_LEV;
  if (levs.some(l => quemado(a, l))) return 0;
  return levs.reduce((s, l) => s + mejor(a, l), 0);
}

/** Puntos del atleta con la fórmula del meet ('GL' | 'DOTS' | 'Wilks' | 'IPF' = GL). 0 si no hay total válido. */
export function puntos(a, formula = 'GL') {
  return puntaje(sistemaDe(formula), total(a), pesoDe(a), a.sexo === 'F' ? 'F' : 'M', equipoDe(a));
}

/* ---------- Orden de salida ---------- */

export const delGrupo = (lista, { plataforma, sesion, grupo }) => lista.filter(a => (!plataforma || a.plataforma === plataforma) && (!sesion || String(a.sesion) === String(sesion)) && (!grupo || a.grupo === grupo));

/**
 * Cola de un levantamiento. Una ronda no termina hasta que todos la hagan:
 * dentro de ella sale primero el peso menor; a igual peso, el lote menor.
 * Un peso 0 es un pase. Quien no ha declarado aparece en `sinPeso`.
 */
export function cola(lista, lev) {
  const participan = lista.filter(a => (a.levantes || ORDEN_LEV).includes(lev));
  const rondas = Math.max(3, ...participan.map(a => a.intentos?.[lev]?.length || 0));
  for (let n = 0; n < rondas; n++) {
    const pend = participan.filter(a => {
      const i = a.intentos?.[lev]?.[n];
      return i && i.r === null && !(Number(i.kg) === 0 && i.kg !== null) && (n < 3 || i.kg > 0);
    });
    if (!pend.length) continue;
    const conPeso = pend.filter(a => a.intentos[lev][n].kg > 0);
    const orden = [...conPeso].sort((x, y) => {
      const a = x.intentos[lev][n], b = y.intentos[lev][n];
      return (a.alFinal ? 1 : 0) - (b.alFinal ? 1 : 0) || a.kg - b.kg || (Number(x.lote) || 9999) - (Number(y.lote) || 9999);
    }).map(a => ({ a, lev, n, kg: Number(a.intentos[lev][n].kg) }));
    return { ronda: n, orden, sinPeso: pend.filter(a => !(a.intentos[lev][n].kg > 0)) };
  }
  return { ronda: null, orden: [], sinPeso: [] };
}

/** Lo que permite el reglamento para el siguiente intento. */
export function pesoMinimo(a, lev, n) {
  const previos = (a.intentos?.[lev] || []).slice(0, n).filter(i => i.kg > 0 && i.r !== null);
  if (!previos.length) return 0;
  const u = previos[previos.length - 1];
  return Number(u.kg) + (u.r === 1 ? 2.5 : 0);
}

/**
 * Un peso se corrige libremente una vez; desde el segundo cambio solo puede subir.
 * Devuelve el motivo si no se permite y vacío si se puede.
 */
export function bloqueoCambioPeso(i, nuevo, minimo = 0) {
  if (nuevo > 0 && nuevo < minimo) return `El reglamento pide al menos ${minimo} kg`;
  if (i.kg > 0 && (i.cambios || 0) >= 1 && nuevo < i.kg) return `Ya se cambió una vez: solo puede subir de ${i.kg} kg`;
  return '';
}

/** Aplica el cambio de peso y cuenta la corrección. */
export function cambiarPeso(i, nuevo) {
  if (i.kg > 0 && nuevo !== i.kg) i.cambios = (i.cambios || 0) + 1;
  i.kg = nuevo;
}

/** Cambia la decisión de un intento y deja constancia de quién, cuándo y por qué. */
export function cambiarDecision(i, r, motivo, por = '') {
  i.historial = [...(i.historial || []), { ts: Date.now(), de: i.r ?? null, a: r, motivo, por }];
  i.r = r;
}

export const fueCambiado = i => (i.historial || []).length > 0;

/* ---------- Jueces ---------- */

export const POSICIONES = [['izq', 'Izquierda'], ['cen', 'Principal'], ['der', 'Derecha']];

/* Botones de un mando y motivos de tarjeta del reglamento técnico IPF (S, B, D). */
export const BOTONES = ['blanca', 'roja', 'azul', 'amarilla'];
export const TARJETAS = {
  // Reglamento técnico IPF (2024 + cambios 2026): roja = profundidad/apoyo, azul = movimiento descendente o sin bloqueo, amarilla = el resto.
  roja: { S: 'Sin profundidad o pies movidos', B: 'Barra sin tocar el pecho o glúteos fuera del banco', D: 'Barra apoyada en los muslos o pies movidos' },
  azul: { S: 'Bajó la barra al subir o sin bloqueo', B: 'Bajó la barra al empujar o sin bloqueo', D: 'Bajó la barra o sin bloqueo final' },
  amarilla: { S: 'Señales, auxiliares u otra falta', B: 'Señales, auxiliares u otra falta', D: 'Señales, sin control al bajar u otra falta' },
};

/**
 * Un voto como luz y tarjetas. Acepta 'blanca'|'roja'|'azul'|'amarilla' u objeto {voto|luz, tarjetas}.
 * 'azul' y 'amarilla' son nulo con esa tarjeta; 'roja' lleva tarjeta roja solo en modo IPF.
 */
export function normalizarVoto(v, modo) {
  const ipf = modo === 'IPF';
  let luz = v, tarjetas = [];
  if (v && typeof v === 'object') {
    luz = v.luz ?? v.voto;
    tarjetas = (Array.isArray(v.tarjetas) ? v.tarjetas : []).filter(t => t in TARJETAS).slice(0, 3);
  }
  if (luz === 'blanca') return { luz: 'blanca', tarjetas: [] };
  if (luz === 'azul' || luz === 'amarilla') return { luz: 'roja', tarjetas: [luz] };
  if (luz === 'roja') return { luz: 'roja', tarjetas: tarjetas.length ? tarjetas : ipf ? ['roja'] : [] };
  return null;
}

/** Las luces solo se muestran con los tres votos. Dos blancas validan. Votos: strings viejos u objetos. */
export function decision(votos = {}, modo) {
  const v = POSICIONES.map(([p]) => normalizarVoto(votos[p], modo));
  if (v.some(x => !x)) return null;
  return v.filter(x => x.luz === 'blanca').length >= 2 ? 1 : -1;
}

/** Tarjetas de cada juez ({izq, cen, der}); vacío para quien aún no votó o votó blanca. */
export const tarjetasDe = (votos = {}, modo) => Object.fromEntries(POSICIONES.map(([p]) => [p, normalizarVoto(votos[p], modo)?.tarjetas || []]));

/** Identificador del intento en tarima: 'aid_lev_n'. */
export const turnoDe = (actual, lev) => (actual?.aid && lev && actual.n != null ? `${actual.aid}_${lev}_${actual.n}` : null);

/* ---------- Puestos ---------- */

/** Mayor total; a igual total, el más ligero; a igual peso, el lote menor. */
export function clasificacion(lista) {
  const grupos = new Map();
  lista.forEach(a => {
    const k = `${a.division} · ${a.sexo === 'F' ? 'Mujeres' : 'Hombres'} · ${a.clase || claseDe(a.sexo, pesoDe(a), a.division) || 'Sin categoría'}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  });
  return [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([nombre, l]) => ({
    nombre,
    filas: [...l].sort((x, y) => total(y) - total(x) || (pesoDe(x) || 999) - (pesoDe(y) || 999) || (Number(x.lote) || 9999) - (Number(y.lote) || 9999))
      .map((a, i) => ({ a, puesto: total(a) > 0 ? i + 1 : null, total: total(a) })),
  }));
}

export const mejoresPorFormula = (lista, formula = 'GL') => [...lista].map(a => ({ a, valor: puntos(a, formula) })).filter(x => x.valor > 0).sort((x, y) => y.valor - x.valor);

/* ---------- Discos ---------- */

/** Discos por lado, de mayor a menor. `sobra` > 0 si el peso no se puede cargar exacto. */
export function discos(kg, barra = 20, collar = 2.5) {
  let lado = (Number(kg) - barra - collar * 2) / 2;
  if (lado < 0) { lado = (Number(kg) - barra) / 2; collar = 0; }
  const out = [];
  DISCOS.forEach(d => { while (lado >= d - 1e-9) { out.push(d); lado -= d; } });
  return { discos: out, collar, sobra: Math.round(lado * 2 * 100) / 100 };
}

/* ---------- CSV ---------- */

const COLS = ['nombre', 'sexo', 'club', 'division', 'equipamiento', 'clase', 'plataforma', 'sesion', 'grupo', 'lote', 'peso', 'nacimiento', 'S1', 'B1', 'D1', 'rackS', 'rackB'];
const celda = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const num = v => { const n = Number(String(v ?? '').replace(',', '.')); return String(v ?? '').trim() !== '' && Number.isFinite(n) ? n : null; };

export const plantillaCSV = () => `${COLS.join(',')}\n"Laura Díaz",F,"Club Ejemplo",Open,raw,,"Tarima 1",1,A,12,62.4,1997-05-12,120,65,145,12,6\n`;

export function leerCSV(texto) {
  const filas = [];
  let f = [], c = '', q = false;
  const t = String(texto).replace(/^﻿/, '');
  const sep = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { f.push(c); c = ''; }
    else if (ch === '\n') { f.push(c); filas.push(f); f = []; c = ''; }
    else if (ch !== '\r') c += ch;
  }
  if (c || f.length) { f.push(c); filas.push(f); }
  const cab = (filas.shift() || []).map(x => x.trim());
  return filas.filter(x => x.some(y => y.trim())).map(x => {
    const o = Object.fromEntries(cab.map((k, i) => [k, (x[i] ?? '').trim()]));
    if (!o.nombre) return null;
    const a = nuevoAtleta({
      nombre: o.nombre, sexo: /^f/i.test(o.sexo) ? 'F' : 'M', club: o.club, division: o.division || 'Open',
      equipamiento: /equip/i.test(o.equipamiento || o.modalidad || '') ? 'equipado' : 'raw', clase: o.clase,
      plataforma: o.plataforma || 'Tarima 1', sesion: o.sesion || '1', grupo: o.grupo || 'A', lote: num(o.lote), peso: num(o.peso),
      nacimiento: o.nacimiento || null, rack: { S: o.rackS || '', B: o.rackB || '' },
    });
    ORDEN_LEV.forEach(l => { a.intentos[l][0].kg = num(o[`${l}1`]); });
    if (!a.clase) a.clase = claseDe(a.sexo, a.peso, a.division);
    return a;
  }).filter(Boolean);
}

export function resultadosCSV(lista, formula = 'GL') {
  const cab = ['Puesto', 'Categoría', 'Atleta', 'Club', 'Peso', ...ORDEN_LEV.flatMap(l => [1, 2, 3].map(n => `${l}${n}`)), 'Total', formula];
  const val = i => (i?.kg ? (i.r === -1 ? -i.kg : i.r === 1 ? i.kg : '') : '');
  const filas = clasificacion(lista).flatMap(g => g.filas.map(({ a, puesto, total: t }) => [puesto ?? 'DSQ', g.nombre, a.nombre, a.club, pesoDe(a) || '', ...ORDEN_LEV.flatMap(l => [0, 1, 2].map(n => val(a.intentos?.[l]?.[n]))), t, Math.round(puntos(a, formula) * 100) / 100]));
  return '﻿' + [cab, ...filas].map(f => f.map(celda).join(',')).join('\r\n');
}

/* ---------- Nombres, marcas personales, récords, equipo y anillo ---------- */

/** Nombre sin tildes, en minúscula y con espacios simples: «  José  PÉREZ » → «jose perez». */
export const normalizarNombre = n => String(n ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Marca personal de un nombre en meets anteriores.
 * `historial`: lista de meets ({ id, nombre, fecha, atletas: [...] }); solo cuentan los intentos válidos.
 * Devuelve { total, S, B, D, meets, fechaTotal, meetTotal } con 0 donde no hay marca, o null si ese nombre nunca compitió.
 */
export function marcaPersonal(nombre, historial = []) {
  const k = normalizarNombre(nombre);
  if (!k) return null;
  const m = { total: 0, S: 0, B: 0, D: 0, meets: 0, fechaTotal: null, meetTotal: null };
  for (const meet of historial || []) {
    const a = (meet?.atletas || []).find(x => normalizarNombre(x.nombre) === k);
    if (!a) continue;
    m.meets++;
    ORDEN_LEV.forEach(l => { m[l] = Math.max(m[l], mejor(a, l)); });
    const t = total(a);
    if (t > m.total) { m.total = t; m.fechaTotal = meet.fecha ?? null; m.meetTotal = meet.nombre ?? meet.id ?? null; }
  }
  return m.meets ? m : null;
}

/** ¿Este peso (kg) supera la marca personal en ese levantamiento ('S'|'B'|'D'|'total')? Sin marca previa no hay «marca personal». */
export const superaMarca = (marca, lev, kg) => !!marca && marca[lev] > 0 && Number(kg) > marca[lev];

const claveCat = a => `${a.sexo === 'F' ? 'F' : 'M'}|${a.clase || claseDe(a.sexo, pesoDe(a), a.division) || 'Sin categoría'}|${a.division || 'Open'}`;
export const nombreCategoria = k => { const [s, c, d] = k.split('|'); return `${d} · ${s === 'F' ? 'Mujeres' : 'Hombres'} · ${c}`; };

/**
 * Récords del meet por categoría (sexo + clase + división).
 * @returns {{ clave, nombre, sexo, clase, division, S, B, D, total }[]} cada marca { kg, aid, nombre } o null
 */
export function recordsDelMeet(atletas = []) {
  const por = new Map();
  for (const a of atletas) {
    const k = claveCat(a);
    if (!por.has(k)) { const [sexo, clase, division] = k.split('|'); por.set(k, { clave: k, nombre: nombreCategoria(k), sexo, clase, division, S: null, B: null, D: null, total: null }); }
    const r = por.get(k);
    const poner = (campo, kg) => { if (kg > 0 && (!r[campo] || kg > r[campo].kg)) r[campo] = { kg, aid: a.id, nombre: a.nombre }; };
    ORDEN_LEV.forEach(l => poner(l, mejor(a, l)));
    poner('total', total(a));
  }
  return [...por.values()].sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
}

export const PUNTOS_EQUIPO = [12, 9, 8, 7, 6, 5, 4, 3, 2, 1];

function porCategoria(atletas) {
  const g = new Map();
  atletas.forEach(a => { const k = claveCat(a); if (!g.has(k)) g.set(k, []); g.get(k).push(a); });
  return [...g.entries()].map(([k, l]) => ({
    clave: k, nombre: nombreCategoria(k),
    filas: [...l].sort((x, y) => total(y) - total(x) || (pesoDe(x) || 999) - (pesoDe(y) || 999) || (Number(x.lote) || 9999) - (Number(y.lote) || 9999))
      .map((a, i) => ({ a, puesto: total(a) > 0 ? i + 1 : null })),
  }));
}

/**
 * Puntos de equipo (club): 12-9-8-7-6-5-4-3-2-1 a los diez primeros de cada categoría (sexo + clase + división).
 * Cuentan solo atletas con total válido y club. @returns {{ club, puntos, atletas, detalle }[]} de mayor a menor.
 */
export function puntosEquipo(atletas = []) {
  const clubes = new Map();
  for (const g of porCategoria(atletas)) {
    g.filas.forEach(({ a, puesto }, i) => {
      const pts = PUNTOS_EQUIPO[i] || 0;
      const club = String(a.club || '').trim();
      if (!puesto || !pts || !club) return;
      const c = clubes.get(club) || { club, puntos: 0, atletas: 0, detalle: [] };
      c.puntos += pts; c.atletas++; c.detalle.push({ aid: a.id, nombre: a.nombre, categoria: g.nombre, puesto, puntos: pts });
      clubes.set(club, c);
    });
  }
  return [...clubes.values()].sort((x, y) => y.puntos - x.puntos || y.atletas - x.atletas || x.club.localeCompare(y.club, 'es'));
}

/**
 * Anillo de 9 segmentos (3 levantamientos × 3 intentos): { lev, n, estado }.
 * estado: 'ok' válido · 'mal' nulo · 'pendiente' con peso y sin resultado · 'vacio' sin peso (o levantamiento que no compite).
 */
export function anilloAtleta(atleta) {
  const levs = atleta?.levantes || ORDEN_LEV;
  return ORDEN_LEV.flatMap(lev => [0, 1, 2].map(n => {
    const i = atleta?.intentos?.[lev]?.[n];
    let estado = 'vacio';
    if (levs.includes(lev) && i) estado = i.r === 1 ? 'ok' : i.r === -1 ? 'mal' : Number(i.kg) > 0 ? 'pendiente' : 'vacio';
    return { lev, n, estado };
  }));
}

/* ---------- Pico y final ---------- */

const resuelto = i => !!i && (i.r === 1 || i.r === -1 || (i.kg !== null && i.kg !== undefined && Number(i.kg) === 0));

/** El atleta terminó: sus 9 intentos (3 por levantamiento que compite) están decididos o pasados, y levantó al menos uno. */
export function atletaTermino(a) {
  const levs = a?.levantes || ORDEN_LEV;
  if (!levs.length) return false;
  let decidido = false;
  for (const l of levs) for (let n = 0; n < 3; n++) {
    const i = a.intentos?.[l]?.[n];
    if (!resuelto(i)) return false;
    if (i.r === 1 || i.r === -1) decidido = true;
  }
  return decidido;
}

/** Tarjeta final de un atleta: { total, puntos, puesto, de, categoria, records: {S,B,D,total} } con el puesto en su categoría. */
export function tarjetaFinal(a, atletas = [], formula = 'GL') {
  const g = clasificacion(atletas).find(x => x.filas.some(f => f.a.id === a.id));
  const fila = g?.filas.find(f => f.a.id === a.id);
  const rec = {};
  for (const r of recordsDelMeet(atletas)) for (const k of [...ORDEN_LEV, 'total']) if (r[k]?.aid === a.id) rec[k] = true;
  return { total: total(a), puntos: puntos(a, formula), puesto: fila?.puesto ?? null, de: g?.filas.length || 0, categoria: g?.nombre || '', records: rec };
}

/** Cifras y ganadores del meet: atletas, intentos decididos, % válidos, récords, podio por categoría, mejores por sexo y equipo ganador. */
export function resumenMeet(atletas = [], formula = 'GL') {
  let intentos = 0, validosN = 0;
  for (const a of atletas) for (const l of a.levantes || ORDEN_LEV) for (const i of validos(a.intentos?.[l] || [])) if (i.r === 1 || i.r === -1) { intentos++; if (i.r === 1) validosN++; }
  const todos = mejoresPorFormula(atletas, formula);
  const rec = recordsDelMeet(atletas);
  return {
    atletas: atletas.length, intentos, validos: validosN, pct: intentos ? Math.round((validosN / intentos) * 100) : 0,
    records: rec.reduce((s, r) => s + [...ORDEN_LEV, 'total'].filter(k => r[k]).length, 0),
    podios: clasificacion(atletas).map(g => ({ nombre: g.nombre, filas: g.filas.filter(f => f.puesto).slice(0, 3) })).filter(g => g.filas.length),
    mejores: { F: todos.filter(x => x.a.sexo === 'F')[0] || null, M: todos.filter(x => x.a.sexo !== 'F')[0] || null },
    podioGeneral: todos.slice(0, 3),
    equipo: puntosEquipo(atletas)[0] || null,
  };
}
