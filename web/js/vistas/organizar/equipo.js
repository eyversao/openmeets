/* ============================================================
   OPENMEETS — Pestaña «Equipo»: accesos con PIN propio (director, mesa, pesaje, locutor, solo lectura) y auditoría
   El PIN se muestra una sola vez, con el QR del enlace de entrada. La auditoría registra quién cambió qué y cuándo.
   ============================================================ */

import { el, reemplazar, copiar, hora, fecha, hace } from '../../util.js';
import { t } from '../../i18n.js';
import { pedir } from '../../api.js';
import { boton, campo, select, modal, toast, vacio, pildora, confirmar, errorEstado, esqueletoLista } from '../../ui.js';
import { qrTrazo } from '../../nucleo/qr.js';
import { basesParaTelefonos } from './logica.js';
import { avisoError } from './comun.js';
import { cargarRol, NOMBRE_ROL } from '../federacion/rol.js';

const DESCRIPCION = {
  director: 'Dirige todo el meet: atletas, mesa, jueces y datos. No lo borra ni crea accesos.',
  mesa: 'Marca resultados y pesos de intentos de UNA plataforma y manda el vivo de esa plataforma.',
  pesaje: 'Anota peso corporal, clase, rack y la apertura de los intentos. No toca resultados.',
  locutor: 'Ve la hoja del locutor y lo público. No escribe nada.',
  lectura: 'Ve el panel central y los resultados. No escribe nada.',
};
const caducidades = () => [{ valor: '12', texto: t('12 horas') }, { valor: '24', texto: t('1 día') }, { valor: '48', texto: t('2 días') }, { valor: '168', texto: t('7 días') }, { valor: '720', texto: t('30 días') }];
const TONO = { activo: 'ok', revocado: 'mal', caducado: 'aviso' };

export async function montar(st) {
  st.ctx.app.estilos('federacion');
  const base = `/api/meets/${encodeURIComponent(st.id)}`;
  const raiz = el('div.apilar-grande.fed-equipo');
  const rolFed = await cargarRol();
  const esOrg = !rolFed.rol || rolFed.rol === 'organizador';
  const accesos = el('div.apilar-chico');
  const auditoria = el('div.apilar-chico');

  /* ---------- accesos ---------- */
  function mostrarPin({ rol, pin }) {
    const info = st.ctx.app.info() || {};
    const bases = basesParaTelefonos({ origen: location.origin, ips: info.ips || [], puerto: info.puerto });
    let baseUrl = bases[0] || location.origin;
    const qrCaja = el('div.org-qr.fed-qr');
    const enlace = el('span.datos.pequeno.suave.truncar');
    const pintarQr = () => {
      const url = `${baseUrl}/entrar#${rol.id}.${pin}`;
      enlace.textContent = `${baseUrl}/entrar`;
      try { const q = qrTrazo(url); qrCaja.replaceChildren(el('svg', { class: 'org-qr-svg', viewBox: `0 0 ${q.tam} ${q.tam}`, role: 'img', 'aria-label': t('Código QR para entrar como {nombre}', { nombre: rol.nombre }), 'shape-rendering': 'crispEdges' }, [el('rect', { width: q.tam, height: q.tam, fill: '#fff' }), el('path', { d: q.d, fill: '#000' })])); }
      catch { qrCaja.replaceChildren(el('p.suave.pequeno', { text: t('No se pudo dibujar el QR. Copia el enlace.') })); }
      return url;
    };
    let url = pintarQr();
    const selBase = bases.length > 1 ? select({ etiqueta: t('Dirección de esta red'), opciones: bases, valor: baseUrl, onChange: v => { baseUrl = v; url = pintarQr(); } }) : null;
    modal({ titulo: t('Acceso creado para {nombre}', { nombre: rol.nombre }), contenido: el('div.apilar', {}, [
      el('p', { text: t('Este PIN no se vuelve a mostrar. Entrégalo ahora (o haz que escanee el QR): quien lo tenga entra como {rol}.', { rol: t(NOMBRE_ROL[rol.rol]).toLowerCase() }) }),
      el('div.fed-pin-grande.datos', { 'aria-label': t('PIN') }, `${pin.slice(0, 3)} ${pin.slice(3)}`),
      selBase, qrCaja, enlace,
      el('div.fila', {}, [
        boton({ texto: t('Copiar PIN'), icono: 'copiar', variante: 'secundario', tam: 'chico', onclick: async () => toast((await copiar(pin)) ? t('PIN copiado.') : t('No se pudo copiar.'), { tipo: 'ok' }) }),
        boton({ texto: t('Copiar enlace con PIN'), icono: 'enlace', variante: 'secundario', tam: 'chico', onclick: async () => toast((await copiar(url)) ? t('Enlace copiado.') : t('No se pudo copiar.'), { tipo: 'ok' }) }),
      ]),
    ]), acciones: [{ texto: t('Listo, ya lo anoté'), variante: 'primario' }] });
  }

  function formulario() {
    const nombre = campo({ etiqueta: t('Nombre de la persona'), placeholder: t('Ana Gómez'), requerido: true });
    const rol = select({ etiqueta: t('Rol'), opciones: Object.entries(NOMBRE_ROL).map(([valor, texto]) => ({ valor, texto: t(texto) })), valor: 'mesa' });
    const plataforma = select({ etiqueta: t('Plataforma'), opciones: st.plataformas(), valor: st.plataformas()[0] });
    const caduca = select({ etiqueta: t('Caduca en'), opciones: caducidades(), valor: '48' });
    const ayuda = el('p.suave.pequeno');
    const alCambiar = () => { ayuda.textContent = t(DESCRIPCION[rol.valor()]); plataforma.hidden = rol.valor() !== 'mesa'; };
    rol.entrada.addEventListener('change', alCambiar); alCambiar();
    const crear = boton({ texto: t('Crear acceso'), icono: 'plus', variante: 'primario', onclick: async () => {
      if (!nombre.valor().trim()) { nombre.ponerError(t('Ponle un nombre.')); nombre.entrada.focus(); return; }
      crear.cargando(true);
      try {
        const r = await pedir('POST', `${base}/roles`, { nombre: nombre.valor().trim(), rol: rol.valor(), plataforma: rol.valor() === 'mesa' ? plataforma.valor() : '', horas: Number(caduca.valor()) });
        nombre.poner('');
        mostrarPin(r); cargarAccesos(); cargarAuditoria();
      } catch (e) { avisoError(e); } finally { crear.cargando(false); }
    } });
    return el('section.panel.org-seccion', {}, [el('h2.org-sec-titulo', { text: t('Nuevo acceso') }), el('p.suave.pequeno', { text: t('Cada persona del equipo entra con su propio PIN de 6 dígitos. Tú sigues siendo el organizador: ningún rol puede borrar el meet ni crear accesos.') }),
      el('div.formulario', {}, [nombre, el('div.formulario-fila', {}, [rol, plataforma]), caduca, ayuda]), el('div.fila', {}, [crear])]);
  }

  async function cargarAccesos() {
    let lista;
    try { lista = (await pedir('GET', `${base}/roles`)).roles; } catch (e) { reemplazar(accesos, errorEstado({ titulo: t('No se pudieron cargar los accesos'), texto: e.message, reintentar: cargarAccesos })); return; }
    if (!lista.length) { reemplazar(accesos, vacio({ icono: 'usuarios', titulo: t('Aún no hay accesos de equipo'), texto: t('Crea el primero arriba: mesa por plataforma, pesaje, locutor o director técnico.') })); return; }
    reemplazar(accesos, lista.map(r => el('div.org-fila-simple.fed-acceso', {}, [
      el('span.fed-acceso-quien', {}, [el('strong', { text: r.nombre }), el('span.suave.pequeno', { text: ` ${t(NOMBRE_ROL[r.rol])}${r.plataforma ? ` · ${r.plataforma}` : ''}` })]),
      el('span.fila-juntos', {}, [
        pildora({ texto: t(r.estado === 'activo' ? 'Activo' : r.estado === 'revocado' ? 'Revocado' : 'Caducado'), tono: TONO[r.estado] }),
        r.estado === 'activo' ? el('span.suave.pequeno', { text: t('caduca {fecha}', { fecha: `${fecha(new Date(r.caduca).toISOString().slice(0, 10), { day: 'numeric', month: 'short' })} ${hora(r.caduca)}` }) }) : null,
        r.estado === 'activo' ? boton({ texto: t('Revocar'), variante: 'secundario', tam: 'chico', onclick: async () => {
          if (!(await confirmar({ titulo: t('Revocar el acceso de {nombre}', { nombre: r.nombre }), texto: t('Deja de poder entrar al instante, incluso si ya tenía la sesión abierta.'), confirmar: t('Revocar'), peligro: true }))) return;
          try { await pedir('DELETE', `${base}/roles/${encodeURIComponent(r.id)}`); toast(t('Acceso revocado.'), { tipo: 'ok' }); cargarAccesos(); cargarAuditoria(); } catch (e) { avisoError(e); }
        } }) : null,
      ]),
    ])));
  }

  /* ---------- auditoría ---------- */
  const fQuien = campo({ etiqueta: t('Quién'), placeholder: t('Ana, mesa, organizador…') });
  const fTexto = campo({ etiqueta: t('Qué contiene'), placeholder: t('peso, resultado, sede…') });
  const fDesde = select({ etiqueta: t('Desde'), opciones: [{ valor: '0', texto: t('Todo') }, { valor: '1', texto: t('Última hora') }, { valor: '24', texto: t('Último día') }], valor: '0' });
  const consulta = () => {
    const q = new URLSearchParams();
    if (fQuien.valor().trim()) q.set('quien', fQuien.valor().trim());
    if (fTexto.valor().trim()) q.set('q', fTexto.valor().trim());
    if (fDesde.valor() !== '0') q.set('desde', String(Date.now() - Number(fDesde.valor()) * 3600000));
    return q.toString();
  };
  const csv = boton({ texto: t('Exportar CSV'), icono: 'descargar', variante: 'secundario', tam: 'chico', href: `${base}/auditoria.csv`, download: `${st.id}-auditoria.csv`, 'data-externo': '' });
  async function cargarAuditoria() {
    csv.setAttribute('href', `${base}/auditoria.csv${consulta() ? `?${consulta()}` : ''}`);
    reemplazar(auditoria, esqueletoLista(2, 'fila'));
    let es;
    try { es = (await pedir('GET', `${base}/auditoria?${consulta()}`)).entradas; } catch (e) { reemplazar(auditoria, errorEstado({ titulo: t('No se pudo cargar la auditoría'), texto: e.message, reintentar: cargarAuditoria })); return; }
    if (!es.length) { reemplazar(auditoria, vacio({ icono: 'documento', titulo: t('Sin movimientos con esos filtros'), texto: t('Cada resultado, peso o cambio de datos que haga el equipo aparece aquí, con quién lo hizo y cuándo.') })); return; }
    reemplazar(auditoria, el('div.tabla-caja', {}, el('table.tabla.fed-aud-tabla', {}, [
      el('thead', {}, el('tr', {}, [t('Cuándo'), t('Quién'), t('Qué')].map(h => el('th', { text: h })))),
      el('tbody', {}, es.map(e => el('tr', {}, [el('td.datos', { title: new Date(e.ts).toLocaleString(), text: `${hora(e.ts)} · ${hace(e.ts)}` }), el('td', {}, el('strong', { text: e.quien })), el('td.fed-aud-resumen', { text: e.resumen })]))),
    ])));
  }
  const filtros = el('div.formulario-fila.fed-filtros', {}, [fQuien, fTexto, fDesde]);
  for (const c of [fQuien.entrada, fTexto.entrada]) c.addEventListener('keydown', e => { if (e.key === 'Enter') cargarAuditoria(); });
  fDesde.entrada.addEventListener('change', cargarAuditoria);

  reemplazar(raiz, [
    esOrg ? formulario() : null,
    esOrg ? el('section.panel.org-seccion', {}, [el('h2.org-sec-titulo', { text: t('Accesos del equipo') }), accesos]) : null,
    el('section.panel.org-seccion', {}, [
      el('div.org-cab-fila', {}, [el('h2.org-sec-titulo', { text: t('Auditoría') }), el('div.fila-juntos', {}, [boton({ texto: t('Buscar'), icono: 'refrescar', variante: 'secundario', tam: 'chico', onclick: cargarAuditoria }), csv])]),
      el('p.suave.pequeno', { text: t('Quién cambió qué y cuándo. No guarda teléfonos, correos ni direcciones IP.') }), filtros, auditoria,
    ]),
  ]);
  if (esOrg) cargarAccesos();
  cargarAuditoria();
  return { nodo: raiz, alActivar: () => { if (esOrg) cargarAccesos(); cargarAuditoria(); } };
}
