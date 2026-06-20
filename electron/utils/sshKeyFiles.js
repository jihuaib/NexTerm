const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

function sshDirPath() {
    return path.join(os.homedir(), '.ssh');
}

function normalizePath(value) {
    return path.resolve(String(value || ''));
}

function isInsideSshDir(filePath) {
    const sshDir = normalizePath(sshDirPath());
    const target = normalizePath(filePath);
    return target === sshDir || target.startsWith(`${sshDir}${path.sep}`);
}

function readHead(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(4096);
        const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
        return buffer.subarray(0, bytes).toString('utf8');
    } finally {
        fs.closeSync(fd);
    }
}

function isPrivateKeyFile(filePath, name) {
    if (name.endsWith('.pub')) return false;
    if (['known_hosts', 'authorized_keys', 'config'].includes(name)) return false;
    try {
        return /-----BEGIN (?:OPENSSH |RSA |DSA |EC |)PRIVATE KEY-----/.test(readHead(filePath));
    } catch (_err) {
        return false;
    }
}

function fingerprintFromPublicKey(publicKeyPath) {
    try {
        const line = fs.readFileSync(publicKeyPath, 'utf8').split(/\r?\n/).find(Boolean);
        const [keyType, rawKey] = String(line || '')
            .trim()
            .split(/\s+/);
        if (!keyType || !rawKey) return { keyType: '', fingerprint: '' };
        const digest = crypto
            .createHash('sha256')
            .update(Buffer.from(rawKey, 'base64'))
            .digest('base64')
            .replace(/=+$/, '');
        return { keyType, fingerprint: `SHA256:${digest}` };
    } catch (_err) {
        return { keyType: '', fingerprint: '' };
    }
}

function listSshKeys() {
    const dir = sshDirPath();
    let entries = [];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
        if (err.code === 'ENOENT') return [];
        throw err;
    }

    return entries
        .filter(entry => entry.isFile())
        .map(entry => {
            const filePath = path.join(dir, entry.name);
            if (!isPrivateKeyFile(filePath, entry.name)) return null;
            const stat = fs.statSync(filePath);
            const publicKeyPath = `${filePath}.pub`;
            const hasPublicKey = fs.existsSync(publicKeyPath);
            const publicKey = hasPublicKey ? fingerprintFromPublicKey(publicKeyPath) : { keyType: '', fingerprint: '' };
            return {
                id: filePath,
                name: entry.name,
                path: filePath,
                publicKeyPath: hasPublicKey ? publicKeyPath : '',
                keyType: publicKey.keyType,
                fingerprint: publicKey.fingerprint,
                size: stat.size,
                mode: `0${(stat.mode & 0o777).toString(8)}`,
                updatedAt: stat.mtime.toISOString()
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function removeSshKey(payload = {}) {
    const filePath = normalizePath(payload.path || payload.id);
    if (!filePath || !isInsideSshDir(filePath)) return false;
    if (!listSshKeys().some(entry => normalizePath(entry.path) === filePath)) return false;
    fs.rmSync(filePath, { force: true });
    fs.rmSync(`${filePath}.pub`, { force: true });
    return true;
}

module.exports = { listSshKeys, removeSshKey, sshDirPath };
