use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
pub struct ChatMsg {
    pub role: String,
    pub content: String,
}

/// 向 OpenAI 兼容接口发起流式对话，边收边通过事件推给前端。
/// 返回完整的助手回复文本。
pub async fn stream_completion(
    app: &AppHandle,
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMsg>,
    token_event: &str,
    done_event: &str,
    err_event: &str,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": true,
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let m = format!("网络请求失败：{}", e);
            let _ = app.emit(err_event, m.clone());
            m
        })?;

    if !resp.status().is_success() {
        let code = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let m = format!("接口返回 {}：{}", code, truncate(&text, 300));
        let _ = app.emit(err_event, m.clone());
        return Err(m);
    }

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut full = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| {
            let m = format!("流读取中断：{}", e);
            let _ = app.emit(err_event, m.clone());
            m
        })?;
        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(pos) = buf.find('\n') {
            let line: String = buf.drain(..=pos).collect();
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let data = match line.strip_prefix("data:") {
                Some(d) => d.trim(),
                None => continue,
            };
            if data == "[DONE]" {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(data) {
                if let Some(delta) = v
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta"))
                    .and_then(|d| d.get("content"))
                    .and_then(|d| d.as_str())
                {
                    if !delta.is_empty() {
                        full.push_str(delta);
                        let _ = app.emit(token_event, delta.to_string());
                    }
                }
            }
        }
    }

    let _ = app.emit(done_event, full.clone());
    Ok(full)
}

/// 非流式一次性补全（用于自动记忆总结等后台小任务）
pub async fn complete_once(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMsg>,
) -> Result<String, String> {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "stream": false,
    });
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("网络请求失败：{}", e))?;
    if !resp.status().is_success() {
        return Err(format!("接口返回 {}", resp.status()));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("")
        .to_string())
}

fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        s.chars().take(n).collect::<String>() + "…"
    }
}
