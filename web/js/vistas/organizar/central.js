/* ============================================================
   OPENMEETS — Pestaña «Central»: todas las plataformas a la vez
   Atleta actual, reloj, último resultado, progreso del grupo, jueces y conexión, con alertas
   (plataforma parada más de 3 min, juez desconectado, servidor o nube caídos).
   ============================================================ */

import { el, reemplazar, hora } from '../../util.js';
import { t } from '../../i18n.js';
import { pedir } from '../../api.js';
import { boton, pildora, vacio } from '../../ui.js';
import * as C from '../../nucleo/competencia.js';
import * as R from '../../nucleo/reloj.js';
import { estadoPlataforma, alertasGlobales } from '../../nucleo/federacion.js';
import { enlaceExterno } from './comun.js';

const TONO = { activa: 'ok', parada: 'mal', espera: 'info', terminada: 'senal', 'sin-datos': 'aviso' };
const TEXTO = { activa: 'En marcha', parada: 'Parada', espera: 'En espera', terminada: 'Terminada', 'sin-datos': 'Sin datos' };
const kgT = n => `${String(Number(n) || 0).replace('.', ',')} kg`;
const dentro = (clave, datos) => t(clave, datos);

export function montar(st) {
  st.ctx.app.estilos('federacion');
  const raiz = el('div.apilar.fed-central');
  const avisos = el('div.fed-avisos', { role: 'alert' });
  const rejilla = el('div.rejilla-2.fed-plats');
  raiz.append(avisos, rejilla);
  let nube = null, activo = true;

  const plataformas = () => [...new Set([...st.plataformas(), ...Object.keys(st.vivos || {})])];

  async function mirarNube() {
    try { nube = await pedir('GET', '/api/nube/estado', undefined, { reintentos: 0 }); } catch { nube = null; }
    pintar();
  }

  function tarjeta(p, ahora) {
    const e = estadoPlataforma(st.meet, p, st.vivos[p] || st.meet.vivo?.[p] || null, ahora);
    const base = `/organizar/${encodeURIComponent(st.id)}`;
    const a = e.actual;
    const prog = e.progreso;
    const faltan = prog.pendientes;
    return el('article.panel.fed-plat', { class: e.estado, 'aria-label': p }, [
      el('header.fed-plat-cab', {}, [el('h3.fed-plat-nombre', { text: p }), pildora({ texto: t(TEXTO[e.estado]), tono: TONO[e.estado], punto: e.estado === 'activa' })]),
      e.alertas.length ? el('ul.fed-alertas', {}, e.alertas.map(x => el('li.fed-alerta', { class: x.tipo }, [dentro(x.clave, x.datos)]))) : null,
      el('div.fed-plat-actual', {}, a ? [
        el('div.fed-plat-quien', {}, [el('strong.fed-plat-nombre-atleta', { text: a.nombre }), el('span.suave.pequeno', { text: [t(C.LEVANTES[e.lev] || ''), a.n != null ? t('{n}.º intento', { n: Number(a.n) + 1 }) : '', kgT(a.kg)].filter(Boolean).join(' · ') })]),
        e.reloj ? el('span.fed-reloj.datos', { class: e.reloj.estado, role: 'timer', text: R.texto(e.reloj.restante) }) : null,
      ] : [el('span.suave', { text: e.estado === 'sin-datos' ? t('La mesa de esta plataforma aún no ha publicado nada.') : t('Nadie en tarima ahora.') })]),
      e.ultimo ? el('p.fed-ultimo.pequeno', {}, [el('span.suave', { text: `${t('Último')}: ` }), el('strong', { text: e.ultimo.nombre }), ` · ${kgT(e.ultimo.kg)} · `, el('span', { class: e.ultimo.resultado === 1 ? 'fed-ok' : 'fed-mal', text: e.ultimo.resultado === 1 ? t('válido') : t('nulo') }), e.ultimo.ts ? el('span.suave', { text: ` · ${hora(e.ultimo.ts)}` }) : null]) : null,
      prog.total ? el('div.fed-prog', {}, [
        el('div.fed-prog-barra', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': prog.pct, 'aria-label': t('Progreso del grupo') }, el('span', { style: { width: `${prog.pct}%` } })),
        el('span.pequeno.suave', { text: faltan ? t('Faltan {n} intentos{grupo}', { n: faltan, grupo: prog.grupo ? ` · ${t('Grupo {g}', { g: prog.grupo })}` : '' }) : t('Todos los intentos decididos') }),
      ]) : null,
      e.jueces.length ? el('div.fed-jueces', { 'aria-label': t('Jueces') }, e.jueces.map(j => el('span.fed-juez', { class: j.conectado ? 'on' : 'off', title: j.conectado ? t('Conectado') : t('Sin conexión') }, [el('i', { 'aria-hidden': 'true' }), t(j.nombre)]))) : null,
      el('div.fed-plat-acciones', {}, [
        boton({ texto: t('Mesa'), icono: 'luces', variante: 'secundario', tam: 'chico', onclick: () => { st.filtroPlataforma = p; st.irA('mesa'); } }),
        enlaceExterno(`/meets/${encodeURIComponent(st.id)}/pantalla?t=${encodeURIComponent(p)}`, t('Pantalla'), 'pantalla'),
        enlaceExterno(`/meets/${encodeURIComponent(st.id)}/locutor?t=${encodeURIComponent(p)}`, t('Locutor'), 'pin'),
      ]),
    ]);
  }

  let firma = '';
  /** Repinta solo si algo cambió (así los botones no pierden el foco); el reloj se actualiza en su sitio cada segundo. */
  function pintar() {
    if (!activo || st.tab !== 'central') return;
    const ahora = Date.now();
    const conexion = st.canal?.estado?.() || 'conectado';
    const glob = alertasGlobales({ conexion, nube });
    const lista = plataformas();
    const estados = lista.map(p => estadoPlataforma(st.meet, p, st.vivos[p] || st.meet.vivo?.[p] || null, ahora));
    const f = JSON.stringify([glob, estados.map(e => ({ ...e, reloj: e.reloj && { estado: e.reloj.estado } }))]);
    if (f !== firma) {
      firma = f;
      reemplazar(avisos, glob.map(x => el('p.fed-alerta-global', { class: x.tipo }, dentro(x.clave, x.datos))));
      reemplazar(rejilla, lista.length ? lista.map(p => tarjeta(p, ahora)) : vacio({ icono: 'barra', titulo: t('Este meet no tiene plataformas'), texto: t('Añádelas en Datos para ver aquí cada tarima.') }));
    }
    rejilla.querySelectorAll('.fed-plat').forEach((n, i) => { const r = estados[i]?.reloj, x = n.querySelector('.fed-reloj'); if (r && x) x.textContent = R.texto(r.restante); });
  }

  const baja = st.escuchar(() => { if (st.tab === 'central') pintar(); });
  const pulso = setInterval(pintar, 1000);
  const pulsoNube = setInterval(() => { if (st.tab === 'central') mirarNube(); }, 20000);
  pintar();
  return { nodo: raiz, alActivar() { pintar(); mirarNube(); }, salir() { activo = false; clearInterval(pulso); clearInterval(pulsoNube); baja(); } };
}
