#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRODUCT_ID = 'nexterm';
const LICENSE_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_KEY_DIR = 'license-keys';
const DEFAULT_PRIVATE_KEY_NAME = 'nexterm-license-private.pem';
const DEFAULT_PUBLIC_KEY_NAME = 'nexterm-license-public.pem';
const INSTALLED_PUBLIC_KEY_PATH = path.resolve(__dirname, '../electron/assets/license-public.pem');

const BOOLEAN_FLAGS = new Set(['force', 'help', 'install-public-key', 'permanent']);

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

function printHelp() {
    console.log(`
NexTerm License Tool

Usage:
  node scripts/license-tool.js keygen [options]
  node scripts/license-tool.js sign [request.json] --private-key <private.pem> [options]
  node scripts/license-tool.js verify <license.json> --public-key <public.pem>

Commands:
  keygen    生成 Ed25519 授权密钥对
  sign      根据激活请求或机器码签发 license.json
  verify    校验 license.json 签名和基础字段

Keygen options:
  --out <dir>              密钥输出目录，默认 license-keys
  --private-key <path>     私钥输出路径
  --public-key <path>      公钥输出路径
  --install-public-key     同时写入 electron/assets/license-public.pem
  --force                  允许覆盖已有文件

Sign options:
  --private-key <path>     授权私钥 PEM 文件
  --out <path>             license.json 输出路径；不传则输出到 stdout
  --machine-id <id|*>      不使用请求文件时指定机器码，* 表示不绑定机器
  --subject <name>         授权对象，默认 NexTerm User
  --license-id <id>        授权 ID，默认自动生成
  --edition <name>         授权版本，默认 Pro
  --features <list>        功能列表，逗号分隔，默认 *
  --days <number>          有效天数，默认 365
  --expires-at <iso>       指定到期时间，优先于 --days
  --permanent              永久授权，不写 expiresAt

Examples:
  npm run license:keygen -- --out license-keys --install-public-key
  npm run license:sign -- activation-request.json --private-key license-keys/nexterm-license-private.pem --subject "客户名称" --days 365 --out license.json
  npm run license:verify -- license.json --public-key license-keys/nexterm-license-public.pem
`);
}

function fail(message) {
    throw new Error(message);
}

function parseArgs(argv) {
    const [command, ...rest] = argv;
    const flags = {};
    const positionals = [];

    for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index];
        if (!arg.startsWith('--')) {
            positionals.push(arg);
            continue;
        }

        const eqIndex = arg.indexOf('=');
        const name = eqIndex > 2 ? arg.slice(2, eqIndex) : arg.slice(2);
        if (BOOLEAN_FLAGS.has(name)) {
            flags[name] = eqIndex > 2 ? arg.slice(eqIndex + 1) !== 'false' : true;
            continue;
        }

        const value = eqIndex > 2 ? arg.slice(eqIndex + 1) : rest[index + 1];
        if (!value || value.startsWith('--')) fail(`缺少参数值: --${name}`);
        flags[name] = value;
        if (eqIndex <= 2) index += 1;
    }

    return { command, flags, positionals };
}

function resolvePath(filePath) {
    return path.resolve(process.cwd(), filePath);
}

function ensureWritable(filePath, force) {
    if (!force && fs.existsSync(filePath)) fail(`文件已存在，如需覆盖请加 --force: ${filePath}`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeText(filePath, text, mode, force) {
    ensureWritable(filePath, force);
    fs.writeFileSync(filePath, text, { encoding: 'utf8', mode });
}

function readJson(filePath, label) {
    try {
        return JSON.parse(fs.readFileSync(resolvePath(filePath), 'utf8'));
    } catch (err) {
        fail(`${label} 读取失败: ${err.message}`);
    }
}

function publicKeyFingerprint(publicKey) {
    const key = publicKey?.type === 'public' ? publicKey : crypto.createPublicKey(publicKey);
    const der = key.export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(der).digest('hex');
}

function shortFingerprint(fingerprint) {
    return String(fingerprint || '').slice(0, 16) || '-';
}

function normalizeMachineId(value) {
    const machineId = String(value || '').trim();
    if (machineId === '*') return machineId;
    if (!/^[a-f0-9]{64}$/i.test(machineId)) fail('机器码必须是 64 位十六进制字符串，或使用 * 表示不绑定机器');
    return machineId.toLowerCase();
}

function parseFeatures(value) {
    if (!value) return ['*'];
    const features = String(value)
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    return features.length > 0 ? features : ['*'];
}

function parseExpiresAt(flags, issuedAt) {
    if (flags.permanent) return '';
    if (flags['expires-at']) {
        const expiresAt = new Date(flags['expires-at']);
        if (!Number.isFinite(expiresAt.getTime())) fail('--expires-at 必须是合法时间');
        return expiresAt.toISOString();
    }

    const days = flags.days ? Number(flags.days) : 365;
    if (!Number.isFinite(days) || days <= 0) fail('--days 必须是大于 0 的数字');
    return new Date(Date.parse(issuedAt) + Math.round(days * DAY_MS)).toISOString();
}

function defaultLicenseId() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `lic-${date}-${crypto.randomBytes(4).toString('hex')}`;
}

function signPayload(payload, privateKey) {
    return crypto.sign(null, Buffer.from(stableStringify(payload)), privateKey).toString('base64');
}

function licensePayload(license) {
    const { signature: _signature, ...payload } = license;
    return payload;
}

function commandKeygen({ flags }) {
    const outDir = resolvePath(flags.out || DEFAULT_KEY_DIR);
    const privateKeyPath = resolvePath(flags['private-key'] || path.join(outDir, DEFAULT_PRIVATE_KEY_NAME));
    const publicKeyPath = resolvePath(flags['public-key'] || path.join(outDir, DEFAULT_PUBLIC_KEY_NAME));
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

    writeText(privateKeyPath, privatePem, 0o600, flags.force);
    writeText(publicKeyPath, publicPem, 0o644, flags.force);
    if (flags['install-public-key']) writeText(INSTALLED_PUBLIC_KEY_PATH, publicPem, 0o644, flags.force);

    console.log(`私钥: ${privateKeyPath}`);
    console.log(`公钥: ${publicKeyPath}`);
    if (flags['install-public-key']) console.log(`客户端公钥: ${INSTALLED_PUBLIC_KEY_PATH}`);
    console.log(`公钥指纹: ${shortFingerprint(publicKeyFingerprint(publicPem))}`);
    console.log('私钥只保存在授权端，不要打进客户端或提交到仓库。');
}

function commandSign({ flags, positionals }) {
    const request = positionals[0] ? readJson(positionals[0], '激活请求') : {};
    const requestProductId = request.productId || PRODUCT_ID;
    if (requestProductId !== PRODUCT_ID) fail(`激活请求产品不匹配: ${requestProductId}`);

    const privateKeyPath = flags['private-key'] || process.env.NEXTERM_LICENSE_PRIVATE_KEY_FILE;
    if (!privateKeyPath) fail('缺少 --private-key，或设置 NEXTERM_LICENSE_PRIVATE_KEY_FILE');
    const privateKey = fs.readFileSync(resolvePath(privateKeyPath), 'utf8');
    const signingKeyFingerprint = publicKeyFingerprint(crypto.createPublicKey(privateKey));
    const issuedAt = new Date().toISOString();
    const expiresAt = parseExpiresAt(flags, issuedAt);
    const payload = {
        version: LICENSE_VERSION,
        productId: PRODUCT_ID,
        licenseId: flags['license-id'] || defaultLicenseId(),
        subject: flags.subject || request.subject || 'NexTerm User',
        edition: flags.edition || 'Pro',
        features: parseFeatures(flags.features),
        machineId: normalizeMachineId(flags['machine-id'] || request.machineId),
        signingKeyFingerprint,
        issuedAt
    };
    if (expiresAt) payload.expiresAt = expiresAt;

    const license = {
        ...payload,
        signature: signPayload(payload, privateKey)
    };
    const text = JSON.stringify(license, null, 2) + '\n';

    if (!flags.out) {
        process.stdout.write(text);
        return;
    }

    const outPath = resolvePath(flags.out);
    writeText(outPath, text, 0o644, flags.force);
    console.log(`授权文件: ${outPath}`);
    console.log(`机器码: ${license.machineId}`);
    console.log(`签发公钥: ${shortFingerprint(license.signingKeyFingerprint)}`);
    console.log(`有效期: ${license.expiresAt || '永久'}`);
}

function readPublicKey(flags) {
    if (flags['public-key']) return fs.readFileSync(resolvePath(flags['public-key']), 'utf8');
    if (process.env.NEXTERM_LICENSE_PUBLIC_KEY) return process.env.NEXTERM_LICENSE_PUBLIC_KEY;
    if (process.env.NEXTERM_LICENSE_PUBLIC_KEY_FILE) {
        return fs.readFileSync(resolvePath(process.env.NEXTERM_LICENSE_PUBLIC_KEY_FILE), 'utf8');
    }
    fail('缺少 --public-key，或设置 NEXTERM_LICENSE_PUBLIC_KEY / NEXTERM_LICENSE_PUBLIC_KEY_FILE');
}

function commandVerify({ flags, positionals }) {
    const licensePath = positionals[0];
    if (!licensePath) fail('缺少 license.json 路径');
    const license = readJson(licensePath, '授权文件');
    if (license.version !== LICENSE_VERSION) fail('授权文件版本不支持');
    if (license.productId !== PRODUCT_ID) fail(`授权产品不匹配: ${license.productId}`);
    if (!license.signature) fail('授权文件缺少签名');
    if (license.expiresAt && Date.parse(license.expiresAt) <= Date.now()) fail('授权已过期');

    const publicKey = readPublicKey(flags);
    const verifierFingerprint = publicKeyFingerprint(publicKey);
    const ok = crypto.verify(
        null,
        Buffer.from(stableStringify(licensePayload(license))),
        publicKey,
        Buffer.from(String(license.signature), 'base64')
    );
    if (!ok) {
        fail(
            `授权签名无效（验证公钥: ${shortFingerprint(verifierFingerprint)}，授权公钥: ${shortFingerprint(
                license.signingKeyFingerprint
            )}）`
        );
    }

    console.log('授权文件签名有效');
    console.log(`机器码: ${license.machineId || '-'}`);
    console.log(`验证公钥: ${shortFingerprint(verifierFingerprint)}`);
    if (license.signingKeyFingerprint) console.log(`授权公钥: ${shortFingerprint(license.signingKeyFingerprint)}`);
    console.log(`有效期: ${license.expiresAt || '永久'}`);
}

function main() {
    const parsed = parseArgs(process.argv.slice(2));
    if (!parsed.command || parsed.flags.help || parsed.command === 'help') {
        printHelp();
        return;
    }

    if (parsed.command === 'keygen') commandKeygen(parsed);
    else if (parsed.command === 'sign') commandSign(parsed);
    else if (parsed.command === 'verify') commandVerify(parsed);
    else fail(`未知命令: ${parsed.command}`);
}

try {
    main();
} catch (err) {
    console.error(err.message);
    process.exitCode = 1;
}
