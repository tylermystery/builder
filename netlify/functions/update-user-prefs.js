// REPLACE THE ENTIRE CONTENTS of netlify/functions/update-user-prefs.js with this:

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

const USERS_TABLE = 'Users';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const LIKED_BY_FIELD = 'Liked By Users';
const NAME_FIELD = 'Name';

// --- Helper: Toggle Like Logic ---
async function handleToggleLike(userId, itemId) {
    if (!itemId) {
        throw new Error('Missing itemId for toggle-like action.');
    }
    console.log(`[func-combo] handleToggleLike: User ${userId} toggling like for item ${itemId}`);
    // Environment variable check logs (kept for safety)
    console.log(`[func-combo] handleToggleLike: Using BASE_ID: ${BASE_ID}`);
    console.log(`[func-combo] handleToggleLike: Using ITEMS_TABLE: ${ITEMS_TABLE}`);
    console.log(`[func-combo] handleToggleLike: Using LIKED_BY_FIELD: ${LIKED_BY_FIELD}`);
    const maskedPAT = AIRTABLE_PAT ? `${AIRTABLE_PAT.substring(0, 5)}...${AIRTABLE_PAT.substring(AIRTABLE_PAT.length - 5)}` : 'undefined/missing!';
    console.log(`[func-combo] handleToggleLike: Using AIRTABLE_PAT (masked): ${maskedPAT}`);
    if (!AIRTABLE_PAT || !BASE_ID) console.error("[func-combo] CRITICAL: AIRTABLE_PAT or BASE_ID environment variable is missing!");

    // --- FIX: Fetch the full item record (no fields[] parameter) ---
    const getItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${itemId}`;
    console.log(`[func-combo] handleToggleLike: Fetching item URL (all fields): ${getItemUrl}`);
    // --- END FIX ---

    let itemRes;
    try {
        itemRes = await fetch(getItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    } catch (fetchError) {
        console.error(`[func-combo] handleToggleLike: Network error during fetch item: ${fetchError.message}`);
        throw new Error(`Network error fetching item ${itemId} from Airtable: ${fetchError.message}`);
    }

    if (!itemRes.ok) {
        const errorStatus = itemRes.status;
        const errorBody = await itemRes.text(); // Log full body for unexpected errors
        console.error(`[func-combo] handleToggleLike: Airtable fetch item failed. Status: ${errorStatus}, Body: ${errorBody}`);
        throw new Error(`Failed to fetch item ${itemId} from Airtable. Status: ${errorStatus}`);
    }

    // --- Restore Original Logic ---
    console.log(`[func-combo] handleToggleLike: Successfully fetched item ${itemId}. Status: ${itemRes.status}`);
    const itemRecord = await itemRes.json();
    // Safely access the field from the full record, defaulting to an empty array
    const likedUserIds = itemRecord.fields?.[LIKED_BY_FIELD] || [];
    console.log(`[func-combo] handleToggleLike: Current likedUserIds for item ${itemId}:`, likedUserIds); // Log current likes
    const userIndex = likedUserIds.indexOf(userId);
    let updatedUserIds;
    let liked = false;

    if (userIndex > -1) {
        // User already liked it, remove them (unlike)
        updatedUserIds = likedUserIds.filter(id => id !== userId);
        liked = false;
        console.log(`[func-combo] handleToggleLike: User ${userId} unliking item ${itemId}.`);
    } else {
        // User hasn't liked it, add them (like)
        updatedUserIds = [...likedUserIds, userId];
        liked = true;
        console.log(`[func-combo] handleToggleLike: User ${userId} liking item ${itemId}.`);
    }
    console.log(`[func-combo] handleToggleLike: New updatedUserIds for item ${itemId}:`, updatedUserIds); // Log the list to be patched

    // 3. Update the Item record
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
    
    // --- VERIFICATION: Re-fetch the item to confirm the patch was applied ---
    console.log(`[func-combo] handleToggleLike: Verifying patch by re-fetching item ${itemId}...`);
    const verifyRes = await fetch(getItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (verifyRes.ok) {
        const verifiedRecord = await verifyRes.json();
        const verifiedLikes = verifiedRecord.fields?.[LIKED_BY_FIELD] || [];
        console.log(`[func-combo] handleToggleLike: VERIFICATION - ${LIKED_BY_FIELD} field after patch:`, verifiedLikes);
        console.log(`[func-combo] handleToggleLike: VERIFICATION - Does it contain user ${userId}?`, verifiedLikes.includes(userId));
    } else {
        console.warn(`[func-combo] handleToggleLike: Could not verify patch. Status: ${verifyRes.status}`);
    }
    // --- END VERIFICATION ---

    return { success: true, liked: liked }; // Return the actual new liked status
     // --- End Original Logic ---
}

// --- Helper: Update Prefs Logic ---
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

// --- NEW HELPER: Get User Data (Likes) ---
async function handleGetUserData(userId) {
    console.log(`[func-combo] handleGetUserData: ========== GET USER DATA START ==========`);
    console.log(`[func-combo] handleGetUserData: Fetching liked items for user ${userId}`);
    console.log(`[func-combo] handleGetUserData: Using BASE_ID: ${BASE_ID}`);
    console.log(`[func-combo] handleGetUserData: Using ITEMS_TABLE: ${ITEMS_TABLE}`);
    console.log(`[func-combo] handleGetUserData: Using LIKED_BY_FIELD: ${LIKED_BY_FIELD}`);
    
    let likedItemIds = [];
    const likedItemsFormula = `FIND('${userId}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
    const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`; // Only get record IDs

    console.log(`[func-combo] handleGetUserData: Formula: ${likedItemsFormula}`);
    console.log(`[func-combo] handleGetUserData: Full URL: ${likedItemsUrl}`);
    const likedItemsRes = await fetch(likedItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    console.log(`[func-combo] handleGetUserData: Response status: ${likedItemsRes.status}`);

    if (likedItemsRes.ok) {
        const likedItemsData = await likedItemsRes.json();
        console.log(`[func-combo] handleGetUserData: Raw response from Airtable:`, JSON.stringify(likedItemsData, null, 2));
        likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
        console.log(`[func-combo] handleGetUserData: Found ${likedItemIds.length} liked items for user ${userId}.`);
        console.log(`[func-combo] handleGetUserData: Liked item IDs:`, likedItemIds);
    } else {
        const errorBody = await likedItemsRes.text();
        console.error(`[func-combo] handleGetUserData: Failed to fetch liked items for user ${userId}. Status: ${likedItemsRes.status}, Body: ${errorBody}`);
        // Don't fail the request, just return empty list
    }
    
    console.log(`[func-combo] handleGetUserData: Returning ${likedItemIds.length} liked items`);
    console.log(`[func-combo] handleGetUserData: ========== GET USER DATA END ==========`);
    // Return the payload expected by the client
    return { likedItemIds: likedItemIds };
}
// --- END NEW HELPER ---


// --- Main Handler ---
exports.handler = async (event) => {
  console.log(`[func-combo] Handler invoked. Method: ${event.httpMethod}. Path: ${event.path}. Body length: ${event.body ? event.body.length : 'N/A'}`);
  let body;
  try {
      body = JSON.parse(event.body);
  } catch (parseError) {
       // --- MODIFICATION: Handle GET request with no body ---
       if (event.httpMethod === 'GET') {
           body = {}; // Create empty body for GET
       } else {
           console.error('[func-combo] Error parsing request body:', parseError);
           return {
               statusCode: 400,
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ error: 'Invalid request body.' })
           };
       }
       // --- END MODIFICATION ---
  }

  // --- MODIFICATION: Allow GET requests ---
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    console.log(`[func-combo] Method Not Allowed: ${event.httpMethod}`);
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  // --- END MODIFICATION ---

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
    // --- MODIFICATION: Get action from query param for GET, body for POST ---
    let action;
    if (event.httpMethod === 'GET') {
        action = event.queryStringParameters.action;
    } else {
        action = body.action;
    }
    // --- END MODIFICATION ---
    
    console.log(`[func-combo] Action received: ${action}`);

    let result;

    if (action === 'toggle-like') {
      if (event.httpMethod !== 'POST') throw new Error('toggle-like action requires POST method.');
      const { itemId } = body;
      if (!itemId) throw new Error('Missing itemId for toggle-like action.');
      result = await handleToggleLike(userId, itemId);

    } else if (action === 'update-prefs') {
      if (event.httpMethod !== 'POST') throw new Error('update-prefs action requires POST method.');
      const { phone, frequency } = body;
       if (!['Real-Time', 'None'].includes(frequency)) {
          throw new Error(`Invalid frequency value: ${frequency}`);
       }
      result = await handleUpdatePrefs(userId, phone, frequency);

    // --- MODIFICATION: Add new action handler ---
    } else if (action === 'get-user-data') {
      if (event.httpMethod !== 'GET') throw new Error('get-user-data action requires GET method.');
      result = await handleGetUserData(userId);
    // --- END MODIFICATION ---

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
    console.error(`[func-combo] Handler Error processing action '${body?.action || event.queryStringParameters.action || 'unknown'}':`, error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
    };
  }
};
