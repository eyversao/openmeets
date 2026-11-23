// OpenMeets · quién es organizador: loopback, o PIN de 6 dígitos con cookie de sesión HttpOnly.
import { randomBytes, randomInt, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';

export const COOKIE = 'om_sesion';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const esLoopback = ip => LOOPBACK.has(ip);

/** Igualdad en tiempo constante (compara hashes del mismo largo). */
export function iguales(a, b) {
  const h = x => createHash('sha256').update(String(x)).digest();
  return timingSafeEqual(h(a), h(b));
}
export const pinValido = pin => typeof pin === 'string' && /^\d{6}$/.test(pin);
export const pinAleatorio = () => String(randomInt(0, 1000000)).padStart(6, '0');

export function leerCookies(cabecera = '') {
  const o = {};
  for (const par of String(cabecera).split(';')) {
    const i = par.indexOf('=');
    if (i > 0) o[par.slice(0, i).trim()] = par.slice(i + 1).trim();
  }
  return o;
}

/** Decisión pura: ¿organizador o no? (sin sockets, para poder probarla). */
export function decidirRol({ ip, cookie }, sesiones) {
  if (esLoopback(ip)) return 'organizador';
  return cookie && sesiones.has(cookie) ? 'organizador' : 'publico';
}

/** Límite de intentos por clave dentro de una ventana (5 por minuto por defecto). */
export function crearLimitador({ max = 5, ventana = 60000, ahora = Date.now } = {}) {
  const m = new Map();
  return {
    /** Registra un intento; devuelve false si se pasó del límite. */
    intentar(clave) {
      const t = ahora();
      const lista = (m.get(clave) || []).filter(x => t - x < ventana);
      if (lista.length >= max) { m.set(clave, lista); return false; }
      lista.push(t); m.set(clave, lista);
      if (m.size > 5000) for (const [k, v] of m) if (!v.some(x => t - x < ventana)) m.delete(k);
      return true;
    },
    reiniciar(clave) { m.delete(clave); },
  };
}

export function crearAcceso(dir, { ahora = Date.now } = {}) {
  mkdirSync(dir, { recursive: true });
  const archivo = join(dir, 'config.json');
  let config = {};
  try { config = JSON.parse(readFileSync(archivo, 'utf8')) || {}; } catch { config = {}; }
  const guardar = () => writeFileSync(archivo, JSON.stringify(config, null, 2));
  if (!pinValido(config.pin)) { config.pin = pinAleatorio(); guardar(); }
  const sesiones = new Set();
  const limite = crearLimitador({ max: 5, ventana: 60000, ahora });

  return {
    get pin() { return config.pin; },
    sesiones,
    cambiarPin(nuevo) {
      const pin = nuevo === undefined || nuevo === null || nuevo === '' ? pinAleatorio() : nuevo;
      if (!pinValido(pin)) throw Object.assign(new Error('El PIN debe tener 6 dígitos'), { estado: 400 });
      config.pin = pin; guardar(); sesiones.clear();
      return pin;
    },
    /** Comprueba el PIN. `ip` limita a 5 intentos por minuto. Devuelve { ok, limitado, token }. */
    iniciarSesion(ip, pin) {
      if (!limite.intentar(`pin|${ip}`)) return { ok: false, limitado: true };
      if (typeof pin !== 'string' || !iguales(pin, config.pin)) return { ok: false };
      const token = randomBytes(24).toString('hex');
      sesiones.add(token);
      return { ok: true, token };
    },
    cerrarSesion(token) { sesiones.delete(token); },
    rol(req) { return decidirRol({ ip: req.socket?.remoteAddress, cookie: leerCookies(req.headers?.cookie)[COOKIE] }, sesiones); },
    esOrganizador(req) { return this.rol(req) === 'organizador'; },
    // Ganchos de los roles de equipo (federacion.mjs los rellena): quién pregunta y si su rol pasa por organizador en esa ruta.
    resolverRol: () => null,
    elevar: () => false,
    permisos(req) { return this.esOrganizador(req) ? { org: true, rol: 'organizador', meetId: null, plataforma: '' } : { org: false, ...(this.resolverRol(req) || { rol: null, meetId: null, plataforma: '' }) }; },
  };
}

export const cabeceraCookie = (token, { borrar = false } = {}) =>
  `${COOKIE}=${borrar ? '' : token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${borrar ? 0 : 60 * 60 * 24 * 30}`;

/** Direcciones IPv4 de la red local (para decirle a los teléfonos a dónde entrar). */
export const ipsLAN = () => Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
