// Netlify Identity signup webhook handler
// This is triggered when a new user signs up via Netlify Identity (email+password only)
// Note: For OAuth/external providers (Google, GitHub, etc.), use identity-validate instead.
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
    return {
        statusCode: 200,
        body: JSON.stringify(responseUser)
    };
};

exports.handler = async (event, context) => {
    console.log('[identity-signup] ========== HANDLER START ==========');

    // Default user object for fallback responses
    let user = {};

    try {
        // Parse event body
        if (event.body) {
            const payload = JSON.parse(event.body);
            console.log('[identity-signup] Event type:', payload.event);
            user = payload.user || {};
            console.log('[identity-signup] User email:', user.email);
            console.log('[identity-signup] User provider:', user.app_metadata?.provider);
        }

        // If no user data, just allow signup
        if (!user.email) {
            console.log('[identity-signup] No email in user data, allowing signup');
            return createResponse(user, { roles: ["user"] });
        }

        // Skip Airtable sync if env vars or fetch missing
        const { AIRTABLE_PAT, BASE_ID } = process.env;
        if (!AIRTABLE_PAT || !BASE_ID || !fetchFn) {
            console.log('[identity-signup] Skipping Airtable sync (missing env/fetch)');
            return createResponse(user, { roles: ["user"] });
        }

        // Try to sync with Airtable (non-blocking - errors don't fail signup)
        try {
            const filterFormula = encodeURIComponent(`{Email}="${user.email}"`);
            const findUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${filterFormula}`;

            const findRes = await fetchFn(findUrl, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });

            if (findRes.ok) {
                const existing = await findRes.json();

                if (existing.records?.length > 0) {
                    console.log('[identity-signup] User exists in Airtable:', existing.records[0].id);
                    return createResponse(user, {
                        airtable_user_id: existing.records[0].id,
                        roles: ["user"]
                    });
                }

                // Create new user in Airtable
                const name = user.user_metadata?.full_name || user.email.split('@')[0];
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

                if (createRes.ok) {
                    const result = await createRes.json();
                    const newId = result.records?.[0]?.id;
                    console.log('[identity-signup] Created user in Airtable:', newId);
                    return createResponse(user, {
                        airtable_user_id: newId,
                        roles: ["user"]
                    });
                }
            }
        } catch (airtableErr) {
            console.error('[identity-signup] Airtable error:', airtableErr.message);
        }

        // Always return success to allow signup
        console.log('[identity-signup] ========== HANDLER SUCCESS ==========');
        return createResponse(user, { roles: ["user"] });

    } catch (err) {
        console.error('[identity-signup] Error:', err.message);
        // Return success with whatever user data we have
        return createResponse(user, { roles: ["user"] });
    }
};
