// REPLACE THE ENTIRE CONTENTS of utils.js

import { state } from './state.js';
import { CONSTANTS } from './config.js';
import { log } from './utils/debug.js';

/**
 * Creates a "debounced" function that delays invoking the func until after
 * wait milliseconds have elapsed since the last time the debounced function
 * was invoked.
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay.
 * @returns {Function} The new debounced function.
 */
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

/**
 * Parses URL parameters into an object.
 * @returns {object} An object of key/value pairs from the URL.
 */
export function getUrlParams() {
    const params = {};
    const queryString = window.location.search.substring(1);
    const regex = /([^&=]+)=([^&]*)/g;
    let m;
    while (m = regex.exec(queryString)) {
        params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
    }
    return params;
}

/**
 * Updates the browser's URL with new query parameters without reloading.
 * @param {object} paramsToUpdate - An object of key/value pairs to add/update.
 */
export function updateUrl(paramsToUpdate) {
    if (state.ui.isInitializing) return;

    const currentParams = getUrlParams();
    // 1. Update/add new params
    for (const key in paramsToUpdate) {
        if (paramsToUpdate[key] === null || paramsToUpdate[key] === undefined) {
            delete currentParams[key];
        } else {
            currentParams[key] = paramsToUpdate[key];
        }
    }

    // 2. Build the new query string
    const newQueryString = Object.keys(currentParams)
        .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(currentParams[key])}`)
        .join('&');
    
    // 3. Update the URL
    const newUrl = `${window.location.pathname}${newQueryString ? '?' : ''}${newQueryString}`;
    if (window.history.pushState) {
        window.history.pushState({ path: newUrl }, '', newUrl);
    }
}

/**
 * Parses the "Options" field (which can be string or JSON) into a standard array.
 * @param {string} optionsString - The raw string from Airtable.
 * @returns {Array<object>} An array of option objects.
 */
export function parseOptions(optionsString) {
    if (!optionsString || typeof optionsString !== 'string') {
        return [];
    }
    try {
        // Try to parse as JSON first
        const options = JSON.parse(optionsString);
        if (Array.isArray(options)) {
            // New JSON format: [{name: "Name", price: 100}, ...]
            return options.map(opt => ({
                name: opt.name || 'Option',
                price: typeof opt.price === 'number' ? opt.price : null,
                priceChange: typeof opt.priceChange === 'number' ? opt.priceChange : null,
                description: opt.description || null
            }));
        }
    } catch (e) {
        // Fallback for old comma-separated string format
        return optionsString.split(',').map(s => s.trim()).filter(s => s).map(name => ({
            name: name,
            price: null,
            priceChange: null,
            description: null
        }));
    }
    return [];
}

/**
 * Recursively finds all descendant bookable items for a grouping.
 * @param {object} record - The parent record.
 * @param {Array<object>} allRecords - All records to search.
 * @returns {Array<object>} A flat array of all descendant items.
 */
function getDescendantBookableItems(record, allRecords) {
    let bookableItems = [];
    // Find children by Parent Item link
    const children = allRecords.filter(r => 
        r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] && 
        r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM][0] === record.id 
    );

    for (const child of children) {
        if (child.fields['Item Type'] === 'Grouping') {
            bookableItems = bookableItems.concat(getDescendantBookableItems(child, allRecords));
        } else if (child.fields['Item Type'] === 'Bookable Item' || child.fields['Item Type'] === 'Event') {
            bookableItems.push(child);
        }
    }
    return bookableItems;
}

/**
 * Calculates the min/max price range for a Grouping record.
 * @param {object} record - The Grouping item record.
 * @returns {object | null} An object {min, max} or null.
 */
export function getGroupPriceRange(record) {
    if (record.fields['Item Type'] !== 'Grouping') return null;
    
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

/**
 * Gets the definitive price for a record, considering the selected option.
 * @param {object} record - The item record.
 * @param {number | null} optionIndex - The index of the selected option.
 * @returns {number} The calculated price.
 */
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
    return price;
}
