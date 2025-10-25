// FILE: netlify/functions/update-user-prefs.js (REPLACE ENTIRE FILE)

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');

// Ensure all ENV variables are set in Netlify
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

// --- Define all needed constants ---
const USERS_TABLE = 'Users';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Your Items table ID
const LIKED_BY_FIELD = 'Liked By Users'; // Exact field name from Items table

// --- Helper: Toggle Like Logic ---
async function handleToggleLike(userId, itemId) {
    if (!itemId) {
        throw new Error('Missing itemId for toggle-like action.');
    }
    console.log(`[func-combo] User ${userId} toggling like for item ${itemId}`);

    // 1. Fetch the Item record
    const getItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}/${itemId}?fields[]=${encodeURIComponent(LIKED_BY_FIELD)}`;
    const itemRes = await fetch(getItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

    if (!itemRes.ok) {
        console.error(`Airtable fetch error (${itemRes.status}):`, await itemRes.text());
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
    } else {
        updatedUserIds = [...likedUserIds, userId];
        liked = true;
    }

    // 3. Update the Item record
    const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}/${itemId}`;
    const payload = { fields: { [LIKED_BY_FIELD]: updatedUserIds } };
    const patchRes = await fetch(patchUrl, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!patchRes.ok) {
        console.error(`Airtable patch error (${patchRes.status}):`, await patchRes.text());
        throw new Error(`Failed to update likes for item ${itemId}.`);
    }

    return { success: true, liked: liked };
}

// --- Helper: Update Prefs Logic ---
async function handleUpdatePrefs(userId, phone, frequency) {
    console.log(`[func-combo] User ${userId} updating prefs. Freq: ${frequency}`);
    
    const payload = {
      records: [{
        id: userId,
        fields: {
          'PhoneNumber': phone,
          'NotificationFrequency': frequency,
        }
      }]
    };

    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Airtable API Error (update-prefs):', errorData);
      throw new Error(`Airtable API Error: ${errorData.error.message}`);
    }

    const responseData = await response.json();
    const updatedUser = responseData.records[0];

    return {
        message: 'Preferences updated successfully.',
        user: {
            phoneNumber: updatedUser.fields.PhoneNumber || '',
            notificationFrequency: updatedUser.fields.NotificationFrequency || 'None'
        }
    };
}

// --- Main Handler ---
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // --- Authentication (Unified for all actions) ---
  const authHeader = event.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: Missing or invalid token' }) };
  }
  const token = authHeader.split(' ')[1];
  let userId;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    userId = decoded.userId;
    if (!userId) throw new Error('Invalid token payload.');
  } catch (error) {
    console.error('JWT Verification Error:', error.message);
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized: Invalid or expired token.' }) };
  }
  // --- End Authentication ---

  try {
    const body = JSON.parse(event.body);
    const { action } = body;

    let result;

    if (action === 'toggle-like') {
      // --- Run Like Logic ---
      const { itemId } = body;
      result = await handleToggleLike(userId, itemId);
    } else {
      // --- Run Prefs Logic (default) ---
      const { phone, frequency } = body;
      result = await handleUpdatePrefs(userId, phone, frequency);
    }

    return {
      statusCode: 200,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('[func-combo] Handler Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
    };
  }
};
