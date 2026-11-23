//! Helpers que imitan la semántica de JavaScript que usa el servidor Node (cadenas, números, orden «localeCompare»).
use serde_json::Value;
use std::cmp::Ordering;
use unicode_normalization::UnicodeNormalization;

pub fn ahora_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Fecha local AAAA-MM-DD (como `hoyISO`).
pub fn hoy_iso() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Número como lo escribe `JSON.stringify`: entero si no tiene decimales.
pub fn nv(f: f64) -> Value {
    if !f.is_finite() {
        Value::Null
    } else if f.fract() == 0.0 && f.abs() < 9.0e15 {
        Value::from(f as i64)
    } else {
        Value::from(f)
    }
}
pub fn nv_opt(f: Option<f64>) -> Value {
    f.map(nv).unwrap_or(Value::Null)
}

/// `String(n)` de JS para un número.
pub fn num_str(f: f64) -> String {
    if f.is_nan() {
        "NaN".into()
    } else if f.is_infinite() {
        if f > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else if f.fract() == 0.0 && f.abs() < 1e21 {
        if f.abs() < 9.0e15 { format!("{}", f as i64) } else { format!("{f:.0}") }
    } else {
        format!("{f}")
    }
}

/// `String(valor)` de JS.
pub fn js_string(v: &Value) -> String {
    match v {
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => num_str(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(|x| if x.is_null() { String::new() } else { js_string(x) }).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}
/// `String(x ?? '')`.
pub fn js_string_vacio(v: &Value) -> String {
    if v.is_null() { String::new() } else { js_string(v) }
}

fn recortar_js(s: &str) -> &str {
    s.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
}

/// `Number(cadena)` de JS.
pub fn js_number_str(s: &str) -> f64 {
    let t = recortar_js(s);
    if t.is_empty() {
        return 0.0;
    }
    let (signo, resto) = match t.as_bytes()[0] {
        b'-' => (-1.0, &t[1..]),
        b'+' => (1.0, &t[1..]),
        _ => (1.0, t),
    };
    let base = |p: &str, b: u32| -> Option<f64> { if p.is_empty() { None } else { u64::from_str_radix(p, b).ok().map(|n| n as f64) } };
    if t.len() > 2 && t.as_bytes()[0] == b'0' {
        let r = match &t[1..2] {
            "x" | "X" => base(&t[2..], 16),
            "o" | "O" => base(&t[2..], 8),
            "b" | "B" => base(&t[2..], 2),
            _ => None,
        };
        if let Some(n) = r {
            return n;
        }
    }
    if resto == "Infinity" {
        return signo * f64::INFINITY;
    }
    // Rust acepta «inf», «nan» e «infinity»; JS no.
    if resto.is_empty() || !resto.bytes().all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'e' | b'E' | b'+' | b'-')) {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// `Number(valor)` de JS.
pub fn js_to_number(v: &Value) -> f64 {
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => if *b { 1.0 } else { 0.0 },
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => js_number_str(s),
        Value::Array(a) => match a.len() {
            0 => 0.0,
            1 => js_to_number(&a[0]),
            _ => f64::NAN,
        },
        Value::Object(_) => f64::NAN,
    }
}
/// `Number(x) || 0`.
pub fn num_o_cero(v: &Value) -> f64 {
    let n = js_to_number(v);
    if n.is_nan() { 0.0 } else { n }
}

pub fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// `s.slice(0, max)` contando unidades UTF-16 (un par sustituto no se parte).
pub fn cortar(s: &str, max: usize) -> String {
    let mut n = 0;
    let mut out = String::new();
    for c in s.chars() {
        n += c.len_utf16();
        if n > max {
            break;
        }
        out.push(c);
    }
    out
}
pub fn largo16(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
}

/// `txt(x, max)` de validar.js: solo cadenas, recortadas.
pub fn txt(v: &Value, max: usize) -> String {
    match v {
        Value::String(s) => cortar(recortar_js(s), max),
        _ => String::new(),
    }
}
pub fn txt_s(s: &str, max: usize) -> String {
    cortar(recortar_js(s), max)
}
pub fn trim_js(s: &str) -> &str {
    recortar_js(s)
}

/// `num(x, min, max)` de validar.js (None = el valor por defecto).
pub fn num(v: &Value, min: f64, max: f64) -> Option<f64> {
    let n = match v {
        Value::String(s) if !recortar_js(s).is_empty() => js_number_str(s),
        Value::Number(n) => n.as_f64()?,
        _ => return None,
    };
    (n.is_finite() && n >= min && n <= max).then_some(n)
}

pub fn es_id_seguro(s: &str) -> bool {
    let b = s.as_bytes();
    if b.is_empty() || b.len() > 60 {
        return false;
    }
    let ok0 = b[0].is_ascii_digit() || b[0].is_ascii_lowercase();
    ok0 && b[1..].iter().all(|c| c.is_ascii_digit() || c.is_ascii_lowercase() || *c == b'-')
}
pub fn id_seguro(v: &Value) -> bool {
    v.as_str().map(es_id_seguro).unwrap_or(false)
}

pub fn es_fecha(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}
/// `fecha(x)`: la cadena si es AAAA-MM-DD, si no ''.
pub fn fecha(v: &Value) -> String {
    match v {
        Value::String(s) if es_fecha(s) => s.clone(),
        _ => String::new(),
    }
}

/// `url(x)`: solo http(s).
pub fn url(v: &Value) -> String {
    let t = txt(v, 300);
    let m = t.to_ascii_lowercase();
    if m.starts_with("http://") || m.starts_with("https://") { t } else { String::new() }
}

pub fn hex_aleatorio(n: usize) -> String {
    (0..n).map(|_| format!("{:02x}", rand::random::<u8>())).collect()
}
pub fn entero_aleatorio(max: u32) -> u32 {
    let tope = (u32::MAX / max) * max;
    loop {
        let x = rand::random::<u32>();
        if x < tope {
            return x % max;
        }
    }
}

fn es_marca(c: char) -> bool {
    ('\u{300}'..='\u{36f}').contains(&c)
}
pub fn sin_tildes(s: &str) -> String {
    s.nfd().filter(|c| !es_marca(*c)).collect()
}
/// `normalizarNombre`: sin tildes, minúscula, solo a-z0-9 y espacios simples.
pub fn normalizar_nombre(s: &str) -> String {
    let t: String = sin_tildes(s).to_lowercase().chars().map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() { c } else { ' ' }).collect();
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn slug(t: &str) -> String {
    let t = sin_tildes(t).to_lowercase();
    let mut o = String::new();
    let mut guion = false;
    for c in t.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if guion && !o.is_empty() {
                o.push('-');
            }
            guion = false;
            o.push(c);
        } else {
            guion = true;
        }
    }
    let o = cortar(&o, 40);
    let o = o.trim_matches('-').to_string();
    if o.is_empty() { "meet".into() } else { o }
}

/// Celda de CSV con la protección contra fórmulas de Excel (`celda` de calculo.js).
pub fn celda(v: &Value) -> String {
    if v.is_null() {
        return String::new();
    }
    let original = js_string(v);
    let mut t = original.clone();
    if v.is_string() && t.chars().next().is_some_and(|c| matches!(c, '=' | '+' | '-' | '@' | '\t' | '\r')) {
        t = format!("'{t}");
    }
    if t.contains(['"', ',', '\r', '\n']) || t != original {
        format!("\"{}\"", t.replace('"', "\"\""))
    } else {
        t
    }
}

/* ---- Orden como `localeCompare` (aproximación del orden raíz de ICU para texto latino) ---- */

const PUNTUACION: &str = "_-,;:!?.·'\"()[]{}@*/\\&#%`^+<=>|~$";

fn primario(c: char) -> (u32, u8) {
    // (peso primario, 1 si es mayúscula)
    if c.is_whitespace() {
        return (1, 0);
    }
    if let Some(i) = PUNTUACION.chars().position(|p| p == c) {
        return (10 + i as u32, 0);
    }
    if c.is_ascii_digit() {
        return (100 + (c as u32 - '0' as u32), 0);
    }
    if c.is_alphabetic() {
        let mayus = c.is_uppercase();
        let b = c.to_lowercase().next().unwrap_or(c);
        if b == 'ñ' {
            return (229, mayus as u8); // la «ñ» va después de la «n»
        }
        if b.is_ascii_lowercase() {
            return (200 + (b as u32 - 'a' as u32) * 2 + if b > 'n' { 4 } else { 0 }, mayus as u8);
        }
        return (1000 + b as u32, mayus as u8);
    }
    (500 + c as u32, 0)
}

pub fn loc_cmp(a: &str, b: &str) -> Ordering {
    fn claves(s: &str) -> Vec<(u32, u32, u8)> {
        let mut v: Vec<(u32, u32, u8)> = Vec::new();
        for c in s.nfd() {
            if es_marca(c) {
                if let Some(u) = v.last_mut() {
                    u.1 = u.1.wrapping_mul(31).wrapping_add(c as u32);
                }
            } else {
                let (p, m) = primario(c);
                v.push((p, 0, m));
            }
        }
        v
    }
    let (ka, kb) = (claves(a), claves(b));
    ka.iter().map(|x| x.0).cmp(kb.iter().map(|x| x.0))
        .then_with(|| ka.iter().map(|x| x.1).cmp(kb.iter().map(|x| x.1)))
        .then_with(|| ka.iter().map(|x| x.2).cmp(kb.iter().map(|x| x.2)))
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use serde_json::json;

    #[test]
    fn numeros_como_js() {
        assert_eq!(js_number_str(" 12 "), 12.0);
        assert_eq!(js_number_str("0x10"), 16.0);
        assert_eq!(js_number_str(""), 0.0);
        assert!(js_number_str("nan").is_nan());
        assert!(js_number_str("inf").is_nan());
        assert_eq!(num(&json!("1e2"), 0.0, 1000.0), Some(100.0));
        assert_eq!(num(&json!(true), 0.0, 1.0), None);
        assert_eq!(nv(120.0).to_string(), "120");
        assert_eq!(nv(62.5).to_string(), "62.5");
    }

    #[test]
    fn textos() {
        assert_eq!(txt(&json!("  hola  "), 3), "hol");
        assert_eq!(txt(&json!(5), 3), "");
        assert_eq!(cortar("a😀b", 2), "a"); // el emoji pesa 2 y no cabe entero
        assert_eq!(slug("Copa Ñandú 2026"), "copa-nandu-2026");
        assert_eq!(normalizar_nombre("  José  PÉREZ "), "jose perez");
        assert!(es_id_seguro("copa-1") && !es_id_seguro("Copa") && !es_id_seguro("-a") && !es_id_seguro(""));
    }

    #[test]
    fn csv_y_orden() {
        assert_eq!(celda(&json!("=1+1")), "\"'=1+1\"");
        assert_eq!(celda(&json!("a,b")), "\"a,b\"");
        assert_eq!(celda(&json!(-120)), "-120");
        assert_eq!(loc_cmp("-105", "+120"), Ordering::Less); // en ICU el guion va antes que el más
        assert_eq!(loc_cmp("a", "B"), Ordering::Less);
        assert_eq!(loc_cmp("a", "A"), Ordering::Less);
        assert_eq!(loc_cmp("n", "ñ"), Ordering::Less);
        assert_eq!(loc_cmp("ñ", "o"), Ordering::Less);
    }
}
