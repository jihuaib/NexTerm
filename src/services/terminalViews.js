import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { isLocalSessionProtocol } from '../models/resources';
import { getXtermTheme } from '../theme/themeManager';
import { eventBus } from '../utils/eventBus';

const views = new Map();
const FIT_DEBOUNCE_MS = 80;
const REFRESH_DELAYS_MS = [0, 80, 240];
const ACTIVATE_REFRESH_DELAYS_MS = [0, 50, 150, 400];
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 2;

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

function isVisible(view) {
    if (!view?.mountEl?.isConnected || document.visibilityState === 'hidden') return false;
    const rect = view.mountEl.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function validSize(cols, rows) {
    return Number.isFinite(cols) && Number.isFinite(rows) && cols >= MIN_TERMINAL_COLS && rows >= MIN_TERMINAL_ROWS;
}

function currentSize(view) {
    const cols = Math.floor(Number(view?.term?.cols));
    const rows = Math.floor(Number(view?.term?.rows));
    return validSize(cols, rows) ? { cols, rows } : null;
}

function clearRefreshTimers(view) {
    view.refreshTimers.forEach(timer => window.clearTimeout(timer));
    view.refreshTimers.clear();
}

function refreshVisibleRows(view) {
    if (!view || view.disposed || !view.opened || !isVisible(view)) return;
    const rows = Math.floor(Number(view.term.rows)) || 0;
    if (rows <= 0) return;
    view.term.refresh(0, rows - 1);
}

function queueTerminalRefresh(view, delays = REFRESH_DELAYS_MS) {
    if (!view || view.disposed || !view.opened) return;
    clearRefreshTimers(view);
    delays.forEach(delay => {
        const timer = window.setTimeout(() => {
            view.refreshTimers.delete(timer);
            window.requestAnimationFrame(() => refreshVisibleRows(view));
        }, delay);
        view.refreshTimers.add(timer);
    });
}

function reportTerminalSize(view) {
    const size = currentSize(view);
    if (!size) return;
    if (view.lastReportedSize.cols === size.cols && view.lastReportedSize.rows === size.rows) return;
    view.lastReportedSize = size;
    window.terminalApi.resize(view.sessionId, size.cols, size.rows);
}

function isWindowsPlatform() {
    return /Win/i.test(navigator.platform || '') || /Windows/i.test(navigator.userAgent || '');
}

function terminalCompatibilityOptions(session) {
    if (!isWindowsPlatform() || !isLocalSessionProtocol(session?.protocol)) return {};
    return { windowsMode: true };
}

function createView(session, settings) {
    const term = new Terminal({
        cursorBlink: settings.cursorBlink,
        cursorStyle: settings.cursorStyle,
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily,
        theme: getXtermTheme(settings.themeId),
        scrollback: settings.scrollback,
        allowProposedApi: true,
        ...terminalCompatibilityOptions(session)
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
        disposables: [],
        fitTimer: null,
        refreshTimers: new Set(),
        lastReportedSize: { cols: 0, rows: 0 }
    };

    term.attachCustomKeyEventHandler(event => {
        if (typeof view.shortcutHandler !== 'function') return true;
        return view.shortcutHandler(event);
    });

    view.disposables.push(term.onData(data => window.terminalApi.sendInput(view.sessionId, data)));
    view.disposables.push(
        searchAddon.onDidChangeResults(result => {
            view.searchResult = result || { resultIndex: 0, resultCount: 0 };
        })
    );
    view.disposables.push(
        term.onSelectionChange(() => {
            if (typeof view.selectionHandler === 'function') view.selectionHandler(view.term.getSelection());
        })
    );
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

export function fitTerminalView(view, options = {}) {
    if (!view || view.disposed || !view.opened) return;
    if (!isVisible(view)) return;
    try {
        view.fitAddon.fit();
        reportTerminalSize(view);
        if (options.refresh !== false) queueTerminalRefresh(view, options.refreshDelays);
    } catch (_err) {
        /* hidden or detached terminal containers cannot always be measured */
    }
}

export function scheduleTerminalViewFit(view, options = {}) {
    if (!view || view.disposed || !view.opened) return;
    if (view.fitTimer) window.clearTimeout(view.fitTimer);
    const delay = Math.max(0, Number(options.delay ?? FIT_DEBOUNCE_MS) || 0);
    view.fitTimer = window.setTimeout(() => {
        view.fitTimer = null;
        window.requestAnimationFrame(() => fitTerminalView(view, options));
    }, delay);
}

export function activateTerminalView(view) {
    scheduleTerminalViewFit(view, { delay: 0, refreshDelays: ACTIVATE_REFRESH_DELAYS_MS });
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
        scheduleTerminalViewFit(view, { delay: 0 });
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
    if (view.fitTimer) window.clearTimeout(view.fitTimer);
    clearRefreshTimers(view);
    view.statusListeners.clear();
    view.mountEl.remove();
    view.term.dispose();
    views.delete(sessionId);
}
