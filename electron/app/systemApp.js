const Store = require('electron-store');
const EventDispatcher = require('../utils/eventDispatcher');
const SessionApp = require('./sessionApp');
const SettingsApp = require('./settingsApp');
const ScriptApp = require('./scriptApp');
const CommandSetApp = require('./commandSetApp');
const SftpApp = require('./sftpApp');
const TelnetApp = require('./telnetApp');
const UpdaterApp = require('./updaterApp');
const CredentialStore = require('../utils/credentialStore');
const LicenseApp = require('./licenseApp');

/**
 * 中央协调器：创建共享 store / 事件分发器，实例化并注册各功能模块
 */
class SystemApp {
    constructor(ipcMain) {
        this.store = new Store({ name: 'NexTerm Data' });

        this.dispatcher = new EventDispatcher();
        this.credentialStore = new CredentialStore();

        this.sessionApp = new SessionApp(ipcMain, this.credentialStore);
        this.scriptApp = new ScriptApp(ipcMain);
        this.commandSetApp = new CommandSetApp(ipcMain);
        this.licenseApp = new LicenseApp(ipcMain);
        this.updaterApp = new UpdaterApp(ipcMain, this.dispatcher, this.store);
        this.settingsApp = new SettingsApp(ipcMain, this.store, settings => this.updaterApp.updateSettings(settings));
        this.telnetApp = new TelnetApp(ipcMain, this.dispatcher, this.store, this.credentialStore);
        this.sftpApp = new SftpApp(ipcMain, this.telnetApp.sshManager, this.dispatcher);
    }

    attachWebContents(webContents) {
        this.dispatcher.setWebContents(webContents);
    }

    detachWebContents(webContents) {
        if (!webContents || this.dispatcher.webContents !== webContents) return;
        this.dispatcher.setWebContents(null);
    }

    cleanup() {
        this.updaterApp.cleanup();
        this.telnetApp.cleanup();
        this.dispatcher.cleanup();
    }
}

module.exports = SystemApp;
