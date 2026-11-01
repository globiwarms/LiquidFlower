#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod actions;
mod capture;
mod commands;
mod config;
mod hook;
mod overlay;
mod system;
mod winicon;

use tauri::menu::{MenuBuilder, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::WindowEvent;

fn main() {
    if !system::acquire_single_instance() {
        // Already running — just surface its settings window.
        system::signal_show_settings();
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();

            overlay::init(handle.clone());
            overlay::patch_overlay_window(&handle);
            overlay::setup_settings_window(&handle);

            let cfg = config::load();
            hook::TRIGGER_BTN.store(cfg.trigger_button(), std::sync::atomic::Ordering::Relaxed);
            hook::install().map_err(|e| format!("mouse hook: {e}"))?;
            let _ = commands::apply_runtime(&handle, &cfg, false);

            system::spawn_show_settings_listener(handle.clone());
            setup_tray(&handle)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "settings" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::reset_config,
            commands::run_action,
            commands::overlay_hidden,
            commands::overlay_ready,
            commands::open_settings_window,
            commands::close_settings,
            commands::minimize_settings,
            commands::toggle_maximize_settings,
            commands::quit_app,
            commands::pick_app_file,
            commands::get_app_icon,
            commands::action_list,
            commands::petal_limits,
            commands::is_autostart_enabled,
            commands::default_petal,
        ])
        .run(tauri::generate_context!())
        .expect("LiquidFlower failed to start");
}

fn setup_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let settings_item = MenuItem::with_id(app, "settings", "Настройки", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
    let menu = MenuBuilder::new(app)
        .item(&settings_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let icon = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?.into();

    TrayIconBuilder::with_id("lf-tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("LiquidFlower")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "settings" => overlay::create_settings_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                overlay::create_settings_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
