// API de inscripciones: validación, límite por IP, anti-duplicado, cupos y lista de espera, privacidad y confirmación.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crearApp } from './_servidor.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'om-ins-'));
const web = join(tmp, 'web'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<title>OM</title>');
const app = crearApp({ datos: join(tmp, 'datos'), web, espera: 20 });
const puerto = await app.escuchar(0, '127.0.0.1');
const base = `http://127.0.0.1:${puerto}`;
const pedir = async (ruta, { metodo = 'GET', cuerpo } = {}) => {
  const r = await fetch(base + ruta, { method: metodo, headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  const texto = await r.text(); let json = null; try { json = JSON.parse(texto); } catch { /* csv */ }
  return { estado: r.status, json, texto };
};
const futuro = new Date(); futuro.setDate(futuro.getDate() + 40);
const fechaFutura = `${futuro.getFullYear()}-${String(futuro.getMonth() + 1).padStart(2, '0')}-${String(futuro.getDate()).padStart(2, '0')}`;

try {
  let r = await pedir('/api/meets', { metodo: 'POST', cuerpo: { nombre: 'Copa Inscripciones', fecha: fechaFutura, federacion: 'IPF' } });
  const id = r.json.id;
  const ruta = `/api/meets/${id}/inscripciones`;
  const valido = n => ({ nombre: `Atleta Numero${n}`, sexo: 'M', nacimiento: '1995-03-04', club: 'Club', division: 'Open', equipamiento: 'raw', pesoEstimado: 82, contacto: `atleta${n}@correo.com`, acepto: true, aperturas: { S: 150 }, respuestas: {} });

  // cerradas por defecto
  assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: valido(1) })).estado, 409, 'sin configurar no se puede inscribir');
  assert.equal((await pedir(`${ruta}/estado`)).json.abierta, false);

  // configuración validada
  const malas = [{ pagoUrl: 'javascript:alert(1)' }, { precio: -5 }, { precio: 'caro' }, { cierre: 'mañana' }, { cupoTotal: 0 }, { cupoTotal: 99999 }];
  for (const m of malas) assert.equal((await pedir(`${ruta}/config`, { metodo: 'PUT', cuerpo: { abiertas: true, ...m } })).estado, 400, JSON.stringify(m));
  r = await pedir(`${ruta}/config`, { metodo: 'PUT', cuerpo: { abiertas: true, cierre: `${fechaFutura}T18:00`, cupoTotal: 3, cupoCategoria: 2, precio: '80000', moneda: 'cop', pagoUrl: 'https://pagos.example/x', instrucciones: 'Envía el comprobante.', preguntas: [{ texto: '¿Alguna lesión?', tipo: 'texto' }, { texto: '¿Eres menor de edad?', tipo: 'si-no', obligatoria: true }, { texto: '' }] } });
  assert.equal(r.estado, 200); assert.equal(r.json.config.moneda, 'COP'); assert.equal(r.json.config.precio, 80000); assert.equal(r.json.config.preguntas.length, 2);
  assert.equal((await pedir(`${ruta}/estado`)).json.abierta, true);
  assert.deepEqual((await pedir('/api/inscripciones/abiertas')).json, [id]);

  // validación del formulario
  const resp = { p2: 'no' };
  const prueba = async (cambio, texto) => { const x = await pedir(ruta, { metodo: 'POST', cuerpo: { ...valido(0), respuestas: resp, ...cambio } }); assert.equal(x.estado, 400, texto); };
  await prueba({ nombre: 'Ana' }, 'nombre y apellido');
  await prueba({ sexo: 'X' }, 'sexo');
  await prueba({ nacimiento: '2999-01-01' }, 'nacimiento futuro');
  await prueba({ nacimiento: '2000-02-31' }, 'fecha imposible');
  await prueba({ division: 'Inventada' }, 'división');
  await prueba({ equipamiento: 'x' }, 'equipamiento');
  await prueba({ pesoEstimado: 5 }, 'peso');
  await prueba({ contacto: 'no es nada' }, 'contacto');
  await prueba({ acepto: false }, 'reglamento');
  await prueba({ aperturas: { S: 'mucho' } }, 'apertura');
  await prueba({ respuestas: {} }, 'pregunta obligatoria');
  await prueba({ respuestas: { p2: 'quizá' } }, 'sí/no');

  // alta, anti-duplicado y privacidad
  r = await pedir(ruta, { metodo: 'POST', cuerpo: { ...valido(1), respuestas: resp } });
  assert.equal(r.estado, 201); assert.match(r.json.codigo, /^[A-HJKMNP-Z2-9]{6}$/); assert.equal(r.json.estado, 'pendiente'); assert.equal(r.json.clase, '-83'); assert.equal(r.json.pagoUrl, 'https://pagos.example/x');
  const it1 = r.json;
  r = await pedir(ruta, { metodo: 'POST', cuerpo: { ...valido(1), nombre: '  atleta  numero1 ', respuestas: resp } });
  assert.equal(r.estado, 409, 'mismo nombre y nacimiento');

  const publico = (await pedir(`/api/meets/${id}`)).json;
  const crudo = JSON.stringify(publico) + (await pedir(`/api/meets/${id}/resultados.csv`)).texto + (await pedir('/api/meets')).texto + (await pedir(`${ruta}/estado`)).texto;
  assert.ok(!crudo.includes('atleta1@correo.com') && !crudo.includes('Numero1'), 'el contacto y el nombre no salen en lo público');
  assert.equal(publico.atletas.length, 0, 'inscrito no es atleta hasta confirmar');
  assert.equal(publico.inscripciones.pagoUrl, 'https://pagos.example/x');

  // cupo por categoría (2) y total (3)
  assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: { ...valido(2), respuestas: resp } })).json.estado, 'pendiente');
  assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: { ...valido(3), respuestas: resp } })).json.estado, 'espera', 'categoría llena');
  assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: { ...valido(4), sexo: 'F', pesoEstimado: 55, respuestas: resp } })).json.estado, 'pendiente');
  assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: { ...valido(5), sexo: 'F', pesoEstimado: 70, respuestas: resp } })).json.estado, 'espera', 'cupo total lleno');

  // límite por IP: 5 por hora (ya van 5 válidas)
  assert.equal((await pedir(ruta, { metodo: 'POST', cuerpo: { ...valido(6), respuestas: resp } })).estado, 429);

  // gestión del organizador
  r = await pedir(ruta); assert.equal(r.estado, 200); assert.equal(r.json.items.length, 5);
  const iid = r.json.items.find(i => i.codigo === it1.codigo).id;
  r = await pedir(`${ruta}/${iid}`, { metodo: 'PATCH', cuerpo: { pagado: true } }); assert.equal(r.json.item.pagado, true); assert.equal(r.json.item.estado, 'pendiente');
  r = await pedir(`${ruta}/${iid}`, { metodo: 'PATCH', cuerpo: { estado: 'confirmado' } }); assert.equal(r.json.item.estado, 'confirmado');
  let m = (await pedir(`/api/meets/${id}`)).json;
  assert.equal(m.atletas.length, 1); assert.equal(m.atletas[0].nombre, 'Atleta Numero1'); assert.equal(m.atletas[0].clase, '-83'); assert.equal(m.atletas[0].intentos.S[0].kg, 150); assert.equal(m.atletas[0].lote, 1);
  assert.ok(!JSON.stringify(m).includes('atleta1@correo.com'), 'el atleta confirmado no lleva contacto');
  await pedir(`${ruta}/${iid}`, { metodo: 'PATCH', cuerpo: { estado: 'confirmado' } });
  m = (await pedir(`/api/meets/${id}`)).json; assert.equal(m.atletas.length, 1, 'confirmar dos veces no duplica');
  assert.equal((await pedir(`${ruta}/${iid}`, { metodo: 'PATCH', cuerpo: { estado: 'volando' } })).estado, 400);
  r = await pedir(`${ruta}/${iid}`, { metodo: 'PATCH', cuerpo: { estado: 'rechazado', nota: 'Documento ilegible' } }); assert.equal(r.json.item.estado, 'rechazado');
  m = (await pedir(`/api/meets/${id}`)).json; assert.equal(m.atletas.length, 0, 'rechazar a un confirmado lo saca del meet (Deshacer lo devuelve)');
  await pedir(`${ruta}/${iid}`, { metodo: 'PATCH', cuerpo: { estado: 'confirmado' } });
  assert.equal((await pedir(`/api/meets/${id}`)).json.atletas.length, 1);
  assert.equal((await pedir(`${ruta}/nada`, { metodo: 'PATCH', cuerpo: { pagado: true } })).estado, 404);

  // CSV privado con contacto
  r = await pedir(`/api/meets/${id}/inscripciones.csv`);
  assert.equal(r.estado, 200); assert.match(r.texto, /Contacto/); assert.match(r.texto, /atleta1@correo\.com/);

  // cierre vencido
  await pedir(`${ruta}/config`, { metodo: 'PUT', cuerpo: { abiertas: true, cierre: '2020-01-01T10:00' } });
  assert.equal((await pedir(`${ruta}/estado`)).json.motivo, 'cierre');
  assert.deepEqual((await pedir('/api/inscripciones/abiertas')).json, []);
  console.log('inscripciones-api: ok');
} finally { await app.cerrar?.(); rmSync(tmp, { recursive: true, force: true }); }
