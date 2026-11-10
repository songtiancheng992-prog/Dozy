use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppConfig {
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub autostart: bool,
    pub clipboard_enabled: bool,
    pub suspend_on_hide: bool,
    pub hk_toggle: String,
    pub hk_chat: String,
    pub hk_translate: String,
    pub hk_clipboard: String,
    pub hk_todo: String,
    pub auto_collapse: bool,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            base_url: "https://api.deepseek.com/v1".into(),
            api_key: String::new(),
            model: "deepseek-chat".into(),
            autostart: false,
            clipboard_enabled: true,
            suspend_on_hide: true,
            hk_toggle: "Alt+Q".into(),
            hk_chat: "Alt+A".into(),
            hk_translate: "Alt+T".into(),
            hk_clipboard: "Alt+C".into(),
            hk_todo: "Alt+D".into(),
            auto_collapse: true,
        }
    }
}

impl AppConfig {
    fn config_path(dir: &Path) -> PathBuf {
        dir.join("config.json")
    }

    /// 返回 (配置, 配置文件是否已存在)
    pub fn load(dir: &Path) -> (Self, bool) {
        let p = Self::config_path(dir);
        if p.exists() {
            if let Ok(s) = fs::read_to_string(&p) {
                if let Ok(mut c) = serde_json::from_str::<Self>(&s) {
                    // 兼容旧配置：空快捷键给默认值
                    if c.hk_toggle.trim().is_empty() {
                        c.hk_toggle = "Alt+Q".into();
                    }
                    return (c, true);
                }
            }
            return (Self::default(), true);
        }
        (Self::default(), false)
    }

    pub fn save(&self, dir: &Path) {
        let _ = fs::create_dir_all(dir);
        if let Ok(s) = serde_json::to_string_pretty(self) {
            let _ = fs::write(Self::config_path(dir), s);
        }
    }
}
