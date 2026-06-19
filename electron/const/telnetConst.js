// Telnet 协议常量（RFC 854 / 1073 / 1091 等）
const TELNET = {
    // 命令
    IAC: 255,
    DONT: 254,
    DO: 253,
    WONT: 252,
    WILL: 251,
    SB: 250,
    SE: 240,
    GA: 249,

    // 子协商
    SB_IS: 0,
    SB_SEND: 1,

    // 选项
    OPT_ECHO: 1,
    OPT_SGA: 3,
    OPT_TTYPE: 24,
    OPT_NAWS: 31
};

// 连接状态
const TERMINAL_STATUS = {
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    CLOSED: 'closed',
    ERROR: 'error'
};

// 事件类型（unified-event 的 type）
const TERMINAL_EVT = {
    DATA: 'terminal:data',
    STATUS: 'terminal:status'
};

const SFTP_EVT = {
    CWD: 'sftp:cwd',
    PROGRESS: 'sftp:progress'
};

module.exports = { TELNET, TERMINAL_STATUS, TERMINAL_EVT, SFTP_EVT };
