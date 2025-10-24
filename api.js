// FILE: api.js (REPLACE ENTIRE FILE)

import { state } from './state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from './config.js';
import { parseOptions } from './utils.js';
import { log } from './utils/debug.js';

const PERSONAL_ACCESS_TOKEN = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const TABLE_ID = 'tblUA4uuS8IYlhKpD'; // Items Table
const SESSIONS_TABLE_NAME = 'Sessions';
const STORES_TABLE_NAME = 'Stores';
const ITEM_MESSAGES_TABLE_NAME = 'Messages'; // Renamed from ItemMessages for clarity with CRM

// --- NEW AI-RELATED CONSTANTS (Defined Once) ---
const IMAGE_GALLERY_TABLE_NAME = 'Image_Gallery';
const HISTORICAL_PRODUCTS_TABLE_NAME = 'Historical_Products';
// --------------------------------

export async function fetchPlansForUser(userId) {
    if (!userId) {
        return [];
    }
    // Assuming 'Collaborators' field directly links to Users table
    const formula = `FIND('${userId}', ARRAYJOIN(Collaborators))`;
    const encodedFormula = encodeURIComponent(formula);
    // Fetch sessions where the user is a collaborator
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}&fields%5B%5D=Name`; // Only fetch Name for dropdown

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error fetching plans:', errorText);
            throw new Error('Failed to fetch user plans from Airtable.');
        }
        const data = await response.json();
        // Sort by creation time, newest first
        data.records.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));
        log('API', `Fetched ${data.records.length} plans for user ${userId}`);
        return data.records;
    } catch (error) {
        console.error("Error fetching user plans:", error);
        return [];
    }
}


export async function associateSessionWithUser(sessionId, userId) {
    if (!sessionId || !userId) return;
    log('API', `Associating session ${sessionId} with user ${userId}`);

    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    const userUrl = `https://api.airtable.com/v0/${BASE_ID}/Users/${userId}`; // Assuming Users table name

    try {
        // Fetch existing records to get current links
        const [sessionRes, userRes] = await Promise.all([
            fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } }),
            fetch(userUrl, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } })
        ]);

        if (!sessionRes.ok) throw new Error(`Could not fetch session ${sessionId}. Status: ${sessionRes.status}`);
        if (!userRes.ok) throw new Error(`Could not fetch user ${userId}. Status: ${userRes.status}`);

        const sessionRecord = await sessionRes.json();
        const userRecord = await userRes.json();

        // Update Session with User collaborator
        const currentCollaborators = sessionRecord.fields.Collaborators || [];
        if (!currentCollaborators.includes(userId)) {
            const updatedCollaborators = [...currentCollaborators, userId];
            const sessionPayload = { fields: { 'Collaborators': updatedCollaborators } };
            const patchSessionRes = await fetch(sessionUrl, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(sessionPayload)
            });
            if (!patchSessionRes.ok) throw new Error(`Airtable API Error updating session collaborators: ${await patchSessionRes.text()}`);
            log('API', `Successfully added user ${userId} to session ${sessionId} collaborators.`);
        } else {
             log('API', `User ${userId} already a collaborator on session ${sessionId}.`);
        }

        // Update User with Associated Session
        const currentSessions = userRecord.fields['Sessions 2'] || []; // Corrected field name 'Sessions 2'
         if (!currentSessions.includes(sessionId)) {
            const updatedSessions = [...currentSessions, sessionId];
            const userPayload = { fields: { 'Sessions 2': updatedSessions } }; // Corrected field name 'Sessions 2'
             const patchUserRes = await fetch(userUrl, {
                 method: 'PATCH',
                 headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
                 body: JSON.stringify(userPayload)
             });
             if (!patchUserRes.ok) throw new Error(`Airtable API Error updating user associated sessions: ${await patchUserRes.text()}`);
             log('API', `Successfully added session ${sessionId} to user ${userId}'s associated sessions.`);
         } else {
              log('API', `Session ${sessionId} already associated with user ${userId}.`);
         }

    } catch (error) {
        console.error("Failed to associate session with user:", error);
        log('API', `Failed to associate session: ${error.message}`);
    }
}


export async function loadSessionFromAirtable(sessionId) {
    if (!sessionId) {
         log('API', 'loadSessionFromAirtable called with no sessionId.');
         return;
    }
    // Avoid reloading if already loaded
    if (state.session.id === sessionId) {
        log('API', `Session ${sessionId} is already loaded.`);
        // Ensure sessionReady is fired if initialization depends on it even for reloads
        // Check if cart/details exist before assuming ready
        if (state.cart.lockedItems.size > 0 || state.eventDetails.combined.size > 0) {
             document.dispatchEvent(new CustomEvent('sessionReady'));
        }
        return;
    }

    state.session.id = sessionId;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    log('API', `Loading session from URL: ${url}`);
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        if (!response.ok) {
            const errorData = await response.json();
             console.error(`Airtable error fetching session ${sessionId}:`, errorData);
            throw new Error(`Could not fetch session data. Status: ${response.status}`);
        }
        const record = await response.json();
        log('API', `Session loaded: ${record.fields.Name || 'Unnamed Session'} (ID: ${sessionId})`);

        // Reset parts of state before loading new session data
        state.cart.items = new Map();
        state.cart.lockedItems = new Map();
        state.session.reactions = new Map();
        state.session.userProfiles = new Map();
        state.eventDetails.combined = new Map();
        state.session.storeId = null;
        state.session.user.amountReceived = 0;
        state.session.user.paymentHistory = [];


        if (record.fields['Shop Link'] && record.fields['Shop Link'].length > 0) { // Corrected field name 'Shop Link'
            state.session.storeId = record.fields['Shop Link'][0]; // Corrected field name 'Shop Link'
            log('API', `Session belongs to Store ID: ${state.session.storeId}`);
        } else {
             log('API', 'Session not linked to a specific store.');
        }

        // Determine ownership (simple check: is the current user among collaborators?)
        state.session.isOwned = (record.fields.Collaborators || []).includes(state.session.user.id);
        log('API', `Session ownership for current user (${state.session.user.id}): ${state.session.isOwned}`);

        // Load payment info
        state.session.user.amountReceived = record.fields['Amount Received'] || 0;
        try {
            state.session.user.paymentHistory = JSON.parse(record.fields.PaymentHistory || '[]');
        } catch (e) {
            state.session.user.paymentHistory = [];
             console.warn(`Could not parse PaymentHistory for session ${sessionId}:`, record.fields.PaymentHistory);
        }
        log('API', `Loaded Amount Received: ${state.session.user.amountReceived}`);

        // Load core session data: items, reactions, details
        const sessionDataString = record.fields['Items with Variations'];
        if (sessionDataString && sessionDataString.trim() !== '') {
            try {
                const savedState = JSON.parse(sessionDataString);
                state.cart.items = new Map(Object.entries(savedState.ideasItems || savedState.favoritedItems || {})); // Handle potential old name
                state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems || {}));

                const reactionsObject = savedState.itemReactions || {};
                state.session.reactions = new Map();
                for (const recordId in reactionsObject) {
                    state.session.reactions.set(recordId, new Map(Object.entries(reactionsObject[recordId])));
                }

                state.session.userProfiles = new Map(Object.entries(savedState.userProfiles || {}));
                state.eventDetails.combined = new Map(Object.entries(savedState.eventDetails || savedState.favoritedDetails || {})); // Handle potential old name
                log('API', `Parsed session data: ${state.cart.items.size} ideas, ${state.cart.lockedItems.size} locked items, ${state.eventDetails.combined.size} details.`);

            } catch (jsonError) {
                log('API', `Failed to parse session JSON for ${sessionId}: ${jsonError.message}`);
                console.error("Session Data String:", sessionDataString); // Log the problematic string
                 // Fallback to empty state to prevent app crash
                 state.cart.items = new Map();
                 state.cart.lockedItems = new Map();
                 state.session.reactions = new Map();
                 state.session.userProfiles = new Map();
                 state.eventDetails.combined = new Map();
            }
        } else {
             log('API', `Session ${sessionId} has no 'Items with Variations' data.`);
        }

        // Ensure current user profile is added if not present
        if (state.session.user.isAuthenticated && state.session.user.id && !state.session.userProfiles.has(state.session.user.id)) {
             state.session.userProfiles.set(state.session.user.id, state.session.user.name || 'User');
             log('API', 'Added current authenticated user to session profiles.');
             // Optionally trigger a save here if this modification should persist immediately
             // triggerSave();
        }

        document.dispatchEvent(new CustomEvent('sessionReady'));
        log('API', `Finished loading session ${sessionId}. Fired sessionReady event.`);

    } catch (error) {
        console.error(`Failed to load session ${sessionId}:`, error);
        log('API', `Failed to load session: ${error.message}`);
        // Reset session ID if loading fails
        state.session.id = null;
        alert("Could not load the shared session. It might have been deleted or there was a network issue.");
        // Clear session param from URL to avoid reload loop
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search.replace(/&?session=[^&]+/, ''));
        // Optionally redirect to a default state or show an error message permanently
        // window.location.href = '/'; // Example redirect
    }
}


export async function updatePaymentHistory(sessionId, paymentHistory) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    log('API', `Updating payment history for session ${sessionId}`);

    // Ensure paymentHistory is an array
    const historyArray = Array.isArray(paymentHistory) ? paymentHistory : [];
    const newTotal = historyArray.reduce((sum, p) => sum + (p.amount || 0), 0);

    const payload = {
        fields: {
            'Amount Received': newTotal,
            // Store as a formatted JSON string in Airtable long text field
            'PaymentHistory': JSON.stringify(historyArray, null, 2)
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
            throw new Error(`Airtable API Error updating payment history: ${errorData?.error?.message || response.statusText}`);
        }
        log('API', `Successfully updated payment history for session ${sessionId}. New total: ${newTotal}`);
        return await response.json(); // Return the updated record
    } catch (error) {
        console.error("Failed to update payment history:", error);
        log('API', `Failed to update payment history: ${error.message}`);
        return null;
    }
}


export async function saveSessionToAirtable() {
    // Only save if there's actual data or if it's a new session needing an ID
    const hasPlanData = state.cart.items.size > 0 || state.cart.lockedItems.size > 0;
    const hasDetails = state.eventDetails.combined.size > 0;
    const hasReactions = state.session.reactions.size > 0;
    const needsInitialSave = !state.session.id;

    if (!hasPlanData && !hasDetails && !hasReactions && !needsInitialSave) {
        log('API', 'saveSessionToAirtable: No changes or data to save, skipping.');
        state.ui.saveState = 'SAVED'; // Ensure state is marked as saved
        ui.updateSaveShareButton(); // Update button if needed - ensure accessible
        return false; // Indicate no save occurred
    }

    const sessionStatus = state.session.id ? `UPDATE (id: ${state.session.id})` : 'CREATE (new session)';
    log('API', `saveSessionToAirtable: Triggered for ${sessionStatus}`);
    state.ui.saveState = 'SAVING'; // ui.updateSaveShareButton() should be called by caller or here
    if (typeof ui !== 'undefined' && ui.updateSaveShareButton) ui.updateSaveShareButton();


    // Prepare reactions data for JSON storage
    const reactionsForSaving = {};
    for (const [recordId, userReactionsMap] of state.session.reactions.entries()) {
        reactionsForSaving[recordId] = Object.fromEntries(userReactionsMap);
    }

    // Consolidate data into the structure expected by Airtable
    const sessionData = {
        ideasItems: Object.fromEntries(state.cart.items), // Use new name "ideasItems"
        lockedInItems: Object.fromEntries(state.cart.lockedItems),
        itemReactions: reactionsForSaving,
        userProfiles: Object.fromEntries(state.session.userProfiles),
        eventDetails: Object.fromEntries(state.eventDetails.combined) // Use new name "eventDetails"
    };

    const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || `New Plan - ${new Date().toLocaleDateString()}`;
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    let formattedDate = null;
    // Handle both single date string (from date picker) and potential array (from older range picker)
    if (dateValue) {
        const dateToFormat = Array.isArray(dateValue) ? dateValue[0] : dateValue;
        const dateObj = new Date(dateToFormat);
        if (!isNaN(dateObj.getTime())) {
             // Store date only for Airtable Date field (no time component needed for simple date)
             formattedDate = dateObj.toISOString().split('T')[0];
        }
    }


    // Get collaborator IDs (only valid Airtable record IDs)
    const allUserIds = Array.from(state.session.userProfiles.keys());
    const validCollaboratorIds = allUserIds.filter(id => id && typeof id === 'string' && id.startsWith('rec'));
     // Ensure the current authenticated user is included if not already in profiles
     if (state.session.user.isAuthenticated && state.session.user.id && !validCollaboratorIds.includes(state.session.user.id)) {
          validCollaboratorIds.push(state.session.user.id);
     }

    const fields = {
        "Name": sessionName,
        // Store the consolidated data in one field
        "Items with Variations": JSON.stringify(sessionData, null, 2), // Pretty print for readability
        "Collaborators": validCollaboratorIds,
        "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) || null,
        "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || null,
        // Link to the current store
        "Shop Link": state.ui.activeShopId ? [state.ui.activeShopId] : null // Corrected field name 'Shop Link'
    };
    if (formattedDate) {
        fields["Date"] = formattedDate; // Ensure field name matches Airtable
    }

    const payload = { fields };
    const isUpdate = state.session.id !== null;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}` + (isUpdate ? `/${state.session.id}` : '');
    const method = isUpdate ? 'PATCH' : 'POST';

    try {
        const response = await fetch(url, {
            method: method,
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
            // Airtable API expects slightly different structures for create vs update
            body: JSON.stringify(isUpdate ? payload : { records: [payload] })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Airtable API Error saving session: ${errorData?.error?.message || response.statusText}`);
        }

        const result = await response.json();

        if (!isUpdate && result.records && result.records.length > 0) {
            // --- New Session Created ---
            const newSessionId = result.records[0].id;
            state.session.id = newSessionId;
            state.session.isOwned = true; // User who creates it owns it
            // Update URL bar without reloading
            window.history.replaceState({}, document.title, `?session=${newSessionId}${window.location.search.includes('shopId') ? `&shopId=${state.ui.activeShopId}` : ''}`);
            log('API', `New session created with ID: ${newSessionId}`);
            // Ensure user is associated if logged in
            if(state.session.user.isAuthenticated && state.session.user.id) {
                 await associateSessionWithUser(newSessionId, state.session.user.id);
            }
            document.dispatchEvent(new CustomEvent('sessionReady')); // Notify components session ID is available
            document.dispatchEvent(new CustomEvent('planCreated')); // Notify header to refresh plans list
        } else if (isUpdate) {
             log('API', `Successfully updated session ${state.session.id}`);
        }

        state.ui.saveState = 'SAVED';
        if (typeof ui !== 'undefined' && ui.updateSaveShareButton) ui.updateSaveShareButton(); // Update button state
        return true; // Indicate success

    } catch (error) {
        console.error("Failed to save session:", error);
        log('API', `Failed to save session: ${error.message}`);
        state.ui.saveState = 'SAVED'; // Reset state even on failure
        if (typeof ui !== 'undefined' && ui.updateSaveShareButton) ui.updateSaveShareButton(); // Update button state
         alert(`Error saving your plan: ${error.message}. Please try again.`); // Inform user
        return false; // Indicate failure
    }
}


export async function fetchAllRecords() {
    let allRecords = [];
    let offset = null;
    // Use TABLE_ID which refers to the Items table
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;
    log('API', `Fetching items from base URL: ${baseUrl}`);
    try {
        do {
            let url = baseUrl;
            // Add view parameter if you have a specific view for published items
            // url += '?view=PublishedItemsView'; // Example view name
            if (offset) {
                // Check if URL already has query params
                url += (url.includes('?') ? '&' : '?') + `offset=${offset}`;
            }

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
            });
            if (!response.ok) {
                const errorData = await response.json();
                console.error('Airtable Error fetching items:', errorData);
                throw new Error(`Failed to fetch items from Airtable. Status: ${response.status}`);
            }
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        log('API', `Total item records fetched: ${allRecords.length}`);
        // Filter out records without essential fields like 'Name' AFTER fetching all pages
        return allRecords.filter(record => record.fields && record.fields.Name);
    } catch (error) {
        console.error("Error fetching all item records:", error);
        throw error; // Re-throw to be caught by initializer
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
                const errorData = await response.json();
                 console.error('Airtable Error fetching stores:', errorData);
                throw new Error(`Failed to fetch stores from Airtable. Status: ${response.status}`);
            }
            const data = await response.json();
            records = records.concat(data.records);
            offset = data.offset;
        } while (offset);
        log('API', `Total stores fetched: ${records.length}`);
        // Ensure stores have a Name before returning
        return records.filter(record => record.fields && record.fields.Name);
    } catch (error) {
        console.error("Error fetching all stores:", error);
        throw error; // Re-throw
    }
}


export async function fetchCalendarForRecord(record) {
    if (!record || !record.fields) return []; // Safety check
    const icalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];
    if (!icalUrl) {
         log('API', `No iCal URL for record ${record.id}`);
        return []; // No calendar to fetch
    }

    // Check cache first
    if (state.calendar.busyTimes.has(icalUrl)) {
        log('API', `Cache hit for iCal URL: ${icalUrl}`);
        return state.calendar.busyTimes.get(icalUrl);
    }
     log('API', `Fetching calendar for ${record.fields.Name} from URL: ${icalUrl}`);

    try {
        // Use the Netlify function proxy
        const proxyUrl = `/api/calendar?url=${encodeURIComponent(icalUrl)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            throw new Error(`Calendar proxy function error: ${response.status} ${response.statusText}`);
        }
        const busyTimes = await response.json();
        // Store in cache
        state.calendar.busyTimes.set(icalUrl, busyTimes);
         log('API', `Successfully fetched and cached ${busyTimes.length} busy times for ${icalUrl}`);
        return busyTimes;
    } catch (error) {
        console.error(`Failed to fetch/parse calendar for ${record.fields.Name} (${icalUrl}):`, error);
        // Cache failure as empty array to avoid retrying constantly
        state.calendar.busyTimes.set(icalUrl, []);
        return []; // Return empty on error
    }
}


export async function fetchImagesByTags(tags, retries = 2) {
    if (!tags || (Array.isArray(tags) && tags.length === 0) || (typeof tags === 'string' && !tags.trim())) {
        log('API', 'fetchImagesByTags: No valid tags provided.');
        return []; // Return empty array for consistency
    }

    try {
        let payload;
        if (Array.isArray(tags)) {
            // Filter out empty strings and create expression for multiple tags
            const validTags = tags.map(t => String(t).trim()).filter(Boolean);
            if (validTags.length === 0) return [];
            payload = { expression: validTags.map(tag => `tags:\"${tag}\"`).join(' AND ') };
            log('API', `Fetching images by expression: ${payload.expression}`);
        } else {
            // Single tag
            const tagName = String(tags).trim();
            if (!tagName) return [];
            payload = { tag: tagName };
            log('API', `Fetching images by single tag: ${tagName}`);
        }

        // Use the Netlify function proxy for Cloudinary
        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // Handle rate limiting (429 Too Many Requests) with retry logic
        if (response.status === 429 && retries > 0) {
            log('API', `Cloudinary rate limit hit, retrying in 500ms... (${retries} retries left)`);
            await new Promise(res => setTimeout(res, 500)); // Wait 500ms
            return fetchImagesByTags(tags, retries - 1); // Recurse with decremented retries
        }

        if (!response.ok) {
            console.warn(`Cloudinary proxy function error: ${response.status} ${response.statusText}`);
            // Log response body for more details if possible
            try { console.warn('Cloudinary error body:', await response.text()); } catch (e) {}
            return []; // Return empty array on error
        }

        const data = await response.json();
        if (!data.resources || data.resources.length === 0) {
             log('API', 'No Cloudinary resources found for the given tags/expression.');
            return [];
        }

        const imageUrls = data.resources.map(image => {
             // Define standard transformations, adjust for GIFs
             let transformations = 'c_fill,g_auto,w_600,h_520,f_auto'; // Added f_auto
             if (image.format === 'gif') {
                 transformations = 'c_fit,w_600,h_520'; // Keep original GIF format, just fit dimensions
             }
             // Construct the transformed URL
             const urlParts = image.secure_url.split('/upload/');
             if (urlParts.length === 2) {
                return `${urlParts[0]}/upload/${transformations}/${urlParts[1]}`;
             }
             return image.secure_url; // Fallback to original URL if split fails
        });

         log('API', `Found ${imageUrls.length} images from Cloudinary.`);
        return imageUrls;

    } catch (error) {
        console.error('Failed to fetch from Cloudinary via proxy:', error);
        return []; // Return empty array on unexpected errors
    }
}


export async function fetchCuratedImagesByRecord(record) {
    // 1. Check for linked records in the 'Curated Images' field
    const curatedLinks = record.fields[CONSTANTS.FIELD_NAMES.CURATED_IMAGES_LINK];

    // Safety Check: If no links, exit early
    if (!curatedLinks || !Array.isArray(curatedLinks) || curatedLinks.length === 0) {
        log('API', `Safety Exit: No curated image links found for item ${record.id}.`);
        return [];
    }
    log('API', `Fetching ${curatedLinks.length} curated images for item ${record.id}`);

    // 2. Build Airtable formula to fetch linked Image_Gallery records
    const formula = `OR(${curatedLinks.map(id => `RECORD_ID()='${id}'`).join(',')})`;

    // 3. Define sorting parameters (prioritize 'isBestOf')
    const sortParams = `&sort%5B0%5D%5Bfield%5D=isBestOf&sort%5B0%5D%5Bdirection%5D=desc`;

    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${IMAGE_GALLERY_TABLE_NAME}?filterByFormula=${encodedFormula}${sortParams}&fields[]=ImageURL`; // Only fetch the ImageURL field

    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Airtable fetch error for curated images: ${errorData?.error?.message || response.statusText}`);
        }

        const data = await response.json();
        if (!data.records || data.records.length === 0) {
             log('API', 'No matching records found in Image_Gallery for curated links.');
             return [];
        }

        // 4. Extract and transform ImageURLs
        const imageUrls = data.records
            .map(r => r.fields.ImageURL) // Get the URL field
            .filter(Boolean) // Filter out any potentially empty URLs
            .map(url => {
                // Apply f_auto transformation if it's a Cloudinary URL
                if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
                    const parts = url.split('/upload/');
                    if (parts.length === 2 && !parts[1].startsWith('f_auto/')) { // Avoid double adding
                         // Add standard transformations including f_auto
                         const transformations = 'c_fill,g_auto,w_600,h_520,f_auto';
                         // Reconstruct URL carefully, handling existing transformations if necessary
                         // Basic approach: Assume no complex existing transforms, just add ours before the public ID part
                         return `${parts[0]}/upload/${transformations}/${parts[1]}`;
                     }
                }
                return url; // Return original URL otherwise
            });

         log('API', `Successfully fetched and processed ${imageUrls.length} curated image URLs.`);
        return imageUrls;

    } catch (error) {
        console.error(`Error fetching curated images for item ${record.id}:`, error.message);
        return []; // Return empty array on failure
    }
}


export async function fetchImagesForRecord(record, allRecords, imageCache) {
    if (!record || !record.id) return { imageUrls: [] }; // Safety check

    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        // log('API', `Cache hit for images: ${record.id}`);
        return { imageUrls: imageCache.get(cacheKey) };
    }
    // log('API', `Fetching images for record: ${record.fields.Name} (${record.id})`);


    const defaultImagePublicID = 'ww71meppejsewxsxr4x7.jpg';
    // Apply standard transformations + f_auto to the fallback
    const ultimateFallbackUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520,f_auto/${defaultImagePublicID}`;

    let imageUrls = [];
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const childRecordNames = new Set(allRecords.map(r => r.fields.Name));
    // Determine if it's a grouping item by checking if options link to other items
    const isGrouping = record.fields['Item Type'] === 'Grouping' || rawOptions.some(opt => childRecordNames.has(opt.name));

    if (isGrouping) {
         log('API', `Record ${record.id} identified as grouping, using fallback image.`);
        // For groupings, often a single representative image or fallback is enough.
        // Or, you could fetch images from the first few child items here if desired.
        imageUrls = [ultimateFallbackUrl];
    } else {
        // 1. Attempt to fetch curated images first
        imageUrls = await fetchCuratedImagesByRecord(record);

        // 2. If no curated images found, fallback to legacy Media Tags
        if (!imageUrls || imageUrls.length === 0) {
             log('API', `No curated images found for ${record.id}, falling back to Media Tags.`);
             imageUrls = await fetchImagesByTags(record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]); // fetchImagesByTags already adds f_auto
        }
    }

    // 3. If still no images, use the ultimate fallback
    if (!imageUrls || imageUrls.length === 0) {
        log('API', `No images found for ${record.id} after all checks, using ultimate fallback.`);
        imageUrls = [ultimateFallbackUrl];
    }

    // Cache the result before returning
    imageCache.set(cacheKey, imageUrls);
     // log('API', `Cached ${imageUrls.length} images for ${record.id}`);
    return { imageUrls };
}


export async function fetchChatMessages(sessionId) {
    if (!sessionId || !sessionId.startsWith('rec')) {
         log('API', 'fetchChatMessages: Invalid or missing sessionId.');
         return [];
    }
    // Fetch messages linked specifically to this Session record
    const formula = `FIND('${sessionId}', ARRAYJOIN({SessionID}))`; // Added {} around SessionID    const encodedFormula = encodeURIComponent(formula);
    // Sort by timestamp ascending (oldest first)
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to fetch chat messages for session ${sessionId}: ${errorData?.error?.message || response.statusText}`);
        }
        const data = await response.json();
        log('API', `Fetched ${data.records.length} chat messages for session ${sessionId}.`);
        return data.records;
    } catch (error) {
        console.error(`Error fetching chat history for session ${sessionId}:`, error);
        return [];
    }
}


export async function postChatMessage(sessionId, senderId, senderName, content) {
    if (!sessionId || !sessionId.startsWith('rec')) {
        console.error(`[API] postChatMessage Error: Invalid sessionId provided: \"${sessionId}\". Cannot save message.`);
        return; // Prevent API call with invalid ID
    }
     if (!content || !content.trim()) {
         log('API', 'postChatMessage: Attempted to send empty message.');
         return; // Don't send empty messages
     }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;
    const payload = {
        records: [{
            fields: {
                SessionID: [sessionId], // Link to the Session record
                SenderID: senderId,     // Could be user record ID or guest ID
                SenderName: senderName, // Display name
                Content: content.trim(),      // Trim whitespace
                // Timestamp is handled automatically by Airtable 'Created time' field
            }
        }]
    };

    try {
         log('API', `Posting chat message to session ${sessionId} from ${senderName}`);
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
            throw new Error(`Airtable API Error posting message: ${errorData?.error?.message || response.statusText}`);
        }

        const result = await response.json();
        const newMessageRecordId = result.records[0].id;
         log('API', `Chat message saved with record ID: ${newMessageRecordId}`);

        // Trigger notifications after successful save
        if (newMessageRecordId) {
            // Use Promise.allSettled to trigger all notifications concurrently and log results/errors
            const notificationPromises = [
                fetch('/api/send-notification', { // SMS via Twilio
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ recordId: newMessageRecordId })
                }).catch(err => console.error(\"SMS notification trigger failed:\", err)),

                fetch('/api/send-email-notification', { // Email via SendGrid
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ recordId: newMessageRecordId })
                }).catch(err => console.error(\"Email notification trigger failed:\", err)),

                fetch('/api/send-chat-to-admin', { // Admin email notification
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ recordId: newMessageRecordId })
                }).catch(err => console.error(\"Admin chat notification trigger failed:\", err))
            ];
            await Promise.allSettled(notificationPromises);
            log('API', `Triggered all notifications for message ${newMessageRecordId}.`);
        }
    } catch (error) {
        console.error(\"CRITICAL: Failed to save chat message to database.\", error);
        // Inform the user in a non-blocking way if possible
         if (typeof ui !== 'undefined' && ui.showToast) {
             ui.showToast(`Error: Could not send message. ${error.message}`);
         } else {
             alert(`Could not save message: ${error.message}`);
         }
    }
}


export async function fetchItemChatMessages(itemId) {
     if (!itemId || !itemId.startsWith('rec')) {
          log('API', 'fetchItemChatMessages: Invalid or missing itemId.');
          return [];
     }
    // Fetch messages linked specifically to this Item record
    const formula = `FIND('${itemId}', ARRAYJOIN({Item Link}))`; // Corrected field name 'Item Link'
    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
             const errorData = await response.json();
            throw new Error(`Failed to fetch item chat messages for ${itemId}: ${errorData?.error?.message || response.statusText}`);
        }
        const data = await response.json();
        log('API', `Fetched ${data.records.length} item chat messages for ${itemId}.`);
        return data.records;
    } catch (error) {
        console.error(`Error fetching item chat history for ${itemId}:`, error);
        return [];
    }
}


export async function postItemChatMessage(itemId, senderId, senderName, content) {
     if (!itemId || !itemId.startsWith('rec')) {
        console.error(`[API] postItemChatMessage Error: Invalid itemId provided: \"${itemId}\".`);
        return;
    }
    if (!content || !content.trim()) {
        log('API', 'postItemChatMessage: Attempted to send empty message.');
        return;
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;
    const payload = {
        records: [{
            fields: {
                'Item Link': [itemId], // Corrected field name 'Item Link'
                SenderID: senderId,
                SenderName: senderName,
                Content: content.trim(),
            }
        }]
    };
    try {
         log('API', `Posting item chat message to item ${itemId} from ${senderName}`);
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
             throw new Error(`Failed to post item chat message to Airtable: ${errorData?.error?.message || response.statusText}`);
        }
        log('API', `Successfully posted item chat message for ${itemId}.`);
         // Optionally trigger notifications specific to item chats if needed
    } catch (error) {
        console.error(`Error posting item chat message for ${itemId}:`, error);
         // Inform user?
         if (typeof ui !== 'undefined' && ui.showToast) {
            ui.showToast(`Error: Could not send message. ${error.message}`);
        }
    }
}


export async function banUser(userId) {
     // Placeholder/Simulation - In a real app, this would call a secure backend endpoint
     // that verifies admin privileges and updates the User record in Airtable.
    log('API', `[MODERATION] Simulating API call to ban user: ${userId}`);
    // Update local state immediately for UI feedback
    state.session.bannedUsers.add(userId);
     // Persisting this requires changes to saveSessionToAirtable or a dedicated endpoint.
     // For now, it's session-local.
     // Optionally trigger a UI refresh if needed
     // document.dispatchEvent(new CustomEvent('moderationStateChanged'));
}


export async function updateUserFlagStatus(userId, isFlagged) {
     // Placeholder/Simulation - In a real app, this would call a secure backend endpoint
     // that verifies admin privileges and updates the User record or a separate Flags table.
    log('API', `[MODERATION] Simulating API call to update flag for user: ${userId} to ${isFlagged}`);
    // Update local state
    if (isFlagged) {
        state.session.flaggedUsers.add(userId);
    } else {
        state.session.flaggedUsers.delete(userId);
    }
    // Persisting this requires changes to saveSessionToAirtable or a dedicated endpoint.
    // For now, it's session-local.
     // Optionally trigger a UI refresh if needed
     // document.dispatchEvent(new CustomEvent('moderationStateChanged'));
}


export async function addRsvpToEvent(eventId, userId) {
    if (!eventId || !userId) {
         log('API', 'addRsvpToEvent: Missing eventId or userId.');
         return null;
    }
    log('API', `Adding RSVP for user ${userId} to event ${eventId}`);
    // Assuming TABLE_ID refers to the Items/Events table
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${eventId}`;

    try {
        // 1. Get current RSVPs
        const getResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!getResponse.ok) {
             if (getResponse.status === 404) throw new Error(`Event ${eventId} not found.`);
             throw new Error(`Could not fetch the event to update RSVPs. Status: ${getResponse.status}`);
        }

        const existingRecord = await getResponse.json();
        // Assuming 'RSVPs' field links to Users table
        const rsvps = new Set(existingRecord.fields.RSVPs || []);

        // 2. Add user if not already RSVP'd
        if (rsvps.has(userId)) {
             log('API', `User ${userId} already RSVP'd to event ${eventId}.`);
             return existingRecord; // Return existing record, no change needed
        }
        rsvps.add(userId);

        // 3. Update the record
        const rsvpPayload = {
            fields: { 'RSVPs': Array.from(rsvps) } // Update the linked records field
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
            throw new Error(`Airtable API Error updating RSVPs: ${errorData?.error?.message || patchResponse.statusText}`);
        }

        log('API', `Successfully added RSVP for user ${userId} to event ${eventId}`);
        return await patchResponse.json(); // Return the updated event record

    } catch (error) {
        console.error(`Failed to add RSVP for event ${eventId}:`, error);
        log('API', `Failed to add RSVP: ${error.message}`);
         if (typeof ui !== 'undefined' && ui.showToast) {
             ui.showToast(`RSVP Error: ${error.message}`);
         }
        return null;
    }
}


// --- NEW FUNCTION TO TOGGLE USER LIKE ---
export async function toggleUserLike(itemId) {
    if (!state.session.user.isAuthenticated || !state.session.user.id) {
        log('API', 'User not authenticated. Cannot toggle like.');
        throw new Error('You must be logged in to like items.');
    }

    const token = localStorage.getItem('jwt');
    if (!token) {
        log('API', 'JWT token not found. Cannot toggle like.');
        throw new Error('Authentication token missing.');
    }

    log('API', `Toggling like for item ${itemId} for user ${state.session.user.id}`);

    try {
        const response = await fetch('/api/like-temp', { // Use temporary path
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ itemId: itemId }) // Pass itemId in the body
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Failed to toggle like (Status: ${response.status})`);
        }

        const result = await response.json();
        log('API', `Successfully toggled like for item ${itemId}. New status: ${result.liked ? 'Liked' : 'Unliked'}`);
        return result; // Should return { success: true, liked: boolean }

    } catch (error) {
        console.error("Error toggling like:", error);
        log('API', `Failed to toggle like: ${error.message}`);
        throw error; // Re-throw the error to be caught by the caller
    }
}
// --- END NEW FUNCTION ---
