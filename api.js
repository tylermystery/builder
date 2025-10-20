// REPLACE the entire contents of: api.js

import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { parseOptions } from './utils.js';
import { log } from './utils/debug.js';

const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SESSIONS_TABLE_NAME = 'Sessions';
const STORES_TABLE_NAME = 'Stores';
const ITEM_MESSAGES_TABLE_NAME = 'ItemMessages';

// --- NEW AI-RELATED CONSTANTS (Defined Once) ---
const IMAGE_GALLERY_TABLE_NAME = 'Image_Gallery'; 
const HISTORICAL_PRODUCTS_TABLE_NAME = 'Historical_Products';
// --------------------------------

export async function fetchPlansForUser(userId) {
    if (!userId) {
        return [];
    }
    const collaboratorField = CONSTANTS.FIELD_NAMES.COLLABORATOR_IDS_FIELD;
    const formula = `IF({${collaboratorField}}, FIND('${userId}', {${collaboratorField}}), 0)`;
    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error('Failed to fetch user plans from Airtable.');
        }
        const data = await response.json();
        data.records.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
        return data.records;
    } catch (error) {
        console.error("Error fetching user plans:", error);
        return [];
    }
}

export async function associateSessionWithUser(sessionId, userId) {
    if (!sessionId || !userId) return;
    log('API', `Associating session ${sessionId} with user ${userId}`);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    try {
        const getResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!getResponse.ok) throw new Error('Could not fetch existing session to update collaborators.');
        
        const existingRecord = await getResponse.json();
        const collaborators = new Set(existingRecord.fields.Collaborators || []);
        collaborators.add(userId);

        const payload = {
            fields: {
                'Collaborators': Array.from(collaborators)
            }
        };
        const patchResponse = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!patchResponse.ok) {
            const errorData = await patchResponse.json();
            throw new Error(`Airtable API Error: ${errorData.error.message}`);
        }
        log('API', `Successfully associated user ${userId} with session.`);
    } catch (error) {
        console.error("Failed to associate session with user:", error);
        log('API', `Failed to associate session: ${error.message}`);
    }
}

export async function loadSessionFromAirtable(sessionId) {
    state.session.id = sessionId;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    log('API', `Loading session from URL: ${url}`);
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error('Could not fetch session data.');
        }
        const record = await response.json();
        log('API', `Session loaded: ${record.fields.Name}`);
     
        if (record.fields.Store && record.fields.Store.length > 0) {
            state.session.storeId = record.fields.Store[0];
        }

        state.session.isOwned = false;
        
        // Load the total amount and the detailed payment history
        state.session.user.amountReceived = record.fields['Amount Received'] || 0;
        try {
            state.session.user.paymentHistory = JSON.parse(record.fields.PaymentHistory || '[]');
        } catch (e) {
            state.session.user.paymentHistory = [];
        }

        const sessionDataString = record.fields['Items with Variations'];
        if (sessionDataString && sessionDataString.trim() !== '') {
            try {
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
            } catch (jsonError) {
                log('API', `Failed to parse session JSON: ${jsonError.message}`);
            }
        }
        document.dispatchEvent(new CustomEvent('sessionReady'));
    } catch (error) {
        console.error("Failed to load session:", error);
        log('API', `Failed to load session: ${error.message}`);
        alert("Could not load the shared session.");
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}

export async function updatePaymentHistory(sessionId, paymentHistory) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    log('API', `Updating payment history for session ${sessionId}`);

    const newTotal = paymentHistory.reduce((sum, p) => sum + p.amount, 0);

    const payload = {
        fields: {
            'Amount Received': newTotal,
            'PaymentHistory': JSON.stringify(paymentHistory, null, 2)
        }
    };

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Airtable API Error: ${errorData.error.message}`);
        }
        log('API', `Successfully updated payment history for session ${sessionId}`);
        return await response.json();
    } catch (error) {
        console.error("Failed to update payment history:", error);
        log('API', `Failed to update payment history: ${error.message}`);
        return null;
    }
}

export async function saveSessionToAirtable() {
    const sessionStatus = state.session.id ? `UPDATE (id: ${state.session.id})` : 'CREATE (new session)';
    console.log(`[DEBUG] saveSessionToAirtable: Triggered for ${sessionStatus}`);
    
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
    const dateRange = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    let formattedDate = null;
    if (Array.isArray(dateRange) && dateRange.length > 0) {
        const startDate = new Date(dateRange[0]);
        if (!isNaN(startDate.getTime())) {
             formattedDate = startDate.toISOString();
        }
    }
    const allUserIds = Array.from(state.session.userProfiles.keys());
    const validCollaboratorIds = allUserIds.filter(id => id && id.startsWith('rec'));
    const fields = {
        "Name": sessionName,
        "Items with Variations": JSON.stringify(sessionData),
        "Collaborators": validCollaboratorIds,
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
            log('API', `New session created with ID: ${state.session.id}`);
            document.dispatchEvent(new CustomEvent('sessionReady'));
            document.dispatchEvent(new CustomEvent('planCreated'));
        }
        console.log(`[DEBUG] saveSessionToAirtable: SUCCESS for session ${state.session.id}`);
        return true;
    } catch (error) {
        console.error("Failed to save session:", error);
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
            const url = offset ? `${baseUrl}&offset=${offset}` : baseUrl;
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error('Failed to fetch data from Airtable.');
            }
            const data = await response.json();
            records = records.concat(data.records);
            offset = data.offset;
        } while (offset);
        log('API', `Total records fetched: ${records.length}`);
        return records.filter(record => record.fields);
    } catch (error) {
        console.error(error);
        throw error;
    }
}

export async function fetchAllStores() {
    let records = [];
    let offset = null;
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE_NAME}?`;
    log('API', `Fetching stores from base URL: ${baseUrl}`);
    try {
        do {
            const url = offset ? `${baseUrl}&offset=${offset}` : baseUrl;
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
            });
            if (!response.ok) {
                throw new Error('Failed to fetch stores from Airtable.');
            }
            const data = await response.json();
            records = records.concat(data.records);
            offset = data.offset;
        } while (offset);
        log('API', `Total stores fetched: ${records.length}`);
        return records.filter(record => record.fields.Name);
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

export async function fetchImagesByTags(tags, retries = 2) {
    if (!tags || tags.length === 0) {
        return null;
    }
    try {
        let payload;
        if (Array.isArray(tags)) {
            payload = { expression: tags.map(tag => `tags:\"${tag}\"`).join(' AND ') };
        } else {
            payload = { tag: tags };
        }
        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (response.status === 420 && retries > 0) {
            await new Promise(res => setTimeout(res, 500));
            return fetchImagesByTags(tags, retries - 1);
        }

        if (!response.ok) {
            console.warn(`Cloudinary function error: ${response.statusText}`);
            return null;
        }
        
        const data = await response.json();
        if (!data.resources || data.resources.length === 0) {
            return null;
        }
        
        const imageUrls = data.resources.map(image => {
            let transformations = 'c_fill,g_auto,w_600,h_520';
            if (image.format === 'gif') {
                transformations = 'c_fit,w_600,h_520';
            }
            const urlParts = image.secure_url.split('/upload/');
            return `${urlParts[0]}/upload/${transformations}/${urlParts[1]}`;
        });
        return imageUrls;
    } catch (error) {
        console.error('Failed to fetch from Cloudinary via proxy:', error);
        return null;
    }
}

// --- NEW FUNCTION TO FETCH CURATED IMAGES (WITH SAFETY) ---
export async function fetchCuratedImagesByRecord(record) {
    // 1. Check if the Item record has links in the new 'Curated Images' field.
    const curatedLinks = record.fields[CONSTANTS.FIELD_NAMES.CURATED_IMAGES_LINK];

    // CRITICAL SAFETY CHECK: If no links exist, return immediately without making the API call.
    // This protects against breaking the live site when the new Curated Images field is empty.
    if (!curatedLinks || !Array.isArray(curatedLinks) || curatedLinks.length === 0) {
        log('API', `Safety Exit: No curated links found for ${record.id}.`);
        return [];
    }

    // 2. Build a formula to find all linked records in Image_Gallery
    // Formula: OR(RECORD_ID()='recId1', RECORD_ID()='recId2', ...)
    const formula = `OR(${curatedLinks.map(id => `RECORD_ID()='${id}'`).join(',')})`;

    // 3. Prioritize images based on the 'isBestOf' flag (show the BestOf first)
    // NOTE: We assume 'isBestOf' is a checkbox/boolean field in Image_Gallery
    const sortParams = `&sort%5B0%5D%5Bfield%5D=isBestOf&sort%5B0%5D%5Bdirection%5D=desc`;

    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${IMAGE_GALLERY_TABLE_NAME}?filterByFormula=${encodedFormula}${sortParams}`;

    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        if (!response.ok) {
            const errorData = await response.json();
             // IMPORTANT: Throw a caught error instead of letting it propagate up silently
            throw new Error(`Airtable fetch error: ${errorData.error.message || 'Unknown Airtable Error'}`);
        }
        
        const data = await response.json();
        
        // Extract the ImageURL field from the curated records
        const imageUrls = data.records
            .map(r => r.fields.ImageURL)
            .filter(url => url);
            
        return imageUrls;
        
    } catch (error) {
        console.error("Error fetching curated images:", error.message);
        // Return an empty array on failure so the calling function can safely proceed
        return [];
    }
}
// ---------------------------------------------

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        return { imageUrls: imageCache.get(cacheKey) };
    }
    
    const defaultImagePublicID = 'ww71meppejsewxsxr4x7.jpg';
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/${defaultImagePublicID}`;
    
    let imageUrls = null;
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));

    if (isGrouping) {
        imageUrls = [ultimateFallbackUrl];
    } else {
        // 1. ATTEMPT NEW CURATED FETCH 
        // This is now safer due to the early exit check in fetchCuratedImagesByRecord
        imageUrls = await fetchCuratedImagesByRecord(record);

        // 2. FALLBACK TO OLD MEDIA TAGS IF NEW CURATED FIELD IS EMPTY 
        if (!imageUrls || imageUrls.length === 0) {
             log('API', `Fallback: No curated image found for ${record.id}, checking old Media Tags.`);
             imageUrls = await fetchImagesByTags(record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]);
        }
    }

    if (!imageUrls || imageUrls.length === 0) {
        imageUrls = [ultimateFallbackUrl];
    }

    imageCache.set(cacheKey, imageUrls);
    return { imageUrls };
}

export async function fetchChatMessages(sessionId) {
    const formula = `({SessionID_Rollup} = '${sessionId}')`;
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
    if (!sessionId || !sessionId.startsWith('rec')) {
        console.error(`[DEBUG] postChatMessage: FAILED. Invalid sessionId provided: \"${sessionId}\". Cannot save message.`);
        return;
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;
    const payload = {
        records: [{
            fields: {
                SessionID: [sessionId],
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
            const errorData = await response.json();
            throw new Error(`Airtable API Error: ${errorData.error.message || 'Unknown error'}`);
        }

        const result = await response.json();
        const newMessageRecordId = result.records[0].id;
        if (newMessageRecordId) {
            await Promise.all([
                fetch('/api/send-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ recordId: newMessageRecordId })
                }),
                fetch('/api/send-email-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ recordId: newMessageRecordId })
                }),
                fetch('/api/send-chat-to-admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ recordId: newMessageRecordId })
                })
            ]);
        }
    } catch (error) {
        console.error("CRITICAL: Failed to save chat message to database.", error);
        alert(`Could not save message: ${error.message}`);
    }
}

export async function fetchItemChatMessages(itemId) {
    const formula = `FIND('${itemId}', ARRAYJOIN({ItemID}))`;
    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
            throw new Error('Failed to fetch item chat messages from Airtable.');
        }
        const data = await response.json();
        return data.records;
    } catch (error) {
        console.error("Error fetching item chat history:", error);
        return [];
    }
}

export async function postItemChatMessage(itemId, senderId, senderName, content) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;
    const payload = {
        records: [{
            fields: {
                ItemID: itemId,
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
             throw new Error('Failed to post item chat message to Airtable.');
        }
    } catch (error) {
        console.error("Error posting item chat message:", error);
    }
}

export async function banUser(userId) {
    log('API', `Simulating API call to ban user: ${userId}`);
    state.session.bannedUsers.add(userId);
}

export async function updateUserFlagStatus(userId, isFlagged) {
    log('API', `Simulating API call to update flag for user: ${userId} to ${isFlagged}`);
    if (isFlagged) {
        state.session.flaggedUsers.add(userId);
    } else {
        state.session.flaggedUsers.delete(userId);
    }
}

export async function addRsvpToEvent(eventId, userId) {
    log('API', `Adding RSVP for user ${userId} to event ${eventId}`);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${eventId}`;

    try {
        const getResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!getResponse.ok) throw new Error('Could not fetch the event to update RSVPs.');

        const existingRecord = await getResponse.json();
        const rsvps = new Set(existingRecord.fields.RSVPs || []);
        rsvps.add(userId);

        const rsvpPayload = {
            fields: { 'RSVPs': Array.from(rsvps) }
        };
        const patchResponse = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(rsvpPayload)
        });
        if (!patchResponse.ok) {
            const errorData = await patchResponse.json();
            throw new Error(`Airtable API Error: ${errorData.error.message}`);
        }

        log('API', `Successfully added RSVP for user ${userId}`);
        return await patchResponse.json();
    } catch (error) {
        console.error("Failed to add RSVP:", error);
        return null;
    }
}
