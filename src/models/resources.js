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

export function isLocalSessionProtocol(protocol) {
    return protocol === 'local' || protocol === 'shell';
}

export function isSshSessionProtocol(protocol) {
    return protocol === 'ssh';
}

export function defaultPortForProtocol(protocol, fallback = 23) {
    if (isLocalSessionProtocol(protocol)) return null;
    if (isSshSessionProtocol(protocol)) return 22;
    return Number(fallback) || 23;
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
    const host = String(session.host || '').trim();
    const port = defaultPortForProtocol(protocol, defaults.defaultPort);
    return {
        id: session.id || makeEntityId('session'),
        type: RESOURCE_NODE_TYPES.SESSION,
        resource: RESOURCE_KINDS.SESSION,
        name: String(session.name || host || (isLocal ? 'Local Shell' : '未命名会话')).trim(),
        protocol,
        host,
        port: isLocal ? null : Number(session.port) || port,
        username: session.username || '',
        authType: session.authType || (session.privateKeyPath ? 'key' : 'password'),
        password: session.password || '',
        privateKeyPath: session.privateKeyPath || '',
        passphrase: session.passphrase || '',
        shell: session.shell || '',
        cwd: session.cwd || '',
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
