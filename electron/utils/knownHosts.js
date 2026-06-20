const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function knownHostsPath() {
    return path.join(os.homedir(), '.ssh', 'known_hosts');
}

function readKnownHostLines() {
    try {
        const raw = fs.readFileSync(knownHostsPath(), 'utf8');
        if (!raw) return [];
        return raw
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .split('\n')
            .filter((line, index, lines) => {
                return index < lines.length - 1 || line !== '';
            });
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }
}

function writeKnownHostLines(lines) {
    const filePath = knownHostsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    try {
        fs.chmodSync(path.dirname(filePath), 0o700);
    } catch (_err) {
        /* best effort only */
    }
    const tmpPath = `${filePath}.tmp`;
    const content = lines.length ? `${lines.join('\n')}\n` : '';
    fs.writeFileSync(tmpPath, content, { encoding: 'utf8', mode: 0o600 });
    try {
        fs.chmodSync(tmpPath, 0o600);
    } catch (_err) {
        /* best effort only */
    }
    fs.renameSync(tmpPath, filePath);
}

function normalizeHost(host) {
    return String(host || '')
        .trim()
        .toLowerCase();
}

function normalizePort(port) {
    return Number(port) || 22;
}

function targetHostField(host, port) {
    const normalizedHost = normalizeHost(host);
    const normalizedPort = normalizePort(port);
    return normalizedPort === 22 ? normalizedHost : `[${normalizedHost}]:${normalizedPort}`;
}

function readSshString(buffer, offset = 0) {
    if (!Buffer.isBuffer(buffer) || buffer.length < offset + 4) return null;
    const length = buffer.readUInt32BE(offset);
    const start = offset + 4;
    const end = start + length;
    if (length <= 0 || end > buffer.length) return null;
    return { value: buffer.slice(start, end), next: end };
}

function fingerprintFromBuffer(buffer) {
    const digest = crypto.createHash('sha256').update(buffer).digest('base64').replace(/=+$/, '');
    return `SHA256:${digest}`;
}

function rawKeyInfo(rawKey) {
    if (!Buffer.isBuffer(rawKey) || rawKey.length === 0) return null;
    const first = readSshString(rawKey);
    if (!first) return null;
    const keyType = first.value.toString('utf8');
    if (!keyType) return null;
    return {
        keyType,
        key: rawKey.toString('base64'),
        fingerprint: fingerprintFromBuffer(rawKey)
    };
}

function fingerprintFromBase64(key) {
    try {
        const rawKey = Buffer.from(String(key || ''), 'base64');
        if (!rawKey.length) return '';
        return fingerprintFromBuffer(rawKey);
    } catch (_err) {
        return '';
    }
}

function parseKnownHostLine(line, index) {
    const text = String(line || '').trim();
    if (!text || text.startsWith('#')) return null;

    const fields = text.split(/\s+/);
    let marker = '';
    if (fields[0]?.startsWith('@')) marker = fields.shift();
    if (fields.length < 3) return null;

    const hostPattern = fields[0];
    const keyType = fields[1];
    const key = fields[2];
    if (!hostPattern || !keyType || !key) return null;

    const parsed = {
        id: `line-${index}`,
        marker,
        hostPattern,
        keyType,
        key,
        line,
        lineIndex: index,
        lineNumber: index + 1,
        sourcePath: knownHostsPath(),
        hash: 'sha256',
        fingerprint: fingerprintFromBase64(key)
    };
    return {
        ...parsed,
        ...displayHostFromPattern(hostPattern)
    };
}

function displayHostFromPattern(hostPattern) {
    const first = String(hostPattern || '').split(',')[0] || '';
    const bracketMatch = first.match(/^\[([^\]]+)]:(\d+)$/);
    if (bracketMatch) {
        return {
            host: bracketMatch[1],
            port: Number(bracketMatch[2]) || 22
        };
    }
    if (first && !first.includes('*') && !first.includes('?') && !first.startsWith('|')) {
        return {
            host: first,
            port: 22
        };
    }
    return {
        host: first || hostPattern,
        port: 22
    };
}

function patternToRegExp(pattern) {
    const escaped = String(pattern || '')
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');
    return new RegExp(`^${escaped}$`, 'i');
}

function hashedHostMatches(pattern, target) {
    const parts = String(pattern || '').split('|');
    if (parts.length !== 4 || parts[1] !== '1') return false;
    try {
        const salt = Buffer.from(parts[2], 'base64');
        const expected = parts[3];
        const digest = crypto.createHmac('sha1', salt).update(target).digest('base64');
        return digest === expected;
    } catch (_err) {
        return false;
    }
}

function hostPatternMatches(hostPattern, host, port) {
    const normalizedHost = normalizeHost(host);
    const normalizedPort = normalizePort(port);
    const target = targetHostField(normalizedHost, normalizedPort);
    const alternatives = normalizedPort === 22 ? [normalizedHost, target] : [target];
    let matched = false;

    for (const rawPattern of String(hostPattern || '').split(',')) {
        const pattern = rawPattern.trim();
        if (!pattern) continue;
        const negated = pattern.startsWith('!');
        const value = negated ? pattern.slice(1) : pattern;
        const isMatch =
            alternatives.some(candidate => value.toLowerCase() === candidate.toLowerCase()) ||
            alternatives.some(candidate => patternToRegExp(value).test(candidate)) ||
            alternatives.some(candidate => hashedHostMatches(value, candidate));
        if (isMatch && negated) return false;
        if (isMatch) matched = true;
    }

    return matched;
}

function verifyKnownHost(options = {}, rawKey = null) {
    const host = normalizeHost(options.host);
    const port = Number(options.port) || 22;
    const info = rawKeyInfo(rawKey);

    if (!host || !info) {
        return { ok: false, msg: 'SSH 主机指纹校验失败: 服务端没有提供有效主机公钥。' };
    }

    let lines;
    try {
        lines = readKnownHostLines();
    } catch (err) {
        return { ok: false, msg: `SSH 主机指纹校验失败: 无法读取 ~/.ssh/known_hosts (${err.message})。` };
    }

    const entries = lines.map(parseKnownHostLine).filter(Boolean);
    for (const entry of entries) {
        if (!hostPatternMatches(entry.hostPattern, host, port)) continue;
        if (entry.marker === '@revoked') {
            return {
                ok: false,
                msg: `SSH 主机指纹校验失败: ${host}:${port} 的主机密钥已在 ~/.ssh/known_hosts 中标记为 revoked。`
            };
        }
        if (entry.keyType !== info.keyType) continue;
        if (entry.key === info.key) return { ok: true };
        return {
            ok: false,
            msg:
                `SSH 主机指纹校验失败: ${host}:${port} 的主机指纹已变化，已阻止连接。` +
                '请在主页面 Known Host 中删除 ~/.ssh/known_hosts 对应记录后重试。'
        };
    }

    try {
        writeKnownHostLines([...lines, `${targetHostField(host, port)} ${info.keyType} ${info.key} nexterm`]);
    } catch (err) {
        return { ok: false, msg: `SSH 主机指纹校验失败: 无法写入 ~/.ssh/known_hosts (${err.message})。` };
    }
    return { ok: true };
}

function listKnownHosts() {
    return readKnownHostLines()
        .map(parseKnownHostLine)
        .filter(Boolean)
        .map(entry => ({
            id: entry.id,
            host: entry.host,
            port: entry.port,
            hostPattern: entry.hostPattern,
            hash: entry.hash,
            fingerprint: entry.fingerprint,
            keyType: entry.keyType,
            marker: entry.marker,
            sourcePath: entry.sourcePath,
            lineNumber: entry.lineNumber
        }))
        .sort((a, b) => `${a.host}:${a.port}:${a.keyType}`.localeCompare(`${b.host}:${b.port}:${b.keyType}`));
}

function removeKnownHost(payload = {}) {
    const lines = readKnownHostLines();
    const id = String(payload.id || '').trim();
    const lineMatch = id.match(/^line-(\d+)$/);
    if (lineMatch) {
        const index = Number(lineMatch[1]);
        if (!Number.isInteger(index) || index < 0 || index >= lines.length) return false;
        lines.splice(index, 1);
        writeKnownHostLines(lines);
        return true;
    }

    const host = normalizeHost(payload.host);
    const port = normalizePort(payload.port);
    if (!host) return false;

    const nextLines = lines.filter((line, index) => {
        const entry = parseKnownHostLine(line, index);
        return !entry || !hostPatternMatches(entry.hostPattern, host, port);
    });
    if (nextLines.length === lines.length) return false;
    writeKnownHostLines(nextLines);
    return true;
}

module.exports = { knownHostsPath, listKnownHosts, removeKnownHost, verifyKnownHost };
