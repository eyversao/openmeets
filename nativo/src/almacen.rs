//! Almacén de meets en disco: un JSON por meet, escritura atómica (tmp + rename), copia .bak,
//! espera agrupada (300 ms por defecto) y papelera. Mismo formato y carpetas que el servidor Node.
use crate::js::*;
use crate::validar::{R, err, mal};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

#[derive(Default)]
struct Interno {
    cache: HashMap<String, Value>,
    pendientes: HashSet<String>,
}

#[derive(Clone)]
pub struct Almacen {
    inner: Arc<Mutex<Interno>>,
    pub carpeta: PathBuf,
    pub papelera: PathBuf,
    espera: Duration,
}

fn requiere(id: &str) -> R<()> {
    if es_id_seguro(id) { Ok(()) } else { mal(400, "Identificador no válido") }
}

fn ruta_en(carpeta: &Path, id: &str) -> PathBuf {
    carpeta.join(format!("{id}.json"))
}
fn con_sufijo(p: &Path, s: &str) -> PathBuf {
    let mut o = p.as_os_str().to_owned();
    o.push(s);
    PathBuf::from(o)
}

impl Almacen {
    pub fn nuevo(dir: &Path, espera_ms: u64) -> std::io::Result<Almacen> {
        let carpeta = dir.join("meets");
        let papelera = dir.join("papelera");
        fs::create_dir_all(&carpeta)?;
        fs::create_dir_all(&papelera)?;
        Ok(Almacen { inner: Arc::new(Mutex::new(Interno::default())), carpeta, papelera, espera: Duration::from_millis(espera_ms) })
    }

    fn lock(&self) -> MutexGuard<'_, Interno> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn ruta(&self, id: &str) -> PathBuf {
        ruta_en(&self.carpeta, id)
    }

    fn leer_archivo(&self, id: &str) -> Option<Value> {
        let r = self.ruta(id);
        for f in [r.clone(), con_sufijo(&r, ".bak")] {
            if let Ok(t) = fs::read_to_string(&f) {
                if let Ok(v) = serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')) {
                    if v.is_object() {
                        return Some(v);
                    }
                }
            }
        }
        None
    }

    fn escribir(&self, g: &Interno, id: &str) -> std::io::Result<()> {
        let Some(m) = g.cache.get(id) else { return Ok(()) };
        let r = self.ruta(id);
        let tmp = con_sufijo(&r, ".tmp");
        fs::write(&tmp, serde_json::to_vec(m)?)?;
        if r.exists() {
            let _ = fs::copy(&r, con_sufijo(&r, ".bak"));
        }
        fs::rename(&tmp, &r)
    }

    fn programar(&self, g: &mut Interno, id: &str) {
        if !g.pendientes.insert(id.to_string()) {
            return;
        }
        let yo = self.clone();
        let id2 = id.to_string();
        let id = id.to_string();
        let espera = self.espera;
        let tarea = async move {
            tokio::time::sleep(espera).await;
            let mut g = yo.lock();
            if g.pendientes.remove(&id) {
                if let Err(e) = yo.escribir(&g, &id) {
                    eprintln!("No pude guardar {id} {e}");
                }
            }
            drop(g);
        };
        if tokio::runtime::Handle::try_current().is_ok() {
            tokio::spawn(tarea);
        } else if g.pendientes.remove(&id2) {
            // Sin runtime (pruebas síncronas): se guarda al momento.
            let _ = self.escribir(g, &id2);
        }
    }

    pub fn vaciar(&self) {
        let mut g = self.lock();
        let ids: Vec<String> = g.pendientes.drain().collect();
        for id in ids {
            if let Err(e) = self.escribir(&g, &id) {
                eprintln!("No pude guardar {id} {e}");
            }
        }
    }

    pub fn ids(&self) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(&self.carpeta)
            .map(|d| d.filter_map(|e| e.ok()).filter_map(|e| e.file_name().into_string().ok()).filter_map(|f| f.strip_suffix(".json").map(str::to_string)).filter(|i| es_id_seguro(i)).collect())
            .unwrap_or_default();
        v.sort();
        v
    }

    pub fn listar(&self) -> Vec<Value> {
        self.ids().iter().filter_map(|i| self.leer(i)).collect()
    }

    pub fn leer(&self, id: &str) -> Option<Value> {
        if !es_id_seguro(id) {
            return None;
        }
        let mut g = self.lock();
        if let Some(m) = g.cache.get(id) {
            return Some(m.clone());
        }
        let m = self.leer_archivo(id)?;
        g.cache.insert(id.to_string(), m.clone());
        Some(m)
    }

    pub fn existe(&self, id: &str) -> bool {
        es_id_seguro(id) && (self.lock().cache.contains_key(id) || self.ruta(id).exists())
    }

    pub fn crear(&self, meet: &Value) -> R<()> {
        let id = meet["id"].as_str().unwrap_or("");
        requiere(id)?;
        if self.existe(id) {
            return mal(409, "Ya existe un meet con ese identificador");
        }
        let mut g = self.lock();
        g.cache.insert(id.to_string(), meet.clone());
        self.escribir(&g, id).map_err(|e| err(500, e.to_string()))
    }

    /// Modifica el meet en su sitio y lo guarda tras la espera agrupada. `None` si no existe.
    pub fn guardar<F: FnOnce(&mut Value) -> R<()>>(&self, id: &str, f: F) -> R<Option<()>> {
        if self.leer(id).is_none() {
            return Ok(None);
        }
        let mut g = self.lock();
        let Some(m) = g.cache.get_mut(id) else { return Ok(None) };
        f(m)?;
        m["actualizado"] = Value::from(ahora_ms());
        self.programar(&mut g, id);
        Ok(Some(()))
    }

    /// Mueve el archivo a la papelera (nunca se borra del todo).
    pub fn borrar(&self, id: &str) -> bool {
        if !self.existe(id) {
            return false;
        }
        self.vaciar();
        let destino = self.papelera.join(format!("{id}-{}.json", ahora_ms()));
        let r = self.ruta(id);
        if fs::rename(&r, &destino).is_err() {
            let copia = self.lock().cache.get(id).cloned().unwrap_or(Value::Object(Default::default()));
            let _ = fs::write(&destino, copia.to_string());
            let _ = fs::remove_file(&r);
        }
        let _ = fs::remove_file(con_sufijo(&r, ".bak"));
        self.lock().cache.remove(id);
        true
    }

    pub fn exportar(&self, id: &str) -> Option<Value> {
        self.vaciar();
        self.leer(id)
    }

    /// Restaura una copia completa. Con `reemplazar` sobrescribe (la anterior queda en .bak).
    pub fn importar(&self, meet: &Value, reemplazar: bool) -> R<()> {
        let id = meet["id"].as_str().unwrap_or("");
        requiere(id)?;
        if self.existe(id) {
            if !reemplazar {
                return mal(409, "Ya existe un meet con ese identificador");
            }
            self.vaciar();
        }
        let mut g = self.lock();
        g.cache.insert(id.to_string(), meet.clone());
        self.escribir(&g, id).map_err(|e| err(500, e.to_string()))
    }

    pub fn pendientes(&self) -> usize {
        self.lock().pendientes.len()
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use serde_json::json;

    fn tmp(n: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("om-rs-{n}-{}", hex_aleatorio(4)));
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[tokio::test]
    async fn crear_guardar_borrar() {
        let d = tmp("almacen");
        let a = Almacen::nuevo(&d, 30).unwrap();
        assert!(a.crear(&json!({"id": "../x"})).is_err());
        a.crear(&json!({"id": "m1", "nombre": "Uno", "atletas": []})).unwrap();
        assert_eq!(a.crear(&json!({"id": "m1"})).unwrap_err().estado, 409);
        a.guardar("m1", |m| { m["nombre"] = json!("Dos"); Ok(()) }).unwrap().unwrap();
        assert_eq!(a.pendientes(), 1);
        // la escritura agrupada llega a disco tras la espera
        tokio::time::sleep(Duration::from_millis(150)).await;
        assert_eq!(a.pendientes(), 0);
        let en_disco: Value = serde_json::from_str(&fs::read_to_string(d.join("meets/m1.json")).unwrap()).unwrap();
        assert_eq!(en_disco["nombre"], "Dos");
        assert!(d.join("meets/m1.json.bak").exists(), "deja copia .bak al sobrescribir");
        // otro almacén (reinicio) abre lo mismo
        let b = Almacen::nuevo(&d, 30).unwrap();
        assert_eq!(b.leer("m1").unwrap()["nombre"], "Dos");
        assert!(b.borrar("m1"));
        assert!(!b.existe("m1"));
        assert_eq!(fs::read_dir(d.join("papelera")).unwrap().count(), 1);
        let _ = fs::remove_dir_all(d);
    }

    #[tokio::test]
    async fn recupera_desde_bak_y_vacia() {
        let d = tmp("bak");
        let a = Almacen::nuevo(&d, 5000).unwrap();
        a.crear(&json!({"id": "m2", "v": 1})).unwrap();
        a.guardar("m2", |m| { m["v"] = json!(2); Ok(()) }).unwrap();
        a.vaciar(); // no espera los 5 s
        assert_eq!(a.pendientes(), 0);
        fs::write(d.join("meets/m2.json"), "{roto").unwrap();
        let b = Almacen::nuevo(&d, 30).unwrap();
        assert_eq!(b.leer("m2").unwrap()["v"], 1, "el archivo roto se sustituye por la copia .bak");
        let _ = fs::remove_dir_all(d);
    }
}
