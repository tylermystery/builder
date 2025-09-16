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
            imageCache.set(tag, resultUrls); // Cache results for individual tags
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
}, 50); // Wait 50ms to collect simultaneous requests into a single batch.

export function getImagesForTags(tags) {
    if (!tags || tags.length === 0) {
        return Promise.resolve([]);
    }
    
    const tagArray = Array.isArray(tags) ? tags : [tags];
    
    // Check cache for each tag individually
    const cachedResults = [];
    let allTagsCached = true;
    for (const tag of tagArray) {
        if (imageCache.has(tag)) {
            cachedResults.push(...imageCache.get(tag));
        } else {
            allTagsCached = false;
            break;
        }
    }

    if (allTagsCached) {
        return Promise.resolve(Array.from(new Set(cachedResults))); // Return unique URLs
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
