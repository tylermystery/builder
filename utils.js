import { log } from './utils/debug.js';

export function parseOptions(optionsString) {
    if (!optionsString || typeof optionsString !== 'string') return [];
    const options = [];
    optionsString.split(',').forEach(optStr => {
        const opt = { name: optStr.trim(), description: '', absolutePrice: null, priceChange: null };
        const match = optStr.match(/\(([\+=]?[-\s]?\$([\d.]+))\)/);
        if (match) {
            const sign = match[1][0];
            const price = parseFloat(match[2]);
            if (sign === '=') opt.absolutePrice = price;
            else opt.priceChange = (sign === '-' || match[1].includes('-') ? -price : price);
            opt.name = optStr.replace(match[0], '').trim();
        }
        options.push(opt);
    });
    return options;
}

export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
