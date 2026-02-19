// Netlify Identity login webhook handler
// This is triggered when a user logs in via Netlify Identity (including Google OAuth returning users)
// Reference: https://docs.netlify.com/security/secure-access-to-sites/identity/registration-login/

exports.handler = async (event, context) => {
    const ts = new Date().toISOString();
    console.log(`[identity-login] ========== HANDLER START (${ts}) ==========`);
    console.log('[identity-login] httpMethod:', event.httpMethod);
    console.log('[identity-login] body present:', !!event.body);
    console.log('[identity-login] body length:', event.body ? event.body.length : 0);

    let user = {};

    try {
        if (event.body) {
            let payload;
            try {
                payload = JSON.parse(event.body);
            } catch (parseError) {
                console.error('[identity-login] JSON parse error:', parseError.message);
                return { statusCode: 200, body: JSON.stringify({}) };
            }

            console.log('[identity-login] event type:', payload.event);
            user = payload.user || {};
            console.log('[identity-login] user.email:', user.email);
            console.log('[identity-login] user.id:', user.id);
            console.log('[identity-login] provider:', user.app_metadata?.provider);
            console.log('[identity-login] app_metadata:', JSON.stringify(user.app_metadata || {}));
            console.log('[identity-login] user_metadata:', JSON.stringify(user.user_metadata || {}));
        } else {
            console.log('[identity-login] No body received');
        }

        // Return the user object to allow login to proceed
        const responseUser = {
            ...user,
            app_metadata: {
                ...(user.app_metadata || {}),
                last_login: ts
            },
            user_metadata: {
                ...(user.user_metadata || {})
            }
        };

        const body = JSON.stringify(responseUser);
        console.log('[identity-login] Returning 200 — body length:', body.length);
        console.log('[identity-login] ========== HANDLER SUCCESS ==========');
        return { statusCode: 200, body };

    } catch (err) {
        console.error('[identity-login] ========== ERROR ==========');
        console.error('[identity-login] Error:', err.name, '-', err.message);
        console.error('[identity-login] Stack:', err.stack);
        // Return success with whatever user data we have
        return {
            statusCode: 200,
            body: JSON.stringify({
                ...user,
                app_metadata: user.app_metadata || {},
                user_metadata: user.user_metadata || {}
            })
        };
    }
};
