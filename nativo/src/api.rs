//! Rutas /api/*: el mismo contrato HTTP y JSON que servidor/api.mjs.
use crate::acceso::*;
use crate::almacen::Almacen;
use crate::calculo::*;
use crate::estatico::Estatico;
use crate::federacion::{self, Roles};
use crate::inscripciones::Inscripciones;
use crate::js::*;
use crate::records::Records;
use crate::tiempo::Tiempo;
use crate::validar::*;
use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, Method, Response, StatusCode, header};
use bytes::Bytes;
use serde_json::{Map, Value, json};
use std::net::IpAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU16, Ordering};

pub struct App {
    pub version: String,
    pub puerto: AtomicU16,
    pub datos: PathBuf,
    pub almacen: Almacen,
    pub acceso: Acceso,
    pub tiempo: Tiempo,
    pub estatico: Estatico,
    pub aplausos: Limitador,
    pub roles: Roles,
    pub lim_rol: Limitador,
    pub inscripciones: Inscripciones,
    pub records: Records,
}

impl App {
    pub fn nuevo(datos: PathBuf, web: Option<PathBuf>, espera_ms: u64, version: &str) -> std::io::Result<Arc<App>> {
        std::fs::create_dir_all(&datos)?;
        Ok(Arc::new(App {
            version: version.to_string(),
            puerto: AtomicU16::new(0),
            almacen: Almacen::nuevo(&datos, espera_ms)?,
            acceso: Acceso::nuevo(&datos)?,
            tiempo: Tiempo::default(),
            estatico: Estatico::nuevo(web),
            aplausos: Limitador::nuevo(1, 10000),
            roles: Roles::nuevo(&datos),
            lim_rol: Limitador::nuevo(5, 60000),
            inscripciones: Inscripciones::nuevo(&datos),
            records: Records::nuevo(&datos),
            datos,
        }))
    }
}

/* ---------- Respuestas ---------- */

pub fn json_h(estado: u16, v: &Value, extra: &[(&str, String)]) -> Response<Body> {
    let mut r = Response::new(Body::from(v.to_string()));
    *r.status_mut() = StatusCode::from_u16(estado).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let h = r.headers_mut();
    h.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json; charset=utf-8"));
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    for (k, v) in extra {
        if let (Ok(k), Ok(v)) = (header::HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v)) {
            h.append(k, v);
        }
    }
    r
}
pub fn json_resp(estado: u16, v: &Value) -> Response<Body> {
    json_h(estado, v, &[])
}

/// Archivo descargable (CSV, JSON): Content-Disposition y sin caché.
pub fn descarga(tipo: &str, nombre: &str, cuerpo: Vec<u8>) -> Response<Body> {
    let mut r = Response::new(Body::from(cuerpo));
    let h = r.headers_mut();
    if let Ok(v) = HeaderValue::from_str(tipo) {
        h.insert(header::CONTENT_TYPE, v);
    }
    if let Ok(v) = HeaderValue::from_str(&format!("attachment; filename=\"{nombre}\"")) {
        h.insert(header::CONTENT_DISPOSITION, v);
    }
    h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    r
}

fn texto_resp(estado: StatusCode, t: &str) -> Response<Body> {
    let mut r = Response::new(Body::from(t.to_string()));
    *r.status_mut() = estado;
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"));
    r
}

/* ---------- Contexto de una petición ---------- */

pub enum Post {
    Auditar { id: String, partes: Vec<String>, metodo: String, snap: Value, quien: String, rol: String },
    Record { id: String, aid: String, antes: Value },
}

pub struct Ctx {
    pub app: Arc<App>,
    pub metodo: Method,
    pub partes: Vec<String>,
    pub query: Vec<(String, String)>,
    pub headers: HeaderMap,
    pub ip: IpAddr,
    pub org: bool,
    pub escribe: bool,
    pub body: Option<Body>,
    pub raw: Option<Bytes>,
    pub post: Vec<Post>,
}

fn es_json_ct(ct: &str) -> bool {
    let m = ct.to_ascii_lowercase();
    m.strip_prefix("application/json").is_some_and(|r| !r.chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_'))
}

impl Ctx {
    pub fn q(&self, k: &str) -> Option<&str> {
        self.query.iter().find(|(a, _)| a == k).map(|(_, v)| v.as_str())
    }
    pub fn ip_s(&self) -> String {
        self.ip.to_string()
    }
    pub fn cookie(&self, nombre: &str) -> Option<String> {
        let c = self.headers.get(header::COOKIE).and_then(|v| v.to_str().ok()).unwrap_or("");
        leer_cookies(c).remove(nombre)
    }
    pub fn requiere_org(&self) -> R<()> {
        if self.org { Ok(()) } else { mal(403, "Solo el organizador puede hacer esto. Entra con el PIN que muestra la consola.") }
    }
    pub fn meet_visible(&self, id: &str) -> R<Value> {
        match self.app.almacen.leer(id) {
            Some(m) if !(m["publico"] == false && !self.org) => Ok(m),
            _ => mal(404, "No encuentro ese meet"),
        }
    }
    pub fn guardar(&self, id: &str, f: impl FnOnce(&mut Value) -> R<()>) -> R<()> {
        self.app.almacen.guardar(id, f).map(|_| ())
    }

    /// Lee el cuerpo sin interpretarlo (con tope). El resultado se conserva para que otro paso lo vuelva a leer.
    pub async fn bytes(&mut self, limite: usize) -> R<Bytes> {
        if let Some(b) = &self.raw {
            if b.len() > limite {
                return mal(413, "La petición es demasiado grande");
            }
            return Ok(b.clone());
        }
        let Some(body) = self.body.take() else { return mal(400, "JSON no válido") };
        let b = axum::body::to_bytes(body, limite).await.map_err(|_| err(413, "La petición es demasiado grande"))?;
        self.raw = Some(b.clone());
        Ok(b)
    }

    /// Cuerpo JSON (415 si no lo es, 413 si pasa el tope, 400 si no se puede leer).
    pub async fn cuerpo(&mut self, limite: usize) -> R<Value> {
        let ct = self.headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("");
        if !es_json_ct(ct) {
            return mal(415, "El cuerpo debe ser JSON (Content-Type: application/json)");
        }
        let b = self.bytes(limite).await?;
        parsear(&b)
    }
}

pub fn parsear(b: &[u8]) -> R<Value> {
    let t = String::from_utf8_lossy(b);
    let t = if t.is_empty() { "{}" } else { &t };
    serde_json::from_str(t).or_else(|_| mal(400, "JSON no válido"))
}

/// Origin distinto del Host en una petición que cambia datos = otra página intentando usar este servidor.
pub fn origen_ajeno(headers: &HeaderMap) -> bool {
    let Some(o) = headers.get(header::ORIGIN) else { return false };
    let Ok(o) = o.to_str() else { return true };
    if o.is_empty() {
        return false;
    }
    let Some((esquema, resto)) = o.split_once("://") else { return true };
    let auth = resto.split(['/', '?', '#']).next().unwrap_or("");
    let auth = auth.rsplit('@').next().unwrap_or("").to_ascii_lowercase();
    let host = match (esquema.to_ascii_lowercase().as_str(), auth.rsplit_once(':')) {
        ("http", Some((h, "80"))) | ("https", Some((h, "443"))) => h.to_string(),
        _ => auth,
    };
    host != headers.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("")
}

fn decodificar(s: &str) -> String {
    let b = s.as_bytes();
    let mut o = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            match s.get(i + 1..i + 3).and_then(|h| u8::from_str_radix(h, 16).ok()) {
                Some(x) => {
                    o.push(x);
                    i += 3;
                    continue;
                }
                None => return String::new(),
            }
        }
        o.push(b[i]);
        i += 1;
    }
    String::from_utf8(o).unwrap_or_default()
}

fn parsear_query(q: &str) -> Vec<(String, String)> {
    q.split('&').filter(|p| !p.is_empty()).map(|p| {
        let (k, v) = p.split_once('=').unwrap_or((p, ""));
        (decodificar(&k.replace('+', " ")), decodificar(&v.replace('+', " ")))
    }).collect()
}

fn vista_meet(m: &Value, org: bool) -> Value {
    if org { m.clone() } else { sin_privado(m) }
}
fn con_estado(mut v: Value, m: &Value) -> Value {
    v["estado"] = json!(estado_meet(m, &hoy_iso()));
    v
}

/// Atiende una petición /api. Los errores salen como { ok:false, error }.
pub async fn atender(app: Arc<App>, metodo: Method, uri: &axum::http::Uri, headers: HeaderMap, ip: IpAddr, body: Body) -> Response<Body> {
    let mut ctx = Ctx {
        app: app.clone(), escribe: metodo != Method::GET && metodo != Method::HEAD, metodo, query: parsear_query(uri.query().unwrap_or("")),
        partes: vec![], headers, ip, org: false, body: Some(body), raw: None, post: vec![],
    };
    let ruta = uri.path().trim_end_matches('/');
    let ruta = if ruta.is_empty() { "/" } else { ruta };
    ctx.partes = ruta.split('/').skip(2).map(decodificar).collect();
    match manejar(&mut ctx).await {
        Ok(r) => {
            let estado = r.status().as_u16();
            for p in std::mem::take(&mut ctx.post) {
                federacion::despues(&ctx, p, estado);
            }
            r
        }
        Err(e) => {
            if e.estado == 500 {
                eprintln!("Error en la API: {}", e.mensaje);
            }
            json_resp(e.estado, &json!({"ok": false, "error": if e.estado == 500 { "Error interno del servidor".to_string() } else { e.mensaje }}))
        }
    }
}

async fn manejar(ctx: &mut Ctx) -> R<Response<Body>> {
    let app = ctx.app.clone();
    let metodo = ctx.metodo.clone();
    let id_ip = ctx.ip_s();
    ctx.org = app.acceso.es_organizador(&ctx.ip, ctx.cookie(COOKIE).as_deref());
    if !ctx.org && federacion::elevar(&ctx, &app) {
        ctx.org = true; // rol de equipo con permiso para esta ruta
    }
    if ctx.escribe && origen_ajeno(&ctx.headers) {
        return mal(403, "Petición de otro origen rechazada");
    }

    /* --- extensiones: federación (roles), inscripciones, récords --- */
    if let Some(r) = federacion::atender(ctx).await? {
        return Ok(r);
    }
    if let Some(r) = crate::inscripciones::atender(ctx).await? {
        return Ok(r);
    }
    if let Some(r) = crate::records::atender(ctx).await? {
        return Ok(r);
    }

    let p = ctx.partes.clone();
    let g0 = p.first().map(String::as_str).unwrap_or("");
    let org = ctx.org;

    /* --- info y sesión --- */
    if g0 == "info" && metodo == Method::GET && p.len() == 1 {
        return Ok(json_resp(200, &json!({"app": "OpenMeets", "version": app.version, "puerto": app.puerto.load(Ordering::Relaxed), "ips": ips_lan(), "organizador": org})));
    }
    if g0 == "sesion" && p.len() == 1 {
        if metodo == Method::DELETE {
            app.acceso.cerrar_sesion(ctx.cookie(COOKIE).as_deref());
            return Ok(json_h(200, &json!({"ok": true}), &[("Set-Cookie", cabecera_cookie("", true))]));
        }
        if metodo != Method::POST {
            return mal(405, "Método no permitido");
        }
        let b = ctx.cuerpo(1024).await?;
        return match app.acceso.iniciar_sesion(&id_ip, b["pin"].as_str()) {
            Sesion::Limitado => mal(429, "Demasiados intentos. Espera un minuto y vuelve a probar."),
            Sesion::Mal => mal(401, "PIN incorrecto"),
            Sesion::Ok(t) => Ok(json_h(200, &json!({"ok": true, "organizador": true}), &[("Set-Cookie", cabecera_cookie(&t, false))])),
        };
    }
    if g0 == "pin" && p.len() == 1 {
        ctx.requiere_org()?;
        if metodo == Method::GET {
            return Ok(json_resp(200, &json!({"ok": true, "pin": app.acceso.pin()})));
        }
        if metodo == Method::PUT {
            let b = ctx.cuerpo(1024).await?;
            if b.get("pin").is_some() && !b["pin"].as_str().is_some_and(pin_valido) {
                return mal(400, "El PIN debe tener 6 dígitos");
            }
            let pin = app.acceso.cambiar_pin(b["pin"].as_str())?;
            return Ok(json_h(200, &json!({"ok": true, "pin": pin}), &[("Set-Cookie", cabecera_cookie("", true))]));
        }
        return mal(405, "Método no permitido");
    }
    if g0 != "meets" {
        return mal(404, "Ruta desconocida");
    }

    /* --- /api/meets --- */
    if p.len() == 1 {
        if metodo == Method::GET {
            let todas = org && ctx.q("todas") == Some("1");
            let hoy = hoy_iso();
            let mut lista: Vec<Value> = app.almacen.listar().iter().filter(|m| todas || m["publico"] != false).map(|m| resumen_meet(m, &hoy)).collect();
            lista.sort_by(|a, b| loc_cmp(&js_string(&b["fecha"]), &js_string(&a["fecha"])));
            return Ok(json_resp(200, &Value::Array(lista)));
        }
        if metodo == Method::POST {
            ctx.requiere_org()?;
            let b = ctx.cuerpo(LIM_NORMAL).await?;
            let mut m = meet_nuevo(&b, &|id| app.almacen.existe(id))?;
            anotar(&mut m, "Meet creado");
            app.almacen.crear(&m)?;
            return Ok(json_resp(201, &m));
        }
        return mal(405, "Método no permitido");
    }
    if p[1] == "importar" && p.len() == 2 {
        ctx.requiere_org()?;
        if metodo != Method::POST {
            return mal(405, "Método no permitido");
        }
        let m = meet_importado(&ctx.cuerpo(LIM_IMPORTAR).await?)?;
        app.almacen.importar(&m, ctx.q("reemplazar") == Some("1"))?;
        return Ok(json_resp(201, &m));
    }

    let id = p[1].clone();
    if !es_id_seguro(&id) {
        return mal(404, "No encuentro ese meet");
    }
    let m = ctx.meet_visible(&id)?;
    let sub = p.get(2).cloned();

    let Some(sub) = sub else {
        if metodo == Method::GET {
            return Ok(json_resp(200, &con_estado(vista_meet(&m, org), &m)));
        }
        ctx.requiere_org()?;
        if metodo == Method::PATCH {
            let mut c = limpiar_campos(&ctx.cuerpo(LIM_NORMAL).await?, true)?;
            let privado = c.shift_remove("privado");
            let estaba_cerrado = truthy(&m["cerrado"]);
            let publicos = c.clone();
            let nuevo_cerrado = publicos.get("cerrado").cloned();
            ctx.guardar(&id, |mm| {
                if let Some(o) = mm.as_object_mut() {
                    for (k, v) in &publicos {
                        o.insert(k.clone(), v.clone());
                    }
                }
                if let Some(pv) = &privado {
                    let mut base = mm["privado"].as_object().cloned().unwrap_or_default();
                    if let Some(po) = pv.as_object() {
                        for (k, v) in po {
                            base.insert(k.clone(), v.clone());
                        }
                    }
                    mm["privado"] = Value::Object(base);
                }
                if let Some(cn) = &nuevo_cerrado {
                    if cn.as_bool().unwrap_or(false) != estaba_cerrado {
                        anotar(mm, if cn.as_bool().unwrap_or(false) { "Meet terminado" } else { "Meet reabierto" });
                    }
                }
                Ok(())
            })?;
            app.tiempo.emitir(&id, &json!({"tipo": "meet-cambio", "campos": Value::Object(c)}));
            let m2 = app.almacen.leer(&id).unwrap_or(m);
            return Ok(json_resp(200, &con_estado(m2.clone(), &m2)));
        }
        if metodo == Method::DELETE {
            app.tiempo.emitir(&id, &json!({"tipo": "meet-cambio", "campos": {"eliminado": true}}));
            app.almacen.borrar(&id);
            return Ok(json_resp(200, &json!({"ok": true})));
        }
        return mal(405, "Método no permitido");
    };

    if sub == "atletas" {
        ctx.requiere_org()?;
        let aid = p.get(3).cloned().unwrap_or_default();
        if p.len() == 3 && metodo == Method::POST {
            let b = ctx.cuerpo(LIM_LOTE).await?;
            let Some(entrada) = b["atletas"].as_array() else { return mal(400, "Falta la lista «atletas»") };
            let mut lista = vec![];
            for a in entrada.iter().take(MAX_ATLETAS) {
                let mut o = if a.is_object() { a.clone() } else { json!({}) };
                let ya = id_seguro(&a["id"]);
                if !ya {
                    o["id"] = json!(format!("at-{}", hex_aleatorio(4)));
                }
                lista.push(limpiar_atleta(&o, None)?);
            }
            let mut vistos = std::collections::HashSet::new();
            if !lista.iter().all(|a| vistos.insert(a["id"].as_str().unwrap_or("").to_string())) {
                return mal(400, "Hay atletas con el mismo identificador");
            }
            let n = lista.len();
            ctx.guardar(&id, |mm| {
                let mut por: Vec<Value> = mm["atletas"].as_array().cloned().unwrap_or_default();
                for a in &lista {
                    match por.iter().position(|x| x["id"] == a["id"]) {
                        Some(i) => por[i] = a.clone(),
                        None => por.push(a.clone()),
                    }
                }
                if por.len() > MAX_ATLETAS {
                    return mal(400, format!("Un meet admite hasta {MAX_ATLETAS} atletas"));
                }
                mm["atletas"] = Value::Array(por);
                anotar(mm, &format!("{n} atletas importados"));
                Ok(())
            })?;
            for a in &lista {
                app.tiempo.emitir(&id, &json!({"tipo": "atleta", "atleta": a}));
            }
            return Ok(json_resp(200, &json!({"ok": true, "atletas": n})));
        }
        if p.len() == 4 && metodo == Method::PUT {
            if !es_id_seguro(&aid) {
                return mal(400, "Identificador de atleta no válido");
            }
            let a = limpiar_atleta(&ctx.cuerpo(LIM_NORMAL).await?, Some(&aid))?;
            ctx.guardar(&id, |mm| {
                if !mm["atletas"].is_array() {
                    mm["atletas"] = json!([]);
                }
                let nombre = if truthy(&a["nombre"]) { js_string(&a["nombre"]) } else { "Atleta".into() };
                let Some(lista) = mm["atletas"].as_array_mut() else { return Ok(()) };
                let i = lista.iter().position(|x| x["id"] == aid.as_str());
                if i.is_none() && lista.len() >= MAX_ATLETAS {
                    return mal(400, format!("Un meet admite hasta {MAX_ATLETAS} atletas"));
                }
                let mut notas = vec![];
                match i {
                    None => {
                        lista.push(a.clone());
                        notas.push(format!("{nombre} se unió al meet"));
                    }
                    Some(i) => {
                        notas = cambios_de_resultados(&lista[i], &a);
                        lista[i] = a.clone();
                    }
                }
                for t in notas {
                    anotar(mm, &t);
                }
                Ok(())
            })?;
            app.tiempo.emitir(&id, &json!({"tipo": "atleta", "atleta": a}));
            return Ok(json_resp(200, &a));
        }
        if p.len() == 4 && metodo == Method::DELETE {
            let Some(previo) = m["atletas"].as_array().and_then(|l| l.iter().find(|x| x["id"] == aid.as_str())).cloned() else { return mal(404, "No encuentro ese atleta") };
            ctx.guardar(&id, |mm| {
                if let Some(l) = mm["atletas"].as_array_mut() {
                    l.retain(|x| x["id"] != aid.as_str());
                }
                if let Some(o) = mm["aplausos"].as_object_mut() {
                    o.shift_remove(&aid);
                }
                let nombre = if truthy(&previo["nombre"]) { js_string(&previo["nombre"]) } else { "Atleta".into() };
                anotar(mm, &format!("{nombre} salió del meet"));
                Ok(())
            })?;
            app.tiempo.emitir(&id, &json!({"tipo": "atleta", "atleta": {"id": aid, "eliminado": true}}));
            return Ok(json_resp(200, &json!({"ok": true})));
        }
        return mal(405, "Método no permitido");
    }

    if sub == "resultados.csv" && metodo == Method::GET {
        let mut r = descarga("text/csv; charset=utf-8", &format!("{id}-resultados.csv"), resultados_csv(&m).into_bytes());
        r.headers_mut().remove(header::X_CONTENT_TYPE_OPTIONS);
        return Ok(r);
    }
    if sub == "export.json" && metodo == Method::GET {
        ctx.requiere_org()?;
        let v = app.almacen.exportar(&id).unwrap_or(Value::Null);
        return Ok(descarga("application/json; charset=utf-8", &format!("{id}.json"), v.to_string().into_bytes()));
    }

    if sub == "aplauso" && metodo == Method::POST {
        let b = ctx.cuerpo(1024).await?;
        let aid = b["aid"].as_str().unwrap_or("");
        if !es_id_seguro(aid) || !m["atletas"].as_array().is_some_and(|l| l.iter().any(|a| a["id"] == aid)) {
            return mal(404, "No encuentro ese atleta");
        }
        if !app.aplausos.intentar(&format!("{id_ip}|{id}|{aid}")) {
            return mal(429, "Ya aplaudiste hace un momento. Espera unos segundos.");
        }
        let mut n = 0u64;
        ctx.guardar(&id, |mm| {
            if !mm["aplausos"].is_object() {
                mm["aplausos"] = json!({});
            }
            n = mm["aplausos"][aid].as_u64().unwrap_or(0) + 1;
            mm["aplausos"][aid] = json!(n);
            Ok(())
        })?;
        app.tiempo.emitir(&id, &json!({"tipo": "aplauso", "aid": aid, "n": n}));
        return Ok(json_resp(200, &json!({"ok": true, "n": n})));
    }

    if sub == "canal" && p.len() == 3 {
        if metodo == Method::GET {
            let mut inicial = vec![json!({"tipo": "meet", "meet": con_estado(vista_meet(&m, org), &m)})];
            if let Some(o) = m["vivo"].as_object() {
                for (plataforma, datos) in o {
                    inicial.push(json!({"tipo": "vivo", "plataforma": plataforma, "datos": datos}));
                }
            }
            if let Some(o) = m["regie"].as_object() {
                for (plataforma, datos) in o {
                    inicial.push(json!({"tipo": "regie", "plataforma": plataforma, "datos": datos}));
                }
            }
            let flujo = app.tiempo.conectar(&id, org, &inicial);
            let mut r = Response::new(Body::from_stream(flujo));
            let h = r.headers_mut();
            h.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/event-stream; charset=utf-8"));
            h.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache, no-transform"));
            h.insert(header::CONNECTION, HeaderValue::from_static("keep-alive"));
            h.insert("x-accel-buffering", HeaderValue::from_static("no"));
            return Ok(r);
        }
        if metodo == Method::POST {
            return publicar(ctx, &m).await;
        }
        return mal(405, "Método no permitido");
    }
    mal(404, "Ruta desconocida")
}

async fn publicar(ctx: &mut Ctx, m: &Value) -> R<Response<Body>> {
    let app = ctx.app.clone();
    let b = ctx.cuerpo(LIM_CANAL).await?;
    if !b.is_object() {
        return mal(400, "Mensaje no válido");
    }
    let id = m["id"].as_str().unwrap_or("").to_string();
    let codigo_ok = |c: &Value| c.as_str().is_some_and(|c| !c.is_empty()) && m["privado"]["codigoJuez"].as_str().is_some_and(|j| !j.is_empty() && iguales(c.as_str().unwrap_or(""), j));
    match b["tipo"].as_str().unwrap_or("") {
        "vivo" => {
            ctx.requiere_org()?;
            let plataforma = txt(&b["plataforma"], 40);
            if plataforma.is_empty() || !b["datos"].is_object() {
                return mal(400, "Falta la plataforma o los datos del vivo");
            }
            let previo = &m["vivo"][plataforma.as_str()];
            if truthy(previo) && num_o_cero(&previo["version"]) > num_o_cero(&b["datos"]["version"]) {
                return Ok(json_resp(200, &json!({"ok": true, "ignorado": true})));
            }
            let datos = b["datos"].clone();
            ctx.guardar(&id, |mm| {
                if !truthy(&mm["vivo"]) {
                    mm["vivo"] = json!({});
                }
                mm["vivo"][plataforma.as_str()] = datos.clone();
                Ok(())
            })?;
            app.tiempo.limpiar_votos(&id, &plataforma, b["datos"].get("turno"));
            app.tiempo.emitir(&id, &json!({"tipo": "vivo", "plataforma": plataforma, "datos": b["datos"]}));
            Ok(json_resp(200, &json!({"ok": true})))
        }
        "regie" => {
            ctx.requiere_org()?;
            let plataforma = txt(&b["plataforma"], 40);
            if plataforma.is_empty() || !b["datos"].is_object() {
                return mal(400, "Falta la plataforma o los datos de la regie");
            }
            let datos = limpiar_regie(&b["datos"]);
            ctx.guardar(&id, |mm| {
                if !truthy(&mm["regie"]) {
                    mm["regie"] = json!({});
                }
                mm["regie"][plataforma.as_str()] = datos.clone();
                Ok(())
            })?;
            app.tiempo.emitir(&id, &json!({"tipo": "regie", "plataforma": plataforma, "datos": datos}));
            Ok(json_resp(200, &json!({"ok": true})))
        }
        "limpiar" => {
            ctx.requiere_org()?;
            let plataforma = txt(&b["plataforma"], 40);
            if plataforma.is_empty() {
                return mal(400, "Falta la plataforma");
            }
            app.tiempo.limpiar_votos(&id, &plataforma, None);
            app.tiempo.emitir(&id, &json!({"tipo": "limpiar", "plataforma": plataforma}));
            Ok(json_resp(200, &json!({"ok": true})))
        }
        "voto" => {
            let v = &b["voto"];
            if !v.is_object() || !codigo_ok(&v["codigo"]) {
                return mal(403, "Código de jueces incorrecto");
            }
            if !v["plataforma"].is_string() || !v["pos"].as_str().is_some_and(|x| POS.contains(&x)) || !(v["voto"] == "blanca" || v["voto"] == "roja") {
                return mal(400, "Voto no válido");
            }
            let tarjetas: Vec<Value> = v["tarjetas"].as_array().map(|a| a.iter().filter(|t| ["roja", "azul", "amarilla"].iter().any(|x| *t == x)).take(3).cloned().collect()).unwrap_or_default();
            let via = if truthy(&v["via"]) { js_string(&v["via"]) } else { "local".into() };
            let limpio = json!({
                "plataforma": txt(&v["plataforma"], 40), "pos": v["pos"], "voto": v["voto"], "tarjetas": tarjetas,
                "turno": v["turno"].as_str().map(|t| json!(cortar(t, 80))).unwrap_or(Value::Null),
                "via": txt_s(&via, 20), "dispositivo": txt(&v["dispositivo"], 40), "secreto": txt(&v["secreto"], 80),
                "ts": nv(num(&v["ts"], 0.0, 9e15).unwrap_or(ahora_ms() as f64)),
            });
            let k = format!("{}|{}|{}", limpio["plataforma"].as_str().unwrap_or(""), v["pos"].as_str().unwrap_or(""), limpio["dispositivo"].as_str().unwrap_or(""));
            if app.tiempo.voto_de(&id, &k).is_some_and(|a| a["turno"] == limpio["turno"]) {
                return Ok(json_resp(200, &json!({"ok": true, "repetido": true}))); // el primero cuenta
            }
            app.tiempo.guardar_voto(&id, &k, limpio.clone());
            app.tiempo.emitir(&id, &json!({"tipo": "voto", "voto": limpio}));
            Ok(json_resp(200, &json!({"ok": true})))
        }
        "presencia" => {
            let d = &b["datos"];
            if !d.is_object() || !codigo_ok(&d["codigo"]) {
                return mal(403, "Código de jueces incorrecto");
            }
            if !d["plataforma"].is_string() || !d["pos"].as_str().is_some_and(|x| POS.contains(&x)) {
                return mal(400, "Presencia no válida");
            }
            let via = if truthy(&d["via"]) { js_string(&d["via"]) } else { "local".into() };
            let limpio = json!({
                "plataforma": txt(&d["plataforma"], 40), "pos": d["pos"], "bateria": nv_opt(num(&d["bateria"], 0.0, 100.0)), "via": txt_s(&via, 20),
                "dispositivo": txt(&d["dispositivo"], 40), "nombre": txt(&d["nombre"], 60), "huella": txt(&d["huella"], 80), "ts": ahora_ms(),
            });
            let k = format!("{}|{}|{}", limpio["plataforma"].as_str().unwrap_or(""), d["pos"].as_str().unwrap_or(""), limpio["dispositivo"].as_str().unwrap_or(""));
            app.tiempo.guardar_presencia(&id, &k, limpio.clone());
            let huella = limpio["huella"].as_str().unwrap_or("").to_string();
            if !huella.is_empty() {
                ctx.guardar(&id, |mm| {
                    if !truthy(&mm["privado"]) {
                        mm["privado"] = json!({});
                    }
                    if !truthy(&mm["privado"]["juecesConocidos"]) {
                        mm["privado"]["juecesConocidos"] = json!({});
                    }
                    let c = &mut mm["privado"]["juecesConocidos"];
                    let n = c.as_object().map(|o| o.len()).unwrap_or(0);
                    if truthy(&c[huella.as_str()]) || n < 50 {
                        c[huella.as_str()] = json!({"pos": d["pos"], "nombre": limpio["nombre"], "ts": limpio["ts"]});
                    }
                    Ok(())
                })?;
            }
            app.tiempo.emitir(&id, &json!({"tipo": "presencia", "datos": limpio}));
            Ok(json_resp(200, &json!({"ok": true})))
        }
        _ => mal(400, "Tipo de mensaje desconocido"),
    }
}

/// Entrada de todas las peticiones: la API, o los archivos estáticos.
pub async fn servir(app: Arc<App>, metodo: Method, uri: axum::http::Uri, headers: HeaderMap, ip: IpAddr, body: Body) -> Response<Body> {
    let path = uri.path();
    if path.starts_with("/api/") || path == "/api" {
        return atender(app, metodo, &uri, headers, ip, body).await;
    }
    if metodo != Method::GET && metodo != Method::HEAD {
        return texto_resp(StatusCode::METHOD_NOT_ALLOWED, "Método no permitido");
    }
    app.estatico.servir(&metodo, &headers, path).await
}

#[allow(dead_code)]
fn _tipos(_: Map<String, Value>) {}
