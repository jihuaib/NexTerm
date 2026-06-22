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

function commandSetDataPath() {
    return userDataPath('data', 'command-sets.json');
}

function credentialDataPath() {
    return userDataPath('data', 'credentials.json');
}

function licenseDataPath() {
    return userDataPath('data', 'license.json');
}

function installDataPath() {
    return userDataPath('data', 'install.json');
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
    commandSetDataPath,
    credentialDataPath,
    ensureUserDataDir,
    installDataPath,
    licenseDataPath,
    scriptDataPath,
    sessionDataPath,
    sftpDownloadDirectory,
    sftpUploadDirectory,
    terminalLogDirectory,
    userDataPath
};
