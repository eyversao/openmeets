// OpenMeets · almacén de meets en disco. Un JSON por meet, escritura atómica (tmp + rename), copia .bak,
// espera agrupada de 300 ms y papelera. La interfaz es la misma si algún día se cambia por una nube.
import { mkdirSync, existsSync, readFileSync, readdirSync, writeFileSync, renameSync, copyFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { ID_SEGURO, idSeguro } from '../web/js/nucleo/validar.js';
export { ID_SEGURO, idSeguro };

export function crearAlmacen(dir, { espera = 300 } = {}) {
  const carpeta = join(dir, 'meets');
  const papelera = join(dir, 'papelera');
  mkdirSync(carpeta, { recursive: true });
  mkdirSync(papelera, { recursive: true });
  const cache = new Map();      // id → meet
  const pendientes = new Map(); // id → temporizador
  const ruta = id => join(carpeta, `${id}.json`);
  const requiere = id => { if (!idSeguro(id)) throw Object.assign(new Error('Identificador no válido'), { estado: 400 }); };

  const leerArchivo = id => {
    for (const f of [ruta(id), `${ruta(id)}.bak`]) {
      try { const m = JSON.parse(readFileSync(f, 'utf8')); if (m && typeof m === 'object') return m; } catch { /* probar la copia */ }
    }
    return null;
  };
  const escribir = id => {
    const m = cache.get(id);
    if (!m) return;
    const tmp = `${ruta(id)}.tmp`;
    writeFileSync(tmp, JSON.stringify(m));
    if (existsSync(ruta(id))) { try { copyFileSync(ruta(id), `${ruta(id)}.bak`); } catch { /* sin copia */ } }
    renameSync(tmp, ruta(id));
  };
  const programar = id => {
    if (pendientes.has(id)) return;
    const t = setTimeout(() => { pendientes.delete(id); try { escribir(id); } catch (e) { console.error('No pude guardar', id, e.message); } }, espera);
    pendientes.set(id, t);
  };
  const vaciar = () => { for (const [id, t] of [...pendientes]) { clearTimeout(t); pendientes.delete(id); escribir(id); } };

  return {
    ids() { return readdirSync(carpeta).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(idSeguro); },
    listar() { return this.ids().map(id => this.leer(id)).filter(Boolean); },
    leer(id) {
      if (!idSeguro(id)) return null;
      if (cache.has(id)) return cache.get(id);
      const m = leerArchivo(id);
      if (m) cache.set(id, m);
      return m;
    },
    existe(id) { return idSeguro(id) && (cache.has(id) || existsSync(ruta(id))); },
    crear(meet) {
      requiere(meet?.id);
      if (this.existe(meet.id)) throw Object.assign(new Error('Ya existe un meet con ese identificador'), { estado: 409 });
      cache.set(meet.id, meet);
      escribir(meet.id); // la creación se guarda al instante
      return meet;
    },
    /** `cambios` es un objeto (se fusiona) o una función que modifica el meet. Guarda tras la espera agrupada. */
    guardarParcial(id, cambios) {
      const m = this.leer(id);
      if (!m) return null;
      if (typeof cambios === 'function') cambios(m); else Object.assign(m, cambios);
      m.actualizado = Date.now();
      programar(id);
      return m;
    },
    /** Mueve el archivo a la papelera (nunca se borra del todo). */
    borrar(id) {
      if (!this.existe(id)) return false;
      vaciar();
      const destino = join(papelera, `${id}-${Date.now()}.json`);
      try { renameSync(ruta(id), destino); } catch { writeFileSync(destino, JSON.stringify(cache.get(id) || {})); rmSync(ruta(id), { force: true }); }
      rmSync(`${ruta(id)}.bak`, { force: true });
      cache.delete(id);
      return true;
    },
    exportar(id) { vaciar(); const m = this.leer(id); return m ? JSON.parse(JSON.stringify(m)) : null; },
    /** Restaura una copia completa. Con `reemplazar` sobrescribe (la anterior queda en .bak). */
    importar(meet, { reemplazar = false } = {}) {
      requiere(meet?.id);
      if (this.existe(meet.id)) {
        if (!reemplazar) throw Object.assign(new Error('Ya existe un meet con ese identificador'), { estado: 409 });
        vaciar();
      }
      cache.set(meet.id, meet);
      escribir(meet.id);
      return meet;
    },
    vaciar,
    cerrar() { vaciar(); },
    get pendientes() { return pendientes.size; },
    carpeta, papelera,
  };
}
