const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');
const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    // Validate environment variables
    if (!AIRTABLE_PAT || !BASE_ID || !SENDGRID_API_KEY) {
        console.error('Auth-start error: Missing required environment variables');
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Server configuration error' })
        };
    }

    try {
        let body;
        try {
            body = JSON.parse(event.body);
        } catch (parseError) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid JSON in request body' })
            };
        }

        const { email, siteUrl } = body;

        // Validate required fields
        if (!email || typeof email !== 'string') {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Email is required and must be a string' })
            };
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Invalid email format' })
            };
        }

        const token = crypto.randomBytes(16).toString('hex');
        const channelId = crypto.randomBytes(12).toString('hex'); // Unique ID for the real-time channel
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // Token expires in 15 minutes

        // Store the token and the new channelId in Airtable
        const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links`;

        // Add timeout to prevent hanging requests
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        const airtableResponse = await fetch(airtableUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                records: [{ fields: { Token: token, Email: email, ExpiresAt: expiresAt.toISOString(), ChannelID: channelId } }]
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!airtableResponse.ok) {
            const errorData = await airtableResponse.json();
            console.error('Airtable error:', errorData);
            throw new Error('Could not create magic link in database.');
        }

        // The confirmation link now points to a new 'auth-confirm' function
        const confirmationLink = `${siteUrl}/.netlify/functions/auth-confirm?token=${token}`;
        const msg = {
            to: email,
            from: 'info@tylersmysterytours.com',
            subject: 'Confirm Your Sign-In for TMT Shop',
            html: `<p>Hello!</p><p>Please click the link below to confirm your sign-in attempt. This link will expire in 15 minutes.</p><p><a href="${confirmationLink}">Confirm Sign-In</a></p>`,
        };

        await sgMail.send(msg);

        // Return the channelId to the browser so it can listen for the confirmation
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Confirmation email sent.', channelId: channelId }),
        };
    } catch (error) {
        console.error('Auth-start error:', error);

        // Handle specific error types
        if (error.name === 'AbortError') {
            return {
                statusCode: 504,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Request timeout' })
            };
        }

        // Handle SendGrid errors
        if (error.code && error.code >= 400) {
            return {
                statusCode: 500,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Failed to send email. Please try again.' })
            };
        }

        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'An internal error occurred.' }),
        };
    }
};
