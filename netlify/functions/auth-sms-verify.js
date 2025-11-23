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
    console.log('[SMS-VERIFY-DEBUG] ========== Function invoked ==========');
    console.log('[SMS-VERIFY-DEBUG] HTTP Method:', event.httpMethod);
    console.log('[SMS-VERIFY-DEBUG] Request headers:', JSON.stringify(event.headers));
    console.log('[SMS-VERIFY-DEBUG] Request body (raw):', event.body);

    if (event.httpMethod !== 'POST') {
        console.log('[SMS-VERIFY-DEBUG] Invalid HTTP method - returning 405');
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        console.log('[SMS-VERIFY-DEBUG] Parsing request body');
        const { code, phoneNumber } = JSON.parse(event.body);
        console.log('[SMS-VERIFY-DEBUG] Parsed code:', code);
        console.log('[SMS-VERIFY-DEBUG] Parsed phoneNumber:', phoneNumber);

        if (!code || !phoneNumber) {
            console.log('[SMS-VERIFY-DEBUG] Validation failed - missing code or phone number');
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Code and phone number are required.' })
            };
        }

        // Normalize phone number
        const normalizedPhone = phoneNumber.startsWith('+') ? phoneNumber : `+${phoneNumber}`;
        console.log('[SMS-VERIFY-DEBUG] Normalized phone number:', normalizedPhone);

        console.log(`[auth-sms-verify] Verification attempt for: ${normalizedPhone} with code: ${code}`);

        // Check environment variables
        console.log('[SMS-VERIFY-DEBUG] Environment variable checks:');
        console.log('[SMS-VERIFY-DEBUG] - AIRTABLE_PAT exists:', !!AIRTABLE_PAT);
        console.log('[SMS-VERIFY-DEBUG] - BASE_ID exists:', !!BASE_ID);
        console.log('[SMS-VERIFY-DEBUG] - JWT_SECRET exists:', !!JWT_SECRET);

        // 1. Verify SMS Code
        const findCodeUrl = `https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes?filterByFormula=AND({Code}='${code}',{PhoneNumber}='${normalizedPhone}')`;
        console.log('[SMS-VERIFY-DEBUG] Airtable find code URL:', findCodeUrl);
        console.log('[SMS-VERIFY-DEBUG] Fetching SMS code from Airtable...');

        const codeRes = await fetch(findCodeUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        console.log('[SMS-VERIFY-DEBUG] Airtable response status:', codeRes.status);
        console.log('[SMS-VERIFY-DEBUG] Airtable response ok:', codeRes.ok);

        const codeData = await codeRes.json();
        console.log('[SMS-VERIFY-DEBUG] Airtable response data:', JSON.stringify(codeData));
        console.log('[SMS-VERIFY-DEBUG] Number of records found:', codeData.records?.length || 0);

        if (!codeData.records || codeData.records.length === 0) {
            console.warn(`[auth-sms-verify] Invalid code or phone number mismatch.`);
            console.warn('[SMS-VERIFY-DEBUG] Code verification failed - no matching records');
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid or expired code.' })
            };
        }

        const smsCodeRecord = codeData.records[0];
        console.log('[SMS-VERIFY-DEBUG] SMS code record ID:', smsCodeRecord.id);
        console.log('[SMS-VERIFY-DEBUG] SMS code record fields:', JSON.stringify(smsCodeRecord.fields));

        const { PhoneNumber, ExpiresAt } = smsCodeRecord.fields;
        console.log('[SMS-VERIFY-DEBUG] Code phone number:', PhoneNumber);
        console.log('[SMS-VERIFY-DEBUG] Code expires at:', ExpiresAt);
        console.log('[SMS-VERIFY-DEBUG] Current time:', new Date().toISOString());

        // Check expiration
        if (new Date() > new Date(ExpiresAt)) {
            console.warn(`[auth-sms-verify] Code expired for: ${PhoneNumber}`);
            console.warn('[SMS-VERIFY-DEBUG] Code has expired');

            // Clean up expired code
            console.log('[SMS-VERIFY-DEBUG] Deleting expired code...');
            const deleteResponse = await fetch(`https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes/${smsCodeRecord.id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });
            console.log('[SMS-VERIFY-DEBUG] Delete expired code response status:', deleteResponse.status);

            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'Invalid or expired code.' })
            };
        }

        // Delete the used SMS code immediately
        console.log('[SMS-VERIFY-DEBUG] Deleting used SMS code...');
        const deleteUsedResponse = await fetch(`https://api.airtable.com/v0/${BASE_ID}/SMS%20Codes/${smsCodeRecord.id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });
        console.log('[SMS-VERIFY-DEBUG] Delete used code response status:', deleteUsedResponse.status);

        console.log(`[auth-sms-verify] Code verified successfully for: ${PhoneNumber}`);

        // 2. Find or Create User by Phone Number
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}?filterByFormula=({${PHONE_FIELD}}='${PhoneNumber}')`;
        console.log('[SMS-VERIFY-DEBUG] Finding user in Airtable...');
        console.log('[SMS-VERIFY-DEBUG] Find user URL:', findUserUrl);

        const userRes = await fetch(findUserUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });

        console.log('[SMS-VERIFY-DEBUG] Find user response status:', userRes.status);
        console.log('[SMS-VERIFY-DEBUG] Find user response ok:', userRes.ok);

        let userData = await userRes.json();
        console.log('[SMS-VERIFY-DEBUG] Find user response data:', JSON.stringify(userData));

        let userRecord;

        if (userData.records && userData.records.length > 0) {
            userRecord = userData.records[0];
            console.log(`[auth-sms-verify] Found existing user: ${userRecord.id}`);
            console.log('[SMS-VERIFY-DEBUG] Existing user fields:', JSON.stringify(userRecord.fields));
        } else {
            console.log(`[auth-sms-verify] Creating new user for phone: ${PhoneNumber}`);
            console.log('[SMS-VERIFY-DEBUG] No existing user found - creating new user...');

            // Create new user with phone number
            const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(USERS_TABLE)}`;
            console.log('[SMS-VERIFY-DEBUG] Create user URL:', createUserUrl);

            const createUserPayload = {
                records: [{
                    fields: {
                        [PHONE_FIELD]: PhoneNumber,
                        [NAME_FIELD]: `User ${PhoneNumber.slice(-4)}`,
                        [EMAIL_FIELD]: `sms-user-${Date.now()}@temp.local` // Temporary email
                    }
                }]
            };
            console.log('[SMS-VERIFY-DEBUG] Create user payload:', JSON.stringify(createUserPayload));

            const createUserRes = await fetch(createUserUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${AIRTABLE_PAT}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(createUserPayload)
            });

            console.log('[SMS-VERIFY-DEBUG] Create user response status:', createUserRes.status);
            console.log('[SMS-VERIFY-DEBUG] Create user response ok:', createUserRes.ok);

            if (!createUserRes.ok) {
                const errorData = await createUserRes.json();
                console.error('[auth-sms-verify] Failed to create user:', errorData);
                console.error('[SMS-VERIFY-DEBUG] Create user error details:', JSON.stringify(errorData));
                throw new Error('Failed to create user in Airtable.');
            }

            const newUserData = await createUserRes.json();
            console.log('[SMS-VERIFY-DEBUG] Create user response data:', JSON.stringify(newUserData));
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
        console.log('[SMS-VERIFY-DEBUG] Generating JWT token...');
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
        console.log('[SMS-VERIFY-DEBUG] JWT token generated successfully');

        // 8. Return Response to Client
        const responsePayload = {
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
        };

        console.log('[SMS-VERIFY-DEBUG] Response payload prepared:', JSON.stringify({
            ...responsePayload,
            token: '[REDACTED]'
        }));
        console.log('[SMS-VERIFY-DEBUG] ========== Function completed successfully ==========');

        return {
            statusCode: 200,
            body: JSON.stringify(responsePayload),
        };
    } catch (error) {
        console.error('[auth-sms-verify] Function Error:', error);
        console.error('[SMS-VERIFY-DEBUG] ========== ERROR IN FUNCTION ==========');
        console.error('[SMS-VERIFY-DEBUG] Error name:', error.name);
        console.error('[SMS-VERIFY-DEBUG] Error message:', error.message);
        console.error('[SMS-VERIFY-DEBUG] Error stack:', error.stack);
        console.error('[SMS-VERIFY-DEBUG] Full error object:', JSON.stringify(error, null, 2));

        return {
            statusCode: 500,
            body: JSON.stringify({
                error: error.message || 'An internal error occurred.'
            }),
        };
    }
};
