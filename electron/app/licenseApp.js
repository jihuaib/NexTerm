const fs = require('fs');
const path = require('path');
const { BrowserWindow, dialog } = require('electron');
const { successResponse, errorResponse } = require('../utils/responseUtils');
const { ensureUserDataDir } = require('../utils/appPaths');
const LicenseManager = require('../utils/licenseManager');

function readJsonText(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('授权内容不能为空');
    return JSON.parse(raw);
}

class LicenseApp {
    constructor(ipcMain, manager = null) {
        this.manager = manager || new LicenseManager();
        ipcMain.handle('license:get', this.handleGet.bind(this));
        ipcMain.handle('license:request', this.handleRequest.bind(this));
        ipcMain.handle('license:export-request', this.handleExportRequest.bind(this));
        ipcMain.handle('license:import-text', this.handleImportText.bind(this));
        ipcMain.handle('license:import-file', this.handleImportFile.bind(this));
        ipcMain.handle('license:remove', this.handleRemove.bind(this));
    }

    handleGet() {
        try {
            return successResponse(this.manager.status(), '获取授权状态成功');
        } catch (err) {
            return errorResponse('获取授权状态失败: ' + err.message);
        }
    }

    handleRequest() {
        try {
            return successResponse(this.manager.activationRequest(), '激活请求已生成');
        } catch (err) {
            return errorResponse('生成激活请求失败: ' + err.message);
        }
    }

    async handleExportRequest(event) {
        try {
            const request = this.manager.activationRequest();
            const fileName = `nexterm-activation-request-${request.requestId}.json`;
            let filePath = path.join(ensureUserDataDir('activation'), fileName);

            if (!process.env.NEXTERM_E2E) {
                const win = BrowserWindow.fromWebContents(event.sender);
                const result = await dialog.showSaveDialog(win, {
                    title: '保存激活请求文件',
                    defaultPath: filePath,
                    filters: [{ name: 'JSON', extensions: ['json'] }]
                });
                if (result.canceled || !result.filePath) {
                    return successResponse({ canceled: true, request }, '已取消');
                }
                filePath = result.filePath;
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, JSON.stringify(request, null, 2) + '\n', 'utf8');
            return successResponse({ canceled: false, path: filePath, request }, '激活请求已保存');
        } catch (err) {
            return errorResponse('保存激活请求失败: ' + err.message);
        }
    }

    handleImportText(_event, text) {
        try {
            const license = readJsonText(text);
            const result = this.manager.importLicense(license);
            if (!result.ok) return errorResponse(result.msg || '授权文件无效');
            return successResponse(result.status, '授权已导入');
        } catch (err) {
            return errorResponse('导入授权失败: ' + err.message);
        }
    }

    async handleImportFile(event) {
        try {
            let filePath = '';
            if (process.env.NEXTERM_E2E) {
                filePath = path.join(ensureUserDataDir('activation'), 'license.json');
            } else {
                const win = BrowserWindow.fromWebContents(event.sender);
                const result = await dialog.showOpenDialog(win, {
                    title: '选择授权文件',
                    properties: ['openFile'],
                    filters: [{ name: 'JSON', extensions: ['json'] }]
                });
                if (result.canceled || !result.filePaths?.[0]) {
                    return successResponse({ canceled: true, status: this.manager.status() }, '已取消');
                }
                filePath = result.filePaths[0];
            }

            const license = readJsonText(fs.readFileSync(filePath, 'utf8'));
            const result = this.manager.importLicense(license);
            if (!result.ok) return errorResponse(result.msg || '授权文件无效');
            return successResponse({ canceled: false, status: result.status }, '授权已导入');
        } catch (err) {
            return errorResponse('导入授权文件失败: ' + err.message);
        }
    }

    handleRemove() {
        try {
            const result = this.manager.removeLicense();
            if (!result.ok) return errorResponse(result.msg || '移除授权失败');
            return successResponse(result.status, '授权已移除');
        } catch (err) {
            return errorResponse('移除授权失败: ' + err.message);
        }
    }
}

module.exports = LicenseApp;
