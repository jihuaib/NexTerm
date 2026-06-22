export const COMMAND_SET_COLOR_OPTIONS = [
    {
        id: 'blue',
        label: '蓝色',
        swatch: '#3b82f6',
        bg: 'rgba(59, 130, 246, 0.14)',
        border: 'rgba(59, 130, 246, 0.48)'
    },
    {
        id: 'green',
        label: '绿色',
        swatch: '#10b981',
        bg: 'rgba(16, 185, 129, 0.14)',
        border: 'rgba(16, 185, 129, 0.48)'
    },
    {
        id: 'amber',
        label: '琥珀',
        swatch: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.14)',
        border: 'rgba(245, 158, 11, 0.5)'
    },
    {
        id: 'violet',
        label: '紫色',
        swatch: '#8b5cf6',
        bg: 'rgba(139, 92, 246, 0.14)',
        border: 'rgba(139, 92, 246, 0.48)'
    },
    {
        id: 'rose',
        label: '玫红',
        swatch: '#f43f5e',
        bg: 'rgba(244, 63, 94, 0.14)',
        border: 'rgba(244, 63, 94, 0.48)'
    },
    {
        id: 'cyan',
        label: '青色',
        swatch: '#06b6d4',
        bg: 'rgba(6, 182, 212, 0.14)',
        border: 'rgba(6, 182, 212, 0.48)'
    }
];

export function getCommandSetColorOption(colorId) {
    return COMMAND_SET_COLOR_OPTIONS.find(color => color.id === colorId) || COMMAND_SET_COLOR_OPTIONS[0];
}

export function normalizeCommandSetCommands(value) {
    const list = Array.isArray(value) ? value : String(value || '').replace(/\r/g, '').split('\n');
    return list.map(line => String(line || '').trimEnd()).filter(line => line.trim());
}

export function commandSetCommandsToText(commands) {
    return normalizeCommandSetCommands(commands).join('\n');
}

export function normalizeCommandSet(def = {}) {
    const color = getCommandSetColorOption(def.color);
    return {
        id: def.id || '',
        name: String(def.name || '').trim() || '新建指令集',
        color: color.id,
        commands: normalizeCommandSetCommands(def.commands),
        description: String(def.description || ''),
        createdAt: def.createdAt || '',
        updatedAt: def.updatedAt || ''
    };
}
