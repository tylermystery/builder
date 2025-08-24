/*
 * Version: 1.6.1
 * Last Modified: 2025-08-23
 *
 * Changelog:
 *
 * v1.6.1 - 2025-08-23
 * - Updated imports to point to new session.js file to fix circular dependency.
 */
import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { storeSession } from './session.js';
import { parseOptions } from './ui.js';

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
        state.session.collaborators = record.fields.Collaborators ?
        record.fields.Collaborators.split(',').map(name => name.trim()) : [];
        const sessionDataString = record.fields['Items with Variations'];
        if (sessionDataString) {
            const savedState = JSON.parse(sessionDataString);
            if (savedState.favoritedItems) state.cart.items = new Map(Object.entries(savedState.favoritedItems));
            if (savedState.lockedInItems) state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems));
            if (savedState.itemReactions) state.session.reactions = new Map(Object.entries(savedState.itemReactions));
            if (savedState.favoritedDetails) state.eventDetails.combined = new Map(Object.entries(savedState.favoritedDetails));
            storeSession(sessionId, record.fields.Name);
        }
    } catch (error) {
        console.error("Failed to load session:", error);
        alert("Could not load the shared session.");
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}
export async function saveSessionToAirtable() {
    document.getElementById('save-status').textContent = 'Saving...';
    const sessionData = { favoritedItems: Object.fromEntries(state.cart.items), lockedInItems: Object.fromEntries(state.cart.lockedItems), itemReactions: Object.fromEntries(state.session.reactions), favoritedDetails: Object.fromEntries(state.eventDetails.combined) };
    const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) ||
    `Session from ${new Date().toLocaleString()}`;
    const payload = { fields: { "Name": sessionName, "Items with Variations": JSON.stringify(sessionData), "Collaborators": state.session.collaborators.join(', '), "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) ||
    null, "Location": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.LOCATION) || null, "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.SPECIAL_REQUESTS) || null, "Date": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE) || null } };
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
        }
        storeSession(state.session.id, sessionName);
        window.history.replaceState({}, document.title, `?session=${state.session.id}`);
        return true;
    } catch (error) {
        console.error("Failed to save session:", error);
        document.getElementById('save-status').textContent = 'Error saving.';
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

    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/default-event-image`;

    if (isGrouping) {
        const children = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0] === record.id);
        if (children.length > 0) {
            let childTags = children.slice(0, 4).map(child => {
                const tags = child.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];
                return (tags && tags.trim() !== '') ? tags.split(',')[0].trim() : 'default-event-image';
            });
            
            while (childTags.length < 4) {
                childTags.push('default-event-image');
            }

            const collageUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,w_600,h_520,g_auto/l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC9jX2ZpbGwsZ19hdXRvLGhfZ2V0L3dfZGVhL3RhZ19yZXNpemU6YXV0by92MV8xL3BsYW5uZXJzLyR7Y2hpbGRUYWdzWzBdfQ==/fl_layer_apply,g_north_west,w_0.5,h_0.5,c_fill/l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC9jX2ZpbGwsZ19hdXRvLGhfZ2V0L3dfZGVhL3RhZ19yZXNpemU6YXV0by92MV8xL3BsYW5uZXJzLyR7Y2hpbGRUYWdzWzFdfQ==/fl_layer_apply,g_north_east,w_0.5,h_0.5,c_fill/l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC9jX2ZpbGwsZ19hdXRvLGhfZ2V0L3dfZGVhL3RhZ19yZXNpemU6YXV0by92MV8xL3BsYW5uZXJzLyR7Y2hpbGRUYWdzWzJdfQ==/fl_layer_apply,g_south_west,w_0.5,h_0.5,c_fill/l_fetch:aHR0cHM6Ly9yZXMuY2xvdWRpbmFyeS5jb20vZGFlZHFpenJlL2ltYWdlL3VwbG9hZC9jX2ZpbGwsZ19hdXRvLGhfZ2V0L3dfZGVhL3RhZ19yZXNpemU6YXV0by92MV8xL3BsYW5uZXJzLyR7Y2hpbGRUYWdzWzNdfQ==/fl_layer_apply,g_south_east,w_0.5,h_0.5,c_fill/default-event-image.jpg`.replace(/\s/g, '');

            imageCache.set(cacheKey, [collageUrl]);
            return [collageUrl];
        }
    }

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
