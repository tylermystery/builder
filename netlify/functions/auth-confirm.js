// FILE: netlify/functions/auth-confirm.js
// Confirms magic link authentication and logs in the user via Pusher

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const Pusher = require("pusher");
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET, PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;

// Debug: Log environment variable availability at cold start
console.log('[auth-confirm] Cold start - checking env vars:', {
    hasAirtablePat: !!AIRTABLE_PAT,
    hasBaseId: !!BASE_ID,
    hasJwtSecret: !!JWT_SECRET,
    hasPusherAppId: !!PUSHER_APP_ID,
    hasPusherKey: !!PUSHER_KEY,
    hasPusherSecret: !!PUSHER_SECRET,
    hasPusherCluster: !!PUSHER_CLUSTER
});

// Define table/field names as constants for consistency
const USERS_TABLE = 'Users';
const SESSIONS_TABLE = 'Sessions';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const LIKED_BY_FIELD = 'Liked By Users';
const RSVPS_FIELD = 'RSVPs';

// Only initialize Pusher if all required vars are present
let pusher = null;
if (PUSHER_APP_ID && PUSHER_KEY && PUSHER_SECRET && PUSHER_CLUSTER) {
    pusher = new Pusher({
        appId: PUSHER_APP_ID,
        key: PUSHER_KEY,
        secret: PUSHER_SECRET,
        cluster: PUSHER_CLUSTER,
        useTLS: true,
    });
}

exports.handler = async (event) => {
    console.log('[auth-confirm] Function invoked');
    console.log('[auth-confirm] Request path:', event.path);
    console.log('[auth-confirm] Query params:', JSON.stringify(event.queryStringParameters || {}));

    // Helper function to generate HTML response
    const generateHtmlPage = (title, message, isSuccess = false) => {
        const bgColor = isSuccess ? '#d4edda' : '#f8d7da';
        const textColor = isSuccess ? '#155724' : '#721c24';
        const borderColor = isSuccess ? '#c3e6cb' : '#f5c6cb';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title} - WTFun</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 400px;
        }
        .icon {
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: ${textColor};
            margin: 0 0 15px 0;
            font-size: 24px;
        }
        p {
            color: #666;
            margin: 0 0 20px 0;
            line-height: 1.6;
        }
        .status-box {
            background: ${bgColor};
            border: 1px solid ${borderColor};
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 20px;
        }
        .status-box p {
            color: ${textColor};
            margin: 0;
        }
        a {
            display: inline-block;
            background: #667eea;
            color: white;
            text-decoration: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-weight: 500;
        }
        a:hover {
            background: #5a6fd6;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">${isSuccess ? '✅' : '⚠️'}</div>
        <h1>${title}</h1>
        <div class="status-box">
            <p>${message}</p>
        </div>
        <p>${isSuccess ? 'You can close this tab and return to the original window.' : 'Please try again or request a new link.'}</p>
    </div>
</body>
</html>`;
    };

    try {
        // Check for required environment variables early
        if (!AIRTABLE_PAT || !BASE_ID || !JWT_SECRET) {
            console.error('[auth-confirm] Missing required environment variables');
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
                body: generateHtmlPage('Configuration Error', 'Server is not properly configured. Please contact support.', false)
            };
        }

        if (!pusher) {
            console.error('[auth-confirm] Pusher not initialized - missing environment variables');
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
                body: generateHtmlPage('Service Unavailable', 'Real-time authentication service is unavailable. Please try again later.', false)
            };
        }

        const { token } = event.queryStringParameters || {};
        if (!token) {
            console.error('[auth-confirm] No token provided in query parameters');
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
                body: generateHtmlPage('Invalid Link', 'No authentication token was found in this link. Please use the complete link from your email.', false)
            };
        }

        console.log('[auth-confirm] Processing magic link confirmation for token:', token.substring(0, 8) + '...');

        const findTokenUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links?filterByFormula=AND({Token}='${token}')`;
        const tokenRes = await fetch(findTokenUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (!tokenRes.ok) {
            console.error('[auth-confirm] Airtable API error:', tokenRes.status, tokenRes.statusText);
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
                body: generateHtmlPage('Service Error', 'Unable to verify your authentication token. Please try again later.', false)
            };
        }

        const tokenData = await tokenRes.json();

        if (!tokenData.records || tokenData.records.length === 0) {
            console.log('[auth-confirm] Token not found in database - may have been already used or expired');
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
                body: generateHtmlPage('Link Already Used', 'This sign-in link has already been used or has expired. If you need to sign in again, please request a new link.', false)
            };
        }

        const magicLinkRecord = tokenData.records[0];
        const { Email, ExpiresAt, ChannelID } = magicLinkRecord.fields;

        // Check if token has expired
        if (new Date() > new Date(ExpiresAt)) {
            console.log('[auth-confirm] Token has expired at:', ExpiresAt);
            // Delete the expired token
            await fetch(`https://api.airtable.com/v0/${BASE_ID}/Magic%20Links/${magicLinkRecord.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
                body: generateHtmlPage('Link Expired', 'This sign-in link has expired (links are valid for 15 minutes). Please request a new sign-in link.', false)
            };
        }

        // Delete the token immediately to prevent reuse
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/Magic%20Links/${magicLinkRecord.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=AND({Email}='${Email}')`;
        const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        let userData = await userRes.json();
        let userRecord;

        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
            console.log(`[auth-confirm] Found existing user: ${userRecord.id}`);
        } else {
            console.log(`[auth-confirm] Creating new user for email: ${Email}`);
            const createUserRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: { Email: Email, Name: Email.split('@')[0] } }] })
            });
            const newUserData = await createUserRes.json();
            userRecord = newUserData.records[0];
            console.log(`[auth-confirm] Created new user: ${userRecord.id}`);
        }

        // Fetch owner data
        let ownerData = { isOwner: false, ownerDashboardId: null, ownedStoreId: null };
        if (userRecord.fields.OwnedStore && userRecord.fields.OwnedStore.length > 0) {
            const storeId = userRecord.fields.OwnedStore[0];
            ownerData.ownedStoreId = storeId;
            const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/Stores/${storeId}`;
            const storeRes = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (storeRes.ok) {
                const storeRecord = await storeRes.json();
                if (storeRecord.fields.OwnerDashboardID) {
                    ownerData.isOwner = true;
                    ownerData.ownerDashboardId = storeRecord.fields.OwnerDashboardID;
                    console.log(`[auth-confirm] User ${userRecord.id} is owner of store ${storeId}`);
                }
            }
        }

        // Fetch associated sessions
        let associatedSessions = [];
        const sessionIds = userRecord.fields['Associated Sessions'];
        if (sessionIds && sessionIds.length > 0) {
            const formula = `OR(${sessionIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
            const sessionsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SESSIONS_TABLE)}?fields[]=Name&filterByFormula=${encodeURIComponent(formula)}`;
            const sessionsRes = await fetch(sessionsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (sessionsRes.ok) {
                const sessionsData = await sessionsRes.json();
                associatedSessions = sessionsData.records.map(rec => ({ id: rec.id, name: rec.fields.Name || 'Unnamed Session' }));
                console.log(`[auth-confirm] Found ${associatedSessions.length} associated sessions`);
            }
        }

        // Fetch liked items
        let likedItemIds = [];
        const likedItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
        const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`;
        const likedItemsRes = await fetch(likedItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (likedItemsRes.ok) {
            const likedItemsData = await likedItemsRes.json();
            likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-confirm] Found ${likedItemIds.length} liked items`);
        }

        // Fetch RSVP'd items
        let rsvpdItemIds = [];
        const rsvpdItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${RSVPS_FIELD}}))`;
        const rsvpdItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(rsvpdItemsFormula)}&fields[]=`;
        const rsvpdItemsRes = await fetch(rsvpdItemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (rsvpdItemsRes.ok) {
            const rsvpdItemsData = await rsvpdItemsRes.json();
            rsvpdItemIds = rsvpdItemsData.records ? rsvpdItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-confirm] Found ${rsvpdItemIds.length} RSVP'd items`);
        }

        const sessionToken = jwt.sign(
            { userId: userRecord.id, name: userRecord.fields.Name, email: userRecord.fields.Email, isOwner: ownerData.isOwner },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        await pusher.trigger(`private-auth-${ChannelID}`, "auth-success", {
            token: sessionToken,
            user: {
                id: userRecord.id,
                name: userRecord.fields.Name,
                email: userRecord.fields.Email,
                phoneNumber: userRecord.fields.Phone || '',
                notificationFrequency: userRecord.fields.NotificationFrequency || 'None',
                likedItemIds: likedItemIds,
                rsvpdItemIds: rsvpdItemIds,
                associatedSessions: associatedSessions
            },
            ownerData: ownerData
        });

        console.log(`[auth-confirm] Authentication successful for user: ${userRecord.id}`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
            body: generateHtmlPage('Authentication Confirmed!', 'You have been successfully signed in. The original tab will update automatically.', true)
        };
    } catch (error) {
        console.error('[auth-confirm] Error:', error.message);
        console.error('[auth-confirm] Error stack:', error.stack);

        // Provide user-friendly error messages
        let userMessage = error.message;
        if (error.message === 'Token is required.') {
            userMessage = 'No authentication token provided. Please use the link from your email.';
        } else if (error.message.includes('Invalid or expired')) {
            userMessage = 'This link has expired or has already been used. Please request a new sign-in link.';
        }

        return {
            statusCode: 400,
            headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
            body: generateHtmlPage('Authentication Failed', userMessage, false)
        };
    }
};
