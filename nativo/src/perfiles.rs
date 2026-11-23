//! Perfiles de atleta: une las apariciones de una persona en todos los meets del servidor.
//! Port de web/js/nucleo/perfiles.js.
use crate::calculo::*;
use crate::js::*;
use serde_json::{Value, json};
use std::collections::HashMap;

pub struct Aparicion<'a> {
    pub meet: &'a Value,
    pub a: &'a Value,
}
pub struct GrupoAtleta<'a> {
    pub slug: String,
    pub apariciones: Vec<Aparicion<'a>>,
}

/// Identificador de la ficha por nombre y sexo: «jose-perez-m». '' si no tiene nombre.
pub fn slug_auto(a: &Value) -> String {
    let base = normalizar_nombre(&js_string_vacio(&a["nombre"])).replace(' ', "-");
    let base = cortar(&base, 56);
    let base = base.trim_end_matches('-');
    if base.is_empty() { String::new() } else { format!("{base}-{}", if a["sexo"] == "F" { "f" } else { "m" }) }
}
pub fn clave_apar(meet_id: &str, aid: &str) -> String {
    format!("{meet_id}|{aid}")
}

/// Ficha de un atleta de un meet: asignación del organizador > atletaId > nombre y sexo.
pub fn slug_de(meet_id: &str, a: &Value, asig: &HashMap<String, String>) -> String {
    if let Some(x) = asig.get(&clave_apar(meet_id, a["id"].as_str().unwrap_or(""))) {
        if es_id_seguro(x) {
            return x.clone();
        }
    }
    if id_seguro(&a["atletaId"]) { a["atletaId"].as_str().unwrap_or("").to_string() } else { slug_auto(a) }
}

/// slug → grupo (apariciones de la más antigua a la más reciente), en orden de primera aparición.
pub fn agrupar_atletas<'a>(meets: &'a [Value], asig: &HashMap<String, String>) -> Vec<GrupoAtleta<'a>> {
    let mut g: Vec<GrupoAtleta<'a>> = vec![];
    let mut idx: HashMap<String, usize> = HashMap::new();
    for meet in meets {
        for a in meet["atletas"].as_array().map(|v| v.iter()).into_iter().flatten() {
            let slug = slug_de(meet["id"].as_str().unwrap_or(""), a, asig);
            if slug.is_empty() {
                continue;
            }
            let i = *idx.entry(slug.clone()).or_insert_with(|| {
                g.push(GrupoAtleta { slug, apariciones: vec![] });
                g.len() - 1
            });
            g[i].apariciones.push(Aparicion { meet, a });
        }
    }
    for x in &mut g {
        x.apariciones.sort_by(|x, y| {
            loc_cmp(&js_string_vacio(&x.meet["fecha"]), &js_string_vacio(&y.meet["fecha"]))
                .then(num_o_cero(&x.meet["creado"]).partial_cmp(&num_o_cero(&y.meet["creado"])).unwrap_or(std::cmp::Ordering::Equal))
        });
    }
    g
}

fn unicos(l: impl Iterator<Item = String>) -> Vec<Value> {
    let mut v: Vec<String> = vec![];
    for x in l.filter(|x| !x.is_empty()) {
        if !v.contains(&x) {
            v.push(x);
        }
    }
    v.into_iter().map(Value::from).collect()
}
fn categoria_de(a: &Value) -> String {
    let div = if truthy(&a["division"]) { js_string(&a["division"]) } else { "Open".into() };
    let mut p = vec![div];
    if truthy(&a["clase"]) {
        p.push(format!("{} kg", js_string(&a["clase"])));
    }
    p.join(" · ")
}

/// Fila de lista: lo justo para el buscador.
pub fn resumen_lista(g: &GrupoAtleta) -> Value {
    let Some(ult) = g.apariciones.last() else { return Value::Null };
    let mejor_total = g.apariciones.iter().map(|x| total(x.a)).fold(0.0, f64::max);
    json!({
        "slug": g.slug, "nombre": ult.a["nombre"], "sexo": if ult.a["sexo"] == "F" { "F" } else { "M" },
        "club": if truthy(&ult.a["club"]) { ult.a["club"].clone() } else { json!("") }, "meets": g.apariciones.len(),
        "ultimaFecha": if truthy(&ult.meet["fecha"]) { ult.meet["fecha"].clone() } else { json!("") }, "mejorTotal": nv(mejor_total),
    })
}

fn puestos_de(meet: &Value) -> HashMap<String, (Option<usize>, usize)> {
    let mut m = HashMap::new();
    let vacio = vec![];
    for g in clasificacion(meet["atletas"].as_array().unwrap_or(&vacio)) {
        let de = g.filas.len();
        for f in g.filas {
            m.insert(js_string_vacio(&f.a["id"]), (f.puesto, de));
        }
    }
    m
}

/// Ficha completa. `records` es la tabla de récords (para los que posee).
pub fn perfil_de(g: &GrupoAtleta, records: &[Value]) -> Value {
    let Some(ult) = g.apariciones.last() else { return Value::Null };
    let filas: Vec<Value> = g.apariciones.iter().map(|Aparicion { meet, a }| {
        let formula = if truthy(&meet["formula"]) { js_string(&meet["formula"]) } else { "GL".into() };
        let tot = total(a);
        let p = puestos_de(meet).get(&js_string_vacio(&a["id"])).copied();
        let pts = if tot != 0.0 { redondear2(puntos(a, &formula)) } else { 0.0 };
        let peso = peso_de(a);
        json!({
            "meetId": meet["id"], "meetNombre": meet["nombre"], "fecha": if truthy(&meet["fecha"]) { meet["fecha"].clone() } else { json!("") }, "aid": a["id"],
            "categoria": categoria_de(a), "division": if truthy(&a["division"]) { a["division"].clone() } else { json!("Open") }, "clase": if truthy(&a["clase"]) { a["clase"].clone() } else { json!("") },
            "equipamiento": if a["equipamiento"] == "equipado" { "equipado" } else { "raw" }, "peso": if peso != 0.0 { nv(peso) } else { Value::Null },
            "club": if truthy(&a["club"]) { a["club"].clone() } else { json!("") }, "nombre": a["nombre"],
            "S": nv(mejor(a, "S")), "B": nv(mejor(a, "B")), "D": nv(mejor(a, "D")), "total": nv(tot), "puntos": nv(pts),
            "formula": if formula == "IPF" { "GL".to_string() } else { formula },
            "puesto": if tot != 0.0 { p.and_then(|x| x.0).map(|x| json!(x)).unwrap_or(Value::Null) } else { Value::Null },
            "de": p.map(|x| x.1).unwrap_or(0), "federacion": if truthy(&meet["federacion"]) { meet["federacion"].clone() } else { json!("") },
        })
    }).collect();
    let mut mejores = serde_json::Map::new();
    for k in ["S", "B", "D", "total", "puntos"] {
        let mut b: Option<(f64, &Value)> = None;
        for f in &filas {
            let v = f[k].as_f64().unwrap_or(0.0);
            if v > 0.0 && b.is_none_or(|(mv, _)| v > mv) {
                b = Some((v, f));
            }
        }
        mejores.insert(k.into(), b.map(|(_, f)| json!({"kg": f[k], "fecha": f["fecha"], "meetId": f["meetId"], "meet": f["meetNombre"]})).unwrap_or(Value::Null));
    }
    let nombres: Vec<String> = g.apariciones.iter().map(|x| normalizar_nombre(&js_string_vacio(&x.a["nombre"]))).collect();
    let sexo = if ult.a["sexo"] == "F" { "F" } else { "M" };
    let rev = || g.apariciones.iter().rev();
    json!({
        "slug": g.slug, "nombre": ult.a["nombre"], "sexo": sexo,
        "clubs": unicos(rev().map(|x| js_string_vacio(&x.a["club"]))), "categorias": unicos(rev().map(|x| categoria_de(x.a))), "meets": g.apariciones.len(),
        "historial": filas.iter().rev().cloned().collect::<Vec<_>>(),
        "mejores": Value::Object(mejores),
        "progresion": filas.iter().filter(|f| f["total"].as_f64().unwrap_or(0.0) > 0.0).map(|f| json!({"fecha": f["fecha"], "meetId": f["meetId"], "meet": f["meetNombre"], "total": f["total"], "puntos": f["puntos"]})).collect::<Vec<_>>(),
        "ultimo": {"meetId": ult.meet["id"], "meet": ult.meet["nombre"], "fecha": if truthy(&ult.meet["fecha"]) { ult.meet["fecha"].clone() } else { json!("") }, "aid": ult.a["id"], "anillo": anillo_atleta(ult.a)},
        "records": records.iter().filter(|r| r["sexo"] == sexo && nombres.contains(&normalizar_nombre(&js_string_vacio(&r["atleta"])))).cloned().collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn meet(id: &str, fecha: &str, nombre: &str, total_s: i32) -> Value {
        json!({"id": id, "nombre": id, "fecha": fecha, "formula": "GL", "federacion": "IPF", "atletas": [
            {"id": "a1", "nombre": nombre, "sexo": "M", "peso": 82, "clase": "-83", "division": "Open", "club": "Club", "intentos": {"S": [{"kg": total_s, "r": 1}], "B": [{"kg": 100, "r": 1}], "D": [{"kg": 150, "r": 1}]}}]})
    }

    #[test]
    fn agrupa_por_nombre_y_asignacion() {
        let meets = vec![meet("m2", "2026-02-01", "José Pérez", 200), meet("m1", "2026-01-01", "jose perez", 190)];
        let g = agrupar_atletas(&meets, &HashMap::new());
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].slug, "jose-perez-m");
        assert_eq!(g[0].apariciones[0].meet["id"], "m1", "de la más antigua a la reciente");
        let r = resumen_lista(&g[0]);
        assert_eq!(r["mejorTotal"], 450);
        assert_eq!(r["nombre"], "José Pérez");
        let mut asig = HashMap::new();
        asig.insert("m1|a1".to_string(), "otra-ficha".to_string());
        assert_eq!(agrupar_atletas(&meets, &asig).len(), 2);
        let p = perfil_de(&g[0], &[]);
        assert_eq!(p["meets"], 2);
        assert_eq!(p["mejores"]["total"]["kg"], 450);
        assert_eq!(p["historial"][0]["meetId"], "m2");
        assert_eq!(p["progresion"].as_array().unwrap().len(), 2);
        assert_eq!(p["ultimo"]["anillo"].as_array().unwrap().len(), 9);
    }
}
