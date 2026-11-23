/* ============================================================
   OPENMEETS — LiftingCast en vivo
   LiftingCast publica cada competencia en una base CouchDB pública de solo
   lectura (couchdb.liftingcast.com/<meet>_readonly) con CORS abierto: se lee
   entera una vez y después se escucha su feed de cambios (longpoll).
   Sin imports: se prueba en Node (pruebas/liftingcast.test.mjs).
   ============================================================ */

const BASE = 'https://couchdb.liftingcast.com/';
const LEV = { squat: 'sq', bench: 'bp', dead: 'dl' };
const ORDEN = { squat: 1, bench: 2, dead: 3 };

/** Id de la competencia a partir del enlace (o del id suelto); null si no es de LiftingCast. */
export function idDeEnlace(texto) {
  const s = String(texto || '').trim();
  const m = s.match(/liftingcast\.com\/meets\/([a-z0-9]{6,32})/i) || s.match(/^([a-z0-9]{6,32})$/i);
  return m ? m[1].toLowerCase() : null;
}

// Jueces de LiftingCast → posiciones de la mesa (left = izq, head = cen, right = der).
const POS = { left: 'izq', head: 'cen', right: 'der' };
const COLOR_TARJETA = { red: 'roja', blue: 'azul', yellow: 'amarilla' };

/**
 * Motivo corto de cada tarjeta IPF por movimiento (sq, bp, dl). Texto propio: este módulo no importa nada.
 * Es una guía breve; la lista oficial completa la lleva competencia.js (TARJETAS).
 */
export const MOTIVOS_IPF = {
  // Igual que TARJETAS en competencia.js (reglamento técnico IPF 2024 + cambios 2026).
  sq: { roja: 'Sin profundidad o pies movidos', azul: 'Bajó la barra al subir o sin bloqueo', amarilla: 'Señales, auxiliares u otra falta' },
  bp: { roja: 'Barra sin tocar el pecho o glúteos fuera del banco', azul: 'Bajó la barra al empujar o sin bloqueo', amarilla: 'Señales, auxiliares u otra falta' },
  dl: { roja: 'Barra apoyada en los muslos o pies movidos', azul: 'Bajó la barra o sin bloqueo final', amarilla: 'Señales, sin control al bajar u otra falta' },
};
/** Motivo de una tarjeta ('roja'|'azul'|'amarilla') en un movimiento; null si no hay texto. */
export const motivoTarjeta = (lev, color) => MOTIVOS_IPF[lev]?.[color] || null;

const tarjetasDe = c => Object.entries(COLOR_TARJETA).filter(([k]) => c?.[k] === true).map(([, v]) => v);
const luzDe = d => (d === 'good' ? 'blanca' : d === 'bad' ? 'roja' : null);

/** Luces de una plataforma: los 3 jueces. Nada de color hasta que votan los 3 (como en la pantalla de la mesa). */
function lucesDe(docs, pid) {
  const j = Object.fromEntries(Object.entries(POS).map(([k, pos]) => [pos, docs[`r${k}-${pid}`] || null]));
  const votados = { izq: !!luzDe(j.izq?.decision), cen: !!luzDe(j.cen?.decision), der: !!luzDe(j.der?.decision) };
  const revelado = votados.izq && votados.cen && votados.der;
  const out = { votados, revelado, izq: null, cen: null, der: null, tarjetas: { izq: [], cen: [], der: [] } };
  if (revelado) for (const pos of Object.values(POS)) { out[pos] = luzDe(j[pos].decision); out.tarjetas[pos] = out[pos] === 'roja' ? tarjetasDe(j[pos].cards) : []; }
  return out;
}

/** Los 3 jueces de un intento terminado: [{ luz, tarjetas }] en orden izq, cen, der. */
const juecesDe = a => Object.keys(POS).map(k => {
  const d = a?.decisions?.[k];
  const luz = luzDe(d?.decision);
  return { luz, tarjetas: luz === 'roja' ? tarjetasDe(d.cards) : [] };
});

/** Discos por lado para un peso total, con la barra y los discos (pares) de la competencia. */
export function discosPorLado(kg, comp, barra = 25) {
  const platos = comp?.platos;
  if (!platos?.length || !(kg > 0)) return null;
  let lado = (kg - (Number(barra) || 0)) / 2;
  if (lado < 0) return null;
  const discos = [];
  for (const p of [...platos].sort((x, y) => y.kg - x.kg)) {
    let n = Math.min(p.pares, Math.floor(lado / p.kg + 1e-9));
    while (n-- > 0) { discos.push({ kg: p.kg, color: p.color }); lado = Math.round((lado - p.kg) * 1e4) / 1e4; }
  }
  return { discos, falta: lado > 1e-6 ? Math.round(lado * 1e4) / 1e4 : 0 };
}

const plano = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z ]/gi, '').toLowerCase().trim();

/**
 * Lo que interesa ver de la competencia: quién está en tarima y, para cada nombre
 * buscado, sus intentos y cuántos intentos faltan para que salga.
 * docs: { _id: doc } tal como vienen de CouchDB.
 */
export function resumen(docs, nombres = [], { segPorIntento = {} } = {}) {
  const todos = Object.values(docs);
  const lifters = Object.fromEntries(todos.filter(d => d._id?.[0] === 'l').map(d => [d._id, d]));
  const intentos = todos.filter(d => d._id?.[0] === 'a' && lifters[d.lifterId]);
  const plataformas = todos.filter(d => d._id?.[0] === 'p');
  const porId = Object.fromEntries(intentos.map(a => [a._id, a]));

  // Orden de LiftingCast: sesión, movimiento, flight, intento, fin de ronda, kilos, lote.
  const clave = a => {
    const l = lifters[a.lifterId];
    return [l.session ?? 99, ORDEN[a.liftName] ?? 9, l.flight || 'Z', Number(a.attemptNumber) || 9, a.endOfRound ? 1 : 0, Number(a.weight) || 9999, l.lot ?? 9999];
  };
  const cmp = (x, y) => { const a = clave(x), b = clave(y); for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1; return 0; };

  const meet = todos.find(d => d.plates);
  const competencia = meet ? {
    federacion: meet.federation || null,
    platos: Object.values(meet.plates).filter(p => p?.pairsCount > 0 && p.weight > 0).map(p => ({ kg: Number(p.weight), pares: Number(p.pairsCount), color: p.color || null })),
  } : null;
  const rackDe = l => ({ sq: l?.squatRackHeight ? String(l.squatRackHeight) : null, bp: l?.benchRackHeight ? String(l.benchRackHeight) : null });

  const enTarima = plataformas.map(p => {
    const a = porId[p.currentAttemptId];
    const l = a && lifters[a.lifterId];
    return {
      plataforma: p.name, intento: a ? { nombre: l.name, lev: LEV[a.liftName], n: Number(a.attemptNumber), kg: Number(a.weight) || null } : null, reloj: p.clockState || null,
      relojMs: Number(p.clockTimerLength) || null, barra: Number(p.barAndCollarsWeight) || null,
      rack: l ? rackDe(l) : null, luces: lucesDe(docs, p._id),
    };
  });

  // Cola por plataforma: lo que queda sin resultado, en orden, desde el intento en curso.
  const cola = {};
  for (const p of plataformas) {
    cola[p._id] = intentos.filter(a => lifters[a.lifterId].platformId === p._id && !a.result).sort(cmp);
    const i = cola[p._id].findIndex(a => a._id === p.currentAttemptId);
    if (i > 0) cola[p._id] = cola[p._id].slice(i);
  }

  // Los próximos en salir de la plataforma activa (reloj corriendo, o la primera con intento en curso).
  const activa = plataformas.find(p => p.clockState === 'started' && porId[p.currentAttemptId]) || plataformas.find(p => porId[p.currentAttemptId]);
  const siguientes = activa ? [...new Set((cola[activa._id] || []).map(a => lifters[a.lifterId].name))] : [];

  // Grupos (sesión, movimiento, flight) de cada plataforma en orden de salida, para saber si el vuelo de alguien ya corre.
  const grupo = a => { const l = lifters[a.lifterId]; return `${l.session ?? 99}|${ORDEN[a.liftName] ?? 9}|${l.flight || 'Z'}`; };
  const grupos = {};
  for (const a of [...intentos].sort(cmp)) {
    const g = (grupos[lifters[a.lifterId].platformId] ||= []);
    if (g.at(-1) !== grupo(a)) g.push(grupo(a));
  }

  const buscados = nombres.map(plano).filter(Boolean);
  const atletas = Object.values(lifters)
    .filter(l => buscados.some(n => plano(l.name) === n))
    .map(l => {
      const suyos = intentos.filter(a => a.lifterId === l._id);
      const lev = Object.fromEntries(Object.entries(LEV).map(([nom, k]) => [k, [1, 2, 3].map(n => {
        const a = suyos.find(x => x.liftName === nom && Number(x.attemptNumber) === n);
        return {
          kg: Number(a?.weight) || null, r: a?.result === 'good' ? 1 : a?.result === 'bad' ? -1 : 0,
          jueces: a?.decisions ? juecesDe(a) : null, jurado: !!(a?.juryOverride || a?.preJuryOverturnDecisions),
        };
      })]));
      // Solo se cuenta la cola si su sesión es la que está en tarima; si no, «aún no empieza».
      const actual = porId[plataformas.find(p => p._id === l.platformId)?.currentAttemptId];
      const enCurso = actual && lifters[actual.lifterId].session === l.session;
      const q = enCurso ? cola[l.platformId] || [] : [];
      const pos = q.findIndex(a => a.lifterId === l._id);
      const sig = pos >= 0 ? q[pos] : suyos.filter(a => !a.result).sort(cmp)[0];
      // En vivo si su próximo intento es del grupo que está en tarima o del que sigue (A en sentadilla → B ya cuenta).
      const orden = grupos[l.platformId] || [];
      const d = actual && sig ? orden.indexOf(grupo(sig)) - orden.indexOf(grupo(actual)) : -1;
      return {
        vuelo: d === 0 ? 'ahora' : d === 1 ? 'siguiente' : null,
        nombre: l.name, sesion: l.session ?? null, flight: l.flight || null, peso: Number(l.bodyWeight) || null, lev,
        espera: !enCurso,
        faltan: pos < 0 ? null : pos,             // 0 = está en tarima ahora
        estimadoSeg: pos < 0 ? null : pos * (segPorIntento[l.platformId] || 60),
        rack: rackDe(l), plataforma: plataformas.find(p => p._id === l.platformId)?.name ?? null,
        siguiente: sig ? { lev: LEV[sig.liftName], n: Number(sig.attemptNumber), kg: Number(sig.weight) || null } : null,
      };
    });
  return { enTarima, atletas, siguientes, competencia };
}

/** El vuelo ('ahora' | 'siguiente' | null) de un nombre dentro de un resumen. */
export const vueloDe = (r, nombre) => r?.atletas.find(a => plano(a.nombre) === plano(nombre))?.vuelo || null;

/**
 * Lee la competencia y la escucha. alCambiar(resumen) en cada cambio; devuelve la función para cortar.
 * Si la red falla, reintenta a los 5 s sin perder lo que ya tenía.
 */
export function conectar(meetId, nombres, alCambiar, { fetchFn = fetch } = {}) {
  // nombres = número n: los n próximos en salir al conectar (sala de ejemplo); se quedan fijos.
  let buscar = Array.isArray(nombres) ? nombres : null;
  const db = `${BASE}${meetId}_readonly`;
  const docs = {};
  const corte = new AbortController();
  let vivo = true;
  const espera = ms => new Promise(r => setTimeout(r, ms));
  // Ritmo real por plataforma: segundos entre un intento en tarima y el siguiente (promedio de los últimos 8).
  const visto = {}, ritmo = {}, ultimos = {};
  const medir = () => {
    for (const d of Object.values(docs)) {
      if (d._id?.[0] !== 'p' || !d.currentAttemptId) continue;
      const v = visto[d._id], t = Date.now();
      if (v && v.id !== d.currentAttemptId) {
        const seg = (t - v.t) / 1000;
        if (seg >= 10 && seg <= 900) { const xs = (ultimos[d._id] ||= []); xs.push(seg); if (xs.length > 8) xs.shift(); ritmo[d._id] = xs.reduce((s, x) => s + x, 0) / xs.length; }
      }
      if (!v || v.id !== d.currentAttemptId) visto[d._id] = { id: d.currentAttemptId, t };
    }
  };
  (async () => {
    let seq = null;
    while (vivo) {
      try {
        if (seq === null) {
          const j = await (await fetchFn(`${db}/_all_docs?include_docs=true&update_seq=true`, { signal: corte.signal })).json();
          j.rows.forEach(r => { if (r.doc) docs[r.id] = r.doc; });
          seq = j.update_seq;
        } else {
          const j = await (await fetchFn(`${db}/_changes?feed=longpoll&include_docs=true&timeout=25000&since=${encodeURIComponent(seq)}`, { signal: corte.signal })).json();
          j.results.forEach(r => { if (r.deleted) delete docs[r.id]; else if (r.doc) docs[r.id] = r.doc; });
          seq = j.last_seq;
          if (!j.results.length) continue;
        }
        medir();
        buscar ||= resumen(docs, []).siguientes.slice(0, Number(nombres) || 3);
        alCambiar(resumen(docs, buscar, { segPorIntento: ritmo }));
      } catch (e) {
        if (!vivo) return;
        console.warn('[liftingcast]', e.message);
        await espera(5000);
      }
    }
  })();
  return () => { vivo = false; corte.abort(); };
}
