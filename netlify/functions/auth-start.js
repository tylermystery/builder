const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');
const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { email, siteUrl } = JSON.parse(event.body);
        if (!email) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Email is required.' }) };
        }

        const token = crypto.randomBytes(16).toString('hex');
        const channelId = crypto.randomBytes(12).toString('hex'); // Unique ID for the real-time channel
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // Token expires in 15 minutes

        // Store the token and the new channelId in Airtable
        const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links`;
        const airtableResponse = await fetch(airtableUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                records: [{ fields: { Token: token, Email: email, ExpiresAt: expiresAt.toISOString(), ChannelID: channelId } }]
            })
        });

        if (!airtableResponse.ok) {
            console.error('Airtable error:', await airtableResponse.json());
            throw new Error('Could not create magic link in database.');
        }

        // The confirmation link now points to a new 'auth-confirm' function
        const confirmationLink = `${siteUrl}/.netlify/functions/auth-confirm?token=${token}`;
        const msg = {
            to: email,
            from: 'info@tylersmysterytours.com', // Replace with your verified sender
            subject: 'Confirm Your Sign-In for TMT Shop',
            html: `<p>Hello!</p><p>Please click the link below to confirm your sign-in attempt. This link will expire in 15 minutes.</p><p><a href="${confirmationLink}">Confirm Sign-In</a></p>`,
        };
        
        await sgMail.send(msg);

        // Return the channelId to the browser so it can listen for the confirmation
        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Confirmation email sent.', channelId: channelId }),
        };
    } catch (error) {
        console.error('Auth-start error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'An internal error occurred.' }),
        };
    }
};
