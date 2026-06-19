const path = require('path');
const { BrowserWindow, dialog } = require('electron');
const { successResponse, errorResponse } = require('../utils/responseUtils');
const { sftpDownloadDirectory, sftpUploadDirectory } = require('../utils/appPaths');
const { SFTP_EVT } = require('../const/telnetConst');

function basename(remotePath = '/') {
    const parts = String(remotePath).split('/').filter(Boolean);
    return parts[parts.length - 1] || 'download';
}

class SftpApp {
    constructor(ipcMain, sshManager, dispatcher = null) {
        this.sshManager = sshManager;
        this.dispatcher = dispatcher;
        ipcMain.handle('sftp:list', this.handleList.bind(this));
        ipcMain.handle('sftp:cwd', this.handleCwd.bind(this));
        ipcMain.handle('sftp:download', this.handleDownload.bind(this));
        ipcMain.handle('sftp:upload', this.handleUpload.bind(this));
        ipcMain.handle('sftp:mkdir', this.handleMkdir.bind(this));
        ipcMain.handle('sftp:remove', this.handleRemove.bind(this));
        ipcMain.handle('sftp:rename', this.handleRename.bind(this));
    }

    getWindow(event) {
        return BrowserWindow.fromWebContents(event.sender);
    }

    showOpenDialog(event, options) {
        const win = this.getWindow(event);
        return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
    }

    showSaveDialog(event, options) {
        const win = this.getWindow(event);
        return win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options);
    }

    emitProgress(payload = {}) {
        this.dispatcher?.emit?.(SFTP_EVT.PROGRESS, payload);
    }

    async handleList(_event, payload = {}) {
        try {
            if (!payload.sessionId) return errorResponse('请选择 SSH 会话');
            const result = await this.sshManager.list(payload.sessionId, payload.path || '/');
            return successResponse(result, '获取远程目录成功');
        } catch (err) {
            return errorResponse('获取远程目录失败: ' + err.message);
        }
    }

    async handleCwd(_event, payload = {}) {
        try {
            if (!payload.sessionId) return errorResponse('请选择 SSH 会话');
            const result = await this.sshManager.currentCwd(payload.sessionId);
            return successResponse(result, '获取当前目录成功');
        } catch (err) {
            return errorResponse('获取当前目录失败: ' + err.message);
        }
    }

    async handleDownload(event, payload = {}) {
        try {
            if (!payload.sessionId || !payload.remotePath) return errorResponse('下载参数不完整');
            const name = basename(payload.remotePath);
            let destinationPath = '';

            if (payload.type === 'file-folder') {
                const result = await this.showOpenDialog(event, {
                    title: '选择下载保存目录',
                    defaultPath: sftpDownloadDirectory(),
                    properties: ['openDirectory', 'createDirectory']
                });
                if (result.canceled || !result.filePaths.length) return successResponse({ canceled: true }, '已取消下载');
                destinationPath = path.join(result.filePaths[0], name);
            } else {
                const result = await this.showSaveDialog(event, {
                    title: '保存远程文件',
                    defaultPath: path.join(sftpDownloadDirectory(), name)
                });
                if (result.canceled || !result.filePath) return successResponse({ canceled: true }, '已取消下载');
                destinationPath = result.filePath;
            }

            this.emitProgress({
                sessionId: payload.sessionId,
                operation: 'download',
                phase: 'start',
                remotePath: payload.remotePath,
                name
            });
            await this.sshManager.download(payload.sessionId, payload.remotePath, destinationPath, progress => {
                this.emitProgress(progress);
            });
            this.emitProgress({
                sessionId: payload.sessionId,
                operation: 'download',
                phase: 'done',
                remotePath: payload.remotePath,
                name
            });
            return successResponse({ destinationPath }, '下载完成');
        } catch (err) {
            if (payload.sessionId) {
                this.emitProgress({
                    sessionId: payload.sessionId,
                    operation: 'download',
                    phase: 'error',
                    remotePath: payload.remotePath,
                    name: basename(payload.remotePath),
                    msg: err.message
                });
            }
            return errorResponse('下载失败: ' + err.message);
        }
    }

    async handleUpload(event, payload = {}) {
        try {
            if (!payload.sessionId || !payload.remoteDir) return errorResponse('上传参数不完整');
            let filePaths = Array.isArray(payload.localPaths)
                ? payload.localPaths.map(item => String(item || '').trim()).filter(Boolean)
                : [];

            if (filePaths.length === 0 && !Array.isArray(payload.localPaths)) {
                const result = await this.showOpenDialog(event, {
                    title: '选择要上传的文件或目录',
                    defaultPath: sftpUploadDirectory(),
                    properties: ['openFile', 'openDirectory', 'multiSelections']
                });
                if (result.canceled || !result.filePaths.length) return successResponse({ canceled: true }, '已取消上传');
                filePaths = result.filePaths;
            }

            if (filePaths.length === 0) return errorResponse('未找到可上传的本地文件');

            this.emitProgress({
                sessionId: payload.sessionId,
                operation: 'upload',
                phase: 'start',
                remotePath: payload.remoteDir,
                name: `${filePaths.length} 项`
            });
            for (const localPath of filePaths) {
                await this.sshManager.upload(payload.sessionId, localPath, payload.remoteDir, progress => {
                    this.emitProgress(progress);
                });
            }
            this.emitProgress({
                sessionId: payload.sessionId,
                operation: 'upload',
                phase: 'done',
                remotePath: payload.remoteDir,
                name: `${filePaths.length} 项`
            });
            return successResponse({ count: filePaths.length }, '上传完成');
        } catch (err) {
            if (payload.sessionId) {
                this.emitProgress({
                    sessionId: payload.sessionId,
                    operation: 'upload',
                    phase: 'error',
                    remotePath: payload.remoteDir,
                    msg: err.message
                });
            }
            return errorResponse('上传失败: ' + err.message);
        }
    }

    async handleMkdir(_event, payload = {}) {
        try {
            if (!payload.sessionId || !payload.remoteDir) return errorResponse('新建目录参数不完整');
            const result = await this.sshManager.mkdir(payload.sessionId, payload.remoteDir, payload.name);
            return successResponse(result, '目录已创建');
        } catch (err) {
            return errorResponse('新建目录失败: ' + err.message);
        }
    }

    async handleRemove(_event, payload = {}) {
        try {
            if (!payload.sessionId || !payload.remotePath) return errorResponse('删除参数不完整');
            await this.sshManager.remove(payload.sessionId, payload.remotePath);
            return successResponse(null, '删除完成');
        } catch (err) {
            return errorResponse('删除失败: ' + err.message);
        }
    }

    async handleRename(_event, payload = {}) {
        try {
            if (!payload.sessionId || !payload.remotePath) return errorResponse('重命名参数不完整');
            const result = await this.sshManager.rename(payload.sessionId, payload.remotePath, payload.name);
            return successResponse(result, '重命名完成');
        } catch (err) {
            return errorResponse('重命名失败: ' + err.message);
        }
    }
}

module.exports = SftpApp;
