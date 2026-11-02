//! System actions executed by petals.

use windows::core::PCWSTR;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCapture, eMultimedia, eRender, IMMDevice, IMMDeviceEnumerator, EDataFlow, ERole,
    MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Power::SetSuspendState;
use windows::Win32::System::Shutdown::{
    ExitWindowsEx, EWX_POWEROFF, EWX_SHUTDOWN, SHTDN_REASON_MAJOR_OTHER, SHTDN_REASON_MINOR_OTHER,
};
use windows::Win32::Security::{TOKEN_ADJUST_PRIVILEGES, TOKEN_QUERY};
use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK,
};
use windows::Win32::UI::Shell::{ShellExecuteW, IShellDispatch2, Shell as ShellCLSID};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn with_com<T>(f: impl FnOnce() -> T) -> T {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let out = f();
        if hr.ok().is_ok() {
            CoUninitialize();
        }
        out
    }
}

type WResult<T> = windows::core::Result<T>;

fn endpoint(render: bool) -> WResult<IAudioEndpointVolume> {
    unsafe {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let flow: EDataFlow = if render { eRender } else { eCapture };
        let dev: IMMDevice = enumerator.GetDefaultAudioEndpoint(flow, ERole(eMultimedia.0))?;
        dev.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}

fn toggle_mute(render: bool) -> Result<(), String> {
    with_com(|| {
        let vol = endpoint(render).map_err(|e| e.to_string())?;
        unsafe {
            let muted = vol.GetMute().map_err(|e| e.to_string())?;
            vol.SetMute(!muted.as_bool(), std::ptr::null()).map_err(|e| e.to_string())
        }
    })
}

fn change_volume(delta: f32) -> Result<(), String> {
    with_com(|| {
        let vol = endpoint(true).map_err(|e| e.to_string())?;
        unsafe {
            let cur = vol.GetMasterVolumeLevelScalar().map_err(|e| e.to_string())?;
            let next = (cur + delta).clamp(0.0, 1.0);
            vol.SetMasterVolumeLevelScalar(next, std::ptr::null()).map_err(|e| e.to_string())
        }
    })
}

fn press_media_key(vk: VIRTUAL_KEY) {
    unsafe {
        let down = INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: windows::Win32::UI::Input::KeyboardAndMouse::KEYBD_EVENT_FLAGS(0),
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let mut up = down;
        up.Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;
        SendInput(&[down, up], std::mem::size_of::<INPUT>() as i32);
    }
}

fn enable_shutdown_privilege() {
    unsafe {
        let mut token = windows::Win32::Foundation::HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &mut token).is_err() {
            return;
        }
        let mut luid = windows::Win32::Foundation::LUID::default();
        let name = wide("SeShutdownPrivilege");
        if windows::Win32::Security::LookupPrivilegeValueW(
            PCWSTR::null(),
            PCWSTR::from_raw(name.as_ptr()),
            &mut luid,
        )
        .is_err()
        {
            return;
        }
        let tp = windows::Win32::Security::TOKEN_PRIVILEGES {
            PrivilegeCount: 1,
            Privileges: [windows::Win32::Security::LUID_AND_ATTRIBUTES {
                Luid: luid,
                Attributes: windows::Win32::Security::SE_PRIVILEGE_ENABLED,
            }],
        };
        let _ = windows::Win32::Security::AdjustTokenPrivileges(token, false, Some(&tp), 0, None, None);
    }
}

fn shell_open(target: &str) -> Result<(), String> {
    let w = wide(target);
    if target.is_empty() {
        return Err("empty target".into());
    }
    unsafe {
        let res = ShellExecuteW(
            None,
            PCWSTR::from_raw(wide("open").as_ptr()),
            PCWSTR::from_raw(w.as_ptr()),
            None,
            None,
            SW_SHOWNORMAL,
        );
        if res.0 as isize <= 32 {
            return Err(format!("ShellExecute failed ({})", res.0 as isize));
        }
    }
    Ok(())
}

fn minimize_all() -> Result<(), String> {
    with_com(|| {
        unsafe {
            let shell: IShellDispatch2 = CoCreateInstance(&ShellCLSID, None, CLSCTX_ALL)
                .map_err(|e| e.to_string())?;
            shell.MinimizeAll().map_err(|e| e.to_string())
        }
    })
}

/// Current mute state of the default capture (microphone) device.
pub fn is_mic_muted() -> bool {
    with_com(|| {
        let vol = match endpoint(false) {
            Ok(v) => v,
            Err(_) => return false,
        };
        unsafe { vol.GetMute().map(|m| m.as_bool()).unwrap_or(false) }
    })
}

/// Current mute state of the default render (speakers) device.
pub fn is_sound_muted() -> bool {
    with_com(|| {
        let vol = match endpoint(true) {
            Ok(v) => v,
            Err(_) => return false,
        };
        unsafe { vol.GetMute().map(|m| m.as_bool()).unwrap_or(false) }
    })
}

pub fn execute(action: &str, param: &str) -> Result<(), String> {
    match action {
        "open_app" => shell_open(param),
        "link" => shell_open(param),
        "mute" => toggle_mute(true),
        "mic_mute" => toggle_mute(false),
        "vol_down" => change_volume(-0.25),
        "vol_up" => change_volume(0.25),
        "play_pause" => {
            press_media_key(VK_MEDIA_PLAY_PAUSE);
            Ok(())
        }
        "next_track" => {
            press_media_key(VK_MEDIA_NEXT_TRACK);
            Ok(())
        }
        "prev_track" => {
            press_media_key(VK_MEDIA_PREV_TRACK);
            Ok(())
        }
        "sleep" => {
            let ok = unsafe { SetSuspendState(false, false, false) };
            if ok { Ok(()) } else { Err("SetSuspendState failed".into()) }
        }
        "shutdown" => {
            enable_shutdown_privilege();
            unsafe {
                ExitWindowsEx(EWX_SHUTDOWN | EWX_POWEROFF, SHTDN_REASON_MAJOR_OTHER | SHTDN_REASON_MINOR_OTHER)
                    .map_err(|_| "ExitWindowsEx failed".to_string())
            }
        }
        "minimize_all" => minimize_all(),
        _ => Err(format!("unknown action: {action}")),
    }
}

pub const ACTIONS: &[(&str, &str)] = &[
    ("open_app", "Открыть приложение"),
    ("mute", "Выключить звук"),
    ("mic_mute", "Выключить микрофон"),
    ("vol_down", "Тише"),
    ("vol_up", "Громче"),
    ("play_pause", "Пауза / Старт"),
    ("next_track", "Следующий трек"),
    ("prev_track", "Предыдущий трек"),
    ("sleep", "Спящий режим"),
    ("shutdown", "Завершение работы"),
    ("link", "Ссылка"),
    ("minimize_all", "Свернуть все окна"),
];
