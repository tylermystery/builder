const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');
const { DEFAULT_FROM } = require('./utils/email-config');
const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY } = process.env;

// Debug: Log environment variable availability at cold start
console.log('[auth-start] Cold start - checking env vars:', {
    hasAirtablePat: !!AIRTABLE_PAT,
    hasBaseId: !!BASE_ID,
    hasSendgridKey: !!SENDGRID_API_KEY,
    baseIdPrefix: BASE_ID ? BASE_ID.substring(0, 6) + '...' : 'missing'
});

if (SENDGRID_API_KEY) {
    sgMail.setApiKey(SENDGRID_API_KEY);
}

exports.handler = async (event) => {
    console.log('[auth-start] Function invoked, method:', event.httpMethod);

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // Validate environment variables are present
        if (!AIRTABLE_PAT || !BASE_ID || !SENDGRID_API_KEY) {
            console.error('[auth-start] Missing required environment variables:', {
                hasAirtablePat: !!AIRTABLE_PAT,
                hasBaseId: !!BASE_ID,
                hasSendgridKey: !!SENDGRID_API_KEY
            });
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Server configuration error. Please contact support.' })
            };
        }

        console.log('[auth-start] Parsing request body');
        const { email, siteUrl } = JSON.parse(event.body);
        console.log('[auth-start] Parsed request - email:', email ? email.substring(0, 3) + '***' : 'missing', 'siteUrl:', siteUrl);

        if (!email) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email is required.' }) };
        }

        const token = crypto.randomBytes(16).toString('hex');
        const channelId = crypto.randomBytes(12).toString('hex'); // Unique ID for the real-time channel
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // Token expires in 15 minutes

        console.log('[auth-start] Generated token and channelId, storing in Airtable');

        // Store the token and the new channelId in Airtable
        const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links`;
        console.log('[auth-start] Airtable URL:', airtableUrl.replace(BASE_ID, 'BASE_ID'));

        const airtablePayload = {
            records: [{ fields: { Token: token, Email: email, ExpiresAt: expiresAt.toISOString(), ChannelID: channelId } }]
        };
        console.log('[auth-start] Airtable payload fields:', Object.keys(airtablePayload.records[0].fields));

        const airtableResponse = await fetch(airtableUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(airtablePayload)
        });

        console.log('[auth-start] Airtable response status:', airtableResponse.status);

        if (!airtableResponse.ok) {
            const airtableError = await airtableResponse.json();
            console.error('[auth-start] Airtable error details:', JSON.stringify(airtableError));
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Could not create magic link. Please try again.' })
            };
        }

        const airtableData = await airtableResponse.json();
        console.log('[auth-start] Airtable record created, id:', airtableData.records?.[0]?.id);

        // The confirmation link now points to a new 'auth-confirm' function
        const confirmationLink = `${siteUrl}/.netlify/functions/auth-confirm?token=${token}`;
        console.log('[auth-start] Generated confirmation link (host only):', new URL(confirmationLink).host);

        const msg = {
            to: email,
            from: DEFAULT_FROM,
            subject: 'Confirm Your Sign-In for WhatTheFun',
            html: `<p>Hello!</p><p>Please click the link below to confirm your sign-in attempt. This link will expire in 15 minutes.</p><p><a href="${confirmationLink}">Confirm Sign-In</a></p>`,
        };

        console.log('[auth-start] Sending email via SendGrid to:', email.substring(0, 3) + '***');

        try {
            console.log('[auth-start] About to call sgMail.send with msg:', {
                to: msg.to ? msg.to.substring(0, 3) + '***' : 'missing',
                from: msg.from,
                subject: msg.subject
            });
            const sendResult = await sgMail.send(msg);
            console.log('[auth-start] Email sent successfully, result:', JSON.stringify(sendResult));
        } catch (sendgridError) {
            // Comprehensive SendGrid error logging
            console.error('[auth-start] SendGrid error occurred');
            console.error('[auth-start] Error name:', sendgridError.name);
            console.error('[auth-start] Error message:', sendgridError.message);
            console.error('[auth-start] Error code:', sendgridError.code);
            console.error('[auth-start] Error stack:', sendgridError.stack);

            // SendGrid specific error details
            if (sendgridError.response) {
                console.error('[auth-start] SendGrid response status:', sendgridError.response.statusCode);
                console.error('[auth-start] SendGrid response headers:', JSON.stringify(sendgridError.response.headers));
                console.error('[auth-start] SendGrid response body:', JSON.stringify(sendgridError.response.body));
            }

            // Extract a user-friendly error message
            let userErrorMessage = 'Failed to send confirmation email. Please try again.';
            if (sendgridError.response?.body?.errors) {
                const errors = sendgridError.response.body.errors;
                console.error('[auth-start] SendGrid specific errors:', JSON.stringify(errors));
                if (errors[0]?.message) {
                    // Log the specific error but don't expose it to the user
                    console.error('[auth-start] First error message:', errors[0].message);
                }
            }

            return {
                statusCode: 500,
                body: JSON.stringify({ error: userErrorMessage })
            };
        }

        // Return the channelId to the browser so it can listen for the confirmation
        console.log('[auth-start] Returning success response with channelId');
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Confirmation email sent.', channelId: channelId }),
        };
    } catch (error) {
        console.error('[auth-start] Unexpected error:', {
            name: error.name,
            message: error.message,
            stack: error.stack
        });
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'An internal error occurred. Please try again.' }),
        };
    }
};
