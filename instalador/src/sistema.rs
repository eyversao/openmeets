//! The only unsafe code: thin wrappers over Win32 calls.
use std::path::PathBuf;
use windows_sys::Win32::{
    Globalization::GetUserDefaultLocaleName,
    Graphics::Dwm::DwmSetWindowAttribute,
    System::Com::CoTaskMemFree,
    UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath},
};

/// Real desktop folder (follows OneDrive redirection), falling back to %USERPROFILE%\Desktop.
pub fn escritorio() -> PathBuf {
    let mut p: *mut u16 = std::ptr::null_mut();
    // SAFETY: on success `p` is a NUL-terminated wide string owned by COM; we copy it and free it once.
    unsafe {
        if SHGetKnownFolderPath(&FOLDERID_Desktop, 0, std::ptr::null_mut(), &mut p) == 0 && !p.is_null() {
            let len = (0..).take_while(|&i| *p.add(i) != 0).count();
            let s = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
            CoTaskMemFree(p as *const _);
            return PathBuf::from(s);
        }
    }
    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default()).join("Desktop")
}

/// System locale name (e.g. "es-CO").
pub fn idioma() -> String {
    let mut b = [0u16; 85];
    // SAFETY: buffer length matches the size passed; the call writes at most that many u16.
    let n = unsafe { GetUserDefaultLocaleName(b.as_mut_ptr(), b.len() as i32) };
    String::from_utf16_lossy(&b[..(n.max(1) - 1) as usize])
}

/// Rounded corners on Windows 11 (DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_ROUND = 2); ignored on Windows 10.
pub fn redondear(hwnd: isize) {
    let v: i32 = 2;
    // SAFETY: valid HWND of our own window and a pointer to a live i32 of the stated size.
    unsafe {
        DwmSetWindowAttribute(hwnd as _, 33, &v as *const i32 as *const _, 4);
    }
}
