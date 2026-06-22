const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');
const { installDataPath, licenseDataPath } = require('./appPaths');

const PRODUCT_ID = 'nexterm';
const LICENSE_VERSION = 1;
const TRIAL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const PUBLIC_KEY_FILE = path.join(__dirname, '../assets/license-public.pem');
const DEFAULT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAjRjpF0NNn2H6/LZFuiRJrsKjXrYUtN79rdGapk5WonE=
-----END PUBLIC KEY-----`;

function nowIso() {
    return new Date().toISOString();
}

function parseTime(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : 0;
}

function addDaysIso(value, days) {
    return new Date(parseTime(value) + days * DAY_MS).toISOString();
}

function daysRemaining(until, now = Date.now()) {
    const diff = parseTime(until) - now;
    return Math.max(0, Math.ceil(diff / DAY_MS));
}

function effectiveTrialExpiresAt(data = {}) {
    const startedAt = parseTime(data.trialStartedAt);
    const storedExpiresAt = parseTime(data.trialExpiresAt);
    if (!startedAt) {
        const fallbackExpiresAt = storedExpiresAt || Date.now() + TRIAL_DAYS * DAY_MS;
        return new Date(fallbackExpiresAt).toISOString();
    }
    const maxExpiresAt = startedAt + TRIAL_DAYS * DAY_MS;
    return new Date(storedExpiresAt ? Math.min(storedExpiresAt, maxExpiresAt) : maxExpiresAt).toISOString();
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value)
            .sort()
            .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

function readPublicKey() {
    if (process.env.NEXTERM_LICENSE_PUBLIC_KEY) return process.env.NEXTERM_LICENSE_PUBLIC_KEY;
    if (fs.existsSync(PUBLIC_KEY_FILE)) {
        const key = fs.readFileSync(PUBLIC_KEY_FILE, 'utf8').trim();
        if (key) return key;
    }
    return DEFAULT_PUBLIC_KEY;
}

function publicKeyFingerprint(publicKey) {
    try {
        const key = crypto.createPublicKey(publicKey);
        const der = key.export({ type: 'spki', format: 'der' });
        return crypto.createHash('sha256').update(der).digest('hex');
    } catch (_err) {
        return '';
    }
}

function shortFingerprint(fingerprint) {
    const value = String(fingerprint || '');
    return value ? value.slice(0, 16) : '-';
}

function shortMachineId(machineId) {
    const value = String(machineId || '');
    if (value === '*') return value;
    if (value.length <= 16) return value || '-';
    return `${value.slice(0, 12)}...${value.slice(-8)}`;
}

function isMachineId(value) {
    return /^[a-f0-9]{64}$/i.test(String(value || ''));
}

function createInstallData() {
    return {
        installId: crypto.randomUUID(),
        machineId: crypto.randomBytes(32).toString('hex'),
        createdAt: nowIso()
    };
}

function licensePayload(license = {}) {
    const { signature: _signature, ...payload } = license;
    return payload;
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

class LicenseManager {
    constructor() {
        this.filePath = licenseDataPath();
        this.installPath = installDataPath();
        this.publicKey = readPublicKey();
    }

    readInstallData() {
        const existing = readJsonFile(this.installPath);
        if (existing?.installId && isMachineId(existing.machineId)) return existing;
        const data = createInstallData();
        writeJsonFile(this.installPath, data);
        return data;
    }

    machineId() {
        const install = this.readInstallData();
        return install.machineId;
    }

    readData() {
        const install = this.readInstallData();
        const startedAt = parseTime(install.createdAt) ? install.createdAt : nowIso();
        const fallback = {
            version: 1,
            trialStartedAt: startedAt,
            trialExpiresAt: addDaysIso(startedAt, TRIAL_DAYS),
            lastSeenAt: startedAt,
            license: null
        };
        const data = readJsonFile(this.filePath);
        if (!data) {
            this.writeData(fallback);
            return fallback;
        }
        const merged = {
            ...fallback,
            ...data,
            version: 1
        };
        const installStartedAt = parseTime(startedAt);
        const trialStartedAt = parseTime(merged.trialStartedAt);
        if (!trialStartedAt || trialStartedAt > installStartedAt) merged.trialStartedAt = startedAt;
        merged.trialExpiresAt = effectiveTrialExpiresAt(merged);
        return merged;
    }

    writeData(data) {
        writeJsonFile(this.filePath, {
            ...data,
            version: 1,
            updatedAt: nowIso()
        });
    }

    activationRequest() {
        return {
            version: LICENSE_VERSION,
            productId: PRODUCT_ID,
            appVersion: app.getVersion(),
            machineId: this.machineId(),
            publicKeyFingerprint: publicKeyFingerprint(this.publicKey),
            requestId: crypto.randomUUID(),
            createdAt: nowIso()
        };
    }

    verifyLicense(license = {}) {
        if (!license || typeof license !== 'object') return { ok: false, reason: '授权文件为空' };
        if (license.version !== LICENSE_VERSION) return { ok: false, reason: '授权文件版本不支持' };
        if (license.productId !== PRODUCT_ID) return { ok: false, reason: '授权产品不匹配' };
        const currentMachineId = this.machineId();
        if (license.machineId !== currentMachineId && license.machineId !== '*') {
            return {
                ok: false,
                reason: `授权文件不属于当前机器（当前: ${shortMachineId(currentMachineId)}，授权: ${shortMachineId(license.machineId)}）`
            };
        }
        if (license.expiresAt && parseTime(license.expiresAt) <= Date.now()) {
            return { ok: false, reason: '授权已过期' };
        }
        if (!license.signature) return { ok: false, reason: '授权文件缺少签名' };

        try {
            const payload = Buffer.from(stableStringify(licensePayload(license)));
            const signature = Buffer.from(String(license.signature), 'base64');
            const ok = crypto.verify(null, payload, this.publicKey, signature);
            if (ok) return { ok: true };
            const currentFingerprint = publicKeyFingerprint(this.publicKey);
            const signingFingerprint = license.signingKeyFingerprint || '';
            if (signingFingerprint && currentFingerprint && signingFingerprint !== currentFingerprint) {
                return {
                    ok: false,
                    reason: `授权签名无效（当前公钥: ${shortFingerprint(currentFingerprint)}，授权公钥: ${shortFingerprint(signingFingerprint)}）`
                };
            }
            return {
                ok: false,
                reason: `授权签名无效（当前公钥: ${shortFingerprint(currentFingerprint)}，授权文件可能被修改或不是这组密钥签发）`
            };
        } catch (err) {
            return { ok: false, reason: `授权签名校验失败: ${err.message}` };
        }
    }

    sanitizeLicense(license = {}) {
        return {
            licenseId: license.licenseId || '',
            subject: license.subject || '',
            edition: license.edition || 'pro',
            features: Array.isArray(license.features) ? license.features : [],
            issuedAt: license.issuedAt || '',
            expiresAt: license.expiresAt || '',
            machineId: license.machineId || '',
            signingKeyFingerprint: license.signingKeyFingerprint || ''
        };
    }

    status() {
        const data = this.readData();
        const now = Date.now();
        const lastSeen = parseTime(data.lastSeenAt);
        const machineId = this.machineId();
        const trialExpiresAt = effectiveTrialExpiresAt(data);

        if (lastSeen && now + CLOCK_SKEW_MS < lastSeen) {
            return {
                status: 'time-error',
                active: false,
                machineId,
                publicKeyFingerprint: publicKeyFingerprint(this.publicKey),
                trialStartedAt: data.trialStartedAt,
                trialExpiresAt,
                daysRemaining: 0,
                msg: '检测到系统时间回拨，请恢复正确时间后重试'
            };
        }

        const nextData = { ...data, trialExpiresAt };
        if (!lastSeen || now > lastSeen) {
            nextData.lastSeenAt = new Date(now).toISOString();
        }
        if (nextData.trialExpiresAt !== data.trialExpiresAt || nextData.lastSeenAt !== data.lastSeenAt) {
            this.writeData(nextData);
        }

        const licenseCheck = data.license ? this.verifyLicense(data.license) : { ok: false, reason: '' };
        if (licenseCheck.ok) {
            return {
                status: 'active',
                active: true,
                machineId,
                publicKeyFingerprint: publicKeyFingerprint(this.publicKey),
                daysRemaining: data.license.expiresAt ? daysRemaining(data.license.expiresAt, now) : null,
                license: this.sanitizeLicense(data.license),
                msg: '已激活'
            };
        }

        const trialLeft = daysRemaining(trialExpiresAt, now);
        if (trialLeft > 0) {
            return {
                status: 'trial',
                active: true,
                machineId,
                publicKeyFingerprint: publicKeyFingerprint(this.publicKey),
                trialStartedAt: data.trialStartedAt,
                trialExpiresAt,
                daysRemaining: trialLeft,
                licenseError: licenseCheck.reason || '',
                msg: `试用剩余 ${trialLeft} 天`
            };
        }

        return {
            status: 'expired',
            active: false,
            machineId,
            publicKeyFingerprint: publicKeyFingerprint(this.publicKey),
            trialStartedAt: data.trialStartedAt,
            trialExpiresAt,
            daysRemaining: 0,
            licenseError: licenseCheck.reason || '',
            msg: '试用已到期，请导入授权文件'
        };
    }

    importLicense(license) {
        const check = this.verifyLicense(license);
        if (!check.ok) return { ok: false, msg: check.reason };
        const data = this.readData();
        this.writeData({ ...data, license });
        return { ok: true, status: this.status() };
    }

    removeLicense() {
        const data = this.readData();
        this.writeData({ ...data, license: null });
        return { ok: true, status: this.status() };
    }
}

LicenseManager.stableStringify = stableStringify;
LicenseManager.PRODUCT_ID = PRODUCT_ID;
LicenseManager.LICENSE_VERSION = LICENSE_VERSION;
LicenseManager.TRIAL_DAYS = TRIAL_DAYS;

module.exports = LicenseManager;
