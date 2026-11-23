// Corre todas las pruebas (*.test.mjs) de esta carpeta, cada una en su proceso.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const filtro = process.argv[2];
const archivos = readdirSync(aqui).filter(f => f.endsWith('.test.mjs') && (!filtro || f.includes(filtro))).sort();
let fallos = 0;
for (const f of archivos) {
  console.log(`\n== ${f}`);
  if (spawnSync(process.execPath, [join(aqui, f)], { stdio: 'inherit', cwd: aqui }).status !== 0) { fallos++; console.log(`FALLÓ ${f}`); }
}
console.log(fallos ? `\n${fallos} con fallos` : `\nTodo bien (${archivos.length} archivos)`);
process.exit(fallos ? 1 : 0);
