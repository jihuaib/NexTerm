const fs = require('fs');
const path = require('path');
const remotePath = require('path').posix;
const { Client } = require('ssh2');
const { TERMINAL_STATUS, TERMINAL_EVT, SFTP_EVT } = require('../const/telnetConst');
const { verifyKnownHost } = require('./knownHosts');

function normalizeText(value) {
    return String(value || '').trim();
}

function toB64(buffer) {
    return Buffer.isBuffer(buffer) ? buffer.toString('base64') : Buffer.from(String(buffer), 'utf8').toString('base64');
}

function normalizeRemotePath(input = '/') {
    const text = normalizeText(input) || '/';
    const normalized = remotePath.normalize(text);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function decodeFileUriPath(value) {
    const text = String(value || '');
    try {
        return decodeURIComponent(text);
    } catch (_err) {
        return text;
    }
}

function extractOsc7Paths(text) {
    const paths = [];
    const pattern = /\x1b]7;file:\/\/[^/\x07\x1b]*(\/[^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let match = pattern.exec(text);
    while (match) {
        paths.push(normalizeRemotePath(decodeFileUriPath(match[1])));
        match = pattern.exec(text);
    }
    return paths;
}

function stripAnsi(text) {
    return String(text || '')
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
}

function resolvePromptPath(ctx, promptPath) {
    const raw = String(promptPath || '').trim();
    if (!raw) return '';
    if (raw === '~') return ctx.home || '/';
    if (raw.startsWith('~/')) return normalizeRemotePath(remotePath.join(ctx.home || '/', raw.slice(2)));
    if (raw.startsWith('/')) return normalizeRemotePath(raw);
    return '';
}

function extractLatestPromptPath(text, ctx) {
    let latestPath = '';
    const plain = stripAnsi(text).replace(/\r/g, '\n');
    const pattern = /(?:^|\n)[^\n]*:([~/][^#$\n]*)\s?[$#]\s?/g;
    let match = pattern.exec(plain);
    while (match) {
        const resolved = resolvePromptPath(ctx, match[1]);
        if (resolved) latestPath = resolved;
        match = pattern.exec(plain);
    }
    return latestPath;
}

function normalizeAuthType(options = {}) {
    const authType = normalizeText(options.authType);
    if (authType === 'password' || authType === 'key' || authType === 'agent') return authType;
    if (normalizeText(options.privateKeyPath)) return 'key';
    if (String(options.password || '')) return 'password';
    return process.env.SSH_AUTH_SOCK ? 'agent' : 'password';
}

function resolveRemotePath(base, target) {
    const raw = normalizeText(target);
    if (!raw) return normalizeRemotePath(base || '/');
    if (raw.startsWith('/')) return normalizeRemotePath(raw);
    return normalizeRemotePath(remotePath.join(base || '/', raw));
}

function parentRemotePath(filePath) {
    const parts = String(filePath || '/').split('/').filter(Boolean);
    parts.pop();
    return parts.length ? `/${parts.join('/')}` : '/';
}

function remoteBasename(targetPath) {
    return remotePath.basename(normalizeRemotePath(targetPath));
}

function validateRemoteName(name, label = '名称') {
    const value = normalizeText(name);
    if (!value) throw new Error(`${label}不能为空`);
    if (value === '.' || value === '..' || value.includes('/')) throw new Error(`${label}不能包含路径分隔符`);
    return value;
}

function validateRemovablePath(targetPath) {
    const normalized = normalizeRemotePath(targetPath);
    if (normalized === '/') throw new Error('不允许删除根目录');
    return normalized;
}

function buildConfig(options = {}) {
    const password = String(options.password || '');
    const authType = normalizeAuthType(options);
    const config = {
        host: normalizeText(options.host),
        port: Number(options.port) || 22,
        username: normalizeText(options.username) || process.env.USER || 'root',
        readyTimeout: 20000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
        tryKeyboard: false
    };

    const privateKeyPath = expandHomePath(options.privateKeyPath);
    if (authType === 'key') {
        if (!privateKeyPath) throw new Error('请选择 SSH 私钥文件');
        try {
            config.privateKey = fs.readFileSync(privateKeyPath, 'utf8');
        } catch (err) {
            throw new Error(`读取 SSH 私钥失败: ${err.message}`);
        }
        const passphrase = normalizeText(options.passphrase);
        if (passphrase) config.passphrase = passphrase;
    } else if (authType === 'agent') {
        if (!process.env.SSH_AUTH_SOCK) {
            throw new Error('未发现 SSH Agent，请确认 ssh-agent 已启动，或改用密码/私钥认证');
        }
        config.agent = process.env.SSH_AUTH_SOCK;
    } else {
        if (!password) throw new Error('SSH 密码为空，请输入密码，或在会话里改用私钥/SSH Agent');
        config.password = password;
        config.tryKeyboard = true;
    }

    if (options.sshKnownHostsEnabled !== false) {
        config.hostHash = 'sha256';
        config.hostVerifier = fingerprint => {
            const result = verifyKnownHost(config, fingerprint);
            if (!result.ok) options._knownHostVerificationError = result.msg;
            return result.ok;
        };
    }

    return config;
}

function formatConnectionError(err, options = {}) {
    if (options._knownHostVerificationError) return options._knownHostVerificationError;
    const message = err?.message || String(err || '未知错误');
    if (!/All configured authentication methods failed/i.test(message)) {
        return `SSH 连接失败: ${message}`;
    }

    const authType = normalizeAuthType(options);
    if (authType === 'key') {
        return 'SSH 认证失败: 私钥未被服务端接受，请检查用户名、私钥文件、私钥口令以及服务端 authorized_keys。';
    }
    if (authType === 'agent') {
        return 'SSH 认证失败: SSH Agent 没有可用密钥，或当前用户没有被服务端接受。';
    }
    return 'SSH 认证失败: 用户名或密码不正确，或服务端禁用了密码/键盘交互登录。';
}

function expandHomePath(value) {
    const text = normalizeText(value);
    if (!text) return '';
    if (text === '~') return process.env.HOME || text;
    if (text.startsWith('~/')) return path.join(process.env.HOME || '', text.slice(2));
    return text;
}

function modeText(attrs = {}) {
    return attrs.mode ? `0${(attrs.mode & 0o777).toString(8)}` : '';
}

function entryFromStats(item, parentPath, sessionId) {
    const fullPath = normalizeRemotePath(parentPath === '/' ? `/${item.filename}` : `${parentPath}/${item.filename}`);
    const isDirectory = item.attrs?.isDirectory?.() || false;
    return {
        id: `sftp:${sessionId}:${fullPath}`,
        type: isDirectory ? 'file-folder' : 'file',
        resource: 'file',
        name: item.filename,
        path: fullPath,
        connectionId: sessionId,
        size: Number(item.attrs?.size) || 0,
        modifiedAt: item.attrs?.mtime ? new Date(item.attrs.mtime * 1000).toISOString() : null,
        permissions: modeText(item.attrs),
        loaded: false,
        children: []
    };
}

function isDirStats(stats) {
    return Boolean(stats?.isDirectory?.());
}

function splitShellCommands(command = '') {
    const parts = [];
    let current = '';
    let quote = '';
    let escaped = false;

    for (let i = 0; i < command.length; i += 1) {
        const ch = command[i];
        const next = command[i + 1];
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            current += ch;
            escaped = true;
            continue;
        }
        if (quote) {
            current += ch;
            if (ch === quote) quote = '';
            continue;
        }
        if (ch === '"' || ch === "'") {
            current += ch;
            quote = ch;
            continue;
        }
        if (ch === ';' || (ch === '&' && next === '&')) {
            if (current.trim()) parts.push(current.trim());
            current = '';
            if (ch === '&') i += 1;
            continue;
        }
        current += ch;
    }

    if (current.trim()) parts.push(current.trim());
    return parts;
}

function tokenizeShellCommand(command = '') {
    const tokens = [];
    let current = '';
    let quote = '';
    let escaped = false;

    for (const ch of command) {
        if (escaped) {
            current += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            continue;
        }
        if (quote) {
            if (ch === quote) quote = '';
            else current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (/\s/.test(ch)) {
            if (current) {
                tokens.push(current);
                current = '';
            }
            continue;
        }
        current += ch;
    }

    if (current) tokens.push(current);
    return tokens;
}

function resolveShellPath(ctx, target) {
    const raw = String(target || '');
    if (!raw || raw === '~' || raw === '$HOME' || raw === '${HOME}') return ctx.home || '/';
    if (raw === '-') return ctx.previousCwd || ctx.cwd || ctx.home || '/';
    if (raw.startsWith('~/')) return remotePath.join(ctx.home || '/', raw.slice(2));
    return resolveRemotePath(ctx.cwd, raw);
}

function parseNavigationCommand(command) {
    const tokens = tokenizeShellCommand(command);
    while (tokens[0] === 'builtin' || tokens[0] === 'command') tokens.shift();
    const name = tokens[0];
    if (name === 'cd') return { type: 'cd', target: tokens[1] || '' };
    if (name === 'pushd') return { type: 'pushd', target: tokens[1] || '' };
    if (name === 'popd') return { type: 'popd' };
    return null;
}

class SshManager {
    constructor(emit) {
        this.emit = typeof emit === 'function' ? emit : () => {};
        this.conns = new Map();
    }

    connect(options = {}) {
        const { sessionId } = options;
        if (!sessionId) return { ok: false, msg: '会话参数不完整' };
        if (this.conns.has(sessionId)) return { ok: false, msg: '会话已存在' };
        if (!options.host) return { ok: false, msg: 'SSH 主机不能为空' };

        let config;
        try {
            config = buildConfig(options);
        } catch (err) {
            return { ok: false, msg: `SSH 配置无效: ${err.message}` };
        }

        const conn = new Client();
        const ctx = {
            conn,
            stream: null,
            sftp: null,
            sftpReady: null,
            cols: Number(options.cols) || 80,
            rows: Number(options.rows) || 24,
            cwd: '/',
            home: '/',
            previousCwd: '/',
            dirStack: [],
            commandBuffer: '',
            oscBuffer: '',
            promptBuffer: '',
            lastError: '',
            ended: false
        };
        this.conns.set(sessionId, ctx);
        this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.CONNECTING });

        const emitTerminalStatus = (status, msg = '') => {
            if (status === TERMINAL_STATUS.ERROR) ctx.lastError = msg || 'SSH 连接失败';
            if ((status === TERMINAL_STATUS.CLOSED || status === TERMINAL_STATUS.ERROR) && ctx.ended) return;
            if (status === TERMINAL_STATUS.CLOSED || status === TERMINAL_STATUS.ERROR) ctx.ended = true;
            this.emit(TERMINAL_EVT.STATUS, { sessionId, status, msg });
        };

        conn.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
            const password = String(options.password || '');
            finish(prompts.map(() => password));
        });

        conn.on('ready', () => {
            this.ensureSftp(sessionId).then(sftp => {
                sftp.realpath('.', (err, realPath) => {
                    if (!err && realPath) {
                        ctx.cwd = normalizeRemotePath(realPath);
                        ctx.home = ctx.cwd;
                        this.emit(SFTP_EVT.CWD, { sessionId, path: ctx.cwd });
                    }
                });
            }).catch(() => {});

            conn.shell(
                {
                    term: 'xterm-256color',
                    cols: ctx.cols,
                    rows: ctx.rows,
                    width: ctx.cols * 10,
                    height: ctx.rows * 20
                },
                (err, stream) => {
                    if (err) {
                        emitTerminalStatus(TERMINAL_STATUS.ERROR, `打开远程 Shell 失败: ${err.message}`);
                        try {
                            conn.end();
                        } catch (_closeErr) {
                            /* ignore */
                        }
                        return;
                    }
                    ctx.stream = stream;
                    ctx.ended = false;
                    this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.CONNECTED });
                    stream.on('data', data => {
                        this.processShellData(sessionId, ctx, data);
                        this.emit(TERMINAL_EVT.DATA, { sessionId, b64: toB64(data) });
                    });
                    stream.stderr?.on?.('data', data => {
                        this.emit(TERMINAL_EVT.DATA, { sessionId, b64: toB64(data) });
                    });
                    stream.on('close', () => {
                        this.conns.delete(sessionId);
                        emitTerminalStatus(TERMINAL_STATUS.CLOSED, ctx.lastError || '远程 Shell 已关闭');
                    });
                }
            );
        });

        conn.on('error', err => {
            emitTerminalStatus(TERMINAL_STATUS.ERROR, formatConnectionError(err, options));
        });
        conn.on('close', () => {
            this.conns.delete(sessionId);
            if (ctx.lastError) emitTerminalStatus(TERMINAL_STATUS.ERROR, ctx.lastError);
            else emitTerminalStatus(TERMINAL_STATUS.CLOSED, 'SSH 连接已关闭');
        });

        conn.connect(config);
        return { ok: true };
    }

    ensureSftp(sessionId) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return Promise.reject(new Error('SSH 会话不存在'));
        if (ctx.sftp) return Promise.resolve(ctx.sftp);
        if (ctx.sftpReady) return ctx.sftpReady;
        ctx.sftpReady = new Promise((resolve, reject) => {
            ctx.conn.sftp((err, sftp) => {
                if (err) {
                    ctx.sftpReady = null;
                    reject(err);
                    return;
                }
                ctx.sftp = sftp;
                resolve(sftp);
            });
        });
        return ctx.sftpReady;
    }

    async currentCwd(sessionId) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) throw new Error('SSH 会话不存在');
        if (ctx.cwd && ctx.cwd !== '/') return { path: ctx.cwd };

        const sftp = await this.ensureSftp(sessionId);
        const realPath = await new Promise((resolve, reject) => {
            sftp.realpath('.', (err, resolvedPath) => {
                if (err) reject(err);
                else resolve(resolvedPath);
            });
        });
        if (realPath) {
            ctx.cwd = normalizeRemotePath(realPath);
            ctx.home = ctx.home && ctx.home !== '/' ? ctx.home : ctx.cwd;
            this.emit(SFTP_EVT.CWD, { sessionId, path: ctx.cwd });
        }
        return { path: ctx.cwd || '/' };
    }

    async list(sessionId, dirPath = '/') {
        const sftp = await this.ensureSftp(sessionId);
        const normalized = normalizeRemotePath(dirPath);
        return new Promise((resolve, reject) => {
            sftp.readdir(normalized, (err, list = []) => {
                if (err) {
                    reject(err);
                    return;
                }
                const entries = list
                    .filter(item => item.filename !== '.' && item.filename !== '..')
                    .map(item => entryFromStats(item, normalized, sessionId))
                    .sort((a, b) => {
                        if (a.type !== b.type) return a.type === 'file-folder' ? -1 : 1;
                        return a.name.localeCompare(b.name);
                    });
                resolve({ path: normalized, entries });
            });
        });
    }

    async stat(sessionId, targetPath) {
        const sftp = await this.ensureSftp(sessionId);
        const normalized = normalizeRemotePath(targetPath);
        return new Promise((resolve, reject) => {
            sftp.stat(normalized, (err, stats) => {
                if (err) reject(err);
                else resolve(stats);
            });
        });
    }

    async download(sessionId, sourcePath, destinationPath, onProgress = null) {
        const stats = await this.stat(sessionId, sourcePath);
        if (isDirStats(stats)) await this.downloadDirectory(sessionId, sourcePath, destinationPath, onProgress);
        else await this.downloadFile(sessionId, sourcePath, destinationPath, onProgress);
    }

    async downloadFile(sessionId, sourcePath, destinationPath, onProgress = null) {
        const sftp = await this.ensureSftp(sessionId);
        const normalizedSource = normalizeRemotePath(sourcePath);
        await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
        return new Promise((resolve, reject) => {
            sftp.fastGet(
                normalizedSource,
                destinationPath,
                {
                    step: (transferred, _chunk, total) => {
                        if (typeof onProgress !== 'function') return;
                        onProgress({
                            sessionId,
                            operation: 'download',
                            phase: 'active',
                            remotePath: normalizedSource,
                            name: remoteBasename(normalizedSource),
                            transferred,
                            total
                        });
                    }
                },
                err => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async downloadDirectory(sessionId, sourcePath, destinationPath, onProgress = null) {
        await fs.promises.mkdir(destinationPath, { recursive: true });
        const { entries } = await this.list(sessionId, sourcePath);
        for (const entry of entries) {
            const childLocal = path.join(destinationPath, entry.name);
            if (entry.type === 'file-folder') await this.downloadDirectory(sessionId, entry.path, childLocal, onProgress);
            else await this.downloadFile(sessionId, entry.path, childLocal, onProgress);
        }
    }

    async upload(sessionId, localPath, targetDir, onProgress = null) {
        const stats = await fs.promises.stat(localPath);
        const destination = resolveRemotePath(targetDir, path.basename(localPath));
        if (stats.isDirectory()) await this.uploadDirectory(sessionId, localPath, destination, onProgress);
        else await this.uploadFile(sessionId, localPath, destination, onProgress);
    }

    async uploadFile(sessionId, localPath, destinationPath, onProgress = null) {
        const sftp = await this.ensureSftp(sessionId);
        const normalizedDestination = normalizeRemotePath(destinationPath);
        return new Promise((resolve, reject) => {
            sftp.fastPut(
                localPath,
                normalizedDestination,
                {
                    step: (transferred, _chunk, total) => {
                        if (typeof onProgress !== 'function') return;
                        onProgress({
                            sessionId,
                            operation: 'upload',
                            phase: 'active',
                            remotePath: normalizedDestination,
                            name: path.basename(localPath),
                            transferred,
                            total
                        });
                    }
                },
                err => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });
    }

    async uploadDirectory(sessionId, localPath, destinationPath, onProgress = null) {
        const sftp = await this.ensureSftp(sessionId);
        await new Promise(resolve => {
            sftp.mkdir(normalizeRemotePath(destinationPath), () => resolve());
        });
        const children = await fs.promises.readdir(localPath);
        for (const child of children) {
            await this.upload(sessionId, path.join(localPath, child), destinationPath, onProgress);
        }
    }

    async mkdir(sessionId, targetDir, name) {
        const sftp = await this.ensureSftp(sessionId);
        const folderName = validateRemoteName(name, '目录名称');
        const targetPath = resolveRemotePath(targetDir, folderName);
        return new Promise((resolve, reject) => {
            sftp.mkdir(targetPath, err => {
                if (err) reject(err);
                else resolve({ path: targetPath });
            });
        });
    }

    async rename(sessionId, sourcePath, newName) {
        const sftp = await this.ensureSftp(sessionId);
        const normalizedSource = validateRemovablePath(sourcePath);
        const targetName = validateRemoteName(newName, '新名称');
        const targetPath = resolveRemotePath(parentRemotePath(normalizedSource), targetName);
        return new Promise((resolve, reject) => {
            sftp.rename(normalizedSource, targetPath, err => {
                if (err) reject(err);
                else resolve({ path: targetPath });
            });
        });
    }

    async remove(sessionId, targetPath) {
        const normalizedTarget = validateRemovablePath(targetPath);
        const stats = await this.stat(sessionId, normalizedTarget);
        if (isDirStats(stats)) await this.removeDirectory(sessionId, normalizedTarget);
        else await this.removeFile(sessionId, normalizedTarget);
    }

    async removeFile(sessionId, targetPath) {
        const sftp = await this.ensureSftp(sessionId);
        const normalizedTarget = validateRemovablePath(targetPath);
        return new Promise((resolve, reject) => {
            sftp.unlink(normalizedTarget, err => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async removeDirectory(sessionId, targetPath) {
        const sftp = await this.ensureSftp(sessionId);
        const normalizedTarget = validateRemovablePath(targetPath);
        const { entries } = await this.list(sessionId, normalizedTarget);
        for (const entry of entries) {
            if (entry.type === 'file-folder') await this.removeDirectory(sessionId, entry.path);
            else await this.removeFile(sessionId, entry.path);
        }
        return new Promise((resolve, reject) => {
            sftp.rmdir(normalizedTarget, err => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    resize(sessionId, cols, rows) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return;
        ctx.cols = Number(cols) || ctx.cols;
        ctx.rows = Number(rows) || ctx.rows;
        try {
            ctx.stream?.setWindow?.(ctx.rows, ctx.cols, ctx.rows * 20, ctx.cols * 10);
        } catch (_err) {
            /* stream may be closed */
        }
    }

    sendInput(sessionId, data) {
        const ctx = this.conns.get(sessionId);
        if (!ctx?.stream) return;
        const text = String(data);
        ctx.stream.write(text);
        this.trackCommand(sessionId, ctx, text);
    }

    trackCommand(sessionId, ctx, text) {
        for (const ch of text) {
            if (ch === '\r' || ch === '\n') {
                this.processCommand(sessionId, ctx, ctx.commandBuffer.trim());
                ctx.commandBuffer = '';
            } else if (ch === '\u007f' || ch === '\b') {
                ctx.commandBuffer = ctx.commandBuffer.slice(0, -1);
            } else if (ch >= ' ' && ch !== '\x7f') {
                ctx.commandBuffer += ch;
            }
        }
    }

    processShellData(sessionId, ctx, data) {
        const chunk = data.toString('utf8');
        const text = ctx.oscBuffer + chunk;
        const paths = extractOsc7Paths(text);
        paths.forEach(path => this.updateCwd(sessionId, ctx, path, true));
        const promptText = ctx.promptBuffer + chunk;
        const promptPath = extractLatestPromptPath(promptText, ctx);
        if (promptPath) this.updateCwd(sessionId, ctx, promptPath, true);
        ctx.promptBuffer = promptText.slice(-2048);

        const lastEsc = text.lastIndexOf('\x1b]7;');
        const lastTerminator = Math.max(text.lastIndexOf('\x07'), text.lastIndexOf('\x1b\\'));
        ctx.oscBuffer = lastEsc > lastTerminator ? text.slice(lastEsc) : '';
        if (ctx.oscBuffer.length > 4096) ctx.oscBuffer = '';
    }

    updateCwd(sessionId, ctx, path, forceEmit = false) {
        const normalized = normalizeRemotePath(path);
        if (!normalized) return;
        if (!forceEmit && normalized === ctx.cwd) return;
        ctx.cwd = normalized;
        this.emit(SFTP_EVT.CWD, { sessionId, path: ctx.cwd });
    }

    async processCommand(sessionId, ctx, command) {
        let handledNavigation = false;
        for (const part of splitShellCommands(command)) {
            const nav = parseNavigationCommand(part);
            if (!nav) continue;
            handledNavigation = true;
            await this.applyNavigationCommand(sessionId, ctx, nav);
        }

        if (!handledNavigation && command === 'pwd') {
            this.emit(SFTP_EVT.CWD, { sessionId, path: ctx.cwd });
        }
    }

    async applyNavigationCommand(sessionId, ctx, nav) {
        let target = '';
        if (nav.type === 'popd') {
            target = ctx.dirStack.pop();
            if (!target) return;
        } else {
            target = resolveShellPath(ctx, nav.target);
        }

        try {
            const sftp = await this.ensureSftp(sessionId);
            const stats = await this.stat(sessionId, target);
            if (!isDirStats(stats)) return;
            const realPath = await new Promise((resolve, reject) => {
                sftp.realpath(target, (err, resolvedPath) => {
                    if (err) reject(err);
                    else resolve(resolvedPath);
                });
            });
            if (!realPath) return;
            const oldCwd = ctx.cwd;
            if (nav.type === 'pushd' && oldCwd) ctx.dirStack.push(oldCwd);
            this.updateCwd(sessionId, ctx, realPath);
            if (oldCwd !== ctx.cwd) ctx.previousCwd = oldCwd;
        } catch (_err) {
            /* shell command may fail; keep previous cwd */
        }
    }

    disconnect(sessionId) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return;
        try {
            ctx.stream?.end?.();
            ctx.conn.end();
        } catch (_err) {
            /* already closed */
        }
        this.conns.delete(sessionId);
    }

    disconnectAll() {
        for (const id of [...this.conns.keys()]) {
            this.disconnect(id);
        }
    }
}

module.exports = SshManager;
