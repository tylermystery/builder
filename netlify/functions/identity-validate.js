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
    console.log('[identity-validate] successResponse called');
    console.log('[identity-validate] Input user data keys:', userData ? Object.keys(userData) : 'null');
    console.log('[identity-validate] Response user email:', userData?.email);

    const response = {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
    };

    console.log('[identity-validate] Final response statusCode:', response.statusCode);
    console.log('[identity-validate] Final response body length:', response.body.length);

    return response;
};

exports.handler = async (event, context) => {
    try {
        console.log('[identity-validate] ========== VALIDATE WEBHOOK HANDLER START ==========');
        console.log('[identity-validate] Timestamp:', new Date().toISOString());
        console.log('[identity-validate] Event method:', event.httpMethod);
        console.log('[identity-validate] Event body present:', !!event.body);
        console.log('[identity-validate] Event body length:', event.body ? event.body.length : 0);
        console.log('[identity-validate] Event headers:', JSON.stringify(event.headers || {}));
        console.log('[identity-validate] Context keys:', context ? Object.keys(context) : 'null');

        if (!event.body) {
            console.log('[identity-validate] No body provided, allowing signup to proceed');
            return successResponse({});
        }

        let payload;
        try {
            payload = JSON.parse(event.body);
            console.log('[identity-validate] Parsed payload keys:', Object.keys(payload));
            console.log('[identity-validate] Event type:', payload.event);
            console.log('[identity-validate] Full payload:', JSON.stringify(payload, null, 2));
        } catch (parseError) {
            console.error('[identity-validate] ERROR: Failed to parse event body:', parseError.message);
            console.error('[identity-validate] Raw event body (first 500 chars):', event.body.substring(0, 500));
            // Return success to allow signup to proceed
            return successResponse({});
        }

        const userData = payload.user;

        if (!userData) {
            console.log('[identity-validate] No user data in payload, allowing signup');
            return successResponse({});
        }

        console.log('[identity-validate] User data found:');
        console.log('[identity-validate] - Email:', userData.email);
        console.log('[identity-validate] - ID:', userData.id);
        console.log('[identity-validate] - Provider:', userData.app_metadata?.provider);
        console.log('[identity-validate] - app_metadata:', JSON.stringify(userData.app_metadata || {}));
        console.log('[identity-validate] - user_metadata:', JSON.stringify(userData.user_metadata || {}));
        console.log('[identity-validate] - All keys:', Object.keys(userData));

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

        console.log('[identity-validate] Response user object constructed');
        console.log('[identity-validate] Response user keys:', Object.keys(responseUser));
        console.log('[identity-validate] Response user app_metadata:', JSON.stringify(responseUser.app_metadata));

        console.log('[identity-validate] ========== VALIDATE WEBHOOK HANDLER SUCCESS ==========');
        const finalResponse = {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(responseUser)
        };
        console.log('[identity-validate] Final response body length:', finalResponse.body.length);
        return finalResponse;

    } catch (outerError) {
        console.error('[identity-validate] ========== CRITICAL ERROR ==========');
        console.error('[identity-validate] Error name:', outerError.name);
        console.error('[identity-validate] Error message:', outerError.message);
        console.error('[identity-validate] Error stack:', outerError.stack);

        // Always return success to not block signup
        return successResponse({});
    }
};
