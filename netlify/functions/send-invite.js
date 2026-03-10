// FILE: netlify/functions/send-invite.js
// Sends email invitations to collaborate on a plan

const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');

const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL: NETLIFY_URL } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { email, sessionId, invitedBy, inviterName, role, sessionName } = JSON.parse(event.body);

        if (!email || !sessionId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Email and sessionId are required.' })
            };
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid email address.' })
            };
        }

        const baseUrl = SITE_URL || NETLIFY_URL;
        const inviteLink = `${baseUrl}/?session=${sessionId}&invite=true`;
        const planName = sessionName || 'an event plan';
        const senderName = inviterName || 'Someone';
        const assignedRole = role || 'Editor';

        // Send the invitation email
        const msg = {
            to: email,
            from: 'info@tylersmysterytours.com',
            subject: `${senderName} invited you to collaborate on "${planName}"`,
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h2 style="color: #333; margin: 0;">You're Invited!</h2>
                    </div>
                    <p style="color: #555; font-size: 16px; line-height: 1.5;">
                        <strong>${senderName}</strong> has invited you to collaborate on <strong>"${planName}"</strong> as a <strong>${assignedRole}</strong>.
                    </p>
                    <p style="color: #555; font-size: 15px; line-height: 1.5;">
                        ${assignedRole === 'Editor'
                            ? 'You\'ll be able to add ideas, comment, react, and help shape the plan.'
                            : 'You\'ll be able to view the plan, comment, and react to items.'}
                    </p>
                    <div style="text-align: center; margin: 32px 0;">
                        <a href="${inviteLink}" style="display: inline-block; padding: 14px 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
                            View & Join the Plan
                        </a>
                    </div>
                    <p style="color: #999; font-size: 13px; text-align: center;">
                        Sign in to collaborate. Your ideas and feedback will be shared with the team in real time.
                    </p>
                </div>
            `
        };

        await sgMail.send(msg);

        console.log(`[send-invite] Invitation sent to ${email} for session ${sessionId} by ${invitedBy}`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: `Invitation sent to ${email}`
            })
        };

    } catch (error) {
        console.error('[send-invite] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
