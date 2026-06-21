const MIN_TERMINAL_COLS = 2;
const MIN_TERMINAL_ROWS = 2;
const DEFAULT_TERMINAL_COLS = 80;
const DEFAULT_TERMINAL_ROWS = 24;

function positiveInteger(value) {
    const next = Math.floor(Number(value));
    return Number.isFinite(next) ? next : 0;
}

function normalizeTerminalSize(cols, rows, fallback = {}) {
    const rawFallbackCols = positiveInteger(fallback.cols);
    const rawFallbackRows = positiveInteger(fallback.rows);
    const fallbackCols = rawFallbackCols >= MIN_TERMINAL_COLS ? rawFallbackCols : DEFAULT_TERMINAL_COLS;
    const fallbackRows = rawFallbackRows >= MIN_TERMINAL_ROWS ? rawFallbackRows : DEFAULT_TERMINAL_ROWS;
    const nextCols = positiveInteger(cols);
    const nextRows = positiveInteger(rows);

    return {
        cols: nextCols >= MIN_TERMINAL_COLS ? nextCols : fallbackCols,
        rows: nextRows >= MIN_TERMINAL_ROWS ? nextRows : fallbackRows
    };
}

function sameTerminalSize(a = {}, b = {}) {
    return positiveInteger(a.cols) === positiveInteger(b.cols) && positiveInteger(a.rows) === positiveInteger(b.rows);
}

module.exports = {
    normalizeTerminalSize,
    sameTerminalSize
};
