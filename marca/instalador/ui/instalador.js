// OpenMeets · lógica de la interfaz del instalador. Contrato con Rust en CONTRATO.md.
//   UI → Rust:  window.ipc.postMessage(JSON.stringify({ accion, ... }))
//   Rust → UI:  window.instalador.datos({...}), .carpeta(ruta), .progreso(pct, texto), .listo(), .error(msg)
// Sin window.ipc (abierto en Chrome) arranca un modo demo que simula todo. Parámetros de la demo:
//   ?modo=desinstalar  ?idioma=en|es  ?fallo=1 (la instalación termina en error)  ?vibrancia=1
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const q = new URLSearchParams(location.search);
  const DEMO = !(window.ipc && typeof window.ipc.postMessage === 'function');
  const reducido = matchMedia('(prefers-reduced-motion: reduce)');

  const FLUJOS = {
    instalar: ['bienvenida', 'licencia', 'carpeta', 'instalando', 'listo'],
    desinstalar: ['confirmar', 'quitando', 'hecho'],
  };
  const estado = {
    modo: 'instalar', idioma: 'es', version: '1.0.0', carpeta: '',
    pantalla: null, ocupado: false, borroDatos: false,
  };
  let T = window.TEXTOS.es;

  // ---------- envío a Rust ----------
  function enviar(accion, extra = {}) {
    const msg = JSON.stringify({ accion, ...extra });
    if (DEMO) demo(accion, extra); else window.ipc.postMessage(msg);
  }

  // ---------- idioma ----------
  const idiomaDe = v => (String(v || '').toLowerCase().startsWith('en') ? 'en' : 'es');
  function aplicarTextos() {
    T = window.TEXTOS[estado.idioma];
    document.documentElement.lang = estado.idioma;
    $$('[data-t]').forEach(e => { e.textContent = T[e.dataset.t]; });
    $$('[data-html]').forEach(e => { e.innerHTML = T[e.dataset.html]; }); // solo textos propios con <em>
    $$('[data-i]').forEach(e => { const [k, i] = e.dataset.i.split('.'); e.textContent = T[k][+i]; });
    $$('[data-aria]').forEach(e => e.setAttribute('aria-label', T[e.dataset.aria]));
    $('#minimizar').setAttribute('aria-label', T.minimizar); $('#minimizar').title = T.minimizar;
    $('#cerrar').setAttribute('aria-label', T.cerrar); $('#cerrar').title = T.cerrar;
    $('#lateral').setAttribute('aria-label', T.pasosEtiqueta);
    $('#demo').textContent = T.demo;
    $('#licencia').textContent = window.LICENCIA_MIT.replace(/([^\n])\n(?!\n)/g, '$1 '); // párrafos en una línea; los ajusta la caja
    document.title = 'OpenMeets ' + estado.version;
    pintarPasos();
  }

  // ---------- pasos del lateral ----------
  function pintarPasos() {
    const flujo = FLUJOS[estado.modo];
    const nombres = estado.modo === 'instalar' ? T.pasosInstalar : T.pasosDesinstalar;
    const actual = Math.max(0, flujo.indexOf(estado.pantalla === 'error' ? 'instalando' : estado.pantalla));
    const ol = $('#pasos'); ol.textContent = '';
    nombres.forEach((n, i) => {
      const li = document.createElement('li'); li.textContent = n;
      if (i < actual || (i === actual && ['listo', 'hecho'].includes(estado.pantalla))) li.className = 'hecho';
      if (i === actual) li.setAttribute('aria-current', 'step');
      ol.append(li);
    });
  }

  // ---------- navegación ----------
  function ir(nombre, { atras = false } = {}) {
    const antes = estado.pantalla;
    if (antes === nombre) return;
    estado.pantalla = nombre;
    $$('.pantalla').forEach(s => {
      const es = s.dataset.p === nombre;
      s.hidden = !es; s.classList.remove('entra', 'vuelve');
      if (es && antes && !reducido.matches) { void s.offsetWidth; s.classList.add(atras ? 'vuelve' : 'entra'); }
      if (es) reiniciarSimbolo(s);
    });
    estado.ocupado = nombre === 'instalando' || nombre === 'quitando';
    $('#cerrar').disabled = estado.ocupado;
    pintarPasos();
    if (nombre === 'carpeta') actualizarInstalar();
    // El foco va al título de la pantalla nueva (lectores de pantalla) salvo en la primera carga.
    if (antes) requestAnimationFrame(() => $(`.pantalla[data-p="${nombre}"] h1`).focus());
  }
  function reiniciarSimbolo(s) { // vuelve a lanzar la entrada del logo al mostrar la pantalla
    const sim = s.querySelector('.simbolo.entrada');
    if (sim) { sim.classList.remove('entrada'); void sim.getBoundingClientRect(); sim.classList.add('entrada'); }
  }
  function siguiente() {
    const f = FLUJOS[estado.modo], i = f.indexOf(estado.pantalla);
    if (i >= 0 && i < f.length - 1) ir(f[i + 1]);
  }
  function atras() {
    const f = FLUJOS[estado.modo], i = f.indexOf(estado.pantalla);
    if (estado.modo === 'instalar' && i > 0 && i <= 2) ir(f[i - 1], { atras: true });
  }

  // ---------- carpeta ----------
  function mostrarCarpeta(ruta) {
    estado.carpeta = String(ruta || '');
    const out = $('#ruta'); out.textContent = '';
    const b = document.createElement('bdi'); b.textContent = estado.carpeta; out.append(b); // rtl + bdi: se recorta por la izquierda
    out.title = estado.carpeta;
    actualizarInstalar();
  }
  function actualizarInstalar() { $('#instalar').disabled = !estado.carpeta.trim(); }

  // ---------- progreso ----------
  function mostrarProgreso(pct, texto) {
    const s = $(`.pantalla[data-p="${estado.modo === 'instalar' ? 'instalando' : 'quitando'}"]`);
    const v = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    s.querySelector('.progreso').setAttribute('aria-valuenow', v);
    s.querySelector('.progreso i').style.width = v + '%';
    s.querySelector('.porcentaje').textContent = v + ' %';
    if (texto != null) s.querySelector('.paso-actual').textContent = String(texto);
  }

  // ---------- acciones de los botones ----------
  const ACCIONES = {
    siguiente, atras,
    cerrar: () => enviar('cerrar'),
    abrirApp: () => enviar('abrirApp'),
    reintentar: () => ir('carpeta', { atras: true }),
  };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-accion]');
    if (b && !b.disabled) ACCIONES[b.dataset.accion]();
  });
  $('#minimizar').addEventListener('click', () => enviar('minimizar'));
  $('#cerrar').addEventListener('click', () => { if (!estado.ocupado) enviar('cerrar'); });
  $('#cambiar').addEventListener('click', () => enviar('elegirCarpeta'));
  $('#instalar').addEventListener('click', () => {
    if (!estado.carpeta.trim()) return;
    mostrarProgreso(0, T.preparando); ir('instalando');
    enviar('instalar', { carpeta: estado.carpeta, escritorio: $('#op-escritorio').checked, inicio: $('#op-inicio').checked, abrir: $('#op-abrir').checked });
  });
  $('#quitar').addEventListener('click', () => {
    estado.borroDatos = $('#op-borrar').checked;
    mostrarProgreso(0, T.preparando); ir('quitando');
    enviar('desinstalar', { borrarDatos: estado.borroDatos });
  });

  // Arrastre: botón principal sobre la cabecera, fuera de los botones. Rust llama a drag_window().
  $('[data-arrastre]').addEventListener('mousedown', e => {
    if (e.button === 0 && !e.target.closest('button, a, input')) { e.preventDefault(); enviar('arrastrar'); }
  });

  // Teclado: Intro = botón principal de la pantalla; Esc = Atrás (en las pantallas que lo tienen).
  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const s = $(`.pantalla[data-p="${estado.pantalla}"]`);
    if (e.key === 'Enter') {
      const t = e.target;
      if (t.matches('button, input, a, .licencia')) return; // Intro/Espacio nativos sobre el control con foco
      const p = s && s.querySelector('[data-primario]');
      if (p && !p.disabled) { e.preventDefault(); p.click(); }
    } else if (e.key === 'Escape') {
      const a = s && s.querySelector('[data-accion="atras"]');
      if (a) { e.preventDefault(); a.click(); }
    }
  });
  // Ni menú contextual ni zoom con Ctrl+rueda: se siente como una ventana nativa.
  document.addEventListener('contextmenu', e => { if (!e.target.closest('.licencia, .mensaje-error')) e.preventDefault(); });
  document.addEventListener('wheel', e => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  // ---------- API que llama Rust ----------
  window.instalador = {
    datos(d = {}) {
      if (d.version) estado.version = String(d.version);
      if (d.idioma) estado.idioma = idiomaDe(d.idioma);
      if (d.modo === 'desinstalar' || d.modo === 'instalar') estado.modo = d.modo;
      document.documentElement.classList.toggle('vibrancia', !!d.vibrancia);
      $('#ventana').dataset.modo = estado.modo;
      $('#version').textContent = estado.version;
      if (d.carpetaPorDefecto && !estado.carpeta) mostrarCarpeta(d.carpetaPorDefecto);
      aplicarTextos();
      const f = FLUJOS[estado.modo];
      if (!f.includes(estado.pantalla) || estado.pantalla === f[0]) { estado.pantalla = null; ir(f[0]); }
    },
    carpeta(ruta) { if (ruta) mostrarCarpeta(ruta); },
    progreso(pct, texto) { mostrarProgreso(pct, texto); },
    listo() {
      if (estado.modo === 'instalar') { mostrarProgreso(100); ir('listo'); }
      else {
        mostrarProgreso(100);
        $('#hecho-texto').textContent = estado.borroDatos ? T.hechoTextoSinDatos : T.hechoTexto;
        ir('hecho');
      }
    },
    error(mensaje) {
      $('#mensaje-error').textContent = String(mensaje || '');
      ir('error');
      $('#ventana').dataset.modo = estado.modo;
      if (estado.modo === 'desinstalar') $('.pantalla[data-p="error"] [data-accion="reintentar"]').hidden = true;
    },
  };

  // ---------- modo demo (sin Rust) ----------
  let temporizador = null;
  function aviso(texto) {
    const a = $('#aviso-demo'); a.textContent = texto; a.hidden = false;
    clearTimeout(aviso.t); aviso.t = setTimeout(() => { a.hidden = true; }, 2200);
  }
  function simular(pasos, alTerminar) {
    let pct = 0, i = 0; clearInterval(temporizador);
    temporizador = setInterval(() => {
      pct = Math.min(100, pct + 3 + Math.random() * 6);
      i = Math.min(pasos.length - 1, Math.floor(pct / (100 / pasos.length)));
      window.instalador.progreso(pct, pasos[i] + '…');
      if (pct >= 100) { clearInterval(temporizador); setTimeout(alTerminar, 450); }
    }, 140);
  }
  function demo(accion, extra) {
    console.log('[instalador demo] → ' + JSON.stringify({ accion, ...extra })); // lo mismo que recibiría Rust
    switch (accion) {
      case 'elegirCarpeta': setTimeout(() => window.instalador.carpeta('D:\\Apps\\OpenMeets'), 250); break;
      case 'instalar':
        simular(T.demoPasos, () => q.get('fallo')
          ? window.instalador.error((estado.idioma === 'en' ? 'Could not write ' : 'No se pudo escribir ') + extra.carpeta + '\\OpenMeets.exe (os error 5)')
          : window.instalador.listo());
        break;
      case 'desinstalar': simular(T.demoQuitar, () => window.instalador.listo()); break;
      case 'abrirApp': aviso(T.demoAbrir); break;
      case 'cerrar': aviso(T.demoCerrar); clearInterval(temporizador); setTimeout(reiniciarDemo, 900); break;
      case 'minimizar': case 'arrastrar': break;
    }
  }
  function reiniciarDemo() {
    $('#op-borrar').checked = false; estado.borroDatos = false; estado.pantalla = null;
    $$('.pantalla [data-accion="reintentar"]').forEach(b => { b.hidden = false; });
    window.instalador.datos({ modo: estado.modo });
  }

  // ---------- arranque ----------
  estado.idioma = idiomaDe(q.get('idioma') || navigator.language);
  aplicarTextos();
  ir(FLUJOS.instalar[0]);
  if (DEMO) {
    $('#demo').hidden = false;
    window.instalador.datos({
      version: '1.0.0', idioma: estado.idioma, modo: q.get('modo') === 'desinstalar' ? 'desinstalar' : 'instalar',
      carpetaPorDefecto: 'C:\\Users\\Usuario\\AppData\\Local\\Programs\\OpenMeets', vibrancia: q.get('vibrancia') === '1',
    });
  }
})();
