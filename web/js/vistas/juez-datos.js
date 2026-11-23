/* ============================================================
   OPENMEETS — Datos del teléfono del juez (puro, sin DOM)
   Enlace:  /juez/<id>?t=<plataforma>&p=<izq|cen|der>&c=<código de jueces>
   ============================================================ */

import * as C from '../nucleo/competencia.js';
import * as A from '../nucleo/jueces-acceso.js';
import { momentoTarima } from './pantalla-datos.js';

const POS = C.POSICIONES.map(([p]) => p);
export const NOMBRE_JUEZ = { izq: 'Juez izquierdo', cen: 'Juez principal', der: 'Juez derecho' };

/** Lee t, p y c de la consulta; `valido` solo si los tres están y la posición existe. */
export function parametrosJuez(consulta) {
  const q = consulta instanceof URLSearchParams ? consulta : new URLSearchParams(consulta || '');
  const plataforma = (q.get('t') || '').trim(), pos = q.get('p') || '', codigo = (q.get('c') || '').trim();
  return { plataforma, pos, codigo, valido: !!plataforma && POS.includes(pos) && !!codigo };
}

export const enlaceJuez = (origen, id, plataforma, pos, codigo) => `${String(origen).replace(/\/+$/, '')}/juez/${encodeURIComponent(id)}?t=${encodeURIComponent(plataforma)}&p=${pos}&c=${encodeURIComponent(codigo)}`;

/** Botones según el modo: IPF tiene tarjetas; en otra federación, solo válido y nulo. */
export const botonesJuez = modo => (modo === 'IPF'
  ? [{ id: 'blanca', texto: 'VÁLIDO' }, { id: 'roja', texto: 'ROJA' }, { id: 'azul', texto: 'AZUL' }, { id: 'amarilla', texto: 'AMARILLA' }]
  : [{ id: 'blanca', texto: 'VÁLIDO' }, { id: 'roja', texto: 'NULO' }]);

/** El voto que viaja: roja/azul/amarilla son nulo; en IPF llevan su tarjeta. */
export function armarVoto({ plataforma, pos, codigo, turno, boton, modo, ident, via = 'local', ts = Date.now() }) {
  const nulo = boton !== 'blanca';
  return { plataforma, pos, voto: nulo ? 'roja' : 'blanca', tarjetas: nulo && modo === 'IPF' ? [boton] : [], codigo, turno, ts, via, dispositivo: ident.dispositivo, secreto: ident.secreto };
}

/** Qué le decimos al juez según lo que devolvió canal.enviarVoto: { estado: 'enviado'|'cola'|'fallo', texto }. */
export function resumenEnvio(r) {
  if (r?.ok) return { estado: 'enviado', texto: 'Enviado' };
  if (r?.enCola) return { estado: 'cola', texto: 'En cola: se enviará al volver la red' };
  return { estado: 'fallo', texto: r?.estado === 403 ? 'No llegó: el código del enlace no es válido' : 'No llegó' };
}

/** Acceso del teléfono: modo (el del vivo manda), estado y si hay que enseñar su código de 6 dígitos. */
export function accesoJuez(vivo, meet, huellaCorta) {
  const modo = ['abierta', 'mesa', 'codigo'].includes(vivo?.aprobacion) ? vivo.aprobacion : A.modoAprobacion(meet);
  const estado = huellaCorta ? A.estadoAcceso({ ...(vivo || {}), aprobacion: modo }, meet, huellaCorta) : (modo === 'abierta' ? 'abierta' : 'espera');
  return { modo, estado, puede: A.puedeVotar(estado), mostrarCodigo: modo === 'codigo' && estado !== 'ok' && estado !== 'abierta' };
}

/* ---------- Pico y final: cuántos intentos juzgó este teléfono y cuándo cerrar ---------- */

const claveVotos = id => `openmeets.juez.votos.${id}`;
const almacenJuez = () => { try { return globalThis.localStorage || null; } catch { return null; } };

/** Turnos que votó este teléfono en este meet (guardados en localStorage). */
export function votosJuzgados(id, almacen = almacenJuez()) {
  try { const a = JSON.parse(almacen?.getItem(claveVotos(id)) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

/** Anota (o quita, con `quitar`) el turno de un voto y devuelve cuántos intentos lleva juzgados. */
export function anotarVoto(id, turno, { quitar = false, almacen = almacenJuez() } = {}) {
  const lista = votosJuzgados(id, almacen);
  if (!turno) return lista.length;
  const i = lista.indexOf(turno);
  if (quitar ? i >= 0 : i < 0) { if (quitar) lista.splice(i, 1); else lista.push(turno); try { almacen?.setItem(claveVotos(id), JSON.stringify(lista.slice(-2000))); } catch { /* sin almacenamiento: el conteo de esta sesión se pierde */ } }
  return lista.length;
}

/** Cierre de la sesión del juez: null mientras se compite; { tipo: 'grupo'|'meet', grupo, clave } al terminar el grupo o el meet. */
export function cierreJuez(meet, vivo, plataforma) {
  const m = momentoTarima(meet, vivo, plataforma);
  if (m.tipo === 'meet') return { tipo: 'meet', grupo: '', clave: 'meet' };
  if (m.tipo === 'grupo') return { tipo: 'grupo', grupo: m.grupo, clave: `${vivo?.sesion || ''}|${m.grupo}` };
  return null;
}
