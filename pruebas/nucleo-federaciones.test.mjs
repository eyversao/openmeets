// Categorías de peso y de edad: cada federación con las suyas (reglamentos IPF 2026, WRPF 2026, USAPL 2026, WPC 2025, GPC 2025).
import assert from 'node:assert/strict';

const F = await import(new URL('../web/js/nucleo/federaciones.js', import.meta.url).href);
const { claseDe } = await import(new URL('../web/js/nucleo/competencia.js', import.meta.url).href);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('OK  ' + m); };
const nombres = fed => F.divisionesDe(fed).map(x => x.nombre);
const edad = (fed, nombre) => F.divisionesDe(fed).find(x => x.nombre === nombre)?.edad;

ok(!F.clasesDe('IPF', 'M').includes('-110') && F.clasesDe('IPF', 'M').join() === '-59,-66,-74,-83,-93,-105,-120,+120', 'IPF hombres: 59 a 120 y +120, sin 110');
ok(F.clasesDe('IPF', 'F').join() === '-47,-52,-57,-63,-69,-76,-84,+84', 'IPF mujeres: 47 a 84 y +84');
ok(F.clasesDe('IPF', 'M', 'Junior')[0] === '-53' && F.clasesDe('IPF', 'F', 'Sub-Junior')[0] === '-43' && F.clasesDe('IPF', 'M', 'Open')[0] === '-59', 'IPF: la clase de 53 y la de 43 solo en Sub-Junior y Junior');
ok(edad('IPF', 'Sub-Junior') === '14-18' && edad('IPF', 'Junior') === '19-23', 'IPF: Sub-Junior 14-18 y Junior 19-23');
ok(edad('WRPF', 'Sub-Junior') === '17-19' && edad('WRPF', 'Teenage') === '14-16' && edad('WRPF', 'Junior') === '20-23', 'WRPF: Teenage 14-16, Sub-Junior 17-19 y Junior 20-23');
ok(F.clasesDe('WRPF', 'M').join() === '-52,-56,-60,-67.5,-75,-82.5,-90,-100,-110,-125,-140,+140' && F.clasesDe('WRPF', 'F').at(-1) === '+90', 'WRPF: clases de 52 a 140, mujeres hasta +90');
ok(F.clasesDe('WRPF', 'M', 'Junior')[0] === '-52', 'WRPF no tiene clase extra para juveniles');
ok(F.clasesDe('USAPL', 'F').includes('-65') && F.clasesDe('USAPL', 'F').includes('-70') && F.clasesDe('USAPL', 'F').at(-1) === '+100', 'USAPL mujeres: 65 y 70, hasta +100');
ok(['Teen 1', 'Teen 2', 'Teen 3'].every(x => nombres('USAPL').includes(x)) && edad('USAPL', 'Teen 3') === '18-19', 'USAPL: Teen 1, 2 y 3 (la tercera, 18-19)');
ok(F.clasesDe('WPC', 'F').at(-1) === '+110' && F.clasesDe('GPC', 'F').at(-1) === '+110' && nombres('WPC').includes('Master 45-49'), 'WPC y GPC: mujeres hasta +110 y máster por bandas de 5 años');
ok(!nombres('IPF').includes('Teenage') && !nombres('WRPF').includes('Master 45-49') && !nombres('USAPL').includes('Sub-Junior'), 'ninguna federación hereda las divisiones de otra');
ok(F.FEDERACIONES.join() === 'IPF,IPL,WRPF,WPC,USAPL,GPC,FCLP,Local,Amateur,Otra', 'las diez opciones de federación siguen igual');
ok(F.clasesDe('Local', 'M').includes('-59') && F.clasesDe('Local', 'M').includes('-52') && F.clasesDe('Local', 'M').at(-1) === '+140' && F.clasesDe('Local', 'F').includes('-47'), 'Local, Amateur y Otra ofrecen todas las clases, ordenadas');
ok(F.claseMasCercana('IPF', 'M', 91) === '-93' && F.claseMasCercana('WRPF', 'M', 91) === '-100' && F.claseMasCercana('WRPF', 'M', 150) === '+140', 'un hombre de 91 kg: -93 en la IPF y -100 en la WRPF');
ok(claseDe('M', 52) === '-59' && claseDe('M', 52, 'Junior') === '-53' && claseDe('F', 120) === '+84', 'claseDe (competencia en vivo): un adulto de 52 kg va a -59; un Junior, a -53');
console.log(`\n${n} comprobaciones`);
