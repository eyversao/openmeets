use std::{env, fs, path::{Path, PathBuf}};

fn main() {
    let man = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    for v in ["OPENMEETS_PAYLOAD", "OPENMEETS_INSTALADOR_UI"] {
        println!("cargo:rerun-if-env-changed={v}");
    }

    // Payload: openmeets.exe compressed with zstd, prefixed by its raw size (u64 LE).
    let payload = env::var("OPENMEETS_PAYLOAD").map(PathBuf::from).unwrap_or_else(|_| man.join("prueba/openmeets-prueba.exe"));
    println!("cargo:rerun-if-changed={}", payload.display());
    let raw = fs::read(&payload).unwrap_or_else(|e| panic!("cannot read payload {}: {e}", payload.display()));
    let mut data = (raw.len() as u64).to_le_bytes().to_vec();
    data.extend(zstd::encode_all(&raw[..], 19).unwrap());
    fs::write(out.join("payload.zst"), data).unwrap();

    // Icon: the brand one if present, otherwise a generated placeholder.
    let brand = man.join("../marca/instalador/openmeets.ico");
    let ico = out.join("openmeets.ico");
    if brand.exists() {
        println!("cargo:rerun-if-changed={}", brand.display());
        fs::copy(&brand, &ico).unwrap();
    } else {
        fs::write(&ico, provisional_ico()).unwrap();
    }

    // UI folder -> static table of (path, bytes).
    let ui = match env::var("OPENMEETS_INSTALADOR_UI") {
        Ok(p) => PathBuf::from(p),
        Err(_) if man.join("../marca/instalador/ui/index.html").exists() => man.join("../marca/instalador/ui"),
        Err(_) => man.join("ui-provisional"),
    };
    println!("cargo:rerun-if-changed={}", ui.display());
    let mut files = vec![];
    walk(&ui, &ui, &mut files);
    let mut src = String::from("pub static UI: &[(&str, &[u8])] = &[\n");
    for (rel, abs) in files {
        src += &format!("    ({:?}, include_bytes!({:?})),\n", rel, abs.to_string_lossy());
    }
    src += "];\n";
    fs::write(out.join("ui.rs"), src).unwrap();

    if env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows" {
        let mut res = winres::WindowsResource::new();
        res.set_icon(ico.to_str().unwrap())
            .set_manifest(MANIFEST)
            .set("ProductName", "OpenMeets")
            .set("FileDescription", "OpenMeets Setup")
            .set("CompanyName", "Eyver Gomez")
            .set("LegalCopyright", "MIT License - Eyver Gomez")
            .set("OriginalFilename", "OpenMeets-Setup.exe");
        res.compile().unwrap();
    }
}

fn walk(root: &Path, dir: &Path, acc: &mut Vec<(String, PathBuf)>) {
    for e in fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(root, &p, acc);
        } else {
            let rel = p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
            acc.push((rel, fs::canonicalize(&p).unwrap()));
        }
    }
}

// 32x32 32-bit icon: blue rounded square with a white dot.
fn provisional_ico() -> Vec<u8> {
    let n = 32usize;
    let mut v = vec![0, 0, 1, 0, 1, 0, 32, 32, 0, 0, 1, 0, 32, 0];
    let size = 40 + n * n * 4 + n * 4;
    v.extend((size as u32).to_le_bytes());
    v.extend(22u32.to_le_bytes());
    v.extend(40u32.to_le_bytes());
    v.extend((n as u32).to_le_bytes());
    v.extend((2 * n as u32).to_le_bytes());
    v.extend([1, 0, 32, 0]);
    v.extend([0u8; 24]);
    for y in (0..n).rev() {
        for x in 0..n {
            let (fx, fy) = (x as f32 - 15.5, y as f32 - 15.5);
            let (cx, cy) = (fx.abs() - 9.5, fy.abs() - 9.5);
            let d = (cx.max(0.0).powi(2) + cy.max(0.0).powi(2)).sqrt() + cx.max(cy).min(0.0) - 6.0;
            let dot = (fx * fx + fy * fy).sqrt() < 6.0;
            let (b, g, r, a) = if d > 0.0 { (0, 0, 0, 0) } else if dot { (255, 255, 255, 255) } else { (0xe5, 0x6f, 0x1f, 255) };
            v.extend([b, g, r, a]);
        }
    }
    v.extend(vec![0u8; n * 4]);
    v
}

const MANIFEST: &str = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0" xmlns:asmv3="urn:schemas-microsoft-com:asm.v3">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges>
    <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
  </requestedPrivileges></security></trustInfo>
  <dependency><dependentAssembly>
    <assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="*" publicKeyToken="6595b64144ccf1df" language="*"/>
  </dependentAssembly></dependency>
  <asmv3:application><asmv3:windowsSettings>
    <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
    <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
  </asmv3:windowsSettings></asmv3:application>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1"><application>
    <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
  </application></compatibility>
</assembly>
"#;
