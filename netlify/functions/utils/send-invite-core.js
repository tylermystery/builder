// FILE: netlify/functions/utils/send-invite-core.js
// Sends email invitations to collaborate on a plan using tokenized invite links.
// The caller passes in the invite-token Blobs store.

const sgMail = require('@sendgrid/mail');
const { buildFrom, fetchStoreName } = require('./email-config');
const { loadPlanSnapshot, buildSnapshotEmailParts } = require('./plan-snapshot-email');
const { escapeHtml } = require('./checkout-emails');
const { createInviteToken } = require('./invite-tokens');

async function sendInvite(store, rawBody) {
    const { SENDGRID_API_KEY, SITE_URL, URL: NETLIFY_URL } = process.env;
    sgMail.setApiKey(SENDGRID_API_KEY);

    try {
        const { email, sessionId, invitedBy, inviterName, role, sessionName, storeId } = JSON.parse(rawBody);

        if (!email || !sessionId) {
            return { statusCode: 400, body: { error: 'Email and sessionId are required.' } };
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return { statusCode: 400, body: { error: 'Invalid email address.' } };
        }

        // Cap role to editor max (prevent URL tampering to owner)
        const assignedRole = (role === 'viewer') ? 'Viewer' : 'Editor';

        // Load the saved plan before creating or sending the invitation.
        const snapshotData = await loadPlanSnapshot(sessionId);
        const snapshot = buildSnapshotEmailParts(snapshotData);

        const { token } = await createInviteToken(store, {
            sessionId, email, role: assignedRole.toLowerCase(), invitedBy, inviterName, sessionName
        });

        const baseUrl = SITE_URL || NETLIFY_URL;
        // Tokenized invite link — email and role stay server-side. The plan ID (already
        // public in share links) is included so the page opens the plan and reads the token.
        const inviteLink = `${baseUrl}/?session=${encodeURIComponent(sessionId)}&invite_token=${token}`;
        const planName = snapshotData.plan.name || sessionName || 'an event plan';
        const senderName = inviterName || 'Someone';

        // Resolve store name for dynamic sender
        const storeName = await fetchStoreName(snapshotData.storeId || storeId);
        const emailFrom = buildFrom(storeName);

        // Send the invitation email
        const msg = {
            to: email,
            from: emailFrom,
            subject: `${senderName} invited you to collaborate on "${planName}"`,
            text: `${senderName} invited you to collaborate on "${planName}" as ${assignedRole}.\n\n${snapshot.text}\n\nView & join the plan: ${inviteLink}`,
            ...(snapshot.attachments ? { attachments: snapshot.attachments } : {}),
            html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h2 style="color: #333; margin: 0;">You're Invited!</h2>
                    </div>
                    <p style="color: #555; font-size: 16px; line-height: 1.5;">
                        <strong>${escapeHtml(senderName)}</strong> has invited you to collaborate on <strong>"${escapeHtml(planName)}"</strong> as a <strong>${assignedRole}</strong>.
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
                ${snapshot.html}
            `
        };

        await sgMail.send(msg);

        console.log(`[send-invite] Invitation sent to ${email} for session ${sessionId} as ${assignedRole} by ${invitedBy || senderName}`);

        return { statusCode: 200, body: { success: true, message: `Invitation sent to ${email}` } };
    } catch (error) {
        console.error('[send-invite] Error:', error);
        return { statusCode: 500, body: { error: error.message } };
    }
}

module.exports = { sendInvite };
