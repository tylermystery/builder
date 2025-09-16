// FILE: imageManager.js (NEW AND IMPROVED)
import { debounce } from './utils.js';
import * as api from './api.js';
import { log } from './utils/debug.js';
import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { parseOptions } from './utils.js';

const requestQueue = new Set();
const imageCache = new Map();
const pendingRequests = new Map();
const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`;

// This internal function processes the queue, just like in our previous attempt.
const processRequestQueue = debounce(async () => {
    if (requestQueue.size === 0) return;

    const tagsToFetch = Array.from(requestQueue);
    requestQueue.clear();
    log('ImageManager', `Processing batch request for tags: ${tagsToFetch.join(', ')}`);

    try {
        const imageUrlsMap = await api.fetchImagesByTags(tagsToFetch); // Assumes fetchImagesByTags returns a Map
        
        tagsToFetch.forEach(tag => {
            const resultUrls = imageUrlsMap.get(tag) || [];
            imageCache.set(tag, resultUrls);
            if (pendingRequests.has(tag)) {
                pendingRequests.get(tag).forEach(handler => handler.resolve(resultUrls));
                pendingRequests.delete(tag);
            }
        });

    } catch (error) {
        log('ImageManager', `Image batch fetch failed: ${error}`);
        tagsToFetch.forEach(tag => {
            if (pendingRequests.has(tag)) {
                pendingRequests.get(tag).forEach(handler => handler.reject(error));
                pendingRequests.delete(tag);
            }
        });
    }
}, 50); // 50ms debounce window

// This internal function fetches images for a set of tags using the batching system.
function fetchAndCacheTags(tags) {
    const tagArray = Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()) : []);
    if (tagArray.length === 0) {
        return Promise.resolve([]);
    }

    return new Promise((resolve, reject) => {
        const promises = tagArray.map(tag => {
            return new Promise((res, rej) => {
                if (imageCache.has(tag)) {
                    res(imageCache.get(tag));
                } else {
                    if (!pendingRequests.has(tag)) {
                        pendingRequests.set(tag, []);
                    }
                    pendingRequests.get(tag).push({ resolve: res, reject: rej });
                    requestQueue.add(tag);
                }
            });
        });
        
        processRequestQueue();

        Promise.all(promises)
            .then(results => {
                const flattenedResults = results.flat();
                resolve(Array.from(new Set(flattenedResults)));
            })
            .catch(reject);
    });
}

/**
 * The primary function to get images for any record.
 * It intelligently handles grouping items vs. bookable items.
 */
export async function getImagesForRecord(record) {
    const allRecords = state.records.all;
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    // Logic from the old "working" code: If it's a category, just return the fallback.
    if (isGrouping) {
        log('ImageManager', `Record "${record.fields.Name}" is a grouping. Returning fallback.`);
        return [ultimateFallbackUrl];
    }

    // It's a bookable item, so fetch images using our efficient batching system.
    log('ImageManager', `Record "${record.fields.Name}" is bookable. Fetching tags.`);
    let imageUrls = await fetchAndCacheTags(record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]);

    if (!imageUrls || imageUrls.length === 0) {
        imageUrls = [ultimateFallbackUrl];
    }

    return imageUrls;
}
