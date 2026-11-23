//! Dibujo de la consola de arranque: líneas de texto (con o sin color ANSI), símbolo, logotipo y QR en medios bloques.
use std::io::IsTerminal;

const MEDIOS: [char; 4] = [' ', '▀', '▄', '█'];

// (truecolor, 256 colores)
fn paleta(k: &str) -> ([u8; 3], u8) {
    match k {
        "tinta" => ([242, 242, 238], 255),
        "gris" => ([142, 142, 136], 245),
        "suave" => ([201, 201, 195], 251),
        "mal" => ([255, 107, 96], 209),
        "oscura" => ([17, 17, 17], 233),
        "papel" => ([245, 245, 242], 255),
        _ => ([217, 248, 74], 191), // senal
    }
}

pub fn sin_color(s: &str) -> String {
    let mut o = String::new();
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '\x1b' && it.peek() == Some(&'[') {
            for d in it.by_ref() {
                if d == 'm' {
                    break;
                }
            }
        } else {
            o.push(c);
        }
    }
    o
}
fn ancho(s: &str) -> usize {
    sin_color(s).chars().count()
}
fn relleno(s: &str, n: usize) -> String {
    format!("{s}{}", " ".repeat(n.saturating_sub(ancho(s))))
}

#[derive(Clone, Copy)]
pub struct Modo {
    pub color: bool,
    pub truecolor: bool,
}

/// Qué color admite la consola. NO_COLOR manda; FORCE_COLOR fuerza; si no, solo en terminal real.
pub fn detectar_color(es_tty: bool) -> Modo {
    let env = |k: &str| std::env::var(k).unwrap_or_default();
    let color = if !env("NO_COLOR").is_empty() {
        false
    } else if !env("FORCE_COLOR").is_empty() {
        !matches!(env("FORCE_COLOR").to_lowercase().as_str(), "0" | "false")
    } else {
        es_tty && env("TERM") != "dumb"
    };
    let c = env("COLORTERM").to_lowercase();
    Modo { color, truecolor: cfg!(windows) || c.contains("truecolor") || c.contains("24bit") }
}
pub fn modo_stdout() -> Modo {
    detectar_color(std::io::stdout().is_terminal())
}
pub fn modo_stderr() -> Modo {
    detectar_color(std::io::stderr().is_terminal())
}

struct Pintor {
    color: bool,
    truecolor: bool,
}
impl Pintor {
    fn fg(&self, k: &str) -> String {
        let (t, c) = paleta(k);
        if self.truecolor { format!("38;2;{};{};{}", t[0], t[1], t[2]) } else { format!("38;5;{c}") }
    }
    fn bg(&self, k: &str) -> String {
        let (t, c) = paleta(k);
        if self.truecolor { format!("48;2;{};{};{}", t[0], t[1], t[2]) } else { format!("48;5;{c}") }
    }
    fn env(&self, codigos: &str, t: &str) -> String {
        if self.color { format!("\x1b[{codigos}m{t}\x1b[0m") } else { t.to_string() }
    }
    fn tinta(&self, t: &str) -> String { self.env(&self.fg("tinta"), t) }
    fn negrita(&self, t: &str) -> String { self.env(&format!("1;{}", self.fg("tinta")), t) }
    fn gris(&self, t: &str) -> String { self.env(&self.fg("gris"), t) }
    fn suave(&self, t: &str) -> String { self.env(&self.fg("suave"), t) }
    fn mal(&self, t: &str) -> String { self.env(&format!("1;{}", self.fg("mal")), t) }
    /// Resaltador lima con texto tinta: solo lo importante (URL para teléfonos y PIN).
    fn senal(&self, t: &str) -> String {
        if self.color { self.env(&format!("1;{};{}", self.fg("oscura"), self.bg("senal")), &format!(" {t} ")) } else { t.to_string() }
    }
    fn qr(&self, t: &str) -> String { self.env(&format!("{};{}", self.fg("oscura"), self.bg("papel")), t) }
}

/// Disco abierto muestreado del trazado de simbolo.svg (medios bloques, 1 columna por píxel).
pub fn simbolo(px: usize) -> Vec<String> {
    let k = 53.0 / px as f64;
    let sub = 4;
    let dentro = |x: f64, y: f64| {
        let (dx, dy) = (x - 32.0, y - 32.0);
        let d = dx.hypot(dy);
        let ang = dy.atan2(dx) * 180.0 / std::f64::consts::PI;
        d <= 6.0 || (d >= 17.5 && d <= 26.5 && !(ang > -62.0 && ang < -38.0)) // abertura arriba a la derecha
    };
    let pixel = |i: usize, j: usize| {
        let mut n = 0;
        for a in 0..sub {
            for b in 0..sub {
                if dentro(5.5 + (i as f64 + (a as f64 + 0.5) / sub as f64) * k, 5.5 + (j as f64 + (b as f64 + 0.5) / sub as f64) * k) {
                    n += 1;
                }
            }
        }
        n * 2 >= sub * sub
    };
    (0..px).step_by(2).map(|j| (0..px).map(|i| MEDIOS[pixel(i, j) as usize + 2 * pixel(i, j + 1) as usize]).collect()).collect()
}

fn glifo(c: char) -> &'static [&'static str] {
    match c {
        'o' => &[".###.", "##.##", "##.##", "##.##", "##.##", ".###."],
        'p' => &["####.", "##.##", "##.##", "##.##", "##.##", "####.", "##...", "##..."],
        'e' => &[".###.", "##.##", "#####", "##...", "##.##", ".###."],
        'n' => &["####.", "##.##", "##.##", "##.##", "##.##", "##.##"],
        'm' => &["###.###.", "##.##.##", "##.##.##", "##.##.##", "##.##.##", "##.##.##"],
        't' => &[".##..", "#####", ".##..", ".##..", ".##..", "..###"],
        's' => &[".####", "##...", ".###.", "...##", "...##", "####."],
        _ => &[],
    }
}

/// Logotipo «openmeets» en bloques: 4 filas de texto.
pub fn logotipo() -> Vec<String> {
    let texto = "openmeets";
    let n = texto.chars().count();
    let mut px: Vec<Vec<char>> = vec![vec![]; 8];
    for (i, ch) in texto.chars().enumerate() {
        let g = glifo(ch);
        let w = g[0].len();
        for (y, fila) in px.iter_mut().enumerate() {
            match g.get(y) {
                Some(s) => fila.extend(s.chars()),
                None => fila.extend(std::iter::repeat_n('.', w)),
            }
            if i < n - 1 {
                fila.push('.');
            }
        }
    }
    (0..8).step_by(2).map(|y| (0..px[y].len()).map(|x| MEDIOS[(px[y][x] == '#') as usize + 2 * (px[y + 1][x] == '#') as usize]).collect()).collect()
}

/// QR en medios bloques (módulos oscuros sobre fondo claro): se lee con la cámara del teléfono.
pub fn qr_bloques(texto: &str, margen: usize) -> Option<Vec<String>> {
    let q = qrcode::QrCode::with_error_correction_level(texto.as_bytes(), qrcode::EcLevel::M).ok()?;
    let tam = q.width();
    let colores = q.to_colors();
    let n = tam + margen * 2;
    let m = |x: usize, y: usize| x >= margen && y >= margen && x < n - margen && y < n - margen && colores[(y - margen) * tam + (x - margen)] == qrcode::Color::Dark;
    Some((0..n).step_by(2).map(|y| (0..n).map(|x| MEDIOS[m(x, y) as usize + 2 * m(x, y + 1) as usize]).collect()).collect())
}

fn envolver_texto(t: &str, max: usize) -> Vec<String> {
    let mut lineas = vec![];
    let mut l = String::new();
    for p in t.split(' ') {
        if !l.is_empty() && l.chars().count() + 1 + p.chars().count() > max {
            lineas.push(std::mem::take(&mut l));
            l = p.to_string();
        } else if l.is_empty() {
            l = p.to_string();
        } else {
            l = format!("{l} {p}");
        }
    }
    if !l.is_empty() {
        lineas.push(l);
    }
    lineas
}

/// Una línea de aviso o error con el estilo de la consola.
pub fn aviso(texto: &str, m: Modo) -> String {
    let c = Pintor { color: m.color, truecolor: m.truecolor };
    format!("\n  {} {texto}", c.mal("■"))
}

pub struct DatosConsola<'a> {
    pub version: &'a str,
    pub local: &'a str,
    pub ips: &'a [String],
    pub puerto: u16,
    pub pin: &'a str,
    pub datos: &'a str,
    pub registro: &'a str,
}

/// Todas las líneas de la consola de arranque.
pub fn lineas_consola(d: &DatosConsola, m: Modo) -> Vec<String> {
    let c = Pintor { color: m.color, truecolor: m.truecolor };
    let max = 80usize;
    let sangria = "  ";
    let mut out = vec![String::new()];

    // Cabecera: símbolo a la izquierda, logotipo y créditos a la derecha.
    let logo = logotipo();
    let mut derecha: Vec<Option<String>> = vec![None; 8];
    for i in 0..4 {
        derecha[2 + i] = Some(logo[i].clone());
    }
    let ver = format!("versión {}", d.version);
    derecha[6] = Some(ver);
    derecha[7] = Some("por Eyver Gomez (@eyversao)".into());
    for (i, f) in simbolo(16).iter().enumerate() {
        let der = derecha.get(i).cloned().flatten().unwrap_or_default();
        let der = if (2..=5).contains(&i) { c.tinta(&der) } else { c.gris(&der) };
        out.push(format!("{sangria}{}   {der}", c.tinta(f)));
    }
    out.push(String::new());

    // Datos a la izquierda; el QR de la URL para teléfonos, si hay red y color, a la derecha.
    let titulo = |t: &str| c.negrita(t);
    let q: Vec<String> = if m.color && !d.ips.is_empty() {
        qr_bloques(&format!("http://{}:{}/", d.ips[0], d.puerto), 3).map(|v| v.iter().map(|f| c.qr(f)).collect()).unwrap_or_default()
    } else {
        vec![]
    };
    let mut izq: Vec<String> = vec![titulo("En este equipo"), format!("  {}", c.tinta(d.local)), format!("  {}", c.gris("Organizador, sin PIN.")), String::new(), titulo("Teléfonos y pantallas")];
    if d.ips.is_empty() {
        izq.push(format!("  {}", c.gris("Sin red: conecta el equipo a la Wi-Fi o activa el hotspot.")));
    } else {
        for (i, ip) in d.ips.iter().enumerate() {
            let u = format!("http://{ip}:{}/", d.puerto);
            izq.push(format!("  {}", if i == 0 { c.senal(&u) } else { c.tinta(&u) }));
        }
    }
    if !q.is_empty() {
        izq.push(format!("  {}", c.gris("Escanea el QR con la cámara.")));
    }
    izq.extend([String::new(), titulo("PIN de organizador"), format!("  {}", c.senal(d.pin)), format!("  {}", c.gris("Solo desde otro equipo."))]);
    let ancho_q = q.first().map(|x| ancho(x)).unwrap_or(0);
    let col_izq = (izq.iter().map(|x| ancho(x)).max().unwrap_or(0) + 3).min((max - 2).saturating_sub(ancho_q));
    for i in 0..izq.len().max(q.len()) {
        let l = izq.get(i).cloned().unwrap_or_default();
        out.push(if q.is_empty() { format!("{sangria}{l}") } else { format!("{sangria}{}{}", relleno(&l, col_izq), q.get(i).cloned().unwrap_or_default()) });
    }
    out.push(String::new());

    out.push(format!("{sangria}{}", titulo("Pasos")));
    let pasos = ["Windows pregunta por el Firewall: pulsa «Permitir» en redes privadas.", "Teléfonos, pantallas y este equipo, en la misma Wi-Fi o en el hotspot.", "En el meet, la pestaña Jueces da los enlaces y el código de los jueces."];
    for (i, p) in pasos.iter().enumerate() {
        for (j, l) in envolver_texto(p, max - 9).iter().enumerate() {
            out.push(format!("{sangria}  {}{}", if j > 0 { "   ".to_string() } else { c.gris(&format!("{}  ", i + 1)) }, c.suave(l)));
        }
    }
    out.push(String::new());

    out.push(format!("{sangria}{}", titulo("Datos y registro")));
    out.push(format!("{sangria}  {}{}", c.gris("Datos     "), c.suave(d.datos)));
    out.push(format!("{sangria}  {}{}", c.gris("Registro  "), c.suave(d.registro)));
    out.push(String::new());
    out.push(format!("{sangria}{}", c.gris("Para cerrar OpenMeets, cierra esta ventana o pulsa Ctrl+C.")));
    out.push(String::new());
    out.into_iter().map(|l| l.trim_end_matches(' ').to_string()).collect()
}

pub fn titulo_ventana(url: &str) -> String {
    format!("OpenMeets · {url}")
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn consola_sin_color() {
        let ips = vec!["192.168.1.20".to_string()];
        let d = DatosConsola { version: "1.0.0", local: "http://localhost:5050/", ips: &ips, puerto: 5050, pin: "123456", datos: "C:/datos", registro: "C:/datos/openmeets.log" };
        let t = lineas_consola(&d, Modo { color: false, truecolor: true }).join("\n");
        assert!(t.contains("PIN de organizador") && t.contains("123456") && t.contains("http://192.168.1.20:5050/") && t.contains("versión 1.0.0"));
        assert!(!t.contains('\x1b'));
        let c = lineas_consola(&d, Modo { color: true, truecolor: true }).join("\n");
        assert!(c.contains("\x1b[") && c.contains('█'), "con color incluye el QR en bloques");
    }

    #[test]
    fn piezas() {
        assert_eq!(simbolo(16).len(), 8);
        assert_eq!(logotipo().len(), 4);
        let q = qr_bloques("http://192.168.1.20:5050/", 3).unwrap();
        assert!(q.len() > 10 && q[0].chars().count() > 20);
        assert_eq!(sin_color("\x1b[1;38;5;5mhola\x1b[0m"), "hola");
        assert_eq!(envolver_texto("a bb ccc", 4), vec!["a bb", "ccc"]);
    }
}
