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
                const [key, value] = part.split(':', 1).map(x => x.trim());
                if (key === 'price change') {
                    opt.priceChange = parseFloat(value);
                } else if (key === 'price') {
                    opt.absolutePrice = parseFloat(value);
                } else if (key === 'duration') {
                    opt.duration = parseFloat(value);
                } else if (key === 'description') {
                    opt.description = value.replace(/^"|"$/g, ''); // Strip surrounding quotes
                }
            }
        }
        
        options.push(opt);
    }
    
    return options;
}
