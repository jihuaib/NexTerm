const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const SystemApp = require('./app/systemApp');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;
let systemApp = null;

if (process.env.NEXTERM_USER_DATA_DIR) {
    app.setPath('userData', process.env.NEXTERM_USER_DATA_DIR);
}

function ensureSystemApp() {
    if (!systemApp) systemApp = new SystemApp(ipcMain);
    return systemApp;
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1180,
        height: 760,
        minWidth: 820,
        minHeight: 520,
        backgroundColor: '#1e1e1e',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false
        }
    });
    mainWindow = win;
    const winWebContents = win.webContents;

    // 中央协调器只注册一次 IPC；窗口重建时只切换事件投递目标
    ensureSystemApp().attachWebContents(winWebContents);

    if (isDev) {
        win.loadURL('http://127.0.0.1:5273');
        if (!process.env.NEXTERM_DISABLE_DEVTOOLS) {
            winWebContents.openDevTools({ mode: 'detach' });
        }
    } else {
        win.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    win.on('closed', () => {
        if (systemApp) systemApp.detachWebContents(winWebContents);
        if (mainWindow === win) mainWindow = null;
    });
}

app.whenReady().then(() => {
    ensureSystemApp();
    createWindow();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
    if (systemApp) systemApp.cleanup();
});
