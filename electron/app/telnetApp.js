const { successResponse, errorResponse } = require('../utils/responseUtils');
const { TERMINAL_STATUS, TERMINAL_EVT } = require('../const/telnetConst');
const DirectForwardManager = require('../utils/directForwardManager');
const ShellManager = require('../utils/shellManager');
const SshManager = require('../utils/sshManager');
const SerialManager = require('../utils/serialManager');
const TelnetManager = require('../utils/telnetManager');
const TerminalLogWriter = require('../utils/terminalLogWriter');

/**
 * 终端连接编排：在主进程内按协议管理多会话
 */
class TelnetApp {
    constructor(ipcMain, dispatcher, store, credentialStore = null) {
        this.dispatcher = dispatcher;
        this.routes = new Map(); // sessionId -> local | telnet
        this.pendingCredentials = new Map();
        this.credentialStore = credentialStore;
        this.terminalLogWriter = new TerminalLogWriter(store);
        this.emit = (type, data) => {
            const payload = data && typeof data === 'object' ? { ...data } : data;
            this.handleCredentialStatus(type, payload);
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
            this.dispatcher.emit(type, payload);
        };
        this.telnetManager = new TelnetManager(this.emit);
        this.shellManager = new ShellManager(this.emit);
        this.sshManager = new SshManager(this.emit);
        this.serialManager = new SerialManager(this.emit);
        this.directForwardManager = new DirectForwardManager(this.emit);

        ipcMain.handle('terminal:connect', this.handleConnect.bind(this));
        ipcMain.handle('terminal:disconnect', this.handleDisconnect.bind(this));
        ipcMain.handle('terminal:serial-ports', this.handleSerialPorts.bind(this));
        ipcMain.handle('terminal:script-run', this.handleScriptRun.bind(this));
        ipcMain.handle('terminal:script-stop', this.handleScriptStop.bind(this));
        ipcMain.handle('terminal:script-pause', this.handleScriptPause.bind(this));
        ipcMain.handle('terminal:script-resume', this.handleScriptResume.bind(this));
        ipcMain.handle('port-forward:list', this.handlePortForwardList.bind(this));
        ipcMain.handle('port-forward:start', this.handlePortForwardStart.bind(this));
        ipcMain.handle('port-forward:stop', this.handlePortForwardStop.bind(this));
        ipcMain.on('terminal:input', this.handleInput.bind(this));
        ipcMain.on('terminal:resize', this.handleResize.bind(this));
    }

    getProtocol(options = {}) {
        if (options.protocol === 'ssh') return 'ssh';
        if (options.protocol === 'serial') return 'serial';
        return options.protocol === 'local' || options.protocol === 'shell' ? 'local' : 'telnet';
    }

    getManager(protocol) {
        if (protocol === 'ssh') return this.sshManager;
        if (protocol === 'serial') return this.serialManager;
        return protocol === 'local' ? this.shellManager : this.telnetManager;
    }

    readSavedCredential(options = {}, kind = 'password') {
        if (options.credentialSaveMode !== 'persist' || !options.profileId || !this.credentialStore) return '';
        return this.credentialStore.get(options.profileId, kind);
    }

    hydrateSshCredentials(options = {}) {
        if (options.protocol !== 'ssh' || options.credentialSaveMode !== 'persist') return;
        const authType = options.authType || (options.privateKeyPath ? 'key' : 'password');
        if (authType === 'password' && !options.password) {
            options.password = this.readSavedCredential(options, 'password');
        }
        if (authType === 'key' && !options.passphrase) {
            options.passphrase = this.readSavedCredential(options, 'passphrase');
        }
    }

    collectPendingCredential(options = {}) {
        if (options.protocol !== 'ssh' || options.credentialSaveMode !== 'persist' || !options.profileId) return null;
        const authType = options.authType || (options.privateKeyPath ? 'key' : 'password');
        const pending = { profileId: options.profileId };
        if (authType === 'password' && options.password) pending.password = String(options.password);
        if (authType === 'key' && options.passphrase) pending.passphrase = String(options.passphrase);
        return pending.password || pending.passphrase ? pending : null;
    }

    handleCredentialStatus(type, payload = {}) {
        if (type !== TERMINAL_EVT.STATUS || !payload?.sessionId) return;
        const pending = this.pendingCredentials.get(payload.sessionId);
        if (!pending) return;
        if (payload.status === TERMINAL_STATUS.ERROR || payload.status === TERMINAL_STATUS.CLOSED) {
            this.pendingCredentials.delete(payload.sessionId);
            return;
        }
        if (payload.status !== TERMINAL_STATUS.CONNECTED) return;

        this.pendingCredentials.delete(payload.sessionId);
        const saved = { profileId: pending.profileId };
        let error = '';
        if (pending.password) {
            const res = this.credentialStore?.save(pending.profileId, 'password', pending.password);
            if (res?.ok) saved.password = true;
            else error = res?.msg || 'SSH 密码保存失败';
        }
        if (pending.passphrase) {
            const res = this.credentialStore?.save(pending.profileId, 'passphrase', pending.passphrase);
            if (res?.ok) saved.passphrase = true;
            else error = error || res?.msg || 'SSH 私钥口令保存失败';
        }
        if (saved.password || saved.passphrase) payload.credentialSaved = saved;
        if (error) payload.credentialSaveError = error;
    }

    async handleSerialPorts() {
        try {
            const ports = await this.serialManager.listPorts();
            return successResponse(ports, '获取串口列表成功');
        } catch (err) {
            return errorResponse('获取串口列表失败: ' + err.message);
        }
    }

    handleConnect(_event, options) {
        try {
            if (!options || !options.sessionId) {
                return errorResponse('连接参数不完整');
            }
            const protocol = this.getProtocol(options);
            if (protocol === 'telnet' && !options.host) return errorResponse('连接参数不完整');
            if (protocol === 'ssh' && !options.host) return errorResponse('SSH 主机不能为空');
            if (protocol === 'serial' && !(options.serialPath || options.path || options.host)) {
                return errorResponse('请选择串口设备');
            }

            const connectOptions = { ...options };
            this.hydrateSshCredentials(connectOptions);
            const pendingCredential = this.collectPendingCredential(connectOptions);
            if (pendingCredential) this.pendingCredentials.set(connectOptions.sessionId, pendingCredential);
            else this.pendingCredentials.delete(connectOptions.sessionId);
            const result = this.getManager(protocol).connect(connectOptions);
            if (!result.ok) this.pendingCredentials.delete(connectOptions.sessionId);
            if (!result.ok) return errorResponse(result.msg || '连接失败');
            this.terminalLogWriter.registerSession(connectOptions, protocol);
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
                this.serialManager.disconnect(sessionId);
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

    async handleScriptRun(_event, payload = {}) {
        try {
            const { sessionId } = payload;
            const protocol = this.routes.get(sessionId);
            if (!protocol) return errorResponse('请选择已连接的终端窗口');
            const result = await this.getManager(protocol).runScript(sessionId, payload);
            if (!result.ok) return errorResponse(result.msg || '脚本执行失败');
            return successResponse(null, '脚本已开始执行');
        } catch (err) {
            return errorResponse('脚本执行失败: ' + err.message);
        }
    }

    handleScriptStop(_event, payload = {}) {
        try {
            const protocol = this.routes.get(payload.sessionId);
            if (!protocol) return errorResponse('脚本任务不存在');
            const result = this.getManager(protocol).stopScript(payload.taskId);
            if (!result.ok) return errorResponse(result.msg || '停止脚本失败');
            return successResponse(null, '脚本已停止');
        } catch (err) {
            return errorResponse('停止脚本失败: ' + err.message);
        }
    }

    handleScriptPause(_event, payload = {}) {
        try {
            const protocol = this.routes.get(payload.sessionId);
            if (!protocol) return errorResponse('脚本任务不存在');
            const result = this.getManager(protocol).pauseScript(payload.taskId);
            if (!result.ok) return errorResponse(result.msg || '暂停脚本失败');
            return successResponse(null, '脚本已暂停');
        } catch (err) {
            return errorResponse('暂停脚本失败: ' + err.message);
        }
    }

    handleScriptResume(_event, payload = {}) {
        try {
            const protocol = this.routes.get(payload.sessionId);
            if (!protocol) return errorResponse('脚本任务不存在');
            const result = this.getManager(protocol).resumeScript(payload.taskId);
            if (!result.ok) return errorResponse(result.msg || '继续脚本失败');
            return successResponse(null, '脚本已继续');
        } catch (err) {
            return errorResponse('继续脚本失败: ' + err.message);
        }
    }

    handlePortForwardList() {
        try {
            return successResponse(
                [...this.directForwardManager.listPortForwards(), ...this.sshManager.listPortForwards()],
                '获取端口转发列表成功'
            );
        } catch (err) {
            return errorResponse('获取端口转发列表失败: ' + err.message);
        }
    }

    async handlePortForwardStart(_event, payload = {}) {
        try {
            const manager =
                payload?.type === 'direct' || payload?.type === 'tcp' || payload?.type === 'udp'
                    ? this.directForwardManager
                    : this.sshManager;
            const result = await manager.startPortForward(payload);
            if (!result.ok) return errorResponse(result.msg || '启动端口转发失败');
            return successResponse(result.data, '端口转发已启动');
        } catch (err) {
            return errorResponse('启动端口转发失败: ' + err.message);
        }
    }

    async handlePortForwardStop(_event, payload = {}) {
        try {
            const id = typeof payload === 'string' ? payload : payload.id;
            const manager = this.directForwardManager.hasPortForward(id) ? this.directForwardManager : this.sshManager;
            const result = await manager.stopPortForward(id);
            if (!result.ok) return errorResponse(result.msg || '停止端口转发失败');
            return successResponse(result.data, '端口转发已停止');
        } catch (err) {
            return errorResponse('停止端口转发失败: ' + err.message);
        }
    }

    cleanup() {
        this.telnetManager.disconnectAll();
        this.shellManager.disconnectAll();
        this.sshManager.disconnectAll();
        this.serialManager.disconnectAll();
        this.directForwardManager.disconnectAll();
        this.routes.clear();
        this.terminalLogWriter.cleanup();
    }
}

module.exports = TelnetApp;
