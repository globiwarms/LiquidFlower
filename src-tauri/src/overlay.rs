//! The fullscreen transparent overlay that hosts the petals.

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::{MonitorFromPoint, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetSystemMetrics, GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
    SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
};

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
static OVERLAY_READY: AtomicBool = AtomicBool::new(false);

pub fn init(app: AppHandle) {
    let _ = APP.set(app);
}

pub fn mark_overlay_ready() {
    OVERLAY_READY.store(true, Ordering::Relaxed);
}

pub fn cursor_position() -> (i32, i32) {
    unsafe {
        let mut pt = POINT::default();
        let _ = GetCursorPos(&mut pt);
        (pt.x, pt.y)
    }
}

fn dpi_scale_at(x: i32, y: i32) -> f32 {
    unsafe {
        let mon = MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST);
        let mut dx = 0u32;
        let mut dy = 0u32;
        if GetDpiForMonitor(mon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy).is_ok() && dx > 0 {
            dx as f32 / 96.0
        } else {
            1.0
        }
    }
}

pub fn open_menu(cx: i32, cy: i32) {
    let Some(app) = APP.get() else { return };

    // The webview may still be booting right after launch — wait briefly.
    if !OVERLAY_READY.load(Ordering::Relaxed) {
        let app = app.clone();
        std::thread::spawn(move || {
            for _ in 0..40 {
                if OVERLAY_READY.load(Ordering::Relaxed) {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            open_menu_inner(&app, cx, cy);
        });
    } else {
        open_menu_inner(app, cx, cy);
    }
}

fn open_menu_inner(app: &AppHandle, cx: i32, cy: i32) {
    let Some(win) = app.get_webview_window("overlay") else { return };
    crate::hook::MENU_OPEN.store(1, Ordering::Relaxed);

    let cfg = crate::config::load();
    let scale = dpi_scale_at(cx, cy);

    let (vx, vy, vw, vh) = virtual_screen();
    if vw <= 0 || vh <= 0 {
        crate::hook::MENU_OPEN.store(0, Ordering::Relaxed);
        return;
    }

    // Capture the region the petals will cover (for real backdrop glass).
    let ap = &cfg.appearance;
    let pad = ((ap.radius + ap.petal_size / 2.0 + 32.0) * scale as f64).max(240.0) as i32;
    let side = pad * 2;
    let side = side.min(vw).min(vh);
    let rx = (cx - side / 2).max(vx).min(vx + vw - side);
    let ry = (cy - side / 2).max(vy).min(vy + vh - side);
    let capture = crate::capture::capture_region(rx, ry, side, side).unwrap_or_default();

    let _ = win.set_position(PhysicalPosition::new(vx, vy));
    let _ = win.set_size(PhysicalSize::new(vw.max(1) as u32, vh.max(1) as u32));
    let _ = win.show();

    let payload = serde_json::json!({
        "cursor": { "x": cx - vx, "y": cy - vy },
        "region": { "x": rx - vx, "y": ry - vy, "w": side, "h": side },
        "scale": scale,
        "capture": capture,
        "config": cfg,
        "micMuted": crate::actions::is_mic_muted(),
        "soundMuted": crate::actions::is_sound_muted(),
    });
    let _ = win.emit("menu/show", payload);
}

pub fn close_menu() {
    let Some(app) = APP.get() else { return };
    if let Some(win) = app.get_webview_window("overlay") {
        let _ = win.emit("menu/hide", ());
    }
}

/// Called by the frontend after the close animation finished.
pub fn finish_hide() {
    if let Some(app) = APP.get() {
        if let Some(win) = app.get_webview_window("overlay") {
            let _ = win.hide();
        }
    }
    crate::hook::MENU_OPEN.store(0, Ordering::Relaxed);
}

fn virtual_screen() -> (i32, i32, i32, i32) {
    unsafe {
        (
            GetSystemMetrics(SM_XVIRTUALSCREEN),
            GetSystemMetrics(SM_YVIRTUALSCREEN),
            GetSystemMetrics(SM_CXVIRTUALSCREEN),
            GetSystemMetrics(SM_CYVIRTUALSCREEN),
        )
    }
}

/// Makes the overlay click-targetable but never focus-stealing (games keep focus).
pub fn patch_overlay_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("overlay") else { return };
    unsafe {
        if let Ok(h) = win.hwnd() {
            // tauri's windows crate version may differ — pass the raw handle.
            let hwnd = HWND(h.0);
            let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            SetWindowLongPtrW(
                hwnd,
                GWL_EXSTYLE,
                ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize,
            );
        }
    }
}

/// The settings window is created hidden at startup — show it on demand.
pub fn create_settings_window(app: &AppHandle) {
    let Some(w) = app.get_webview_window("settings") else { return };
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
}

/// Prepares the pre-created settings window (round corners, centered).
pub fn setup_settings_window(app: &AppHandle) {
    let Some(w) = app.get_webview_window("settings") else { return };
    let _ = w.center();
    unsafe {
        if let Ok(h) = w.hwnd() {
            use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE};
            let round: u32 = 2; // DWMWCP_ROUND
            let _ = DwmSetWindowAttribute(
                HWND(h.0),
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &round as *const u32 as *const std::ffi::c_void,
                4,
            );
        }
    }
}
