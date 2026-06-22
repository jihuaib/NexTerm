import { THEMES } from './themes';

// 应用主题：把主题的 app 令牌注入到文档根 :root（自研组件全部消费这些 CSS 变量）
export function applyAppTheme(themeId) {
    const theme = THEMES[themeId] || THEMES.dark;
    const root = document.documentElement;
    Object.entries(theme.app).forEach(([key, value]) => {
        root.style.setProperty(key, value);
    });
    root.setAttribute('data-theme', theme.id);
    return theme;
}

// 取 xterm 的 ITheme
export function getXtermTheme(themeId) {
    const theme = THEMES[themeId] || THEMES.dark;
    const terminal = theme.id === 'light' ? THEMES.dark.terminal : theme.terminal;
    return {
        ...terminal,
        background: '#000000'
    };
}
