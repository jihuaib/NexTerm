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
    isLocalSessionProtocol,
    isSshSessionProtocol,
    normalizeSessionFolder,
    normalizeSessionProfile
} from './models/resources';
import {
    makeLeaf,
    splitLeaf,
    addSessionToLeaf,
    setLeafActiveSession,
    removeSessionFromLeaf,
    removeLeaf,
    findLeaf,
    findFirstLeaf,
    findSession,
    getLeafSessions,
    genId
} from './layout';
import { disposeTerminalView } from './services/terminalViews';

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
    terminalContextMenuTrigger: 'shift'
};

const rootLeaf = makeLeaf(null);
const initialSessionTree = createSessionResourceTree();

// 简单的全局响应式状态（基础版无需 Vuex）
export const store = reactive({
    sessions: [], // 已保存的会话定义
    sessionFolders: [], // 会话文件夹
    sessionTree: initialSessionTree,
    selectedFolderId: ALL_SESSIONS_FOLDER_ID,
    fileTree: createDefaultFileResourceTree(),
    selectedFileNodeId: FILE_ROOT_ID,
    layout: rootLeaf, // Tab Group 分屏布局树
    activePaneId: rootLeaf.id, // 当前聚焦的 Tab Group id
    settings: { ...DEFAULT_SETTINGS },
    settingsOpen: false
});

function genRuntimeId() {
    return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function makeRuntimeSession(def) {
    const protocol = def.protocol || store.settings.defaultProtocol;
    const isLocal = isLocalSessionProtocol(protocol);
    const port = defaultPortForProtocol(protocol, store.settings.defaultPort);
    return {
        profileId: def.id || null,
        sessionId: genRuntimeId(),
        name: def.name || def.host || (isLocal ? 'Local Shell' : ''),
        host: def.host || '',
        port: isLocal ? null : Number(def.port) || port,
        protocol,
        username: def.username || '',
        authType: def.authType || (def.privateKeyPath ? 'key' : 'password'),
        password: def.password || '',
        privateKeyPath: def.privateKeyPath || '',
        passphrase: def.passphrase || '',
        shell: def.shell || '',
        cwd: def.cwd || '',
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
    if (res.status === 'success') Object.assign(store.settings, res.data);
    applyAppTheme(store.settings.themeId);
}

export async function updateSettings(patch) {
    Object.assign(store.settings, patch);
    if ('themeId' in patch) applyAppTheme(store.settings.themeId);
    await window.settingsApi.save(patch);
}

export function openSettings() {
    store.settingsOpen = true;
}
export function closeSettings() {
    store.settingsOpen = false;
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
    const isSsh = isSshSessionProtocol(protocol);
    const authType = isSsh ? def.authType || (def.privateKeyPath ? 'key' : 'password') : '';
    const port = defaultPortForProtocol(protocol, store.settings.defaultPort);
    return {
        id: def.id || undefined,
        name: String(def.name || '').trim(),
        folderId: normalizeSessionFolderId(def.folderId),
        protocol,
        host: isLocal ? '' : String(def.host || '').trim(),
        port: isLocal ? null : Number(def.port) || port,
        username: isSsh ? String(def.username || '').trim() : '',
        authType,
        password: isSsh && authType === 'password' ? String(def.password || '') : '',
        privateKeyPath: isSsh && authType === 'key' ? String(def.privateKeyPath || '').trim() : '',
        passphrase: isSsh && authType === 'key' ? String(def.passphrase || '') : '',
        shell: isLocal ? String(def.shell || '').trim() : '',
        cwd: isLocal ? String(def.cwd || '').trim() : '',
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

// ---------- Tab Group / 连接 ----------
export function setActivePane(paneId) {
    store.activePaneId = paneId;
}

// Xshell 模型：打开会话 = 加入当前 Tab Group，不自动分屏
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

// Xshell 模型：拖已打开 Tab 到其他组 = 移动；拖到边缘 = 创建新 Tab Group
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
