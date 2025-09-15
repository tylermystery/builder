// FILE: imageManager.js
import { debounce } from './utils.js';
import * as api from './api.js';

let requestQueue = new Set();
const imageCache = new Map();
let pendingRequests = new Map();

// This function will be called after a short delay to process the queue
const processRequestQueue = debounce(async () => {
    if (requestQueue.size === 0) return;

    const tagsToFetch = Array.from(requestQueue);
    requestQueue.clear(); // Clear the queue for the next batch

    try {
        const imageUrls = await api.fetchImagesByTags(tagsToFetch);
        
        // Even if some tags return no images, we resolve the promises
        // to prevent requests from hanging.
        if (imageUrls && imageUrls.length > 0) {
            // A simple way to map results back to tags isn't perfect but works for this case.
            // A more advanced version would have the API return a tag-to-URL map.
            imageCache.set(tagsToFetch.join(','), imageUrls);
        }
        
        // Resolve all pending promises with the fetched URLs
        tagsToFetch.forEach(tag => {
            if (pendingRequests.has(tag)) {
                pendingRequests.get(tag).resolve(imageUrls || []);
                pendingRequests.delete(tag);
            }
        });

    } catch (error) {
        console.error("Image batch fetch failed:", error);
        // Reject all pending promises in case of failure
        tagsToFetch.forEach(tag => {
            if (pendingRequests.has(tag)) {
                pendingRequests.get(tag).reject(error);
                pendingRequests.delete(tag);
            }
        });
    }
}, 100); // Wait 100ms to batch requests

export function getImagesForTags(tags) {
    if (!tags || tags.length === 0) {
        return Promise.resolve([]);
    }
    
    // Use a canonical key for the cache to handle tags in different orders
    const cacheKey = Array.isArray(tags) ? tags.sort().join(',') : tags;

    if (imageCache.has(cacheKey)) {
        return Promise.resolve(imageCache.get(cacheKey));
    }

    return new Promise((resolve, reject) => {
        const tagArray = Array.isArray(tags) ? tags : [tags];
        tagArray.forEach(tag => {
            requestQueue.add(tag);
            // Store the resolve/reject functions to be called when the batch processes
            pendingRequests.set(tag, { resolve, reject });
        });
        processRequestQueue();
    });
}
