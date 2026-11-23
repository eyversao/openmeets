// Almacén: crear, leer, guardado agrupado y atómico, .bak, papelera, exportar/importar.
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearAlmacen, idSeguro } from '../servidor/almacen.mjs';

const dir = mkdtempSync(join(tmpdir(), 'om-almacen-'));
const espera = ms => new Promise(r => setTimeout(r, ms));
try {
  assert.equal(idSeguro('copa-1'), true);
  for (const x of ['../x', 'A', 'a/b', '', 'a.b', '-x', null, 'a'.repeat(61)]) assert.equal(idSeguro(x), false, String(x));

  const a = crearAlmacen(dir, { espera: 80 });
  assert.deepEqual(a.listar(), []);
  a.crear({ id: 'copa-1', nombre: 'Copa', atletas: [] });
  assert.ok(existsSync(join(dir, 'meets', 'copa-1.json')), 'crear escribe al instante');
  assert.throws(() => a.crear({ id: 'copa-1' }), /Ya existe/);
  assert.throws(() => a.crear({ id: '../malo' }), /no válido/);
  assert.equal(a.leer('../malo'), null);

  // Guardado agrupado: 20 cambios seguidos, una sola escritura tras la espera.
  for (let i = 0; i < 20; i++) a.guardarParcial('copa-1', m => { m.n = i; });
  assert.equal(a.pendientes, 1);
  assert.equal(JSON.parse(readFileSync(join(dir, 'meets', 'copa-1.json'), 'utf8')).n, undefined, 'aún no está en disco');
  await espera(250);
  assert.equal(a.pendientes, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, 'meets', 'copa-1.json'), 'utf8')).n, 19);
  assert.ok(existsSync(join(dir, 'meets', 'copa-1.json.bak')), 'deja copia .bak');
  assert.ok(!readdirSync(join(dir, 'meets')).some(f => f.endsWith('.tmp')), 'sin temporales sueltos');
  assert.equal(a.guardarParcial('no-existe', { x: 1 }), null);

  // Merge de objeto
  a.guardarParcial('copa-1', { nombre: 'Copa 2' });
  a.cerrar();
  assert.equal(JSON.parse(readFileSync(join(dir, 'meets', 'copa-1.json'), 'utf8')).nombre, 'Copa 2');

  // Otro almacén sobre la misma carpeta lee lo guardado; archivo roto → usa el .bak
  const b = crearAlmacen(dir);
  assert.equal(b.leer('copa-1').nombre, 'Copa 2');
  writeFileSync(join(dir, 'meets', 'copa-1.json'), '{roto');
  const c = crearAlmacen(dir);
  assert.ok(c.leer('copa-1'), 'recupera desde .bak');

  // Exportar / importar
  const copia = c.exportar('copa-1');
  copia.id = 'copa-2';
  c.importar(copia);
  assert.equal(c.listar().length, 2);
  assert.throws(() => c.importar(copia), /Ya existe/);
  c.importar({ ...copia, nombre: 'Reemplazada' }, { reemplazar: true });
  assert.equal(c.leer('copa-2').nombre, 'Reemplazada');

  // Papelera
  assert.equal(c.borrar('copa-2'), true);
  assert.equal(c.borrar('copa-2'), false);
  assert.equal(c.leer('copa-2'), null);
  assert.ok(readdirSync(join(dir, 'papelera')).some(f => f.startsWith('copa-2-')), 'queda en la papelera');
  assert.ok(!existsSync(join(dir, 'meets', 'copa-2.json')));
  console.log('almacén: ok');
} finally { rmSync(dir, { recursive: true, force: true }); }
