// Mandos de jueces: protocolo de texto, mapa de fábrica, mapas viejos, programar y estado con latido.
import assert from 'node:assert/strict';
const M = await import(new URL('../web/js/nucleo/jueces-mandos.js', import.meta.url).href);

// Protocolo
assert.deepEqual(M.parsearLinea('L1'), { tipo: 'voto', pos: 'izq', letra: 'L', boton: 'blanca', codigo: 'L1' });
assert.equal(M.parsearLinea('C2').boton, 'roja');
assert.equal(M.parsearLinea(' r3 \r').boton, 'azul');
assert.deepEqual([M.parsearLinea('R4').pos, M.parsearLinea('R4').boton], ['der', 'amarilla']);
assert.deepEqual(M.parsearLinea('BAT:L:87'), { tipo: 'bateria', pos: 'izq', letra: 'L', nivel: 87 });
assert.equal(M.parsearLinea('BAT:C:250').nivel, 100);
assert.deepEqual(M.parsearLinea('HB:R'), { tipo: 'latido', pos: 'der', letra: 'R' });
for (const malo of ['L5', 'L0', 'X1', 'HB:X', 'BAT:L:', 'hola', '', null]) assert.equal(M.parsearLinea(malo), null, String(malo));
assert.deepEqual(M.separarLineas('L', '1\nHB:'), { lineas: ['L1'], resto: 'HB:' });
assert.deepEqual(M.separarLineas('', 'L1\r\nC2\r\n'), { lineas: ['L1', 'C2'], resto: '' });

// Mapa de fábrica: 4 botones por juez, teclado + USB + Bluetooth
const f = M.mapaDeFabrica();
assert.equal(Object.keys(f).length, 36);
assert.deepEqual(f['tecla:KeyQ'], { pos: 'izq', voto: 'blanca' });
assert.deepEqual(f['tecla:KeyA'], { pos: 'izq', voto: 'roja' });
assert.deepEqual(f['tecla:Digit1'], { pos: 'izq', voto: 'azul' });
assert.deepEqual(f['tecla:Digit6'], { pos: 'der', voto: 'amarilla' });
assert.deepEqual(f['serie:C3'], { pos: 'cen', voto: 'azul' });
assert.deepEqual(f['ble:R4'], { pos: 'der', voto: 'amarilla' });
const teclas = Object.keys(f).filter(s => s.startsWith('tecla:')).map(s => s.slice(6));
for (const reservada of ['KeyG', 'KeyB', 'KeyS', 'KeyR', 'KeyP', 'Space']) assert.ok(!teclas.includes(reservada), reservada);
assert.deepEqual(M.aplicarMapa(f, 'ble:L2'), { pos: 'izq', voto: 'roja' });
assert.equal(M.aplicarMapa(f, 'tecla:KeyX'), null);

// Mapa viejo (solo blanca/roja) sigue valiendo y recibe lo nuevo
const viejo = { 'tecla:KeyQ': { pos: 'izq', voto: 'blanca' }, 'tecla:KeyP': { pos: 'der', voto: 'roja' } };
const fundido = M.fundirMapa(viejo);
assert.deepEqual(fundido['tecla:KeyQ'], { pos: 'izq', voto: 'blanca' });
assert.deepEqual(fundido['tecla:KeyP'], { pos: 'der', voto: 'roja' });
assert.equal(fundido['tecla:KeyC'], undefined, 'der roja ya tiene tecla propia: no vuelve la de fábrica');
assert.deepEqual(fundido['tecla:Digit2'], { pos: 'izq', voto: 'amarilla' });
assert.deepEqual(fundido['serie:L1'], { pos: 'izq', voto: 'blanca' });
assert.deepEqual(M.fundirMapa(null), f);
assert.deepEqual(M.leerMapa(), f, 'sin almacenamiento, el de fábrica');

// Programar: una señal por voto y familia; las otras vías no se tocan
const p = M.programar(f, 'tecla:KeyK', 'izq', 'blanca');
assert.deepEqual(p['tecla:KeyK'], { pos: 'izq', voto: 'blanca' });
assert.equal(p['tecla:KeyQ'], undefined);
assert.deepEqual(p['serie:L1'], { pos: 'izq', voto: 'blanca' }, 'USB intacto');
const q = M.programar(p, 'tecla:KeyK', 'cen', 'azul');
assert.deepEqual(q['tecla:KeyK'], { pos: 'cen', voto: 'azul' }, 'la señal se mueve de voto');
assert.equal(q['tecla:Digit3'], undefined);
assert.equal(M.familiaDe('mando12:b3'), 'mando');
assert.deepEqual(M.programar(f, 'mando0:b3', 'der', 'roja')['mando0:b3'], { pos: 'der', voto: 'roja' });
assert.deepEqual(M.fundirMapa(p)['tecla:KeyK'], { pos: 'izq', voto: 'blanca' });
assert.equal(M.fundirMapa(p)['tecla:KeyQ'], undefined, 'lo reprogramado no resucita');

// Estado de dispositivos y latido
const r = M.crearRegistro();
r.actualizar('usb0', { nombre: 'Placa USB', tipo: 'usb', pos: 'izq' }, 1000);
r.actualizar('bt:1', { nombre: 'OpenMando-C', tipo: 'bluetooth', pos: 'cen', bateria: 80 }, 1000);
r.actualizar('teclado', { nombre: 'Teclado', tipo: 'teclado' }, 1000);
const conectados = t => Object.fromEntries(r.lista(t).map(d => [d.id, d.conectado]));
assert.deepEqual(conectados(50000), { usb0: true, 'bt:1': true, teclado: true }, 'sin latido, vale el enlace');
r.latido('usb0', 2000);
r.latido('bt:1', 2000);
assert.deepEqual(conectados(7999), { usb0: true, 'bt:1': true, teclado: true });
assert.deepEqual(conectados(8001), { usb0: false, 'bt:1': false, teclado: true }, 'caduca a los 6 s');
r.latido('bt:1', 8000);
assert.equal(conectados(9000)['bt:1'], true, 'otro latido lo recupera');
r.actualizar('bt:1', { enlace: false }, 9000);
assert.equal(conectados(9000)['bt:1'], false, 'enlace caído');
const d = r.lista(9000).find(x => x.id === 'bt:1');
assert.deepEqual(Object.keys(d).sort(), ['bateria', 'conectado', 'id', 'nombre', 'pos', 'tipo', 'ts']);
assert.equal(d.bateria, 80);
assert.equal(M.esperaReconexion(0), 1000);
assert.equal(M.esperaReconexion(3), 8000);
assert.equal(M.esperaReconexion(40), 30000);
r.quitar('usb0');
assert.equal(r.lista().length, 2);

console.log('mandos: ok');
