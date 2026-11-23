//! Archivos de web/: embebidos en el binario o, con `--web <carpeta>`, leídos del disco.
//! Rutas sin extensión caen en index.html. Mismas cabeceras, MIME y ETag que estatico.mjs; gzip para texto.
use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, Method, Response, StatusCode, header};
use bytes::Bytes;
use rust_embed::RustEmbed;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(RustEmbed)]
#[folder = "../web/"]
struct Web;

pub fn mime(ext: &str) -> &'static str {
    match ext {
        ".html" => "text/html; charset=utf-8",
        ".js" | ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json; charset=utf-8",
        ".webmanifest" => "application/manifest+json",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" | ".jpeg" => "image/jpeg",
        ".webp" => "image/webp",
        ".ico" => "image/x-icon",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        ".mp3" => "audio/mpeg",
        ".ogg" => "audio/ogg",
        ".wav" => "audio/wav",
        ".mp4" => "video/mp4",
        ".txt" => "text/plain; charset=utf-8",
        ".csv" => "text/csv; charset=utf-8",
        ".map" => "application/json",
        _ => "application/octet-stream",
    }
}

/// Extensión con punto y en minúscula («.js»), o '' si no hay (como `path.extname`).
pub fn extname(nombre: &str) -> String {
    let base = nombre.rsplit(['/', '\\']).next().unwrap_or("");
    match base.rfind('.') {
        Some(i) if i > 0 => base[i..].to_ascii_lowercase(),
        _ => String::new(),
    }
}

fn decodificar(ruta: &str) -> Option<String> {
    let b = ruta.as_bytes();
    let mut o = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let h = ruta.get(i + 1..i + 3)?;
            o.push(u8::from_str_radix(h, 16).ok()?);
            i += 3;
        } else {
            o.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(o).ok()
}

/// Ruta absoluta dentro de `raiz` o None si intenta salirse (../, bytes nulos, codificación rota).
pub fn resolver_ruta(raiz: &Path, ruta: &str) -> Option<PathBuf> {
    let rel = decodificar(ruta)?;
    if rel.contains('\0') || rel.split(['/', '\\']).any(|s| s == "..") {
        return None;
    }
    let mut p = raiz.to_path_buf();
    for s in rel.split(['/', '\\']).filter(|s| !s.is_empty() && *s != ".") {
        if s.contains(':') {
            return None; // «C:» o flujos alternos de NTFS
        }
        p.push(s);
    }
    Some(p)
}

fn texto(n: StatusCode, t: &str) -> Response<Body> {
    let mut r = Response::new(Body::from(t.to_string()));
    *r.status_mut() = n;
    r.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"));
    r
}

pub struct Estatico {
    disco: Option<PathBuf>,
    gz: Mutex<HashMap<String, Bytes>>,
}

fn comprimible(ct: &str) -> bool {
    ct.starts_with("text/") || ct.contains("javascript") || ct.contains("json") || ct.contains("svg") || ct.contains("manifest")
}

impl Estatico {
    pub fn nuevo(disco: Option<PathBuf>) -> Estatico {
        Estatico { disco, gz: Mutex::new(HashMap::new()) }
    }

    fn enviar(&self, metodo: &Method, h: &HeaderMap, nombre: &str, datos: Bytes, es_index: bool, etag: &str) -> Response<Body> {
        let ext = extname(nombre);
        let ct = mime(&ext);
        let sin_cache = es_index || ext == ".html" || nombre == "sw.js" || nombre.ends_with("/sw.js") || nombre.ends_with("\\sw.js");
        let mut r = Response::new(Body::empty());
        let cab = r.headers_mut();
        cab.insert(header::CONTENT_TYPE, HeaderValue::from_static(ct));
        cab.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
        cab.insert(header::CACHE_CONTROL, HeaderValue::from_static(if sin_cache { "no-store" } else { "no-cache" }));
        if let Ok(v) = HeaderValue::from_str(etag) {
            cab.insert(header::ETAG, v);
        }
        if !sin_cache && h.get(header::IF_NONE_MATCH).and_then(|v| v.to_str().ok()) == Some(etag) {
            *r.status_mut() = StatusCode::NOT_MODIFIED;
            return r;
        }
        let acepta_gzip = h.get(header::ACCEPT_ENCODING).and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("gzip"));
        let mut cuerpo = datos;
        if acepta_gzip && comprimible(ct) && cuerpo.len() > 860 {
            let clave = format!("{nombre}|{etag}");
            let en_cache = self.gz.lock().unwrap_or_else(|e| e.into_inner()).get(&clave).cloned();
            let gz = match en_cache {
                Some(b) => Some(b),
                None => {
                    let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
                    let comprimido = e.write_all(&cuerpo).and_then(|_| e.finish()).ok().map(Bytes::from);
                    if let Some(b) = &comprimido {
                        self.gz.lock().unwrap_or_else(|e| e.into_inner()).insert(clave, b.clone());
                    }
                    comprimido
                }
            };
            if let Some(b) = gz.filter(|b| b.len() < cuerpo.len()) {
                cuerpo = b;
                r.headers_mut().insert(header::CONTENT_ENCODING, HeaderValue::from_static("gzip"));
            }
            r.headers_mut().insert(header::VARY, HeaderValue::from_static("Accept-Encoding"));
        }
        r.headers_mut().insert(header::CONTENT_LENGTH, HeaderValue::from(cuerpo.len()));
        *r.status_mut() = StatusCode::OK;
        if *metodo != Method::HEAD {
            *r.body_mut() = Body::from(cuerpo);
        }
        r
    }

    fn leer_embebido(nombre: &str) -> Option<(Bytes, String)> {
        let f = Web::get(nombre)?;
        let etag = format!("\"{}\"", f.metadata.sha256_hash().iter().take(8).map(|b| format!("{b:02x}")).collect::<String>());
        Some((Bytes::from(f.data.into_owned()), etag))
    }

    pub async fn servir(&self, metodo: &Method, h: &HeaderMap, pathname: &str) -> Response<Body> {
        match &self.disco {
            None => {
                let Some(rel) = decodificar(pathname).map(|r| r.trim_start_matches('/').to_string()) else { return texto(StatusCode::BAD_REQUEST, "Petición no válida") };
                if rel.contains('\0') || rel.split(['/', '\\']).any(|s| s == "..") {
                    return texto(StatusCode::FORBIDDEN, "Prohibido");
                }
                let nombre = if rel.is_empty() || rel.ends_with('/') { format!("{rel}index.html") } else { rel.clone() };
                let mut hallado = Self::leer_embebido(&nombre);
                let mut es_index = false;
                let mut nombre = nombre;
                if hallado.is_none() {
                    let e = extname(&rel);
                    if !e.is_empty() && e != ".html" {
                        return texto(StatusCode::NOT_FOUND, "No existe");
                    }
                    nombre = "index.html".into();
                    es_index = true;
                    hallado = Self::leer_embebido(&nombre);
                }
                match hallado {
                    Some((d, etag)) => self.enviar(metodo, h, &nombre, d, es_index, &etag),
                    None => texto(StatusCode::NOT_FOUND, "No existe"),
                }
            }
            Some(raiz) => {
                let Some(archivo0) = resolver_ruta(raiz, pathname) else { return texto(StatusCode::FORBIDDEN, "Prohibido") };
                let mut archivo = archivo0;
                let mut es_index = false;
                let mut meta = tokio::fs::metadata(&archivo).await.ok();
                if meta.as_ref().is_some_and(|m| m.is_dir()) {
                    archivo.push("index.html");
                    meta = tokio::fs::metadata(&archivo).await.ok();
                }
                if !meta.as_ref().is_some_and(|m| m.is_file()) {
                    let e = extname(pathname);
                    if !e.is_empty() && e != ".html" {
                        return texto(StatusCode::NOT_FOUND, "No existe");
                    }
                    archivo = raiz.join("index.html");
                    es_index = true;
                    meta = tokio::fs::metadata(&archivo).await.ok();
                    if meta.is_none() {
                        return texto(StatusCode::NOT_FOUND, "Falta web/index.html");
                    }
                }
                let Some(meta) = meta else { return texto(StatusCode::NOT_FOUND, "No existe") };
                match tokio::fs::read(&archivo).await {
                    Ok(d) => {
                        let ms = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
                        let etag = format!("W/\"{}-{}\"", meta.len(), ms);
                        self.enviar(metodo, h, &archivo.to_string_lossy(), Bytes::from(d), es_index, &etag)
                    }
                    Err(_) => texto(StatusCode::NOT_FOUND, "No existe"),
                }
            }
        }
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn rutas_seguras() {
        let raiz = Path::new("web");
        assert!(resolver_ruta(raiz, "/js/app.js").is_some());
        assert!(resolver_ruta(raiz, "/../secreto").is_none());
        assert!(resolver_ruta(raiz, "/%2e%2e/secreto").is_none());
        assert!(resolver_ruta(raiz, "/a%00b").is_none());
        assert!(resolver_ruta(raiz, "/%zz").is_none());
        assert!(resolver_ruta(raiz, "/C:/Windows/win.ini").is_none());
        assert!(resolver_ruta(raiz, "\\..\\x").is_none());
    }

    #[tokio::test]
    async fn embebido_con_cache() {
        let e = Estatico::nuevo(None);
        let h = HeaderMap::new();
        let r = e.servir(&Method::GET, &h, "/").await;
        assert_eq!(r.status(), 200);
        assert_eq!(r.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(r.headers()[header::CONTENT_TYPE], "text/html; charset=utf-8");
        let r = e.servir(&Method::GET, &h, "/una/ruta/sin/extension").await;
        assert_eq!(r.status(), 200, "las rutas sin extensión caen en index.html");
        assert_eq!(e.servir(&Method::GET, &h, "/no-existe.js").await.status(), 404);
        let r = e.servir(&Method::GET, &h, "/manifest.webmanifest").await;
        let etag = r.headers()[header::ETAG].clone();
        let mut h2 = HeaderMap::new();
        h2.insert(header::IF_NONE_MATCH, etag);
        assert_eq!(e.servir(&Method::GET, &h2, "/manifest.webmanifest").await.status(), 304);
        let mut h3 = HeaderMap::new();
        h3.insert(header::ACCEPT_ENCODING, HeaderValue::from_static("gzip"));
        let r = e.servir(&Method::GET, &h3, "/js/app.js").await;
        assert_eq!(r.headers()[header::CONTENT_ENCODING], "gzip");
        assert_eq!(e.servir(&Method::HEAD, &h, "/js/app.js").await.status(), 200);
    }

    #[test]
    fn extensiones() {
        assert_eq!(extname("a/b.JS"), ".js");
        assert_eq!(extname("a/b"), "");
        assert_eq!(extname(".gitignore"), "");
        assert_eq!(extname("x."), ".");
    }
}
