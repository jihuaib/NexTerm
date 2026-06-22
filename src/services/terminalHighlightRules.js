export const DEFAULT_TERMINAL_HIGHLIGHT_RULES = Object.freeze([
    { id: 'error', label: '错误', text: 'error', color: '#ff5f57', enabled: true, caseSensitive: false },
    { id: 'failed', label: '失败', text: 'failed', color: '#ff5f57', enabled: true, caseSensitive: false },
    { id: 'fatal', label: '致命错误', text: 'fatal', color: '#ff5f57', enabled: true, caseSensitive: false },
    { id: 'exception', label: '异常', text: 'exception', color: '#ff5f57', enabled: true, caseSensitive: false },
    { id: 'warning', label: '警告', text: 'warning', color: '#fbbf24', enabled: true, caseSensitive: false },
    { id: 'warn', label: 'WARN', text: 'warn', color: '#fbbf24', enabled: true, caseSensitive: false },
    { id: 'timeout', label: '超时', text: 'timeout', color: '#fb923c', enabled: true, caseSensitive: false },
    { id: 'success', label: '成功', text: 'success', color: '#34d399', enabled: true, caseSensitive: false },
    { id: 'connected', label: '已连接', text: 'connected', color: '#34d399', enabled: true, caseSensitive: false },
    { id: 'done', label: '完成', text: 'done', color: '#38bdf8', enabled: true, caseSensitive: false },
    {
        id: 'ipv4',
        label: 'IPv4 地址',
        text: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b`,
        mode: 'regex',
        color: '#38bdf8',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'mac',
        label: 'MAC 地址',
        text: String.raw`\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b`,
        mode: 'regex',
        color: '#22d3ee',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'ipv6',
        label: 'IPv6 地址',
        text: String.raw`\b(?:(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}|[0-9a-f]{1,4}::[0-9a-f]{0,4}|::1)\b`,
        mode: 'regex',
        color: '#2dd4bf',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'timestamp',
        label: '时间戳',
        text: String.raw`\b\d{4}-\d{2}-\d{2}[T ][0-2]\d:[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?\b`,
        mode: 'regex',
        color: '#a78bfa',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'date',
        label: '日期',
        text: String.raw`\b\d{4}-\d{2}-\d{2}\b`,
        mode: 'regex',
        color: '#c084fc',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'time',
        label: '时间',
        text: String.raw`\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,6})?)?\b`,
        mode: 'regex',
        color: '#c084fc',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'url',
        label: 'URL',
        text: String.raw`\bhttps?:\/\/[^\s"'<>]+`,
        mode: 'regex',
        color: '#60a5fa',
        enabled: true,
        caseSensitive: false
    },
    {
        id: 'uuid',
        label: 'UUID',
        text: String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b`,
        mode: 'regex',
        color: '#f472b6',
        enabled: true,
        caseSensitive: false
    }
]);

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const DEFAULT_RULE_IDS = new Set(DEFAULT_TERMINAL_HIGHLIGHT_RULES.map(rule => rule.id));
const DEFAULT_RULE_BY_ID = new Map(DEFAULT_TERMINAL_HIGHLIGHT_RULES.map(rule => [rule.id, rule]));

export function createDefaultTerminalHighlightRules() {
    return DEFAULT_TERMINAL_HIGHLIGHT_RULES.map(rule => ({ ...rule }));
}

export function normalizeHexColor(value, fallback = '#38bdf8') {
    const color = String(value || '').trim();
    return HEX_COLOR_RE.test(color) ? color.toLowerCase() : fallback;
}

export function normalizeTerminalHighlightMode(value) {
    return value === 'regex' ? 'regex' : 'text';
}

export function isDefaultTerminalHighlightRule(id) {
    return DEFAULT_RULE_IDS.has(id);
}

export function normalizeTerminalHighlightRules(value) {
    const source = Array.isArray(value) ? value : createDefaultTerminalHighlightRules();
    return source
        .map((rule, index) => {
            const id = String(rule?.id || '').trim();
            const text = String(rule?.text || '').trim();
            if (!text) return null;
            const defaultRule = DEFAULT_RULE_BY_ID.get(id);
            const label = String(rule?.label || defaultRule?.label || '自定义规则').trim();
            return {
                id: id || `highlight-${index}-${text}`,
                label,
                text,
                mode: normalizeTerminalHighlightMode(rule?.mode),
                color: normalizeHexColor(rule?.color),
                enabled: rule?.enabled !== false,
                caseSensitive: Boolean(rule?.caseSensitive)
            };
        })
        .filter(Boolean);
}

export function mergeMissingDefaultTerminalHighlightRules(value) {
    const rules = normalizeTerminalHighlightRules(value);
    const existingIds = new Set(rules.map(rule => rule.id));
    const missingDefaults = createDefaultTerminalHighlightRules().filter(
        rule => DEFAULT_RULE_IDS.has(rule.id) && !existingIds.has(rule.id)
    );
    return normalizeTerminalHighlightRules([...rules, ...missingDefaults]);
}
