//! Rutas de récords y perfiles de atleta.
//!   /api/records …            tabla de récords (<datos>/records.json). Lectura pública; edición del organizador.
//!   /api/atletas …            fichas de atleta armadas con todos los meets públicos de este servidor.
//!   PUT /api/meets/:id/atletas/:aid  se vigila: si un intento pasa a válido y supera la tabla, el récord se registra solo.
use crate::api::*;
use crate::js::*;
use crate::perfiles as P;
use crate::records_logica as RL;
use crate::validar::*;
use axum::body::Body;
use axum::http::{Method, Response};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const FILTROS: [&str; 10] = ["federacion", "nivel", "sexo", "division", "equipamiento", "clase", "lev", "q", "meetId", "pendientes"];

fn leer_json(ruta: &Path, vacio: Value) -> Value {
    let bak = {
        let mut o = ruta.as_os_str().to_owned();
        o.push(".bak");
        PathBuf::from(o)
    };
    for f in [ruta.to_path_buf(), bak] {
        if let Ok(t) = std::fs::read_to_string(&f) {
            if let Ok(v) = serde_json::from_str::<Value>(t.trim_start_matches('\u{feff}')) {
                if v.is_object() {
                    return v;
                }
            }
        }
    }
    vacio
}

/// Escritura atómica: archivo temporal, copia .bak y rename.
fn escribir_json(ruta: &Path, obj: &Value) {
    let mut t = ruta.as_os_str().to_owned();
    t.push(".tmp");
    let tmp = PathBuf::from(t);
    let mut b = ruta.as_os_str().to_owned();
    b.push(".bak");
    if std::fs::write(&tmp, obj.to_string()).is_ok() {
        if ruta.exists() {
            let _ = std::fs::copy(ruta, PathBuf::from(b));
        }
        let _ = std::fs::rename(&tmp, ruta);
    }
}

pub struct Records {
    ruta_rec: PathBuf,
    ruta_asig: PathBuf,
    pub tabla: Mutex<Vec<Value>>,
    asig: Mutex<HashMap<String, String>>,
}

impl Records {
    pub fn nuevo(datos: &Path) -> Records {
        let ruta_rec = datos.join("records.json");
        let ruta_asig = datos.join("atletas.json");
        let mut tabla = vec![];
        if let Some(l) = leer_json(&ruta_rec, json!({"records": []}))["records"].as_array() {
            for x in l {
                if let Ok(mut r) = RL::normalizar_record(x) {
                    if !truthy(&r["id"]) {
                        r["id"] = json!(format!("rc-{}", hex_aleatorio(4)));
                    }
                    tabla.push(r);
                }
            }
        }
        let mut asig = HashMap::new();
        if let Some(o) = leer_json(&ruta_asig, json!({}))["asignaciones"].as_object() {
            for (k, v) in o {
                if let Some(s) = v.as_str() {
                    asig.insert(k.clone(), s.to_string());
                }
            }
        }
        Records { ruta_rec, ruta_asig, tabla: Mutex::new(tabla), asig: Mutex::new(asig) }
    }
    fn guardar_tabla(&self, t: &[Value]) {
        escribir_json(&self.ruta_rec, &json!({"version": 1, "records": t}));
    }
    fn guardar_asig(&self, a: &HashMap<String, String>) {
        let mut claves: Vec<&String> = a.keys().collect();
        claves.sort();
        let o: serde_json::Map<String, Value> = claves.into_iter().map(|k| (k.clone(), json!(a[k]))).collect();
        escribir_json(&self.ruta_asig, &json!({"version": 1, "asignaciones": o}));
    }
    fn tabla(&self) -> std::sync::MutexGuard<'_, Vec<Value>> {
        self.tabla.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Récord automático tras un PUT de atleta que respondió 200.
    pub fn despues_de_atleta(&self, ctx: &Ctx, id: &str, aid: &str, antes: &Value) {
        let app = &ctx.app;
        let Some(m) = app.almacen.leer(id) else { return };
        let Some(despues) = m["atletas"].as_array().and_then(|a| a.iter().find(|x| x["id"] == aid)).cloned() else { return };
        if !truthy(&m["federacion"]) {
            return;
        }
        let hechos = {
            let mut t = self.tabla();
            let h = RL::registrar_automaticos(&mut t, &m, antes, &despues);
            if h.is_empty() {
                return;
            }
            self.guardar_tabla(&t);
            h
        };
        let _ = app.almacen.guardar(id, |mm| {
            for h in &hechos {
                let r = &h.record;
                anotar(mm, &format!("Récord {} · {} · {} kg · {} (por homologar)", RL::nombre_nivel(r), RL::nombre_lev_rec(r["lev"].as_str().unwrap_or("")).to_lowercase(), js_string(&r["kg"]), js_string_vacio(&r["atleta"])));
            }
            Ok(())
        });
        app.tiempo.emitir(id, &json!({"tipo": "meet-cambio", "campos": {}}));
    }
}

fn lectura(ctx: &Ctx) -> HashMap<String, String> {
    let mut f = HashMap::new();
    for k in FILTROS {
        if let Some(v) = ctx.q(k).filter(|v| !v.is_empty()) {
            f.insert(k.to_string(), txt_s(v, 120));
        }
    }
    f
}

pub async fn atender(ctx: &mut Ctx) -> R<Option<Response<Body>>> {
    let g0 = ctx.partes.first().cloned().unwrap_or_default();
    if g0 == "records" {
        return records(ctx).await.map(Some);
    }
    if g0 == "atletas" {
        return atletas(ctx).await.map(Some);
    }
    let p = &ctx.partes;
    if p.first().map(String::as_str) == Some("meets") && p.get(2).map(String::as_str) == Some("atletas") && p.len() == 4 && ctx.metodo == Method::PUT && ctx.org {
        let (id, aid) = (p[1].clone(), p[3].clone());
        let previo = ctx.app.almacen.leer(&id).and_then(|m| m["atletas"].as_array().and_then(|a| a.iter().find(|x| x["id"] == aid.as_str()).cloned()));
        let antes = match previo {
            Some(p) => json!({"intentos": p["intentos"]}),
            None => Value::Null,
        };
        ctx.post.push(Post::Record { id, aid, antes });
    }
    Ok(None)
}

async fn records(ctx: &mut Ctx) -> R<Response<Body>> {
    let app = ctx.app.clone();
    let rs = &app.records;
    let (sub, extra) = (ctx.partes.get(1).cloned(), ctx.partes.get(2).cloned());
    let metodo = ctx.metodo.clone();
    let Some(sub) = sub else {
        if metodo == Method::GET {
            let t = rs.tabla();
            return Ok(json_resp(200, &json!({"ok": true, "records": RL::filtrar_records(&t, &lectura(ctx))})));
        }
        if metodo == Method::POST {
            ctx.requiere_org()?;
            let b = ctx.cuerpo(256 * 1024).await?;
            let mut r = RL::normalizar_record(&b).or_else(|e| mal(400, e))?;
            let mut t = rs.tabla();
            if t.len() >= RL::MAX_RECORDS {
                return mal(400, format!("La tabla admite hasta {} récords", RL::MAX_RECORDS));
            }
            let k = RL::clave_record(&r);
            if let Some(igual) = t.iter().find(|x| RL::clave_record(x) == k) {
                return mal(409, format!("Ya hay un récord para esa categoría y levantamiento ({} kg de {}). Edítalo y márcalo como récord nuevo para guardar el anterior en el historial.", js_string(&igual["kg"]), js_string_vacio(&igual["atleta"])));
            }
            if !truthy(&r["id"]) || t.iter().any(|x| x["id"] == r["id"]) {
                r["id"] = json!(format!("rc-{}", hex_aleatorio(4)));
            }
            t.push(r.clone());
            rs.guardar_tabla(&t);
            return Ok(json_resp(201, &json!({"ok": true, "record": r})));
        }
        return mal(405, "Método no permitido");
    };
    if sub == "export.csv" && metodo == Method::GET {
        let t = rs.tabla();
        return Ok(descarga("text/csv; charset=utf-8", "records-openmeets.csv", RL::records_a_csv(&RL::filtrar_records(&t, &lectura(ctx))).into_bytes()));
    }
    if sub == "plantilla.csv" && metodo == Method::GET {
        return Ok(descarga("text/csv; charset=utf-8", "plantilla-records.csv", RL::plantilla_records_csv().into_bytes()));
    }
    if sub == "importar" && extra.is_none() {
        ctx.requiere_org()?;
        if metodo != Method::POST {
            return mal(405, "Método no permitido");
        }
        let b = ctx.cuerpo(2 * 1024 * 1024).await?;
        let csv = b["csv"].as_str().filter(|s| !trim_js(s).is_empty());
        let Some(csv) = csv else { return mal(400, "Falta el contenido del CSV") };
        let (filas, mut errores) = RL::records_de_csv(csv);
        let simular = truthy(&b["simular"]);
        let mut t = rs.tabla();
        let mut copia = t.clone();
        let (mut nuevos, mut actualizados, mut iguales) = (0, 0, 0);
        for f in &filas {
            if copia.len() >= RL::MAX_RECORDS {
                errores.push((0, format!("Se llegó al máximo de {} récords", RL::MAX_RECORDS)));
                break;
            }
            let (_, c) = RL::registrar_record(&mut copia, f, &format!("rc-{}", hex_aleatorio(4)), false);
            match c {
                RL::Cambio::Nuevo => nuevos += 1,
                RL::Cambio::Igual => iguales += 1,
                _ => actualizados += 1,
            }
        }
        if !simular && (nuevos > 0 || actualizados > 0) {
            *t = copia;
            rs.guardar_tabla(&t);
        }
        let total = errores.len();
        let errs: Vec<Value> = errores.iter().take(50).map(|(l, e)| json!({"linea": l, "error": e})).collect();
        return Ok(json_resp(200, &json!({"ok": true, "simulado": simular, "nuevos": nuevos, "actualizados": actualizados, "iguales": iguales, "errores": errs, "erroresTotal": total})));
    }
    if !es_id_seguro(&sub) || extra.is_some() {
        return mal(404, "No encuentro ese récord");
    }
    let pos = rs.tabla().iter().position(|x| x["id"] == sub.as_str());
    if metodo == Method::GET {
        let Some(i) = pos else { return mal(404, "No encuentro ese récord") };
        return Ok(json_resp(200, &json!({"ok": true, "record": rs.tabla()[i]})));
    }
    ctx.requiere_org()?;
    let Some(_) = pos else { return mal(404, "No encuentro ese récord") };
    if metodo == Method::DELETE {
        let mut t = rs.tabla();
        let Some(i) = t.iter().position(|x| x["id"] == sub.as_str()) else { return mal(404, "No encuentro ese récord") };
        let r = t.remove(i);
        rs.guardar_tabla(&t);
        return Ok(json_resp(200, &json!({"ok": true, "record": r})));
    }
    if metodo == Method::PUT {
        let b = ctx.cuerpo(256 * 1024).await?;
        let mut t = rs.tabla();
        let Some(i) = t.iter().position(|x| x["id"] == sub.as_str()) else { return mal(404, "No encuentro ese récord") };
        let mut fusion = t[i].as_object().cloned().unwrap_or_default();
        if let Some(bo) = b.as_object() {
            for (k, v) in bo {
                fusion.insert(k.clone(), v.clone());
            }
        }
        fusion.insert("id".into(), json!(sub));
        let mut r = RL::normalizar_record(&Value::Object(fusion)).or_else(|e| mal(400, e))?;
        let k = RL::clave_record(&r);
        if t.iter().enumerate().any(|(j, x)| j != i && RL::clave_record(x) == k) {
            return mal(409, "Ya existe otro récord con esa federación, nivel, categoría y levantamiento");
        }
        let previo = t[i].clone();
        let hist_previo = previo["historial"].clone();
        r["historial"] = if b["nuevoTitular"] == true {
            let mut h = vec![RL::instantanea(&previo)];
            h.extend(hist_previo.as_array().cloned().unwrap_or_default());
            h.truncate(50);
            Value::Array(h)
        } else {
            hist_previo
        };
        if b["nuevoTitular"] == true {
            if let Some(o) = r.as_object_mut() {
                o.shift_remove("meetId");
                o.shift_remove("aid");
            }
        }
        t[i] = r.clone();
        rs.guardar_tabla(&t);
        return Ok(json_resp(200, &json!({"ok": true, "record": r})));
    }
    mal(405, "Método no permitido")
}

fn clave_asig_ok(k: &str) -> bool {
    k.split_once('|').is_some_and(|(a, b)| es_id_seguro(a) && es_id_seguro(b))
}

async fn atletas(ctx: &mut Ctx) -> R<Response<Body>> {
    let app = ctx.app.clone();
    let rs = &app.records;
    let slug = ctx.partes.get(1).cloned();
    let metodo = ctx.metodo.clone();
    let publicos = || -> Vec<Value> { app.almacen.listar().into_iter().filter(|m| m["publico"] != false).collect() };
    let Some(slug) = slug else {
        if metodo != Method::GET {
            return mal(405, "Método no permitido");
        }
        let q = normalizar_nombre(ctx.q("q").unwrap_or(""));
        let meets = publicos();
        let asig = rs.asig.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let mut lista: Vec<Value> = P::agrupar_atletas(&meets, &asig).iter().map(P::resumen_lista).collect();
        if !q.is_empty() {
            lista.retain(|x| normalizar_nombre(&format!("{} {}", js_string_vacio(&x["nombre"]), js_string_vacio(&x["club"]))).contains(&q));
        }
        lista.sort_by(|a, b| loc_cmp(a["ultimaFecha"].as_str().unwrap_or(""), b["ultimaFecha"].as_str().unwrap_or("")).reverse().then_with(|| loc_cmp(a["nombre"].as_str().unwrap_or(""), b["nombre"].as_str().unwrap_or(""))));
        let total = lista.len();
        lista.truncate(500);
        return Ok(json_resp(200, &json!({"ok": true, "atletas": lista, "total": total})));
    };
    if slug == "asignaciones" && ctx.partes.len() == 2 {
        ctx.requiere_org()?;
        if metodo != Method::PUT {
            return mal(405, "Método no permitido");
        }
        let b = ctx.cuerpo(512 * 1024).await?;
        let Some(set) = b["set"].as_object() else { return mal(400, "Falta «set»: { \"meet|atleta\": \"ficha\" | null }") };
        let mut nuevo = rs.asig.lock().unwrap_or_else(|e| e.into_inner()).clone();
        for (k, v) in set.iter().take(2000) {
            if !clave_asig_ok(k) {
                return mal(400, format!("Clave no válida: {}", txt_s(k, 40)));
            }
            if v.is_null() {
                nuevo.remove(k);
            } else if id_seguro(v) {
                nuevo.insert(k.clone(), v.as_str().unwrap_or("").to_string());
            } else {
                return mal(400, "La ficha debe llevar solo a-z, 0-9 y guiones");
            }
        }
        if nuevo.len() > 20000 {
            return mal(400, "Demasiadas asignaciones");
        }
        rs.guardar_asig(&nuevo);
        *rs.asig.lock().unwrap_or_else(|e| e.into_inner()) = nuevo;
        return Ok(json_resp(200, &json!({"ok": true})));
    }
    if ctx.partes.len() != 2 || !es_id_seguro(&slug) {
        return mal(404, "No encuentro esa ficha");
    }
    if metodo != Method::GET {
        return mal(405, "Método no permitido");
    }
    let meets = publicos();
    let asig = rs.asig.lock().unwrap_or_else(|e| e.into_inner()).clone();
    let grupos = P::agrupar_atletas(&meets, &asig);
    let (m, a) = (ctx.q("m").unwrap_or("").to_string(), ctx.q("a").unwrap_or("").to_string());
    let contiene = |g: &P::GrupoAtleta| g.apariciones.iter().any(|y| y.meet["id"] == m.as_str() && y.a["id"] == a.as_str());
    let Some(g) = grupos.iter().find(|x| x.slug == slug) else {
        if !m.is_empty() && !a.is_empty() {
            if let Some(n) = grupos.iter().find(|x| contiene(x)) {
                return Ok(json_resp(200, &json!({"ok": true, "redirigir": n.slug})));
            }
        }
        return mal(404, "No encuentro esa ficha. Puede que se haya fusionado con otra o que el meet ya no sea público.");
    };
    if !m.is_empty() && !a.is_empty() && !contiene(g) {
        if let Some(otra) = grupos.iter().find(|x| contiene(x)) {
            return Ok(json_resp(200, &json!({"ok": true, "redirigir": otra.slug})));
        }
    }
    let t = rs.tabla();
    Ok(json_resp(200, &json!({"ok": true, "perfil": P::perfil_de(g, &t)})))
}
