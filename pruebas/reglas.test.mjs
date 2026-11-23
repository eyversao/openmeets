// Reglas de Firestore (firestore.rules) contra el emulador. Se omite si no hay emulador (hace falta Java):
//   npx -y firebase-tools@latest emulators:exec --only firestore --project demo-openmeets "node pruebas/reglas.test.mjs"
// Dependencias de desarrollo: npm i (@firebase/rules-unit-testing y firebase).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log('reglas: omitido (sin emulador de Firestore; necesita Java)'); process.exit(0); }

const assert = (await import('node:assert/strict')).default;
const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, increment } = await import('firebase/firestore');

const env = await initializeTestEnvironment({ projectId: 'demo-openmeets', firestore: { rules: readFileSync(fileURLToPath(new URL('../firestore.rules', import.meta.url)), 'utf8') } });
const meetBase = (extra = {}) => ({ id: 'm1', nombre: 'Copa', fecha: '2026-12-01', publico: true, cerrado: false, enVivo: false, n: 1, dueno: 'dueno', creado: 1, actualizado: 1, ...extra });
const atleta = (id = 'a1') => ({ id, nombre: 'Ana Gil', sexo: 'F', intentos: { S: [], B: [], D: [] } });
const voto = (extra = {}) => ({ plataforma: 'Tarima 1', pos: 'izq', voto: 'blanca', tarjetas: [], turno: 't1', via: 'local', dispositivo: 'd1', secreto: '', ts: 1, codigo: '123456', ...extra });
const insc = (iid, extra = {}) => ({ id: iid, codigo: 'ABC234', estado: 'pendiente', pagado: false, nombre: 'Luis Perez', sexo: 'M', nacimiento: '2000-01-01', contacto: 'luis@correo.com', aid: null, creado: 1, ts: 1, ...extra });
const IID = `in-${'a'.repeat(24)}`;

await env.clearFirestore();
await env.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'meets/m1'), meetBase({ inscripciones: { abiertas: true } }));
  await setDoc(doc(db, 'meets/m1/privado/datos'), { codigoJuez: '123456', juecesConocidos: {} });
  await setDoc(doc(db, 'meets/m1/atletas/a1'), atleta());
  await setDoc(doc(db, 'meets/priv'), meetBase({ id: 'priv', publico: false }));
  await setDoc(doc(db, 'meets/priv/atletas/a1'), atleta());
  await setDoc(doc(db, 'meets/cerrado'), meetBase({ id: 'cerrado', inscripciones: { abiertas: false } }));
  await setDoc(doc(db, 'meets/cerrado/privado/datos'), { codigoJuez: '1', juecesConocidos: {} });
});

const anon = env.unauthenticatedContext().firestore();
const dueno = env.authenticatedContext('dueno').firestore();
const otro = env.authenticatedContext('otro').firestore();
const d = (db, ruta) => doc(db, ruta);

// meets
await assertSucceeds(getDoc(d(anon, 'meets/m1')));
await assertFails(getDoc(d(anon, 'meets/priv')));
await assertSucceeds(getDoc(d(dueno, 'meets/priv')));
await assertSucceeds(getDocs(query(collection(anon, 'meets'), where('publico', '==', true))));
await assertFails(getDocs(collection(anon, 'meets')));
await assertSucceeds(getDocs(query(collection(dueno, 'meets'), where('dueno', '==', 'dueno'))));
await assertFails(getDocs(query(collection(otro, 'meets'), where('dueno', '==', 'dueno'))));
await assertSucceeds(setDoc(d(otro, 'meets/nuevo'), meetBase({ id: 'nuevo', dueno: 'otro' })));
await assertFails(setDoc(d(otro, 'meets/robado'), meetBase({ id: 'robado', dueno: 'dueno' })));
await assertFails(setDoc(d(anon, 'meets/anonimo'), meetBase({ id: 'anonimo', dueno: 'x' })));
await assertFails(updateDoc(d(otro, 'meets/m1'), { nombre: 'Mío' }));
await assertFails(updateDoc(d(dueno, 'meets/m1'), { dueno: 'otro' }));
await assertFails(updateDoc(d(dueno, 'meets/m1'), { campoRaro: 1 }));
await assertSucceeds(updateDoc(d(dueno, 'meets/m1'), { nombre: 'Copa 2' }));
await assertFails(deleteDoc(d(otro, 'meets/m1')));

// atletas
await assertSucceeds(getDoc(d(anon, 'meets/m1/atletas/a1')));
await assertFails(getDoc(d(anon, 'meets/priv/atletas/a1')));
await assertSucceeds(setDoc(d(dueno, 'meets/m1/atletas/a2'), atleta('a2')));
await assertFails(setDoc(d(otro, 'meets/m1/atletas/a3'), atleta('a3')));
await assertFails(setDoc(d(dueno, 'meets/m1/atletas/a4'), { ...atleta('a4'), extra: 1 }));
await assertFails(setDoc(d(dueno, 'meets/m1/atletas/a5'), atleta('otro-id')));

// privado, votos y presencia
await assertFails(getDoc(d(anon, 'meets/m1/privado/datos')));
await assertSucceeds(getDoc(d(dueno, 'meets/m1/privado/datos')));
await assertSucceeds(setDoc(d(anon, 'meets/m1/votos/p1'), voto()));
await assertFails(setDoc(d(anon, 'meets/m1/votos/p2'), voto({ codigo: '000000' })));
await assertFails(setDoc(d(anon, 'meets/m1/votos/p3'), voto({ pos: 'abajo' })));
await assertFails(setDoc(d(anon, 'meets/m1/votos/p4'), voto({ voto: 'azul' })));
await assertFails(setDoc(d(anon, 'meets/m1/votos/p1'), voto({ voto: 'roja' }))); // mismo turno: el primero cuenta
await assertSucceeds(setDoc(d(anon, 'meets/m1/votos/p1'), voto({ turno: 't2', voto: 'roja' })));
await assertFails(getDoc(d(anon, 'meets/m1/votos/p1')));
await assertSucceeds(getDoc(d(dueno, 'meets/m1/votos/p1')));
await assertSucceeds(deleteDoc(d(dueno, 'meets/m1/votos/p1')));
await assertFails(deleteDoc(d(anon, 'meets/m1/votos/p1')));
await assertSucceeds(setDoc(d(anon, 'meets/m1/presencia/p1'), { plataforma: 'Tarima 1', pos: 'cen', bateria: 80, nombre: 'Juez', huella: 'h', ts: 1, codigo: '123456' }));
await assertFails(setDoc(d(anon, 'meets/m1/presencia/p2'), { plataforma: 'Tarima 1', pos: 'cen', ts: 1, codigo: 'mal' }));

// aplausos
await assertSucceeds(setDoc(d(anon, 'meets/m1/aplausos/a1'), { n: increment(1) }, { merge: true }));
await assertSucceeds(setDoc(d(anon, 'meets/m1/aplausos/a1'), { n: increment(1) }, { merge: true }));
await assertFails(setDoc(d(anon, 'meets/m1/aplausos/a1'), { n: increment(5) }, { merge: true }));
await assertFails(setDoc(d(anon, 'meets/m1/aplausos/zz'), { n: 1 }));
await assertFails(setDoc(d(anon, 'meets/priv/aplausos/a1'), { n: 1 }));

// vivo: la versión solo sube
await assertSucceeds(setDoc(d(dueno, 'meets/m1/vivo/T'), { plataforma: 'T', datos: { version: 10, actual: true } }));
await assertFails(setDoc(d(dueno, 'meets/m1/vivo/T'), { plataforma: 'T', datos: { version: 5 } }));
await assertSucceeds(setDoc(d(dueno, 'meets/m1/vivo/T'), { plataforma: 'T', datos: { version: 11 } }));
await assertFails(setDoc(d(anon, 'meets/m1/vivo/T'), { plataforma: 'T', datos: { version: 99 } }));
await assertSucceeds(getDoc(d(anon, 'meets/m1/vivo/T')));

// inscripciones y cupos
await assertSucceeds(setDoc(d(anon, `meets/m1/inscripciones/${IID}`), insc(IID)));
await assertFails(setDoc(d(anon, `meets/m1/inscripciones/${IID}`), insc(IID))); // duplicado: segunda escritura = update
await assertFails(setDoc(d(anon, `meets/m1/inscripciones/in-${'b'.repeat(24)}`), insc(`in-${'b'.repeat(24)}`, { estado: 'confirmado' })));
await assertFails(setDoc(d(anon, `meets/m1/inscripciones/in-${'c'.repeat(24)}`), insc(`in-${'c'.repeat(24)}`, { aid: 'a1' })));
await assertFails(setDoc(d(anon, `meets/cerrado/inscripciones/${IID}`), insc(IID)));
await assertFails(getDoc(d(anon, `meets/m1/inscripciones/${IID}`)));
await assertSucceeds(getDoc(d(dueno, `meets/m1/inscripciones/${IID}`)));
await assertSucceeds(updateDoc(d(dueno, `meets/m1/inscripciones/${IID}`), { estado: 'confirmado' }));
await assertFails(updateDoc(d(anon, `meets/m1/inscripciones/${IID}`), { estado: 'confirmado' }));
await assertSucceeds(setDoc(d(anon, 'meets/m1/publico/cupos'), { ocupados: increment(1), porClase: { 'M|83': increment(1) } }, { merge: true }));
await assertSucceeds(setDoc(d(anon, 'meets/m1/publico/cupos'), { ocupados: increment(1) }, { merge: true }));
await assertFails(setDoc(d(anon, 'meets/m1/publico/cupos'), { ocupados: increment(3) }, { merge: true }));
await assertSucceeds(setDoc(d(dueno, 'meets/m1/publico/cupos'), { ocupados: 0, espera: 0, porClase: {} }));
await assertSucceeds(getDoc(d(anon, 'meets/m1/publico/cupos')));

// todo lo demás, denegado
await assertFails(setDoc(d(dueno, 'otra/x'), { a: 1 }));
await assertFails(getDoc(d(anon, 'otra/x')));

/* ---------- el código real de la app (rutas y transporte) contra estas reglas ---------- */
{
  const fs = await import('firebase/firestore');
  const { adaptarFirestore } = await import('../web/js/nube/bd.js');
  const { crearRutas } = await import('../web/js/nube/rutas.js');
  const { crearTransporte } = await import('../web/js/nube/transporte.js');
  const memoria = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
  const bdDe = (db, uid) => ({ config: {}, ...adaptarFirestore(fs, db), usuario: async () => (uid ? { uid, email: 'x@y.co', nombre: 'X', foto: '' } : null), salir: async () => {} });
  const dueñoBd = bdDe(env.authenticatedContext('real').firestore(), 'real');
  const otroBd = bdDe(env.authenticatedContext('intruso').firestore(), 'intruso');
  const anonBd = bdDe(env.unauthenticatedContext().firestore(), null);
  const rd = crearRutas({ db: dueñoBd, almacen: memoria() }), ro = crearRutas({ db: otroBd, almacen: memoria() }), ra = crearRutas({ db: anonBd, almacen: memoria() });
  const rechaza = async (p, estado) => { try { await p; } catch (e) { assert.equal(e.estado, estado, e.message); return; } throw new Error('debía rechazarse'); };

  const m = await rd('POST', '/api/meets', { nombre: 'Copa Real', federacion: 'IPF', fecha: '2027-01-01' });
  const r = `/api/meets/${m.id}`;
  await rd('PUT', `${r}/atletas/ana`, { id: 'ana', nombre: 'Ana Gil', sexo: 'F', peso: 60, intentos: { S: [{ kg: 100 }], B: [], D: [] } });
  await rd('PUT', `${r}/atletas/ana`, { id: 'ana', nombre: 'Ana Gil', sexo: 'F', peso: 60, intentos: { S: [{ kg: 100, r: 1 }], B: [], D: [] } });
  await rd('POST', `${r}/atletas`, { atletas: [{ nombre: 'Luis Paz', sexo: 'M' }] });
  assert.equal((await rd('GET', r)).atletas.length, 2);
  assert.equal((await ra('GET', r)).mio, false);
  assert.equal((await ra('GET', r)).privado, undefined);
  assert.equal((await ra('GET', '/api/meets')).some(x => x.id === m.id), true);
  await rechaza(ro('PUT', `${r}/atletas/ana`, { id: 'ana', nombre: 'Ana' }), 403);
  await rechaza(ra('PATCH', r, { nombre: 'x' }), 403);
  await rechaza(ra('GET', `${r}/export.json`), 403);
  await rd('PATCH', r, { publico: false, descripcion: 'Solo yo' });
  await rechaza(ra('GET', r), 404);
  await rd('PATCH', r, { publico: true });
  await ra('POST', `${r}/aplauso`, { aid: 'ana' });
  assert.equal((await ra('GET', r)).aplausos.ana, 1);
  await rd('PUT', `${r}/inscripciones/config`, { abiertas: true, cupoTotal: 1, equipamiento: ['raw'] });
  const form = { nombre: 'Pedro Gomez', sexo: 'M', nacimiento: '2001-02-03', division: 'Open', equipamiento: 'raw', pesoEstimado: 75, contacto: '3001234567', acepto: true };
  assert.equal((await ra('POST', `${r}/inscripciones`, form)).estado, 'pendiente');
  await rechaza(ra('POST', `${r}/inscripciones`, form), 409);
  assert.equal((await ra('POST', `${r}/inscripciones`, { ...form, nombre: 'Maria Lopez', sexo: 'F', nacimiento: '2000-05-05' })).estado, 'espera');
  const est = await ra('GET', `${r}/inscripciones/estado`);
  assert.equal(est.cupos.ocupados, 1); assert.equal(est.cupos.espera, 1);
  const lista = await rd('GET', `${r}/inscripciones`);
  assert.equal(lista.items.length, 2);
  const pedro = lista.items.find(i => i.nombre === 'Pedro Gomez');
  assert.ok((await rd('PATCH', `${r}/inscripciones/${pedro.id}`, { estado: 'confirmado' })).item.aid);
  assert.equal((await rd('GET', r)).atletas.length, 3);
  await rd('PATCH', `${r}/inscripciones/${pedro.id}`, { estado: 'rechazado' });
  assert.equal((await rd('GET', r)).atletas.length, 2);
  await rechaza(ra('GET', `${r}/inscripciones`), 403);
  const copia = await rd('GET', `${r}/export.json`);
  await rd('POST', '/api/meets/importar', { ...copia, id: 'copia-real' });
  assert.equal((await rd('GET', '/api/meets/copia-real')).atletas.length, 2);
  await rd('DELETE', '/api/meets/copia-real');
  await rechaza(rd('GET', '/api/meets/copia-real'), 404);

  // transporte: dueño escribe vivo, juez vota con el código, el dueño lo lee
  const t = crearTransporte(dueñoBd, m.id, { espera: 0 }), tj = crearTransporte(anonBd, m.id, { espera: 0 });
  const codigo = (await rd('GET', r)).privado.codigoJuez;
  const recibidos = [];
  const baja = t.suscribir(x => recibidos.push(x), () => {});
  await t.enviar({ tipo: 'vivo', plataforma: 'Tarima 1', datos: { version: 5, actual: 'ana', turno: 't1' } });
  await t.enviar({ tipo: 'regie', plataforma: 'Tarima 1', datos: { escena: 'podio' } });
  await tj.enviar({ tipo: 'voto', codigo, voto: { plataforma: 'Tarima 1', pos: 'cen', voto: 'roja', turno: 't1', dispositivo: 'tel9' } });
  await tj.enviar({ tipo: 'presencia', codigo, datos: { plataforma: 'Tarima 1', pos: 'cen', dispositivo: 'tel9', nombre: 'Juez', huella: 'hh', bateria: 50 } });
  await assert.rejects(tj.enviar({ tipo: 'voto', codigo: '000000', voto: { plataforma: 'Tarima 1', pos: 'izq', voto: 'roja', turno: 't1', dispositivo: 'tel8' } }), e => e.estado === 403);
  await assert.rejects(tj.enviar({ tipo: 'vivo', plataforma: 'Tarima 1', datos: { version: 99 } }), e => e.code === 'permission-denied');
  await new Promise(ok => setTimeout(ok, 1500));
  assert.ok(recibidos.some(x => x.tipo === 'meet' && x.meet.mio), 'el dueño recibe el meet armado');
  assert.ok(recibidos.some(x => x.tipo === 'voto' && x.voto.voto === 'roja'), 'el dueño recibe el voto');
  assert.ok(recibidos.some(x => x.tipo === 'presencia'));
  assert.equal((await ra('GET', r)).vivo['Tarima 1'].version, 5);
  assert.equal((await ra('GET', '/api/meets')).find(x => x.id === m.id).estado, 'en-vivo', 'el listado ve enVivo sin leer el vivo');
  baja();
  await rd('DELETE', r);
  assert.equal((await ra('GET', '/api/meets')).some(x => x.id === m.id), false);
}

await env.cleanup();
console.log('reglas: ok');
