// Lógica pura de las vistas públicas: listado agrupado, progreso del grupo, marcas y récords.
import assert from 'node:assert/strict';
const P = await import(new URL('../web/js/vistas/_publico.js', import.meta.url).href);

const lista = [
  { id: 'a', nombre: 'Copa Norte', fecha: '2026-03-01', ciudad: 'Bogotá', federacion: 'IPF', estado: 'terminada' },
  { id: 'b', nombre: 'Open Sur', fecha: '2026-12-10', ciudad: 'Cali', federacion: 'WRPF', estado: 'programada' },
  { id: 'c', nombre: 'Open Hoy', fecha: '2026-11-22', ciudad: 'Medellín', federacion: 'IPF', estado: 'en-vivo' },
  { id: 'd', nombre: 'Copa Vieja', fecha: '2025-05-02', ciudad: 'Cali', federacion: 'IPF', estado: 'terminada' },
  { id: 'e', nombre: 'Open Pronto', fecha: '2026-12-01', ciudad: 'Cali', federacion: 'IPF', estado: 'programada' },
];
let g = P.agruparMeets(lista);
assert.deepEqual(g.vivo.map(m => m.id), ['c']);
assert.deepEqual(g.proximas.map(m => m.id), ['e', 'b'], 'próximas por fecha ascendente');
assert.deepEqual(g.historial.map(m => m.id), ['a', 'd'], 'historial por fecha descendente');
assert.deepEqual(P.agruparMeets(lista, { busqueda: 'MEDELLIN' }).vivo.map(m => m.id), ['c'], 'búsqueda sin tildes ni mayúsculas');
assert.deepEqual(P.agruparMeets(lista, { anio: '2025' }).historial.map(m => m.id), ['d']);
assert.equal(P.agruparMeets(lista, { federacion: 'WRPF' }).proximas.length, 1);
assert.deepEqual(P.opcionesFiltro(lista), { anios: ['2026', '2025'], federaciones: ['IPF', 'WRPF'], paises: [], ciudades: ['Bogotá', 'Cali', 'Medellín'] });
const conPais = [{ ...lista[0], pais: 'Colombia' }, { ...lista[1], pais: 'Colombia' }, { id: 'x', nombre: 'Copa Lima', fecha: '2026-04-01', ciudad: 'Lima', pais: 'Perú', federacion: 'IPF', estado: 'terminada' }];
assert.deepEqual(P.opcionesFiltro(conPais).paises, ['Colombia', 'Perú']);
assert.deepEqual(P.opcionesFiltro(conPais, 'Colombia').ciudades, ['Bogotá', 'Cali'], 'las ciudades son las del país elegido');
assert.deepEqual(P.agruparMeets(conPais, { pais: 'Perú' }).historial.map(m => m.id), ['x']);
assert.deepEqual(P.agruparMeets(conPais, { pais: 'Colombia', ciudad: 'Cali' }).proximas.map(m => m.id), ['b']);

// Estado local del meet
assert.equal(P.estadoDe({ cerrado: true, fecha: '2999-01-01' }, '2026-11-22'), 'terminada');
assert.equal(P.estadoDe({ fecha: '2026-11-22', vivo: { T: { actual: { aid: 'x' } } } }, '2026-11-22'), 'en-vivo');
assert.equal(P.estadoDe({ fecha: '2026-11-21' }, '2026-11-22'), 'terminada');
assert.equal(P.estadoDe({ fecha: '2026-11-23' }, '2026-11-22'), 'programada');

// Progreso del grupo: solo intentos con peso y sin resultado, del grupo y levantamiento en curso
const at = (id, grupo, S) => ({ id, nombre: id, sexo: 'M', plataforma: 'T1', sesion: '1', grupo, intentos: { S, B: [], D: [] } });
const I = (kg, r = null) => ({ kg, r });
const atletas = [at('x', 'A', [I(100, 1), I(110), I(0)]), at('y', 'A', [I(90, -1), I(90), I(95)]), at('z', 'B', [I(80), I(85), I(90)])];
assert.deepEqual(P.progresoGrupo(atletas, 'T1', { lev: 'S', sesion: '1', grupo: 'A' }), { faltan: 3, total: 5, grupo: 'A' });
assert.equal(P.progresoGrupo(atletas, 'T1', { lev: 'B', sesion: '1', grupo: 'A' }), null, 'sin pesos no hay progreso');
assert.equal(P.progresoGrupo(atletas, 'T1', {}), null);

// Marcas personales solo con meets anteriores; récords por atleta
const previo = { id: 'p', fecha: '2026-01-01', nombre: 'Previo', atletas: [{ nombre: 'Ana Díaz', sexo: 'F', intentos: { S: [I(100, 1)], B: [I(60, 1)], D: [I(120, 1)] } }] };
const futuro = { ...previo, id: 'f', fecha: '2027-01-01', atletas: [{ nombre: 'Ana Díaz', sexo: 'F', intentos: { S: [I(500, 1)], B: [], D: [] } }] };
const ana = { id: 'ana', nombre: 'ana diaz', sexo: 'F', division: 'Open', peso: 60, clase: '63', intentos: { S: [I(110, 1), I(0), I(0)], B: [I(55, 1), I(0), I(0)], D: [I(130, 1), I(0), I(0)] } };
const marcas = P.marcasDeAtletas([ana], [previo, futuro], '2026-11-22');
assert.equal(marcas.get('ana').S, 100, 'ignora meets posteriores');
const sup = P.marcasSuperadas(ana, marcas.get('ana'));
assert.deepEqual([sup.S, sup.B, sup.D, sup.total], [true, false, true, true]);
assert.equal(P.recordsPorAtleta([ana]).get('ana').total, true);

// Mejor levantador por sexo
const luis = { ...ana, id: 'luis', nombre: 'Luis', sexo: 'M', peso: 83, clase: '83' };
const m = P.mejoresPorSexo([ana, luis], 'GL');
assert.equal(m.F[0].a.id, 'ana'); assert.equal(m.M[0].a.id, 'luis');

// Agrupación de atletas por plataforma, sesión y grupo
const gr = P.gruposDeAtletas([at('q', 'B', []), at('r', 'A', [])].map((a, i) => ({ ...a, plataforma: i ? 'T2' : 'T1' })), ['T1', 'T2']);
assert.deepEqual(gr.map(x => x.plataforma), ['T1', 'T2']);

console.log('vistas-publico: ok');
