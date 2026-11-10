use crate::db::{self, Db};
use crate::ConfigState;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// 后台线程：轮询系统剪贴板，文字变化即入库（最多 30 条），并通知前端刷新。
pub fn spawn_monitor(app: AppHandle) {
    thread::spawn(move || {
        let mut clip = match arboard::Clipboard::new() {
            Ok(c) => c,
            Err(_) => return,
        };
        let mut last = clip.get_text().unwrap_or_default();
        loop {
            thread::sleep(Duration::from_millis(800));

            let enabled = {
                let cfg = app.state::<ConfigState>();
                let g = cfg.0.lock().unwrap();
                g.clipboard_enabled
            };

            let text = match clip.get_text() {
                Ok(t) => t,
                Err(_) => continue,
            };

            if text == last {
                continue;
            }
            last = text.clone();

            if !enabled {
                continue;
            }
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }

            {
                let dbs = app.state::<Db>();
                let conn = dbs.0.lock().unwrap();
                db::add_clipboard(&conn, trimmed);
            }
            let _ = app.emit("clip-updated", ());
        }
    });
}
