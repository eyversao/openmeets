//! Tiempo real por SSE: un canal por meet, con filtro por rol. Mismos eventos y formato que el servidor Node.
use bytes::Bytes;
use indexmap::IndexMap;
use serde_json::Value;
use std::collections::HashMap;
use std::pin::Pin;
use std::sync::{Arc, Mutex, MutexGuard};
use std::task::{Context, Poll};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel};

const PUBLICOS: [&str; 6] = ["meet", "atleta", "meet-cambio", "vivo", "aplauso", "regie"];

/// ¿Este mensaje le toca a este rol? El organizador lo recibe todo; el resto solo lo público.
pub fn para_rol(m: &Value, org: bool) -> bool {
    match m["tipo"].as_str() {
        Some(t) => org || PUBLICOS.contains(&t),
        None => false,
    }
}

struct Cliente {
    id: u64,
    org: bool,
    tx: UnboundedSender<Bytes>,
}
#[derive(Default)]
struct Canal {
    clientes: Vec<Cliente>,
    votos: IndexMap<String, Value>,
    presencias: IndexMap<String, Value>,
}
#[derive(Default)]
struct Interno {
    canales: HashMap<String, Canal>,
    sig: u64,
}

#[derive(Clone, Default)]
pub struct Tiempo {
    inner: Arc<Mutex<Interno>>,
}

fn evento(m: &Value) -> Bytes {
    Bytes::from(format!("data: {m}\n\n"))
}

/// Cuerpo SSE: se da de baja del canal cuando el cliente se desconecta.
pub struct Flujo {
    rx: UnboundedReceiver<Bytes>,
    t: Tiempo,
    meet: String,
    id: u64,
}
impl futures_util::Stream for Flujo {
    type Item = Result<Bytes, std::convert::Infallible>;
    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.rx.poll_recv(cx).map(|o| o.map(Ok))
    }
}
impl Drop for Flujo {
    fn drop(&mut self) {
        let mut g = self.t.lock();
        if let Some(c) = g.canales.get_mut(&self.meet) {
            c.clientes.retain(|x| x.id != self.id);
        }
    }
}

impl Tiempo {
    fn lock(&self) -> MutexGuard<'_, Interno> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Abre un SSE. `inicial` son los mensajes de arranque (meet, vivos…); pasan por el mismo filtro.
    pub fn conectar(&self, meet: &str, org: bool, inicial: &[Value]) -> Flujo {
        let (tx, rx) = unbounded_channel();
        let mut g = self.lock();
        g.sig += 1;
        let id = g.sig;
        let c = g.canales.entry(meet.to_string()).or_default();
        let _ = tx.send(Bytes::from_static(b"retry: 2000\n\n"));
        for m in inicial {
            if para_rol(m, org) {
                let _ = tx.send(evento(m));
            }
        }
        if org {
            for d in c.presencias.values() {
                let _ = tx.send(evento(&serde_json::json!({"tipo": "presencia", "datos": d})));
            }
            for v in c.votos.values() {
                let _ = tx.send(evento(&serde_json::json!({"tipo": "voto", "voto": v})));
            }
        }
        c.clientes.push(Cliente { id, org, tx });
        Flujo { rx, t: self.clone(), meet: meet.to_string(), id }
    }

    pub fn emitir(&self, meet: &str, m: &Value) {
        let mut g = self.lock();
        let c = g.canales.entry(meet.to_string()).or_default();
        let datos = evento(m);
        c.clientes.retain(|x| if para_rol(m, x.org) { x.tx.send(datos.clone()).is_ok() } else { !x.tx.is_closed() });
    }

    pub fn ping(&self) {
        let mut g = self.lock();
        for c in g.canales.values_mut() {
            c.clientes.retain(|x| x.tx.send(Bytes::from_static(b": ping\n\n")).is_ok());
        }
    }

    /// Último voto de cada juez (en memoria) para quien se conecte tarde.
    pub fn guardar_voto(&self, meet: &str, clave: &str, voto: Value) {
        self.lock().canales.entry(meet.to_string()).or_default().votos.insert(clave.to_string(), voto);
    }
    pub fn voto_de(&self, meet: &str, clave: &str) -> Option<Value> {
        self.lock().canales.get(meet).and_then(|c| c.votos.get(clave).cloned())
    }
    pub fn guardar_presencia(&self, meet: &str, clave: &str, datos: Value) {
        self.lock().canales.entry(meet.to_string()).or_default().presencias.insert(clave.to_string(), datos);
    }
    /// Borra los votos de una plataforma; con `turno_vigente`, solo los de otros turnos.
    pub fn limpiar_votos(&self, meet: &str, plataforma: &str, turno_vigente: Option<&Value>) {
        let mut g = self.lock();
        let c = g.canales.entry(meet.to_string()).or_default();
        c.votos.retain(|_, v| !(v["plataforma"] == plataforma && turno_vigente.is_none_or(|t| v["turno"] != *t)));
    }
    pub fn clientes(&self, meet: &str) -> usize {
        self.lock().canales.get(meet).map(|c| c.clientes.len()).unwrap_or(0)
    }

    /// Cierra todos los canales (los clientes ven el fin del flujo).
    pub fn cerrar(&self) {
        for c in self.lock().canales.values_mut() {
            c.clientes.clear();
        }
    }

    /// Latido cada 15 s para que los intermediarios no corten el SSE.
    pub fn latido(&self) {
        let t = self.clone();
        tokio::spawn(async move {
            let mut i = tokio::time::interval(std::time::Duration::from_secs(15));
            i.tick().await;
            loop {
                i.tick().await;
                t.ping();
            }
        });
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use futures_util::StreamExt;
    use serde_json::json;

    #[test]
    fn filtro_por_rol() {
        assert!(para_rol(&json!({"tipo": "meet"}), false));
        assert!(para_rol(&json!({"tipo": "vivo"}), false));
        assert!(!para_rol(&json!({"tipo": "voto"}), false));
        assert!(!para_rol(&json!({"tipo": "presencia"}), false));
        assert!(para_rol(&json!({"tipo": "voto"}), true));
        assert!(!para_rol(&json!({}), true));
        assert!(!para_rol(&json!({"tipo": 5}), true));
    }

    #[tokio::test]
    async fn emite_solo_a_quien_le_toca() {
        let t = Tiempo::default();
        t.guardar_voto("m", "p|izq|d", json!({"plataforma": "p", "turno": "a_S_0"}));
        let mut org = t.conectar("m", true, &[json!({"tipo": "meet"})]);
        let mut publico = t.conectar("m", false, &[json!({"tipo": "meet"})]);
        assert_eq!(t.clientes("m"), 2);
        t.emitir("m", &json!({"tipo": "voto", "voto": 1}));
        t.emitir("m", &json!({"tipo": "vivo"}));
        let mut o = String::new();
        for _ in 0..5 {
            o += std::str::from_utf8(&org.next().await.unwrap().unwrap()).unwrap();
        }
        assert!(o.starts_with("retry: 2000\n\n") && o.contains("data: {\"tipo\":\"meet\"}") && o.contains("\"tipo\":\"voto\",\"voto\":{\"plataforma\"") && o.contains("\"tipo\":\"vivo\""));
        let mut p = String::new();
        for _ in 0..3 {
            p += std::str::from_utf8(&publico.next().await.unwrap().unwrap()).unwrap();
        }
        assert!(!p.contains("voto"), "el público no ve votos");
        drop(publico);
        assert_eq!(t.clientes("m"), 1, "al desconectarse se da de baja");
        t.limpiar_votos("m", "p", Some(&json!("otro")));
        assert!(t.voto_de("m", "p|izq|d").is_none());
    }
}
