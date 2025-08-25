/*
 * Version: 2.3.0
 * Last Modified: 2025-08-25
 *
 * Changelog:
 *
 * v2.3.0 - 2025-08-25
 * - Rerouted all Cloudinary requests through a secure serverless function to fix CORS errors.
 * - Corrected the ultimateFallbackUrl to include a file extension (.jpg).
 */
import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { storeSession } from './session.js';
import { parseOptions } from './utils.js';

const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SESSIONS_TABLE_NAME = 'Sessions';

// ... (loadSessionFromAirtable and saveSessionToAirtable are unchanged)
export async function loadSessionFromAirtable(sessionId) {
    state.session.id = sessionId;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        if (!response.ok) throw new Error('Could not fetch session data.');
        const record = await response.json();
        
        state.session.isOwned = false;
        state.session.collaborators = record.fields.Collaborators ?
            record.fields.Collaborators.split(',').map(name => name.trim()) : [];
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
    const payload = { fields: { "Name": sessionName, "Items with Variations": JSON.stringify(sessionData), "Collaborators": state.session.collaborators.join(', '), "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) || null, "Location": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.LOCATION) || null, "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || null, "Date": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE) || null } };
    
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

export async function fetchImagesByTags(tags) {
    if (!tags || tags.length === 0) return null;

    try {
        let payload;
        if (Array.isArray(tags)) {
            // Prepare payload for multi-tag search
            payload = { expression: tags.map(tag => `tags:"${tag}"`).join(' AND ') };
        } else {
            // Prepare payload for single-tag list
            payload = { tag: tags };
        }
        
        // Call our own secure serverless function instead of Cloudinary directly
        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`Serverless function error: ${response.statusText}`);
        
        const data = await response.json();
        if (!data.resources || data.resources.length === 0) return null;

        return data.resources.map(image =>
            `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/v${image.version}/${image.public_id}.${image.format}`
        );
    } catch (error) {
        console.error('Failed to fetch from Cloudinary via proxy:', error);
        return null;
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
        return records.filter(record => record.fields[CONSTANTS.FIELD_NAMES.NAME]);
    } catch (error) {
        console.error(error);
        throw error;
    }
}

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        return imageCache.get(cacheKey);
    }

    // CORRECTED: Added .jpg to the fallback URL to prevent 404 errors.
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/default-event-image.jpg`;
    let imageUrls = null;

    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    if (isGrouping) {
        // Collage logic would go here
    } else {
        const itemName = record.fields[CONSTANTS.FIELD_NAMES.NAME];
        if (itemName) {
            const autoTagName = itemName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            imageUrls = await fetchImagesByTags(autoTagName);
        }
        
        if (!imageUrls) {
            const manualTags = record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];
            const primaryManualTag = (manualTags && manualTags.trim() !== '') ? manualTags.split(',')[0].trim() : null;
            if (primaryManualTag) {
                imageUrls = await fetchImagesByTags(primaryManualTag);
            }
        }
    }
    
    const finalImageUrls = imageUrls || [ultimateFallbackUrl];
    imageCache.set(cacheKey, finalImageUrls);
    return finalImageUrls;
}
