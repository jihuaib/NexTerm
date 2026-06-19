const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { parseVersion } = require('electron-updater/out/providers/Provider');
const { successResponse, errorResponse } = require('../utils/responseUtils');

const SETTINGS_KEY = 'settings';
const UPDATE_DEFAULTS = {
    updateAutoCheckOnStartup: true,
    updateAutoDownload: false
};

function sanitizeUpdateInfo(info = {}) {
    return {
        version: info.version || '',
        releaseDate: info.releaseDate || '',
        releaseName: info.releaseName || '',
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : ''
    };
}

function sanitizeProgress(progress = {}) {
    return {
        bytesPerSecond: Number(progress.bytesPerSecond) || 0,
        percent: Number(progress.percent) || 0,
        transferred: Number(progress.transferred) || 0,
        total: Number(progress.total) || 0
    };
}

function normalizeError(err) {
    const message = err?.message || String(err || '未知错误');
    const missingFeed =
        (message.includes('latest-mac.yml') || message.includes('latest.yml')) && message.includes('404');
    return missingFeed ? '服务端暂无当前平台的更新包' : message;
}

class UpdaterApp {
    constructor(ipcMain, dispatcher, store) {
        this.ipcMain = ipcMain;
        this.dispatcher = dispatcher;
        this.store = store;
        this.isDev = !app.isPackaged;
        this.updateDownloaded = false;
        this.updateAvailable = false;
        this.startupTimer = null;
        this.hasDevUpdateConfig = false;
        this.listeners = [];
        this.updateSettingsConfig = { ...UPDATE_DEFAULTS };

        this.setupAutoUpdater();
        this.registerHandlers();
        this.setupUpdateEvents();
        this.updateSettings(this.getStoredSettings(), { scheduleStartup: true });
    }

    registerHandlers() {
        this.ipcMain.handle('updater:checkForUpdates', this.checkForUpdates.bind(this));
        this.ipcMain.handle('updater:downloadUpdate', this.downloadUpdate.bind(this));
        this.ipcMain.handle('updater:quitAndInstall', this.quitAndInstall.bind(this));
        this.ipcMain.handle('updater:getCurrentVersion', this.getCurrentVersion.bind(this));
    }

    setupAutoUpdater() {
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;

        if (this.isDev) {
            const devConfigPath = path.join(__dirname, '../dev-app-update.yml');
            this.hasDevUpdateConfig = fs.existsSync(devConfigPath);
            autoUpdater.allowDowngrade = true;

            if (this.hasDevUpdateConfig) {
                autoUpdater.forceDevUpdateConfig = true;
                autoUpdater.updateConfigPath = devConfigPath;
            }

            try {
                const packageJsonPath = path.join(__dirname, '../../package.json');
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                autoUpdater.currentVersion = parseVersion(packageJson.version);
            } catch (_err) {
                /* packaged apps use Electron's app version */
            }
        } else {
            autoUpdater.allowDowngrade = false;
        }
    }

    setupUpdateEvents() {
        this.onUpdater('checking-for-update', () => {
            this.sendStatus('checking-for-update');
        });
        this.onUpdater('update-available', info => {
            this.updateAvailable = true;
            this.updateDownloaded = false;
            this.sendStatus('update-available', sanitizeUpdateInfo(info));
            if (this.updateSettingsConfig.updateAutoDownload) this.sendStatus('download-started');
        });
        this.onUpdater('update-not-available', info => {
            this.updateAvailable = false;
            this.updateDownloaded = false;
            this.sendStatus('update-not-available', sanitizeUpdateInfo(info));
        });
        this.onUpdater('download-progress', progress => {
            this.sendStatus('download-progress', sanitizeProgress(progress));
        });
        this.onUpdater('update-downloaded', info => {
            this.updateDownloaded = true;
            this.sendStatus('update-downloaded', sanitizeUpdateInfo(info));
        });
        this.onUpdater('error', err => {
            this.sendStatus('update-error', { error: normalizeError(err) });
        });
    }

    onUpdater(type, handler) {
        autoUpdater.on(type, handler);
        this.listeners.push({ type, handler });
    }

    getStoredSettings() {
        return {
            ...UPDATE_DEFAULTS,
            ...(this.store?.get(SETTINGS_KEY, {}) || {})
        };
    }

    updateSettings(settings = {}, options = {}) {
        this.updateSettingsConfig = {
            updateAutoCheckOnStartup: settings.updateAutoCheckOnStartup !== false,
            updateAutoDownload: Boolean(settings.updateAutoDownload)
        };
        autoUpdater.autoDownload = this.updateSettingsConfig.updateAutoDownload;
        autoUpdater.autoInstallOnAppQuit = true;

        if (options.scheduleStartup && this.updateSettingsConfig.updateAutoCheckOnStartup) {
            this.scheduleStartupCheck();
        }
    }

    scheduleStartupCheck() {
        if (this.startupTimer || !this.canUseUpdater({ quiet: true }).ok) return;
        this.startupTimer = setTimeout(() => {
            this.startupTimer = null;
            this.checkForUpdates(null, { quiet: true });
        }, 3000);
    }

    canUseUpdater() {
        if (process.env.NEXTERM_E2E) {
            return { ok: false, reason: 'E2E 环境跳过更新检查' };
        }
        if (this.isDev && !this.hasDevUpdateConfig) {
            return { ok: false, reason: '开发环境未配置 dev-app-update.yml，跳过更新检查' };
        }
        return { ok: true, reason: '' };
    }

    sendStatus(type, data = {}) {
        this.dispatcher.emit('updater:update-status', { type, data });
    }

    async checkForUpdates(_event = null, options = {}) {
        const availability = this.canUseUpdater();
        if (!availability.ok) {
            if (!options.quiet) this.sendStatus('update-error', { error: availability.reason });
            return errorResponse(availability.reason);
        }

        try {
            const result = await autoUpdater.checkForUpdates();
            return successResponse(
                { updateInfo: result?.updateInfo ? sanitizeUpdateInfo(result.updateInfo) : null },
                '更新检查完成'
            );
        } catch (err) {
            const message = normalizeError(err);
            if (!options.quiet) this.sendStatus('update-error', { error: message });
            return errorResponse('检查更新失败: ' + message);
        }
    }

    async downloadUpdate() {
        const availability = this.canUseUpdater();
        if (!availability.ok) return errorResponse(availability.reason);
        if (!this.updateAvailable) return errorResponse('没有可下载的更新');

        try {
            this.sendStatus('download-started');
            await autoUpdater.downloadUpdate();
            return successResponse(null, '更新下载已开始');
        } catch (err) {
            const message = normalizeError(err);
            this.sendStatus('update-error', { error: message });
            return errorResponse('下载更新失败: ' + message);
        }
    }

    quitAndInstall() {
        const availability = this.canUseUpdater();
        if (!availability.ok) return errorResponse(availability.reason);
        if (!this.updateDownloaded) return errorResponse('没有已下载的更新');

        if (this.isDev && process.platform === 'darwin') {
            return successResponse(null, '开发环境无法执行自动安装，请使用打包应用验证');
        }

        autoUpdater.quitAndInstall();
        return successResponse(null, '正在重启并安装更新');
    }

    getCurrentVersion() {
        return successResponse(app.getVersion(), '获取版本成功');
    }

    cleanup() {
        if (this.startupTimer) {
            clearTimeout(this.startupTimer);
            this.startupTimer = null;
        }
        this.listeners.forEach(({ type, handler }) => autoUpdater.removeListener(type, handler));
        this.listeners = [];
    }
}

module.exports = UpdaterApp;
