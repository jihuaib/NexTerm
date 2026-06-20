const path = require('path');

const SCRIPT_LANGUAGES = [
    {
        id: 'javascript',
        extension: 'mjs',
        runner: 'if command -v node >/dev/null 2>&1; then node "$__nexterm_script_file"; elif command -v nodejs >/dev/null 2>&1; then nodejs "$__nexterm_script_file"; else printf \'%s\\n\' \'NexTerm: node/nodejs not found\' >&2; false; fi'
    },
    {
        id: 'python',
        extension: 'py',
        runner: 'if command -v python3 >/dev/null 2>&1; then python3 "$__nexterm_script_file"; elif command -v python >/dev/null 2>&1; then python "$__nexterm_script_file"; else printf \'%s\\n\' \'NexTerm: python3/python not found\' >&2; false; fi'
    },
    {
        id: 'tcl',
        extension: 'tcl',
        runner: "if command -v tclsh >/dev/null 2>&1; then tclsh \"$__nexterm_script_file\"; else printf '%s\\n' 'NexTerm: tclsh not found' >&2; false; fi"
    },
    {
        id: 'shell',
        extension: 'sh',
        runner: 'sh "$__nexterm_script_file"'
    },
    {
        id: 'custom',
        extension: 'txt',
        runner: ''
    }
];

function normalizeScript(script) {
    return String(script || '').replace(/\r\n?/g, '\n');
}

function getScriptLanguage(languageId) {
    return SCRIPT_LANGUAGES.find(item => item.id === languageId) || SCRIPT_LANGUAGES[0];
}

function safeTaskId(taskId) {
    return String(taskId || `script-${Date.now().toString(36)}`).replace(/[^A-Za-z0-9_-]/g, '');
}

function safeExtension(extension) {
    return String(extension || 'txt')
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(0, 12);
}

function shellQuote(value) {
    return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function makeDelimiter(script) {
    let index = 0;
    let delimiter = '__NEXTERM_SCRIPT_EOF__';
    while (script.includes(delimiter)) {
        index += 1;
        delimiter = `__NEXTERM_SCRIPT_EOF_${index}__`;
    }
    return delimiter;
}

function customRunner(command) {
    const value = String(command || '').trim();
    if (!value) return '';
    if (value.includes('{file}')) return value.replace(/\{file\}/g, '"$__nexterm_script_file"');
    return `${value} "$__nexterm_script_file"`;
}

function scriptFileName(taskId, languageId) {
    const language = getScriptLanguage(languageId);
    return `.nexterm-${safeTaskId(taskId)}.${safeExtension(language.extension)}`;
}

function runnerFor(languageId, command) {
    const language = getScriptLanguage(languageId);
    return language.id === 'custom' ? customRunner(command) : language.runner;
}

function javascriptRuntime() {
    return `
import * as readline from 'node:readline';

const __nxRS = String.fromCharCode(30);
let __nxReqId = 0;
const __nxPending = new Map();
const __nxReader = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function __nxEncode(value = '') {
    return String(value)
        .replace(/%/g, '%25')
        .replace(/\\t/g, '%09')
        .replace(/\\r/g, '%0D')
        .replace(/\\n/g, '%0A')
        .replace(new RegExp(__nxRS, 'g'), '%1E');
}

function __nxDecode(value = '') {
    return String(value).replace(/%([0-9A-Fa-f]{2})/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}

__nxReader.on('line', line => {
    if (!line.startsWith(__nxRS + 'NEXTERM_RES\\t')) return;
    const body = line.slice(1, line.endsWith(__nxRS) ? -1 : undefined);
    const parts = body.split('\\t');
    const pending = __nxPending.get(parts[1]);
    if (!pending) return;
    __nxPending.delete(parts[1]);
    const payload = __nxDecode(parts[3] || '');
    if (parts[2] === 'ok') pending.resolve(payload);
    else pending.reject(new Error(payload || 'term request failed'));
});

function __nxRequest(action, payload = '', options = {}) {
    const id = String(++__nxReqId);
    const timeout = Number(options.timeout ?? 5000) || 5000;
    const regex = options.regex ? '1' : '0';
    process.stdout.write(__nxRS + 'NEXTERM_RPC\\t' + id + '\\t' + action + '\\t' + timeout + '\\t' + regex + '\\t' + __nxEncode(payload) + __nxRS + '\\n');
    return new Promise((resolve, reject) => __nxPending.set(id, { resolve, reject }));
}

globalThis.term = {
    send(text) {
        return __nxRequest('send', text);
    },
    expect(pattern, timeout = 5000, options = {}) {
        return __nxRequest('expect', pattern, { ...options, timeout });
    },
    async exec(command, options = {}) {
        const line = String(command).endsWith('\\n') ? String(command) : String(command) + '\\n';
        await this.send(line);
        return this.expect(options.expect ?? options.pattern ?? '$ ', options.timeout ?? 5000, options);
    },
    print(text) {
        process.stdout.write(String(text));
        return Promise.resolve('');
    }
};
`;
}

function pythonRuntime() {
    return `
import sys
import threading
import queue

_nx_rs = chr(30)
_nx_req_id = 0
_nx_responses = {}
_nx_lock = threading.Lock()

def _nx_encode(value=''):
    return str(value).replace('%', '%25').replace('\\t', '%09').replace('\\r', '%0D').replace('\\n', '%0A').replace(_nx_rs, '%1E')

def _nx_decode(value=''):
    import re
    return re.sub(r'%([0-9A-Fa-f]{2})', lambda m: chr(int(m.group(1), 16)), str(value))

def _nx_reader():
    for line in sys.stdin:
        line = line.rstrip('\\n')
        if not line.startswith(_nx_rs + 'NEXTERM_RES\\t'):
            continue
        body = line[1:-1] if line.endswith(_nx_rs) else line[1:]
        parts = body.split('\\t')
        if len(parts) < 4:
            continue
        q = _nx_responses.get(parts[1])
        if q:
            q.put((parts[2], _nx_decode(parts[3])))

threading.Thread(target=_nx_reader, daemon=True).start()

def _nx_request(action, payload='', timeout=5000, regex=False):
    global _nx_req_id
    with _nx_lock:
        _nx_req_id += 1
        req_id = str(_nx_req_id)
    q = queue.Queue(maxsize=1)
    _nx_responses[req_id] = q
    sys.stdout.write(_nx_rs + 'NEXTERM_RPC\\t' + req_id + '\\t' + action + '\\t' + str(int(timeout)) + '\\t' + ('1' if regex else '0') + '\\t' + _nx_encode(payload) + _nx_rs + '\\n')
    sys.stdout.flush()
    try:
        status, data = q.get(timeout=(float(timeout) / 1000.0) + 1.0)
    finally:
        _nx_responses.pop(req_id, None)
    if status != 'ok':
        raise RuntimeError(data or 'term request failed')
    return data

class _NxTerm:
    def send(self, text):
        return _nx_request('send', text)

    def expect(self, pattern, timeout=5000, regex=False):
        return _nx_request('expect', pattern, timeout=timeout, regex=regex)

    def exec(self, command, expect='$ ', timeout=5000, regex=False):
        line = str(command)
        if not line.endswith('\\n'):
            line += '\\n'
        self.send(line)
        return self.expect(expect, timeout=timeout, regex=regex)

    def print(self, text):
        sys.stdout.write(str(text))
        sys.stdout.flush()
        return ''

term = _NxTerm()
`;
}

function tclRuntime() {
    return `
set __nx_rs [format %c 30]
set __nx_req_id 0

proc __nx_encode {value} {
    global __nx_rs
    return [string map [list "%" "%25" "\\t" "%09" "\\r" "%0D" "\\n" "%0A" $__nx_rs "%1E"] $value]
}

proc __nx_decode {value} {
    global __nx_rs
    return [string map [list "%1E" $__nx_rs "%0A" "\\n" "%0D" "\\r" "%09" "\\t" "%25" "%"] $value]
}

proc __nx_request {action payload {timeout 5000} {regex 0}} {
    global __nx_rs __nx_req_id
    incr __nx_req_id
    set req_id $__nx_req_id
    puts -nonewline stdout "\${__nx_rs}NEXTERM_RPC\\t$req_id\\t$action\\t$timeout\\t$regex\\t[__nx_encode $payload]$__nx_rs\\n"
    flush stdout
    if {[gets stdin line] < 0} {
        error "term request failed"
    }
    if {![string match "\${__nx_rs}NEXTERM_RES\\t*" $line]} {
        error "invalid term response"
    }
    set body [string range $line 1 end-1]
    set parts [split $body "\\t"]
    set status [lindex $parts 2]
    set data [__nx_decode [lindex $parts 3]]
    if {$status ne "ok"} {
        error $data
    }
    return $data
}

proc term {method args} {
    switch -- $method {
        send {
            return [__nx_request send [lindex $args 0]]
        }
        expect {
            set timeout 5000
            if {[llength $args] > 1} { set timeout [lindex $args 1] }
            return [__nx_request expect [lindex $args 0] $timeout 0]
        }
        exec {
            set command [lindex $args 0]
            set expect "\\$ "
            set timeout 5000
            if {[llength $args] > 1} { set expect [lindex $args 1] }
            if {[llength $args] > 2} { set timeout [lindex $args 2] }
            term send "$command\\n"
            return [term expect $expect $timeout]
        }
        print {
            puts -nonewline stdout [lindex $args 0]
            flush stdout
            return ""
        }
        default {
            error "unknown term method: $method"
        }
    }
}
`;
}

function shellRuntime() {
    return `
__nx_rs=$(printf '\\036')
__nx_req_id=0
__nx_encode() {
    printf '%s' "$1" | od -An -tx1 -v | tr -d ' \\n' | sed 's/../%&/g'
}
__nx_decode() {
    printf '%s' "$1" | sed 's/%0A/\\
/g; s/%0D/\\r/g; s/%09/\\t/g; s/%25/%/g'
}
__nx_request() {
    __nx_req_id=$((__nx_req_id + 1))
    __nx_action=$1
    __nx_payload=$2
    __nx_timeout=\${3:-5000}
    printf '%sNEXTERM_RPC\\t%s\\t%s\\t%s\\t0\\t%s%s\\n' "$__nx_rs" "$__nx_req_id" "$__nx_action" "$__nx_timeout" "$(__nx_encode "$__nx_payload")" "$__nx_rs"
    IFS= read -r __nx_line || return 1
    __nx_body=\${__nx_line#"$__nx_rs"}
    __nx_body=\${__nx_body%"$__nx_rs"}
    __nx_status=$(printf '%s' "$__nx_body" | cut -f3)
    __nx_data=$(printf '%s' "$__nx_body" | cut -f4-)
    if [ "$__nx_status" != "ok" ]; then
        __nx_decode "$__nx_data" >&2
        return 1
    fi
    __nx_decode "$__nx_data"
}
term_send() { __nx_request send "$1"; }
term_expect() { __nx_request expect "$1" "\${2:-5000}"; }
term_exec() {
    __nx_cmd=$1
    __nx_expect=\${2:-'$ '}
    __nx_timeout=\${3:-5000}
    term_send "$__nx_cmd
"
    term_expect "$__nx_expect" "$__nx_timeout"
}
term_print() { printf '%s' "$1"; }
`;
}

function runtimeFor(languageId) {
    const language = getScriptLanguage(languageId);
    if (language.id === 'javascript') return javascriptRuntime();
    if (language.id === 'python') return pythonRuntime();
    if (language.id === 'tcl') return tclRuntime();
    if (language.id === 'shell') return shellRuntime();
    return '';
}

function scriptFileContent(languageId, content) {
    const script = normalizeScript(content);
    const runtime = runtimeFor(languageId);
    if (!runtime) return script;
    if (getScriptLanguage(languageId).id === 'javascript') return `${runtime}\n${script}\n\n__nxReader.close();`;
    return `${runtime}\n${script}`;
}

function buildScriptShellCommand({ taskId, languageId, command = '', content = '', cwd = '' } = {}) {
    const script = normalizeScript(content);
    if (!script.trim()) throw new Error('脚本内容不能为空');

    const runner = runnerFor(languageId, command);
    if (!runner) throw new Error('执行命令不能为空');

    const bodyContent = scriptFileContent(languageId, script);
    const body = bodyContent.endsWith('\n') ? bodyContent : `${bodyContent}\n`;
    const delimiter = makeDelimiter(body);
    const fileName = scriptFileName(taskId, languageId);
    const filePath = `./${fileName}`;
    const lines = [];
    if (cwd) lines.push(`cd ${shellQuote(cwd)} || exit 1`);
    lines.push(`__nexterm_script_file=${shellQuote(filePath)}`);
    lines.push('trap \'rm -f "$__nexterm_script_file"\' EXIT HUP INT TERM');
    lines.push(`cat > "$__nexterm_script_file" <<'${delimiter}'`);
    lines.push(body + delimiter);
    lines.push(runner);
    lines.push('__nexterm_script_status=$?');
    lines.push('rm -f "$__nexterm_script_file"');
    lines.push('exit "$__nexterm_script_status"');
    return lines.join('\n');
}

function shellForPlatform() {
    if (process.platform === 'win32') {
        return {
            command: process.env.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c']
        };
    }
    return {
        command: process.env.SHELL || '/bin/sh',
        args: ['-lc']
    };
}

function normalizeLocalCwd(cwd) {
    return cwd ? path.resolve(cwd) : process.cwd();
}

module.exports = {
    buildScriptShellCommand,
    getScriptLanguage,
    normalizeLocalCwd,
    normalizeScript,
    scriptFileContent,
    shellForPlatform
};
