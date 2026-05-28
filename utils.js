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
        const stored = localStorage.getItem('tempLikes');
        const parsed = stored ? JSON.parse(stored) : [];
        // Defensive: ensure parsed is an array before creating Set
        const tempLikes = new Set(Array.isArray(parsed) ? parsed : []);
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
        // Defensive: ensure likes is a Set or can be converted to array
        const likesArray = likes instanceof Set ? Array.from(likes) : (Array.isArray(likes) ? likes : []);
        localStorage.setItem('tempLikes', JSON.stringify(likesArray));
        tempLikesCache = likes instanceof Set ? likes : new Set(likesArray);
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
 * Preloads Stripe.js on hover/interaction so it's ready when checkout opens.
 * Call this on mouseenter/touchstart of payment-related buttons.
 * Safe to call multiple times — loadScript deduplicates.
 */
export function preloadStripe() {
    if (!window.Stripe && !loadingPromises.has('stripe')) {
        loadScript('https://js.stripe.com/v3/', 'stripe').catch(() => {
            // Silently ignore preload failures — will retry on actual checkout
        });
    }
}

/**
 * Lazy loads Flatpickr library and CSS on demand
 * @returns {Promise<void>}
 */
export async function loadFlatpickr() {
    if (window.flatpickr) {
        return Promise.resolve();
    }

    // Load Flatpickr CSS first
    if (!document.querySelector('link[href*="flatpickr.min.css"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://cdn.jsdelivr.net/npm/flatpickr/dist/flatpickr.min.css';
        document.head.appendChild(link);
        log('LazyLoad', 'Flatpickr CSS loaded');
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
 * Lazy loads SortableJS library on demand
 * @returns {Promise<void>}
 */
export async function loadSortable() {
    if (window.Sortable) {
        return Promise.resolve();
    }

    await loadScript('https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js', 'sortable');

    // Wait for Sortable to be available on window object
    let attempts = 0;
    while (!window.Sortable && attempts < 50) {
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }

    if (!window.Sortable) {
        throw new Error('Sortable failed to load after 5 seconds');
    }

    log('LazyLoad', 'SortableJS is now available on window object');
}

/**
 * Parses the raw string from Airtable's 'Options' field into a structured array of option groups.
 * Supports rich modifiers with bracket syntax:
 *   [Group Name] (optional_modifier) - Creates a new option group
 *   Option Name [price: +X] [img: tag] [desc: text] [time: +X] - Option with modifiers
 *   Price modifiers support absolute amounts (+X / -X), overrides (X), and
 *   percentages of the base price (+X% / -X%).
 *
 * Falls back to legacy comma-separated format for backward compatibility.
 *
 * @param {string} rawOptionsString The multi-line string from the Airtable field.
 * @returns {Array<Object>} An array of group objects, each with name and options array.
 *   Each option has: { name, priceModifier, priceOverride, pricePercent, imageTag, descriptionAppend, durationChange }
 */
export function parseOptions(rawOptionsString) {
    if (!rawOptionsString || typeof rawOptionsString !== 'string') {
        return [];
    }

    const lines = rawOptionsString.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

    // Check if new bracket syntax is used (group headers start with [ at beginning)
    const hasGroupHeaders = lines.some(line => /^\[.+\]\s*(\(.+\))?$/.test(line));

    if (hasGroupHeaders) {
        // New bracket syntax parsing
        return parseOptionsWithGroups(lines);
    } else {
        // Legacy parsing - return as single "Options" group for backward compatibility
        return parseLegacyOptions(lines);
    }
}

/**
 * Parses options using the new bracket group syntax.
 * @param {Array<string>} lines - Array of trimmed, non-empty lines
 * @returns {Array<Object>} Array of group objects with name and options array
 */
function parseOptionsWithGroups(lines) {
    const groups = [];
    let currentGroup = null;

    for (const line of lines) {
        // Check if this is a group header: [Group Name] or [Group Name] (modifier)
        const groupMatch = line.match(/^\[(.+?)\]\s*(?:\((.+?)\))?$/);

        if (groupMatch) {
            // Start a new group
            currentGroup = {
                name: groupMatch[1].trim(),
                modifier: groupMatch[2] ? groupMatch[2].trim() : null,
                options: []
            };
            groups.push(currentGroup);
        } else if (currentGroup) {
            // Parse option line with potential modifiers
            const option = parseOptionLine(line);
            currentGroup.options.push(option);
        } else {
            // Line before any group header - create a default group
            currentGroup = {
                name: 'Options',
                modifier: null,
                options: []
            };
            groups.push(currentGroup);
            const option = parseOptionLine(line);
            currentGroup.options.push(option);
        }
    }

    return groups;
}

/**
 * Parses a single option line with bracket modifiers.
 * Format: Option Name [price: +10] [img: image_tag] [desc: description text] [time: +30]
 * Price modifiers: [price: +10]/[price: -5] (absolute), [price: 25] (override),
 * [price: +15%]/[price: -10%] (percentage of base price).
 *
 * @param {string} line - A single option line
 * @returns {Object} Parsed option with all modifier fields
 */
function parseOptionLine(line) {
    let name = line;
    let priceModifier = null;  // +X or -X (adds/subtracts from base)
    let priceOverride = null;  // X (replaces base price)
    let pricePercent = null;   // +X% or -X% (adjusts base price by a percentage)
    let imageTag = null;
    let descriptionAppend = null;
    let durationChange = null;

    // Extract all bracket modifiers using regex
    // Pattern: [key: value] or [key:value]
    const modifierPattern = /\[(\w+):\s*([^\]]+)\]/gi;
    let match;

    while ((match = modifierPattern.exec(line)) !== null) {
        const key = match[1].toLowerCase();
        const value = match[2].trim();

        switch (key) {
            case 'price':
                // Check if it's a percentage (+X% / -X% / X%), a modifier (+X or -X) or override (X)
                if (value.endsWith('%')) {
                    pricePercent = parseFloat(value);
                } else if (value.startsWith('+') || value.startsWith('-')) {
                    priceModifier = parseFloat(value);
                } else {
                    priceOverride = parseFloat(value);
                }
                break;
            case 'img':
            case 'image':
                imageTag = value;
                break;
            case 'desc':
            case 'description':
                descriptionAppend = value;
                break;
            case 'time':
            case 'duration':
                // Parse duration change (typically in minutes, +X or -X)
                durationChange = parseFloat(value);
                break;
        }
    }

    // Remove all bracket modifiers from the name
    name = line.replace(/\[(\w+):\s*([^\]]+)\]/gi, '').trim();

    // Legacy: Check for inline $X price in the name itself
    const namePriceMatch = name.match(/\$(\d+(\.\d{1,2})?)/);
    if (namePriceMatch && priceOverride === null && priceModifier === null) {
        priceOverride = parseFloat(namePriceMatch[1]);
        name = name.replace(namePriceMatch[0], '').trim();
    }

    return {
        name: name || 'Unnamed Option',
        priceModifier: isNaN(priceModifier) ? null : priceModifier,
        priceOverride: isNaN(priceOverride) ? null : priceOverride,
        pricePercent: isNaN(pricePercent) ? null : pricePercent,
        imageTag: imageTag,
        descriptionAppend: descriptionAppend,
        durationChange: isNaN(durationChange) ? null : durationChange,
        // Legacy compatibility fields
        price: priceOverride,
        priceChange: priceModifier,
        description: descriptionAppend
    };
}

/**
 * Parses options using legacy format (comma-separated on single lines).
 * Returns result in new group format for consistency.
 *
 * @param {Array<string>} lines - Array of trimmed, non-empty lines
 * @returns {Array<Object>} Array with single "Options" group
 */
function parseLegacyOptions(lines) {
    const options = lines.map(option => {
        let name = option;
        let price = null;
        let priceChange = null;
        let pricePercent = null;
        let durationChange = null;
        let description = null;

        const parts = option.split(',').map(part => part.trim());
        name = parts.shift() || '';

        parts.forEach(part => {
            let match;
            if (match = part.match(/price:\s*(\-?\d+(\.\d{1,2})?)/i)) {
                price = parseFloat(match[1]);
            } else if (match = part.match(/price change:\s*([+\-]?\d+(\.\d{1,2})?)%/i)) {
                pricePercent = parseFloat(match[1]);
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
            name: name || 'Unnamed Option',
            priceModifier: priceChange,
            priceOverride: price,
            pricePercent: isNaN(pricePercent) ? null : pricePercent,
            imageTag: null,
            descriptionAppend: description,
            durationChange: durationChange,
            // Legacy compatibility fields
            price: price,
            priceChange: priceChange,
            description: description
        };
    });

    // Return as single group for backward compatibility
    if (options.length === 0) {
        return [];
    }

    return [{
        name: 'Options',
        modifier: null,
        options: options
    }];
}

/**
 * Helper function to get a flat list of all options from parsed groups.
 * Useful for backward compatibility where code expects flat option arrays.
 *
 * @param {Array<Object>} groups - Parsed option groups from parseOptions
 * @returns {Array<Object>} Flat array of all options across all groups
 */
export function flattenOptionGroups(groups) {
    if (!Array.isArray(groups)) return [];
    return groups.reduce((acc, group) => {
        if (group.options && Array.isArray(group.options)) {
            return acc.concat(group.options);
        }
        return acc;
    }, []);
}
export function debounce(func, delay = 300) {
    if (typeof func !== 'function') {
        console.warn('[Utils] debounce called with non-function:', func);
        return () => {};
    }
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            try {
                func.apply(this, args);
            } catch (e) {
                console.error('[Utils] Error in debounced function:', e);
            }
        }, delay);
    };
}

/**
 * Generates a URL-friendly slug from a name string.
 * Must match the slug generation logic in build.js for consistency.
 * @param {string} name - The item name to convert to a slug.
 * @param {string} recordId - The Airtable record ID to append.
 * @param {string[]} [tags] - Optional AI-generated tags to include for SEO.
 * @returns {string} The generated slug (e.g., "sunset-boat-party-outdoor-fun-rec123").
 */
export function generateSlug(name, recordId, tags = []) {
    if (!name || typeof name !== 'string') {
        return recordId; // Fallback to just the record ID if no name
    }

    // Process the item name
    let slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with dashes
        .replace(/^-+|-+$/g, '');    // Remove leading/trailing dashes

    // Add up to 3 AI tags to the slug for SEO (if provided)
    if (tags && tags.length > 0) {
        const tagSlug = tags
            .slice(0, 3) // Only use first 3 tags to keep URL reasonable
            .map(tag => tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
            .filter(tag => tag.length > 0 && !slug.includes(tag)) // Avoid duplicates
            .join('-');

        if (tagSlug) {
            slug = `${slug}-${tagSlug}`;
        }
    }

    // Limit total length for reasonable URLs (leaving room for recordId)
    slug = slug.substring(0, 60);

    return `${slug}-${recordId}`;
}

/**
 * Extracts the Airtable record ID from a pretty URL path.
 * Pretty URLs are in format: /item/event-name-recXYZ
 * The record ID is always the last part after the final dash, starting with "rec".
 *
 * @param {string} path - The URL path to parse (e.g., "/item/sunset-boat-party-rec123")
 * @returns {string|null} The extracted record ID (e.g., "rec123") or null if not found
 */
export function extractRecordIdFromPath(path) {
    if (!path || typeof path !== 'string') {
        return null;
    }

    // Check if it's an item path
    if (!path.startsWith('/item/')) {
        return null;
    }

    // Extract the slug portion (everything after /item/)
    const slug = path.replace('/item/', '').split('?')[0]; // Remove query string if present

    // Record IDs in Airtable start with "rec" and are 17 chars total
    // Find the last occurrence of "-rec" and extract the ID
    const recMatch = slug.match(/rec[A-Za-z0-9]{14}$/);
    if (recMatch) {
        return recMatch[0];
    }

    return null;
}

export function storeSlug(storeName) {
    if (!storeName || typeof storeName !== 'string') return '';
    return storeName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function findStoreBySlugOrId(identifier, stores) {
    if (!identifier || !stores || !stores.length) return null;
    const direct = stores.find(s => s.id === identifier);
    if (direct) return direct;
    const slugMatch = identifier.toLowerCase();
    return stores.find(s => s.fields?.Name && storeSlug(s.fields.Name) === slugMatch) || null;
}

export function getShopUrlParam(activeShopId, stores) {
    if (!activeShopId) return '';
    const shop = stores?.find(s => s.id === activeShopId);
    if (shop?.fields?.Name) {
        return `shop=${encodeURIComponent(storeSlug(shop.fields.Name))}`;
    }
    return `shopId=${activeShopId}`;
}

/**
 * Updates the browser's URL with new query parameters without reloading the page.
 * When setting openItem, generates a "pretty" URL like /item/event-name-recXYZ
 * instead of using query parameters, for better SEO and user experience.
 *
 * @param {Object} paramsToUpdate - An object of key-value pairs to set in the URL.
 * A value of null or undefined will remove the parameter.
 * @param {Object} options - Optional configuration.
 * @param {string} options.itemName - The item name to use for generating pretty URL slugs.
 *   If not provided, will attempt to look up from state.records.all.
 * @param {string[]} options.tags - Optional AI-generated tags to include in the URL slug.
 */
export function updateUrl(paramsToUpdate, options = {}) {
    const url = new URL(window.location);
    const searchParams = url.searchParams;

    // Check if we're setting openItem with a valid value
    const openItemValue = paramsToUpdate.openItem;
    const isSettingOpenItem = openItemValue !== null && openItemValue !== undefined && openItemValue !== '';

    // Check if we're clearing openItem
    const isClearingOpenItem = 'openItem' in paramsToUpdate && !isSettingOpenItem;

    if (isSettingOpenItem) {
        // Generate a pretty URL for the item
        let itemName = options.itemName;
        let tags = options.tags || [];

        // Try to find the record name and tags from state if not provided
        if (state.records && state.records.all) {
            const record = state.records.all.find(r => r.id === openItemValue);
            if (record && record.fields) {
                if (!itemName && record.fields.Name) {
                    itemName = record.fields.Name;
                }
                // Extract AI tags for SEO-friendly URLs
                if (tags.length === 0) {
                    const aiProfileString = record.fields.AI_Profile || record.fields.Rankings;
                    if (aiProfileString) {
                        try {
                            const aiProfile = JSON.parse(aiProfileString);
                            tags = aiProfile.Tags || aiProfile.SearchTerms || [];
                        } catch (e) {
                            // Ignore parsing errors
                        }
                    }
                }
            }
        }

        // Preserve the existing shared slug when the current URL already points at
        // this same record. Otherwise opening a share link like
        // /item/short-slug-recXYZ would rewrite the path to /item/longer-canonical-slug-recXYZ
        // on modal open, surprising the user and breaking the URL they just arrived at.
        let prettyPath;
        if (window.location.pathname.startsWith('/item/') &&
            extractRecordIdFromPath(window.location.pathname) === openItemValue) {
            prettyPath = window.location.pathname;
        } else {
            const slug = generateSlug(itemName, openItemValue, tags);
            prettyPath = `/item/${slug}`;
        }

        // Build the query string for any other parameters (excluding openItem)
        const otherParams = new URLSearchParams(searchParams);
        otherParams.delete('openItem'); // Remove openItem if it exists

        // Apply other parameter updates (excluding openItem)
        for (const key in paramsToUpdate) {
            if (key === 'openItem') continue; // Skip openItem, we handle it via path
            const value = paramsToUpdate[key];
            if (value === null || value === undefined || value === '') {
                otherParams.delete(key);
            } else {
                otherParams.set(key, value);
            }
        }

        // Build final URL
        const queryString = otherParams.toString();
        const newUrl = queryString ? `${prettyPath}?${queryString}` : prettyPath;

        // Only push if URL actually changed
        const currentFullPath = window.location.pathname + window.location.search;
        if (newUrl !== currentFullPath) {
            history.pushState({ openItem: openItemValue }, '', newUrl);
        }
        return;
    }

    if (isClearingOpenItem) {
        // When clearing openItem, go back to the base path with remaining params
        // If we're on a /item/... path, redirect back to root
        for (const key in paramsToUpdate) {
            const value = paramsToUpdate[key];
            if (value === null || value === undefined || value === '') {
                searchParams.delete(key);
            } else {
                searchParams.set(key, value);
            }
        }

        const queryString = searchParams.toString();
        const basePath = window.location.pathname.startsWith('/item/') ? '/' : url.pathname;
        const newUrl = queryString ? `${basePath}?${queryString}` : basePath;

        const currentFullPath = window.location.pathname + window.location.search;
        if (newUrl !== currentFullPath) {
            history.pushState({}, '', newUrl);
        }
        return;
    }

    // Standard parameter update (no openItem involved)
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
/**
 * Calculates the final price for a record based on selected options.
 * Supports both legacy single optionIndex and new selections object format.
 *
 * @param {Object} record - The Airtable record
 * @param {number|Object} selectionsOrIndex - Either a single option index (legacy)
 *   or a selections object mapping groupIndex to optionIndex: { group0: 0, group1: 2 }
 * @returns {number} The calculated final price
 */
export function getRecordPrice(record, selectionsOrIndex = null) {
    // Defensive: ensure record exists and has fields
    if (!record || !record.fields) {
        console.warn('[Utils] getRecordPrice called with invalid record:', record);
        return 0;
    }

    const priceField = record.fields[CONSTANTS.FIELD_NAMES.PRICE];
    let price = parseFloat(String(priceField || '0').replace(/[^0-9.-]+/g, ""));

    if (selectionsOrIndex === null) {
        return isNaN(price) ? 0 : price;
    }

    // Capture the base price so percentage modifiers apply to it consistently
    // (rather than compounding off the running total as multiple groups are applied).
    const basePrice = isNaN(price) ? 0 : price;

    const groups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);

    // Handle legacy single index format
    if (typeof selectionsOrIndex === 'number') {
        const flatOptions = flattenOptionGroups(groups);
        const variation = flatOptions[selectionsOrIndex];
        if (variation) {
            if (variation.priceOverride !== null && !isNaN(variation.priceOverride)) {
                return variation.priceOverride;
            }
            if (variation.priceModifier !== null && !isNaN(variation.priceModifier)) {
                price += variation.priceModifier;
            }
            if (variation.pricePercent !== null && !isNaN(variation.pricePercent)) {
                price += basePrice * (variation.pricePercent / 100);
            }
        }
        return isNaN(price) ? 0 : price;
    }

    // Handle new selections object format: { group0: optionIndex, group1: optionIndex, ... }
    // Also supports multi-select arrays: { group0: [0, 2], group1: 1 }
    if (typeof selectionsOrIndex === 'object' && selectionsOrIndex !== null) {
        // Iterate through each group selection
        for (const [groupKey, optionValue] of Object.entries(selectionsOrIndex)) {
            // Extract group index from key like "group0", "group1", etc.
            const groupIndexMatch = groupKey.match(/^group(\d+)$/);
            if (!groupIndexMatch) continue;

            const groupIndex = parseInt(groupIndexMatch[1], 10);
            const group = groups[groupIndex];
            if (!group || !group.options) continue;

            // Handle both single index and array of indices (multi-select)
            const optionIndices = Array.isArray(optionValue) ? optionValue : [optionValue];

            for (const optionIndex of optionIndices) {
                const option = group.options[optionIndex];
                if (!option) continue;

                // Apply price modifications - override takes precedence
                if (option.priceOverride !== null && !isNaN(option.priceOverride)) {
                    price = option.priceOverride;
                } else {
                    if (option.priceModifier !== null && !isNaN(option.priceModifier)) {
                        price += option.priceModifier;
                    }
                    if (option.pricePercent !== null && !isNaN(option.pricePercent)) {
                        price += basePrice * (option.pricePercent / 100);
                    }
                }
            }
        }
    }

    return isNaN(price) ? 0 : price;
}

/**
 * Gets the active image tag from selected options.
 * Returns the image tag from the last selected option that has an [img:...] modifier.
 *
 * @param {Object} record - The Airtable record
 * @param {number|Object} selectionsOrIndex - Either a single option index or selections object
 * @returns {string|null} The image tag to use, or null if none specified
 */
export function getActiveImageTag(record, selectionsOrIndex = null) {
    if (selectionsOrIndex === null) {
        return null;
    }

    const groups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let imageTag = null;

    // Handle legacy single index format
    if (typeof selectionsOrIndex === 'number') {
        const flatOptions = flattenOptionGroups(groups);
        const option = flatOptions[selectionsOrIndex];
        if (option && option.imageTag) {
            return option.imageTag;
        }
        return null;
    }

    // Handle new selections object format (supports multi-select arrays)
    if (typeof selectionsOrIndex === 'object') {
        // Iterate through selections in order, last one with imageTag wins
        const sortedKeys = Object.keys(selectionsOrIndex).sort((a, b) => {
            const indexA = parseInt(a.replace('group', ''), 10) || 0;
            const indexB = parseInt(b.replace('group', ''), 10) || 0;
            return indexA - indexB;
        });

        for (const groupKey of sortedKeys) {
            const optionValue = selectionsOrIndex[groupKey];
            const groupIndexMatch = groupKey.match(/^group(\d+)$/);
            if (!groupIndexMatch) continue;

            const groupIndex = parseInt(groupIndexMatch[1], 10);
            const group = groups[groupIndex];
            if (!group || !group.options) continue;

            // Handle both single index and array of indices (multi-select)
            const optionIndices = Array.isArray(optionValue) ? optionValue : [optionValue];

            for (const optionIndex of optionIndices) {
                const option = group.options[optionIndex];
                if (option && option.imageTag) {
                    imageTag = option.imageTag;
                }
            }
        }
    }

    return imageTag;
}

/**
 * Gets the full description for a record based on selected options.
 * Appends description text from selected options that have [desc:...] modifiers.
 *
 * @param {Object} record - The Airtable record
 * @param {number|Object} selectionsOrIndex - Either a single option index or selections object
 * @returns {string} The base description plus any appended text from selected options
 */
export function getRecordDescription(record, selectionsOrIndex = null) {
    const baseDescription = record?.fields?.Description || '';

    if (selectionsOrIndex === null) {
        return baseDescription;
    }

    const groups = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const appendedParts = [];

    // Handle legacy single index format
    if (typeof selectionsOrIndex === 'number') {
        const flatOptions = flattenOptionGroups(groups);
        const option = flatOptions[selectionsOrIndex];
        if (option && option.descriptionAppend) {
            appendedParts.push(option.descriptionAppend);
        }
    }

    // Handle new selections object format (supports multi-select arrays)
    if (typeof selectionsOrIndex === 'object') {
        const sortedKeys = Object.keys(selectionsOrIndex).sort((a, b) => {
            const indexA = parseInt(a.replace('group', ''), 10) || 0;
            const indexB = parseInt(b.replace('group', ''), 10) || 0;
            return indexA - indexB;
        });

        for (const groupKey of sortedKeys) {
            const optionValue = selectionsOrIndex[groupKey];
            const groupIndexMatch = groupKey.match(/^group(\d+)$/);
            if (!groupIndexMatch) continue;

            const groupIndex = parseInt(groupIndexMatch[1], 10);
            const group = groups[groupIndex];
            if (!group || !group.options) continue;

            // Handle both single index and array of indices (multi-select)
            const optionIndices = Array.isArray(optionValue) ? optionValue : [optionValue];

            for (const optionIndex of optionIndices) {
                const option = group.options[optionIndex];
                if (option && option.descriptionAppend) {
                    appendedParts.push(option.descriptionAppend);
                }
            }
        }
    }

    if (appendedParts.length === 0) {
        return baseDescription;
    }

    // Join base description with appended parts
    const separator = baseDescription ? '\n\n' : '';
    return baseDescription + separator + appendedParts.join('\n');
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

/**
 * Parses package contents from session data.
 * Package contents are now stored in the linked session's 'Items with Variations' field,
 * not in a separate 'Package Contents' field on the item record.
 *
 * @param {Object} sessionData - The parsed JSON from session's 'Items with Variations' field
 * @returns {Object} Parsed package contents with structure:
 *   {
 *     includedItems: [{ id, quantity, options, locked }],
 *     addOnItems: [{ id, quantity, options }],
 *     tiers: [{ name, price, includedItems, addOnItems }],
 *     metadata: { discount, price, pricingType }
 *   }
 */
export function parsePackageContentsFromSession(sessionData) {
    const defaultContents = {
        includedItems: [],
        addOnItems: [],
        tiers: [],
        metadata: { discount: 0, price: 0, pricingType: null }
    };

    if (!sessionData) {
        return defaultContents;
    }

    // Extract locked items as included items
    const includedItems = [];
    for (const [id, info] of Object.entries(sessionData.lockedInItems || {})) {
        includedItems.push({
            id,
            quantity: info.quantity || 1,
            options: info.selections || null,
            locked: true
        });
    }

    // Extract ideas as add-on items
    const addOnItems = [];
    for (const [id, info] of Object.entries(sessionData.ideasItems || {})) {
        addOnItems.push({
            id,
            quantity: info.quantity || 1,
            options: info.selections || null
        });
    }

    return {
        includedItems,
        addOnItems,
        tiers: sessionData.packageMetadata?.tiers || [],
        metadata: sessionData.packageMetadata || { discount: 0, price: 0, pricingType: null }
    };
}

/**
 * @deprecated Use parsePackageContentsFromSession instead.
 * This function attempted to read from a 'Package Contents' field that no longer exists.
 * Package data is now stored in the linked session's 'Items with Variations' field.
 */
export function parsePackageContents(record) {
    console.warn('[Utils] parsePackageContents is deprecated. Use parsePackageContentsFromSession with session data instead.');
    const defaultContents = {
        includedItems: [],
        addOnItems: [],
        tiers: []
    };

    if (!record || record.fields['Item Type'] !== 'Package') {
        return defaultContents;
    }

    // Return empty default - the data should be fetched from linked session
    return defaultContents;
}

/**
 * Calculates the total price for a package based on selected tier and customizations.
 * Supports tiered pricing (Decision 2 - Option C).
 *
 * @param {Object} packageContents - Package contents from parsePackageContentsFromSession
 * @param {Object} packageRecord - The Package record from Items table (for base price)
 * @param {Object} options - Options for price calculation
 *   @param {number} options.tierIndex - Selected tier index (0-based)
 *   @param {Array} options.addedAddOns - Array of add-on IDs that have been selected
 *   @param {Object} options.quantityOverrides - Map of item ID to quantity override
 * @param {Array} allRecords - All catalog records for looking up item prices
 * @returns {Object} Price breakdown:
 *   {
 *     basePrice: number,
 *     addOnsPrice: number,
 *     discount: number,
 *     totalPrice: number,
 *     savings: number
 *   }
 */
export function calculatePackagePriceFromContents(packageContents, packageRecord, options = {}, allRecords = []) {
    const { tierIndex = 0, addedAddOns = [], quantityOverrides = {} } = options;

    const tiers = packageContents.tiers || [];
    const metadata = packageContents.metadata || {};
    const discount = parseFloat(metadata.discount || 0);

    // Get base price from tier, metadata, or record
    let basePrice = 0;
    if (tiers.length > 0 && tiers[tierIndex]) {
        basePrice = parseFloat(tiers[tierIndex].price || 0);
    } else if (metadata.price) {
        basePrice = parseFloat(metadata.price);
    } else if (packageRecord) {
        basePrice = parseFloat(packageRecord.fields[CONSTANTS.FIELD_NAMES.PRICE] || 0);
    }

    // Calculate original value of included items (for savings display)
    let originalValue = 0;
    for (const itemRef of (packageContents.includedItems || [])) {
        const itemId = itemRef.id || itemRef;
        const itemRecord = allRecords.find(r => r.id === itemId);
        if (itemRecord) {
            const itemPrice = parseFloat(itemRecord.fields[CONSTANTS.FIELD_NAMES.PRICE] || 0);
            const qty = quantityOverrides[itemId] || itemRef.quantity || 1;
            originalValue += itemPrice * qty;
        }
    }

    // Calculate add-ons price
    let addOnsPrice = 0;
    for (const addOnId of addedAddOns) {
        const addOnRef = (packageContents.addOnItems || []).find(a => (a.id || a) === addOnId);
        if (addOnRef) {
            const addOnRecord = allRecords.find(r => r.id === addOnId);
            if (addOnRecord) {
                const addOnPrice = parseFloat(addOnRecord.fields[CONSTANTS.FIELD_NAMES.PRICE] || 0);
                const qty = quantityOverrides[addOnId] || addOnRef.quantity || 1;
                addOnsPrice += addOnPrice * qty;
            }
        }
    }

    // Calculate discount amount
    const discountAmount = discount > 0 ? (basePrice * (discount / 100)) : 0;

    // Calculate total
    const totalPrice = basePrice - discountAmount + addOnsPrice;

    // Calculate savings compared to buying items individually
    const savings = (originalValue + addOnsPrice) - totalPrice;

    return {
        basePrice,
        addOnsPrice,
        discount: discountAmount,
        totalPrice,
        savings: Math.max(0, savings),
        originalValue
    };
}

/**
 * @deprecated Use calculatePackagePriceFromContents instead.
 * This function relied on parsePackageContents which no longer works.
 */
export function calculatePackagePrice(record, options = {}, allRecords = []) {
    console.warn('[Utils] calculatePackagePrice is deprecated. Use calculatePackagePriceFromContents with session data instead.');

    // Return zero values since we can't access the data
    return {
        basePrice: parseFloat(record?.fields?.[CONSTANTS.FIELD_NAMES.PRICE] || 0),
        addOnsPrice: 0,
        discount: 0,
        totalPrice: parseFloat(record?.fields?.[CONSTANTS.FIELD_NAMES.PRICE] || 0),
        savings: 0,
        originalValue: 0
    };
}

/**
 * Dynamically calculates package price based on current component item prices.
 * This is the preferred method for displaying package prices as it always uses
 * the latest prices from the catalog items, applying any package discount.
 *
 * @param {Object} packageContents - Package contents from parsePackageContentsFromSession
 * @param {Object} packageMetadata - Package metadata containing discount info
 * @param {Array} allRecords - All catalog records for looking up current item prices
 * @param {number} headcount - The headcount/quantity to use for per-guest items (default: 1)
 * @returns {Object} Price breakdown:
 *   {
 *     subtotal: number,           // Sum of all item prices before discount
 *     discountPercent: number,    // Discount percentage (0-100)
 *     discountAmount: number,     // Dollar amount of discount
 *     totalPrice: number,         // Final price after discount
 *     itemBreakdown: Array,       // Breakdown by item with individual prices
 *     hasPerGuestItems: boolean   // Whether package contains per-guest items
 *   }
 */
export function calculateDynamicPackagePrice(packageContents, packageMetadata, allRecords, headcount = 1) {
    const includedItems = packageContents.includedItems || [];
    const discountPercent = parseFloat(packageMetadata?.discount || 0);

    let subtotal = 0;
    let hasPerGuestItems = false;
    const itemBreakdown = [];

    for (const itemRef of includedItems) {
        const itemId = itemRef.id || itemRef;
        const itemRecord = allRecords.find(r => r.id === itemId);

        if (!itemRecord) {
            console.warn(`[Utils] Package item ${itemId} not found in records`);
            continue;
        }

        // Get base price with selected options
        const selections = itemRef.options || itemRef.selections || {};
        const basePrice = getRecordPrice(itemRecord, selections);

        // Check if this is a per-guest item (multiplied by headcount)
        // Items with null/missing/empty pricing type are treated as flat rate (no headcount multiplication)
        const pricingType = itemRecord.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
        const isPerGuest = pricingType && pricingType.toLowerCase().includes('per guest');

        // For per-guest items, multiply by headcount; otherwise use item quantity
        const itemQuantity = itemRef.quantity || 1;
        let effectiveQuantity = itemQuantity;

        if (isPerGuest) {
            hasPerGuestItems = true;
            effectiveQuantity = headcount;
        }

        const itemTotal = basePrice * effectiveQuantity;
        subtotal += itemTotal;

        itemBreakdown.push({
            id: itemId,
            name: itemRecord.fields[CONSTANTS.FIELD_NAMES.NAME] || 'Unknown Item',
            basePrice,
            quantity: effectiveQuantity,
            isPerGuest,
            pricingType,
            total: itemTotal
        });
    }

    // Apply discount
    const discountAmount = discountPercent > 0 ? (subtotal * (discountPercent / 100)) : 0;
    const totalPrice = subtotal - discountAmount;

    return {
        subtotal,
        discountPercent,
        discountAmount,
        totalPrice,
        itemBreakdown,
        hasPerGuestItems
    };
}

/**
 * Gets the default headcount for a package based on its items.
 * Returns the maximum minimum headcount required across all included items.
 *
 * @param {Object} packageContents - Package contents from parsePackageContentsFromSession
 * @param {Array} allRecords - All catalog records
 * @returns {number} The recommended default headcount
 */
export function getPackageDefaultHeadcount(packageContents, allRecords) {
    const includedItems = packageContents.includedItems || [];
    let maxMinHeadcount = 1;

    for (const itemRef of includedItems) {
        const itemId = itemRef.id || itemRef;
        const itemRecord = allRecords.find(r => r.id === itemId);

        if (itemRecord) {
            const minHeadcount = itemRecord.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
            if (minHeadcount > maxMinHeadcount) {
                maxMinHeadcount = minHeadcount;
            }
        }
    }

    return maxMinHeadcount;
}

/**
 * Builds a Package Contents JSON object from a Session's locked items and ideas.
 * Used when publishing a Session as a Package (Decision 5 - Option B).
 *
 * @param {Map} lockedItems - Map of locked item IDs to item info
 * @param {Map} ideasItems - Map of ideas/favorites item IDs to item info
 * @param {Object} tierConfig - Optional tier configuration
 * @returns {Object} Package contents structure for storing in Airtable
 */
export function buildPackageContentsFromSession(lockedItems, ideasItems, tierConfig = null) {
    const includedItems = [];
    const addOnItems = [];

    // Locked items become included items (locked in)
    for (const [id, info] of lockedItems.entries()) {
        includedItems.push({
            id,
            quantity: info.quantity || 1,
            options: info.selections || info.selectedOptionIndex || null,
            locked: true
        });
    }

    // Ideas items become add-ons
    for (const [id, info] of ideasItems.entries()) {
        addOnItems.push({
            id,
            quantity: info.quantity || 1,
            options: info.selections || info.selectedOptionIndex || null
        });
    }

    const contents = {
        includedItems,
        addOnItems
    };

    // Add tier configuration if provided
    if (tierConfig && Array.isArray(tierConfig) && tierConfig.length > 0) {
        contents.tiers = tierConfig;
    }

    return contents;
}
