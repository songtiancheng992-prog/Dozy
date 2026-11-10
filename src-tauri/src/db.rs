use crate::llm::ChatMsg;
use rusqlite::{Connection, params};
use serde::Serialize;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct Db(pub Mutex<Connection>);

#[derive(Serialize, Clone)]
pub struct Session {
    pub id: i64,
    pub title: String,
    pub created_at: i64,
}

#[derive(Serialize, Clone)]
pub struct Message {
    pub id: i64,
    pub session_id: i64,
    pub role: String,
    pub content: String,
    pub created_at: i64,
}

#[derive(Serialize, Clone)]
pub struct ClipItem {
    pub id: i64,
    pub content: String,
    pub created_at: i64,
}

#[derive(Serialize, Clone)]
pub struct Todo {
    pub id: i64,
    pub content: String,
    pub done: bool,
    pub created_at: i64,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn init(conn: &Connection) {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL DEFAULT '新会话',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
        CREATE TABLE IF NOT EXISTS clipboard (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            done INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        );",
    )
    .expect("init db");
}

pub fn create_session(conn: &Connection, title: &str) -> i64 {
    conn.execute(
        "INSERT INTO sessions (title, created_at) VALUES (?1, ?2)",
        params![title, now()],
    )
    .ok();
    conn.last_insert_rowid()
}

pub fn ensure_session(conn: &Connection, id: i64) -> i64 {
    if id <= 0 {
        return create_session(conn, "新会话");
    }
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sessions WHERE id=?1)",
            params![id],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if exists {
        id
    } else {
        create_session(conn, "新会话")
    }
}

pub fn list_sessions(conn: &Connection) -> Vec<Session> {
    let mut stmt = conn
        .prepare("SELECT id, title, created_at FROM sessions ORDER BY id DESC")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok(Session {
                id: r.get(0)?,
                title: r.get(1)?,
                created_at: r.get(2)?,
            })
        })
        .unwrap();
    rows.filter_map(|x| x.ok()).collect()
}

pub fn delete_session(conn: &Connection, id: i64) {
    conn.execute("DELETE FROM messages WHERE session_id=?1", params![id])
        .ok();
    conn.execute("DELETE FROM sessions WHERE id=?1", params![id]).ok();
}

pub fn add_message(conn: &Connection, session_id: i64, role: &str, content: &str) -> i64 {
    conn.execute(
        "INSERT INTO messages (session_id, role, content, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![session_id, role, content, now()],
    )
    .ok();
    conn.last_insert_rowid()
}

pub fn list_messages(conn: &Connection, session_id: i64) -> Vec<Message> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, created_at FROM messages WHERE session_id=?1 ORDER BY id ASC",
        )
        .unwrap();
    let rows = stmt
        .query_map(params![session_id], |r| {
            Ok(Message {
                id: r.get(0)?,
                session_id: r.get(1)?,
                role: r.get(2)?,
                content: r.get(3)?,
                created_at: r.get(4)?,
            })
        })
        .unwrap();
    rows.filter_map(|x| x.ok()).collect()
}

/// 取最近 n 条消息作为大模型上下文
pub fn history_for_llm(conn: &Connection, session_id: i64, n: usize) -> Vec<ChatMsg> {
    let all = list_messages(conn, session_id);
    let start = all.len().saturating_sub(n);
    all[start..]
        .iter()
        .map(|m| ChatMsg {
            role: m.role.clone(),
            content: m.content.clone(),
        })
        .collect()
}

/// 首条用户消息作为会话标题
pub fn ensure_title(conn: &Connection, session_id: i64, first_user_text: &str) {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM messages WHERE session_id=?1",
            params![session_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    if count <= 1 {
        let t: String = first_user_text.chars().take(18).collect();
        let t = t.trim().replace('\n', " ");
        if !t.is_empty() {
            conn.execute(
                "UPDATE sessions SET title=?1 WHERE id=?2",
                params![t, session_id],
            )
            .ok();
        }
    }
}

pub fn add_clipboard(conn: &Connection, content: &str) {
    // 与最近一条重复则跳过，避免程序化复制造成的连续重复
    let latest: Option<String> = conn
        .query_row(
            "SELECT content FROM clipboard ORDER BY id DESC LIMIT 1",
            [],
            |r| r.get(0),
        )
        .ok();
    if latest.as_deref() == Some(content) {
        return;
    }
    conn.execute(
        "INSERT INTO clipboard (content, created_at) VALUES (?1, ?2)",
        params![content, now()],
    )
    .ok();
    conn.execute(
        "DELETE FROM clipboard WHERE id NOT IN (SELECT id FROM clipboard ORDER BY id DESC LIMIT 30)",
        [],
    )
    .ok();
}

pub fn list_clipboard(conn: &Connection) -> Vec<ClipItem> {
    let mut stmt = conn
        .prepare("SELECT id, content, created_at FROM clipboard ORDER BY id DESC")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok(ClipItem {
                id: r.get(0)?,
                content: r.get(1)?,
                created_at: r.get(2)?,
            })
        })
        .unwrap();
    rows.filter_map(|x| x.ok()).collect()
}

pub fn clear_clipboard(conn: &Connection) {
    conn.execute("DELETE FROM clipboard", []).ok();
}

pub fn delete_clip(conn: &Connection, id: i64) {
    conn.execute("DELETE FROM clipboard WHERE id=?1", params![id]).ok();
}

// ---------- 待办 ----------

pub fn list_todos(conn: &Connection) -> Vec<Todo> {
    let mut stmt = conn
        .prepare("SELECT id, content, done, created_at FROM todos ORDER BY done ASC, id DESC")
        .unwrap();
    let rows = stmt
        .query_map([], |r| {
            Ok(Todo {
                id: r.get(0)?,
                content: r.get(1)?,
                done: r.get::<_, i64>(2)? != 0,
                created_at: r.get(3)?,
            })
        })
        .unwrap();
    rows.filter_map(|x| x.ok()).collect()
}

pub fn add_todo(conn: &Connection, content: &str) -> i64 {
    conn.execute(
        "INSERT INTO todos (content, done, created_at) VALUES (?1, 0, ?2)",
        params![content, now()],
    )
    .ok();
    conn.last_insert_rowid()
}

pub fn toggle_todo(conn: &Connection, id: i64) {
    conn.execute(
        "UPDATE todos SET done = CASE WHEN done=0 THEN 1 ELSE 0 END WHERE id=?1",
        params![id],
    )
    .ok();
}

pub fn delete_todo(conn: &Connection, id: i64) {
    conn.execute("DELETE FROM todos WHERE id=?1", params![id])
        .ok();
}
