// Teléfono del juez: enlace, botones, voto firmado, estado del envío y acceso.
import assert from 'node:assert/strict';
const J = await import(new URL('../web/js/vistas/juez-datos.js', import.meta.url).href);
const A = await import(new URL('../web/js/nucleo/jueces-acceso.js', import.meta.url).href);

// Enlace y lectura
const url = J.enlaceJuez('http://192.168.1.5:5050/', 'mi-meet-1', 'Tarima 1', 'cen', '123456');
assert.equal(url, 'http://192.168.1.5:5050/juez/mi-meet-1?t=Tarima%201&p=cen&c=123456');
assert.deepEqual(J.parametrosJuez(new URL(url).searchParams), { plataforma: 'Tarima 1', pos: 'cen', codigo: '123456', valido: true });
assert.equal(J.parametrosJuez('t=T&p=xx&c=1').valido, false);
assert.equal(J.parametrosJuez('t=T&p=izq').valido, false);

// Botones por modo
assert.deepEqual(J.botonesJuez('IPF').map(b => b.id), ['blanca', 'roja', 'azul', 'amarilla']);
assert.deepEqual(J.botonesJuez('otra').map(b => b.id), ['blanca', 'roja']);

// Voto: tarjeta solo en IPF y solo si es nulo
const base = { plataforma: 'Tarima 1', pos: 'izq', codigo: '123456', turno: 'a1_S_0', ident: { dispositivo: 'd1', secreto: 's'.repeat(64) }, ts: 5 };
assert.deepEqual(J.armarVoto({ ...base, boton: 'blanca', modo: 'IPF' }).tarjetas, []);
assert.equal(J.armarVoto({ ...base, boton: 'blanca', modo: 'IPF' }).voto, 'blanca');
assert.deepEqual(J.armarVoto({ ...base, boton: 'azul', modo: 'IPF' }), { plataforma: 'Tarima 1', pos: 'izq', voto: 'roja', tarjetas: ['azul'], codigo: '123456', turno: 'a1_S_0', ts: 5, via: 'local', dispositivo: 'd1', secreto: 's'.repeat(64) });
assert.deepEqual(J.armarVoto({ ...base, boton: 'roja', modo: 'otra' }).tarjetas, []);

// Qué se le dice al juez
assert.deepEqual(J.resumenEnvio({ ok: true, enCola: false }), { estado: 'enviado', texto: 'Enviado' });
assert.equal(J.resumenEnvio({ ok: false, enCola: true }).estado, 'cola');
assert.match(J.resumenEnvio({ ok: false, enCola: true }).texto, /En cola/);
assert.equal(J.resumenEnvio({ ok: false, enCola: false, estado: 403 }).estado, 'fallo');
assert.match(J.resumenEnvio({ ok: false, enCola: false }).texto, /No llegó/);

// Acceso: el modo del vivo manda; el código solo en modo 'codigo' y sin aprobar
const corta = A.corta(await A.huella('a'.repeat(64)));
assert.deepEqual(J.accesoJuez({ aprobacion: 'abierta' }, { aprobacion: 'mesa' }, corta), { modo: 'abierta', estado: 'abierta', puede: true, mostrarCodigo: false });
let ac = J.accesoJuez(null, { aprobacion: 'codigo' }, corta);
assert.equal(ac.estado, 'espera'); assert.equal(ac.puede, false); assert.equal(ac.mostrarCodigo, true);
ac = J.accesoJuez({ accesos: { [corta]: 'ok' } }, { aprobacion: 'codigo' }, corta);
assert.equal(ac.puede, true); assert.equal(ac.mostrarCodigo, false);
assert.equal(J.accesoJuez(null, { aprobacion: 'mesa' }, corta).mostrarCodigo, false);
assert.equal(J.accesoJuez({ accesos: { [corta]: 'no' } }, { aprobacion: 'mesa' }, corta).estado, 'no');
console.log('juez-datos: ok');

// Pico y final del juez: conteo de intentos juzgados y cierre
{
  const mem = {}; const alm = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
  assert.equal(J.anotarVoto('m1', 'a_S_0', { almacen: alm }), 1);
  assert.equal(J.anotarVoto('m1', 'a_S_0', { almacen: alm }), 1, 'el mismo turno no cuenta dos veces');
  assert.equal(J.anotarVoto('m1', 'a_S_1', { almacen: alm }), 2);
  assert.equal(J.anotarVoto('m1', 'a_S_1', { almacen: alm, quitar: true }), 1, 'un voto que no llegó se descuenta');
  assert.equal(J.votosJuzgados('otro', alm).length, 0, 'por meet');
  assert.equal(J.votosJuzgados('m1', null).length, 0, 'sin almacenamiento no falla');
  const I = (kg, r) => ({ kg, r });
  const fin = { id: 'a', nombre: 'A', sexo: 'M', plataforma: 'T1', sesion: '1', grupo: 'A', intentos: { S: [I(100, 1), I(110, 1), I(120, -1)], B: [I(60, 1), I(65, 1), I(70, 1)], D: [I(120, 1), I(130, 1), I(140, 1)] } };
  const otro = { ...fin, id: 'b', grupo: 'B', intentos: { S: [I(90), I(0), I(0)], B: [], D: [] } };
  assert.equal(J.cierreJuez({ atletas: [fin, otro] }, { sesion: '1', grupo: 'B', actual: { aid: 'b' } }, 'T1'), null, 'con atleta en tarima no hay cierre');
  assert.deepEqual(J.cierreJuez({ atletas: [fin, otro] }, { sesion: '1', grupo: 'A' }, 'T1'), { tipo: 'grupo', grupo: 'A', clave: '1|A' });
  assert.equal(J.cierreJuez({ atletas: [fin, otro], cerrado: true }, null, 'T1').tipo, 'meet');
}
