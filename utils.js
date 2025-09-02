import { log } from './utils/debug.js';

export function parseOptions(optionsString) {
    if (!optionsString || typeof optionsString !== 'string') return [];
    try {
        return JSON.parse(optionsString).map(opt => ({
            name: opt.name || '',
            description: opt.description || '',
            absolutePrice: opt.absolutePrice !== undefined ? parseFloat(opt.absolutePrice) : null,
            priceChange: opt.priceChange !== undefined ? parseFloat(opt.priceChange) : null,
        }));
    } catch (error) {
        console.error('Failed to parse options:', error);
        return [];
    }
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
