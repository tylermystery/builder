// FILE: imageManager.js
import { debounce } from './utils.js';
import * as api from './api.js';
import { log } from './utils/debug.js';

let requestQueue = new Set();
const imageCache = new Map();
let pendingRequests = new Map();

const processRequestQueue = debounce(async () => {
    if (requestQueue.size === 0) return;

    const tagsToFetch = Array.from(requestQueue);
    requestQueue.clear();

    log('ImageManager', `Processing batch request for tags: ${tagsToFetch.join(', ')}`);

    try {
        const imageUrlsMap = await api.fetchImagesByTags(tagsToFetch);
        
        tagsToFetch.forEach(tag => {
            const resultUrls = imageUrlsMap.get(tag) || [];
            // Cache the result for this specific tag combination
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
}, 50);

export function getImagesForTags(tags) {
    if (!tags || tags.length === 0) {
        return Promise.resolve([]);
    }
    
    const tagArray = Array.isArray(tags) ? tags : [tags];
    // A single tag is the simplest cache key
    const cacheKey = tagArray.join(',');

    if (imageCache.has(cacheKey)) {
        return Promise.resolve(imageCache.get(cacheKey));
    }

    return new Promise((resolve, reject) => {
        tagArray.forEach(tag => {
            // Even if multiple components request the same tag, we only need to handle it once
            if (!pendingRequests.has(tag)) {
                pendingRequests.set(tag, []);
            }
            pendingRequests.get(tag).push({ resolve, reject });
            requestQueue.add(tag);
        });
        processRequestQueue();
    });
}
