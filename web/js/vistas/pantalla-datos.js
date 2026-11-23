/* ============================================================
   OPENMEETS — Datos de la pantalla de tarima y del HUD (puro, sin DOM)
   De un meet y un `vivo` saca lo que se dibuja; se prueba en Node.
   ============================================================ */

import * as C from '../nucleo/competencia.js';
import * as L from '../nucleo/luces-estado.js';
import * as R from '../nucleo/reloj.js';

/** Plataformas del meet más las que traen un vivo. */
export const plataformasDe = (meet, vivos = {}) => [...new Set([...(meet?.plataformas || []), ...Object.keys(vivos || {})])];

/** La pedida si existe; si no, la primera con atleta en tarima; si no, la primera. */
export function plataformaElegida(meet, vivos = {}, pedida = '') {
  const lista = plataformasDe(meet, vivos);
  if (pedida && lista.includes(pedida)) return pedida;
  return lista.find(p => vivos?.[p]?.actual) || lista[0] || '';
}

/** Discos por lado con los discos y pares del meet; sin lista de discos, los estándar. */
export function cargaDiscos(kg, meet = {}, lev) {
  const barra = lev === 'S' && meet.barraSentadilla ? Number(meet.barraSentadilla) : Number(meet.barra) || 20;
  const collar = meet.collar ?? 2.5;
  const lista = (Array.isArray(meet.discos) ? meet.discos : []).filter(d => Number(d?.kg) > 0).sort((a, b) => b.kg - a.kg);
  if (!lista.length) return { ...C.discos(kg, barra, collar), barra };
  let c = collar;
  let lado = (Number(kg) - barra - c * 2) / 2;
  if (lado < 0) { lado = (Number(kg) - barra) / 2; c = 0; }
  const discos = [];
  if (lado > 0) for (const d of lista) { let n = Math.floor(Number(d.pares ?? 99)); while (n > 0 && lado >= d.kg - 1e-9) { discos.push(Number(d.kg)); lado -= d.kg; n--; } }
  return { discos, collar: c, sobra: Math.max(0, Math.round(lado * 2 * 100) / 100), barra };
}

const categoriaDe = a => {
  if (!a) return '';
  const clase = a.clase ? (/^\d/.test(String(a.clase)) ? `${a.clase} kg` : String(a.clase)) : '';
  return [a.division, a.sexo === 'F' ? 'Mujeres' : a.sexo === 'M' ? 'Hombres' : '', clase].filter(Boolean).join(' · ');
};

/**
 * Lo que dibuja la tarima: atleta, intento, peso con discos, luces, resultado, reloj y siguientes.
 * `estado`: 'espera' (sin atleta) | 'listo' | 'reloj' | 'decision'.
 */
export function vistaTarima(meet, vivo, ahora = Date.now()) {
  const m = meet || {};
  const est = L.estadoLuces(vivo, ahora);
  // Durante el revelado se muestra a quien se juzgó, no al siguiente que la mesa ya puso en `actual`.
  const a = (est.revelado && vivo?.juzgado) || vivo?.actual || null;
  const lev = vivo?.lev || '';
  const atleta = a ? (m.atletas || []).find(x => x.id === a.aid) : null;
  const reloj = L.relojDe(vivo, vivo?.relojHasta || 0);
  const estado = !a ? 'espera' : est.revelado ? 'decision' : reloj.estado === 'corre' ? 'reloj' : 'listo';
  const rack = a?.rack || (lev ? atleta?.rack?.[lev] : '') || '';
  return {
    hayAtleta: !!a,
    nombre: a?.nombre || '',
    club: a?.club || atleta?.club || '',
    categoria: categoriaDe(atleta),
    lev, levNombre: C.LEVANTES[lev] || '',
    intento: a && a.n != null ? Number(a.n) + 1 : 0,
    kg: a ? Number(a.kg) || 0 : 0,
    rec: !!C.recValido(a?.rec), rack,
    recNivel: typeof C.recValido(a?.rec) === 'string' ? a.rec : '',
    recEtiqueta: C.etiquetaRecord(a?.rec, a?.recTexto),
    // aviso: antes de levantar · logrado: récord válido · no: nulo con récord
    recFase: !C.recValido(a?.rec) ? '' : est.revelado ? (est.rec === true ? 'logrado' : est.rec === false ? 'no' : 'aviso') : 'aviso',
    carga: a ? cargaDiscos(a.kg, m, lev) : null,
    est, resultado: L.textoResultado(est), motivos: L.motivosTarjetas(est, lev),
    reloj, estado,
    siguientes: (vivo?.siguientes || []).slice(0, 5).map(s => ({ nombre: s.nombre, kg: s.kg, n: s.n })),
    tanda: vivo?.sesion ? `${vivo.sesion}${vivo.grupo || ''}` : '',
    modo: L.modoDe(vivo, m),
  };
}

export const ETIQUETA_ESTADO = { espera: 'En espera', listo: 'En tarima', reloj: 'Reloj corriendo', decision: 'Decisión', terminado: 'Meet terminado' };

/**
 * Sonidos de la tarima: chicharra con nulo, tono con válido, pitidos a 30 s, 10 s y 0 (una vez por turno).
 * `son` = { chicharra, valido, pitido, final }; devuelve revisar(vivo, ahora).
 */
export function crearRevisorSonidos(son) {
  const est = { ts: 0, turno: null, hechos: new Set(), finalEn: 0 };
  const final = ahora => { if (ahora - est.finalEn < 3000) return; est.finalEn = ahora; son.final(); };
  return function revisar(v, ahora = Date.now()) {
    if (!v) return;
    const sn = v.sonido;
    if (sn?.ts && sn.ts !== est.ts) {
      est.ts = sn.ts;
      if (ahora - sn.ts < 5000) { if (sn.tipo === 'nulo') son.chicharra(); else if (sn.tipo === 'valido') son.valido(); else if (sn.tipo === 'final') final(ahora); }
    }
    const turno = v.turno || C.turnoDe(v.actual, v.lev);
    if (turno !== est.turno) { est.turno = turno; est.hechos.clear(); }
    const rl = L.relojDe(v, v.relojHasta);
    if (rl.estado === 'listo') est.hechos.clear();
    for (const t of L.pitidosPendientes(R.restante(rl, ahora), rl.estado === 'corre', est.hechos)) { if (t === 0) final(ahora); else son.pitido(); }
  };
}

/** Parámetros del HUD por query: ?t=<plataforma>&pos=abajo|arriba&escala=0.6-2&sonido=1 */
export function parametrosHud(consulta) {
  const q = consulta instanceof URLSearchParams ? consulta : new URLSearchParams(consulta || '');
  const pos = q.get('pos') === 'arriba' ? 'arriba' : 'abajo';
  const escala = Math.min(2, Math.max(0.6, Number(String(q.get('escala') || '1').replace(',', '.')) || 1));
  return { plataforma: q.get('t') || q.get('plataforma') || '', pos, escala, sonido: q.get('sonido') === '1' };
}

/**
 * Qué mostrar según el momento de la tarima (pico y final):
 * 'atleta' (hay uno levantando) · 'carga' · 'meet' (terminó: podio y crédito) · 'grupo' (terminó el grupo: 3 mejores) ·
 * 'espera' (quién viene y la clasificación del grupo). Nunca queda en blanco.
 */
export function momentoTarima(meet, vivo, plataforma = '') {
  if (!meet) return { tipo: 'carga' };
  const atletas = meet.atletas || [], formula = meet.formula || 'GL';
  if (vivo?.actual && !meet.cerrado) return { tipo: 'atleta' };
  if (meet.cerrado || (atletas.length && atletas.every(C.atletaTermino))) return { tipo: 'meet', formula, resumen: C.resumenMeet(atletas, formula) };
  const enPlat = atletas.filter(a => !plataforma || a.plataforma === plataforma);
  const grupo = vivo?.grupo ? C.delGrupo(enPlat, { sesion: vivo.sesion, grupo: vivo.grupo }) : enPlat;
  const fila = a => ({ nombre: a.nombre, club: a.club || '', total: C.total(a), puntos: C.puntos(a, formula) });
  if (grupo.length && grupo.every(C.atletaTermino)) {
    const mejores = C.mejoresPorFormula(grupo, formula).slice(0, 3).map(x => fila(x.a));
    return { tipo: 'grupo', grupo: vivo?.grupo || '', formula, mejores };
  }
  const clasif = grupo.filter(a => C.total(a) > 0).sort((x, y) => C.total(y) - C.total(x)).slice(0, 5).map(fila);
  return { tipo: 'espera', grupo: vivo?.grupo || '', formula, atletas: atletas.length, siguientes: (vivo?.siguientes || []).slice(0, 5).map(s => ({ nombre: s.nombre, kg: s.kg })), clasif };
}
