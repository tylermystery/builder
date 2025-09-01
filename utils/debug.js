// A simple logger that can be toggled on or off for debugging.
let isDebugMode = false;

export function setDebugMode(enabled) {
    isDebugMode = !!enabled;
    console.log(`Debug mode is now ${isDebugMode ? 'ON' : 'OFF'}.`);
}

export function log(prefix, ...args) {
    if (isDebugMode) {
        console.log(`[${prefix}]`, ...args);
    }
}
