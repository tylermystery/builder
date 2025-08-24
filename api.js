/*
 * Version: 1.6.0
 * Last Modified: 2025-08-23
 *
 * Changelog:
 *
 * v1.6.0 - 2025-08-23
 * - Implemented dynamic collage generation for Grouping items via Cloudinary.
 * - fetchImagesForRecord is now hierarchy-aware.
 */
import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { storeSession } from './main.js';
import { parseOptions } from './ui.js';

const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SESSIONS_TABLE_NAME = 'Sessions';

export async function loadSessionFromAirtable(sessionId) {
    // ... (logic remains the same)
}
export async function saveSessionToAirtable() {
    // ... (logic remains the same)
}
export async function fetchAllRecords() {
    // ... (logic remains the same)
}

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        return imageCache.get(cacheKey);
    }

    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/default-event-image`;

    // --- NEW LOGIC: Check if the record is a Grouping ---
    if (isGrouping) {
        const children = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0] === record.id);
        if (children.length > 0) {
            // Get the primary media tag from up to 4 children
            let childTags = children.slice(0, 4).map(child => {
                const tags = child.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];
                return (tags && tags.trim() !== '') ? tags.split(',')[0].trim() : 'default-event-image';
            });
            
            // Pad with default images if less than 4 children
            while (childTags.length < 4) {
                childTags.push('default-event-image');
            }

            // Construct a dynamic 2x2 collage URL with Cloudinary transformations
            const collageUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,w_600,h_520,g_auto/
l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC9jX2ZpbGwsZ19hdXRvLGhfZ2V0L3dfZGVhL3RhZ19yZXNpemU6YXV0by92MV8xL3BsYW5uZXJzLyR7Y2hpbGRUYWdzWzBdfQ==/fl_layer_apply,g_north_west,w_0.5,h_0.5,c_fill/
l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC9jX2ZpbGwsZ19hdXRvLGhfZ2V0L3dfZGVhL3RhZ19yZXNpemU6YXV0by92MV8xL3BsYW5uZXJzLyR7Y2hpbGRUYWdzWzFdfQ==/fl_layer_apply,g_north_east,w_0.5,h_0.5,c_fill/
l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC9jX2ZpbGwsZ19hdXRvLGhfZ2V0L3dfZGVhL3RhZ19yZXNpemU6YXV0by92MV8xL3BsYW5uZXJzLyR7Y2hpbGRUYWdzWzJdfQ==/fl_layer_apply,g_south_west,w_0.5,h_0.5,c_fill/
l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC9jX2ZpbGwsZ19hdXRvLGhfZ2V0L3dfZGVhL3RhZ19yZXNpemU6YXV0by92MV8xL3BsYW5uZXJzLyR7Y2hpbGRUYWdzWzNdfQ==/fl_layer_apply,g_south_east,w_0.5,h_0.5,c_fill/
default-event-image.jpg`.replace(/\s/g, ''); // Remove newlines

            imageCache.set(cacheKey, [collageUrl]);
            return [collageUrl];
        }
    }

    // --- Original Logic for Bookable Items ---
    const tags = record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];
    const primaryTag = (tags && tags.trim() !== '') ? tags.split(',')[0].trim() : 'default-event-image';
    
    const cloudinaryUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/list/${encodeURIComponent(primaryTag)}.json`;

    try {
        const response = await fetch(cloudinaryUrl);
        if (!response.ok) throw new Error('Cloudinary list fetch failed.');
        const data = await response.json();
        if (!data.resources || data.resources.length === 0) {
           return [ultimateFallbackUrl];
        }
       
        const imageUrls = data.resources.map(image =>
            `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/v${image.version}/${image.public_id}.${image.format}`
        );
        imageCache.set(cacheKey, imageUrls);
        return imageUrls;
    } catch (error) {
        console.error('Failed to fetch images from Cloudinary:', error);
        imageCache.set(cacheKey, [ultimateFallbackUrl]);
        return [ultimateFallbackUrl];
    }
}
