//! Tauri commands exposed to the webviews.

use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::config::{Config, Petal};
use crate::{actions, config, hook, overlay, system, winicon};

#[tauri::command]
pub fn get_config() -> Config {
    config::load()
}

#[tauri::command]
pub fn save_config(app: AppHandle, cfg: Config) -> Result<(), String> {
    config::save(&cfg)?;
    apply_runtime(&app, &cfg, true)?;
    Ok(())
}

#[tauri::command]
pub async fn reset_config(app: AppHandle) -> Result<Config, String> {
    let cfg = Config::defaults();
    config::save(&cfg)?;
    apply_runtime(&app, &cfg, true)?;
    Ok(cfg)
}

#[tauri::command]
pub fn close_settings(app: AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.hide();
    }
}

#[tauri::command]
pub fn minimize_settings(app: AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        let _ = w.minimize();
    }
}

#[tauri::command]
pub fn toggle_maximize_settings(app: AppHandle) {
    if let Some(w) = app.get_webview_window("settings") {
        if w.is_maximized().unwrap_or(false) {
            let _ = w.unmaximize();
        } else {
            let _ = w.maximize();
        }
    }
}

#[tauri::command]
pub fn run_action(action: String, param: String) -> Result<(), String> {
    actions::execute(&action, &param)
}

#[tauri::command]
pub fn overlay_hidden() {
    overlay::finish_hide();
}

#[tauri::command]
pub fn overlay_ready() {
    overlay::mark_overlay_ready();
}

#[tauri::command]
pub fn open_settings_window(app: AppHandle) {
    overlay::create_settings_window(&app);
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub async fn pick_app_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Приложения", &["exe", "lnk"])
        .pick_file()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn get_app_icon(path: String) -> Option<String> {
    winicon::extract_icon_data_url(&path)
}

#[tauri::command]
pub fn action_list() -> Vec<(String, String)> {
    actions::ACTIONS
        .iter()
        .map(|(id, name)| (id.to_string(), name.to_string()))
        .collect()
}

#[tauri::command]
pub fn petal_limits() -> (usize, usize) {
    (1, config::MAX_PETALS)
}

#[tauri::command]
pub fn is_autostart_enabled() -> bool {
    system::is_autostart()
}

/// Applies config to runtime pieces: trigger button, hotkey, autostart,
/// and notifies the overlay.
pub fn apply_runtime(app: &AppHandle, cfg: &Config, apply_autostart: bool) -> Result<(), String> {
    hook::TRIGGER_BTN.store(cfg.trigger_button(), Ordering::Relaxed);
    apply_hotkey(app, cfg)?;
    if apply_autostart {
        let _ = system::set_autostart(cfg.autostart);
    }
    let _ = app.emit("config/updated", cfg);
    Ok(())
}

fn apply_hotkey(app: &AppHandle, cfg: &Config) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if cfg.trigger == "hotkey" && !cfg.hotkey.is_empty() {
        let sc: Shortcut = cfg
            .hotkey
            .parse::<Shortcut>()
            .map_err(|_| "Неверное сочетание клавиш".to_string())?;
        gs.on_shortcut(sc, |_app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                if hook::MENU_OPEN.load(Ordering::Relaxed) == 1 {
                    overlay::close_menu();
                } else {
                    let (x, y) = overlay::cursor_position();
                    overlay::open_menu(x, y);
                }
            }
        })
        .map_err(|_| "Не удалось зарегистрировать сочетание".to_string())?;
    }
    Ok(())
}

/// Default petal template used by the settings UI when adding a new petal.
#[tauri::command]
pub fn default_petal(id: String) -> Petal {
    Petal {
        id,
        name: "Лепесток".into(),
        icon: "sparkles".into(),
        color: "#5AC8FA".into(),
        action: "mute".into(),
        param: String::new(),
    }
}
