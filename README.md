# Dozy 🐑

<p align="center">
  <img src="./app-icon.png" width="96" alt="Dozy 图标" />
</p>

> **一只睡在屏幕边缘的 AI 小羊：随手呼出问答、翻译、剪贴板与待办，接入任意 OpenAI 兼容大模型，数据全本地。绿色单文件仅 6 MB，挂起常驻约 35 MB，最轻的 AI 桌宠。**

Dozy 平时是一只停靠在屏幕右边缘的小羊玩偶，只露出一小条；鼠标划过即滑出，单击展开成完整的会话小窗。它不占任务栏、不后台偷跑、退出即走，主打**轻量、便捷、高效、本地自有**。

<p align="center">
  <img src="./mascot-full.png" width="160" alt="Dozy 玩偶形态：停靠在屏幕边缘的小羊" />
  <br/>
  <em>最小化时的玩偶形态 —— 睡在屏幕边缘，随时等你唤醒</em>
</p>

## 特性

- 🪟 **双形态桌宠**：展开 = 360×600 暗色会话窗；最小化 = 屏幕边缘小羊玩偶，单击展开、按住拖动、失焦自动收起
- 🤖 **自带大模型**：OpenAI 兼容接口，默认预填 [DeepSeek](https://api.deepseek.com)，可换任何兼容服务；流式打字机输出
- 🌐 **快捷翻译**：粘贴即自动中英互译（大模型翻译），可复制 / 送入对话
- 📋 **剪贴板记录**：后台自动记录复制的文字，保留最近 30 条；单击展开详情并复制，可单条删除或送入对话
- ✅ **待办清单**：轻量待办事项，本地保存
- ✂️ **一键截图**：调起 Windows 原生区域截图（`Win+Shift+S` 同款）
- ⌨️ **自由全局快捷键**：单键（`1`、`A`、`F1`）或组合键（`Ctrl+1`、`Alt+Q`）自由设置，不同快捷键直达不同模块
- 💾 **便携数据**：配置与数据（SQLite）存放在 exe 同目录，不写 AppData、不上云，随文件夹整体搬走
- 🧠 **挂起省内存**：收起为玩偶时自动把 WebView2 内存目标降档，空闲约 35 MB，展开秒回
- 🚫 **零打扰**：不显示在任务栏，只保留托盘；关闭 = 收起，托盘「退出」才真正结束进程

## 下载使用

前往 [Releases](../../releases) 下载 `Dozy.exe`（绿色免安装，约 6 MB）：

1. 双击运行，展开后在「设置」里填入你的 API Key（如 DeepSeek 的 `sk-...`）并保存
2. `Enter` 发送对话；`Shift+Enter` 换行
3. 关闭窗口会收成玩偶，用快捷键或托盘随时唤回

> 依赖 Windows 10/11 自带的 Microsoft Edge WebView2（绝大多数机器已内置，无需安装）。
> 目前仅支持 Windows。

## 默认快捷键

| 功能 | 默认 |
|---|---|
| 窗口 / 玩偶切换 | `Alt+Q` |
| 快速提问（展开并聚焦输入框） | `Alt+A` |
| 直达翻译页 | `Alt+T` |
| 直达剪贴板页 | `Alt+C` |
| 直达待办页 | `Alt+D` |

所有快捷键均可在设置中自由修改（单键或"修饰键+按键"组合，无三键组合）。

## 从源码构建

```bash
# 前置：Rust (MSVC)、Node.js、WebView2 Runtime
npm install
npx tauri build        # 产物在 src-tauri/target/release/
```

技术栈：[Tauri v2](https://tauri.app)（Rust + 原生 JS，无前端框架）· SQLite · reqwest 流式调用 · arboard 剪贴板监听 · WebView2 MemoryUsageTargetLevel 挂起。

## 隐私

你的 API Key、对话记录、剪贴板记录、待办**全部只保存在本机**（exe 同目录的 `config.json` 与 `lazygoat.db`），程序不包含任何遥测/统计代码。唯一的外联请求是你在设置里填的大模型接口地址。

## License

[MIT](./LICENSE)
