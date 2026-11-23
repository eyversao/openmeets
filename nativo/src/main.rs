//! OpenMeets · servidor local en Rust. Reemplazo del servidor Node (servidor/openmeets.mjs):
//! `openmeets [--puerto 5050] [--datos <carpeta>] [--web <carpeta>] [--sin-navegador]`
#![forbid(unsafe_code)]

mod acceso;
mod almacen;
mod api;
mod calculo;
mod consola;
mod estatico;
mod federacion;
mod inscripciones;
mod js;
mod perfiles;
mod records;
mod records_logica;
mod tiempo;
mod validar;

use axum::extract::{ConnectInfo, Request, State};
use axum::response::Response;
use std::io::Write;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const VERSION: &str = "1.0.0";
const PUERTO: u16 = 5050;

fn home() -> PathBuf {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from).unwrap_or_default()
}
fn base_datos(nombre_win: &str, nombre_otro: &str) -> PathBuf {
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from).unwrap_or_else(|| home().join("AppData").join("Local"));
        local.join(nombre_win).join("datos")
    } else {
        home().join(nombre_otro)
    }
}
fn datos_por_defecto() -> PathBuf {
    base_datos("OpenMeets", ".openmeets")
}
/// Carpeta de datos con el nombre anterior (sin «s»), para migrarla.
fn datos_antiguos() -> PathBuf {
    base_datos("OpenMeet", ".openmeet")
}

fn copiar_dir(a: &Path, b: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(b)?;
    for e in std::fs::read_dir(a)? {
        let e = e?;
        let d = b.join(e.file_name());
        if e.file_type()?.is_dir() { copiar_dir(&e.path(), &d)?; } else { std::fs::copy(e.path(), d)?; }
    }
    Ok(())
}

/// Si la carpeta nueva no existe y la vieja sí: la renombra; si no puede, la copia (la vieja nunca se borra).
fn migrar_datos(nueva: &Path, vieja: &Path) {
    if nueva.exists() || !vieja.exists() {
        return;
    }
    if let Some(p) = nueva.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    if std::fs::rename(vieja, nueva).is_err() {
        let _ = copiar_dir(vieja, nueva);
    }
}

struct Args {
    puerto: Option<u16>,
    puerto_txt: Option<String>,
    datos: PathBuf,
    web: Option<PathBuf>,
    sin_navegador: bool,
    ayuda: bool,
    nube: bool,
}

fn absoluta(p: &str) -> PathBuf {
    std::path::absolute(p).unwrap_or_else(|_| PathBuf::from(p))
}

fn leer_argumentos(argv: &[String]) -> Args {
    let valor = |n: &str| argv.iter().position(|a| a == n).and_then(|i| argv.get(i + 1)).cloned();
    let modo = valor("--modo").or_else(|| std::env::var("OPENMEETS_MODO").ok()).or_else(|| std::env::var("OPENMEET_MODO").ok());
    let puerto_txt = valor("--puerto");
    let puerto = match &puerto_txt {
        Some(t) => { let n = js::js_number_str(t); if n.fract() == 0.0 && (1.0..=65535.0).contains(&n) { Some(n as u16) } else { None } }
        None => Some(PUERTO),
    };
    Args {
        puerto, puerto_txt, nube: modo.as_deref() == Some("nube"),
        datos: valor("--datos").map(|d| absoluta(&d)).unwrap_or_else(datos_por_defecto),
        web: valor("--web").map(|d| absoluta(&d)),
        sin_navegador: argv.iter().any(|a| a == "--sin-navegador"),
        ayuda: argv.iter().any(|a| a == "--ayuda" || a == "-h" || a == "--help"),
    }
}

async fn manejar(State(app): State<Arc<api::App>>, ConnectInfo(addr): ConnectInfo<SocketAddr>, req: Request) -> Response {
    let (partes, body) = req.into_parts();
    api::servir(app, partes.method, partes.uri, partes.headers, addr.ip(), body).await
}

/// ¿Hay ya un OpenMeets en ese puerto? Pregunta a /api/info (acepta también el nombre antiguo).
async fn hay_openmeets(puerto: u16) -> bool {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let r = tokio::time::timeout(std::time::Duration::from_millis(1500), async {
        let mut s = tokio::net::TcpStream::connect(("127.0.0.1", puerto)).await.ok()?;
        s.write_all(format!("GET /api/info HTTP/1.1\r\nHost: 127.0.0.1:{puerto}\r\nConnection: close\r\n\r\n").as_bytes()).await.ok()?;
        let mut t = Vec::new();
        s.read_to_end(&mut t).await.ok()?;
        Some(String::from_utf8_lossy(&t).contains("\"app\":\"OpenMeet"))
    }).await;
    r.ok().flatten().unwrap_or(false)
}

fn abrir_navegador(url: &str, log: &dyn Fn(&str)) {
    use std::process::{Command, Stdio};
    let r = if cfg!(windows) {
        Command::new("cmd").args(["/c", "start", "", url]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    } else {
        Command::new(if cfg!(target_os = "macos") { "open" } else { "xdg-open" }).arg(url).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn()
    };
    match r {
        Ok(_) => log(&format!("navegador abierto: {url}")),
        Err(e) => println!("  No pude abrir el navegador ({e}). Abre {url} a mano."),
    }
}

async fn esperar_cierre() {
    #[cfg(windows)]
    {
        use tokio::signal::windows::{ctrl_break, ctrl_close, ctrl_shutdown};
        if let (Ok(mut a), Ok(mut b), Ok(mut c)) = (ctrl_break(), ctrl_close(), ctrl_shutdown()) {
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = a.recv() => {}, _ = b.recv() => {}, _ = c.recv() => {} }
            return;
        }
    }
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut t) = signal(SignalKind::terminate()) {
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = t.recv() => {} }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

#[tokio::main]
async fn main() {
    let _ = enable_ansi_support::enable_ansi_support();
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let a = leer_argumentos(&argv);
    if a.ayuda {
        println!("\n  OpenMeets · uso: openmeets [--puerto 5050] [--datos <carpeta>] [--web <carpeta>] [--sin-navegador]\n");
        return;
    }
    let Some(puerto) = a.puerto else {
        eprintln!("{}", consola::aviso("El puerto debe ser un número entre 1 y 65535.", consola::modo_stderr()));
        std::process::exit(1);
    };
    let _ = a.puerto_txt;
    if a.nube {
        eprintln!("{}", consola::aviso("El modo nube ya no existe en este servidor: la nube ahora es Firestore desde el navegador.", consola::modo_stderr()));
        std::process::exit(1);
    }
    if a.datos == datos_por_defecto() {
        migrar_datos(&a.datos, &datos_antiguos());
    }
    let _ = std::fs::create_dir_all(&a.datos);
    let archivo_log = a.datos.join("openmeets.log");
    if std::fs::metadata(&archivo_log).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let mut o = archivo_log.as_os_str().to_owned();
        o.push(".1");
        let _ = std::fs::rename(&archivo_log, PathBuf::from(o));
    }
    // El registro se acumula y se escribe de una vez (abrir el archivo por cada línea tarda ~1 s en Windows con antivirus).
    let pendiente = std::cell::RefCell::new(String::new());
    let log = |t: &str| pendiente.borrow_mut().push_str(&format!("{} {t}
", chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ")));
    let volcar = || {
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&archivo_log) {
            let _ = f.write_all(pendiente.borrow().as_bytes());
        }
        pendiente.borrow_mut().clear();
    };
    let dec = |t: &str| {
        println!("{t}");
        log(consola::sin_color(t).trim());
    };
    let av = |t: &str| consola::aviso(t, consola::modo_stdout());
    let local = format!("http://localhost:{puerto}/");

    // Se intenta escuchar primero: conectar a un puerto cerrado tarda ~1,5 s en Windows. Si está ocupado, se mira si es OpenMeets.
    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", puerto)).await {
        Ok(l) => l,
        Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
            if hay_openmeets(puerto).await {
                dec(&av(&format!("OpenMeets ya está abierto en este equipo (puerto {puerto}). Abro el navegador.")));
                if !a.sin_navegador {
                    abrir_navegador(&local, &log);
                }
                volcar();
                tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                return;
            }
            dec(&av(&format!("El puerto {puerto} lo usa otro programa que no es OpenMeets. Ciérralo o usa otro: --puerto {}", puerto as u32 + 1)));
            volcar();
            std::process::exit(1);
        }
        Err(e) => {
            dec(&av(&format!("No pude arrancar: {e}")));
            volcar();
            std::process::exit(1);
        }
    };
    let espera = std::env::var("OPENMEETS_ESPERA_MS").ok().and_then(|v| v.parse().ok()).unwrap_or(300);
    let app = match api::App::nuevo(a.datos.clone(), a.web.clone(), espera, VERSION) {
        Ok(x) => x,
        Err(e) => {
            dec(&av(&format!("No pude arrancar: {e}")));
            volcar();
            std::process::exit(1);
        }
    };
    let puerto = listener.local_addr().map(|x| x.port()).unwrap_or(puerto);
    app.puerto.store(puerto, std::sync::atomic::Ordering::Relaxed);
    app.tiempo.latido();
    let router = axum::Router::new().fallback(manejar).with_state(app.clone());
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, router.into_make_service_with_connect_info::<SocketAddr>()).await {
            eprintln!("Error del servidor: {e}");
        }
    });

    let ips = acceso::ips_lan();
    let modo = consola::modo_stdout();
    let url_lan = ips.first().map(|ip| format!("http://{ip}:{puerto}/")).unwrap_or_else(|| local.clone());
    if modo.color && std::io::IsTerminal::is_terminal(&std::io::stdout()) {
        print!("\x1b]0;{}\x07\x1b[8;46;100t", consola::titulo_ventana(&url_lan)); // título OSC y ventana de 100×46
    }
    let pin = app.acceso.pin();
    let (datos_s, log_s) = (a.datos.to_string_lossy().to_string(), archivo_log.to_string_lossy().to_string());
    let d = consola::DatosConsola { version: VERSION, local: &local, ips: &ips, puerto, pin: &pin, datos: &datos_s, registro: &log_s };
    println!("{}", consola::lineas_consola(&d, modo).join("\n"));
    for l in consola::lineas_consola(&d, consola::Modo { color: false, truecolor: modo.truecolor }) {
        if !l.trim().is_empty() && !l.contains(['▀', '▄', '█']) {
            log(l.trim());
        }
    }
    if !a.sin_navegador { abrir_navegador(&local, &log); } else { log("navegador omitido (--sin-navegador)"); }
    volcar();
    esperar_cierre().await;
    log("cerrando");
    volcar();
    app.tiempo.cerrar();
    app.almacen.vaciar();
}
