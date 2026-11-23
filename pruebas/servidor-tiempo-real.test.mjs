// Tiempo real: filtro por rol (el público y los jueces no reciben votos ni presencia).
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { paraRol, crearTiempoReal } from '../servidor/tiempo-real.mjs';

for (const tipo of ['meet', 'atleta', 'meet-cambio', 'vivo', 'aplauso']) {
  assert.equal(paraRol({ tipo }, 'publico'), true, tipo);
  assert.equal(paraRol({ tipo }, 'organizador'), true, tipo);
}
for (const tipo of ['voto', 'presencia', 'limpiar', 'otra-cosa']) {
  assert.equal(paraRol({ tipo }, 'publico'), false, `${tipo} no llega al público`);
  assert.equal(paraRol({ tipo }, 'organizador'), true, `${tipo} llega al organizador`);
}
assert.equal(paraRol(null, 'organizador'), false);
assert.equal(paraRol({}, 'organizador'), false);

const falso = () => {
  const req = new EventEmitter();
  const res = { escrito: [], writeHead() {}, write(t) { this.escrito.push(t); }, end() { this.fin = true; } };
  return { req, res, mensajes: () => res.escrito.filter(t => t.startsWith('data: ')).map(t => JSON.parse(t.slice(6))) };
};

const tr = crearTiempoReal({ ping: 1e6 });
tr.guardarVoto('m1', 'T|izq|d1', { plataforma: 'T', pos: 'izq', voto: 'blanca', turno: 'x' });
tr.guardarPresencia('m1', 'T|izq|d1', { plataforma: 'T', pos: 'izq' });
const org = falso(), pub = falso();
tr.conectar('m1', org.req, org.res, 'organizador', [{ tipo: 'meet', meet: { id: 'm1' } }, { tipo: 'voto', voto: {} }]);
tr.conectar('m1', pub.req, pub.res, 'publico', [{ tipo: 'meet', meet: { id: 'm1' } }, { tipo: 'voto', voto: {} }]);
assert.deepEqual(org.mensajes().map(m => m.tipo).sort(), ['meet', 'presencia', 'voto', 'voto'], 'el organizador recibe el volcado completo');
assert.deepEqual(pub.mensajes().map(m => m.tipo), ['meet'], 'el público solo recibe el meet inicial');

for (const m of [{ tipo: 'voto', voto: {} }, { tipo: 'presencia', datos: {} }, { tipo: 'limpiar', plataforma: 'T' }, { tipo: 'vivo', plataforma: 'T', datos: {} }, { tipo: 'aplauso', aid: 'a', n: 1 }]) tr.emitir('m1', m);
assert.deepEqual(pub.mensajes().map(m => m.tipo), ['meet', 'vivo', 'aplauso']);
assert.equal(org.mensajes().filter(m => m.tipo === 'limpiar').length, 1);
tr.emitir('otro-meet', { tipo: 'vivo' });
assert.equal(pub.mensajes().length, 3, 'otro meet no cruza');

tr.limpiarVotos('m1', 'T');
const tarde = falso();
tr.conectar('m1', tarde.req, tarde.res, 'organizador', []);
assert.deepEqual(tarde.mensajes().map(m => m.tipo), ['presencia'], 'los votos limpiados no se repiten');
assert.equal(tr.clientes('m1'), 3);
pub.req.emit('close');
assert.equal(tr.clientes('m1'), 2);
tr.cerrar();
assert.ok(org.res.fin);
console.log('tiempo real: ok');
