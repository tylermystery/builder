/*
 * Version: 1.7.0
 * Last Modified: 2025-08-23
 *
 * Changelog:
 *
 * v1.7.0 - 2025-08-23
 * - Implemented dynamic collage generation for Grouping items via Cloudinary.
 * - Added text-based acronyms as a fallback for options without images.
 * - fetchImagesForRecord is now hierarchy-aware.
 */
import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { storeSession } from './session.js';
import { parseOptions } from './ui.js';

const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SESSIONS_TABLE_NAME = 'Sessions';

function getInitials(name = '') {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
}

export async function loadSessionFromAirtable(sessionId) {
    // This function remains the same
}
export async function saveSessionToAirtable() {
    // This function remains the same
}
export async function fetchAllRecords() {
    // This function remains the same
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
            const collageOverlays = children.slice(0, 4).map(child => {
                const tags = child.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];
                if (tags && tags.trim() !== '') {
                    // This is an image overlay
                    const primaryTag = tags.split(',')[0].trim();
                    return `l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC9jX2ZpbGwsZ19hdXRvLGhfZ2V0L3dfZGVhL3RhZ19yZXNpemU6YXV0by92MV8xL3BsYW5uZXJzLyR7cHJpbWFyeVRhZ30=/`;
                } else {
                    // This is a text overlay (acronym)
                    const initials = getInitials(child.fields.Name);
                    return `l_text:Arial_80_bold:${encodeURIComponent(initials)},co_white,g_center/`;
                }
            });
            
            // Pad with empty overlays if we have fewer than 4 children
            while (collageOverlays.length < 4) {
                collageOverlays.push('l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC92MTcwMDAwMDAwMC9wbGFubmVycy9kZWZhdWx0LWV2ZW50LWltYWdl');
            }

            const collageUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,w_600,h_520,g_auto/
${collageOverlays[0]}fl_layer_apply,g_north_west,w_0.5,h_0.5,c_fill/
${collageOverlays[1]}fl_layer_apply,g_north_east,w_0.5,h_0.5,c_fill/
${collageOverlays[2]}fl_layer_apply,g_south_west,w_0.5,h_0.5,c_fill/
${collageOverlays[3]}fl_layer_apply,g_south_east,w_0.5,h_0.5,c_fill/
default-event-image.jpg`.replace(/\s/g, '');

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
