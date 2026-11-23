/* ============================================================
   OPENMEETS — Medidas y colores de los discos
   Una sola fuente para el visualizador y las competencias en vivo.
   ============================================================ */

export const SPEC_KG = {
  50: { color: '#10B981', height: 100, textColor: 'white', thickness: 20 },
  25: { color: '#DC2626', height: 100, textColor: 'white', thickness: 14 },
  20: { color: '#2563EB', height: 100, textColor: 'white', thickness: 11 },
  15: { color: '#FACC15', height: 92, textColor: 'black', thickness: 10 },
  10: { color: '#16A34A', height: 88, textColor: 'white', thickness: 9 },
  5: { color: '#FFFFFF', height: 70, textColor: 'black', thickness: 8 },
  2.5: { color: '#000000', height: 60, textColor: 'white', thickness: 6 },
  1.25: { color: '#9CA3AF', height: 50, textColor: 'black', thickness: 5 },
  0.5: { color: '#6B7280', height: 40, textColor: 'white', thickness: 4 },
  0.25: { color: '#4B5563', height: 35, textColor: 'white', thickness: 3 },
};

export const SPEC_LB = {
  45: { color: '#2563EB', metallicColor: '#27272a', height: 98, textColor: 'white', thickness: 25 },
  35: { color: '#FACC15', metallicColor: '#3f3f46', height: 90, textColor: 'black', thickness: 22 },
  25: { color: '#16A34A', metallicColor: '#52525b', height: 82, textColor: 'white', thickness: 20 },
  10: { color: '#FFFFFF', metallicColor: '#71717a', height: 65, textColor: 'black', thickness: 15 },
  5: { color: '#000000', metallicColor: '#a1a1aa', height: 55, textColor: 'white', thickness: 12 },
  2.5: { color: '#9CA3AF', metallicColor: '#d4d4d8', height: 45, textColor: 'black', thickness: 10 },
  1.25: { color: '#6B7280', metallicColor: '#e4e4e7', height: 35, textColor: 'white', thickness: 8 },
};

export function specKg(w) {
  return SPEC_KG[w] || { color: '#374151', height: 100, textColor: 'white', thickness: 8 };
}

/** Luminancia relativa (WCAG) de un color #RRGGBB. */
function luminancia(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map(i => { const c = parseInt(m[1].slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** (blanco si su contraste llega a 3:1, texto grande y en negrita) Texto que se lee sobre ese fondo: claro sobre rojo/azul/verde/negro, oscuro sobre amarillo/blanco/gris claro. */
export const colorTexto = hex => (luminancia(hex) > 0.3 ? '#111111' : '#FFFFFF');

/**
 * Discos por lado (de mayor a menor) agrupados por peso, en orden de carga.
 * `colores`: { kg: '#hex' } del meet; sin dato, el color reglamentario.
 * @returns {{ kg: number, n: number, color: string, texto: string }[]}
 */
export function agruparDiscos(discos = [], colores = {}) {
  const tramos = [];
  for (const w of discos) {
    const kg = Number(w);
    const ult = tramos[tramos.length - 1];
    if (ult && ult.kg === kg) { ult.n++; continue; }
    const color = colores[kg] || specKg(kg).color;
    tramos.push({ kg, n: 1, color, texto: colorTexto(color) });
  }
  return tramos;
}
