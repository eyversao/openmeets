/* Seguir un meet de LiftingCast por enlace o id: quién está en tarima, luces y cuánto falta para tus atletas. */
import { el, reemplazar, kg } from '../util.js';
import { t } from '../i18n.js';
import { boton, campo, vacio, errorEstado, esqueletoLista, pildoraConexion, celdaIntento, pildora } from '../ui.js';
import { idDeEnlace, conectar } from '../nucleo/liftingcast.js';
import { panelEnVivo, vistaVivoLC, textoActualizado } from './_publico.js';

const CLAVE = 'openmeets.seguir';
const LEVS = { S: 'sq', B: 'bp', D: 'dl' };
const NOMBRES = { S: 'Sentadilla', B: 'Press banca', D: 'Peso muerto' };
const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}'); } catch { return {}; } };
const guardar = v => { try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
const SIN_DATOS_MS = 15000;

export default async function (ctx) {
  const { raiz, app, consulta } = ctx;
  app.titulo(t('Seguir en LiftingCast'));
  const previo = leer();
  const pildoraLc = pildoraConexion('reconectando');
  const resultado = el('div.apilar-grande');
  let corte = null, temporizador = 0, tick = 0;

  const enlace = campo({ etiqueta: t('Enlace o id de la competencia'), valor: consulta.get('meet') || previo.enlace || '', placeholder: 'https://liftingcast.com/meets/…', ayuda: t('Pega el enlace público de LiftingCast o solo el id (letras y números).'), autocompletar: 'off', spellcheck: false });
  const nombres = campo({ etiqueta: t('Atletas que quieres seguir (opcional)'), valor: previo.nombres || '', placeholder: t('Ana Díaz, Luis Pérez'), ayuda: t('Sepáralos con comas. Si lo dejas vacío, verás a los tres que salen después.') });
  const ir = boton({ texto: t('Seguir'), icono: 'en-vivo', variante: 'primario', tipo: 'submit' });
  const form = el('form.formulario.panel', { novalidate: true, onsubmit: e => { e.preventDefault(); empezar(); } }, [enlace, nombres, el('div.fila', {}, [ir, el('span.pequeno.suave', { text: t('Solo lee la competencia; no se guarda nada en tu servidor.') })])]);

  reemplazar(raiz, el('div.contenedor.contenedor-estrecho', {}, [
    el('header.cabecera-vista', {}, [
      el('h1.titular', {}, [t('Sigue otro meet '), el('span.resaltado', { text: t('en vivo') })]),
      el('p.subtitulo', { text: t('Mira quién levanta y cuánto falta para tus atletas en cualquier competencia publicada en LiftingCast.') }),
      el('div.fila', {}, [pildoraLc]),
    ]),
    form, resultado,
  ]));

  const parar = () => { corte?.(); corte = null; clearTimeout(temporizador); clearInterval(tick); };
  ctx.alSalir(parar);

  function error(titulo, texto, pasos, reintentar) { reemplazar(resultado, errorEstado({ titulo, texto, pasos, reintentar })); }

  function empezar() {
    parar();
    const meetId = idDeEnlace(enlace.valor());
    if (!meetId) { enlace.ponerError(t('Ese enlace no parece de LiftingCast. Debe verse como liftingcast.com/meets/… o ser solo el id.')); enlace.entrada.focus(); return; }
    enlace.ponerError('');
    const lista = nombres.valor().split(',').map(x => x.trim()).filter(Boolean);
    guardar({ enlace: enlace.valor().trim(), nombres: nombres.valor().trim() });
    pildoraLc.poner('reconectando');
    reemplazar(resultado, esqueletoLista(2));

    let ultimo = null, horaDato = 0, fallos = 0, noExiste = false;
    // conectar() reintenta solo; este envoltorio solo observa cómo le va para poder explicarlo.
    const fetchFn = async (url, op) => {
      let r;
      try { r = await fetch(url, op); } catch (e) { fallos++; sinRed(); throw e; }
      if (r.status === 404 || r.status === 401 || r.status === 403) { noExiste = true; sinDatosAhora(); }
      if (!r.ok) { fallos++; sinRed(); throw new Error(`LiftingCast ${r.status}`); }
      fallos = 0; return r;
    };
    function sinRed() { pildoraLc.poner(fallos >= 2 || navigator.onLine === false ? 'sin-red' : 'reconectando'); if (ultimo) pintar(ultimo); }
    function sinDatosAhora() {
      if (ultimo) return;
      parar();
      pildoraLc.poner('sin-red');
      if (noExiste) error(t('No encontramos esa competencia'), t('LiftingCast no tiene ningún meet público con ese id.'), [t('Copia de nuevo el enlace desde la página del meet en LiftingCast.'), t('Comprueba que el organizador lo publicó.')], null);
      else error(t('No hay conexión con LiftingCast'), t('No pudimos leer la competencia. Esto suele ser internet, no tu enlace.'), [t('Comprueba que tienes internet: LiftingCast es un servicio en línea y no funciona solo con la Wi-Fi local.'), t('Prueba de nuevo en unos segundos.')], empezar);
    }
    temporizador = setTimeout(() => { if (!ultimo) sinDatosAhora(); }, SIN_DATOS_MS);

    corte = conectar(meetId, lista.length ? lista : 3, r => {
      ultimo = r; horaDato = Date.now(); fallos = 0;
      clearTimeout(temporizador);
      pildoraLc.poner('conectado');
      pintar(r);
    }, { fetchFn });
    clearInterval(tick);
    tick = setInterval(() => { const e = resultado.querySelector('.pub-actualizado'); if (e && horaDato) e.textContent = textoActualizado(horaDato); }, 1000);

    function pintar(r) {
      const celebrados = (pintar.celebrados ||= new Set());
      const activa = r.enTarima.find(e => e.intento);
      const sin = !r.enTarima.length;
      reemplazar(resultado, [
        el('p.pequeno.suave.pub-actualizado', { role: 'status', text: textoActualizado(horaDato) }),
        sin ? vacio({ icono: 'reloj', titulo: t('Esta competencia aún no tiene plataformas'), texto: t('Cuando el organizador las configure y empiece el meet, las verás aquí.') })
          : el('div.rejilla-2', {}, r.enTarima.map(e => panelEnVivo(vistaVivoLC(e, e === activa ? r.siguientes : []), { celebrados }))),
        r.atletas.length ? el('section.apilar', {}, [
          el('h2.pub-seccion-titulo', {}, [el('span', { text: lista.length ? t('Tus atletas') : t('Los próximos en salir') })]),
          el('ul.atl-lista', {}, r.atletas.map(filaSeguida)),
        ]) : (lista.length ? vacio({ icono: 'usuarios', titulo: t('No encontramos a esos atletas'), texto: t('Comprueba que los nombres se escriban igual que en LiftingCast. Si quieres, déjalo vacío y verás a los próximos.') }) : null),
      ]);
    }
  }

  function filaSeguida(a) {
    const estadoTxt = a.espera ? t('Su sesión aún no empieza') : a.faltan === 0 ? t('Está en la tarima ahora') : a.faltan === null ? t('Ya terminó sus intentos') : (a.faltan === 1 ? t('Sale después del que está en la tarima') : t('Faltan {n} intentos para que salga', { n: a.faltan }));
    return el('li.atl-fila.atl-fila-lc', {}, [
      el('div.atl-datos', {}, [
        el('b', { text: a.nombre }),
        el('small.suave', { text: [a.plataforma, a.sesion ? t('Sesión {s}', { s: a.sesion }) : '', a.flight ? t('Grupo {g}', { g: a.flight }) : ''].filter(Boolean).join(' · ') }),
        el('span.pub-insignias', {}, [pildora({ texto: estadoTxt, tono: a.faltan === 0 ? 'senal' : 'neutro' }), a.siguiente?.kg ? el('span.pequeno.datos', { text: `${t(NOMBRES[Object.keys(LEVS).find(k => LEVS[k] === a.siguiente.lev)] || '')} ${kg(a.siguiente.kg)}` }) : null]),
      ]),
      el('div.res-levs', {}, Object.entries(LEVS).map(([l, k]) => el('div.res-lev', {}, [
        el('p.res-lev-nombre', { text: t(NOMBRES[l]) }),
        el('div.res-celdas', {}, (a.lev[k] || []).map(i => celdaIntento({ kg: i.kg, r: i.r === 1 ? 1 : i.r === -1 ? -1 : null }))),
      ]))),
    ]);
  }

  if (enlace.valor()) empezar();
}
