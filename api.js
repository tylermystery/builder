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

// --- PHASE 3: TASKS TABLE ---
const TASKS_TABLE_NAME = 'Tasks';
// --------------------------------

// --- API Timeout Configuration ---
const API_TIMEOUT_MS = 15000; // 15 second timeout for API calls

/**
 * Fetch with timeout wrapper to prevent indefinite hangs
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} timeoutMs - Timeout in milliseconds (default: API_TIMEOUT_MS)
 * @returns {Promise<Response>} - Fetch response
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
    // Defensive: validate inputs
    if (!url || typeof url !== 'string') {
        throw new Error('fetchWithTimeout: Invalid URL provided');
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`[API DEBUG] Fetch timeout after ${timeoutMs}ms for URL: ${url.substring(0, 100)}...`);
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            console.error(`[API DEBUG] Request aborted due to timeout: ${url.substring(0, 100)}...`);
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw error;
    }
}
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

/**
 * Fetch project hierarchy for authenticated user
 * Returns all sessions/projects the user has access to with hierarchical data
 * @param {string} userId - The authenticated user's ID
 * @returns {Promise<Array>} - Array of project records
 */
export async function fetchProjectHierarchy(userId) {
    if (!userId) {
        log('API', 'fetchProjectHierarchy called without userId');
        return [];
    }

    log('API', `Fetching project hierarchy for user: ${userId}`);

    // Check if user is a store owner
    const isStoreOwner = state.session.user.isOwner;
    const ownedStoreId = state.session.user.ownedStoreId;

    let formula;
    if (isStoreOwner && ownedStoreId) {
        // Store owners see their collaborator plans + all plans for their store
        formula = `OR(FIND('${userId}', ARRAYJOIN({Collaborators})), FIND('${ownedStoreId}', ARRAYJOIN({Stores})))`;
        log('API', `Fetching projects for store owner: user plans + store plans (Store ID: ${ownedStoreId})`);
    } else {
        // Regular users only see plans they collaborate on
        formula = `FIND('${userId}', ARRAYJOIN({Collaborators}))`;
        log('API', `Fetching projects for regular user: collaborator plans only`);
    }

    const encodedFormula = encodeURIComponent(formula);

    // Request fields needed for project hierarchy display
    const fieldsQuery = [
        'Name',
        'Date',
        'Guest Count',
        'Goals',
        'Stores',
        'Collaborators',
        'Parent_Session',
        'Items with Variations',
        'Cart Type'
    ].map(field => `fields%5B%5D=${encodeURIComponent(field)}`).join('&');

    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}&${fieldsQuery}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error fetching project hierarchy:', errorText);
            throw new Error('Failed to fetch project hierarchy from Airtable.');
        }

        const data = await response.json();

        // Sort by creation time, newest first
        data.records.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));

        log('API', `Fetched ${data.records.length} projects for user ${userId}`);
        return data.records;
    } catch (error) {
        console.error("Error fetching project hierarchy:", error);
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
    console.log('[SESSION-LOAD] ========== START ==========');
    console.log(`[SESSION-LOAD] Loading session: ${sessionId}`);

    if (!sessionId) {
         console.log('[SESSION-LOAD] ❌ No sessionId provided');
         log('API', 'loadSessionFromAirtable called with no sessionId.');
         return;
    }
    // Avoid reloading if already loaded
    if (state.session.id === sessionId) {
        console.log(`[SESSION-LOAD] Session ${sessionId} already loaded`);
        log('API', `Session ${sessionId} is already loaded.`);
        if (state.cart.lockedItems.size > 0 || state.eventDetails.combined.size > 0) {
             console.log('[SESSION-LOAD] Firing sessionReady event');
             document.dispatchEvent(new CustomEvent('sessionReady'));
        }
        console.log('[SESSION-LOAD] ========== END (already loaded) ==========');
        return;
    }

    state.session.id = sessionId;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    log('API', `Loading session from URL: ${url}`);
    try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` } });
        console.log(`[SESSION-LOAD] Airtable response: ${response.status}`);
        if (!response.ok) {
            const errorData = await response.json();
            console.error('[SESSION-LOAD] ❌ Airtable error:', errorData);
            throw new Error(`Could not fetch session data. Status: ${response.status}`);
        }
        const record = await response.json();
        console.log(`[SESSION-LOAD] ✅ Session loaded: "${record.fields?.Name}" (${record.id})`);
        console.log(`[SESSION-LOAD] Plan details - Date: ${record.fields.Date}, Goals: ${record.fields.Goals?.substring(0, 50)}...`);
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

            // Auto-associate authenticated user as collaborator when opening a plan
            // This ensures the plan appears in their plans list immediately
            if (!isCollaborator) {
                console.log(`[SESSION-LOAD] User ${state.session.user.id} not yet collaborator on session ${sessionId}, adding...`);
                // Fire async - don't block session load, just log errors
                associateSessionWithUser(sessionId, state.session.user.id).catch(err => {
                    console.error('[SESSION-LOAD] Failed to auto-associate user with session:', err.message);
                });
            }
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
        if (sessionDataString && sessionDataString.trim() !== '') {
            try {
                const savedState = JSON.parse(sessionDataString);
                console.log(`[SESSION-LOAD] Parsed session data - eventDetails keys: ${Object.keys(savedState.eventDetails || {}).join(', ')}`);

                state.cart.items = new Map(Object.entries(savedState.ideasItems || savedState.favoritedItems || {}));
                state.cart.lockedItems = new Map(Object.entries(savedState.lockedInItems || {}));

                const reactionsObject = savedState.itemReactions || {};
                state.session.reactions = new Map();
                for (const recordId in reactionsObject) {
                    state.session.reactions.set(recordId, new Map(Object.entries(reactionsObject[recordId])));
                }

                state.session.userProfiles = new Map(Object.entries(savedState.userProfiles || {}));

                // Normalize eventDetails keys to handle legacy format
                // Legacy keys: 'Event Name', 'Goals', 'Date' -> New keys: 'eventName', 'goals', 'date'
                const rawEventDetails = savedState.eventDetails || savedState.favoritedDetails || {};
                const normalizedEventDetails = {};

                // Key normalization mapping (legacy -> current)
                const keyMapping = {
                    'Event Name': CONSTANTS.DETAIL_TYPES.EVENT_NAME,  // 'eventName'
                    'Goals': CONSTANTS.DETAIL_TYPES.GOALS,            // 'goals'
                    'Date': CONSTANTS.DETAIL_TYPES.DATE,              // 'date'
                    // Also handle already-correct camelCase keys
                    'eventName': CONSTANTS.DETAIL_TYPES.EVENT_NAME,
                    'goals': CONSTANTS.DETAIL_TYPES.GOALS,
                    'date': CONSTANTS.DETAIL_TYPES.DATE,
                    'guestCount': CONSTANTS.DETAIL_TYPES.GUEST_COUNT,
                    'specialRequests': CONSTANTS.DETAIL_TYPES.SPECIAL_REQUESTS
                };

                for (const [key, value] of Object.entries(rawEventDetails)) {
                    const normalizedKey = keyMapping[key] || key; // Use mapping if exists, otherwise keep original
                    normalizedEventDetails[normalizedKey] = value;
                }

                state.eventDetails.combined = new Map(Object.entries(normalizedEventDetails));
                console.log('[SESSION-LOAD DEBUG] Event details loaded:', Object.fromEntries(state.eventDetails.combined));
                console.log('[SESSION-LOAD DEBUG] Date value:', state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE));

                state.session.itemPositions = new Map(Object.entries(savedState.itemPositions || {}));
                log('API', `Parsed session data: ${state.cart.items.size} ideas, ${state.cart.lockedItems.size} locked items, ${state.eventDetails.combined.size} details.`);

                // Restore AI-generated records from saved session data
                // These are items that were created via AI parsing and don't exist in Airtable
                if (savedState.aiRecords && Object.keys(savedState.aiRecords).length > 0) {
                    const aiRecordsToRestore = Object.values(savedState.aiRecords);
                    for (const aiRecord of aiRecordsToRestore) {
                        // Only add if not already in state.records.all
                        if (!state.records.all.some(r => r.id === aiRecord.id)) {
                            state.records.all.push(aiRecord);
                        }
                    }
                    log('API', `Restored ${aiRecordsToRestore.length} AI-generated items from session data`);
                    console.log(`[SESSION-LOAD] Restored ${aiRecordsToRestore.length} AI-generated items`);
                }

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

                // Restore generated options to record objects from itemInfo
                // This allows AI-generated options to persist across page reloads
                const restoreGeneratedOptions = (itemsMap) => {
                    for (const [recordId, itemInfo] of itemsMap.entries()) {
                        if (itemInfo.generatedOptions) {
                            // Find the record in state.records.all or state.records.archive
                            let record = state.records.all.find(r => r.id === recordId);
                            if (!record) {
                                record = state.records.archive?.find(r => r.id === recordId);
                            }
                            if (record) {
                                record.fields[CONSTANTS.FIELD_NAMES.OPTIONS] = itemInfo.generatedOptions;
                                log('API', `Restored generated options for item ${recordId}`);
                            }
                        }
                    }
                };

                restoreGeneratedOptions(state.cart.lockedItems);
                restoreGeneratedOptions(state.cart.items);

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

        console.log(`[SESSION-LOAD] ✅ Session ready - items: ${state.cart.items.size}, locked: ${state.cart.lockedItems.size}, details: ${state.eventDetails.combined.size}`);
        console.log('[SESSION-LOAD] Dispatching sessionReady event...');
        document.dispatchEvent(new CustomEvent('sessionReady'));
        log('API', `Finished loading session ${sessionId}. Fired sessionReady event.`);
        console.log('[SESSION-LOAD] ========== END (success) ==========');

    } catch (error) {
        console.error('[SESSION-LOAD] ❌ Error loading session:', error.message);
        log('API', `Failed to load session: ${error.message}`);
        state.session.id = null;
        alert("Could not load the shared session. It might have been deleted or there was a network issue.");
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search.replace(/&?session=[^&]+/, ''));
        console.log('[SESSION-LOAD] ========== END (error) ==========');
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
    const hasPlanData = state.cart.items.size > 0 || state.cart.lockedItems.size > 0;
    const hasDetails = state.eventDetails.combined.size > 0;
    const hasReactions = state.session.reactions.size > 0;
    const needsInitialSave = !state.session.id;

    if (!hasPlanData && !hasDetails && !hasReactions && !needsInitialSave) {
        log('API', 'saveSessionToAirtable: No changes or data to save, skipping.');
        state.ui.saveState = 'SAVED';
        // Check if ui.updateSaveShareButton exists before calling
        if (typeof ui !== 'undefined' && ui.updateSaveShareButton) {
            ui.updateSaveShareButton();
        }
        return false;
    }

    const sessionStatus = state.session.id ? `UPDATE (id: ${state.session.id})` : 'CREATE (new session)';
    log('API', `saveSessionToAirtable: Triggered for ${sessionStatus}`);
    state.ui.saveState = 'SAVING';
    if (typeof ui !== 'undefined' && ui.updateSaveShareButton) ui.updateSaveShareButton();

    const reactionsForSaving = {};
    for (const [recordId, userReactionsMap] of state.session.reactions.entries()) {
        reactionsForSaving[recordId] = Object.fromEntries(userReactionsMap);
    }

    // Collect AI-generated item records that are in the cart (ideas or locked)
    // These need to be persisted since they don't exist in Airtable
    const allCartItemIds = [
        ...Array.from(state.cart.items.keys()),
        ...Array.from(state.cart.lockedItems.keys())
    ];
    const aiRecordsToSave = {};
    for (const itemId of allCartItemIds) {
        // AI-generated items have IDs like 'ai-child-*', 'ai-search-*', or 'ai-presentation-*'
        if (itemId.startsWith('ai-')) {
            const aiRecord = state.records.all.find(r => r.id === itemId);
            if (aiRecord) {
                aiRecordsToSave[itemId] = {
                    id: aiRecord.id,
                    fields: aiRecord.fields,
                    isAI: true
                };
            }
        }
    }

    const sessionData = {
        ideasItems: Object.fromEntries(state.cart.items),
        lockedInItems: Object.fromEntries(state.cart.lockedItems),
        itemReactions: reactionsForSaving,
        userProfiles: Object.fromEntries(state.session.userProfiles),
        eventDetails: Object.fromEntries(state.eventDetails.combined),
        itemPositions: Object.fromEntries(state.session.itemPositions),
        // Store full AI record data for persistence across refreshes
        aiRecords: aiRecordsToSave
    };

    const sessionName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || `New Plan - ${new Date().toLocaleDateString()}`;
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    let formattedDate = null;
    if (dateValue) {
        const dateToFormat = Array.isArray(dateValue) ? dateValue[0] : dateValue;
        const dateObj = new Date(dateToFormat);
        if (!isNaN(dateObj.getTime())) {
             formattedDate = dateObj.toISOString().split('T')[0];
        }
    }

    const allUserIds = Array.from(state.session.userProfiles.keys());
    const validCollaboratorIds = allUserIds.filter(id => id && typeof id === 'string' && id.startsWith('rec'));
     if (state.session.user.isAuthenticated && state.session.user.id && !validCollaboratorIds.includes(state.session.user.id)) {
          validCollaboratorIds.push(state.session.user.id);
     }

    const storesValue = state.ui.activeShopId ? [state.ui.activeShopId] : null;

    const fields = {
        "Name": sessionName,
        "Items with Variations": JSON.stringify(sessionData, null, 2),
        "Collaborators": validCollaboratorIds,
        "Guest Count": parseInt(state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT), 10) || null,
        "Goals": state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || null,
        "Stores": storesValue
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
            throw new Error(`Airtable API Error saving session: ${errorData?.error?.message || response.statusText}`);
        }

        const result = await response.json();

        if (!isUpdate && result.records && result.records.length > 0) {
            const newSessionId = result.records[0].id;

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
             log('API', `Successfully updated session ${state.session.id}`);
        }

        state.ui.saveState = 'SAVED';
        if (typeof ui !== 'undefined' && ui.updateSaveShareButton) ui.updateSaveShareButton();
        return true;

    } catch (error) {
        log('API', `Failed to save session: ${error.message}`);
        state.ui.saveState = 'ERROR';
        if (typeof ui !== 'undefined' && ui.updateSaveShareButton) ui.updateSaveShareButton();
        alert(`Error saving your plan: ${error.message}. Please try refreshing the page and trying again.`);
        return false;
    }
}

/**
 * Phase 5: Add an item to a specific session/project
 * Used for cross-project "Add to Project" functionality
 * @param {string} sessionId - The target session/project ID
 * @param {string} itemId - The item record ID to add
 * @param {Object} itemInfo - Item info (quantity, selections, note)
 * @returns {Promise<boolean>} - Success status
 */
export async function addItemToSession(sessionId, itemId, itemInfo = {}) {
    if (!sessionId || !itemId) {
        console.error('[API] addItemToSession: Missing sessionId or itemId');
        return false;
    }

    log('API', `Adding item ${itemId} to session ${sessionId}`);

    try {
        // First, fetch the current session data
        const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch session: ${response.status}`);
        }

        const sessionRecord = await response.json();
        let sessionData = {};

        // Parse existing Items with Variations data
        const existingData = sessionRecord.fields?.['Items with Variations'];
        if (existingData) {
            try {
                sessionData = JSON.parse(existingData);
            } catch (e) {
                console.error('[API] Failed to parse existing session data:', e);
                sessionData = { lockedInItems: {}, ideasItems: {} };
            }
        } else {
            sessionData = { lockedInItems: {}, ideasItems: {} };
        }

        // Add the item to lockedInItems (the plan)
        if (!sessionData.lockedInItems) {
            sessionData.lockedInItems = {};
        }

        // Check if item already exists
        if (sessionData.lockedInItems[itemId]) {
            log('API', `Item ${itemId} already exists in session ${sessionId}`);
            return true; // Already there, consider success
        }

        // Add the item with default info
        sessionData.lockedInItems[itemId] = {
            quantity: itemInfo.quantity || 1,
            selectedOptionIndex: itemInfo.selectedOptionIndex || 0,
            selections: itemInfo.selections || {},
            note: itemInfo.note || ''
        };

        // If this is an AI-generated item, also save its full record data
        // so it persists in the target session
        if (itemId.startsWith('ai-')) {
            const aiRecord = state.records.all.find(r => r.id === itemId);
            if (aiRecord) {
                if (!sessionData.aiRecords) {
                    sessionData.aiRecords = {};
                }
                sessionData.aiRecords[itemId] = {
                    id: aiRecord.id,
                    fields: aiRecord.fields,
                    isAI: true
                };
                log('API', `Also saving AI record data for ${itemId} to session ${sessionId}`);
            }
        }

        // Update the session in Airtable
        const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
        const updateResponse = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fields: {
                    'Items with Variations': JSON.stringify(sessionData)
                }
            })
        });

        if (!updateResponse.ok) {
            throw new Error(`Failed to update session: ${updateResponse.status}`);
        }

        log('API', `Successfully added item ${itemId} to session ${sessionId}`);
        return true;

    } catch (error) {
        console.error('[API] Error adding item to session:', error);
        return false;
    }
}

// REPLACE this function in api.js (around line 348)

export async function fetchAllRecords() {
    console.log('[FETCH DEBUG] ========== fetchAllRecords CALLED ==========');
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
    console.log('[FETCH DEBUG] Fields to fetch:', fieldsToFetch.length, 'fields including Item Type and LinkedSession');

    // --- Build the fields query parameter ---
    const fieldsQuery = fieldsToFetch.map(field => `fields%5B%5D=${encodeURIComponent(field)}`).join('&');

    // --- FIX: Add fieldsQuery *after* the question mark ---
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}?${fieldsQuery}`;
    // --- END FIX ---
    console.log('[FETCH DEBUG] Base URL for Items table:', baseUrl.substring(0, 100) + '...');
    console.log('[FETCH DEBUG] TABLE_ID:', TABLE_ID);

    log('API', `Fetching items URL (with fields): ${baseUrl}`); // Log the full URL

    try {
        do {
            let url = baseUrl; // Start with base URL including fields
            if (offset) {
                // Append offset correctly
                url += `&offset=${offset}`;
            }

            console.log(`[FETCH DEBUG] Requesting URL (page ${allRecords.length > 0 ? Math.ceil(allRecords.length / 100) + 1 : 1}):`, url.substring(0, 100) + '...');

            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
            });

            if (!response.ok) {
                // Log status and potentially body for debugging
                const errorText = await response.text();
                console.error(`[FETCH DEBUG] Airtable Error fetching items (URL: ${url}): Status ${response.status}`, errorText);
                throw new Error(`Failed to fetch items from Airtable. Status: ${response.status}`);
            }
            const data = await response.json();
            console.log(`[FETCH DEBUG] Page fetched: ${data.records.length} records`);
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);

        console.log('[FETCH DEBUG] ========== ANALYZING FETCHED RECORDS ==========');
        console.log('[FETCH DEBUG] Total item records fetched:', allRecords.length);

        // Analyze records by Item Type
        const itemTypeStats = {};
        const packagesFound = [];
        allRecords.forEach(record => {
            const itemType = record.fields['Item Type'] || 'Undefined';
            itemTypeStats[itemType] = (itemTypeStats[itemType] || 0) + 1;

            // Specifically track packages
            if (itemType === 'Package') {
                packagesFound.push({
                    id: record.id,
                    name: record.fields.Name,
                    status: record.fields.Status,
                    linkedSession: record.fields.LinkedSession
                });
            }
        });
        console.log('[FETCH DEBUG] Item types breakdown:', JSON.stringify(itemTypeStats, null, 2));
        console.log('[FETCH DEBUG] Packages found:', packagesFound.length);
        if (packagesFound.length > 0) {
            console.log('[FETCH DEBUG] Package details:', JSON.stringify(packagesFound, null, 2));
        }

        log('API', `Total item records fetched: ${allRecords.length}`);
        if (allRecords.length > 0) {
            // Log the actual fields received for the first record
            console.log('[FETCH DEBUG] Fields received for first record:', Object.keys(allRecords[0].fields));
        } else {
            console.log('[FETCH DEBUG] No records received from Airtable.');
        }

        // Filter and return
        const filteredRecords = allRecords.filter(record => record.fields && record.fields.Name);
        console.log('[FETCH DEBUG] Records after Name filter:', filteredRecords.length);

        // Check if any packages were filtered out
        const filteredPackages = filteredRecords.filter(r => r.fields['Item Type'] === 'Package');
        console.log('[FETCH DEBUG] Packages after Name filter:', filteredPackages.length);

        console.log('[FETCH DEBUG] ========== fetchAllRecords COMPLETE ==========');
        return filteredRecords;
    } catch (error) {
        console.error("[FETCH DEBUG] Error fetching all item records:", error);
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

// Client-side request deduplication to prevent parallel calls for same tags
const pendingImageRequests = new Map();

// Generate a cache key for image requests
function getImageRequestKey(tags) {
    if (Array.isArray(tags)) {
        return `multi:${tags.map(t => String(t).trim()).filter(Boolean).sort().join(',')}`;
    }
    return `single:${String(tags).trim()}`;
}

export async function fetchImagesByTags(tags, retries = 2) {
    // === IMAGE DEBUG: Log entry to fetchImagesByTags ===
    console.log('[IMAGE DEBUG] fetchImagesByTags CALLED with:', {
        tags: tags,
        tagsType: typeof tags,
        isArray: Array.isArray(tags),
        retriesRemaining: retries
    });

    if (!tags || (Array.isArray(tags) && tags.length === 0) || (typeof tags === 'string' && !tags.trim())) {
        log('API', 'fetchImagesByTags: No valid tags provided.');
        console.log('[IMAGE DEBUG] fetchImagesByTags: No valid tags - returning empty array');
        return [];
    }

    // Generate a unique key for this request
    const requestKey = getImageRequestKey(tags);

    // Check for pending request with same key (deduplication)
    if (pendingImageRequests.has(requestKey)) {
        log('API', `Deduplicating image request for ${requestKey}`);
        try {
            return await pendingImageRequests.get(requestKey);
        } catch (e) {
            // If pending request fails, continue to make new request
        }
    }

    // Create the request promise
    const requestPromise = (async () => {
        try {
            let payload;
            if (Array.isArray(tags)) {
                const validTags = tags.map(t => String(t).trim()).filter(Boolean);
                if (validTags.length === 0) return [];
                // Cloudinary Search API uses tags:"value" syntax
                payload = { expression: validTags.map(tag => `tags:"${tag}"`).join(' AND ') };
                log('API', `Fetching images by expression: ${payload.expression}`);
            } else {
                const tagName = String(tags).trim();
                if (!tagName) return [];

                // Check if the tag string contains spaces (multiple keywords from AI)
                // If so, split and search using OR expression to find images matching ANY keyword
                const tagParts = tagName.split(/\s+/).filter(Boolean);
                if (tagParts.length > 1) {
                    // Multiple space-separated keywords - use OR expression for broader matching
                    // Cloudinary Search API uses tags:"value" syntax (with colon, not equals)
                    payload = { expression: tagParts.map(tag => `tags:"${tag}"`).join(' OR ') };
                    log('API', `Fetching images by multi-keyword expression: ${payload.expression}`);
                    console.log('[IMAGE DEBUG] Multi-keyword search - splitting tags:', {
                        original: tagName,
                        splitTags: tagParts,
                        expression: payload.expression
                    });
                } else {
                    // Single keyword - use direct tag lookup
                    payload = { tag: tagName };
                    log('API', `Fetching images by single tag: ${tagName}`);
                }
            }

            const response = await fetch('/.netlify/functions/cloudinary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.status === 429 && retries > 0) {
                log('API', `Cloudinary rate limit hit, retrying in 1000ms... (${retries} retries left)`);
                // Clean up deduplication before retry
                pendingImageRequests.delete(requestKey);
                await new Promise(res => setTimeout(res, 1000));
                return fetchImagesByTags(tags, retries - 1);
            }

            if (!response.ok) {
                console.warn(`Cloudinary proxy function error: ${response.status} ${response.statusText}`);
                try { console.warn('Cloudinary error body:', await response.text()); } catch (e) {}
                return [];
            }

            const data = await response.json();
            // === IMAGE DEBUG: Log Cloudinary response ===
            console.log('[IMAGE DEBUG] Cloudinary response data:', {
                hasResources: !!data.resources,
                resourceCount: data.resources ? data.resources.length : 0,
                fullResponse: JSON.stringify(data).substring(0, 500) + '...'
            });

            if (!data.resources || data.resources.length === 0) {
                 log('API', 'No Cloudinary resources found for the given tags/expression.');
                 console.log('[IMAGE DEBUG] No Cloudinary resources found - returning empty array');
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
    })();

    // Store the promise for deduplication
    pendingImageRequests.set(requestKey, requestPromise);

    try {
        return await requestPromise;
    } finally {
        // Clean up the pending request after completion
        pendingImageRequests.delete(requestKey);
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
// Enhanced fetchImagesForRecord with multi-tier fallback for AI items

// Track image loading status for real-time UI updates
export const imageLoadingStatus = new Map();

/**
 * Updates the image loading status for a record and dispatches a custom event
 * This allows the UI to show real-time progress
 */
function updateImageStatus(recordId, status, message) {
    const statusData = { status, message, timestamp: Date.now() };
    imageLoadingStatus.set(recordId, statusData);

    // Dispatch custom event that UI can listen for
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('imageLoadingStatus', {
            detail: { recordId, ...statusData }
        }));
    }

    console.log(`[IMAGE STATUS] ${recordId}: ${status} - ${message}`);
}

/**
 * Attempts to fetch an image by scraping a website for og:image/meta images
 * @param {string} websiteUrl - The URL to scrape
 * @param {string} businessName - The business name for fallback searches
 * @param {string} imageKeywords - Keywords to search for images
 * @returns {Promise<{success: boolean, imageUrl: string|null, source: string|null}>}
 */
async function fetchWebsiteImage(websiteUrl, businessName, imageKeywords) {
    if (!websiteUrl) {
        return { success: false, imageUrl: null, source: null };
    }

    try {
        const response = await fetch('/.netlify/functions/fetch-website-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ websiteUrl, businessName, imageKeywords })
        });

        if (!response.ok) {
            console.log('[IMAGE DEBUG] fetch-website-image returned error:', response.status);
            return { success: false, imageUrl: null, source: null };
        }

        const result = await response.json();
        return result;
    } catch (error) {
        console.log('[IMAGE DEBUG] fetchWebsiteImage error:', error.message);
        return { success: false, imageUrl: null, source: null };
    }
}

/**
 * Generates a deterministic placeholder URL based on the item name
 * Uses Cloudinary's text overlay on a colored background
 */
function getDeterministicPlaceholder(record) {
    const name = record.fields?.Name || 'Unknown Item';
    const keywords = record.fields?.[CONSTANTS.FIELD_NAMES.MEDIA_TAGS] || '';

    // Generate a color based on the name (for visual variety)
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = ((hash << 5) - hash) + name.charCodeAt(i);
        hash = hash & hash;
    }

    // Muted color palette for professional look
    const colors = ['2C3E50', '34495E', '7F8C8D', '95A5A6', '1ABC9C', '16A085', '2980B9', '8E44AD'];
    const bgColor = colors[Math.abs(hash) % colors.length];

    // Shortened name for overlay (first 20 chars)
    const shortName = name.length > 20 ? name.substring(0, 20) + '...' : name;
    const encodedName = encodeURIComponent(shortName);

    // Cloudinary placeholder with item name overlay
    const placeholderPublicID = 'ww71meppejsewxsxr4x7';
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/w_600,h_520,c_fill,b_rgb:${bgColor}/l_text:Arial_36_bold:${encodedName},co_rgb:FFFFFF,g_center/${placeholderPublicID}.jpg`;
}

export async function fetchImagesForRecord(record, allRecords, imageCache) {
    // === IMAGE DEBUG: Log entry to fetchImagesForRecord ===
    const isAIRecord = record?.id?.startsWith('ai-child-') || record?.id?.startsWith('ai-search-') || record?.isAI === true;
    console.log('[IMAGE DEBUG] fetchImagesForRecord CALLED for:', {
        recordId: record?.id,
        recordName: record?.fields?.Name,
        mediaTags: record?.fields?.['Media Tags'],
        mediaTagsType: typeof record?.fields?.['Media Tags'],
        curatedImages: record?.fields?.['Curated Images'],
        aiWebsite: record?.fields?.['_aiWebsite'],
        isAIRecord: isAIRecord
    });

    if (!record || !record.id) return { imageUrls: [], status: 'error' };

    const cacheKey = record.id;
    if (imageCache.has(cacheKey)) {
        return { imageUrls: imageCache.get(cacheKey), status: 'cached' };
    }

    let imageUrls = [];
    let imageSource = null;

    // ============================================================
    // STEP 1: For AI-sourced items, try website scraping first
    // ============================================================
    if (isAIRecord) {
        const websiteUrl = record.fields?.['_aiWebsite'];
        const businessName = record.fields?.Name;
        const imageKeywords = record.fields?.[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];

        if (websiteUrl) {
            updateImageStatus(record.id, 'trying_website', `Checking ${new URL(websiteUrl).hostname}...`);

            console.log('[IMAGE DEBUG] AI Record - trying website scrape:', {
                recordId: record.id,
                websiteUrl,
                businessName
            });

            const websiteResult = await fetchWebsiteImage(websiteUrl, businessName, imageKeywords);

            if (websiteResult.success && websiteResult.imageUrl) {
                imageUrls = [websiteResult.imageUrl];
                imageSource = websiteResult.source || 'website';
                updateImageStatus(record.id, 'found_website', `Found image from ${websiteResult.source}`);

                console.log('[IMAGE DEBUG] AI Record - website scrape SUCCESS:', {
                    recordId: record.id,
                    imageUrl: websiteResult.imageUrl,
                    source: websiteResult.source
                });
            } else {
                console.log('[IMAGE DEBUG] AI Record - website scrape FAILED:', {
                    recordId: record.id,
                    attempts: websiteResult.attempts
                });
                updateImageStatus(record.id, 'website_failed', 'No website image found, trying other sources...');
            }
        } else {
            updateImageStatus(record.id, 'no_website', 'No website URL available, trying catalog...');
        }
    }

    // ============================================================
    // STEP 2: Try Curated Images (linked from Airtable)
    // ============================================================
    if (!imageUrls || imageUrls.length === 0) {
        if (isAIRecord) {
            updateImageStatus(record.id, 'trying_curated', 'Checking curated images...');
        }

        imageUrls = await fetchCuratedImagesByRecord(record);
        console.log('[IMAGE DEBUG] Step 2 - Curated Images result:', {
            recordId: record.id,
            curatedImagesCount: imageUrls?.length || 0,
            curatedImagesUrls: imageUrls
        });

        if (imageUrls && imageUrls.length > 0) {
            imageSource = 'curated';
            if (isAIRecord) {
                updateImageStatus(record.id, 'found_curated', 'Using curated image');
            }
        }
    }

    // ============================================================
    // STEP 3: Try Media Tags (Cloudinary search)
    // ============================================================
    if (!imageUrls || imageUrls.length === 0) {
        log('API', `No curated images found for ${record.id}, falling back to Media Tags.`);
        const mediaTagsValue = record.fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS];

        if (isAIRecord && mediaTagsValue) {
            updateImageStatus(record.id, 'trying_tags', `Searching for "${mediaTagsValue}"...`);
        }

        console.log('[IMAGE DEBUG] Step 3 - About to call fetchImagesByTags with Media Tags:', {
            recordId: record.id,
            mediaTagsValue: mediaTagsValue,
            mediaTagsType: typeof mediaTagsValue,
            FIELD_NAME_USED: CONSTANTS.FIELD_NAMES.MEDIA_TAGS
        });

        imageUrls = await fetchImagesByTags(mediaTagsValue);

        console.log('[IMAGE DEBUG] Step 3 - fetchImagesByTags result:', {
            recordId: record.id,
            resultCount: imageUrls?.length || 0,
            resultUrls: imageUrls
        });

        if (imageUrls && imageUrls.length > 0) {
            imageSource = 'media_tags';
            if (isAIRecord) {
                updateImageStatus(record.id, 'found_tags', `Found ${imageUrls.length} matching image(s)`);
            }
        }
    }

    // ============================================================
    // STEP 4: Use deterministic placeholder as final fallback
    // ============================================================
    if (!imageUrls || imageUrls.length === 0) {
        log('API', `No images found for ${record.id} after all checks, using placeholder.`);

        if (isAIRecord) {
            updateImageStatus(record.id, 'using_placeholder', 'Using placeholder image');
        }

        imageUrls = [getDeterministicPlaceholder(record)];
        imageSource = 'placeholder';

        console.log('[IMAGE DEBUG] Step 4 - Using deterministic placeholder:', {
            recordId: record.id,
            placeholderUrl: imageUrls[0]
        });
    }

    console.log('[IMAGE DEBUG] fetchImagesForRecord COMPLETE:', {
        recordId: record.id,
        finalImageCount: imageUrls.length,
        imageSource: imageSource,
        finalImageUrls: imageUrls
    });

    imageCache.set(cacheKey, imageUrls);

    // Final status update
    if (isAIRecord) {
        updateImageStatus(record.id, 'complete', `Image loaded from ${imageSource}`);
    }

    return { imageUrls, status: imageSource };
}

export async function fetchChatMessages(sessionId) {
    if (!sessionId || !sessionId.startsWith('rec')) {
         log('API', 'fetchChatMessages: Invalid or missing sessionId.');
         return [];
    }
    // Fetch messages linked specifically to this Session record
    const formula = `FIND('${sessionId}', {SessionID_Rollup})`;
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
        log('API', `Error fetching chat messages: ${error.message}`);
        return [];
    }
}


/**
 * Event types for plan history tracking
 */
export const PLAN_EVENT_TYPES = {
    PLAN_CREATED: 'plan_created',
    AI_INTERPRETATION: 'ai_interpretation',
    PLAN_UPDATED: 'plan_updated',
    TASK_ADDED: 'task_added',
    ITEM_ADDED: 'item_added',
    COLLABORATOR_JOINED: 'collaborator_joined'
};

/**
 * Posts a plan event to the Messages table for history tracking.
 * Events are stored as system messages with EventType field to distinguish from chat messages.
 * @param {string} sessionId - The session/plan ID
 * @param {string} eventType - The type of event (from PLAN_EVENT_TYPES)
 * @param {object} eventData - Additional data about the event
 * @returns {Promise<object|null>} The created record or null on failure
 */
export async function postPlanEvent(sessionId, eventType, eventData = {}) {
    if (!sessionId || !sessionId.startsWith('rec')) {
        log('API', `postPlanEvent: Invalid sessionId provided: "${sessionId}"`);
        return null;
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;

    // Format the event content as JSON string for storage
    const eventContent = JSON.stringify({
        type: eventType,
        data: eventData,
        timestamp: new Date().toISOString()
    });

    const payload = {
        records: [{
            fields: {
                SessionID: [sessionId],
                SenderID: 'system',
                SenderName: 'System',
                Content: eventContent,
                EventType: eventType
            }
        }]
    };

    try {
        log('API', `Posting plan event: ${eventType} to session ${sessionId}`);
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
            // Don't throw - event logging is non-critical
            log('API', `Failed to post plan event: ${errorData?.error?.message || response.statusText}`);
            return null;
        }

        const result = await response.json();
        log('API', `Plan event saved: ${eventType} with record ID: ${result.records[0].id}`);
        return result.records[0];
    } catch (error) {
        log('API', `Error posting plan event: ${error.message}`);
        return null;
    }
}

export async function postChatMessage(sessionId, senderId, senderName, content) {
    if (!sessionId || !sessionId.startsWith('rec')) {
        log('API', `postChatMessage: Invalid sessionId provided: "${sessionId}". Cannot save message.`);
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


export async function banUser(userId) {
    log('API', `[MODERATION] Simulating API call to ban user: ${userId}`);
    state.session.bannedUsers.add(userId);
}

// --- ENHANCED CHAT FEATURES ---

/**
 * Updates a chat message content (for editing)
 * @param {string} messageId - The Airtable record ID of the message
 * @param {string} newContent - The new message content
 * @param {string} senderId - The ID of the user trying to edit (for verification)
 * @returns {Promise<object|null>} The updated record or null on failure
 */
export async function updateChatMessage(messageId, newContent, senderId) {
    console.log('[updateChatMessage DEBUG] ========== updateChatMessage CALLED ==========');
    console.log('[updateChatMessage DEBUG] messageId:', messageId);
    console.log('[updateChatMessage DEBUG] newContent:', newContent?.substring(0, 50));
    console.log('[updateChatMessage DEBUG] senderId:', senderId);

    if (!messageId || !messageId.startsWith('rec')) {
        log('API', `updateChatMessage: Invalid messageId provided: "${messageId}"`);
        console.log('[updateChatMessage DEBUG] ❌ Invalid messageId - aborting');
        return null;
    }
    if (!newContent || !newContent.trim()) {
        log('API', 'updateChatMessage: Attempted to save empty message.');
        console.log('[updateChatMessage DEBUG] ❌ Empty content - aborting');
        return null;
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}/${messageId}`;
    console.log('[updateChatMessage DEBUG] PATCH URL:', url);

    // Only update the Content field - IsEdited may not exist in all Airtable schemas
    // The field will still show as edited by comparing Content with original
    const payload = {
        fields: {
            Content: newContent.trim()
        }
    };
    console.log('[updateChatMessage DEBUG] Payload:', JSON.stringify(payload));

    try {
        log('API', `Updating message ${messageId}`);
        console.log('[updateChatMessage DEBUG] Sending PATCH request...');
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        console.log('[updateChatMessage DEBUG] Response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json();
            console.log('[updateChatMessage DEBUG] ❌ Error response:', JSON.stringify(errorData));
            log('API', `Failed to update message: ${errorData?.error?.message || response.statusText}`);
            return null;
        }

        const result = await response.json();
        console.log('[updateChatMessage DEBUG] ✅ Update successful:', result.id);
        log('API', `Message ${messageId} updated successfully`);
        return result;
    } catch (error) {
        console.log('[updateChatMessage DEBUG] ❌ Exception:', error.message);
        log('API', `Error updating message: ${error.message}`);
        return null;
    }
}

/**
 * Deletes a chat message (soft delete by marking as deleted)
 * @param {string} messageId - The Airtable record ID of the message
 * @param {string} senderId - The ID of the user trying to delete (for verification)
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function deleteChatMessage(messageId, senderId) {
    console.log('[deleteChatMessage DEBUG] ========== deleteChatMessage CALLED ==========');
    console.log('[deleteChatMessage DEBUG] messageId:', messageId);
    console.log('[deleteChatMessage DEBUG] senderId:', senderId);

    if (!messageId || !messageId.startsWith('rec')) {
        log('API', `deleteChatMessage: Invalid messageId provided: "${messageId}"`);
        console.log('[deleteChatMessage DEBUG] ❌ Invalid messageId - aborting');
        return false;
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}/${messageId}`;
    console.log('[deleteChatMessage DEBUG] DELETE URL:', url);

    // Try soft delete first - mark message as deleted
    // Note: We only use IsDeleted since DeletedAt may not exist in the schema
    const payload = {
        fields: {
            IsDeleted: true
        }
    };
    console.log('[deleteChatMessage DEBUG] Payload:', JSON.stringify(payload));

    try {
        log('API', `Soft-deleting message ${messageId}`);
        console.log('[deleteChatMessage DEBUG] Sending PATCH request...');
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        console.log('[deleteChatMessage DEBUG] Response status:', response.status);

        if (!response.ok) {
            const errorData = await response.json();
            console.log('[deleteChatMessage DEBUG] ❌ Error response:', JSON.stringify(errorData));

            // If IsDeleted field doesn't exist, try hard delete
            if (errorData?.error?.type === 'INVALID_REQUEST_UNKNOWN_FIELD_NAME') {
                console.log('[deleteChatMessage DEBUG] IsDeleted field not found, attempting hard DELETE...');
                const deleteResponse = await fetch(url, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`
                    }
                });
                console.log('[deleteChatMessage DEBUG] Hard delete response status:', deleteResponse.status);

                if (deleteResponse.ok) {
                    console.log('[deleteChatMessage DEBUG] ✅ Hard delete successful');
                    log('API', `Message ${messageId} hard-deleted successfully`);
                    return true;
                } else {
                    const deleteError = await deleteResponse.json();
                    console.log('[deleteChatMessage DEBUG] ❌ Hard delete failed:', JSON.stringify(deleteError));
                    return false;
                }
            }

            log('API', `Failed to delete message: ${errorData?.error?.message || response.statusText}`);
            return false;
        }

        console.log('[deleteChatMessage DEBUG] ✅ Soft delete successful');
        log('API', `Message ${messageId} deleted successfully`);
        return true;
    } catch (error) {
        console.log('[deleteChatMessage DEBUG] ❌ Exception:', error.message);
        log('API', `Error deleting message: ${error.message}`);
        return false;
    }
}

/**
 * Adds or removes a reaction to a message
 * @param {string} messageId - The Airtable record ID of the message
 * @param {string} userId - The user adding/removing the reaction
 * @param {string} emoji - The emoji reaction
 * @param {boolean} add - True to add, false to remove
 * @returns {Promise<object|null>} The updated reactions or null on failure
 */
export async function toggleMessageReaction(messageId, userId, emoji, add = true) {
    if (!messageId || !messageId.startsWith('rec')) {
        log('API', `toggleMessageReaction: Invalid messageId provided: "${messageId}"`);
        return null;
    }

    // First, fetch the current reactions
    const getUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}/${messageId}`;

    try {
        const getResponse = await fetch(getUrl, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (!getResponse.ok) {
            log('API', `Failed to fetch message for reactions`);
            return null;
        }

        const record = await getResponse.json();
        let reactions = {};

        // Parse existing reactions (stored as JSON string)
        if (record.fields.Reactions) {
            try {
                reactions = JSON.parse(record.fields.Reactions);
            } catch (e) {
                reactions = {};
            }
        }

        // Initialize emoji array if needed
        if (!reactions[emoji]) {
            reactions[emoji] = [];
        }

        // Add or remove user from the reaction
        const userIndex = reactions[emoji].indexOf(userId);
        if (add && userIndex === -1) {
            reactions[emoji].push(userId);
        } else if (!add && userIndex !== -1) {
            reactions[emoji].splice(userIndex, 1);
        }

        // Remove emoji key if no users
        if (reactions[emoji].length === 0) {
            delete reactions[emoji];
        }

        // Update the message with new reactions
        const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}/${messageId}`;
        const payload = {
            fields: {
                Reactions: JSON.stringify(reactions)
            }
        };

        const updateResponse = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!updateResponse.ok) {
            log('API', `Failed to update reactions`);
            return null;
        }

        log('API', `Reaction ${emoji} ${add ? 'added to' : 'removed from'} message ${messageId}`);
        return reactions;
    } catch (error) {
        log('API', `Error toggling reaction: ${error.message}`);
        return null;
    }
}

/**
 * Posts a reply to an existing message (threaded reply)
 * @param {string} parentMessageId - The ID of the message being replied to
 * @param {string} sessionId - The session ID (for session chat)
 * @param {string} itemId - The item ID (for item chat)
 * @param {string} senderId - The sender's user ID
 * @param {string} senderName - The sender's display name
 * @param {string} content - The reply content
 * @returns {Promise<object|null>} The created record or null on failure
 */
export async function postReplyMessage(parentMessageId, sessionId, itemId, senderId, senderName, content) {
    if (!parentMessageId || !parentMessageId.startsWith('rec')) {
        log('API', `postReplyMessage: Invalid parentMessageId: "${parentMessageId}"`);
        return null;
    }
    if (!content || !content.trim()) {
        log('API', 'postReplyMessage: Attempted to send empty reply.');
        return null;
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;

    const fields = {
        SenderID: senderId,
        SenderName: senderName,
        Content: content.trim(),
        ParentMessageID: parentMessageId
    };

    // Link to session or item
    if (sessionId && sessionId.startsWith('rec')) {
        fields.SessionID = [sessionId];
    }
    if (itemId && itemId.startsWith('rec')) {
        fields['Item Link'] = [itemId];
    }

    const payload = { records: [{ fields }] };

    try {
        log('API', `Posting reply to message ${parentMessageId}`);
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
            log('API', `Failed to post reply: ${errorData?.error?.message || response.statusText}`);
            return null;
        }

        const result = await response.json();
        log('API', `Reply posted successfully with ID: ${result.records[0].id}`);
        return result.records[0];
    } catch (error) {
        log('API', `Error posting reply: ${error.message}`);
        return null;
    }
}

/**
 * Fetches replies to a specific message
 * @param {string} parentMessageId - The ID of the parent message
 * @returns {Promise<Array>} Array of reply records
 */
export async function fetchMessageReplies(parentMessageId) {
    if (!parentMessageId || !parentMessageId.startsWith('rec')) {
        log('API', `fetchMessageReplies: Invalid parentMessageId: "${parentMessageId}"`);
        return [];
    }

    const formula = `{ParentMessageID} = '${parentMessageId}'`;
    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (!response.ok) {
            log('API', `Failed to fetch replies for message ${parentMessageId}`);
            return [];
        }

        const data = await response.json();
        log('API', `Fetched ${data.records.length} replies for message ${parentMessageId}`);
        return data.records;
    } catch (error) {
        log('API', `Error fetching replies: ${error.message}`);
        return [];
    }
}

// --- END ENHANCED CHAT FEATURES ---


// --- COMPONENT COMMENTS FEATURE ---
// Comments linked to specific plan components (items, header, etc.) within a session

/**
 * Comment types for different plan components
 */
export const COMPONENT_TYPES = {
    ITEM: 'item',           // Comment on a plan item
    HEADER: 'header',       // Comment on the plan header/details
    REACTIONS: 'reactions', // Comment on the reactions summary
    GENERAL: 'general'      // General plan comment
};

/**
 * Posts a comment to a specific plan component.
 * Item comments are identified by having BOTH SessionID AND Item Link fields populated.
 * Header/general comments use a [PLAN_COMMENT:type] prefix in the Content field.
 * @param {string} sessionId - The session/plan ID
 * @param {string} componentType - The type of component (from COMPONENT_TYPES)
 * @param {string} componentId - The ID of the component (e.g., item recordId)
 * @param {string} senderId - The user ID posting the comment
 * @param {string} senderName - Display name of the sender
 * @param {string} content - The comment content
 * @param {string} [parentCommentId] - Optional parent comment ID for replies
 * @returns {Promise<object|null>} The created record or null on failure
 */
export async function postComponentComment(sessionId, componentType, componentId, senderId, senderName, content, parentCommentId = null) {
    console.log('[ComponentComment DEBUG] ========== postComponentComment CALLED ==========');
    console.log('[ComponentComment DEBUG] Params:', { sessionId, componentType, componentId, senderId, senderName, contentLength: content?.length, parentCommentId });

    if (!sessionId || !sessionId.startsWith('rec')) {
        console.log('[ComponentComment DEBUG] ❌ Invalid sessionId:', sessionId);
        log('API', `postComponentComment: Invalid sessionId: "${sessionId}"`);
        return null;
    }
    if (!content || !content.trim()) {
        console.log('[ComponentComment DEBUG] ❌ Empty content provided');
        log('API', 'postComponentComment: Empty content provided.');
        return null;
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}`;

    // Build fields based on component type
    // Item comments: use SessionID + Item Link (both populated identifies as component comment)
    // Header/general comments: use SessionID + content prefix [PLAN_COMMENT:type]
    const fields = {
        SessionID: [sessionId],
        SenderID: senderId,
        SenderName: senderName
    };

    // Add parent comment ID if this is a reply
    if (parentCommentId && parentCommentId.startsWith('rec')) {
        fields.ParentMessageID = parentCommentId;
        console.log('[ComponentComment DEBUG] Adding ParentMessageID for reply:', parentCommentId);
    }

    if (componentType === COMPONENT_TYPES.ITEM && componentId && componentId.startsWith('rec')) {
        // Item comment: link to both session AND item
        // Having both SessionID and Item Link distinguishes from regular item chat (which has no SessionID)
        fields['Item Link'] = [componentId];
        fields.Content = content.trim();
        console.log('[ComponentComment DEBUG] Creating item comment with SessionID + Item Link');
    } else {
        // Header/general comment: prefix content to identify as plan comment
        fields.Content = `[PLAN_COMMENT:${componentType}] ${content.trim()}`;
        console.log('[ComponentComment DEBUG] Creating header/general comment with content prefix');
    }

    const payload = { records: [{ fields }] };
    console.log('[ComponentComment DEBUG] Payload fields:', JSON.stringify(fields, null, 2));
    console.log('[ComponentComment DEBUG] POST URL:', url);

    try {
        console.log('[ComponentComment DEBUG] Sending POST request...');
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log('[ComponentComment DEBUG] Response status:', response.status, response.statusText);

        if (!response.ok) {
            const errorData = await response.json();
            console.log('[ComponentComment DEBUG] ❌ Error response:', JSON.stringify(errorData, null, 2));
            log('API', `Failed to post component comment: ${errorData?.error?.message || response.statusText}`);
            return null;
        }

        const result = await response.json();
        const newRecord = result.records[0];
        console.log('[ComponentComment DEBUG] ✅ Comment saved with ID:', newRecord.id);
        log('API', `Component comment saved with ID: ${newRecord.id}`);

        // Trigger notifications for component comments
        if (newRecord.id) {
            const notificationPromises = [
                fetch('/api/send-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordId: newRecord.id })
                }).catch(err => console.error("SMS notification trigger failed:", err)),

                fetch('/api/send-email-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordId: newRecord.id })
                }).catch(err => console.error("Email notification trigger failed:", err))
            ];
            await Promise.allSettled(notificationPromises);
        }

        return newRecord;
    } catch (error) {
        console.log('[ComponentComment DEBUG] ❌ Exception:', error.message);
        log('API', `Error posting component comment: ${error.message}`);
        return null;
    }
}

/**
 * Fetches comments for a specific plan component.
 * Item comments are identified by having BOTH SessionID AND Item Link populated.
 * Header/general comments use Content prefix [PLAN_COMMENT:type].
 *
 * NOTE: For item comments, we fetch all comments with Item Link not empty for the session,
 * then filter client-side by componentId. This is because Airtable's {Item Link} & ""
 * returns the display name (primary field), not the record ID, making FIND() unreliable.
 *
 * @param {string} sessionId - The session/plan ID
 * @param {string} componentType - The type of component (from COMPONENT_TYPES)
 * @param {string} componentId - The ID of the component (optional for header/general)
 * @returns {Promise<Array>} Array of comment records sorted by timestamp
 */
export async function fetchComponentComments(sessionId, componentType, componentId = null) {
    console.log('[ComponentComment DEBUG] ========== fetchComponentComments CALLED ==========');
    console.log('[ComponentComment DEBUG] Params:', { sessionId, componentType, componentId });

    if (!sessionId || !sessionId.startsWith('rec')) {
        console.log('[ComponentComment DEBUG] ❌ Invalid sessionId:', sessionId);
        log('API', `fetchComponentComments: Invalid sessionId: "${sessionId}"`);
        return [];
    }

    let formula;
    let needsClientFilter = false;

    if (componentType === COMPONENT_TYPES.ITEM && componentId && componentId.startsWith('rec')) {
        // For item comments: fetch all with SessionID AND Item Link not empty
        // We'll filter by componentId client-side since {Item Link} & "" returns display names, not record IDs
        formula = `AND(FIND('${sessionId}', {SessionID_Rollup}), {Item Link} != '')`;
        needsClientFilter = true;
        console.log('[ComponentComment DEBUG] Fetching item comments with SessionID + Item Link (will filter client-side for componentId)');
    } else {
        // For header/general comments: filter by SessionID AND content prefix
        formula = `AND(FIND('${sessionId}', {SessionID_Rollup}), FIND('[PLAN_COMMENT:${componentType}]', {Content}))`;
        console.log('[ComponentComment DEBUG] Fetching header/general comments with content prefix');
    }

    console.log('[ComponentComment DEBUG] Filter formula:', formula);

    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;

    try {
        console.log('[ComponentComment DEBUG] Sending GET request...');
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        console.log('[ComponentComment DEBUG] Response status:', response.status, response.statusText);

        if (!response.ok) {
            const errorData = await response.json();
            console.log('[ComponentComment DEBUG] ❌ Error response:', JSON.stringify(errorData, null, 2));
            log('API', `Failed to fetch component comments for ${componentType}:${componentId}`);
            return [];
        }

        const data = await response.json();
        console.log('[ComponentComment DEBUG] ✅ Fetched records from Airtable:', data.records.length);

        // For item comments, filter client-side by componentId
        let filteredRecords = data.records;
        if (needsClientFilter && componentId) {
            filteredRecords = data.records.filter(record => {
                const itemLinks = record.fields['Item Link'];
                // Item Link is an array of record IDs
                return itemLinks && itemLinks.includes(componentId);
            });
            console.log('[ComponentComment DEBUG] ✅ After client-side filter for', componentId, ':', filteredRecords.length, 'records');
        }

        log('API', `Fetched ${filteredRecords.length} comments for ${componentType}:${componentId || 'all'}`);
        return filteredRecords;
    } catch (error) {
        console.log('[ComponentComment DEBUG] ❌ Exception:', error.message);
        log('API', `Error fetching component comments: ${error.message}`);
        return [];
    }
}

/**
 * Fetches all component comments for a session (for batch loading).
 * Component comments are identified by:
 * - Item comments: have both SessionID AND Item Link populated
 * - Header/general comments: have [PLAN_COMMENT:] prefix in Content
 * @param {string} sessionId - The session/plan ID
 * @returns {Promise<Array>} Array of all component comment records
 */
export async function fetchAllComponentComments(sessionId) {
    console.log('[ComponentComment DEBUG] ========== fetchAllComponentComments CALLED ==========');
    console.log('[ComponentComment DEBUG] sessionId:', sessionId);

    if (!sessionId || !sessionId.startsWith('rec')) {
        console.log('[ComponentComment DEBUG] ❌ Invalid sessionId:', sessionId);
        log('API', `fetchAllComponentComments: Invalid sessionId: "${sessionId}"`);
        return [];
    }

    // Fetch messages that are component comments:
    // - Have SessionID matching AND have an Item Link (item component comments)
    // - OR have SessionID AND content starts with [PLAN_COMMENT: (header/general comments)
    // We use OR to get both types in a single query
    const formula = `AND(FIND('${sessionId}', {SessionID_Rollup}), OR({Item Link} != '', FIND('[PLAN_COMMENT:', {Content}) > 0))`;
    console.log('[ComponentComment DEBUG] Filter formula:', formula);

    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=asc`;

    try {
        console.log('[ComponentComment DEBUG] Sending GET request for all comments...');
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        console.log('[ComponentComment DEBUG] Response status:', response.status, response.statusText);

        if (!response.ok) {
            const errorData = await response.json();
            console.log('[ComponentComment DEBUG] ❌ Error response:', JSON.stringify(errorData, null, 2));
            log('API', `Failed to fetch all component comments for session ${sessionId}`);
            return [];
        }

        const data = await response.json();
        console.log('[ComponentComment DEBUG] ✅ Total records fetched:', data.records.length);
        log('API', `Fetched ${data.records.length} total component comments for session ${sessionId}`);
        return data.records;
    } catch (error) {
        console.log('[ComponentComment DEBUG] ❌ Exception:', error.message);
        log('API', `Error fetching all component comments: ${error.message}`);
        return [];
    }
}

/**
 * Deletes a component comment (soft delete).
 * Uses the existing deleteChatMessage function.
 * @param {string} commentId - The comment record ID
 * @param {string} userId - The user attempting to delete
 * @returns {Promise<boolean>} Success status
 */
export async function deleteComponentComment(commentId, userId) {
    return await deleteChatMessage(commentId, userId);
}

/**
 * Updates a component comment.
 * Uses the existing updateChatMessage function.
 * @param {string} commentId - The comment record ID
 * @param {string} newContent - The new comment content
 * @param {string} userId - The user attempting to edit
 * @returns {Promise<object|null>} Updated record or null
 */
export async function updateComponentComment(commentId, newContent, userId) {
    return await updateChatMessage(commentId, newContent, userId);
}

/**
 * Adds a reaction to a component comment.
 * Uses the existing toggleMessageReaction function.
 * @param {string} commentId - The comment record ID
 * @param {string} userId - The user toggling the reaction
 * @param {string} emoji - The emoji to toggle
 * @param {boolean} add - Whether to add or remove the reaction
 * @returns {Promise<object|null>} Updated reactions or null
 */
export async function toggleComponentCommentReaction(commentId, userId, emoji, add) {
    return await toggleMessageReaction(commentId, userId, emoji, add);
}

// --- END COMPONENT COMMENTS FEATURE ---


export async function updateUserFlagStatus(userId, isFlagged) {
    log('API', `[MODERATION] Simulating API call to update flag for user: ${userId} to ${isFlagged}`);
    if (isFlagged) {
        state.session.flaggedUsers.add(userId);
    } else {
        state.session.flaggedUsers.delete(userId);
    }
}


export async function fetchRecentChats(userId, limit = 10) {
    if (!userId) {
        log('API', 'fetchRecentChats: No userId provided.');
        return [];
    }

    // Fetch messages where the user participated (either as sender or in conversations they're part of)
    const formula = `{SenderID} = '${userId}'`;
    const encodedFormula = encodeURIComponent(formula);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${ITEM_MESSAGES_TABLE_NAME}?filterByFormula=${encodedFormula}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=100`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Failed to fetch recent chats: ${errorData?.error?.message || response.statusText}`);
        }
        const data = await response.json();
        log('API', `Fetched ${data.records.length} messages for recent chats.`);

        // Group messages by conversation (SessionID or Item Link)
        const conversationsMap = new Map();

        for (const record of data.records) {
            const fields = record.fields;
            const sessionIds = fields.SessionID || [];
            const itemLinks = fields['Item Link'] || [];

            let conversationId = null;
            let conversationType = null;

            if (sessionIds.length > 0) {
                conversationId = sessionIds[0];
                conversationType = 'session';
            } else if (itemLinks.length > 0) {
                conversationId = itemLinks[0];
                conversationType = 'item';
            }

            if (conversationId && !conversationsMap.has(conversationId)) {
                conversationsMap.set(conversationId, {
                    id: conversationId,
                    type: conversationType,
                    lastMessage: fields.Content || '',
                    lastMessageTime: fields.Timestamp || new Date().toISOString(),
                    senderName: fields.SenderName || 'Unknown'
                });
            }
        }

        // Convert to array and limit results
        const recentChats = Array.from(conversationsMap.values()).slice(0, limit);

        // Fetch names for session/item conversations
        for (const chat of recentChats) {
            if (chat.type === 'session') {
                // Try to get session name
                try {
                    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${chat.id}`;
                    const sessionResponse = await fetch(sessionUrl, {
                        headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
                    });
                    if (sessionResponse.ok) {
                        const sessionData = await sessionResponse.json();
                        chat.name = sessionData.fields?.Name || 'Session Chat';
                    } else {
                        chat.name = 'Session Chat';
                    }
                } catch (e) {
                    chat.name = 'Session Chat';
                }
            } else if (chat.type === 'item') {
                // Try to get item name
                try {
                    const itemUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${chat.id}`;
                    const itemResponse = await fetch(itemUrl, {
                        headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
                    });
                    if (itemResponse.ok) {
                        const itemData = await itemResponse.json();
                        chat.name = itemData.fields?.Name || 'Item Chat';
                    } else {
                        chat.name = 'Item Chat';
                    }
                } catch (e) {
                    chat.name = 'Item Chat';
                }
            }
        }

        return recentChats;
    } catch (error) {
        console.error('Error fetching recent chats:', error);
        return [];
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
 * Publishes a Session as a reusable Package item (Decision 5 - Option B).
 * Creates a new Package item in the catalog with the session's locked items as included items
 * and the session's ideas as optional add-ons.
 *
 * @param {string} sessionId - The session record ID
 * @param {Object} packageData - Package metadata
 *   @param {string} packageData.Name - Package name
 *   @param {string} packageData.Description - Package description
 *   @param {number} packageData.Price - Base package price
 *   @param {number} packageData.Discount - Optional discount percentage
 *   @param {Array} packageData.Tiers - Optional tier configuration [{name, price}, ...]
 * @returns {Promise<Object>} The created package item record
 */
export async function publishSessionAsPackage(sessionId, packageData = {}) {
    console.log('[PACKAGE DEBUG] ========== publishSessionAsPackage CALLED ==========');
    console.log('[PACKAGE DEBUG] sessionId:', sessionId);
    console.log('[PACKAGE DEBUG] packageData:', JSON.stringify(packageData, null, 2));

    if (!sessionId) {
        console.error('[PACKAGE DEBUG] ERROR: No sessionId provided');
        throw new Error('Session ID is required to publish as package');
    }

    console.log('[PACKAGE DEBUG] Fetching session by ID...');
    const session = await fetchSessionById(sessionId);
    if (!session) {
        console.error('[PACKAGE DEBUG] ERROR: Session not found for ID:', sessionId);
        throw new Error('Session not found');
    }
    console.log('[PACKAGE DEBUG] Session found:', session.id);
    console.log('[PACKAGE DEBUG] Session fields keys:', Object.keys(session.fields || {}));

    log('API', `Publishing session ${sessionId} as Package`);

    // Parse session data to get locked items and ideas
    let sessionItems = { lockedInItems: {}, ideasItems: {} };
    try {
        const sessionDataString = session.fields['Items with Variations'];
        console.log('[PACKAGE DEBUG] Session Items with Variations raw:', sessionDataString ? sessionDataString.substring(0, 200) + '...' : 'null/empty');
        if (sessionDataString) {
            sessionItems = JSON.parse(sessionDataString);
            console.log('[PACKAGE DEBUG] Parsed sessionItems keys:', Object.keys(sessionItems));
        }
    } catch (e) {
        console.warn('[PACKAGE DEBUG] Could not parse session data:', e.message);
        console.warn('[API] Could not parse session data:', e);
    }

    // Build package contents from session
    const includedItems = [];
    for (const [id, info] of Object.entries(sessionItems.lockedInItems || {})) {
        includedItems.push({
            id,
            quantity: info.quantity || 1,
            options: info.selections || null,
            locked: true
        });
    }

    const addOnItems = [];
    for (const [id, info] of Object.entries(sessionItems.ideasItems || {})) {
        addOnItems.push({
            id,
            quantity: info.quantity || 1,
            options: info.selections || null
        });
    }

    const packageContents = {
        includedItems,
        addOnItems,
        tiers: packageData.Tiers || []
    };
    console.log('[PACKAGE DEBUG] Package contents built:', JSON.stringify(packageContents, null, 2));

    // Store package metadata in the session's Items with Variations field
    // This avoids needing new Airtable fields - we extend the existing session data
    // Handle case where Price might be undefined (user left it blank for free package)
    let metadataPrice = 0;
    if (packageData.Price !== undefined && packageData.Price !== null && packageData.Price !== '') {
        const parsedMetadataPrice = typeof packageData.Price === 'number' ? packageData.Price : parseFloat(packageData.Price);
        if (!isNaN(parsedMetadataPrice) && isFinite(parsedMetadataPrice)) {
            metadataPrice = parsedMetadataPrice;
        }
    }
    const updatedSessionData = {
        ...sessionItems,
        packageMetadata: {
            discount: packageData.Discount || 0,
            tiers: packageData.Tiers || [],
            price: metadataPrice,
            pricingType: packageData.PricingType || null
        }
    };
    console.log('[PACKAGE DEBUG] Updated session data with packageMetadata:', JSON.stringify(updatedSessionData.packageMetadata, null, 2));

    // Update session with package metadata
    const updateSessionDataUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
    console.log('[PACKAGE DEBUG] Updating session metadata at URL:', updateSessionDataUrl);
    const sessionUpdateResponse = await fetch(updateSessionDataUrl, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ fields: { 'Items with Variations': JSON.stringify(updatedSessionData) } })
    });
    console.log('[PACKAGE DEBUG] Session metadata update response status:', sessionUpdateResponse.status);
    if (!sessionUpdateResponse.ok) {
        const sessionUpdateError = await sessionUpdateResponse.text();
        console.error('[PACKAGE DEBUG] Session metadata update failed:', sessionUpdateError);
    } else {
        console.log('[PACKAGE DEBUG] Session metadata update successful');
    }

    // Build the package item fields - use only existing Airtable fields
    // Package contents are retrieved from LinkedSession at render time
    const itemFields = {
        'Name': packageData.Name || session.fields.Name || 'Untitled Package',
        'Description': packageData.Description || session.fields.Goals || '',
        'Item Type': 'Package',
        'Status': 'Available',
        'LinkedSession': [sessionId],
        'Categories': 'Packages'  // Add to "Packages" category for discoverability
    };

    // CRITICAL: Copy the Stores field from the session to the package
    // Without this, the package won't appear in the catalog (filtered by store)
    if (session.fields.Stores && session.fields.Stores.length > 0) {
        itemFields['Stores'] = session.fields.Stores;
        console.log('[PACKAGE DEBUG] Added Stores to itemFields from session:', session.fields.Stores);
    } else {
        console.warn('[PACKAGE DEBUG] WARNING: Session has no Stores field - package may not appear in catalog');
    }

    console.log('[PACKAGE DEBUG] Building package item fields for ITEMS TABLE');
    console.log('[PACKAGE DEBUG] itemFields:', JSON.stringify(itemFields, null, 2));
    console.log('[PACKAGE DEBUG] Target table ID (Items):', TABLE_ID);

    // Add price if provided - ensure it's a valid number and positive
    // Airtable Currency fields may reject invalid values, so we validate carefully
    const rawPrice = packageData.Price;
    console.log('[PACKAGE DEBUG] packageData.Price raw value:', rawPrice, 'type:', typeof rawPrice);

    // Only add Price field if we have a valid positive number
    // Skip if: undefined, null, NaN, negative, or non-numeric
    if (rawPrice !== undefined && rawPrice !== null && rawPrice !== '') {
        const priceValue = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice);
        console.log('[PACKAGE DEBUG] packageData.Price parsed:', priceValue, 'isNaN:', isNaN(priceValue));

        if (!isNaN(priceValue) && isFinite(priceValue) && priceValue >= 0) {
            itemFields['Price'] = priceValue;
            console.log('[PACKAGE DEBUG] Added Price to itemFields:', priceValue);
        } else {
            console.log('[PACKAGE DEBUG] Price not added - invalid value (NaN, infinite, or negative)');
        }
    } else {
        console.log('[PACKAGE DEBUG] Price not added - undefined, null, or empty');
    }

    // Add pricing type if provided
    if (packageData.PricingType) {
        itemFields['Pricing Type'] = packageData.PricingType;
        console.log('[PACKAGE DEBUG] Added Pricing Type to itemFields:', packageData.PricingType);
    }

    // Check if this session already has a linked package
    const existingPackageId = session.fields.LinkedPackage ? session.fields.LinkedPackage[0] : null;
    console.log('[PACKAGE DEBUG] session.fields.LinkedPackage:', session.fields.LinkedPackage);
    console.log('[PACKAGE DEBUG] existingPackageId:', existingPackageId);
    let itemRecord;

    if (existingPackageId) {
        // Update existing package
        console.log('[PACKAGE DEBUG] ========== UPDATING EXISTING PACKAGE ==========');
        const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${existingPackageId}`;
        console.log('[PACKAGE DEBUG] Update URL:', url);
        console.log('[PACKAGE DEBUG] Request body:', JSON.stringify({ fields: itemFields }, null, 2));

        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: itemFields })
        });
        console.log('[PACKAGE DEBUG] Update response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[PACKAGE DEBUG] Failed to update package:', errorText);
            console.error('Failed to update package:', errorText);
            throw new Error(`Failed to update package: ${errorText}`);
        }

        itemRecord = await response.json();
        console.log('[PACKAGE DEBUG] Updated package record:', JSON.stringify(itemRecord, null, 2));
        log('API', `Updated package ${existingPackageId} from session ${sessionId}`);
    } else {
        // Create new package
        console.log('[PACKAGE DEBUG] ========== CREATING NEW PACKAGE IN ITEMS TABLE ==========');
        const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;
        console.log('[PACKAGE DEBUG] Create URL:', url);
        console.log('[PACKAGE DEBUG] Request body:', JSON.stringify({ fields: itemFields }, null, 2));

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: itemFields })
        });
        console.log('[PACKAGE DEBUG] Create response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[PACKAGE DEBUG] Failed to create package:', errorText);
            console.error('Failed to create package:', errorText);
            throw new Error(`Failed to create package: ${errorText}`);
        }

        itemRecord = await response.json();
        console.log('[PACKAGE DEBUG] ========== PACKAGE CREATED SUCCESSFULLY IN ITEMS TABLE ==========');
        console.log('[PACKAGE DEBUG] New package record ID:', itemRecord.id);
        console.log('[PACKAGE DEBUG] New package record fields:', JSON.stringify(itemRecord.fields, null, 2));
        log('API', `Created package ${itemRecord.id} from session ${sessionId}`);

        // Update session with link to new package
        console.log('[PACKAGE DEBUG] Updating session with LinkedPackage reference...');
        const updateSessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
        console.log('[PACKAGE DEBUG] Session link update URL:', updateSessionUrl);
        console.log('[PACKAGE DEBUG] Session link update body:', JSON.stringify({ fields: { 'LinkedPackage': [itemRecord.id] } }));

        const sessionLinkResponse = await fetch(updateSessionUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: { 'LinkedPackage': [itemRecord.id] } })
        });
        console.log('[PACKAGE DEBUG] Session link update response status:', sessionLinkResponse.status);
        if (!sessionLinkResponse.ok) {
            const linkError = await sessionLinkResponse.text();
            console.error('[PACKAGE DEBUG] Session link update failed:', linkError);
        } else {
            console.log('[PACKAGE DEBUG] Session link update successful');
        }
    }

    console.log('[PACKAGE DEBUG] ========== publishSessionAsPackage COMPLETE ==========');
    console.log('[PACKAGE DEBUG] Returning itemRecord with ID:', itemRecord?.id);
    console.log('[PACKAGE DEBUG] Returning itemRecord fields:', JSON.stringify(itemRecord?.fields, null, 2));
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
 * Creates a new session from an existing event item that doesn't have a linked session.
 * This allows users with publish access to "adopt" unaffiliated events and manage them.
 * @param {string} eventId - The event/item record ID
 * @param {Object} eventRecord - The event record object
 * @param {string} storeId - The store ID to associate with the session
 * @param {string} userId - The user ID creating the session
 * @returns {Promise<Object>} The created session record
 */
export async function createSessionFromEvent(eventId, eventRecord, storeId, userId) {
    console.log('[DEBUG createSessionFromEvent] ========== START ==========');
    console.log('[DEBUG createSessionFromEvent] eventId:', eventId);
    console.log('[DEBUG createSessionFromEvent] eventRecord:', eventRecord);
    console.log('[DEBUG createSessionFromEvent] eventRecord.fields:', eventRecord?.fields);
    console.log('[DEBUG createSessionFromEvent] storeId:', storeId);
    console.log('[DEBUG createSessionFromEvent] userId:', userId);

    if (!eventId || !eventRecord) {
        throw new Error('Event ID and record are required');
    }

    const fields = eventRecord.fields || {};
    console.log('[DEBUG createSessionFromEvent] Event fields.Name:', fields.Name);
    console.log('[DEBUG createSessionFromEvent] Event fields.Description:', fields.Description);
    console.log('[DEBUG createSessionFromEvent] Event fields.Date:', fields.Date);

    // Format the date if available - needed for both eventDetails and the session Date field
    let formattedDate = null;
    let isoDate = null;
    if (fields.Date) {
        const dateValue = Array.isArray(fields.Date) ? fields.Date[0] : fields.Date;
        console.log('[DEBUG createSessionFromEvent] Raw date value:', dateValue);
        const dateObj = new Date(dateValue);
        console.log('[DEBUG createSessionFromEvent] Parsed dateObj:', dateObj);
        console.log('[DEBUG createSessionFromEvent] Is valid date?', !isNaN(dateObj.getTime()));
        if (!isNaN(dateObj.getTime())) {
            formattedDate = dateObj.toISOString().split('T')[0];
            isoDate = dateObj.toISOString();
            console.log('[DEBUG createSessionFromEvent] formattedDate for Airtable Date field:', formattedDate);
            console.log('[DEBUG createSessionFromEvent] isoDate for eventDetails:', isoDate);
        }
    } else {
        console.log('[DEBUG createSessionFromEvent] No Date field in event record');
    }

    // Build session data from event fields
    // CRITICAL: Use the correct keys that match CONSTANTS.DETAIL_TYPES
    // eventName (not 'Event Name'), goals (not 'Goals'), date (not 'Date')
    const sessionData = {
        ideasItems: {},
        lockedInItems: {},
        itemReactions: {},
        userProfiles: userId ? { [userId]: 'Event Manager' } : {},
        eventDetails: {
            'eventName': fields.Name || 'Untitled Event',
            'goals': fields.Description || '',
        },
        itemPositions: {}
    };

    // Add date to eventDetails if available (using ISO format for consistency)
    if (isoDate) {
        sessionData.eventDetails['date'] = isoDate;
        console.log('[DEBUG createSessionFromEvent] Added date to eventDetails:', isoDate);
    }

    console.log('[DEBUG createSessionFromEvent] sessionData.eventDetails:', sessionData.eventDetails);
    console.log('[DEBUG createSessionFromEvent] Full sessionData:', JSON.stringify(sessionData, null, 2));

    const sessionFields = {
        "Name": fields.Name || 'Untitled Event',
        "Items with Variations": JSON.stringify(sessionData, null, 2),
        "Collaborators": userId ? [userId] : [],
        "Goals": fields.Description || null,
        "Stores": storeId ? [storeId] : null,
        "LinkedItem": [eventId] // Link this session to the event
    };

    if (formattedDate) {
        sessionFields["Date"] = formattedDate;
    }

    console.log('[DEBUG createSessionFromEvent] sessionFields being sent to Airtable:', JSON.stringify(sessionFields, null, 2));
    console.log('[DEBUG createSessionFromEvent] Items with Variations JSON contains eventDetails:', sessionFields["Items with Variations"]);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}`;

    try {
        console.log('[DEBUG createSessionFromEvent] Sending POST request to create session...');
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ records: [{ fields: sessionFields }] })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG createSessionFromEvent] Failed to create session:', errorText);
            throw new Error(`Failed to create session: ${errorText}`);
        }

        const result = await response.json();
        const newSession = result.records[0];
        console.log('[DEBUG createSessionFromEvent] Session created successfully!');
        console.log('[DEBUG createSessionFromEvent] New session ID:', newSession.id);
        console.log('[DEBUG createSessionFromEvent] New session fields:', newSession.fields);

        log('API', `Created session ${newSession.id} from event ${eventId}`);

        // Update the event to link back to the new session
        const updateEventUrl = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${eventId}`;
        console.log('[DEBUG createSessionFromEvent] Updating event with LinkedSession reference...');
        await fetch(updateEventUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields: { 'LinkedSession': [newSession.id] } })
        });

        log('API', `Updated event ${eventId} with LinkedSession ${newSession.id}`);
        console.log('[DEBUG createSessionFromEvent] ========== END (SUCCESS) ==========');

        // Also update the user's associated sessions (async, don't block return)
        if (userId) {
            associateSessionWithUser(newSession.id, userId).catch(err => {
                console.error('[API] Failed to update user sessions list for event session:', err.message);
            });
        }

        return newSession;
    } catch (error) {
        console.error('[DEBUG createSessionFromEvent] Error creating session from event:', error);
        console.log('[DEBUG createSessionFromEvent] ========== END (ERROR) ==========');
        throw error;
    }
}

/**
 * Checks if the current user has publish permission for the active store
 * @returns {boolean} True if user has publish permission
 */
export function userHasPublishPermission() {
    const activeStore = state.stores.all.find(s => s.id === state.ui.activeShopId);
    const currentUser = state.session.user;

    if (!activeStore || !currentUser || !currentUser.id) {
        return false;
    }

    const allowedUsers = activeStore.fields.PublishPermission || [];
    return allowedUsers.includes(currentUser.id);
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

/**
 * Finds sessions that contain a specific item in their lockedInItems or ideasItems
 * This is used to show plan membership for event items that have been added to plans
 * @param {string} itemId - The item record ID to search for
 * @param {string} storeId - Optional store ID to filter sessions
 * @returns {Promise<Object|null>} The first matching session record if found, null otherwise
 */
export async function fetchSessionContainingItem(itemId, storeId = null) {
    if (!itemId) {
        return null;
    }

    log('API', `Searching for sessions containing item ${itemId}...`);

    // Build formula to fetch sessions - optionally filtered by store
    let formula;
    if (storeId) {
        formula = `FIND('${storeId}', ARRAYJOIN({Stores}))`;
    } else {
        formula = `TRUE()`; // Fetch all sessions if no store filter
    }
    const encodedFormula = encodeURIComponent(formula);

    // We need to fetch the "Items with Variations" field to search within the JSON
    const fieldsQuery = [
        'Name',
        'Items with Variations',
        'Stores',
        'Collaborators',
        'LinkedItem'
    ].map(field => `fields%5B%5D=${encodeURIComponent(field)}`).join('&');

    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}&${fieldsQuery}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error searching sessions for item:', errorText);
            return null;
        }

        const data = await response.json();

        if (data.records && data.records.length > 0) {
            // Search through each session's Items with Variations for the item ID
            for (const session of data.records) {
                const itemsWithVariations = session.fields['Items with Variations'];
                if (itemsWithVariations) {
                    try {
                        const sessionData = JSON.parse(itemsWithVariations);
                        const lockedInItems = sessionData.lockedInItems || {};
                        const ideasItems = sessionData.ideasItems || {};

                        // Check if itemId is in lockedInItems or ideasItems
                        if (lockedInItems[itemId] || ideasItems[itemId]) {
                            log('API', `Found item ${itemId} in session ${session.id} (${session.fields.Name})`);
                            return session;
                        }
                    } catch (e) {
                        console.warn('Could not parse Items with Variations for session:', session.id, e);
                    }
                }
            }
            log('API', `Item ${itemId} not found in any session's plan items`);
            return null;
        } else {
            return null;
        }
    } catch (error) {
        console.error("Error fetching sessions containing item:", error);
        return null;
    }
}

// ============================================================================
// PHASE 3: TASK MANAGEMENT API FUNCTIONS
// ============================================================================

/**
 * Task status constants
 */
export const TASK_STATUS = {
    PENDING: 'pending',
    IN_PROGRESS: 'in_progress',
    BLOCKED: 'blocked',
    COMPLETED: 'completed'
};

/**
 * Fetch all tasks for a specific project
 * @param {string} projectId - The project/session ID to fetch tasks for
 * @returns {Promise<Array>} - Array of task records
 */
export async function fetchTasks(projectId) {
    console.log('[API DEBUG] fetchTasks called with projectId:', projectId);

    if (!projectId) {
        console.warn('[API DEBUG] fetchTasks called without projectId, returning empty array');
        log('API', 'fetchTasks called without projectId');
        return [];
    }

    log('API', `Fetching tasks for project: ${projectId}`);

    // Filter tasks by the ProjectId field (linked to Sessions)
    const formula = `FIND('${projectId}', ARRAYJOIN({ProjectId}))`;
    const encodedFormula = encodeURIComponent(formula);

    // Request fields needed for task display
    // Note: Only request fields that exist in the Airtable Tasks table
    // SourceType, SourceCommentId, LinkedPlanItemId, AffiliatedTaskId are NOT stored in Airtable
    // Comment-to-task linking is tracked client-side via _commentTaskLinks in session data
    const fieldsQuery = [
        'Name',
        'Description',
        'Status',
        'DueDate',
        'Assignee',
        'ProjectId',
        'ParentTask',
        'Priority',
        'Order',
        'LinkedItem',
        'CreatedTime'
    ].map(field => `fields%5B%5D=${encodeURIComponent(field)}`).join('&');

    console.log('[TASK PERSISTENCE DEBUG] fetchTasks fields requested:', ['Name', 'Description', 'Status', 'DueDate', 'Assignee', 'ProjectId', 'ParentTask', 'Priority', 'Order', 'LinkedItem', 'CreatedTime']);

    // Sort by Order field first, then by DueDate
    const url = `https://api.airtable.com/v0/${BASE_ID}/${TASKS_TABLE_NAME}?filterByFormula=${encodedFormula}&${fieldsQuery}&sort%5B0%5D%5Bfield%5D=Order&sort%5B0%5D%5Bdirection%5D=asc&sort%5B1%5D%5Bfield%5D=DueDate&sort%5B1%5D%5Bdirection%5D=asc`;

    console.log('[API DEBUG] fetchTasks URL:', url.substring(0, 150) + '...');
    console.log('[API DEBUG] fetchTasks table name:', TASKS_TABLE_NAME);

    try {
        console.log('[API DEBUG] fetchTasks starting fetch request...');
        const fetchStart = performance.now();

        const response = await fetchWithTimeout(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        const fetchEnd = performance.now();
        console.log(`[API DEBUG] fetchTasks fetch completed in ${(fetchEnd - fetchStart).toFixed(2)}ms`);
        console.log('[API DEBUG] fetchTasks response status:', response.status, response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[API DEBUG] fetchTasks Airtable error response:', errorText);
            console.error('Airtable Error fetching tasks:', errorText);
            throw new Error(`Failed to fetch tasks from Airtable. Status: ${response.status}`);
        }

        const data = await response.json();
        console.log('[API DEBUG] fetchTasks response data:', {
            hasRecords: !!data.records,
            recordCount: data.records?.length ?? 0,
            offset: data.offset
        });

        // Enhanced persistence debugging
        console.log('[TASK PERSISTENCE DEBUG] ========== TASKS FETCHED FROM AIRTABLE ==========');
        console.log('[TASK PERSISTENCE DEBUG] Project ID:', projectId);
        console.log('[TASK PERSISTENCE DEBUG] Total tasks found:', data.records.length);
        if (data.records.length > 0) {
            console.log('[TASK PERSISTENCE DEBUG] Task IDs:', data.records.map(t => t.id));
            console.log('[TASK PERSISTENCE DEBUG] Task names:', data.records.map(t => t.fields?.Name));
        }
        console.log('[TASK PERSISTENCE DEBUG] ================================================');

        log('API', `Fetched ${data.records.length} tasks for project ${projectId}`);
        return data.records;
    } catch (error) {
        console.error('[API DEBUG] fetchTasks caught error:', error);
        console.error('[API DEBUG] fetchTasks error stack:', error?.stack);
        console.error("Error fetching tasks:", error);
        return [];
    }
}

/**
 * Create a new task
 * @param {string} projectId - The project/session ID to link the task to
 * @param {Object} taskData - Task data: { Name, Description, Status, DueDate, Assignee, ParentTask, Priority }
 * @returns {Promise<Object|null>} - The created task record or null if failed
 */
export async function createTask(projectId, taskData) {
    if (!projectId) {
        console.error('createTask called without projectId');
        return null;
    }

    if (!taskData.Name) {
        console.error('createTask called without Name');
        return null;
    }

    log('API', `Creating task for project: ${projectId}`, taskData);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${TASKS_TABLE_NAME}`;

    // Prepare the fields for creation
    const fields = {
        Name: taskData.Name,
        Status: taskData.Status || TASK_STATUS.PENDING,
        ProjectId: [projectId], // Link to the project (Sessions table)
    };

    // Add optional fields if provided
    if (taskData.Description) {
        fields.Description = taskData.Description;
    }
    if (taskData.DueDate) {
        fields.DueDate = taskData.DueDate;
    }
    if (taskData.Assignee) {
        fields.Assignee = taskData.Assignee;
    }
    if (taskData.ParentTask) {
        fields.ParentTask = [taskData.ParentTask]; // Link to parent task
    }
    if (taskData.Priority) {
        fields.Priority = taskData.Priority;
    }
    if (taskData.Order !== undefined) {
        fields.Order = taskData.Order;
    }
    // Only set LinkedItem if it's a valid Airtable record ID (starts with 'rec')
    // This prevents temporary AI-generated IDs from causing Airtable API errors
    if (taskData.LinkedItem && taskData.LinkedItem.startsWith('rec')) {
        fields.LinkedItem = [taskData.LinkedItem]; // Link to catalog item
    }
    // Note: SourceCommentId tracking is handled client-side only
    // The Tasks table in Airtable does not have this field

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error creating task:', errorText);
            throw new Error('Failed to create task in Airtable.');
        }

        const data = await response.json();
        log('API', `Created task: ${data.id}`);
        return data;
    } catch (error) {
        console.error("Error creating task:", error);
        return null;
    }
}

/**
 * Update an existing task
 * @param {string} taskId - The task record ID to update
 * @param {Object} taskData - Task data to update: { Name, Description, Status, DueDate, Assignee, Priority }
 * @returns {Promise<Object|null>} - The updated task record or null if failed
 */
export async function updateTask(taskId, taskData) {
    if (!taskId) {
        console.error('updateTask called without taskId');
        return null;
    }

    log('API', `Updating task: ${taskId}`, taskData);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${TASKS_TABLE_NAME}/${taskId}`;

    // Prepare the fields for update (only include fields that are provided)
    const fields = {};

    if (taskData.Name !== undefined) {
        fields.Name = taskData.Name;
    }
    if (taskData.Description !== undefined) {
        fields.Description = taskData.Description;
    }
    if (taskData.Status !== undefined) {
        fields.Status = taskData.Status;
    }
    if (taskData.DueDate !== undefined) {
        fields.DueDate = taskData.DueDate || null;
    }
    if (taskData.Assignee !== undefined) {
        fields.Assignee = taskData.Assignee || null;
    }
    if (taskData.ParentTask !== undefined) {
        fields.ParentTask = taskData.ParentTask ? [taskData.ParentTask] : null;
    }
    if (taskData.Priority !== undefined) {
        fields.Priority = taskData.Priority || null;
    }
    if (taskData.Order !== undefined) {
        fields.Order = taskData.Order;
    }
    // Only set LinkedItem if null (to clear) or a valid Airtable record ID (starts with 'rec')
    // This prevents temporary AI-generated IDs from causing Airtable API errors
    if (taskData.LinkedItem !== undefined) {
        if (taskData.LinkedItem === null || taskData.LinkedItem.startsWith('rec')) {
            fields.LinkedItem = taskData.LinkedItem ? [taskData.LinkedItem] : null;
        }
    }

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error updating task:', errorText);
            throw new Error('Failed to update task in Airtable.');
        }

        const data = await response.json();
        log('API', `Updated task: ${data.id}`);
        return data;
    } catch (error) {
        console.error("Error updating task:", error);
        return null;
    }
}

/**
 * Delete a task
 * @param {string} taskId - The task record ID to delete
 * @returns {Promise<boolean>} - True if deleted successfully, false otherwise
 */
export async function deleteTask(taskId) {
    if (!taskId) {
        console.error('deleteTask called without taskId');
        return false;
    }

    log('API', `Deleting task: ${taskId}`);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${TASKS_TABLE_NAME}/${taskId}`;

    try {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error deleting task:', errorText);
            throw new Error('Failed to delete task in Airtable.');
        }

        log('API', `Deleted task: ${taskId}`);
        return true;
    } catch (error) {
        console.error("Error deleting task:", error);
        return false;
    }
}

/**
 * Update task order for drag-and-drop reordering
 * Uses batch update to efficiently update multiple task orders
 * @param {Array} taskOrders - Array of { taskId, order } objects
 * @returns {Promise<boolean>} - True if all updates succeeded, false otherwise
 */
export async function updateTaskOrder(taskOrders) {
    if (!taskOrders || taskOrders.length === 0) {
        log('API', 'updateTaskOrder called with empty array');
        return true;
    }

    log('API', `Updating order for ${taskOrders.length} tasks`);

    // Airtable batch update supports up to 10 records at a time
    const batchSize = 10;
    const batches = [];

    for (let i = 0; i < taskOrders.length; i += batchSize) {
        batches.push(taskOrders.slice(i, i + batchSize));
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${TASKS_TABLE_NAME}`;

    try {
        for (const batch of batches) {
            const records = batch.map(({ taskId, order }) => ({
                id: taskId,
                fields: { Order: order }
            }));

            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ records })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('Airtable Error updating task orders:', errorText);
                throw new Error('Failed to update task orders in Airtable.');
            }
        }

        log('API', `Successfully updated order for ${taskOrders.length} tasks`);
        return true;
    } catch (error) {
        console.error("Error updating task orders:", error);
        return false;
    }
}

// =============================================================================
// PHASE 4: PERMISSIONS & SECURITY
// =============================================================================

const COLLABORATOR_PERMISSIONS_TABLE_NAME = 'Collaborator_Permissions';

/**
 * Permission role constants
 */
export const PERMISSION_ROLES = {
    OWNER: 'owner',
    EDITOR: 'editor',
    VIEWER: 'viewer'
};

/**
 * Fetch user's role/permission for a specific project
 * Queries the Collaborator_Permissions table first, then falls back to legacy Collaborators field
 *
 * @param {string} projectId - The project/session ID
 * @param {string} userId - The user ID to check permissions for
 * @returns {Promise<Object>} - { role: string, permissionRecord: Object|null }
 */
export async function fetchUserRole(projectId, userId) {
    console.log('[API DEBUG] fetchUserRole called with:', { projectId, userId });

    if (!projectId || !userId) {
        console.warn('[API DEBUG] fetchUserRole missing parameters:', { projectId, userId });
        log('API', 'fetchUserRole called without projectId or userId');
        return { role: null, permissionRecord: null };
    }

    log('API', `Fetching user role for project: ${projectId}, user: ${userId}`);

    try {
        // First, try to fetch from Collaborator_Permissions table
        const formula = `AND(FIND('${projectId}', ARRAYJOIN({ProjectId})), FIND('${userId}', ARRAYJOIN({UserId})))`;
        const encodedFormula = encodeURIComponent(formula);
        const url = `https://api.airtable.com/v0/${BASE_ID}/${COLLABORATOR_PERMISSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}&maxRecords=1`;

        console.log('[API DEBUG] fetchUserRole fetching from Collaborator_Permissions...');
        console.log('[API DEBUG] fetchUserRole table name:', COLLABORATOR_PERMISSIONS_TABLE_NAME);
        const fetchStart = performance.now();

        const response = await fetchWithTimeout(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        const fetchEnd = performance.now();
        console.log(`[API DEBUG] fetchUserRole fetch completed in ${(fetchEnd - fetchStart).toFixed(2)}ms`);
        console.log('[API DEBUG] fetchUserRole response status:', response.status, response.statusText);

        if (response.ok) {
            const data = await response.json();
            console.log('[API DEBUG] fetchUserRole response data:', {
                hasRecords: !!data.records,
                recordCount: data.records?.length ?? 0
            });

            if (data.records && data.records.length > 0) {
                const permRecord = data.records[0];
                const role = (permRecord.fields.Role || PERMISSION_ROLES.EDITOR).toLowerCase();
                console.log('[API DEBUG] fetchUserRole found permission record:', { role, permRecordId: permRecord.id });
                log('API', `Found permission record for user ${userId}: role = ${role}`);
                return { role, permissionRecord: permRecord };
            }
        } else {
            const errorText = await response.text();
            console.warn('[API DEBUG] fetchUserRole Collaborator_Permissions table error:', response.status, errorText);
        }

        // Fallback: Check legacy Collaborators field and ownership
        console.log('[API DEBUG] fetchUserRole no permission record found, falling back to legacy check');
        log('API', `No permission record found, falling back to legacy check`);
        return await fetchLegacyUserRole(projectId, userId);

    } catch (error) {
        console.error('[API DEBUG] fetchUserRole caught error:', error);
        console.error('[API DEBUG] fetchUserRole error stack:', error?.stack);
        console.error("Error fetching user role:", error);
        // On error, fall back to legacy check
        console.log('[API DEBUG] fetchUserRole falling back to legacy check after error');
        return await fetchLegacyUserRole(projectId, userId);
    }
}

/**
 * Legacy fallback to determine user role from Collaborators field and ownership
 * @param {string} projectId - The project/session ID
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} - { role: string, permissionRecord: null }
 */
async function fetchLegacyUserRole(projectId, userId) {
    console.log('[API DEBUG] fetchLegacyUserRole called with:', { projectId, userId });

    try {
        const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${projectId}`;
        console.log('[API DEBUG] fetchLegacyUserRole fetching session...');
        const fetchStart = performance.now();

        const response = await fetchWithTimeout(sessionUrl, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        const fetchEnd = performance.now();
        console.log(`[API DEBUG] fetchLegacyUserRole fetch completed in ${(fetchEnd - fetchStart).toFixed(2)}ms`);
        console.log('[API DEBUG] fetchLegacyUserRole response status:', response.status, response.statusText);

        if (!response.ok) {
            console.warn('[API DEBUG] fetchLegacyUserRole could not fetch session:', response.status);
            log('API', `Could not fetch session ${projectId} for legacy role check`);
            return { role: null, permissionRecord: null };
        }

        const session = await response.json();
        console.log('[API DEBUG] fetchLegacyUserRole session fields:', {
            hasCollaborators: !!session.fields.Collaborators,
            collaboratorsCount: session.fields.Collaborators?.length ?? 0,
            hasStores: !!session.fields.Stores
        });

        const collaborators = session.fields.Collaborators || [];
        const storeIds = session.fields.Stores || [];

        // Check if user is a collaborator
        const isCollaborator = collaborators.includes(userId);
        console.log('[API DEBUG] fetchLegacyUserRole isCollaborator:', isCollaborator);

        // Check if user owns the store linked to this session
        const isStoreOwner = state.session.user.isOwner;
        const ownedStoreId = state.session.user.ownedStoreId;
        const isOwnerOfSessionStore = isStoreOwner && ownedStoreId && storeIds.includes(ownedStoreId);
        console.log('[API DEBUG] fetchLegacyUserRole ownership check:', { isStoreOwner, ownedStoreId, isOwnerOfSessionStore });

        // Check if user was the first collaborator (original creator/owner)
        const isFirstCollaborator = collaborators.length > 0 && collaborators[0] === userId;
        console.log('[API DEBUG] fetchLegacyUserRole isFirstCollaborator:', isFirstCollaborator);

        if (isOwnerOfSessionStore || isFirstCollaborator) {
            console.log('[API DEBUG] fetchLegacyUserRole determined role: owner');
            log('API', `User ${userId} is owner of project ${projectId} (legacy)`);
            return { role: PERMISSION_ROLES.OWNER, permissionRecord: null };
        } else if (isCollaborator) {
            console.log('[API DEBUG] fetchLegacyUserRole determined role: editor');
            log('API', `User ${userId} is editor of project ${projectId} (legacy)`);
            return { role: PERMISSION_ROLES.EDITOR, permissionRecord: null };
        } else {
            console.log('[API DEBUG] fetchLegacyUserRole determined role: null (no access)');
            log('API', `User ${userId} has no access to project ${projectId}`);
            return { role: null, permissionRecord: null };
        }
    } catch (error) {
        console.error('[API DEBUG] fetchLegacyUserRole caught error:', error);
        console.error('[API DEBUG] fetchLegacyUserRole error stack:', error?.stack);
        console.error("Error in fetchLegacyUserRole:", error);
        return { role: null, permissionRecord: null };
    }
}

/**
 * Create a permission record in Collaborator_Permissions table
 * @param {string} projectId - The project/session ID
 * @param {string} userId - The user ID to grant permission to
 * @param {string} role - The role to assign (owner, editor, viewer)
 * @returns {Promise<Object|null>} - The created permission record or null
 */
export async function createPermissionRecord(projectId, userId, role = PERMISSION_ROLES.EDITOR) {
    if (!projectId || !userId) {
        console.error('createPermissionRecord called without projectId or userId');
        return null;
    }

    log('API', `Creating permission record: project=${projectId}, user=${userId}, role=${role}`);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${COLLABORATOR_PERMISSIONS_TABLE_NAME}`;

    const fields = {
        ProjectId: [projectId],
        UserId: [userId],
        Role: role.charAt(0).toUpperCase() + role.slice(1).toLowerCase() // Capitalize: "Editor"
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error creating permission record:', errorText);
            throw new Error('Failed to create permission record in Airtable.');
        }

        const data = await response.json();
        log('API', `Created permission record: ${data.id}`);
        return data;
    } catch (error) {
        console.error("Error creating permission record:", error);
        return null;
    }
}

/**
 * Update a permission record's role
 * @param {string} permissionId - The permission record ID
 * @param {string} newRole - The new role to assign
 * @returns {Promise<Object|null>} - The updated permission record or null
 */
export async function updatePermissionRole(permissionId, newRole) {
    if (!permissionId || !newRole) {
        console.error('updatePermissionRole called without permissionId or newRole');
        return null;
    }

    log('API', `Updating permission ${permissionId} to role: ${newRole}`);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${COLLABORATOR_PERMISSIONS_TABLE_NAME}/${permissionId}`;

    const fields = {
        Role: newRole.charAt(0).toUpperCase() + newRole.slice(1).toLowerCase()
    };

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error updating permission record:', errorText);
            throw new Error('Failed to update permission record in Airtable.');
        }

        const data = await response.json();
        log('API', `Updated permission record: ${data.id}`);
        return data;
    } catch (error) {
        console.error("Error updating permission record:", error);
        return null;
    }
}

/**
 * Delete a permission record
 * @param {string} permissionId - The permission record ID to delete
 * @returns {Promise<boolean>} - True if deleted successfully
 */
export async function deletePermissionRecord(permissionId) {
    if (!permissionId) {
        console.error('deletePermissionRecord called without permissionId');
        return false;
    }

    log('API', `Deleting permission record: ${permissionId}`);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${COLLABORATOR_PERMISSIONS_TABLE_NAME}/${permissionId}`;

    try {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error deleting permission record:', errorText);
            throw new Error('Failed to delete permission record in Airtable.');
        }

        log('API', `Deleted permission record: ${permissionId}`);
        return true;
    } catch (error) {
        console.error("Error deleting permission record:", error);
        return false;
    }
}

/**
 * Fetch all permission records for a project (for managing collaborators)
 * @param {string} projectId - The project/session ID
 * @returns {Promise<Array>} - Array of permission records
 */
export async function fetchProjectPermissions(projectId) {
    if (!projectId) {
        log('API', 'fetchProjectPermissions called without projectId');
        return [];
    }

    log('API', `Fetching all permissions for project: ${projectId}`);

    try {
        const formula = `FIND('${projectId}', ARRAYJOIN({ProjectId}))`;
        const encodedFormula = encodeURIComponent(formula);
        const url = `https://api.airtable.com/v0/${BASE_ID}/${COLLABORATOR_PERMISSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}`;

        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error fetching project permissions:', errorText);
            return [];
        }

        const data = await response.json();
        log('API', `Fetched ${data.records.length} permission records for project ${projectId}`);
        return data.records;
    } catch (error) {
        console.error("Error fetching project permissions:", error);
        return [];
    }
}

/**
 * Invite a user to a session with a specific role
 * Creates a permission record and adds user to legacy Collaborators field for backwards compatibility
 *
 * @param {string} sessionId - The session/project ID
 * @param {string} userId - The user ID to invite
 * @param {string} role - The role to assign (owner, editor, viewer)
 * @returns {Promise<Object|null>} - The created permission record or null
 */
export async function inviteUserToSession(sessionId, userId, role = PERMISSION_ROLES.EDITOR) {
    if (!sessionId || !userId) {
        console.error('inviteUserToSession called without sessionId or userId');
        return null;
    }

    log('API', `Inviting user ${userId} to session ${sessionId} with role: ${role}`);

    try {
        // 1. Create permission record in Collaborator_Permissions table
        const permRecord = await createPermissionRecord(sessionId, userId, role);

        // 2. Also add to legacy Collaborators field for backwards compatibility
        const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;
        const sessionResponse = await fetch(sessionUrl, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (sessionResponse.ok) {
            const session = await sessionResponse.json();
            const currentCollaborators = session.fields.Collaborators || [];

            if (!currentCollaborators.includes(userId)) {
                const updatedCollaborators = [...currentCollaborators, userId];
                await fetch(sessionUrl, {
                    method: 'PATCH',
                    headers: {
                        'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        fields: { Collaborators: updatedCollaborators }
                    })
                });
                log('API', `Added user ${userId} to session ${sessionId} collaborators`);
            }
        }

        return permRecord;
    } catch (error) {
        console.error("Error inviting user to session:", error);
        return null;
    }
}

/**
 * Helper function to check if user can edit (owner or editor)
 * @param {string} role - The user's role
 * @returns {boolean} - True if user can edit
 */
export function canEdit(role) {
    return role === PERMISSION_ROLES.OWNER || role === PERMISSION_ROLES.EDITOR;
}

/**
 * Helper function to check if user is owner
 * @param {string} role - The user's role
 * @returns {boolean} - True if user is owner
 */
export function isOwner(role) {
    return role === PERMISSION_ROLES.OWNER;
}

/**
 * Helper function to check if user is viewer (read-only)
 * @param {string} role - The user's role
 * @returns {boolean} - True if user is viewer
 */
export function isViewer(role) {
    return role === PERMISSION_ROLES.VIEWER;
}

// ==============================================
// SESSION MANAGEMENT (Archive, Delete, List)
// ==============================================

/**
 * Fetches all sessions for the current user
 * @param {string} userId - The user ID
 * @param {string} storeId - Optional store ID to filter by
 * @returns {Promise<Array>} Array of session records
 */
export async function fetchUserSessions(userId, storeId = null) {
    if (!userId) {
        log('API', 'Cannot fetch user sessions - no user ID provided');
        return [];
    }

    // Build formula to get sessions where user is a collaborator
    let formula = `FIND("${userId}", ARRAYJOIN({Collaborators}, ","))`;

    // Optionally filter by store
    if (storeId) {
        formula = `AND(${formula}, FIND("${storeId}", ARRAYJOIN({Stores}, ",")))`;
    }

    // Exclude archived sessions by default (if Archived field exists)
    formula = `AND(${formula}, OR({Archived} = FALSE(), {Archived} = BLANK()))`;

    const encodedFormula = encodeURIComponent(formula);

    // Fields to fetch for display
    const fieldsQuery = [
        'Name',
        'Date',
        'Goals',
        'Items with Variations',
        'Stores',
        'Collaborators',
        'Archived',
        'LinkedItem',
        'LinkedPackage'
    ].map(field => `fields%5B%5D=${encodeURIComponent(field)}`).join('&');

    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?filterByFormula=${encodedFormula}&${fieldsQuery}`;

    try {
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error fetching user sessions:', errorText);
            throw new Error('Failed to fetch user sessions');
        }

        const data = await response.json();

        // Sort by creation time, newest first
        data.records.sort((a, b) => new Date(b.createdTime) - new Date(a.createdTime));

        log('API', `Fetched ${data.records.length} sessions for user ${userId}`);
        return data.records;
    } catch (error) {
        console.error('Error fetching user sessions:', error);
        return [];
    }
}

/**
 * Archives a session (soft delete)
 * @param {string} sessionId - The session ID to archive
 * @returns {Promise<boolean>} True if successful
 */
export async function archiveSession(sessionId) {
    if (!sessionId) {
        log('API', 'Cannot archive session - no session ID provided');
        return false;
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fields: { Archived: true }
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error archiving session:', errorText);
            throw new Error('Failed to archive session');
        }

        log('API', `Successfully archived session ${sessionId}`);
        return true;
    } catch (error) {
        console.error('Error archiving session:', error);
        return false;
    }
}

/**
 * Archives multiple sessions (bulk soft delete)
 * @param {Array<string>} sessionIds - Array of session IDs to archive
 * @returns {Promise<{success: number, failed: number}>} Count of successful and failed operations
 */
export async function archiveSessionsBulk(sessionIds) {
    if (!sessionIds || sessionIds.length === 0) {
        return { success: 0, failed: 0 };
    }

    let success = 0;
    let failed = 0;

    // Airtable allows batching up to 10 records per request
    const batchSize = 10;

    for (let i = 0; i < sessionIds.length; i += batchSize) {
        const batch = sessionIds.slice(i, i + batchSize);
        const records = batch.map(id => ({
            id,
            fields: { Archived: true }
        }));

        const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}`;

        try {
            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ records })
            });

            if (response.ok) {
                success += batch.length;
            } else {
                const errorText = await response.text();
                console.error('Airtable Error archiving sessions batch:', errorText);
                failed += batch.length;
            }
        } catch (error) {
            console.error('Error archiving sessions batch:', error);
            failed += batch.length;
        }
    }

    log('API', `Bulk archive complete: ${success} succeeded, ${failed} failed`);
    return { success, failed };
}

/**
 * Permanently deletes a session
 * @param {string} sessionId - The session ID to delete
 * @returns {Promise<boolean>} True if successful
 */
export async function deleteSession(sessionId) {
    if (!sessionId) {
        log('API', 'Cannot delete session - no session ID provided');
        return false;
    }

    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}/${sessionId}`;

    try {
        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error deleting session:', errorText);
            throw new Error('Failed to delete session');
        }

        log('API', `Successfully deleted session ${sessionId}`);
        return true;
    } catch (error) {
        console.error('Error deleting session:', error);
        return false;
    }
}

/**
 * Permanently deletes multiple sessions (bulk delete)
 * @param {Array<string>} sessionIds - Array of session IDs to delete
 * @returns {Promise<{success: number, failed: number}>} Count of successful and failed operations
 */
export async function deleteSessionsBulk(sessionIds) {
    if (!sessionIds || sessionIds.length === 0) {
        return { success: 0, failed: 0 };
    }

    let success = 0;
    let failed = 0;

    // Airtable allows deleting up to 10 records per request
    const batchSize = 10;

    for (let i = 0; i < sessionIds.length; i += batchSize) {
        const batch = sessionIds.slice(i, i + batchSize);
        const recordsQuery = batch.map(id => `records[]=${id}`).join('&');
        const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}?${recordsQuery}`;

        try {
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`
                }
            });

            if (response.ok) {
                success += batch.length;
            } else {
                const errorText = await response.text();
                console.error('Airtable Error deleting sessions batch:', errorText);
                failed += batch.length;
            }
        } catch (error) {
            console.error('Error deleting sessions batch:', error);
            failed += batch.length;
        }
    }

    log('API', `Bulk delete complete: ${success} succeeded, ${failed} failed`);
    return { success, failed };
}

/**
 * Creates a new empty session and returns its ID
 * @param {string} storeId - The store ID to associate the session with
 * @param {string} userId - The user ID creating the session
 * @param {string} name - Optional name for the new session
 * @returns {Promise<string|null>} The new session ID or null if failed
 */
export async function createNewSession(storeId, userId, name = 'New Plan') {
    const sessionData = {
        ideasItems: {},
        lockedInItems: {},
        itemReactions: {},
        userProfiles: userId ? { [userId]: 'Planner' } : {},
        eventDetails: {
            eventName: name
        },
        itemPositions: {}
    };

    const sessionFields = {
        Name: name,
        'Items with Variations': JSON.stringify(sessionData, null, 2),
        Collaborators: userId ? [userId] : [],
        Stores: storeId ? [storeId] : null
    };

    const url = `https://api.airtable.com/v0/${BASE_ID}/${SESSIONS_TABLE_NAME}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ records: [{ fields: sessionFields }] })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error creating new session:', errorText);
            throw new Error('Failed to create new session');
        }

        const result = await response.json();
        const newSessionId = result.records[0].id;

        log('API', `Created new session ${newSessionId}`);

        // Also update the user's associated sessions (async, don't block return)
        if (userId) {
            associateSessionWithUser(newSessionId, userId).catch(err => {
                console.error('[API] Failed to update user sessions list for new session:', err.message);
            });
        }

        return newSessionId;
    } catch (error) {
        console.error('Error creating new session:', error);
        return null;
    }
}

/**
 * Update item options/variations in Airtable
 * @param {string} itemId - The item record ID to update
 * @param {string} optionsString - The new Options field value (multi-line string format)
 * @returns {Promise<Object|null>} - The updated item record or null if failed
 */
export async function updateItemOptions(itemId, optionsString) {
    if (!itemId) {
        console.error('updateItemOptions called without itemId');
        return null;
    }

    log('API', `Updating options for item: ${itemId}`);

    const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}/${itemId}`;

    const fields = {
        [CONSTANTS.FIELD_NAMES.OPTIONS]: optionsString
    };

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fields })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Airtable Error updating item options:', errorText);
            throw new Error(`Failed to update item options: ${errorText}`);
        }

        const result = await response.json();
        log('API', `Successfully updated options for item ${itemId}`);

        // Update the record in local state if present
        const localRecord = state.records.all.find(r => r.id === itemId);
        if (localRecord) {
            localRecord.fields[CONSTANTS.FIELD_NAMES.OPTIONS] = optionsString;
        }

        return result;
    } catch (error) {
        console.error('Error updating item options:', error);
        return null;
    }
}

/**
 * Generate top recommended options/variations for an item using AI
 * @param {Object} record - The item record to generate options for
 * @returns {Promise<Object>} - Object with success flag and generated options string
 */
export async function generateTopOptions(record) {
    if (!record || !record.fields) {
        console.error('generateTopOptions called without valid record');
        return { success: false, error: 'Invalid record' };
    }

    const itemData = {
        name: record.fields.Name || record.fields['Display Name'] || 'Unknown Item',
        description: record.fields.Description || '',
        category: record.fields.Category || record.fields['Item Type'] || '',
        price: record.fields.Price || record.fields['Base Price'] || null,
        pricingType: record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] || ''
    };

    log('API', `Generating top options for item: ${itemData.name}`);

    try {
        const response = await fetch('/.netlify/functions/generate-top-options', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(itemData)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error from generate-top-options function:', errorText);
            throw new Error(`Failed to generate options: ${errorText}`);
        }

        const result = await response.json();
        log('API', `Successfully generated options for ${itemData.name}`);
        return result;
    } catch (error) {
        console.error('Error generating top options:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Fetch Cloudinary image resources by tags with full metadata including public_id
 * This returns the full resource objects, not just URLs, enabling AI processing
 * @param {string|Array} tags - Single tag string or array of tags to search for
 * @param {number} retries - Number of retries on rate limit (default: 2)
 * @returns {Promise<Array>} - Array of image resource objects with public_id, secure_url, etc.
 */
export async function fetchImageResourcesByTags(tags, retries = 2) {
    console.log('[IMAGE DEBUG] fetchImageResourcesByTags CALLED with:', {
        tags: tags,
        tagsType: typeof tags,
        isArray: Array.isArray(tags),
        retriesRemaining: retries
    });

    if (!tags || (Array.isArray(tags) && tags.length === 0) || (typeof tags === 'string' && !tags.trim())) {
        log('API', 'fetchImageResourcesByTags: No valid tags provided.');
        return [];
    }

    try {
        let payload;
        if (Array.isArray(tags)) {
            const validTags = tags.map(t => String(t).trim()).filter(Boolean);
            if (validTags.length === 0) return [];
            payload = { expression: validTags.map(tag => `tags:"${tag}"`).join(' AND ') };
            log('API', `Fetching image resources by expression: ${payload.expression}`);
        } else {
            const tagName = String(tags).trim();
            if (!tagName) return [];

            const tagParts = tagName.split(/\s+/).filter(Boolean);
            if (tagParts.length > 1) {
                payload = { expression: tagParts.map(tag => `tags:"${tag}"`).join(' OR ') };
                log('API', `Fetching image resources by multi-keyword expression: ${payload.expression}`);
            } else {
                payload = { tag: tagName };
                log('API', `Fetching image resources by single tag: ${tagName}`);
            }
        }

        const response = await fetch('/.netlify/functions/cloudinary', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.status === 429 && retries > 0) {
            log('API', `Cloudinary rate limit hit, retrying in 1000ms... (${retries} retries left)`);
            await new Promise(res => setTimeout(res, 1000));
            return fetchImageResourcesByTags(tags, retries - 1);
        }

        if (!response.ok) {
            console.warn(`Cloudinary proxy function error: ${response.status} ${response.statusText}`);
            return [];
        }

        const data = await response.json();
        console.log('[IMAGE DEBUG] fetchImageResourcesByTags response:', {
            hasResources: !!data.resources,
            resourceCount: data.resources ? data.resources.length : 0
        });

        if (!data.resources || data.resources.length === 0) {
            log('API', 'No Cloudinary resources found for the given tags/expression.');
            return [];
        }

        // Return full resource objects with public_id, secure_url, format, etc.
        log('API', `Found ${data.resources.length} image resources from Cloudinary.`);
        return data.resources;

    } catch (error) {
        console.error('Failed to fetch image resources from Cloudinary via proxy:', error);
        return [];
    }
}

/**
 * Process a single image through the AI parsing function
 * Uses the same Gemini-based analysis as the AI Discovery parsing tool
 * @param {string} publicId - The Cloudinary public ID of the image to process
 * @returns {Promise<Object>} - Object with success flag and processing result
 */
export async function processImageWithAI(publicId) {
    if (!publicId || typeof publicId !== 'string') {
        console.error('processImageWithAI: Invalid publicId provided');
        return { success: false, error: 'Invalid publicId' };
    }

    log('API', `Processing image with AI: ${publicId}`);

    try {
        const response = await fetch('/.netlify/functions/process-image-ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicId })
        });

        const data = await response.json();

        if (response.ok) {
            log('API', `Successfully processed image with AI: ${publicId}`);
            return { success: true, data };
        } else {
            console.warn(`AI processing failed for ${publicId}:`, data.error);
            return { success: false, error: data.error || 'Unknown error' };
        }
    } catch (error) {
        console.error(`Error processing image ${publicId} with AI:`, error);
        return { success: false, error: error.message };
    }
}

/**
 * Process multiple images through AI parsing in sequence
 * Processes images one at a time to avoid overwhelming the AI service
 * @param {Array<string>} publicIds - Array of Cloudinary public IDs to process
 * @param {Function} onProgress - Optional callback for progress updates (index, total, result)
 * @returns {Promise<Object>} - Object with processed count, failed count, and results array
 */
export async function processImagesWithAI(publicIds, onProgress = null) {
    if (!Array.isArray(publicIds) || publicIds.length === 0) {
        return { processed: 0, failed: 0, results: [] };
    }

    log('API', `Processing ${publicIds.length} images with AI`);

    const results = [];
    let processed = 0;
    let failed = 0;

    for (let i = 0; i < publicIds.length; i++) {
        const publicId = publicIds[i];
        const result = await processImageWithAI(publicId);

        if (result.success) {
            processed++;
        } else {
            failed++;
        }

        results.push({ publicId, ...result });

        if (onProgress) {
            onProgress(i + 1, publicIds.length, result);
        }

        // Small delay between requests to avoid rate limiting
        if (i < publicIds.length - 1) {
            await new Promise(res => setTimeout(res, 500));
        }
    }

    log('API', `AI processing complete: ${processed} processed, ${failed} failed`);
    return { processed, failed, results };
}

/**
 * Scrape website and social media for photos
 * Extracts og:image, gallery images, structured data images, and other photos from the web
 * Used for AI-parsed items that don't have Cloudinary photos yet
 * @param {string} websiteUrl - The URL to scrape for photos
 * @param {string} businessName - The business name for fallback searches
 * @param {number} maxImages - Maximum number of images to return (default: 10)
 * @returns {Promise<Object>} - Object with success flag and array of image objects
 */
export async function scrapeWebsitePhotos(websiteUrl, businessName, maxImages = 10) {
    if (!websiteUrl) {
        console.log('[API] scrapeWebsitePhotos: No website URL provided');
        return { success: false, images: [], error: 'No website URL provided' };
    }

    log('API', `Scraping website for photos: ${websiteUrl}`);

    try {
        const response = await fetch('/.netlify/functions/scrape-website-photos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ websiteUrl, businessName, maxImages })
        });

        if (!response.ok) {
            console.warn(`[API] scrapeWebsitePhotos error: ${response.status} ${response.statusText}`);
            return { success: false, images: [], error: `HTTP ${response.status}` };
        }

        const result = await response.json();
        log('API', `Scraped ${result.images?.length || 0} photos from website`);
        return result;
    } catch (error) {
        console.error('[API] scrapeWebsitePhotos error:', error);
        return { success: false, images: [], error: error.message };
    }
}

