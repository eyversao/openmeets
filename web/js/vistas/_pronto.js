/* Marcador de las vistas que aún no se han escrito: mismo marco y mismo contenedor que las reales. */
import { el } from '../util.js';
import { t } from '../i18n.js';
import { vacio } from '../ui.js';

export function pronto(ctx, titulo, texto) {
  ctx.app.titulo(t(titulo));
  ctx.raiz.append(el('div.contenedor', {}, [
    el('header.cabecera-vista', {}, [el('h1.titular', {}, [el('span.resaltado', { text: t(titulo) })])]),
    vacio({ icono: 'reloj', titulo: t('Pronto'), texto: t(texto || 'Esta pantalla se está construyendo.'), accion: { texto: t('Ir al inicio'), icono: 'inicio', href: '/' } }),
  ]));
}
