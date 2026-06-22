const { test, expect, _electron: electron } = require('@playwright/test');
const { generateKeyPairSync, sign } = require('crypto');
const dgram = require('dgram');
const fs = require('fs/promises');
const net = require('net');
const os = require('os');
const path = require('path');
const { startTestSshServer } = require('./helpers/sshServer.cjs');

const ROOT = path.resolve(__dirname, '..');
const DAY_MS = 24 * 60 * 60 * 1000;

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

function signedTestLicense(privateKey, machineId) {
    const payload = {
        version: 1,
        productId: 'nexterm',
        licenseId: 'lic-e2e',
        subject: 'E2E User',
        edition: 'Pro',
        features: ['*'],
        machineId,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    };
    return {
        ...payload,
        signature: sign(null, Buffer.from(stableStringify(payload)), privateKey).toString('base64')
    };
}

function localShellPath() {
    if (process.platform === 'win32') return process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    return '/bin/sh';
}

function mockSerialPath() {
    return process.platform === 'win32' ? 'COM99' : '/dev/tty.NEXTERM-E2E';
}

async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    } catch (_err) {
        return false;
    }
}

async function writeExpiredTrial(userDataDir) {
    const now = Date.now();
    const trialStartedAt = new Date(now - 31 * DAY_MS).toISOString();
    const licensePath = path.join(userDataDir, 'data', 'license.json');
    await fs.mkdir(path.dirname(licensePath), { recursive: true });
    await fs.writeFile(
        licensePath,
        JSON.stringify(
            {
                version: 1,
                trialStartedAt,
                trialExpiresAt: new Date(now + 365 * DAY_MS).toISOString(),
                lastSeenAt: new Date(now - DAY_MS).toISOString(),
                license: null
            },
            null,
            2
        ) + '\n',
        'utf8'
    );
}

async function writeTestPrivateKey(homeDir) {
    const sshDir = path.join(homeDir, '.ssh');
    await fs.mkdir(sshDir, { recursive: true });
    const { privateKey } = generateKeyPairSync('ed25519');
    const privateKeyText = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const keyPath = path.join(sshDir, 'id_ed25519');
    await fs.writeFile(keyPath, privateKeyText, { mode: 0o600 });
    return keyPath;
}

function listenTcp(server, host = '127.0.0.1', port = 0) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
            server.off('error', reject);
            resolve(server.address().port);
        });
    });
}

async function getFreeTcpPort() {
    const server = net.createServer();
    const port = await listenTcp(server);
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function getFreeUdpPort() {
    const server = dgram.createSocket('udp4');
    const port = await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.bind(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve(server.address().port);
        });
    });
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function startEchoServer() {
    const server = net.createServer(socket => {
        socket.on('data', data => {
            socket.write(Buffer.from(`echo:${data.toString('utf8')}`));
        });
    });
    const port = await listenTcp(server);
    return {
        port,
        close: () => new Promise(resolve => server.close(resolve))
    };
}

async function startUdpEchoServer() {
    const server = dgram.createSocket('udp4');
    server.on('message', (message, rinfo) => {
        server.send(Buffer.from(`echo:${message.toString('utf8')}`), rinfo.port, rinfo.address);
    });
    const port = await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.bind(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve(server.address().port);
        });
    });
    return {
        port,
        close: () =>
            new Promise(resolve => {
                try {
                    server.close(() => resolve());
                } catch (_err) {
                    resolve();
                }
            })
    };
}

function tcpRoundTrip(port, payload) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port }, () => socket.write(payload));
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('TCP round trip timed out'));
        }, 5000);
        socket.once('data', data => {
            clearTimeout(timer);
            resolve(data.toString('utf8'));
            socket.end();
        });
        socket.once('error', err => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function udpRoundTrip(port, payload) {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        const timer = setTimeout(() => {
            socket.close();
            reject(new Error('UDP round trip timed out'));
        }, 5000);
        socket.once('message', data => {
            clearTimeout(timer);
            resolve(data.toString('utf8'));
            socket.close();
        });
        socket.once('error', err => {
            clearTimeout(timer);
            socket.close();
            reject(err);
        });
        socket.send(Buffer.from(payload), port, '127.0.0.1');
    });
}

function socks5RoundTrip(socksPort, targetPort, payload) {
    return new Promise((resolve, reject) => {
        const socket = net.connect({ host: '127.0.0.1', port: socksPort });
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error('SOCKS5 round trip timed out'));
        }, 5000);
        let stage = 'greeting';
        socket.on('connect', () => {
            socket.write(Buffer.from([0x05, 0x01, 0x00]));
        });
        socket.on('data', data => {
            if (stage === 'greeting') {
                if (data[0] !== 0x05 || data[1] !== 0x00) {
                    clearTimeout(timer);
                    reject(new Error('SOCKS5 greeting rejected'));
                    socket.destroy();
                    return;
                }
                stage = 'connect';
                const host = Buffer.from([127, 0, 0, 1]);
                const request = Buffer.alloc(10);
                request[0] = 0x05;
                request[1] = 0x01;
                request[2] = 0x00;
                request[3] = 0x01;
                host.copy(request, 4);
                request.writeUInt16BE(targetPort, 8);
                socket.write(request);
                return;
            }
            if (stage === 'connect') {
                if (data[1] !== 0x00) {
                    clearTimeout(timer);
                    reject(new Error(`SOCKS5 connect failed: ${data[1]}`));
                    socket.destroy();
                    return;
                }
                stage = 'payload';
                socket.write(payload);
                return;
            }
            clearTimeout(timer);
            resolve(data.toString('utf8'));
            socket.end();
        });
        socket.once('error', err => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

async function closeElectronApp(electronApp) {
    const childProcess = electronApp.process();
    const exitPromise = childProcess
        ? new Promise(resolve => {
              if (childProcess.exitCode !== null || childProcess.signalCode !== null) resolve();
              else childProcess.once('exit', resolve);
          })
        : Promise.resolve();

    try {
        await electronApp.evaluate(({ app }) => app.quit());
    } catch (_err) {
        /* app may already be closing */
    }

    const result = await Promise.race([
        exitPromise.then(() => 'closed'),
        new Promise(resolve => setTimeout(() => resolve('timeout'), 5000))
    ]);

    if (result === 'timeout' && childProcess && !childProcess.killed) {
        childProcess.kill('SIGKILL');
        await Promise.race([exitPromise, new Promise(resolve => setTimeout(resolve, 1000))]);
    }

    await Promise.race([electronApp.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 1000))]);
}

async function launchTestElectronApp(userDataDir, licensePublicKey) {
    const electronApp = await electron.launch({
        args: ['.'],
        cwd: ROOT,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            NEXTERM_E2E: '1',
            NEXTERM_DISABLE_DEVTOOLS: '1',
            NEXTERM_SERIAL_MOCK: '1',
            NEXTERM_SERIAL_MOCK_PORTS: JSON.stringify([mockSerialPath()]),
            NEXTERM_LICENSE_PUBLIC_KEY: licensePublicKey,
            NEXTERM_USER_DATA_DIR: userDataDir,
            HOME: userDataDir,
            USERPROFILE: userDataDir
        }
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('NexTerm')).toBeVisible();
    await expect(page.locator('.brand__mark')).toHaveAttribute('src', /icon-.*\.svg/);
    return { electronApp, page };
}

function trackPageErrors(page, ctx) {
    page.on('console', msg => {
        if (msg.type() === 'error') ctx.consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => ctx.consoleErrors.push(err.message));
}

test.beforeEach(async ({}, testInfo) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexterm-e2e-user-data-'));
    const shellCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nexterm-e2e-shell-'));
    const licenseKeys = generateKeyPairSync('ed25519');
    const licensePublicKey = licenseKeys.publicKey.export({ type: 'spki', format: 'pem' });
    const { electronApp, page } = await launchTestElectronApp(userDataDir, licensePublicKey);

    testInfo.e2e = { electronApp, page, userDataDir, shellCwd, licenseKeys, licensePublicKey, consoleErrors: [], cleanups: [] };
    trackPageErrors(page, testInfo.e2e);
});

test.afterEach(async ({}, testInfo) => {
    const ctx = testInfo.e2e;
    if (!ctx) return;
    await closeElectronApp(ctx.electronApp);
    for (const cleanup of ctx.cleanups.reverse()) await cleanup();
    expect(ctx.consoleErrors).toEqual([]);
    await fs.rm(ctx.userDataDir, { recursive: true, force: true });
    await fs.rm(ctx.shellCwd, { recursive: true, force: true });
});

function row(page, label) {
    return page.locator('.nx-row').filter({ hasText: label }).first();
}

function settingsPanel(page) {
    return page.locator('.overlay .panel').first();
}

function settingsCategory(page, name) {
    return settingsPanel(page).locator('.cats').getByRole('button', { name, exact: true });
}

function settingsHeading(page, name) {
    return settingsPanel(page).locator('.content__body').getByRole('heading', { name, exact: true });
}

async function openSettings(page) {
    await page.getByRole('button', { name: '设置' }).click();
    await expect(settingsPanel(page)).toBeVisible();
}

async function chooseSettingsCategory(page, name) {
    await settingsCategory(page, name).click();
    await expect(settingsPanel(page).locator('.cat.active').filter({ hasText: name })).toBeVisible();
}

async function fillRowInput(page, label, value) {
    const input = row(page, label).locator('input').first();
    await input.fill(String(value));
    await input.press('Tab');
}

async function selectRowValue(page, label, value) {
    await row(page, label).locator('select').first().selectOption(value);
}

async function toggleRow(page, label) {
    await row(page, label).getByRole('button').first().click();
}

async function dragElementBy(page, locator, deltaX, deltaY) {
    const box = await locator.boundingBox();
    if (!box) throw new Error('Element has no bounding box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2 + deltaY, { steps: 4 });
    await page.mouse.up();
}

test('unactivated app is blocked after the 30 day trial limit', async ({}, testInfo) => {
    const { page, userDataDir } = testInfo.e2e;

    await writeExpiredTrial(userDataDir);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('NexTerm')).toBeVisible();
    await expect(page.locator('.license-pill')).toContainText('需激活');

    const lock = page.locator('.license-lock');
    await expect(lock).toBeVisible();
    await expect(lock).toContainText('试用已到期');
    await expect(lock).toContainText('试用已到期，请导入授权文件');

    await lock.getByRole('button', { name: '打开授权设置' }).click();
    await expect(settingsPanel(page)).toBeVisible();
    await chooseSettingsCategory(page, '授权');
    await expect(settingsPanel(page).getByText('试用已到期').first()).toBeVisible();
    await expect(row(page, '机器码').locator('input')).toHaveValue(/^[a-f0-9]{64}$/);
    await expect(settingsPanel(page).locator('.license-summary__item').filter({ hasText: '试用剩余' }).locator('strong')).toHaveText(
        '0 天'
    );
});

test('machine id is persisted across app restarts', async ({}, testInfo) => {
    const ctx = testInfo.e2e;

    await openSettings(ctx.page);
    await chooseSettingsCategory(ctx.page, '授权');
    const machineId = await row(ctx.page, '机器码').locator('input').inputValue();
    expect(machineId).toMatch(/^[a-f0-9]{64}$/);
    const installData = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'data', 'install.json'), 'utf8'));
    expect(installData.machineId).toBe(machineId);

    await closeElectronApp(ctx.electronApp);
    const relaunched = await launchTestElectronApp(ctx.userDataDir, ctx.licensePublicKey);
    ctx.electronApp = relaunched.electronApp;
    ctx.page = relaunched.page;
    trackPageErrors(ctx.page, ctx);

    await openSettings(ctx.page);
    await chooseSettingsCategory(ctx.page, '授权');
    await expect(row(ctx.page, '机器码').locator('input')).toHaveValue(machineId);
    const installDataAfterRestart = JSON.parse(await fs.readFile(path.join(ctx.userDataDir, 'data', 'install.json'), 'utf8'));
    expect(installDataAfterRestart.machineId).toBe(machineId);
});

test('settings are grouped and persisted through the UI', async ({}, testInfo) => {
    const { page, userDataDir, electronApp, licenseKeys } = testInfo.e2e;

    expect(await electronApp.evaluate(({ app }) => app.getPath('userData'))).toBe(userDataDir);

    await openSettings(page);
    await page.locator('.overlay').click({ position: { x: 4, y: 4 } });
    await expect(settingsPanel(page)).toBeVisible();
    await expect(settingsPanel(page).locator('.content__body')).toHaveCSS('user-select', 'text');

    for (const category of ['外观', '终端', '快捷键', '连接', '文件', '脚本', '日志', '更新', '授权', '关于']) {
        await expect(settingsCategory(page, category)).toBeVisible();
    }

    await chooseSettingsCategory(page, '外观');
    await expect(settingsHeading(page, '主题')).toBeVisible();
    await expect(settingsHeading(page, '字体')).toBeVisible();
    await expect(settingsHeading(page, '布局')).toBeVisible();
    await settingsPanel(page).locator('.nx-swatch').filter({ hasText: '浅色' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await fillRowInput(page, '会话侧栏宽度', '320');

    await chooseSettingsCategory(page, '终端');
    await expect(settingsHeading(page, '显示')).toBeVisible();
    await toggleRow(page, '光标闪烁');
    await selectRowValue(page, '光标样式', 'underline');
    await fillRowInput(page, '回滚行数', '1200');
    await expect(settingsPanel(page).locator('.highlight-rules-head')).toContainText('条规则');
    await expect(settingsPanel(page).locator('.highlight-rule__name').first()).toHaveValue('错误');
    await expect
        .poll(() => settingsPanel(page).locator('.highlight-rule__icon[title="内置规则不可删除"]').count())
        .toBeGreaterThan(17);
    await expect(settingsPanel(page).locator('.highlight-rule__icon[title="内置规则不可删除"]').first()).toBeDisabled();

    await chooseSettingsCategory(page, '快捷键');
    await expect(settingsHeading(page, '终端')).toBeVisible();
    await expect(settingsHeading(page, '鼠标')).toBeVisible();
    await selectRowValue(page, '查找终端', 'CmdOrCtrl+Shift+F');
    await selectRowValue(page, '复制选中内容', 'Ctrl+Insert');
    await selectRowValue(page, '粘贴剪贴板', 'Shift+Insert');
    await toggleRow(page, '选中自动复制');
    await selectRowValue(page, '普通右键', 'paste');
    await selectRowValue(page, '右键菜单打开方式', 'ctrl');

    await chooseSettingsCategory(page, '连接');
    await expect(settingsHeading(page, '新建会话')).toBeVisible();
    await expect(settingsHeading(page, 'Local Shell')).toBeVisible();
    await expect(settingsHeading(page, 'Serial')).toBeVisible();
    await expect(settingsHeading(page, '重连')).toBeVisible();
    await expect(settingsHeading(page, '端口转发机制')).toBeVisible();
    await expect(settingsPanel(page).locator('.forward-flow__title').filter({ hasText: 'Direct' })).toBeVisible();
    await expect(settingsPanel(page).locator('.forward-flow__title').filter({ hasText: 'SSH Local' })).toBeVisible();
    await expect(settingsPanel(page).locator('.forward-flow__title').filter({ hasText: 'SSH Remote' })).toBeVisible();
    await expect(settingsPanel(page).locator('.forward-flow__title').filter({ hasText: 'SOCKS5' })).toBeVisible();
    await expect(settingsHeading(page, 'SSH 安全')).toBeVisible();
    await selectRowValue(page, '默认协议', 'local');
    await fillRowInput(page, '默认 Telnet 端口', '2323');
    await fillRowInput(page, '默认本地 Shell', localShellPath());
    await fillRowInput(page, '默认工作目录', testInfo.e2e.shellCwd);
    await toggleRow(page, '断线自动重连');
    await fillRowInput(page, '重连间隔', '4');
    await fillRowInput(page, '最大重连次数', '2');
    await toggleRow(page, 'known_hosts 校验');

    await chooseSettingsCategory(page, '文件');
    await expect(settingsHeading(page, '目录同步')).toBeVisible();
    await expect(settingsHeading(page, '显示')).toBeVisible();
    await toggleRow(page, '跟随控制台目录');
    await toggleRow(page, '显示隐藏文件');

    await chooseSettingsCategory(page, '日志');
    await expect(settingsHeading(page, '写入')).toBeVisible();
    await expect(settingsHeading(page, '格式')).toBeVisible();
    await expect(settingsHeading(page, '内容')).toBeVisible();
    await toggleRow(page, '缓冲区日志');
    await row(page, '日志目录').getByRole('button', { name: '选择' }).click();
    await expect(row(page, '日志目录').locator('input')).toHaveValue(path.join(userDataDir, 'logs'));
    await selectRowValue(page, '日志文件格式', '{date}/{protocol}-{host}-{id}.log');
    await selectRowValue(page, '日志行格式', '[{datetime}] [{session}] {text}');
    await toggleRow(page, '清理控制字符');

    await chooseSettingsCategory(page, '更新');
    await expect(settingsHeading(page, '版本')).toBeVisible();
    await expect(settingsHeading(page, '操作')).toBeVisible();
    await expect(settingsHeading(page, '自动更新')).toBeVisible();
    await expect(page.getByText('当前版本')).toBeVisible();
    await toggleRow(page, '自动下载更新');

    await chooseSettingsCategory(page, '授权');
    await expect(settingsHeading(page, '授权状态')).toBeVisible();
    await expect(settingsHeading(page, '离线激活')).toBeVisible();
    await expect(settingsPanel(page).getByText('试用中')).toBeVisible();
    const machineId = await row(page, '机器码').locator('input').inputValue();
    expect(machineId).toMatch(/^[a-f0-9]{64}$/);
    const installData = JSON.parse(await fs.readFile(path.join(userDataDir, 'data', 'install.json'), 'utf8'));
    expect(installData.machineId).toBe(machineId);
    const license = signedTestLicense(licenseKeys.privateKey, machineId);
    await settingsPanel(page).locator('.license-text').fill(JSON.stringify(license, null, 2));
    await settingsPanel(page).getByRole('button', { name: '导入授权' }).click();
    await expect(settingsPanel(page).getByText('已激活').first()).toBeVisible();
    await expect(page.locator('.license-pill')).toContainText('已激活');
    await settingsPanel(page).getByRole('button', { name: '移除授权' }).click();
    await expect(settingsPanel(page).getByText('试用中').first()).toBeVisible();
    await expect(page.locator('.license-pill')).toContainText('试用');
    await expect(settingsPanel(page).getByRole('button', { name: '移除授权' })).toHaveCount(0);
    const licenseDataAfterRemove = JSON.parse(await fs.readFile(path.join(userDataDir, 'data', 'license.json'), 'utf8'));
    expect(licenseDataAfterRemove.license).toBeNull();

    await chooseSettingsCategory(page, '关于');
    await expect(
        page.getByText('SSH、Telnet、Serial、Local Shell、SFTP 文件面板、TCP / UDP / SSH 端口转发与终端日志')
    ).toBeVisible();

    await settingsPanel(page).locator('.content__head .close').click();
    await expect(page.locator('.overlay')).toHaveCount(0);

    const settingsPath = path.join(userDataDir, 'NexTerm Data.json');
    expect(await pathExists(settingsPath)).toBe(true);
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    expect(settings.settings.themeId).toBe('light');
    expect(settings.settings.defaultProtocol).toBe('local');
    expect(settings.settings.terminalLogEnabled).toBe(true);
    expect(settings.settings.terminalSearchShortcut).toBe('CmdOrCtrl+Shift+F');
    expect(settings.settings.terminalCopyShortcut).toBe('Ctrl+Insert');
    expect(settings.settings.terminalPasteShortcut).toBe('Shift+Insert');
    expect(settings.settings.terminalSelectToCopy).toBe(true);
    expect(settings.settings.terminalRightClickAction).toBe('paste');
    expect(settings.settings.terminalContextMenuTrigger).toBe('ctrl');
    expect(settings.settings.updateAutoCheckOnStartup).toBe(true);
    expect(settings.settings.updateAutoDownload).toBe(true);
    expect(settings.settings.connectionAutoReconnect).toBe(false);
    expect(settings.settings.connectionReconnectDelay).toBe(4);
    expect(settings.settings.connectionReconnectMaxAttempts).toBe(2);
    expect(settings.settings.sshKnownHostsEnabled).toBe(false);
});

test('session dialog validates protocol-specific fields in place', async ({}, testInfo) => {
    const { page } = testInfo.e2e;

    await page.getByRole('button', { name: '新建会话' }).click();
    const sessionDialog = page.locator('.dialog').filter({ hasText: '新建会话' });
    await expect(sessionDialog).toBeVisible();
    await page.locator('.dialog-overlay').click({ position: { x: 4, y: 4 } });
    await expect(sessionDialog).toBeVisible();
    await expect(sessionDialog.locator('.dialog__body')).toHaveCSS('user-select', 'text');

    await sessionDialog.getByRole('button', { name: '保存' }).click();
    await expect(sessionDialog.getByLabel('主机')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: '请填写主机地址' })).toBeVisible();

    await sessionDialog.getByLabel('主机').fill('127.0.0.1');
    await expect(sessionDialog.getByLabel('主机')).toHaveAttribute('aria-invalid', 'false');

    await sessionDialog.getByRole('tab', { name: 'SSH / SFTP' }).click();
    await sessionDialog.getByRole('button', { name: '保存' }).click();
    await expect(sessionDialog.getByLabel('用户名')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: '请填写 SSH 用户名' })).toBeVisible();

    await sessionDialog.getByLabel('用户名').fill('e2e');
    await sessionDialog.getByLabel('认证').selectOption('key');
    await sessionDialog.getByRole('button', { name: '保存' }).click();
    await expect(sessionDialog.getByLabel('私钥路径')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: '请填写私钥路径' })).toBeVisible();

    await sessionDialog.getByRole('tab', { name: 'Serial' }).click();
    const serialPathInput = sessionDialog.locator('.serial-path-field input');
    await expect(sessionDialog.getByTitle('刷新串口列表')).toBeVisible();
    await expect(serialPathInput).toHaveValue(mockSerialPath());
    await serialPathInput.fill('');
    await sessionDialog.getByRole('button', { name: '保存' }).click();
    await expect(serialPathInput).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: '请选择串口设备' })).toBeVisible();
});

test('serial session connects and scripts can drive the port from the UI', async ({}, testInfo) => {
    const { page, userDataDir } = testInfo.e2e;
    const serialPath = mockSerialPath();

    await page.getByRole('button', { name: '新建会话' }).click();
    const sessionDialog = page.locator('.dialog').filter({ hasText: '新建会话' });
    await expect(sessionDialog).toBeVisible();
    await sessionDialog.getByRole('tab', { name: 'Serial' }).click();
    const serialSelect = sessionDialog.locator('.serial-path-field select');
    const serialInput = sessionDialog.locator('.serial-path-field input');
    await expect(sessionDialog.getByTitle('刷新串口列表')).toBeVisible();
    await expect(serialSelect).toContainText(serialPath);
    await serialSelect.selectOption(serialPath);
    await expect(serialInput).toHaveValue(serialPath);

    await sessionDialog.getByLabel('名称').fill('E2E Serial');
    await sessionDialog.getByLabel('波特率').fill('57600');
    await sessionDialog.getByLabel('数据位').selectOption('7');
    await sessionDialog.getByLabel('停止位').selectOption('2');
    await sessionDialog.getByLabel('校验').selectOption('even');
    await sessionDialog.getByLabel('流控').selectOption('software');
    await sessionDialog.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.resource-row', { hasText: 'E2E Serial' })).toBeVisible();

    const sessionDataPath = path.join(userDataDir, 'data', 'sessions.json');
    await expect.poll(() => pathExists(sessionDataPath)).toBe(true);
    const saved = JSON.parse(await fs.readFile(sessionDataPath, 'utf8'));
    const savedSerialSession = saved.sessions.find(session => session.name === 'E2E Serial');
    expect(savedSerialSession.protocol).toBe('serial');
    expect(savedSerialSession.serialPath).toBe(serialPath);
    expect(savedSerialSession.serialBaudRate).toBe(57600);
    expect(savedSerialSession.serialDataBits).toBe(7);
    expect(savedSerialSession.serialStopBits).toBe(2);
    expect(savedSerialSession.serialParity).toBe('even');
    expect(savedSerialSession.serialFlowControl).toBe('software');
    expect(savedSerialSession.color).toBe('violet');

    await page.locator('.resource-row', { hasText: 'E2E Serial' }).dblclick();
    await expect(page.locator('.tab', { hasText: 'E2E Serial' })).toBeVisible();
    await expect(page.locator('.tab', { hasText: 'E2E Serial' }).locator('.dot.connected')).toBeVisible({
        timeout: 15_000
    });

    await page.locator('.xterm').click();
    await page.keyboard.type('__NEXTERM_SERIAL_ECHO__');
    await expect(page.locator('.xterm')).toContainText('__NEXTERM_SERIAL_ECHO__', { timeout: 10_000 });

    await page.getByRole('button', { name: '脚本', exact: true }).click();
    await page.getByRole('button', { name: '新建脚本' }).click();
    const scriptDialog = page.locator('.dialog').filter({ hasText: '新建脚本' });
    await expect(scriptDialog).toBeVisible();
    await scriptDialog.getByLabel('名称').fill('E2E Serial Script');
    await scriptDialog.getByLabel('语言').selectOption('javascript');
    await scriptDialog
        .getByLabel('脚本', { exact: true })
        .fill(
            "await term.send('__NEXTERM_SERIAL_SCRIPT__\\n');\n" +
                "const out = await term.expect('__NEXTERM_SERIAL_SCRIPT__', 5000);\n" +
                "term.print(out.includes('__NEXTERM_SERIAL_SCRIPT__') ? '__NEXTERM_SERIAL_SCRIPT_OK__\\n' : '__NEXTERM_SERIAL_SCRIPT_MISS__\\n');"
        );
    await scriptDialog.getByRole('button', { name: '保存' }).click();
    const serialScriptRow = page.locator('.script-row').filter({ hasText: 'E2E Serial Script' });
    await expect(serialScriptRow).toBeVisible();
    await serialScriptRow.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '执行', exact: true }).click();
    const runDialog = page.locator('.dialog').filter({ hasText: '执行脚本' });
    await expect(runDialog).toBeVisible();
    await expect(runDialog.getByLabel('目标窗口')).not.toHaveValue('');
    await runDialog.getByRole('button', { name: '执行' }).click();
    await expect(page.locator('.xterm')).toContainText('__NEXTERM_SERIAL_SCRIPT_OK__', { timeout: 10_000 });
    const serialScriptTasks = page.locator('.task-item').filter({ hasText: 'E2E Serial Script' });
    await expect(serialScriptTasks).toHaveCount(1);
    await expect(serialScriptTasks.first()).toContainText('退出码 0', { timeout: 10_000 });
});

test('session tree, local shell tab, split pane, and file panel work from the UI', async ({}, testInfo) => {
    const { page, userDataDir, shellCwd } = testInfo.e2e;
    const sessionDataPath = path.join(userDataDir, 'data', 'sessions.json');
    const commandSetDataPath = path.join(userDataDir, 'data', 'command-sets.json');

    await page.getByRole('button', { name: '新建文件夹' }).click();
    const folderDialog = page.locator('.dialog').filter({ hasText: '新建文件夹' });
    await expect(folderDialog).toBeVisible();
    await folderDialog.locator('input').fill('E2E Folder');
    await folderDialog.getByRole('button', { name: '创建' }).click();
    await expect(page.locator('.resource-row', { hasText: 'E2E Folder' })).toBeVisible();

    await page.locator('.resource-row', { hasText: 'E2E Folder' }).click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '新建文件夹' }).click();
    const childFolderDialog = page.locator('.dialog').filter({ hasText: '新建文件夹' });
    await expect(childFolderDialog).toBeVisible();
    await childFolderDialog.locator('input').fill('E2E Child');
    await childFolderDialog.getByRole('button', { name: '创建' }).click();
    await expect(page.locator('.resource-row', { hasText: 'E2E Child' })).toBeVisible();

    await page.getByRole('button', { name: '新建会话' }).click();
    const sessionDialog = page.locator('.dialog').filter({ hasText: '新建会话' });
    await expect(sessionDialog).toBeVisible();
    await sessionDialog.getByRole('tab', { name: 'Local Shell' }).click();
    await sessionDialog.getByLabel('名称').fill('E2E Local');
    await sessionDialog.getByLabel('文件夹').selectOption({ label: 'E2E Folder / E2E Child' });
    await sessionDialog.getByLabel('Shell').fill(localShellPath());
    await sessionDialog.getByLabel('工作目录').fill(shellCwd);
    await sessionDialog.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.resource-row', { hasText: 'E2E Local' })).toBeVisible();
    await expect.poll(() => pathExists(sessionDataPath)).toBe(true);
    const savedWithLocal = JSON.parse(await fs.readFile(sessionDataPath, 'utf8'));
    expect(savedWithLocal.sessions.find(session => session.name === 'E2E Local').color).toBe('green');

    await page.locator('.resource-row', { hasText: 'E2E Local' }).dblclick();
    await expect(page.locator('.tab', { hasText: 'E2E Local' })).toBeVisible();
    await expect(page.locator('.tab', { hasText: 'E2E Local' })).toHaveAttribute('style', /rgba\(16, 185, 129/);
    await expect(page.locator('.tab', { hasText: 'E2E Local' }).locator('.dot.connected')).toBeVisible({
        timeout: 15_000
    });

    const commandSetCommand =
        process.platform === 'win32'
            ? 'echo __NEXTERM_COMMAND_SET__'
            : 'printf "__NEXTERM_COMMAND_SET__\\n"';
    await page.locator('.command-add').click();
    const commandSetDialog = page.locator('.dialog').filter({ hasText: '新建指令集' });
    await expect(commandSetDialog).toBeVisible();
    await commandSetDialog.getByLabel('名称').fill('E2E 指令');
    await commandSetDialog.getByLabel('命令').fill(commandSetCommand);
    await commandSetDialog.getByTitle('玫红').click();
    await commandSetDialog.getByRole('button', { name: '保存' }).click();
    const commandChip = page.locator('.command-chip', { hasText: 'E2E 指令' });
    await expect(commandChip).toBeVisible();
    await expect(commandChip).toHaveAttribute('style', /#f43f5e/);
    await expect.poll(() => pathExists(commandSetDataPath)).toBe(true);
    const savedCommandSets = JSON.parse(await fs.readFile(commandSetDataPath, 'utf8'));
    expect(savedCommandSets.commandSets.find(commandSet => commandSet.name === 'E2E 指令').color).toBe('rose');
    await commandChip.click();
    await expect(page.locator('.xterm')).toContainText('__NEXTERM_COMMAND_SET__', { timeout: 10_000 });
    await commandChip.click({ button: 'right' });
    await expect(page.locator('.context-menu').getByRole('button', { name: '编辑' })).toBeVisible();
    await page.locator('.context-menu').getByRole('button', { name: '编辑' }).click();
    const editCommandSetDialog = page.locator('.dialog').filter({ hasText: '编辑指令集' });
    await expect(editCommandSetDialog).toBeVisible();
    await editCommandSetDialog.getByLabel('名称').fill('E2E 指令编辑');
    await editCommandSetDialog.getByLabel('命令').fill(
        process.platform === 'win32' ? 'echo __NEXTERM_COMMAND_SET_EDIT__' : 'printf "__NEXTERM_COMMAND_SET_EDIT__\\n"'
    );
    await editCommandSetDialog.getByTitle('青色').click();
    await editCommandSetDialog.getByRole('button', { name: '保存' }).click();
    const editedCommandChip = page.locator('.command-chip', { hasText: 'E2E 指令编辑' });
    await expect(editedCommandChip).toBeVisible();
    await expect(editedCommandChip).toHaveAttribute('style', /#06b6d4/);
    await editedCommandChip.click({ button: 'right' });
    await expect(page.locator('.context-menu').getByRole('button', { name: '删除' })).toBeVisible();
    await page.locator('.context-menu').getByRole('button', { name: '删除' }).click();
    await expect(editedCommandChip).toHaveCount(0);
    const savedAfterDelete = JSON.parse(await fs.readFile(commandSetDataPath, 'utf8'));
    expect(savedAfterDelete.commandSets.some(commandSet => commandSet.name === 'E2E 指令编辑')).toBe(false);

    await page.locator('.xterm').click();
    await page.keyboard.type('echo __NEXTERM_E2E__');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm')).toContainText('__NEXTERM_E2E__', { timeout: 10_000 });

    await page.locator('.xterm').click({ button: 'right', modifiers: ['Shift'] });
    await page.locator('.context-menu').getByRole('button', { name: '查找' }).click();
    await expect(page.locator('.search-panel')).toBeVisible();
    await page.locator('.search-panel input').fill('__NEXTERM_E2E__');
    await expect(page.locator('.search-count')).toHaveText(/\d+\/\d+/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.search-panel')).toHaveCount(0);

    const pasteCommand =
        process.platform === 'win32'
            ? 'echo __NEXTERM_RIGHT_CLICK_PASTE__\r\n'
            : 'printf "__NEXTERM_RIGHT_CLICK_PASTE__\\n"\n';
    await testInfo.e2e.electronApp.evaluate(({ clipboard }, text) => clipboard.writeText(text), pasteCommand);
    await page.locator('.xterm').click({ button: 'right' });
    await expect(page.locator('.xterm')).toContainText('__NEXTERM_RIGHT_CLICK_PASTE__', { timeout: 10_000 });

    await page.locator('.xterm').click({ button: 'right', modifiers: ['Shift'] });
    await expect(page.locator('.context-menu').getByRole('button', { name: '复制' })).toBeDisabled();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '新建右侧标签组' }).first().click();
    await expect(page.locator('.workspace .tabs-empty').filter({ hasText: '空标签组' }).first()).toBeVisible();
    await page.getByRole('button', { name: '会话集' }).click();
    await page.locator('.resource-row', { hasText: 'E2E Local' }).dblclick();
    const localTabs = page.locator('.tab', { hasText: 'E2E Local' });
    await expect(localTabs).toHaveCount(2);
    await expect(localTabs.nth(0).locator('.tab__title')).toHaveText('1. E2E Local');
    await expect(localTabs.nth(1).locator('.tab__title')).toHaveText('2. E2E Local');
    await expect(localTabs.nth(1).locator('.dot.connected')).toBeVisible({
        timeout: 15_000
    });

    await fs.writeFile(path.join(shellCwd, 'helper.mjs'), "export const marker='__NEXTERM_SCRIPT_' + 'IMPORT__';\n");
    await page.getByRole('button', { name: '脚本', exact: true }).click();
    await page.getByRole('button', { name: '新建脚本' }).click();
    const scriptDialog = page.locator('.dialog').filter({ hasText: '新建脚本' });
    await expect(scriptDialog).toBeVisible();
    await scriptDialog.getByLabel('名称').fill('E2E Script');
    await scriptDialog.getByLabel('语言').selectOption('javascript');
    await scriptDialog
        .getByLabel('脚本', { exact: true })
        .fill(
            "import { marker } from './helper.mjs';\n" +
                'await term.send(\'printf "__NEXTERM_TERM_SEND__\\\\n"\\n\');\n' +
                "const echoed = await term.expect('__NEXTERM_TERM_SEND__', 5000);\n" +
                "term.print(echoed.includes('__NEXTERM_TERM_SEND__') ? '__NEXTERM_TERM_EXPECT_OK__\\n' : '__NEXTERM_TERM_EXPECT_MISS__\\n');\n" +
                'await term.send(\'printf "__NEXTERM_LITERAL_ESCAPED_SEND__"\\\\n\');\n' +
                "const escaped = await term.expect('__NEXTERM_LITERAL_ESCAPED_SEND__', 5000);\n" +
                "term.print(escaped.includes('__NEXTERM_LITERAL_ESCAPED_SEND__') ? '__NEXTERM_LITERAL_SEND_OK__\\n' : '__NEXTERM_LITERAL_SEND_MISS__\\n');\n" +
                'console.log(marker);'
        );
    await scriptDialog.getByRole('button', { name: '保存' }).click();
    const e2eScriptRow = page.locator('.script-row').filter({ hasText: 'E2E Script' });
    await expect(e2eScriptRow).toBeVisible();
    await e2eScriptRow.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '执行', exact: true }).click();
    const runDialog = page.locator('.dialog').filter({ hasText: '执行脚本' });
    await expect(runDialog).toBeVisible();
    const targetSelect = runDialog.getByLabel('目标窗口');
    const targetOptions = targetSelect.locator('option:not([value=""])');
    await expect(targetSelect).not.toHaveValue('');
    await expect(targetOptions).toHaveCount(2);
    await expect(targetOptions.nth(0)).toContainText('E2E Local · 窗口 1');
    await expect(targetOptions.nth(1)).toContainText('E2E Local · 窗口 2');
    const targetValues = await targetOptions.evaluateAll(options => options.map(option => option.value));
    expect(new Set(targetValues).size).toBe(2);
    await targetSelect.selectOption(targetValues[1]);
    await expect(targetSelect).toHaveValue(targetValues[1]);
    await runDialog.getByRole('button', { name: '执行' }).click();
    await expect(page.locator('.xterm').filter({ hasText: '__NEXTERM_TERM_EXPECT_OK__' })).toHaveCount(1, {
        timeout: 10_000
    });
    await expect(page.locator('.xterm').filter({ hasText: '__NEXTERM_LITERAL_SEND_OK__' })).toHaveCount(1, {
        timeout: 10_000
    });
    await expect(page.locator('.xterm').filter({ hasText: '__NEXTERM_SCRIPT_IMPORT__' })).toHaveCount(1, {
        timeout: 10_000
    });
    const e2eScriptTasks = page.locator('.task-item').filter({ hasText: 'E2E Script' });
    await expect(e2eScriptTasks).toHaveCount(1);
    await expect(e2eScriptTasks.first()).toContainText('退出码 0', {
        timeout: 10_000
    });
    await expect(page.locator('.xterm').filter({ hasText: '__nexterm_script_file' })).toHaveCount(0);
    await expect(page.locator('.xterm').filter({ hasText: 'stty -echo' })).toHaveCount(0);
    await expect(page.locator('.xterm').filter({ hasText: '[NexTerm] Script' })).toHaveCount(0);
    await e2eScriptTasks.first().getByTitle('再次执行').click();
    await expect(e2eScriptTasks).toHaveCount(1);
    await expect(e2eScriptTasks.first()).toContainText('退出码 0', { timeout: 10_000 });
    await e2eScriptTasks.first().click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '再次执行' }).click();
    await expect(e2eScriptTasks).toHaveCount(1);
    await expect(e2eScriptTasks.first()).toContainText('退出码 0', { timeout: 10_000 });
    await e2eScriptTasks.first().click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '删除任务' }).click();
    await expect(e2eScriptTasks).toHaveCount(0);
    await expect
        .poll(async () => (await fs.readdir(shellCwd)).filter(name => name.startsWith('.nexterm-script-')))
        .toEqual([]);

    await page.getByRole('button', { name: '新建脚本' }).click();
    const failingScriptDialog = page.locator('.dialog').filter({ hasText: '新建脚本' });
    await expect(failingScriptDialog).toBeVisible();
    await failingScriptDialog.getByLabel('名称').fill('E2E Failing Script');
    await failingScriptDialog.getByLabel('语言').selectOption('javascript');
    await failingScriptDialog.getByLabel('脚本', { exact: true }).fill("await term.expect('__NEXTERM_NEVER__', 120);");
    await failingScriptDialog.getByRole('button', { name: '保存' }).click();
    const failingScriptRow = page.locator('.script-row').filter({ hasText: 'E2E Failing Script' });
    await expect(failingScriptRow).toBeVisible();
    await failingScriptRow.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '执行', exact: true }).click();
    const failingRunDialog = page.locator('.dialog').filter({ hasText: '执行脚本' });
    await expect(failingRunDialog).toBeVisible();
    await failingRunDialog.getByRole('button', { name: '执行' }).click();
    const failingTask = page.locator('.task-item').filter({ hasText: 'E2E Failing Script' });
    await expect(failingTask).toContainText('失败', { timeout: 10_000 });
    await expect(failingTask).toContainText('等待回显超时');
    await expect(page.locator('.xterm').filter({ hasText: 'NexTerm 脚本错误' })).toHaveCount(0);
    await expect(page.locator('.xterm').filter({ hasText: '.nexterm-script-' })).toHaveCount(0);
    await failingTask.getByTitle('错误详情').click();
    const errorDetailDialog = page.locator('.dialog').filter({ hasText: '错误详情' });
    await expect(errorDetailDialog).toBeVisible();
    await expect(errorDetailDialog).toContainText('NexTerm 脚本错误: 等待回显超时: __NEXTERM_NEVER__');
    await expect(errorDetailDialog).toContainText('Error: 等待回显超时: __NEXTERM_NEVER__');
    await expect(errorDetailDialog).toContainText('at Interface.');
    await errorDetailDialog.locator('button.ghost', { hasText: '关闭' }).click();
    await failingTask.getByTitle('删除任务').click();
    await expect(failingTask).toHaveCount(0);

    const pythonProbeCommand =
        process.platform === 'win32'
            ? 'echo __NEXTERM_PYTHON_EXEC^_TARGET__'
            : 'printf "%s\\\\n" "__NEXTERM_PYTHON_EXEC_""TARGET__"';
    await page.getByRole('button', { name: '新建脚本' }).click();
    const pythonScriptDialog = page.locator('.dialog').filter({ hasText: '新建脚本' });
    await expect(pythonScriptDialog).toBeVisible();
    await pythonScriptDialog.getByLabel('名称').fill('E2E Python Script');
    await pythonScriptDialog.getByLabel('语言').selectOption('python');
    await pythonScriptDialog
        .getByLabel('脚本', { exact: true })
        .fill(
            `out = term.exec(${JSON.stringify(pythonProbeCommand)}, expect="__NEXTERM_PYTHON_EXEC_TARGET__", timeout=5000)\n` +
                'term.print("__NEXTERM_PYTHON_EXEC_OK__\\n" if "__NEXTERM_PYTHON_EXEC_TARGET__" in out else "__NEXTERM_PYTHON_EXEC_MISS__\\n")'
        );
    await pythonScriptDialog.getByRole('button', { name: '保存' }).click();
    const e2ePythonScriptRow = page.locator('.script-row').filter({ hasText: 'E2E Python Script' });
    await expect(e2ePythonScriptRow).toBeVisible();
    await e2ePythonScriptRow.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '执行', exact: true }).click();
    const pythonRunDialog = page.locator('.dialog').filter({ hasText: '执行脚本' });
    await expect(pythonRunDialog).toBeVisible();
    await expect(pythonRunDialog.getByLabel('目标窗口')).not.toHaveValue('');
    await pythonRunDialog.getByRole('button', { name: '执行' }).click();
    await expect(page.locator('.xterm').filter({ hasText: '__NEXTERM_PYTHON_EXEC_OK__' })).toHaveCount(1, {
        timeout: 10_000
    });
    const e2ePythonTasks = page.locator('.task-item').filter({ hasText: 'E2E Python Script' });
    await expect(e2ePythonTasks).toHaveCount(1);
    await expect(e2ePythonTasks.first()).toContainText('退出码 0', { timeout: 10_000 });
    await expect(page.locator('.xterm').filter({ hasText: 'NameError' })).toHaveCount(0);
    await expect
        .poll(async () => (await fs.readdir(shellCwd)).filter(name => name.startsWith('.nexterm-script-')))
        .toEqual([]);

    const sidebarBefore = await page.locator('.sidebar').boundingBox();
    await dragElementBy(page, page.locator('.sidebar-resizer'), 58, 0);
    await expect
        .poll(async () => (await page.locator('.sidebar').boundingBox()).width)
        .toBeGreaterThan(sidebarBefore.width + 30);

    await page.getByRole('button', { name: '新建右侧标签组' }).first().click();
    await expect(page.locator('.workspace .tabs-empty').filter({ hasText: '空标签组' }).first()).toBeVisible();

    await page.getByRole('button', { name: '文件', exact: true }).click();
    await expect(page.getByText('等待 SSH 会话')).toBeVisible();

    await page.getByRole('button', { name: '会话集' }).click();
    await page.locator('.resource-row', { hasText: 'E2E Folder' }).click({ button: 'right' });
    await page.getByRole('button', { name: '删除文件夹' }).click();
    await page.getByRole('button', { name: '删除' }).click();
    await expect(page.locator('.resource-row', { hasText: 'E2E Folder' })).toHaveCount(0);
    await expect(page.locator('.resource-row', { hasText: 'E2E Child' })).toHaveCount(0);
    await expect(page.locator('.resource-row', { hasText: 'E2E Local' })).toHaveCount(0);

    expect(await pathExists(sessionDataPath)).toBe(true);
    const saved = JSON.parse(await fs.readFile(sessionDataPath, 'utf8'));
    expect(saved.sessions).toEqual([]);
    expect(saved.sessionFolders).toEqual([]);
});

test('ssh session connects and sftp directory renders from the UI', async ({}, testInfo) => {
    const { page, userDataDir } = testInfo.e2e;
    const server = await startTestSshServer({ password: '__NEXTERM_E2E_SECRET__' });
    testInfo.e2e.cleanups.push(() => server.close());

    await page.getByRole('button', { name: '新建会话' }).click();
    const sessionDialog = page.locator('.dialog').filter({ hasText: '新建会话' });
    await expect(sessionDialog).toBeVisible();
    await sessionDialog.getByRole('tab', { name: 'SSH / SFTP' }).click();
    await sessionDialog.getByLabel('名称').fill('E2E SSH');
    await sessionDialog.getByLabel('主机').fill(server.host);
    await sessionDialog.getByLabel('端口').fill(String(server.port));
    await sessionDialog.getByLabel('用户名').fill(server.username);
    await sessionDialog.getByLabel('认证').selectOption('password');
    await sessionDialog.getByLabel('凭据处理').selectOption('persist');
    await sessionDialog.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.resource-row', { hasText: 'E2E SSH' })).toBeVisible();

    const sessionDataPath = path.join(userDataDir, 'data', 'sessions.json');
    const credentialDataPath = path.join(userDataDir, 'data', 'credentials.json');
    await expect.poll(() => pathExists(sessionDataPath)).toBe(true);
    const savedSessions = JSON.parse(await fs.readFile(sessionDataPath, 'utf8'));
    const savedSshSession = savedSessions.sessions.find(session => session.name === 'E2E SSH');
    expect(savedSshSession.password).toBeUndefined();
    expect(savedSshSession.passphrase).toBeUndefined();
    expect(savedSshSession.credentialSaveMode).toBe('persist');
    expect(savedSshSession.credentialId).toBeUndefined();
    expect(savedSshSession.passphraseCredentialId).toBeUndefined();
    expect(await pathExists(credentialDataPath)).toBe(false);
    expect(await fs.readFile(sessionDataPath, 'utf8')).not.toContain(server.password);

    await page.locator('.resource-row', { hasText: 'E2E SSH' }).dblclick();
    const authDialog = page.locator('.dialog').filter({ hasText: 'SSH 密码' });
    await expect(authDialog).toBeVisible();
    await authDialog.locator('input[type="password"]').fill(server.password);
    await authDialog.getByRole('button', { name: '连接' }).click();
    await expect(page.locator('.tab', { hasText: 'E2E SSH' }).locator('.dot.connected')).toBeVisible({
        timeout: 15_000
    });
    await expect(page.locator('.xterm')).toContainText('mock ssh ready', { timeout: 10_000 });
    await expect.poll(() => pathExists(credentialDataPath)).toBe(true);
    const savedCredentials = await fs.readFile(credentialDataPath, 'utf8');
    expect(savedCredentials).toContain('safeStorage-base64');
    expect(savedCredentials).not.toContain(server.password);
    expect(await fs.readFile(sessionDataPath, 'utf8')).not.toContain(server.password);

    await page.locator('.tab', { hasText: 'E2E SSH' }).getByTitle('关闭标签').click();
    await expect(page.locator('.tab', { hasText: 'E2E SSH' })).toHaveCount(0);
    await page.locator('.resource-row', { hasText: 'E2E SSH' }).dblclick();
    await expect(page.locator('.dialog').filter({ hasText: 'SSH 密码' })).toHaveCount(0);
    await expect(page.locator('.tab', { hasText: 'E2E SSH' }).locator('.dot.connected')).toBeVisible({
        timeout: 15_000
    });
    await expect(page.locator('.xterm')).toContainText('mock ssh ready', { timeout: 10_000 });

    const echoServer = await startEchoServer();
    testInfo.e2e.cleanups.push(() => echoServer.close());
    const udpEchoServer = await startUdpEchoServer();
    testInfo.e2e.cleanups.push(() => udpEchoServer.close());
    const directForwardPort = await getFreeTcpPort();
    const directUdpForwardPort = await getFreeUdpPort();
    const localForwardPort = await getFreeTcpPort();
    const remoteForwardPort = await getFreeTcpPort();
    const socksForwardPort = await getFreeTcpPort();

    await page.getByRole('button', { name: '转发' }).click();
    const forwardPanel = page.locator('.forward-panel');
    await expect(forwardPanel.getByLabel('SSH 会话')).toHaveCount(0);
    await forwardPanel.getByLabel('模式').selectOption('direct');
    await forwardPanel.getByLabel('名称').fill('E2E Direct Forward');
    await forwardPanel.getByLabel('监听地址').fill('127.0.0.1');
    await forwardPanel.getByLabel('监听端口').fill(String(directForwardPort));
    await forwardPanel.getByLabel('目标地址').fill('127.0.0.1');
    await forwardPanel.getByLabel('目标端口').fill(String(echoServer.port));
    await forwardPanel.locator('.forward-form').getByRole('button', { name: '启动转发' }).click();
    const directForwardRow = forwardPanel.locator('.forward-item').filter({ hasText: `127.0.0.1:${directForwardPort}` });
    await expect(directForwardRow).toContainText('运行中');
    await expect(directForwardRow).toContainText('不使用 SSH');
    await expect
        .poll(async () => {
            try {
                return await tcpRoundTrip(directForwardPort, '__NEXTERM_FORWARD_DIRECT__');
            } catch (_err) {
                return '';
            }
        })
        .toContain('echo:__NEXTERM_FORWARD_DIRECT__');

    await forwardPanel.getByLabel('模式').selectOption('direct');
    await forwardPanel.getByLabel('协议').selectOption('udp');
    await forwardPanel.getByLabel('名称').fill('E2E Direct UDP Forward');
    await forwardPanel.getByLabel('监听地址').fill('127.0.0.1');
    await forwardPanel.getByLabel('监听端口').fill(String(directUdpForwardPort));
    await forwardPanel.getByLabel('目标地址').fill('127.0.0.1');
    await forwardPanel.getByLabel('目标端口').fill(String(udpEchoServer.port));
    await forwardPanel.locator('.forward-form').getByRole('button', { name: '启动转发' }).click();
    const directUdpForwardRow = forwardPanel
        .locator('.forward-item')
        .filter({ hasText: `127.0.0.1:${directUdpForwardPort}` });
    await expect(directUdpForwardRow).toContainText('运行中');
    await expect(directUdpForwardRow).toContainText('UDP');
    await expect
        .poll(async () => {
            try {
                return await udpRoundTrip(directUdpForwardPort, '__NEXTERM_FORWARD_DIRECT_UDP__');
            } catch (_err) {
                return '';
            }
        })
        .toContain('echo:__NEXTERM_FORWARD_DIRECT_UDP__');

    await forwardPanel.getByLabel('模式').selectOption('local');
    await expect(forwardPanel.getByLabel('SSH 会话')).not.toHaveValue('');
    await forwardPanel.getByLabel('名称').fill('E2E Local Forward');
    await forwardPanel.getByLabel('监听地址').fill('127.0.0.1');
    await forwardPanel.getByLabel('监听端口').fill(String(localForwardPort));
    await forwardPanel.getByLabel('目标地址').fill('127.0.0.1');
    await forwardPanel.getByLabel('目标端口').fill(String(echoServer.port));
    await forwardPanel.locator('.forward-form').getByRole('button', { name: '启动转发' }).click();
    const localForwardRow = forwardPanel.locator('.forward-item').filter({ hasText: `127.0.0.1:${localForwardPort}` });
    await expect(localForwardRow).toContainText('运行中');
    await expect
        .poll(async () => {
            try {
                return await tcpRoundTrip(localForwardPort, '__NEXTERM_FORWARD_LOCAL__');
            } catch (_err) {
                return '';
            }
        })
        .toContain('echo:__NEXTERM_FORWARD_LOCAL__');

    await forwardPanel.getByLabel('模式').selectOption('remote');
    await forwardPanel.getByLabel('名称').fill('E2E Remote Forward');
    await forwardPanel.getByLabel('监听地址').fill('127.0.0.1');
    await forwardPanel.getByLabel('监听端口').fill(String(remoteForwardPort));
    await forwardPanel.getByLabel('目标地址').fill('127.0.0.1');
    await forwardPanel.getByLabel('目标端口').fill(String(echoServer.port));
    await forwardPanel.locator('.forward-form').getByRole('button', { name: '启动转发' }).click();
    const remoteForwardRow = forwardPanel.locator('.forward-item').filter({ hasText: `127.0.0.1:${remoteForwardPort}` });
    await expect(remoteForwardRow).toContainText('运行中');
    await expect
        .poll(async () => {
            try {
                return await tcpRoundTrip(remoteForwardPort, '__NEXTERM_FORWARD_REMOTE__');
            } catch (_err) {
                return '';
            }
        })
        .toContain('echo:__NEXTERM_FORWARD_REMOTE__');

    await forwardPanel.getByLabel('模式').selectOption('dynamic');
    await forwardPanel.getByLabel('名称').fill('E2E SOCKS Forward');
    await forwardPanel.getByLabel('监听地址').fill('127.0.0.1');
    await forwardPanel.getByLabel('监听端口').fill(String(socksForwardPort));
    await forwardPanel.locator('.forward-form').getByRole('button', { name: '启动转发' }).click();
    const socksForwardRow = forwardPanel.locator('.forward-item').filter({ hasText: `127.0.0.1:${socksForwardPort}` });
    await expect(socksForwardRow).toContainText('运行中');
    await expect
        .poll(async () => {
            try {
                return await socks5RoundTrip(socksForwardPort, echoServer.port, '__NEXTERM_FORWARD_SOCKS__');
            } catch (_err) {
                return '';
            }
        })
        .toContain('echo:__NEXTERM_FORWARD_SOCKS__');
    await directForwardRow.getByTitle('停止').click();
    await expect(directForwardRow).toContainText('已停止');
    await directUdpForwardRow.getByTitle('停止').click();
    await expect(directUdpForwardRow).toContainText('已停止');
    await localForwardRow.getByTitle('停止').click();
    await expect(localForwardRow).toContainText('已停止');
    await remoteForwardRow.getByTitle('停止').click();
    await expect(remoteForwardRow).toContainText('已停止');
    await socksForwardRow.getByTitle('停止').click();
    await expect(socksForwardRow).toContainText('已停止');

    await page.getByRole('button', { name: '会话集' }).click();

    await page.getByRole('button', { name: '脚本', exact: true }).click();
    await page.getByRole('button', { name: '新建脚本' }).click();
    const scriptDialog = page.locator('.dialog').filter({ hasText: '新建脚本' });
    await expect(scriptDialog).toBeVisible();
    await scriptDialog.getByLabel('名称').fill('E2E SSH Script');
    await scriptDialog.getByLabel('语言').selectOption('javascript');
    await scriptDialog
        .getByLabel('脚本', { exact: true })
        .fill(
            'const out = await term.exec("pwd", { expect: "$ ", timeout: 5000 });\n' +
                "term.print(out.includes('/home/e2e') ? '__NEXTERM_SSH_SCRIPT_LOCAL_RUNNER__\\n' : '__NEXTERM_SSH_SCRIPT_MISS__\\n');"
        );
    await scriptDialog.getByRole('button', { name: '保存' }).click();
    const sshScriptRow = page.locator('.script-row').filter({ hasText: 'E2E SSH Script' });
    await expect(sshScriptRow).toBeVisible();
    await sshScriptRow.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '执行', exact: true }).click();
    const runDialog = page.locator('.dialog').filter({ hasText: '执行脚本' });
    await expect(runDialog).toBeVisible();
    await expect(runDialog.getByLabel('目标窗口')).not.toHaveValue('');
    await runDialog.getByRole('button', { name: '执行' }).click();
    await expect(page.locator('.xterm')).toContainText('__NEXTERM_SSH_SCRIPT_LOCAL_RUNNER__', { timeout: 10_000 });
    await expect(page.locator('.xterm').filter({ hasText: '__nexterm_script_file' })).toHaveCount(0);
    await expect(page.locator('.xterm').filter({ hasText: '[NexTerm] Script' })).toHaveCount(0);
    const sshScriptTasks = page.locator('.task-item').filter({ hasText: 'E2E SSH Script' });
    await expect(sshScriptTasks).toHaveCount(1);
    await expect(sshScriptTasks.first()).toContainText('退出码 0', { timeout: 10_000 });

    const knownHostsPath = path.join(userDataDir, '.ssh', 'known_hosts');
    await expect.poll(() => pathExists(knownHostsPath)).toBe(true);
    const knownHosts = await fs.readFile(knownHostsPath, 'utf8');
    expect(knownHosts).toContain(`[${server.host}]:${server.port}`);
    expect(knownHosts).toContain('ssh-rsa');

    await writeTestPrivateKey(userDataDir);
    await page.getByRole('button', { name: 'Keychain', exact: true }).click();
    const keychainPanel = page.locator('.security-panel').locator('.keychain-item');
    const keychainRow = keychainPanel.filter({ hasText: 'id_ed25519' });
    await expect(keychainRow).toBeVisible();
    await keychainRow.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '查看详情' }).click();
    const keyDetailDialog = page.locator('.dialog').filter({ hasText: 'SSH Key 详情' });
    await expect(keyDetailDialog).toContainText('私钥路径');
    await expect(keyDetailDialog).toContainText(path.join(userDataDir, '.ssh', 'id_ed25519'));
    await keyDetailDialog.getByRole('button', { name: '关闭' }).last().click();
    await page.getByRole('button', { name: 'Known Host', exact: true }).click();
    const knownHostsPanel = page.locator('.security-panel');
    await expect(knownHostsPanel).toContainText(`${server.host}:${server.port}`);
    const knownHostRow = knownHostsPanel.locator('.known-host').filter({ hasText: `${server.host}:${server.port}` });
    await knownHostRow.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '查看详情' }).click();
    const knownHostDetailDialog = page.locator('.dialog').filter({ hasText: 'Known Host 详情' });
    await expect(knownHostDetailDialog).toContainText('指纹');
    await expect(knownHostDetailDialog).toContainText('来源');
    await knownHostDetailDialog.getByRole('button', { name: '关闭' }).last().click();
    await knownHostRow.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '重新信任' }).click();
    await expect(knownHostsPanel).toContainText('暂无已信任主机');
    const knownHostsAfterRemove = await fs.readFile(knownHostsPath, 'utf8');
    expect(knownHostsAfterRemove).not.toContain(`[${server.host}]:${server.port}`);

    await page.getByRole('button', { name: '文件', exact: true }).click();
    const filePanel = page.locator('.file-panel');
    await expect(filePanel.locator('select')).not.toHaveValue('');
    await expect(filePanel.locator('.file-path')).toHaveText('/home/e2e', { timeout: 15_000 });
    await expect(filePanel.locator('.resource-row').filter({ hasText: 'code' })).toBeVisible();
    await expect(filePanel.locator('.resource-row').filter({ hasText: 'readme.txt' })).toBeVisible();

    await filePanel.locator('.resource-row').filter({ hasText: 'code' }).dblclick();
    await expect(filePanel.locator('.file-path')).toHaveText('/home/e2e/code', { timeout: 10_000 });
    await expect(filePanel.locator('.resource-row').filter({ hasText: 'app.log' })).toBeVisible();

    await filePanel.getByRole('button', { name: '上级目录' }).click();
    await expect(filePanel.locator('.file-path')).toHaveText('/home/e2e', { timeout: 10_000 });

    await filePanel.locator('.resource-tree').click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '新建目录' }).click();
    const mkdirDialog = page.locator('.dialog').filter({ hasText: '新建远程目录' });
    await expect(mkdirDialog).toBeVisible();
    await mkdirDialog.locator('input').fill('e2e-dir');
    await mkdirDialog.getByRole('button', { name: '创建' }).click();
    await expect(filePanel.locator('.resource-row').filter({ hasText: 'e2e-dir' })).toBeVisible();

    await filePanel.locator('.resource-row').filter({ hasText: 'e2e-dir' }).click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '重命名' }).click();
    const renameDialog = page.locator('.dialog').filter({ hasText: '重命名远程项' });
    await expect(renameDialog).toBeVisible();
    await renameDialog.locator('input').fill('e2e-renamed');
    await renameDialog.getByRole('button', { name: '重命名' }).click();
    await expect(filePanel.locator('.resource-row').filter({ hasText: 'e2e-renamed' })).toBeVisible();
    await expect(filePanel.locator('.resource-row').filter({ hasText: 'e2e-dir' })).toHaveCount(0);

    await filePanel.locator('.resource-row').filter({ hasText: 'e2e-renamed' }).click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '删除' }).click();
    const deleteDialog = page.locator('.dialog').filter({ hasText: '删除远程项' });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog.getByRole('button', { name: '删除' }).click();
    await expect(filePanel.locator('.resource-row').filter({ hasText: 'e2e-renamed' })).toHaveCount(0);
});
