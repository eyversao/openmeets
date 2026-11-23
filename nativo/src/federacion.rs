//! Modo federación: accesos de equipo con PIN propio (director, mesa, pesaje, locutor, solo lectura),
//! auditoría de cada escritura y datos para el locutor. Port de servidor/federacion.mjs.
use crate::acceso::*;
use crate::api::*;
use crate::calculo::*;
use crate::js::*;
use crate::records_logica::open_powerlifting_csv;
use crate::validar::*;
use axum::body::Body;
use axum::http::{Method, Response};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const COOKIE_ROL: &str = "om_rol";
pub const ROLES: [&str; 5] = ["director", "mesa", "pesaje", "locutor", "lectura"];
const MAX_ROLES: usize = 100;

pub fn nombre_rol(r: &str) -> String {
    match r {
        "director" => "Director técnico",
        "mesa" => "Mesa",
        "pesaje" => "Pesaje",
        "locutor" => "Locutor",
        "lectura" => "Solo lectura",
        o => o,
    }
    .to_string()
}

/* ====================== Roles: almacén con hash scrypt ====================== */

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(default)]
pub struct Rol {
    pub id: String,
    #[serde(rename = "meetId")]
    pub meet_id: String,
    pub nombre: String,
    pub rol: String,
    pub plataforma: String,
    pub sal: String,
    pub hash: String,
    pub creado: i64,
    pub caduca: i64,
    pub revocado: bool,
}

fn hash_pin(pin: &str, sal: &str) -> Vec<u8> {
    let sal = hex::decode(sal).unwrap_or_default();
    let mut out = vec![0u8; 32];
    if let Ok(p) = scrypt::Params::new(14, 8, 1) {
        let _ = scrypt::scrypt(pin.as_bytes(), &sal, &p, &mut out);
    }
    out
}
fn coincide(r: &Rol, pin: &str) -> bool {
    let a = hash_pin(pin, &r.sal);
    let b = hex::decode(&r.hash).unwrap_or_default();
    a.len() == b.len() && a.iter().zip(b.iter()).fold(0u8, |x, (p, q)| x | (p ^ q)) == 0
}

#[derive(Default)]
struct RolesInterno {
    lista: Vec<Rol>,
    sesiones: HashMap<String, String>,
}
pub struct Roles {
    archivo: PathBuf,
    i: Mutex<RolesInterno>,
}

fn activo(r: &Rol) -> bool {
    !r.revocado && r.caduca > ahora_ms()
}
pub fn publico(r: &Rol) -> Value {
    let estado = if r.revocado { "revocado" } else if r.caduca <= ahora_ms() { "caducado" } else { "activo" };
    json!({"id": r.id, "meetId": r.meet_id, "nombre": r.nombre, "rol": r.rol, "plataforma": r.plataforma, "creado": r.creado, "caduca": r.caduca, "estado": estado})
}

impl Roles {
    pub fn nuevo(dir: &Path) -> Roles {
        let _ = std::fs::create_dir_all(dir);
        let archivo = dir.join("roles.json");
        let lista = std::fs::read_to_string(&archivo).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()).and_then(|v| serde_json::from_value::<Vec<Rol>>(v["roles"].clone()).ok()).unwrap_or_default();
        Roles { archivo, i: Mutex::new(RolesInterno { lista, sesiones: HashMap::new() }) }
    }
    fn lock(&self) -> std::sync::MutexGuard<'_, RolesInterno> {
        self.i.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn guardar(&self, g: &RolesInterno) {
        let mut buf = Vec::new();
        let fmt = serde_json::ser::PrettyFormatter::with_indent(b" ");
        let mut ser = serde_json::Serializer::with_formatter(&mut buf, fmt);
        if serde::Serialize::serialize(&json!({"version": 1, "roles": g.lista}), &mut ser).is_ok() {
            let mut t = self.archivo.as_os_str().to_owned();
            t.push(".tmp");
            let tmp = PathBuf::from(t);
            if std::fs::write(&tmp, &buf).is_ok() {
                let _ = std::fs::rename(&tmp, &self.archivo);
            }
        }
    }
    /// Crea un acceso y devuelve (rol público, PIN): el PIN solo se ve esta vez.
    pub fn crear(&self, meet_id: &str, nombre: &str, rol: &str, plataforma: &str, horas: f64) -> R<(Value, String)> {
        let mut g = self.lock();
        if g.lista.len() >= MAX_ROLES {
            return mal(400, format!("Hay demasiados accesos en este servidor (máximo {MAX_ROLES}). Revoca los que ya no uses."));
        }
        let mut pin = pin_aleatorio();
        for _ in 0..30 {
            if !g.lista.iter().any(|r| activo(r) && coincide(r, &pin)) {
                break;
            }
            pin = pin_aleatorio();
        }
        let sal = hex_aleatorio(16);
        let ahora = ahora_ms();
        let r = Rol { id: format!("r-{}", hex_aleatorio(5)), meet_id: meet_id.into(), nombre: nombre.into(), rol: rol.into(), plataforma: plataforma.into(), hash: hex::encode(hash_pin(&pin, &sal)), sal, creado: ahora, caduca: ahora + (horas * 3_600_000.0) as i64, revocado: false };
        let p = publico(&r);
        g.lista.push(r);
        self.guardar(&g);
        Ok((p, pin))
    }
    pub fn verificar(&self, pin: &str, id: Option<&str>) -> Option<Rol> {
        if !pin_valido(pin) {
            return None;
        }
        let g = self.lock();
        let mut hallado = None;
        for r in &g.lista {
            if id.is_none_or(|i| r.id == i) && activo(r) && coincide(r, pin) && hallado.is_none() {
                hallado = Some(r.clone());
            }
        }
        hallado
    }
    pub fn abrir_sesion(&self, r: &Rol) -> String {
        let t = hex_aleatorio(24);
        self.lock().sesiones.insert(t.clone(), r.id.clone());
        t
    }
    pub fn cerrar_sesion(&self, t: Option<&str>) {
        if let Some(t) = t {
            self.lock().sesiones.remove(t);
        }
    }
    pub fn de_token(&self, t: Option<&str>) -> Option<Rol> {
        let t = t?;
        let mut g = self.lock();
        let id = g.sesiones.get(t).cloned();
        if let Some(r) = id.and_then(|id| g.lista.iter().find(|x| x.id == id)).filter(|r| activo(r)) {
            return Some(r.clone());
        }
        g.sesiones.remove(t);
        None
    }
    pub fn revocar(&self, meet_id: &str, id: &str) -> Option<Rol> {
        let mut g = self.lock();
        let r = g.lista.iter_mut().find(|x| x.id == id && x.meet_id == meet_id)?;
        r.revocado = true;
        let r = r.clone();
        self.guardar(&g);
        g.sesiones.retain(|_, rid| rid != id);
        Some(r)
    }
    pub fn listar(&self, meet_id: &str) -> Vec<Value> {
        let g = self.lock();
        let mut l: Vec<&Rol> = g.lista.iter().filter(|r| r.meet_id == meet_id).collect();
        l.sort_by(|a, b| b.creado.cmp(&a.creado));
        l.into_iter().map(publico).collect()
    }
}

pub struct Quien {
    pub rol: String,
    pub meet_id: String,
    pub plataforma: String,
    pub nombre: String,
}

fn rol_de(ctx: &Ctx, app: &App) -> Option<Quien> {
    app.roles.de_token(ctx.cookie(COOKIE_ROL).as_deref()).map(|r| Quien { rol: r.rol, meet_id: r.meet_id, plataforma: r.plataforma, nombre: r.nombre })
}

/* ====================== Permisos por rol ====================== */

/// ¿Esta ruta pasa como organizador para este rol? `partes` = ruta tras /api.
pub fn eleva_para(p: &Quien, metodo: &Method, partes: &[String]) -> bool {
    let g = |i: usize| partes.get(i).map(String::as_str).unwrap_or("");
    if g(0) != "meets" || g(1) != p.meet_id || g(2) == "importar" {
        return false;
    }
    let n = partes.len();
    let sub = g(2);
    if sub == "roles" {
        return false;
    }
    let get = *metodo == Method::GET;
    match p.rol.as_str() {
        "director" => !(*metodo == Method::DELETE && n == 2),
        "mesa" => (get && (n == 2 || (sub == "canal" && n == 3))) || (sub == "canal" && *metodo == Method::POST && n == 3) || (sub == "atletas" && *metodo == Method::PUT && n == 4),
        "pesaje" => (get && n == 2) || (sub == "atletas" && *metodo == Method::PUT && n == 4),
        _ => false,
    }
}

pub fn elevar(ctx: &Ctx, app: &App) -> bool {
    rol_de(ctx, app).is_some_and(|p| eleva_para(&p, &ctx.metodo, &ctx.partes))
}

/// Lo que un rol puede cambiar de un atleta; 403 si intenta más.
pub fn fusionar_atleta(rol: &str, prev: &Value, nuevo: &Value) -> R<Value> {
    let mut sal = prev.clone();
    if rol == "mesa" {
        sal["intentos"] = nuevo["intentos"].clone();
        return Ok(sal);
    }
    if rol == "pesaje" {
        sal["peso"] = nuevo["peso"].clone();
        sal["clase"] = nuevo["clase"].clone();
        sal["rack"] = nuevo["rack"].clone();
        for l in ORDEN_LEV {
            let antes = prev["intentos"][l].as_array().cloned().unwrap_or_default();
            let ahora = nuevo["intentos"][l].as_array().cloned().unwrap_or_default();
            for n in 0..antes.len().max(ahora.len()) {
                let (a, b) = (antes.get(n), ahora.get(n));
                let ra = a.map(|x| x["r"].clone()).unwrap_or(Value::Null);
                let rb = b.map(|x| x["r"].clone()).unwrap_or(Value::Null);
                if ra != rb {
                    return mal(403, "Con el rol de pesaje no puedes cambiar resultados. Pídeselo a la mesa.");
                }
                let kg_b = b.map(|x| js_to_number(&x["kg"])).unwrap_or(0.0);
                if a.is_none() && b.is_some() && kg_b > 0.0 {
                    if !sal["intentos"][l].is_array() {
                        sal["intentos"][l] = json!([]);
                    }
                    if let Some(v) = sal["intentos"][l].as_array_mut() {
                        while v.len() < n {
                            v.push(Value::Null);
                        }
                        let nuevo_i = json!({"kg": b.map(|x| x["kg"].clone()).unwrap_or(Value::Null), "r": null, "rec": false, "alFinal": false});
                        if n < v.len() { v[n] = nuevo_i } else { v.push(nuevo_i) }
                    }
                } else if a.is_some_and(|x| x["r"].is_null()) && b.is_some() {
                    sal["intentos"][l][n]["kg"] = b.map(|x| x["kg"].clone()).unwrap_or(Value::Null);
                }
            }
        }
        return Ok(sal);
    }
    mal(403, "Tu rol no puede escribir atletas")
}

/* ====================== Auditoría ====================== */

fn etiqueta_r(r: &Value) -> &'static str {
    match r.as_f64() {
        Some(1.0) => "válido",
        Some(-1.0) => "nulo",
        _ => "—",
    }
}
const CAMPOS_ATLETA: [&str; 12] = ["nombre", "sexo", "nacimiento", "club", "division", "equipamiento", "peso", "clase", "plataforma", "sesion", "grupo", "lote"];

fn ver(v: &Value) -> String {
    if v.is_null() || *v == "" { "—".into() } else { js_string(v) }
}

fn cmp(out: &mut Vec<Value>, campo: String, a: &Value, b: &Value) {
    if a != b {
        out.push(json!({"campo": campo, "antes": ver(a), "despues": ver(b)}));
    }
}

/// Diferencias entre dos versiones de un atleta: [{ campo, antes, despues }].
pub fn cambios_atleta(prev: &Value, nuevo: &Value) -> Vec<Value> {
    let mut out = vec![];
    for c in CAMPOS_ATLETA {
        cmp(&mut out, c.to_string(), &prev[c], &nuevo[c]);
    }
    for l in ["S", "B"] {
        cmp(&mut out, format!("rack {l}"), &prev["rack"][l], &nuevo["rack"][l]);
    }
    let falso = json!(false);
    for l in ORDEN_LEV {
        for n in 0..4 {
            let (a, b) = (&prev["intentos"][l][n], &nuevo["intentos"][l][n]);
            if !truthy(a) && !truthy(b) {
                continue;
            }
            cmp(&mut out, format!("{l}{} kg", n + 1), &a["kg"], &b["kg"]);
            if a["r"] != b["r"] {
                out.push(json!({"campo": format!("{l}{} resultado", n + 1), "antes": etiqueta_r(&a["r"]), "despues": etiqueta_r(&b["r"])}));
            }
            let ra = if truthy(&a["rec"]) { &a["rec"] } else { &falso };
            let rb = if truthy(&b["rec"]) { &b["rec"] } else { &falso };
            cmp(&mut out, format!("{l}{} récord", n + 1), ra, rb);
        }
    }
    out
}

fn resumen_cambios(cs: &[Value]) -> String {
    let mut s = cs.iter().take(4).map(|c| format!("{} {}→{}", js_string(&c["campo"]), js_string(&c["antes"]), js_string(&c["despues"]))).collect::<Vec<_>>().join(", ");
    if cs.len() > 4 {
        s.push_str(&format!(" y {} más", cs.len() - 4));
    }
    s
}
const OCULTOS: [&str; 7] = ["atletas", "vivo", "aplausos", "actividad", "privado", "actualizado", "estado"];

/// Foto previa de lo que va a tocar una escritura.
pub fn instantanea(m: &Value, partes: &[String]) -> Value {
    let sub = partes.get(2).map(String::as_str).unwrap_or("");
    if sub.is_empty() {
        let campos: Map<String, Value> = m.as_object().map(|o| o.iter().filter(|(k, _)| !OCULTOS.contains(&k.as_str())).map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
        return json!({"tipo": "meet", "campos": campos, "codigo": m["privado"]["codigoJuez"]});
    }
    if sub == "atletas" {
        if partes.len() == 4 {
            let antes = m["atletas"].as_array().and_then(|a| a.iter().find(|x| x["id"] == partes[3].as_str())).cloned().unwrap_or(Value::Null);
            return json!({"tipo": "atleta", "aid": partes[3], "antes": antes});
        }
        return json!({"tipo": "lote", "n": m["atletas"].as_array().map(|a| a.len()).unwrap_or(0)});
    }
    if sub == "canal" {
        let v: Map<String, Value> = m["vivo"].as_object().map(|o| o.iter().map(|(p, v)| (p.clone(), json!({"turno": if truthy(&v["turno"]) { v["turno"].clone() } else { Value::Null }, "lucesTs": if truthy(&v["lucesTs"]) { v["lucesTs"].clone() } else { Value::Null }}))).collect()).unwrap_or_default();
        return json!({"tipo": "canal", "vivos": v});
    }
    json!({"tipo": "otro"})
}

fn corto(v: &Value) -> String {
    let t = if let Value::String(s) = v { s.clone() } else { v.to_string() };
    if largo16(&t) > 80 { format!("{}…", cortar(&t, 77)) } else { t }
}

/// Compara la foto con el meet ya cambiado y devuelve las entradas de auditoría.
pub fn resumir_escritura(snap: &Value, m: &Value, metodo: &Method, partes: &[String]) -> Vec<Value> {
    let sub = partes.get(2).map(String::as_str).unwrap_or("");
    match snap["tipo"].as_str().unwrap_or("") {
        "meet" => {
            if *metodo == Method::DELETE {
                return vec![json!({"resumen": "Borró el meet (queda en la papelera)"})];
            }
            let mut cambios: Vec<Value> = m.as_object().map(|o| o.iter().filter(|(k, v)| !OCULTOS.contains(&k.as_str()) && **v != snap["campos"][k.as_str()]).map(|(k, v)| json!({"campo": k, "antes": corto(&if snap["campos"][k.as_str()].is_null() { json!("—") } else { snap["campos"][k.as_str()].clone() }), "despues": corto(v)})).collect()).unwrap_or_default();
            if m["privado"]["codigoJuez"] != snap["codigo"] {
                cambios.push(json!({"campo": "código de jueces", "antes": "***", "despues": "***"}));
            }
            if cambios.is_empty() { vec![] } else { vec![json!({"resumen": format!("Cambió el meet: {}", resumen_cambios(&cambios)), "cambios": cambios})] }
        }
        "atleta" => {
            let ahora = m["atletas"].as_array().and_then(|a| a.iter().find(|x| x["id"] == snap["aid"])).cloned().unwrap_or(Value::Null);
            let base = if ahora.is_null() { &snap["antes"] } else { &ahora };
            let nombre = if truthy(&base["nombre"]) { js_string(&base["nombre"]) } else { js_string(&snap["aid"]) };
            if *metodo == Method::DELETE {
                return if snap["antes"].is_null() { vec![] } else { vec![json!({"resumen": format!("Quitó a {nombre} del meet")})] };
            }
            if snap["antes"].is_null() && !ahora.is_null() {
                return vec![json!({"resumen": format!("Añadió a {nombre}")})];
            }
            let cambios = cambios_atleta(&snap["antes"], &ahora);
            if cambios.is_empty() { vec![] } else { vec![json!({"resumen": format!("{nombre}: {}", resumen_cambios(&cambios)), "cambios": cambios})] }
        }
        "lote" => vec![json!({"resumen": format!("Importó atletas ({} → {} en el meet)", js_string(&snap["n"]), m["atletas"].as_array().map(|a| a.len()).unwrap_or(0))})],
        "canal" => {
            let mut out = vec![];
            if let Some(o) = m["vivo"].as_object() {
                for (p, v) in o {
                    let antes = &snap["vivos"][p.as_str()];
                    if truthy(&v["turno"]) && v["turno"] != antes["turno"] && truthy(&v["actual"]) {
                        let lev = js_string_vacio(&v["lev"]).to_uppercase();
                        out.push(json!({"resumen": format!("{p}: en tarima {}, {} kg ({lev}{})", js_string_vacio(&v["actual"]["nombre"]), js_string_vacio(&v["actual"]["kg"]), num_str(js_to_number(&v["actual"]["n"]) + 1.0))}));
                    }
                    if truthy(&v["lucesTs"]) && v["lucesTs"] != antes["lucesTs"] && truthy(&v["luces"]["resultado"]) {
                        let nom = if truthy(&v["juzgado"]["nombre"]) { js_string(&v["juzgado"]["nombre"]) } else { "atleta".into() };
                        out.push(json!({"resumen": format!("{p}: {nom} {} kg, {}", js_string_vacio(&v["juzgado"]["kg"]), etiqueta_r(&v["luces"]["resultado"]))}));
                    }
                }
            }
            out
        }
        _ => {
            if sub == "roles" || sub == "aplauso" {
                vec![]
            } else {
                vec![json!({"resumen": format!("{} /{}", metodo.as_str(), partes.get(2..).unwrap_or(&[]).join("/"))})]
            }
        }
    }
}

/* ====================== Marcas personales (para el locutor) ====================== */

pub fn marcas_personales(meet: &Value, historial: &[Value]) -> Value {
    let indices: Vec<(&Value, HashMap<String, &Value>)> = historial.iter().filter(|h| h["id"] != meet["id"]).map(|h| {
        let mut por = HashMap::new();
        for a in h["atletas"].as_array().map(|v| v.iter()).into_iter().flatten() {
            por.insert(normalizar_nombre(&js_string_vacio(&a["nombre"])), a);
        }
        (h, por)
    }).collect();
    let mut out = Map::new();
    for a in meet["atletas"].as_array().map(|v| v.iter()).into_iter().flatten() {
        let k = normalizar_nombre(&js_string_vacio(&a["nombre"]));
        let (mut tot, mut s, mut b, mut d, mut meets) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0);
        let (mut fecha, mut nombre) = (Value::Null, Value::Null);
        if !k.is_empty() {
            for (h, por) in &indices {
                let Some(x) = por.get(&k) else { continue };
                meets += 1;
                s = s.max(mejor(x, "S"));
                b = b.max(mejor(x, "B"));
                d = d.max(mejor(x, "D"));
                let t = total(x);
                if t > tot {
                    tot = t;
                    fecha = h["fecha"].clone();
                    nombre = if !h["nombre"].is_null() { h["nombre"].clone() } else { h["id"].clone() };
                }
            }
        }
        let v = if meets > 0 { json!({"total": nv(tot), "S": nv(s), "B": nv(b), "D": nv(d), "meets": meets, "fechaTotal": fecha, "meetTotal": nombre}) } else { Value::Null };
        out.insert(js_string_vacio(&a["id"]), v);
    }
    Value::Object(out)
}

/* ====================== Extensión de la API ====================== */

fn archivo_aud(app: &App, id: &str) -> PathBuf {
    app.datos.join("auditoria").join(format!("{id}.jsonl"))
}

fn auditar(app: &App, meet_id: &str, quien: &str, rol: &str, e: &Value) {
    let mut o = Map::new();
    o.insert("ts".into(), json!(ahora_ms()));
    o.insert("quien".into(), json!(quien));
    o.insert("rol".into(), json!(rol));
    if let Some(m) = e.as_object() {
        o.extend(m.clone());
    }
    let _ = std::fs::create_dir_all(app.datos.join("auditoria"));
    let r = std::fs::OpenOptions::new().create(true).append(true).open(archivo_aud(app, meet_id)).and_then(|mut f| writeln!(f, "{}", Value::Object(o)));
    if let Err(e) = r {
        eprintln!("No pude anotar en la auditoría: {e}");
    }
}

struct Filtros {
    quien: String,
    q: String,
    desde: f64,
    hasta: f64,
    limite: usize,
}

fn leer_auditoria(app: &App, id: &str, f: &Filtros) -> Vec<Value> {
    let Ok(t) = std::fs::read_to_string(archivo_aud(app, id)) else { return vec![] };
    let lineas: Vec<&str> = t.split('\n').filter(|l| !l.is_empty()).collect();
    let (nq, nw) = (normalizar_nombre(&f.q), normalizar_nombre(&f.quien));
    let mut out = vec![];
    for l in lineas.iter().rev() {
        if out.len() >= f.limite {
            break;
        }
        let Ok(e) = serde_json::from_str::<Value>(l) else { continue };
        let ts = e["ts"].as_f64().unwrap_or(0.0);
        if f.desde != 0.0 && ts < f.desde || f.hasta != 0.0 && ts > f.hasta {
            continue;
        }
        if !nw.is_empty() && !normalizar_nombre(&format!("{} {}", js_string_vacio(&e["quien"]), js_string_vacio(&e["rol"]))).contains(&nw) {
            continue;
        }
        if !nq.is_empty() {
            let campos: Vec<String> = e["cambios"].as_array().map(|a| a.iter().map(|c| js_string_vacio(&c["campo"])).collect()).unwrap_or_default();
            if !normalizar_nombre(&format!("{} {}", js_string_vacio(&e["resumen"]), campos.join(" "))).contains(&nq) {
                continue;
            }
        }
        out.push(e);
    }
    out
}

fn auditoria_csv(es: &[Value]) -> String {
    let f = |t: f64| chrono::DateTime::from_timestamp_millis(t as i64).map(|d| d.format("%Y-%m-%d %H:%M:%S").to_string()).unwrap_or_default();
    let cab: Vec<Value> = ["Fecha", "Quién", "Rol", "Resumen"].iter().map(|c| json!(c)).collect();
    let filas = es.iter().map(|e| vec![json!(f(js_to_number(&e["ts"]))), e["quien"].clone(), e["rol"].clone(), e["resumen"].clone()]).collect();
    filas_csv(cab, filas, true, true)
}

pub async fn atender(ctx: &mut Ctx) -> R<Option<Response<Body>>> {
    let app = ctx.app.clone();
    let p = ctx.partes.clone();
    let metodo = ctx.metodo.clone();
    let g = |i: usize| p.get(i).map(String::as_str).unwrap_or("");
    let real_org = app.acceso.es_organizador(&ctx.ip, ctx.cookie(COOKIE).as_deref());
    let real = if real_org { None } else { rol_de(ctx, &app) };

    /* ---- /api/rol: quién soy, entrar, salir ---- */
    if g(0) == "rol" {
        if p.len() == 1 && metodo == Method::GET {
            let v = if real_org { json!({"ok": true, "rol": "organizador", "meetId": null, "plataforma": "", "nombre": "Organizador"}) } else {
                match &real { Some(r) => json!({"ok": true, "rol": r.rol, "meetId": r.meet_id, "plataforma": r.plataforma, "nombre": r.nombre}), None => json!({"ok": true, "rol": null, "meetId": null, "plataforma": "", "nombre": ""}) }
            };
            return Ok(Some(json_resp(200, &v)));
        }
        if g(1) == "entrar" && p.len() == 2 && metodo == Method::POST {
            let b = ctx.cuerpo(1024).await?;
            if !app.lim_rol.intentar(&format!("rol|{}", ctx.ip_s())) {
                return mal(429, "Demasiados intentos. Espera un minuto y vuelve a probar.");
            }
            let id = b["id"].as_str().filter(|s| es_id_seguro(s));
            let pin = b["pin"].as_str().map(|s| trim_js(s).to_string()).unwrap_or_default();
            let Some(r) = app.roles.verificar(&pin, id) else { return mal(401, "PIN incorrecto o acceso caducado. Pídele uno nuevo al organizador.") };
            if !app.almacen.existe(&r.meet_id) {
                return mal(404, "El meet de este acceso ya no existe");
            }
            let token = app.roles.abrir_sesion(&r);
            let seg = ((r.caduca - ahora_ms()) / 1000).clamp(60, 30 * 86400);
            let cookie = format!("{COOKIE_ROL}={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={seg}");
            return Ok(Some(json_h(200, &json!({"ok": true, "rol": r.rol, "meetId": r.meet_id, "plataforma": r.plataforma, "nombre": r.nombre}), &[("Set-Cookie", cookie)])));
        }
        if g(1) == "salir" && p.len() == 2 && metodo == Method::POST {
            app.roles.cerrar_sesion(ctx.cookie(COOKIE_ROL).as_deref());
            return Ok(Some(json_h(200, &json!({"ok": true}), &[("Set-Cookie", format!("{COOKIE_ROL}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"))])));
        }
        return mal(404, "Ruta desconocida");
    }

    if g(0) != "meets" || !es_id_seguro(g(1)) {
        return Ok(None);
    }
    let id = g(1).to_string();
    let sub = g(2).to_string();
    let es_director = real.as_ref().is_some_and(|r| r.rol == "director" && r.meet_id == id);

    /* ---- accesos del equipo (solo el organizador de verdad) ---- */
    if sub == "roles" {
        if !real_org {
            return mal(403, "Solo el organizador puede crear o revocar accesos del equipo. Entra con el PIN que muestra la consola.");
        }
        let Some(m) = app.almacen.leer(&id) else { return mal(404, "No encuentro ese meet") };
        if p.len() == 3 && metodo == Method::GET {
            return Ok(Some(json_resp(200, &json!({"ok": true, "roles": app.roles.listar(&id)}))));
        }
        if p.len() == 3 && metodo == Method::POST {
            let b = ctx.cuerpo(2048).await?;
            let nombre = txt(&b["nombre"], 60);
            if nombre.is_empty() {
                return mal(400, "Ponle un nombre al acceso (por ejemplo, el de la persona).");
            }
            let Some(rol) = b["rol"].as_str().filter(|r| ROLES.contains(r)) else { return mal(400, "El rol debe ser director, mesa, pesaje, locutor o lectura") };
            let plataforma = txt(&b["plataforma"], 40);
            if rol == "mesa" && plataforma.is_empty() {
                return mal(400, "La mesa necesita una plataforma");
            }
            if !plataforma.is_empty() && !m["plataformas"].as_array().is_some_and(|a| a.iter().any(|x| *x == plataforma.as_str())) {
                return mal(400, "Esa plataforma no existe en este meet");
            }
            let horas = num(&b["horas"], 1.0, 720.0).unwrap_or(48.0);
            let (r, pin) = app.roles.crear(&id, &nombre, rol, &plataforma, horas)?;
            let en = if plataforma.is_empty() { String::new() } else { format!(" ({plataforma})") };
            auditar(&app, &id, "Organizador", "organizador", &json!({"resumen": format!("Creó un acceso de {} para {nombre}{en}", nombre_rol(rol).to_lowercase())}));
            return Ok(Some(json_resp(201, &json!({"ok": true, "rol": r, "pin": pin}))));
        }
        if p.len() == 4 && metodo == Method::DELETE {
            let Some(r) = app.roles.revocar(&id, g(3)) else { return mal(404, "No encuentro ese acceso") };
            auditar(&app, &id, "Organizador", "organizador", &json!({"resumen": format!("Revocó el acceso de {} ({})", r.nombre, nombre_rol(&r.rol).to_lowercase())}));
            return Ok(Some(json_resp(200, &json!({"ok": true, "rol": publico(&r)}))));
        }
        return mal(405, "Método no permitido");
    }

    /* ---- auditoría ---- */
    if (sub == "auditoria" || sub == "auditoria.csv") && p.len() == 3 && metodo == Method::GET {
        if !real_org && !es_director {
            return mal(403, "La auditoría la ven el organizador y el director técnico.");
        }
        if !app.almacen.existe(&id) {
            return mal(404, "No encuentro ese meet");
        }
        let f = Filtros {
            quien: ctx.q("quien").unwrap_or("").to_string(), q: ctx.q("q").unwrap_or("").to_string(),
            desde: ctx.q("desde").map(js_number_str).filter(|x| !x.is_nan()).unwrap_or(0.0), hasta: ctx.q("hasta").map(js_number_str).filter(|x| !x.is_nan()).unwrap_or(0.0),
            limite: { let l = ctx.q("limite").map(js_number_str).filter(|x| !x.is_nan() && *x != 0.0).unwrap_or(500.0); l.max(1.0).min(5000.0) as usize },
        };
        let es = leer_auditoria(&app, &id, &f);
        if sub == "auditoria" {
            return Ok(Some(json_resp(200, &json!({"ok": true, "entradas": es}))));
        }
        return Ok(Some(descarga("text/csv; charset=utf-8", &format!("{id}-auditoria.csv"), auditoria_csv(&es).into_bytes())));
    }

    /* ---- exportación OpenPowerlifting y marcas del locutor ---- */
    if sub == "openpowerlifting.csv" && metodo == Method::GET && p.len() == 3 {
        let m = ctx.meet_visible(&id)?;
        return Ok(Some(descarga("text/csv; charset=utf-8", &format!("{id}-openpowerlifting.csv"), open_powerlifting_csv(&m).into_bytes())));
    }
    if sub == "locutor" && metodo == Method::GET && p.len() == 3 {
        let m = ctx.meet_visible(&id)?;
        let historial: Vec<Value> = app.almacen.listar().into_iter().filter(|h| h["id"] != id.as_str() && (h["publico"] != false || real_org)).collect();
        return Ok(Some(json_resp(200, &json!({"ok": true, "marcas": marcas_personales(&m, &historial)}))));
    }

    /* ---- filtro del cuerpo para mesa y pesaje ---- */
    let filtra = (sub == "canal" && p.len() == 3 && metodo == Method::POST) || (sub == "atletas" && p.len() == 4 && metodo == Method::PUT);
    if let Some(r) = &real {
        if (r.rol == "mesa" || r.rol == "pesaje") && r.meet_id == id && filtra {
            let reescribe = sub == "atletas";
            if sub == "canal" {
                let ct = ctx.headers.get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("");
                if !ct.to_ascii_lowercase().starts_with("application/json") {
                    return mal(415, "El cuerpo debe ser JSON (Content-Type: application/json)");
                }
            }
            let largo = ctx.headers.get("content-length").and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<usize>().ok());
            let limite = if sub == "canal" { LIM_CANAL } else { LIM_NORMAL };
            match largo {
                None => return mal(411, "Falta la longitud de la petición"),
                Some(l) if l > limite => return mal(413, "La petición es demasiado grande"),
                _ => {}
            }
            let b = ctx.cuerpo(limite).await?;
            if sub == "canal" {
                if r.rol == "mesa" && (b["tipo"] == "vivo" || b["tipo"] == "limpiar") && txt(&b["plataforma"], 40) != r.plataforma {
                    return mal(403, format!("Tu mesa es «{}»: no puedes mandar a otra plataforma.", r.plataforma));
                }
            } else {
                let prev = app.almacen.leer(&id).and_then(|m| m["atletas"].as_array().and_then(|a| a.iter().find(|x| x["id"] == g(3))).cloned());
                let Some(prev) = prev else { return mal(403, "Con tu rol no puedes añadir atletas nuevos. Pídeselo al organizador.") };
                if r.rol == "mesa" && prev["plataforma"] != r.plataforma.as_str() {
                    return mal(403, format!("Tu mesa es «{}», y este atleta compite en «{}».", r.plataforma, if truthy(&prev["plataforma"]) { js_string(&prev["plataforma"]) } else { "ninguna".into() }));
                }
                let fusion = fusionar_atleta(&r.rol, &prev, &limpiar_atleta(&b, Some(g(3)))?)?;
                if reescribe {
                    ctx.raw = Some(bytes::Bytes::from(fusion.to_string()));
                }
            }
        }
    }

    /* ---- auditoría de toda escritura de organizador o de rol ---- */
    if ctx.escribe && (real_org || real.is_some()) && (real_org || real.as_ref().is_some_and(|r| r.meet_id == id)) && sub != "roles" {
        if let Some(m) = app.almacen.leer(&id) {
            let snap = instantanea(&m, &p);
            let (quien, rol) = match &real {
                Some(r) if !real_org => (format!("{} ({})", r.nombre, nombre_rol(&r.rol)), r.rol.clone()),
                _ => ("Organizador".to_string(), "organizador".to_string()),
            };
            ctx.post.push(Post::Auditar { id, partes: p.clone(), metodo: metodo.to_string(), snap, quien, rol });
        }
    }
    Ok(None)
}

/// Tareas que corren tras responder (auditoría y récord automático).
pub fn despues(ctx: &Ctx, p: Post, estado: u16) {
    let app = &ctx.app;
    match p {
        Post::Auditar { id, partes, metodo, snap, quien, rol } => {
            if estado >= 400 {
                return;
            }
            let Some(actual) = app.almacen.leer(&id) else { return };
            let metodo = Method::from_bytes(metodo.as_bytes()).unwrap_or(Method::GET);
            for e in resumir_escritura(&snap, &actual, &metodo, &partes) {
                auditar(app, &id, &quien, &rol, &e);
            }
        }
        Post::Record { id, aid, antes } => {
            if estado == 200 {
                app.records.despues_de_atleta(ctx, &id, &aid, &antes);
            }
        }
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn q(rol: &str) -> Quien {
        Quien { rol: rol.into(), meet_id: "m".into(), plataforma: "T1".into(), nombre: "x".into() }
    }
    fn partes(s: &str) -> Vec<String> {
        s.split('/').map(String::from).collect()
    }

    #[test]
    fn permisos() {
        assert!(eleva_para(&q("director"), &Method::PATCH, &partes("meets/m")));
        assert!(!eleva_para(&q("director"), &Method::DELETE, &partes("meets/m")));
        assert!(!eleva_para(&q("director"), &Method::POST, &partes("meets/m/roles")));
        assert!(!eleva_para(&q("director"), &Method::GET, &partes("meets/otro")));
        assert!(eleva_para(&q("mesa"), &Method::POST, &partes("meets/m/canal")));
        assert!(!eleva_para(&q("mesa"), &Method::PATCH, &partes("meets/m")));
        assert!(eleva_para(&q("pesaje"), &Method::PUT, &partes("meets/m/atletas/a1")));
        assert!(!eleva_para(&q("locutor"), &Method::GET, &partes("meets/m")));
    }

    #[test]
    fn fusiones() {
        let prev = json!({"peso": 80, "clase": "-83", "rack": {}, "intentos": {"S": [{"kg": 100, "r": 1}, {"kg": 110, "r": null}], "B": [], "D": []}});
        let nuevo = json!({"peso": 81.6, "clase": "-83", "rack": {"S": 5}, "intentos": {"S": [{"kg": 100, "r": 1}, {"kg": 115, "r": null}, {"kg": 120, "r": null}], "B": [], "D": []}});
        let f = fusionar_atleta("pesaje", &prev, &nuevo).unwrap();
        assert_eq!(f["peso"], 81.6);
        assert_eq!(f["intentos"]["S"][1]["kg"], 115);
        assert_eq!(f["intentos"]["S"][2]["kg"], 120);
        let mut trampa = nuevo.clone();
        trampa["intentos"]["S"][0]["r"] = json!(-1);
        assert_eq!(fusionar_atleta("pesaje", &prev, &trampa).unwrap_err().estado, 403);
        assert_eq!(fusionar_atleta("mesa", &prev, &trampa).unwrap()["peso"], 80);
        assert_eq!(fusionar_atleta("locutor", &prev, &nuevo).unwrap_err().estado, 403);
    }

    #[test]
    fn auditoria_de_cambios() {
        let prev = json!({"nombre": "Ana", "intentos": {"S": [{"kg": 100, "r": null}]}});
        let nuevo = json!({"nombre": "Ana", "intentos": {"S": [{"kg": 100, "r": 1}]}});
        let c = cambios_atleta(&prev, &nuevo);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0]["campo"], "S1 resultado");
        assert_eq!(c[0]["despues"], "válido");
        let snap = json!({"tipo": "atleta", "aid": "a", "antes": prev});
        let m = json!({"atletas": [{"id": "a", "nombre": "Ana", "intentos": nuevo["intentos"]}]});
        let r = resumir_escritura(&snap, &m, &Method::PUT, &partes("meets/m/atletas/a"));
        assert_eq!(r[0]["resumen"], "Ana: S1 resultado —→válido");
    }

    #[test]
    fn roles_con_scrypt() {
        let d = std::env::temp_dir().join(format!("om-rs-roles-{}", hex_aleatorio(4)));
        let r = Roles::nuevo(&d);
        let (p, pin) = r.crear("m", "Luis", "mesa", "T1", 1.0).unwrap();
        assert_eq!(p["estado"], "activo");
        let rol = r.verificar(&pin, None).expect("el PIN abre el acceso");
        assert!(r.verificar("000000", None).is_none() || pin == "000000");
        let t = r.abrir_sesion(&rol);
        assert!(r.de_token(Some(&t)).is_some());
        assert!(Roles::nuevo(&d).verificar(&pin, None).is_some(), "se conserva en disco");
        r.revocar("m", &rol.id).unwrap();
        assert!(r.de_token(Some(&t)).is_none());
        let _ = std::fs::remove_dir_all(d);
    }
}
