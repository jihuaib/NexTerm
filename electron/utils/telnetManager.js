const net = require('net');
const { TELNET, TERMINAL_STATUS, TERMINAL_EVT } = require('../const/telnetConst');

const T = TELNET;

/**
 * Telnet 客户端连接管理器
 * - 自实现 IAC 选项协商最小集（ECHO / SGA / NAWS / TERMINAL-TYPE）
 * - 从字节流中剥离 IAC 序列，只把净荷推送给终端
 * - 通过 emit(type, data) 推送数据与状态事件
 */
class TelnetManager {
    /**
     * @param {(type: string, data: any) => void} emit 事件推送回调
     */
    constructor(emit) {
        this.emit = typeof emit === 'function' ? emit : () => {};
        this.conns = new Map(); // sessionId -> ctx
    }

    connect({ sessionId, host, port }) {
        if (this.conns.has(sessionId)) {
            return { ok: false, msg: '会话已存在' };
        }

        const socket = new net.Socket();
        const ctx = {
            socket,
            state: 'data', // data | iac | option | sb | sb_iac
            optionCmd: null,
            sb: [],
            nawsEnabled: false,
            cols: 80,
            rows: 24
        };
        this.conns.set(sessionId, ctx);

        this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.CONNECTING });

        socket.setNoDelay(true);
        socket.on('connect', () => {
            this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.CONNECTED });
        });
        socket.on('data', buf => this._onData(sessionId, ctx, buf));
        socket.on('error', err => {
            this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.ERROR, msg: err.message });
        });
        socket.on('close', () => {
            this.conns.delete(sessionId);
            this.emit(TERMINAL_EVT.STATUS, { sessionId, status: TERMINAL_STATUS.CLOSED });
        });

        socket.connect(Number(port) || 23, host);
        return { ok: true };
    }

    _onData(sessionId, ctx, buf) {
        const out = [];
        for (let i = 0; i < buf.length; i++) {
            const b = buf[i];
            switch (ctx.state) {
                case 'data':
                    if (b === T.IAC) ctx.state = 'iac';
                    else out.push(b);
                    break;
                case 'iac':
                    if (b === T.IAC) {
                        out.push(T.IAC); // 转义的 0xFF
                        ctx.state = 'data';
                    } else if (b === T.DO || b === T.DONT || b === T.WILL || b === T.WONT) {
                        ctx.optionCmd = b;
                        ctx.state = 'option';
                    } else if (b === T.SB) {
                        ctx.sb = [];
                        ctx.state = 'sb';
                    } else {
                        // GA 等其他命令直接忽略
                        ctx.state = 'data';
                    }
                    break;
                case 'option':
                    this._handleOption(ctx, ctx.optionCmd, b);
                    ctx.state = 'data';
                    break;
                case 'sb':
                    if (b === T.IAC) ctx.state = 'sb_iac';
                    else ctx.sb.push(b);
                    break;
                case 'sb_iac':
                    if (b === T.SE) {
                        this._handleSubneg(ctx);
                        ctx.state = 'data';
                    } else {
                        ctx.sb.push(b); // IAC IAC 出现在 SB 中
                        ctx.state = 'sb';
                    }
                    break;
                default:
                    ctx.state = 'data';
            }
        }
        if (out.length) {
            this.emit(TERMINAL_EVT.DATA, { sessionId, b64: Buffer.from(out).toString('base64') });
        }
    }

    _handleOption(ctx, cmd, opt) {
        const s = ctx.socket;
        if (cmd === T.DO) {
            if (opt === T.OPT_NAWS) {
                s.write(Buffer.from([T.IAC, T.WILL, T.OPT_NAWS]));
                ctx.nawsEnabled = true;
                this._sendNaws(ctx);
            } else if (opt === T.OPT_TTYPE) {
                s.write(Buffer.from([T.IAC, T.WILL, T.OPT_TTYPE]));
            } else if (opt === T.OPT_SGA) {
                s.write(Buffer.from([T.IAC, T.WILL, T.OPT_SGA]));
            } else {
                s.write(Buffer.from([T.IAC, T.WONT, opt]));
            }
        } else if (cmd === T.DONT) {
            s.write(Buffer.from([T.IAC, T.WONT, opt]));
        } else if (cmd === T.WILL) {
            // 服务器愿意回显/抑制 GA，是交互式 shell 的常见组合
            if (opt === T.OPT_ECHO || opt === T.OPT_SGA) {
                s.write(Buffer.from([T.IAC, T.DO, opt]));
            } else {
                s.write(Buffer.from([T.IAC, T.DONT, opt]));
            }
        } else if (cmd === T.WONT) {
            s.write(Buffer.from([T.IAC, T.DONT, opt]));
        }
    }

    _handleSubneg(ctx) {
        const b = ctx.sb;
        // 终端类型查询：IAC SB TTYPE SEND IAC SE -> 回 IAC SB TTYPE IS "xterm" IAC SE
        if (b[0] === T.OPT_TTYPE && b[1] === T.SB_SEND) {
            const name = Buffer.from('xterm', 'ascii');
            const resp = [T.IAC, T.SB, T.OPT_TTYPE, T.SB_IS, ...name, T.IAC, T.SE];
            ctx.socket.write(Buffer.from(resp));
        }
    }

    _sendNaws(ctx) {
        if (!ctx.nawsEnabled) return;
        const w = ctx.cols & 0xffff;
        const h = ctx.rows & 0xffff;
        const sizeBytes = [(w >> 8) & 0xff, w & 0xff, (h >> 8) & 0xff, h & 0xff];
        // NAWS 净荷中的 0xFF 需转义为 0xFF 0xFF
        const escaped = [];
        for (const byte of sizeBytes) {
            escaped.push(byte);
            if (byte === T.IAC) escaped.push(T.IAC);
        }
        ctx.socket.write(Buffer.from([T.IAC, T.SB, T.OPT_NAWS, ...escaped, T.IAC, T.SE]));
    }

    resize(sessionId, cols, rows) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return;
        ctx.cols = cols;
        ctx.rows = rows;
        this._sendNaws(ctx);
    }

    sendInput(sessionId, data) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return;
        const buf = Buffer.from(String(data), 'utf8');
        // 用户数据中的 0xFF 需转义
        const escaped = [];
        for (const byte of buf) {
            escaped.push(byte);
            if (byte === T.IAC) escaped.push(T.IAC);
        }
        ctx.socket.write(Buffer.from(escaped));
    }

    disconnect(sessionId) {
        const ctx = this.conns.get(sessionId);
        if (!ctx) return;
        ctx.socket.destroy();
        this.conns.delete(sessionId);
    }

    disconnectAll() {
        for (const id of [...this.conns.keys()]) {
            this.disconnect(id);
        }
    }
}

module.exports = TelnetManager;
