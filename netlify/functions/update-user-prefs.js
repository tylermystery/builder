// FILE: netlify/functions/update-user-prefs.js (REPLACE ENTIRE FILE)

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

// Ensure all ENV variables are set in Netlify
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

// --- Define all needed constants ---
const USERS_TABLE = 'Users';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Your Items table ID (Looks like an ID, so no encodeURIComponent needed below)
const LIKED_BY_FIELD = 'Liked By Users'; // Exact field name from Items table

// --- Helper: Toggle Like Logic ---
async function handleToggleLike(userId, itemId) {
    if (!itemId) {
        throw new Error('Missing itemId for toggle-like action.');
    }
    console.log(`[func-combo] User ${userId} toggling like for item ${itemId}`);

    // --- FIX 1: Removed encodeURIComponent around ITEMS_TABLE ---
    // 1. Fetch the Item record (only the Liked By Users field)
    const getItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${itemId}?fields[]=${encodeURIComponent(LIKED_BY_FIELD)}`;
    console.log(`[func-combo] Fetching item URL: ${getItemUrl}`); // Added log
    const itemRes = await fetch(getItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

    if (!itemRes.ok) {
        const errorBody = await itemRes.text(); // Get error body as text
        console.error(`[func-combo] Airtable fetch error (${itemRes.status}): ${errorBody}`);
        // Throw specific error from within the function as seen in client logs
        throw new Error(`Failed to fetch item ${itemId} from Airtable.`);
    }

    const itemRecord = await itemRes.json();
    const likedUserIds = itemRecord.fields?.[LIKED_BY_FIELD] || [];
    const userIndex = likedUserIds.indexOf(userId);
    let updatedUserIds;
    let liked = false;

    // 2. Determine new state
    if (userIndex > -1) {
        updatedUserIds = likedUserIds.filter(id => id !== userId);
        liked = false;
        console.log(`[func-combo] User ${userId} unliking item ${itemId}.`);
    } else {
        updatedUserIds = [...likedUserIds, userId];
        liked = true;
        console.log(`[func-combo] User ${userId} liking item ${itemId}.`);
    }

    // --- FIX 2: Removed encodeURIComponent around ITEMS_TABLE ---
    // 3. Update the Item record in Airtable
    const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${itemId}`;
    console.log(`[func-combo] Patching item URL: ${patchUrl}`); // Added log
    const payload = {
        fields: {
            [LIKED_BY_FIELD]: updatedUserIds
        }
    };

    const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${AIRTABLE_PAT}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!patchRes.ok) {
        const errorBody = await patchRes.text(); // Get error body as text
        console.error(`[func-combo] Airtable patch error (${patchRes.status}): ${errorBody}`);
        throw new Error(`Failed to update likes for item ${itemId} in Airtable.`);
    }

    console.log(`[func-combo] Successfully updated likes for item ${itemId}. New status: ${liked ? 'Liked' : 'Unliked'}`);

    return { success: true, liked: liked }; // Return the new liked status
}

// --- Helper: Update Prefs Logic ---
async function handleUpdatePrefs(userId, phone, frequency) {
    console.log(`[func-combo] User ${userId} updating prefs. Freq: ${frequency}, Phone: ${phone}`); // Added phone to log

    const payload = {
      records: [{
        id: userId,
        fields: {
          // Ensure these field names EXACTLY match your Airtable Users table
          'PhoneNumber': phone || null, // Use null if phone is empty/undefined to clear the field
          'NotificationFrequency': frequency,
        }
      }]
    };

    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE}`, { // Ensure USERS_TABLE is correct
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[func-combo] Airtable API Error (update-prefs):', errorData);
      // Try to provide a more specific error message if available
      const message = errorData?.error?.message || `Airtable API Error: ${response.statusText}`;
      throw new Error(message);
    }

    const responseData = await response.json();
    // Check if records array exists and has elements
    if (!responseData.records || responseData.records.length === 0) {
        console.error('[func-combo] Airtable PATCH response did not contain updated records:', responseData);
        throw new Error('Failed to retrieve updated user preferences from Airtable response.');
    }
    const updatedUser = responseData.records[0];

    return {
        message: 'Preferences updated successfully.',
        // Safely access fields, providing defaults
        user: {
            phoneNumber: updatedUser.fields?.PhoneNumber || '',
            notificationFrequency: updatedUser.fields?.NotificationFrequency || 'None'
        }
    };
}


// --- Main Handler ---
exports.handler = async (event) => {
  console.log('[func-combo] Handler invoked.'); // Log invocation
  if (event.httpMethod !== 'POST') {
    console.log(`[func-combo] Method Not Allowed: ${event.httpMethod}`);
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // --- Authentication ---
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
  // --- End Authentication ---

  try {
    const body = JSON.parse(event.body);
    const { action } = body;
    console.log(`[func-combo] Action received: ${action}`);

    let result;

    if (action === 'toggle-like') {
      const { itemId } = body;
      if (!itemId) throw new Error('Missing itemId for toggle-like action.');
      result = await handleToggleLike(userId, itemId);
    } else if (action === 'update-prefs') { // Explicitly check for 'update-prefs'
      const { phone, frequency } = body;
      // Basic validation for frequency
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
      headers: { 'Content-Type': 'application/json' }, // Ensure correct content type
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('[func-combo] Handler Error:', error);
    // Ensure error message is included in the response
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' }, // Ensure correct content type
      body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
    };
  }
};
