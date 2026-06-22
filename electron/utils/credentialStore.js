const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { credentialDataPath } = require('./appPaths');

const DATA_VERSION = 1;
const ENCODING = 'safeStorage-base64';
const VALID_KINDS = new Set(['password', 'passphrase']);

function nowIso() {
    return new Date().toISOString();
}

function normalizeKind(kind) {
    return VALID_KINDS.has(kind) ? kind : 'password';
}

function credentialId(profileId, kind = 'password') {
    return `session:${String(profileId || '').trim()}:${normalizeKind(kind)}`;
}

function normalizeData(data = {}) {
    return {
        version: DATA_VERSION,
        credentials: data && typeof data.credentials === 'object' && data.credentials ? data.credentials : {},
        updatedAt: data.updatedAt || nowIso()
    };
}

function readJsonFile(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
}

function writeJsonFile(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpPath, filePath);
}

class CredentialStore {
    constructor() {
        this.filePath = credentialDataPath();
    }

    encryptionAvailable() {
        return Boolean(safeStorage?.isEncryptionAvailable?.());
    }

    read() {
        return normalizeData(readJsonFile(this.filePath) || {});
    }

    write(data) {
        writeJsonFile(this.filePath, {
            ...normalizeData(data),
            updatedAt: nowIso()
        });
    }

    has(profileId, kind = 'password') {
        if (!profileId) return false;
        const data = this.read();
        const entry = data.credentials[credentialId(profileId, kind)];
        return Boolean(entry?.value && entry.encoding === ENCODING);
    }

    get(profileId, kind = 'password') {
        if (!profileId) return '';
        if (!this.encryptionAvailable()) return '';
        const data = this.read();
        const entry = data.credentials[credentialId(profileId, kind)];
        if (!entry?.value || entry.encoding !== ENCODING) return '';
        try {
            return safeStorage.decryptString(Buffer.from(entry.value, 'base64'));
        } catch (_err) {
            return '';
        }
    }

    save(profileId, kind = 'password', secret = '') {
        const normalizedKind = normalizeKind(kind);
        const value = String(secret || '');
        if (!profileId || !value) return { ok: false, msg: '凭据为空，未保存' };
        if (!this.encryptionAvailable()) {
            return { ok: false, msg: '当前系统不支持安全凭据存储，密码未保存' };
        }

        const data = this.read();
        const id = credentialId(profileId, normalizedKind);
        data.credentials[id] = {
            id,
            profileId,
            kind: normalizedKind,
            encoding: ENCODING,
            value: safeStorage.encryptString(value).toString('base64'),
            updatedAt: nowIso()
        };
        this.write(data);
        return { ok: true, id };
    }

    remove(profileId, kind = 'password') {
        if (!profileId) return false;
        const data = this.read();
        const id = credentialId(profileId, kind);
        if (!data.credentials[id]) return false;
        delete data.credentials[id];
        this.write(data);
        return true;
    }

    removeProfile(profileId) {
        if (!profileId) return 0;
        const data = this.read();
        let removed = 0;
        for (const id of Object.keys(data.credentials)) {
            if (data.credentials[id]?.profileId !== profileId) continue;
            delete data.credentials[id];
            removed += 1;
        }
        if (removed) this.write(data);
        return removed;
    }
}

CredentialStore.credentialId = credentialId;

module.exports = CredentialStore;
