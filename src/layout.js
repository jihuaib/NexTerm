// 分屏布局树（不可变操作，便于 Vue 响应式整树替换）
//   叶子: { id, type:'leaf', sessions: RuntimeSession[], activeSessionId: string|null }
//   分屏: { id, type:'split', dir:'row'|'col', children:[node,node], sizes:[n,n] }

let seq = 0;
export function genId() {
    seq += 1;
    return 'n' + Date.now().toString(36) + seq.toString(36);
}

export function makeLeaf(session = null) {
    return {
        id: genId(),
        type: 'leaf',
        sessions: session ? [session] : [],
        activeSessionId: session ? session.sessionId : null
    };
}

export function getLeafSessions(leaf) {
    if (!leaf || leaf.type !== 'leaf') return [];
    if (Array.isArray(leaf.sessions)) return leaf.sessions;
    return leaf.session ? [leaf.session] : [];
}

export function getActiveSession(leaf) {
    const sessions = getLeafSessions(leaf);
    if (!sessions.length) return null;
    return sessions.find(s => s.sessionId === leaf.activeSessionId) || sessions[0];
}

function normalizeLeaf(leaf) {
    if (leaf.type !== 'leaf') return leaf;
    const sessions = getLeafSessions(leaf);
    const active = sessions.find(s => s.sessionId === leaf.activeSessionId) || sessions[0] || null;
    return {
        id: leaf.id,
        type: 'leaf',
        sessions,
        activeSessionId: active ? active.sessionId : null
    };
}

// 把某个叶子拆成分屏：保留原叶子，并在指定一侧加入 newLeaf
export function splitLeaf(root, leafId, dir, side, newLeaf) {
    function rec(node) {
        if (node.type === 'leaf') {
            if (node.id !== leafId) return normalizeLeaf(node);
            const keep = normalizeLeaf(node);
            const children = side === 'start' ? [newLeaf, keep] : [keep, newLeaf];
            return { id: genId(), type: 'split', dir, children, sizes: [50, 50] };
        }
        return { ...node, children: node.children.map(rec) };
    }
    return rec(root);
}

export function addSessionToLeaf(root, leafId, session) {
    function rec(node) {
        if (node.type === 'leaf') {
            if (node.id !== leafId) return normalizeLeaf(node);
            const current = getLeafSessions(node).filter(s => s.sessionId !== session.sessionId);
            return {
                ...normalizeLeaf(node),
                sessions: [...current, session],
                activeSessionId: session.sessionId
            };
        }
        return { ...node, children: node.children.map(rec) };
    }
    return rec(root);
}

export function setLeafActiveSession(root, leafId, sessionId) {
    function rec(node) {
        if (node.type === 'leaf') {
            if (node.id !== leafId) return normalizeLeaf(node);
            const sessions = getLeafSessions(node);
            const active = sessions.some(s => s.sessionId === sessionId) ? sessionId : sessions[0]?.sessionId || null;
            return { ...normalizeLeaf(node), activeSessionId: active };
        }
        return { ...node, children: node.children.map(rec) };
    }
    return rec(root);
}

export function removeSessionFromLeaf(root, leafId, sessionId) {
    function rec(node) {
        if (node.type === 'leaf') {
            if (node.id !== leafId) return normalizeLeaf(node);
            const sessions = getLeafSessions(node).filter(s => s.sessionId !== sessionId);
            const activeStillExists = sessions.some(s => s.sessionId === node.activeSessionId);
            return {
                ...normalizeLeaf(node),
                sessions,
                activeSessionId: activeStillExists ? node.activeSessionId : sessions[0]?.sessionId || null
            };
        }
        return { ...node, children: node.children.map(rec) };
    }
    return rec(root);
}

// 兼容旧调用：把某个组替换成单标签组
export function fillLeaf(root, leafId, session) {
    function rec(node) {
        if (node.type === 'leaf') {
            return node.id === leafId ? makeLeaf(session) : normalizeLeaf(node);
        }
        return { ...node, children: node.children.map(rec) };
    }
    return rec(root);
}

// 移除某个 Tab Group：其父分屏坍缩为兄弟节点；移除最后一个则回到空组
export function removeLeaf(root, leafId) {
    function rec(node) {
        if (node.type === 'leaf') return normalizeLeaf(node);
        const [a, b] = node.children;
        if (a.type === 'leaf' && a.id === leafId) return rec(b);
        if (b.type === 'leaf' && b.id === leafId) return rec(a);
        return { ...node, children: [rec(a), rec(b)] };
    }
    let res = rec(root);
    if (res.type === 'leaf' && res.id === leafId) res = makeLeaf(null);
    return res;
}

export function findLeaf(root, leafId) {
    if (root.type === 'leaf') return root.id === leafId ? root : null;
    return findLeaf(root.children[0], leafId) || findLeaf(root.children[1], leafId);
}

export function findFirstLeaf(root) {
    if (root.type === 'leaf') return root;
    return findFirstLeaf(root.children[0]);
}

export function findLeafBySession(root, sessionId) {
    if (root.type === 'leaf') {
        return getLeafSessions(root).some(s => s.sessionId === sessionId) ? root : null;
    }
    return findLeafBySession(root.children[0], sessionId) || findLeafBySession(root.children[1], sessionId);
}

export function findSession(root, sessionId) {
    const leaf = findLeafBySession(root, sessionId);
    return leaf ? getLeafSessions(leaf).find(s => s.sessionId === sessionId) || null : null;
}

export function collectSessions(root, acc = []) {
    if (root.type === 'leaf') {
        acc.push(...getLeafSessions(root));
    } else {
        collectSessions(root.children[0], acc);
        collectSessions(root.children[1], acc);
    }
    return acc;
}
