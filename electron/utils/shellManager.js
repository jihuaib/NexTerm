const os = require('os');
const fs = require('fs');
const path = require('path');
const { TERMINAL_STATUS, TERMINAL_EVT } = require('../const/telnetConst');
const {
    pauseLocalScriptTask,
    resumeLocalScriptTask,
    startLocalScriptTask,
    stopLocalScriptTask
} = require('./scriptProcessRunner');
const { normalizeTerminalOutput } = require('./scriptIoBridge');
const { normalizeTerminalSize, sameTerminalSize } = require('./terminalSize');

let ptyModule;
let ptyLoadError;

function loadPty() {
    if (ptyModule) return { pty: ptyModule };
    try {
        ptyModule = require('node-pty');
        ptyLoadError = null;
        return { pty: ptyModule };
    } catch (err) {
        ptyLoadError = err;
        return { error: err };
    }
}

function normalizeText(value) {
    return String(value || '').trim();
}

function existingFile(filePath) {
    try {
        return filePath && fs.existsSync(filePath) ? filePath : '';
    } catch (_err) {
        return '';
    }
}

function defaultWindowsShell() {
    const override = normalizeText(process.env.NEXTERM_SHELL);
    if (override) return override;

    const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const windowsPowerShell = existingFile(
        path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    );
    return windowsPowerShell || process.env.ComSpec || 'powershell.exe';
}

function defaultShell() {
    if (process.platform === 'win32') {
        return defaultWindowsShell();
    }
    return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

function defaultCwd(cwd) {
    const requested = normalizeText(cwd);
    if (requested) return requested;
    if (process.platform === 'win32') {
        return (
            process.env.USERPROFILE ||
            (process.env.HOMEDRIVE && process.env.HOMEPATH ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}` : '') ||
            os.homedir() ||
            process.cwd()
        );
    }
    return process.env.HOME || os.homedir() || process.cwd();
}

function shellBasename(shell) {
    return path
        .basename(shell || '')
        .toLowerCase()
        .replace(/\.exe$/, '');
}

function defaultShellArgs(shell) {
    if (process.platform !== 'win32') return [];
    const name = shellBasename(shell);
    if (name === 'powershell' || name === 'pwsh') return ['-NoLogo'];
    return [];
}

function normalizeShellArgs(args, shell) {
    if (Array.isArray(args)) return args.map(item => String(item)).filter(Boolean);
    return defaultShellArgs(shell);
}

function buildEnv() {
    const env = {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor'
    };
    if (process.platform === 'win32') {
        env.SystemRoot = env.SystemRoot || 'C:\\Windows';
        env.windir = env.windir || env.SystemRoot;
    } else {
        env.LANG = env.LANG || 'en_US.UTF-8';
    }
    return env;
}

function buildPtyOptions({ cols, rows, cwd }) {
    const options = {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: buildEnv(),
        encoding: 'utf8'
    };

    if (process.platform === 'win32') {
        const backend = normalizeText(process.env.NEXTERM_PTY_BACKEND).toLowerCase();
        if (backend === 'conpty') options.useConpty = true;
        if (backend === 'winpty') options.useConpty = false;
    }

    return options;
}

function nativeModuleHint(err) {
    const reason = err?.message || String(err || ptyLoadError || 'unknown error');
    return `node-pty native 模块未加载，请先执行 npm run rebuild:native 后重启应用。原始错误: ${reason}`;
}

function spawnError(shell, err) {
    const reason = err?.message || String(err || 'unknown error');
    if (
        /NODE_MODULE_VERSION|module version|Module did not self-register|invalid ELF header|mach-o|dynamic link/i.test(
            reason
        )
    ) {
        return nativeModuleHint(err);
    }
    return `无法启动本地 Shell (${shell}): ${reason}`;
}

class ShellManager {
    constructor(emit) {
        this.emit = typeof emit === 'function' ? emit : () => {};
        this.conns = new Map();
        this.scriptTasks = new Map();
    }

    connect(options = {}) {
        const { sessionId } = options;
        if (!sessionId) return { ok: false, msg: '会话参数不完整' };
        if (this.conns.has(sessionId)) return { ok: false, msg: '会话已存在' };

        const loaded = loadPty();
        if (loaded.error) return { ok: false, msg: nativeModuleHint(loaded.error) };

        const shell = normalizeText(options.shell) || defaultShell();
        const args = normalizeShellArgs(options.shellArgs, shell);
        const cwd = defaultCwd(options.cwd);
        const cols = Number(options.cols) || 80;
        const rows = Number(options.rows) || 24;

        this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.CONNECTING });

        let term;
        try {
            term = loaded.pty.spawn(shell, args, buildPtyOptions({ cols, rows, cwd }));
        } catch (err) {
            return { ok: false, msg: spawnError(shell, err) };
        }

        const ctx = { term, shell, args, cwd, cols, rows };
        this.conns.set(sessionId, ctx);

        term.onData(data => {
            for (const task of this.scriptTasks.values()) {
                if (task.sessionId === sessionId) task.bridge.onTerminalData(data);
            }
            this.emit(TERMINAL_EVT.DATA, {
                sessionId,
                b64: Buffer.from(data, 'utf8').toString('base64')
            });
        });

        term.onExit(({ exitCode, signal }) => {
            this.conns.delete(sessionId);
            this.emit(TERMINAL_EVT.STATUS, {
                sessionId,
                status: TERMINAL_STATUS.CLOSED,
                msg: signal ? `Shell exited by ${signal}` : `Shell exited with ${exitCode}`
            });
        });

        this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.CONNECTED });
        return { ok: true };
    }

    resize(sessionId, cols, rows) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return;
        const nextSize = normalizeTerminalSize(cols, rows, ctx);
        if (sameTerminalSize(ctx, nextSize)) return;
        ctx.cols = nextSize.cols;
        ctx.rows = nextSize.rows;
        try {
            ctx.term.resize(ctx.cols, ctx.rows);
        } catch (_err) {
            /* pty may already be closed */
        }
    }

    sendInput(sessionId, data) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return;
        ctx.term.write(String(data));
    }

    emitData(sessionId, data) {
        if (!data || data.length === 0) return;
        this.emit(TERMINAL_EVT.DATA, {
            sessionId,
            b64: Buffer.from(normalizeTerminalOutput(data)).toString('base64')
        });
    }

    async runScript(sessionId, payload = {}) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return { ok: false, msg: '本地会话不存在' };
        if (!payload.taskId) return { ok: false, msg: '脚本任务参数不完整' };
        if (this.scriptTasks.has(payload.taskId)) return { ok: false, msg: '脚本任务已存在' };

        return startLocalScriptTask({
            sessionId,
            writeTerminal: data => this.emitData(sessionId, data),
            sendTerminalInput: data => this.sendInput(sessionId, data),
            payload,
            cwd: ctx.cwd,
            emit: this.emit,
            registerTask: task => this.scriptTasks.set(payload.taskId, task),
            unregisterTask: () => this.scriptTasks.delete(payload.taskId)
        });
    }

    stopScript(taskId) {
        const task = this.scriptTasks.get(taskId);
        return stopLocalScriptTask(task);
    }

    pauseScript(taskId) {
        const task = this.scriptTasks.get(taskId);
        return pauseLocalScriptTask(task);
    }

    resumeScript(taskId) {
        const task = this.scriptTasks.get(taskId);
        return resumeLocalScriptTask(task);
    }

    disconnect(sessionId) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return;
        for (const [taskId, task] of [...this.scriptTasks.entries()]) {
            if (task.sessionId !== sessionId) continue;
            this.stopScript(taskId);
            this.scriptTasks.delete(taskId);
        }
        try {
            ctx.term.kill();
        } catch (_err) {
            /* pty may already be closed */
        }
        this.conns.delete(sessionId);
    }

    disconnectAll() {
        for (const id of [...this.conns.keys()]) {
            this.disconnect(id);
        }
    }
}

module.exports = ShellManager;
