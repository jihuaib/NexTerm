const RS = '\x1e';
const REQUEST_PREFIX = `${RS}NEXTERM_RPC\t`;
const RESPONSE_PREFIX = `${RS}NEXTERM_RES\t`;
const MAX_BUFFER = 1024 * 128;

function encodeField(value = '') {
    return String(value)
        .replace(/%/g, '%25')
        .replace(/\t/g, '%09')
        .replace(/\r/g, '%0D')
        .replace(/\n/g, '%0A')
        .replace(/\x1e/g, '%1E');
}

function decodeField(value = '') {
    return String(value).replace(/%([0-9A-Fa-f]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function toText(data) {
    return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
}

function findMatch(buffer, pattern, useRegex) {
    if (useRegex) {
        const match = buffer.match(new RegExp(pattern));
        if (!match) return null;
        return { start: match.index, end: match.index + match[0].length };
    }

    const index = buffer.indexOf(pattern);
    if (index < 0) return null;
    return { start: index, end: index + pattern.length };
}

function literalEscapeIsEscaped(text, backslashIndex) {
    let count = 0;
    for (let index = backslashIndex - 1; index >= 0 && text[index] === '\\'; index -= 1) count += 1;
    return count % 2 === 1;
}

function normalizeTerminalInput(value = '') {
    const text = String(value);
    const lineEndings = [
        ['\\r\\n', '\r'],
        ['\\n', '\r'],
        ['\\r', '\r']
    ];
    const actualSuffixes = ['\r\n', '\n', '\r'];

    for (const [literal, actual] of lineEndings) {
        for (const suffix of actualSuffixes) {
            if (!text.endsWith(literal + suffix)) continue;
            const start = text.length - literal.length - suffix.length;
            if (!literalEscapeIsEscaped(text, start)) return normalizeInputLineEndings(text.slice(0, start) + actual);
        }
    }

    for (const [literal, actual] of lineEndings) {
        if (!text.endsWith(literal)) continue;
        const start = text.length - literal.length;
        if (!literalEscapeIsEscaped(text, start)) return normalizeInputLineEndings(text.slice(0, start) + actual);
    }

    return normalizeInputLineEndings(text);
}

function normalizeInputLineEndings(value = '') {
    return String(value).replace(/\r\n/g, '\r').replace(/\n/g, '\r');
}

function normalizeTerminalOutput(value = '') {
    return String(value).replace(/\r?\n/g, match => (match === '\r\n' ? match : '\r\n'));
}

function stripFrameTerminator(buffer = '') {
    if (buffer.startsWith('\r\n')) return buffer.slice(2);
    if (buffer.startsWith('\n') || buffer.startsWith('\r')) return buffer.slice(1);
    return buffer;
}

class ScriptIoBridge {
    constructor({ sessionId, writeInput, writeTerminal, sendTerminalInput }) {
        this.sessionId = sessionId;
        this.writeInput = writeInput;
        this.writeTerminal = writeTerminal;
        this.sendTerminalInput = sendTerminalInput;
        this.stdoutBuffer = '';
        this.expectBuffer = '';
        this.waiters = new Set();
    }

    onTerminalData(data) {
        this.expectBuffer = `${this.expectBuffer}${toText(data)}`.slice(-MAX_BUFFER);
        for (const waiter of [...this.waiters]) this.checkWaiter(waiter);
    }

    writeVisible(data) {
        this.writeTerminal(normalizeTerminalOutput(data));
    }

    onStdout(data) {
        this.stdoutBuffer += toText(data);

        while (this.stdoutBuffer) {
            const start = this.stdoutBuffer.indexOf(REQUEST_PREFIX);
            if (start < 0) {
                this.writeVisible(this.stdoutBuffer);
                this.stdoutBuffer = '';
                return;
            }

            if (start > 0) {
                this.writeVisible(this.stdoutBuffer.slice(0, start));
                this.stdoutBuffer = this.stdoutBuffer.slice(start);
            }

            const end = this.stdoutBuffer.indexOf(RS, 1);
            if (end < 0) {
                if (this.stdoutBuffer.length > MAX_BUFFER) {
                    this.writeVisible(this.stdoutBuffer);
                    this.stdoutBuffer = '';
                }
                return;
            }

            const frame = this.stdoutBuffer.slice(1, end);
            this.stdoutBuffer = stripFrameTerminator(this.stdoutBuffer.slice(end + 1));
            this.handleFrame(frame);
        }
    }

    flush() {
        if (!this.stdoutBuffer) return;
        this.writeVisible(this.stdoutBuffer);
        this.stdoutBuffer = '';
    }

    handleFrame(frame) {
        const parts = String(frame || '').split('\t');
        if (parts[0] !== 'NEXTERM_RPC' || parts.length < 6) return;
        const [, id, action, timeoutRaw, regexRaw, payloadRaw] = parts;
        const payload = decodeField(payloadRaw);
        const timeout = Math.max(0, Number(timeoutRaw) || 0);
        const useRegex = regexRaw === '1';

        if (action === 'send') {
            this.sendTerminalInput(normalizeTerminalInput(payload));
            this.respond(id, 'ok', '');
            return;
        }
        if (action === 'print') {
            this.writeVisible(payload);
            this.respond(id, 'ok', '');
            return;
        }
        if (action === 'expect') {
            this.expect(id, payload, timeout, useRegex);
            return;
        }

        this.respond(id, 'error', `未知 term 动作: ${action}`);
    }

    expect(id, pattern, timeout, useRegex) {
        const waiter = {
            id,
            pattern,
            useRegex,
            timer: null
        };

        waiter.timer = setTimeout(() => {
            this.waiters.delete(waiter);
            this.respond(id, 'error', `等待回显超时: ${pattern}`);
        }, timeout || 5000);

        this.waiters.add(waiter);
        this.checkWaiter(waiter);
    }

    checkWaiter(waiter) {
        let match = null;
        try {
            match = findMatch(this.expectBuffer, waiter.pattern, waiter.useRegex);
        } catch (err) {
            this.waiters.delete(waiter);
            clearTimeout(waiter.timer);
            this.respond(waiter.id, 'error', `回显匹配表达式无效: ${err.message}`);
            return;
        }

        if (!match) return;
        const output = this.expectBuffer.slice(0, match.end);
        this.expectBuffer = this.expectBuffer.slice(match.end);
        this.waiters.delete(waiter);
        clearTimeout(waiter.timer);
        this.respond(waiter.id, 'ok', output);
    }

    respond(id, status, payload) {
        try {
            this.writeInput(`${RESPONSE_PREFIX}${id}\t${status}\t${encodeField(payload)}${RS}\n`);
        } catch (_err) {
            /* script stdin may already be closed */
        }
    }

    close() {
        this.flush();
        for (const waiter of this.waiters) {
            clearTimeout(waiter.timer);
            this.respond(waiter.id, 'error', '脚本已结束');
        }
        this.waiters.clear();
    }
}

module.exports = {
    REQUEST_PREFIX,
    RESPONSE_PREFIX,
    normalizeTerminalInput,
    normalizeTerminalOutput,
    ScriptIoBridge
};
