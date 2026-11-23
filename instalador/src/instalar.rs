//! Install / uninstall logic, with no UI dependency.
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}};
use winreg::{enums::*, RegKey};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const EXE: &str = "openmeets.exe";
pub const ICO: &str = "openmeets.ico";
pub const DESINSTALADOR: &str = "Desinstalar OpenMeets.exe";
pub const LNK: &str = "OpenMeets.lnk";
const CLAVE: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\OpenMeets";

static PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.zst"));
static ICONO: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/openmeets.ico"));

/// Where shortcuts and the registry entry go; overridable (env vars) so tests never touch the real ones.
#[derive(Clone)]
pub struct Entorno {
    pub inicio: PathBuf,
    pub escritorio: PathBuf,
    pub clave: String,
    /// User data folder; only removed when the user explicitly asks.
    pub datos: PathBuf,
}

impl Entorno {
    pub fn real() -> Self {
        let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
        Entorno {
            inicio: var("OPENMEETS_TEST_INICIO").unwrap_or_else(|| {
                PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join(r"Microsoft\Windows\Start Menu\Programs")
            }),
            escritorio: var("OPENMEETS_TEST_ESCRITORIO").unwrap_or_else(crate::sistema::escritorio),
            clave: std::env::var("OPENMEETS_TEST_CLAVE").unwrap_or_else(|_| CLAVE.into()),
            datos: var("OPENMEETS_TEST_DATOS")
                .unwrap_or_else(|| PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join(r"OpenMeets\datos")),
        }
    }
}

pub struct Opciones {
    pub carpeta: PathBuf,
    pub escritorio: bool,
    pub inicio: bool,
}

pub fn carpeta_por_defecto() -> PathBuf {
    PathBuf::from(std::env::var("LOCALAPPDATA").unwrap_or_default()).join(r"Programs\OpenMeets")
}

fn texto(es: bool, a: &str, b: &str) -> String {
    (if es { a } else { b }).into()
}

fn abierto(exe: &Path) -> bool {
    // A running exe cannot be opened for writing: that is how we detect OpenMeets is open.
    exe.exists() && fs::OpenOptions::new().write(true).open(exe).is_err()
}

pub fn instalar(o: &Opciones, env: &Entorno, es: bool, prog: &dyn Fn(u8, &str)) -> Result<(), String> {
    let e = |c: &str, x: std::io::Error| format!("{c}: {x}");
    let exe = o.carpeta.join(EXE);
    if abierto(&exe) {
        return Err(texto(es, "OpenMeets está abierto. Ciérralo y vuelve a intentarlo.", "OpenMeets is running. Close it and try again."));
    }
    prog(2, &texto(es, "Preparando la carpeta", "Preparing the folder"));
    fs::create_dir_all(&o.carpeta).map_err(|x| e(&o.carpeta.to_string_lossy(), x))?;

    // Streamed decompression so the percentage is real.
    let total = u64::from_le_bytes(PAYLOAD[..8].try_into().unwrap()).max(1);
    let mut dec = zstd::stream::read::Decoder::new(&PAYLOAD[8..]).map_err(|x| e("zstd", x))?;
    let mut out = fs::File::create(&exe).map_err(|x| e(EXE, x))?;
    let (mut buf, mut hecho) = (vec![0u8; 64 * 1024], 0u64);
    loop {
        let n = dec.read(&mut buf).map_err(|x| e("zstd", x))?;
        if n == 0 {
            break;
        }
        out.write_all(&buf[..n]).map_err(|x| e(EXE, x))?;
        hecho += n as u64;
        prog(5 + (hecho * 70 / total) as u8, &texto(es, "Copiando OpenMeets", "Copying OpenMeets"));
    }
    drop(out);

    prog(78, &texto(es, "Guardando el desinstalador", "Saving the uninstaller"));
    fs::write(o.carpeta.join(ICO), ICONO).map_err(|x| e(ICO, x))?;
    let desinst = o.carpeta.join(DESINSTALADOR);
    let yo = std::env::current_exe().map_err(|x| e("current_exe", x))?;
    if yo != desinst {
        fs::copy(&yo, &desinst).map_err(|x| e(DESINSTALADOR, x))?;
    }

    prog(85, &texto(es, "Creando accesos directos", "Creating shortcuts"));
    let mut destinos = vec![];
    if o.inicio {
        destinos.push(&env.inicio);
    }
    if o.escritorio {
        destinos.push(&env.escritorio);
    }
    for d in destinos {
        fs::create_dir_all(d).map_err(|x| e("shortcut folder", x))?;
        acceso(&exe, &o.carpeta.join(ICO), &d.join(LNK))?;
    }

    prog(95, &texto(es, "Registrando en Windows", "Registering with Windows"));
    registrar(&env.clave, &o.carpeta)?;
    prog(100, &texto(es, "Listo", "Done"));
    Ok(())
}

fn acceso(exe: &Path, ico: &Path, lnk: &Path) -> Result<(), String> {
    let mut l = mslnk::ShellLink::new(exe).map_err(|x| format!("lnk: {x}"))?;
    l.set_icon_location(Some(ico.to_string_lossy().into()));
    l.set_working_dir(exe.parent().map(|p| p.to_string_lossy().into()));
    l.set_name(Some("OpenMeets".into()));
    l.create_lnk(lnk).map_err(|x| format!("lnk: {x}"))
}

pub fn registrar(clave: &str, carpeta: &Path) -> Result<(), String> {
    let (k, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(clave).map_err(|x| format!("registry: {x}"))?;
    let un = carpeta.join(DESINSTALADOR).to_string_lossy().to_string();
    let kb = fs::read_dir(carpeta).map(|d| d.flatten().filter_map(|f| f.metadata().ok()).map(|m| m.len()).sum::<u64>() / 1024).unwrap_or(0);
    let r = (|| {
        k.set_value("DisplayName", &"OpenMeets")?;
        k.set_value("DisplayVersion", &VERSION)?;
        k.set_value("Publisher", &"Eyver Gomez")?;
        k.set_value("DisplayIcon", &carpeta.join(ICO).to_string_lossy().to_string())?;
        k.set_value("InstallLocation", &carpeta.to_string_lossy().to_string())?;
        k.set_value("UninstallString", &format!("\"{un}\" --desinstalar"))?;
        k.set_value("QuietUninstallString", &format!("\"{un}\" --desinstalar /S"))?;
        k.set_value("URLInfoAbout", &"https://github.com/eyversao/openmeets")?;
        k.set_value("EstimatedSize", &(kb as u32))?;
        k.set_value("NoModify", &1u32)?;
        k.set_value("NoRepair", &1u32)
    })();
    r.map_err(|x| format!("registry: {x}"))
}

/// Install folder recorded in the registry.
pub fn carpeta_registrada(clave: &str) -> Option<PathBuf> {
    let k = RegKey::predef(HKEY_CURRENT_USER).open_subkey(clave).ok()?;
    k.get_value::<String, _>("InstallLocation").ok().map(PathBuf::from)
}

/// Removes our files, shortcuts and registry entry. Never touches the user's data folder.
pub fn desinstalar(carpeta: &Path, env: &Entorno, es: bool, borrar_datos: bool, prog: &dyn Fn(u8, &str)) -> Result<(), String> {
    prog(10, &texto(es, "Comprobando OpenMeets", "Checking OpenMeets"));
    if abierto(&carpeta.join(EXE)) {
        return Err(texto(es, "OpenMeets está abierto. Ciérralo y vuelve a intentarlo.", "OpenMeets is running. Close it and try again."));
    }
    prog(30, &texto(es, "Quitando accesos directos", "Removing shortcuts"));
    for d in [&env.inicio, &env.escritorio] {
        let _ = fs::remove_file(d.join(LNK));
    }
    prog(55, &texto(es, "Borrando archivos", "Deleting files"));
    for f in [EXE, ICO] {
        let p = carpeta.join(f);
        if p.exists() {
            fs::remove_file(&p).map_err(|x| format!("{f}: {x}"))?;
        }
    }
    // The installed uninstaller may still be exiting (it relaunched us from %TEMP%): retry briefly.
    let u = carpeta.join(DESINSTALADOR);
    for _ in 0..25 {
        if !u.exists() || fs::remove_file(&u).is_ok() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    let _ = fs::remove_dir(carpeta); // only succeeds if empty: user files stay
    prog(85, &texto(es, "Quitando el registro", "Removing registry entry"));
    match RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(&env.clave) {
        Ok(()) => {}
        Err(x) if x.kind() == std::io::ErrorKind::NotFound => {}
        Err(x) => return Err(format!("registry: {x}")),
    }
    if borrar_datos && env.datos.file_name().is_some_and(|n| n == "datos") && env.datos.is_dir() {
        prog(92, &texto(es, "Borrando tus datos", "Deleting your data"));
        fs::remove_dir_all(&env.datos).map_err(|x| format!("datos: {x}"))?;
    }
    prog(100, &texto(es, "Listo", "Done"));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(n: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("om-test-{n}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn ruta_por_defecto_en_localappdata() {
        assert!(carpeta_por_defecto().ends_with(r"Programs\OpenMeets"));
    }

    #[test]
    fn extrae_el_payload_completo() {
        let total = u64::from_le_bytes(PAYLOAD[..8].try_into().unwrap()) as usize;
        let raw = zstd::decode_all(&PAYLOAD[8..]).unwrap();
        assert_eq!(raw.len(), total);
        assert_eq!(&raw[..2], b"MZ");
    }

    #[test]
    fn registro_en_clave_de_prueba() {
        let clave = r"Software\OpenMeetsPrueba\reg";
        let c = tmp("reg");
        fs::create_dir_all(&c).unwrap();
        registrar(clave, &c).unwrap();
        assert_eq!(carpeta_registrada(clave).unwrap(), c);
        let k = RegKey::predef(HKEY_CURRENT_USER).open_subkey(clave).unwrap();
        assert_eq!(k.get_value::<String, _>("Publisher").unwrap(), "Eyver Gomez");
        assert_eq!(k.get_value::<u32, _>("NoModify").unwrap(), 1);
        let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(r"Software\OpenMeetsPrueba");
        let _ = fs::remove_dir_all(&c);
    }

    #[test]
    fn instalar_y_desinstalar_limpia_todo() {
        let base = tmp("ciclo");
        let env = Entorno { inicio: base.join("inicio"), escritorio: base.join("esc"), clave: r"Software\OpenMeetsPrueba\ciclo".into(), datos: base.join("OpenMeets").join("datos") };
        fs::create_dir_all(&env.datos).unwrap();
        fs::write(env.datos.join("meet.json"), "{}").unwrap();
        let o = Opciones { carpeta: base.join("app"), escritorio: true, inicio: true };
        let ultimo = std::cell::Cell::new(0u8);
        instalar(&o, &env, false, &|p, _| ultimo.set(p)).unwrap();
        assert_eq!(ultimo.get(), 100);
        for f in [EXE, ICO, DESINSTALADOR] {
            assert!(o.carpeta.join(f).exists(), "{f}");
        }
        assert!(env.inicio.join(LNK).exists() && env.escritorio.join(LNK).exists());
        assert!(carpeta_registrada(&env.clave).is_some());
        fs::write(o.carpeta.join("mio.txt"), "x").unwrap(); // a user file must survive
        desinstalar(&o.carpeta, &env, false, false, &|_, _| {}).unwrap();
        assert!(env.datos.join("meet.json").exists(), "data kept by default");
        assert!(!o.carpeta.join(EXE).exists() && !env.inicio.join(LNK).exists());
        assert!(carpeta_registrada(&env.clave).is_none());
        assert!(o.carpeta.join("mio.txt").exists());
        // second round: explicit request deletes the data folder too
        instalar(&o, &env, false, &|_, _| {}).unwrap();
        desinstalar(&o.carpeta, &env, false, true, &|_, _| {}).unwrap();
        assert!(!env.datos.exists());
        let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(r"Software\OpenMeetsPrueba");
        let _ = fs::remove_dir_all(&base);
    }
}
