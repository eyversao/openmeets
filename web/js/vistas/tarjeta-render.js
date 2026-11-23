/* ============================================================
   OPENMEETS — Imagen para redes: dibuja con Canvas 2D (sin librerías) el diseño de nucleo/tarjeta-social.js
   y la ofrece para descargar o compartir. Espera a las fuentes de la web antes de medir y dibujar.
   ============================================================ */

import { el } from '../util.js';
import { t } from '../i18n.js';
import { boton, modal, toast } from '../ui.js';
import { FORMATOS, PALETA, TARJETAS, datosTarjeta, fuenteCss, nombreArchivo } from '../nucleo/tarjeta-social.js';

const LOGO = 'M49.34 18.46 A22 22 0 1 1 42.33 12.58'; // favicon.svg (viewBox 4 4 56 56)

async function fuentesListas() {
  try {
    await Promise.all(['400 40px Geist', '500 40px Geist', '600 40px Geist', '700 40px Geist', '500 40px "Geist Mono"', '400 40px "Instrument Serif"'].map(f => document.fonts.load(f, 'Aa0')));
    await document.fonts.ready;
  } catch { /* sin API de fuentes: se usa la de respaldo */ }
}

/** Dibuja un diseño en un canvas. */
export function dibujar(diseno, canvas = document.createElement('canvas')) {
  canvas.width = diseno.w; canvas.height = diseno.h;
  const c = canvas.getContext('2d');
  c.textBaseline = 'top';
  for (const b of diseno.bloques) {
    if (b.k === 'rect') {
      c.fillStyle = PALETA[b.color] || b.color;
      c.beginPath();
      if (b.r && c.roundRect) c.roundRect(b.x, b.y, b.w, b.h, b.r); else c.rect(b.x, b.y, b.w, b.h);
      c.fill();
    } else if (b.k === 'texto') {
      c.font = fuenteCss(b); c.fillStyle = PALETA[b.color] || b.color;
      c.textAlign = b.alinear === 'cen' ? 'center' : b.alinear === 'der' ? 'right' : 'left';
      c.fillText(b.texto, b.x, b.y);
    } else if (b.k === 'anillo') {
      const n = b.segmentos.length || 9, gap = 0.09, paso = (Math.PI * 2) / n;
      c.lineWidth = b.grosor; c.lineCap = 'butt';
      b.segmentos.forEach((s, i) => {
        const a0 = -Math.PI / 2 + i * paso + gap / 2;
        c.strokeStyle = PALETA[s.color] || PALETA.linea;
        c.beginPath(); c.arc(b.cx, b.cy, b.r, a0, a0 + paso - gap); c.stroke();
      });
    } else if (b.k === 'logo') {
      c.save(); c.translate(b.x, b.y); c.scale(b.tam / 56, b.tam / 56); c.translate(-4, -4);
      c.strokeStyle = c.fillStyle = PALETA.papel; c.lineWidth = 9; c.lineCap = 'butt';
      c.stroke(new Path2D(LOGO)); c.beginPath(); c.arc(32, 32, 6, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }
  return canvas;
}

/** Medidor con las mismas fuentes que se dibujan. */
function medidor() {
  const c = document.createElement('canvas').getContext('2d');
  return (texto, tam, peso, fam) => { c.font = fuenteCss({ tam, peso, fam }); return c.measureText(texto).width; };
}

/** Canvas listo de una tarjeta: tipo 'record' | 'atleta' | 'podio'; `ref` = { aid, lev } | { aid } | { categoria }. null si no hay datos. */
export async function crearTarjeta(tipo, meet, ref, formato = 'feed') {
  const datos = datosTarjeta(tipo, meet, ref);
  if (!datos || !TARJETAS[tipo] || !FORMATOS[formato]) return null;
  await fuentesListas();
  return dibujar(TARJETAS[tipo](datos, formato, medidor()));
}

const aBlob = canvas => new Promise((ok, mal) => canvas.toBlob(b => (b ? ok(b) : mal(new Error('No se pudo generar la imagen'))), 'image/png'));

/** Descarga directa con a.download. */
export function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Comparte el PNG con el menú del sistema si se puede (si no, devuelve false). */
export async function compartirBlob(blob, nombre, texto) {
  const archivo = new File([blob], nombre, { type: 'image/png' });
  if (!navigator.share || !navigator.canShare?.({ files: [archivo] })) return false;
  try { await navigator.share({ files: [archivo], text: texto }); return true; } catch (e) { if (e.name === 'AbortError') return true; return false; }
}

/**
 * Ventana «Imagen para redes»: vista previa, 1080×1350 (Instagram) o 1080×1920 (historia), descargar y compartir.
 * `titulo` y `nombreBase` salen del atleta o la categoría.
 */
export async function abrirImagenRedes(meet, tipo, ref, { nombreBase = '' } = {}) {
  let formato = 'feed', canvas = null, blob = null;
  const vista = el('div.tarjeta-vista', {}, el('p.suave', { text: t('Preparando la imagen…') }));
  const nota = el('p.suave.pequeno', { text: t('Se genera aquí, en tu equipo: no sale nada a internet.') });
  const botones = el('div.fila', {});
  const m = modal({ titulo: t('Imagen para redes'), contenido: el('div.apilar', {}, [botones, vista, nota]) });

  async function pintar() {
    blob = null;
    canvas = await crearTarjeta(tipo, meet, ref, formato);
    if (!canvas) { vista.replaceChildren(el('p.suave', { text: t('Todavía no hay datos para esta imagen.') })); return; }
    canvas.setAttribute('aria-label', t('Vista previa de la imagen'));
    canvas.style.cssText = 'display:block;margin:0 auto;max-width:100%;max-height:58vh;width:auto;height:auto;border-radius:12px';
    vista.replaceChildren(canvas);
    blob = await aBlob(canvas);
    botones.replaceChildren(
      ...[['feed', t('Instagram 1080×1350')], ['historia', t('Historia 1080×1920')]].map(([f, txt]) => boton({ texto: txt, variante: f === formato ? 'primario' : 'secundario', 'aria-pressed': f === formato ? 'true' : 'false', onclick: () => { formato = f; pintar(); } })),
      boton({ texto: t('Descargar PNG'), icono: 'descargar', variante: 'secundario', onclick: () => descargarBlob(blob, nombreArchivo(tipo, nombreBase || meet.nombre, formato)) }),
      navigator.share ? boton({ texto: t('Compartir'), icono: 'enlace', variante: 'secundario', onclick: async () => { if (!(await compartirBlob(blob, nombreArchivo(tipo, nombreBase || meet.nombre, formato), meet.nombre))) toast(t('Tu navegador no puede compartir imágenes: usa Descargar.'), { tipo: 'info' }); } }) : null,
    );
  }
  await pintar();
  return m;
}
