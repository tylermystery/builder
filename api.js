/*
 * Version: 2.7.7
 * Last Modified: 2025-08-28
 *
 * Changelog:
 *
 * v2.7.7 - 2025-08-28
 * - Made fetchImagesByTags more resilient to server errors to allow UI to render with fallback images.
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
    state.session.id = sessionId;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        if (!response.ok) throw new Error('Could not fetch session data.');
        const record = await response.json();
        
        state.session.isOwned = false;
        state.session.collaborators = record.fields.Collaborators ? record.fields.Collaborators.split(',').map(name => name.trim()) : [];
        const sessionDataString = record.fields['Items with Variations'];
        if (sessionDataString) {
            const savedState = JSON.parse(sessionDataString);
            if (savedState.favoritedItems) state.cart.items = new Map(Object.entries(savedState.favoritedItems));
            if (savedState.lockedInItems) state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems));
            if (savedState.itemReactions) state.session.reactions = new Map(Object.entries(savedState.itemReactions));
            if (savedState.favoritedDetails) state.eventDetails.combined = new Map(Object.entries(savedState.favoritedDetails));
        }
    } catch (error) {
        console.error("Failed to load session:", error);
        alert("Could not load the shared session.");
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

export async function saveSessionToAirtable() {
    if (state.session.id && !state.session.isOwned) {
        state.session.id = null;
    }

    const sessionData = { favoritedItems: Object.fromEntries(state.cart.items), lockedInItems: Object.fromEntries(state.cart.lockedItems), itemReactions: Object.fromEntries(state.session.reactions), favoritedDetails: Object.fromEntries(state.eventDetails.combined) };
    const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || `Session from ${new Date().toLocaleString()}`;

    const dateRange = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    let formattedDate = null;
    if (Array.isArray(dateRange) && dateRange.length > 0) {
        const startDateString = dateRange[0];
        if (startDateString && /^\d{4}-\d{2}-\d{2}$/.test(startDateString)) {
            formattedDate = new Date(startDateString).toISOString();
        } else {
            console.error("Invalid date format in state, cannot save:", startDateString);
        }
    }

    const payload = {
        fields: {
            "Name": sessionName,
            "Items with Variations": JSON.stringify(sessionData),
            "Collaborators": state.session.collaborators.join(', '),
            "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) ||
 null,
            "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) ||
 null,
            "Date": formattedDate
        }
    };
    const isUpdate = state.session.id !== null;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}` + (isUpdate ? `/${state.session.id}` : '');
    const method = isUpdate ? 'PATCH' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(isUpdate ? payload : { records: [payload] })
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Airtable API Error: ${errorData.error.message}`);
        }
        const result = await response.json();
        if (!isUpdate) {
            state.session.id = result.records[0].id;
            state.session.isOwned = true;
            window.history.replaceState({}, document.title, `?session=${state.session.id}`);
        }
        
        storeSession(state.session.id, sessionName);
        return true;
    } catch (error) {
        console.error("Failed to save session:", error);
        return false;
    }
}


export async function fetchAllRecords() {
    let records = [];
    let offset = null;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?`;
    try {
        do {
            const response = await fetch(offset ? `${url}&offset=${offset}` : url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
            if (!response.ok) throw new Error('Failed to fetch data from Airtable.');
            const data = await response.json();
            records = records.concat(data.records);
            offset = data.offset;
        } while (offset);
        return records.filter(record => record.fields);
    } catch (error) {
        console.error(error);
        throw error;
    }
}

export async function fetchCalendarForRecord(record) {
    const icalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];
    if (!icalUrl) {
        return [];
    }

    if (state.calendar.busyTimes.has(icalUrl)) {
        return state.calendar.busyTimes.get(icalUrl);
    }

    try {
        const proxyUrl = `/api/calendar?url=${encodeURIComponent(icalUrl)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            throw new Error(`Calendar API Error: ${response.statusText}`);
        }
        const busyTimes = await response.json();
        state.calendar.busyTimes.set(icalUrl, busyTimes);
        return busyTimes;
    } catch (error) {
        console.error(`Failed to fetch calendar for ${record.fields.Name}:`, error);
        state.calendar.busyTimes.set(icalUrl, []);
        return [];
    }
}

export async function fetchImagesByTags(tags) {
    if (!tags || tags.length === 0) return null;
    try {
        let payload;
        if (Array.isArray(tags)) {
            payload = { expression: tags.map(tag => `tags:"${tag}"`).join(' AND ') };
        } else {
            payload = { tag: tags };
        }
        
        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            console.warn(`Cloudinary function error: ${response.statusText}`);
            return null;
        }
        
        const data = await response.json();
        if (!data.resources || data.resources.length === 0) return null;
        
        return data.resources.map(image => {
            let transformations;
            if (image.format === 'gif') {
                transformations = 'c_fit,w_600,h_520';
            } else {
                transformations = 'c_fill,g_auto,w_600,h_520';
          
            }
            const urlParts = image.secure_url.split('/upload/');
            return `${urlParts[0]}/upload/${transformations}/${urlParts[1]}`;
        });
    } catch (error) {
        console.error('Failed to fetch from Cloudinary via proxy:', error);
        return null;
    }
}

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
            const firstChildOption = rawOptions.length > 0 ?
 rawOptions[0] : null;

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
    
    const finalImageUrls = (imageUrls && imageUrls.length > 0) ?
 imageUrls : [ultimateFallbackUrl];
    
    const result = {
        isGrouping: isGrouping,
        imageUrls: finalImageUrls.flat()
    };
    imageCache.set(cacheKey, result);
    return result;
}
