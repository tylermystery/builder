// Netlify Identity signup webhook handler
// This is triggered when a new user signs up via Netlify Identity (Google SSO)

const fetch = require('node-fetch');

exports.handler = async (event, context) => {
    console.log('[identity-signup] ========== WEBHOOK HANDLER START ==========');
    console.log('[identity-signup] Event method:', event.httpMethod);
    console.log('[identity-signup] Event body present:', !!event.body);

    // Check for required environment variables
    const { AIRTABLE_PAT, BASE_ID } = process.env;

    if (!AIRTABLE_PAT) {
        console.error('[identity-signup] ERROR: AIRTABLE_PAT environment variable is not set');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error: Missing AIRTABLE_PAT' }) };
    }

    if (!BASE_ID) {
        console.error('[identity-signup] ERROR: BASE_ID environment variable is not set');
        return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error: Missing BASE_ID' }) };
    }

    console.log('[identity-signup] Environment variables verified');

    // Parse the event body
    let userData;
    try {
        if (!event.body) {
            console.error('[identity-signup] ERROR: Event body is empty or missing');
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
        }

        const payload = JSON.parse(event.body);
        console.log('[identity-signup] Parsed payload keys:', Object.keys(payload));

        userData = payload.user;

        if (!userData) {
            console.error('[identity-signup] ERROR: No user data in payload');
            console.log('[identity-signup] Full payload:', JSON.stringify(payload, null, 2));
            return { statusCode: 400, body: JSON.stringify({ error: 'No user data in request' }) };
        }

        console.log('[identity-signup] User data extracted successfully');
        console.log('[identity-signup] User email:', userData.email);
        console.log('[identity-signup] User metadata:', JSON.stringify(userData.user_metadata || {}, null, 2));

    } catch (parseError) {
        console.error('[identity-signup] ERROR: Failed to parse event body:', parseError.message);
        console.log('[identity-signup] Raw body (first 500 chars):', event.body?.substring(0, 500));
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON in request body' }) };
    }

    const { email, user_metadata } = userData;

    if (!email) {
        console.error('[identity-signup] ERROR: No email found in user data');
        return { statusCode: 400, body: JSON.stringify({ error: 'No email in user data' }) };
    }

    const name = user_metadata?.full_name || email.split('@')[0];
    console.log('[identity-signup] Extracted name:', name);

    try {
        // Check if user already exists - use encodeURIComponent for email to handle special chars
        const filterFormula = encodeURIComponent(`{Email}="${email}"`);
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${filterFormula}`;
        console.log('[identity-signup] Checking for existing user with email:', email);

        const findRes = await fetch(findUserUrl, {
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`
            }
        });

        console.log('[identity-signup] Find user response status:', findRes.status);

        if (!findRes.ok) {
            const errorText = await findRes.text();
            console.error('[identity-signup] ERROR: Airtable find request failed');
            console.error('[identity-signup] Status:', findRes.status);
            console.error('[identity-signup] Response:', errorText);
            // Return 200 to Netlify Identity even on error so signup can complete
            // The user just won't be synced to Airtable
            return { statusCode: 200, body: JSON.stringify({ warning: 'User created in Netlify Identity but Airtable sync failed' }) };
        }

        const existing = await findRes.json();
        console.log('[identity-signup] Find user result - records found:', existing.records?.length || 0);

        if (existing.records && existing.records.length > 0) {
            console.log(`[identity-signup] User ${email} already exists in Airtable. Record ID: ${existing.records[0].id}`);
            return { statusCode: 200, body: JSON.stringify({ message: 'User already exists' }) };
        }

        // Create user if they don't exist
        console.log('[identity-signup] Creating new user in Airtable...');
        const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users`;
        const createPayload = {
            records: [{
                fields: {
                    Email: email,
                    Name: name
                }
            }]
        };

        console.log('[identity-signup] Create payload:', JSON.stringify(createPayload, null, 2));

        const createRes = await fetch(createUserUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(createPayload)
        });

        console.log('[identity-signup] Create user response status:', createRes.status);

        if (!createRes.ok) {
            const errorText = await createRes.text();
            console.error('[identity-signup] ERROR: Failed to create user in Airtable');
            console.error('[identity-signup] Status:', createRes.status);
            console.error('[identity-signup] Response:', errorText);
            // Return 200 to Netlify Identity even on error so signup can complete
            return { statusCode: 200, body: JSON.stringify({ warning: 'User created in Netlify Identity but Airtable sync failed' }) };
        }

        const createResult = await createRes.json();
        console.log(`[identity-signup] Successfully created user ${email} in Airtable`);
        console.log('[identity-signup] New record ID:', createResult.records?.[0]?.id);

        console.log('[identity-signup] ========== WEBHOOK HANDLER SUCCESS ==========');
        return { statusCode: 200, body: JSON.stringify({ message: 'User created', recordId: createResult.records?.[0]?.id }) };

    } catch (error) {
        console.error('[identity-signup] ========== UNEXPECTED ERROR ==========');
        console.error('[identity-signup] Error name:', error.name);
        console.error('[identity-signup] Error message:', error.message);
        console.error('[identity-signup] Error stack:', error.stack);

        // Return 200 to Netlify Identity even on error so signup can complete
        // This prevents blocking the user from signing up even if Airtable sync fails
        return { statusCode: 200, body: JSON.stringify({ warning: 'User signup completed but sync to database failed' }) };
    }
};
