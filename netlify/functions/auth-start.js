// PASTE THIS ENTIRE CODE INTO: netlify/functions/auth-start.js
const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');

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

        // Generate a simple, secure token
        const token = require('crypto').randomBytes(16).toString('hex');
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // Token expires in 15 minutes

        // Store the token in Airtable
        const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/Magic%20Links`;
        const airtableResponse = await fetch(airtableUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                records: [{ fields: { Token: token, Email: email, ExpiresAt: expiresAt.toISOString() } }]
            })
        });

        if (!airtableResponse.ok) {
            console.error('Airtable error:', await airtableResponse.json());
            throw new Error('Could not create magic link in database.');
        }

        // Send the magic link email via SendGrid
        const signInLink = `${siteUrl}?token=${token}`;
        const msg = {
            to: email,
            from: 'tyler@tylersmysterytours.com', // Use an email you have verified with SendGrid
            subject: 'Your Sign-In Link for TMT Shop',
            html: `<p>Hello!</p><p>Click the link below to sign in to your TMT Shop account. This link will expire in 15 minutes.</p><p><a href="${signInLink}">Sign In</a></p>`,
        };
        
        await sgMail.send(msg);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Magic link sent successfully.' }),
        };

    } catch (error) {
        console.error('Auth-start error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'An internal error occurred.' }),
        };
    }
};
