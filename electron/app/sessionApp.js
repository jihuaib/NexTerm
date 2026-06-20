const fs = require('fs');
const path = require('path');
const { successResponse, errorResponse } = require('../utils/responseUtils');
const { sessionDataPath } = require('../utils/appPaths');

const STORE_KEY = 'sessions';
const FOLDER_STORE_KEY = 'sessionFolders';
const DATA_VERSION = 1;

function nowIso() {
    return new Date().toISOString();
}

function makeId(prefix) {
    return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function isLocalProtocol(protocol) {
    return protocol === 'local' || protocol === 'shell';
}

function defaultPortForProtocol(protocol) {
    if (isLocalProtocol(protocol)) return null;
    if (protocol === 'ssh') return 22;
    return 23;
}

function normalizeCredentialSaveMode(value) {
    if (value === 'session' || value === 'prompt') return value;
    return 'prompt';
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function stringField(def, existing, key, fallback = '') {
    if (hasOwn(def, key)) return String(def[key] || '');
    return existing?.[key] || fallback;
}

function normalizeFolder(folder = {}, existing = null) {
    const timestamp = nowIso();
    return {
        id: folder.id || existing?.id || makeId('folder'),
        type: 'session-folder',
        resource: 'session',
        name: (folder.name && folder.name.trim()) || existing?.name || '新建文件夹',
        parentId: folder.parentId === undefined ? existing?.parentId || null : folder.parentId || null,
        sort: Number(folder.sort ?? existing?.sort) || 0,
        createdAt: folder.createdAt || existing?.createdAt || timestamp,
        updatedAt: timestamp
    };
}

function normalizeSession(def = {}, existing = null) {
    const timestamp = nowIso();
    const protocol = def.protocol || existing?.protocol || 'telnet';
    const isLocal = isLocalProtocol(protocol);
    const host = stringField(def, existing, 'host').trim();
    const port = defaultPortForProtocol(protocol);
    return {
        id: def.id || existing?.id || makeId('session'),
        type: 'session',
        resource: 'session',
        name: (def.name && def.name.trim()) || existing?.name || host || (isLocal ? 'Local Shell' : ''),
        protocol,
        host,
        port: isLocal ? null : Number(def.port || existing?.port) || port,
        username: stringField(def, existing, 'username'),
        authType:
            def.authType || existing?.authType || (def.privateKeyPath || existing?.privateKeyPath ? 'key' : 'password'),
        privateKeyPath: stringField(def, existing, 'privateKeyPath'),
        credentialSaveMode: isLocal
            ? 'prompt'
            : normalizeCredentialSaveMode(def.credentialSaveMode || existing?.credentialSaveMode),
        shell: stringField(def, existing, 'shell'),
        cwd: stringField(def, existing, 'cwd'),
        folderId: def.folderId === undefined ? existing?.folderId || null : def.folderId || null,
        tags: Array.isArray(def.tags) ? def.tags : existing?.tags || [],
        description: def.description || existing?.description || '',
        createdAt: def.createdAt || existing?.createdAt || timestamp,
        updatedAt: timestamp
    };
}

function publicSession(session = {}) {
    return {
        ...normalizeSession(session, session),
        password: '',
        passphrase: ''
    };
}

function normalizeData(data = {}) {
    return {
        version: DATA_VERSION,
        sessions: Array.isArray(data.sessions) ? data.sessions.map(session => normalizeSession(session, session)) : [],
        sessionFolders: Array.isArray(data.sessionFolders)
            ? data.sessionFolders.map(folder => normalizeFolder(folder, folder))
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

class UserDataSessionStore {
    constructor() {
        this.filePath = sessionDataPath();
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

/**
 * 会话管理：持久化的会话定义（CRUD）
 * 会话定义结构：{ id, type, resource, name, protocol, host, port, folderId, tags, description, createdAt, updatedAt }
 * 文件夹结构：{ id, type, resource, name, parentId, sort, createdAt, updatedAt }
 */
class SessionApp {
    constructor(ipcMain) {
        this.store = new UserDataSessionStore();
        ipcMain.handle('session:list', this.handleList.bind(this));
        ipcMain.handle('session:save', this.handleSave.bind(this));
        ipcMain.handle('session:remove', this.handleRemove.bind(this));
        ipcMain.handle('session:folder:list', this.handleFolderList.bind(this));
        ipcMain.handle('session:folder:save', this.handleFolderSave.bind(this));
        ipcMain.handle('session:folder:remove', this.handleFolderRemove.bind(this));
        ipcMain.handle('session:move-folder', this.handleMoveFolder.bind(this));
    }

    handleList() {
        try {
            const list = this.store.get(STORE_KEY, []).map(publicSession);
            return successResponse(list, '获取会话列表成功');
        } catch (err) {
            return errorResponse('获取会话列表失败: ' + err.message);
        }
    }

    handleSave(_event, def) {
        try {
            if (!def) return errorResponse('会话参数不能为空');
            const protocol = def.protocol || 'telnet';
            if (!isLocalProtocol(protocol) && !def.host) return errorResponse('主机地址不能为空');
            if (protocol === 'ssh' && !def.username) return errorResponse('SSH 用户名不能为空');
            const list = this.store.get(STORE_KEY, []);
            const existing = list.find(s => s.id === def.id) || null;
            const session = normalizeSession(def, existing);
            const idx = list.findIndex(s => s.id === session.id);
            if (idx >= 0) list[idx] = session;
            else list.push(session);
            this.store.set(STORE_KEY, list);
            return successResponse(publicSession(session), '会话已保存');
        } catch (err) {
            return errorResponse('保存会话失败: ' + err.message);
        }
    }

    handleRemove(_event, id) {
        try {
            const current = this.store.get(STORE_KEY, []);
            const list = current.filter(s => s.id !== id);
            this.store.set(STORE_KEY, list);
            return successResponse(null, '会话已删除');
        } catch (err) {
            return errorResponse('删除会话失败: ' + err.message);
        }
    }

    handleFolderList() {
        try {
            const list = this.store.get(FOLDER_STORE_KEY, []).map(folder => normalizeFolder(folder, folder));
            return successResponse(list, '获取会话文件夹成功');
        } catch (err) {
            return errorResponse('获取会话文件夹失败: ' + err.message);
        }
    }

    handleFolderSave(_event, folder) {
        try {
            const name = folder && folder.name && folder.name.trim();
            if (!name) return errorResponse('文件夹名称不能为空');

            const list = this.store.get(FOLDER_STORE_KEY, []);
            const existing = list.find(f => f.id === folder.id);
            const item = normalizeFolder({ ...folder, name }, existing);
            const idx = list.findIndex(f => f.id === item.id);
            if (idx >= 0) list[idx] = item;
            else list.push(item);
            this.store.set(FOLDER_STORE_KEY, list);
            return successResponse(item, '会话文件夹已保存');
        } catch (err) {
            return errorResponse('保存会话文件夹失败: ' + err.message);
        }
    }

    handleFolderRemove(_event, id) {
        try {
            const currentFolders = this.store.get(FOLDER_STORE_KEY, []);
            const removeIds = new Set([id]);
            let changed = true;
            while (changed) {
                changed = false;
                currentFolders.forEach(folder => {
                    if (folder.parentId && removeIds.has(folder.parentId) && !removeIds.has(folder.id)) {
                        removeIds.add(folder.id);
                        changed = true;
                    }
                });
            }
            const folders = currentFolders.filter(f => !removeIds.has(f.id));
            const currentSessions = this.store.get(STORE_KEY, []);
            const sessions = currentSessions.filter(session => !removeIds.has(session.folderId));
            this.store.set(FOLDER_STORE_KEY, folders);
            this.store.set(STORE_KEY, sessions);
            return successResponse(null, '会话文件夹已删除');
        } catch (err) {
            return errorResponse('删除会话文件夹失败: ' + err.message);
        }
    }

    handleMoveFolder(_event, payload) {
        try {
            const sessionId = payload && payload.sessionId;
            if (!sessionId) return errorResponse('会话不存在');

            const list = this.store.get(STORE_KEY, []);
            const idx = list.findIndex(s => s.id === sessionId);
            if (idx < 0) return errorResponse('会话不存在');

            list[idx] = normalizeSession({ ...list[idx], folderId: payload.folderId || null }, list[idx]);
            this.store.set(STORE_KEY, list);
            return successResponse(publicSession(list[idx]), '会话已移动');
        } catch (err) {
            return errorResponse('移动会话失败: ' + err.message);
        }
    }
}

module.exports = SessionApp;
