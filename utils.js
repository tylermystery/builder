// REPLACE THE ENTIRE CONTENTS OF: utils.js

import { log } from './utils/debug.js';
import { CONSTANTS } from './config.js';
import { state } from './state.js';

const loadedLibraries = new Set();
const loadingPromises = new Map();

// Cache for tempLikes to reduce localStorage parsing overhead
let tempLikesCache = null;
let tempLikesCacheTime = 0;
const TEMP_LIKES_CACHE_TTL = 5000; // Cache for 5 seconds

/**
 * Get temporary likes with caching to reduce localStorage overhead
 * @returns {Set<string>} Set of liked item IDs
 */
export function getTempLikes() {
    const now = Date.now();
    if (tempLikesCache && (now - tempLikesCacheTime) < TEMP_LIKES_CACHE_TTL) {
        return tempLikesCache;
    }
    
    try {
        const tempLikes = new Set(JSON.parse(localStorage.getItem('tempLikes') || '[]'));
        tempLikesCache = tempLikes;
        tempLikesCacheTime = now;
        return tempLikes;
    } catch (e) {
        console.error('[Utils] Error reading tempLikes:', e);
        return new Set();
    }
}

/**
 * Set temporary likes and update cache
 * @param {Set<string>} likes - Set of liked item IDs
 */
export function setTempLikes(likes) {
    try {
        localStorage.setItem('tempLikes', JSON.stringify(Array.from(likes)));
        tempLikesCache = likes;
        tempLikesCacheTime = Date.now();
    } catch (e) {
        console.error('[Utils] Error setting tempLikes:', e);
    }
}

/**
 * Invalidate the tempLikes cache to force a refresh
 */
export function invalidateTempLikesCache() {
    tempLikesCache = null;
    tempLikesCacheTime = 0;
}

/**
 * Dynamically loads a script from a URL and returns a promise
 * @param {string} src - The script URL to load
 * @param {string} name - Identifier for the library being loaded
 * @returns {Promise<void>}
 */
export function loadScript(src, name) {
    if (loadedLibraries.has(name)) {
        return Promise.resolve();
    }
    
    if (loadingPromises.has(name)) {
        return loadingPromises.get(name);
    }
    
    const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => {
            loadedLibraries.add(name);
            loadingPromises.delete(name);
            log('LazyLoad', `${name} loaded successfully`);
            resolve();
        };
        script.onerror = () => {
            loadingPromises.delete(name);
            log('LazyLoad', `Failed to load ${name}`);
            reject(new Error(`Failed to load ${name}`));
        };
        document.head.appendChild(script);
    });
    
    loadingPromises.set(name, promise);
    return promise;
}

/**
 * Lazy loads Stripe.js library on demand
 * @returns {Promise<void>}
 */
export async function loadStripe() {
    await loadScript('https://js.stripe.com/v3/', 'stripe');
}

/**
 * Lazy loads Flatpickr library on demand
 * @returns {Promise<void>}
 */
export async function loadFlatpickr() {
    if (window.flatpickr) {
        return Promise.resolve();
    }
    
    await loadScript('https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.js', 'flatpickr');
    
    // Wait for flatpickr to be available on window object
    let attempts = 0;
    while (!window.flatpickr && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    if (!window.flatpickr) {
        throw new Error('Flatpickr failed to load after 5 seconds');
    }
    
    log('LazyLoad', 'Flatpickr is now available on window object');
}

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

    const newUrl = url.pathname + '?' + searchParams.toString();
    const currentUrl = window.location.pathname + window.location.search;
    
    if (newUrl !== currentUrl) {
        // --- THIS IS THE FIX ---
        // Always use pushState to update the URL without triggering a full navigation
        // or relying on a potentially non-existent browser history entry.
        history.pushState({}, '', newUrl);
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

/**
 * Calculate the effective minimum quantity for a record based on Union Machine Works presence
 * @param {Object} record - The record to calculate the minimum for
 * @returns {number} The effective minimum quantity (1 if UMW is booked, otherwise the Airtable minimum)
 */
export function getEffectiveMinQuantity(record) {
    // 1. Check if Union Machine Works is in the plan
    let isUmwInPlan = false;
    for (const [id] of state.cart.lockedItems) {
        const lockedRecord = state.records.all.find(r => r.id === id);
        if (lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works")) {
            isUmwInPlan = true;
            break;
        }
    }

    // 2. Get the base minimum from Airtable (default to 1)
    const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;

    // 3. Return 1 if UMW is booked, otherwise return the specific item minimum
    return isUmwInPlan ? 1 : airtableMin;
}
