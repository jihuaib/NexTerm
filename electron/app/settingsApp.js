const { BrowserWindow, dialog } = require('electron');
const { successResponse, errorResponse } = require('../utils/responseUtils');
const { terminalLogDirectory } = require('../utils/appPaths');
const { listKnownHosts, removeKnownHost } = require('../utils/knownHosts');
const { listSshKeys, removeSshKey, sshDirPath } = require('../utils/sshKeyFiles');

const STORE_KEY = 'settings';
const DEFAULT_TERMINAL_HIGHLIGHT_RULES = Object.freeze([
    { id: 'error', label: '错误', text: 'error', color: '#ff5f57', enabled: true, caseSensitive: false },
    { id: 'failed', label: '失败', text: 'failed', color: '#ff5f57', enabled: true, caseSensitive: false },
    { id: 'fatal', label: '致命错误', text: 'fatal', color: '#ff5f57', enabled: true, caseSensitive: false },
    { id: 'exception', label: '异常', text: 'exception', color: '#ff5f57', enabled: true, caseSensitive: false },
    { id: 'warning', label: '警告', text: 'warning', color: '#fbbf24', enabled: true, caseSensitive: false },
    { id: 'warn', label: 'WARN', text: 'warn', color: '#fbbf24', enabled: true, caseSensitive: false },
    { id: 'timeout', label: '超时', text: 'timeout', color: '#fb923c', enabled: true, caseSensitive: false },
    { id: 'success', label: '成功', text: 'success', color: '#34d399', enabled: true, caseSensitive: false },
    { id: 'connected', label: '已连接', text: 'connected', color: '#34d399', enabled: true, caseSensitive: false },
    { id: 'done', label: '完成', text: 'done', color: '#38bdf8', enabled: true, caseSensitive: false },
    {
        id: 'ipv4',
        label: 'IPv4 地址',
        text: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b`,
        mode: 'regex',
        color: '#38bdf8',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'mac',
        label: 'MAC 地址',
        text: String.raw`\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b`,
        mode: 'regex',
        color: '#22d3ee',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'ipv6',
        label: 'IPv6 地址',
        text: String.raw`\b(?:(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}|[0-9a-f]{1,4}::[0-9a-f]{0,4}|::1)\b`,
        mode: 'regex',
        color: '#2dd4bf',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'timestamp',
        label: '时间戳',
        text: String.raw`\b\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?\b`,
        mode: 'regex',
        color: '#a78bfa',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'date',
        label: '日期',
        text: String.raw`\b\d{4}-\d{2}-\d{2}\b`,
        mode: 'regex',
        color: '#c084fc',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'time',
        label: '时间',
        text: String.raw`\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?\b`,
        mode: 'regex',
        color: '#c084fc',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'url',
        label: 'URL',
        text: String.raw`\bhttps?:\/\/[^\s"'<>]+`,
        mode: 'regex',
        color: '#60a5fa',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'uuid',
        label: 'UUID',
        text: String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b`,
        mode: 'regex',
        color: '#f472b6',
        enabled: true,
        caseSensitive: false
    }
]);
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
    defaultSerialBaudRate: 115200,
    defaultSerialDataBits: 8,
    defaultSerialStopBits: 1,
    defaultSerialParity: 'none',
    defaultSerialFlowControl: 'none',
    defaultSerialDtr: true,
    defaultSerialRts: true,
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
    terminalContextMenuTrigger: 'shift',
    terminalHighlightEnabled: true,
    terminalHighlightRules: DEFAULT_TERMINAL_HIGHLIGHT_RULES,
    // 更新
    updateAutoCheckOnStartup: true,
    updateAutoDownload: false
};

function getDefaults() {
    return {
        ...STATIC_DEFAULTS,
        terminalLogDirectory: terminalLogDirectory(),
        terminalHighlightRules: DEFAULT_TERMINAL_HIGHLIGHT_RULES.map(rule => ({ ...rule }))
    };
}

/**
 * 应用设置：主题、字号等
 */
class SettingsApp {
    constructor(ipcMain, store, onSave = null) {
        this.store = store;
        this.onSave = typeof onSave === 'function' ? onSave : null;
        ipcMain.handle('settings:get', this.handleGet.bind(this));
        ipcMain.handle('settings:save', this.handleSave.bind(this));
        ipcMain.handle('settings:select-log-directory', this.handleSelectLogDirectory.bind(this));
        ipcMain.handle('known-hosts:list', this.handleKnownHostsList.bind(this));
        ipcMain.handle('known-hosts:remove', this.handleKnownHostsRemove.bind(this));
        ipcMain.handle('keychain:list', this.handleKeychainList.bind(this));
        ipcMain.handle('keychain:remove', this.handleKeychainRemove.bind(this));
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
            if (this.onSave) this.onSave(merged);
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

    handleKnownHostsList() {
        try {
            return successResponse(listKnownHosts(), '获取 known_hosts 成功');
        } catch (err) {
            return errorResponse('获取 known_hosts 失败: ' + err.message);
        }
    }

    handleKnownHostsRemove(_event, payload = {}) {
        try {
            const removed = removeKnownHost(payload);
            return successResponse({ removed }, removed ? '主机指纹记录已删除' : '主机指纹记录不存在');
        } catch (err) {
            return errorResponse('删除主机指纹记录失败: ' + err.message);
        }
    }

    handleKeychainList() {
        try {
            return successResponse(
                {
                    available: true,
                    sourcePath: sshDirPath(),
                    entries: listSshKeys()
                },
                '获取 SSH Key 成功'
            );
        } catch (err) {
            return errorResponse('获取 SSH Key 失败: ' + err.message);
        }
    }

    handleKeychainRemove(_event, payload = {}) {
        try {
            const removed = removeSshKey(payload);
            return successResponse({ removed }, removed ? 'SSH Key 已删除' : 'SSH Key 不存在');
        } catch (err) {
            return errorResponse('删除 SSH Key 失败: ' + err.message);
        }
    }
}

SettingsApp.getDefaults = getDefaults;
SettingsApp.STORE_KEY = STORE_KEY;

module.exports = SettingsApp;
