/*
 * Version: 1.0.1
 * Last Modified: 2025-09-02
 * Changelog:
 * v1.0.1 - 2025-09-02
 *   - Restored parseOptions export and added debounce for carousel updates.
 */
import { log } from './utils/debug.js';

export function parseOptions(optionsString) {
    if (!optionsString || typeof optionsString !== 'string') {
        log('Utils', 'No valid options string provided, returning empty array.');
        return [];
    }
    try {
        return JSON.parse(optionsString).map(opt => ({
            name: opt.name || '',
            description: opt.description || '',
            absolutePrice: opt.absolutePrice !== undefined ? parseFloat(opt.absolutePrice) : null,
            priceChange: opt.priceChange !== undefined ? parseFloat(opt.priceChange) : null,
        }));
    } catch (error) {
        console.error('Failed to parse options:', error);
        log('Utils', `Failed to parse options: ${error.message}`);
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
