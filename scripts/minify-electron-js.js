const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const asar = require('@electron/asar');
const { transform } = require('esbuild');

const NODE_PTY_UNPACK_DIR = 'node_modules/node-pty';

async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch (_err) {
        return false;
    }
}

async function findDarwinAppDirs(appOutDir) {
    const entries = await fs.readdir(appOutDir, { withFileTypes: true }).catch(() => []);
    return entries
        .filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
        .map(entry => path.join(appOutDir, entry.name));
}

async function findElectronRoots(context) {
    const appOutDir = context.appOutDir;
    const candidates = [path.join(appOutDir, 'resources', 'app', 'electron')];

    if (context.electronPlatformName === 'darwin') {
        const appDirs = await findDarwinAppDirs(appOutDir);
        appDirs.forEach(appDir => {
            candidates.push(path.join(appDir, 'Contents', 'Resources', 'app', 'electron'));
        });
    }

    const roots = [];
    for (const candidate of candidates) {
        if (await pathExists(candidate)) roots.push(candidate);
    }
    return roots;
}

async function findAsarArchives(context) {
    const appOutDir = context.appOutDir;
    const candidates = [path.join(appOutDir, 'resources', 'app.asar')];

    if (context.electronPlatformName === 'darwin') {
        const appDirs = await findDarwinAppDirs(appOutDir);
        appDirs.forEach(appDir => {
            candidates.push(path.join(appDir, 'Contents', 'Resources', 'app.asar'));
        });
    }

    const archives = [];
    for (const candidate of candidates) {
        if (await pathExists(candidate)) archives.push(candidate);
    }
    return archives;
}

async function collectJsFiles(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectJsFiles(fullPath)));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
    }

    return files;
}

async function writeFileBreakingHardlink(filePath, contents) {
    const stat = await fs.stat(filePath);

    if (stat.nlink <= 1) {
        await fs.writeFile(filePath, contents);
        return;
    }

    const tempPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

    try {
        await fs.writeFile(tempPath, contents, { mode: stat.mode });
        await fs.rename(tempPath, filePath);
    } catch (err) {
        await fs.rm(tempPath, { force: true }).catch(() => {});
        throw err;
    }
}

async function minifyFile(filePath) {
    const source = await fs.readFile(filePath, 'utf8');
    const result = await transform(source, {
        loader: 'js',
        target: 'node16',
        minifyWhitespace: true,
        minifySyntax: true,
        minifyIdentifiers: true,
        keepNames: true,
        legalComments: 'none'
    });

    await writeFileBreakingHardlink(filePath, result.code);

    return {
        before: Buffer.byteLength(source),
        after: Buffer.byteLength(result.code)
    };
}

async function minifyElectronRoot(electronRoot) {
    const files = await collectJsFiles(electronRoot);
    let beforeBytes = 0;
    let afterBytes = 0;

    for (const file of files) {
        const result = await minifyFile(file);
        beforeBytes += result.before;
        afterBytes += result.after;
    }

    const savedBytes = beforeBytes - afterBytes;
    const savedPercent = beforeBytes > 0 ? ((savedBytes / beforeBytes) * 100).toFixed(1) : '0.0';
    console.log(`[minify-electron-js] minified ${files.length} files, saved ${savedBytes} bytes (${savedPercent}%)`);
}

async function minifyAsarArchive(archivePath) {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'nexterm-electron-minify-'));
    const appDir = path.join(tempRoot, 'app');
    const tempArchive = `${archivePath}.${process.pid}.tmp`;
    const tempUnpacked = `${tempArchive}.unpacked`;
    const unpackedDir = `${archivePath}.unpacked`;

    try {
        asar.extractAll(archivePath, appDir);

        const electronRoot = path.join(appDir, 'electron');
        if (!(await pathExists(electronRoot))) {
            console.log(`[minify-electron-js] electron directory not found in ${archivePath}, skipped`);
            return;
        }

        await minifyElectronRoot(electronRoot);
        await fs.rm(tempArchive, { force: true }).catch(() => {});
        await fs.rm(tempUnpacked, { recursive: true, force: true }).catch(() => {});

        await asar.createPackageWithOptions(appDir, tempArchive, {
            unpackDir: NODE_PTY_UNPACK_DIR
        });

        await fs.rename(tempArchive, archivePath);
        if (await pathExists(tempUnpacked)) {
            await fs.rm(unpackedDir, { recursive: true, force: true }).catch(() => {});
            await fs.rename(tempUnpacked, unpackedDir);
        }
    } finally {
        await fs.rm(tempArchive, { force: true }).catch(() => {});
        await fs.rm(tempUnpacked, { recursive: true, force: true }).catch(() => {});
        await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
}

async function minifyElectronJs(context) {
    const electronRoots = await findElectronRoots(context);
    if (electronRoots.length > 0) {
        for (const electronRoot of electronRoots) await minifyElectronRoot(electronRoot);
        return;
    }

    const asarArchives = await findAsarArchives(context);
    if (asarArchives.length > 0) {
        for (const archive of asarArchives) await minifyAsarArchive(archive);
        return;
    }

    console.log('[minify-electron-js] electron output directory not found, skipped');
}

async function runFromCli() {
    const appOutDir = process.argv[2] || path.join(__dirname, '../release/mac-arm64');
    await minifyElectronJs({
        appOutDir,
        electronPlatformName: process.platform === 'darwin' ? 'darwin' : process.platform
    });
}

module.exports = minifyElectronJs;
module.exports.minifyElectronRoot = minifyElectronRoot;
module.exports.minifyAsarArchive = minifyAsarArchive;

if (require.main === module) {
    runFromCli().catch(err => {
        console.error(err);
        process.exitCode = 1;
    });
}
