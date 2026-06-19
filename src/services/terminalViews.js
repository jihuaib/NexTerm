import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { getXtermTheme } from '../theme/themeManager';
import { eventBus } from '../utils/eventBus';

const views = new Map();

function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
}

function createMountElement() {
    const el = document.createElement('div');
    el.className = 'xterm-mount';
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.overflow = 'hidden';
    return el;
}

const SEARCH_DECORATIONS = {
    matchBackground: '#5d4b1f',
    matchBorder: '#d7a928',
    matchOverviewRuler: '#d7a928',
    activeMatchBackground: '#1f5d50',
    activeMatchBorder: '#2dd4bf',
    activeMatchColorOverviewRuler: '#2dd4bf'
};

function emitStatus(view, status, msg = '') {
    view.status = status;
    view.statusMsg = msg;
    view.session.status = status;
    view.statusListeners.forEach(listener => listener(status, msg));
}

function createView(session, settings) {
    const term = new Terminal({
        cursorBlink: settings.cursorBlink,
        cursorStyle: settings.cursorStyle,
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily,
        theme: getXtermTheme(settings.themeId),
        scrollback: settings.scrollback,
        allowProposedApi: true
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon({ highlightLimit: 2000 });
    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);

    const view = {
        session,
        sessionId: session.sessionId,
        term,
        fitAddon,
        searchAddon,
        mountEl: createMountElement(),
        opened: false,
        disposed: false,
        status: session.status || 'connecting',
        statusMsg: '',
        searchResult: { resultIndex: 0, resultCount: 0 },
        shortcutHandler: null,
        selectionHandler: null,
        statusListeners: new Set(),
        disposables: []
    };

    term.attachCustomKeyEventHandler(event => {
        if (typeof view.shortcutHandler !== 'function') return true;
        return view.shortcutHandler(event);
    });

    view.disposables.push(term.onData(data => window.terminalApi.sendInput(view.sessionId, data)));
    view.disposables.push(searchAddon.onDidChangeResults(result => {
        view.searchResult = result || { resultIndex: 0, resultCount: 0 };
    }));
    view.disposables.push(term.onSelectionChange(() => {
        if (typeof view.selectionHandler === 'function') view.selectionHandler(view.term.getSelection());
    }));
    view.disposables.push(
        eventBus.on('terminal:data', payload => {
            if (payload.sessionId !== view.sessionId || view.disposed) return;
            view.term.write(b64ToBytes(payload.b64));
        })
    );
    view.disposables.push(
        eventBus.on('terminal:status', payload => {
            if (payload.sessionId !== view.sessionId || view.disposed) return;
            emitStatus(view, payload.status, payload.msg);
        })
    );

    views.set(session.sessionId, view);
    return view;
}

export function mountTerminalView(session, settings, host) {
    const view = views.get(session.sessionId) || createView(session, settings);
    view.session = session;
    if (view.mountEl.parentElement !== host) {
        host.appendChild(view.mountEl);
    }
    if (!view.opened) {
        view.term.open(view.mountEl);
        view.opened = true;
    }
    return view;
}

export function fitTerminalView(view) {
    if (!view || view.disposed || !view.opened) return;
    try {
        view.fitAddon.fit();
        window.terminalApi.resize(view.sessionId, view.term.cols, view.term.rows);
    } catch (_err) {
        /* hidden or detached terminal containers cannot always be measured */
    }
}

export function focusTerminalView(view) {
    if (!view || view.disposed || !view.opened) return;
    view.term.focus();
}

export function updateTerminalViewSettings(view, settings, previousSettings = {}) {
    if (!view || view.disposed) return;
    view.term.options.theme = getXtermTheme(settings.themeId);
    view.term.options.fontFamily = settings.fontFamily;
    view.term.options.cursorBlink = settings.cursorBlink;
    view.term.options.cursorStyle = settings.cursorStyle;
    view.term.options.scrollback = settings.scrollback;
    if (settings.fontSize !== previousSettings.fontSize || settings.fontFamily !== previousSettings.fontFamily) {
        view.term.options.fontSize = settings.fontSize;
        fitTerminalView(view);
    }
}

export function onTerminalViewStatus(view, listener) {
    if (!view || view.disposed || typeof listener !== 'function') return () => {};
    view.statusListeners.add(listener);
    return () => view.statusListeners.delete(listener);
}

export function setTerminalShortcutHandler(view, handler) {
    if (!view || view.disposed) return;
    view.shortcutHandler = typeof handler === 'function' ? handler : null;
}

export function setTerminalSelectionHandler(view, handler) {
    if (!view || view.disposed) return;
    view.selectionHandler = typeof handler === 'function' ? handler : null;
}

function searchOptions(options = {}) {
    return {
        regex: Boolean(options.regex),
        wholeWord: Boolean(options.wholeWord),
        caseSensitive: Boolean(options.caseSensitive),
        incremental: Boolean(options.incremental),
        decorations: SEARCH_DECORATIONS
    };
}

export function findTerminalNext(view, term, options = {}) {
    if (!view || view.disposed || !term) return { found: false, resultIndex: 0, resultCount: 0 };
    const found = view.searchAddon.findNext(term, searchOptions(options));
    return { found, ...view.searchResult };
}

export function findTerminalPrevious(view, term, options = {}) {
    if (!view || view.disposed || !term) return { found: false, resultIndex: 0, resultCount: 0 };
    const found = view.searchAddon.findPrevious(term, searchOptions(options));
    return { found, ...view.searchResult };
}

export function clearTerminalSearch(view) {
    if (!view || view.disposed) return;
    view.searchAddon.clearDecorations();
    view.term.clearSelection();
    view.searchResult = { resultIndex: 0, resultCount: 0 };
}

export function getTerminalViewSize(view) {
    if (!view || view.disposed) return { cols: 80, rows: 24 };
    return {
        cols: view.term.cols || 80,
        rows: view.term.rows || 24
    };
}

export function disposeTerminalView(sessionId) {
    const view = views.get(sessionId);
    if (!view) return;
    view.disposed = true;
    view.disposables.forEach(disposable => {
        if (typeof disposable === 'function') disposable();
        else disposable?.dispose?.();
    });
    view.statusListeners.clear();
    view.mountEl.remove();
    view.term.dispose();
    views.delete(sessionId);
}
