const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const showHelp = args.includes('--help') || args.includes('-h');

function printHelp() {
    console.log(`
NexTerm Release Script

Usage:
  node scripts/release.js [options]

Options:
  --help, -h          显示帮助信息
  --win               构建 Windows x64
  --mac               构建 macOS x64 + arm64
  --x64               指定 x64 架构
  --arm64             指定 arm64 架构
  --universal         指定 macOS universal 架构
  --publish <mode>    electron-builder publish 模式: always / never / onTagOrDraft
  --skip-build        跳过前端构建

Examples:
  npm run release
  npm run release -- --mac
  npm run release -- --win --publish always
`);
}

if (showHelp) {
    printHelp();
    process.exit(0);
}

function loadDotEnv() {
    const envPath = path.resolve(__dirname, '../.env');
    if (!fs.existsSync(envPath)) return;

    const envConfig = fs.readFileSync(envPath, 'utf8');
    envConfig.split(/\r?\n/).forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const match = trimmed.match(/^([^=]+)=(.*)$/);
        if (!match) return;
        const key = match[1].trim();
        const value = match[2].trim();
        if (!process.env[key]) process.env[key] = value;
    });
}

function readArgValue(name) {
    const index = args.indexOf(name);
    if (index < 0) return '';
    return args[index + 1] || '';
}

function getPlatformArgs() {
    if (args.includes('--win')) return ['--win', '--x64'];
    if (args.includes('--mac')) return ['--mac'];
    return [];
}

function getArchArgs() {
    if (args.includes('--win')) return [];
    return ['--x64', '--arm64', '--universal'].filter(arg => args.includes(arg));
}

function getPublishMode() {
    const explicit = readArgValue('--publish');
    if (explicit) return explicit;
    return process.env.GH_TOKEN || process.env.GITHUB_TOKEN ? 'always' : 'never';
}

function extraBuilderArgs() {
    const consumed = new Set([
        '--help',
        '-h',
        '--win',
        '--mac',
        '--x64',
        '--arm64',
        '--universal',
        '--skip-build',
        '--publish'
    ]);
    const result = [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--publish') {
            i += 1;
            continue;
        }
        if (!consumed.has(arg)) result.push(arg);
    }
    return result;
}

function run(command, options = {}) {
    console.log(`\n> ${command}`);
    execSync(command, {
        stdio: 'inherit',
        env: {
            ...process.env,
            CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false',
            GH_TOKEN: process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
        },
        ...options
    });
}

loadDotEnv();

if (!args.includes('--skip-build')) {
    run('npm run build');
}

const publishMode = getPublishMode();
if (publishMode !== 'never' && !process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    console.warn('\nGH_TOKEN/GITHUB_TOKEN 未设置，将无法发布到 GitHub。');
}
if (publishMode === 'never') {
    console.warn('\n未检测到 GH_TOKEN/GITHUB_TOKEN，本次只生成 release 产物，不上传 GitHub。');
}

const builderArgs = [
    'electron-builder',
    ...getPlatformArgs(),
    ...getArchArgs(),
    '--publish',
    publishMode,
    ...extraBuilderArgs()
].filter(Boolean);

run(builderArgs.join(' '));

console.log('\nRelease command completed.');
