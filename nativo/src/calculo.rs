//! Reglas de competencia que usa el servidor: federaciones y categorías, puntajes (GL, DOTS, Wilks),
//! totales, clasificación, estado del meet y CSV. Port de web/js/nucleo/{federaciones,puntajes,competencia,calculo}.js.
use crate::js::*;
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::OnceLock;

pub const ORDEN_LEV: [&str; 3] = ["S", "B", "D"];

/* ====================== Federaciones ====================== */

pub struct Division {
    pub nombre: String,
    #[allow(dead_code)]
    pub edad: String,
}
pub struct Categoria {
    pub pesos_m: Vec<String>,
    pub pesos_f: Vec<String>,
    /// (divisiones, clases M, clases F) con una clase más liviana solo para ellas.
    pub juvenil: Option<(Vec<String>, Vec<String>, Vec<String>)>,
    pub divisiones: Vec<Division>,
}

fn sv(l: &[&str]) -> Vec<String> {
    l.iter().map(|s| s.to_string()).collect()
}
fn dv(l: &[(&str, &str)]) -> Vec<Division> {
    l.iter().map(|(n, e)| Division { nombre: n.to_string(), edad: e.to_string() }).collect()
}

const M5: [&str; 12] = ["-52", "-56", "-60", "-67.5", "-75", "-82.5", "-90", "-100", "-110", "-125", "-140", "+140"];
const F_DEL_90: [&str; 10] = ["-44", "-48", "-52", "-56", "-60", "-67.5", "-75", "-82.5", "-90", "+90"];
const F_DEL_110: [&str; 12] = ["-44", "-48", "-52", "-56", "-60", "-67.5", "-75", "-82.5", "-90", "-100", "-110", "+110"];
const MAESTROS5: [(&str, &str); 9] = [("Master 40-44", "40-44"), ("Master 45-49", "45-49"), ("Master 50-54", "50-54"), ("Master 55-59", "55-59"), ("Master 60-64", "60-64"), ("Master 65-69", "65-69"), ("Master 70-74", "70-74"), ("Master 75-79", "75-79"), ("Master 80+", "80+")];
const TEEN3: [(&str, &str); 3] = [("Teen 13-15", "13-15"), ("Teen 16-17", "16-17"), ("Teen 18-19", "18-19")];
const IPF_DIV: [(&str, &str); 7] = [("Sub-Junior", "14-18"), ("Junior", "19-23"), ("Open", "19+"), ("Master 1", "40-49"), ("Master 2", "50-59"), ("Master 3", "60-69"), ("Master 4", "70+")];

fn ipf_pesos() -> (Vec<String>, Vec<String>) {
    (sv(&["-59", "-66", "-74", "-83", "-93", "-105", "-120", "+120"]), sv(&["-47", "-52", "-57", "-63", "-69", "-76", "-84", "+84"]))
}
fn ipf_juvenil() -> Option<(Vec<String>, Vec<String>, Vec<String>)> {
    Some((sv(&["Sub-Junior", "Junior"]), sv(&["-53"]), sv(&["-43"])))
}

fn construir() -> (Vec<String>, HashMap<String, Categoria>) {
    let mut m: HashMap<String, Categoria> = HashMap::new();
    let mut orden: Vec<String> = vec![];
    let mut poner = |n: &str, c: Categoria| {
        orden.push(n.to_string());
        m.insert(n.to_string(), c);
    };
    let (pm, pf) = ipf_pesos();
    poner("IPF", Categoria { pesos_m: pm.clone(), pesos_f: pf.clone(), juvenil: ipf_juvenil(), divisiones: dv(&IPF_DIV) });
    poner("IPL", Categoria {
        pesos_m: sv(&M5), pesos_f: sv(&F_DEL_110), juvenil: None,
        divisiones: dv(&[&[("Junior 15-19", "15-19"), ("Junior 20-23", "20-23"), ("Open", "13+")][..], &MAESTROS5[..]].concat()),
    });
    poner("WRPF", Categoria {
        pesos_m: sv(&M5), pesos_f: sv(&F_DEL_90), juvenil: None,
        divisiones: dv(&[("Teenage", "14-16"), ("Sub-Junior", "17-19"), ("Junior", "20-23"), ("Open", "24-39"), ("Master 1", "40-49"), ("Master 2", "50-59"), ("Master 3", "60-69"), ("Master 4", "70-79"), ("Master 5", "80+")]),
    });
    poner("WPC", Categoria {
        pesos_m: sv(&M5), pesos_f: sv(&F_DEL_110), juvenil: None,
        divisiones: dv(&[&TEEN3[..], &[("Junior", "20-23"), ("Open", "13+")][..], &MAESTROS5[..]].concat()),
    });
    poner("USAPL", Categoria {
        pesos_m: sv(&M5), pesos_f: sv(&["-44", "-48", "-52", "-56", "-60", "-65", "-70", "-75", "-82.5", "-90", "-100", "+100"]), juvenil: None,
        divisiones: dv(&[("Teen 1", "14-15"), ("Teen 2", "16-17"), ("Teen 3", "18-19"), ("Junior", "20-23"), ("Open", "14+"), ("Master 1", "40-49"), ("Master 2", "50-59"), ("Master 3", "60-69"), ("Master 4", "70-79"), ("Master 5", "80-89")]),
    });
    poner("GPC", Categoria {
        pesos_m: sv(&M5), pesos_f: sv(&F_DEL_110), juvenil: None,
        divisiones: dv(&[&TEEN3[..], &[("Junior", "20-23"), ("Open", "24-39")][..], &MAESTROS5[..]].concat()),
    });
    poner("FCLP", Categoria { pesos_m: pm, pesos_f: pf, juvenil: ipf_juvenil(), divisiones: dv(&IPF_DIV) });

    // Competencias sin reglamento propio: todas las clases, ordenadas, y las divisiones de la IPF sin edad.
    let orden_clase = |a: &String, b: &String| {
        let pa = a.starts_with('+') as i32;
        let pb = b.starts_with('+') as i32;
        let fa: f64 = a[1..].parse().unwrap_or(f64::NAN);
        let fb: f64 = b[1..].parse().unwrap_or(f64::NAN);
        (pa - pb).cmp(&0).then(fa.partial_cmp(&fb).unwrap_or(std::cmp::Ordering::Equal))
    };
    let unir = |f: &dyn Fn(&Categoria) -> Vec<String>| {
        let mut v: Vec<String> = vec![];
        for n in &orden {
            for c in f(&m[n]) {
                if !v.contains(&c) {
                    v.push(c);
                }
            }
        }
        v.sort_by(orden_clase);
        v
    };
    let um = unir(&|c| c.pesos_m.iter().cloned().chain(c.juvenil.iter().flat_map(|j| j.1.clone())).collect());
    let uf = unir(&|c| c.pesos_f.iter().cloned().chain(c.juvenil.iter().flat_map(|j| j.2.clone())).collect());
    for n in ["Local", "Amateur", "Otra"] {
        orden.push(n.to_string());
        m.insert(n.to_string(), Categoria { pesos_m: um.clone(), pesos_f: uf.clone(), juvenil: None, divisiones: IPF_DIV.iter().map(|(d, _)| Division { nombre: d.to_string(), edad: String::new() }).collect() });
    }
    (orden, m)
}

fn categorias() -> &'static HashMap<String, Categoria> {
    static C: OnceLock<(Vec<String>, HashMap<String, Categoria>)> = OnceLock::new();
    &C.get_or_init(construir).1
}
pub fn categorias_de(fed: &str) -> &'static Categoria {
    let c = categorias();
    c.get(fed).unwrap_or(&c["Otra"])
}
pub fn divisiones_de(fed: &str) -> &'static [Division] {
    &categorias_de(fed).divisiones
}
pub fn clases_de(fed: &str, sexo: &str, division: &str) -> Vec<String> {
    let c = categorias_de(fed);
    let f = sexo == "F";
    let base = if f { &c.pesos_f } else { &c.pesos_m };
    match &c.juvenil {
        Some((divs, jm, jf)) if divs.iter().any(|d| d == division) => jm_o_jf(f, jm, jf).iter().chain(base.iter()).cloned().collect(),
        _ => base.clone(),
    }
}
fn jm_o_jf<'a>(f: bool, jm: &'a [String], jf: &'a [String]) -> &'a [String] {
    if f { jf } else { jm }
}
/// La clase más cercana por encima del peso corporal (la última, si pasa de todas).
pub fn clase_mas_cercana(fed: &str, sexo: &str, bw: f64, division: &str) -> String {
    let l = clases_de(fed, sexo, division);
    if !(bw > 0.0) {
        return l.get(l.len() / 2).cloned().unwrap_or_default();
    }
    l.iter().find(|c| c.starts_with('-') && bw <= c[1..].parse::<f64>().unwrap_or(f64::NAN)).or(l.last()).cloned().unwrap_or_default()
}

/* ====================== Puntajes ====================== */

fn poli(co: &[f64], x: f64) -> f64 {
    co.iter().enumerate().map(|(i, c)| c * x.powi(i as i32)).sum()
}
const WILKS_M: [f64; 6] = [-216.0475144, 16.2606339, -0.002388645, -0.00113732, 7.01863e-06, -1.291e-08];
const WILKS_F: [f64; 6] = [594.31747775582, -27.23842536447, 0.82112226871, -0.00930733913, 4.731582e-05, -9.054e-08];
const WILKS20_M: [f64; 6] = [47.46178854, 8.472061379, 0.07369410346, -0.001395833811, 7.07665973070743e-06, -1.20804336482315e-08];
const WILKS20_F: [f64; 6] = [-125.4255398, 13.71219419, -0.03307250631, -0.001050400051, 9.38773881462799e-06, -2.3334613884954e-08];
const DOTS_M: [f64; 5] = [-307.75076, 24.0900756, -0.1918759221, 0.0007391293, -0.000001093];
const DOTS_F: [f64; 5] = [-57.96288, 13.6175032, -0.1126655495, 0.0005158568, -0.0000010706];

/// Puntos IPF GL (fórmula oficial 2020).
pub fn ipf_gl(total: f64, bw: f64, sexo: &str, equipo: &str) -> f64 {
    if total == 0.0 || bw == 0.0 || total.is_nan() || bw.is_nan() || bw < 35.0 {
        return 0.0;
    }
    let c = match (sexo, equipo) {
        ("M", "classic") => [1199.72839, 1025.18162, 0.00921],
        ("F", "classic") => [610.32796, 1045.59282, 0.03048],
        ("M", "equipped") => [1236.25115, 1449.21864, 0.01644],
        ("F", "equipped") => [758.63878, 949.31382, 0.02435],
        _ => [1199.72839, 1025.18162, 0.00921],
    };
    let denom = c[0] - c[1] * (-c[2] * bw).exp();
    if denom <= 0.0 { 0.0 } else { (total * 100.0 / denom).max(0.0) }
}

pub fn sistema_de(f: &str) -> &'static str {
    match f {
        "Wilks" => "Wilks",
        "Wilks 2020" => "Wilks 2020",
        "DOTS" => "DOTS",
        _ => "GL", // «IPF» y cualquier otro se calculan con GL
    }
}

/// Puntaje de un total (0 si faltan datos).
pub fn puntaje(sistema: &str, total: f64, bw: f64, sexo: &str, equipo: &str) -> f64 {
    if !(total > 0.0) || !(bw >= 35.0) {
        return 0.0;
    }
    let f = sexo == "F";
    let v = match sistema_de(sistema) {
        "Wilks" => (total * 500.0) / poli(if f { &WILKS_F } else { &WILKS_M }, bw),
        "Wilks 2020" => (total * 600.0) / poli(if f { &WILKS20_F } else { &WILKS20_M }, bw),
        "DOTS" => (total * 500.0) / poli(if f { &DOTS_F } else { &DOTS_M }, bw),
        _ => ipf_gl(total, bw, if f { "F" } else { "M" }, if equipo == "equipped" || equipo == "equipado" { "equipped" } else { "classic" }),
    };
    if v.is_nan() { 0.0 } else { v.max(0.0) }
}

/* ====================== Competencia ====================== */

pub fn peso_de(a: &Value) -> f64 {
    num_o_cero(if a["peso"].is_null() { &a["bw"] } else { &a["peso"] })
}
pub fn equipo_de(a: &Value) -> &'static str {
    if a["equipamiento"] == "equipado" || a["modalidad"] == "equipped" { "equipped" } else { "classic" }
}
fn levs_de(a: &Value) -> Vec<String> {
    match a["levantes"].as_array() {
        Some(l) if truthy(&a["levantes"]) => l.iter().map(js_string).collect(),
        _ => ORDEN_LEV.iter().map(|s| s.to_string()).collect(),
    }
}
fn primeros3<'a>(a: &'a Value, lev: &str) -> Vec<&'a Value> {
    a["intentos"][lev].as_array().map(|l| l.iter().take(3).collect()).unwrap_or_default()
}
fn es_r(i: &Value, r: f64) -> bool {
    i["r"].as_f64() == Some(r)
}
pub fn mejor(a: &Value, lev: &str) -> f64 {
    primeros3(a, lev).into_iter().filter(|i| es_r(i, 1.0) && js_to_number(&i["kg"]) > 0.0).map(|i| js_to_number(&i["kg"])).fold(0.0, f64::max)
}
fn quemado(a: &Value, lev: &str) -> bool {
    let l = primeros3(a, lev);
    !l.is_empty() && l.iter().all(|i| es_r(i, -1.0) || js_to_number(&i["kg"]) == 0.0) && l.iter().any(|i| es_r(i, -1.0))
}
/// Sin ningún intento válido en un levantamiento no hay total.
pub fn total(a: &Value) -> f64 {
    let levs = levs_de(a);
    if levs.iter().any(|l| quemado(a, l)) {
        return 0.0;
    }
    levs.iter().map(|l| mejor(a, l)).sum()
}
pub fn puntos(a: &Value, formula: &str) -> f64 {
    puntaje(sistema_de(formula), total(a), peso_de(a), if a["sexo"] == "F" { "F" } else { "M" }, equipo_de(a))
}
pub fn redondear2(x: f64) -> f64 {
    (x * 100.0 + 0.5).floor() / 100.0
}

fn clase_de(sexo: &Value, bw: f64, division: &str, federacion: &str) -> String {
    if bw > 0.0 { clase_mas_cercana(federacion, if *sexo == "F" { "F" } else { "M" }, bw, division) } else { String::new() }
}
fn division_de(a: &Value) -> String {
    match &a["division"] {
        Value::Null => "Open".into(),
        v => js_string(v),
    }
}
/// Clase del atleta o la que le toca por peso (federación `fed`).
pub fn clase_del_atleta(a: &Value, fed: &str) -> String {
    match a["clase"].as_str() {
        Some(c) if !c.is_empty() => c.to_string(),
        _ => clase_de(&a["sexo"], peso_de(a), &division_de(a), fed),
    }
}

pub struct Fila<'a> {
    pub a: &'a Value,
    pub puesto: Option<usize>,
    pub total: f64,
}
pub struct Grupo<'a> {
    pub nombre: String,
    pub filas: Vec<Fila<'a>>,
}

fn lote_o(a: &Value, def: f64) -> f64 {
    let n = num_o_cero(&a["lote"]);
    if n == 0.0 { def } else { n }
}
fn peso_o(a: &Value) -> f64 {
    let n = peso_de(a);
    if n == 0.0 { 999.0 } else { n }
}
pub fn orden_filas(l: &mut [&Value]) {
    l.sort_by(|x, y| {
        total(y).partial_cmp(&total(x)).unwrap_or(std::cmp::Ordering::Equal)
            .then(peso_o(x).partial_cmp(&peso_o(y)).unwrap_or(std::cmp::Ordering::Equal))
            .then(lote_o(x, 9999.0).partial_cmp(&lote_o(y, 9999.0)).unwrap_or(std::cmp::Ordering::Equal))
    });
}

/// Mayor total; a igual total, el más ligero; a igual peso, el lote menor.
pub fn clasificacion(lista: &[Value]) -> Vec<Grupo<'_>> {
    let mut grupos: Vec<(String, Vec<&Value>)> = vec![];
    for a in lista {
        let clase = match a["clase"].as_str() {
            Some(c) if !c.is_empty() => c.to_string(),
            _ => {
                let c = clase_de(&a["sexo"], peso_de(a), &division_de(a), "IPF");
                if c.is_empty() { "Sin categoría".to_string() } else { c }
            }
        };
        let div = if a["division"].is_null() { "undefined".to_string() } else { js_string(&a["division"]) };
        let k = format!("{} · {} · {}", div, if a["sexo"] == "F" { "Mujeres" } else { "Hombres" }, clase);
        match grupos.iter_mut().find(|g| g.0 == k) {
            Some(g) => g.1.push(a),
            None => grupos.push((k, vec![a])),
        }
    }
    grupos.sort_by(|a, b| loc_cmp(&a.0, &b.0));
    grupos.into_iter().map(|(nombre, mut l)| {
        orden_filas(&mut l);
        let filas = l.into_iter().enumerate().map(|(i, a)| { let t = total(a); Fila { a, puesto: if t > 0.0 { Some(i + 1) } else { None }, total: t } }).collect();
        Grupo { nombre, filas }
    }).collect()
}

/// Anillo de 9 segmentos (3 levantamientos x 3 intentos): { lev, n, estado }.
pub fn anillo_atleta(a: &Value) -> Value {
    let levs = levs_de(a);
    let mut out = vec![];
    for lev in ORDEN_LEV {
        for n in 0..3 {
            let i = &a["intentos"][lev][n];
            let mut estado = "vacio";
            if levs.iter().any(|l| l == lev) && truthy(i) {
                estado = if es_r(i, 1.0) { "ok" } else if es_r(i, -1.0) { "mal" } else if js_to_number(&i["kg"]) > 0.0 { "pendiente" } else { "vacio" };
            }
            out.push(json!({"lev": lev, "n": n, "estado": estado}));
        }
    }
    Value::Array(out)
}

/* ====================== Estado, resumen y CSV ====================== */

/// 'en-vivo' | 'programada' | 'terminada', calculado a partir del meet.
pub fn estado_meet(meet: &Value, hoy: &str) -> &'static str {
    if truthy(&meet["cerrado"]) {
        return "terminada";
    }
    let en_vivo = meet["vivo"].as_object().is_some_and(|o| o.values().any(|v| truthy(v) && truthy(&v["actual"])));
    if en_vivo {
        return "en-vivo";
    }
    let fin = if truthy(&meet["fechaFin"]) { &meet["fechaFin"] } else { &meet["fecha"] };
    if truthy(fin) && js_string(fin).encode_utf16().cmp(hoy.encode_utf16()).is_lt() {
        return "terminada";
    }
    "programada"
}

fn o_vacio(v: &Value) -> Value {
    if truthy(v) { v.clone() } else { json!("") }
}

pub fn resumen_meet(m: &Value, hoy: &str) -> Value {
    let mut o = serde_json::Map::new();
    for (k, v) in [("id", &m["id"]), ("nombre", &m["nombre"])] {
        if !v.is_null() {
            o.insert(k.into(), v.clone());
        }
    }
    for k in ["fecha", "fechaFin", "sede", "ciudad", "pais", "federacion"] {
        o.insert(k.into(), o_vacio(&m[k]));
    }
    o.insert("estado".into(), json!(estado_meet(m, hoy)));
    o.insert("atletas".into(), json!(m["atletas"].as_array().map(|a| a.len()).unwrap_or(0)));
    o.insert("plataformas".into(), if truthy(&m["plataformas"]) { m["plataformas"].clone() } else { json!([]) });
    o.insert("publico".into(), json!(m["publico"] != false));
    Value::Object(o)
}

pub fn filas_csv(cab: Vec<Value>, filas: Vec<Vec<Value>>, bom: bool, crlf_final: bool) -> String {
    let mut s = String::new();
    if bom {
        s.push('\u{feff}');
    }
    let todas = std::iter::once(cab).chain(filas);
    let lineas: Vec<String> = todas.map(|f| f.iter().map(celda).collect::<Vec<_>>().join(",")).collect();
    s.push_str(&lineas.join("\r\n"));
    if crlf_final {
        s.push_str("\r\n");
    }
    s
}

fn kg_val(i: &Value) -> Value {
    let kg = js_to_number(&i["kg"]);
    if i.is_object() && kg > 0.0 {
        if es_r(i, 1.0) { nv(kg) } else if es_r(i, -1.0) { nv(-kg) } else { json!(format!("({})", num_str(kg))) }
    } else {
        Value::Null
    }
}
fn o_null(v: &Value) -> Value {
    if v.is_null() { Value::Null } else { v.clone() }
}

/// resultados.csv: puesto por categoría, datos del atleta, los 9 intentos, mejores, total y puntos.
pub fn resultados_csv(meet: &Value) -> String {
    let formula = if truthy(&meet["formula"]) { js_string(&meet["formula"]) } else { "GL".into() };
    let mut cab: Vec<Value> = ["Puesto", "Categoría", "Nombre", "Club", "Sexo", "División", "Equipamiento", "Clase", "Peso corporal", "Plataforma"].iter().map(|s| json!(s)).collect();
    for l in ORDEN_LEV {
        for n in 1..=3 {
            cab.push(json!(format!("{l}{n}")));
        }
    }
    cab.extend(["Mejor S", "Mejor B", "Mejor D", "Total"].iter().map(|s| json!(s)));
    cab.push(json!(format!("Puntos {formula}")));
    let vacio = vec![];
    let lista = meet["atletas"].as_array().unwrap_or(&vacio);
    let mut filas = vec![];
    for g in clasificacion(lista) {
        for f in g.filas {
            let a = f.a;
            let mut r: Vec<Value> = vec![f.puesto.map(|p| json!(p)).unwrap_or(json!("DSQ")), json!(g.nombre), o_null(&a["nombre"]), o_null(&a["club"]), o_null(&a["sexo"]), o_null(&a["division"]), o_null(&a["equipamiento"]), o_null(&a["clase"])];
            let p = peso_de(a);
            r.push(if p != 0.0 { nv(p) } else { json!("") });
            r.push(o_null(&a["plataforma"]));
            for l in ORDEN_LEV {
                for n in 0..3 {
                    r.push(kg_val(&a["intentos"][l][n]));
                }
            }
            for l in ORDEN_LEV {
                let m = mejor(a, l);
                r.push(if m != 0.0 { nv(m) } else { json!("") });
            }
            r.push(if f.total != 0.0 { nv(f.total) } else { json!("") });
            r.push(if f.total != 0.0 { nv(redondear2(puntos(a, &formula))) } else { json!("") });
            filas.push(r);
        }
    }
    filas_csv(cab, filas, true, true)
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn atleta(id: &str, sexo: &str, peso: f64, s: f64, b: f64, d: f64) -> Value {
        let it = |kg: f64| json!([{"kg": kg, "r": 1}, {"kg": null, "r": null}, {"kg": null, "r": null}]);
        json!({"id": id, "nombre": id, "sexo": sexo, "peso": peso, "division": "Open", "clase": "", "intentos": {"S": it(s), "B": it(b), "D": it(d)}})
    }

    #[test]
    fn formulas_conocidas() {
        // GL de un hombre de 83 kg con 600 kg (raw): 600*100/(1199.72839-1025.18162*exp(-0.00921*83))
        let esperado = 600.0 * 100.0 / (1199.72839 - 1025.18162 * (-0.00921f64 * 83.0).exp());
        assert!((puntaje("GL", 600.0, 83.0, "M", "classic") - esperado).abs() < 1e-9);
        assert!((puntaje("IPF", 600.0, 83.0, "M", "classic") - esperado).abs() < 1e-9);
        let dots = 500.0 * 600.0 / (-307.75076 + 24.0900756 * 83.0 - 0.1918759221 * 83f64.powi(2) + 0.0007391293 * 83f64.powi(3) - 0.000001093 * 83f64.powi(4));
        assert!((puntaje("DOTS", 600.0, 83.0, "M", "classic") - dots).abs() < 1e-9);
        assert!((dots - 400.0).abs() < 20.0, "DOTS razonable: {dots}");
        assert_eq!(puntaje("GL", 600.0, 30.0, "M", "classic"), 0.0, "bajo 35 kg no hay puntos");
        assert_eq!(puntaje("Wilks", 0.0, 80.0, "M", "classic"), 0.0);
        assert_eq!(sistema_de("IPF"), "GL");
        assert_eq!(sistema_de("rara"), "GL");
    }

    #[test]
    fn categorias() {
        assert_eq!(clase_mas_cercana("IPF", "M", 82.0, "Open"), "-83");
        assert_eq!(clase_mas_cercana("IPF", "M", 200.0, "Open"), "+120");
        assert_eq!(clase_mas_cercana("IPF", "M", 50.0, "Junior"), "-53");
        assert_eq!(clase_mas_cercana("IPF", "F", 50.0, "Open"), "-52");
        assert_eq!(clase_mas_cercana("WRPF", "F", 61.0, "Open"), "-67.5");
        assert!(clases_de("Otra", "M", "Open").len() > 12);
        assert_eq!(divisiones_de("IPF").len(), 7);
    }

    #[test]
    fn totales_y_puestos() {
        let a = atleta("a", "M", 82.0, 200.0, 140.0, 240.0);
        assert_eq!(total(&a), 580.0);
        let mut nulo = atleta("b", "M", 82.0, 200.0, 140.0, 240.0);
        nulo["intentos"]["B"] = json!([{"kg": 140, "r": -1}, {"kg": 140, "r": -1}, {"kg": 140, "r": -1}]);
        assert_eq!(total(&nulo), 0.0, "sin banca válida no hay total");
        let lista = vec![a, nulo, atleta("c", "M", 82.0, 210.0, 140.0, 240.0)];
        let g = clasificacion(&lista);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].nombre, "Open · Hombres · -83");
        assert_eq!(g[0].filas[0].a["id"], "c");
        assert_eq!(g[0].filas[2].puesto, None);
        let csv = resultados_csv(&json!({"formula": "GL", "atletas": lista}));
        assert!(csv.starts_with('\u{feff}') && csv.contains("Puntos GL") && csv.contains("DSQ"));
    }

    #[test]
    fn estado() {
        assert_eq!(estado_meet(&json!({"fecha": "2000-01-01"}), "2026-01-01"), "terminada");
        assert_eq!(estado_meet(&json!({"fecha": "2999-01-01"}), "2026-01-01"), "programada");
        assert_eq!(estado_meet(&json!({"fecha": "2999-01-01", "vivo": {"T": {"actual": {"aid": "x"}}}}), "2026-01-01"), "en-vivo");
        assert_eq!(estado_meet(&json!({"cerrado": true}), "2026-01-01"), "terminada");
    }
}
