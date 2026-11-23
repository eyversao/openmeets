/* ============================================================
   OPENMEETS — Hoja del locutor  (/meets/:id/locutor?t=<plataforma>)
   Atleta en tarima con lo que hay que anunciar, los 3 siguientes y frases sugeridas. En vivo, letra grande, siempre oscura.
   ============================================================ */

import { el } from '../../util.js';
import { t } from '../../i18n.js';
import { pedir } from '../../api.js';
import { pildoraConexion, errorEstado } from '../../ui.js';
import { conectarTarima } from '../pantalla.js';
import { datosLocutor } from '../../nucleo/federacion.js';

const kgT = n => `${String(Number(n) || 0).replace('.', ',')} kg`;

export default async function (ctx) {
  const { id } = ctx.params;
  ctx.app.estilos('federacion');
  ctx.app.titulo(t('Locutor'));
  const raiz = ctx.raiz;
  raiz.classList.add('fed-locutor');
  const cab = el('header.loc-cab'), cuerpo = el('main.loc-cuerpo', { 'aria-live': 'polite' });
  const pildora = pildoraConexion('reconectando');
  raiz.replaceChildren(cab, cuerpo);
  let marcas = {}, firma = '';

  const cargarMarcas = () => pedir('GET', `/api/meets/${encodeURIComponent(id)}/locutor`, undefined, { reintentos: 0 }).then(r => { marcas = r.marcas || {}; firma = ''; pintar(); }, () => {});

  function pintar() {
    const T = tarima, meet = T.s.meet;
    if (T.s.error) { cuerpo.replaceChildren(errorEstado({ titulo: t('No encontramos este meet'), texto: t('El enlace puede estar mal escrito o el meet ya no existe.') })); return; }
    pildora.poner(T.canal.estado());
    if (!meet) { cuerpo.replaceChildren(el('p.loc-espera', { text: t('Cargando el meet…') })); return; }
    const p = T.plataforma(), plats = T.plataformas();
    const d = datosLocutor(meet, { ...(T.vivo() || {}), plataforma: p }, marcas);
    const f = JSON.stringify([meet.nombre, p, plats, d]);
    if (f === firma) return;
    firma = f;
    cab.replaceChildren(el('h1.loc-meet', { text: meet.nombre }),
      el('div.loc-ctl', {}, [
        plats.length > 1 ? el('label.tv-plat', {}, [el('span', { text: t('Plataforma') }), el('select', { onchange: e => { const u = new URL(location.href); u.searchParams.set('t', e.target.value); history.replaceState({}, '', u); T.elegir(e.target.value); } }, plats.map(x => el('option', { value: x, text: x, selected: x === p })))]) : el('span', { text: p }),
        pildora]));
    const sig = el('section.loc-sig', {}, [el('h2.loc-h2', { text: t('Siguientes') }), d.siguientes.length ? el('ol.loc-lista', {}, d.siguientes.map(s => el('li', {}, [el('strong', { text: s.nombre }), el('span.suave', { text: s.club ? ` · ${s.club}` : '' }), el('span.datos.loc-kg', { text: `${kgT(s.kg)}${s.n ? ` · ${t('{n}.º', { n: s.n })}` : ''}` })]))) : el('p.suave', { text: t('No hay más atletas en la cola de esta plataforma.') })]);
    if (!d.hayAtleta) { cuerpo.replaceChildren(el('p.loc-espera', { text: t('Esperando al siguiente atleta') }), sig); return; }
    cuerpo.replaceChildren(
      el('section.loc-actual', {}, [
        el('p.loc-meta', { text: [t(d.levNombre), t('{n}.º intento', { n: d.intento }), d.rack ? t('Rack {n}', { n: d.rack }) : ''].filter(Boolean).join(' · ') }),
        el('h2.loc-nombre', { text: d.nombre }),
        el('p.loc-club', { text: [d.club, d.categoria].filter(Boolean).join(' · ') }),
        el('p.loc-peso.datos', { text: kgT(d.kg) }),
        el('ul.loc-datos', {}, [
          d.record ? el('li.loc-record', { text: d.record.nivel ? d.record.etiqueta || t('Va por récord') : t('Va por récord') }) : null,
          d.marca ? el('li', { text: d.marca.superaMarca ? t('Marca personal en juego: la anterior es {kg}', { kg: kgT(d.marca.kg) }) : t('Su mejor marca previa: {kg}', { kg: kgT(d.marca.kg) }) }) : null,
          d.puesto ? el('li', { text: d.puesto === 1 ? t('Líder de su categoría (de {de})', { de: d.de }) : t('Puesto {puesto} de {de} ahora', { puesto: d.puesto, de: d.de }) }) : null,
          d.necesita ? el('li.loc-podio', { text: d.necesita.alcanza ? t('Con este peso pelea el {medalla}', { medalla: d.necesita.medalla }) : t('Necesita {kg} en el {ordinal} para el {medalla}', { kg: kgT(d.necesita.kg), ordinal: d.ordinal, medalla: d.necesita.medalla }) }) : null,
        ]),
      ]),
      el('section.loc-frases', {}, [el('h2.loc-h2', { text: t('Frases sugeridas') }), el('ul.loc-lista', {}, d.frases.map(x => el('li.loc-frase', { text: t(x.clave, x.datos) })))]),
      sig);
  }

  const tarima = conectarTarima(id, { plataforma: ctx.consulta.get('t') || '', alCambio: pintar });
  cargarMarcas();
  const h = setInterval(cargarMarcas, 30000);
  return () => { clearInterval(h); tarima.cerrar(); raiz.classList.remove('fed-locutor'); };
}
