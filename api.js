/*
 * Version: 2.7.6
 * Last Modified: 2025-08-27
 *
 * Changelog:
 *
 * v2.7.6 - 2025-08-27
 * - Fixed bug with grouping item images not displaying.
 * - Unified the logic for identifying a "grouping" item.
 * - Implemented new rule: find a group-specific image, or fall back to the first child's image.
 *
 * v2.7.5 - 2025-08-26
 * - Reverted to hard-coded keys for development purposes.
 */
import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { storeSession } from './session.js';
import { parseOptions } from './utils.js';

const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SESSIONS_TABLE_NAME = 'Sessions';

export async function loadSessionFromAirtable(sessionId) {
    // ... (This function is unchanged)
}

export async function saveSessionToAirtable() {
    // ... (This function is unchanged)
}


export async function fetchAllRecords() {
    // ... (This function is unchanged)
}

export async function fetchCalendarForRecord(record) {
    // ... (This function is unchanged)
}

export async function fetchImagesByTags(tags) {
    // ... (This function is unchanged)
}

// This function is no longer needed with the new, simpler logic.
// async function getRecursiveChildImageUrls(...) { ... }

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        return imageCache.get(cacheKey);
    }

    const defaultImagePublicID = 'ww71meppejsewxsxr4x7.jpg';
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/${defaultImagePublicID}`;
    
    let imageUrls = null;
    
    // --- UNIFIED GROUPING LOGIC ---
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
    // --- END UNIFIED LOGIC ---

    if (isGrouping) {
        // Rule 1: Try to find an image tagged with the group's name.
        const groupNameTag = record.fields[CONSTANTS.FIELD_NAMES.NAME].toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        imageUrls = await fetchImagesByTags(groupNameTag);

        // Rule 2: If no specific group image, find the first child and use its image.
        if (!imageUrls || imageUrls.length === 0) {
            const firstChildOption = rawOptions.length > 0 ? rawOptions[0] : null;

            if (firstChildOption) {
                const firstChildRecord = allRecords.find(r => r.fields.Name === firstChildOption.name);
                if (firstChildRecord) {
                    // Recursively call this function to get the child's image data
                    const childImageData = await fetchImagesForRecord(firstChildRecord, allRecords, imageCache);
                    imageUrls = childImageData.imageUrls;
                }
            }
        }
    } else {
        // This is the existing, working logic for final (non-grouping) items.
        const itemName = record.fields[CONSTANTS.FIELD_NAMES.NAME];
        if (itemName) {
            const autoTagName = itemName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            imageUrls = await fetchImagesByTags(autoTagName);
        }
        
        if (!imageUrls) {
            const manualTags = record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];
            const primaryManualTag = (manualTags && manualTags.trim() !== '') ? manualTags.split(',').shift().trim() : null;
            if (primaryManualTag) {
                imageUrls = await fetchImagesByTags(primaryManualTag);
            }
        }
    }
    
    const finalImageUrls = (imageUrls && imageUrls.length > 0) ? imageUrls : [ultimateFallbackUrl];
    
    const result = {
        isGrouping: isGrouping,
        imageUrls: finalImageUrls.flat()
    };
    imageCache.set(cacheKey, result);
    return result;
}
