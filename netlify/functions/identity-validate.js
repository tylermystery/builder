// Netlify Identity validate webhook handler
// This is triggered BEFORE a user signup is confirmed - for ALL signup methods including OAuth/SSO
//
// IMPORTANT: identity-signup only fires for email+password signups
// For external providers (Google, GitHub, etc.), identity-validate is the hook that fires.
//
// This function MUST return the user object to allow the signup to proceed.
// Reference: https://docs.netlify.com/security/secure-access-to-sites/identity/registration-login/

// Helper function to return a successful response
const successResponse = (userData = {}) => {
    console.log('[identity-validate] Returning success response');
    console.log('[identity-validate] Response user email:', userData?.email);
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
    };
};

exports.handler = async (event, context) => {
    try {
        console.log('[identity-validate] ========== VALIDATE WEBHOOK HANDLER START ==========');
        console.log('[identity-validate] Event method:', event.httpMethod);
        console.log('[identity-validate] Event body present:', !!event.body);

        if (!event.body) {
            console.log('[identity-validate] No body provided, allowing signup to proceed');
            return successResponse({});
        }

        let payload;
        try {
            payload = JSON.parse(event.body);
            console.log('[identity-validate] Parsed payload keys:', Object.keys(payload));
            console.log('[identity-validate] Event type:', payload.event);
        } catch (parseError) {
            console.error('[identity-validate] ERROR: Failed to parse event body:', parseError.message);
            // Return success to allow signup to proceed
            return successResponse({});
        }

        const userData = payload.user;

        if (!userData) {
            console.log('[identity-validate] No user data in payload, allowing signup');
            console.log('[identity-validate] Full payload:', JSON.stringify(payload, null, 2));
            return successResponse({});
        }

        console.log('[identity-validate] User data found:');
        console.log('[identity-validate] - Email:', userData.email);
        console.log('[identity-validate] - ID:', userData.id);
        console.log('[identity-validate] - Provider:', userData.app_metadata?.provider);
        console.log('[identity-validate] - Keys:', Object.keys(userData));

        // For validate, we just need to return the user object to allow signup to proceed
        // We can optionally add app_metadata or user_metadata here
        const responseUser = {
            ...userData,
            app_metadata: {
                ...(userData.app_metadata || {}),
                roles: ["user"],
                validated: true
            },
            user_metadata: {
                ...(userData.user_metadata || {})
            }
        };

        console.log('[identity-validate] ========== VALIDATE WEBHOOK HANDLER SUCCESS ==========');
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(responseUser)
        };

    } catch (outerError) {
        console.error('[identity-validate] ========== CRITICAL ERROR ==========');
        console.error('[identity-validate] Error name:', outerError.name);
        console.error('[identity-validate] Error message:', outerError.message);
        console.error('[identity-validate] Error stack:', outerError.stack);

        // Always return success to not block signup
        return successResponse({});
    }
};
