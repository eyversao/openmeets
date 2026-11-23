//! Inscripciones: configuración pública en meet.inscripciones; inscritos y contactos PRIVADOS en <datos>/inscripciones/<meet>.json.
//! Quien se inscribe NO entra al meet hasta que el organizador lo confirma. Port de servidor/inscripciones.mjs
//! y web/js/nucleo/{inscripcion,inscribir}.js.
use crate::api::*;
use crate::calculo::*;
use crate::js::*;
use crate::validar::*;
use axum::body::Body;
use axum::http::{Method, Response};
use chrono::TimeZone;
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

pub const ESTADOS: [&str; 4] = ["pendiente", "confirmado", "espera", "rechazado"];
pub const MAX_INSCRITOS: usize = 1500;
const CODIGO: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
pub const MENSAJE_DUPLICADO: &str = "Ya hay una inscripción con ese nombre y fecha de nacimiento. Si es tuya, pregunta al organizador por tu código.";

/* ====================== Reglas puras ====================== */

fn es_cierre(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 16 && b.iter().enumerate().all(|(i, c)| match i { 4 | 7 => *c == b'-', 10 => *c == b'T', 13 => *c == b':', _ => c.is_ascii_digit() })
}

/// 'AAAA-MM-DDTHH:MM' (hora local de la mesa) → ms; None si no hay o no vale.
pub fn cierre_ms(cierre: &Value) -> Option<i64> {
    let s = cierre.as_str()?;
    if !es_cierre(s) {
        return None;
    }
    let t = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M").ok()?;
    chrono::Local.from_local_datetime(&t).earliest().map(|d| d.timestamp_millis())
}

/// (abierta, motivo): '' | 'apagada' | 'cierre'.
pub fn estado_apertura(cfg: &Value, ahora: i64) -> (bool, &'static str) {
    if !truthy(cfg) || !truthy(&cfg["abiertas"]) {
        return (false, "apagada");
    }
    match cierre_ms(&cfg["cierre"]) {
        Some(c) if ahora >= c => (false, "cierre"),
        _ => (true, ""),
    }
}

fn ocupa(it: &Value) -> bool {
    it["estado"] == "pendiente" || it["estado"] == "confirmado"
}
fn clave_clase(it: &Value) -> String {
    format!("{}|{}", js_string_vacio(&it["sexo"]), js_string_vacio(&it["clase"]))
}

pub struct Cupos {
    pub ocupados: usize,
    pub espera: usize,
    pub por_clase: Vec<(String, usize)>,
}
pub fn contar_cupos(items: &[Value]) -> Cupos {
    let mut c = Cupos { ocupados: 0, espera: 0, por_clase: vec![] };
    for it in items {
        if ocupa(it) {
            c.ocupados += 1;
            let k = clave_clase(it);
            match c.por_clase.iter_mut().find(|x| x.0 == k) {
                Some(x) => x.1 += 1,
                None => c.por_clase.push((k, 1)),
            }
        } else if it["estado"] == "espera" {
            c.espera += 1;
        }
    }
    c
}
fn por_clase_json(c: &Cupos) -> Value {
    Value::Object(c.por_clase.iter().map(|(k, n)| (k.clone(), json!(n))).collect())
}

pub fn cabe(cfg: &Value, c: &Cupos, sexo: &str, clase: &str) -> bool {
    let tot = js_to_number(&cfg["cupoTotal"]);
    if tot != 0.0 && !tot.is_nan() && c.ocupados as f64 >= tot {
        return false;
    }
    let cat = js_to_number(&cfg["cupoCategoria"]);
    let k = format!("{sexo}|{clase}");
    let usados = c.por_clase.iter().find(|x| x.0 == k).map(|x| x.1).unwrap_or(0);
    !(cat != 0.0 && !cat.is_nan() && usados as f64 >= cat)
}

fn contacto_valido(c: &str) -> bool {
    let correo = || {
        let Some((local, resto)) = c.split_once('@') else { return false };
        let ok_local = !local.is_empty() && largo16(local) <= 64 && !local.chars().any(char::is_whitespace);
        if !ok_local || resto.contains('@') || resto.chars().any(char::is_whitespace) {
            return false;
        }
        // [^\s@]{1,190}\.[^\s@]{2,}
        let b: Vec<char> = resto.chars().collect();
        (1..b.len()).any(|i| b[i] == '.' && i <= 190 && b.len() - i - 1 >= 2)
    };
    let tel = || {
        let t = c.strip_prefix('+').unwrap_or(c);
        let n = largo16(t);
        (7..=20).contains(&n) && t.chars().all(|x| x.is_ascii_digit() || x.is_whitespace() || matches!(x, '(' | ')' | '.' | '-')) && c.chars().filter(char::is_ascii_digit).count() >= 7
    };
    correo() || tel()
}

fn lista(v: &Value, max: usize, largo: usize) -> Vec<String> {
    let mut o: Vec<String> = vec![];
    if let Some(a) = v.as_array() {
        for x in a.iter().take(max).map(|x| txt(x, largo)).filter(|x| !x.is_empty()) {
            if !o.contains(&x) {
                o.push(x);
            }
        }
    }
    o
}

/// Valida y completa la configuración que escribe el organizador.
pub fn limpiar_config(b: &Value) -> R<Value> {
    if !b.is_object() {
        return mal(400, "Configuración no válida");
    }
    let cierre = b["cierre"].as_str().map(|s| trim_js(s).to_string()).unwrap_or_default();
    if !cierre.is_empty() && (!es_cierre(&cierre) || cierre_ms(&json!(cierre)).is_none()) {
        return mal(400, "El cierre debe tener fecha y hora válidas");
    }
    let precio = if b["precio"].is_null() || b["precio"] == "" { Some(0.0) } else { num(&b["precio"], 0.0, 1e9) };
    let Some(precio) = precio else { return mal(400, "El precio debe ser un número entre 0 y 1.000.000.000") };
    let pago = txt(&b["pagoUrl"], 300);
    if !pago.is_empty() && url(&json!(pago)).is_empty() {
        return mal(400, "El enlace de pago debe empezar por http:// o https://");
    }
    let reg = txt(&b["reglamentoUrl"], 300);
    if !reg.is_empty() && url(&json!(reg)).is_empty() {
        return mal(400, "El enlace del reglamento debe empezar por http:// o https://");
    }
    let cupo = |v: &Value| -> Result<Value, ()> { if v.is_null() || *v == "" { Ok(Value::Null) } else { num(v, 1.0, MAX_INSCRITOS as f64).map(nv).ok_or(()) } };
    let (Ok(cupo_total), Ok(cupo_cat)) = (cupo(&b["cupoTotal"]), cupo(&b["cupoCategoria"])) else {
        return mal(400, format!("Los cupos deben ser números entre 1 y {MAX_INSCRITOS} (o déjalos vacíos)"));
    };
    let preguntas: Vec<Value> = b["preguntas"].as_array().map(|a| {
        a.iter().take(8).filter(|p| p.is_object()).enumerate().map(|(i, p)| json!({
            "id": format!("p{}", i + 1), "texto": txt(&p["texto"], 120), "tipo": if p["tipo"] == "si-no" { "si-no" } else { "texto" }, "obligatoria": truthy(&p["obligatoria"]),
        })).filter(|p| !p["texto"].as_str().unwrap_or("").is_empty()).collect()
    }).unwrap_or_default();
    let mut equipamiento: Vec<String> = lista(&b["equipamiento"], 2, 10).into_iter().filter(|e| e == "raw" || e == "equipado").collect();
    if equipamiento.is_empty() {
        equipamiento = vec!["raw".into(), "equipado".into()];
    }
    let moneda = txt(&b["moneda"], 5).to_uppercase();
    Ok(json!({
        "abiertas": truthy(&b["abiertas"]), "cierre": cierre, "cupoTotal": cupo_total, "cupoCategoria": cupo_cat,
        "divisiones": lista(&b["divisiones"], 30, 40), "clases": lista(&b["clases"], 40, 12), "equipamiento": equipamiento,
        "precio": nv(precio), "moneda": if moneda.is_empty() { "COP".to_string() } else { moneda }, "pagoUrl": pago, "reglamentoUrl": reg, "instrucciones": txt(&b["instrucciones"], 1000), "preguntas": preguntas,
    }))
}

fn fecha_valida(nac: &str) -> bool {
    if !es_fecha(nac) {
        return false;
    }
    let anio: i32 = nac[0..4].parse().unwrap_or(0);
    chrono::NaiveDate::parse_from_str(nac, "%Y-%m-%d").is_ok() && anio >= 1920 && nac <= chrono::Utc::now().format("%Y-%m-%d").to_string().as_str()
}

/// Valida el formulario público contra la configuración del meet. Devuelve los campos del inscrito.
pub fn validar_inscripcion(m: &Value, b: &Value, ahora: i64) -> R<Map<String, Value>> {
    let cfg = &m["inscripciones"];
    let (abierta, motivo) = estado_apertura(cfg, ahora);
    if !abierta {
        return mal(409, if motivo == "cierre" { "Las inscripciones de este meet ya cerraron." } else { "Las inscripciones de este meet no están abiertas." });
    }
    if !b.is_object() {
        return mal(400, "Cuerpo no válido");
    }
    let nombre = txt(&b["nombre"], 80).split_whitespace().collect::<Vec<_>>().join(" ");
    if largo16(&nombre) < 3 || !nombre.contains(' ') {
        return mal(400, "Escribe tu nombre y apellido.");
    }
    if b["sexo"] != "M" && b["sexo"] != "F" {
        return mal(400, "Elige tu sexo (hombre o mujer).");
    }
    let nacimiento = fecha(&b["nacimiento"]);
    if !fecha_valida(&nacimiento) {
        return mal(400, "Escribe una fecha de nacimiento válida.");
    }
    let fed = if truthy(&m["federacion"]) { js_string(&m["federacion"]) } else { "IPF".into() };
    let div_cfg: Vec<String> = cfg["divisiones"].as_array().map(|a| a.iter().map(js_string).collect()).unwrap_or_default();
    let permitidas: Vec<&str> = divisiones_de(&fed).iter().map(|d| d.nombre.as_str()).filter(|d| div_cfg.is_empty() || div_cfg.iter().any(|x| x == d)).collect();
    let division = txt(&b["division"], 40);
    if !permitidas.contains(&division.as_str()) {
        return mal(400, "Elige una de las divisiones disponibles.");
    }
    let equipamiento = if b["equipamiento"] == "equipado" { "equipado" } else if b["equipamiento"] == "raw" { "raw" } else { "" };
    let eq_cfg: Vec<String> = match cfg["equipamiento"].as_array() {
        Some(a) if truthy(&cfg["equipamiento"]) => a.iter().map(js_string).collect(),
        _ => vec!["raw".into(), "equipado".into()],
    };
    if equipamiento.is_empty() || !eq_cfg.iter().any(|e| e == equipamiento) {
        return mal(400, "Elige un equipamiento de los que acepta el meet.");
    }
    let Some(peso) = num(&b["pesoEstimado"], 20.0, 300.0) else { return mal(400, "Escribe tu peso estimado en kg (entre 20 y 300).") };
    let clase = clase_mas_cercana(&fed, if b["sexo"] == "F" { "F" } else { "M" }, peso, &division);
    let clases_cfg = cfg["clases"].as_array().filter(|a| !a.is_empty());
    if clases_cfg.is_some_and(|a| !a.iter().any(|c| *c == clase.as_str())) {
        return mal(400, format!("Con ese peso tu categoría sería {clase} kg y este meet no la admite."));
    }
    let contacto = txt(&b["contacto"], 80);
    if !contacto_valido(&contacto) {
        return mal(400, "Escribe un correo o un teléfono para contactarte.");
    }
    if b["acepto"] != true {
        return mal(400, "Debes aceptar el reglamento para inscribirte.");
    }
    let mut aperturas = Map::new();
    for l in LEVS {
        let v = &b["aperturas"][l];
        if v.is_null() || *v == "" {
            continue;
        }
        let Some(n) = num(v, 1.0, 600.0) else { return mal(400, "Las marcas o aperturas deben ser números entre 1 y 600 kg.") };
        aperturas.insert(l.into(), nv(n));
    }
    let mut respuestas = vec![];
    for p in cfg["preguntas"].as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let v = txt(&b["respuestas"][p["id"].as_str().unwrap_or("")], 200);
        if p["tipo"] == "si-no" && !v.is_empty() && v != "si" && v != "no" {
            return mal(400, format!("Responde «sí» o «no» en: {}", js_string_vacio(&p["texto"])));
        }
        if truthy(&p["obligatoria"]) && v.is_empty() {
            return mal(400, format!("Falta responder: {}", js_string_vacio(&p["texto"])));
        }
        if !v.is_empty() {
            respuestas.push(json!({"id": p["id"], "texto": p["texto"], "valor": v}));
        }
    }
    let mut o = Map::new();
    o.insert("nombre".into(), json!(nombre));
    o.insert("sexo".into(), b["sexo"].clone());
    o.insert("nacimiento".into(), json!(nacimiento));
    o.insert("club".into(), json!(txt(&b["club"], 80)));
    o.insert("division".into(), json!(division));
    o.insert("equipamiento".into(), json!(equipamiento));
    o.insert("pesoEstimado".into(), nv(peso));
    o.insert("clase".into(), json!(clase));
    o.insert("aperturas".into(), Value::Object(aperturas));
    o.insert("contacto".into(), json!(contacto));
    o.insert("respuestas".into(), Value::Array(respuestas));
    Ok(o)
}

pub fn codigo_inscripcion(usado: &dyn Fn(&str) -> bool) -> String {
    loop {
        let c: String = (0..6).map(|_| CODIGO[entero_aleatorio(CODIGO.len() as u32) as usize] as char).collect();
        if !usado(&c) {
            return c;
        }
    }
}

pub fn item_nuevo(campos: Map<String, Value>, estado: &str, codigo: &str, ahora: i64) -> Value {
    let mut o = Map::new();
    o.insert("id".into(), json!(format!("in-{}", hex_aleatorio(4))));
    o.insert("codigo".into(), json!(codigo));
    o.insert("estado".into(), json!(estado));
    o.insert("pagado".into(), json!(false));
    o.extend(campos);
    o.insert("nota".into(), json!(""));
    o.insert("aid".into(), Value::Null);
    o.insert("creado".into(), json!(ahora));
    o.insert("ts".into(), json!(ahora));
    Value::Object(o)
}

/// Atleta que entra al meet al confirmar la inscripción (aperturas estimadas como primer intento).
pub fn atleta_de_inscripcion(item: &Value, m: &Value, lote: f64) -> R<Value> {
    let aid = format!("at-{}", hex_aleatorio(4));
    let mut intentos = Map::new();
    for l in LEVS {
        intentos.insert(l.into(), json!([{"kg": item["aperturas"][l]}, {}, {}]));
    }
    let plataforma = if truthy(&m["plataformas"][0]) { m["plataformas"][0].clone() } else { json!("Tarima 1") };
    limpiar_atleta(&json!({
        "id": aid, "nombre": item["nombre"], "sexo": item["sexo"], "nacimiento": item["nacimiento"], "club": item["club"], "division": item["division"], "equipamiento": item["equipamiento"],
        "peso": item["pesoEstimado"], "clase": item["clase"], "plataforma": plataforma, "sesion": "1", "grupo": "A", "lote": lote, "intentos": Value::Object(intentos),
    }), Some(&aid))
}

pub fn csv_inscripciones(items: &[Value]) -> String {
    let cab: Vec<Value> = ["Código", "Estado", "Pagado", "Nombre", "Sexo", "Nacimiento", "Club", "División", "Clase", "Equipamiento", "Peso estimado", "Apertura S", "Apertura B", "Apertura D", "Contacto", "Respuestas", "Nota", "Inscrito"].iter().map(|c| json!(c)).collect();
    let etiqueta = |e: &str| match e { "pendiente" => "Pendiente", "confirmado" => "Confirmado", "espera" => "Lista de espera", "rechazado" => "Rechazado", o => o }.to_string();
    let filas = items.iter().map(|i| {
        let resp: Vec<String> = i["respuestas"].as_array().map(|a| a.iter().map(|r| format!("{}: {}", js_string_vacio(&r["texto"]), js_string_vacio(&r["valor"]))).collect()).unwrap_or_default();
        let creado = chrono::DateTime::from_timestamp_millis(js_to_number(&i["creado"]) as i64).map(|d| d.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()).unwrap_or_default();
        vec![i["codigo"].clone(), json!(etiqueta(i["estado"].as_str().unwrap_or(""))), json!(if truthy(&i["pagado"]) { "Sí" } else { "No" }), i["nombre"].clone(), i["sexo"].clone(), i["nacimiento"].clone(), i["club"].clone(), i["division"].clone(), i["clase"].clone(), i["equipamiento"].clone(), i["pesoEstimado"].clone(),
            i["aperturas"]["S"].clone(), i["aperturas"]["B"].clone(), i["aperturas"]["D"].clone(), i["contacto"].clone(), json!(resp.join(" | ")), if truthy(&i["nota"]) { i["nota"].clone() } else { json!("") }, json!(creado)]
    }).collect();
    filas_csv(cab, filas, true, true)
}

/* ====================== Estado y rutas ====================== */

pub struct Inscripciones {
    carpeta: PathBuf,
    cache: Mutex<HashMap<String, Value>>,
    limite: crate::acceso::Limitador,
}

impl Inscripciones {
    pub fn nuevo(datos: &std::path::Path) -> Inscripciones {
        let carpeta = datos.join("inscripciones");
        let _ = std::fs::create_dir_all(&carpeta);
        Inscripciones { carpeta, cache: Mutex::new(HashMap::new()), limite: crate::acceso::Limitador::nuevo(5, 60 * 60 * 1000) }
    }
    fn ruta(&self, id: &str) -> PathBuf {
        self.carpeta.join(format!("{id}.json"))
    }
    fn leer(&self, id: &str) -> Value {
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        c.entry(id.to_string()).or_insert_with(|| {
            let x = std::fs::read_to_string(self.ruta(id)).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
            match x {
                Some(v) if v["items"].is_array() => v,
                _ => json!({"items": []}),
            }
        }).clone()
    }
    fn items(&self, id: &str) -> Vec<Value> {
        self.leer(id)["items"].as_array().cloned().unwrap_or_default()
    }
    fn modificar<T>(&self, id: &str, f: impl FnOnce(&mut Vec<Value>) -> T) -> R<T> {
        let _ = self.leer(id);
        let mut c = self.cache.lock().unwrap_or_else(|e| e.into_inner());
        let v = c.get_mut(id).ok_or_else(|| err(500, "sin datos"))?;
        let r = {
            let Some(items) = v["items"].as_array_mut() else { return mal(500, "datos corruptos") };
            f(items)
        };
        let tmp = self.carpeta.join(format!("{id}.json.tmp"));
        std::fs::write(&tmp, v.to_string()).and_then(|_| std::fs::rename(&tmp, self.ruta(id))).map_err(|e| err(500, e.to_string()))?;
        Ok(r)
    }
    fn publico(&self, m: &Value) -> Map<String, Value> {
        let c = &m["inscripciones"];
        let (abierta, motivo) = estado_apertura(c, ahora_ms());
        let cupos = contar_cupos(&self.items(m["id"].as_str().unwrap_or("")));
        let mut o = Map::new();
        o.insert("config".into(), if truthy(c) { c.clone() } else { Value::Null });
        o.insert("abierta".into(), json!(abierta));
        o.insert("motivo".into(), json!(motivo));
        o.insert("cupos".into(), json!({"total": if c["cupoTotal"].is_null() { Value::Null } else { c["cupoTotal"].clone() }, "ocupados": cupos.ocupados, "espera": cupos.espera, "porClase": por_clase_json(&cupos)}));
        o
    }
}

fn con_ok(extra: Map<String, Value>) -> Value {
    let mut o = Map::new();
    o.insert("ok".into(), json!(true));
    o.extend(extra);
    Value::Object(o)
}

pub async fn atender(ctx: &mut Ctx) -> R<Option<Response<Body>>> {
    let app = ctx.app.clone();
    let ins = &app.inscripciones;
    let p = ctx.partes.clone();
    let metodo = ctx.metodo.clone();
    let g = |i: usize| p.get(i).map(String::as_str);
    if g(0) == Some("inscripciones") && g(1) == Some("abiertas") && p.len() == 2 && metodo == Method::GET {
        let ahora = ahora_ms();
        let ids: Vec<Value> = app.almacen.listar().iter().filter(|m| m["publico"] != false && estado_apertura(&m["inscripciones"], ahora).0).map(|m| m["id"].clone()).collect();
        return Ok(Some(json_resp(200, &Value::Array(ids))));
    }
    if g(0) != Some("meets") || !(g(2) == Some("inscripciones") || g(2) == Some("inscripciones.csv")) {
        return Ok(None);
    }
    let id = g(1).unwrap_or("").to_string();
    let m = ctx.meet_visible(&id)?;
    let sub = g(3).map(str::to_string);

    if g(2) == Some("inscripciones.csv") {
        ctx.requiere_org()?;
        if metodo != Method::GET || p.len() != 3 {
            return mal(405, "Método no permitido");
        }
        return Ok(Some(descarga("text/csv; charset=utf-8", &format!("{id}-inscripciones.csv"), csv_inscripciones(&ins.items(&id)).into_bytes())));
    }
    if sub.as_deref() == Some("estado") && p.len() == 4 {
        if metodo != Method::GET {
            return mal(405, "Método no permitido");
        }
        return Ok(Some(json_resp(200, &con_ok(ins.publico(&m)))));
    }
    if sub.as_deref() == Some("config") && p.len() == 4 {
        ctx.requiere_org()?;
        if metodo != Method::PUT {
            return mal(405, "Método no permitido");
        }
        let cfg = limpiar_config(&ctx.cuerpo(LIM_NORMAL).await?)?;
        ctx.guardar(&id, |mm| { mm["inscripciones"] = cfg.clone(); Ok(()) })?;
        app.tiempo.emitir(&id, &json!({"tipo": "meet-cambio", "campos": {"inscripciones": cfg}}));
        return Ok(Some(json_resp(200, &json!({"ok": true, "config": cfg}))));
    }
    let Some(sub) = sub else {
        if metodo == Method::GET {
            ctx.requiere_org()?;
            let mut o = Map::new();
            o.insert("items".into(), Value::Array(ins.items(&id)));
            o.extend(ins.publico(&m));
            return Ok(Some(json_resp(200, &con_ok(o))));
        }
        if metodo != Method::POST {
            return mal(405, "Método no permitido");
        }
        return inscribir(ctx, &m).await.map(Some);
    };
    if p.len() == 4 && metodo == Method::PATCH {
        ctx.requiere_org()?;
        let Some(item0) = ins.items(&id).into_iter().find(|x| x["id"] == sub.as_str()) else { return mal(404, "No encuentro esa inscripción") };
        let b = ctx.cuerpo(4096).await?;
        if !b.is_object() {
            return mal(400, "Cuerpo no válido");
        }
        if b.get("estado").is_some() && !b["estado"].as_str().is_some_and(|e| ESTADOS.contains(&e)) {
            return mal(400, "Estado no válido");
        }
        let mut item = item0;
        let antes = item["estado"].as_str().unwrap_or("").to_string();
        if let Some(nuevo) = b["estado"].as_str().filter(|n| *n != antes) {
            if nuevo == "confirmado" {
                if !truthy(&item["aid"]) {
                    alta(ctx, &m, &mut item)?;
                }
            } else if antes == "confirmado" {
                baja(ctx, &id, &mut item)?;
            }
            item["estado"] = json!(nuevo);
        }
        if b.get("pagado").is_some() {
            item["pagado"] = json!(truthy(&b["pagado"]));
        }
        if b.get("nota").is_some() {
            item["nota"] = json!(txt(&b["nota"], 300));
        }
        item["ts"] = json!(ahora_ms());
        let guardado = item.clone();
        ins.modificar(&id, |l| { if let Some(x) = l.iter_mut().find(|x| x["id"] == sub.as_str()) { *x = guardado; } })?;
        let mut o = Map::new();
        o.insert("item".into(), item);
        o.extend(ins.publico(&m));
        return Ok(Some(json_resp(200, &con_ok(o))));
    }
    mal(404, "Ruta desconocida")
}

fn alta(ctx: &Ctx, m: &Value, item: &mut Value) -> R<()> {
    let id = m["id"].as_str().unwrap_or("").to_string();
    if m["atletas"].as_array().map(|a| a.len()).unwrap_or(0) >= 1000 {
        return mal(400, "Un meet admite hasta 1000 atletas");
    }
    let mut atleta = Value::Null;
    ctx.guardar(&id, |mm| {
        let lote = mm["atletas"].as_array().map(|a| a.iter().map(|x| num_o_cero(&x["lote"])).fold(0.0, f64::max)).unwrap_or(0.0) + 1.0;
        atleta = atleta_de_inscripcion(item, mm, lote)?;
        if !mm["atletas"].is_array() {
            mm["atletas"] = json!([]);
        }
        if let Some(a) = mm["atletas"].as_array_mut() {
            a.push(atleta.clone());
        }
        Ok(())
    })?;
    item["aid"] = atleta["id"].clone();
    ctx.app.tiempo.emitir(&id, &json!({"tipo": "atleta", "atleta": atleta}));
    Ok(())
}

fn baja(ctx: &Ctx, id: &str, item: &mut Value) -> R<()> {
    let Some(aid) = item["aid"].as_str().filter(|s| !s.is_empty()).map(str::to_string) else { return Ok(()) };
    ctx.guardar(id, |mm| {
        if let Some(a) = mm["atletas"].as_array_mut() {
            a.retain(|x| x["id"] != aid.as_str());
        }
        if let Some(o) = mm["aplausos"].as_object_mut() {
            o.shift_remove(&aid);
        }
        Ok(())
    })?;
    ctx.app.tiempo.emitir(id, &json!({"tipo": "atleta", "atleta": {"id": aid, "eliminado": true}}));
    item["aid"] = Value::Null;
    Ok(())
}

async fn inscribir(ctx: &mut Ctx, m: &Value) -> R<Response<Body>> {
    let app = ctx.app.clone();
    let id = m["id"].as_str().unwrap_or("").to_string();
    let cfg = m["inscripciones"].clone();
    let cuerpo = ctx.cuerpo(16 * 1024).await?;
    let campos = validar_inscripcion(m, &cuerpo, ahora_ms())?;
    let items = app.inscripciones.items(&id);
    let llave = format!("{}|{}", normalizar_nombre(campos["nombre"].as_str().unwrap_or("")), campos["nacimiento"].as_str().unwrap_or(""));
    if items.iter().any(|i| i["estado"] != "rechazado" && format!("{}|{}", normalizar_nombre(&js_string_vacio(&i["nombre"])), js_string_vacio(&i["nacimiento"])) == llave) {
        return mal(409, MENSAJE_DUPLICADO);
    }
    if items.len() >= MAX_INSCRITOS {
        return mal(409, "Este meet ya no recibe más inscripciones.");
    }
    if !app.inscripciones.limite.intentar(&ctx.ip_s()) {
        return mal(429, "Ya enviaste varias inscripciones desde esta conexión. Espera una hora o pídele al organizador que te inscriba.");
    }
    let cupos = contar_cupos(&items);
    let estado = if cabe(&cfg, &cupos, campos["sexo"].as_str().unwrap_or(""), campos["clase"].as_str().unwrap_or("")) { "pendiente" } else { "espera" };
    let codigo = codigo_inscripcion(&|c| items.iter().any(|i| i["codigo"] == c));
    let clase = campos["clase"].clone();
    let division = campos["division"].clone();
    let item = item_nuevo(campos, estado, &codigo, ahora_ms());
    app.inscripciones.modificar(&id, |l| l.push(item))?;
    Ok(json_resp(201, &json!({
        "ok": true, "codigo": codigo, "estado": estado, "clase": clase, "division": division,
        "precio": if truthy(&cfg["precio"]) { cfg["precio"].clone() } else { json!(0) }, "moneda": if truthy(&cfg["moneda"]) { cfg["moneda"].clone() } else { json!("") }, "pagoUrl": if truthy(&cfg["pagoUrl"]) { cfg["pagoUrl"].clone() } else { json!("") },
    })))
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn contactos() {
        assert!(contacto_valido("ana@correo.co"));
        assert!(contacto_valido("+57 300 123 4567"));
        assert!(!contacto_valido("ana@correo"));
        assert!(!contacto_valido("a b@correo.co"));
        assert!(!contacto_valido("12345"));
        assert!(!contacto_valido("a@@b.co"));
    }

    #[test]
    fn config_y_cupos() {
        assert!(limpiar_config(&json!([])).is_err());
        assert!(limpiar_config(&json!({"pagoUrl": "ftp://x"})).is_err());
        assert!(limpiar_config(&json!({"cupoTotal": 0})).is_err());
        assert!(limpiar_config(&json!({"cierre": "2026-13-01T10:00"})).is_err());
        let c = limpiar_config(&json!({"abiertas": 1, "precio": "50", "moneda": "usd", "cupoTotal": "2", "preguntas": [{"texto": "¿Alergias?", "tipo": "si-no"}, 5, {"texto": ""}]})).unwrap();
        assert_eq!(c["abiertas"], true);
        assert_eq!(c["moneda"], "USD");
        assert_eq!(c["precio"], 50);
        assert_eq!(c["cupoTotal"], 2);
        assert_eq!(c["equipamiento"], json!(["raw", "equipado"]));
        assert_eq!(c["preguntas"].as_array().unwrap().len(), 1);
        assert_eq!(c["preguntas"][0]["id"], "p1");
        let items = vec![json!({"estado": "pendiente", "sexo": "M", "clase": "-83"}), json!({"estado": "espera", "sexo": "M", "clase": "-83"})];
        let cu = contar_cupos(&items);
        assert_eq!((cu.ocupados, cu.espera), (1, 1));
        assert!(cabe(&c, &cu, "M", "-83"));
        assert!(!cabe(&json!({"cupoTotal": 1}), &cu, "M", "-83"));
        assert!(!cabe(&json!({"cupoCategoria": 1}), &cu, "M", "-83"));
        assert!(cabe(&json!({"cupoCategoria": 1}), &cu, "F", "-57"));
    }

    #[test]
    fn apertura_y_formulario() {
        let ahora = ahora_ms();
        assert_eq!(estado_apertura(&json!(null), ahora), (false, "apagada"));
        assert_eq!(estado_apertura(&json!({"abiertas": true, "cierre": "2000-01-01T10:00"}), ahora), (false, "cierre"));
        assert_eq!(estado_apertura(&json!({"abiertas": true, "cierre": "2999-01-01T10:00"}), ahora), (true, ""));
        let m = json!({"federacion": "IPF", "inscripciones": {"abiertas": true, "cierre": ""}});
        let ok = json!({"nombre": "Ana Pérez", "sexo": "F", "nacimiento": "1995-05-12", "division": "Open", "equipamiento": "raw", "pesoEstimado": 60, "contacto": "ana@correo.co", "acepto": true});
        let c = validar_inscripcion(&m, &ok, ahora).unwrap();
        assert_eq!(c["clase"], "-63");
        assert!(validar_inscripcion(&m, &json!({"nombre": "Ana Pérez", "sexo": "F", "nacimiento": "2999-05-12"}), ahora).is_err());
        let mut mal_peso = ok.clone();
        mal_peso["pesoEstimado"] = json!(10);
        assert!(validar_inscripcion(&m, &mal_peso, ahora).is_err());
        let mut sin = ok.clone();
        sin["acepto"] = json!(false);
        assert_eq!(validar_inscripcion(&m, &sin, ahora).unwrap_err().estado, 400);
        let it = item_nuevo(c, "pendiente", "ABC234", ahora);
        let at = atleta_de_inscripcion(&it, &m, 3.0).unwrap();
        assert_eq!(at["lote"], 3);
        assert_eq!(at["plataforma"], "Tarima 1");
        assert!(csv_inscripciones(&[it]).contains("ABC234,Pendiente,No,Ana Pérez"));
    }
}
