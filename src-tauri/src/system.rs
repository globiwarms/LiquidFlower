//! Autostart, single instance and "show settings" signalling.

use tauri::AppHandle;
use windows::core::PCWSTR;
use windows::Win32::Foundation::{GetLastError, ERROR_ALREADY_EXISTS, WAIT_OBJECT_0};
use windows::Win32::System::Threading::{CreateEventW, OpenEventW, SetEvent, WaitForSingleObject, INFINITE};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use winreg::enums::{HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE};
use winreg::RegKey;

const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "LiquidFlower";
const MUTEX_NAME: &str = "LiquidFlower.SingleInstance.Mutex";
const SHOW_EVENT: &str = "LiquidFlower.SingleInstance.ShowSettings";

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn set_autostart(enable: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let run = hkcu
        .open_subkey_with_flags(RUN_KEY, KEY_SET_VALUE | KEY_QUERY_VALUE)
        .map_err(|e| e.to_string())?;
    if enable {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        run.set_value(VALUE_NAME, &exe.to_string_lossy().to_string())
            .map_err(|e| e.to_string())?;
    } else {
        let _ = run.delete_value(VALUE_NAME);
    }
    Ok(())
}

pub fn is_autostart() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey(RUN_KEY)
        .and_then(|k| k.get_value::<String, _>(VALUE_NAME))
        .is_ok()
}

/// Returns true when this is the first instance.
#[allow(forgetting_copy_types)]
pub fn acquire_single_instance() -> bool {
    unsafe {
        let name = wide(MUTEX_NAME);
        let mutex = windows::Win32::System::Threading::CreateMutexW(None, false, PCWSTR::from_raw(name.as_ptr()));
        let Ok(mutex) = mutex else { return true };
        if GetLastError() == ERROR_ALREADY_EXISTS {
            return false;
        }
        // Keep the handle alive for the whole process lifetime.
        std::mem::forget(mutex);
        true
    }
}

pub fn signal_show_settings() {
    unsafe {
        let name = wide(SHOW_EVENT);
        if let Ok(ev) = OpenEventW(windows::Win32::System::Threading::EVENT_MODIFY_STATE, false, PCWSTR::from_raw(name.as_ptr())) {
            let _ = SetEvent(ev);
        }
    }
}

pub fn spawn_show_settings_listener(app: AppHandle) {
    std::thread::spawn(move || unsafe {
        let name = wide(SHOW_EVENT);
        let hinstance = GetModuleHandleW(PCWSTR::null()).unwrap_or_default();
        let ev = CreateEventW(None, false, false, PCWSTR::from_raw(name.as_ptr()));
        let Ok(ev) = ev else { return };
        let _ = hinstance;
        loop {
            let r = WaitForSingleObject(ev, INFINITE);
            if r == WAIT_OBJECT_0 {
                crate::overlay::create_settings_window(&app);
            } else {
                break;
            }
        }
    });
}
