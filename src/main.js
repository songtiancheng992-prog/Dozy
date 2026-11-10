const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let cfg = null;
let mode = "panel";
let curSession = 0;
let chatBusy = false;
let trTimer = null;
let trBusy = false;

// ---------- 工具 ----------
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

function esc(t) {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function renderMd(text) {
  let s = esc(text);
  s = s.replace(/```([\s\S]*?)```/g, (m, code) => "<pre><code>" + code.replace(/^\n/, "") + "</code></pre>");
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return s;
}
function relTime(ts) {
  const d = Math.floor(Date.now() / 1000 - ts);
  if (d < 60) return "刚刚";
  if (d < 3600) return Math.floor(d / 60) + "分钟前";
  if (d < 86400) return Math.floor(d / 3600) + "小时前";
  return Math.floor(d / 86400) + "天前";
}

// ---------- 形态切换（窗口 / 玩偶） ----------
function savedTab() { return localStorage.getItem("lg-tab") || "chat"; }
function applyMode(m, nav, focusInput) {
  mode = m;
  document.body.classList.toggle("pet-mode", m === "pet");
  if (m === "panel") {
    if (nav) switchTab(nav);
    if (focusInput) setTimeout(() => $("#chat-input").focus(), 90);
  }
}
listen("mode", (e) => {
  const p = e.payload || {};
  applyMode(p.mode || "panel", p.nav, p.focusInput);
});

// ---------- 标签切换（记住上次停留的模块） ----------
function switchTab(v) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.v === v));
  $$(".view").forEach((s) => s.classList.toggle("active", s.dataset.view === v));
  localStorage.setItem("lg-tab", v);
  if (v === "clipboard") loadClipboard();
  if (v === "todo") loadTodos();
}
$$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.v)));

// ---------- 标题栏 ----------
$("#btn-min").addEventListener("click", () => invoke("go_pet"));
$("#btn-shot").addEventListener("click", () => invoke("take_screenshot"));

// ---------- 玩偶浮窗交互：单击展开，按住拖动 ----------
(function () {
  const pet = $("#pet");
  let down = null;
  pet.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, dragged: false };
  });
  pet.addEventListener("pointermove", (e) => {
    if (!down || down.dragged) return;
    if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 8) {
      down.dragged = true;
      try { window.__TAURI__.window.getCurrentWindow().startDragging(); } catch (err) {}
    }
  });
  pet.addEventListener("pointerup", (e) => {
    const d = down;
    down = null;
    if (!d || d.dragged) return;
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 8) invoke("go_panel");
  });
  pet.addEventListener("mouseleave", () => { down = null; });
  let peekTimer = null;
  pet.addEventListener("mouseenter", () => {
    clearTimeout(peekTimer);
    invoke("pet_peek", { out: true });
  });
  pet.addEventListener("mouseleave", () => {
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => invoke("pet_peek", { out: false }), 400);
  });
})();

// ---------- 对话 ----------
function addBubble(role, text, isErr) {
  const log = $("#chat-log");
  const empty = log.querySelector(".empty");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.className = "msg " + (isErr ? "err" : role === "user" ? "user" : "bot");
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function loadSessions() {
  const list = await invoke("list_sessions");
  const sel = $("#sess-select");
  sel.innerHTML = "";
  if (list.length === 0) {
    curSession = await invoke("new_session");
    list.push({ id: curSession, title: "新会话" });
  }
  list.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.title || "新会话";
    sel.appendChild(o);
  });
  curSession = list[0].id;
  sel.value = curSession;
  await loadMessages();
}

async function loadMessages() {
  const msgs = await invoke("list_messages", { sessionId: curSession });
  const log = $("#chat-log");
  log.innerHTML = "";
  if (msgs.length === 0) {
    log.innerHTML = '<div class="empty">开始和懒羊羊聊天吧～</div>';
    return;
  }
  msgs.forEach((m) => {
    const div = document.createElement("div");
    div.className = "msg " + (m.role === "user" ? "user" : "bot");
    if (m.role === "user") div.textContent = m.content;
    else div.innerHTML = renderMd(m.content);
    log.appendChild(div);
  });
  log.scrollTop = log.scrollHeight;
}

$("#sess-select").addEventListener("change", async (e) => {
  curSession = parseInt(e.target.value);
  await loadMessages();
});
$("#btn-new-sess").addEventListener("click", async () => {
  curSession = await invoke("new_session");
  await loadSessions();
  $("#sess-select").value = curSession;
  await loadMessages();
});
$("#btn-del-sess").addEventListener("click", async () => {
  if (!curSession) return;
  await invoke("delete_session", { sessionId: curSession });
  curSession = 0;
  await loadSessions();
});

async function sendChat() {
  const input = $("#chat-input");
  const text = input.value.trim();
  if (!text || chatBusy) return;
  input.value = "";
  addBubble("user", text);
  chatBusy = true;
  $("#btn-send").disabled = true;
  $("#chat-status").textContent = "思考中…";
  const bot = addBubble("assistant", "");
  bot.dataset.streaming = "1";
  try {
    await invoke("chat_send", { sessionId: curSession, content: text });
  } catch (e) {}
}

$("#btn-send").addEventListener("click", sendChat);
$("#chat-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

let streamBubble = null;
listen("chat-token", (e) => {
  const log = $("#chat-log");
  if (!streamBubble || streamBubble.dataset.done === "1") {
    streamBubble = log.querySelector('.msg.bot[data-streaming="1"]:last-of-type');
  }
  if (streamBubble) {
    streamBubble.textContent += e.payload;
    log.scrollTop = log.scrollHeight;
  }
});
listen("chat-done", () => {
  if (streamBubble) {
    const raw = streamBubble.textContent;
    streamBubble.innerHTML = renderMd(raw);
    streamBubble.dataset.done = "1";
    streamBubble.removeAttribute("data-streaming");
  }
  streamBubble = null;
  chatBusy = false;
  $("#btn-send").disabled = false;
  $("#chat-status").textContent = "就绪";
  loadSessionsKeep();
});
listen("chat-error", (e) => {
  addBubble("", e.payload, true);
  if (streamBubble) { streamBubble.remove(); streamBubble = null; }
  chatBusy = false;
  $("#btn-send").disabled = false;
  $("#chat-status").textContent = "就绪";
});
async function loadSessionsKeep() {
  const keep = curSession;
  const list = await invoke("list_sessions");
  const sel = $("#sess-select");
  sel.innerHTML = "";
  list.forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id; o.textContent = s.title || "新会话";
    sel.appendChild(o);
  });
  sel.value = keep;
}

// ---------- 翻译 ----------
function doTranslate() {
  const text = $("#tr-input").value.trim();
  if (!text || trBusy) return;
  trBusy = true;
  $("#tr-status").textContent = "翻译中…";
  $("#tr-output").textContent = "";
  trOut = "";
  invoke("translate", { text }).catch(() => {});
}
$("#tr-input").addEventListener("input", () => {
  clearTimeout(trTimer);
  trTimer = setTimeout(doTranslate, 700);
});
$("#tr-input").addEventListener("paste", () => {
  clearTimeout(trTimer);
  trTimer = setTimeout(doTranslate, 120);
});
let trOut = "";
listen("trans-token", (e) => {
  trOut += e.payload;
  $("#tr-output").textContent = trOut;
});
listen("trans-done", () => {
  trBusy = false;
  $("#tr-status").textContent = "就绪";
});
listen("trans-error", (e) => {
  trBusy = false;
  $("#tr-status").textContent = "就绪";
  $("#tr-output").textContent = "⚠ " + e.payload;
});
$("#tr-copy").addEventListener("click", () => {
  const t = $("#tr-output").textContent;
  if (t) invoke("copy_to_clipboard", { text: t });
});
$("#tr-tochat").addEventListener("click", () => {
  const t = $("#tr-output").textContent.trim();
  if (!t) return;
  switchTab("chat");
  $("#chat-input").value = t;
  $("#chat-input").focus();
});

// ---------- 剪贴板 ----------
let clipExpanded = 0;
async function loadClipboard() {
  clipExpanded = 0;
  const list = await invoke("list_clipboard");
  const box = $("#clip-list");
  box.innerHTML = "";
  if (list.length === 0) {
    box.innerHTML = '<div class="empty">暂无记录，去别处复制点内容试试～</div>';
    return;
  }
  list.forEach((it) => {
    const row = document.createElement("div");
    row.className = "cb-item";
    const txt = document.createElement("div");
    txt.className = "cb-txt";
    txt.textContent = it.content;
    const time = document.createElement("div");
    time.className = "cb-time";
    time.textContent = relTime(it.created_at);
    const copy = document.createElement("div");
    copy.className = "cb-copy";
    copy.textContent = "复制";
    copy.addEventListener("click", (e) => {
      e.stopPropagation();
      invoke("copy_to_clipboard", { text: it.content });
      copy.textContent = "已复制 ✓";
      setTimeout(() => (copy.textContent = "复制"), 900);
    });
    const send = document.createElement("div");
    send.className = "cb-send";
    send.textContent = "送入";
    send.addEventListener("click", (e) => {
      e.stopPropagation();
      switchTab("chat");
      $("#chat-input").value = it.content;
      $("#chat-input").focus();
    });
    // 单击行：复制 + 展开/收起详情
    row.addEventListener("click", () => {
      invoke("copy_to_clipboard", { text: it.content });
      if (clipExpanded === it.id) {
        collapseDetail(box);
        return;
      }
      collapseDetail(box);
      clipExpanded = it.id;
      row.classList.add("expanded");
      const detail = document.createElement("div");
      detail.className = "cb-detail";
      const del = document.createElement("div");
      del.className = "cb-del";
      del.textContent = "删除";
      del.addEventListener("click", async (e) => {
        e.stopPropagation();
        await invoke("delete_clip", { id: it.id });
        clipExpanded = 0;
        loadClipboard();
      });
      const full = document.createElement("div");
      full.className = "cb-full";
      full.textContent = it.content;
      detail.appendChild(del);
      detail.appendChild(full);
      row.after(detail);
    });
    row.appendChild(txt);
    row.appendChild(time);
    row.appendChild(copy);
    row.appendChild(send);
    box.appendChild(row);
  });
}
function collapseDetail(box) {
  box.querySelectorAll(".cb-detail").forEach((d) => d.remove());
  box.querySelectorAll(".cb-item.expanded").forEach((r) => r.classList.remove("expanded"));
  clipExpanded = 0;
}
$("#clip-clear").addEventListener("click", async () => {
  await invoke("clear_clipboard");
  loadClipboard();
});
listen("clip-updated", () => {
  if ($('.view[data-view="clipboard"]').classList.contains("active")) loadClipboard();
});

// ---------- 待办 ----------
async function loadTodos() {
  const list = await invoke("list_todos");
  const box = $("#todo-list");
  box.innerHTML = "";
  if (list.length === 0) {
    box.innerHTML = '<div class="empty">暂无待办，添加一条吧～</div>';
    return;
  }
  list.forEach((t) => {
    const row = document.createElement("div");
    row.className = "todo-item" + (t.done ? " done" : "");
    const chk = document.createElement("div");
    chk.className = "todo-check";
    chk.textContent = "✓";
    chk.addEventListener("click", async () => {
      await invoke("toggle_todo", { id: t.id });
      loadTodos();
    });
    const txt = document.createElement("div");
    txt.className = "todo-txt";
    txt.textContent = t.content;
    const del = document.createElement("div");
    del.className = "todo-del";
    del.textContent = "🗑";
    del.addEventListener("click", async () => {
      await invoke("delete_todo", { id: t.id });
      loadTodos();
    });
    row.appendChild(chk);
    row.appendChild(txt);
    row.appendChild(del);
    box.appendChild(row);
  });
}
async function addTodo() {
  const inp = $("#todo-input");
  const v = inp.value.trim();
  if (!v) return;
  await invoke("add_todo", { content: v });
  inp.value = "";
  loadTodos();
}
$("#todo-add").addEventListener("click", addTodo);
$("#todo-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addTodo(); }
});

// ---------- 设置 ----------
function setSw(id, on) { $(id).classList.toggle("off", !on); }
function getSw(id) { return !$(id).classList.contains("off"); }
$$(".sw").forEach((s) => s.addEventListener("click", () => s.classList.toggle("off")));

function fillSettings() {
  $("#cfg-url").value = cfg.base_url;
  $("#cfg-key").value = cfg.api_key;
  $("#cfg-model").value = cfg.model;
  $("#hk-toggle").value = cfg.hk_toggle;
  $("#hk-chat").value = cfg.hk_chat;
  $("#hk-translate").value = cfg.hk_translate;
  $("#hk-clipboard").value = cfg.hk_clipboard;
  $("#hk-todo").value = cfg.hk_todo;
  setSw("#sw-autostart", cfg.autostart);
  setSw("#sw-collapse", cfg.auto_collapse);
  setSw("#sw-clip", cfg.clipboard_enabled);
  setSw("#sw-suspend", cfg.suspend_on_hide);
}

async function saveSettings() {
  cfg.base_url = $("#cfg-url").value.trim();
  cfg.api_key = $("#cfg-key").value.trim();
  cfg.model = $("#cfg-model").value.trim();
  cfg.hk_toggle = $("#hk-toggle").value.trim();
  cfg.hk_chat = $("#hk-chat").value.trim();
  cfg.hk_translate = $("#hk-translate").value.trim();
  cfg.hk_clipboard = $("#hk-clipboard").value.trim();
  cfg.hk_todo = $("#hk-todo").value.trim();
  cfg.autostart = getSw("#sw-autostart");
  cfg.auto_collapse = getSw("#sw-collapse");
  cfg.clipboard_enabled = getSw("#sw-clip");
  cfg.suspend_on_hide = getSw("#sw-suspend");
  const btn = $("#btn-save");
  const errBox = $("#hk-error");
  errBox.textContent = "";
  try {
    const failed = await invoke("save_config", { cfg });
    if (failed && failed.length) {
      errBox.textContent = failed.join("；");
      btn.textContent = "已保存，部分快捷键无效";
      setTimeout(() => (btn.textContent = "保存设置"), 3000);
    } else {
      btn.textContent = "已保存 ✓";
      setTimeout(() => (btn.textContent = "保存设置"), 1200);
    }
  } catch (e) {
    btn.textContent = "保存失败";
    setTimeout(() => (btn.textContent = "保存设置"), 1500);
  }
}
$("#btn-save").addEventListener("click", saveSettings);
$("#btn-quit").addEventListener("click", () => invoke("quit_app"));

// 快捷键为自由文本输入（如 A / 5 / Ctrl+Q / Alt+T），保存时由后端校验

// ---------- 启动 ----------
(async function init() {
  cfg = await invoke("get_config");
  fillSettings();
  await loadSessions();
  const m = await invoke("get_mode");
  applyMode(m, null, false);
  if (m === "panel") switchTab(savedTab());
})();
