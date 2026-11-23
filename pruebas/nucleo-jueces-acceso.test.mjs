// Acceso de jueces: identidad, huella, código de 6 dígitos, verificación de votos y registro de la mesa.
import assert from 'node:assert/strict';

const A = await import(new URL('../web/js/nucleo/jueces-acceso.js', import.meta.url).href);
const memoria = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

// Identidad: se crea una vez y se conserva; cada evento tiene la suya
const alm = memoria();
const i1 = A.identidad('ev1', alm), i2 = A.identidad('ev1', alm), i3 = A.identidad('ev2', alm);
assert.equal(i1.secreto, i2.secreto); assert.equal(i1.dispositivo, i2.dispositivo);
assert.notEqual(i1.secreto, i3.secreto);
assert.match(i1.secreto, /^[0-9a-f]{64}$/); assert.ok(i1.dispositivo.length >= 8 && i1.dispositivo.length <= 40);
assert.equal(A.guardarNombre('ev1', '  Ana  ', alm).nombre, 'Ana');
assert.equal(A.identidad('ev1', alm).nombre, 'Ana'); assert.equal(A.identidad('ev1', alm).secreto, i1.secreto);
assert.ok(A.identidad('ev3', null).secreto, 'sin almacenamiento sigue funcionando');

// Huella y código
const h = await A.huella('abc');
assert.equal(h, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'); // SHA-256 de «abc»
assert.equal(A.corta(h), 'ba7816bf8f01');
const c = A.codigoPar(h);
assert.match(c, /^\d{6}$/); assert.equal(A.codigoPar(h), c, 'estable');
assert.equal(A.codigoPar(await A.huella('abd')).length, 6);
assert.equal(A.formatoCodigo('482913'), '482 913');
// El código sale del final de la huella: la corta (pública) no lo revela
const h2 = h.slice(0, 12) + 'f'.repeat(52);
assert.notEqual(A.codigoPar(h2), c);
assert.equal(A.codigoCoincide(h, c.slice(0, 3) + ' ' + c.slice(3)), true);
assert.equal(A.codigoCoincide(h, c === '000000' ? '111111' : '000000'), false);
assert.equal(A.codigoCoincide(h, ''), false);

// Verificación de votos
const voto = { pos: 'izq', secreto: 'abc' };
assert.equal(await A.verificarVoto(voto, [h]), true);
assert.equal(await A.verificarVoto(voto, [A.corta(h)]), true);
assert.equal(await A.verificarVoto(voto, { izq: [h], cen: [] }), true, 'mapa por posición');
assert.equal(await A.verificarVoto({ ...voto, pos: 'cen' }, { izq: [h] }), false, 'otra posición');
assert.equal(await A.verificarVoto({ pos: 'izq', secreto: 'otro' }, [h]), false);
assert.equal(await A.verificarVoto({ pos: 'izq' }, [h]), false, 'sin secreto');
assert.equal(await A.verificarVoto(voto, []), false);

// Estado que ve el teléfono
assert.equal(A.estadoAcceso({ aprobacion: 'abierta' }, null, 'x'), 'abierta');
assert.equal(A.estadoAcceso({ accesos: { x: 'ok' } }, null, 'x'), 'ok');
assert.equal(A.estadoAcceso({ accesos: { x: 'no' } }, null, 'x'), 'no');
assert.equal(A.estadoAcceso({ accesos: {} }, null, 'x'), 'espera');
assert.equal(A.estadoAcceso(null, { aprobacion: 'abierta' }, 'x'), 'abierta');
assert.equal(A.estadoAcceso({ aprobacion: 'mesa' }, { aprobacion: 'abierta' }, 'x'), 'espera', 'manda el vivo');
assert.equal(A.estadoAcceso(null, null, 'x'), 'espera', 'por defecto pide aprobación');
assert.ok(A.puedeVotar('ok') && A.puedeVotar('abierta') && !A.puedeVotar('espera') && !A.puedeVotar('no'));
assert.equal(A.modoAprobacion({}), 'mesa'); assert.equal(A.modoAprobacion({ aprobacion: 'codigo' }), 'codigo'); assert.equal(A.necesitaAprobacion({ aprobacion: 'abierta' }), false);

// Registro de la mesa: dos teléfonos en la misma posición se ven por separado
const t = 100000;
const guardados = [];
const alm2 = memoria();
const R = A.crearRegistro('ev1', { almacen: alm2, ahora: () => t, guardarConocidos: c2 => guardados.push(c2) });
const ha = await A.huella('A'), hb = await A.huella('B');
const pres = {
  'T_1__izq__da': { plataforma: 'T 1', pos: 'izq', dispositivo: 'da', nombre: 'Ana', huella: ha, ts: 99000 },
  'T_1__izq__db': { plataforma: 'T 1', pos: 'izq', dispositivo: 'db', nombre: 'Beto', huella: hb, ts: 99500 },
  viejo: { plataforma: 'T 1', pos: 'cen', dispositivo: 'dc', nombre: 'Viejo', huella: 'f'.repeat(64), ts: 1 },
  sinhuella: { plataforma: 'T 1', pos: 'der', nombre: 'X', ts: 99900 },
};
assert.deepEqual(R.solicitudes(pres).map(x => x.nombre), ['Ana', 'Beto'], 'vigentes y con huella');
R.aprobar('T 1', 'izq', ha, { nombre: 'Ana', dispositivo: 'da' });
assert.deepEqual(R.solicitudes(pres).map(x => x.nombre), ['Beto'], 'aprobar a uno no aprueba al otro');
assert.deepEqual(R.aprobadosDe('T 1', 'izq'), [ha]); assert.deepEqual(R.aprobadosDe('T 1', 'cen'), []);
assert.equal(R.admite('T 1', 'izq', ha), true); assert.equal(R.admite('T 1', 'izq', hb), false);
assert.equal(await A.verificarVoto({ pos: 'izq', secreto: 'B' }, R.aprobadosDe('T 1', 'izq')), false);
assert.equal(await A.verificarVoto({ pos: 'izq', secreto: 'A' }, R.aprobadosDe('T 1', 'izq')), true);
R.rechazar('T 1', hb);
assert.deepEqual(R.accesos('T 1'), { [A.corta(ha)]: 'ok', [A.corta(hb)]: 'no' });
assert.equal(R.solicitudes(pres).length, 0);
assert.ok(!JSON.stringify(R.accesos('T 1')).includes(ha), 'solo huellas cortas');
// Recordar, auto-aprobación y olvidar
R.aprobar('T 1', 'izq', hb, { nombre: 'Beto', recordar: true });
assert.equal(guardados.length, 1); assert.equal(guardados[0][hb].pos, 'izq');
R.quitar('T 1', 'izq', hb);
assert.deepEqual(R.paraAutoAprobar(pres).map(x => x.nombre), ['Beto'], 'el conocido se aprueba solo');
assert.equal(R.esConocido(hb, 'cen'), false, 'solo en su posición');
// Persistencia en el almacén
const R2 = A.crearRegistro('ev1', { almacen: alm2 });
assert.deepEqual(R2.aprobadosDe('T 1', 'izq'), [ha]); assert.equal(R2.conocidos().length, 1);
R2.olvidar(hb); assert.equal(R2.conocidos().length, 0);
console.log('jueces-acceso: todo bien');

// SHA-256 en JS puro (teléfonos por http en la red local) = WebCrypto.
{
  const { sha256Puro, huella: hu } = await import('../web/js/nucleo/jueces-acceso.js');
  const { createHash } = await import('node:crypto');
  for (const t of ['', 'abc', 'a'.repeat(55), 'b'.repeat(56), 'c'.repeat(64), 'ñandú 🏋️'.repeat(20)]) {
    const esperado = createHash('sha256').update(t).digest('hex');
    if (sha256Puro(new TextEncoder().encode(t)) !== esperado) throw new Error('sha256Puro distinto para ' + JSON.stringify(t.slice(0, 10)));
    if (await hu(t) !== esperado) throw new Error('huella distinta');
  }
  console.log('sha256 puro: ok');
}
