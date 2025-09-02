let isDebugMode = true; // Enabled by default for troubleshooting

export function setDebugMode(enabled) {
    isDebugMode = enabled;
    console.log(`[Debug] Debug mode is now ${enabled ? 'ON' : 'OFF'}.`);
}

export function log(prefix, ...args) {
    if (isDebugMode) {
        console.log(`[${prefix}]`, ...args);
    }
}
