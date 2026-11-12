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
function savedTab() {
  const v = localStorage.getItem("lg-tab") || "chat";
  return v === "set" ? "chat" : v;
}
function applyMode(m, nav, focusInput, expanded) {
  mode = m;
  document.body.classList.toggle("pet-mode", m === "pet");
  if (typeof expanded === "boolean") document.body.classList.toggle("big", expanded);
  if (m === "panel") {
    if (nav) switchTab(nav);
    if (focusInput) setTimeout(() => $("#chat-input").focus(), 90);
  }
}
listen("mode", (e) => {
  const p = e.payload || {};
  applyMode(p.mode || "panel", p.nav, p.focusInput, p.expanded);
});

// ---------- 标签切换（记住上次停留的模块） ----------
function switchTab(v) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.v === v));
  $$(".view").forEach((s) => s.classList.toggle("active", s.dataset.view === v));
  if (v !== "set") localStorage.setItem("lg-tab", v);
  if (v === "clipboard") loadClipboard();
  if (v === "todo") loadTodos();
  if (v === "set") refreshMemory();
}
$$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.v)));

// ---------- 标题栏 ----------
$("#btn-min").addEventListener("click", () => invoke("go_pet"));
$("#btn-shot").addEventListener("click", () => invoke("take_screenshot"));
$("#btn-set").addEventListener("click", () => switchTab("set"));
$("#btn-set-back").addEventListener("click", () => switchTab(savedTab()));
$("#btn-expand").addEventListener("click", async () => {
  const big = await invoke("toggle_expand");
  document.body.classList.toggle("big", big);
  $("#btn-expand").classList.toggle("on", big);
});
// 屏幕录像：⏺ 开始 / ⏹ 停止（首次自动下载编码组件）
let recording = false;
$("#btn-rec").addEventListener("click", async () => {
  const btn = $("#btn-rec");
  if (recording) {
    btn.textContent = "…";
    try { await invoke("toggle_record"); } catch (e) {}
    recording = false;
    btn.classList.remove("rec");
    btn.textContent = "⏺";
    btn.title = "开始 / 停止屏幕录像";
    return;
  }
  btn.textContent = "…";
  btn.title = "正在启动系统自带录像…";
  try {
    const r = await invoke("toggle_record");
    recording = !!r.recording;
    btn.classList.toggle("rec", recording);
    btn.textContent = recording ? "⏹" : "⏺";
    btn.title = recording ? (r.note || "停止录像并保存") : "开始 / 停止屏幕录像（系统自带）";
  } catch (e) {
    recording = false;
    btn.classList.remove("rec");
    btn.textContent = "⏺";
    btn.title = "录像失败：" + e;
  }
});

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

// ---------- 计算器（纯本地，安全表达式解析，不用 eval） ----------
function evalExpr(src) {
  // 词法 + 递归下降解析：+ - * / % 括号 小数；% 作为后缀取百分
  let i = 0;
  const s = src.replace(/\s+/g, "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  if (!s) throw new Error("empty");
  function peek() { return s[i]; }
  function parseExpr() {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = s[i++];
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() === "*" || peek() === "/") {
      const op = s[i++];
      const r = parseFactor();
      if (op === "/" && r === 0) throw new Error("除数为 0");
      v = op === "*" ? v * r : v / r;
    }
    return v;
  }
  function parseFactor() {
    if (peek() === "(") {
      i++;
      const v = parseExpr();
      if (peek() !== ")") throw new Error("括号不匹配");
      i++;
      return parsePostfix(v);
    }
    if (peek() === "-") { i++; return -parseFactor(); }
    if (peek() === "+") { i++; return parseFactor(); }
    const m = /^\d*\.?\d+/.exec(s.slice(i));
    if (!m) throw new Error("语法错误");
    i += m[0].length;
    return parsePostfix(parseFloat(m[0]));
  }
  function parsePostfix(v) {
    while (peek() === "%") { i++; v = v / 100; }
    return v;
  }
  const v = parseExpr();
  if (i !== s.length) throw new Error("语法错误");
  if (!isFinite(v)) throw new Error("结果无效");
  return v;
}
function fmtNum(v) {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  const r = parseFloat(v.toPrecision(12));
  return String(r);
}
let calcHist = [];
try { calcHist = JSON.parse(localStorage.getItem("lg-calc-hist") || "[]"); } catch (e) {}
function renderCalcHist() {
  const box = $("#calc-hist");
  box.innerHTML = "";
  if (!calcHist.length) { box.innerHTML = '<div class="empty">暂无历史</div>'; return; }
  calcHist.forEach((h) => {
    const d = document.createElement("div");
    d.className = "calc-hist-item";
    d.textContent = h.expr + " = " + h.res;
    d.title = "点击填入";
    d.addEventListener("click", () => { $("#calc-expr").value = h.expr; calcPreview(); });
    box.appendChild(d);
  });
}
function calcPreview() {
  const src = $("#calc-expr").value.trim();
  const pv = $("#calc-preview");
  if (!src) { pv.textContent = ""; return; }
  try { pv.textContent = "= " + fmtNum(evalExpr(src)); } catch (e) { pv.textContent = ""; }
}
function calcCommit() {
  const src = $("#calc-expr").value.trim();
  if (!src) return;
  try {
    const res = fmtNum(evalExpr(src));
    calcHist.unshift({ expr: src, res });
    calcHist = calcHist.slice(0, 8);
    localStorage.setItem("lg-calc-hist", JSON.stringify(calcHist));
    $("#calc-expr").value = res;
    $("#calc-preview").textContent = "";
    renderCalcHist();
  } catch (e) {
    $("#calc-preview").textContent = "⚠ " + e.message;
  }
}
$$(".ck").forEach((k) => k.addEventListener("click", () => {
  const key = k.dataset.k;
  const inp = $("#calc-expr");
  if (key === "C") { inp.value = ""; }
  else if (key === "back") { inp.value = inp.value.slice(0, -1); }
  else if (key === "=") { calcCommit(); return; }
  else { inp.value += key; }
  calcPreview();
  inp.focus();
}));
$("#calc-expr").addEventListener("input", calcPreview);
$("#calc-expr").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); calcCommit(); }
});
renderCalcHist();

// 计算 / 换算 子页切换
$$(".calc-mode").forEach((m) => m.addEventListener("click", () => {
  $$(".calc-mode").forEach((x) => x.classList.toggle("active", x === m));
  const isCalc = m.dataset.cm === "calc";
  $("#calc-pane").style.display = isCalc ? "" : "none";
  $("#conv-pane").style.display = isCalc ? "none" : "";
  if (isCalc) $("#calc-expr").focus();
}));

// ---------- 单位换算（纯本地） ----------
const CONV = {
  "长度": { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.344, yd: 0.9144, ft: 0.3048, in: 0.0254, "海里": 1852, "里": 500, "丈": 10 / 3, "尺": 1 / 3, "寸": 1 / 30 },
  "重量": { kg: 1, g: 0.001, mg: 0.000001, t: 1000, lb: 0.45359237, oz: 0.028349523125, "斤": 0.5, "两": 0.05, "钱": 0.005 },
  "面积": { "m²": 1, "km²": 1e6, "cm²": 0.0001, "公顷": 1e4, "亩": 2000 / 3, "ft²": 0.09290304, "in²": 0.00064516, "英亩": 4046.8564224 },
  "体积": { "m³": 1, L: 0.001, mL: 0.000001, "gal(美)": 0.003785411784, "qt(美)": 0.000946352946, "ft³": 0.028316846592, "in³": 0.000016387064 },
  "数据存储": { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776, bit: 0.125 },
  "时间": { s: 1, ms: 0.001, min: 60, h: 3600, d: 86400, wk: 604800 },
  "速度": { "m/s": 1, "km/h": 1 / 3.6, "mph": 0.44704, "kn": 0.514444444, "ft/s": 0.3048 },
};
const CONV_NAMES = {
  m: "米", km: "千米", cm: "厘米", mm: "毫米", mi: "英里", yd: "码", ft: "英尺", in: "英寸",
  kg: "千克", g: "克", mg: "毫克", t: "吨", lb: "磅", oz: "盎司",
  s: "秒", ms: "毫秒", min: "分钟", h: "小时", d: "天", wk: "周",
  B: "字节", KB: "千字节", MB: "兆字节", GB: "吉字节", TB: "太字节", bit: "比特",
  L: "升", mL: "毫升",
  "m²": "平方米", "km²": "平方千米", "cm²": "平方厘米", "ft²": "平方英尺", "in²": "平方英寸",
  "m³": "立方米", "gal(美)": "美加仑", "qt(美)": "美夸脱", "ft³": "立方英尺", "in³": "立方英寸",
  "m/s": "米/秒", "km/h": "千米/时", mph: "英里/时", kn: "节", "ft/s": "英尺/秒",
  "°C": "摄氏度", "°F": "华氏度", K: "开尔文",
};
const FX_NAMES = {
  CNY: "人民币", USD: "美元", EUR: "欧元", JPY: "日元", GBP: "英镑", HKD: "港币",
  KRW: "韩元", TWD: "新台币", SGD: "新加坡元", AUD: "澳元", CAD: "加元", CHF: "瑞士法郎",
  RUB: "卢布", INR: "印度卢比", BRL: "雷亚尔", MXN: "墨西哥比索", THB: "泰铢", VND: "越南盾",
};
function unitLabel(u) { return CONV_NAMES[u] ? u + "（" + CONV_NAMES[u] + "）" : u; }
function fxLabel(u) { return FX_NAMES[u] ? u + "（" + FX_NAMES[u] + "）" : u; }
// 汇率（免费接口，本地缓存 12h）
let fxRates = null, fxTime = 0;
const COMMON_FX = ["CNY", "USD", "EUR", "JPY", "GBP", "HKD", "KRW", "TWD", "SGD", "AUD", "CAD", "CHF", "RUB", "INR", "BRL", "MXN", "THB", "VND"];
async function loadFx(force) {
  const v = await invoke("get_fx", { force });
  fxRates = v.rates || {};
  fxTime = v.t || 0;
}
async function fillConvUnits() {
  const cat = $("#conv-cat").value;
  const isFx = cat === "汇率";
  $("#conv-fx-refresh").style.display = isFx ? "" : "none";
  let units;
  if (isFx) {
    try { await loadFx(false); } catch (e) { fxRates = null; }
    units = fxRates ? COMMON_FX.filter((c) => fxRates[c]) : [];
    $("#conv-note").textContent = fxTime ? ("汇率更新于 " + new Date(fxTime * 1000).toLocaleString() + " · 缓存12h") : "汇率加载失败，点「刷新汇率」重试";
  } else {
    units = Object.keys(CONV[cat]);
    $("#conv-note").textContent = "纯本地换算，不消耗 token";
  }
  for (const id of ["#conv-from", "#conv-to"]) {
    const sel = $(id);
    const keep = sel.value;
    sel.innerHTML = "";
    units.forEach((u) => {
      const o = document.createElement("option");
      o.value = u; o.textContent = isFx ? fxLabel(u) : unitLabel(u);
      sel.appendChild(o);
    });
    if (units.includes(keep)) sel.value = keep;
  }
  if (cat === "温度") { $("#conv-from").value = "°C"; $("#conv-to").value = "°F"; }
  if (isFx && units.length) { $("#conv-from").value = "CNY"; $("#conv-to").value = "USD"; }
  doConvert();
}
function doConvert() {
  const cat = $("#conv-cat").value;
  const v = parseFloat($("#conv-val").value);
  const out = $("#conv-result");
  if (!isFinite(v)) { out.textContent = "请输入数值"; return; }
  const f = $("#conv-from").value, t = $("#conv-to").value;
  let res;
  if (cat === "温度") {
    let c = f === "°C" ? v : f === "°F" ? (v - 32) * 5 / 9 : v - 273.15;
    res = t === "°C" ? c : t === "°F" ? c * 9 / 5 + 32 : c + 273.15;
  } else if (cat === "汇率") {
    if (!fxRates || !fxRates[f] || !fxRates[t]) { out.textContent = "汇率未加载"; return; }
    res = v / fxRates[f] * fxRates[t];
  } else {
    res = v * CONV[cat][f] / CONV[cat][t];
  }
  out.textContent = fmtNum(v) + " " + f + " = " + fmtNum(res) + " " + t;
  out.dataset.res = fmtNum(res);
}
(function initConv() {
  const catSel = $("#conv-cat");
  ["长度", "重量", "温度", "面积", "体积", "数据存储", "时间", "速度", "汇率"].forEach((c) => {
    const o = document.createElement("option");
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  CONV["温度"] = { "°C": 1, "°F": 1, K: 1 };
  CONV["汇率"] = {};
  catSel.addEventListener("change", fillConvUnits);
  $("#conv-from").addEventListener("change", doConvert);
  $("#conv-to").addEventListener("change", doConvert);
  $("#conv-val").addEventListener("input", doConvert);
  $("#conv-swap").addEventListener("click", () => {
    const f = $("#conv-from"), t = $("#conv-to");
    const tmp = f.value; f.value = t.value; t.value = tmp;
    doConvert();
  });
  $("#conv-copy").addEventListener("click", () => {
    const r = $("#conv-result").dataset.res;
    if (r) invoke("copy_to_clipboard", { text: r });
  });
  $("#conv-fx-refresh").addEventListener("click", async () => {
    $("#conv-note").textContent = "刷新中…";
    try { await loadFx(true); } catch (e) {}
    fillConvUnits();
  });
  fillConvUnits();
})();

// ---------- 设置 ----------
function setSw(id, on) { $(id).classList.toggle("off", !on); }
function getSw(id) { return !$(id).classList.contains("off"); }
$$(".sw").forEach((s) => s.addEventListener("click", () => s.classList.toggle("off")));

function fillSettings() {
  $("#cfg-url").value = cfg.base_url;
  $("#cfg-key").value = cfg.api_key;
  $("#cfg-model").value = cfg.model;
  $("#cfg-persona").value = cfg.persona || "";
  $("#cfg-instructions").value = cfg.instructions || "";
  $("#hk-toggle").value = cfg.hk_toggle;
  $("#hk-chat").value = cfg.hk_chat;
  $("#hk-translate").value = cfg.hk_translate;
  $("#hk-clipboard").value = cfg.hk_clipboard;
  $("#hk-todo").value = cfg.hk_todo;
  setSw("#sw-autostart", cfg.autostart);
  setSw("#sw-collapse", cfg.auto_collapse);
  setSw("#sw-clip", cfg.clipboard_enabled);
  setSw("#sw-suspend", cfg.suspend_on_hide);
  setSw("#sw-memory", !!cfg.memory_enabled);
}

async function refreshMemory() {
  const m = await invoke("get_memory");
  $("#mem-view").textContent = m.trim() ? m : "（暂无记忆）";
}
$("#btn-mem-refresh").addEventListener("click", refreshMemory);
$("#btn-mem-clear").addEventListener("click", async () => {
  await invoke("clear_memory");
  refreshMemory();
});

async function saveSettings() {
  cfg.base_url = $("#cfg-url").value.trim();
  cfg.api_key = $("#cfg-key").value.trim();
  cfg.model = $("#cfg-model").value.trim();
  cfg.persona = $("#cfg-persona").value.trim();
  cfg.instructions = $("#cfg-instructions").value.trim();
  cfg.memory_enabled = getSw("#sw-memory");
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
  document.body.classList.toggle("big", !!cfg.expanded);
  $("#btn-expand").classList.toggle("on", !!cfg.expanded);
  await loadSessions();
  const m = await invoke("get_mode");
  applyMode(m, null, false, !!cfg.expanded);
  if (m === "panel") switchTab(savedTab());
})();
