// Netlify Identity signup webhook handler
// This is triggered when a new user signs up via Netlify Identity (including OAuth/SSO providers)
//
// IMPORTANT: This function MUST return the FULL user object with metadata.
// Reference: https://docs.netlify.com/build/functions/functions-and-identity/

// Use global fetch (Node.js 18+) or fall back to node-fetch
let fetchFn;
try {
    fetchFn = typeof fetch !== 'undefined' ? fetch : require('node-fetch');
} catch (e) {
    // node-fetch not available, will handle in handler
}

// Helper to create response with user object
const createResponse = (user, additionalAppMeta = {}) => {
    console.log('[identity-signup] createResponse called');
    console.log('[identity-signup] Input user object keys:', user ? Object.keys(user) : 'null');
    console.log('[identity-signup] Additional app_metadata:', JSON.stringify(additionalAppMeta));

    const responseUser = {
        ...user,
        app_metadata: {
            ...(user?.app_metadata || {}),
            ...additionalAppMeta
        },
        user_metadata: {
            ...(user?.user_metadata || {})
        }
    };

    console.log('[identity-signup] Response user object keys:', Object.keys(responseUser));
    console.log('[identity-signup] Response user email:', responseUser.email);
    console.log('[identity-signup] Response app_metadata:', JSON.stringify(responseUser.app_metadata));

    const response = {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(responseUser)
    };

    console.log('[identity-signup] Final response statusCode:', response.statusCode);
    console.log('[identity-signup] Final response body length:', response.body.length);

    return response;
};

exports.handler = async (event, context) => {
    console.log('[identity-signup] ========== HANDLER START ==========');
    console.log('[identity-signup] Timestamp:', new Date().toISOString());
    console.log('[identity-signup] Event httpMethod:', event.httpMethod);
    console.log('[identity-signup] Event headers:', JSON.stringify(event.headers || {}));
    console.log('[identity-signup] Event body present:', !!event.body);
    console.log('[identity-signup] Event body length:', event.body ? event.body.length : 0);
    console.log('[identity-signup] Context keys:', context ? Object.keys(context) : 'null');
    console.log('[identity-signup] Context.clientContext:', context?.clientContext ? 'present' : 'absent');

    // Default user object for fallback responses
    let user = {};

    try {
        // Parse event body
        if (event.body) {
            console.log('[identity-signup] Parsing event body...');
            let payload;
            try {
                payload = JSON.parse(event.body);
            } catch (parseErr) {
                console.error('[identity-signup] ERROR: Failed to parse event body:', parseErr.message);
                console.error('[identity-signup] Raw event body (first 500 chars):', event.body.substring(0, 500));
                return createResponse({}, { roles: ["user"], signup_error: "parse_failed" });
            }

            console.log('[identity-signup] Parsed payload keys:', Object.keys(payload));
            console.log('[identity-signup] Event type:', payload.event);
            console.log('[identity-signup] Full payload:', JSON.stringify(payload, null, 2));

            user = payload.user || {};
            console.log('[identity-signup] User object keys:', Object.keys(user));
            console.log('[identity-signup] User email:', user.email);
            console.log('[identity-signup] User id:', user.id);
            console.log('[identity-signup] User provider:', user.app_metadata?.provider);
            console.log('[identity-signup] User app_metadata:', JSON.stringify(user.app_metadata || {}));
            console.log('[identity-signup] User user_metadata:', JSON.stringify(user.user_metadata || {}));
        } else {
            console.log('[identity-signup] No event body received');
        }

        // If no user data, just allow signup
        if (!user.email) {
            console.log('[identity-signup] No email in user data, allowing signup');
            return createResponse(user, { roles: ["user"] });
        }

        // Skip Airtable sync if env vars or fetch missing
        const { AIRTABLE_PAT, BASE_ID } = process.env;
        console.log('[identity-signup] Environment check - AIRTABLE_PAT present:', !!AIRTABLE_PAT);
        console.log('[identity-signup] Environment check - BASE_ID present:', !!BASE_ID);
        console.log('[identity-signup] Environment check - fetchFn present:', !!fetchFn);

        if (!AIRTABLE_PAT || !BASE_ID || !fetchFn) {
            console.log('[identity-signup] Skipping Airtable sync (missing env/fetch)');
            console.log('[identity-signup] Missing: AIRTABLE_PAT=' + !AIRTABLE_PAT + ', BASE_ID=' + !BASE_ID + ', fetchFn=' + !fetchFn);
            return createResponse(user, { roles: ["user"] });
        }

        // Try to sync with Airtable (non-blocking - errors don't fail signup)
        try {
            console.log('[identity-signup] Starting Airtable sync for email:', user.email);
            const filterFormula = encodeURIComponent(`{Email}="${user.email}"`);
            const findUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${filterFormula}`;
            console.log('[identity-signup] Airtable find URL:', findUrl);

            const findRes = await fetchFn(findUrl, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });

            console.log('[identity-signup] Airtable find response status:', findRes.status);
            console.log('[identity-signup] Airtable find response ok:', findRes.ok);

            if (findRes.ok) {
                const existing = await findRes.json();
                console.log('[identity-signup] Airtable find response - records found:', existing.records?.length || 0);

                if (existing.records?.length > 0) {
                    console.log('[identity-signup] User exists in Airtable:', existing.records[0].id);
                    return createResponse(user, {
                        airtable_user_id: existing.records[0].id,
                        roles: ["user"]
                    });
                }

                // Create new user in Airtable
                const name = user.user_metadata?.full_name || user.email.split('@')[0];
                console.log('[identity-signup] Creating new user in Airtable with name:', name);

                const createRes = await fetchFn(`https://api.airtable.com/v0/${BASE_ID}/Users`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${AIRTABLE_PAT}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        records: [{ fields: { Email: user.email, Name: name } }]
                    })
                });

                console.log('[identity-signup] Airtable create response status:', createRes.status);
                console.log('[identity-signup] Airtable create response ok:', createRes.ok);

                if (createRes.ok) {
                    const result = await createRes.json();
                    const newId = result.records?.[0]?.id;
                    console.log('[identity-signup] Created user in Airtable:', newId);
                    return createResponse(user, {
                        airtable_user_id: newId,
                        roles: ["user"]
                    });
                } else {
                    const errorText = await createRes.text();
                    console.error('[identity-signup] Airtable create error response:', errorText);
                }
            } else {
                const errorText = await findRes.text();
                console.error('[identity-signup] Airtable find error response:', errorText);
            }
        } catch (airtableErr) {
            console.error('[identity-signup] Airtable error name:', airtableErr.name);
            console.error('[identity-signup] Airtable error message:', airtableErr.message);
            console.error('[identity-signup] Airtable error stack:', airtableErr.stack);
        }

        // Always return success to allow signup
        console.log('[identity-signup] ========== HANDLER SUCCESS (fallback) ==========');
        return createResponse(user, { roles: ["user"] });

    } catch (err) {
        console.error('[identity-signup] ========== HANDLER ERROR ==========');
        console.error('[identity-signup] Error name:', err.name);
        console.error('[identity-signup] Error message:', err.message);
        console.error('[identity-signup] Error stack:', err.stack);
        // Return success with whatever user data we have
        return createResponse(user, { roles: ["user"] });
    }
};
