// FILE: netlify/functions/send-invite.js
// Sends email invitations to collaborate on a plan using tokenized invite links

const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const crypto = require('crypto');
const { buildFrom, fetchStoreName } = require('./utils/email-config');

const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL: NETLIFY_URL } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { email, sessionId, invitedBy, inviterName, role, sessionName, storeId } = JSON.parse(event.body);

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

        // Cap role to editor max (prevent URL tampering to owner)
        const assignedRole = (role === 'viewer') ? 'Viewer' : 'Editor';

        // Generate a secure invite token and store in Netlify Blobs
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const { getStore } = require('@netlify/blobs');
        const store = getStore({ name: 'invite-tokens', consistency: 'strong' });
        await store.setJSON(token, {
            token,
            sessionId,
            email,
            role: assignedRole.toLowerCase(),
            invitedBy: invitedBy || '',
            inviterName: inviterName || '',
            sessionName: sessionName || '',
            createdAt: new Date().toISOString(),
            expiresAt,
            consumed: false
        });

        const baseUrl = SITE_URL || NETLIFY_URL;
        // Use tokenized invite link — no sensitive data in URL
        const inviteLink = `${baseUrl}/?invite_token=${token}`;
        const planName = sessionName || 'an event plan';
        const senderName = inviterName || 'Someone';

        // Resolve store name for dynamic sender
        const storeName = await fetchStoreName(storeId);
        const emailFrom = buildFrom(storeName);

        // Send the invitation email
        const msg = {
            to: email,
            from: emailFrom,
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
                        Click the button above to view the plan and sign in to collaborate in real time.
                    </p>
                </div>
            `
        };

        await sgMail.send(msg);

        console.log(`[send-invite] Invitation sent to ${email} for session ${sessionId} as ${assignedRole} by ${invitedBy || senderName}`);

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
