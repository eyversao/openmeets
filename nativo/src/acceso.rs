//! Quién es organizador: loopback, o PIN de 6 dígitos con cookie de sesión HttpOnly.
use crate::js::*;
use crate::validar::{R, err, mal};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const COOKIE: &str = "om_sesion";

pub fn es_loopback(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v) => v.octets() == [127, 0, 0, 1],
        IpAddr::V6(v) => v.is_loopback() || v.to_ipv4_mapped().is_some_and(|x| x.octets() == [127, 0, 0, 1]),
    }
}

/// Igualdad en tiempo constante (compara hashes del mismo largo).
pub fn iguales(a: &str, b: &str) -> bool {
    let (ha, hb) = (Sha256::digest(a.as_bytes()), Sha256::digest(b.as_bytes()));
    ha.iter().zip(hb.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}
pub fn pin_valido(pin: &str) -> bool {
    pin.len() == 6 && pin.bytes().all(|b| b.is_ascii_digit())
}
pub fn pin_aleatorio() -> String {
    format!("{:06}", entero_aleatorio(1_000_000))
}

pub fn leer_cookies(cabecera: &str) -> HashMap<String, String> {
    let mut o = HashMap::new();
    for par in cabecera.split(';') {
        if let Some(i) = par.find('=') {
            if i > 0 {
                o.insert(par[..i].trim().to_string(), par[i + 1..].trim().to_string());
            }
        }
    }
    o
}

/// Límite de intentos por clave dentro de una ventana (5 por minuto por defecto).
pub struct Limitador {
    max: usize,
    ventana: i64,
    m: Mutex<HashMap<String, Vec<i64>>>,
}
impl Limitador {
    pub fn nuevo(max: usize, ventana_ms: i64) -> Limitador {
        Limitador { max, ventana: ventana_ms, m: Mutex::new(HashMap::new()) }
    }
    /// Registra un intento; devuelve false si se pasó del límite.
    pub fn intentar(&self, clave: &str) -> bool {
        self.intentar_en(clave, ahora_ms())
    }
    pub fn intentar_en(&self, clave: &str, t: i64) -> bool {
        let mut m = self.m.lock().unwrap_or_else(|e| e.into_inner());
        let mut lista: Vec<i64> = m.get(clave).map(|l| l.iter().copied().filter(|x| t - x < self.ventana).collect()).unwrap_or_default();
        if lista.len() >= self.max {
            m.insert(clave.to_string(), lista);
            return false;
        }
        lista.push(t);
        m.insert(clave.to_string(), lista);
        if m.len() > 5000 {
            let v = self.ventana;
            m.retain(|_, l| l.iter().any(|x| t - x < v));
        }
        true
    }
}

pub struct Acceso {
    archivo: PathBuf,
    config: Mutex<Value>,
    pub sesiones: Mutex<HashSet<String>>,
    limite: Limitador,
}

fn guardar_json2(archivo: &Path, v: &Value) -> std::io::Result<()> {
    std::fs::write(archivo, serde_json::to_string_pretty(v)?)
}


pub enum Sesion {
    Ok(String),
    Limitado,
    Mal,
}

impl Acceso {
    pub fn nuevo(dir: &Path) -> std::io::Result<Acceso> {
        std::fs::create_dir_all(dir)?;
        let archivo = dir.join("config.json");
        let mut config = std::fs::read_to_string(&archivo).ok().and_then(|t| serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')).ok()).filter(|v| v.is_object() || v.is_array()).unwrap_or_else(|| serde_json::json!({}));
        if !config.is_object() {
            config = serde_json::json!({});
        }
        if !config["pin"].as_str().is_some_and(pin_valido) {
            config["pin"] = Value::from(pin_aleatorio());
            guardar_json2(&archivo, &config)?;
        }
        Ok(Acceso { archivo, config: Mutex::new(config), sesiones: Mutex::new(HashSet::new()), limite: Limitador::nuevo(5, 60000) })
    }

    pub fn pin(&self) -> String {
        self.config.lock().unwrap_or_else(|e| e.into_inner())["pin"].as_str().unwrap_or("").to_string()
    }

    pub fn cambiar_pin(&self, nuevo: Option<&str>) -> R<String> {
        let pin = match nuevo {
            None | Some("") => pin_aleatorio(),
            Some(p) => p.to_string(),
        };
        if !pin_valido(&pin) {
            return mal(400, "El PIN debe tener 6 dígitos");
        }
        let mut c = self.config.lock().unwrap_or_else(|e| e.into_inner());
        c["pin"] = Value::from(pin.clone());
        guardar_json2(&self.archivo, &c).map_err(|e| err(500, e.to_string()))?;
        self.sesiones.lock().unwrap_or_else(|e| e.into_inner()).clear();
        Ok(pin)
    }

    /// Comprueba el PIN. `ip` limita a 5 intentos por minuto.
    pub fn iniciar_sesion(&self, ip: &str, pin: Option<&str>) -> Sesion {
        if !self.limite.intentar(&format!("pin|{ip}")) {
            return Sesion::Limitado;
        }
        match pin {
            Some(p) if iguales(p, &self.pin()) => {
                let token = hex_aleatorio(24);
                self.sesiones.lock().unwrap_or_else(|e| e.into_inner()).insert(token.clone());
                Sesion::Ok(token)
            }
            _ => Sesion::Mal,
        }
    }

    pub fn cerrar_sesion(&self, token: Option<&str>) {
        if let Some(t) = token {
            self.sesiones.lock().unwrap_or_else(|e| e.into_inner()).remove(t);
        }
    }

    pub fn es_organizador(&self, ip: &IpAddr, cookie: Option<&str>) -> bool {
        es_loopback(ip) || cookie.is_some_and(|c| !c.is_empty() && self.sesiones.lock().unwrap_or_else(|e| e.into_inner()).contains(c))
    }
}

pub fn cabecera_cookie(token: &str, borrar: bool) -> String {
    format!("{COOKIE}={}; HttpOnly; SameSite=Strict; Path=/; Max-Age={}", if borrar { "" } else { token }, if borrar { 0 } else { 60 * 60 * 24 * 30 })
}

/// Direcciones IPv4 de la red local (para decirle a los teléfonos a dónde entrar).
pub fn ips_lan() -> Vec<String> {
    if_addrs::get_if_addrs().map(|l| l.into_iter().filter(|i| !i.is_loopback()).filter_map(|i| match i.ip() { IpAddr::V4(v) => Some(v.to_string()), _ => None }).collect()).unwrap_or_default()
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn pin_y_sesiones() {
        let d = std::env::temp_dir().join(format!("om-rs-acc-{}", hex_aleatorio(4)));
        let a = Acceso::nuevo(&d).unwrap();
        let pin = a.pin();
        assert!(pin_valido(&pin));
        assert_eq!(Acceso::nuevo(&d).unwrap().pin(), pin, "el PIN se conserva al reiniciar");
        let lejos: IpAddr = "192.168.1.20".parse().unwrap();
        assert!(!a.es_organizador(&lejos, None));
        let Sesion::Ok(t) = a.iniciar_sesion("x", Some(&pin)) else { panic!("debía entrar") };
        assert!(a.es_organizador(&lejos, Some(&t)));
        assert!(a.es_organizador(&"127.0.0.1".parse().unwrap(), None));
        assert!(matches!(a.iniciar_sesion("y", Some("000000x")), Sesion::Mal));
        assert!(a.cambiar_pin(Some("12")).is_err());
        a.cambiar_pin(Some("123456")).unwrap();
        assert!(!a.es_organizador(&lejos, Some(&t)), "cambiar el PIN cierra las sesiones");
        let _ = std::fs::remove_dir_all(d);
    }

    #[test]
    fn limite_de_intentos() {
        let l = Limitador::nuevo(2, 1000);
        assert!(l.intentar_en("a", 0) && l.intentar_en("a", 10));
        assert!(!l.intentar_en("a", 20));
        assert!(l.intentar_en("b", 20));
        assert!(l.intentar_en("a", 2000), "pasada la ventana vuelve a dejar");
    }

    #[test]
    fn cookies() {
        let c = leer_cookies("a=1; om_sesion=abc; =x");
        assert_eq!(c["om_sesion"], "abc");
        assert!(iguales("123456", "123456") && !iguales("123456", "123457"));
    }
}
