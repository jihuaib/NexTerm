const SESSION_KEY = 'nexterm.preview.sessions';
const FOLDER_KEY = 'nexterm.preview.sessionFolders';
const SCRIPT_KEY = 'nexterm.preview.scripts';
const COMMAND_SET_KEY = 'nexterm.preview.commandSets';
const SETTINGS_KEY = 'nexterm.preview.settings';
const KNOWN_HOSTS_KEY = 'nexterm.preview.knownHosts';
const LICENSE_KEY = 'nexterm.preview.license';

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

function previewLicenseStatus() {
    const now = Date.now();
    const stored = readJson(LICENSE_KEY, null);
    const startedAt = stored?.trialStartedAt || new Date(now).toISOString();
    const trialExpiresAt = stored?.trialExpiresAt || new Date(Date.parse(startedAt) + 30 * 24 * 60 * 60 * 1000).toISOString();
    const next = {
        status: stored?.license ? 'active' : Date.parse(trialExpiresAt) > now ? 'trial' : 'expired',
        active: Boolean(stored?.license) || Date.parse(trialExpiresAt) > now,
        machineId: stored?.machineId || 'preview-machine',
        trialStartedAt: startedAt,
        trialExpiresAt,
        daysRemaining: Math.max(0, Math.ceil((Date.parse(trialExpiresAt) - now) / (24 * 60 * 60 * 1000))),
        license: stored?.license || null,
        msg: stored?.license ? '已激活' : '预览环境试用中'
    };
    writeJson(LICENSE_KEY, next);
    return next;
}

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

function isSerialProtocol(protocol) {
    return protocol === 'serial';
}

function defaultPortForProtocol(protocol) {
    if (isLocalProtocol(protocol)) return null;
    if (isSerialProtocol(protocol)) return null;
    if (protocol === 'ssh') return 22;
    return PREVIEW_SETTINGS.defaultPort;
}

function sessionColorForProtocol(protocol) {
    if (isLocalProtocol(protocol)) return 'green';
    if (isSerialProtocol(protocol)) return 'violet';
    if (protocol === 'ssh') return 'blue';
    return 'amber';
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function stringField(def, existing, key, fallback = '') {
    if (hasOwn(def, key)) return String(def[key] || '');
    return existing?.[key] || fallback;
}

function numberField(def, existing, key, fallback, allowed = []) {
    const value = hasOwn(def, key) ? def[key] : existing?.[key];
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    if (allowed.length && !allowed.includes(next)) return fallback;
    return next;
}

function booleanField(def, existing, key, fallback = true) {
    const value = hasOwn(def, key) ? def[key] : existing?.[key];
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function serialParity(value) {
    const next = String(value || '').trim().toLowerCase();
    return ['none', 'even', 'odd', 'mark', 'space'].includes(next) ? next : 'none';
}

function serialFlowControl(value) {
    const next = String(value || '').trim().toLowerCase();
    return ['none', 'hardware', 'software'].includes(next) ? next : 'none';
}

function credentialSaveMode(value) {
    return ['prompt', 'session', 'persist'].includes(value) ? value : 'prompt';
}

function normalizeSession(def = {}, existing = null) {
    const timestamp = nowIso();
    const protocol = def.protocol || existing?.protocol || PREVIEW_SETTINGS.defaultProtocol;
    const isLocal = isLocalProtocol(protocol);
    const isSerial = isSerialProtocol(protocol);
    const host = stringField(def, existing, 'host').trim();
    const serialPath = stringField(def, existing, 'serialPath').trim();
    const port = defaultPortForProtocol(protocol);
    return {
        id: def.id || existing?.id || `preview-${Date.now().toString(36)}`,
        type: 'session',
        resource: 'session',
        name: def.name || existing?.name || host || serialPath || (isLocal ? 'Local Shell' : ''),
        color: sessionColorForProtocol(protocol),
        protocol,
        host: isSerial ? '' : host,
        port: isLocal || isSerial ? null : Number(def.port || existing?.port) || port,
        username: stringField(def, existing, 'username'),
        authType:
            def.authType || existing?.authType || (def.privateKeyPath || existing?.privateKeyPath ? 'key' : 'password'),
        credentialSaveMode: credentialSaveMode(def.credentialSaveMode || existing?.credentialSaveMode),
        password: '',
        hasSavedPassword: Boolean(def.hasSavedPassword ?? existing?.hasSavedPassword),
        privateKeyPath: stringField(def, existing, 'privateKeyPath'),
        passphrase: '',
        hasSavedPassphrase: Boolean(def.hasSavedPassphrase ?? existing?.hasSavedPassphrase),
        shell: stringField(def, existing, 'shell'),
        cwd: stringField(def, existing, 'cwd'),
        serialPath,
        serialBaudRate: numberField(def, existing, 'serialBaudRate', 115200),
        serialDataBits: numberField(def, existing, 'serialDataBits', 8, [5, 6, 7, 8]),
        serialStopBits: numberField(def, existing, 'serialStopBits', 1, [1, 2]),
        serialParity: serialParity(hasOwn(def, 'serialParity') ? def.serialParity : existing?.serialParity),
        serialFlowControl: serialFlowControl(
            hasOwn(def, 'serialFlowControl') ? def.serialFlowControl : existing?.serialFlowControl
        ),
        serialDtr: booleanField(def, existing, 'serialDtr', true),
        serialRts: booleanField(def, existing, 'serialRts', true),
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

function normalizeCommandSetCommands(value) {
    const list = Array.isArray(value) ? value : String(value || '').replace(/\r/g, '').split('\n');
    return list.map(line => String(line || '').trimEnd()).filter(line => line.trim());
}

function normalizeCommandSet(def = {}, existing = null) {
    const timestamp = nowIso();
    const color = ['blue', 'green', 'amber', 'violet', 'rose', 'cyan'].includes(def.color || existing?.color)
        ? def.color || existing?.color
        : 'blue';
    return {
        id: def.id || existing?.id || `preview-command-set-${Date.now().toString(36)}`,
        name: def.name?.trim() || existing?.name || '新建指令集',
        color,
        commands: normalizeCommandSetCommands(def.commands ?? existing?.commands ?? []),
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

function getPreviewCommandSets() {
    const stored = readJson(COMMAND_SET_KEY, null);
    if (Array.isArray(stored)) return stored.map(item => normalizeCommandSet(item, item));
    writeJson(COMMAND_SET_KEY, []);
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

    if (window.sessionApi && window.commandSetApi && window.terminalApi && window.settingsApi && window.sftpApi) return;

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

    window.licenseApi ||= {
        async get() {
            return ok(previewLicenseStatus());
        },
        async request() {
            return ok({
                version: 1,
                productId: 'nexterm',
                appVersion: 'preview',
                machineId: previewLicenseStatus().machineId,
                requestId: `preview-${Date.now().toString(36)}`,
                createdAt: new Date().toISOString()
            });
        },
        async exportRequest() {
            return ok({ canceled: false, path: 'preview/activation-request.json', request: (await this.request()).data });
        },
        async importText(text = '') {
            const license = JSON.parse(String(text || '{}'));
            const current = previewLicenseStatus();
            writeJson(LICENSE_KEY, { ...current, status: 'active', active: true, license });
            return ok(previewLicenseStatus());
        },
        async importFile() {
            return fail('预览环境不支持选择授权文件');
        },
        async remove() {
            const current = previewLicenseStatus();
            writeJson(LICENSE_KEY, { ...current, status: 'trial', active: true, license: null });
            return ok(previewLicenseStatus());
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
            if (
                !isLocalProtocol(def.protocol) &&
                !isSerialProtocol(def.protocol) &&
                (!def.host || !String(def.host).trim())
            )
                return fail('请填写主机地址');
            if (isSerialProtocol(def.protocol) && (!def.serialPath || !String(def.serialPath).trim()))
                return fail('请选择串口设备');
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

    window.commandSetApi ||= {
        async list() {
            return ok(getPreviewCommandSets());
        },
        async save(def) {
            const name = def?.name?.trim();
            if (!name) return fail('指令集名称不能为空');
            if (normalizeCommandSetCommands(def?.commands).length === 0) return fail('请至少填写一条指令');

            const commandSets = getPreviewCommandSets();
            const existing = commandSets.find(item => item.id === def.id);
            const next = normalizeCommandSet({ ...def, name }, existing);
            const index = commandSets.findIndex(item => item.id === next.id);
            if (index >= 0) commandSets.splice(index, 1, next);
            else commandSets.push(next);
            writeJson(COMMAND_SET_KEY, commandSets);
            return ok(next);
        },
        async remove(id) {
            const commandSets = getPreviewCommandSets().filter(item => item.id !== id);
            writeJson(COMMAND_SET_KEY, commandSets);
            return ok();
        }
    };

    window.terminalApi ||= {
        async connect(options) {
            this.disconnect(options.sessionId);
            const isLocal = isLocalProtocol(options.protocol);
            const isSsh = options.protocol === 'ssh';
            const isSerial = isSerialProtocol(options.protocol);
            emit('terminal:status', {
                sessionId: options.sessionId,
                status: 'connecting',
                msg: isLocal
                    ? '正在启动本地 Shell'
                    : isSerial
                      ? `正在打开串口 ${options.serialPath}`
                      : `正在连接 ${options.host}:${options.port}`
            });

            const queue = [
                window.setTimeout(() => {
                    const credentialSaved =
                        isSsh && options.credentialSaveMode === 'persist' && options.profileId
                            ? {
                                  profileId: options.profileId,
                                  password: Boolean(options.password),
                                  passphrase: Boolean(options.passphrase)
                              }
                            : null;
                    emit('terminal:status', {
                        sessionId: options.sessionId,
                        status: 'connected',
                        msg: '',
                        ...(credentialSaved && (credentialSaved.password || credentialSaved.passphrase)
                            ? { credentialSaved }
                            : {})
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
                                      : isSerial
                                        ? `Serial ports require Electron with npm run dev.\r\n`
                                        : `Connected to ${options.host}:${options.port} (${options.protocol})\r\n`) +
                                `Real terminal sessions run in Electron.\r\n\r\npreview$ `
                        )
                    });
                }, 520)
            ];
            timers.set(options.sessionId, queue);
            return ok();
        },
        async listSerialPorts() {
            return ok([
                {
                    path: '/dev/tty.usbserial-preview',
                    label: '/dev/tty.usbserial-preview (Preview)',
                    manufacturer: 'Preview',
                    serialNumber: '',
                    pnpId: '',
                    locationId: '',
                    vendorId: '',
                    productId: ''
                },
                {
                    path: 'COM3',
                    label: 'COM3 (Preview)',
                    manufacturer: 'Preview',
                    serialNumber: '',
                    pnpId: '',
                    locationId: '',
                    vendorId: '',
                    productId: ''
                }
            ]);
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
                ? `\r\n[preview] Electron 环境中会执行脚本并把 stdout 写回终端，错误显示在任务状态里。\r\n`
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

    window.portForwardApi ||= {
        async list() {
            return ok([]);
        },
        async start(payload = {}) {
            const forward = {
                id: payload.id || `preview-forward-${Date.now().toString(36)}`,
                sessionId: payload.type === 'direct' ? '' : payload.sessionId || '',
                type: payload.type || 'direct',
                transport: payload.type === 'direct' && payload.transport === 'udp' ? 'udp' : 'tcp',
                name: payload.name || '',
                bindHost: payload.bindHost || '127.0.0.1',
                bindPort: Number(payload.bindPort) || 0,
                targetHost: payload.targetHost || '',
                targetPort: Number(payload.targetPort) || null,
                status: 'active',
                startedAt: nowIso(),
                msg: '预览环境不执行真实端口转发'
            };
            emit('port-forward:update', forward);
            return ok(forward, '端口转发已启动');
        },
        async stop(payload = {}) {
            const forward = {
                id: typeof payload === 'string' ? payload : payload.id,
                status: 'stopped',
                msg: '端口转发已停止'
            };
            emit('port-forward:update', forward);
            return ok(forward, '端口转发已停止');
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
