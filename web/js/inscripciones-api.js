/* OpenMeets — cliente de las inscripciones (público: estado y alta; organizador: gestión). Usa el mismo `pedir` que el resto. */
import { pedir } from './api.js';

const ruta = id => `/api/meets/${encodeURIComponent(id)}/inscripciones`;

export const ins = {
  /** Público: { config, abierta, motivo, cupos: { total, ocupados, espera, porClase } } */
  estado: id => pedir('GET', `${ruta(id)}/estado`),
  /** Público: manda la inscripción. Devuelve { codigo, estado, clase, division, precio, moneda, pagoUrl }. */
  inscribir: (id, datos) => pedir('POST', ruta(id), datos),
  /** Ids de los meets públicos con inscripciones abiertas ahora. */
  abiertas: async () => { try { const l = await pedir('GET', '/api/inscripciones/abiertas', undefined, { reintentos: 0 }); return Array.isArray(l) ? l : []; } catch { return []; } },
  /** Organizador. */
  lista: id => pedir('GET', ruta(id)),
  guardarConfig: (id, config) => pedir('PUT', `${ruta(id)}/config`, config),
  cambiar: (id, iid, campos) => pedir('PATCH', `${ruta(id)}/${encodeURIComponent(iid)}`, campos),
  urlCsv: id => `${ruta(id)}.csv`,
};
