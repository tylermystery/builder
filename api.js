/*
 * Version: 1.5.0
 * Last Modified: 2025-08-18
 *
 * Changelog:
 *
 * v1.5.0 - 2025-08-18
 * - [cite_start]Upgraded `fetchImageForRecord` to `fetchImagesForRecord` to retrieve all associated images from Cloudinary instead of a single random one. [cite: 362]
 * - [cite_start]Updated caching logic to store the entire array of image URLs. [cite: 363]
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */
import { state } from './state.js';
[cite_start]import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js'; [cite: 364]
import { storeSession } from './main.js';
const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
[cite_start]const BASE_ID = 'app5yTznb3R5YNUFw'; [cite: 365]
const TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SESSIONS_TABLE_NAME = 'Sessions';
[cite_start]export async function loadSessionFromAirtable(sessionId) { [cite: 366]
    state.session.id = sessionId;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    [cite_start]try { [cite: 367]
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        [cite_start]if (!response.ok) throw new Error('Could not fetch session data.'); [cite: 368]
        const record = await response.json();
        state.session.collaborators = record.fields.Collaborators ?
            [cite_start]record.fields.Collaborators.split(',').map(name => name.trim()) : []; [cite: 369]
        const sessionDataString = record.fields['Items with Variations'];
        [cite_start]if (sessionDataString) { [cite: 370]
            const savedState = JSON.parse(sessionDataString);
            [cite_start]if (savedState.favoritedItems) state.cart.items = new Map(Object.entries(savedState.favoritedItems)); [cite: 371]
            if (savedState.lockedInItems) state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems));
            if (savedState.itemReactions) state.session.reactions = new Map(Object.entries(savedState.itemReactions));
            [cite_start]if (savedState.favoritedDetails) state.eventDetails.combined = new Map(Object.entries(savedState.favoritedDetails)); [cite: 372]
            storeSession(sessionId, record.fields.Name);
        }
    } catch (error) {
        console.error("Failed to load session:", error);
        [cite_start]alert("Could not load the shared session."); [cite: 373]
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}
export async function saveSessionToAirtable() {
    [cite_start]document.getElementById('save-status').textContent = 'Saving...'; [cite: 374]
    const sessionData = { favoritedItems: Object.fromEntries(state.cart.items), lockedInItems: Object.fromEntries(state.cart.lockedItems), itemReactions: Object.fromEntries(state.session.reactions), favoritedDetails: Object.fromEntries(state.eventDetails.combined) };
    const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) ||
        [cite_start]`Session from ${new Date().toLocaleString()}`; [cite: 375]
    const payload = { fields: { "Name": sessionName, "Items with Variations": JSON.stringify(sessionData), "Collaborators": state.session.collaborators.join(', '), "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) ||
        [cite_start]null, "Location": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.LOCATION) || null, "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.SPECIAL_REQUESTS) || null, "Date": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE) || null } }; [cite: 376]
    [cite_start]const isUpdate = state.session.id !== null; [cite: 377]
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}` + (isUpdate ? `/${state.session.id}` : '');
    const method = isUpdate ? [cite_start]'PATCH' : 'POST'; [cite: 378]
    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(isUpdate ? payload : { records: [payload] })
        });
        [cite_start]if (!response.ok) { [cite: 379]
            const errorData = await response.json();
            [cite_start]throw new Error(`Airtable API Error: ${errorData.error.message}`); [cite: 380]
        }
        const result = await response.json();
        [cite_start]if (!isUpdate) { [cite: 381]
            [cite_start]state.session.id = result.records[0].id; [cite: 382]
        }
        storeSession(state.session.id, sessionName);
        window.history.replaceState({}, document.title, `?session=${state.session.id}`);
        [cite_start]return true; [cite: 383]
    } catch (error) {
        console.error("Failed to save session:", error);
        document.getElementById('save-status').textContent = 'Error saving.';
        [cite_start]return false; [cite: 384]
    }
}
export async function fetchAllRecords() {
    let records = [];
    let offset = null;
    [cite_start]const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?`; [cite: 385]
    try {
        do {
            const response = await fetch(offset ? `${url}&offset=${offset}` : url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
            [cite_start]if (!response.ok) throw new Error('Failed to fetch data from Airtable.'); [cite: 386]
            const data = await response.json();
            records = records.concat(data.records);
            [cite_start]offset = data.offset; [cite: 387]
        } while (offset);
        [cite_start]return records.filter(record => record.fields[CONSTANTS.FIELD_NAMES.NAME]); [cite: 388]
    } catch (error) {
        console.error(error);
        [cite_start]throw error; [cite: 389]
    }
}
export async function fetchImagesForRecord(record, imageCache) {
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/default-event-image`;
    const cacheKey = record.id;
    [cite_start]if (imageCache.has(cacheKey)) { [cite: 390]
        return imageCache.get(cacheKey);
    }
    const tags = record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];
    [cite_start]const primaryTag = (tags && tags.trim() !== '') ? tags.split(',')[0].trim() : 'default'; [cite: 391]
    [cite_start]if (!CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME === 'Your_Cloud_Name_Here') { [cite: 392]
        const placeholderUrls = [`https://placehold.co/600x400/007aff/FFFFFF?text=${encodeURIComponent(record.fields[CONSTANTS.FIELD_NAMES.NAME])}`];
        imageCache.set(cacheKey, placeholderUrls);
        [cite_start]return placeholderUrls; [cite: 393]
    }
    const encodedTag = encodeURIComponent(primaryTag);
    [cite_start]const cloudinaryUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/list/${encodedTag}.json`; [cite: 394]
    try {
        const response = await fetch(cloudinaryUrl);
        [cite_start]if (!response.ok) { [cite: 395]
            imageCache.set(cacheKey, [ultimateFallbackUrl]);
            [cite_start]return [ultimateFallbackUrl]; [cite: 396]
        }
        const data = await response.json();
        [cite_start]if (!data.resources || data.resources.length === 0) { [cite: 397]
            imageCache.set(cacheKey, [ultimateFallbackUrl]);
            [cite_start]return [ultimateFallbackUrl]; [cite: 398]
        }
       
        const imageUrls = data.resources.map(image =>
            `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/v${image.version}/${image.public_id}.${image.format}`
        );
        [cite_start]imageCache.set(cacheKey, imageUrls); [cite: 399]
        return imageUrls;
    } catch (error) {
        console.error('Failed to fetch images from Cloudinary:', error);
        [cite_start]imageCache.set(cacheKey, [ultimateFallbackUrl]); [cite: 400]
        return [ultimateFallbackUrl];
    }
}
