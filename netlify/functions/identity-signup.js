// Netlify Identity signup webhook handler
// This is triggered when a new user signs up via Netlify Identity (including OAuth/SSO providers)
//
// IMPORTANT: This function MUST return a 200 with the user object to allow signup.
// For external providers (Google), identity-validate fires first, then identity-signup.
// Reference: https://docs.netlify.com/build/functions/functions-and-identity/

const nodeFetch = require('node-fetch');

exports.handler = async (event, context) => {
    const ts = new Date().toISOString();
    console.log(`[identity-signup] ========== HANDLER START (${ts}) ==========`);
    console.log('[identity-signup] httpMethod:', event.httpMethod);
    console.log('[identity-signup] body present:', !!event.body);
    console.log('[identity-signup] body length:', event.body ? event.body.length : 0);
    console.log('[identity-signup] node-fetch loaded:', typeof nodeFetch === 'function');

    let user = {};

    try {
        // Parse event body
        if (event.body) {
            let payload;
            try {
                payload = JSON.parse(event.body);
            } catch (parseErr) {
                console.error('[identity-signup] JSON parse error:', parseErr.message);
                console.error('[identity-signup] Raw body (first 300 chars):', event.body.substring(0, 300));
                return { statusCode: 200, body: JSON.stringify({}) };
            }

            console.log('[identity-signup] event type:', payload.event);
            user = payload.user || {};
            console.log('[identity-signup] user.email:', user.email);
            console.log('[identity-signup] user.id:', user.id);
            console.log('[identity-signup] provider:', user.app_metadata?.provider);
            console.log('[identity-signup] app_metadata:', JSON.stringify(user.app_metadata || {}));
            console.log('[identity-signup] user_metadata:', JSON.stringify(user.user_metadata || {}));
        } else {
            console.log('[identity-signup] No event body received');
            return { statusCode: 200, body: JSON.stringify({}) };
        }

        // If no email, just allow signup without Airtable sync
        if (!user.email) {
            console.log('[identity-signup] No email — allowing signup without Airtable sync');
            return buildResponse(user, { roles: ["user"] });
        }

        // Check environment vars for Airtable sync
        const { AIRTABLE_PAT, BASE_ID } = process.env;
        console.log('[identity-signup] AIRTABLE_PAT present:', !!AIRTABLE_PAT);
        console.log('[identity-signup] BASE_ID present:', !!BASE_ID);

        if (!AIRTABLE_PAT || !BASE_ID) {
            console.log('[identity-signup] Missing env vars — skipping Airtable sync');
            return buildResponse(user, { roles: ["user"] });
        }

        // Try to sync with Airtable — errors must not block signup
        try {
            console.log('[identity-signup] Starting Airtable sync for:', user.email);

            const filterFormula = encodeURIComponent(`{Email}="${user.email}"`);
            const findUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${filterFormula}`;

            const findRes = await nodeFetch(findUrl, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` },
                timeout: 6000 // 6s timeout to leave room before Netlify's 10s limit
            });

            console.log('[identity-signup] Airtable find status:', findRes.status);

            if (findRes.ok) {
                const existing = await findRes.json();
                const recordCount = existing.records?.length || 0;
                console.log('[identity-signup] Airtable records found:', recordCount);

                if (recordCount > 0) {
                    const existingId = existing.records[0].id;
                    console.log('[identity-signup] User already exists in Airtable:', existingId);
                    return buildResponse(user, {
                        airtable_user_id: existingId,
                        roles: ["user"]
                    });
                }

                // Create new user in Airtable
                const name = user.user_metadata?.full_name || user.email.split('@')[0];
                console.log('[identity-signup] Creating Airtable user — name:', name);

                const createRes = await nodeFetch(`https://api.airtable.com/v0/${BASE_ID}/Users`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${AIRTABLE_PAT}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        records: [{ fields: { Email: user.email, Name: name } }]
                    }),
                    timeout: 6000
                });

                console.log('[identity-signup] Airtable create status:', createRes.status);

                if (createRes.ok) {
                    const result = await createRes.json();
                    const newId = result.records?.[0]?.id;
                    console.log('[identity-signup] Created Airtable user:', newId);
                    return buildResponse(user, {
                        airtable_user_id: newId,
                        roles: ["user"]
                    });
                } else {
                    const errorText = await createRes.text();
                    console.error('[identity-signup] Airtable create error:', errorText);
                }
            } else {
                const errorText = await findRes.text();
                console.error('[identity-signup] Airtable find error:', errorText);
            }
        } catch (airtableErr) {
            console.error('[identity-signup] Airtable sync error:', airtableErr.name, '-', airtableErr.message);
            if (airtableErr.type === 'request-timeout') {
                console.error('[identity-signup] Airtable request timed out — proceeding without sync');
            }
        }

        // Fallback: always allow signup
        console.log('[identity-signup] ========== HANDLER SUCCESS (fallback) ==========');
        return buildResponse(user, { roles: ["user"] });

    } catch (err) {
        console.error('[identity-signup] ========== CRITICAL ERROR ==========');
        console.error('[identity-signup] Error:', err.name, '-', err.message);
        console.error('[identity-signup] Stack:', err.stack);
        // Always return 200 to avoid blocking signup
        return buildResponse(user, { roles: ["user"] });
    }
};

function buildResponse(user, additionalAppMeta = {}) {
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
    const body = JSON.stringify(responseUser);
    console.log('[identity-signup] Returning 200 — body length:', body.length);
    return { statusCode: 200, body };
}
