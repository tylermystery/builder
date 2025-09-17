// PASTE THIS ENTIRE CODE INTO: api.js
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
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        if (!response.ok) { throw new Error('Could not fetch session data.');
        }
        const record = await response.json();
        state.session.isOwned = false;
        const sessionDataString = record.fields['Items with Variations'];
        if (sessionDataString && sessionDataString.trim() !== '') {
            const savedState = JSON.parse(sessionDataString);
            state.cart.items = new Map(Object.entries(savedState.favoritedItems || {}));
            state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems || {}));
            const reactionsObject = savedState.itemReactions || {};
            state.session.reactions = new Map();
            for (const recordId in reactionsObject) {
                state.session.reactions.set(recordId, new Map(Object.entries(reactionsObject[recordId])));
            }
            state.session.userProfiles = new Map(Object.entries(savedState.userProfiles || {}));
            state.eventDetails.combined = new Map(Object.entries(savedState.favoritedDetails || {}));
        }
    } catch (error) {
        console.error("Failed to load session:", error);
        alert("Could not load the shared session.");
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

export async function saveSessionToAirtable() {
    const reactionsForSaving = {};
    for (const [recordId, userReactionsMap] of state.session.reactions.entries()) {
        reactionsForSaving[recordId] = Object.fromEntries(userReactionsMap);
    }
    
    const sessionData = { 
        favoritedItems: Object.fromEntries(state.cart.items), 
        lockedInItems: Object.fromEntries(state.cart.lockedItems), 
        itemReactions: reactionsForSaving,
        userProfiles: Object.fromEntries(state.session.userProfiles),
        favoritedDetails: Object.fromEntries(state.eventDetails.combined) 
    };
    const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || `Session from ${new Date().toLocaleString()}`;
    
    // === START: MODIFIED DATE LOGIC ===
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    let formattedDate = null;
    if (dateValue) {
        const dateToFormat = Array.isArray(dateValue) ? dateValue[0] : dateValue;
        if (dateToFormat) { // Ensure the value isn't empty/undefined after array check
            const dateObj = new Date(dateToFormat);
            if (!isNaN(dateObj.getTime())) {
                formattedDate = dateObj.toISOString();
            }
        }
    }
    // === END: MODIFIED DATE LOGIC ===

    const fields = {
        "Name": sessionName,
        "Items with Variations": JSON.stringify(sessionData),
        "Collaborators": Array.from(state.session.userProfiles.values()).join(', '),
        "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) || null,
        "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || null,
    };

    if (formattedDate) {
        fields["Date"] = formattedDate;
    }

    const payload = { fields };
    const isUpdate = state.session.id !== null;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}` + (isUpdate ? `/${state.session.id}` : '');
    const method = isUpdate ? 'PATCH' : 'POST';
    try {
        const response = await fetch(url, {
            method,
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(isUpdate ? payload : { records: [payload] })
        });
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
    try {
        do {
            const url = offset ? `${baseUrl}&offset=${offset}` : baseUrl;
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch data from Airtable.');
            }
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

export async function fetchChatMessages(sessionId) {
    const formula = `({SessionID} = '${sessionId}')`;
    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/Messages?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch chat messages from Airtable.');
        }
        const data = await response.json();
        return data.records;
    } catch (error) {
        console.error("Error fetching chat history:", error);
        return [];
    }
}

export async function postChatMessage(sessionId, senderId, senderName, content) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/Messages`;
    const payload = {
        records: [{
            fields: {
                SessionID: sessionId,
                SenderID: senderId,
                SenderName: senderName,
                Content: content,
            }
        }]
    };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
             throw new Error('Failed to post chat message to Airtable.');
        }
    } catch (error) {
        console.error("Error posting chat message:", error);
    }
}

async function fetchImagesByTags(tags, retries = 2) {
    const tagArray = Array.isArray(tags) ? tags : (tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : []);
    if (tagArray.length === 0) {
        return [];
    }

    try {
        const payload = { expression: tagArray.map(tag => `tags:"${tag}"`).join(' AND ') };
        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (response.status === 420 && retries > 0) {
            await new Promise(res => setTimeout(res, 500));
            return fetchImagesByTags(tags, retries - 1);
        }
        if (!response.ok) {
            return [];
        }

        const data = await response.json();
        if (!data.resources) {
            return [];
        }
        
        return data.resources.map(image => {
            const transformations = image.format === 'gif' ? 'c_fit,w_600,h_520' : 'c_fill,g_auto,w_600,h_520';
            const urlParts = image.secure_url.split('/upload/');
            return `${urlParts[0]}/upload/${transformations}/${urlParts[1]}`;
        });
    } catch (error) {
        console.error('Failed to fetch from Cloudinary via proxy:', error);
        return [];
    }
}

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        return { imageUrls: imageCache.get(cacheKey) };
    }

    const defaultImagePublicID = 'ww71meppejsewxsxr4x7.jpg';
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/${defaultImagePublicID}`;
    
    let imageUrls;
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
    
    if (isGrouping) {
        imageUrls = [ultimateFallbackUrl];
    } else {
        const mediaTags = record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];
        imageUrls = await fetchImagesByTags(mediaTags);
    }

    if (!imageUrls || imageUrls.length === 0) {
        imageUrls = [ultimateFallbackUrl];
    }

    imageCache.set(cacheKey, imageUrls);
    return { imageUrls };
}
