const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function userDataPath(...segments) {
    return path.join(app.getPath('userData'), ...segments);
}

function ensureUserDataDir(...segments) {
    const dir = userDataPath(...segments);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function sessionDataPath() {
    return userDataPath('data', 'sessions.json');
}

function scriptDataPath() {
    return userDataPath('data', 'scripts.json');
}

function terminalLogDirectory() {
    return ensureUserDataDir('logs');
}

function sftpDownloadDirectory() {
    return ensureUserDataDir('downloads');
}

function sftpUploadDirectory() {
    return ensureUserDataDir('uploads');
}

module.exports = {
    ensureUserDataDir,
    scriptDataPath,
    sessionDataPath,
    sftpDownloadDirectory,
    sftpUploadDirectory,
    terminalLogDirectory,
    userDataPath
};
