mod clipboard;
mod config;
mod db;
mod llm;

use config::AppConfig;
use db::Db;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub struct ConfigState(pub Mutex<AppConfig>);
pub struct ConfigDir(pub PathBuf);
/// true = 玩偶(最小化)形态, false = 会话窗口形态
pub struct Mode(pub AtomicBool);

// 逻辑像素尺寸
const PANEL_W: f64 = 360.0;
const PANEL_H: f64 = 600.0;
const PET_W: f64 = 88.0;
const PET_H: f64 = 100.0;
const EDGE_MARGIN: f64 = 6.0;
const PEEK: f64 = 32.0;
/// 悬停时滑出的可见宽度：小于完整宽度，保证窗口滑动后鼠标仍落在窗口内，避免闪烁
const PEEK_OUT: f64 = 56.0;

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

fn is_pet(app: &AppHandle) -> bool {
    app.state::<Mode>().0.load(Ordering::SeqCst)
}
fn set_pet(app: &AppHandle, v: bool) {
    app.state::<Mode>().0.store(v, Ordering::SeqCst);
}

/// 返回 (逻辑宽, 逻辑高, 缩放)
fn monitor_info(app: &AppHandle) -> (f64, f64, f64) {
    if let Some(w) = main_window(app) {
        for m in [w.current_monitor().ok().flatten(), w.primary_monitor().ok().flatten()] {
            if let Some(m) = m {
                let s = m.size().to_logical::<f64>(m.scale_factor());
                return (s.width, s.height, m.scale_factor());
            }
        }
    }
    (1920.0, 1080.0, 1.0)
}

fn current_logical_y(w: &WebviewWindow, scale: f64, default: f64) -> f64 {
    match w.outer_position() {
        Ok(p) => {
            let y = p.y as f64 / scale;
            if y.is_finite() && y > -2000.0 && y < 20000.0 {
                y
            } else {
                default
            }
        }
        Err(_) => default,
    }
}

/// 设置 WebView2 内存目标等级：玩偶/隐藏时置 Low 省内存，会话窗口时恢复 Normal。
#[cfg(windows)]
fn set_memory_level(app: &AppHandle, low: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
    };
    use windows::core::Interface;
    if let Some(w) = main_window(app) {
        let _ = w.with_webview(move |webview| unsafe {
            let controller = webview.controller();
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(wv19) = core.cast::<ICoreWebView2_19>() {
                    let level = if low {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                    } else {
                        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                    };
                    let _ = wv19.SetMemoryUsageTargetLevel(level);
                }
            }
        });
    }
}
#[cfg(not(windows))]
fn set_memory_level(_app: &AppHandle, _low: bool) {}

/// 关闭 Win11 DWM 自动圆角，避免与 CSS 圆角叠加产生“两层边角”瑕疵。
#[cfg(windows)]
fn disable_dwm_rounding(app: &AppHandle) {
    use windows::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
    };
    if let Some(w) = main_window(app) {
        if let Ok(hwnd) = w.hwnd() {
            unsafe {
                let pref = DWMWCP_DONOTROUND;
                let _ = DwmSetWindowAttribute(
                    hwnd,
                    DWMWA_WINDOW_CORNER_PREFERENCE,
                    &pref as *const _ as *const core::ffi::c_void,
                    std::mem::size_of_val(&pref) as u32,
                );
            }
        }
    }
}
#[cfg(not(windows))]
fn disable_dwm_rounding(_app: &AppHandle) {}

fn cfg_of(app: &AppHandle) -> AppConfig {
    let s = app.state::<ConfigState>();
    let g = s.0.lock().unwrap();
    g.clone()
}

/// 进入会话窗口形态
fn enter_panel(app: &AppHandle, nav: Option<&str>, focus_input: bool) {
    let w = match main_window(app) {
        Some(w) => w,
        None => return,
    };
    set_pet(app, false);
    let (mw, _mh, scale) = monitor_info(app);
    let y = current_logical_y(&w, scale, 90.0);
    let x = (mw - PANEL_W - EDGE_MARGIN).max(0.0);
    let _ = w.set_size(tauri::LogicalSize::new(PANEL_W, PANEL_H));
    let _ = w.set_position(tauri::LogicalPosition::new(x, y.max(0.0)));
    let _ = w.set_always_on_top(false);
    let _ = w.set_skip_taskbar(true);
    set_memory_level(app, false);
    let _ = w.show();
    let _ = w.unminimize();
    let _ = w.set_focus();
    // nav 为 None 时前端保持/恢复上次停留的模块
    let _ = w.emit(
        "mode",
        serde_json::json!({ "mode": "panel", "nav": nav, "focusInput": focus_input }),
    );
}

/// 进入玩偶浮窗形态（停靠边缘、只露一点点）
fn enter_pet(app: &AppHandle) {
    let w = match main_window(app) {
        Some(w) => w,
        None => return,
    };
    set_pet(app, true);
    let (mw, _mh, scale) = monitor_info(app);
    let y = current_logical_y(&w, scale, 120.0);
    let _ = w.set_size(tauri::LogicalSize::new(PET_W, PET_H));
    let x = mw - PEEK; // 右侧收进，只露 PEEK
    let _ = w.set_position(tauri::LogicalPosition::new(x, y.max(0.0)));
    let _ = w.set_always_on_top(true);
    let _ = w.set_skip_taskbar(true);
    let _ = w.show();
    if cfg_of(app).suspend_on_hide {
        set_memory_level(app, true);
    }
    let _ = w.emit("mode", serde_json::json!({ "mode": "pet" }));
}

/// 玩偶悬停时滑出/收回
fn do_peek(app: &AppHandle, out: bool) {
    if !is_pet(app) {
        return;
    }
    let w = match main_window(app) {
        Some(w) => w,
        None => return,
    };
    let (mw, _mh, scale) = monitor_info(app);
    let y = current_logical_y(&w, scale, 120.0);
    let cur_x = w
        .outer_position()
        .ok()
        .map(|p| p.x as f64 / scale)
        .unwrap_or(mw - PEEK);
    let near_left = cur_x < mw / 2.0;
    // 只滑出到 PEEK_OUT（小于完整宽度）：窗口滑动前后，鼠标位置始终在窗口范围内，不会触发 mouseleave 抖动
    let x = if out {
        if near_left {
            -(PET_W - PEEK_OUT)
        } else {
            mw - PEEK_OUT
        }
    } else if near_left {
        -(PET_W - PEEK)
    } else {
        mw - PEEK
    };
    let _ = w.set_position(tauri::LogicalPosition::new(x, y.max(0.0)));
}

fn toggle_mode(app: &AppHandle) {
    if is_pet(app) {
        enter_panel(app, None, false);
    } else {
        enter_pet(app);
    }
}

fn handle_hotkey(app: &AppHandle, action: &str) {
    match action {
        "toggle" => toggle_mode(app),
        "chat" => enter_panel(app, Some("chat"), true),
        "translate" => enter_panel(app, Some("translate"), false),
        "clipboard" => enter_panel(app, Some("clipboard"), false),
        "todo" => enter_panel(app, Some("todo"), false),
        _ => {}
    }
}

/// 规范化用户输入的快捷键：返回 (规范化字符串或空串, 人话错误或空串)
/// 支持：单键（1、A、F1、Space…）、组合键（Ctrl+1、Alt+Q、Shift+F1…）
fn normalize_accel(input: &str) -> (String, String) {
    let s = input.trim();
    if s.is_empty() {
        return (String::new(), String::new());
    }
    let mut mods: Vec<&str> = Vec::new();
    let mut key = String::new();
    let mut key_raw = String::new();
    for part in s.split('+') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        let low = p.to_ascii_lowercase();
        match low.as_str() {
            "ctrl" | "control" => {
                mods.push("Ctrl");
                continue;
            }
            "alt" | "option" => {
                mods.push("Alt");
                continue;
            }
            "shift" => {
                mods.push("Shift");
                continue;
            }
            "super" | "win" | "meta" | "cmd" | "command" => {
                mods.push("Super");
                continue;
            }
            _ => {}
        }
        if !key.is_empty() {
            return (
                String::new(),
                format!(
                    "「{}」无效：组合键只能是 修饰键+按键（如 Ctrl+1、Alt+Q），{} 和 {} 是两个主按键；单键请直接填一个键，如 1 或 A",
                    s, key_raw, p
                ),
            );
        }
        key_raw = p.to_string();
        let up = p.to_ascii_uppercase();
        if up.len() == 1 && up.as_bytes()[0].is_ascii_alphanumeric() {
            key = up; // 0-9 / A-Z
        } else if up.starts_with('F') && up.len() <= 3 && up[1..].chars().all(|c| c.is_ascii_digit()) && up != "F" {
            key = up; // F1..F99
        } else {
            let named = match up.as_str() {
                "SPACE" => Some("Space"),
                "ENTER" | "RETURN" => Some("Enter"),
                "TAB" => Some("Tab"),
                "ESC" | "ESCAPE" => Some("Esc"),
                "UP" => Some("Up"),
                "DOWN" => Some("Down"),
                "LEFT" => Some("Left"),
                "RIGHT" => Some("Right"),
                _ => None,
            };
            match named {
                Some(n) => key = n.to_string(),
                None => {
                    return (
                        String::new(),
                        format!("「{}」无效：无法识别按键「{}」。可用：数字/字母单键、F1-F99、Space/Enter/Tab/Esc/方向键，组合键如 Ctrl+1、Alt+Q", s, p),
                    )
                }
            }
        }
    }
    if key.is_empty() {
        return (String::new(), format!("「{}」无效：缺少主按键", s));
    }
    if mods.is_empty() {
        (key, String::new())
    } else {
        (format!("{}+{}", mods.join("+"), key), String::new())
    }
}

/// 注册全局快捷键，返回每条无效快捷键的人话提示
fn register_hotkeys(app: &AppHandle, cfg: &AppConfig) -> Vec<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let mut failed = Vec::new();
    let bindings = [
        (cfg.hk_toggle.clone(), "toggle"),
        (cfg.hk_chat.clone(), "chat"),
        (cfg.hk_translate.clone(), "translate"),
        (cfg.hk_clipboard.clone(), "clipboard"),
        (cfg.hk_todo.clone(), "todo"),
    ];
    for (raw, action) in bindings {
        let (accel, err) = normalize_accel(&raw);
        if !err.is_empty() {
            failed.push(err);
            continue;
        }
        if accel.is_empty() {
            continue; // 留空=不启用
        }
        let act = action.to_string();
        let res = gs.on_shortcut(accel.as_str(), move |app, _sc, event| {
            if event.state == ShortcutState::Pressed {
                handle_hotkey(app, &act);
            }
        });
        if res.is_err() {
            failed.push(format!("「{}」注册失败（可能被其它软件占用），请换个键", accel));
        }
    }
    failed
}

fn apply_autostart(app: &AppHandle, enable: bool) -> Result<(), String> {
    let al = app.autolaunch();
    let current = al.is_enabled().map_err(|e| e.to_string())?;
    if enable && !current {
        al.enable().map_err(|e| e.to_string())?;
    } else if !enable && current {
        al.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "会话窗口 / 玩偶", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "打开设置", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出懒羊羊", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &settings, &quit])?;

    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id("main-tray")
        .tooltip("懒羊羊")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => toggle_mode(app),
            "settings" => enter_panel(app, Some("set"), false),
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
                toggle_mode(tray.app_handle());
            }
        });
    if let Some(i) = icon {
        builder = builder.icon(i);
    }
    builder.build(app)?;
    Ok(())
}

// ---------- 命令 ----------

#[tauri::command]
fn get_config(state: tauri::State<ConfigState>) -> AppConfig {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn save_config(app: AppHandle, mut cfg: AppConfig) -> Result<Vec<String>, String> {
    // 快捷键规范化后回存（无效输入原样保留，便于用户看到并修改）
    for f in [
        &mut cfg.hk_toggle,
        &mut cfg.hk_chat,
        &mut cfg.hk_translate,
        &mut cfg.hk_clipboard,
        &mut cfg.hk_todo,
    ] {
        let (norm, err) = normalize_accel(f);
        if err.is_empty() {
            *f = norm;
        }
    }
    let dir = {
        let d = app.state::<ConfigDir>();
        d.0.clone()
    };
    cfg.save(&dir);
    {
        let s = app.state::<ConfigState>();
        let mut g = s.0.lock().unwrap();
        *g = cfg.clone();
    }
    apply_autostart(&app, cfg.autostart)?;
    let failed = register_hotkeys(&app, &cfg);
    Ok(failed)
}

#[tauri::command]
fn get_mode(app: AppHandle) -> String {
    if is_pet(&app) {
        "pet".into()
    } else {
        "panel".into()
    }
}

#[tauri::command]
fn go_panel(app: AppHandle) {
    enter_panel(&app, None, false);
}

#[tauri::command]
fn go_pet(app: AppHandle) {
    enter_pet(&app);
}

#[tauri::command]
fn pet_peek(app: AppHandle, out: bool) {
    do_peek(&app, out);
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn take_screenshot(app: AppHandle) {
    // 先收成玩偶，避免浮窗被拍进截图
    enter_pet(&app);
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(240));
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let _ = std::process::Command::new("cmd")
                .args(["/C", "start", "", "ms-screenclip:"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
        }
    });
}

#[tauri::command]
fn new_session(app: AppHandle) -> i64 {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::create_session(&conn, "新会话")
}

#[tauri::command]
fn list_sessions(app: AppHandle) -> Vec<db::Session> {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::list_sessions(&conn)
}

#[tauri::command]
fn list_messages(app: AppHandle, session_id: i64) -> Vec<db::Message> {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::list_messages(&conn, session_id)
}

#[tauri::command]
fn delete_session(app: AppHandle, session_id: i64) {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::delete_session(&conn, session_id);
}

#[tauri::command]
async fn chat_send(app: AppHandle, session_id: i64, content: String) -> Result<i64, String> {
    let cfg = cfg_of(&app);
    if cfg.api_key.trim().is_empty() {
        let m = "尚未配置 API Key，请到「设置」里填写。".to_string();
        let _ = app.emit("chat-error", m.clone());
        return Err(m);
    }
    let sid = {
        let dbs = app.state::<Db>();
        let conn = dbs.0.lock().unwrap();
        let sid = db::ensure_session(&conn, session_id);
        db::add_message(&conn, sid, "user", &content);
        db::ensure_title(&conn, sid, &content);
        sid
    };
    let history = {
        let dbs = app.state::<Db>();
        let conn = dbs.0.lock().unwrap();
        db::history_for_llm(&conn, sid, 20)
    };
    let reply = llm::stream_completion(
        &app,
        &cfg.base_url,
        &cfg.api_key,
        &cfg.model,
        history,
        "chat-token",
        "chat-done",
        "chat-error",
    )
    .await?;
    let aid = {
        let dbs = app.state::<Db>();
        let conn = dbs.0.lock().unwrap();
        db::add_message(&conn, sid, "assistant", &reply)
    };
    Ok(aid)
}

#[tauri::command]
async fn translate(app: AppHandle, text: String) -> Result<(), String> {
    let cfg = cfg_of(&app);
    if cfg.api_key.trim().is_empty() {
        let m = "尚未配置 API Key，请到「设置」里填写。".to_string();
        let _ = app.emit("trans-error", m.clone());
        return Err(m);
    }
    let sys = "你是一个翻译引擎。自动检测用户文本的语言：如果是中文，翻译成英文；如果是英文或其它语言，翻译成简体中文。只输出译文本身，不要任何解释或额外内容。".to_string();
    let messages = vec![
        llm::ChatMsg { role: "system".into(), content: sys },
        llm::ChatMsg { role: "user".into(), content: text },
    ];
    llm::stream_completion(
        &app,
        &cfg.base_url,
        &cfg.api_key,
        &cfg.model,
        messages,
        "trans-token",
        "trans-done",
        "trans-error",
    )
    .await?;
    Ok(())
}

#[tauri::command]
fn list_clipboard(app: AppHandle) -> Vec<db::ClipItem> {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::list_clipboard(&conn)
}

#[tauri::command]
fn clear_clipboard(app: AppHandle) {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::clear_clipboard(&conn);
}

#[tauri::command]
fn delete_clip(app: AppHandle, id: i64) {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::delete_clip(&conn, id);
}

#[tauri::command]
fn copy_to_clipboard(_app: AppHandle, text: String) {
    if let Ok(mut c) = arboard::Clipboard::new() {
        let _ = c.set_text(text);
    }
}

// ---------- 待办 ----------

#[tauri::command]
fn list_todos(app: AppHandle) -> Vec<db::Todo> {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::list_todos(&conn)
}

#[tauri::command]
fn add_todo(app: AppHandle, content: String) -> i64 {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::add_todo(&conn, &content)
}

#[tauri::command]
fn toggle_todo(app: AppHandle, id: i64) {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::toggle_todo(&conn, id);
}

#[tauri::command]
fn delete_todo(app: AppHandle, id: i64) {
    let dbs = app.state::<Db>();
    let conn = dbs.0.lock().unwrap();
    db::delete_todo(&conn, id);
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            enter_panel(app, None, false);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--collapsed"]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_mode,
            go_panel,
            go_pet,
            pet_peek,
            quit_app,
            take_screenshot,
            new_session,
            list_sessions,
            list_messages,
            delete_session,
            chat_send,
            translate,
            list_clipboard,
            clear_clipboard,
            delete_clip,
            copy_to_clipboard,
            list_todos,
            add_todo,
            toggle_todo,
            delete_todo
        ])
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                enter_pet(window.app_handle());
            }
            tauri::WindowEvent::Focused(false) => {
                let app = window.app_handle();
                let auto = {
                    let s = app.state::<ConfigState>();
                    let g = s.0.lock().unwrap();
                    g.auto_collapse
                };
                if auto && !is_pet(app) {
                    enter_pet(app);
                }
            }
            _ => {}
        })
        .setup(|app| {
            let handle = app.handle().clone();

            // 便携模式：数据存放在 exe 同目录（程序与数据都在 D 盘）
            let dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.to_path_buf()))
                .unwrap_or_else(|| app.path().app_config_dir().expect("config dir"));
            let _ = std::fs::create_dir_all(&dir);

            let (cfg, _existed) = AppConfig::load(&dir);

            let db_path = dir.join("lazygoat.db");
            let conn = rusqlite::Connection::open(&db_path).expect("open db");
            db::init(&conn);

            app.manage(Db(Mutex::new(conn)));
            app.manage(ConfigState(Mutex::new(cfg.clone())));
            app.manage(ConfigDir(dir));
            app.manage(Mode(AtomicBool::new(false)));

            disable_dwm_rounding(&handle);
            let _ = apply_autostart(&handle, cfg.autostart);
            if let Some(w) = main_window(&handle) {
                let _ = w.set_skip_taskbar(true);
            }

            setup_tray(&handle)?;
            let _ = register_hotkeys(&handle, &cfg);
            clipboard::spawn_monitor(handle.clone());

            // 开机自启(--collapsed)则以玩偶形态启动，否则展开会话窗口（恢复上次模块）
            if std::env::args().any(|a| a == "--collapsed") {
                enter_pet(&handle);
            } else {
                enter_panel(&handle, None, false);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
