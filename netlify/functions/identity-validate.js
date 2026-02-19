// Netlify Identity validate webhook handler
// This is triggered BEFORE a user signup is confirmed - for ALL signup methods including OAuth/SSO
//
// IMPORTANT: For external providers (Google, GitHub, etc.), identity-validate is the hook that fires.
// This function MUST return a 200 with the user object to allow the signup to proceed.
// Reference: https://docs.netlify.com/security/secure-access-to-sites/identity/registration-login/

exports.handler = async (event, context) => {
    const ts = new Date().toISOString();
    console.log(`[identity-validate] ========== HANDLER START (${ts}) ==========`);
    console.log('[identity-validate] httpMethod:', event.httpMethod);
    console.log('[identity-validate] body present:', !!event.body);
    console.log('[identity-validate] body length:', event.body ? event.body.length : 0);

    try {
        if (!event.body) {
            console.log('[identity-validate] No body — returning 200 with empty object');
            return { statusCode: 200, body: JSON.stringify({}) };
        }

        let payload;
        try {
            payload = JSON.parse(event.body);
        } catch (parseError) {
            console.error('[identity-validate] JSON parse error:', parseError.message);
            console.error('[identity-validate] Raw body (first 300 chars):', event.body.substring(0, 300));
            return { statusCode: 200, body: JSON.stringify({}) };
        }

        console.log('[identity-validate] event type:', payload.event);
        const user = payload.user;

        if (!user) {
            console.log('[identity-validate] No user in payload — returning 200 empty');
            return { statusCode: 200, body: JSON.stringify({}) };
        }

        console.log('[identity-validate] user.email:', user.email);
        console.log('[identity-validate] user.id:', user.id);
        console.log('[identity-validate] provider:', user.app_metadata?.provider);
        console.log('[identity-validate] app_metadata:', JSON.stringify(user.app_metadata || {}));
        console.log('[identity-validate] user_metadata:', JSON.stringify(user.user_metadata || {}));

        // Build response: return the user with optional metadata additions
        const responseUser = {
            ...user,
            app_metadata: {
                ...(user.app_metadata || {}),
                roles: ["user"],
                validated: true
            },
            user_metadata: {
                ...(user.user_metadata || {})
            }
        };

        const body = JSON.stringify(responseUser);
        console.log('[identity-validate] Returning 200 — body length:', body.length);
        console.log('[identity-validate] ========== HANDLER SUCCESS ==========');
        return { statusCode: 200, body };

    } catch (err) {
        console.error('[identity-validate] ========== CRITICAL ERROR ==========');
        console.error('[identity-validate] Error:', err.name, '-', err.message);
        console.error('[identity-validate] Stack:', err.stack);
        // Always return 200 to avoid blocking signup
        return { statusCode: 200, body: JSON.stringify({}) };
    }
};
