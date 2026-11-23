#![cfg_attr(not(test), windows_subsystem = "windows")]
//! OpenMeets-Setup.exe: frameless rounded WebView2 installer (see README.md for the UI contract).
mod instalar;
mod sistema;

use instalar::{Entorno, Opciones};
use std::{os::windows::process::CommandExt, path::PathBuf, process::Command, sync::Arc, time::Duration};
use tao::{
    dpi::{LogicalSize, PhysicalPosition},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    platform::windows::WindowExtWindows,
    window::WindowBuilder,
};
use wry::{http::Response, PageLoadEvent, WebViewBuilder};

include!(concat!(env!("OUT_DIR"), "/ui.rs"));

const NO_WINDOW: u32 = 0x0800_0000;
const WEBVIEW2: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

enum Ev {
    Js(String),
    Salir,
}

fn mime(p: &str) -> &'static str {
    match p.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

fn js(f: &str, args: &[serde_json::Value]) -> String {
    let a: Vec<String> = args.iter().map(|v| v.to_string()).collect();
    format!("window.instalador && window.instalador.{f}({})", a.join(","))
}

struct Args {
    silencioso: bool,
    desinstalar: bool,
    carpeta: Option<PathBuf>,
    sin_escritorio: bool,
    borrar_datos: bool,
}

fn args() -> Args {
    let v: Vec<String> = std::env::args().skip(1).collect();
    let tiene = |n: &[&str]| v.iter().any(|a| n.iter().any(|x| a.eq_ignore_ascii_case(x)));
    let exe = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    Args {
        silencioso: tiene(&["/S", "--silencioso"]),
        desinstalar: tiene(&["--desinstalar"]) || exe.is_some_and(|n| n.starts_with("desinstalar")),
        carpeta: v.iter().position(|a| a == "--carpeta").and_then(|i| v.get(i + 1)).map(PathBuf::from),
        sin_escritorio: tiene(&["--sin-escritorio"]),
        borrar_datos: tiene(&["--borrar-datos"]),
    }
}

fn lanzar_app(carpeta: &std::path::Path) {
    let _ = Command::new(carpeta.join(instalar::EXE)).current_dir(carpeta).spawn();
}

/// The uninstaller cannot delete itself while running: relaunch a copy from %TEMP% and let it do the work.
fn relanzar_desde_temp(carpeta: &std::path::Path, silencioso: bool, borrar: bool) -> ! {
    let tmp = std::env::temp_dir().join(format!("OpenMeets-uninstall-{}.exe", std::process::id()));
    let ok = std::fs::copy(std::env::current_exe().unwrap(), &tmp).is_ok();
    let mut c = Command::new(&tmp);
    c.arg("--desinstalar").arg("--carpeta").arg(carpeta);
    if silencioso {
        c.arg("/S");
    }
    if borrar {
        c.arg("--borrar-datos");
    }
    let code = match (ok, c.spawn()) {
        (true, Ok(mut h)) if silencioso => {
            let c = h.wait().ok().and_then(|s| s.code()).unwrap_or(1);
            // We are the installed uninstaller, still running: let a detached cmd remove us and the folder.
            if c == 0 {
                borrar_luego(&[std::env::current_exe().unwrap()], Some(carpeta));
            }
            c
        }
        (true, Ok(_)) => 0,
        _ => 1,
    };
    std::process::exit(code)
}

/// Deletes files (and then the folder, if empty) after this process exits: Windows cannot delete a running exe.
fn borrar_luego(archivos: &[PathBuf], carpeta: Option<&std::path::Path>) {
    let mut cmd = String::from("/C ping -n 3 127.0.0.1 >nul");
    for f in archivos {
        cmd += &format!(" & del /f /q \"{}\"", f.display());
    }
    if let Some(c) = carpeta {
        cmd += &format!(" & rmdir \"{}\"", c.display());
    }
    let _ = Command::new("cmd").raw_arg(cmd).creation_flags(NO_WINDOW).spawn();
}

/// The temp copy of the uninstaller removes itself.
fn borrar_copia_temporal() {
    if let Ok(exe) = std::env::current_exe() {
        if exe.starts_with(std::env::temp_dir()) {
            borrar_luego(&[exe], None);
        }
    }
}

fn main() {
    let a = args();
    let locale = sistema::idioma();
    let es = locale.to_lowercase().starts_with("es");
    let env = Entorno::real();

    // Uninstall: resolve the folder and move out of it before doing anything.
    let carpeta_desinst = a.desinstalar.then(|| {
        a.carpeta.clone().unwrap_or_else(|| {
            let c = instalar::carpeta_registrada(&env.clave)
                .or_else(|| std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.to_path_buf())))
                .unwrap_or_else(instalar::carpeta_por_defecto);
            relanzar_desde_temp(&c, a.silencioso, a.borrar_datos)
        })
    });

    if a.silencioso {
        let r = match &carpeta_desinst {
            Some(c) => instalar::desinstalar(c, &env, es, a.borrar_datos, &|_, _| {}),
            None => instalar::instalar(
                &Opciones { carpeta: a.carpeta.unwrap_or_else(instalar::carpeta_por_defecto), escritorio: !a.sin_escritorio, inicio: true },
                &env,
                es,
                &|_, _| {},
            ),
        };
        if carpeta_desinst.is_some() {
            borrar_copia_temporal();
        }
        std::process::exit(if r.is_ok() { 0 } else { 1 });
    }

    if wry::webview_version().is_err() {
        let m = if es {
            "OpenMeets necesita Microsoft WebView2 Runtime para mostrar el instalador. ¿Abrir la página de descarga?"
        } else {
            "OpenMeets needs the Microsoft WebView2 Runtime to show the installer. Open the download page?"
        };
        let r = rfd::MessageDialog::new().set_title("OpenMeets").set_description(m).set_buttons(rfd::MessageButtons::YesNo).show();
        if r == rfd::MessageDialogResult::Yes {
            let _ = Command::new("cmd").args(["/C", "start", "", WEBVIEW2]).creation_flags(NO_WINDOW).spawn();
        }
        return;
    }

    let modo = if carpeta_desinst.is_some() { "desinstalar" } else { "instalar" };
    let carpeta_def = carpeta_desinst.clone().unwrap_or_else(instalar::carpeta_por_defecto);
    let datos = js(
        "datos",
        &[serde_json::json!({
            "version": instalar::VERSION,
            "carpetaPorDefecto": carpeta_def.to_string_lossy(),
            "idioma": locale,
            "modo": modo,
        })],
    );

    let event_loop = EventLoopBuilder::<Ev>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let (w, h) = (760.0, 480.0);
    let window = WindowBuilder::new()
        .with_title("OpenMeets")
        .with_decorations(false)
        .with_transparent(true)
        .with_resizable(false)
        .with_maximizable(false)
        .with_inner_size(LogicalSize::new(w, h))
        .build(&event_loop)
        .expect("window");
    if let Some(m) = window.current_monitor() {
        let (s, p, sz) = (window.scale_factor(), m.position(), m.size());
        let (ww, wh) = ((w * s) as i32, (h * s) as i32);
        window.set_outer_position(PhysicalPosition::new(p.x + (sz.width as i32 - ww) / 2, p.y + (sz.height as i32 - wh) / 2));
    }
    sistema::redondear(window.hwnd());

    let ipc_proxy = proxy.clone();
    let load_proxy = proxy.clone();
    let win = Arc::new(window);
    let win_ipc = win.clone();
    let estado = Arc::new(std::sync::Mutex::new(carpeta_def.clone()));

    let webview = WebViewBuilder::new()
        .with_transparent(true)
        .with_custom_protocol("om".into(), |_id, req| {
            let mut p = req.uri().path().trim_start_matches('/');
            if p.is_empty() {
                p = "index.html";
            }
            match UI.iter().find(|(n, _)| *n == p) {
                Some((_, b)) => Response::builder().header("Content-Type", mime(p)).body(std::borrow::Cow::Borrowed(*b)).unwrap(),
                None => Response::builder().status(404).body(std::borrow::Cow::Borrowed(&b""[..])).unwrap(),
            }
        })
        .with_url("http://om.localhost/index.html")
        .with_on_page_load_handler(move |ev, _| {
            if matches!(ev, PageLoadEvent::Finished) {
                let _ = load_proxy.send_event(Ev::Js(datos.clone()));
            }
        })
        .with_ipc_handler(move |req| {
            let m: serde_json::Value = serde_json::from_str(req.body()).unwrap_or_default();
            accion(&m, &win_ipc, &ipc_proxy, &estado, es, modo == "desinstalar");
        })
        .build(&*win)
        .expect("webview");

    event_loop.run(move |ev, _, cf| {
        *cf = ControlFlow::Wait;
        match ev {
            Event::UserEvent(Ev::Js(s)) => {
                let _ = webview.evaluate_script(&s);
            }
            Event::UserEvent(Ev::Salir) | Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => {
                if modo == "desinstalar" {
                    borrar_copia_temporal();
                }
                *cf = ControlFlow::Exit;
            }
            _ => {}
        }
    });
}

fn accion(m: &serde_json::Value, win: &tao::window::Window, proxy: &EventLoopProxy<Ev>, estado: &Arc<std::sync::Mutex<PathBuf>>, es: bool, desinst: bool) {
    let b = |k: &str| m[k].as_bool().unwrap_or(false);
    match m["accion"].as_str().unwrap_or("") {
        "cerrar" => {
            let _ = proxy.send_event(Ev::Salir);
        }
        "minimizar" => win.set_minimized(true),
        "arrastrar" => {
            let _ = win.drag_window();
        }
        "elegirCarpeta" => {
            let mut d = rfd::FileDialog::new().set_title(if es { "Carpeta de instalación" } else { "Install folder" });
            if let Some(c) = estado.lock().unwrap().parent().filter(|p| p.exists()) {
                d = d.set_directory(c);
            }
            if let Some(p) = d.pick_folder() {
                // Picking "C:\Foo" installs into "C:\Foo\OpenMeets" unless it already ends with it.
                let p = if p.file_name().is_some_and(|n| n.eq_ignore_ascii_case("OpenMeets")) { p } else { p.join("OpenMeets") };
                *estado.lock().unwrap() = p.clone();
                let _ = proxy.send_event(Ev::Js(js("carpeta", &[p.to_string_lossy().into()])));
            }
        }
        "abrirApp" => {
            lanzar_app(&estado.lock().unwrap());
            let _ = proxy.send_event(Ev::Salir);
        }
        a @ ("instalar" | "desinstalar") => {
            let inst = a == "instalar";
            let proxy = proxy.clone();
            let env = Entorno::real();
            let carpeta = if inst && !desinst { m["carpeta"].as_str().map(PathBuf::from).unwrap_or_default() } else { estado.lock().unwrap().clone() };
            *estado.lock().unwrap() = carpeta.clone();
            let (escritorio, inicio, abrir, borrar) = (b("escritorio"), b("inicio"), b("abrir"), b("borrarDatos"));
            std::thread::spawn(move || {
                let send = |s: String| {
                    let _ = proxy.send_event(Ev::Js(s));
                };
                let prog = |p: u8, t: &str| send(js("progreso", &[p.into(), t.into()]));
                let r = if inst {
                    instalar::instalar(&Opciones { carpeta: carpeta.clone(), escritorio, inicio }, &env, es, &prog)
                } else {
                    instalar::desinstalar(&carpeta, &env, es, borrar, &prog)
                };
                match r {
                    Err(e) => send(js("error", &[e.into()])),
                    Ok(()) => {
                        send(js("listo", &[]));
                        if inst && abrir {
                            lanzar_app(&carpeta);
                            std::thread::sleep(Duration::from_millis(1500));
                            let _ = proxy.send_event(Ev::Salir);
                        }
                    }
                }
            });
        }
        _ => {}
    }
}
