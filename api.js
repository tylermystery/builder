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

export async function fetchPlansForUser(userId, includeFullDetails = false) {
    if (!userId) {
        return [];
    }

    // Check if user is a store owner
    const isStoreOwner = state.session.user.isOwner;
    const ownedStoreId = state.session.user.ownedStoreId;

    let formula;
    if (isStoreOwner && ownedStoreId) {
        // If user is a store owner, fetch plans where:
        // 1. User is a collaborator OR
        // 2. Plan belongs to their store
        formula = `OR(FIND('${userId}', ARRAYJOIN({Collaborators})), FIND('${ownedStoreId}', ARRAYJOIN({Stores})))`;
        log('API', `Fetching plans for store owner: collaborator plans + store plans (Store ID: ${ownedStoreId})`);
    } else {
        // Regular user: only fetch plans where they are a collaborator
        formula = `FIND('${userId}', ARRAYJOIN({Collaborators}))`;
        log('API', `Fetching plans for regular user: collaborator plans only`);
    }

    const encodedFormula = encodeURIComponent(formula);
    let url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}`;

    if (!includeFullDetails) {
        url += '&fields%5B%5D=Name'; // Only fetch Name for dropdown
    }
    // If includeFullDetails is true, fetch all fields for catalog display

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

export async function fetchSessionsWithDatesForStore(storeId) {
    console.log('[FETCH SESSIONS] ========== fetchSessionsWithDatesForStore START ==========');
    console.log('[FETCH SESSIONS] Requested storeId:', storeId);

    if (!storeId) {
        console.log('[FETCH SESSIONS] ⚠️ No storeId provided, returning empty array');
        return [];
    }

    console.log('[FETCH SESSIONS] Building Airtable query...');

    // Create formula to filter sessions that:
    // 1. Have the specified store ID in their Stores field
    // 2. Have a non-empty Date field
    // Using OR to try both approaches: FIND in ARRAYJOIN or direct field check
    const formula = `AND(OR(FIND('${storeId}', ARRAYJOIN({Stores})), FIND('${storeId}', {Stores}&'')), {Date} != '')`;
    const encodedFormula = encodeURIComponent(formula);
    console.log('[FETCH SESSIONS] Airtable formula:', formula);
    console.log('[FETCH SESSIONS] Encoded formula:', encodedFormula);

    // Request specific fields needed for calendar display
    const fieldsQuery = [
        'Name',
        'Date',
        'Guest Count',
        'Goals',
        'Stores',
        'Collaborators'
    ].map(field => `fields%5B%5D=${encodeURIComponent(field)}`).join('&');

    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}&${fieldsQuery}`;
    console.log('[FETCH SESSIONS] Full API URL:', url);

    try {
        console.log('[FETCH SESSIONS] Making fetch request...');
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        console.log('[FETCH SESSIONS] Response status:', response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[FETCH SESSIONS] ⚠️ Airtable Error response:', errorText);
            throw new Error('Failed to fetch sessions with dates from Airtable.');
        }

        const data = await response.json();
        console.log('[FETCH SESSIONS] ========== QUERY RESULTS ==========');
        console.log('[FETCH SESSIONS] Number of records returned:', data.records?.length || 0);

        // Log details of each record
        if (data.records && data.records.length > 0) {
            console.log('[FETCH SESSIONS] ✅ Found', data.records.length, 'matching session(s)!');
            data.records.forEach((record, index) => {
                console.log(`[FETCH SESSIONS] --- Session ${index + 1} ---`);
                console.log(`[FETCH SESSIONS]   ID: ${record.id}`);
                console.log(`[FETCH SESSIONS]   Name: ${record.fields.Name}`);
                console.log(`[FETCH SESSIONS]   Date: ${record.fields.Date}`);
                console.log(`[FETCH SESSIONS]   Stores: ${JSON.stringify(record.fields.Stores)}`);
                console.log(`[FETCH SESSIONS]   Stores type: ${typeof record.fields.Stores}`);
                console.log(`[FETCH SESSIONS]   Stores is array? ${Array.isArray(record.fields.Stores)}`);
            });
            console.log('[FETCH SESSIONS] ==================================================');
            console.log('[FETCH SESSIONS] Returning', data.records.length, 'session(s) to calendar');
            return data.records;
        } else {
            console.log('[FETCH SESSIONS] ⚠️ No sessions matched the query');
            console.log('[FETCH SESSIONS] This means either:');
            console.log('[FETCH SESSIONS]   1. No sessions have dates set');
            console.log('[FETCH SESSIONS]   2. No sessions have the Stores field set to:', storeId);
            console.log('[FETCH SESSIONS]   3. Sessions exist but the formula didnt match');

            // Fallback: Try to fetch ALL sessions with dates to debug
            console.log('[FETCH SESSIONS] ========== FALLBACK QUERY ==========');
            console.log('[FETCH SESSIONS] Attempting to fetch ALL sessions with dates...');
            const fallbackFormula = `{Date} != ''`;
            const fallbackEncodedFormula = encodeURIComponent(fallbackFormula);
            const fallbackUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${fallbackEncodedFormula}&${fieldsQuery}`;

            try {
                const fallbackResponse = await fetch(fallbackUrl, {
                    headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
                });

                if (fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    console.log('[FETCH SESSIONS] Fallback query found', fallbackData.records?.length || 0, 'sessions with dates');
                    if (fallbackData.records && fallbackData.records.length > 0) {
                        console.log('[FETCH SESSIONS] --- All Sessions with Dates ---');
                        fallbackData.records.forEach((record, index) => {
                            const stores = record.fields.Stores;
                            const matchesStore = stores ?
                                (Array.isArray(stores) ? stores.includes(storeId) : stores === storeId)
                                : false;
                            console.log(`[FETCH SESSIONS] Session ${index + 1}:`);
                            console.log(`[FETCH SESSIONS]   ID: ${record.id}`);
                            console.log(`[FETCH SESSIONS]   Name: ${record.fields.Name}`);
                            console.log(`[FETCH SESSIONS]   Date: ${record.fields.Date}`);
                            console.log(`[FETCH SESSIONS]   Stores: ${JSON.stringify(stores)}`);
                            console.log(`[FETCH SESSIONS]   Stores type: ${typeof stores}`);
                            console.log(`[FETCH SESSIONS]   Stores is array? ${Array.isArray(stores)}`);
                            console.log(`[FETCH SESSIONS]   Matches storeId '${storeId}'? ${matchesStore ? '✅ YES' : '❌ NO'}`);
                            console.log('[FETCH SESSIONS]   ---');
                        });

                        // Filter manually to sessions that match the storeId
                        const matchingSessions = fallbackData.records.filter(record => {
                            const stores = record.fields.Stores;
                            if (!stores) {
                                console.log(`[FETCH SESSIONS] Excluding ${record.id}: No Stores field`);
                                return false;
                            }
                            if (Array.isArray(stores)) {
                                const matches = stores.includes(storeId);
                                console.log(`[FETCH SESSIONS] ${record.id}: Stores array ${matches ? 'includes' : 'does NOT include'} storeId`);
                                return matches;
                            }
                            const matches = stores === storeId;
                            console.log(`[FETCH SESSIONS] ${record.id}: Stores string ${matches ? 'matches' : 'does NOT match'} storeId`);
                            return matches;
                        });
                        console.log('[FETCH SESSIONS] ==================================================');
                        console.log('[FETCH SESSIONS] Manual filtering found', matchingSessions.length, 'matching session(s)');
                        console.log('[FETCH SESSIONS] Returning manually filtered results');
                        return matchingSessions;
                    } else {
                        console.log('[FETCH SESSIONS] ⚠️ Fallback query found NO sessions with dates at all!');
                        console.log('[FETCH SESSIONS] This means no sessions in Airtable have the Date field set.');
                    }
                }
            } catch (fallbackError) {
                console.error('[FETCH SESSIONS] Fallback query also failed:', fallbackError);
            }
        }

        console.log('[FETCH SESSIONS] ==================================================');
        console.log('[FETCH SESSIONS] Returning empty array');
        return [];
    } catch (error) {
        console.error("[Calendar API Debug] Error fetching sessions with dates:", error);
        return [];
    }
}

// Debug helper function - can be called manually from console to verify a specific session
window.debugFetchSession = async function(sessionId) {
    console.log('[DEBUG] Manually fetching session:', sessionId);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
            console.error('[DEBUG] Failed to fetch session:', response.status, response.statusText);
            return null;
        }
        const data = await response.json();
        console.log('[DEBUG] Session data from Airtable:', data);
        console.log('[DEBUG] Session Name:', data.fields?.Name);
        console.log('[DEBUG] Session Date:', data.fields?.Date);
        console.log('[DEBUG] Session Stores:', data.fields?.Stores);
        console.log('[DEBUG] Stores type:', typeof data.fields?.Stores);
        console.log('[DEBUG] Stores is array?', Array.isArray(data.fields?.Stores));
        console.log('[DEBUG] Stores value:', JSON.stringify(data.fields?.Stores));
        return data;
    } catch (error) {
        console.error('[DEBUG] Error fetching session:', error);
        return null;
    }
};


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
             // Log error but don't throw, as login can still proceed
             if (!patchUserRes.ok) console.error(`Airtable API Error updating user associated sessions: ${await patchUserRes.text()}`);
             else log('API', `Successfully added session ${sessionId} to user ${userId}'s associated sessions.`);
         } else {
              log('API', `Session ${sessionId} already associated with user ${userId}.`);
         }

    } catch (error) {
        // Don't block login flow for this, just log the error
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
        console.log('[DEBUG] loadSessionFromAirtable - Fetched record from Airtable:', record.id);
        console.log('[DEBUG] loadSessionFromAirtable - Record Date field:', record.fields.Date);
        console.log('[DEBUG] loadSessionFromAirtable - Record Guest Count:', record.fields['Guest Count']);
        console.log('[DEBUG] loadSessionFromAirtable - Record Goals:', record.fields.Goals);
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


        // --- THIS IS THE FIX for "Shop Link" ---
        // Check for the field name from the error log.
        // If it's different (e.g., "Store"), change "Shop Link" to "Store"
        if (record.fields['Stores'] && record.fields['Stores'].length > 0) { 
            state.session.storeId = record.fields['Stores'][0];
            log('API', `Session belongs to Store ID: ${state.session.storeId}`);
        } else {
             log('API', 'Session not linked to a specific store (Shop Link field is empty).');
        }

        // If user is authenticated, check if they are a collaborator or owner.
        // If not authenticated, they are a guest with no ownership.
        if (state.session.user.isAuthenticated && state.session.user.id) {
            const isCollaborator = (record.fields.Collaborators || []).includes(state.session.user.id);
            const isStoreOwner = state.session.user.isOwner;
            const ownedStoreId = state.session.user.ownedStoreId;
            const planStoreId = state.session.storeId;
            const isOwnerOfPlanStore = isStoreOwner && ownedStoreId && planStoreId === ownedStoreId;
            state.session.isOwned = isCollaborator || isOwnerOfPlanStore;
            log('API', `Authenticated user. Access level (isOwned): ${state.session.isOwned}`);
        } else {
            state.session.isOwned = false;
            log('API', `Unauthenticated user. Access level (isOwned): false`);
        }

        state.session.user.amountReceived = record.fields['Amount Received'] || 0;
        try {
            state.session.user.paymentHistory = JSON.parse(record.fields.PaymentHistory || '[]');
        } catch (e) {
            state.session.user.paymentHistory = [];
             console.warn(`Could not parse PaymentHistory for session ${sessionId}:`, record.fields.PaymentHistory);
        }
        log('API', `Loaded Amount Received: ${state.session.user.amountReceived}`);

        const sessionDataString = record.fields['Items with Variations'];
        console.log('[DEBUG] loadSessionFromAirtable - Items with Variations field exists:', !!sessionDataString);
        if (sessionDataString && sessionDataString.trim() !== '') {
            try {
                const savedState = JSON.parse(sessionDataString);
                console.log('[DEBUG] loadSessionFromAirtable - Parsed savedState.eventDetails:', savedState.eventDetails);
                state.cart.items = new Map(Object.entries(savedState.ideasItems || savedState.favoritedItems || {}));
                state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems || {}));

                const reactionsObject = savedState.itemReactions || {};
                state.session.reactions = new Map();
                for (const recordId in reactionsObject) {
                    state.session.reactions.set(recordId, new Map(Object.entries(reactionsObject[recordId])));
                }

                state.session.userProfiles = new Map(Object.entries(savedState.userProfiles || {}));
                state.eventDetails.combined = new Map(Object.entries(savedState.eventDetails || savedState.favoritedDetails || {}));
                console.log('[DEBUG] loadSessionFromAirtable - state.eventDetails.combined after loading:', Object.fromEntries(state.eventDetails.combined));
                console.log('[DEBUG] loadSessionFromAirtable - Date value in eventDetails:', state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE));
                state.session.itemPositions = new Map(Object.entries(savedState.itemPositions || {}));
                log('API', `Parsed session data: ${state.cart.items.size} ideas, ${state.cart.lockedItems.size} locked items, ${state.eventDetails.combined.size} details.`);

                // Fetch ghost items (archived/deleted items in the plan)
                const allItemIds = [
                    ...Array.from(state.cart.lockedItems.keys()),
                    ...Array.from(state.cart.items.keys())
                ];
                const missingItemIds = allItemIds.filter(id =>
                    !state.records.all.some(r => r.id === id) &&
                    id.startsWith('rec') // Only fetch real Airtable IDs, not custom items
                );

                if (missingItemIds.length > 0) {
                    log('API', `Found ${missingItemIds.length} ghost items in session, fetching...`);
                    const ghostItems = await fetchGhostItems(missingItemIds);
                    setState({ records: { ...state.records, archive: ghostItems } });
                    log('API', `Stored ${ghostItems.length} ghost items in state.records.archive`);
                }

            } catch (jsonError) {
                log('API', `Failed to parse session JSON for ${sessionId}: ${jsonError.message}`);
                console.error("Session Data String:", sessionDataString);
                 state.cart.items = new Map();
                 state.cart.lockedItems = new Map();
                 state.session.reactions = new Map();
                 state.session.userProfiles = new Map();
                 state.eventDetails.combined = new Map();
                state.session.itemPositions = new Map();
            }
        } else {
             log('API', `Session ${sessionId} has no 'Items with Variations' data.`);
        }

        if (state.session.user.isAuthenticated && state.session.user.id && !state.session.userProfiles.has(state.session.user.id)) {
             state.session.userProfiles.set(state.session.user.id, state.session.user.name || 'User');
             log('API', 'Added current authenticated user to session profiles.');
        }

        document.dispatchEvent(new CustomEvent('sessionReady'));
        log('API', `Finished loading session ${sessionId}. Fired sessionReady event.`);

    } catch (error) {
        console.error(`Failed to load session ${sessionId}:`, error);
        log('API', `Failed to load session: ${error.message}`);
        state.session.id = null;
        alert("Could not load the shared session. It might have been deleted or there was a network issue.");
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search.replace(/&?session=[^&]+/, ''));
    }
}


export async function updatePaymentHistory(sessionId, paymentHistory) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    log('API', `Updating payment history for session ${sessionId}`);

    const historyArray = Array.isArray(paymentHistory) ? paymentHistory : [];
    const newTotal = historyArray.reduce((sum, p) => sum + (p.amount || 0), 0);

    const payload = {
        fields: {
            'Amount Received': newTotal,
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
        return await response.json();
    } catch (error) {
        console.error("Failed to update payment history:", error);
        log('API', `Failed to update payment history: ${error.message}`);
        return null;
    }
}


export async function saveSessionToAirtable() {
    console.log('[SAVE DEBUG] ========== saveSessionToAirtable START ==========');
    console.log('[SAVE DEBUG] state.ui.activeShopId:', state.ui.activeShopId);
    console.log('[SAVE DEBUG] state.session.id:', state.session.id);

    const hasPlanData = state.cart.items.size > 0 || state.cart.lockedItems.size > 0;
    const hasDetails = state.eventDetails.combined.size > 0;
    const hasReactions = state.session.reactions.size > 0;
    const needsInitialSave = !state.session.id;

    console.log('[SAVE DEBUG] hasPlanData:', hasPlanData);
    console.log('[SAVE DEBUG] hasDetails:', hasDetails);
    console.log('[SAVE DEBUG] hasReactions:', hasReactions);
    console.log('[SAVE DEBUG] needsInitialSave:', needsInitialSave);

    if (!hasPlanData && !hasDetails && !hasReactions && !needsInitialSave) {
        log('API', 'saveSessionToAirtable: No changes or data to save, skipping.');
        console.log('[SAVE DEBUG] Skipping save - no data');
        state.ui.saveState = 'SAVED';
        // Check if ui.updateSaveShareButton exists before calling
        if (typeof ui !== 'undefined' && ui.updateSaveShareButton) {
            ui.updateSaveShareButton();
        }
        return false;
    }

    const sessionStatus = state.session.id ? `UPDATE (id: ${state.session.id})` : 'CREATE (new session)';
    log('API', `saveSessionToAirtable: Triggered for ${sessionStatus}`);
    console.log('[SAVE DEBUG] Proceeding with save:', sessionStatus);
    state.ui.saveState = 'SAVING';
    if (typeof ui !== 'undefined' && ui.updateSaveShareButton) ui.updateSaveShareButton();

    const reactionsForSaving = {};
    for (const [recordId, userReactionsMap] of state.session.reactions.entries()) {
        reactionsForSaving[recordId] = Object.fromEntries(userReactionsMap);
    }

    const sessionData = {
        ideasItems: Object.fromEntries(state.cart.items),
        lockedInItems: Object.fromEntries(state.cart.lockedItems),
        itemReactions: reactionsForSaving,
        userProfiles: Object.fromEntries(state.session.userProfiles),
        eventDetails: Object.fromEntries(state.eventDetails.combined),
        itemPositions: Object.fromEntries(state.session.itemPositions)
    };

    const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || `New Plan - ${new Date().toLocaleDateString()}`;
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    console.log('[DEBUG] saveSessionToAirtable - Raw dateValue from state:', dateValue);
    console.log('[DEBUG] saveSessionToAirtable - Is dateValue an array?', Array.isArray(dateValue));
    let formattedDate = null;
    if (dateValue) {
        const dateToFormat = Array.isArray(dateValue) ? dateValue[0] : dateValue;
        console.log('[DEBUG] saveSessionToAirtable - dateToFormat:', dateToFormat);
        const dateObj = new Date(dateToFormat);
        console.log('[DEBUG] saveSessionToAirtable - dateObj:', dateObj);
        console.log('[DEBUG] saveSessionToAirtable - Is valid date?', !isNaN(dateObj.getTime()));
        if (!isNaN(dateObj.getTime())) {
             formattedDate = dateObj.toISOString().split('T')[0];
             console.log('[DEBUG] saveSessionToAirtable - formattedDate for Airtable:', formattedDate);
        }
    } else {
        console.log('[DEBUG] saveSessionToAirtable - No date value found in state');
    }

    const allUserIds = Array.from(state.session.userProfiles.keys());
    const validCollaboratorIds = allUserIds.filter(id => id && typeof id === 'string' && id.startsWith('rec'));
     if (state.session.user.isAuthenticated && state.session.user.id && !validCollaboratorIds.includes(state.session.user.id)) {
          validCollaboratorIds.push(state.session.user.id);
     }

    const storesValue = state.ui.activeShopId ? [state.ui.activeShopId] : null;
    console.log('[SAVE DEBUG] ========== STORES FIELD CONFIGURATION ==========');
    console.log('[SAVE DEBUG] state.ui.activeShopId:', state.ui.activeShopId);
    console.log('[SAVE DEBUG] storesValue being sent to Airtable:', storesValue);
    console.log('[SAVE DEBUG] storesValue type:', typeof storesValue);
    console.log('[SAVE DEBUG] storesValue is array?', Array.isArray(storesValue));
    console.log('[SAVE DEBUG] storesValue is null?', storesValue === null);
    if (storesValue && Array.isArray(storesValue)) {
        console.log('[SAVE DEBUG] storesValue array length:', storesValue.length);
        console.log('[SAVE DEBUG] storesValue array contents:', JSON.stringify(storesValue));
    }
    console.log('[SAVE DEBUG] ====================================================');

    // Note: History field removed - data is already in "Items with Variations"
    // The locked items information is stored in sessionData.lockedInItems
    console.log('[SAVE DEBUG] Locked items count:', state.cart.lockedItems.size);

    const fields = {
        "Name": sessionName,
        "Items with Variations": JSON.stringify(sessionData, null, 2),
        "Collaborators": validCollaboratorIds,
        "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) || null,
        "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || null,
        // --- THIS IS THE FIX for "Shop Link" ---
        // Change "Shop Link" to the exact name from your Airtable Sessions table
        "Stores": storesValue
    };
    if (formattedDate) {
        fields["Date"] = formattedDate;
        console.log('[DEBUG] saveSessionToAirtable - Adding Date field to payload:', formattedDate);
    } else {
        console.log('[DEBUG] saveSessionToAirtable - NOT adding Date field to payload (no formatted date)');
    }

    console.log('[DEBUG] saveSessionToAirtable - Complete fields object being sent:', JSON.stringify(fields, null, 2));

    console.log('[DEBUG] saveSessionToAirtable - sessionData.eventDetails:', sessionData.eventDetails);
    const payload = { fields };
    const isUpdate = state.session.id !== null;
    console.log('[DEBUG] saveSessionToAirtable - isUpdate:', isUpdate, 'session.id:', state.session.id);
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
            throw new Error(`Airtable API Error saving session: ${errorData?.error?.message || response.statusText}`);
        }

        const result = await response.json();
        console.log('[SAVE DEBUG] ========== AIRTABLE RESPONSE ==========');
        console.log('[SAVE DEBUG] Full response:', isUpdate ? result : result.records[0]);

        if (!isUpdate && result.records && result.records.length > 0) {
            const newSessionId = result.records[0].id;
            const savedFields = result.records[0].fields;
            console.log('[SAVE DEBUG] ***** NEW SESSION CREATED *****');
            console.log('[SAVE DEBUG] Session ID:', newSessionId);
            console.log('[SAVE DEBUG] Saved Name:', savedFields?.Name);
            console.log('[SAVE DEBUG] Saved Date:', savedFields?.Date);
            console.log('[SAVE DEBUG] Saved Stores:', savedFields?.Stores);
            console.log('[SAVE DEBUG] Stores type:', typeof savedFields?.Stores);
            console.log('[SAVE DEBUG] Stores is array?', Array.isArray(savedFields?.Stores));
            console.log('[SAVE DEBUG] Stores is null?', savedFields?.Stores === null);
            console.log('[SAVE DEBUG] Stores is undefined?', savedFields?.Stores === undefined);
            if (savedFields?.Stores) {
                console.log('[SAVE DEBUG] Stores value:', JSON.stringify(savedFields.Stores));
            } else {
                console.log('[SAVE DEBUG] ⚠️ WARNING: Stores field is NOT set in Airtable response!');
            }
            console.log('[SAVE DEBUG] ==========================================');

            state.session.id = newSessionId;
            state.session.isOwned = true;
            window.history.replaceState({}, document.title, `?session=${newSessionId}${window.location.search.includes('shopId') ? `&shopId=${state.ui.activeShopId}` : ''}`);
            log('API', `New session created with ID: ${newSessionId}`);
            if(state.session.user.isAuthenticated && state.session.user.id) {
                 await associateSessionWithUser(newSessionId, state.session.user.id);
            }
            document.dispatchEvent(new CustomEvent('sessionReady'));
            document.dispatchEvent(new CustomEvent('planCreated'));
        } else if (isUpdate) {
             const savedFields = result.fields;
             console.log('[SAVE DEBUG] ***** SESSION UPDATED *****');
             console.log('[SAVE DEBUG] Session ID:', state.session.id);
             console.log('[SAVE DEBUG] Saved Name:', savedFields?.Name);
             console.log('[SAVE DEBUG] Saved Date:', savedFields?.Date);
             console.log('[SAVE DEBUG] Saved Stores:', savedFields?.Stores);
             console.log('[SAVE DEBUG] Stores type:', typeof savedFields?.Stores);
             console.log('[SAVE DEBUG] Stores is array?', Array.isArray(savedFields?.Stores));
             console.log('[SAVE DEBUG] Stores is null?', savedFields?.Stores === null);
             console.log('[SAVE DEBUG] Stores is undefined?', savedFields?.Stores === undefined);
             if (savedFields?.Stores) {
                 console.log('[SAVE DEBUG] Stores value:', JSON.stringify(savedFields.Stores));
             } else {
                 console.log('[SAVE DEBUG] ⚠️ WARNING: Stores field is NOT set in Airtable response!');
             }
             console.log('[SAVE DEBUG] ==========================================');
             log('API', `Successfully updated session ${state.session.id}`);
        }

        state.ui.saveState = 'SAVED';
        if (typeof ui !== 'undefined' && ui.updateSaveShareButton) ui.updateSaveShareButton();
        return true;

    } catch (error) {
        console.error("Failed to save session:", error);
        log('API', `Failed to save session: ${error.message}`);
        state.ui.saveState = 'ERROR';
        if (typeof ui !== 'undefined' && ui.updateSaveShareButton) ui.updateSaveShareButton();
        alert(`Error saving your plan: ${error.message}. Please try refreshing the page and trying again.`);
        return false;
    }
}

// REPLACE this function in api.js (around line 348)

export async function fetchAllRecords() {
    let allRecords = [];
    let offset = null;

    // --- List ALL fields needed - MAKE SURE THESE MATCH AIRTABLE EXACTLY ---
    const fieldsToFetch = [
        'Name',
        'Price',
        'Description',
        'Options',
        'Parent Item',
        'Status',
        'Pricing Type',
        'Headcount min',
        'Media Tags',
        'Curated Images',
        'Categories',
        'Subcategories',
        'iCal URL',
        'Lead Time (days)',
        'Item Type',
        'Stores',
        'RSVPs',
        'RSVPMaybe',
        'RSVPNo',
        'Date',
        'Time',
        'Chat Enabled',
        'Duration',
        'Capacity',
        'Location Details',
        'Additional Information',
        'Rankings',
        'AI_Profile',
        'LinkedSession'
    ];
    // --- END OF FIELD LIST ---

    // --- Build the fields query parameter ---
    const fieldsQuery = fieldsToFetch.map(field => `fields%5B%5D=${encodeURIComponent(field)}`).join('&');

    // --- FIX: Add fieldsQuery *after* the question mark ---
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${fieldsQuery}`;
    // --- END FIX ---

    log('API', `Fetching items URL (with fields): ${baseUrl}`); // Log the full URL

    try {
        do {
            let url = baseUrl; // Start with base URL including fields
            if (offset) {
                // Append offset correctly
                url += `&offset=${offset}`;
            }

            // Log the exact URL being fetched in each iteration
            // console.log(`[API Fetch] Requesting URL: ${url}`);

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
            });

            if (!response.ok) {
                // Log status and potentially body for debugging
                const errorText = await response.text();
                console.error(`Airtable Error fetching items (URL: ${url}): Status ${response.status}`, errorText);
                throw new Error(`Failed to fetch items from Airtable. Status: ${response.status}`);
            }
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        log('API', `Total item records fetched: ${allRecords.length}`);
        if (allRecords.length > 0) {
            // Log the actual fields received for the first record
            console.log('[API Debug] Fields received for first record:', Object.keys(allRecords[0].fields));
        } else {
            console.log('[API Debug] No records received from Airtable.');
        }
        return allRecords.filter(record => record.fields && record.fields.Name);
    } catch (error) {
        console.error("Error fetching all item records:", error);
        throw error; // Re-throw the error to be caught by the caller
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
        return records.filter(record => record.fields && record.fields.Name);
    } catch (error) {
        console.error("Error fetching all stores:", error);
        throw error;
    }
}

// In: api.js (Add this function near fetchAllStores)

/**
 * Fetches name and relevant title information for a given array of store IDs.
 * @param {string[]} storeIds - Array of Airtable Store record IDs.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of store objects.
 */
export async function fetchStoreDetailsByIds(storeIds) {
    if (!storeIds || storeIds.length === 0) {
        return [];
    }

    const formula = `OR(${storeIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const encodedFormula = encodeURIComponent(formula);
    // Fetch only the Name and Shop Title
    const fieldsQuery = `fields%5B%5D=Name&fields%5B%5D=Shop%20Title`; 
    
    const url = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE_NAME}?filterByFormula=${encodedFormula}&${fieldsQuery}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error fetching store details:', errorText);
            throw new Error('Failed to fetch store details from Airtable.');
        }
        const data = await response.json();
        log('API', `Fetched ${data.records.length} store details.`);
        return data.records.map(record => ({
            id: record.id,
            name: record.fields.Name,
            shopTitle: record.fields['Shop Title']
        }));
    } catch (error) {
        console.error("Error fetching store details:", error);
        return [];
    }
}

export async function fetchCalendarForRecord(record) {
    if (!record || !record.fields) return [];
    const icalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];
    if (!icalUrl) {
         log('API', `No iCal URL for record ${record.id}`);
        return [];
    }

    if (state.calendar.busyTimes.has(icalUrl)) {
        log('API', `Cache hit for iCal URL: ${icalUrl}`);
        return state.calendar.busyTimes.get(icalUrl);
    }
     log('API', `Fetching calendar for ${record.fields.Name} from URL: ${icalUrl}`);

    try {
        const proxyUrl = `/api/calendar?url=${encodeURIComponent(icalUrl)}`;
        const response = await fetch(proxyUrl);
        if (!response.ok) {
            throw new Error(`Calendar proxy function error: ${response.status} ${response.statusText}`);
        }
        const busyTimes = await response.json();
        state.calendar.busyTimes.set(icalUrl, busyTimes);
         log('API', `Successfully fetched and cached ${busyTimes.length} busy times for ${icalUrl}`);
        return busyTimes;
    } catch (error) {
        console.error(`Failed to fetch/parse calendar for ${record.fields.Name} (${icalUrl}):`, error);
        state.calendar.busyTimes.set(icalUrl, []);
        return [];
    }
}


// In: api.js
// REPLACE the fetchImagesByTags function (around line 520)

export async function fetchImagesByTags(tags, retries = 2) {
    if (!tags || (Array.isArray(tags) && tags.length === 0) || (typeof tags === 'string' && !tags.trim())) {
        log('API', 'fetchImagesByTags: No valid tags provided.');
        return [];
    }

    try {
        let payload;
        if (Array.isArray(tags)) {
            const validTags = tags.map(t => String(t).trim()).filter(Boolean);
            if (validTags.length === 0) return [];
            payload = { expression: validTags.map(tag => `tags:\\\"${tag}\\\"`).join(' AND ') };
            log('API', `Fetching images by expression: ${payload.expression}`);
        } else {
            const tagName = String(tags).trim();
            if (!tagName) return [];
            payload = { tag: tagName };
            log('API', `Fetching images by single tag: ${tagName}`);
        }

        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.status === 429 && retries > 0) {
            log('API', `Cloudinary rate limit hit, retrying in 500ms... (${retries} retries left)`);
            await new Promise(res => setTimeout(res, 500));
            return fetchImagesByTags(tags, retries - 1);
        }

        if (!response.ok) {
            console.warn(`Cloudinary proxy function error: ${response.status} ${response.statusText}`);
            try { console.warn('Cloudinary error body:', await response.text()); } catch (e) {}
            return [];
        }

        const data = await response.json();
        if (!data.resources || data.resources.length === 0) {
             log('API', 'No Cloudinary resources found for the given tags/expression.');
            return [];
        }

        const imageUrls = data.resources.map(image => {
             // --- THIS IS THE FIX ---
             // We force the format to JPG (f_jpg) instead of auto (f_auto).
             // This ensures HEIC and other formats are converted.
             // We also keep the GIF-specific rule.
             let transformations = 'c_fill,g_auto,w_600,h_520,f_jpg'; // Changed f_auto to f_jpg
             if (image.format === 'gif') {
                 transformations = 'c_fit,w_600,h_520';
             }
             // --- END FIX ---

             const urlParts = image.secure_url.split('/upload/');
             if (urlParts.length === 2) {
                return `${urlParts[0]}/upload/${transformations}/${urlParts[1]}`;
             }
             return image.secure_url;
        });

         log('API', `Found ${imageUrls.length} images from Cloudinary.`);
        return imageUrls;

    } catch (error) {
        console.error('Failed to fetch from Cloudinary via proxy:', error);
        return [];
    }
}


// In: api.js
// REPLACE the fetchCuratedImagesByRecord function (around line 580)

export async function fetchCuratedImagesByRecord(record) {
    const curatedLinks = record.fields[CONSTANTS.FIELD_NAMES.CURATED_IMAGES_LINK];

    if (!curatedLinks || !Array.isArray(curatedLinks) || curatedLinks.length === 0) {
        log('API', `Safety Exit: No curated image links found for item ${record.id}.`);
        return [];
    }
    log('API', `Fetching ${curatedLinks.length} curated images for item ${record.id}`);

    const formula = `OR(${curatedLinks.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const sortParams = `&sort%5B0%5D%5Bfield%5D=isBestOf&sort%5B0%5D%5Bdirection%5D=desc`;
    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${IMAGE_GALLERY_TABLE_NAME}?filterByFormula=${encodedFormula}${sortParams}&fields[]=ImageURL`;

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

        const imageUrls = data.records
            .map(r => r.fields.ImageURL)
            .filter(Boolean)
            .map(url => {
                if (url.includes('res.cloudinary.com') && url.includes('/upload/')) {
                    const parts = url.split('/upload/');
                    if (parts.length === 2 && !parts[1].startsWith('f_auto/')) {
                         // --- THIS IS THE FIX ---
                         // Changed f_auto to f_jpg to force conversion of HEIC/other files
                         const transformations = 'c_fill,g_auto,w_600,h_520,f_jpg';
                         // --- END FIX ---
                         return `${parts[0]}/upload/${transformations}/${parts[1]}`;
                     }
                }
                return url;
            });

         log('API', `Successfully fetched and processed ${imageUrls.length} curated image URLs.`);
        return imageUrls;

    } catch (error) {
        console.error(`Error fetching curated images for item ${record.id}:`, error.message);
        return [];
    }
}

// In: api.js
// REPLACE the entire fetchImagesForRecord function (around line 638)

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    if (!record || !record.id) return { imageUrls: [] };

    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        return { imageUrls: imageCache.get(cacheKey) };
    }

    // --- NEW: DYNAMIC FALLBACK LOGIC (as you suggested) ---
    // This function will now be called if all image fetches fail.
    // It overlays the failing tag name onto a placeholder image for easy debugging.
    const getDynamicFallbackUrl = (record) => {
        const mediaTag = record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || "NO_TAG_DEFINED";
        
        // URL-encode the text to be overlaid. \n becomes a new line.
        const encodedTag = encodeURIComponent(`Failed Media Tag:\n${mediaTag}`);
        
        // A generic grey placeholder public ID
        const placeholderPublicID = 'ww71meppejsewxsxr4x7'; // Replaced 'v1/samples/solid_color'
        
        // Cloudinary URL with text overlay:
        // w_600,h_520,c_fill: Base canvas
        // co_rgb:FFFFFF,b_rgb:00000080: Overlay text (white, 80% black background)
        // l_text:Arial_32_bold:...,g_center: Place text in the center
        return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/w_600,h_520,c_fill,g_auto,co_rgb:808080/l_text:Arial_32_bold:${encodedTag},co_rgb:FFFFFF,b_rgb:00000080,g_center/${placeholderPublicID}.jpg`;
    };
    // --- END DYNAMIC FALLBACK LOGIC ---

    let imageUrls = [];

    // --- THIS IS THE FIX ---
    // We REMOVED the faulty 'isGrouping' check that was here.
    // Now, we *always* try to find images for *every* item, letting the
    // 'createInteractiveCard' function decide later if it wants a collage or a single image.
    
    // Step 1: Try to get 'Curated Images' (the new AI-linked field)
    // Per your request, this is NOT the primary method, but we leave the logic in place.
    imageUrls = await fetchCuratedImagesByRecord(record);
    
    // Step 2: If no curated images, fall back to 'Media Tags' (the old way)
    if (!imageUrls || imageUrls.length === 0) {
         log('API', `No curated images found for ${record.id}, falling back to Media Tags.`);
         imageUrls = await fetchImagesByTags(record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]);
    }
    // --- END FIX ---

    // Step 3: If *still* no images, use the new dynamic fallback
    if (!imageUrls || imageUrls.length === 0) {
        log('API', `No images found for ${record.id} after all checks, using DYNAMIC fallback.`);
        imageUrls = [getDynamicFallbackUrl(record)];
    }

    imageCache.set(cacheKey, imageUrls);
    return { imageUrls };
}

export async function fetchChatMessages(sessionId) {
    if (!sessionId || !sessionId.startsWith('rec')) {
         log('API', 'fetchChatMessages: Invalid or missing sessionId.');
         return [];
    }
    // Fetch messages linked specifically to this Session record
// --- REPAIR: Use the correct linked-record ID search formula ---
    const formula = `FIND('${sessionId}', {SessionID_Rollup})`; // The correct formula is simply matching the ID against the linked field string/array representation.
    // --- END REPAIR ---
    const encodedFormula = encodeURIComponent(formula);
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
        return;
    }
     if (!content || !content.trim()) {
         log('API', 'postChatMessage: Attempted to send empty message.');
         return;
     }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;
    const payload = {
        records: [{
            fields: {
                SessionID: [sessionId],
                SenderID: senderId,
                SenderName: senderName,
                Content: content.trim(),
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

        if (newMessageRecordId) {
            const notificationPromises = [
                fetch('/api/send-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ recordId: newMessageRecordId })
                }).catch(err => console.error("SMS notification trigger failed:", err)),

                fetch('/api/send-email-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ recordId: newMessageRecordId })
                }).catch(err => console.error("Email notification trigger failed:", err)),

                fetch('/api/send-chat-to-admin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ recordId: newMessageRecordId })
                }).catch(err => console.error("Admin chat notification trigger failed:", err))
            ];
            await Promise.allSettled(notificationPromises);
            log('API', `Triggered all notifications for message ${newMessageRecordId}.`);
        }
    } catch (error) {
        console.error("CRITICAL: Failed to save chat message to database.", error);
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
        const result = await response.json();
        const newMessageRecordId = result.records[0].id;
        log('API', `Successfully posted item chat message for ${itemId}. Message ID: ${newMessageRecordId}`);
        
        fetch('/api/notify-rsvp-users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ recordId: newMessageRecordId })
        }).catch(err => console.error("RSVP user notification trigger failed:", err));
        
    } catch (error) {
        console.error(`Error posting item chat message for ${itemId}:`, error);
         if (typeof ui !== 'undefined' && ui.showToast) {
            ui.showToast(`Error: Could not send message. ${error.message}`);
        }
    }
}


export async function banUser(userId) {
    log('API', `[MODERATION] Simulating API call to ban user: ${userId}`);
    state.session.bannedUsers.add(userId);
}


export async function updateUserFlagStatus(userId, isFlagged) {
    log('API', `[MODERATION] Simulating API call to update flag for user: ${userId} to ${isFlagged}`);
    if (isFlagged) {
        state.session.flaggedUsers.add(userId);
    } else {
        state.session.flaggedUsers.delete(userId);
    }
}


export async function updateRsvpForEvent(eventId, userId, rsvpType) {
    if (!eventId || !userId) {
         log('API', 'updateRsvpForEvent: Missing eventId or userId.');
         return null;
    }
    log('API', `Updating RSVP for user ${userId} to event ${eventId} with type: ${rsvpType}`);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${eventId}`;

    try {
        const getResponse = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!getResponse.ok) {
             if (getResponse.status === 404) throw new Error(`Event ${eventId} not found.`);
             throw new Error(`Could not fetch the event to update RSVPs. Status: ${getResponse.status}`);
        }

        const existingRecord = await getResponse.json();
        const rsvpYes = new Set(existingRecord.fields.RSVPs || []);
        const rsvpMaybe = new Set(existingRecord.fields.RSVPMaybe || []);
        const rsvpNo = new Set(existingRecord.fields.RSVPNo || []);

        rsvpYes.delete(userId);
        rsvpMaybe.delete(userId);
        rsvpNo.delete(userId);

        if (rsvpType === 'yes') {
            rsvpYes.add(userId);
        } else if (rsvpType === 'maybe') {
            rsvpMaybe.add(userId);
        } else if (rsvpType === 'no') {
            rsvpNo.add(userId);
        }

        const rsvpPayload = {
            fields: { 
                'RSVPs': Array.from(rsvpYes),
                'RSVPMaybe': Array.from(rsvpMaybe),
                'RSVPNo': Array.from(rsvpNo)
            }
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

        log('API', `Successfully updated RSVP for user ${userId} to event ${eventId}`);
        return await patchResponse.json();

    } catch (error) {
        console.error(`Failed to update RSVP for event ${eventId}:`, error);
        log('API', `Failed to update RSVP: ${error.message}`);
         if (typeof ui !== 'undefined' && ui.showToast) {
             ui.showToast(`RSVP Error: ${error.message}`);
         }
        return null;
    }
}

export async function addRsvpToEvent(eventId, userId) {
    return updateRsvpForEvent(eventId, userId, 'yes');
}


// --- FUNCTION TO TOGGLE USER LIKE (Using combined endpoint) ---
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

    log('API', `Toggling like for item ${itemId} via update-user-prefs`);

    try {
        // Call the KNOWN-WORKING endpoint
        const response = await fetch('/api/update-user-prefs', { 
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            // Send the 'action' and 'itemId'
            body: JSON.stringify({ 
                action: 'toggle-like',
                itemId: itemId 
            }) 
        });

        if (!response.ok) {
            // Try to parse error JSON, but handle empty/non-JSON responses
            let errorText = response.statusText;
            try {
                const errorData = await response.json(); // This is line 981
                errorText = errorData.error || errorText;
            } catch (e) {
                // This catch block handles the "Unexpected end of JSON input"
                log('API', 'Could not parse error response as JSON.');
            }
            throw new Error(errorText || `Failed to toggle like (Status: ${response.status})`);
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

/**
 * Fetches ghost items (archived/deleted items) that are referenced in a session's history
 * @param {Array<string>} recordIds - Array of record IDs to fetch
 * @returns {Promise<Array>} Array of item records
 */
export async function fetchGhostItems(recordIds) {
    if (!recordIds || recordIds.length === 0) {
        return [];
    }

    // Filter out IDs that don't look like Airtable record IDs
    const validIds = recordIds.filter(id => id && id.startsWith('rec'));
    if (validIds.length === 0) {
        return [];
    }

    // Build OR formula for multiple records
    const formula = `OR(${validIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const encodedFormula = encodeURIComponent(formula);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?filterByFormula=${encodedFormula}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error fetching ghost items:', errorText);
            return []; // Return empty array instead of throwing
        }

        const data = await response.json();
        log('API', `Fetched ${data.records.length} ghost items`);
        return data.records;
    } catch (error) {
        console.error("Error fetching ghost items:", error);
        return []; // Return empty array on error
    }
}

/**
 * Publishes or updates a Session as a public Event item
 * @param {string} sessionId - The session record ID
 * @param {Object} eventData - Event data (Name, Date, Goals, etc.)
 * @returns {Promise<Object>} The created or updated item record
 */
export async function publishSessionAsEvent(sessionId, eventData) {
    if (!sessionId) {
        throw new Error('Session ID is required to publish as event');
    }

    const session = await fetchSessionById(sessionId);
    if (!session) {
        throw new Error('Session not found');
    }

    // Check if this session is already linked to an event
    const linkedItemId = session.fields.LinkedItem ? session.fields.LinkedItem[0] : null;

    // Format the date properly for Airtable
    // Items table Date field may be a DateTime type requiring full ISO 8601 format
    // Sessions table Date field accepts YYYY-MM-DD format
    let formattedDateOnly = null;  // YYYY-MM-DD format for simple date fields
    let formattedDateTime = null;  // Full ISO 8601 for datetime fields
    const dateValue = eventData.Date || session.fields.Date;

    if (dateValue) {
        const dateToFormat = Array.isArray(dateValue) ? dateValue[0] : dateValue;

        // Check if it's already in YYYY-MM-DD format (no time component)
        if (typeof dateToFormat === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateToFormat)) {
            formattedDateOnly = dateToFormat;
            // Also create a full ISO datetime string for datetime fields
            // Use noon UTC to avoid timezone issues
            formattedDateTime = `${dateToFormat}T12:00:00.000Z`;
        } else if (typeof dateToFormat === 'string' && dateToFormat.includes('T')) {
            // It's already a full ISO datetime string
            formattedDateTime = dateToFormat;
            formattedDateOnly = dateToFormat.split('T')[0];
        } else {
            // Parse and format the date
            const dateObj = new Date(dateToFormat);

            if (!isNaN(dateObj.getTime())) {
                // Create both formats
                formattedDateTime = dateObj.toISOString();  // Full ISO 8601 with time
                formattedDateOnly = formattedDateTime.split('T')[0]; // Date only YYYY-MM-DD
            }
        }
    }

    const itemFields = {
        'Name': eventData.Name || session.fields.Name || 'Untitled Event',
        'Description': eventData.Description || session.fields.Goals || '',
        'Item Type': 'Event',
        'Status': 'Available',
        'LinkedSession': [sessionId], // Link back to the session
        // Note: Goals and Guest Count exist in Sessions table, not Items table
        // They are stored in the linked Session record
    };

    // Airtable Date fields (not DateTime fields) require YYYY-MM-DD format only
    if (formattedDateOnly) {
        itemFields['Date'] = formattedDateOnly;
    }

    let itemRecord;

    if (linkedItemId) {
        // Update existing event
        const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${linkedItemId}`;
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: itemFields })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Failed to update event:', errorText);
            throw new Error(`Failed to update event: ${errorText}`);
        }

        itemRecord = await response.json();
        log('API', `Updated event ${linkedItemId} from session ${sessionId}`);
    } else {
        // Create new event
        const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: itemFields })
        });

        if (!response.ok) {
            const errorText = await response.text();

            // Check if the error is specifically about the Date field
            if (response.status === 422 && errorText.toLowerCase().includes('date')) {
                // Remove the Date field and try again
                const itemFieldsWithoutDate = { ...itemFields };
                delete itemFieldsWithoutDate['Date'];

                const retryResponse = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ fields: itemFieldsWithoutDate })
                });

                if (!retryResponse.ok) {
                    const retryErrorText = await retryResponse.text();
                    throw new Error(`Failed to create event even without Date field: ${retryErrorText}`);
                }

                itemRecord = await retryResponse.json();
                log('API', `Created event ${itemRecord.id} from session ${sessionId} (without date)`);
            } else {
                throw new Error(`Failed to create event: ${errorText}`);
            }
        } else {
            itemRecord = await response.json();
            log('API', `Created event ${itemRecord.id} from session ${sessionId}`);
        }
        // Update session with link to new event
        const updateSessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
        await fetch(updateSessionUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: { 'LinkedItem': [itemRecord.id] } })
        });
    }

    return itemRecord;
}

/**
 * Fetches a single session by ID
 * @param {string} sessionId - The session record ID
 * @returns {Promise<Object>} The session record
 */
export async function fetchSessionById(sessionId) {
    if (!sessionId) {
        return null;
    }

    // Fetch all fields from the session record
    // Note: Not using fields[] parameter to avoid 422 errors from fields that may not exist
    // and to ensure we get all fields including LinkedItem if it exists
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error fetching session:', errorText);
            return null;
        }

        const data = await response.json();
        return data;
    } catch (error) {
        console.error("Error fetching session:", error);
        return null;
    }
}

/**
 * Finds a session by searching for which session has this event in its LinkedItem field
 * This is a fallback for when an Event record doesn't have a LinkedSession field
 * @param {string} eventId - The event/item record ID to search for
 * @returns {Promise<Object|null>} The session record if found, null otherwise
 */
export async function fetchSessionByLinkedItem(eventId) {
    if (!eventId) {
        return null;
    }

    // Build a formula to find sessions where LinkedItem contains this event ID
    const formula = `FIND('${eventId}', ARRAYJOIN({LinkedItem}))`;
    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error searching sessions by LinkedItem:', errorText);
            return null;
        }

        const data = await response.json();

        if (data.records && data.records.length > 0) {
            return data.records[0]; // Take the first match
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error fetching session by LinkedItem:", error);
        return null;
    }
}

