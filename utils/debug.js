/**
 * debug.js — Enhanced Debug Utility
 *
 * Captures all console output into a buffer so it can be
 * copied to clipboard via the floating debug panel.
 * Debug mode is ON by default for troubleshooting.
 */

let isDebugMode = true; // ON by default for troubleshooting

// --- Console Capture Buffer ---
const MAX_LOG_ENTRIES = 2000;
const logBuffer = [];

// Store original console methods
const _origConsoleLog = console.log.bind(console);
const _origConsoleWarn = console.warn.bind(console);
const _origConsoleError = console.error.bind(console);
const _origConsoleInfo = console.info.bind(console);

function timestamp() {
    const now = new Date();
    return now.toISOString().slice(11, 23); // HH:MM:SS.mmm
}

function stringify(args) {
    return args.map(a => {
        if (a === null) return 'null';
        if (a === undefined) return 'undefined';
        if (typeof a === 'string') return a;
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ''}`;
        try {
            return JSON.stringify(a, null, 2);
        } catch (e) {
            return String(a);
        }
    }).join(' ');
}

function pushEntry(level, args) {
    const entry = `[${timestamp()}] [${level}] ${stringify(args)}`;
    logBuffer.push(entry);
    if (logBuffer.length > MAX_LOG_ENTRIES) {
        logBuffer.shift();
    }
    // Update the debug panel if it exists
    if (typeof window !== 'undefined') {
        const panel = document.getElementById('debug-console-output');
        if (panel) {
            const line = document.createElement('div');
            line.className = `debug-line debug-${level.toLowerCase()}`;
            line.textContent = entry;
            panel.appendChild(line);
            panel.scrollTop = panel.scrollHeight;

            // Update the badge counter
            const badge = document.getElementById('debug-badge');
            if (badge) {
                const errorCount = logBuffer.filter(l => l.includes('[ERROR]') || l.includes('[WARN]')).length;
                if (errorCount > 0) {
                    badge.textContent = errorCount;
                    badge.style.display = 'inline-block';
                }
            }
        }
    }
}

// Override console methods to capture output
console.log = function(...args) {
    pushEntry('LOG', args);
    _origConsoleLog(...args);
};

console.warn = function(...args) {
    pushEntry('WARN', args);
    _origConsoleWarn(...args);
};

console.error = function(...args) {
    pushEntry('ERROR', args);
    _origConsoleError(...args);
};

console.info = function(...args) {
    pushEntry('INFO', args);
    _origConsoleInfo(...args);
};

// Capture unhandled errors
if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
        pushEntry('UNCAUGHT', [`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`]);
    });

    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        const msg = reason instanceof Error
            ? `${reason.message}\n${reason.stack || ''}`
            : String(reason);
        pushEntry('UNHANDLED_PROMISE', [msg]);
    });
}

// --- Public API ---

export function setDebugMode(enabled) {
    isDebugMode = enabled;
}

export function log(prefix, ...args) {
    if (isDebugMode) {
        console.log(`[${prefix}]`, ...args);
    }
}

/**
 * Returns the full captured log buffer as a single string.
 */
export function getLogBuffer() {
    return logBuffer.join('\n');
}

/**
 * Copies all captured console output to clipboard.
 * Returns a promise that resolves when copy is complete.
 */
export async function copyLogsToClipboard() {
    const text = getLogBuffer();
    if (!text) {
        _origConsoleLog('[Debug] No log entries to copy.');
        return false;
    }
    try {
        await navigator.clipboard.writeText(text);
        _origConsoleLog('[Debug] Logs copied to clipboard successfully.');
        return true;
    } catch (err) {
        // Fallback: textarea copy
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            _origConsoleLog('[Debug] Logs copied to clipboard (fallback).');
            return true;
        } catch (e) {
            _origConsoleError('[Debug] Failed to copy logs:', e);
            return false;
        }
    }
}

/**
 * Clears the log buffer and debug panel.
 */
export function clearLogs() {
    logBuffer.length = 0;
    const panel = document.getElementById('debug-console-output');
    if (panel) panel.innerHTML = '';
    const badge = document.getElementById('debug-badge');
    if (badge) badge.style.display = 'none';
}

/**
 * Creates and injects the floating debug panel into the page.
 * Call this once after the DOM is ready.
 */
export function injectDebugPanel() {
    if (document.getElementById('debug-panel-container')) return; // already injected

    const container = document.createElement('div');
    container.id = 'debug-panel-container';
    container.innerHTML = `
        <style>
            #debug-panel-container {
                position: fixed;
                bottom: 16px;
                right: 16px;
                z-index: 999999;
                font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
                font-size: 11px;
            }
            #debug-toggle-btn {
                width: 48px;
                height: 48px;
                border-radius: 50%;
                background: #1a1a2e;
                color: #0f0;
                border: 2px solid #0f0;
                cursor: pointer;
                font-size: 18px;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 4px 16px rgba(0,255,0,0.3);
                position: relative;
                transition: background 0.2s;
                margin-left: auto;
            }
            #debug-toggle-btn:hover {
                background: #0f0;
                color: #1a1a2e;
            }
            #debug-badge {
                position: absolute;
                top: -4px;
                right: -4px;
                background: #ff4444;
                color: #fff;
                border-radius: 50%;
                width: 20px;
                height: 20px;
                font-size: 10px;
                display: none;
                align-items: center;
                justify-content: center;
                font-weight: bold;
                line-height: 20px;
                text-align: center;
            }
            #debug-panel {
                display: none;
                width: 420px;
                max-width: 90vw;
                max-height: 50vh;
                background: #0d1117;
                border: 1px solid #30363d;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 8px 32px rgba(0,0,0,0.6);
                margin-bottom: 8px;
                flex-direction: column;
            }
            #debug-panel.open {
                display: flex;
            }
            #debug-panel-header {
                background: #161b22;
                padding: 8px 12px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                border-bottom: 1px solid #30363d;
                flex-shrink: 0;
            }
            #debug-panel-header span {
                color: #58a6ff;
                font-weight: 600;
                font-size: 12px;
            }
            .debug-panel-actions {
                display: flex;
                gap: 6px;
            }
            .debug-action-btn {
                padding: 4px 10px;
                border: 1px solid #30363d;
                border-radius: 4px;
                background: #21262d;
                color: #c9d1d9;
                cursor: pointer;
                font-size: 11px;
                transition: background 0.15s;
            }
            .debug-action-btn:hover {
                background: #30363d;
            }
            .debug-action-btn.copy-btn {
                background: #238636;
                border-color: #2ea043;
                color: #fff;
            }
            .debug-action-btn.copy-btn:hover {
                background: #2ea043;
            }
            #debug-console-output {
                flex: 1;
                overflow-y: auto;
                padding: 8px;
                color: #c9d1d9;
                line-height: 1.5;
                min-height: 100px;
                max-height: calc(50vh - 60px);
            }
            .debug-line {
                white-space: pre-wrap;
                word-break: break-all;
                padding: 1px 0;
            }
            .debug-error {
                color: #f85149;
            }
            .debug-warn {
                color: #d29922;
            }
            .debug-info {
                color: #58a6ff;
            }
            .debug-log {
                color: #c9d1d9;
            }
            #debug-copy-toast {
                position: fixed;
                bottom: 80px;
                right: 16px;
                background: #238636;
                color: #fff;
                padding: 8px 16px;
                border-radius: 6px;
                font-size: 12px;
                opacity: 0;
                transition: opacity 0.3s;
                z-index: 9999999;
                pointer-events: none;
            }
            #debug-copy-toast.show {
                opacity: 1;
            }
        </style>
        <div id="debug-panel">
            <div id="debug-panel-header">
                <span>Debug Console</span>
                <div class="debug-panel-actions">
                    <button class="debug-action-btn" id="debug-clear-btn">Clear</button>
                    <button class="debug-action-btn copy-btn" id="debug-copy-btn">Copy All</button>
                </div>
            </div>
            <div id="debug-console-output"></div>
        </div>
        <button id="debug-toggle-btn" title="Toggle Debug Console">
            🐛
            <span id="debug-badge">0</span>
        </button>
        <div id="debug-copy-toast">Logs copied to clipboard!</div>
    `;
    document.body.appendChild(container);

    // Populate existing buffer entries into the panel
    const outputEl = document.getElementById('debug-console-output');
    for (const entry of logBuffer) {
        const line = document.createElement('div');
        let cls = 'debug-log';
        if (entry.includes('[ERROR]') || entry.includes('[UNCAUGHT]') || entry.includes('[UNHANDLED_PROMISE]')) cls = 'debug-error';
        else if (entry.includes('[WARN]')) cls = 'debug-warn';
        else if (entry.includes('[INFO]')) cls = 'debug-info';
        line.className = `debug-line ${cls}`;
        line.textContent = entry;
        outputEl.appendChild(line);
    }
    outputEl.scrollTop = outputEl.scrollHeight;

    // Update badge
    const errorCount = logBuffer.filter(l => l.includes('[ERROR]') || l.includes('[WARN]') || l.includes('[UNCAUGHT]') || l.includes('[UNHANDLED_PROMISE]')).length;
    const badge = document.getElementById('debug-badge');
    if (errorCount > 0) {
        badge.textContent = errorCount;
        badge.style.display = 'inline-block';
    }

    // Wire up events
    const toggleBtn = document.getElementById('debug-toggle-btn');
    const panel = document.getElementById('debug-panel');
    toggleBtn.addEventListener('click', () => {
        panel.classList.toggle('open');
    });

    document.getElementById('debug-copy-btn').addEventListener('click', async () => {
        const success = await copyLogsToClipboard();
        const toast = document.getElementById('debug-copy-toast');
        toast.textContent = success ? 'Logs copied to clipboard!' : 'Failed to copy logs';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    });

    document.getElementById('debug-clear-btn').addEventListener('click', () => {
        clearLogs();
    });
}
