use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

pub const MAX_PETALS: usize = 10;
pub const APP_DIR_NAME: &str = "LiquidFlower";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Petal {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub action: String,
    #[serde(default)]
    pub param: String,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase", default)]
pub struct Appearance {
    pub opacity: f64,
    pub liquid_glass: bool,
    pub blur: f64,
    pub glow: bool,
    pub glow_strength: f64,
    pub petal_size: f64,
    pub radius: f64,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            opacity: 0.5,
            liquid_glass: true,
            blur: 24.0,
            glow: true,
            glow_strength: 0.6,
            petal_size: 112.0,
            radius: 150.0,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Sounds {
    pub open: bool,
    pub close: bool,
    pub volume: f64,
    pub open_type: String, // "bloom" | "glass" | "drop" | "pop" | "chime"
}

impl Default for Sounds {
    fn default() -> Self {
        Self { open: true, close: true, volume: 0.6, open_type: "bloom".into() }
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub trigger: String,      // "middle" | "back" | "forward" | "hotkey"
    pub hotkey: String,       // e.g. "ctrl+alt+KeyS"
    pub animation: String,    // "bloom" | "cascade" | "wave"
    pub animation_speed: f64, // 0.5 .. 2.0
    pub close_after_action: bool,
    pub appearance: Appearance,
    pub autostart: bool,
    pub sounds: Sounds,
    pub petals: Vec<Petal>,
}

impl Config {
    pub fn defaults() -> Self {
        Config {
            trigger: "middle".into(),
            hotkey: String::new(),
            animation: "bloom".into(),
            animation_speed: 1.0,
            close_after_action: true,
            appearance: Appearance::default(),
            autostart: false,
            sounds: Sounds::default(),
            petals: vec![
                petal("p1", "Микрофон", "mic-off", "none", "mic_mute", ""),
                petal("p2", "Звук", "volume-x", "none", "mute", ""),
                petal("p3", "Пауза", "play", "none", "play_pause", ""),
                petal("p4", "Трек", "skip-forward", "none", "next_track", ""),
                petal("p5", "Приложение", "app-window", "none", "open_app", ""),
                petal("p6", "Ссылка", "link", "none", "link", ""),
            ],
        }
    }

    /// 0 = middle, 1 = back, 2 = forward, 3 = hotkey only
    pub fn trigger_button(&self) -> u8 {
        match self.trigger.as_str() {
            "middle" => 0,
            "back" => 1,
            "forward" => 2,
            _ => 3,
        }
    }
}

fn petal(id: &str, name: &str, icon: &str, color: &str, action: &str, param: &str) -> Petal {
    Petal {
        id: id.into(),
        name: name.into(),
        icon: icon.into(),
        color: color.into(),
        action: action.into(),
        param: param.into(),
    }
}

pub fn config_dir() -> PathBuf {
    std::env::var("APPDATA")
        .map(|d| PathBuf::from(d).join(APP_DIR_NAME))
        .unwrap_or_else(|_| PathBuf::from("."))
}

pub fn config_path() -> PathBuf {
    config_dir().join("config.json")
}

pub fn load() -> Config {
    fs::read(config_path())
        .ok()
        .and_then(|bytes| {
            // Tolerate a UTF-8 BOM (some editors, e.g. Notepad, write one).
            let rest = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF][..]).unwrap_or(&bytes);
            let s = String::from_utf8_lossy(rest).into_owned();
            serde_json::from_str(&s).ok()
        })
        .unwrap_or_else(Config::defaults)
}

pub fn save(cfg: &Config) -> Result<(), String> {
    let dir = config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    fs::write(config_path(), json).map_err(|e| e.to_string())
}
