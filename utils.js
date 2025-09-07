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

    const optionsArray = rawOptionsString.split(/\r?\n/).map(option => option.trim()).filter(Boolean);

    return optionsArray.map(option => {
        // Use a more advanced parsing approach to handle various keywords
        let name = option;
        let price = null;
        let priceChange = null;
        let durationChange = null;
        let description = null;

        const parts = option.split(',');
        name = parts.shift().trim();

        parts.forEach(part => {
            const trimmedPart = part.trim();
            let match;
            if (match = trimmedPart.match(/price:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                price = parseFloat(match[1]);
            } else if (match = trimmedPart.match(/price change:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                priceChange = parseFloat(match[1]);
            } else if (match = trimmedPart.match(/duration change:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                durationChange = parseFloat(match[1]);
            } else if (match = trimmedPart.match(/description:\s*['"]?([^"']+)['"]?/i)) {
                description = match[1];
            }
        });

        // Use regex on the initial name to catch any lingering keywords
        let nameMatch;
        if (nameMatch = name.match(/price:\s*(\-?\d+(\.\d{1,2})?)/i)) {
            price = parseFloat(nameMatch[1]);
            name = name.replace(nameMatch[0], '').trim();
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
