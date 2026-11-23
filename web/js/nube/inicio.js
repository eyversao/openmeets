/* OpenMeets (nube) · arranque de la versión en la nube. app.js lo importa solo si /nube.json existe, así el modo local no descarga nada de esto. */
import { fijarTransporte } from '../canal.js';
import { transporteDiferido } from './transporte.js';
import { instalarDescargas } from './descargas.js';
import { pedir } from './rutas.js';

export async function iniciar({ aviso } = {}) {
  const raiz = document.documentElement;
  raiz.dataset.modo = 'cuentas';
  const css = document.createElement('link');
  css.rel = 'stylesheet'; css.href = '/css/cuentas.css';
  document.head.append(css);
  const cargarBd = async () => {
    const [{ obtenerBd }, { detectarNube }] = await Promise.all([import('./bd.js'), import('./modo.js')]);
    return obtenerBd(await detectarNube());
  };
  fijarTransporte((id, opciones) => transporteDiferido(cargarBd, id, opciones));
  instalarDescargas(pedir, { aviso });
}
