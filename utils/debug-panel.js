/**
 * Mobile-friendly Debug Panel Module
 * Provides a visual debug panel for debugging on any device
 *
 * Logs persist across page navigations within the same browser session
 * using sessionStorage, making it easier to track flows across views.
 *
 * Usage:
 *   import { initDebugPanel, debugLog } from '/utils/debug-panel.js';
 *   initDebugPanel(); // Call once on page load
 *   debugLog('Action description', { any: 'data' }, 'info'); // Log entries
 *
 * Types: 'info', 'success', 'error', 'data'
 */

const STORAGE_KEY = 'wtfun_debug_logs';
const MAX_PERSISTED_LOGS = 500; // Limit stored logs to prevent storage bloat

let debugLogs = [];
let debugPanel = null;
let debugToggle = null;
let debugLogContent = null;
let isInitialized = false;

/**
 * Load persisted debug logs from sessionStorage
 */
function loadPersistedLogs() {
    try {
        const stored = sessionStorage.getItem(STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (e) {
        console.warn('[Debug Panel] Failed to load persisted logs:', e);
    }
    return [];
}

/**
 * Save debug logs to sessionStorage
 */
function persistLogs() {
    try {
        // Keep only the most recent logs to prevent storage overflow
        const logsToStore = debugLogs.slice(-MAX_PERSISTED_LOGS);
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(logsToStore));
    } catch (e) {
        console.warn('[Debug Panel] Failed to persist logs:', e);
    }
}

/**
 * Render a single log entry to the panel
 * @param {Object} entry - Log entry with timestamp, action, data, type
 * @param {boolean} isPersisted - Whether this is a log from a previous page
 */
function renderLogEntry(entry, isPersisted = false) {
    if (!debugLogContent) return;

    const entryEl = document.createElement('div');
    entryEl.className = 'debug-entry' + (isPersisted ? ' debug-entry-persisted' : '');

    let dataClass = '';
    if (entry.type === 'error') dataClass = 'debug-error';
    else if (entry.type === 'success') dataClass = 'debug-success';

    let html = `<div class="debug-timestamp">${entry.timestamp}</div>`;
    html += `<div class="debug-action ${dataClass}">[${entry.type.toUpperCase()}] ${escapeHtml(entry.action)}</div>`;

    if (entry.data !== null && entry.data !== undefined) {
        const dataStr = typeof entry.data === 'object' ? JSON.stringify(entry.data, null, 2) : String(entry.data);
        html += `<div class="debug-data">${escapeHtml(dataStr)}</div>`;
    }

    entryEl.innerHTML = html;
    debugLogContent.appendChild(entryEl);
}

/**
 * Render all persisted logs from sessionStorage
 */
function renderPersistedLogs() {
    if (!debugLogContent || debugLogs.length === 0) return;

    // Add a separator to show these are from previous pages
    const separator = document.createElement('div');
    separator.className = 'debug-separator';
    separator.innerHTML = `<span>--- Logs from previous pages (${debugLogs.length} entries) ---</span>`;
    debugLogContent.appendChild(separator);

    // Render each persisted log
    for (const entry of debugLogs) {
        renderLogEntry(entry, true);
    }

    // Add another separator
    const endSeparator = document.createElement('div');
    endSeparator.className = 'debug-separator';
    endSeparator.innerHTML = '<span>--- Current page logs below ---</span>';
    debugLogContent.appendChild(endSeparator);

    // Scroll to bottom
    debugPanel.scrollTop = debugPanel.scrollHeight;
}

/**
 * Escape HTML for safe display
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Initialize the debug panel by injecting HTML and setting up event listeners
 * @param {string} title - Optional title for the debug panel (default: 'Debug Log')
 */
export function initDebugPanel(title = 'Debug Log') {
    if (isInitialized) {
        console.warn('[Debug Panel] Already initialized');
        return;
    }

    // Load any persisted logs from previous pages in this session
    debugLogs = loadPersistedLogs();

    // Inject CSS if not already present
    if (!document.querySelector('link[href*="debug-panel.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/css/debug-panel.css';
        document.head.appendChild(link);
    }

    // Create debug toggle button
    debugToggle = document.createElement('button');
    debugToggle.id = 'debugToggle';
    debugToggle.className = 'debug-toggle';
    debugToggle.title = 'Toggle Debug Panel';
    debugToggle.textContent = '🔧';
    document.body.appendChild(debugToggle);

    // Create debug panel
    debugPanel = document.createElement('div');
    debugPanel.id = 'debugPanel';
    debugPanel.className = 'debug-panel';
    debugPanel.innerHTML = `
        <div class="debug-panel-header">
            <span class="debug-panel-title">📋 ${escapeHtml(title)}</span>
            <div class="debug-panel-controls">
                <button class="debug-btn" id="clearDebugLog">Clear</button>
                <button class="debug-btn" id="closeDebugPanel">✕</button>
            </div>
        </div>
        <div id="debugLogContent"></div>
    `;
    document.body.appendChild(debugPanel);

    // Get content container
    debugLogContent = document.getElementById('debugLogContent');

    // Set up event listeners
    debugToggle.addEventListener('click', toggleDebugPanel);
    document.getElementById('closeDebugPanel').addEventListener('click', () => {
        debugPanel.classList.remove('visible');
    });
    document.getElementById('clearDebugLog').addEventListener('click', clearDebugLogs);

    isInitialized = true;

    // Render any persisted logs from previous pages
    if (debugLogs.length > 0) {
        renderPersistedLogs();
        // Show indicator that there are logs from before
        debugToggle.classList.add('has-logs');
    }

    // Log initialization with page context
    debugLog('Debug panel initialized', {
        page: window.location.pathname,
        search: window.location.search,
        persistedLogCount: debugLogs.length - 1, // -1 because we're about to add this entry
        timestamp: Date.now()
    }, 'info');
}

/**
 * Add a debug log entry to the panel
 * @param {string} action - The action description
 * @param {any} data - Optional data to display
 * @param {string} type - 'info', 'success', 'error', 'data'
 */
export function debugLog(action, data = null, type = 'info') {
    const timestamp = new Date().toISOString();
    const entry = { timestamp, action, data, type };

    // Store the log entry
    debugLogs.push(entry);

    // Persist to sessionStorage so logs survive page navigation
    persistLogs();

    // If not initialized, logs will be rendered when panel initializes
    if (!isInitialized) {
        return;
    }

    // Add visual indicator if panel is closed
    if (!debugPanel.classList.contains('visible')) {
        debugToggle.classList.add('has-logs');
    }

    // Render the entry to the panel
    renderLogEntry(entry, false);

    // Auto-scroll to bottom
    debugPanel.scrollTop = debugPanel.scrollHeight;

    // Also log to console for traditional debugging
    const consoleMethod = type === 'error' ? 'error' : type === 'success' ? 'info' : 'log';
    console[consoleMethod](`[Debug] ${action}`, data || '');
}

/**
 * Toggle debug panel visibility
 */
export function toggleDebugPanel() {
    if (!debugPanel) return;

    debugPanel.classList.toggle('visible');
    if (debugPanel.classList.contains('visible')) {
        debugToggle.classList.remove('has-logs');
    }
}

/**
 * Clear all debug logs
 */
export function clearDebugLogs() {
    debugLogs = [];
    if (debugLogContent) {
        debugLogContent.innerHTML = '';
    }
    // Also clear sessionStorage
    try {
        sessionStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.warn('[Debug Panel] Failed to clear persisted logs:', e);
    }
    debugLog('Debug log cleared', null, 'info');
}

/**
 * Get all debug logs
 * @returns {Array} Array of debug log entries
 */
export function getDebugLogs() {
    return [...debugLogs];
}

/**
 * Check if debug panel is initialized
 * @returns {boolean}
 */
export function isDebugPanelInitialized() {
    return isInitialized;
}

// Auto-initialize if the script is loaded and DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Don't auto-init, let pages call initDebugPanel explicitly
    });
}

// Export for use as a module
export default {
    initDebugPanel,
    debugLog,
    toggleDebugPanel,
    clearDebugLogs,
    getDebugLogs,
    isDebugPanelInitialized
};
