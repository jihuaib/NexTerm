const { SerialPort, SerialPortMock } = require('serialport');
const { TERMINAL_STATUS, TERMINAL_EVT } = require('../const/telnetConst');
const {
    pauseLocalScriptTask,
    resumeLocalScriptTask,
    startLocalScriptTask,
    stopLocalScriptTask
} = require('./scriptProcessRunner');
const { normalizeTerminalOutput } = require('./scriptIoBridge');

const DEFAULT_SERIAL_BAUD_RATE = 115200;
const DEFAULT_SERIAL_DATA_BITS = 8;
const DEFAULT_SERIAL_STOP_BITS = 1;
const DEFAULT_SERIAL_PARITY = 'none';
const DEFAULT_SERIAL_FLOW_CONTROL = 'none';
const DEFAULT_MOCK_SERIAL_PATH = process.platform === 'win32' ? 'COM99' : '/dev/tty.NEXTERM-E2E';

let mockSerialReady = false;

function normalizeText(value) {
    return String(value || '').trim();
}

function mockSerialPortPaths() {
    const raw = normalizeText(process.env.NEXTERM_SERIAL_MOCK_PORTS);
    if (!raw) return [DEFAULT_MOCK_SERIAL_PATH];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            const paths = parsed.map(normalizeText).filter(Boolean);
            if (paths.length) return paths;
        }
    } catch (_err) {
        /* fall back to comma separated env value */
    }
    const paths = raw
        .split(',')
        .map(normalizeText)
        .filter(Boolean);
    return paths.length ? paths : [DEFAULT_MOCK_SERIAL_PATH];
}

function ensureMockSerialPorts() {
    if (mockSerialReady || !SerialPortMock?.binding) return;
    SerialPortMock.binding.reset();
    for (const portPath of mockSerialPortPaths()) {
        SerialPortMock.binding.createPort(portPath, {
            echo: true,
            record: true,
            manufacturer: 'NexTerm E2E',
            vendorId: 'EEEE',
            productId: '0001'
        });
    }
    mockSerialReady = true;
}

function resolveSerialPort(options = {}) {
    if (options.SerialPort) return options.SerialPort;
    if (process.env.NEXTERM_SERIAL_MOCK === '1' && SerialPortMock) {
        ensureMockSerialPorts();
        return SerialPortMock;
    }
    return SerialPort;
}

function clampNumber(value, fallback, allowed = []) {
    const next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    if (allowed.length && !allowed.includes(next)) return fallback;
    return next;
}

function normalizeParity(value) {
    const next = normalizeText(value).toLowerCase();
    return ['none', 'even', 'odd', 'mark', 'space'].includes(next) ? next : DEFAULT_SERIAL_PARITY;
}

function normalizeFlowControl(value) {
    const next = normalizeText(value).toLowerCase();
    return ['none', 'hardware', 'software'].includes(next) ? next : DEFAULT_SERIAL_FLOW_CONTROL;
}

function normalizeBoolean(value, fallback = false) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return fallback;
}

function normalizeSerialOptions(options = {}) {
    const flowControl = normalizeFlowControl(options.serialFlowControl || options.flowControl);
    return {
        path: normalizeText(options.serialPath || options.path || options.host),
        baudRate: clampNumber(options.serialBaudRate || options.baudRate, DEFAULT_SERIAL_BAUD_RATE),
        dataBits: clampNumber(options.serialDataBits || options.dataBits, DEFAULT_SERIAL_DATA_BITS, [5, 6, 7, 8]),
        stopBits: clampNumber(options.serialStopBits || options.stopBits, DEFAULT_SERIAL_STOP_BITS, [1, 2]),
        parity: normalizeParity(options.serialParity || options.parity),
        flowControl,
        dtr: normalizeBoolean(options.serialDtr, true),
        rts: normalizeBoolean(options.serialRts, true)
    };
}

function flowControlOptions(flowControl) {
    return {
        rtscts: flowControl === 'hardware',
        xon: flowControl === 'software',
        xoff: flowControl === 'software',
        xany: flowControl === 'software'
    };
}

function formatPortLabel(port = {}) {
    const parts = [port.path];
    const meta = [port.manufacturer, port.vendorId && port.productId ? `${port.vendorId}:${port.productId}` : '']
        .map(normalizeText)
        .filter(Boolean);
    if (meta.length) parts.push(`(${meta.join(' · ')})`);
    return parts.join(' ');
}

async function listSerialPorts(SerialPortImpl = SerialPort) {
    if (SerialPortImpl === SerialPortMock) ensureMockSerialPorts();
    const ports = await SerialPortImpl.list();
    return ports
        .map(port => ({
            path: port.path || '',
            label: formatPortLabel(port),
            manufacturer: port.manufacturer || '',
            serialNumber: port.serialNumber || '',
            pnpId: port.pnpId || '',
            locationId: port.locationId || '',
            vendorId: port.vendorId || '',
            productId: port.productId || ''
        }))
        .filter(port => port.path)
        .sort((a, b) => a.path.localeCompare(b.path));
}

function serialOpenError(path, err) {
    const reason = err?.message || String(err || 'unknown error');
    if (process.platform === 'win32' && /access denied|permission/i.test(reason)) {
        return `无法打开串口 ${path}: ${reason}。请确认串口未被其他程序占用。`;
    }
    if (process.platform !== 'win32' && /permission|denied|EACCES/i.test(reason)) {
        return `无法打开串口 ${path}: ${reason}。请确认当前用户有串口设备权限。`;
    }
    return `无法打开串口 ${path}: ${reason}`;
}

class SerialManager {
    constructor(emit, options = {}) {
        this.emit = typeof emit === 'function' ? emit : () => {};
        this.SerialPort = resolveSerialPort(options);
        this.conns = new Map();
        this.scriptTasks = new Map();
    }

    listPorts() {
        return listSerialPorts(this.SerialPort);
    }

    connect(options = {}) {
        const { sessionId } = options;
        if (!sessionId) return { ok: false, msg: '会话参数不完整' };
        if (this.conns.has(sessionId)) return { ok: false, msg: '会话已存在' };

        const serialOptions = normalizeSerialOptions(options);
        if (!serialOptions.path) return { ok: false, msg: '请选择串口设备' };

        this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.CONNECTING });

        let port;
        try {
            port = new this.SerialPort({
                path: serialOptions.path,
                baudRate: serialOptions.baudRate,
                dataBits: serialOptions.dataBits,
                stopBits: serialOptions.stopBits,
                parity: serialOptions.parity,
                autoOpen: false,
                ...flowControlOptions(serialOptions.flowControl)
            });
        } catch (err) {
            return { ok: false, msg: serialOpenError(serialOptions.path, err) };
        }

        const ctx = { port, options: serialOptions, open: false };
        this.conns.set(sessionId, ctx);

        port.on('data', data => {
            for (const task of this.scriptTasks.values()) {
                if (task.sessionId === sessionId) task.bridge.onTerminalData(data);
            }
            this.emit(TERMINAL_EVT.DATA, {
                sessionId,
                b64: Buffer.from(data).toString('base64')
            });
        });

        port.on('error', err => {
            const msg = serialOpenError(serialOptions.path, err);
            this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.ERROR, msg });
        });

        port.on('close', () => {
            this.conns.delete(sessionId);
            this.emit(TERMINAL_EVT.STATUS, {
                sessionId,
                status: TERMINAL_STATUS.CLOSED,
                msg: `${serialOptions.path} 已关闭`
            });
        });

        port.open(err => {
            if (err) {
                this.conns.delete(sessionId);
                this.emit(TERMINAL_EVT.STATUS, {
                    sessionId,
                    status: TERMINAL_STATUS.ERROR,
                    msg: serialOpenError(serialOptions.path, err)
                });
                return;
            }

            ctx.open = true;
            port.set({ dtr: serialOptions.dtr, rts: serialOptions.rts }, setErr => {
                if (setErr) {
                    this.emit(TERMINAL_EVT.DATA, {
                        sessionId,
                        b64: Buffer.from(`[NexTerm] 串口控制线设置失败: ${setErr.message}\r\n`).toString('base64')
                    });
                }
                this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.CONNECTED });
            });
        });

        return { ok: true };
    }

    resize() {
        /* serial ports are byte streams and do not have terminal geometry */
    }

    sendInput(sessionId, data) {
        const ctx = this.conns.get(sessionId);
        if (!ctx?.port?.writable) return;
        ctx.port.write(Buffer.from(String(data), 'utf8'));
    }

    emitData(sessionId, data) {
        if (!data || data.length === 0) return;
        this.emit(TERMINAL_EVT.DATA, {
            sessionId,
            b64: Buffer.from(normalizeTerminalOutput(data)).toString('base64')
        });
    }

    runScript(sessionId, payload = {}) {
        const ctx = this.conns.get(sessionId);
        if (!ctx?.port?.writable) return Promise.resolve({ ok: false, msg: '串口会话不存在' });
        if (!payload.taskId) return Promise.resolve({ ok: false, msg: '脚本任务参数不完整' });
        if (this.scriptTasks.has(payload.taskId)) return Promise.resolve({ ok: false, msg: '脚本任务已存在' });

        return startLocalScriptTask({
            sessionId,
            writeTerminal: data => this.emitData(sessionId, data),
            sendTerminalInput: data => this.sendInput(sessionId, data),
            payload,
            emit: this.emit,
            registerTask: task => this.scriptTasks.set(payload.taskId, task),
            unregisterTask: () => this.scriptTasks.delete(payload.taskId)
        });
    }

    stopScript(taskId) {
        const task = this.scriptTasks.get(taskId);
        return stopLocalScriptTask(task);
    }

    pauseScript(taskId) {
        const task = this.scriptTasks.get(taskId);
        return pauseLocalScriptTask(task);
    }

    resumeScript(taskId) {
        const task = this.scriptTasks.get(taskId);
        return resumeLocalScriptTask(task);
    }

    disconnect(sessionId) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return;
        for (const [taskId, task] of [...this.scriptTasks.entries()]) {
            if (task.sessionId !== sessionId) continue;
            this.stopScript(taskId);
            this.scriptTasks.delete(taskId);
        }
        try {
            if (ctx.port?.isOpen) ctx.port.close();
            else ctx.port?.destroy?.();
        } catch (_err) {
            /* serial port may already be closed */
        }
        this.conns.delete(sessionId);
    }

    disconnectAll() {
        for (const id of [...this.conns.keys()]) {
            this.disconnect(id);
        }
    }
}

SerialManager.DEFAULT_SERIAL_BAUD_RATE = DEFAULT_SERIAL_BAUD_RATE;
SerialManager.DEFAULT_SERIAL_DATA_BITS = DEFAULT_SERIAL_DATA_BITS;
SerialManager.DEFAULT_SERIAL_STOP_BITS = DEFAULT_SERIAL_STOP_BITS;
SerialManager.DEFAULT_SERIAL_PARITY = DEFAULT_SERIAL_PARITY;
SerialManager.DEFAULT_SERIAL_FLOW_CONTROL = DEFAULT_SERIAL_FLOW_CONTROL;

module.exports = SerialManager;
