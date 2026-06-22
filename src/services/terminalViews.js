import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { isLocalSessionProtocol } from '../models/resources';
import { getXtermTheme } from '../theme/themeManager';
import { normalizeTerminalHighlightRules } from './terminalHighlightRules';
import { eventBus } from '../utils/eventBus';

const views = new Map();
const FIT_DEBOUNCE_MS = 80;
const REFRESH_DELAYS_MS = [0, 80, 240];
const ACTIVATE_REFRESH_DELAYS_MS = [0, 50, 150, 400];
const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 2;
const HIGHLIGHT_REFRESH_DEBOUNCE_MS = 80;
const TERMINAL_HIGHLIGHT_LIMIT = 900;

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

function emitStatus(view, status, msg = '', payload = {}) {
    view.status = status;
    view.statusMsg = msg;
    view.session.status = status;
    view.statusListeners.forEach(listener => listener(status, msg, payload));
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

function clearTerminalHighlightTimer(view) {
    if (!view?.highlightTimer) return;
    window.clearTimeout(view.highlightTimer);
    view.highlightTimer = null;
}

function clearTerminalHighlightDecorations(view) {
    if (!view?.highlightDecorations?.length) return;
    view.highlightDecorations.forEach(item => {
        item.decoration?.dispose?.();
        item.marker?.dispose?.();
    });
    view.highlightDecorations = [];
}

function bufferLineToTextWithCells(line) {
    const cells = [];
    let text = '';
    for (let x = 0; x < line.length; x += 1) {
        const cell = line.getCell(x);
        if (!cell || cell.getWidth() === 0) continue;
        const chars = cell.getChars() || ' ';
        const start = text.length;
        text += chars;
        cells.push({
            start,
            end: text.length,
            x,
            width: Math.max(1, cell.getWidth())
        });
    }
    return { text, cells };
}

function findRuleMatches(text, rule) {
    if (rule.mode === 'regex') {
        let regex;
        try {
            regex = new RegExp(rule.text, rule.caseSensitive ? 'g' : 'gi');
        } catch (_err) {
            return [];
        }
        const matches = [];
        let match;
        while ((match = regex.exec(text)) !== null) {
            const value = match[0] || '';
            if (!value) {
                regex.lastIndex += 1;
                continue;
            }
            matches.push({ index: match.index, length: value.length, color: rule.color });
        }
        return matches;
    }

    const needle = rule.caseSensitive ? rule.text : rule.text.toLowerCase();
    if (!needle) return [];
    const haystack = rule.caseSensitive ? text : text.toLowerCase();
    const matches = [];
    let index = haystack.indexOf(needle);
    while (index >= 0) {
        matches.push({ index, length: needle.length, color: rule.color });
        index = haystack.indexOf(needle, index + Math.max(1, needle.length));
    }
    return matches;
}

function matchToCellRange(cells, start, length, cols) {
    const end = start + length;
    const first = cells.find(cell => cell.end > start);
    if (!first) return null;
    const after = cells.find(cell => cell.start >= end);
    const last = cells[cells.length - 1];
    const endX = after ? after.x : last.x + last.width;
    const x = Math.min(cols - 1, Math.max(0, first.x));
    const width = Math.min(cols - x, Math.max(1, endX - x));
    return width > 0 ? { x, width } : null;
}

function registerHighlightDecoration(view, row, x, width, color) {
    const buffer = view.term.buffer.active;
    const marker = view.term.registerMarker(row - buffer.baseY - buffer.cursorY);
    if (!marker) return false;
    const decoration = view.term.registerDecoration({
        marker,
        x,
        width,
        foregroundColor: color,
        layer: 'bottom'
    });
    if (!decoration) {
        marker.dispose();
        return false;
    }
    view.highlightDecorations.push({ marker, decoration });
    return true;
}

function refreshTerminalHighlights(view) {
    if (!view || view.disposed || !view.opened) return;
    clearTerminalHighlightTimer(view);
    clearTerminalHighlightDecorations(view);

    if (view.settings?.terminalHighlightEnabled === false) return;
    const rules = normalizeTerminalHighlightRules(view.settings?.terminalHighlightRules).filter(rule => rule.enabled);
    if (!rules.length) return;

    const buffer = view.term.buffer.active;
    const cols = Math.floor(Number(view.term.cols)) || 0;
    const rows = Math.floor(Number(view.term.rows)) || 0;
    if (!buffer || cols <= 0 || rows <= 0) return;

    const startRow = Math.max(0, buffer.viewportY || 0);
    const endRow = Math.min(buffer.length - 1, startRow + rows - 1);
    let count = 0;

    for (let row = startRow; row <= endRow && count < TERMINAL_HIGHLIGHT_LIMIT; row += 1) {
        const line = buffer.getLine(row);
        if (!line) continue;
        const { text, cells } = bufferLineToTextWithCells(line);
        if (!text.trim() || !cells.length) continue;

        for (const rule of rules) {
            const matches = findRuleMatches(text, rule);
            for (const match of matches) {
                const range = matchToCellRange(cells, match.index, match.length, cols);
                if (!range) continue;
                if (registerHighlightDecoration(view, row, range.x, range.width, match.color)) count += 1;
                if (count >= TERMINAL_HIGHLIGHT_LIMIT) return;
            }
        }
    }
}

function scheduleTerminalHighlightRefresh(view, options = {}) {
    if (!view || view.disposed || !view.opened) return;
    clearTerminalHighlightTimer(view);
    const delay = Math.max(0, Number(options.delay ?? HIGHLIGHT_REFRESH_DEBOUNCE_MS) || 0);
    view.highlightTimer = window.setTimeout(() => {
        window.requestAnimationFrame(() => refreshTerminalHighlights(view));
    }, delay);
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
        settings: { ...settings },
        searchResult: { resultIndex: 0, resultCount: 0 },
        shortcutHandler: null,
        selectionHandler: null,
        statusListeners: new Set(),
        disposables: [],
        fitTimer: null,
        refreshTimers: new Set(),
        highlightTimer: null,
        highlightDecorations: [],
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
    view.disposables.push(term.onWriteParsed(() => scheduleTerminalHighlightRefresh(view)));
    view.disposables.push(term.onScroll(() => scheduleTerminalHighlightRefresh(view, { delay: 0 })));
    view.disposables.push(term.onResize(() => scheduleTerminalHighlightRefresh(view, { delay: 0 })));
    view.disposables.push(
        eventBus.on('terminal:data', payload => {
            if (payload.sessionId !== view.sessionId || view.disposed) return;
            view.term.write(b64ToBytes(payload.b64));
        })
    );
    view.disposables.push(
        eventBus.on('terminal:status', payload => {
            if (payload.sessionId !== view.sessionId || view.disposed) return;
            emitStatus(view, payload.status, payload.msg, payload);
        })
    );

    views.set(session.sessionId, view);
    return view;
}

export function mountTerminalView(session, settings, host) {
    const view = views.get(session.sessionId) || createView(session, settings);
    view.session = session;
    view.settings = { ...settings };
    if (view.mountEl.parentElement !== host) {
        host.appendChild(view.mountEl);
    }
    if (!view.opened) {
        view.term.open(view.mountEl);
        view.opened = true;
    }
    scheduleTerminalHighlightRefresh(view, { delay: 0 });
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
    view.settings = { ...settings };
    view.term.options.theme = getXtermTheme(settings.themeId);
    view.term.options.fontFamily = settings.fontFamily;
    view.term.options.cursorBlink = settings.cursorBlink;
    view.term.options.cursorStyle = settings.cursorStyle;
    view.term.options.scrollback = settings.scrollback;
    if (settings.fontSize !== previousSettings.fontSize || settings.fontFamily !== previousSettings.fontFamily) {
        view.term.options.fontSize = settings.fontSize;
        scheduleTerminalViewFit(view, { delay: 0 });
    }
    scheduleTerminalHighlightRefresh(view, { delay: 0 });
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
    clearTerminalHighlightTimer(view);
    clearRefreshTimers(view);
    clearTerminalHighlightDecorations(view);
    view.statusListeners.clear();
    view.mountEl.remove();
    view.term.dispose();
    views.delete(sessionId);
}
