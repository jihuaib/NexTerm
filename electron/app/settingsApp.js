const { BrowserWindow, dialog } = require('electron');
const { successResponse, errorResponse } = require('../utils/responseUtils');
const { terminalLogDirectory } = require('../utils/appPaths');

const STORE_KEY = 'settings';
const STATIC_DEFAULTS = {
    // 外观
    themeId: 'dark',
    fontSize: 14,
    fontFamily: "'Consolas', 'Menlo', 'DejaVu Sans Mono', monospace",
    // 终端
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 5000,
    // 连接默认值
    defaultProtocol: 'telnet',
    defaultPort: 23,
    sidebarWidth: 278,
    defaultLocalShell: '',
    defaultLocalCwd: '',
    connectionAutoReconnect: true,
    connectionReconnectDelay: 3,
    connectionReconnectMaxAttempts: 5,
    sshKnownHostsEnabled: true,
    // 文件 / SFTP
    sftpFollowConsole: true,
    sftpShowHiddenFiles: true,
    // 终端缓冲区日志
    terminalLogEnabled: false,
    terminalLogDirectory: '',
    terminalLogFileFormat: '{date}/{time}-{session}-{id}.log',
    terminalLogLineFormat: '{text}',
    terminalLogStripAnsi: true,
    // 快捷键
    terminalSearchShortcut: 'CmdOrCtrl+F',
    terminalCopyShortcut: 'CmdOrCtrl+Shift+C',
    terminalPasteShortcut: 'CmdOrCtrl+Shift+V',
    terminalSelectToCopy: false,
    terminalRightClickAction: 'paste',
    terminalContextMenuTrigger: 'shift'
};

function getDefaults() {
    return {
        ...STATIC_DEFAULTS,
        terminalLogDirectory: terminalLogDirectory()
    };
}

/**
 * 应用设置：主题、字号等
 */
class SettingsApp {
    constructor(ipcMain, store) {
        this.store = store;
        ipcMain.handle('settings:get', this.handleGet.bind(this));
        ipcMain.handle('settings:save', this.handleSave.bind(this));
        ipcMain.handle('settings:select-log-directory', this.handleSelectLogDirectory.bind(this));
    }

    handleGet() {
        try {
            return successResponse({ ...getDefaults(), ...this.store.get(STORE_KEY, {}) }, '获取设置成功');
        } catch (err) {
            return errorResponse('获取设置失败: ' + err.message);
        }
    }

    handleSave(_event, settings) {
        try {
            const merged = { ...getDefaults(), ...this.store.get(STORE_KEY, {}), ...(settings || {}) };
            this.store.set(STORE_KEY, merged);
            return successResponse(merged, '设置已保存');
        } catch (err) {
            return errorResponse('保存设置失败: ' + err.message);
        }
    }

    async handleSelectLogDirectory(event) {
        try {
            const settings = { ...getDefaults(), ...this.store.get(STORE_KEY, {}) };
            const current = String(settings.terminalLogDirectory || '').trim() || terminalLogDirectory();
            if (process.env.NEXTERM_E2E) {
                return successResponse({ canceled: false, path: terminalLogDirectory() }, '已选择日志目录');
            }
            const win = BrowserWindow.fromWebContents(event.sender);
            const result = await dialog.showOpenDialog(win, {
                title: '选择日志目录',
                defaultPath: current,
                properties: ['openDirectory', 'createDirectory']
            });
            if (result.canceled || !result.filePaths?.[0]) {
                return successResponse({ canceled: true, path: settings.terminalLogDirectory || '' }, '已取消');
            }
            return successResponse({ canceled: false, path: result.filePaths[0] }, '已选择日志目录');
        } catch (err) {
            return errorResponse('选择日志目录失败: ' + err.message);
        }
    }
}

module.exports = SettingsApp;
