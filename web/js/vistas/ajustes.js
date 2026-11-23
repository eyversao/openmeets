/* Ajustes: idioma y tema para todos; PIN, red y carpeta de datos para el organizador; Acerca de. */
import { el, reemplazar, copiar } from '../util.js';
import { t } from '../i18n.js';
import { pedir, api } from '../api.js';
import { boton, campo, selectorIdioma, selectorTema, confirmar, toast, icono } from '../ui.js';
import { simbolo } from '../marca.js';
import { bloqueNube } from './nube-ui.js';

const bloque = (titulo, texto, ...hijos) => el('section.panel.apilar', {}, [el('h2.pub-seccion-titulo', {}, [el('span', { text: titulo })]), texto ? el('p.suave', { text: texto }) : null, ...hijos]);
const enlaceExterno = (href, texto) => el('a.pub-enlace-ext', { href, target: '_blank', rel: 'noopener noreferrer' }, [texto, icono('enlace', { tam: 16 })]);

export default async function (ctx) {
  const { raiz, app } = ctx;
  app.titulo(t('Ajustes'));
  const cuerpo = el('div.apilar-grande');
  reemplazar(raiz, el('div.contenedor.contenedor-estrecho', {}, [el('header.cabecera-vista', {}, [el('h1.titular', {}, [el('span.resaltado', { text: t('Ajustes') })])]), cuerpo]));

  /* ---- organizador: entrar con el PIN ---- */
  function bloqueEntrar() {
    const pin = campo({ etiqueta: t('PIN de organizador'), tipo: 'password', modo: 'numeric', maxlength: 6, placeholder: '••••••', ayuda: t('Lo muestra la consola del equipo de la mesa. Desde ese equipo no hace falta.'), autocompletar: 'one-time-code' });
    const entrar = boton({ texto: t('Entrar como organizador'), icono: 'candado', variante: 'primario', tipo: 'submit' });
    return bloque(t('Organizador'), t('Si organizas un meet desde otro equipo, escribe el PIN para poder crear y dirigir meets.'),
      el('form.formulario', { novalidate: true, onsubmit: async e => {
        e.preventDefault();
        if (!/^\d{6}$/.test(pin.valor().trim())) { pin.ponerError(t('El PIN tiene 6 dígitos.')); return; }
        entrar.cargando(true);
        try { await api.sesion(pin.valor()); await app.recargarInfo(); toast(t('Listo, ya eres organizador.'), { tipo: 'ok' }); pintar(); } catch (err) { pin.ponerError(err.message); entrar.cargando(false); }
      } }, [pin, entrar]));
  }

  /* ---- organizador: ver y cambiar el PIN ---- */
  async function bloquePin() {
    let actual = '';
    try { actual = (await pedir('GET', '/api/pin')).pin; } catch (e) { return bloque(t('PIN de organizador'), e.message); }
    let visible = false;
    const valor = el('output.datos.pub-pin', { text: '••••••', 'aria-live': 'polite' });
    const ver = boton({ texto: t('Mostrar'), icono: 'ojo', variante: 'secundario', onclick: () => { visible = !visible; valor.textContent = visible ? actual : '••••••'; ver.querySelector('.boton-texto').textContent = visible ? t('Ocultar') : t('Mostrar'); } });
    const copia = boton({ texto: t('Copiar'), icono: 'copiar', variante: 'fantasma', onclick: async () => toast((await copiar(actual)) ? t('PIN copiado.') : t('No se pudo copiar. Selecciónalo y cópialo a mano.'), { tipo: 'info' }) });
    const nuevo = campo({ etiqueta: t('PIN nuevo'), modo: 'numeric', maxlength: 6, placeholder: '000000', ayuda: t('Seis dígitos. Al cambiarlo se cierran las sesiones de otros equipos.'), autocompletar: 'off' });
    const cambiar = async pinNuevo => {
      if (pinNuevo !== undefined && !/^\d{6}$/.test(pinNuevo)) { nuevo.ponerError(t('El PIN tiene 6 dígitos.')); nuevo.entrada.focus(); return; }
      if (!(await confirmar({ titulo: t('¿Cambiar el PIN?'), texto: t('Quienes entraron con el PIN anterior tendrán que escribir el nuevo. Desde el equipo de la mesa no cambia nada.'), confirmar: t('Cambiar PIN') }))) return;
      try { await pedir('PUT', '/api/pin', pinNuevo === undefined ? {} : { pin: pinNuevo }); await app.recargarInfo(); toast(t('PIN cambiado.'), { tipo: 'ok' }); pintar(); } catch (e) { nuevo.ponerError(e.message); }
    };
    return bloque(t('PIN de organizador'), t('Con este PIN se entra como organizador desde otro equipo. Quien lo tenga puede crear, editar y borrar meets.'),
      el('div.fila', {}, [valor, ver, copia]),
      el('form.formulario', { novalidate: true, onsubmit: e => { e.preventDefault(); cambiar(nuevo.valor().trim()); } }, [nuevo, el('div.fila', {}, [
        boton({ texto: t('Cambiar PIN'), icono: 'candado', variante: 'primario', tipo: 'submit' }),
        boton({ texto: t('Generar uno al azar'), icono: 'refrescar', variante: 'secundario', onclick: () => cambiar(undefined) }),
      ])]));
  }

  /* ---- organizador: red y carpeta de datos ---- */
  function bloqueRed() {
    const i = app.info() || {};
    const urls = (i.ips || []).map(ip => `http://${ip}:${i.puerto}/`);
    return bloque(t('Red del meet'), urls.length ? t('Abre una de estas direcciones desde los teléfonos y pantallas conectados a la misma Wi-Fi.') : t('No encontramos red. Conecta el equipo a la Wi-Fi o activa el hotspot.'),
      urls.length ? el('ul.pub-lista-red', {}, urls.map(u => el('li', {}, [el('a.datos', { href: u, target: '_blank', rel: 'noopener noreferrer', text: u }), boton({ icono: 'copiar', variante: 'fantasma', etiqueta: t('Copiar {u}', { u }), onclick: async () => toast((await copiar(u)) ? t('Dirección copiada.') : t('No se pudo copiar.'), { tipo: 'info' }) })]))) : null,
      el('p.pequeno.suave', { text: t('Si no abre, permite OpenMeets en el Firewall de Windows para redes privadas.') }));
  }
  const bloqueDatos = () => bloque(t('Carpeta de datos'), t('Cada meet es un archivo en la carpeta de datos, y nunca se borra solo. Cópiala para tener una copia de seguridad.'),
    el('dl.pub-datos', {}, [
      el('dt', { text: 'Windows' }), el('dd.datos', { text: '%LOCALAPPDATA%\\OpenMeets\\datos' }),
      el('dt', { text: 'Mac / Linux' }), el('dd.datos', { text: '~/.openmeets' }),
    ]),
    el('p.pequeno.suave', {}, [t('Se cambia al abrir con '), el('code.datos', { text: '--datos <carpeta>' }), t('. El PIN está en el archivo '), el('code.datos', { text: 'config.json' }), t(' de esa carpeta.')]));

  const bloqueAcerca = () => {
    const i = app.info() || {};
    return bloque(t('Acerca de'), null,
      el('div.fila', {}, [simbolo({ tam: 40, animar: 'vivo' }), el('div', {}, [el('b', { text: 'OpenMeets' }), el('p.pequeno.suave.datos', { text: i.version ? `${t('Versión')} ${i.version}` : t('Versión desconocida') })])]),
      el('p', { text: t('Organiza, dirige, juzga, muestra y sigue competencias de powerlifting en vivo. Código abierto, funciona en tu red local.') }),
      el('p.pequeno.suave', { text: t('Licencia MIT · © 2026 Eyver Gomez') }),
      el('p', {}, [t('Creado por '), el('b', { text: 'Eyver Gomez (@eyversao)' })]),
      el('div.fila', {}, [enlaceExterno('https://instagram.com/eyversao', 'Instagram'), enlaceExterno('https://github.com/eyversao', 'GitHub')]));
  };

  /* ---- nube (modo cuentas): la cuenta de Google ---- */
  function bloqueCuenta() {
    const i = app.info() || {}, u = i.usuario;
    if (!u) return bloque(t('Tu cuenta'), t('Entra con Google para crear y dirigir tus propias competencias.'), boton({ texto: t('Continuar con Google'), icono: 'usuario', variante: 'primario', href: '/organizar' }));
    const salir = boton({ texto: t('Cerrar sesión'), icono: 'x', onclick: async () => {
      salir.cargando(true);
      try { await api.salir(); (await import('../cuenta.js')).salirDeGoogle(i.firebase); await app.recargarInfo(); await pintar(); } catch (e) { toast(e.message, { tipo: 'error' }); salir.cargando(false); }
    } });
    return bloque(t('Tu cuenta'), null, el('div.fila', {}, [icono('usuario', { tam: 22 }), el('div', {}, [el('b', { text: u.nombre || u.email }), u.nombre ? el('p.pequeno.suave', { text: u.email }) : null])]), salir);
  }

  async function pintar() {
    const org = app.esOrganizador(), cuentas = !!app.info()?.cuentas, local = org && !cuentas;
    reemplazar(cuerpo, [
      bloque(t('Idioma'), null, selectorIdioma()),
      bloque(t('Tema'), t('Automático sigue el modo de tu teléfono o computador.'), selectorTema()),
      cuentas ? bloqueCuenta() : org || app.info()?.modo === 'nube' ? null : bloqueEntrar(),
      local ? await bloquePin() : null,
      local ? bloqueRed() : null,
      local ? await bloqueNube(bloque) : null,
      local ? bloqueDatos() : null,
      bloqueAcerca(),
    ]);
  }
  await pintar();
}
