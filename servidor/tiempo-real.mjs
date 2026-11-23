// OpenMeets · tiempo real por SSE, un canal por meet, con filtro por rol.
const PUBLICOS = new Set(['meet', 'atleta', 'meet-cambio', 'vivo', 'aplauso', 'regie']);

/** ¿Este mensaje le toca a este rol? El organizador lo recibe todo; el resto solo lo público. */
export const paraRol = (mensaje, rol) => !!mensaje && typeof mensaje.tipo === 'string' && (rol === 'organizador' || PUBLICOS.has(mensaje.tipo));

export function crearTiempoReal({ ping = 15000 } = {}) {
  const canales = new Map(); // meetId → { clientes:Set<res>, votos:{}, presencias:{} }
  const canal = id => {
    if (!canales.has(id)) canales.set(id, { clientes: new Set(), votos: {}, presencias: {} });
    return canales.get(id);
  };
  const escribir = (c, res, m) => { try { res.write(`data: ${JSON.stringify(m)}\n\n`); } catch { c.clientes.delete(res); } };

  const t = setInterval(() => { for (const c of canales.values()) for (const res of c.clientes) { try { res.write(': ping\n\n'); } catch { c.clientes.delete(res); } } }, ping);
  t.unref();

  return {
    /** Abre un SSE. `inicial` son los mensajes de arranque (meet, vivos…); pasan por el mismo filtro. */
    conectar(id, req, res, rol, inicial = []) {
      const c = canal(id);
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      res.rol = rol;
      for (const m of inicial) if (paraRol(m, rol)) escribir(c, res, m);
      if (rol === 'organizador') {
        for (const d of Object.values(c.presencias)) escribir(c, res, { tipo: 'presencia', datos: d });
        for (const v of Object.values(c.votos)) escribir(c, res, { tipo: 'voto', voto: v });
      }
      c.clientes.add(res);
      req.on('close', () => c.clientes.delete(res));
    },
    emitir(id, m) {
      const c = canal(id);
      for (const res of c.clientes) if (paraRol(m, res.rol)) escribir(c, res, m);
    },
    /** Último voto de cada juez (en memoria) para quien se conecte tarde. */
    guardarVoto(id, clave, voto) { canal(id).votos[clave] = voto; },
    votoDe(id, clave) { return canal(id).votos[clave]; },
    guardarPresencia(id, clave, datos) { canal(id).presencias[clave] = datos; },
    /** Borra los votos de una plataforma; con `turnoVigente`, solo los de otros turnos. */
    limpiarVotos(id, plataforma, turnoVigente) {
      const c = canal(id);
      for (const [k, v] of Object.entries(c.votos)) if (v.plataforma === plataforma && (turnoVigente === undefined || v.turno !== turnoVigente)) delete c.votos[k];
    },
    clientes(id) { return canales.get(id)?.clientes.size || 0; },
    cerrar() {
      clearInterval(t);
      for (const c of canales.values()) { for (const res of c.clientes) { try { res.end(); } catch { /* ya cerrado */ } } c.clientes.clear(); }
    },
  };
}
