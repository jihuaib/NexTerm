# NexTerm

类 Xshell 的跨平台远程接入终端，采用与 NetNexus 一致的架构范式（Electron 主进程 / preload / Vue 3 渲染进程，按模块拆分的 `App` + IPC、`EventDispatcher` 统一事件、`{status,msg,data}` 返回格式）。

当前为**基础版**：Telnet 终端、本地 Shell、主题切换、会话管理。样式/主题/组件外观全部自研封装；协议后续接入 SSH（`ssh2`，走 worker 线程），终端渲染使用 `xterm.js`。

## 功能

- **Telnet 终端**：自实现 IAC 选项协商（ECHO / SGA / NAWS / TERMINAL-TYPE），多标签会话。
- **本地 Shell**：通过 `node-pty` 接入系统伪终端，macOS / Linux 使用系统 pty，Windows 使用 `node-pty` 的 ConPTY / winpty 后端选择。
- **会话管理**：左侧树形会话管理器，支持多级文件夹、新建 / 编辑 / 删除、拖动归档、双击连接；会话和文件夹持久化在应用 `userData/data/sessions.json`。
- **主题切换**：内置 深色 / 浅色 / Solarized / Monokai，单一主题对象同时驱动应用外壳 CSS 令牌与 xterm 配色；可调字号；实时热更新。

## 开发运行

```bash
npm install
npm run dev      # 同时启动 Vite(5273) 与 Electron
npm run start    # 仅启动本地浏览器预览：http://127.0.0.1:5273
```

`npm install` 会自动重编 `node-pty` 到当前 Electron ABI，Windows / macOS / Linux 都走同一套安装流程。

## 构建

```bash
npm run build    # 构建前端到 dist/
```

## 目录结构

```
electron/
  main.js                 # 创建窗口、加载页面
  preload.js              # contextBridge 暴露 sessionApi / terminalApi / settingsApi
  app/
    systemApp.js          # 中央协调器（共享 store + 事件分发器）
    sessionApp.js         # 会话定义 CRUD
    telnetApp.js          # Telnet 连接编排
    settingsApp.js        # 主题 / 字号
  utils/
    telnetManager.js      # 自实现 Telnet 协议（IAC 状态机）
    eventDispatcher.js    # 主->渲染 统一事件 (unified-event)
    responseUtils.js
  const/telnetConst.js
src/
  theme/                  # 主题体系（自研样式核心）
    themes.js             # 主题对象：app 令牌 + xterm 配色
    themeManager.js       # 注入 CSS 变量 / 产出 xterm ITheme
  styles/tokens.css       # 设计令牌默认值
  components/
    AppShell.vue  SessionSidebar.vue  TabBar.vue
    TerminalPane.vue      # xterm 封装：输入/输出/resize/状态
    SessionDialog.vue  ThemeMenu.vue
  store.js                # 全局响应式状态
  utils/eventBus.js       # 接入 unified-event 并按 type 分发
```

## 验证连接

可用公开 Telnet 服务测试，例如电影《星球大战》ASCII 动画：

```
towel.blinkenlights.nl : 23
```

> 后续规划：SSH（ssh2 + worker 线程）、SFTP 文件传输、串口、凭据加密(safeStorage)、known_hosts、会话日志、隧道转发。
