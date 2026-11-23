// Migración de la carpeta de datos «OpenMeet» → «OpenMeets»: renombra, no pisa lo nuevo y nunca borra sin copiar.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrarDatos } from '../servidor/openmeets.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'om-migra-'));
try {
  const vieja = join(tmp, 'OpenMeet', 'datos'), nueva = join(tmp, 'OpenMeets', 'datos');
  mkdirSync(vieja, { recursive: true }); writeFileSync(join(vieja, 'config.json'), '{"pin":"123456"}');
  migrarDatos(nueva, vieja);
  assert.equal(readFileSync(join(nueva, 'config.json'), 'utf8'), '{"pin":"123456"}');
  assert.equal(existsSync(vieja), false);
  // con la nueva ya creada no se toca nada
  mkdirSync(vieja, { recursive: true }); writeFileSync(join(vieja, 'otro.json'), '{}');
  migrarDatos(nueva, vieja);
  assert.equal(existsSync(join(vieja, 'otro.json')), true);
  assert.equal(existsSync(join(nueva, 'otro.json')), false);
  // sin la vieja no hace nada
  migrarDatos(join(tmp, 'x', 'datos'), join(tmp, 'no-existe'));
  assert.equal(existsSync(join(tmp, 'x')), false);
  console.log('ok migración de datos');
} finally { rmSync(tmp, { recursive: true, force: true }); }
