const fs = require('fs');
const path = require('path');
const { ensureUserDataDir } = require('./appPaths');

function knownHostsPath() {
    return path.join(ensureUserDataDir('data'), 'known_hosts.json');
}

function readKnownHosts() {
    try {
        const raw = fs.readFileSync(knownHostsPath(), 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
        if (err.code === 'ENOENT') return {};
        throw err;
    }
}

function writeKnownHosts(data) {
    const filePath = knownHostsPath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function hostKey(host, port) {
    return `${String(host || '')
        .trim()
        .toLowerCase()}:${Number(port) || 22}`;
}

function verifyKnownHost(options = {}, fingerprint = '') {
    const host = String(options.host || '').trim();
    const port = Number(options.port) || 22;
    const key = hostKey(host, port);
    const now = new Date().toISOString();
    const normalizedFingerprint = String(fingerprint || '').trim();

    if (!host || !normalizedFingerprint) {
        return { ok: false, msg: 'SSH 主机指纹校验失败: 服务端没有提供有效主机指纹。' };
    }

    let data;
    try {
        data = readKnownHosts();
    } catch (err) {
        return { ok: false, msg: `SSH 主机指纹校验失败: 无法读取 known_hosts (${err.message})。` };
    }

    const hosts = data.hosts && typeof data.hosts === 'object' ? data.hosts : {};
    const existing = hosts[key];
    if (!existing) {
        hosts[key] = {
            host,
            port,
            hash: 'sha256',
            fingerprint: normalizedFingerprint,
            firstSeenAt: now,
            lastSeenAt: now
        };
        try {
            writeKnownHosts({ ...data, hosts });
        } catch (err) {
            return { ok: false, msg: `SSH 主机指纹校验失败: 无法写入 known_hosts (${err.message})。` };
        }
        return { ok: true };
    }

    if (existing.fingerprint !== normalizedFingerprint) {
        return {
            ok: false,
            msg:
                `SSH 主机指纹校验失败: ${host}:${port} 的主机指纹已变化，已阻止连接。` +
                '如果确认服务器已重装或更换密钥，请删除 userData/data/known_hosts.json 中对应记录后重试。'
        };
    }

    hosts[key] = { ...existing, lastSeenAt: now };
    try {
        writeKnownHosts({ ...data, hosts });
    } catch (_err) {
        /* lastSeenAt 写入失败不影响已验证的连接 */
    }
    return { ok: true };
}

module.exports = { verifyKnownHost };
