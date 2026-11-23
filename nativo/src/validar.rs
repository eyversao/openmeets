//! Validación de meets y atletas (port de web/js/nucleo/validar.js). Trabaja sobre `serde_json::Value`
//! para conservar el mismo JSON (campos, orden y tipos) que escribe el servidor Node.
use crate::js::*;
use serde_json::{Map, Value, json};

pub const LIM_NORMAL: usize = 256 * 1024;
pub const LIM_CANAL: usize = 64 * 1024;
pub const LIM_LOTE: usize = 1024 * 1024;
pub const LIM_IMPORTAR: usize = 8 * 1024 * 1024;
pub const MAX_ATLETAS: usize = 1000;
pub const LEVS: [&str; 3] = ["S", "B", "D"];
pub const POS: [&str; 3] = ["izq", "cen", "der"];
pub const NIVELES_REC: [&str; 5] = ["mundial", "nacional", "ibero", "regional", "otro"];

#[derive(Debug)]
pub struct ErrorApi {
    pub estado: u16,
    pub mensaje: String,
}
pub type R<T> = Result<T, ErrorApi>;
pub fn mal<T>(estado: u16, mensaje: impl Into<String>) -> R<T> {
    Err(ErrorApi { estado, mensaje: mensaje.into() })
}
pub fn err(estado: u16, mensaje: impl Into<String>) -> ErrorApi {
    ErrorApi { estado, mensaje: mensaje.into() }
}

fn nombre_lev(l: &str) -> &'static str {
    match l {
        "S" => "sentadilla",
        "B" => "banca",
        _ => "peso muerto",
    }
}

pub fn limpiar_intento(i: &Value) -> Value {
    if !i.is_object() {
        return json!({"kg": null, "r": null, "rec": false, "alFinal": false});
    }
    let r = match i["r"].as_f64() {
        Some(x) if x == 1.0 => json!(1),
        Some(x) if x == -1.0 => json!(-1),
        _ => Value::Null,
    };
    let rec = if i["rec"] == Value::Bool(true) || i["rec"].as_str().is_some_and(|s| NIVELES_REC.contains(&s)) { i["rec"].clone() } else { Value::Bool(false) };
    let mut o = Map::new();
    o.insert("kg".into(), nv_opt(num(&i["kg"], 0.0, 1000.0)));
    o.insert("r".into(), r);
    o.insert("rec".into(), rec.clone());
    o.insert("alFinal".into(), Value::Bool(truthy(&i["alFinal"])));
    if rec == "otro" && !txt(&i["recTexto"], 40).is_empty() {
        o.insert("recTexto".into(), json!(txt(&i["recTexto"], 40)));
    }
    if i.get("cambios").is_some() {
        o.insert("cambios".into(), nv(num(&i["cambios"], 0.0, 99.0).unwrap_or(0.0)));
    }
    if let Some(h) = i["historial"].as_array() {
        let desde = h.len().saturating_sub(30);
        let lista: Vec<Value> = h[desde..].iter().filter(|x| x.is_object()).map(|h| {
            json!({
                "ts": nv(num(&h["ts"], 0.0, 9e15).unwrap_or(0.0)),
                "de": h["de"].clone(), "a": h["a"].clone(),
                "motivo": txt(&h["motivo"], 120), "por": txt(&h["por"], 60),
            })
        }).collect();
        o.insert("historial".into(), Value::Array(lista));
    }
    Value::Object(o)
}

pub fn limpiar_atleta(a: &Value, id: Option<&str>) -> R<Value> {
    if !a.is_object() {
        return mal(400, "Atleta no válido");
    }
    let aid = match id {
        Some(s) => s.to_string(),
        None => a["id"].as_str().unwrap_or("").to_string(),
    };
    if !es_id_seguro(&aid) {
        return mal(400, "El identificador del atleta solo puede llevar a-z, 0-9 y guiones");
    }
    let mut intentos = Map::new();
    for l in LEVS {
        let lista: Vec<Value> = a["intentos"][l].as_array().map(|v| v.iter().take(4).map(limpiar_intento).collect()).unwrap_or_default();
        intentos.insert(l.into(), Value::Array(lista));
    }
    let division = txt(&a["division"], 40);
    let mut o = Map::new();
    o.insert("id".into(), json!(aid));
    o.insert("nombre".into(), json!(txt(&a["nombre"], 80)));
    o.insert("sexo".into(), json!(if a["sexo"] == "F" { "F" } else { "M" }));
    let nac = fecha(&a["nacimiento"]);
    o.insert("nacimiento".into(), if nac.is_empty() { Value::Null } else { json!(nac) });
    o.insert("club".into(), json!(txt(&a["club"], 80)));
    o.insert("division".into(), json!(if division.is_empty() { "Open".to_string() } else { division }));
    o.insert("equipamiento".into(), json!(if a["equipamiento"] == "equipado" { "equipado" } else { "raw" }));
    o.insert("peso".into(), nv_opt(num(&a["peso"], 0.0, 500.0)));
    o.insert("clase".into(), json!(txt(&a["clase"], 12)));
    o.insert("plataforma".into(), json!(txt(&a["plataforma"], 40)));
    o.insert("sesion".into(), json!(txt_s(&js_string_vacio(&a["sesion"]), 20)));
    o.insert("grupo".into(), json!(txt_s(&js_string_vacio(&a["grupo"]), 20)));
    o.insert("lote".into(), nv_opt(num(&a["lote"], 0.0, 9999.0)));
    o.insert("rack".into(), json!({"S": nv_opt(num(&a["rack"]["S"], 0.0, 99.0)), "B": nv_opt(num(&a["rack"]["B"], 0.0, 99.0))}));
    o.insert("intentos".into(), Value::Object(intentos));
    if let Some(l) = a["levantes"].as_array() {
        o.insert("levantes".into(), Value::Array(l.iter().filter(|x| x.as_str().is_some_and(|s| LEVS.contains(&s))).cloned().collect()));
    }
    if a.get("pais").is_some() {
        o.insert("pais".into(), json!(txt(&a["pais"], 60)));
    }
    if id_seguro(&a["atletaId"]) {
        o.insert("atletaId".into(), a["atletaId"].clone());
    }
    if a.get("notas").is_some() {
        o.insert("notas".into(), json!(txt(&a["notas"], 500)));
    }
    if a["pesaje"].is_object() {
        let p = &a["pesaje"];
        o.insert("pesaje".into(), json!({"hora": nv(num(&p["hora"], 0.0, 9e15).unwrap_or(0.0)), "por": txt(&p["por"], 60), "equipo": truthy(&p["equipo"]), "licencia": truthy(&p["licencia"])}));
    }
    Ok(Value::Object(o))
}

/// Campos editables del meet. Solo devuelve los que vienen en el cuerpo.
pub fn limpiar_campos(b: &Value, parcial: bool) -> R<Map<String, Value>> {
    if !b.is_object() {
        return mal(400, "Cuerpo no válido");
    }
    let mut o = Map::new();
    let tiene = |k: &str| b.get(k).is_some();
    if tiene("nombre") {
        let t = txt(&b["nombre"], 120);
        if t.is_empty() {
            return mal(400, "El meet necesita un nombre");
        }
        o.insert("nombre".into(), json!(t));
    }
    for (k, msg) in [("fecha", "La fecha debe ser AAAA-MM-DD"), ("fechaFin", "La fecha final debe ser AAAA-MM-DD")] {
        if tiene(k) {
            let v = &b[k];
            if v.is_null() || *v == "" {
                o.insert(k.into(), json!(""));
            } else {
                let f = fecha(v);
                if f.is_empty() {
                    return mal(400, msg);
                }
                o.insert(k.into(), json!(f));
            }
        }
    }
    for (k, m) in [("sede", 120), ("ciudad", 80), ("pais", 80), ("organizador", 120), ("descripcion", 2000), ("federacion", 60)] {
        if tiene(k) {
            o.insert(k.into(), json!(txt(&b[k], m)));
        }
    }
    if tiene("stream") {
        o.insert("stream".into(), json!(url(&b["stream"])));
    }
    if tiene("modo") {
        o.insert("modo".into(), json!(if b["modo"] == "otra" { "otra" } else { "IPF" }));
    }
    if tiene("aprobacion") {
        o.insert("aprobacion".into(), json!(if ["abierta", "mesa", "codigo"].iter().any(|s| b["aprobacion"] == *s) { b["aprobacion"].as_str().unwrap_or("mesa") } else { "mesa" }));
    }
    if tiene("unidades") {
        o.insert("unidades".into(), json!("kg"));
    }
    if tiene("formula") {
        o.insert("formula".into(), json!(if ["GL", "DOTS", "Wilks", "IPF"].iter().any(|s| b["formula"] == *s) { b["formula"].as_str().unwrap_or("GL") } else { "GL" }));
    }
    if tiene("barra") {
        o.insert("barra".into(), nv(num(&b["barra"], 5.0, 50.0).unwrap_or(20.0)));
    }
    if tiene("barraSentadilla") {
        o.insert("barraSentadilla".into(), nv_opt(num(&b["barraSentadilla"], 5.0, 50.0)));
    }
    if tiene("collar") {
        o.insert("collar".into(), nv(num(&b["collar"], 0.0, 10.0).unwrap_or(2.5)));
    }
    if tiene("discos") {
        let l = match b["discos"].as_array() {
            Some(a) => a.iter().take(20).filter(|d| d.is_object()).map(|d| json!({
                "kg": nv(num(&d["kg"], 0.05, 50.0).unwrap_or(0.0)), "pares": nv(num(&d["pares"], 0.0, 50.0).unwrap_or(0.0)), "color": txt(&d["color"], 20),
            })).collect(),
            None => vec![],
        };
        o.insert("discos".into(), Value::Array(l));
    }
    if tiene("relojes") {
        let l = match b["relojes"].as_array() {
            Some(a) => a.iter().take(4).filter_map(|n| num(n, 1.0, 3600.0)).map(nv).collect(),
            None => vec![json!(60), json!(180)],
        };
        o.insert("relojes".into(), Value::Array(l));
    }
    if tiene("pararAlVotar") {
        o.insert("pararAlVotar".into(), Value::Bool(truthy(&b["pararAlVotar"])));
    }
    if tiene("plataformas") {
        let l: Vec<Value> = b["plataformas"].as_array().map(|a| a.iter().take(12).map(|p| txt(p, 40)).filter(|p| !p.is_empty()).map(Value::from).collect()).unwrap_or_default();
        o.insert("plataformas".into(), if l.is_empty() { json!(["Tarima 1"]) } else { Value::Array(l) });
    }
    if tiene("publico") {
        o.insert("publico".into(), Value::Bool(truthy(&b["publico"])));
    }
    if tiene("cerrado") {
        o.insert("cerrado".into(), Value::Bool(truthy(&b["cerrado"])));
    }
    if tiene("hud") {
        let v = &b["hud"];
        if !v.is_object() || largo16(&v.to_string()) > 8000 {
            return mal(400, "Ajustes de pantalla no válidos");
        }
        o.insert("hud".into(), v.clone());
    }
    // `b.privado?.codigoJuez ?? b.codigoJuez`
    let cj: Option<&Value> = if !b["privado"]["codigoJuez"].is_null() { Some(&b["privado"]["codigoJuez"]) } else { b.get("codigoJuez") };
    if let Some(cj) = cj {
        let c = txt_s(&js_string(cj), 40);
        if c.is_empty() {
            return mal(400, "El código de jueces no puede estar vacío");
        }
        o.insert("privado".into(), json!({"codigoJuez": c}));
    }
    if !parcial && !o.contains_key("nombre") {
        return mal(400, "El meet necesita un nombre");
    }
    Ok(o)
}

pub fn id_nuevo(nombre: &str) -> String {
    format!("{}-{}", slug(nombre), hex_aleatorio(3))
}
pub fn codigo_nuevo() -> String {
    format!("{:06}", entero_aleatorio(1_000_000))
}

pub fn meet_nuevo(body: &Value, existe: &dyn Fn(&str) -> bool) -> R<Value> {
    let c = limpiar_campos(body, false)?;
    let nombre = c.get("nombre").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let mut id = if id_seguro(&body["id"]) { body["id"].as_str().unwrap_or("").to_string() } else { id_nuevo(&nombre) };
    while existe(&id) {
        id = id_nuevo(&nombre);
    }
    let ahora = ahora_ms();
    let mut m = Map::new();
    let defs = json!({
        "id": id, "fecha": "", "fechaFin": "", "sede": "", "ciudad": "", "pais": "", "organizador": "", "descripcion": "", "stream": "", "federacion": "", "modo": "IPF",
        "aprobacion": "mesa", "unidades": "kg", "formula": "GL", "barra": 20, "collar": 2.5, "discos": [], "relojes": [60, 180], "pararAlVotar": true,
        "plataformas": ["Tarima 1"], "publico": true, "cerrado": false, "hud": {},
    });
    if let Value::Object(d) = defs {
        m.extend(d);
    }
    let cod = c.get("privado").and_then(|p| p["codigoJuez"].as_str()).map(str::to_string).filter(|s| !s.is_empty()).unwrap_or_else(codigo_nuevo);
    for (k, v) in c {
        m.insert(k, v);
    }
    m.insert("atletas".into(), json!([]));
    m.insert("vivo".into(), json!({}));
    m.insert("aplausos".into(), json!({}));
    m.insert("actividad".into(), json!([]));
    m.insert("privado".into(), json!({"codigoJuez": cod, "juecesConocidos": {}}));
    m.insert("creado".into(), json!(ahora));
    m.insert("actualizado".into(), json!(ahora));
    Ok(Value::Object(m))
}

/// Restaurar una copia: pasa todo por los mismos filtros.
pub fn meet_importado(raw: &Value) -> R<Value> {
    let r = if raw["meet"].is_object() { &raw["meet"] } else { raw };
    if !r.is_object() || !id_seguro(&r["id"]) {
        return mal(400, "La copia no es un meet de OpenMeets");
    }
    let mut cuerpo = r.clone();
    cuerpo["id"] = r["id"].clone();
    let mut m = meet_nuevo(&cuerpo, &|_| false)?;
    m["id"] = r["id"].clone();
    let mut atletas = vec![];
    if let Some(l) = r["atletas"].as_array() {
        for a in l.iter().take(MAX_ATLETAS) {
            atletas.push(limpiar_atleta(a, None)?);
        }
    }
    m["atletas"] = Value::Array(atletas);
    if let Some(v) = r["vivo"].as_object() {
        for (p, x) in v.iter().take(12) {
            if x.is_object() {
                m["vivo"][txt_s(p, 40)] = x.clone();
            }
        }
    }
    if let Some(v) = r["aplausos"].as_object() {
        for (k, n) in v {
            if es_id_seguro(k) {
                m["aplausos"][k.as_str()] = nv(num(n, 0.0, 1e9).unwrap_or(0.0));
            }
        }
    }
    if let Some(l) = r["actividad"].as_array() {
        let desde = l.len().saturating_sub(500);
        m["actividad"] = Value::Array(l[desde..].iter().filter(|x| x.is_object()).map(|x| json!({"ts": nv(num(&x["ts"], 0.0, 9e15).unwrap_or(0.0)), "texto": txt(&x["texto"], 300)})).collect());
    }
    if r["privado"]["juecesConocidos"].is_object() {
        m["privado"]["juecesConocidos"] = r["privado"]["juecesConocidos"].clone();
    }
    let creado = m["creado"].as_f64().unwrap_or(0.0);
    m["creado"] = nv(num(&r["creado"], 0.0, 9e15).unwrap_or(creado));
    Ok(m)
}

pub fn sin_privado(m: &Value) -> Value {
    let mut c = m.clone();
    if let Some(o) = c.as_object_mut() {
        o.shift_remove("privado");
        o.shift_remove("dueno");
    }
    c
}

pub fn anotar(m: &mut Value, texto: &str) {
    if !truthy(&m["actividad"]) {
        m["actividad"] = json!([]);
    }
    if let Some(a) = m["actividad"].as_array_mut() {
        a.push(json!({"ts": ahora_ms(), "texto": txt_s(texto, 300)}));
        if a.len() > 500 {
            let sobra = a.len() - 500;
            a.drain(0..sobra);
        }
    }
}

const ESCENAS_REGIE: [&str; 9] = ["atleta", "siguientes", "clasif", "podio", "mejor", "record", "pausa", "patro", "oculto"];

fn logo_valido(l: &str) -> bool {
    let m = l.to_ascii_lowercase();
    if m.starts_with("http://") || m.starts_with("https://") {
        return l.len() > 8 && !l.chars().any(char::is_whitespace) && {
            let resto = &l[l.find("://").map(|i| i + 3).unwrap_or(0)..];
            !resto.is_empty() && !resto.starts_with(char::is_whitespace)
        };
    }
    for t in ["png", "jpeg", "webp", "svg+xml"] {
        let pre = format!("data:image/{t};base64,");
        if m.starts_with(&pre) {
            let cuerpo = &l[pre.len()..];
            return !cuerpo.is_empty() && cuerpo.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'+' | b'/' | b'='));
        }
    }
    false
}

/// Estado de la regie del HUD: solo campos conocidos y logos como data URL pequeña o URL http(s).
pub fn limpiar_regie(d: &Value) -> Value {
    let logos: Vec<Value> = d["patro"]["logos"].as_array().map(|a| a.iter().filter(|l| l.as_str().is_some_and(|s| largo16(s) <= 40000 && logo_valido(s))).take(8).cloned().collect()).unwrap_or_default();
    let escena = d["escena"].as_str().filter(|s| ESCENAS_REGIE.contains(s)).unwrap_or("");
    json!({
        "modo": if d["modo"] == "manual" { "manual" } else { "auto" },
        "escena": escena,
        "cat": txt(&d["cat"], 120), "texto": txt(&d["texto"], 200),
        "dur": nv(num(&d["dur"], 0.0, 600.0).unwrap_or(0.0)),
        "patro": {"logos": logos, "seg": nv(num(&d["patro"]["seg"], 3.0, 60.0).unwrap_or(8.0))},
        "v": nv(num(&d["v"], 0.0, 9e15).unwrap_or(ahora_ms() as f64)),
    })
}

/// Textos de actividad por cada intento que pasa a válido o nulo.
pub fn cambios_de_resultados(prev: &Value, nuevo: &Value) -> Vec<String> {
    let mut out = vec![];
    for l in LEVS {
        if let Some(lista) = nuevo["intentos"][l].as_array() {
            for (n, i) in lista.iter().enumerate() {
                let antes = &prev["intentos"][l][n];
                let r = &i["r"];
                let r_antes = if antes["r"].is_null() { &Value::Null } else { &antes["r"] };
                if !r.is_null() && r != r_antes {
                    let kg = if i["kg"].is_null() { "?".to_string() } else { js_string(&i["kg"]) };
                    out.push(format!("{}: {} {} · {} kg · {}", js_string(&nuevo["nombre"]), nombre_lev(l), n + 1, kg, if *r == 1 { "válido" } else { "nulo" }));
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn atleta_y_meet() {
        let a = limpiar_atleta(&json!({"id": "a1", "nombre": "  Ana ", "sexo": "F", "peso": "62.4", "intentos": {"S": [{"kg": "100", "r": 1}]}}), None).unwrap();
        assert_eq!(a["nombre"], "Ana");
        assert_eq!(a["peso"], 62.4);
        assert_eq!(a["intentos"]["S"][0]["kg"], 100);
        assert_eq!(a["intentos"]["B"], json!([]));
        assert_eq!(a["division"], "Open");
        assert!(limpiar_atleta(&json!({"id": "MAL"}), None).is_err());
        let m = meet_nuevo(&json!({"nombre": "Copa Ñandú 2026", "fecha": "2030-01-01"}), &|_| false).unwrap();
        assert!(m["id"].as_str().unwrap().starts_with("copa-nandu-2026-"));
        assert_eq!(m["privado"]["codigoJuez"].as_str().unwrap().len(), 6);
        assert!(meet_nuevo(&json!({"fecha": "2030-01-01"}), &|_| false).is_err());
        assert!(meet_nuevo(&json!({"nombre": "x", "fecha": "mañana"}), &|_| false).is_err());
    }

    #[test]
    fn regie_y_cambios() {
        let r = limpiar_regie(&json!({"escena": "podio", "modo": "manual", "patro": {"logos": ["data:image/png;base64,AAAA", "javascript:1"], "seg": 999}}));
        assert_eq!(r["patro"]["logos"].as_array().unwrap().len(), 1);
        assert_eq!(r["patro"]["seg"], 8);
        let prev = json!({"intentos": {"S": [{"r": null}]}});
        let nuevo = json!({"nombre": "Ana", "intentos": {"S": [{"kg": 100, "r": 1}]}});
        assert_eq!(cambios_de_resultados(&prev, &nuevo), vec!["Ana: sentadilla 1 · 100 kg · válido"]);
    }
}
