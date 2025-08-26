/*
 * Version: 2.5.1
 * Last Modified: 2025-08-25
 *
 * Changelog:
 *
 * v2.5.1 - 2025-08-25
 * - fetchImagesForRecord now returns an object { isGrouping, imageUrls }
 * to make it the single source of truth for this logic.
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
            payload = { expression: tags.map(tag => `tags:"${tag}"`).join(' AND ') };
        } else {
            payload = { tag: tags };
        }
        
        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`Serverless function error: ${response.statusText}`);
        
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

async function getRecursiveChildImageUrls(record, allRecords, imageCache, maxDepth = 2, currentDepth = 1) {
    if (!record || typeof record !== 'object' || !record.id) {
        console.error("Invalid data passed to getRecursiveChildImageUrls:", record);
        return [];
    }
    if (currentDepth > maxDepth) return [];

    let children = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0] === record.id);
    
    if (children.length === 0) {
        const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const childNames = new Set(rawOptions.map(opt => opt.name));
        children = allRecords.filter(r => childNames.has(r.fields.Name));
    }
    
    let imageUrls = [];

    for (const child of children) {
        const isChildGrouping = allRecords.some(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0] === child.id);

        if (isChildGrouping && currentDepth < maxDepth) {
            const deeperUrls = await getRecursiveChildImageUrls(child, allRecords, imageCache, maxDepth, currentDepth + 1);
            imageUrls.push(...deeperUrls);
        } else {
            const imageData = await fetchImagesForRecord(child, allRecords, imageCache);
            imageUrls.push(imageData.imageUrls[0]);
        }
    }
    return imageUrls;
}

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        return imageCache.get(cacheKey);
    }

    const defaultImagePublicID = 'ww71meppejsewxsxr4x7.jpg';
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/${defaultImagePublicID}`;
    
    let imageUrls = null;
    const isGrouping = allRecords.some(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0] === record.id);

    if (isGrouping) {
        imageUrls = await getRecursiveChildImageUrls(record, allRecords, imageCache);
    } else {
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
    
    // The final returned object is now the single source of truth.
    const result = {
        isGrouping: isGrouping,
        imageUrls: finalImageUrls
    };

    imageCache.set(cacheKey, result);
    return result;
}
