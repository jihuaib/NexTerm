const fs = require('fs');
const path = require('path');
const { successResponse, errorResponse } = require('../utils/responseUtils');
const { commandSetDataPath } = require('../utils/appPaths');

const STORE_KEY = 'commandSets';
const DATA_VERSION = 1;
const COLORS = new Set(['blue', 'green', 'amber', 'violet', 'rose', 'cyan']);

function nowIso() {
    return new Date().toISOString();
}

function makeId() {
    return 'command-set-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function normalizeCommands(value) {
    const list = Array.isArray(value) ? value : String(value || '').replace(/\r/g, '').split('\n');
    return list.map(line => String(line || '').trimEnd()).filter(line => line.trim());
}

function normalizeCommandSet(def = {}, existing = null) {
    const timestamp = nowIso();
    const color = COLORS.has(def.color || existing?.color) ? def.color || existing?.color : 'blue';
    return {
        id: def.id || existing?.id || makeId(),
        name: (def.name && String(def.name).trim()) || existing?.name || '新建指令集',
        color,
        commands: normalizeCommands(def.commands ?? existing?.commands ?? []),
        description: String(def.description ?? existing?.description ?? ''),
        createdAt: def.createdAt || existing?.createdAt || timestamp,
        updatedAt: timestamp
    };
}

function normalizeData(data = {}) {
    return {
        version: DATA_VERSION,
        commandSets: Array.isArray(data.commandSets)
            ? data.commandSets.map(commandSet => normalizeCommandSet(commandSet, commandSet))
            : [],
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

class UserDataCommandSetStore {
    constructor() {
        this.filePath = commandSetDataPath();
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

class CommandSetApp {
    constructor(ipcMain) {
        this.store = new UserDataCommandSetStore();
        ipcMain.handle('command-set:list', this.handleList.bind(this));
        ipcMain.handle('command-set:save', this.handleSave.bind(this));
        ipcMain.handle('command-set:remove', this.handleRemove.bind(this));
    }

    handleList() {
        try {
            const list = this.store.get(STORE_KEY, []).map(commandSet => normalizeCommandSet(commandSet, commandSet));
            return successResponse(list, '获取指令集成功');
        } catch (err) {
            return errorResponse('获取指令集失败: ' + err.message);
        }
    }

    handleSave(_event, def) {
        try {
            if (!def) return errorResponse('指令集参数不能为空');
            if (!String(def.name || '').trim()) return errorResponse('指令集名称不能为空');
            if (normalizeCommands(def.commands).length === 0) return errorResponse('请至少填写一条指令');
            const list = this.store.get(STORE_KEY, []);
            const existing = list.find(commandSet => commandSet.id === def.id);
            const commandSet = normalizeCommandSet(def, existing);
            const index = list.findIndex(item => item.id === commandSet.id);
            if (index >= 0) list[index] = commandSet;
            else list.push(commandSet);
            this.store.set(STORE_KEY, list);
            return successResponse(commandSet, '指令集已保存');
        } catch (err) {
            return errorResponse('保存指令集失败: ' + err.message);
        }
    }

    handleRemove(_event, id) {
        try {
            const list = this.store.get(STORE_KEY, []).filter(commandSet => commandSet.id !== id);
            this.store.set(STORE_KEY, list);
            return successResponse(null, '指令集已删除');
        } catch (err) {
            return errorResponse('删除指令集失败: ' + err.message);
        }
    }
}

module.exports = CommandSetApp;
