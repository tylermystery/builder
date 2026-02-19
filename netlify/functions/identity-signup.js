// Netlify Identity signup webhook handler
// Triggered when a new user signs up via Netlify Identity (email+password or OAuth providers).
//
// CRITICAL: This function has a strict ~10 second timeout enforced by Netlify Identity.
// If it times out or returns a non-200 status, the signup is BLOCKED with:
//   "Failed to handle signup webhook" (422 error)
//
// Strategy: Return immediately with the user + roles. Do NOT make external API calls
// (Airtable sync, etc.) here — those are handled by auth-social.js after login.

exports.handler = async (event, context) => {
    const ts = new Date().toISOString();
    console.log(`[identity-signup] ========== HANDLER START (${ts}) ==========`);

    let user = {};

    try {
        if (!event.body) {
            console.log('[identity-signup] No body — returning 200 empty user');
            return { statusCode: 200, body: JSON.stringify({}) };
        }

        let payload;
        try {
            payload = JSON.parse(event.body);
        } catch (parseErr) {
            console.error('[identity-signup] JSON parse error:', parseErr.message);
            return { statusCode: 200, body: JSON.stringify({}) };
        }

        console.log('[identity-signup] event type:', payload.event);
        user = payload.user || {};
        console.log('[identity-signup] user.email:', user.email);
        console.log('[identity-signup] user.id:', user.id);
        console.log('[identity-signup] provider:', user.app_metadata?.provider);

        // Return the user immediately with "user" role — no external API calls.
        // Airtable user record creation is handled downstream by auth-social.js.
        const responseUser = {
            ...user,
            app_metadata: {
                ...(user.app_metadata || {}),
                roles: ["user"]
            },
            user_metadata: {
                ...(user.user_metadata || {})
            }
        };

        const body = JSON.stringify(responseUser);
        console.log('[identity-signup] Returning 200 — body length:', body.length);
        console.log(`[identity-signup] ========== HANDLER SUCCESS (${new Date().toISOString()}) ==========`);
        return { statusCode: 200, body };

    } catch (err) {
        console.error('[identity-signup] CRITICAL ERROR:', err.name, '-', err.message);
        // Always return 200 with whatever user data we have to avoid blocking signup
        return {
            statusCode: 200,
            body: JSON.stringify({
                ...user,
                app_metadata: { ...(user.app_metadata || {}), roles: ["user"] },
                user_metadata: { ...(user.user_metadata || {}) }
            })
        };
    }
};
