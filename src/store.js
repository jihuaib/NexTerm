import { reactive } from 'vue';
import { applyAppTheme } from './theme/themeManager';
import {
    ALL_SESSIONS_FOLDER_ID,
    FILE_ROOT_ID,
    UNGROUPED_FOLDER_ID,
    createDefaultFileResourceTree,
    createSessionResourceTree,
    defaultPortForProtocol,
    getSessionsForFolder,
    getProtocolSessionColor,
    isLocalSessionProtocol,
    isSerialSessionProtocol,
    isSshSessionProtocol,
    normalizeCredentialSaveMode,
    normalizeSerialBoolean,
    normalizeSerialFlowControl,
    normalizeSerialNumber,
    normalizeSerialParity,
    normalizeSessionFolder,
    normalizeSessionProfile
} from './models/resources';
import {
    addSessionToLeaf,
    findLeaf,
    findFirstLeaf,
    findSession,
    genId,
    getLeafSessions,
    insertSessionIntoLeaf,
    makeLeaf,
    removeLeaf,
    removeSessionFromLeaf,
    reorderSessionInLeaf,
    setLeafActiveSession,
    splitLeaf
} from './layout';
import { disposeTerminalView } from './services/terminalViews';
import { normalizeCommandSet, normalizeCommandSetCommands } from './services/commandSets';
import { createScriptTaskId, DEFAULT_SCRIPT_LANGUAGE, getScriptLanguage } from './services/terminalScriptRunner';
import {
    createDefaultTerminalHighlightRules,
    mergeMissingDefaultTerminalHighlightRules
} from './services/terminalHighlightRules';
import { eventBus } from './utils/eventBus';

export { ALL_SESSIONS_FOLDER_ID, UNGROUPED_FOLDER_ID };

// 设置默认值（与 electron/app/settingsApp.js 的 DEFAULTS 镜像）
export const DEFAULT_SETTINGS = {
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
    terminalHighlightEnabled: true,
    terminalHighlightRules: createDefaultTerminalHighlightRules(),
    updateAutoCheckOnStartup: true,
    updateAutoDownload: false
};

const rootLeaf = makeLeaf(null);
let runtimeSessionSeq = 0;
const initialSessionTree = createSessionResourceTree();

// 简单的全局响应式状态（基础版无需 Vuex）
export const store = reactive({
    sessions: [], // 已保存的会话定义
    sessionFolders: [], // 会话文件夹
    sessionTree: initialSessionTree,
    selectedFolderId: ALL_SESSIONS_FOLDER_ID,
    fileTree: createDefaultFileResourceTree(),
    selectedFileNodeId: FILE_ROOT_ID,
    scripts: [],
    commandSets: [],
    scriptTasks: [],
    portForwards: [],
    license: {
        status: 'loading',
        active: true,
        machineId: '',
        daysRemaining: null,
        msg: '授权状态读取中'
    },
    layout: rootLeaf, // Tab Group 分屏布局树
    activePaneId: rootLeaf.id, // 当前聚焦的 Tab Group id
    settings: { ...DEFAULT_SETTINGS },
    settingsOpen: false
});

function genRuntimeId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function genPortForwardId() {
    return 'pf-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function nowIso() {
    return new Date().toISOString();
}

function normalizeScript(def = {}) {
    const language = getScriptLanguage(def.languageId || DEFAULT_SCRIPT_LANGUAGE);
    return {
        id: def.id || '',
        name: String(def.name || '').trim() || '新建脚本',
        languageId: language.id,
        command: language.id === 'custom' ? String(def.command || '').trim() : '',
        content: String(def.content || ''),
        description: String(def.description || ''),
        createdAt: def.createdAt || '',
        updatedAt: def.updatedAt || ''
    };
}

function toPlainCommandSetPayload(def = {}) {
    const commandSet = normalizeCommandSet(def);
    return {
        id: commandSet.id || undefined,
        name: commandSet.name,
        color: commandSet.color,
        commands: commandSet.commands,
        description: commandSet.description
    };
}

function normalizePortForward(def = {}, existing = null) {
    const type = ['direct', 'local', 'remote', 'dynamic'].includes(def.type) ? def.type : existing?.type || 'direct';
    const transport =
        type === 'direct' && ['tcp', 'udp'].includes(def.transport || existing?.transport)
            ? def.transport || existing?.transport
            : 'tcp';
    return {
        id: def.id || existing?.id || genPortForwardId(),
        sessionId: type === 'direct' ? '' : def.sessionId || existing?.sessionId || '',
        type,
        transport,
        name: String(def.name ?? existing?.name ?? '').trim(),
        bindHost: String(def.bindHost ?? existing?.bindHost ?? '127.0.0.1').trim() || '127.0.0.1',
        bindPort: Number(def.bindPort ?? existing?.bindPort) || 0,
        targetHost: type === 'dynamic' ? '' : String(def.targetHost ?? existing?.targetHost ?? '').trim(),
        targetPort: type === 'dynamic' ? null : Number(def.targetPort ?? existing?.targetPort) || null,
        status: def.status || existing?.status || 'stopped',
        startedAt: def.startedAt || existing?.startedAt || '',
        msg: def.msg ?? existing?.msg ?? ''
    };
}

function upsertPortForward(def = {}) {
    const index = store.portForwards.findIndex(item => item.id === def.id);
    const existing = index >= 0 ? store.portForwards[index] : null;
    const next = normalizePortForward(def, existing);
    if (index >= 0) Object.assign(store.portForwards[index], next);
    else store.portForwards.unshift(next);
    return index >= 0 ? store.portForwards[index] : next;
}

function makeRuntimeSession(def) {
    const protocol = def.protocol || store.settings.defaultProtocol;
    const isLocal = isLocalSessionProtocol(protocol);
    const isSerial = isSerialSessionProtocol(protocol);
    const port = defaultPortForProtocol(protocol, store.settings.defaultPort);
    const serialPath = String(def.serialPath || '').trim();
    return {
        profileId: def.id || null,
        sessionId: genRuntimeId(),
        runtimeOrder: ++runtimeSessionSeq,
        name: def.name || def.host || serialPath || (isLocal ? 'Local Shell' : ''),
        color: getProtocolSessionColor(protocol),
        host: isSerial ? '' : def.host || '',
        port: isLocal || isSerial ? null : Number(def.port) || port,
        protocol,
        username: def.username || '',
        authType: def.authType || (def.privateKeyPath ? 'key' : 'password'),
        credentialSaveMode: isLocal ? 'prompt' : normalizeCredentialSaveMode(def.credentialSaveMode),
        password: def.password || '',
        hasSavedPassword: Boolean(def.hasSavedPassword),
        privateKeyPath: def.privateKeyPath || '',
        passphrase: def.passphrase || '',
        hasSavedPassphrase: Boolean(def.hasSavedPassphrase),
        shell: def.shell || '',
        cwd: def.cwd || '',
        serialPath,
        serialBaudRate: normalizeSerialNumber(
            def.serialBaudRate,
            store.settings.defaultSerialBaudRate || 115200
        ),
        serialDataBits: normalizeSerialNumber(def.serialDataBits, store.settings.defaultSerialDataBits || 8, [5, 6, 7, 8]),
        serialStopBits: normalizeSerialNumber(def.serialStopBits, store.settings.defaultSerialStopBits || 1, [1, 2]),
        serialParity: normalizeSerialParity(def.serialParity || store.settings.defaultSerialParity),
        serialFlowControl: normalizeSerialFlowControl(def.serialFlowControl || store.settings.defaultSerialFlowControl),
        serialDtr: normalizeSerialBoolean(def.serialDtr, store.settings.defaultSerialDtr),
        serialRts: normalizeSerialBoolean(def.serialRts, store.settings.defaultSerialRts),
        status: 'connecting',
        connectionStarted: false,
        manualDisconnect: false,
        reconnectAttempts: 0
    };
}

function isEdgeZone(zone) {
    return zone === 'left' || zone === 'right' || zone === 'top' || zone === 'bottom';
}

function splitParams(zone) {
    return {
        dir: zone === 'left' || zone === 'right' ? 'row' : 'col',
        side: zone === 'left' || zone === 'top' ? 'start' : 'end'
    };
}

function rebuildSessionTree() {
    store.sessionTree = createSessionResourceTree({
        folders: store.sessionFolders,
        sessions: store.sessions
    });
}

export function normalizeSessionFolderId(folderId) {
    if (!folderId || folderId === ALL_SESSIONS_FOLDER_ID || folderId === UNGROUPED_FOLDER_ID) return null;
    return folderId;
}

function removeEmptyGroupIfNeeded(layout, paneId) {
    const leaf = findLeaf(layout, paneId);
    if (!leaf || getLeafSessions(leaf).length > 0) return layout;
    if (layout.type === 'leaf' && layout.id === paneId) return layout;
    return removeLeaf(layout, paneId);
}

// ---------- 设置 / 主题 ----------
export async function loadSettings() {
    const res = await window.settingsApi.get();
    if (res.status === 'success') {
        const data = { ...res.data };
        data.terminalHighlightEnabled = data.terminalHighlightEnabled !== false;
        data.terminalHighlightRules = mergeMissingDefaultTerminalHighlightRules(data.terminalHighlightRules);
        Object.assign(store.settings, data);
    }
    applyAppTheme(store.settings.themeId);
}

export async function updateSettings(patch) {
    const nextPatch = { ...patch };
    if ('terminalHighlightEnabled' in nextPatch) {
        nextPatch.terminalHighlightEnabled = nextPatch.terminalHighlightEnabled !== false;
    }
    if ('terminalHighlightRules' in nextPatch) {
        nextPatch.terminalHighlightRules = mergeMissingDefaultTerminalHighlightRules(nextPatch.terminalHighlightRules);
    }
    Object.assign(store.settings, nextPatch);
    if ('themeId' in nextPatch) applyAppTheme(store.settings.themeId);
    await window.settingsApi.save(nextPatch);
}

export function openSettings() {
    store.settingsOpen = true;
}
export function closeSettings() {
    store.settingsOpen = false;
}

// ---------- 授权 / 试用 ----------
export async function loadLicenseStatus() {
    if (!window.licenseApi?.get) {
        store.license = {
            status: 'trial',
            active: true,
            machineId: '',
            daysRemaining: 30,
            msg: '预览环境试用中'
        };
        return store.license;
    }
    const res = await window.licenseApi.get();
    if (res.status === 'success') store.license = res.data;
    return store.license;
}

export async function refreshLicenseStatus() {
    return loadLicenseStatus();
}

// ---------- 会话定义管理 ----------
export async function loadSessions() {
    const res = await window.sessionApi.list();
    if (res.status === 'success') {
        store.sessions = res.data.map(session => normalizeSessionProfile(session, store.settings));
        rebuildSessionTree();
    }
}

export async function loadSessionFolders() {
    if (!window.sessionApi.folderList) return;
    const res = await window.sessionApi.folderList();
    if (res.status === 'success') {
        store.sessionFolders = res.data.map(normalizeSessionFolder);
        rebuildSessionTree();
    }
}

function toPlainSessionPayload(def = {}) {
    const protocol = def.protocol || store.settings.defaultProtocol;
    const isLocal = isLocalSessionProtocol(protocol);
    const isSerial = isSerialSessionProtocol(protocol);
    const isSsh = isSshSessionProtocol(protocol);
    const authType = isSsh ? def.authType || (def.privateKeyPath ? 'key' : 'password') : '';
    const port = defaultPortForProtocol(protocol, store.settings.defaultPort);
    return {
        id: def.id || undefined,
        name: String(def.name || '').trim(),
        color: getProtocolSessionColor(protocol),
        folderId: normalizeSessionFolderId(def.folderId),
        protocol,
        host: isLocal || isSerial ? '' : String(def.host || '').trim(),
        port: isLocal || isSerial ? null : Number(def.port) || port,
        username: isSsh ? String(def.username || '').trim() : '',
        authType,
        credentialSaveMode: isSsh ? normalizeCredentialSaveMode(def.credentialSaveMode) : 'prompt',
        password: '',
        hasSavedPassword: false,
        privateKeyPath: isSsh && authType === 'key' ? String(def.privateKeyPath || '').trim() : '',
        passphrase: '',
        hasSavedPassphrase: false,
        shell: isLocal ? String(def.shell || '').trim() : '',
        cwd: isLocal ? String(def.cwd || '').trim() : '',
        serialPath: isSerial ? String(def.serialPath || '').trim() : '',
        serialBaudRate: isSerial
            ? normalizeSerialNumber(def.serialBaudRate, store.settings.defaultSerialBaudRate || 115200)
            : store.settings.defaultSerialBaudRate || 115200,
        serialDataBits: isSerial
            ? normalizeSerialNumber(def.serialDataBits, store.settings.defaultSerialDataBits || 8, [5, 6, 7, 8])
            : store.settings.defaultSerialDataBits || 8,
        serialStopBits: isSerial
            ? normalizeSerialNumber(def.serialStopBits, store.settings.defaultSerialStopBits || 1, [1, 2])
            : store.settings.defaultSerialStopBits || 1,
        serialParity: isSerial ? normalizeSerialParity(def.serialParity) : store.settings.defaultSerialParity || 'none',
        serialFlowControl: isSerial
            ? normalizeSerialFlowControl(def.serialFlowControl)
            : store.settings.defaultSerialFlowControl || 'none',
        serialDtr: isSerial ? normalizeSerialBoolean(def.serialDtr, store.settings.defaultSerialDtr) : true,
        serialRts: isSerial ? normalizeSerialBoolean(def.serialRts, store.settings.defaultSerialRts) : true,
        tags: Array.isArray(def.tags) ? def.tags.map(tag => String(tag)) : [],
        description: String(def.description || '')
    };
}

export async function saveSession(def) {
    const res = await window.sessionApi.save(toPlainSessionPayload(def));
    if (res.status === 'success') await loadSessions();
    return res;
}

export async function deleteSession(id) {
    await window.sessionApi.remove(id);
    await loadSessions();
}

export function selectSessionFolder(folderId) {
    store.selectedFolderId = folderId || ALL_SESSIONS_FOLDER_ID;
}

export function getCreateFolderId(selection = store.selectedFolderId) {
    return normalizeSessionFolderId(selection);
}

export function getSelectedSessionItems() {
    return getSessionsForFolder(store.sessionTree, store.selectedFolderId);
}

export async function createSessionFolder(name, parentId = null) {
    if (!window.sessionApi.folderSave) return { status: 'error', msg: '当前环境不支持会话文件夹', data: null };
    const res = await window.sessionApi.folderSave({
        name,
        parentId: normalizeSessionFolderId(parentId)
    });
    if (res.status === 'success') {
        await loadSessionFolders();
        store.selectedFolderId = res.data.id;
    }
    return res;
}

export async function deleteSessionFolder(id) {
    if (!window.sessionApi.folderRemove) return { status: 'error', msg: '当前环境不支持删除会话文件夹', data: null };
    const res = await window.sessionApi.folderRemove(id);
    if (res.status === 'success') {
        await Promise.all([loadSessionFolders(), loadSessions()]);
        const selectedIsRealFolder =
            store.selectedFolderId !== ALL_SESSIONS_FOLDER_ID && store.selectedFolderId !== UNGROUPED_FOLDER_ID;
        const selectedFolderExists = store.sessionFolders.some(folder => folder.id === store.selectedFolderId);
        if (store.selectedFolderId === id || (selectedIsRealFolder && !selectedFolderExists)) {
            store.selectedFolderId = UNGROUPED_FOLDER_ID;
        }
    }
    return res;
}

export async function moveSessionToFolder(sessionId, folderId) {
    if (!window.sessionApi.moveToFolder) return { status: 'error', msg: '当前环境不支持移动会话', data: null };
    const res = await window.sessionApi.moveToFolder(sessionId, normalizeSessionFolderId(folderId));
    if (res.status === 'success') await loadSessions();
    return res;
}

// ---------- 脚本库 / 执行任务 ----------
export async function loadScripts() {
    if (!window.scriptApi?.list) return;
    const res = await window.scriptApi.list();
    if (res.status === 'success') store.scripts = res.data.map(normalizeScript);
}

function toPlainScriptPayload(def = {}) {
    const script = normalizeScript(def);
    return {
        id: script.id || undefined,
        name: script.name,
        languageId: script.languageId,
        command: script.command,
        content: script.content,
        description: script.description
    };
}

export async function saveScript(def) {
    if (!window.scriptApi?.save) return { status: 'error', msg: '当前环境不支持脚本库', data: null };
    const res = await window.scriptApi.save(toPlainScriptPayload(def));
    if (res.status === 'success') await loadScripts();
    return res;
}

export async function deleteScript(id) {
    if (!window.scriptApi?.remove) return { status: 'error', msg: '当前环境不支持删除脚本', data: null };
    const res = await window.scriptApi.remove(id);
    if (res.status === 'success') await loadScripts();
    return res;
}

export async function importScripts() {
    if (!window.scriptApi?.importScripts) return { status: 'error', msg: '当前环境不支持导入脚本', data: null };
    const res = await window.scriptApi.importScripts();
    if (res.status === 'success' && !res.data?.canceled) await loadScripts();
    return res;
}

export async function exportScripts(ids = []) {
    if (!window.scriptApi?.exportScripts) return { status: 'error', msg: '当前环境不支持导出脚本', data: null };
    return window.scriptApi.exportScripts(ids);
}

// ---------- 指令集 ----------
export async function loadCommandSets() {
    if (!window.commandSetApi?.list) return;
    const res = await window.commandSetApi.list();
    if (res.status === 'success') store.commandSets = res.data.map(normalizeCommandSet);
}

export async function saveCommandSet(def) {
    if (!window.commandSetApi?.save) return { status: 'error', msg: '当前环境不支持指令集', data: null };
    const res = await window.commandSetApi.save(toPlainCommandSetPayload(def));
    if (res.status === 'success') await loadCommandSets();
    return res;
}

export async function deleteCommandSet(id) {
    if (!window.commandSetApi?.remove) return { status: 'error', msg: '当前环境不支持删除指令集', data: null };
    const res = await window.commandSetApi.remove(id);
    if (res.status === 'success') await loadCommandSets();
    return res;
}

export function sendCommandSetToSession(commandSet, sessionId) {
    const session = findSession(store.layout, sessionId);
    if (!session) return { status: 'error', msg: '当前控制台不存在', data: null };
    if (session.status !== 'connected') return { status: 'error', msg: '当前控制台未连接', data: null };
    const commands = normalizeCommandSetCommands(commandSet?.commands);
    if (!commands.length) return { status: 'error', msg: '指令集没有可发送的命令', data: null };
    window.terminalApi.sendInput(sessionId, `${commands.join('\n')}\n`);
    return { status: 'success', msg: '指令已发送', data: { count: commands.length } };
}

// ---------- 端口转发 ----------
export async function loadPortForwards() {
    if (!window.portForwardApi?.list) return;
    const res = await window.portForwardApi.list();
    if (res.status === 'success') store.portForwards = res.data.map(item => normalizePortForward(item));
}

export function createPortForwardDraft(patch = {}) {
    return normalizePortForward({
        type: 'direct',
        transport: 'tcp',
        bindHost: '127.0.0.1',
        bindPort: 8080,
        targetHost: '127.0.0.1',
        targetPort: 80,
        ...patch
    });
}

export async function startPortForward(def = {}) {
    const forward = normalizePortForward(def);
    upsertPortForward({ ...forward, status: 'starting', msg: '' });
    const res = await window.portForwardApi.start(forward);
    if (res.status === 'success') {
        upsertPortForward({ ...forward, ...res.data, status: res.data?.status || 'active' });
    } else {
        upsertPortForward({ ...forward, status: 'error', msg: res.msg || '启动端口转发失败' });
    }
    return res;
}

export async function stopPortForward(id) {
    const forward = store.portForwards.find(item => item.id === id);
    if (!forward) return { status: 'error', msg: '端口转发不存在', data: null };
    if (forward.status !== 'active' && forward.status !== 'starting') {
        forward.status = 'stopped';
        return { status: 'success', msg: '端口转发已停止', data: forward };
    }
    const res = await window.portForwardApi.stop({ id });
    if (res.status === 'success') upsertPortForward({ ...forward, ...res.data, status: 'stopped' });
    else upsertPortForward({ ...forward, status: 'error', msg: res.msg || '停止端口转发失败' });
    return res;
}

export async function deletePortForward(id) {
    const forward = store.portForwards.find(item => item.id === id);
    if (forward && (forward.status === 'active' || forward.status === 'starting')) await stopPortForward(id);
    const index = store.portForwards.findIndex(item => item.id === id);
    if (index >= 0) store.portForwards.splice(index, 1);
    return { status: 'success', msg: '端口转发已删除', data: null };
}

export function getConnectedSessions() {
    const connected = collectRuntimeSessions().filter(item => item.session.status === 'connected');
    const needsWindowLabel = connected.length > 1;

    return connected.map(item => {
        const session = item.session;
        const baseName = session.name || session.host || session.sessionId;
        const targetLabel = needsWindowLabel
            ? `${baseName} · 窗口 ${item.windowIndex} · 标签 ${item.tabIndex}${item.isCurrent ? ' · 当前' : ''}`
            : baseName;
        return {
            ...session,
            targetLabel
        };
    });
}

function collectRuntimeSessions() {
    const list = [];
    let windowIndex = 0;
    function visit(node) {
        if (!node) return;
        if (node.type === 'leaf') {
            windowIndex += 1;
            getLeafSessions(node).forEach((session, index) =>
                list.push({
                    session,
                    windowId: node.id,
                    windowIndex,
                    tabIndex: index + 1,
                    isCurrent: node.id === store.activePaneId && session.sessionId === node.activeSessionId
                })
            );
            return;
        }
        const children = Array.isArray(node.children) ? node.children : [node.first, node.second];
        children.forEach(visit);
    }
    visit(store.layout);
    return list;
}

function taskIsActive(task) {
    return task && (task.status === 'running' || task.status === 'paused');
}

function findActiveTaskForSession(sessionId, ignoredTaskId = '') {
    return store.scriptTasks.find(
        task => task.sessionId === sessionId && task.id !== ignoredTaskId && taskIsActive(task)
    );
}

function findScriptTask(taskId) {
    return store.scriptTasks.find(task => task.id === taskId);
}

function createScriptTask(script, session, taskId) {
    const language = getScriptLanguage(script.languageId);
    return {
        id: taskId,
        scriptId: script.id || '',
        scriptName: script.name || '未命名脚本',
        languageId: language.id,
        languageLabel: language.label,
        command: script.command || '',
        content: script.content || '',
        sessionId: session.sessionId,
        sessionName: session.name || session.host || session.sessionId,
        status: 'running',
        exitCode: null,
        msg: '',
        errorDetail: '',
        startedAt: nowIso(),
        finishedAt: ''
    };
}

function taskPayload(task) {
    return {
        taskId: task.id,
        sessionId: task.sessionId,
        languageId: task.languageId,
        command: task.command,
        content: task.content
    };
}

export async function runScriptOnSession(scriptDef, sessionId) {
    return startScriptOnSession(scriptDef, sessionId);
}

async function startScriptOnSession(scriptDef, sessionId, existingTask = null) {
    const script = normalizeScript(scriptDef);
    if (!script.content.trim()) return { status: 'error', msg: '脚本内容不能为空', data: null };
    if (existingTask && taskIsActive(existingTask)) {
        return { status: 'error', msg: '任务正在执行中', data: null };
    }

    const session = findSession(store.layout, sessionId);
    if (!session || session.status !== 'connected') {
        return { status: 'error', msg: '请选择已连接的终端窗口', data: null };
    }
    if (findActiveTaskForSession(session.sessionId, existingTask?.id)) {
        return { status: 'error', msg: '该终端已有脚本任务在执行', data: null };
    }

    const taskId = existingTask?.id || createScriptTaskId();
    const task = existingTask || createScriptTask(script, session, taskId);
    Object.assign(task, createScriptTask(script, session, taskId));
    if (!existingTask) store.scriptTasks.unshift(task);
    const res = await window.terminalApi.runScript(taskPayload(task));
    if (res.status !== 'success') {
        if (!existingTask) {
            const index = store.scriptTasks.findIndex(item => item.id === task.id);
            if (index >= 0) store.scriptTasks.splice(index, 1);
        } else {
            task.status = task.exitCode === 0 ? 'completed' : 'failed';
        }
        return res;
    }
    return { status: 'success', msg: '脚本已发送到终端', data: task };
}

export async function stopScriptTask(taskId) {
    const task = typeof taskId === 'object' ? taskId : findScriptTask(taskId);
    if (!task || !taskIsActive(task)) return { status: 'error', msg: '任务不存在或未运行', data: null };
    const res = await window.terminalApi.stopScript({ sessionId: task.sessionId, taskId: task.id });
    if (res.status !== 'success') return res;
    task.status = 'stopped';
    task.finishedAt = nowIso();
    return res;
}

export async function pauseScriptTask(taskId) {
    const task = typeof taskId === 'object' ? taskId : findScriptTask(taskId);
    if (!task || task.status !== 'running') return { status: 'error', msg: '任务不存在或未运行', data: null };
    const res = await window.terminalApi.pauseScript({ sessionId: task.sessionId, taskId: task.id });
    if (res.status !== 'success') return res;
    task.status = 'paused';
    return res;
}

export async function resumeScriptTask(taskId) {
    const task = typeof taskId === 'object' ? taskId : findScriptTask(taskId);
    if (!task || task.status !== 'paused') return { status: 'error', msg: '任务不存在或未暂停', data: null };
    const res = await window.terminalApi.resumeScript({ sessionId: task.sessionId, taskId: task.id });
    if (res.status !== 'success') return res;
    task.status = 'running';
    return res;
}

export async function rerunScriptTask(taskId) {
    const task = typeof taskId === 'object' ? taskId : findScriptTask(taskId);
    if (!task) return { status: 'error', msg: '任务不存在', data: null };
    return startScriptOnSession(
        {
            id: task.scriptId,
            name: task.scriptName,
            languageId: task.languageId,
            command: task.command,
            content: task.content
        },
        task.sessionId,
        task
    );
}

export async function deleteScriptTask(taskId) {
    const task = typeof taskId === 'object' ? taskId : findScriptTask(taskId);
    if (!task) return { status: 'error', msg: '任务不存在', data: null };
    if (taskIsActive(task)) await window.terminalApi.stopScript({ sessionId: task.sessionId, taskId: task.id });
    const index = store.scriptTasks.findIndex(item => item.id === task.id);
    if (index >= 0) store.scriptTasks.splice(index, 1);
    return { status: 'success', msg: '任务已删除', data: null };
}

function handleScriptTaskEvent(payload = {}) {
    const task = findScriptTask(payload.taskId);
    if (!task || task.status === 'stopped') return;
    if (payload.status === 'running') {
        task.status = 'running';
        task.exitCode = null;
        task.msg = '';
        task.errorDetail = '';
        task.finishedAt = '';
        return;
    }
    if (payload.status === 'completed' || payload.status === 'failed' || payload.status === 'stopped') {
        task.status = payload.status;
        task.exitCode = payload.exitCode ?? task.exitCode;
        task.msg = payload.msg || '';
        task.errorDetail = payload.details || '';
        task.finishedAt = nowIso();
    }
}

function handleScriptTerminalStatus(payload = {}) {
    if (!payload.sessionId) return;
    if (payload.credentialSaved?.profileId) {
        const saved = payload.credentialSaved;
        const profile = store.sessions.find(session => session.id === saved.profileId);
        let profileChanged = false;
        if (profile) {
            if (saved.password && !profile.hasSavedPassword) {
                profile.hasSavedPassword = true;
                profileChanged = true;
            }
            if (saved.passphrase && !profile.hasSavedPassphrase) {
                profile.hasSavedPassphrase = true;
                profileChanged = true;
            }
        }
        collectRuntimeSessions().forEach(item => {
            if (item.session.profileId !== saved.profileId) return;
            if (saved.password) item.session.hasSavedPassword = true;
            if (saved.passphrase) item.session.hasSavedPassphrase = true;
        });
        if (profileChanged) rebuildSessionTree();
    }
    if (payload.status !== 'closed' && payload.status !== 'error') return;
    store.scriptTasks.forEach(task => {
        if (task.sessionId !== payload.sessionId || !taskIsActive(task)) return;
        task.status = payload.status === 'error' ? 'failed' : 'stopped';
        task.finishedAt = nowIso();
    });
    store.portForwards.forEach(forward => {
        if (forward.sessionId !== payload.sessionId || forward.status === 'stopped') return;
        forward.status = 'stopped';
        forward.msg = payload.status === 'error' ? 'SSH 会话异常断开' : 'SSH 会话已断开';
    });
}

function handlePortForwardEvent(payload = {}) {
    if (!payload.id) return;
    upsertPortForward(payload);
}

let scriptTaskEventsReady = false;

export function initScriptTaskEvents() {
    if (scriptTaskEventsReady) return;
    scriptTaskEventsReady = true;
    eventBus.on('script:task', handleScriptTaskEvent);
    eventBus.on('terminal:status', handleScriptTerminalStatus);
    eventBus.on('port-forward:update', handlePortForwardEvent);
}

// ---------- Tab Group / 连接 ----------
export function setActivePane(paneId) {
    store.activePaneId = paneId;
}

// 打开会话 = 加入当前 Tab Group，不自动分屏
export function openSession(def) {
    const session = makeRuntimeSession(def);
    const active = findLeaf(store.layout, store.activePaneId);
    const targetId = active ? active.id : findFirstLeaf(store.layout).id;
    store.layout = addSessionToLeaf(store.layout, targetId, session);
    store.activePaneId = targetId;
}

export function activateGroupTab(paneId, sessionId) {
    store.layout = setLeafActiveSession(store.layout, paneId, sessionId);
    store.activePaneId = paneId;
}

export function closeGroupTab(paneId, sessionId) {
    const session = findSession(store.layout, sessionId);
    if (session) session.manualDisconnect = true;
    window.terminalApi.disconnect(sessionId);
    disposeTerminalView(sessionId);
    let nextLayout = removeSessionFromLeaf(store.layout, paneId, sessionId);
    nextLayout = removeEmptyGroupIfNeeded(nextLayout, paneId);
    store.layout = nextLayout;
    if (!findLeaf(store.layout, store.activePaneId)) {
        store.activePaneId = findFirstLeaf(store.layout).id;
    }
}

// 拖已打开 Tab 到其他组 = 移动；拖到边缘 = 创建新 Tab Group
export function moveOpenSessionIntoPane(targetPaneId, payload, zone) {
    const source = findLeaf(store.layout, payload.sourcePaneId);
    const target = findLeaf(store.layout, targetPaneId);
    const session = findSession(store.layout, payload.sessionId);
    if (!source || !target || !session) return;

    if (source.id === target.id && !isEdgeZone(zone)) {
        activateGroupTab(source.id, session.sessionId);
        return;
    }

    if (source.id === target.id && isEdgeZone(zone) && getLeafSessions(source).length <= 1) return;

    let nextLayout = removeSessionFromLeaf(store.layout, source.id, session.sessionId);
    nextLayout = removeEmptyGroupIfNeeded(nextLayout, source.id);
    const currentTarget = findLeaf(nextLayout, targetPaneId) || findFirstLeaf(nextLayout);

    if (isEdgeZone(zone) && getLeafSessions(currentTarget).length > 0) {
        const { dir, side } = splitParams(zone);
        const movingLeaf = makeLeaf(session);
        store.layout = splitLeaf(nextLayout, currentTarget.id, dir, side, movingLeaf);
        store.activePaneId = movingLeaf.id;
        return;
    }

    store.layout = addSessionToLeaf(nextLayout, currentTarget.id, session);
    store.activePaneId = currentTarget.id;
}

export function moveOpenSessionToTabPosition(targetPaneId, payload, targetSessionId, position) {
    const source = findLeaf(store.layout, payload.sourcePaneId);
    const target = findLeaf(store.layout, targetPaneId);
    const session = findSession(store.layout, payload.sessionId);
    if (!source || !target || !session || session.sessionId === targetSessionId) return;

    const targetSessions = getLeafSessions(target);
    const targetIndex = targetSessions.findIndex(item => item.sessionId === targetSessionId);
    if (targetIndex < 0) return;

    const targetInsertIndex = position === 'after' ? targetIndex + 1 : targetIndex;

    if (source.id === target.id) {
        const sourceIndex = targetSessions.findIndex(item => item.sessionId === session.sessionId);
        if (sourceIndex < 0) return;
        const adjustedIndex = sourceIndex < targetInsertIndex ? targetInsertIndex - 1 : targetInsertIndex;
        store.layout = reorderSessionInLeaf(store.layout, target.id, session.sessionId, adjustedIndex);
        store.activePaneId = target.id;
        return;
    }

    let nextLayout = removeSessionFromLeaf(store.layout, source.id, session.sessionId);
    nextLayout = removeEmptyGroupIfNeeded(nextLayout, source.id);
    const currentTarget = findLeaf(nextLayout, targetPaneId) || findFirstLeaf(nextLayout);
    store.layout = insertSessionIntoLeaf(nextLayout, currentTarget.id, session, targetInsertIndex);
    store.activePaneId = currentTarget.id;
}

// 组工具按钮：创建一个空 Tab Group
export function splitPaneEmpty(paneId, dir) {
    const newLeaf = makeLeaf(null);
    store.layout = splitLeaf(store.layout, paneId, dir, 'end', newLeaf);
    store.activePaneId = newLeaf.id;
}

export function closePane(paneId) {
    const leaf = findLeaf(store.layout, paneId);
    getLeafSessions(leaf).forEach(session => {
        session.manualDisconnect = true;
        window.terminalApi.disconnect(session.sessionId);
        disposeTerminalView(session.sessionId);
    });
    store.layout = removeLeaf(store.layout, paneId);
    if (!findLeaf(store.layout, store.activePaneId)) {
        store.activePaneId = findFirstLeaf(store.layout).id;
    }
}

export function setSessionStatus(sessionId, status) {
    const session = findSession(store.layout, sessionId);
    if (session) session.status = status;
}

export { genId };
