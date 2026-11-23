/* Atletas: buscador de fichas armadas con todos los meets públicos de este servidor. */
import { el, reemplazar, rebote, kg, plural, fecha } from '../util.js';
import { t } from '../i18n.js';
import { pedir } from '../api.js';
import { campo, vacio, errorEstado, esqueletoLista, boton } from '../ui.js';
import { normalizarNombre } from '../nucleo/competencia.js';

export default async function (ctx) {
  const { raiz, app } = ctx;
  app.titulo(t('Atletas'));
  app.estilos('records');
  let lista = null, fallo = null, busqueda = '';
  const cuerpo = el('div.apilar');
  const buscar = campo({ etiqueta: t('Buscar un atleta'), tipo: 'search', placeholder: t('Nombre o club'), onInput: rebote(v => { busqueda = v; pintar(); }, 120) });
  reemplazar(raiz, el('div.contenedor.contenedor-estrecho', {}, [
    el('header.cabecera-vista', {}, [
      el('h1.titular', {}, [el('span.resaltado', { text: t('Atletas') })]),
      el('p.subtitulo', { text: t('La ficha de cada atleta con sus meets, marcas y récords en este servidor.') }),
      el('div.fila', {}, [boton({ texto: t('Récords'), icono: 'trofeo', variante: 'secundario', href: '/records' })]),
    ]),
    buscar, cuerpo,
  ]));

  function pintar() {
    if (!lista) {
      reemplazar(cuerpo, fallo
        ? errorEstado({ titulo: t('No logramos traer a los atletas'), texto: t('Tu teléfono no llegó a OpenMeets. Suele ser la red, no tú.'), detalle: fallo.message, pasos: [t('Revisa que estés en la misma Wi-Fi que la mesa.'), t('Si sigue igual, pídele al organizador que abra OpenMeets en su equipo.')], reintentar: cargar })
        : esqueletoLista(4));
      return;
    }
    if (!lista.length) { reemplazar(cuerpo, vacio({ icono: 'usuarios', titulo: t('Aún no hay atletas'), texto: t('Las fichas aparecen solas cuando un meet público tiene atletas inscritos.'), accion: { texto: t('Ver los meets'), icono: 'flecha-der', href: '/' } })); return; }
    const q = normalizarNombre(busqueda);
    const f = q ? lista.filter(x => normalizarNombre(`${x.nombre} ${x.club}`).includes(q)) : lista;
    if (!f.length) { reemplazar(cuerpo, vacio({ icono: 'buscar', titulo: t('Nadie coincide con «{q}»', { q: busqueda.trim() }), texto: t('Prueba con otro nombre, sin tildes o con solo el apellido.'), accion: { texto: t('Quitar la búsqueda'), icono: 'x', onclick: () => { buscar.poner(''); busqueda = ''; pintar(); } } })); return; }
    reemplazar(cuerpo, [
      el('p.pequeno.suave', { role: 'status', text: plural(f.length, 'atleta', 'atletas') }),
      el('ul.rc-lista', {}, f.slice(0, 200).map(x => el('li', {}, el('a.rc-fila', { href: `/atletas/${encodeURIComponent(x.slug)}` }, [
        el('div', {}, [el('b', { text: x.nombre }), el('small', { text: [x.sexo === 'F' ? t('Mujer') : t('Hombre'), x.club, plural(x.meets, 'meet', 'meets'), x.ultimaFecha ? fecha(x.ultimaFecha) : ''].filter(Boolean).join(' · ') })]),
        el('div.rc-fila-total.datos', {}, [x.mejorTotal ? kg(x.mejorTotal) : '—', el('small', { text: t('mejor total') })]),
      ])))),
      f.length > 200 ? el('p.pequeno.suave', { text: t('Se muestran 200. Escribe más del nombre para acotar.') }) : null,
    ]);
  }
  async function cargar() {
    try { lista = (await pedir('GET', '/api/atletas')).atletas; fallo = null; } catch (e) { fallo = e; }
    pintar();
  }
  pintar();
  await cargar();
}
