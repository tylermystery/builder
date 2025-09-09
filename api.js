// FILE: api.js
import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { storeSession } from './session.js';
import { parseOptions } from './utils.js';
import { log } from './utils/debug.js';
const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SESSIONS_TABLE_NAME = 'Sessions';
export async function loadSessionFromAirtable(sessionId) {
    state.session.id = sessionId;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    log('API', `Loading session from URL: ${url}`);
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        log('API', `Session load response: status ${response.status}`);
        if (!response.ok) {
            const errorData = await response.json();
            log('API', `Session load error: ${JSON.stringify(errorData)}`);
            throw new Error('Could not fetch session data.');
        }
        const record = await response.json();
        log('API', `Session loaded: ${record.fields.Name}`);
        
        state.session.isOwned = false;
        state.session.collaborators = record.fields.Collaborators ? record.fields.Collaborators.split(',').map(name => name.trim()) : [];
        const sessionDataString = record.fields['Items with Variations'];
        // --- FIX: Safely parse session data only if it exists
        if (sessionDataString && sessionDataString.trim() !== '') {
            try {
                const savedState = JSON.parse(sessionDataString);
                state.cart.items = new Map(Object.entries(savedState.favoritedItems || {}));
                state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems || {}));
                state.session.reactions = new Map(Object.entries(savedState.itemReactions || {}));
                state.eventDetails.combined = new Map(Object.entries(savedState.favoritedDetails || {}));
            } catch (jsonError) {
                log('API', `Failed to parse session JSON: ${jsonError.message}`);
            }
        }
    } catch (error) {
        console.error("Failed to load session:", error);
        log('API', `Failed to load session: ${error.message}`);
        alert("Could not load the shared session.");
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

export async function saveSessionToAirtable() {
    if (state.session.id && !state.session.isOwned) {
        state.session.id = null;
    }

    const sessionData = { 
        favoritedItems: Object.fromEntries(state.cart.items), 
        lockedInItems: Object.fromEntries(state.cart.lockedItems), 
        itemReactions: Object.fromEntries(state.session.reactions), 
        favoritedDetails: Object.fromEntries(state.eventDetails.combined) 
    };
    const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || `Session from ${new Date().toLocaleString()}`;
    log('API', `Saving session: ${sessionName}`);

    const dateRange = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    let formattedDate = null;
    if (Array.isArray(dateRange) && dateRange.length > 0) {
        const startDate = new Date(dateRange[0]);
        // NEW: Check if the date is valid before formatting and sending
        if (!isNaN(startDate.getTime())) {
             formattedDate = startDate.toISOString();
        }
    }

    const fields = {
        "Name": sessionName,
        "Items with Variations": JSON.stringify(sessionData),
        "Collaborators": state.session.collaborators.join(', '),
        "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) ||
null,
        "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || null,
    };
    if (formattedDate) {
        fields["Date"] = formattedDate;
    }

    const payload = { fields };
    const isUpdate = state.session.id !== null;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}` + (isUpdate ? `/${state.session.id}` : '');
    const method = isUpdate ? 'PATCH' : 'POST';
    log('API', `Saving session to URL: ${url}, Method: ${method}`);

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json' 
            },
   

            body: JSON.stringify(isUpdate ? payload : { records: [payload] })
        });
        log('API', `Session save response: status ${response.status}`);
        if (!response.ok) {
            const errorData = await response.json();
            log('API', `Session save error: ${JSON.stringify(errorData)}`);
            throw new Error(`Airtable API Error: ${errorData.error.message}`);
        }
        const result = await response.json();
        if (!isUpdate) {
            state.session.id = result.records[0].id;
            state.session.isOwned = true;
            window.history.replaceState({}, document.title, `?session=${state.session.id}`);
log('API', `New session created with ID: ${state.session.id}`);
        }
        
        storeSession(state.session.id, sessionName);
        return true;
    } catch (error) {
        console.error("Failed to save session:", error);
        log('API', `Failed to save session: ${error.message}`);
        return false;
    }
}

export async function fetchAllRecords() {
    let records = [];
    let offset = null;
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?`;
    log('API', `Fetching records from base URL: ${baseUrl}`);
    try {
        do {
            const url = offset ?
`${baseUrl}&offset=${offset}` : baseUrl;
            log('API', `Fetching records from: ${url}`);
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
            });
            log('API', `Records fetch response: status ${response.status}`);
            if (!response.ok) {
                const errorData = await response.json();
                log('API', `Records fetch error: ${JSON.stringify(errorData)}`);
                throw new Error('Failed to fetch data from Airtable.');
            }
            const data = await response.json();
            records = records.concat(data.records);
            offset = data.offset;
            log('API', `Fetched ${data.records.length} records, offset: ${offset}`);
        } while (offset);
        log('API', `Total records fetched: ${records.length}`);
        return records.filter(record => record.fields);
    } catch (error) {
        console.error(error);
        log('API', `Failed to fetch records: ${error.message}`);
        throw error;
    }
}

export async function fetchCalendarForRecord(record) {
    const icalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];
    if (!icalUrl) {
        log('API', `No iCal URL for record: ${record.fields.Name}`);
        return [];
    }
    if (state.calendar.busyTimes.has(icalUrl)) {
        log('API', `Returning cached busy times for: ${icalUrl}`);
        return state.calendar.busyTimes.get(icalUrl);
    }
    try {
        const proxyUrl = `/api/calendar?url=${encodeURIComponent(icalUrl)}`;
        log('API', `Fetching calendar from: ${proxyUrl}`);
        const response = await fetch(proxyUrl);
log('API', `Calendar fetch response: status ${response.status}`);
        if (!response.ok) {
            const errorData = await response.json();
            log('API', `Calendar fetch error: ${JSON.stringify(errorData)}`);
            throw new Error(`Calendar API Error: ${response.statusText}`);
        }
        const busyTimes = await response.json();
        state.calendar.busyTimes.set(icalUrl, busyTimes);
        log('API', `Cached busy times for: ${icalUrl}`);
        return busyTimes;
    } catch (error) {
        console.error(`Failed to fetch calendar for ${record.fields.Name}:`, error);
        log('API', `Failed to fetch calendar: ${error.message}`);
        state.calendar.busyTimes.set(icalUrl, []);
        return [];
    }
}

export async function fetchImagesByTags(tags, retries = 2) {
    if (!tags || tags.length === 0) {
        log('API', 'No tags provided for image fetch');
        return null;
    }
    try {
        let payload;
        if (Array.isArray(tags)) {
            payload = { expression: tags.map(tag => `tags:"${tag}"`).join(' AND ') };
        } else {
            payload = { tag: tags };
        }
log('API', `Fetching images with payload: ${JSON.stringify(payload)}`);
        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
log('API', `Image fetch response: status ${response.status}`);
        if (response.status === 420 && retries > 0) {
            console.warn(`Cloudinary rate limit hit. Retrying in 500ms... (${retries} retries left)`);
log('API', `Cloudinary rate limit hit, retrying (${retries} left)`);
            await new Promise(res => setTimeout(res, 500));
            return fetchImagesByTags(tags, retries - 1);
        }

        if (!response.ok) {
            const errorData = await response.json();
            log('API', `Image fetch error: ${JSON.stringify(errorData)}`);
            console.warn(`Cloudinary function error: ${response.statusText}`);
            return null;
        }
        
        const data = await response.json();
        if (!data.resources || data.resources.length === 0) {
            log('API', 'No image resources found');
            return null;
        }
        
        const imageUrls = data.resources.map(image => {
            let transformations;
            if (image.format === 'gif') {
                transformations = 'c_fit,w_600,h_520';
            } else {
                
transformations = 'c_fill,g_auto,w_600,h_520';
            }
            const urlParts = image.secure_url.split('/upload/');
            return `${urlParts[0]}/upload/${transformations}/${urlParts[1]}`;
        });
log('API', `Fetched ${imageUrls.length} images`);
        return imageUrls;
    } catch (error) {
        console.error('Failed to fetch from Cloudinary via proxy:', error);
log('API', `Failed to fetch images: ${error.message}`);
        return null;
    }
}

// FIX: This function is now async so we can perform the bulk fetch before rendering
export async function fetchImagesForRecord(record, allRecords, imageCache) {
    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        log('API', `Returning cached images for record: ${record.id}`);
        return imageCache.get(cacheKey);
    }

    const defaultImagePublicID = 'ww71meppejsewxsxr4x7.jpg';
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/${defaultImagePublicID}`;
    
    let imageUrls = null;
    
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
    if (isGrouping) {
        const bookableItems = allRecords.filter(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] === record.fields.Name);
        log('API', `Fetching images for ${bookableItems.length} child records of ${record.fields.Name}`);
        // FIX: Bulk fetch images for all child records at once
        const allChildTags = new Set();
        bookableItems.forEach(child => {
            if (child.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]) {
                child.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS].split(',').forEach(tag => allChildTags.add(tag.trim()));
            }
        });
        imageUrls = await fetchImagesByTags(Array.from(allChildTags));
    }
    
    if (!imageUrls) {
        imageUrls = await fetchImagesByTags(record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]);
    }
    
    if (!imageUrls || imageUrls.length === 0) {
        log('API', `Using fallback image for record: ${record.id}`);
        imageUrls = [ultimateFallbackUrl];
    }
    
    imageCache.set(cacheKey, imageUrls);
log('API', `Cached ${imageUrls.length} images for record: ${record.id}`);
    return { imageUrls };
}
