// OpenMeets · reglas de las inscripciones que comparten el servidor local y la versión en la nube. Puras.
import { txt as _txt, num as _num, url as _url, objeto as _objeto, fecha, mal as _mal, limpiarAtleta, enteroAleatorio, hexAleatorio } from './validar.js';
import { divisionesDe } from './federaciones.js';
import { estadoApertura, categoriaPropuesta, PREGUNTA_TIPOS } from './inscripcion.js';

export const MAX_INSCRITOS = 1500;
const CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L
const CIERRE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const CORREO = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const contactoValido = c => CORREO.test(c) || (/^\+?[\d\s().-]{7,20}$/.test(c) && c.replace(/\D/g, '').length >= 7);

/** Valida y completa la configuración que escribe el organizador. Lo que no cabe se rechaza con un mensaje claro. */
export function limpiarConfig(b, { txt = _txt, num = _num, url = _url, objeto = _objeto, mal = _mal } = {}) {
  if (!objeto(b)) mal(400, 'Configuración no válida');
  const cierre = typeof b.cierre === 'string' ? b.cierre.trim() : '';
  if (cierre && (!CIERRE.test(cierre) || Number.isNaN(new Date(cierre).getTime()))) mal(400, 'El cierre debe tener fecha y hora válidas');
  const lista = (v, max, largo) => (Array.isArray(v) ? [...new Set(v.slice(0, max).map(x => txt(x, largo)).filter(Boolean))] : []);
  const precio = b.precio === '' || b.precio === null || b.precio === undefined ? 0 : num(b.precio, 0, 1e9, null);
  if (precio === null) mal(400, 'El precio debe ser un número entre 0 y 1.000.000.000');
  const pago = txt(b.pagoUrl, 300);
  if (pago && !url(pago)) mal(400, 'El enlace de pago debe empezar por http:// o https://');
  const reg = txt(b.reglamentoUrl, 300);
  if (reg && !url(reg)) mal(400, 'El enlace del reglamento debe empezar por http:// o https://');
  const cupoTotal = b.cupoTotal === '' || b.cupoTotal == null ? null : num(b.cupoTotal, 1, MAX_INSCRITOS, NaN);
  const cupoCategoria = b.cupoCategoria === '' || b.cupoCategoria == null ? null : num(b.cupoCategoria, 1, MAX_INSCRITOS, NaN);
  if (Number.isNaN(cupoTotal) || Number.isNaN(cupoCategoria)) mal(400, `Los cupos deben ser números entre 1 y ${MAX_INSCRITOS} (o déjalos vacíos)`);
  const preguntas = (Array.isArray(b.preguntas) ? b.preguntas : []).slice(0, 8).filter(objeto).map((p, i) => ({
    id: `p${i + 1}`, texto: txt(p.texto, 120), tipo: PREGUNTA_TIPOS.includes(p.tipo) ? p.tipo : 'texto', obligatoria: !!p.obligatoria,
  })).filter(p => p.texto);
  const equipamiento = lista(b.equipamiento, 2, 10).filter(e => e === 'raw' || e === 'equipado');
  return {
    abiertas: !!b.abiertas, cierre, cupoTotal, cupoCategoria,
    divisiones: lista(b.divisiones, 30, 40), clases: lista(b.clases, 40, 12), equipamiento: equipamiento.length ? equipamiento : ['raw', 'equipado'],
    precio, moneda: txt(b.moneda, 5).toUpperCase() || 'COP', pagoUrl: pago, reglamentoUrl: reg, instrucciones: txt(b.instrucciones, 1000), preguntas,
  };
}

/** Valida el formulario público contra la configuración del meet. Devuelve los campos del inscrito (sin id, código ni estado). */
export function validarInscripcion(m, b, { txt = _txt, num = _num, objeto = _objeto, mal = _mal } = {}) {
  const cfg = m.inscripciones;
  const ap = estadoApertura(cfg);
  if (!ap.abierta) mal(409, ap.motivo === 'cierre' ? 'Las inscripciones de este meet ya cerraron.' : 'Las inscripciones de este meet no están abiertas.');
  if (!objeto(b)) mal(400, 'Cuerpo no válido');
  const nombre = txt(b.nombre, 80).replace(/\s+/g, ' ');
  if (nombre.length < 3 || !nombre.includes(' ')) mal(400, 'Escribe tu nombre y apellido.');
  if (b.sexo !== 'M' && b.sexo !== 'F') mal(400, 'Elige tu sexo (hombre o mujer).');
  const nacimiento = fecha(b.nacimiento);
  const anio = Number(nacimiento.slice(0, 4)); if (nacimiento && Number.isNaN(new Date(nacimiento).getTime())) mal(400, 'Escribe una fecha de nacimiento válida.');
  if (!nacimiento || new Date(nacimiento).toISOString().slice(0, 10) !== nacimiento || anio < 1920 || nacimiento > new Date().toISOString().slice(0, 10)) mal(400, 'Escribe una fecha de nacimiento válida.');
  const fed = m.federacion || 'IPF';
  const permitidas = divisionesDe(fed).map(d => d.nombre).filter(d => !cfg.divisiones?.length || cfg.divisiones.includes(d));
  const division = txt(b.division, 40);
  if (!permitidas.includes(division)) mal(400, 'Elige una de las divisiones disponibles.');
  const equipamiento = b.equipamiento === 'equipado' ? 'equipado' : b.equipamiento === 'raw' ? 'raw' : '';
  if (!equipamiento || !(cfg.equipamiento || ['raw', 'equipado']).includes(equipamiento)) mal(400, 'Elige un equipamiento de los que acepta el meet.');
  const peso = num(b.pesoEstimado, 20, 300, null);
  if (peso === null) mal(400, 'Escribe tu peso estimado en kg (entre 20 y 300).');
  const clase = categoriaPropuesta(fed, b.sexo, peso, division);
  if (cfg.clases?.length && !cfg.clases.includes(clase)) mal(400, `Con ese peso tu categoría sería ${clase} kg y este meet no la admite.`);
  const contacto = txt(b.contacto, 80);
  if (!contactoValido(contacto)) mal(400, 'Escribe un correo o un teléfono para contactarte.');
  if (b.acepto !== true) mal(400, 'Debes aceptar el reglamento para inscribirte.');
  const aperturas = {};
  for (const l of ['S', 'B', 'D']) { const v = b.aperturas?.[l]; if (v === '' || v == null) continue; const n = num(v, 1, 600, null); if (n === null) mal(400, 'Las marcas o aperturas deben ser números entre 1 y 600 kg.'); aperturas[l] = n; }
  const respuestas = (cfg.preguntas || []).map(p => {
    const v = txt(b.respuestas?.[p.id], 200);
    if (p.tipo === 'si-no' && v && v !== 'si' && v !== 'no') mal(400, `Responde «sí» o «no» en: ${p.texto}`);
    if (p.obligatoria && !v) mal(400, `Falta responder: ${p.texto}`);
    return { id: p.id, texto: p.texto, valor: v };
  }).filter(r => r.valor);
  return { nombre, sexo: b.sexo, nacimiento, club: txt(b.club, 80), division, equipamiento, pesoEstimado: peso, clase, aperturas, contacto, respuestas };
}

export const MENSAJE_DUPLICADO = 'Ya hay una inscripción con ese nombre y fecha de nacimiento. Si es tuya, pregunta al organizador por tu código.';

/** Código de 6 caracteres para que el inscrito consulte su alta. `usado(c)` evita repetidos. */
export function codigoInscripcion(usado = () => false) {
  let c;
  do c = Array.from({ length: 6 }, () => CODIGO[enteroAleatorio(CODIGO.length)]).join(''); while (usado(c));
  return c;
}

export const idInscripcion = () => `in-${hexAleatorio(4)}`;

/** Inscripción nueva (sin guardar). */
export function itemNuevo(campos, estado, codigo, ahora = Date.now()) {
  return { id: idInscripcion(), codigo, estado, pagado: false, ...campos, nota: '', aid: null, creado: ahora, ts: ahora };
}

/** Atleta que entra al meet al confirmar la inscripción (aperturas estimadas como primer intento). */
export function atletaDeInscripcion(item, m, lote, aid = `at-${hexAleatorio(4)}`) {
  const intentos = Object.fromEntries(['S', 'B', 'D'].map(l => [l, [{ kg: item.aperturas?.[l] ?? null }, {}, {}]]));
  return limpiarAtleta({ id: aid, nombre: item.nombre, sexo: item.sexo, nacimiento: item.nacimiento, club: item.club, division: item.division, equipamiento: item.equipamiento, peso: item.pesoEstimado, clase: item.clase, plataforma: m.plataformas?.[0] || 'Tarima 1', sesion: '1', grupo: 'A', lote, intentos }, aid);
}
