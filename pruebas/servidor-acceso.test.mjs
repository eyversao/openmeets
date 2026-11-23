// Acceso: loopback, PIN, cookie y límite de intentos.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearAcceso, crearLimitador, decidirRol, esLoopback, iguales, leerCookies, cabeceraCookie, pinValido, COOKIE } from '../servidor/acceso.mjs';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'om-acceso-')); dirs.push(d); return d; };
try {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(esLoopback(ip), true);
  for (const ip of ['192.168.1.5', '10.0.0.2', undefined, '::ffff:192.168.1.5']) assert.equal(esLoopback(ip), false);

  const s = new Set(['tok']);
  assert.equal(decidirRol({ ip: '127.0.0.1' }, s), 'organizador');
  assert.equal(decidirRol({ ip: '192.168.1.5' }, s), 'publico');
  assert.equal(decidirRol({ ip: '192.168.1.5', cookie: 'otra' }, s), 'publico');
  assert.equal(decidirRol({ ip: '192.168.1.5', cookie: 'tok' }, s), 'organizador');

  assert.deepEqual(leerCookies('a=1; om_sesion=xyz; b=2'), { a: '1', om_sesion: 'xyz', b: '2' });
  const ck = cabeceraCookie('t');
  assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/); assert.ok(ck.startsWith(`${COOKIE}=t`));
  assert.match(cabeceraCookie('', { borrar: true }), /Max-Age=0/);

  assert.equal(iguales('123456', '123456'), true);
  assert.equal(iguales('123456', '123457'), false);
  assert.equal(iguales('1', '123456'), false);

  // PIN: aleatorio de 6 dígitos, guardado en config.json y estable entre arranques
  const dir = tmp();
  const ac = crearAcceso(dir);
  assert.ok(pinValido(ac.pin));
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).pin, ac.pin);
  assert.equal(crearAcceso(dir).pin, ac.pin);
  assert.ok(pinValido(crearAcceso(tmp()).pin));

  // Sesión por PIN
  const req = (ip, cookie) => ({ socket: { remoteAddress: ip }, headers: cookie ? { cookie } : {} });
  assert.equal(ac.esOrganizador(req('192.168.1.5')), false);
  assert.equal(ac.iniciarSesion('192.168.1.5', ac.pin === '000000' ? '000001' : '000000').ok, false);
  const r = ac.iniciarSesion('192.168.1.5', ac.pin);
  assert.equal(r.ok, true);
  assert.equal(ac.esOrganizador(req('192.168.1.5', `${COOKIE}=${r.token}`)), true);
  ac.cerrarSesion(r.token);
  assert.equal(ac.esOrganizador(req('192.168.1.5', `${COOKIE}=${r.token}`)), false);

  // Cambiar PIN invalida sesiones; rechaza PIN malo
  const r2 = ac.iniciarSesion('10.0.0.9', ac.pin);
  assert.throws(() => ac.cambiarPin('12'), /6 dígitos/);
  assert.equal(ac.cambiarPin('424242'), '424242');
  assert.equal(ac.esOrganizador(req('10.0.0.9', `${COOKIE}=${r2.token}`)), false);
  assert.ok(pinValido(ac.cambiarPin()), 'sin argumento genera uno aleatorio');

  // 5 intentos por minuto por IP
  const lim = crearAcceso(tmp());
  const malo = lim.pin === '999999' ? '999998' : '999999';
  for (let i = 0; i < 5; i++) assert.equal(lim.iniciarSesion('1.1.1.1', malo).limitado, undefined);
  assert.equal(lim.iniciarSesion('1.1.1.1', malo).limitado, true);
  assert.equal(lim.iniciarSesion('1.1.1.1', lim.pin).ok, false, 'bloqueada aunque acierte');
  assert.equal(lim.iniciarSesion('2.2.2.2', lim.pin).ok, true, 'otra IP no se ve afectada');

  // Limitador con reloj controlado
  let t = 0;
  const l = crearLimitador({ max: 2, ventana: 1000, ahora: () => t });
  assert.ok(l.intentar('k')); assert.ok(l.intentar('k')); assert.ok(!l.intentar('k'));
  t = 1001; assert.ok(l.intentar('k'));
  console.log('acceso: ok');
} finally { for (const d of dirs) rmSync(d, { recursive: true, force: true }); }
