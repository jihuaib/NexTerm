const { generateKeyPairSync } = require('crypto');
const { constants } = require('fs');
const net = require('net');
const posixPath = require('path').posix;
const { Server } = require('ssh2');
const { STATUS_CODE } = require('ssh2/lib/protocol/SFTP.js');

const ROOT = {
    '/': [{ name: 'home', type: 'dir' }],
    '/home': [{ name: 'e2e', type: 'dir' }],
    '/home/e2e': [
        { name: 'code', type: 'dir' },
        { name: 'readme.txt', type: 'file', size: 15 }
    ],
    '/home/e2e/code': [{ name: 'app.log', type: 'file', size: 27 }]
};

function normalizeRemotePath(input = '/') {
    const raw = String(input || '/').trim();
    if (raw === '.' || raw === './') return '/home/e2e';
    const normalized = posixPath.normalize(raw.startsWith('/') ? raw : `/home/e2e/${raw}`);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function entryAt(targetPath) {
    const normalized = normalizeRemotePath(targetPath);
    if (ROOT[normalized]) return { name: posixPath.basename(normalized) || '/', type: 'dir' };
    const parent = posixPath.dirname(normalized);
    const name = posixPath.basename(normalized);
    return (ROOT[parent] || []).find(entry => entry.name === name) || null;
}

function addEntry(parentPath, entry) {
    const parent = normalizeRemotePath(parentPath);
    if (!ROOT[parent]) return false;
    if (ROOT[parent].some(item => item.name === entry.name)) return false;
    ROOT[parent].push(entry);
    ROOT[parent].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return true;
}

function removeEntry(targetPath) {
    const normalized = normalizeRemotePath(targetPath);
    if (normalized === '/') return false;
    const entry = entryAt(normalized);
    if (!entry) return false;
    if (entry.type === 'dir') {
        for (const key of Object.keys(ROOT)) {
            if (key === normalized || key.startsWith(`${normalized}/`)) delete ROOT[key];
        }
    }
    const parent = posixPath.dirname(normalized);
    const name = posixPath.basename(normalized);
    ROOT[parent] = (ROOT[parent] || []).filter(item => item.name !== name);
    return true;
}

function renameEntry(oldPath, newPath) {
    const source = normalizeRemotePath(oldPath);
    const target = normalizeRemotePath(newPath);
    const entry = entryAt(source);
    if (!entry || entryAt(target)) return false;
    const targetParent = posixPath.dirname(target);
    if (!ROOT[targetParent]) return false;

    removeEntry(source);
    const renamed = { ...entry, name: posixPath.basename(target) };
    addEntry(targetParent, renamed);
    if (entry.type === 'dir') {
        const moved = {};
        for (const [key, value] of Object.entries(ROOT)) {
            if (key === source || key.startsWith(`${source}/`)) {
                moved[key.replace(source, target)] = value;
                delete ROOT[key];
            }
        }
        Object.assign(ROOT, moved);
        ROOT[target] ||= [];
    }
    return true;
}

function attrsFor(entry) {
    const now = Math.floor(Date.now() / 1000);
    const isDir = entry?.type === 'dir';
    return {
        mode: (isDir ? constants.S_IFDIR : constants.S_IFREG) | (isDir ? 0o755 : 0o644),
        uid: 1000,
        gid: 1000,
        size: isDir ? 0 : Number(entry.size) || 0,
        atime: now,
        mtime: now
    };
}

function longnameFor(entry) {
    const prefix = entry.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--';
    return `${prefix} 1 e2e e2e ${entry.size || 0} Jun 19 2026 ${entry.name}`;
}

function wireSftp(sftp) {
    let nextHandle = 1;
    const handles = new Map();

    function createHandle(state) {
        const handle = Buffer.alloc(4);
        handle.writeUInt32BE(nextHandle, 0);
        handles.set(nextHandle, state);
        nextHandle += 1;
        return handle;
    }

    function readHandle(handle) {
        if (!Buffer.isBuffer(handle) || handle.length !== 4) return null;
        return handles.get(handle.readUInt32BE(0)) || null;
    }

    function sendAttrs(reqid, targetPath) {
        const entry = entryAt(targetPath);
        if (!entry) {
            sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            return;
        }
        sftp.attrs(reqid, attrsFor(entry));
    }

    sftp.on('REALPATH', (reqid, targetPath) => {
        const resolved = normalizeRemotePath(targetPath);
        const entry = entryAt(resolved) || { name: posixPath.basename(resolved), type: 'dir' };
        sftp.name(reqid, [
            {
                filename: resolved,
                longname: longnameFor(entry),
                attrs: attrsFor(entry)
            }
        ]);
    });

    sftp.on('STAT', sendAttrs);
    sftp.on('LSTAT', sendAttrs);

    sftp.on('OPENDIR', (reqid, targetPath) => {
        const resolved = normalizeRemotePath(targetPath);
        if (!ROOT[resolved]) {
            sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            return;
        }
        sftp.handle(reqid, createHandle({ type: 'dir', path: resolved, sent: false }));
    });

    sftp.on('READDIR', (reqid, handle) => {
        const state = readHandle(handle);
        if (!state || state.type !== 'dir') {
            sftp.status(reqid, STATUS_CODE.FAILURE);
            return;
        }
        if (state.sent) {
            sftp.status(reqid, STATUS_CODE.EOF);
            return;
        }
        state.sent = true;
        sftp.name(
            reqid,
            ROOT[state.path].map(entry => ({
                filename: entry.name,
                longname: longnameFor(entry),
                attrs: attrsFor(entry)
            }))
        );
    });

    sftp.on('CLOSE', (reqid, handle) => {
        if (Buffer.isBuffer(handle) && handle.length === 4) handles.delete(handle.readUInt32BE(0));
        sftp.status(reqid, STATUS_CODE.OK);
    });

    sftp.on('MKDIR', (reqid, targetPath) => {
        const resolved = normalizeRemotePath(targetPath);
        const parent = posixPath.dirname(resolved);
        const name = posixPath.basename(resolved);
        if (!addEntry(parent, { name, type: 'dir' })) {
            sftp.status(reqid, STATUS_CODE.FAILURE);
            return;
        }
        ROOT[resolved] = [];
        sftp.status(reqid, STATUS_CODE.OK);
    });

    sftp.on('RENAME', (reqid, oldPath, newPath) => {
        sftp.status(reqid, renameEntry(oldPath, newPath) ? STATUS_CODE.OK : STATUS_CODE.FAILURE);
    });

    sftp.on('REMOVE', (reqid, targetPath) => {
        const entry = entryAt(targetPath);
        if (!entry || entry.type === 'dir') {
            sftp.status(reqid, STATUS_CODE.FAILURE);
            return;
        }
        sftp.status(reqid, removeEntry(targetPath) ? STATUS_CODE.OK : STATUS_CODE.FAILURE);
    });

    sftp.on('RMDIR', (reqid, targetPath) => {
        const entry = entryAt(targetPath);
        if (!entry || entry.type !== 'dir') {
            sftp.status(reqid, STATUS_CODE.FAILURE);
            return;
        }
        sftp.status(reqid, removeEntry(targetPath) ? STATUS_CODE.OK : STATUS_CODE.FAILURE);
    });
}

function writePrompt(stream, cwd) {
    const promptPath = cwd === '/home/e2e' ? '~' : cwd.replace('/home/e2e', '~');
    stream.write(`\u001b]7;file://mock${cwd}\u0007`);
    stream.write(`e2e@mock:${promptPath}$ `);
}

function wireShell(stream) {
    let cwd = '/home/e2e';
    let buffer = '';
    stream.write('mock ssh ready\r\n');
    writePrompt(stream, cwd);
    stream.on('data', data => {
        buffer += data.toString('utf8');
        let lineBreak = buffer.search(/[\r\n]/);
        while (lineBreak >= 0) {
            const line = buffer.slice(0, lineBreak).trim();
            buffer = buffer.slice(lineBreak + 1);
            if (line === 'pwd') stream.write(`${cwd}\r\n`);
            if (line.startsWith('cd ')) {
                const target = normalizeRemotePath(line.slice(3).trim());
                if (ROOT[target]) cwd = target;
            }
            writePrompt(stream, cwd);
            lineBreak = buffer.search(/[\r\n]/);
        }
    });
}

async function startTestSshServer(options = {}) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const hostKey = privateKey.export({ type: 'pkcs1', format: 'pem' });
    const username = 'e2e';
    const password = options.password || 'password';
    const clients = new Set();
    const forwardServers = new Set();

    const server = new Server({ hostKeys: [hostKey] }, client => {
        clients.add(client);
        const remoteForwards = new Map();
        client.on('close', () => {
            clients.delete(client);
            for (const forwardServer of remoteForwards.values()) {
                forwardServers.delete(forwardServer);
                try {
                    forwardServer.close();
                } catch (_err) {
                    /* test cleanup */
                }
            }
            remoteForwards.clear();
        });

        client.on('authentication', ctx => {
            if (ctx.method === 'password' && ctx.username === username && ctx.password === password) {
                ctx.accept();
                return;
            }
            ctx.reject();
        });

        client.on('ready', () => {
            client.on('request', (accept, reject, name, info = {}) => {
                if (name === 'tcpip-forward') {
                    const bindHost = info.bindAddr || '127.0.0.1';
                    const requestedPort = Number(info.bindPort) || 0;
                    const forwardServer = net.createServer(socket => {
                        client.forwardOut(
                            bindHost,
                            forwardServer.address().port,
                            socket.remoteAddress || '127.0.0.1',
                            Number(socket.remotePort) || 0,
                            (err, channel) => {
                                if (err) {
                                    socket.destroy();
                                    return;
                                }
                                socket.pipe(channel);
                                channel.pipe(socket);
                            }
                        );
                    });
                    const onForwardError = () => reject?.();
                    forwardServer.once('error', onForwardError);
                    forwardServer.listen(requestedPort, bindHost, () => {
                        forwardServer.off('error', onForwardError);
                        const actualPort = forwardServer.address().port;
                        remoteForwards.set(`${bindHost}:${actualPort}`, forwardServer);
                        forwardServers.add(forwardServer);
                        accept?.(actualPort);
                    });
                    return;
                }

                if (name === 'cancel-tcpip-forward') {
                    const bindHost = info.bindAddr || '127.0.0.1';
                    const bindPort = Number(info.bindPort) || 0;
                    const key = `${bindHost}:${bindPort}`;
                    const forwardServer = remoteForwards.get(key);
                    if (forwardServer) {
                        remoteForwards.delete(key);
                        forwardServers.delete(forwardServer);
                        forwardServer.close(() => accept?.());
                    } else {
                        accept?.();
                    }
                }
            });

            client.on('tcpip', (accept, reject, info = {}) => {
                const destHost = info.destIP || info.destHost || '127.0.0.1';
                const destPort = Number(info.destPort);
                if (!destPort) {
                    reject?.();
                    return;
                }
                const channel = accept();
                const socket = net.connect({ host: destHost, port: destPort }, () => {
                    channel.pipe(socket);
                    socket.pipe(channel);
                });
                const close = () => {
                    channel.destroy?.();
                    socket.destroy?.();
                };
                channel.on('error', close);
                socket.on('error', close);
            });

            client.on('session', accept => {
                const session = accept();
                session.on('pty', acceptPty => acceptPty && acceptPty());
                session.on('shell', acceptShell => wireShell(acceptShell()));
                session.on('sftp', acceptSftp => wireSftp(acceptSftp()));
            });
        });
    });

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve();
        });
    });

    return {
        host: '127.0.0.1',
        port: server.address().port,
        username,
        password,
        close: () =>
            new Promise(resolve => {
                let settled = false;
                const done = () => {
                    if (settled) return;
                    settled = true;
                    resolve();
                };
                for (const client of clients) {
                    try {
                        client.end();
                        client.destroy?.();
                    } catch (_err) {
                        /* test cleanup */
                    }
                }
                for (const forwardServer of [...forwardServers]) {
                    try {
                        forwardServer.close();
                    } catch (_err) {
                        /* test cleanup */
                    }
                }
                forwardServers.clear();
                server.close(done);
                setTimeout(done, 1000).unref();
            })
    };
}

module.exports = { startTestSshServer };
