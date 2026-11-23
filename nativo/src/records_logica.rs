//! Tabla de récords y exportación OpenPowerlifting (puro). Port de web/js/nucleo/records.js y servidor/openpowerlifting.mjs.
use crate::calculo::*;
use crate::js::*;
use serde_json::{Map, Value, json};

pub const LEVS_REC: [&str; 4] = ["S", "B", "D", "total"];
pub const MAX_RECORDS: usize = 5000;
const MAX_HISTORIAL: usize = 50;
const ORDEN_NIVEL: [&str; 5] = ["mundial", "ibero", "nacional", "regional", "otro"];
const NIVELES: [&str; 5] = ["mundial", "nacional", "ibero", "regional", "otro"];
const MAX_REC_TEXTO: usize = 40;

fn n(x: &str) -> String {
    normalizar_nombre(x)
}
fn nv_(x: &Value) -> String {
    n(&js_string_vacio(x))
}
/// `txt` de records.js: cadenas y números.
fn txt(x: &Value, max: usize) -> String {
    match x {
        Value::String(_) | Value::Number(_) => txt_s(&js_string(x), max),
        _ => String::new(),
    }
}
fn id_ok(v: &Value) -> bool {
    id_seguro(v)
}

/// Clave del récord vigente.
pub fn clave_record(r: &Value) -> String {
    let otro = r["nivel"] == "otro";
    [nv_(&r["federacion"]), js_string_vacio(&r["nivel"]), if otro { nv_(&r["nivelTexto"]) } else { String::new() }, js_string_vacio(&r["sexo"]), nv_(&r["division"]), js_string_vacio(&r["equipamiento"]), nv_(&r["clase"]), js_string_vacio(&r["lev"])].join("|")
}

fn sexo(v: &Value) -> Option<&'static str> {
    let s = js_string(v);
    let s = trim_js(&s).to_lowercase();
    if ["f", "mujer", "mújer", "mujeres", "fem"].iter().any(|p| s.starts_with(p)) || s.starts_with("mújer") {
        Some("F")
    } else if ["m", "h", "hombre", "masc"].iter().any(|p| s.starts_with(p)) {
        Some("M")
    } else {
        None
    }
}
fn equipo(v: &Value) -> Option<&'static str> {
    let s = js_string(v);
    let s = trim_js(&s).to_lowercase();
    if ["equip", "equipped", "multi"].iter().any(|p| s.starts_with(p)) {
        Some("equipado")
    } else if ["raw", "clasic", "clásic", "classic", "unequipped"].iter().any(|p| s.starts_with(p)) || s.starts_with("sinequip") || s.starts_with("sin equip") {
        Some("raw")
    } else {
        None
    }
}
fn lev(v: &Value) -> Option<&'static str> {
    let s = nv_(v);
    if s == "s" || s.starts_with("sentad") || s.starts_with("squat") {
        Some("S")
    } else if s == "b" || s.starts_with("banca") || s.starts_with("press") || s.starts_with("bench") {
        Some("B")
    } else if s == "d" || s.starts_with("peso muerto") || s.starts_with("deadlift") {
        Some("D")
    } else if s == "total" || s == "t" {
        Some("total")
    } else {
        None
    }
}
fn nivel(v: &Value) -> Option<&'static str> {
    let s = nv_(v);
    NIVELES.iter().find(|x| **x == s).copied().or(if s.starts_with("iberoam") { Some("ibero") } else { None })
}

pub fn instantanea(r: &Value) -> Value {
    let mut o = Map::new();
    o.insert("kg".into(), nv(num_o_cero(&r["kg"])));
    o.insert("atleta".into(), json!(txt(&r["atleta"], 80)));
    o.insert("fecha".into(), json!(if r["fecha"].as_str().is_some_and(es_fecha) { r["fecha"].clone() } else { json!("") }));
    o.insert("meet".into(), json!(txt(&r["meet"], 120)));
    o.insert("lugar".into(), json!(txt(&r["lugar"], 120)));
    o.insert("fuente".into(), json!(txt(&r["fuente"], 200)));
    o.insert("homologado".into(), json!(r["homologado"] != false));
    if id_ok(&r["meetId"]) {
        o.insert("meetId".into(), r["meetId"].clone());
    }
    if id_ok(&r["aid"]) {
        o.insert("aid".into(), r["aid"].clone());
    }
    Value::Object(o)
}

/// Valida y limpia un récord (de la API o de una fila de CSV).
pub fn normalizar_record(o: &Value) -> Result<Value, String> {
    if !o.is_object() {
        return Err("Récord no válido".into());
    }
    let federacion = txt(&o["federacion"], 60);
    if federacion.is_empty() {
        return Err("Falta la federación".into());
    }
    let Some(niv) = nivel(&o["nivel"]) else { return Err("El nivel debe ser mundial, nacional, ibero, regional u otro".into()) };
    let nivel_texto = if niv == "otro" { txt(&o["nivelTexto"], MAX_REC_TEXTO) } else { String::new() };
    if niv == "otro" && nivel_texto.is_empty() {
        return Err("Escribe el nombre del nivel (por ejemplo, «Panamericano»)".into());
    }
    let Some(sx) = sexo(&o["sexo"]) else { return Err("El sexo debe ser M o F".into()) };
    let eq_v = if o["equipamiento"].is_null() { json!("raw") } else { o["equipamiento"].clone() };
    let Some(eq) = equipo(&eq_v) else { return Err("El equipamiento debe ser raw o equipado".into()) };
    let lv_v = if o["lev"].is_null() { &o["levantamiento"] } else { &o["lev"] };
    let Some(lv) = lev(lv_v) else { return Err("El levantamiento debe ser S, B, D o total".into()) };
    let kg_n = match &o["kg"] {
        Value::String(s) => js_number_str(&s.replace(',', ".")),
        Value::Number(x) => x.as_f64().unwrap_or(f64::NAN),
        _ => f64::NAN,
    };
    if !kg_n.is_finite() || kg_n <= 0.0 || kg_n > 2000.0 {
        return Err("El peso debe ser un número entre 0 y 2000 kg".into());
    }
    let atleta = txt(&o["atleta"], 80);
    if atleta.is_empty() {
        return Err("Falta el nombre del atleta".into());
    }
    let fecha = if truthy(&o["fecha"]) { trim_js(&js_string(&o["fecha"])).to_string() } else { String::new() };
    if !fecha.is_empty() && !es_fecha(&fecha) {
        return Err("La fecha debe ser AAAA-MM-DD".into());
    }
    let hom = &o["homologado"];
    let homologado = if hom.is_null() || *hom == "" {
        true
    } else {
        *hom == true || ["si", "sí", "s", "true", "1", "yes", "y"].contains(&trim_js(&js_string(hom)).to_lowercase().as_str())
    };
    let division = txt(&o["division"], 40);
    let mut r = Map::new();
    r.insert("id".into(), if id_ok(&o["id"]) { o["id"].clone() } else { json!("") });
    r.insert("federacion".into(), json!(federacion));
    r.insert("nivel".into(), json!(niv));
    r.insert("nivelTexto".into(), json!(nivel_texto));
    r.insert("sexo".into(), json!(sx));
    r.insert("division".into(), json!(if division.is_empty() { "Open".to_string() } else { division }));
    r.insert("equipamiento".into(), json!(eq));
    r.insert("clase".into(), json!(txt(&o["clase"], 12)));
    r.insert("lev".into(), json!(lv));
    r.insert("kg".into(), nv((kg_n * 100.0 + 0.5).floor() / 100.0));
    r.insert("atleta".into(), json!(atleta));
    r.insert("fecha".into(), json!(fecha));
    r.insert("meet".into(), json!(txt(&o["meet"], 120)));
    r.insert("lugar".into(), json!(txt(&o["lugar"], 120)));
    r.insert("fuente".into(), json!(txt(&o["fuente"], 200)));
    r.insert("homologado".into(), json!(homologado));
    if id_ok(&o["meetId"]) {
        r.insert("meetId".into(), o["meetId"].clone());
    }
    if id_ok(&o["aid"]) {
        r.insert("aid".into(), o["aid"].clone());
    }
    let hist: Vec<Value> = o["historial"].as_array().map(|a| a.iter().take(MAX_HISTORIAL).map(instantanea).filter(|h| h["kg"].as_f64().unwrap_or(0.0) > 0.0).collect()).unwrap_or_default();
    r.insert("historial".into(), Value::Array(hist));
    Ok(Value::Object(r))
}

fn num_clase(c: &str) -> f64 {
    let (mas, resto) = match c.as_bytes().first() {
        Some(b'+') => (true, &c[1..]),
        Some(b'-') => (false, &c[1..]),
        _ => (false, c),
    };
    let fin = resto.find(|ch: char| !(ch.is_ascii_digit() || ch == '.')).unwrap_or(resto.len());
    let mut num_txt = &resto[..fin];
    // \d+(\.\d+)?: sin punto final
    if let Some(s) = num_txt.strip_suffix('.') {
        num_txt = s;
    }
    if num_txt.is_empty() || !num_txt.as_bytes()[0].is_ascii_digit() {
        return 1e5;
    }
    num_txt.parse::<f64>().map(|v| v + if mas { 1e4 } else { 0.0 }).unwrap_or(1e5)
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or("")
}

/// Orden de lectura: federación, nivel, sexo, división, equipamiento, clase y levantamiento.
pub fn ordenar_records(lista: &[Value]) -> Vec<Value> {
    let mut v: Vec<Value> = lista.to_vec();
    v.sort_by(|a, b| {
        let idx = |x: &Value| ORDEN_NIVEL.iter().position(|n| *n == s(x, "nivel")).map(|i| i as i64).unwrap_or(-1);
        loc_cmp(s(a, "federacion"), s(b, "federacion"))
            .then(idx(a).cmp(&idx(b)))
            .then_with(|| loc_cmp(s(a, "nivelTexto"), s(b, "nivelTexto")))
            .then_with(|| if a["sexo"] == b["sexo"] { std::cmp::Ordering::Equal } else if a["sexo"] == "F" { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater })
            .then_with(|| loc_cmp(s(a, "division"), s(b, "division")))
            .then_with(|| loc_cmp(s(a, "equipamiento"), s(b, "equipamiento")))
            .then_with(|| num_clase(s(a, "clase")).partial_cmp(&num_clase(s(b, "clase"))).unwrap_or(std::cmp::Ordering::Equal))
            .then_with(|| LEVS_REC.iter().position(|l| *l == s(a, "lev")).cmp(&LEVS_REC.iter().position(|l| *l == s(b, "lev"))))
    });
    v
}

/// Filtros: federacion, nivel, sexo, division, equipamiento, clase, lev, q, meetId, pendientes.
pub fn filtrar_records(tabla: &[Value], f: &HashMap<String, String>) -> Vec<Value> {
    let g = |k: &str| f.get(k).map(String::as_str).unwrap_or("");
    let eq = |v: &str, w: &Value| v.is_empty() || n(v) == nv_(w);
    let q = n(g("q"));
    let sel: Vec<Value> = tabla.iter().filter(|r| {
        eq(g("federacion"), &r["federacion"]) && (g("nivel").is_empty() || g("nivel") == s(r, "nivel")) && (g("sexo").is_empty() || g("sexo") == s(r, "sexo"))
            && eq(g("division"), &r["division"]) && (g("equipamiento").is_empty() || g("equipamiento") == s(r, "equipamiento")) && eq(g("clase"), &r["clase"]) && (g("lev").is_empty() || g("lev") == s(r, "lev"))
            && (g("meetId").is_empty() || g("meetId") == s(r, "meetId")) && (g("pendientes").is_empty() || g("pendientes") == "0" || r["homologado"] == false)
            && (q.is_empty() || {
                let mut partes: Vec<String> = ["atleta", "meet", "lugar", "fuente", "federacion", "nivelTexto"].iter().map(|k| js_string_vacio(&r[*k])).collect();
                partes.extend(r["historial"].as_array().map(|h| h.iter().map(|x| js_string_vacio(&x["atleta"])).collect::<Vec<_>>()).unwrap_or_default());
                n(&partes.join(" ")).contains(&q)
            })
    }).cloned().collect();
    ordenar_records(&sel)
}
use std::collections::HashMap;

pub enum Cambio {
    Nuevo,
    Igual,
    Reemplazo,
    Actualizado,
}

/// Pone un récord en la tabla (muta `tabla`). Devuelve el récord resultante y el tipo de cambio.
pub fn registrar_record(tabla: &mut Vec<Value>, datos: &Value, id: &str, mismo: bool) -> (Value, Cambio) {
    let k = clave_record(datos);
    let Some(pos) = tabla.iter().position(|x| clave_record(x) == k) else {
        let mut nuevo = datos.as_object().cloned().unwrap_or_default();
        let idf = if truthy(&datos["id"]) { datos["id"].clone() } else if !id.is_empty() { json!(id) } else { json!(format!("rc-{}", hex_aleatorio(4))) };
        nuevo.insert("id".into(), idf);
        let h = if truthy(&datos["historial"]) { datos["historial"].clone() } else { json!([]) };
        nuevo.insert("historial".into(), h);
        let v = Value::Object(nuevo);
        tabla.push(v.clone());
        return (v, Cambio::Nuevo);
    };
    let r = &mut tabla[pos];
    if r["kg"].as_f64() == datos["kg"].as_f64() && nv_(&r["atleta"]) == nv_(&datos["atleta"]) && r["fecha"] == datos["fecha"] {
        return (r.clone(), Cambio::Igual);
    }
    if !mismo {
        let mut h = vec![instantanea(r)];
        h.extend(r["historial"].as_array().cloned().unwrap_or_default());
        h.truncate(MAX_HISTORIAL);
        r["historial"] = Value::Array(h);
    }
    if let Some(o) = r.as_object_mut() {
        for c in ["meetId", "aid"] {
            o.shift_remove(c);
        }
        if let Some(d) = datos.as_object() {
            for (k, v) in d {
                if k != "id" && k != "historial" {
                    o.insert(k.clone(), v.clone());
                }
            }
        }
    }
    (r.clone(), if mismo { Cambio::Actualizado } else { Cambio::Reemplazo })
}

/* ---------- ¿Este intento supera un récord? ---------- */

fn clase_atleta(a: &Value, meet: &Value) -> String {
    let fed = if meet["federacion"].is_null() { "IPF".to_string() } else { js_string(&meet["federacion"]) };
    clase_del_atleta(a, &fed)
}

fn aplica(r: &Value, a: &Value, meet: &Value) -> bool {
    nv_(&r["federacion"]) == nv_(&meet["federacion"]) && s(r, "sexo") == if a["sexo"] == "F" { "F" } else { "M" }
        && (!truthy(&r["division"]) || nv_(&r["division"]) == n(&if truthy(&a["division"]) { js_string(&a["division"]) } else { "Open".into() }))
        && s(r, "equipamiento") == if a["equipamiento"] == "equipado" { "equipado" } else { "raw" }
        && (!truthy(&r["clase"]) || nv_(&r["clase"]) == n(&clase_atleta(a, meet)))
}

pub struct Supera {
    pub registro: Value,
    pub kg: f64,
}

/// Récords de la tabla que superaría `kg` en `lev` para este atleta en este meet. Un empate no cuenta.
pub fn records_que_supera(atleta: &Value, lv: &str, kg: &Value, tabla: &[Value], meet: &Value) -> Vec<Supera> {
    let mut out = vec![];
    let kg_n = js_to_number(kg);
    if !atleta.is_object() || !(kg_n > 0.0) || n(&js_string_vacio(&meet["federacion"])).is_empty() || !LEVS_REC.contains(&lv) {
        return out;
    }
    let mut probar = |l: &str, valor: f64| {
        for r in tabla {
            if s(r, "lev") == l && aplica(r, atleta, meet) && valor > js_to_number(&r["kg"]) {
                out.push(Supera { registro: r.clone(), kg: valor });
            }
        }
    };
    probar(lv, kg_n);
    if lv != "total" {
        let levs: Vec<String> = match atleta["levantes"].as_array() {
            Some(l) if truthy(&atleta["levantes"]) => l.iter().map(js_string).collect(),
            _ => ORDEN_LEV.iter().map(|x| x.to_string()).collect(),
        };
        let marcas: Vec<f64> = levs.iter().map(|l| mejor(atleta, l).max(if l == lv { kg_n } else { 0.0 })).collect();
        if levs.iter().any(|l| l == lv) && marcas.iter().all(|x| *x > 0.0) {
            probar("total", marcas.iter().sum());
        }
    }
    out
}

pub struct Hecho {
    pub record: Value,
}

/// Récords nuevos que dejó la última escritura de un atleta: cada intento que pasó a válido y supera la tabla.
pub fn registrar_automaticos(tabla: &mut Vec<Value>, meet: &Value, antes: &Value, despues: &Value) -> Vec<Hecho> {
    let mut hechos = vec![];
    for lv in ORDEN_LEV {
        for i in 0..3 {
            let ni = &despues["intentos"][lv][i];
            if ni["r"].as_f64() != Some(1.0) || !(js_to_number(&ni["kg"]) > 0.0) || antes["intentos"][lv][i]["r"].as_f64() == Some(1.0) {
                continue;
            }
            let candidatos = records_que_supera(despues, lv, &ni["kg"], tabla, meet);
            for c in candidatos {
                let base = &c.registro;
                let mismo = base["meetId"] == meet["id"] && !base["meetId"].is_null() && base["aid"] == despues["id"];
                let mut datos = base.as_object().cloned().unwrap_or_default();
                datos.insert("kg".into(), nv(c.kg));
                datos.insert("atleta".into(), despues["nombre"].clone());
                datos.insert("fecha".into(), if truthy(&meet["fecha"]) { meet["fecha"].clone() } else { json!("") });
                datos.insert("meet".into(), if truthy(&meet["nombre"]) { meet["nombre"].clone() } else { json!("") });
                let lugar: Vec<String> = [&meet["sede"], &meet["ciudad"]].iter().filter(|v| truthy(v)).map(|v| js_string(v)).collect();
                datos.insert("lugar".into(), json!(lugar.join(", ")));
                datos.insert("fuente".into(), json!("OpenMeets · mesa"));
                datos.insert("homologado".into(), json!(false));
                datos.insert("meetId".into(), meet["id"].clone());
                datos.insert("aid".into(), despues["id"].clone());
                datos.shift_remove("historial");
                let (record, _) = registrar_record(tabla, &Value::Object(datos), "", mismo);
                hechos.push(Hecho { record });
            }
        }
    }
    hechos
}

/* ---------- CSV ---------- */

pub const COLUMNAS_CSV: [&str; 15] = ["federacion", "nivel", "nivel_texto", "sexo", "division", "equipamiento", "clase", "levantamiento", "kg", "atleta", "fecha", "meet", "lugar", "fuente", "homologado"];

fn celda_q(v: &Value) -> String {
    format!("\"{}\"", js_string_vacio(v).replace('"', "\"\""))
}

pub fn records_a_csv(lista: &[Value]) -> String {
    let mut l: Vec<String> = vec![COLUMNAS_CSV.iter().map(|c| celda_q(&json!(c))).collect::<Vec<_>>().join(",")];
    for r in ordenar_records(lista) {
        let h = if r["homologado"].as_bool().unwrap_or(false) || truthy(&r["homologado"]) { "si" } else { "no" };
        let f = [&r["federacion"], &r["nivel"], &r["nivelTexto"], &r["sexo"], &r["division"], &r["equipamiento"], &r["clase"], &r["lev"], &r["kg"], &r["atleta"], &r["fecha"], &r["meet"], &r["lugar"], &r["fuente"], &json!(h)];
        l.push(f.iter().map(|v| celda_q(v)).collect::<Vec<_>>().join(","));
    }
    format!("\u{feff}{}\r\n", l.join("\r\n"))
}

pub fn plantilla_records_csv() -> String {
    format!("{}\"IPF\",mundial,,F,Open,raw,-63,S,235.5,\"Nombre Apellido\",2025-06-14,\"Campeonato Mundial\",\"Lugar, País\",\"https://fuente.example/ipf\",si\r\n", records_a_csv(&[]))
}

fn filas_csv_texto(texto: &str) -> Vec<Vec<String>> {
    let t = texto.trim_start_matches('\u{feff}');
    let prim = t.split('\n').next().unwrap_or("");
    let sep = if prim.matches(';').count() > prim.matches(',').count() { ';' } else { ',' };
    let mut filas = vec![];
    let (mut f, mut c, mut q) = (vec![], String::new(), false);
    let ch: Vec<char> = t.chars().collect();
    let mut i = 0;
    while i < ch.len() {
        let x = ch[i];
        if q {
            if x == '"' && ch.get(i + 1) == Some(&'"') {
                c.push('"');
                i += 1;
            } else if x == '"' {
                q = false;
            } else {
                c.push(x);
            }
        } else if x == '"' {
            q = true;
        } else if x == sep {
            f.push(std::mem::take(&mut c));
        } else if x == '\n' {
            f.push(std::mem::take(&mut c));
            filas.push(std::mem::take(&mut f));
        } else if x != '\r' {
            c.push(x);
        }
        i += 1;
    }
    if !c.is_empty() || !f.is_empty() {
        f.push(c);
        filas.push(f);
    }
    filas
}

/// CSV → (records, errores [(linea, error)]).
pub fn records_de_csv(texto: &str) -> (Vec<Value>, Vec<(usize, String)>) {
    let mut filas = filas_csv_texto(texto);
    let cab: Vec<String> = if filas.is_empty() { vec![] } else { filas.remove(0) }.iter().map(|x| n(x).replace(' ', "_")).collect();
    let (mut records, mut errores) = (vec![], vec![]);
    if !cab.iter().any(|c| c == "federacion") || !cab.iter().any(|c| c == "kg") {
        return (records, vec![(1, "Faltan las columnas «federacion» y «kg». Descarga la plantilla para ver el formato.".into())]);
    }
    for (i, x) in filas.iter().enumerate() {
        if !x.iter().any(|y| !trim_js(y).is_empty()) {
            continue;
        }
        let mut o = Map::new();
        for (j, k) in cab.iter().enumerate() {
            o.insert(k.clone(), json!(trim_js(x.get(j).map(String::as_str).unwrap_or(""))));
        }
        let nivel_texto = o.get("nivel_texto").cloned().unwrap_or(Value::Null);
        let lv = match o.get("levantamiento") {
            Some(v) if truthy(v) => v.clone(),
            _ => o.get("lev").cloned().unwrap_or(Value::Null),
        };
        o.insert("nivelTexto".into(), nivel_texto);
        o.insert("lev".into(), lv);
        match normalizar_record(&Value::Object(o)) {
            Ok(mut r) => {
                if let Some(m) = r.as_object_mut() {
                    m.shift_remove("id");
                    m.shift_remove("historial");
                }
                records.push(r);
            }
            Err(e) => errores.push((i + 2, e)),
        }
    }
    (records, errores)
}

pub fn nombre_nivel(r: &Value) -> String {
    match s(r, "nivel") {
        "otro" => js_string_vacio(&r["nivelTexto"]),
        "mundial" => "Mundial".into(),
        "nacional" => "Nacional".into(),
        "ibero" => "Iberoamericano".into(),
        "regional" => "Regional".into(),
        otro => otro.to_string(),
    }
}
pub fn nombre_lev_rec(l: &str) -> &'static str {
    match l {
        "S" => "Sentadilla",
        "B" => "Press banca",
        "D" => "Peso muerto",
        _ => "Total",
    }
}

/* ====================== OpenPowerlifting ====================== */

pub const FEDERACIONES_TESTEADAS: [&str; 2] = ["IPF", "FCLP"];
pub const COLUMNAS_OPL: [&str; 33] = [
    "Name", "Sex", "Event", "Equipment", "Age", "Division", "BodyweightKg", "WeightClassKg",
    "Squat1Kg", "Squat2Kg", "Squat3Kg", "Squat4Kg", "Best3SquatKg",
    "Bench1Kg", "Bench2Kg", "Bench3Kg", "Bench4Kg", "Best3BenchKg",
    "Deadlift1Kg", "Deadlift2Kg", "Deadlift3Kg", "Deadlift4Kg", "Best3DeadliftKg",
    "TotalKg", "Place", "Tested", "Country", "Federation", "Date", "MeetCountry", "MeetState", "MeetTown", "MeetName",
];

/// '-83' → '83' · '+120' → '120+' · '83 kg' → '83'.
pub fn clase_opl(clase: &Value) -> String {
    let t = js_string_vacio(clase);
    let mut c = String::new();
    let mut resto = t.as_str();
    while !resto.is_empty() {
        if resto.len() >= 2 && resto.is_char_boundary(2) && resto[..2].eq_ignore_ascii_case("kg") {
            resto = &resto[2..];
        } else {
            let ch = resto.chars().next().unwrap_or(' ');
            c.push(ch);
            resto = &resto[ch.len_utf8()..];
        }
    }
    let c = trim_js(&c.replacen(',', ".", 1)).to_string();
    if c.is_empty() {
        return c;
    }
    if let Some(r) = c.strip_prefix('+') {
        return format!("{r}+");
    }
    c.strip_prefix('-').unwrap_or(&c).to_string()
}

pub fn evento_opl(a: &Value) -> String {
    let levs: Vec<String> = match a["levantes"].as_array() {
        Some(l) if truthy(&a["levantes"]) => l.iter().map(js_string).collect(),
        _ => ORDEN_LEV.iter().map(|x| x.to_string()).collect(),
    };
    let e: String = ORDEN_LEV.iter().filter(|l| levs.iter().any(|x| x == *l)).copied().collect();
    if e.is_empty() { "SBD".into() } else { e }
}

fn partes_fecha(t: &str) -> Option<(i64, i64, i64)> {
    if !es_fecha(t) {
        return None;
    }
    Some((t[0..4].parse().ok()?, t[5..7].parse().ok()?, t[8..10].parse().ok()?))
}
/// Edad en años cumplidos el día del meet; vacío si no hay fecha de nacimiento.
pub fn edad_en(nacimiento: &Value, fecha_meet: &Value) -> Value {
    let (Some(nn), Some(ff)) = (partes_fecha(nacimiento.as_str().unwrap_or("")), partes_fecha(fecha_meet.as_str().unwrap_or(""))) else { return json!("") };
    let mut e = ff.0 - nn.0;
    if ff.1 < nn.1 || (ff.1 == nn.1 && ff.2 < nn.2) {
        e -= 1;
    }
    if (0..120).contains(&e) { json!(e) } else { json!("") }
}

fn valor_opl(i: &Value) -> Value {
    let kg = js_to_number(&i["kg"]);
    if truthy(i) && kg > 0.0 {
        match i["r"].as_f64() {
            Some(1.0) => nv(kg),
            Some(-1.0) => nv(-kg),
            _ => json!(""),
        }
    } else {
        json!("")
    }
}

fn lugar(a: &Value, puesto: Option<usize>) -> Value {
    if let Some(p) = puesto {
        return json!(p);
    }
    let levo = ORDEN_LEV.iter().any(|l| a["intentos"][*l].as_array().is_some_and(|v| v.iter().any(|i| truthy(i) && (i["r"].as_f64() == Some(1.0) || i["r"].as_f64() == Some(-1.0)))));
    json!(if levo { "DQ" } else { "NS" })
}

fn o_vacio(v: &Value) -> Value {
    if truthy(v) { v.clone() } else { json!("") }
}

/// El CSV completo de un meet. Una fila por atleta, en el orden de su categoría.
pub fn open_powerlifting_csv(meet: &Value) -> String {
    let fed = js_string_vacio(&meet["federacion"]).to_uppercase();
    let tested = if FEDERACIONES_TESTEADAS.contains(&fed.as_str()) { "Yes" } else { "" };
    let vacio = vec![];
    let lista = meet["atletas"].as_array().unwrap_or(&vacio);
    let mut filas: Vec<Vec<Value>> = vec![];
    for g in clasificacion(lista) {
        for f in g.filas {
            let a = f.a;
            let levs: Vec<String> = match a["levantes"].as_array() {
                Some(l) if truthy(&a["levantes"]) => l.iter().map(js_string).collect(),
                _ => ORDEN_LEV.iter().map(|x| x.to_string()).collect(),
            };
            let mut celdas = vec![];
            for l in ORDEN_LEV {
                for n in 0..4 {
                    celdas.push(valor_opl(&a["intentos"][l][n]));
                }
                let m = mejor(a, l);
                celdas.push(if levs.iter().any(|x| x == l) && m != 0.0 { nv(m) } else { json!("") });
            }
            let p = peso_de(a);
            let t = total(a);
            let mut fila = vec![
                a["nombre"].clone(), json!(if a["sexo"] == "F" { "F" } else { "M" }), json!(evento_opl(a)), json!(if a["equipamiento"] == "equipado" { "Multi-ply" } else { "Raw" }),
                edad_en(&a["nacimiento"], &meet["fecha"]), if truthy(&a["division"]) { a["division"].clone() } else { json!("Open") }, if p != 0.0 { nv(p) } else { json!("") }, json!(clase_opl(&a["clase"])),
            ];
            fila.extend(celdas);
            fila.extend([if t != 0.0 { nv(t) } else { json!("") }, lugar(a, f.puesto), json!(tested), o_vacio(&a["pais"]), o_vacio(&meet["federacion"]), o_vacio(&meet["fecha"]), o_vacio(&meet["pais"]), json!(""), o_vacio(&meet["ciudad"]), o_vacio(&meet["nombre"])]);
            filas.push(fila);
        }
    }
    let cab: Vec<Value> = COLUMNAS_OPL.iter().map(|c| json!(c)).collect();
    filas_csv(cab, filas, false, true)
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn rec(extra: Value) -> Value {
        let mut b = json!({"federacion": "IPF", "nivel": "mundial", "sexo": "F", "division": "Open", "equipamiento": "raw", "clase": "-63", "lev": "S", "kg": 235.5, "atleta": "Ana", "fecha": "2025-06-14"});
        for (k, v) in extra.as_object().unwrap() {
            b[k] = v.clone();
        }
        normalizar_record(&b).unwrap()
    }

    #[test]
    fn valida_records() {
        assert!(normalizar_record(&json!({})).is_err());
        assert_eq!(normalizar_record(&json!({"federacion": "IPF", "nivel": "x"})).unwrap_err(), "El nivel debe ser mundial, nacional, ibero, regional u otro");
        assert_eq!(rec(json!({"sexo": "Mujer", "kg": "235,5", "nivel": "Iberoamericano", "levantamiento": null}))["nivel"], "ibero");
        assert_eq!(rec(json!({"kg": "1,234"}))["kg"], 1.23);
        assert!(normalizar_record(&json!({"federacion": "IPF", "nivel": "otro", "sexo": "M", "lev": "S", "kg": 1, "atleta": "x"})).is_err(), "nivel otro pide nombre");
        assert_eq!(rec(json!({"homologado": "no"}))["homologado"], false);
        assert_eq!(rec(json!({}))["homologado"], true);
    }

    #[test]
    fn registrar_y_superar() {
        let mut tabla = vec![];
        let r = rec(json!({}));
        let (_, c) = registrar_record(&mut tabla, &r, "rc-1", false);
        assert!(matches!(c, Cambio::Nuevo));
        assert_eq!(tabla[0]["id"], "rc-1");
        let (_, c) = registrar_record(&mut tabla, &r, "rc-2", false);
        assert!(matches!(c, Cambio::Igual));
        let mejorado = rec(json!({"kg": 240, "atleta": "Bea"}));
        let (nuevo, c) = registrar_record(&mut tabla, &mejorado, "rc-3", false);
        assert!(matches!(c, Cambio::Reemplazo));
        assert_eq!(nuevo["historial"][0]["atleta"], "Ana");
        let meet = json!({"id": "m", "federacion": "IPF", "nombre": "Copa", "fecha": "2026-01-01"});
        let atleta = json!({"id": "a1", "nombre": "Cris", "sexo": "F", "clase": "-63", "division": "Open", "equipamiento": "raw", "peso": 62, "intentos": {"S": [{"kg": 241, "r": 1}], "B": [], "D": []}});
        assert_eq!(records_que_supera(&atleta, "S", &json!(241), &tabla, &meet).len(), 1);
        assert_eq!(records_que_supera(&atleta, "S", &json!(240), &tabla, &meet).len(), 0, "un empate no cuenta");
        let antes = json!({"intentos": {"S": [{"kg": 241, "r": null}]}});
        let hechos = registrar_automaticos(&mut tabla, &meet, &antes, &atleta);
        assert_eq!(hechos.len(), 1);
        assert_eq!(tabla[0]["kg"], 241);
        assert_eq!(tabla[0]["homologado"], false);
        assert_eq!(tabla[0]["historial"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn csv_ida_y_vuelta() {
        let csv = plantilla_records_csv();
        let (recs, errores) = records_de_csv(&csv);
        assert!(errores.is_empty(), "{errores:?}");
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0]["kg"], 235.5);
        assert_eq!(records_de_csv("a,b\n1,2").1[0].0, 1);
        let t = vec![rec(json!({}))];
        assert!(records_a_csv(&t).contains("\"IPF\",\"mundial\",\"\",\"F\""));
    }

    #[test]
    fn opl() {
        assert_eq!(clase_opl(&json!("-83")), "83");
        assert_eq!(clase_opl(&json!("+120")), "120+");
        assert_eq!(clase_opl(&json!("83 kg")), "83");
        assert_eq!(edad_en(&json!("2000-06-15"), &json!("2026-06-14")), 25);
        assert_eq!(edad_en(&json!(null), &json!("2026-06-14")), "");
        let it = |kg: i32, r: i32| json!({"kg": kg, "r": r});
        let meet = json!({"federacion": "IPF", "fecha": "2026-06-14", "nombre": "Copa", "atletas": [
            {"id": "a", "nombre": "Ana", "sexo": "F", "peso": 60, "clase": "-63", "division": "Open", "intentos": {"S": [it(100, 1), it(105, -1)], "B": [it(60, 1)], "D": [it(120, 1)]}}]});
        let csv = open_powerlifting_csv(&meet);
        let l: Vec<&str> = csv.lines().collect();
        assert!(l[0].starts_with("Name,Sex,Event,Equipment"));
        assert!(l[1].starts_with("Ana,F,SBD,Raw,,Open,60,63,100,-105,"), "{}", l[1]);
        assert!(l[1].contains(",Yes,"));
    }
}
