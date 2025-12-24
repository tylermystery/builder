// Netlify Identity login webhook handler
// This is triggered when a user logs in via Netlify Identity
// Reference: https://docs.netlify.com/security/secure-access-to-sites/identity/registration-login/

exports.handler = async (event, context) => {
    console.log('[identity-login] ========== HANDLER START ==========');

    let user = {};

    try {
        if (event.body) {
            const payload = JSON.parse(event.body);
            console.log('[identity-login] Event type:', payload.event);
            user = payload.user || {};
            console.log('[identity-login] User email:', user.email);
            console.log('[identity-login] User provider:', user.app_metadata?.provider);
        }

        // Return the user object to allow login to proceed
        console.log('[identity-login] ========== HANDLER SUCCESS ==========');
        return {
            statusCode: 200,
            body: JSON.stringify({
                ...user,
                app_metadata: {
                    ...(user.app_metadata || {}),
                    last_login: new Date().toISOString()
                },
                user_metadata: {
                    ...(user.user_metadata || {})
                }
            })
        };

    } catch (err) {
        console.error('[identity-login] Error:', err.message);
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
