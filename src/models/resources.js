export const RESOURCE_KINDS = {
    SESSION: 'session',
    FILE: 'file'
};

export const RESOURCE_NODE_TYPES = {
    RESOURCE_ROOT: 'resource-root',
    VIRTUAL_FOLDER: 'virtual-folder',
    SESSION_FOLDER: 'session-folder',
    SESSION: 'session',
    FILE_FOLDER: 'file-folder',
    FILE: 'file'
};

export const ALL_SESSIONS_FOLDER_ID = 'all';
export const UNGROUPED_FOLDER_ID = 'ungrouped';
export const SESSION_ROOT_ID = 'sessions-root';
export const FILE_ROOT_ID = 'files-remote-root';

export const SESSION_COLOR_OPTIONS = [
    {
        value: 'blue',
        label: '蓝色',
        swatch: '#3b82f6',
        bg: 'rgba(59, 130, 246, 0.18)',
        activeBg: 'rgba(59, 130, 246, 0.32)',
        border: 'rgba(96, 165, 250, 0.72)'
    },
    {
        value: 'green',
        label: '绿色',
        swatch: '#10b981',
        bg: 'rgba(16, 185, 129, 0.18)',
        activeBg: 'rgba(16, 185, 129, 0.32)',
        border: 'rgba(52, 211, 153, 0.72)'
    },
    {
        value: 'amber',
        label: '琥珀',
        swatch: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.18)',
        activeBg: 'rgba(245, 158, 11, 0.32)',
        border: 'rgba(251, 191, 36, 0.72)'
    },
    {
        value: 'rose',
        label: '玫红',
        swatch: '#f43f5e',
        bg: 'rgba(244, 63, 94, 0.18)',
        activeBg: 'rgba(244, 63, 94, 0.32)',
        border: 'rgba(251, 113, 133, 0.72)'
    },
    {
        value: 'violet',
        label: '紫色',
        swatch: '#8b5cf6',
        bg: 'rgba(139, 92, 246, 0.18)',
        activeBg: 'rgba(139, 92, 246, 0.32)',
        border: 'rgba(167, 139, 250, 0.72)'
    },
    {
        value: 'slate',
        label: '灰色',
        swatch: '#64748b',
        bg: 'rgba(100, 116, 139, 0.18)',
        activeBg: 'rgba(100, 116, 139, 0.32)',
        border: 'rgba(148, 163, 184, 0.72)'
    }
];
export const DEFAULT_SESSION_COLOR = SESSION_COLOR_OPTIONS[0].value;
const SESSION_COLOR_VALUES = new Set(SESSION_COLOR_OPTIONS.map(color => color.value));

export function isLocalSessionProtocol(protocol) {
    return protocol === 'local' || protocol === 'shell';
}

export function isSshSessionProtocol(protocol) {
    return protocol === 'ssh';
}

export function isSerialSessionProtocol(protocol) {
    return protocol === 'serial';
}

export function normalizeSessionColor(value) {
    const next = String(value || '').trim();
    return SESSION_COLOR_VALUES.has(next) ? next : DEFAULT_SESSION_COLOR;
}

export function getSessionColorOption(value) {
    const normalized = normalizeSessionColor(value);
    return SESSION_COLOR_OPTIONS.find(color => color.value === normalized) || SESSION_COLOR_OPTIONS[0];
}

export function defaultPortForProtocol(protocol, fallback = 23) {
    if (isLocalSessionProtocol(protocol)) return null;
    if (isSerialSessionProtocol(protocol)) return null;
    if (isSshSessionProtocol(protocol)) return 22;
    return Number(fallback) || 23;
}

export const SERIAL_DEFAULTS = {
    path: '',
    baudRate: 115200,
    dataBits: 8,
    stopBits: 1,
    parity: 'none',
    flowControl: 'none',
    dtr: true,
    rts: true
};

export function normalizeSerialParity(value) {
    const next = String(value || '').trim().toLowerCase();
    return ['none', 'even', 'odd', 'mark', 'space'].includes(next) ? next : SERIAL_DEFAULTS.parity;
}

export function normalizeSerialFlowControl(value) {
    const next = String(value || '').trim().toLowerCase();
    return ['none', 'hardware', 'software'].includes(next) ? next : SERIAL_DEFAULTS.flowControl;
}

export function normalizeSerialNumber(value, fallback, allowed = []) {
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    if (allowed.length && !allowed.includes(next)) return fallback;
    return next;
}

export function normalizeSerialBoolean(value, fallback = true) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

export function normalizeCredentialSaveMode(value) {
    if (value === 'session' || value === 'prompt') return value;
    return 'prompt';
}

export function makeEntityId(prefix = 'id') {
    return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeSessionFolder(folder = {}) {
    const now = new Date().toISOString();
    return {
        id: folder.id || makeEntityId('folder'),
        type: RESOURCE_NODE_TYPES.SESSION_FOLDER,
        resource: RESOURCE_KINDS.SESSION,
        name: String(folder.name || '新建文件夹').trim(),
        parentId: folder.parentId || null,
        sort: Number(folder.sort) || 0,
        createdAt: folder.createdAt || now,
        updatedAt: folder.updatedAt || folder.createdAt || now
    };
}

export function normalizeSessionProfile(session = {}, defaults = {}) {
    const now = new Date().toISOString();
    const protocol = session.protocol || defaults.defaultProtocol || 'telnet';
    const isLocal = isLocalSessionProtocol(protocol);
    const isSerial = isSerialSessionProtocol(protocol);
    const host = String(session.host || '').trim();
    const serialPath = String(session.serialPath || '').trim();
    const port = defaultPortForProtocol(protocol, defaults.defaultPort);
    return {
        id: session.id || makeEntityId('session'),
        type: RESOURCE_NODE_TYPES.SESSION,
        resource: RESOURCE_KINDS.SESSION,
        name: String(session.name || host || serialPath || (isLocal ? 'Local Shell' : '未命名会话')).trim(),
        color: normalizeSessionColor(session.color),
        protocol,
        host: isSerial ? '' : host,
        port: isLocal || isSerial ? null : Number(session.port) || port,
        username: session.username || '',
        authType: session.authType || (session.privateKeyPath ? 'key' : 'password'),
        credentialSaveMode: isLocal || isSerial ? 'prompt' : normalizeCredentialSaveMode(session.credentialSaveMode),
        password: session.password || '',
        privateKeyPath: session.privateKeyPath || '',
        passphrase: session.passphrase || '',
        shell: session.shell || '',
        cwd: session.cwd || '',
        serialPath,
        serialBaudRate: normalizeSerialNumber(
            session.serialBaudRate,
            defaults.defaultSerialBaudRate || SERIAL_DEFAULTS.baudRate
        ),
        serialDataBits: normalizeSerialNumber(session.serialDataBits, SERIAL_DEFAULTS.dataBits, [5, 6, 7, 8]),
        serialStopBits: normalizeSerialNumber(session.serialStopBits, SERIAL_DEFAULTS.stopBits, [1, 2]),
        serialParity: normalizeSerialParity(session.serialParity),
        serialFlowControl: normalizeSerialFlowControl(session.serialFlowControl),
        serialDtr: normalizeSerialBoolean(session.serialDtr, SERIAL_DEFAULTS.dtr),
        serialRts: normalizeSerialBoolean(session.serialRts, SERIAL_DEFAULTS.rts),
        folderId: session.folderId || null,
        tags: Array.isArray(session.tags) ? session.tags : [],
        description: session.description || '',
        createdAt: session.createdAt || now,
        updatedAt: session.updatedAt || session.createdAt || now
    };
}

export function normalizeFileEntry(entry = {}, parentId = null) {
    const path = entry.path || (parentId ? `${parentId}/${entry.name || ''}` : '/');
    const isFolder =
        entry.type === RESOURCE_NODE_TYPES.FILE_FOLDER || entry.isDirectory || Array.isArray(entry.children);
    const id = entry.id || `file:${path}`;
    return {
        id,
        type: isFolder ? RESOURCE_NODE_TYPES.FILE_FOLDER : RESOURCE_NODE_TYPES.FILE,
        resource: RESOURCE_KINDS.FILE,
        name: entry.name || (path === '/' ? '/' : path.split('/').filter(Boolean).pop()) || '/',
        path,
        parentId,
        connectionId: entry.connectionId || null,
        size: Number(entry.size) || 0,
        modifiedAt: entry.modifiedAt || null,
        permissions: entry.permissions || '',
        owner: entry.owner || '',
        group: entry.group || '',
        loaded: Boolean(entry.loaded),
        children: (entry.children || []).map(child => normalizeFileEntry(child, id))
    };
}

function buildFolderHierarchy(folders) {
    const byId = new Map();
    const roots = [];

    folders.map(normalizeSessionFolder).forEach(folder => {
        byId.set(folder.id, { ...folder, children: [], folders: [], items: [], itemCount: 0, directItemCount: 0 });
    });

    byId.forEach(folder => {
        const parent = folder.parentId && folder.parentId !== folder.id ? byId.get(folder.parentId) : null;
        if (parent) parent.folders.push(folder);
        else roots.push(folder);
    });

    return { byId, roots };
}

function applyRecursiveCounts(node) {
    const childTotal = node.folders.reduce((total, child) => total + applyRecursiveCounts(child), 0);
    node.directItemCount = node.items.length;
    node.itemCount = node.directItemCount + childTotal;
    node.children = [...node.folders, ...node.items];
    return node.itemCount;
}

export function createSessionResourceTree({ folders = [], sessions = [] } = {}) {
    const normalizedSessions = sessions.map(normalizeSessionProfile);
    const { byId, roots } = buildFolderHierarchy(folders);
    const ungrouped = [];

    normalizedSessions.forEach(session => {
        const folder = session.folderId ? byId.get(session.folderId) : null;
        if (folder) folder.items.push(session);
        else ungrouped.push(session);
    });

    roots.forEach(applyRecursiveCounts);

    return {
        id: SESSION_ROOT_ID,
        type: RESOURCE_NODE_TYPES.RESOURCE_ROOT,
        resource: RESOURCE_KINDS.SESSION,
        name: '会话集',
        children: [...roots, ...ungrouped],
        items: normalizedSessions,
        ungrouped,
        folders: roots,
        folderMap: byId,
        itemCount: normalizedSessions.length
    };
}

export function createDefaultFileResourceTree(entries = []) {
    const root = normalizeFileEntry({
        id: FILE_ROOT_ID,
        type: RESOURCE_NODE_TYPES.FILE_FOLDER,
        name: '远程文件',
        path: '/',
        loaded: false,
        children: entries
    });
    root.itemCount = root.children.length;
    return root;
}

export function getSessionsForFolder(tree, folderId) {
    if (!tree) return [];
    if (!folderId || folderId === ALL_SESSIONS_FOLDER_ID) return tree.items || [];
    if (folderId === UNGROUPED_FOLDER_ID) return tree.ungrouped || [];
    return tree.folderMap?.get(folderId)?.items || [];
}
