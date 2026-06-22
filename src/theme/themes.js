// 自研主题体系：单一主题对象同时驱动「应用外壳令牌」与「xterm 配色」
// app: 注入到 :root 的 CSS 变量；terminal: 喂给 xterm 的 ITheme

export const THEMES = {
    dark: {
        id: 'dark',
        name: '深色',
        app: {
            '--nx-bg': '#1e1e1e',
            '--nx-surface': '#252526',
            '--nx-surface-2': '#2d2d30',
            '--nx-border': '#3c3c3c',
            '--nx-text': '#d4d4d4',
            '--nx-text-dim': '#8a8a8a',
            '--nx-accent': '#0a84ff',
            '--nx-icon': '#0a84ff',
            '--nx-accent-text': '#ffffff',
            '--nx-danger': '#f14c4c',
            '--nx-success': '#2ecc71',
            '--nx-warning': '#f1c40f',
            '--nx-tab-active-bg': '#1e1e1e',
            '--nx-tab-inactive-bg': '#2d2d30'
        },
        terminal: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            cursor: '#d4d4d4',
            selectionBackground: '#264f78',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#ffffff'
        }
    },

    light: {
        id: 'light',
        name: '浅色',
        app: {
            '--nx-bg': '#ffffff',
            '--nx-surface': '#f3f3f3',
            '--nx-surface-2': '#e8e8e8',
            '--nx-border': '#d0d0d0',
            '--nx-text': '#1f1f1f',
            '--nx-text-dim': '#6b6b6b',
            '--nx-accent': '#0a66c2',
            '--nx-icon': '#0a84ff',
            '--nx-accent-text': '#ffffff',
            '--nx-danger': '#d13438',
            '--nx-success': '#16825d',
            '--nx-warning': '#a06d00',
            '--nx-tab-active-bg': '#ffffff',
            '--nx-tab-inactive-bg': '#e8e8e8'
        },
        terminal: {
            background: '#ffffff',
            foreground: '#333333',
            cursor: '#333333',
            selectionBackground: '#add6ff',
            black: '#000000',
            red: '#cd3131',
            green: '#107c10',
            yellow: '#949800',
            blue: '#0451a5',
            magenta: '#bc05bc',
            cyan: '#0598bc',
            white: '#555555',
            brightBlack: '#666666',
            brightRed: '#cd3131',
            brightGreen: '#14ce14',
            brightYellow: '#b5ba00',
            brightBlue: '#0451a5',
            brightMagenta: '#bc05bc',
            brightCyan: '#0598bc',
            brightWhite: '#a5a5a5'
        }
    },

    solarized: {
        id: 'solarized',
        name: 'Solarized',
        app: {
            '--nx-bg': '#002b36',
            '--nx-surface': '#073642',
            '--nx-surface-2': '#0a4250',
            '--nx-border': '#0f4b5a',
            '--nx-text': '#93a1a1',
            '--nx-text-dim': '#586e75',
            '--nx-accent': '#268bd2',
            '--nx-icon': '#268bd2',
            '--nx-accent-text': '#fdf6e3',
            '--nx-danger': '#dc322f',
            '--nx-success': '#859900',
            '--nx-warning': '#b58900',
            '--nx-tab-active-bg': '#002b36',
            '--nx-tab-inactive-bg': '#073642'
        },
        terminal: {
            background: '#002b36',
            foreground: '#839496',
            cursor: '#93a1a1',
            selectionBackground: '#073642',
            black: '#073642',
            red: '#dc322f',
            green: '#859900',
            yellow: '#b58900',
            blue: '#268bd2',
            magenta: '#d33682',
            cyan: '#2aa198',
            white: '#eee8d5',
            brightBlack: '#002b36',
            brightRed: '#cb4b16',
            brightGreen: '#586e75',
            brightYellow: '#657b83',
            brightBlue: '#839496',
            brightMagenta: '#6c71c4',
            brightCyan: '#93a1a1',
            brightWhite: '#fdf6e3'
        }
    },

    monokai: {
        id: 'monokai',
        name: 'Monokai',
        app: {
            '--nx-bg': '#272822',
            '--nx-surface': '#2f302a',
            '--nx-surface-2': '#3a3b33',
            '--nx-border': '#44453d',
            '--nx-text': '#f8f8f2',
            '--nx-text-dim': '#90908a',
            '--nx-accent': '#a6e22e',
            '--nx-icon': '#a6e22e',
            '--nx-accent-text': '#272822',
            '--nx-danger': '#f92672',
            '--nx-success': '#a6e22e',
            '--nx-warning': '#f4bf75',
            '--nx-tab-active-bg': '#272822',
            '--nx-tab-inactive-bg': '#3a3b33'
        },
        terminal: {
            background: '#272822',
            foreground: '#f8f8f2',
            cursor: '#f8f8f0',
            selectionBackground: '#49483e',
            black: '#272822',
            red: '#f92672',
            green: '#a6e22e',
            yellow: '#f4bf75',
            blue: '#66d9ef',
            magenta: '#ae81ff',
            cyan: '#a1efe4',
            white: '#f8f8f2',
            brightBlack: '#75715e',
            brightRed: '#f92672',
            brightGreen: '#a6e22e',
            brightYellow: '#f4bf75',
            brightBlue: '#66d9ef',
            brightMagenta: '#ae81ff',
            brightCyan: '#a1efe4',
            brightWhite: '#f9f8f5'
        }
    }
};

export const THEME_LIST = Object.values(THEMES).map(t => ({ id: t.id, name: t.name }));
