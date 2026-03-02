// Debug logging utility - can be disabled in production via URL param or localStorage
// Usage: import { log, warn, error } from './utils/debug.js'

// Check if debug mode should be enabled
function checkDebugMode() {
    if (typeof window === 'undefined') return false;

    // Check URL parameter: ?debug=true
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('debug') === 'true') return true;

    // Check localStorage
    if (localStorage.getItem('wtf_debug') === 'true') return true;

    // Check if running on localhost/development
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.includes('netlify.app')) {
        // Enable debug for deploy previews but not production
        return hostname.includes('--') || hostname === 'localhost';
    }

    return false;
}

let isDebugMode = typeof window !== 'undefined' ? checkDebugMode() : false;

export function setDebugMode(enabled) {
    isDebugMode = enabled;
    if (typeof window !== 'undefined') {
        localStorage.setItem('wtf_debug', enabled ? 'true' : 'false');
    }
}

export function isDebugEnabled() {
    return isDebugMode;
}

export function log(prefix, ...args) {
    if (isDebugMode) {
        console.log(`[${prefix}]`, ...args);
    }
}

export function warn(prefix, ...args) {
    if (isDebugMode) {
        console.warn(`[${prefix}]`, ...args);
    }
}

export function error(prefix, ...args) {
    // Errors are always logged regardless of debug mode
    console.error(`[${prefix}]`, ...args);
}

// Export a scoped logger factory for modules
export function createLogger(moduleName) {
    return {
        log: (...args) => log(moduleName, ...args),
        warn: (...args) => warn(moduleName, ...args),
        error: (...args) => error(moduleName, ...args),
        debug: (...args) => {
            if (isDebugMode) {
                console.debug(`[${moduleName} DEBUG]`, ...args);
            }
        }
    };
}