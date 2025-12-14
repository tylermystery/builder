/**
 * Mobile-friendly Debug Panel Module
 * Provides a visual debug panel for debugging on any device
 *
 * Usage:
 *   import { initDebugPanel, debugLog } from '/utils/debug-panel.js';
 *   initDebugPanel(); // Call once on page load
 *   debugLog('Action description', { any: 'data' }, 'info'); // Log entries
 *
 * Types: 'info', 'success', 'error', 'data'
 */

let debugLogs = [];
let debugPanel = null;
let debugToggle = null;
let debugLogContent = null;
let isInitialized = false;

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

    // Log initialization
    debugLog('Debug panel initialized', {
        page: window.location.pathname,
        userAgent: navigator.userAgent.substring(0, 50) + '...',
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
    // If not initialized, store logs for later
    if (!isInitialized) {
        debugLogs.push({ action, data, type, timestamp: new Date().toISOString() });
        return;
    }

    const timestamp = new Date().toISOString();
    const entry = { timestamp, action, data, type };
    debugLogs.push(entry);

    // Add visual indicator if panel is closed
    if (!debugPanel.classList.contains('visible')) {
        debugToggle.classList.add('has-logs');
    }

    // Render the entry
    const entryEl = document.createElement('div');
    entryEl.className = 'debug-entry';

    let dataClass = '';
    if (type === 'error') dataClass = 'debug-error';
    else if (type === 'success') dataClass = 'debug-success';

    let html = `<div class="debug-timestamp">${timestamp}</div>`;
    html += `<div class="debug-action ${dataClass}">[${type.toUpperCase()}] ${escapeHtml(action)}</div>`;

    if (data !== null) {
        const dataStr = typeof data === 'object' ? JSON.stringify(data, null, 2) : String(data);
        html += `<div class="debug-data">${escapeHtml(dataStr)}</div>`;
    }

    entryEl.innerHTML = html;
    debugLogContent.appendChild(entryEl);

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
