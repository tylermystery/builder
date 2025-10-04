import { log } from './utils/debug.js';

/**
 * Parses the raw string from Airtable's 'Options' field into a structured array of objects.
 * This function handles various formats, including price changes, absolute prices,
 * durations, and descriptions.
 * @param {string} rawOptionsString The comma-separated string from the Airtable field.
 * @returns {Array<Object>} An array of option objects, each with standardized properties.
 */
export function parseOptions(rawOptionsString) {
    if (!rawOptionsString || typeof rawOptionsString !== 'string') {
        return [];
    }
    
    // Split the string by line breaks first, then by commas
    const optionsArray = rawOptionsString.split(/\r?\n/).map(option => option.trim()).filter(Boolean);
    
    return optionsArray.map(option => {
        let name = option;
        let price = null;
        let priceChange = null;
        let durationChange = null;
        let description = null;

        const parts = option.split(',').map(part => part.trim());
        name = parts.shift() || '';
        
        parts.forEach(part => {
            let match;
            if (match = part.match(/price:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                price = parseFloat(match[1]);
            } else if (match = part.match(/price change:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                priceChange = parseFloat(match[1]);
            } else if (match = part.match(/duration change:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                durationChange = parseFloat(match[1]);
            } else if (match = part.match(/description:\s*['"]?([^"']+)['"]?/i)) {
                description = match[1];
            }
        });

        // Use a simple check to see if the name itself contains a price, as in the raw data
        let namePriceMatch = name.match(/\$(\d+(\.\d{1,2})?)/);
        if (namePriceMatch) {
            price = parseFloat(namePriceMatch[1]);
            name = name.replace(namePriceMatch[0], '').trim();
        }

        return {
            name: name,
            price: price,
            priceChange: priceChange,
            durationChange: durationChange,
            description: description
        };
    });
}

/**
 * A utility function to debounce a function call.
 * @param {Function} func The function to debounce.
 * @param {number} delay The debounce delay in milliseconds.
 * @returns {Function} A new function that debounces the original.
 */
export function debounce(func, delay = 300) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

// PASTE THIS AT THE END OF: utils.js

/**
 * Updates the browser's URL with new query parameters without reloading the page.
 * @param {Object} paramsToUpdate - An object of key-value pairs to set in the URL.
 * A value of null or undefined will remove the parameter.
 */
export function updateUrl(paramsToUpdate) {
    const url = new URL(window.location);
    const searchParams = url.searchParams;

    for (const key in paramsToUpdate) {
        const value = paramsToUpdate[key];
        if (value === null || value === undefined || value === '') {
            searchParams.delete(key);
        } else {
            searchParams.set(key, value);
        }
    }

    // Only push a new state if the URL has actually changed
    if (window.location.href !== url.href) {
        history.pushState({}, '', url.href);
    }
}
