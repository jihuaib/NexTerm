const dgram = require('dgram');
const net = require('net');
const { PORT_FORWARD_EVT } = require('../const/telnetConst');

function normalizeText(value) {
    return String(value || '').trim();
}

function nowIso() {
    return new Date().toISOString();
}

function makeForwardId() {
    return `pf-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function normalizePort(value, label, allowZero = false) {
    const port = Number(value);
    const min = allowZero ? 0 : 1;
    if (!Number.isInteger(port) || port < min || port > 65535) throw new Error(`${label}必须是 ${min}-65535`);
    return port;
}

function normalizeTransport(value) {
    const transport = normalizeText(value || 'tcp').toLowerCase();
    if (transport === 'tcp' || transport === 'udp') return transport;
    throw new Error('转发协议必须是 TCP 或 UDP');
}

function normalizeRule(payload = {}) {
    const type = normalizeText(payload.type || 'direct').toLowerCase();
    if (type !== 'direct' && type !== 'tcp' && type !== 'udp') throw new Error('Direct 转发类型无效');
    const transport = type === 'udp' ? 'udp' : normalizeTransport(payload.transport || payload.protocol);
    const targetHost = normalizeText(payload.targetHost || payload.remoteHost);
    if (!targetHost) throw new Error('目标地址不能为空');
    return {
        id: normalizeText(payload.id) || makeForwardId(),
        sessionId: '',
        type: 'direct',
        transport,
        name: normalizeText(payload.name),
        bindHost: normalizeText(payload.bindHost || payload.localHost) || '127.0.0.1',
        bindPort: normalizePort(payload.bindPort || payload.localPort, '监听端口', true),
        targetHost,
        targetPort: normalizePort(payload.targetPort || payload.remotePort, '目标端口', false)
    };
}

function publicForward(state = {}, patch = {}) {
    return {
        id: state.id,
        sessionId: '',
        type: 'direct',
        transport: state.transport || 'tcp',
        name: state.name || '',
        bindHost: state.bindHost,
        bindPort: state.bindPort,
        targetHost: state.targetHost,
        targetPort: state.targetPort,
        status: state.status || 'stopped',
        startedAt: state.startedAt || '',
        msg: state.msg || '',
        ...patch
    };
}

function wireDuplex(left, right) {
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        left.destroy?.();
        right.destroy?.();
    };
    left.on('error', close);
    right.on('error', close);
    left.on('close', close);
    right.on('close', close);
    left.pipe(right);
    right.pipe(left);
}

class DirectForwardManager {
    constructor(emit) {
        this.emit = typeof emit === 'function' ? emit : () => {};
        this.forwardRules = new Map();
    }

    emitUpdate(state, patch = {}) {
        this.emit(PORT_FORWARD_EVT.UPDATE, publicForward(state, patch));
    }

    hasPortForward(id) {
        return this.forwardRules.has(id);
    }

    listPortForwards() {
        return [...this.forwardRules.values()].map(state => publicForward(state));
    }

    async startPortForward(payload = {}) {
        let rule;
        try {
            rule = normalizeRule(payload);
        } catch (err) {
            return { ok: false, msg: err.message };
        }
        if (this.forwardRules.has(rule.id)) return { ok: false, msg: '端口转发规则已在运行' };

        return rule.transport === 'udp' ? this.startUdpForward(rule) : this.startTcpForward(rule);
    }

    async startTcpForward(rule) {
        const server = net.createServer(socket => this.handleTcpSocket(rule.id, socket));
        const state = {
            ...rule,
            server,
            sockets: new Set(),
            udpPeers: new Map(),
            status: 'starting',
            startedAt: nowIso(),
            msg: ''
        };

        server.on('error', err => {
            const current = this.forwardRules.get(rule.id);
            if (!current) return;
            current.status = 'error';
            current.msg = err.message;
            this.emitUpdate(current);
        });

        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.listen(rule.bindPort, rule.bindHost, () => {
                    server.off('error', reject);
                    resolve();
                });
            });
        } catch (err) {
            return { ok: false, msg: err.message };
        }

        const address = server.address();
        if (address && typeof address === 'object') state.bindPort = Number(address.port) || state.bindPort;
        state.status = 'active';
        this.forwardRules.set(state.id, state);
        this.emitUpdate(state);
        return { ok: true, data: publicForward(state) };
    }

    handleTcpSocket(ruleId, socket) {
        const state = this.forwardRules.get(ruleId);
        if (!state || state.status !== 'active') {
            socket.destroy();
            return;
        }
        state.sockets.add(socket);
        socket.on('close', () => state.sockets.delete(socket));
        const target = net.connect({ host: state.targetHost, port: state.targetPort });
        state.sockets.add(target);
        target.on('close', () => state.sockets.delete(target));
        target.on('connect', () => wireDuplex(socket, target));
        target.on('error', err => {
            state.msg = err.message;
            this.emitUpdate(state, { status: 'active', msg: err.message });
            socket.destroy();
        });
    }

    async startUdpForward(rule) {
        const server = dgram.createSocket(net.isIPv6(rule.bindHost) ? 'udp6' : 'udp4');
        const state = {
            ...rule,
            server,
            sockets: new Set(),
            udpPeers: new Map(),
            status: 'starting',
            startedAt: nowIso(),
            msg: ''
        };

        server.on('message', (message, rinfo) => this.handleUdpMessage(rule.id, message, rinfo));
        server.on('error', err => {
            const current = this.forwardRules.get(rule.id);
            if (!current) return;
            current.status = 'error';
            current.msg = err.message;
            this.emitUpdate(current);
        });

        try {
            await new Promise((resolve, reject) => {
                server.once('error', reject);
                server.bind(rule.bindPort, rule.bindHost, () => {
                    server.off('error', reject);
                    resolve();
                });
            });
        } catch (err) {
            return { ok: false, msg: err.message };
        }

        const address = server.address();
        if (address && typeof address === 'object') state.bindPort = Number(address.port) || state.bindPort;
        state.status = 'active';
        this.forwardRules.set(state.id, state);
        this.emitUpdate(state);
        return { ok: true, data: publicForward(state) };
    }

    handleUdpMessage(ruleId, message, rinfo) {
        const state = this.forwardRules.get(ruleId);
        if (!state || state.status !== 'active') return;
        const key = `${rinfo.address}:${rinfo.port}`;
        let peer = state.udpPeers.get(key);
        if (!peer) {
            const socket = dgram.createSocket(net.isIPv6(state.targetHost) ? 'udp6' : 'udp4');
            peer = { socket, timer: null };
            socket.on('message', response => {
                state.server.send(response, rinfo.port, rinfo.address);
            });
            socket.on('error', err => {
                state.msg = err.message;
                this.emitUpdate(state, { status: 'active', msg: err.message });
                this.closeUdpPeer(state, key);
            });
            state.udpPeers.set(key, peer);
        }

        if (peer.timer) clearTimeout(peer.timer);
        peer.timer = setTimeout(() => this.closeUdpPeer(state, key), 30_000);
        peer.socket.send(message, state.targetPort, state.targetHost);
    }

    closeUdpPeer(state, key) {
        const peer = state.udpPeers?.get(key);
        if (!peer) return;
        if (peer.timer) clearTimeout(peer.timer);
        try {
            peer.socket.close();
        } catch (_err) {
            /* socket may already be closed */
        }
        state.udpPeers.delete(key);
    }

    async stopPortForward(id, msg = '端口转发已停止') {
        const state = this.forwardRules.get(id);
        if (!state) return { ok: false, msg: '端口转发不存在' };
        this.forwardRules.delete(id);

        for (const socket of [...state.sockets]) {
            try {
                socket.destroy?.();
            } catch (_err) {
                /* socket may already be closed */
            }
        }
        state.sockets.clear();
        for (const key of [...(state.udpPeers?.keys?.() || [])]) {
            this.closeUdpPeer(state, key);
        }

        await new Promise(resolve => {
            try {
                state.server.close(() => resolve());
            } catch (_err) {
                resolve();
            }
        });

        state.status = 'stopped';
        state.msg = msg;
        this.emitUpdate(state);
        return { ok: true, data: publicForward(state) };
    }

    disconnectAll() {
        for (const id of [...this.forwardRules.keys()]) {
            this.stopPortForward(id);
        }
    }
}

module.exports = DirectForwardManager;
