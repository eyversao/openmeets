// Extensiones de la API. Cada módulo exporta `crear({ almacen, acceso, tiempo, datos })` que devuelve
// `async ctx => boolean` (true si atendió la petición). Imports estáticos: el .exe no admite import() dinámico.
import { crear as inscripciones } from './inscripciones.mjs';
import { crear as federacion } from './federacion.mjs';
import { crear as records } from './records.mjs';
export const EXTENSIONES = [
  federacion, // roles de equipo: filtra el cuerpo de mesa y pesaje y anota la auditoría antes que el resto
  inscripciones,
  records,
];
