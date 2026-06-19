const { test, expect, _electron: electron } = require('@playwright/test');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { startTestSshServer } = require('./helpers/sshServer.cjs');

const ROOT = path.resolve(__dirname, '..');

function localShellPath() {
    if (process.platform === 'win32') return process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe';
    return '/bin/sh';
}

async function pathExists(target) {
    try {
        await fs.access(target);
        return true;
    } catch (_err) {
        return false;
    }
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

    await Promise.race([
        electronApp.close().catch(() => {}),
        new Promise(resolve => setTimeout(resolve, 1000))
    ]);
}

test.beforeEach(async ({}, testInfo) => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexterm-e2e-user-data-'));
    const shellCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nexterm-e2e-shell-'));
    const electronApp = await electron.launch({
        args: ['.'],
        cwd: ROOT,
        env: {
            ...process.env,
            NODE_ENV: 'test',
            NEXTERM_E2E: '1',
            NEXTERM_DISABLE_DEVTOOLS: '1',
            NEXTERM_USER_DATA_DIR: userDataDir
        }
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByText('NexTerm')).toBeVisible();

    testInfo.e2e = { electronApp, page, userDataDir, shellCwd, consoleErrors: [], cleanups: [] };

    page.on('console', msg => {
        if (msg.type() === 'error') testInfo.e2e.consoleErrors.push(msg.text());
    });
    page.on('pageerror', err => testInfo.e2e.consoleErrors.push(err.message));
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

test('settings are grouped and persisted through the UI', async ({}, testInfo) => {
    const { page, userDataDir, electronApp } = testInfo.e2e;

    expect(await electronApp.evaluate(({ app }) => app.getPath('userData'))).toBe(userDataDir);

    await openSettings(page);

    for (const category of ['外观', '终端', '快捷键', '连接', '文件', '日志', '关于']) {
        await expect(settingsCategory(page, category)).toBeVisible();
    }

    await chooseSettingsCategory(page, '外观');
    await expect(settingsHeading(page, '主题')).toBeVisible();
    await expect(settingsHeading(page, '字体')).toBeVisible();
    await expect(settingsHeading(page, '布局')).toBeVisible();
    await page.getByRole('button', { name: '浅色' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await fillRowInput(page, '会话侧栏宽度', '320');

    await chooseSettingsCategory(page, '终端');
    await expect(settingsHeading(page, '显示')).toBeVisible();
    await toggleRow(page, '光标闪烁');
    await selectRowValue(page, '光标样式', 'underline');
    await fillRowInput(page, '回滚行数', '1200');

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
    await expect(settingsHeading(page, '重连')).toBeVisible();
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

    await chooseSettingsCategory(page, '关于');
    await expect(page.getByText('SSH、Telnet、Local Shell、SFTP 文件面板与终端日志')).toBeVisible();

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
});

test('session tree, local shell tab, split pane, and file panel work from the UI', async ({}, testInfo) => {
    const { page, userDataDir, shellCwd } = testInfo.e2e;

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

    await page.locator('.resource-row', { hasText: 'E2E Local' }).dblclick();
    await expect(page.locator('.tab', { hasText: 'E2E Local' })).toBeVisible();
    await expect(page.locator('.tab', { hasText: 'E2E Local' }).locator('.dot.connected')).toBeVisible({ timeout: 15_000 });

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

    await testInfo.e2e.electronApp.evaluate(({ clipboard }) => clipboard.writeText('echo __NEXTERM_RIGHT_CLICK_PASTE__\r'));
    await page.locator('.xterm').click({ button: 'right' });
    await expect(page.locator('.xterm')).toContainText('__NEXTERM_RIGHT_CLICK_PASTE__', { timeout: 10_000 });

    await page.locator('.xterm').click({ button: 'right', modifiers: ['Shift'] });
    await expect(page.locator('.context-menu').getByRole('button', { name: '复制' })).toBeDisabled();
    await page.keyboard.press('Escape');

    const sidebarBefore = await page.locator('.sidebar').boundingBox();
    await dragElementBy(page, page.locator('.sidebar-resizer'), 58, 0);
    await expect.poll(async () => (await page.locator('.sidebar').boundingBox()).width).toBeGreaterThan(sidebarBefore.width + 30);

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

    const sessionDataPath = path.join(userDataDir, 'data', 'sessions.json');
    expect(await pathExists(sessionDataPath)).toBe(true);
    const saved = JSON.parse(await fs.readFile(sessionDataPath, 'utf8'));
    expect(saved.sessions).toEqual([]);
    expect(saved.sessionFolders).toEqual([]);
});

test('ssh session connects and sftp directory renders from the UI', async ({}, testInfo) => {
    const { page, userDataDir } = testInfo.e2e;
    const server = await startTestSshServer();
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
    await sessionDialog.locator('input[type="password"]').fill(server.password);
    await sessionDialog.getByRole('button', { name: '保存' }).click();
    await expect(page.locator('.resource-row', { hasText: 'E2E SSH' })).toBeVisible();

    await page.locator('.resource-row', { hasText: 'E2E SSH' }).dblclick();
    await expect(page.locator('.tab', { hasText: 'E2E SSH' }).locator('.dot.connected')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.xterm')).toContainText('mock ssh ready', { timeout: 10_000 });

    const knownHostsPath = path.join(userDataDir, 'data', 'known_hosts.json');
    await expect.poll(() => pathExists(knownHostsPath)).toBe(true);
    const knownHosts = JSON.parse(await fs.readFile(knownHostsPath, 'utf8'));
    expect(Object.keys(knownHosts.hosts || {})).toContain(`${server.host}:${server.port}`);

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
