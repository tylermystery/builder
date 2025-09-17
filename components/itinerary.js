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
    const cacheKey = tagArray.sort().join(',');

    if (imageCache.has(cacheKey)) {
        return Promise.resolve(imageCache.get(cacheKey));
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
                const uniqueResults = Array.from(new Set(flattenedResults));
                imageCache.set(cacheKey, uniqueResults);
                resolve(uniqueResults);
            })
            .catch(reject);
    });
}
