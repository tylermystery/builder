// REPLACE THE ENTIRE CONTENTS OF: utils.js

import { log } from './utils/debug.js';
import { CONSTANTS } from './config.js';
import { state } from './state.js';

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

    if (window.location.href !== url.href) {
        history.pushState({}, '', url.href);
    }
}

// --- NEWLY MOVED FUNCTIONS ---

function getDescendantBookableItems(record, allRecords) {
    let bookableItems = [];
    const children = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] === record.fields.Name);
    for (const child of children) {
        const rawOptions = parseOptions(child.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
        const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
        if (isGrouping) {
            bookableItems = bookableItems.concat(getDescendantBookableItems(child, allRecords));
        } else {
            bookableItems.push(child);
        }
    }
    return bookableItems;
}

export function getGroupPriceRange(record) {
    const descendants = getDescendantBookableItems(record, state.records.all);
    if (descendants.length === 0) return null;
    let minPrice = Infinity, maxPrice = -Infinity;
    descendants.forEach(item => {
        const options = parseOptions(item.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        if (options.length > 0) {
            options.forEach((opt, index) => {
                const price = getRecordPrice(item, index);
                if (price > 0) {
                    if (price < minPrice) minPrice = price;
                    if (price > maxPrice) maxPrice = price;
                }
            });
        } else {
            const price = getRecordPrice(item);
            if (price > 0) {
                if (price < minPrice) minPrice = price;
                if (price > maxPrice) maxPrice = price;
            }
        }
    });
    return (minPrice === Infinity) ? null : { min: minPrice, max: maxPrice };
}

export function getRecordPrice(record, optionIndex = null) {
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
