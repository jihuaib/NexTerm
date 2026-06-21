const { _electron: electron, expect } = require('@playwright/test');
const { generateKeyPairSync } = require('crypto');
const dgram = require('dgram');
const fs = require('fs/promises');
const net = require('net');
const os = require('os');
const path = require('path');
const { startTestSshServer } = require('../e2e/helpers/sshServer.cjs');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT, 'docs', 'screenshots');
const VIEWPORT = { width: 1366, height: 900 };

function nowIso() {
    return new Date().toISOString();
}

function localShellPath() {
    if (process.platform === 'win32') return process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    return '/bin/sh';
}

function mockSerialPath() {
    return process.platform === 'win32' ? 'COM99' : '/dev/tty.NEXTERM-DOCS';
}

function localEchoCommand(text) {
    return `echo ${text}`;
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

async function startTcpEchoServer() {
    const server = net.createServer(socket => {
        socket.on('data', data => socket.write(Buffer.from(`echo:${data.toString('utf8')}`)));
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

async function startTelnetDemoServer() {
    const server = net.createServer(socket => {
        socket.write('NexTerm telnet demo ready\r\n> ');
        socket.on('data', data => {
            const line = data.toString('utf8').replace(/\r?\n/g, '').trim();
            if (line) socket.write(`echo:${line}\r\n> `);
        });
    });
    const port = await listenTcp(server);
    return {
        port,
        close: () => new Promise(resolve => server.close(resolve))
    };
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

async function seedDocsData({ userDataDir, shellCwd, sshServer, telnetServer }) {
    const dataDir = path.join(userDataDir, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    const timestamp = nowIso();
    await seedDocsSshKey(userDataDir);
    const sessionFolders = [
        {
            id: 'docs-folder-access',
            type: 'session-folder',
            resource: 'session',
            name: '远程接入',
            parentId: null,
            sort: 1,
            createdAt: timestamp,
            updatedAt: timestamp
        },
        {
            id: 'docs-folder-local',
            type: 'session-folder',
            resource: 'session',
            name: '本机与设备',
            parentId: null,
            sort: 2,
            createdAt: timestamp,
            updatedAt: timestamp
        }
    ];
    const sessions = [
        {
            id: 'docs-local',
            type: 'session',
            resource: 'session',
            name: 'Local Shell',
            color: 'green',
            protocol: 'local',
            shell: localShellPath(),
            cwd: shellCwd,
            folderId: 'docs-folder-local',
            createdAt: timestamp,
            updatedAt: timestamp
        },
        {
            id: 'docs-serial',
            type: 'session',
            resource: 'session',
            name: 'Serial Console',
            color: 'amber',
            protocol: 'serial',
            serialPath: mockSerialPath(),
            serialBaudRate: 115200,
            serialDataBits: 8,
            serialStopBits: 1,
            serialParity: 'none',
            serialFlowControl: 'none',
            serialDtr: true,
            serialRts: true,
            folderId: 'docs-folder-local',
            createdAt: timestamp,
            updatedAt: timestamp
        },
        {
            id: 'docs-telnet',
            type: 'session',
            resource: 'session',
            name: 'Telnet Demo',
            color: 'violet',
            protocol: 'telnet',
            host: '127.0.0.1',
            port: telnetServer.port,
            folderId: 'docs-folder-access',
            createdAt: timestamp,
            updatedAt: timestamp
        },
        {
            id: 'docs-ssh',
            type: 'session',
            resource: 'session',
            name: 'SSH + SFTP Demo',
            color: 'blue',
            protocol: 'ssh',
            host: sshServer.host,
            port: sshServer.port,
            username: sshServer.username,
            authType: 'password',
            credentialSaveMode: 'prompt',
            folderId: 'docs-folder-access',
            createdAt: timestamp,
            updatedAt: timestamp
        }
    ];
    const scripts = [
        {
            id: 'docs-script-javascript',
            name: '诊断终端回显',
            languageId: 'javascript',
            command: '',
            content:
                "await term.send('echo __NEXTERM_DOCS_SCRIPT__\\n');\n" +
                "const out = await term.expect('__NEXTERM_DOCS_SCRIPT__', 5000);\n" +
                "term.print(out.includes('__NEXTERM_DOCS_SCRIPT__') ? '脚本执行完成\\n' : '脚本未匹配\\n');",
            description: '通过 term API 向当前终端发送命令、等待输出并写回结果。',
            createdAt: timestamp,
            updatedAt: timestamp
        },
        {
            id: 'docs-script-python',
            name: 'Python 自动化样例',
            languageId: 'python',
            command: '',
            content: 'term.print("Python runner ready\\n")',
            description: '本机 Python runner 与终端桥接示例。',
            createdAt: timestamp,
            updatedAt: timestamp
        }
    ];

    await fs.writeFile(
        path.join(dataDir, 'sessions.json'),
        JSON.stringify({ version: 1, sessions, sessionFolders, updatedAt: timestamp }, null, 2) + '\n'
    );
    await fs.writeFile(path.join(dataDir, 'scripts.json'), JSON.stringify({ version: 1, scripts, updatedAt: timestamp }, null, 2) + '\n');
    await fs.writeFile(
        path.join(userDataDir, 'NexTerm Data.json'),
        JSON.stringify(
            {
                settings: {
                    themeId: 'light',
                    sidebarWidth: 278,
                    terminalLogEnabled: false,
                    sshKnownHostsEnabled: true,
                    updatedAt: timestamp
                }
            },
            null,
            2
        ) + '\n'
    );
}

async function seedDocsSshKey(userDataDir) {
    const sshDir = path.join(userDataDir, '.ssh');
    await fs.mkdir(sshDir, { recursive: true });
    const { privateKey } = generateKeyPairSync('ed25519');
    const keyPath = path.join(sshDir, 'id_ed25519');
    await fs.writeFile(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}

async function launchDocsApp({ userDataDir }) {
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
            NEXTERM_USER_DATA_DIR: userDataDir,
            HOME: userDataDir,
            USERPROFILE: userDataDir
        }
    });
    const page = await electronApp.firstWindow();
    await electronApp.evaluate(
        ({ BrowserWindow }, size) => {
            const win = BrowserWindow.getAllWindows()[0];
            win.setSize(size.width, size.height);
            win.center();
        },
        VIEWPORT
    );
    await page.setViewportSize(VIEWPORT);
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('NexTerm')).toBeVisible();
    return { electronApp, page };
}

async function capture(page, fileName) {
    const closeButtons = page.locator('.toast__close');
    for (let index = await closeButtons.count(); index > 0; index -= 1) {
        await closeButtons.first().click();
    }
    await page.waitForTimeout(250);
    const target = path.join(OUTPUT_DIR, fileName);
    await page.screenshot({ path: target });
    process.stdout.write(`captured ${path.relative(ROOT, target)}\n`);
}

async function connectLocalShell(page) {
    await page.getByRole('button', { name: '会话集' }).click();
    await page.locator('.resource-row', { hasText: 'Local Shell' }).dblclick();
    await expect(page.locator('.tab', { hasText: 'Local Shell' }).locator('.dot.connected')).toBeVisible({
        timeout: 15_000
    });
    await page.locator('.xterm').last().click();
    await page.keyboard.type(localEchoCommand('__NEXTERM_LOCAL_SHELL_READY__'));
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm').last()).toContainText('__NEXTERM_LOCAL_SHELL_READY__', { timeout: 10_000 });
}

async function connectTelnet(page) {
    await page.getByRole('button', { name: '会话集' }).click();
    await page.locator('.resource-row', { hasText: 'Telnet Demo' }).dblclick();
    await expect(page.locator('.tab', { hasText: 'Telnet Demo' }).locator('.dot.connected')).toBeVisible({
        timeout: 15_000
    });
    await expect(page.locator('.xterm').last()).toContainText('NexTerm telnet demo ready', { timeout: 10_000 });
}

async function connectSerial(page) {
    await page.getByRole('button', { name: '会话集' }).click();
    await page.locator('.resource-row', { hasText: 'Serial Console' }).dblclick();
    await expect(page.locator('.tab', { hasText: 'Serial Console' }).locator('.dot.connected')).toBeVisible({
        timeout: 15_000
    });
    await page.locator('.xterm').last().click();
    await page.keyboard.type('AT+NEXTERM');
    await page.keyboard.press('Enter');
    await expect(page.locator('.xterm').last()).toContainText('AT+NEXTERM', { timeout: 10_000 });
}

async function connectSsh(page, sshServer) {
    await page.getByRole('button', { name: '会话集' }).click();
    await page.locator('.resource-row', { hasText: 'SSH + SFTP Demo' }).dblclick();
    const authDialog = page.locator('.dialog').filter({ hasText: 'SSH 密码' });
    await expect(authDialog).toBeVisible();
    await authDialog.locator('input[type="password"]').fill(sshServer.password);
    await authDialog.getByRole('button', { name: '连接' }).click();
    await expect(page.locator('.tab', { hasText: 'SSH + SFTP Demo' }).locator('.dot.connected')).toBeVisible({
        timeout: 15_000
    });
    await expect(page.locator('.xterm').last()).toContainText('mock ssh ready', { timeout: 10_000 });
}

async function openNewSessionDialog(page) {
    await page.getByRole('button', { name: '会话集' }).click();
    await page.getByRole('button', { name: '新建会话' }).click();
    await expect(page.locator('.dialog').filter({ hasText: '新建会话' })).toBeVisible();
}

async function fillForwardForm(page, { type, transport = 'tcp', name, bindPort, targetPort }) {
    const panel = page.locator('.forward-panel');
    await panel.getByLabel('模式').selectOption(type);
    if (type === 'direct') await panel.getByLabel('协议').selectOption(transport);
    await panel.getByLabel('名称').fill(name);
    await panel.getByLabel('监听地址').fill('127.0.0.1');
    await panel.getByLabel('监听端口').fill(String(bindPort));
    if (type !== 'dynamic') {
        await panel.getByLabel('目标地址').fill('127.0.0.1');
        await panel.getByLabel('目标端口').fill(String(targetPort));
    }
    await panel.locator('.forward-form').getByRole('button', { name: '启动转发' }).click();
    await expect(panel.locator('.forward-item').filter({ hasText: name })).toContainText('运行中', {
        timeout: 10_000
    });
}

async function preparePortForwarding(page, tcpEcho, udpEcho) {
    await page.getByRole('button', { name: '转发' }).click();
    await fillForwardForm(page, {
        type: 'direct',
        transport: 'tcp',
        name: 'Direct TCP 到内部服务',
        bindPort: await getFreeTcpPort(),
        targetPort: tcpEcho.port
    });
    await fillForwardForm(page, {
        type: 'direct',
        transport: 'udp',
        name: 'Direct UDP 到日志端口',
        bindPort: await getFreeUdpPort(),
        targetPort: udpEcho.port
    });
    await fillForwardForm(page, {
        type: 'local',
        name: 'SSH Local 转发',
        bindPort: await getFreeTcpPort(),
        targetPort: tcpEcho.port
    });
    await fillForwardForm(page, {
        type: 'dynamic',
        name: 'SOCKS5 动态代理',
        bindPort: await getFreeTcpPort(),
        targetPort: tcpEcho.port
    });
}

async function prepareScriptsPanel(page) {
    await page.getByRole('button', { name: '脚本', exact: true }).click();
    const scriptRow = page.locator('.script-row').filter({ hasText: '诊断终端回显' });
    await expect(scriptRow).toBeVisible();
    await scriptRow.click({ button: 'right' });
    await page.locator('.context-menu').getByRole('button', { name: '执行', exact: true }).click();
    const runDialog = page.locator('.dialog').filter({ hasText: '执行脚本' });
    await expect(runDialog).toBeVisible();
    const targetSelect = runDialog.getByLabel('目标窗口');
    const targetOptions = targetSelect.locator('option:not([value=""])');
    const values = await targetOptions.evaluateAll(options =>
        options.map(option => ({ value: option.value, text: option.textContent || '' }))
    );
    const localTarget = values.find(option => option.text.includes('Local Shell')) || values[0];
    await targetSelect.selectOption(localTarget.value);
    await runDialog.getByRole('button', { name: '执行' }).click();
    await expect(page.locator('.task-item').filter({ hasText: '诊断终端回显' })).toContainText('退出码 0', {
        timeout: 10_000
    });
}

async function openFilesPanel(page) {
    await page.getByRole('button', { name: '文件', exact: true }).click();
    const panel = page.locator('.file-panel');
    await expect(panel.locator('select')).not.toHaveValue('');
    await expect(panel.locator('.file-path')).toHaveText('/home/e2e', { timeout: 15_000 });
    await expect(panel.locator('.resource-row').filter({ hasText: 'readme.txt' })).toBeVisible();
}

async function openKeychainPanel(page) {
    await page.getByRole('button', { name: 'Keychain', exact: true }).click();
    const panel = page.locator('.security-panel');
    await expect(panel.locator('.keychain-item').filter({ hasText: 'id_ed25519' })).toBeVisible({
        timeout: 10_000
    });
}

async function openKnownHostPanel(page, sshServer) {
    await page.getByRole('button', { name: 'Known Host', exact: true }).click();
    const panel = page.locator('.security-panel');
    await expect(panel.locator('.known-host').filter({ hasText: `${sshServer.host}:${sshServer.port}` })).toBeVisible({
        timeout: 10_000
    });
}

async function openSettingsCategory(page, category) {
    await page.getByRole('button', { name: '设置' }).click();
    const settingsPanel = page.locator('.overlay .panel').first();
    await expect(settingsPanel).toBeVisible();
    await settingsPanel.locator('.cats').getByRole('button', { name: category, exact: true }).click();
    await expect(settingsPanel.locator('.cat.active').filter({ hasText: category })).toBeVisible();
}

async function main() {
    await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexterm-docs-user-data-'));
    const shellCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nexterm-docs-shell-'));
    const sshServer = await startTestSshServer({ password: '__NEXTERM_DOCS_SECRET__' });
    const telnetServer = await startTelnetDemoServer();
    const tcpEcho = await startTcpEchoServer();
    const udpEcho = await startUdpEchoServer();
    let electronApp;

    try {
        await seedDocsData({ userDataDir, shellCwd, sshServer, telnetServer });
        const launched = await launchDocsApp({ userDataDir });
        electronApp = launched.electronApp;
        const { page } = launched;

        await connectLocalShell(page);
        await capture(page, '01-local-shell-workspace.png');

        await openNewSessionDialog(page);
        await capture(page, '02-new-session-dialog.png');
        await page.locator('.dialog').filter({ hasText: '新建会话' }).getByRole('button', { name: '取消' }).click();

        await connectTelnet(page);
        await capture(page, '03-telnet-terminal.png');

        await connectSerial(page);
        await capture(page, '04-serial-terminal.png');

        await connectSsh(page, sshServer);
        await capture(page, '05-ssh-terminal.png');

        await openFilesPanel(page);
        await capture(page, '06-sftp-file-panel.png');

        await preparePortForwarding(page, tcpEcho, udpEcho);
        await capture(page, '07-port-forwarding.png');

        await prepareScriptsPanel(page);
        await capture(page, '08-script-workbench.png');

        await openKeychainPanel(page);
        await capture(page, '09-keychain.png');

        await openKnownHostPanel(page, sshServer);
        await capture(page, '10-known-hosts.png');

        await openSettingsCategory(page, '连接');
        await page
            .locator('.overlay .panel')
            .first()
            .getByRole('heading', { name: '端口转发机制', exact: true })
            .scrollIntoViewIfNeeded();
        await capture(page, '11-settings-connection.png');
        await page.locator('.overlay .panel').first().locator('.content__head .close').click();

        await openSettingsCategory(page, '外观');
        await capture(page, '12-settings-appearance.png');
    } finally {
        if (electronApp) await closeElectronApp(electronApp);
        await Promise.allSettled([sshServer.close(), telnetServer.close(), tcpEcho.close(), udpEcho.close()]);
        await fs.rm(userDataDir, { recursive: true, force: true });
        await fs.rm(shellCwd, { recursive: true, force: true });
    }
}

main().catch(err => {
    console.error(err);
    process.exitCode = 1;
});
