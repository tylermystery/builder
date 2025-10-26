// FILE: netlify/functions/update-user-prefs.js (REPLACE ENTIRE FILE)

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

const USERS_TABLE = 'Users';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const LIKED_BY_FIELD = 'Liked By Users';

async function handleToggleLike(userId, itemId) {
    if (!itemId) {
        throw new Error('Missing itemId for toggle-like action.');
    }
    console.log(`[func-combo] handleToggleLike: User ${userId} toggling like for item ${itemId}`);
    console.log(`[func-combo] handleToggleLike: Using BASE_ID: ${BASE_ID}`);
    console.log(`[func-combo] handleToggleLike: Using ITEMS_TABLE: ${ITEMS_TABLE}`);
    console.log(`[func-combo] handleToggleLike: Using LIKED_BY_FIELD: ${LIKED_BY_FIELD}`);
    const maskedPAT = AIRTABLE_PAT ? `${AIRTABLE_PAT.substring(0, 5)}...${AIRTABLE_PAT.substring(AIRTABLE_PAT.length - 5)}` : 'undefined/missing!';
    console.log(`[func-combo] handleToggleLike: Using AIRTABLE_PAT (masked): ${maskedPAT}`);
    if (!AIRTABLE_PAT || !BASE_ID) console.error("[func-combo] CRITICAL: AIRTABLE_PAT or BASE_ID environment variable is missing!");

    // --- TEMPORARY DEBUGGING: Remove fields[] parameter ---
    // const getItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${itemId}?fields[]=${encodeURIComponent(LIKED_BY_FIELD)}`;
    const getItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${itemId}`; // Simpler GET request
    console.log(`[func-combo] handleToggleLike: Fetching item URL (DEBUG - NO FIELDS): ${getItemUrl}`);
    // --- END TEMPORARY DEBUGGING ---

    let itemRes;
    try {
        itemRes = await fetch(getItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    } catch (fetchError) {
        console.error(`[func-combo] handleToggleLike: Network error during fetch item: ${fetchError.message}`);
        throw new Error(`Network error fetching item ${itemId} from Airtable: ${fetchError.message}`);
    }

    if (!itemRes.ok) {
        const errorStatus = itemRes.status;
        const errorBody = await itemRes.text();
        console.error(`[func-combo] handleToggleLike: Airtable fetch item failed. Status: ${errorStatus}, Body: ${errorBody}`);
        throw new Error(`Failed to fetch item ${itemId} from Airtable. Status: ${errorStatus}`);
    }

    // --- If the above fetch works, the 422 error was related to fields[] or LIKED_BY_FIELD ---
    // --- We still need the field data to proceed, so log success and throw for now ---
    console.log(`[func-combo] handleToggleLike: DEBUG fetch SUCCESSFUL (Status: ${itemRes.status}). The issue is likely with the 'fields[]=${encodeURIComponent(LIKED_BY_FIELD)}' parameter or the field name itself.`);
    // Since we didn't fetch the specific field, we can't proceed with the logic yet.
    // Throw an error to indicate debugging step. Re-enable fields[] param once 422 is understood.
    throw new Error(`DEBUG: Basic fetch for item ${itemId} succeeded. Re-check 'Liked By Users' field name/param.`);

    /* --- ORIGINAL LOGIC (Commented out for DEBUG) ---
    console.log(`[func-combo] handleToggleLike: Successfully fetched item ${itemId}. Status: ${itemRes.status}`);
    const itemRecord = await itemRes.json();
    const likedUserIds = itemRecord.fields?.[LIKED_BY_FIELD] || [];
    const userIndex = likedUserIds.indexOf(userId);
    let updatedUserIds;
    let liked = false;

    if (userIndex > -1) {
        updatedUserIds = likedUserIds.filter(id => id !== userId);
        liked = false;
        console.log(`[func-combo] handleToggleLike: User ${userId} unliking item ${itemId}.`);
    } else {
        updatedUserIds = [...likedUserIds, userId];
        liked = true;
        console.log(`[func-combo] handleToggleLike: User ${userId} liking item ${itemId}.`);
    }

    const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${itemId}`;
    console.log(`[func-combo] handleToggleLike: Patching item URL: ${patchUrl}`);
    const payload = { fields: { [LIKED_BY_FIELD]: updatedUserIds } };
    console.log(`[func-combo] handleToggleLike: Patch payload:`, JSON.stringify(payload));

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
        throw new Error(`Failed to update likes for item ${itemId} in Airtable. Status: ${errorStatus}`);
    }

    console.log(`[func-combo] handleToggleLike: Successfully patched likes for item ${itemId}. New status: ${liked ? 'Liked' : 'Unliked'}`);

    return { success: true, liked: liked };
    --- END ORIGINAL LOGIC --- */
}

async function handleUpdatePrefs(userId, phone, frequency) {
    // ... (This function remains unchanged from the previous version) ...
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
exports.handler = async (event) => {
  console.log(`[func-combo] Handler invoked. Method: ${event.httpMethod}. Path: ${event.path}. Body length: ${event.body ? event.body.length : 'N/A'}`);
  // --- FIX 1: Define body outside the try block ---
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
  // --- END FIX 1 ---

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
    // Body is already parsed above
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
    // Now 'body' is accessible here
    console.error(`[func-combo] Handler Error processing action '${body?.action || 'unknown'}':`, error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
    };
  }
};
