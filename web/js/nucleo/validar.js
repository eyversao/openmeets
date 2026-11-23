// OpenMeets · validación de meets y atletas. Pura (sin node: ni DOM): la usan el servidor local y la versión en la nube (navegador).
export const LIMITES = { normal: 256 * 1024, canal: 64 * 1024, lote: 1024 * 1024, importar: 8 * 1024 * 1024 };
export const MAX_ATLETAS = 1000;
export const LEVS = ['S', 'B', 'D'];
export const NOMBRE_LEV = { S: 'sentadilla', B: 'banca', D: 'peso muerto' };
export const POS = ['izq', 'cen', 'der'];
const NIVELES_REC = ['mundial', 'nacional', 'ibero', 'regional', 'otro']; // igual que web/js/nucleo/competencia.js
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export const ID_SEGURO = /^[a-z0-9][a-z0-9-]{0,59}$/;
export const idSeguro = id => typeof id === 'string' && ID_SEGURO.test(id);

export class ErrorApi extends Error { constructor(estado, mensaje) { super(mensaje); this.estado = estado; } }
export const mal = (estado, mensaje) => { throw new ErrorApi(estado, mensaje); };

/** n bytes aleatorios en hexadecimal (crypto global: Node 20+ y navegadores). */
export const hexAleatorio = n => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(n)), b => b.toString(16).padStart(2, '0')).join('');
/** Entero uniforme en [0, max) sin sesgo de módulo. */
export function enteroAleatorio(max) {
  const tope = Math.floor(0x100000000 / max) * max;
  const u = new Uint32Array(1);
  do globalThis.crypto.getRandomValues(u); while (u[0] >= tope);
  return u[0] % max;
}

/* ---------- Validación ---------- */
export const txt = (x, max) => (typeof x === 'string' ? x.trim().slice(0, max) : '');
export const num = (x, min, max, def = null) => { const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x; return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? n : def; };
export const fecha = x => (typeof x === 'string' && FECHA.test(x) ? x : '');
export const objeto = x => !!x && typeof x === 'object' && !Array.isArray(x);
export const url = x => { const t = txt(x, 300); return /^https?:\/\//i.test(t) ? t : ''; };

export function limpiarIntento(i) {
  if (!objeto(i)) return { kg: null, r: null, rec: false, alFinal: false };
  const o = { kg: num(i.kg, 0, 1000), r: i.r === 1 || i.r === -1 ? i.r : null, rec: i.rec === true || NIVELES_REC.includes(i.rec) ? i.rec : false, alFinal: !!i.alFinal };
  if (o.rec === 'otro' && txt(i.recTexto, 40)) o.recTexto = txt(i.recTexto, 40);
  if (i.cambios !== undefined) o.cambios = num(i.cambios, 0, 99, 0);
  if (Array.isArray(i.historial)) o.historial = i.historial.slice(-30).filter(objeto).map(h => ({ ts: num(h.ts, 0, 9e15, 0), de: h.de ?? null, a: h.a ?? null, motivo: txt(h.motivo, 120), por: txt(h.por, 60) }));
  return o;
}

export function limpiarAtleta(a, id) {
  if (!objeto(a)) mal(400, 'Atleta no válido');
  const aid = id || a.id;
  if (!idSeguro(aid)) mal(400, 'El identificador del atleta solo puede llevar a-z, 0-9 y guiones');
  const intentos = {};
  for (const l of LEVS) intentos[l] = (Array.isArray(a.intentos?.[l]) ? a.intentos[l] : []).slice(0, 4).map(limpiarIntento);
  const o = {
    id: aid, nombre: txt(a.nombre, 80), sexo: a.sexo === 'F' ? 'F' : 'M', nacimiento: fecha(a.nacimiento) || null, club: txt(a.club, 80),
    division: txt(a.division, 40) || 'Open', equipamiento: a.equipamiento === 'equipado' ? 'equipado' : 'raw', peso: num(a.peso, 0, 500),
    clase: txt(a.clase, 12), plataforma: txt(a.plataforma, 40), sesion: txt(String(a.sesion ?? ''), 20), grupo: txt(String(a.grupo ?? ''), 20),
    lote: num(a.lote, 0, 9999), rack: { S: num(a.rack?.S, 0, 99), B: num(a.rack?.B, 0, 99) }, intentos,
  };
  if (Array.isArray(a.levantes)) o.levantes = a.levantes.filter(l => LEVS.includes(l));
  if (a.pais !== undefined) o.pais = txt(a.pais, 60);
  if (idSeguro(a.atletaId)) o.atletaId = a.atletaId; // ficha de atleta estable entre meets (perfiles)
  if (a.notas !== undefined) o.notas = txt(a.notas, 500);
  if (objeto(a.pesaje)) o.pesaje = { hora: num(a.pesaje.hora, 0, 9e15, 0), por: txt(a.pesaje.por, 60), equipo: !!a.pesaje.equipo, licencia: !!a.pesaje.licencia }; // modo pesaje
  return o;
}

/** Campos editables del meet. Con `parcial` solo devuelve los que vienen en el cuerpo. */
export function limpiarCampos(b, parcial = true) {
  if (!objeto(b)) mal(400, 'Cuerpo no válido');
  const o = {};
  const tiene = k => b[k] !== undefined;
  const poner = (k, f) => { if (tiene(k)) o[k] = f(b[k]); };
  poner('nombre', v => { const t = txt(v, 120); if (!t) mal(400, 'El meet necesita un nombre'); return t; });
  poner('fecha', v => (v === '' || v === null ? '' : fecha(v) || mal(400, 'La fecha debe ser AAAA-MM-DD')));
  poner('fechaFin', v => (v === '' || v === null ? '' : fecha(v) || mal(400, 'La fecha final debe ser AAAA-MM-DD')));
  for (const [k, m] of [['sede', 120], ['ciudad', 80], ['pais', 80], ['organizador', 120], ['descripcion', 2000], ['federacion', 60]]) poner(k, v => txt(v, m));
  poner('stream', url);
  poner('modo', v => (v === 'otra' ? 'otra' : 'IPF'));
  poner('aprobacion', v => (['abierta', 'mesa', 'codigo'].includes(v) ? v : 'mesa'));
  poner('unidades', () => 'kg');
  poner('formula', v => (['GL', 'DOTS', 'Wilks', 'IPF'].includes(v) ? v : 'GL'));
  poner('barra', v => num(v, 5, 50, 20));
  poner('barraSentadilla', v => num(v, 5, 50));
  poner('collar', v => num(v, 0, 10, 2.5));
  poner('discos', v => (Array.isArray(v) ? v.slice(0, 20).filter(objeto).map(d => ({ kg: num(d.kg, 0.05, 50, 0), pares: num(d.pares, 0, 50, 0), color: txt(d.color, 20) })) : []));
  poner('relojes', v => (Array.isArray(v) ? v.slice(0, 4).map(n => num(n, 1, 3600)).filter(n => n !== null) : [60, 180]));
  poner('pararAlVotar', v => !!v);
  poner('plataformas', v => { const l = (Array.isArray(v) ? v : []).slice(0, 12).map(p => txt(p, 40)).filter(Boolean); return l.length ? l : ['Tarima 1']; });
  poner('publico', v => !!v);
  poner('cerrado', v => !!v);
  poner('hud', v => { if (!objeto(v) || JSON.stringify(v).length > 8000) mal(400, 'Ajustes de pantalla no válidos'); return v; });
  const cj = b.privado?.codigoJuez ?? b.codigoJuez;
  if (cj !== undefined) { const c = txt(String(cj), 40); if (!c) mal(400, 'El código de jueces no puede estar vacío'); o.privado = { codigoJuez: c }; }
  if (!parcial && !o.nombre) mal(400, 'El meet necesita un nombre');
  return o;
}

const slug = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'meet';
export const idNuevo = nombre => `${slug(nombre)}-${hexAleatorio(3)}`;
export const codigoNuevo = () => String(enteroAleatorio(1000000)).padStart(6, '0');

export function meetNuevo(body, existe = () => false) {
  const c = limpiarCampos(body, false);
  let id = idSeguro(body.id) ? body.id : idNuevo(c.nombre);
  while (existe(id)) id = idNuevo(c.nombre);
  const ahora = Date.now();
  return {
    id, fecha: '', fechaFin: '', sede: '', ciudad: '', pais: '', organizador: '', descripcion: '', stream: '', federacion: '', modo: 'IPF',
    aprobacion: 'mesa', unidades: 'kg', formula: 'GL', barra: 20, collar: 2.5, discos: [], relojes: [60, 180], pararAlVotar: true,
    plataformas: ['Tarima 1'], publico: true, cerrado: false, hud: {},
    ...c, atletas: [], vivo: {}, aplausos: {}, actividad: [],
    privado: { codigoJuez: c.privado?.codigoJuez || codigoNuevo(), juecesConocidos: {} }, creado: ahora, actualizado: ahora,
  };
}

/** Restaurar una copia: pasa todo por los mismos filtros. */
export function meetImportado(raw) {
  const r = objeto(raw?.meet) ? raw.meet : raw;
  if (!objeto(r) || !idSeguro(r.id)) mal(400, 'La copia no es un meet de OpenMeets');
  const m = meetNuevo({ ...r, id: r.id });
  m.id = r.id;
  m.atletas = (Array.isArray(r.atletas) ? r.atletas : []).slice(0, MAX_ATLETAS).map(a => limpiarAtleta(a));
  if (objeto(r.vivo)) for (const [p, v] of Object.entries(r.vivo).slice(0, 12)) if (objeto(v)) m.vivo[txt(p, 40)] = v;
  if (objeto(r.aplausos)) for (const [k, n] of Object.entries(r.aplausos)) if (idSeguro(k)) m.aplausos[k] = num(n, 0, 1e9, 0);
  if (Array.isArray(r.actividad)) m.actividad = r.actividad.slice(-500).filter(objeto).map(x => ({ ts: num(x.ts, 0, 9e15, 0), texto: txt(x.texto, 300) }));
  if (objeto(r.privado?.juecesConocidos)) m.privado.juecesConocidos = r.privado.juecesConocidos;
  m.creado = num(r.creado, 0, 9e15, m.creado);
  return m;
}

export const sinPrivado = ({ privado, dueno, ...resto }) => resto; // dueno = uid de la cuenta (modo cuentas): nunca sale al público

export function anotar(m, texto) { (m.actividad ||= []).push({ ts: Date.now(), texto: txt(texto, 300) }); if (m.actividad.length > 500) m.actividad.splice(0, m.actividad.length - 500); }

const ESCENAS_REGIE = ['atleta', 'siguientes', 'clasif', 'podio', 'mejor', 'record', 'pausa', 'patro', 'oculto']; // igual que web/js/nucleo/regie.js
const LOGO = /^(data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+|https?:\/\/\S+)$/i;
/** Estado de la regie del HUD: solo campos conocidos y logos como data URL pequeña o URL http(s). */
export function limpiarRegie(d) {
  const logos = (Array.isArray(d.patro?.logos) ? d.patro.logos : []).filter(l => typeof l === 'string' && l.length <= 40000 && LOGO.test(l)).slice(0, 8);
  return {
    modo: d.modo === 'manual' ? 'manual' : 'auto',
    escena: ESCENAS_REGIE.includes(d.escena) ? d.escena : '',
    cat: txt(d.cat, 120), texto: txt(d.texto, 200),
    dur: num(d.dur, 0, 600, 0),
    patro: { logos, seg: num(d.patro?.seg, 3, 60, 8) },
    v: num(d.v, 0, 9e15, Date.now()),
  };
}

/** Textos de actividad por cada intento que pasa a válido o nulo. */
export function cambiosDeResultados(prev, nuevo) {
  const out = [];
  for (const l of LEVS) {
    (nuevo.intentos[l] || []).forEach((i, n) => {
      const antes = prev?.intentos?.[l]?.[n];
      if (i.r !== null && i.r !== (antes?.r ?? null)) out.push(`${nuevo.nombre}: ${NOMBRE_LEV[l]} ${n + 1} · ${i.kg ?? '?'} kg · ${i.r === 1 ? 'válido' : 'nulo'}`);
    });
  }
  return out;
}

/** Voto de un juez ya filtrado (misma regla que el servidor). El código se comprueba aparte. */
export function limpiarVoto(v) {
  if (!objeto(v) || typeof v.plataforma !== 'string' || !POS.includes(v.pos) || !['blanca', 'roja'].includes(v.voto)) mal(400, 'Voto no válido');
  const tarjetas = Array.isArray(v.tarjetas) ? v.tarjetas.filter(t => ['roja', 'azul', 'amarilla'].includes(t)).slice(0, 3) : [];
  return { plataforma: txt(v.plataforma, 40), pos: v.pos, voto: v.voto, tarjetas, turno: typeof v.turno === 'string' ? v.turno.slice(0, 80) : null, via: txt(String(v.via || 'local'), 20), dispositivo: txt(v.dispositivo, 40), secreto: txt(v.secreto, 80), ts: num(v.ts, 0, 9e15, Date.now()) };
}

export function limpiarPresencia(d) {
  if (!objeto(d) || typeof d.plataforma !== 'string' || !POS.includes(d.pos)) mal(400, 'Presencia no válida');
  return { plataforma: txt(d.plataforma, 40), pos: d.pos, bateria: num(d.bateria, 0, 100), via: txt(String(d.via || 'local'), 20), dispositivo: txt(d.dispositivo, 40), nombre: txt(d.nombre, 60), huella: txt(d.huella, 80), ts: Date.now() };
}
