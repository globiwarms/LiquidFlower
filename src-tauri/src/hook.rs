//! Global low-level mouse hook: catches the trigger button anywhere on screen.

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::mpsc::Sender;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, MSLLHOOKSTRUCT,
    WH_MOUSE_LL, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

pub static TRIGGER_BTN: AtomicU8 = AtomicU8::new(0); // 0 middle, 1 back, 2 forward, 3 hotkey
pub static MENU_OPEN: AtomicU8 = AtomicU8::new(0);

enum Msg {
    Open(i32, i32),
    Close,
}

static TX: std::sync::OnceLock<Sender<Msg>> = std::sync::OnceLock::new();
static SWALLOW_UP: AtomicU8 = AtomicU8::new(0xFF);

pub fn install() -> Result<(), String> {
    let (tx, rx) = std::sync::mpsc::channel::<Msg>();
    TX.set(tx).map_err(|_| "hook already installed".to_string())?;

    std::thread::Builder::new()
        .name("lf-hook-worker".into())
        .spawn(move || {
            while let Ok(msg) = rx.recv() {
                match msg {
                    Msg::Open(x, y) => {
                        if MENU_OPEN.load(Ordering::Relaxed) == 0 {
                            crate::overlay::open_menu(x, y);
                        }
                    }
                    Msg::Close => {
                        if MENU_OPEN.load(Ordering::Relaxed) == 1 {
                            crate::overlay::close_menu();
                        }
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;

    std::thread::Builder::new()
        .name("lf-hook".into())
        .spawn(move || unsafe {
            let module = GetModuleHandleW(PCWSTR::null()).unwrap_or_default();
            let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), Some(HINSTANCE(module.0)), 0);
            if hook.is_err() {
                return;
            }
            let hook = hook.unwrap();
            // Message pump keeps the hook alive.
            let mut msg = Default::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
            let _ = UnhookWindowsHookEx(hook);
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn x_button(mouse_data: u32) -> u8 {
    ((mouse_data >> 16) & 0xFFFF) as u8 // 1 = XBUTTON1 (back), 2 = XBUTTON2 (forward)
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code >= 0 {
        let msg = wparam.0 as u32;
        let mi = &*(lparam.0 as *const MSLLHOOKSTRUCT);
        let trigger = TRIGGER_BTN.load(Ordering::Relaxed);

        if trigger < 3 {
            let (down_btn, up_btn) = match msg {
                WM_MBUTTONDOWN => (Some(0), None),
                WM_MBUTTONUP => (None, Some(0)),
                WM_XBUTTONDOWN => (Some(x_button(mi.mouseData)), None),
                WM_XBUTTONUP => (None, Some(x_button(mi.mouseData))),
                _ => (None, None),
            };

            if down_btn == Some(trigger) {
                SWALLOW_UP.store(trigger, Ordering::Relaxed);
                if MENU_OPEN.load(Ordering::Relaxed) == 1 {
                    let _ = TX.get().unwrap().send(Msg::Close);
                } else {
                    let _ = TX
                        .get()
                        .unwrap()
                        .send(Msg::Open(mi.pt.x, mi.pt.y));
                }
                return LRESULT(1); // consume
            }

            if up_btn == Some(trigger) && SWALLOW_UP.load(Ordering::Relaxed) == trigger {
                SWALLOW_UP.store(0xFF, Ordering::Relaxed);
                return LRESULT(1); // consume matching release
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}
