// FILE: utils.js
import { log } from './utils/debug.js';
import { state } from './state.js';
import { CONSTANTS } from './config.js';

/**
 * Parses the raw string from Airtable's 'Options' field into a structured array of objects.
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

        return { name, price, priceChange, durationChange, description };
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

// --- SHARED PRICING AND HIERARCHY HELPERS ---

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

/**
 * Calculates the total cost for a given map of items.
 * @param {Map<string, object>} itemsMap A map of record IDs to item info objects.
 * @returns {number} The calculated total cost.
 */
export function calculateTotalCost(itemsMap) {
    let total = 0;
    itemsMap.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;
        const unitPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;

        const guestCount = parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) || 0;
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] ? parseInt(record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN]) : 1;
        
        let effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, headcountMin);
        const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE]?.toLowerCase();

        if (pricingType === CONSTANTS.PRICING_TYPES.PER_GUEST && guestCount > 0) {
            effectiveQuantity = guestCount;
        }
        
        total += unitPrice * effectiveQuantity;
    });
    return total;
}
