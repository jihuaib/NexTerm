const fs = require('fs');
const os = require('os');
const path = require('path');
const { terminalLogDirectory } = require('./appPaths');

const STORE_KEY = 'settings';
const DEFAULT_LOG_SETTINGS = {
    terminalLogEnabled: false,
    terminalLogDirectory: '',
    terminalLogFileFormat: '{date}/{time}-{session}-{id}.log',
    terminalLogLineFormat: '{text}',
    terminalLogStripAnsi: true
};

function pad(value) {
    return String(value).padStart(2, '0');
}

function dateTokens(date, forFile = false) {
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    return {
        date: `${year}${month}${day}`,
        time: `${hour}${minute}${second}`,
        datetime: forFile
            ? `${year}${month}${day}-${hour}${minute}${second}`
            : `${year}-${month}-${day} ${hour}:${minute}:${second}`,
        iso: date.toISOString()
    };
}

function stripAnsi(value) {
    return String(value || '').replace(
        // CSI / OSC / one-byte ESC sequences.
        /\x1B(?:\][^\x07]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g,
        ''
    );
}

function safeSegment(value) {
    const sanitized = String(value || '')
        .replace(/[<>:"|?*\x00-\x1f]/g, '_')
        .replace(/[\\/]+/g, '_')
        .trim();
    if (!sanitized || sanitized === '.' || sanitized === '..') return 'log';
    return sanitized;
}

function applyTemplate(template, tokens) {
    return String(template || '').replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
        return tokens[key] === undefined || tokens[key] === null ? '' : String(tokens[key]);
    });
}

function normalizeLineLogText(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '');
}

function defaultLogDirectory() {
    return terminalLogDirectory();
}

class TerminalLogWriter {
    constructor(store) {
        this.store = store;
        this.sessions = new Map();
    }

    getSettings() {
        return {
            ...DEFAULT_LOG_SETTINGS,
            ...(this.store?.get?.(STORE_KEY, {}) || {})
        };
    }

    registerSession(options = {}, protocol = '') {
        if (!options.sessionId) return;
        this.sessions.set(options.sessionId, {
            id: options.sessionId,
            sessionName: options.name || options.host || protocol || 'session',
            protocol: protocol || options.protocol || '',
            host: options.host || '',
            user: options.username || '',
            startedAt: new Date(),
            lineBuffer: '',
            queue: Promise.resolve(),
            logPath: '',
            signature: ''
        });
    }

    writeOutput(sessionId, b64) {
        const ctx = this.sessions.get(sessionId);
        if (!ctx || !b64) return;

        const settings = this.getSettings();
        if (!settings.terminalLogEnabled) {
            ctx.lineBuffer = '';
            ctx.logPath = '';
            ctx.signature = '';
            return;
        }

        const signature = [
            settings.terminalLogDirectory,
            settings.terminalLogFileFormat,
            settings.terminalLogLineFormat,
            settings.terminalLogStripAnsi ? 'strip' : 'raw'
        ].join('\n');
        if (ctx.signature && ctx.signature !== signature) {
            this.flushLineBuffer(ctx, settings);
            ctx.logPath = '';
        }
        ctx.signature = signature;

        let text = '';
        try {
            text = Buffer.from(String(b64), 'base64').toString('utf8');
        } catch (_err) {
            return;
        }
        if (!text) return;
        if (settings.terminalLogStripAnsi) text = stripAnsi(text);

        const output = this.formatOutput(ctx, settings, text);
        if (output) this.enqueueAppend(ctx, settings, output);
    }

    formatOutput(ctx, settings, text) {
        const lineFormat = String(settings.terminalLogLineFormat || '{text}');
        if (lineFormat.trim() === '{text}') return text;

        ctx.lineBuffer += normalizeLineLogText(text);
        const lines = ctx.lineBuffer.split('\n');
        ctx.lineBuffer = lines.pop() || '';
        if (lines.length === 0) return '';
        return lines.map(line => this.formatLine(ctx, settings, line)).join(os.EOL) + os.EOL;
    }

    formatLine(ctx, settings, text) {
        const now = new Date();
        return applyTemplate(settings.terminalLogLineFormat || '{text}', {
            ...dateTokens(now),
            id: ctx.id,
            session: ctx.sessionName,
            protocol: ctx.protocol,
            host: ctx.host,
            user: ctx.user,
            text
        });
    }

    buildLogPath(ctx, settings) {
        const root = path.resolve(String(settings.terminalLogDirectory || '').trim() || defaultLogDirectory());
        const tokens = {
            ...dateTokens(ctx.startedAt, true),
            id: safeSegment(ctx.id),
            session: safeSegment(ctx.sessionName),
            protocol: safeSegment(ctx.protocol || 'terminal'),
            host: safeSegment(ctx.host || 'local'),
            user: safeSegment(ctx.user || 'user')
        };
        const rendered = applyTemplate(
            settings.terminalLogFileFormat || DEFAULT_LOG_SETTINGS.terminalLogFileFormat,
            tokens
        );
        const safeRelative = String(rendered || DEFAULT_LOG_SETTINGS.terminalLogFileFormat)
            .replace(/\\/g, '/')
            .split('/')
            .filter(part => part && part !== '.' && part !== '..')
            .map(safeSegment)
            .join(path.sep);
        const relative = safeRelative || `${tokens.datetime}-${tokens.session}-${tokens.id}.log`;
        const withExtension = path.extname(relative) ? relative : `${relative}.log`;
        const target = path.resolve(root, withExtension);
        return target.startsWith(root + path.sep) || target === root
            ? target
            : path.join(root, `${tokens.datetime}-${tokens.id}.log`);
    }

    enqueueAppend(ctx, settings, content) {
        ctx.queue = ctx.queue
            .catch(() => {})
            .then(async () => {
                if (!ctx.logPath) ctx.logPath = this.buildLogPath(ctx, settings);
                await fs.promises.mkdir(path.dirname(ctx.logPath), { recursive: true });
                await fs.promises.appendFile(ctx.logPath, content, 'utf8');
            })
            .catch(err => {
                console.warn('[terminal-log] write failed:', err?.message || err);
            });
    }

    flushLineBuffer(ctx, settings = this.getSettings()) {
        if (!ctx?.lineBuffer) return;
        const lineFormat = String(settings.terminalLogLineFormat || '{text}');
        const output =
            lineFormat.trim() === '{text}' ? ctx.lineBuffer : this.formatLine(ctx, settings, ctx.lineBuffer) + os.EOL;
        ctx.lineBuffer = '';
        if (output) this.enqueueAppend(ctx, settings, output);
    }

    closeSession(sessionId) {
        const ctx = this.sessions.get(sessionId);
        if (!ctx) return;
        this.flushLineBuffer(ctx);
        this.sessions.delete(sessionId);
    }

    cleanup() {
        for (const sessionId of [...this.sessions.keys()]) this.closeSession(sessionId);
    }
}

module.exports = TerminalLogWriter;
