// REPLACE THE ENTIRE CONTENTS OF: api.js

import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { parseOptions } from './utils.js';
import { log } from './utils/debug.js';
const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SESSIONS_TABLE_NAME = 'Sessions';
const STORES_TABLE_NAME = 'Stores';
const ITEM_MESSAGES_TABLE_NAME = 'ItemMessages'; // New table for item-specific chats

export async function fetchPlansForUser(userId) {
    if (!userId) {
        console.log('[DEBUG] fetchPlansForUser: Bailed because no userId was provided.');
        return [];
    }
    
    const collaboratorField = CONSTANTS.FIELD_NAMES.COLLABORATOR_IDS_FIELD;
    console.log(`[DEBUG] fetchPlansForUser: Fetching plans for userId '${userId}' using rollup field named '${collaboratorField}'`);
    
    const formula = `IF({${collaboratorField}}, FIND('${userId}', {${collaboratorField}}), 0)`;
    console.log(`[DEBUG] fetchPlansForUser: Sending Airtable formula: ${formula}`);

    const encodedFormula = encodeURIComponent(formula);
    // --- THIS IS THE CORRECTED LINE ---
    // The broken '&sort...' parameter has been completely removed.
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[DEBUG] fetchPlansForUser: Airtable API failed with status ${response.status}. Response:`, errorText);
            throw new Error('Failed to fetch user plans from Airtable.');
        }
        const data = await response.json();
        
        // --- NEW: Sort the results here on the client-side ---
        data.records.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));

        console.log(`[DEBUG] fetchPlansForUser: SUCCESS! Found and sorted ${data.records.length} plans for user.`);
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
        // First, get the existing collaborators to avoid overwriting them
        const getResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!getResponse.ok) throw new Error('Could not fetch existing session to update collaborators.');
        
        const existingRecord = await getResponse.json();
        const collaborators = new Set(existingRecord.fields.Collaborators || []);
        collaborators.add(userId); // Add the new user ID

        // Now, update the record with the new set of collaborators
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
     // --- NEW LOGIC START ---
        // If the session has a linked store, save its ID to the state
        if (record.fields.Store && record.fields.Store.length > 0) {
            state.session.storeId = record.fields.Store[0];
        }
        // --- NEW LOGIC END ---

        state.session.isOwned = false;
        // Load amount received data into state
        state.session.user.amountReceived = record.fields['Amount Received'] || 0;
        state.session.user.amountReceivedNote = record.fields['Amount Received Note'] || '';

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

export async function updateSessionAmountReceived(sessionId, amount, note) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    log('API', `Updating session ${sessionId} with amount ${amount}`);
    const payload = {
        fields: {
            'Amount Received': amount,
            'Amount Received Note': note,
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
        log('API', `Successfully updated session ${sessionId}`);
        return await response.json();
    } catch (error) {
        console.error("Failed to update session amount:", error);
        log('API', `Failed to update session amount: ${error.message}`);
        return null;
    }
}

export async function saveSessionToAirtable() {
    // --- DEBUG ---
    const sessionStatus = state.session.id ? `UPDATE (id: ${state.session.id})` : 'CREATE (new session)';
    console.log(`[DEBUG] saveSessionToAirtable: Triggered for ${sessionStatus}`);

    // ... (rest of the function is the same)
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
            // Notify the rest of the app that a real session ID is now available.
            document.dispatchEvent(new CustomEvent('sessionReady'));
            // --- NEW: Dispatch an event to notify the UI to refresh the plans list ---
            document.dispatchEvent(new CustomEvent('planCreated'));
        }
        // --- DEBUG ---
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

export async function fetchAllStores() {
    let records = [];
    let offset = null;
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE_NAME}?`;
    log('API', `Fetching stores from base URL: ${baseUrl}`);
    try {
        do {
            const url = offset ?
            `${baseUrl}&offset=${offset}` : baseUrl;
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
        log('API', `Failed to fetch stores: ${error.message}`);
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

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        log('API', `Returning cached images for record: ${record.id}`);
        return { imageUrls: imageCache.get(cacheKey) };
    }
    
    const defaultImagePublicID = 'ww71meppejsewxsxr4x7.jpg';
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/${defaultImagePublicID}`;
    
    let imageUrls = null;
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
    if (isGrouping) {
        log('API', `Record is a grouping item. Using a placeholder image to avoid multiple API calls.`);
        imageUrls = [ultimateFallbackUrl];
    } else {
        log('API', `Record is a bookable item. Attempting to fetch images by tags.`);
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

export async function fetchChatMessages(sessionId) {
    // --- THIS FORMULA IS NOW CORRECT & MORE RELIABLE ---
    // It directly queries the new Rollup field for an exact match.
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
        // The debug logs are no longer needed here, but you can keep them if you like
        return data.records;
    } catch (error) {
        console.error("Error fetching chat history:", error);
        return [];
    }
}

// REPLACE the postChatMessage function in: api.js

export async function postChatMessage(sessionId, senderId, senderName, content) {
    console.log(`[DEBUG] postChatMessage: Called for session ${sessionId}`);

    // --- FIX: Ensure sessionId is valid before proceeding ---
    if (!sessionId || !sessionId.startsWith('rec')) {
        console.error(`[DEBUG] postChatMessage: FAILED. Invalid sessionId provided: "${sessionId}". Cannot save message.`);
        return; // Stop execution if the session ID is invalid
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/Messages`;
    const payload = {
        records: [{
            fields: {
                // Airtable's Linked Record field MUST be an array of record IDs
                SessionID: [sessionId],
                SenderID: senderId,
                SenderName: senderName,
                Content: content,
            }
        }]
    };

    console.log('[DEBUG] postChatMessage: Sending payload to Airtable:', JSON.stringify(payload, null, 2));

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
            console.error('[DEBUG] postChatMessage: Airtable API Error Response:', errorData);
            // Also throw the error to make the failure more visible
            throw new Error(`Airtable API Error: ${errorData.error.message || 'Unknown error'}`);
        }

        const result = await response.json();
        console.log('[DEBUG] postChatMessage: SUCCESS! Airtable response:', result);

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
                })
            ]);
        }

    } catch (error) {
        // Make the error highly visible to the user
        console.error("CRITICAL: Failed to save chat message to database.", error);
        alert(`Could not save message: ${error.message}`);
    }
}
// --- New API functions for item-specific chat ---

export async function fetchItemChatMessages(itemId) {
    // --- THIS FORMULA IS NOW CORRECT ---
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
    // This would call a Netlify function to handle the ban logic securely
    // For now, we'll log and simulate the effect.
    log('API', `Simulating API call to ban user: ${userId}`);
    state.session.bannedUsers.add(userId);
    // In a real app, this would be a server-side call:
    // await fetch('/.netlify/functions/ban-user', { ... })
}

export async function updateUserFlagStatus(userId, isFlagged) {
    // This would call a Netlify function to handle the flag logic securely
    // For now, we'll log and simulate the effect.
    log('API', `Simulating API call to update flag for user: ${userId} to ${isFlagged}`);
    if (isFlagged) {
        state.session.flaggedUsers.add(userId);
    } else {
        state.session.flaggedUsers.delete(userId);
    }
    // In a real app, this would be a server-side call:
    // await fetch('/.netlify/functions/flag-user', { ... })
}

export async function addRsvpToEvent(eventId, userId) {
    log('API', `Adding RSVP for user ${userId} to event ${eventId}`);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${eventId}`;

    try {
        // 1. Get the current record to read existing RSVPs
        const getResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!getResponse.ok) throw new Error('Could not fetch the event to update RSVPs.');

        const existingRecord = await getResponse.json();
        const rsvps = new Set(existingRecord.fields.RSVPs || []);
        rsvps.add(userId);

        // 2. Construct the final payload
        const rsvpPayload = {
            fields: { 'RSVPs': Array.from(rsvps) }
        };

        // 3. Send the updated list back to Airtable as a JSON string
        const patchResponse = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(rsvpPayload) // This is the corrected line
        });

        if (!patchResponse.ok) {
            const errorData = await patchResponse.json();
            throw new Error(`Airtable API Error: ${errorData.error.message}`);
        }

        log('API', `Successfully added RSVP for user ${userId}`);
        return await patchResponse.json();
    } catch (error) {
        console.error("Failed to add RSVP:", error);
        log('API', `Failed to add RSVP: ${error.message}`);
        return null;
    }
}

// ADD THIS NEW FUNCTION to the end of: api.js

export async function updateUserName(userId, newName) {
    if (!userId || !newName) return;
    log('API', `Updating name for user ${userId} to "${newName}"`);

    const url = `https://api.airtable.com/v0/${BASE_ID}/Users/${userId}`;
    const payload = {
        fields: {
            'Name': newName
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
        log('API', 'Successfully updated user name.');
        return await response.json();
    } catch (error) {
        console.error("Failed to update user name:", error);
        log('API', `Failed to update name: ${error.message}`);
        return null;
    }
}
