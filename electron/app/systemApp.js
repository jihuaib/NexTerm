const Store = require('electron-store');
const EventDispatcher = require('../utils/eventDispatcher');
const SessionApp = require('./sessionApp');
const SettingsApp = require('./settingsApp');
const SftpApp = require('./sftpApp');
const TelnetApp = require('./telnetApp');

/**
 * 中央协调器：创建共享 store / 事件分发器，实例化并注册各功能模块
 */
class SystemApp {
    constructor(ipcMain) {
        this.store = new Store({ name: 'NexTerm Data' });

        this.dispatcher = new EventDispatcher();

        this.sessionApp = new SessionApp(ipcMain);
        this.settingsApp = new SettingsApp(ipcMain, this.store);
        this.telnetApp = new TelnetApp(ipcMain, this.dispatcher, this.store);
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
        this.telnetApp.cleanup();
        this.dispatcher.cleanup();
    }
}

module.exports = SystemApp;
