// SMS OTP verification function
// Verifies the 6-digit code and authenticates the user

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

// Define table/field names as constants
const USERS_TABLE = 'Users';
const SESSIONS_TABLE = 'Sessions';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';
const LIKED_BY_FIELD = 'Liked By Users';
const RSVPS_FIELD = 'RSVPs';
const OWNED_STORE_FIELD = 'OwnedStore';
const OWNER_DASHBOARD_ID_FIELD = 'OwnerDashboardID';
const ASSOCIATED_SESSIONS_FIELD = 'Associated Sessions';
const NAME_FIELD = 'Name';
const EMAIL_FIELD = 'Email';
const PHONE_FIELD = 'PhoneNumber';

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { code, phoneNumber } = JSON.parse(event.body);

        if (!code || !phoneNumber) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Code and phone number are required.' })
            };
        }

        // Normalize phone number
        const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;

        console.log(`[auth-sms-verify] Verification attempt for: ${normalizedPhone} with code: ${code}`);

        // 1. Verify SMS Code
        const findCodeUrl = `https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes?filterByFormula=AND({Code}='${code}',{PhoneNumber}='${normalizedPhone}')`;
        const codeRes = await fetch(findCodeUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        const codeData = await codeRes.json();

        if (!codeData.records || codeData.records.length === 0) {
            console.warn(`[auth-sms-verify] Invalid code or phone number mismatch.`);
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid or expired code.' })
            };
        }

        const smsCodeRecord = codeData.records[0];
        const { PhoneNumber, ExpiresAt } = smsCodeRecord.fields;

        // Check expiration
        if (new Date() > new Date(ExpiresAt)) {
            console.warn(`[auth-sms-verify] Code expired for: ${PhoneNumber}`);

            // Clean up expired code
            await fetch(`https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes/${smsCodeRecord.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });

            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid or expired code.' })
            };
        }

        // Delete the used SMS code immediately
        await fetch(`https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes/${smsCodeRecord.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        console.log(`[auth-sms-verify] Code verified successfully for: ${PhoneNumber}`);

        // 2. Find or Create User by Phone Number
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=({${PHONE_FIELD}}='${PhoneNumber}')`;
        const userRes = await fetch(findUserUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        let userData = await userRes.json();
        let userRecord;

        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
            console.log(`[auth-sms-verify] Found existing user: ${userRecord.id}`);
        } else {
            console.log(`[auth-sms-verify] Creating new user for phone: ${PhoneNumber}`);

            // Create new user with phone number
            const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
            const createUserRes = await fetch(createUserUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_PAT}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    records: [{
                        fields: {
                            [PHONE_FIELD]: PhoneNumber,
                            [NAME_FIELD]: `User ${PhoneNumber.slice(-4)}`,
                            [EMAIL_FIELD]: `sms-user-${Date.now()}@temp.local` // Temporary email
                        }
                    }]
                })
            });

            if (!createUserRes.ok) {
                const errorData = await createUserRes.json();
                console.error('[auth-sms-verify] Failed to create user:', errorData);
                throw new Error('Failed to create user in Airtable.');
            }

            const newUserData = await createUserRes.json();
            userRecord = newUserData.records[0];
            console.log(`[auth-sms-verify] Created new user: ${userRecord.id}`);
        }

        // 3. Check for Store Ownership
        let ownerData = { isOwner: false, ownerDashboardId: null };
        if (userRecord.fields[OWNED_STORE_FIELD] && userRecord.fields[OWNED_STORE_FIELD].length > 0) {
            const storeId = userRecord.fields[OWNED_STORE_FIELD][0];
            const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/Stores/${storeId}?fields[]=${encodeURIComponent(OWNER_DASHBOARD_ID_FIELD)}`;
            const storeRes = await fetch(storeUrl, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });

            if (storeRes.ok) {
                const storeRecord = await storeRes.json();
                if (storeRecord.fields[OWNER_DASHBOARD_ID_FIELD]) {
                    ownerData.isOwner = true;
                    ownerData.ownerDashboardId = storeRecord.fields[OWNER_DASHBOARD_ID_FIELD];
                    console.log(`[auth-sms-verify] User ${userRecord.id} is owner of store ${storeId}`);
                }
            }
        }

        // 4. Fetch Associated Session Names
        let associatedSessions = [];
        const sessionIds = userRecord.fields[ASSOCIATED_SESSIONS_FIELD];
        if (sessionIds && sessionIds.length > 0) {
            const formula = `OR(${sessionIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
            const sessionsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(SESSIONS_TABLE)}?fields[]=${encodeURIComponent(NAME_FIELD)}&filterByFormula=${encodeURIComponent(formula)}`;
            const sessionsRes = await fetch(sessionsUrl, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });

            if (sessionsRes.ok) {
                const sessionsData = await sessionsRes.json();
                associatedSessions = sessionsData.records.map(rec => ({
                    id: rec.id,
                    name: rec.fields[NAME_FIELD] || 'Unnamed Session'
                }));
                console.log(`[auth-sms-verify] Found ${associatedSessions.length} associated sessions`);
            }
        }

        // 5. Fetch Liked Item IDs
        let likedItemIds = [];
        const likedItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${LIKED_BY_FIELD}}))`;
        const likedItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(likedItemsFormula)}&fields[]=`;

        console.log(`[auth-sms-verify] Fetching liked items for user ${userRecord.id}...`);
        const likedItemsRes = await fetch(likedItemsUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        if (likedItemsRes.ok) {
            const likedItemsData = await likedItemsRes.json();
            likedItemIds = likedItemsData.records ? likedItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-sms-verify] Found ${likedItemIds.length} liked items`);
        }

        // 6. Fetch RSVP'd Item IDs
        let rsvpdItemIds = [];
        const rsvpdItemsFormula = `FIND('${userRecord.id}', ARRAYJOIN({${RSVPS_FIELD}}))`;
        const rsvpdItemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(ITEMS_TABLE)}?filterByFormula=${encodeURIComponent(rsvpdItemsFormula)}&fields[]=`;

        console.log(`[auth-sms-verify] Fetching RSVP'd items for user ${userRecord.id}...`);
        const rsvpdItemsRes = await fetch(rsvpdItemsUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        if (rsvpdItemsRes.ok) {
            const rsvpdItemsData = await rsvpdItemsRes.json();
            rsvpdItemIds = rsvpdItemsData.records ? rsvpdItemsData.records.map(rec => rec.id) : [];
            console.log(`[auth-sms-verify] Found ${rsvpdItemIds.length} RSVP'd items`);
        }

        // 7. Generate Session JWT
        const sessionToken = jwt.sign(
            {
                userId: userRecord.id,
                name: userRecord.fields[NAME_FIELD],
                email: userRecord.fields[EMAIL_FIELD],
                phoneNumber: userRecord.fields[PHONE_FIELD],
                isOwner: ownerData.isOwner
            },
            JWT_SECRET,
            { expiresIn: '30d' }
        );

        console.log(`[auth-sms-verify] Authentication successful for user ${userRecord.id}`);

        // 8. Return Response to Client
        return {
            statusCode: 200,
            body: JSON.stringify({
                token: sessionToken,
                user: {
                    id: userRecord.id,
                    name: userRecord.fields[NAME_FIELD],
                    email: userRecord.fields[EMAIL_FIELD],
                    phoneNumber: userRecord.fields[PHONE_FIELD] || '',
                    notificationFrequency: userRecord.fields.NotificationFrequency || 'None',
                    likedItemIds: likedItemIds,
                    rsvpdItemIds: rsvpdItemIds
                },
                ownerData: ownerData,
                associatedSessions: associatedSessions
            }),
        };
    } catch (error) {
        console.error('[auth-sms-verify] Function Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'An internal error occurred.'
            }),
        };
    }
};
