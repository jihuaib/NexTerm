const SESSION_KEY = 'nexterm.preview.sessions';
const FOLDER_KEY = 'nexterm.preview.sessionFolders';
const SCRIPT_KEY = 'nexterm.preview.scripts';
const SETTINGS_KEY = 'nexterm.preview.settings';
const KNOWN_HOSTS_KEY = 'nexterm.preview.knownHosts';

const PREVIEW_SETTINGS = {
    themeId: 'dark',
    fontSize: 14,
    fontFamily: "'Consolas', 'Menlo', 'DejaVu Sans Mono', monospace",
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 5000,
    defaultProtocol: 'telnet',
    defaultPort: 23,
    sidebarWidth: 278,
    defaultLocalShell: '',
    defaultLocalCwd: '',
    connectionAutoReconnect: true,
    connectionReconnectDelay: 3,
    connectionReconnectMaxAttempts: 5,
    sshKnownHostsEnabled: true,
    sftpFollowConsole: true,
    sftpShowHiddenFiles: true,
    terminalLogEnabled: false,
    terminalLogDirectory: '',
    terminalLogFileFormat: '{date}/{time}-{session}-{id}.log',
    terminalLogLineFormat: '{text}',
    terminalLogStripAnsi: true,
    terminalSearchShortcut: 'CmdOrCtrl+F',
    terminalCopyShortcut: 'CmdOrCtrl+Shift+C',
    terminalPasteShortcut: 'CmdOrCtrl+Shift+V',
    terminalSelectToCopy: false,
    terminalRightClickAction: 'paste',
    terminalContextMenuTrigger: 'shift',
    updateAutoCheckOnStartup: true,
    updateAutoDownload: false
};

const PREVIEW_SESSIONS = [
    {
        id: 'preview-starwars',
        type: 'session',
        resource: 'session',
        name: 'ASCII Star Wars',
        protocol: 'telnet',
        host: 'towel.blinkenlights.nl',
        port: 23,
        folderId: null,
        tags: [],
        description: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }
];

function ok(data = null, msg = '') {
    return { status: 'success', msg, data };
}

function fail(msg) {
    return { status: 'error', msg, data: null };
}

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (_e) {
        return fallback;
    }
}

function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeFolder(folder = {}, existing = null) {
    const timestamp = nowIso();
    return {
        id: folder.id || existing?.id || `preview-folder-${Date.now().toString(36)}`,
        type: 'session-folder',
        resource: 'session',
        name: folder.name?.trim() || existing?.name || '新建文件夹',
        parentId: folder.parentId === undefined ? existing?.parentId || null : folder.parentId || null,
        sort: Number(folder.sort ?? existing?.sort) || 0,
        createdAt: folder.createdAt || existing?.createdAt || timestamp,
        updatedAt: timestamp
    };
}

function isLocalProtocol(protocol) {
    return protocol === 'local' || protocol === 'shell';
}

function defaultPortForProtocol(protocol) {
    if (isLocalProtocol(protocol)) return null;
    if (protocol === 'ssh') return 22;
    return PREVIEW_SETTINGS.defaultPort;
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function stringField(def, existing, key, fallback = '') {
    if (hasOwn(def, key)) return String(def[key] || '');
    return existing?.[key] || fallback;
}

function normalizeSession(def = {}, existing = null) {
    const timestamp = nowIso();
    const protocol = def.protocol || existing?.protocol || PREVIEW_SETTINGS.defaultProtocol;
    const isLocal = isLocalProtocol(protocol);
    const host = stringField(def, existing, 'host').trim();
    const port = defaultPortForProtocol(protocol);
    return {
        id: def.id || existing?.id || `preview-${Date.now().toString(36)}`,
        type: 'session',
        resource: 'session',
        name: def.name || existing?.name || host || (isLocal ? 'Local Shell' : ''),
        protocol,
        host,
        port: isLocal ? null : Number(def.port || existing?.port) || port,
        username: stringField(def, existing, 'username'),
        authType:
            def.authType || existing?.authType || (def.privateKeyPath || existing?.privateKeyPath ? 'key' : 'password'),
        credentialSaveMode: def.credentialSaveMode || existing?.credentialSaveMode || 'prompt',
        password: '',
        privateKeyPath: stringField(def, existing, 'privateKeyPath'),
        passphrase: '',
        shell: stringField(def, existing, 'shell'),
        cwd: stringField(def, existing, 'cwd'),
        folderId: def.folderId === undefined ? existing?.folderId || null : def.folderId || null,
        tags: Array.isArray(def.tags) ? def.tags : existing?.tags || [],
        description: def.description || existing?.description || '',
        createdAt: def.createdAt || existing?.createdAt || timestamp,
        updatedAt: timestamp
    };
}

function normalizeScript(def = {}, existing = null) {
    const timestamp = nowIso();
    const languageId = def.languageId || existing?.languageId || 'javascript';
    return {
        id: def.id || existing?.id || `preview-script-${Date.now().toString(36)}`,
        name: def.name?.trim() || existing?.name || '新建脚本',
        languageId,
        command: languageId === 'custom' ? String(def.command || existing?.command || '').trim() : '',
        content: String(def.content ?? existing?.content ?? ''),
        description: String(def.description ?? existing?.description ?? ''),
        createdAt: def.createdAt || existing?.createdAt || timestamp,
        updatedAt: timestamp
    };
}

function getPreviewSessions() {
    const stored = readJson(SESSION_KEY, null);
    if (Array.isArray(stored)) return stored.map(item => normalizeSession(item, item));
    writeJson(SESSION_KEY, PREVIEW_SESSIONS);
    return PREVIEW_SESSIONS;
}

function getPreviewFolders() {
    const stored = readJson(FOLDER_KEY, null);
    if (Array.isArray(stored)) return stored.map(item => normalizeFolder(item, item));
    writeJson(FOLDER_KEY, []);
    return [];
}

function getPreviewScripts() {
    const stored = readJson(SCRIPT_KEY, null);
    if (Array.isArray(stored)) return stored.map(item => normalizeScript(item, item));
    writeJson(SCRIPT_KEY, []);
    return [];
}

function toB64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    bytes.forEach(byte => {
        bin += String.fromCharCode(byte);
    });
    return btoa(bin);
}

export function ensureRuntimeApis() {
    let previewClipboard = '';
    window.clipboardApi ||= {
        async readText() {
            try {
                return await navigator.clipboard.readText();
            } catch (_err) {
                return previewClipboard;
            }
        },
        async writeText(text) {
            previewClipboard = String(text || '');
            try {
                await navigator.clipboard.writeText(previewClipboard);
            } catch (_err) {
                /* browser preview may not grant clipboard permission */
            }
        }
    };

    if (window.sessionApi && window.terminalApi && window.settingsApi && window.sftpApi) return;

    const listeners = new Set();
    const timers = new Map();

    function emit(type, data) {
        listeners.forEach(callback => callback({ type, data }));
    }

    window.settingsApi ||= {
        async get() {
            return ok({ ...PREVIEW_SETTINGS, ...readJson(SETTINGS_KEY, {}) });
        },
        async save(patch) {
            const next = { ...readJson(SETTINGS_KEY, {}), ...patch };
            writeJson(SETTINGS_KEY, next);
            return ok(next);
        },
        async selectLogDirectory() {
            return ok({ canceled: false, path: 'preview/userData/logs' });
        }
    };

    window.knownHostsApi ||= {
        async list() {
            return ok(readJson(KNOWN_HOSTS_KEY, []));
        },
        async remove(payload = {}) {
            const id = payload.id || payload.key || `${payload.host || ''}:${payload.port || 22}`;
            const next = readJson(KNOWN_HOSTS_KEY, []).filter(item => item.id !== id);
            writeJson(KNOWN_HOSTS_KEY, next);
            return ok({ removed: true });
        }
    };

    window.keychainApi ||= {
        async list() {
            return ok({
                available: true,
                sourcePath: '~/.ssh',
                entries: [
                    {
                        id: '~/.ssh/id_ed25519',
                        name: 'id_ed25519',
                        path: '~/.ssh/id_ed25519',
                        publicKeyPath: '~/.ssh/id_ed25519.pub',
                        keyType: 'ssh-ed25519',
                        fingerprint: 'SHA256:preview',
                        size: 0,
                        mode: '0600',
                        updatedAt: new Date().toISOString()
                    }
                ]
            });
        },
        async remove() {
            return ok({ removed: false });
        }
    };

    window.sessionApi ||= {
        async list() {
            return ok(getPreviewSessions());
        },
        async save(def) {
            if (!isLocalProtocol(def.protocol) && (!def.host || !String(def.host).trim()))
                return fail('请填写主机地址');
            if (def.protocol === 'ssh' && (!def.username || !String(def.username).trim()))
                return fail('请填写 SSH 用户名');

            const sessions = getPreviewSessions();
            const id = def.id || null;
            const existing = sessions.find(item => item.id === id);
            const next = normalizeSession(def, existing);
            const index = sessions.findIndex(item => item.id === next.id);
            if (index >= 0) sessions.splice(index, 1, next);
            else sessions.push(next);
            writeJson(SESSION_KEY, sessions);
            return ok(next);
        },
        async remove(id) {
            const sessions = getPreviewSessions().filter(item => item.id !== id);
            writeJson(SESSION_KEY, sessions);
            return ok();
        },
        async folderList() {
            return ok(getPreviewFolders());
        },
        async folderSave(folder) {
            const name = folder?.name?.trim();
            if (!name) return fail('文件夹名称不能为空');

            const folders = getPreviewFolders();
            const existing = folders.find(item => item.id === folder.id);
            const next = normalizeFolder({ ...folder, name }, existing);
            const index = folders.findIndex(item => item.id === next.id);
            if (index >= 0) folders.splice(index, 1, next);
            else folders.push(next);
            writeJson(FOLDER_KEY, folders);
            return ok(next);
        },
        async folderRemove(id) {
            const currentFolders = getPreviewFolders();
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
            const folders = currentFolders.filter(item => !removeIds.has(item.id));
            const sessions = getPreviewSessions().filter(item => !removeIds.has(item.folderId));
            writeJson(FOLDER_KEY, folders);
            writeJson(SESSION_KEY, sessions);
            return ok();
        },
        async moveToFolder(sessionId, folderId) {
            const sessions = getPreviewSessions();
            const index = sessions.findIndex(item => item.id === sessionId);
            if (index < 0) return fail('会话不存在');
            sessions.splice(
                index,
                1,
                normalizeSession({ ...sessions[index], folderId: folderId || null }, sessions[index])
            );
            writeJson(SESSION_KEY, sessions);
            return ok(sessions[index]);
        }
    };

    window.scriptApi ||= {
        async list() {
            return ok(getPreviewScripts());
        },
        async save(def) {
            const name = def?.name?.trim();
            if (!name) return fail('脚本名称不能为空');

            const scripts = getPreviewScripts();
            const existing = scripts.find(item => item.id === def.id);
            const next = normalizeScript({ ...def, name }, existing);
            const index = scripts.findIndex(item => item.id === next.id);
            if (index >= 0) scripts.splice(index, 1, next);
            else scripts.push(next);
            writeJson(SCRIPT_KEY, scripts);
            return ok(next);
        },
        async remove(id) {
            const scripts = getPreviewScripts().filter(item => item.id !== id);
            writeJson(SCRIPT_KEY, scripts);
            return ok();
        },
        async importScripts() {
            return fail('预览环境不支持脚本导入');
        },
        async exportScripts(ids = []) {
            const selectedIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
            const scripts = getPreviewScripts().filter(
                script => selectedIds.length === 0 || selectedIds.includes(script.id)
            );
            if (scripts.length === 0) return fail('没有可导出的脚本');
            const payload = JSON.stringify({ version: 1, exportedAt: nowIso(), scripts }, null, 2);
            const blob = new Blob([payload], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = scripts.length === 1 ? `${scripts[0].name || 'script'}.json` : 'nexterm-scripts.json';
            anchor.click();
            URL.revokeObjectURL(url);
            return ok({ canceled: false, count: scripts.length });
        }
    };

    window.terminalApi ||= {
        async connect(options) {
            this.disconnect(options.sessionId);
            const isLocal = isLocalProtocol(options.protocol);
            const isSsh = options.protocol === 'ssh';
            emit('terminal:status', {
                sessionId: options.sessionId,
                status: 'connecting',
                msg: isLocal ? '正在启动本地 Shell' : `正在连接 ${options.host}:${options.port}`
            });

            const queue = [
                window.setTimeout(() => {
                    emit('terminal:status', {
                        sessionId: options.sessionId,
                        status: 'connected',
                        msg: ''
                    });
                }, 360),
                window.setTimeout(() => {
                    emit('terminal:data', {
                        sessionId: options.sessionId,
                        b64: toB64(
                            `NexTerm browser preview\r\n` +
                                (isLocal
                                    ? `Local shell requires Electron with npm run dev.\r\n`
                                    : isSsh
                                      ? `SSH/SFTP requires Electron with npm run dev.\r\n`
                                      : `Connected to ${options.host}:${options.port} (${options.protocol})\r\n`) +
                                `Real terminal sessions run in Electron.\r\n\r\npreview$ `
                        )
                    });
                }, 520)
            ];
            timers.set(options.sessionId, queue);
            return ok();
        },
        disconnect(sessionId) {
            const queue = timers.get(sessionId) || [];
            queue.forEach(id => window.clearTimeout(id));
            timers.delete(sessionId);
            emit('terminal:status', { sessionId, status: 'closed', msg: '连接已关闭' });
            return ok();
        },
        sendInput(sessionId, data) {
            const output = data === '\r' ? '\r\npreview$ ' : data;
            emit('terminal:data', { sessionId, b64: toB64(output) });
        },
        async runScript(payload = {}) {
            const output = String(payload.content || '').trim()
                ? `\r\n[preview] Electron 环境中会执行脚本并把 stdout/stderr 写回终端。\r\n`
                : '';
            emit('script:task', { taskId: payload.taskId, sessionId: payload.sessionId, status: 'running' });
            if (output) emit('terminal:data', { sessionId: payload.sessionId, b64: toB64(output) });
            window.setTimeout(() => {
                emit('script:task', {
                    taskId: payload.taskId,
                    sessionId: payload.sessionId,
                    status: 'completed',
                    exitCode: 0
                });
            }, 80);
            return ok();
        },
        async stopScript(payload = {}) {
            emit('script:task', {
                taskId: payload.taskId,
                sessionId: payload.sessionId,
                status: 'stopped',
                exitCode: null
            });
            return ok();
        },
        async pauseScript() {
            return ok();
        },
        async resumeScript() {
            return ok();
        },
        resize() {},
        onEvent(callback) {
            listeners.add(callback);
            return () => listeners.delete(callback);
        }
    };

    window.sftpApi ||= {
        async list(payload = {}) {
            const base = payload.path || '/';
            return ok({
                path: base,
                entries: [
                    {
                        id: `preview-sftp:${base}/etc`,
                        type: 'file-folder',
                        resource: 'file',
                        name: 'etc',
                        path: base === '/' ? '/etc' : `${base}/etc`,
                        loaded: false,
                        children: []
                    },
                    {
                        id: `preview-sftp:${base}/README.txt`,
                        type: 'file',
                        resource: 'file',
                        name: 'README.txt',
                        path: base === '/' ? '/README.txt' : `${base}/README.txt`,
                        size: 128,
                        loaded: true,
                        children: []
                    }
                ]
            });
        },
        async download() {
            return ok(null, '浏览器预览不执行真实下载');
        },
        async cwd() {
            return ok({ path: '/' }, '获取当前目录成功');
        },
        async upload() {
            return ok(null, '浏览器预览不执行真实上传');
        },
        async mkdir(payload = {}) {
            return ok(
                { path: `${payload.remoteDir || '/'}/${payload.name || 'folder'}`.replace(/\/+/g, '/') },
                '目录已创建'
            );
        },
        async remove() {
            return ok(null, '删除完成');
        },
        async rename(payload = {}) {
            return ok({ path: payload.remotePath || '/' }, '重命名完成');
        },
        getDroppedFilePaths(files = []) {
            return Array.from(files)
                .map(file => file.path || file.name || '')
                .filter(Boolean);
        }
    };

    window.updaterApi ||= {
        async checkForUpdates() {
            return fail('浏览器预览不执行更新检查');
        },
        async downloadUpdate() {
            return fail('浏览器预览不执行更新下载');
        },
        async quitAndInstall() {
            return fail('浏览器预览不执行更新安装');
        },
        async getCurrentVersion() {
            return ok('1.0.0');
        }
    };
}
