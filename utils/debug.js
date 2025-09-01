let isDebugMode = false;

export function setDebugMode(enabled) {
    isDebugMode = enabled;
}

export function log(prefix, ...args) {
    if (isDebugMode) {
        console.log(`[${prefix}]`, ...args);
    }
}

