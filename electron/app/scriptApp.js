const fs = require('fs');
const path = require('path');
const { BrowserWindow, dialog } = require('electron');
const { successResponse, errorResponse } = require('../utils/responseUtils');
const { scriptDataPath } = require('../utils/appPaths');

const STORE_KEY = 'scripts';
const DATA_VERSION = 1;

function nowIso() {
    return new Date().toISOString();
}

function makeId() {
    return 'script-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeScript(def = {}, existing = null) {
    const timestamp = nowIso();
    const languageId = def.languageId || existing?.languageId || 'javascript';
    return {
        id: def.id || existing?.id || makeId(),
        name: (def.name && String(def.name).trim()) || existing?.name || '新建脚本',
        languageId,
        command: languageId === 'custom' ? String(def.command || existing?.command || '').trim() : '',
        content: String(def.content ?? existing?.content ?? ''),
        description: String(def.description ?? existing?.description ?? ''),
        createdAt: def.createdAt || existing?.createdAt || timestamp,
        updatedAt: timestamp
    };
}

function normalizeData(data = {}) {
    return {
        version: DATA_VERSION,
        scripts: Array.isArray(data.scripts) ? data.scripts.map(script => normalizeScript(script, script)) : [],
        updatedAt: data.updatedAt || nowIso()
    };
}

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
}

function writeJsonFile(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, filePath);
}

function safeFileName(name, fallback = 'script') {
    const value = String(name || fallback)
        .replace(/[\\/:*?"<>|]+/g, '-')
        .trim();
    return value || fallback;
}

class UserDataScriptStore {
    constructor() {
        this.filePath = scriptDataPath();
        this.ensureFile();
    }

    ensureFile() {
        if (fs.existsSync(this.filePath)) return;
        this.write(normalizeData());
    }

    read() {
        return normalizeData(readJsonFile(this.filePath) || {});
    }

    write(data) {
        writeJsonFile(this.filePath, {
            ...normalizeData(data),
            updatedAt: nowIso()
        });
    }

    get(key, fallback = []) {
        const data = this.read();
        return data[key] || fallback;
    }

    set(key, value) {
        const data = this.read();
        data[key] = value;
        this.write(data);
    }
}

class ScriptApp {
    constructor(ipcMain) {
        this.store = new UserDataScriptStore();
        ipcMain.handle('script:list', this.handleList.bind(this));
        ipcMain.handle('script:save', this.handleSave.bind(this));
        ipcMain.handle('script:remove', this.handleRemove.bind(this));
        ipcMain.handle('script:import', this.handleImport.bind(this));
        ipcMain.handle('script:export', this.handleExport.bind(this));
    }

    handleList() {
        try {
            const list = this.store.get(STORE_KEY, []).map(script => normalizeScript(script, script));
            return successResponse(list, '获取脚本列表成功');
        } catch (err) {
            return errorResponse('获取脚本列表失败: ' + err.message);
        }
    }

    handleSave(_event, def) {
        try {
            if (!def) return errorResponse('脚本参数不能为空');
            if (!String(def.name || '').trim()) return errorResponse('脚本名称不能为空');
            const list = this.store.get(STORE_KEY, []);
            const existing = list.find(script => script.id === def.id);
            const script = normalizeScript(def, existing);
            const index = list.findIndex(item => item.id === script.id);
            if (index >= 0) list[index] = script;
            else list.push(script);
            this.store.set(STORE_KEY, list);
            return successResponse(script, '脚本已保存');
        } catch (err) {
            return errorResponse('保存脚本失败: ' + err.message);
        }
    }

    handleRemove(_event, id) {
        try {
            const list = this.store.get(STORE_KEY, []).filter(script => script.id !== id);
            this.store.set(STORE_KEY, list);
            return successResponse(null, '脚本已删除');
        } catch (err) {
            return errorResponse('删除脚本失败: ' + err.message);
        }
    }

    showOpenDialog(event, options) {
        const win = BrowserWindow.fromWebContents(event.sender);
        return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
    }

    showSaveDialog(event, options) {
        const win = BrowserWindow.fromWebContents(event.sender);
        return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
    }

    readImportScripts(filePath) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) return data;
        if (Array.isArray(data.scripts)) return data.scripts;
        if (data.script) return [data.script];
        return [];
    }

    async handleImport(event) {
        try {
            const result = await this.showOpenDialog(event, {
                title: '导入脚本',
                properties: ['openFile'],
                filters: [{ name: 'NexTerm Scripts', extensions: ['json'] }]
            });
            if (result.canceled || !result.filePaths?.[0]) return successResponse({ canceled: true }, '已取消导入');

            const incoming = this.readImportScripts(result.filePaths[0]);
            if (incoming.length === 0) return errorResponse('导入文件中没有脚本');

            const list = this.store.get(STORE_KEY, []);
            let imported = 0;
            incoming.forEach(def => {
                const existing = def.id ? list.find(script => script.id === def.id) : null;
                const script = normalizeScript(def, existing);
                const index = list.findIndex(item => item.id === script.id);
                if (index >= 0) list[index] = script;
                else list.push(script);
                imported += 1;
            });
            this.store.set(STORE_KEY, list);
            return successResponse({ canceled: false, count: imported }, `已导入 ${imported} 个脚本`);
        } catch (err) {
            return errorResponse('导入脚本失败: ' + err.message);
        }
    }

    async handleExport(event, payload = {}) {
        try {
            const ids = Array.isArray(payload.ids) ? payload.ids.filter(Boolean) : [];
            const list = this.store.get(STORE_KEY, []).map(script => normalizeScript(script, script));
            const scripts = ids.length > 0 ? list.filter(script => ids.includes(script.id)) : list;
            if (scripts.length === 0) return errorResponse('没有可导出的脚本');

            const defaultName = scripts.length === 1 ? `${safeFileName(scripts[0].name)}.json` : 'nexterm-scripts.json';
            const result = await this.showSaveDialog(event, {
                title: '导出脚本',
                defaultPath: defaultName,
                filters: [{ name: 'NexTerm Scripts', extensions: ['json'] }]
            });
            if (result.canceled || !result.filePath) return successResponse({ canceled: true }, '已取消导出');

            const data = {
                version: DATA_VERSION,
                exportedAt: nowIso(),
                scripts
            };
            writeJsonFile(result.filePath, data);
            return successResponse({ canceled: false, count: scripts.length, path: result.filePath }, '脚本已导出');
        } catch (err) {
            return errorResponse('导出脚本失败: ' + err.message);
        }
    }
}

module.exports = ScriptApp;
