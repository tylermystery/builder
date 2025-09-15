// FILE: imageManager.js
import { debounce } from './utils.js';
import * as api from './api.js';
import { log } from './utils/debug.js';

// A Set to hold unique tags for the upcoming batch request.
let requestQueue = new Set();
// A Map to cache the results of batch fetches to avoid re-fetching.
const imageCache = new Map();
// A Map to hold the promise handlers for each pending request.
let pendingRequests = new Map();

const processRequestQueue = debounce(async () => {
    if (requestQueue.size === 0) return;

    const tagsToFetch = Array.from(requestQueue);
    requestQueue.clear();

    log('ImageManager', `Processing batch request for tags: ${tagsToFetch.join(', ')}`);

    try {
        const imageUrlsMap = await api.fetchImagesByTags(tagsToFetch);

        // Resolve all pending promises with the fetched URLs
        tagsToFetch.forEach(tag => {
            const resultUrls = imageUrlsMap.get(tag) || [];
            if (pendingRequests.has(tag)) {
                pendingRequests.get(tag).forEach(handler => handler.resolve(resultUrls));
                pendingRequests.delete(tag);
            }
        });

    } catch (error) {
        log('ImageManager', `Image batch fetch failed: ${error}`);
        // Reject all pending promises in case of failure
        tagsToFetch.forEach(tag => {
            if (pendingRequests.has(tag)) {
                pendingRequests.get(tag).forEach(handler => handler.reject(error));
                pendingRequests.delete(tag);
            }
        });
    }
}, 50); // Wait 50ms to collect simultaneous requests into a single batch.

export function getImagesForTags(tags) {
    if (!tags || tags.length === 0) {
        return Promise.resolve([]);
    }
    
    const tagArray = Array.isArray(tags) ? tags : [tags];
    const cacheKey = tagArray.sort().join(',');

    if (imageCache.has(cacheKey)) {
        return Promise.resolve(imageCache.get(cacheKey));
    }

    return new Promise((resolve, reject) => {
        tagArray.forEach(tag => {
            if (!pendingRequests.has(tag)) {
                pendingRequests.set(tag, []);
            }
            pendingRequests.get(tag).push({ resolve, reject });
            requestQueue.add(tag);
        });
        processRequestQueue();
    });
}
