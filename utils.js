// FILE: utils.js
export function parseOptions(optionsStr) {
    if (!optionsStr) return [];
    
    const options = [];
    const lines = optionsStr.trim().split('\n');
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        const parts = line.split(',').map(p => p.trim());
        const opt = {
            name: parts[0],
            priceChange: null,
            absolutePrice: null,
            duration: null,
            description: null
        };
        
        for (let part of parts.slice(1)) {
            if (part.includes(':')) {
                const [key, ...valueParts] = part.split(':').map(x => x.trim());
                const value = valueParts.join(':'); // Handles values containing ':'
                if (value) { // Only process if value exists
                    if (key === 'price change') {
                        opt.priceChange = parseFloat(value);
                    } else if (key === 'price') {
                        opt.absolutePrice = parseFloat(value);
                    } else if (key === 'duration') {
                        opt.duration = parseFloat(value);
                    } else if (key === 'description') {
                        opt.description = value.replace(/^"|"$/g, ''); // Strip quotes safely
                    }
                }
            }
        }
        
        options.push(opt);
    }
    
    return options;
}

// From debug.js (if merged; otherwise keep separate)
let isDebugMode = false;

export function setDebugMode(enabled) {
    isDebugMode = enabled;
}

export function log(prefix, ...args) {
    if (isDebugMode) {
        console.log(`[${prefix}]`, ...args);
    }
}
