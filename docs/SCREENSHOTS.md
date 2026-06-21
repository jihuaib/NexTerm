# 功能截图

本目录下的截图由自动化脚本生成，用于 README、发布说明和功能验收。脚本会启动 Electron 测试环境，使用临时 `userData`，并准备浅色主题、mock SSH/SFTP、mock Serial、本地 Telnet、Local Shell、脚本任务、Keychain、Known Host 和端口转发规则。

## 重新生成

```bash
npm run screenshots
```

输出目录固定为 `docs/screenshots/`。每次执行会清空旧截图并重新生成最新界面。

## 覆盖范围

| 功能 | 截图 |
| --- | --- |
| 会话树、本地 Shell、终端标签 | ![会话树、本地 Shell、终端标签](screenshots/01-local-shell-workspace.png) |
| 新建会话、协议切换、会话颜色 | ![新建会话、协议切换、会话颜色](screenshots/02-new-session-dialog.png) |
| Telnet 终端 | ![Telnet 终端](screenshots/03-telnet-terminal.png) |
| Serial 串口终端 | ![Serial 串口终端](screenshots/04-serial-terminal.png) |
| SSH 终端 | ![SSH 终端](screenshots/05-ssh-terminal.png) |
| SFTP 文件面板 | ![SFTP 文件面板](screenshots/06-sftp-file-panel.png) |
| Direct TCP / UDP、SSH Local、SOCKS5 端口转发 | ![端口转发](screenshots/07-port-forwarding.png) |
| 脚本库、term API、任务状态 | ![脚本库](screenshots/08-script-workbench.png) |
| Keychain、OpenSSH 私钥列表 | ![Keychain](screenshots/09-keychain.png) |
| Known Host、SSH 主机指纹记录 | ![Known Host](screenshots/10-known-hosts.png) |
| 连接设置、自动重连、端口转发机制说明 | ![连接设置](screenshots/11-settings-connection.png) |
| 外观设置、主题、字体和侧栏宽度 | ![外观设置](screenshots/12-settings-appearance.png) |

## 自动化说明

- 脚本入口：[scripts/capture-screenshots.cjs](../scripts/capture-screenshots.cjs)
- Electron 使用 `NODE_ENV=test` 加载 `dist/index.html`，因此 `npm run screenshots` 会先执行 `npm run build`。
- 脚本会预置浅色主题，保证文档截图风格统一。
- Serial 使用 `NEXTERM_SERIAL_MOCK=1`，不会访问真实串口设备。
- SSH / SFTP 使用内置测试服务器，不需要外部网络。
- Keychain 使用临时 `~/.ssh/id_ed25519`，Known Host 使用连接 mock SSH 后生成的临时 `known_hosts`。
- 端口转发截图会启动真实本地监听规则，但只绑定临时端口，脚本结束后会关闭应用和测试服务。
