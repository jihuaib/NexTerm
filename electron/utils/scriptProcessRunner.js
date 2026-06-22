const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { SCRIPT_EVT } = require('../const/telnetConst');
const { getScriptLanguage, normalizeLocalCwd, scriptFileContent } = require('./scriptCommand');
const { ScriptIoBridge } = require('./scriptIoBridge');

function buildScriptEnv(extra = {}) {
    const env = {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        ...extra
    };
    if (process.platform === 'win32') {
        env.SystemRoot = env.SystemRoot || 'C:\\Windows';
        env.windir = env.windir || env.SystemRoot;
    } else {
        env.LANG = env.LANG || 'en_US.UTF-8';
    }
    return env;
}

function commandCandidates(command) {
    const value = String(command || '').trim();
    if (!value) return [];
    if (path.isAbsolute(value) || value.includes('/') || value.includes('\\')) return [value];

    const dirs = String(process.env.PATH || '')
        .split(path.delimiter)
        .filter(Boolean);
    const extensions =
        process.platform === 'win32'
            ? String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
                  .split(';')
                  .filter(Boolean)
            : [''];

    const names =
        process.platform === 'win32' && path.extname(value)
            ? [value]
            : extensions.map(extension => `${value}${extension}`);
    return dirs.flatMap(dir => names.map(name => path.join(dir, name)));
}

function resolveCommand(commands) {
    for (const command of commands) {
        for (const candidate of commandCandidates(command)) {
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                return candidate;
            } catch (_err) {
                /* keep searching */
            }
        }
    }
    return '';
}

function quoteForShell(value) {
    const text = String(value || '');
    if (process.platform === 'win32') return `"${text.replace(/"/g, '\\"')}"`;
    return `'${text.replace(/'/g, "'\\''")}'`;
}

function shellCommandSpec(commandText) {
    if (process.platform === 'win32') {
        return {
            command: process.env.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c', commandText]
        };
    }
    return {
        command: process.env.SHELL || '/bin/sh',
        args: ['-lc', commandText]
    };
}

function buildCommandSpec(languageId, command, filePath) {
    const language = getScriptLanguage(languageId);
    if (language.id === 'javascript') {
        return {
            command: process.execPath,
            args: [filePath],
            env: { ELECTRON_RUN_AS_NODE: '1' }
        };
    }
    if (language.id === 'python') {
        const executable = resolveCommand(['python3', 'python']);
        if (!executable) return { error: 'NexTerm 所在机器缺少 Python 运行环境: python3/python' };
        return { command: executable, args: [filePath] };
    }
    if (language.id === 'tcl') {
        const executable = resolveCommand(['tclsh']);
        if (!executable) return { error: 'NexTerm 所在机器缺少 Tcl 运行环境: tclsh' };
        return { command: executable, args: [filePath] };
    }
    if (language.id === 'shell') {
        const executable = process.platform === 'win32' ? resolveCommand(['sh']) : resolveCommand(['/bin/sh', 'sh']);
        if (!executable) return { error: 'NexTerm 所在机器缺少 Shell 运行环境: sh' };
        return { command: executable, args: [filePath] };
    }

    const value = String(command || '').trim();
    if (!value) return { error: '执行命令不能为空' };
    const commandText = value.includes('{file}')
        ? value.replace(/\{file\}/g, quoteForShell(filePath))
        : `${value} ${quoteForShell(filePath)}`;
    return shellCommandSpec(commandText);
}

async function writableDirectory(cwd) {
    const candidate = cwd ? normalizeLocalCwd(cwd) : '';
    if (candidate) {
        try {
            const stat = await fsp.stat(candidate);
            if (stat.isDirectory()) {
                await fsp.access(candidate, fs.constants.W_OK);
                return { dir: candidate, temporary: false };
            }
        } catch (_err) {
            /* fall back to temp dir */
        }
    }

    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nexterm-script-'));
    return { dir, temporary: true };
}

function safeTaskId(taskId) {
    return String(taskId || `script-${Date.now().toString(36)}`).replace(/[^A-Za-z0-9_-]/g, '');
}

function safeExtension(extension) {
    return String(extension || 'txt')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 12);
}

function summarizeScriptError(text = '') {
    const lines = String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const nextermLine = lines.find(line => line.startsWith('NexTerm 脚本错误:'));
    if (nextermLine) return nextermLine.replace(/^NexTerm 脚本错误:\s*/, '') || nextermLine;
    const errorLine = lines.find(line => /^(Error|RuntimeError|Exception|Traceback|SyntaxError|TypeError|ReferenceError):/.test(line));
    if (errorLine) return errorLine.replace(/^[^:]+:\s*/, '') || errorLine;
    return lines.find(line => !/^\s*at\s+/.test(line) && !line.startsWith('file://')) || '';
}

async function createScriptFile(payload, cwd) {
    const language = getScriptLanguage(payload.languageId);
    const content = scriptFileContent(language.id, payload.content || '');
    if (!String(payload.content || '').trim()) throw new Error('脚本内容不能为空');

    const { dir, temporary } = await writableDirectory(cwd);
    const filePath = path.join(dir, `.nexterm-${safeTaskId(payload.taskId)}.${safeExtension(language.extension)}`);
    await fsp.writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, { mode: 0o600 });

    return {
        filePath,
        cwd: dir,
        async cleanup() {
            await fsp.unlink(filePath).catch(() => {});
            if (temporary) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
        }
    };
}

async function startLocalScriptTask({
    sessionId,
    payload = {},
    cwd = '',
    sendTerminalInput,
    writeTerminal,
    emit,
    registerTask,
    unregisterTask
}) {
    if (!sessionId) return { ok: false, msg: '请选择已连接的终端窗口' };
    if (!payload.taskId) return { ok: false, msg: '脚本任务参数不完整' };

    let scriptFile;
    try {
        scriptFile = await createScriptFile(payload, cwd);
    } catch (err) {
        return { ok: false, msg: err.message };
    }

    const spec = buildCommandSpec(payload.languageId, payload.command, scriptFile.filePath);
    if (spec.error) {
        await scriptFile.cleanup();
        return { ok: false, msg: spec.error };
    }

    let child;
    const bridge = new ScriptIoBridge({
        sessionId,
        writeInput: data => child.stdin.write(data),
        writeTerminal,
        sendTerminalInput
    });
    const task = { child: null, bridge, sessionId, cleanup: scriptFile.cleanup };

    try {
        child = spawn(spec.command, spec.args || [], {
            cwd: scriptFile.cwd,
            env: buildScriptEnv(spec.env),
            windowsHide: true
        });
        task.child = child;
    } catch (err) {
        await scriptFile.cleanup();
        return { ok: false, msg: err.message };
    }

    registerTask(task);

    let settled = false;
    let stderrText = '';
    const finish = async ({ status, exitCode, msg, details }) => {
        if (settled) return;
        settled = true;
        bridge.close();
        await scriptFile.cleanup();
        unregisterTask();
        const detailText = String(details || stderrText).trim();
        emit(SCRIPT_EVT.TASK, {
            taskId: payload.taskId,
            sessionId,
            status,
            exitCode,
            msg: msg || summarizeScriptError(detailText),
            details: detailText
        });
    };

    child.stdout.on('data', data => bridge.onStdout(data));
    child.stderr.on('data', data => {
        const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
        stderrText = `${stderrText}${text}`;
    });
    child.on('error', err => {
        void finish({ status: 'failed', exitCode: 1, msg: err.message, details: err.stack || err.message });
    });
    child.on('close', (exitCode, signal) => {
        const code = Number(exitCode);
        const normalizedCode = Number.isFinite(code) ? code : signal ? 130 : 1;
        void finish({
            status: normalizedCode === 0 ? 'completed' : 'failed',
            exitCode: normalizedCode
        });
    });

    emit(SCRIPT_EVT.TASK, { taskId: payload.taskId, sessionId, status: 'running' });
    return { ok: true };
}

function stopLocalScriptTask(task) {
    if (!task?.child) return { ok: false, msg: '脚本任务不存在' };
    try {
        task.child.kill('SIGTERM');
        return { ok: true };
    } catch (_err) {
        return { ok: false, msg: '停止脚本失败' };
    }
}

function pauseLocalScriptTask(task) {
    if (!task?.child) return { ok: false, msg: '脚本任务不存在' };
    if (process.platform === 'win32') return { ok: false, msg: '当前平台不支持暂停脚本' };
    task.child.kill('SIGSTOP');
    return { ok: true };
}

function resumeLocalScriptTask(task) {
    if (!task?.child) return { ok: false, msg: '脚本任务不存在' };
    if (process.platform === 'win32') return { ok: false, msg: '当前平台不支持继续脚本' };
    task.child.kill('SIGCONT');
    return { ok: true };
}

module.exports = {
    pauseLocalScriptTask,
    resumeLocalScriptTask,
    startLocalScriptTask,
    stopLocalScriptTask
};
