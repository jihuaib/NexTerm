export const DEFAULT_SCRIPT_LANGUAGE = 'javascript';

export const SCRIPT_LANGUAGES = [
    { id: 'javascript', label: 'JavaScript', extension: 'mjs' },
    { id: 'python', label: 'Python', extension: 'py' },
    { id: 'tcl', label: 'Tcl', extension: 'tcl' },
    { id: 'shell', label: 'Shell', extension: 'sh' },
    { id: 'custom', label: '自定义', extension: 'txt' }
];

export function getScriptLanguage(languageId) {
    return SCRIPT_LANGUAGES.find(item => item.id === languageId) || SCRIPT_LANGUAGES[0];
}

export function createScriptTaskId() {
    return `script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
