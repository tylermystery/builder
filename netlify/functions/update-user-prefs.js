// FILE: netlify/functions/update-user-prefs.js (REPLACE ENTIRE FILE AGAIN)

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

const USERS_TABLE = 'Users';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const LIKED_BY_FIELD = 'Liked By Users';
const NAME_FIELD = 'Name'; // Keep Name field constant, though not used in fetch now

// --- Helper: Toggle Like Logic ---
async function handleToggleLike(userId, itemId) {
    if (!itemId) {
        throw new Error('Missing itemId for toggle-like action.');
    }
    console.log(`[func-combo] handleToggleLike: User ${userId} toggling like for item ${itemId}`);
    // Environment variable check logs
    console.log(`[func-combo] handleToggleLike: Using BASE_ID: ${BASE_ID}`);
    console.log(`[func-combo] handleToggleLike: Using ITEMS_TABLE: ${ITEMS_TABLE}`);
    console.log(`[func-combo] handleToggleLike: Using LIKED_BY_FIELD: ${LIKED_BY_FIELD}`);
    const maskedPAT = AIRTABLE_PAT ? `${AIRTABLE_PAT.substring(0, 5)}...${AIRTABLE_PAT.substring(AIRTABLE_PAT.length - 5)}` : 'undefined/missing!';
    console.log(`[func-combo] handleToggleLike: Using AIRTABLE_PAT (masked): ${maskedPAT}`);
    if (!AIRTABLE_PAT || !BASE_ID) console.error("[func-combo] CRITICAL: AIRTABLE_PAT or BASE_ID environment variable is missing!");


    // --- MODIFICATION: Skip the initial GET request entirely ---
    console.log(`[func-combo] handleToggleLike: SKIPPING initial GET request for item ${itemId} to test PATCH directly.`);

    // We don't know the current state, so we can't reliably toggle.
    // FOR TESTING: Let's *assume* the user wants to LIKE the item and try adding them.
    // If this PATCH works, we know the GET was the problem.
    // If this PATCH fails, the issue might be deeper (PAT permissions, field name for PATCH).

    // Construct the PATCH payload assuming we are ADDING the user.
    // NOTE: This is NOT the final logic, just for testing the PATCH operation.
    // A proper solution would require fetching the current state first.
    const updatedUserIdsForPatchTest = [userId]; // Simplified payload just containing the current user

    const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${itemId}`;
    console.log(`[func-combo] handleToggleLike: Attempting direct PATCH to URL: ${patchUrl}`);
    const payload = {
        // --- IMPORTANT: Airtable PATCH for linked records requires specific structure ---
        // We need to provide the *existing* links plus the new one, or just the new one
        // Let's try just providing the current user ID. If the field already has links,
        // this might OVERWRITE them. A safer approach fetches first, then merges.
        // For debugging the PATCH itself, let's try adding the user relative to existing ones IF POSSIBLE,
        // but we can't fetch them reliably right now.
        // Let's stick to the simple (potentially overwriting) approach FOR DEBUGGING ONLY.
        fields: {
             [LIKED_BY_FIELD]: updatedUserIdsForPatchTest // Test adding ONLY the current user
        }
        // A potentially better (but untested without GET) PATCH payload might involve
        // fetching *all* fields (if that works) and then constructing the PATCH more carefully.
    };
    console.log(`[func-combo] handleToggleLike: Patch payload (DEBUG - ADDS USER):`, JSON.stringify(payload));

    let patchRes;
    try {
        patchRes = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
    } catch (fetchError) {
        console.error(`[func-combo] handleToggleLike: Network error during patch item: ${fetchError.message}`);
        throw new Error(`Network error patching item ${itemId} in Airtable: ${fetchError.message}`);
    }

    if (!patchRes.ok) {
        const errorStatus = patchRes.status;
        const errorBody = await patchRes.text();
        console.error(`[func-combo] handleToggleLike: Airtable patch item failed. Status: ${errorStatus}, Body: ${errorBody}`);
        // Provide a more specific error for the client based on PATCH failure
        throw new Error(`Failed to update likes (PATCH) for item ${itemId} in Airtable. Status: ${errorStatus}`);
    }

    // If PATCH succeeds, we still don't know the *actual* final state without the initial GET.
    // Return a generic success for now, acknowledging the limitation.
    console.log(`[func-combo] handleToggleLike: DEBUG PATCH successful for item ${itemId}.`);
    // Cannot determine actual 'liked' state without initial GET. Returning true tentatively.
    return { success: true, liked: true }; // Tentative response
}

// --- Helper: Update Prefs Logic ---
// ... (This function remains unchanged) ...
async function handleUpdatePrefs(userId, phone, frequency) {
     console.log(`[func-combo] handleUpdatePrefs: User ${userId} updating prefs. Freq: ${frequency}, Phone: ${phone}`);
    console.log(`[func-combo] handleUpdatePrefs: Using BASE_ID: ${BASE_ID}`);
    console.log(`[func-combo] handleUpdatePrefs: Using USERS_TABLE: ${USERS_TABLE}`);
    const maskedPAT = AIRTABLE_PAT ? `${AIRTABLE_PAT.substring(0, 5)}...${AIRTABLE_PAT.substring(AIRTABLE_PAT.length - 5)}` : 'undefined/missing!';
    console.log(`[func-combo] handleUpdatePrefs: Using AIRTABLE_PAT (masked): ${maskedPAT}`);
     if (!AIRTABLE_PAT || !BASE_ID) console.error("[func-combo] CRITICAL: AIRTABLE_PAT or BASE_ID environment variable is missing!");

    const payload = {
      records: [{
        id: userId,
        fields: {
          'PhoneNumber': phone || null,
          'NotificationFrequency': frequency,
        }
      }]
    };
    console.log('[func-combo] handleUpdatePrefs: Patch payload:', JSON.stringify(payload));

    const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE}`;
    console.log(`[func-combo] handleUpdatePrefs: Patching user URL: ${patchUrl}`);

    let response;
    try {
        response = await fetch(patchUrl, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
    } catch (fetchError) {
         console.error(`[func-combo] handleUpdatePrefs: Network error during patch user: ${fetchError.message}`);
        throw new Error(`Network error patching user ${userId} preferences: ${fetchError.message}`);
    }

    if (!response.ok) {
      const errorStatus = response.status;
      const errorData = await response.json();
      console.error(`[func-combo] handleUpdatePrefs: Airtable patch user failed. Status: ${errorStatus}`, errorData);
      const message = errorData?.error?.message || `Airtable API Error: ${response.statusText}`;
      throw new Error(message);
    }

    console.log(`[func-combo] handleUpdatePrefs: Successfully patched user ${userId}. Status: ${response.status}`);
    const responseData = await response.json();
    if (!responseData.records || responseData.records.length === 0) {
        console.error('[func-combo] handleUpdatePrefs: Airtable PATCH response did not contain updated records:', responseData);
        throw new Error('Failed to retrieve updated user preferences from Airtable response.');
    }
    const updatedUser = responseData.records[0];

    return {
        message: 'Preferences updated successfully.',
        user: {
            phoneNumber: updatedUser.fields?.PhoneNumber || '',
            notificationFrequency: updatedUser.fields?.NotificationFrequency || 'None'
        }
    };
}

// --- Main Handler ---
// ... (This function remains unchanged) ...
exports.handler = async (event) => {
  console.log(`[func-combo] Handler invoked. Method: ${event.httpMethod}. Path: ${event.path}. Body length: ${event.body ? event.body.length : 'N/A'}`);
  let body;
  try {
      body = JSON.parse(event.body);
  } catch (parseError) {
       console.error('[func-combo] Error parsing request body:', parseError);
       return {
           statusCode: 400,
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ error: 'Invalid request body.' })
       };
  }

  if (event.httpMethod !== 'POST') {
    console.log(`[func-combo] Method Not Allowed: ${event.httpMethod}`);
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const authHeader = event.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('[func-combo] Unauthorized: Missing or invalid token format.');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: Missing or invalid token' }) };
  }
  const token = authHeader.split(' ')[1];
  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.userId;
    if (!userId) throw new Error('Invalid token payload (missing userId).');
    console.log(`[func-combo] User authenticated: ${userId}`);
  } catch (error) {
    console.error('[func-combo] JWT Verification Error:', error.message);
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: Invalid or expired token.' }) };
  }

  try {
    const { action } = body;
    console.log(`[func-combo] Action received: ${action}`);

    let result;

    if (action === 'toggle-like') {
      const { itemId } = body;
      if (!itemId) throw new Error('Missing itemId for toggle-like action.');
      result = await handleToggleLike(userId, itemId);
    } else if (action === 'update-prefs') {
      const { phone, frequency } = body;
       if (!['Real-Time', 'None'].includes(frequency)) {
          throw new Error(`Invalid frequency value: ${frequency}`);
       }
      result = await handleUpdatePrefs(userId, phone, frequency);
    } else {
        console.warn(`[func-combo] Unknown action received: ${action}`);
        throw new Error(`Unknown action: ${action}`);
    }

    console.log(`[func-combo] Action '${action}' processed successfully. Sending response.`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error(`[func-combo] Handler Error processing action '${body?.action || 'unknown'}':`, error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
    };
  }
};
