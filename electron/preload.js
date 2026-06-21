const { contextBridge, ipcRenderer, clipboard } = require('electron');

// 会话管理（持久化的会话定义）
contextBridge.exposeInMainWorld('sessionApi', {
    list: () => ipcRenderer.invoke('session:list'),
    save: def => ipcRenderer.invoke('session:save', def),
    remove: id => ipcRenderer.invoke('session:remove', id),
    folderList: () => ipcRenderer.invoke('session:folder:list'),
    folderSave: folder => ipcRenderer.invoke('session:folder:save', folder),
    folderRemove: id => ipcRenderer.invoke('session:folder:remove', id),
    moveToFolder: (sessionId, folderId) => ipcRenderer.invoke('session:move-folder', { sessionId, folderId })
});

contextBridge.exposeInMainWorld('scriptApi', {
    list: () => ipcRenderer.invoke('script:list'),
    save: script => ipcRenderer.invoke('script:save', script),
    remove: id => ipcRenderer.invoke('script:remove', id),
    importScripts: () => ipcRenderer.invoke('script:import'),
    exportScripts: ids => ipcRenderer.invoke('script:export', { ids })
});

// 终端 / 连接
contextBridge.exposeInMainWorld('terminalApi', {
    connect: options => ipcRenderer.invoke('terminal:connect', options),
    disconnect: sessionId => ipcRenderer.invoke('terminal:disconnect', sessionId),
    listSerialPorts: () => ipcRenderer.invoke('terminal:serial-ports'),
    runScript: payload => ipcRenderer.invoke('terminal:script-run', payload),
    stopScript: payload => ipcRenderer.invoke('terminal:script-stop', payload),
    pauseScript: payload => ipcRenderer.invoke('terminal:script-pause', payload),
    resumeScript: payload => ipcRenderer.invoke('terminal:script-resume', payload),
    // 键盘输入用 send，fire-and-forget，避免每键一次 Promise 往返
    sendInput: (sessionId, data) => ipcRenderer.send('terminal:input', { sessionId, data }),
    resize: (sessionId, cols, rows) => ipcRenderer.send('terminal:resize', { sessionId, cols, rows }),

    // 统一事件订阅（terminal:data / terminal:status），由渲染进程 EventBus 分发
    onEvent: callback => {
        const subscription = (_event, payload) => callback(payload);
        ipcRenderer.on('unified-event', subscription);
        return () => ipcRenderer.removeListener('unified-event', subscription);
    }
});

contextBridge.exposeInMainWorld('sftpApi', {
    list: payload => ipcRenderer.invoke('sftp:list', payload),
    cwd: payload => ipcRenderer.invoke('sftp:cwd', payload),
    download: payload => ipcRenderer.invoke('sftp:download', payload),
    upload: payload => ipcRenderer.invoke('sftp:upload', payload),
    mkdir: payload => ipcRenderer.invoke('sftp:mkdir', payload),
    remove: payload => ipcRenderer.invoke('sftp:remove', payload),
    rename: payload => ipcRenderer.invoke('sftp:rename', payload),
    getDroppedFilePaths: files =>
        Array.from(files || [])
            .map(file => file.path)
            .filter(Boolean)
});

contextBridge.exposeInMainWorld('portForwardApi', {
    list: () => ipcRenderer.invoke('port-forward:list'),
    start: payload => ipcRenderer.invoke('port-forward:start', payload),
    stop: payload => ipcRenderer.invoke('port-forward:stop', payload)
});

contextBridge.exposeInMainWorld('updaterApi', {
    checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
    downloadUpdate: () => ipcRenderer.invoke('updater:downloadUpdate'),
    quitAndInstall: () => ipcRenderer.invoke('updater:quitAndInstall'),
    getCurrentVersion: () => ipcRenderer.invoke('updater:getCurrentVersion')
});

contextBridge.exposeInMainWorld('knownHostsApi', {
    list: () => ipcRenderer.invoke('known-hosts:list'),
    remove: payload => ipcRenderer.invoke('known-hosts:remove', payload)
});

contextBridge.exposeInMainWorld('keychainApi', {
    list: () => ipcRenderer.invoke('keychain:list'),
    remove: payload => ipcRenderer.invoke('keychain:remove', payload)
});

contextBridge.exposeInMainWorld('clipboardApi', {
    readText: () => clipboard.readText(),
    writeText: text => clipboard.writeText(String(text || ''))
});

// 设置（主题、字号）
contextBridge.exposeInMainWorld('settingsApi', {
    get: () => ipcRenderer.invoke('settings:get'),
    save: settings => ipcRenderer.invoke('settings:save', settings),
    selectLogDirectory: () => ipcRenderer.invoke('settings:select-log-directory')
});
