const { successResponse, errorResponse } = require('../utils/responseUtils');
const { TERMINAL_STATUS, TERMINAL_EVT } = require('../const/telnetConst');
const ShellManager = require('../utils/shellManager');
const SshManager = require('../utils/sshManager');
const TelnetManager = require('../utils/telnetManager');
const TerminalLogWriter = require('../utils/terminalLogWriter');

/**
 * 终端连接编排：在主进程内按协议管理多会话
 * （沿用 NetNexus 中 TCP/UDP 工具在主进程运行的范式；SSH 后续走 worker 线程）
 */
class TelnetApp {
    constructor(ipcMain, dispatcher, store) {
        this.dispatcher = dispatcher;
        this.routes = new Map(); // sessionId -> local | telnet
        this.terminalLogWriter = new TerminalLogWriter(store);
        this.emit = (type, data) => {
            if (type === TERMINAL_EVT.DATA && data?.sessionId && data?.b64) {
                this.terminalLogWriter.writeOutput(data.sessionId, data.b64);
            }
            if (type === TERMINAL_EVT.STATUS && data?.status === TERMINAL_STATUS.CLOSED) {
                this.routes.delete(data.sessionId);
                this.terminalLogWriter.closeSession(data.sessionId);
            }
            if (type === TERMINAL_EVT.STATUS && data?.status === TERMINAL_STATUS.ERROR) {
                this.terminalLogWriter.closeSession(data.sessionId);
            }
            this.dispatcher.emit(type, data);
        };
        this.telnetManager = new TelnetManager(this.emit);
        this.shellManager = new ShellManager(this.emit);
        this.sshManager = new SshManager(this.emit);

        ipcMain.handle('terminal:connect', this.handleConnect.bind(this));
        ipcMain.handle('terminal:disconnect', this.handleDisconnect.bind(this));
        ipcMain.on('terminal:input', this.handleInput.bind(this));
        ipcMain.on('terminal:resize', this.handleResize.bind(this));
    }

    getProtocol(options = {}) {
        if (options.protocol === 'ssh') return 'ssh';
        return options.protocol === 'local' || options.protocol === 'shell' ? 'local' : 'telnet';
    }

    getManager(protocol) {
        if (protocol === 'ssh') return this.sshManager;
        return protocol === 'local' ? this.shellManager : this.telnetManager;
    }

    handleConnect(_event, options) {
        try {
            if (!options || !options.sessionId) {
                return errorResponse('连接参数不完整');
            }
            const protocol = this.getProtocol(options);
            if (protocol === 'telnet' && !options.host) return errorResponse('连接参数不完整');
            if (protocol === 'ssh' && !options.host) return errorResponse('SSH 主机不能为空');

            const result = this.getManager(protocol).connect(options);
            if (!result.ok) return errorResponse(result.msg || '连接失败');
            this.terminalLogWriter.registerSession(options, protocol);
            this.routes.set(options.sessionId, protocol);
            return successResponse(null, '正在连接');
        } catch (err) {
            return errorResponse('连接失败: ' + err.message);
        }
    }

    handleDisconnect(_event, sessionId) {
        try {
            const protocol = this.routes.get(sessionId);
            if (protocol) this.getManager(protocol).disconnect(sessionId);
            else {
                this.telnetManager.disconnect(sessionId);
                this.shellManager.disconnect(sessionId);
                this.sshManager.disconnect(sessionId);
            }
            this.routes.delete(sessionId);
            this.terminalLogWriter.closeSession(sessionId);
            return successResponse(null, '已断开');
        } catch (err) {
            return errorResponse('断开失败: ' + err.message);
        }
    }

    handleInput(_event, { sessionId, data } = {}) {
        const protocol = this.routes.get(sessionId);
        if (protocol) this.getManager(protocol).sendInput(sessionId, data);
    }

    handleResize(_event, { sessionId, cols, rows } = {}) {
        const protocol = this.routes.get(sessionId);
        if (protocol) this.getManager(protocol).resize(sessionId, cols, rows);
    }

    cleanup() {
        this.telnetManager.disconnectAll();
        this.shellManager.disconnectAll();
        this.sshManager.disconnectAll();
        this.routes.clear();
        this.terminalLogWriter.cleanup();
    }
}

module.exports = TelnetApp;
