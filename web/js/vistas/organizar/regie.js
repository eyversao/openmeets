/* ============================================================
   OPENMEETS — Pestaña «Transmisión» (regie) /organizar/:id/regie
   Controla qué enseña el HUD de OBS (/meets/:id/hud). AUTO: el HUD sigue el vivo y la regie solo interviene;
   MANUAL: la escena la fija el operador. Cada escena tiene su miniatura en vivo (el mismo componente del HUD)
   y atajos 1-9. También genera las imágenes para redes (récord, resultado de un atleta, podio).
   ============================================================ */

import { el, reemplazar, copiar } from '../../util.js';
import { t } from '../../i18n.js';
import { boton, campo, select, segmentado, toast } from '../../ui.js';
import * as C from '../../nucleo/competencia.js';
import { ESCENAS, REGIE_INICIAL, DUR_INTERVENCION, normalizarRegie, escenaEfectiva, datosEscena, categoriasConTotal, logoActual } from '../../nucleo/regie.js';
import { recordsConImagen } from '../../nucleo/tarjeta-social.js';
import { vistaTarima } from '../pantalla-datos.js';
import { crearFranjaAtleta, construirEscena } from '../hud-escenas.js';
import { abrirImagenRedes } from '../tarjeta-render.js';
import { avisoError } from './comun.js';

const FIJAS = ['pausa', 'patro', 'oculto'];            // se quedan hasta que el operador cambie
const MAX_LOGOS_CHARS = 56000;                          // el canal admite 64 KB por mensaje
const PRESETS = ['Volvemos en 10 min', 'Descanso entre grupos', 'Cambio de discos'];

/** Reduce una imagen a un data URL pequeño (PNG o WebP) para mandarla por el canal. */
async function logoPequeno(archivo) {
  const bmp = await createImageBitmap(archivo);
  for (const k of [320, 240, 160]) {
    const e = Math.min(1, k / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * e)); c.height = Math.max(1, Math.round(bmp.height * e));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    for (const [tipo, q] of [['image/webp', .85], ['image/png']]) { const u = c.toDataURL(tipo, q); if (u.length <= 38000 && u.startsWith(`data:${tipo}`)) return u; }
  }
  throw new Error(t('Ese logo pesa demasiado: usa una imagen más sencilla.'));
}

export function montar(st) {
  const app = st.ctx.app;
  ['luces', 'pantalla', 'regie'].forEach(n => app.estilos(n));
  let plat = st.plataformas()[0];
  const regies = {};
  let desde = Date.now(), timer = 0, activo = false;
  const regie = () => regies[plat] || normalizarRegie(st.meet.regie?.[plat] || REGIE_INICIAL);

  /* ---------- publicar ---------- */
  function publicar(cambios) {
    regies[plat] = normalizarRegie({ ...regie(), ...cambios });
    desde = Date.now();
    pintarControles(); refrescar();
    Promise.resolve(st.canal.publicarRegie(plat, regies[plat])).catch(e => (e.estado >= 400 && e.estado < 500 ? avisoError(e) : toast(t('Sin conexión: la regie se enviará cuando vuelva la red.'), { tipo: 'error' })));
  }
  function elegir(id) {
    if (regie().modo === 'manual') publicar({ escena: id });
    else if (id === 'atleta') publicar({ escena: '', dur: 0 });
    else publicar({ escena: id, dur: FIJAS.includes(id) ? 0 : DUR_INTERVENCION });
  }

  /* ---------- miniaturas ---------- */
  const minis = new Map();
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(es => es.forEach(e => e.target.style.setProperty('--k', String(e.contentRect.width / 1920)))) : null;
  const rejilla = el('div.rg-escenas', { role: 'group', 'aria-label': t('Escenas del HUD') });
  ESCENAS.forEach((e, i) => {
    const escenario = el('div.rg-escenario');
    const mini = el('div.rg-mini', { 'aria-hidden': 'true' }, escenario);
    const aire = el('span.rg-aire', { text: t('Al aire'), hidden: true });
    const b = el('button.rg-esc', { type: 'button', 'aria-label': `${i + 1}. ${t(e.texto)}`, onclick: () => elegir(e.id) }, [mini, el('span.rg-esc-pie', {}, [el('kbd', { text: String(i + 1) }), el('b', { text: t(e.texto) }), aire])]);
    const fa = e.id === 'atleta' ? crearFranjaAtleta('abajo') : null;
    if (fa) escenario.append(fa.franja);
    ro?.observe(mini);
    minis.set(e.id, { b, escenario, aire, fa, firma: null });
    rejilla.append(b);
  });

  const vacioMini = texto => el('p.rg-vacio', { text: texto });
  function refrescar() {
    const r = regie();
    const vivo = st.vivos[plat] || st.meet.vivo?.[plat];
    const vt = vistaTarima(st.meet, vivo);
    const ahora = Date.now();
    const aire = escenaEfectiva(r, vt, vivo, ahora, desde);
    for (const [id, m] of minis) {
      if (id === 'atleta') {
        m.fa.visible(vt.hayAtleta); m.fa.pintar(vt);
        if (m._vacio !== !vt.hayAtleta) { m._vacio = !vt.hayAtleta; m._nota?.remove(); m._nota = m._vacio ? vacioMini(t('Sin atleta en tarima')) : null; if (m._nota) m.escenario.append(m._nota); }
      } else {
        const d = id === 'oculto' ? null : datosEscena(id, st.meet, vt, vivo, r);
        const f = id + (d ? (id === 'patro' ? d.logos.indexOf(logoActual(d.logos, d.seg, ahora)) + ':' + d.logos.length : JSON.stringify(d)) : '');
        if (m.firma !== f) {
          m.firma = f;
          const nodo = d && construirEscena(id, d, 'abajo', ahora);
          if (nodo) nodo.classList.add('entra');
          m.escenario.replaceChildren(nodo || vacioMini(id === 'oculto' ? t('Pantalla limpia') : t('Sin datos todavía')));
        }
      }
      const sel = r.modo === 'manual' ? (r.escena || 'atleta') === id : r.escena === id;
      m.b.classList.toggle('aire', aire === id); m.b.classList.toggle('fijada', sel);
      m.b.setAttribute('aria-pressed', sel ? 'true' : 'false');
      m.aire.hidden = aire !== id;
    }
    estado.textContent = r.modo === 'auto'
      ? (r.escena ? t('AUTO con una intervención: {e}. Pulsa «Atleta en tarima» para volver a seguir el vivo.', { e: t(ESCENAS.find(e => e.id === r.escena)?.texto || '') }) : t('AUTO: el HUD sigue el vivo solo (atleta, revelado, récord y siguiente). Pulsa una escena para intervenir unos segundos.'))
      : t('MANUAL: el HUD enseña lo que elijas, aunque cambie el vivo.');
  }

  /* ---------- controles ---------- */
  const estado = el('p.suave.pequeno', { role: 'status' });
  const url = () => `${location.origin}/meets/${encodeURIComponent(st.id)}/hud?t=${encodeURIComponent(plat)}`;
  const modo = segmentado({ etiqueta: t('Modo'), opciones: [{ valor: 'auto', texto: 'AUTO' }, { valor: 'manual', texto: 'MANUAL' }], valor: 'auto', onChange: v => {
    if (v === regie().modo) return;
    publicar(v === 'manual' ? { modo: 'manual', escena: escenaEfectiva(regie(), vistaTarima(st.meet, st.vivos[plat]), st.vivos[plat], Date.now(), desde) } : { modo: 'auto', escena: '', dur: 0 });
  } });
  const selPlat = st.plataformas().length > 1 ? select({ etiqueta: t('Plataforma'), opciones: st.plataformas(), valor: plat, onChange: v => { plat = v; modo.poner?.(regie().modo, false); pintarControles(); refrescar(); } }) : null;
  const barra = el('div.rg-barra', {}, [selPlat, modo,
    boton({ texto: t('Copiar enlace del HUD'), icono: 'enlace', variante: 'secundario', onclick: async () => { await copiar(url()); toast(t('Enlace copiado. En OBS: Fuente de navegador, 1920×1080.'), { tipo: 'ok' }); } }),
    boton({ texto: t('Abrir el HUD'), icono: 'pantalla', variante: 'fantasma', href: url(), target: '_blank', rel: 'noopener' })]);

  const selCat = select({ etiqueta: t('Categoría del podio'), opciones: [{ valor: '', texto: t('La del atleta en tarima') }], onChange: v => publicar({ cat: v }) });
  const textoPausa = campo({ etiqueta: t('Texto de la pausa'), valor: '', placeholder: t('Volvemos en 10 min'), maxlength: 120, onChange: v => publicar({ texto: v }) });
  const presets = el('div.fila', {}, PRESETS.map(p => boton({ texto: t(p), variante: 'fantasma', onclick: () => { textoPausa.poner(t(p)); publicar({ texto: t(p), escena: 'pausa', dur: 0 }); } })));
  const logosLista = el('ul.rg-logos');
  const selSeg = select({ etiqueta: t('Segundos por logo'), opciones: ['5', '8', '12', '20'], valor: '8', onChange: v => publicar({ patro: { ...regie().patro, seg: Number(v) } }) });
  const archivos = el('input', { type: 'file', accept: 'image/*', multiple: true, 'aria-label': t('Subir logos'), onchange: async e => {
    const nuevos = [];
    for (const f of [...e.target.files]) { try { nuevos.push(await logoPequeno(f)); } catch (x) { toast(x.message, { tipo: 'error' }); } }
    e.target.value = '';
    agregarLogos(nuevos);
  } });
  const urlLogo = campo({ etiqueta: t('O pega la dirección (https://…) de un logo'), placeholder: 'https://', tipo: 'url' });
  function agregarLogos(nuevos) {
    const logos = [...regie().patro.logos, ...nuevos].slice(0, 8);
    if (logos.join('').length > MAX_LOGOS_CHARS) { toast(t('Entre todos los logos pesan demasiado: quita alguno.'), { tipo: 'error' }); return; }
    publicar({ patro: { ...regie().patro, logos } });
  }
  const logosForm = el('div.apilar', {}, [
    el('label.campo-etiqueta', {}, [t('Logos de patrocinadores'), archivos]), urlLogo,
    boton({ texto: t('Añadir por dirección'), variante: 'secundario', onclick: () => { const u = urlLogo.valor().trim(); if (!/^https?:\/\//i.test(u)) { toast(t('La dirección debe empezar por https://'), { tipo: 'error' }); return; } urlLogo.poner(''); agregarLogos([u]); } }),
    logosLista, selSeg,
  ]);

  let firmaCat = '', firmaLogos = '';
  function pintarControles() {
    const r = regie();
    modo.poner?.(r.modo, false);
    const cats = categoriasConTotal(st.atletas());
    const fc = cats.join('|') + r.cat;
    if (fc !== firmaCat) { firmaCat = fc; reemplazar(selCat.entrada, [el('option', { value: '', text: t('La del atleta en tarima') }), ...cats.map(c => el('option', { value: c, text: c }))]); selCat.poner(r.cat); }
    if (document.activeElement !== textoPausa.entrada) textoPausa.poner(r.texto);
    selSeg.poner(String(r.patro.seg));
    const fl = r.patro.logos.length + ':' + r.patro.logos.join('').length;
    if (fl !== firmaLogos) {
      firmaLogos = fl;
      reemplazar(logosLista, r.patro.logos.length ? r.patro.logos.map((l, i) => el('li', {}, [el('img', { src: l, alt: t('Logo {n}', { n: i + 1 }) }), boton({ icono: 'x', etiqueta: t('Quitar el logo {n}', { n: i + 1 }), variante: 'fantasma', onclick: () => publicar({ patro: { ...regie().patro, logos: regie().patro.logos.filter((_, j) => j !== i) } }) })])) : el('li.suave.pequeno', { text: t('Aún no hay logos. Sin logos, la escena Patrocinadores no se muestra.') }));
    }
  }

  /* ---------- imágenes para redes ---------- */
  const redes = el('div.apilar');
  let firmaRedes = '';
  function pintarRedes() {
    const atletas = st.atletas();
    const recs = recordsConImagen(atletas);
    const conTotal = atletas.filter(a => C.total(a) > 0);
    const cats = categoriasConTotal(atletas);
    const f = `${recs.length}|${conTotal.map(a => a.id).join()}|${cats.join()}`;
    if (f === firmaRedes) return;
    firmaRedes = f;
    const selA = select({ etiqueta: t('Resultado de un atleta'), opciones: conTotal.map(a => ({ valor: a.id, texto: a.nombre })) });
    const selC = select({ etiqueta: t('Podio de una categoría'), opciones: cats });
    reemplazar(redes, [
      el('p.suave.pequeno', { text: t('PNG de 1080×1350 (Instagram) o 1080×1920 (historia), con la marca del meet. Se genera en tu equipo.') }),
      recs.length ? el('div.fila', {}, recs.slice(0, 8).map(r => boton({ texto: `${r.etiqueta} · ${t(C.LEVANTES[r.lev])} · ${String(r.kg).replace('.', ',')} kg`, variante: 'secundario', onclick: () => abrirImagenRedes(st.meet, 'record', { aid: r.aid, lev: r.lev }, { nombreBase: r.nombre }) }))) : el('p.suave.pequeno', { text: t('Cuando alguien logre un récord válido podrás sacar su imagen aquí.') }),
      conTotal.length ? el('div.fila.rg-fila', {}, [selA, boton({ texto: t('Imagen del atleta'), icono: 'descargar', variante: 'secundario', onclick: () => abrirImagenRedes(st.meet, 'atleta', { aid: selA.valor() }, { nombreBase: conTotal.find(a => a.id === selA.valor())?.nombre }) })]) : null,
      cats.length ? el('div.fila.rg-fila', {}, [selC, boton({ texto: t('Imagen del podio'), icono: 'descargar', variante: 'secundario', onclick: () => abrirImagenRedes(st.meet, 'podio', { categoria: selC.valor() }, { nombreBase: selC.valor() }) })]) : null,
    ]);
  }

  /* ---------- teclado 1-9 ---------- */
  const teclas = e => {
    if (!activo || e.ctrlKey || e.metaKey || e.altKey || e.target?.matches?.('input, textarea, select')) return;
    const i = '123456789'.indexOf(e.key);
    if (i >= 0 && ESCENAS[i]) { e.preventDefault(); elegir(ESCENAS[i].id); }
  };
  document.addEventListener('keydown', teclas);

  const quitar = [
    st.canal.escucharRegie(m => { for (const [p, r] of Object.entries(m)) if (p !== plat || r.v !== regies[p]?.v) { if (p === plat && r.v !== regies[p]?.v) desde = Date.now(); regies[p] = r; } pintarControles(); refrescar(); }),
    st.escuchar(() => { if (activo) { pintarControles(); pintarRedes(); } }),
  ];

  const nodo = el('div.apilar-grande.rg', {}, [
    el('section.panel.org-seccion', {}, [el('h2.org-sec-titulo', { text: t('Transmisión') }), el('p.suave.pequeno', { text: t('Elige qué enseña el HUD que tienes en OBS. Atajos: teclas 1 a 9.') }), barra, estado, rejilla]),
    el('section.panel.org-seccion', {}, [el('h2.org-sec-titulo', { text: t('Ajustes de las escenas') }), el('div.rg-ajustes', {}, [el('div.apilar', {}, [selCat]), el('div.apilar', {}, [textoPausa, presets]), logosForm])]),
    el('section.panel.org-seccion', {}, [el('h2.org-sec-titulo', { text: t('Imagen para redes') }), redes]),
  ]);

  function alActivar() { activo = true; pintarControles(); pintarRedes(); refrescar(); clearInterval(timer); timer = setInterval(refrescar, 1000); }
  function alDesactivar() { activo = false; clearInterval(timer); }
  function salir() { alDesactivar(); document.removeEventListener('keydown', teclas); ro?.disconnect(); quitar.forEach(f => f()); }
  return { nodo, alActivar, alDesactivar, salir };
}
