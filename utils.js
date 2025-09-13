/**
 * utils.js
 * A collection of utility functions used across the application.
 */
import { CONSTANTS } from './config.js';

/**
 * Parses a string of options from a record's fields.
 * @param {string} optionsStr
 * @returns {Array<object>}
 */
export function parseOptions(optionsStr) {
    if (!optionsStr) return [];
    return optionsStr.split(';').map(optionPart => {
        let name = '';
        let price = null;
        let priceChange = null;
        let durationChange = null;
        let description = '';

        optionPart.trim().split(',').forEach(part => {
            let match;
            if (match = part.match(/name:\s*['"]?([^\"']+)['"]?/i)) {
                name = match[1];
            } else if (match = part.match(/price:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                price = parseFloat(match[1]);
            } else if (match = part.match(/price change:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                priceChange = parseFloat(match[1]);
            } else if (match = part.match(/duration change:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                durationChange = parseFloat(match[1]);
            } else if (match = part.match(/description:\s*['"]?([^\"']+)['"]?/i)) {
                description = match[1];
            }
        });

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
            func(...args);
        }, delay);
    };
}

/**
 * Calculates the price of a record, accounting for a selected option.
 * @param {object} record The Airtable record object.
 * @param {number|null} optionIndex The index of the selected option.
 * @returns {number} The final calculated price.
 */
export function calculatePrice(record, optionIndex = null) {
    let price = parseFloat(String(record?.fields?.[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]+/g, ""));
    if (optionIndex !== null) {
        const options = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        if (variation) {
            if (variation.price !== null) return variation.price;
            if (variation.priceChange !== null) price += variation.priceChange;
        }
    }
    return isNaN(price) ? 0 : price;
}

/**
 * Placeholder function for calculating duration.
 * @param {object} record The Airtable record object.
 * @param {number|null} optionIndex The index of the selected option.
 * @returns {number} The duration in hours.
 */
export function calculateDuration(record, optionIndex = null) {
    // Placeholder for now, will be updated in a later phase
    return 0;
}
