// FILE: netlify/functions/send-daily-digest.js
// Scheduled function - sends daily digest emails to users who opted for Digest notification frequency
// Runs daily at 9 AM UTC via Netlify Scheduled Functions

const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { DEFAULT_FROM } = require('./utils/email-config');

const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL: NETLIFY_URL } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

const USERS_TABLE = 'Users';
const SESSIONS_TABLE = 'Sessions';
const MESSAGES_TABLE = 'Messages';
const AIRTABLE_BASE = `https://api.airtable.com/v0/${BASE_ID}`;
const headers = { 'Authorization': `Bearer ${AIRTABLE_PAT}` };

exports.handler = async (event) => {
    console.log('[daily-digest] Starting daily digest processing...');

    try {
        // 1. Find all users with Digest notification frequency
        const digestUsersUrl = `${AIRTABLE_BASE}/${USERS_TABLE}?filterByFormula=${encodeURIComponent("{NotificationFrequency}='Digest'")}&fields[]=Name&fields[]=Email&fields[]=LastDigestSentAt`;
        const usersResponse = await fetch(digestUsersUrl, { headers });

        if (!usersResponse.ok) {
            throw new Error(`Failed to fetch digest users: ${usersResponse.status}`);
        }

        const { records: digestUsers } = await usersResponse.json();
        console.log(`[daily-digest] Found ${digestUsers.length} users with Digest preference`);

        if (digestUsers.length === 0) {
            return {
                statusCode: 200,
                body: JSON.stringify({ message: 'No users with digest preference.' })
            };
        }

        let emailsSent = 0;

        // 2. Process each user
        for (const user of digestUsers) {
            try {
                const userName = user.fields.Name || 'there';
                const userEmail = user.fields.Email;
                const lastDigest = user.fields.LastDigestSentAt || new Date(Date.now() - 86400000).toISOString(); // Default: 24h ago

                if (!userEmail) {
                    console.log(`[daily-digest] Skipping user ${user.id} - no email`);
                    continue;
                }

                // 3. Find sessions where this user is a collaborator
                const sessionsUrl = `${AIRTABLE_BASE}/${SESSIONS_TABLE}?filterByFormula=${encodeURIComponent(`FIND('${user.id}', ARRAYJOIN({Collaborators}))`)}&fields[]=Name&fields[]=Collaborators`;
                const sessionsResponse = await fetch(sessionsUrl, { headers });

                if (!sessionsResponse.ok) {
                    console.warn(`[daily-digest] Failed to fetch sessions for user ${user.id}`);
                    continue;
                }

                const { records: sessions } = await sessionsResponse.json();

                if (sessions.length === 0) {
                    console.log(`[daily-digest] No sessions found for user ${user.id}`);
                    continue;
                }

                // 4. Fetch recent messages for each session (since last digest)
                const sessionDigests = [];
                const sinceFilter = `IS_AFTER({Timestamp}, '${lastDigest}')`;

                for (const session of sessions) {
                    const sessionName = session.fields.Name || 'Unnamed Plan';
                    const messagesUrl = `${AIRTABLE_BASE}/${MESSAGES_TABLE}?filterByFormula=${encodeURIComponent(
                        `AND({SessionID}='${session.id}', ${sinceFilter}, {SenderID}!='${user.id}', {SenderID}!='system')`
                    )}&fields[]=Content&fields[]=SenderName&fields[]=SenderID&sort[0][field]=Timestamp&sort[0][direction]=desc&maxRecords=10`;

                    const messagesResponse = await fetch(messagesUrl, { headers });
                    if (!messagesResponse.ok) continue;

                    const { records: messages } = await messagesResponse.json();

                    if (messages.length > 0) {
                        // Count ideas vs regular messages
                        const ideas = messages.filter(m => (m.fields.Content || '').startsWith('[IDEA]'));
                        const chatMessages = messages.filter(m => !(m.fields.Content || '').startsWith('[IDEA]'));

                        sessionDigests.push({
                            sessionId: session.id,
                            sessionName,
                            messageCount: chatMessages.length,
                            ideaCount: ideas.length,
                            totalCount: messages.length,
                            previews: messages.slice(0, 3).map(m => ({
                                sender: m.fields.SenderName || 'Anonymous',
                                content: (m.fields.Content || '').replace(/^\[IDEA\]\s*/, '').substring(0, 100)
                            }))
                        });
                    }
                }

                if (sessionDigests.length === 0) {
                    console.log(`[daily-digest] No new activity for user ${user.id}`);
                    continue;
                }

                // 5. Build and send the digest email
                const baseUrl = SITE_URL || NETLIFY_URL;
                const totalActivity = sessionDigests.reduce((sum, s) => sum + s.totalCount, 0);

                const sessionSections = sessionDigests.map(digest => {
                    const viewUrl = `${baseUrl}/?session=${digest.sessionId}`;
                    const summary = [];
                    if (digest.messageCount > 0) summary.push(`${digest.messageCount} new message${digest.messageCount !== 1 ? 's' : ''}`);
                    if (digest.ideaCount > 0) summary.push(`${digest.ideaCount} new idea${digest.ideaCount !== 1 ? 's' : ''}`);

                    const previewsHtml = digest.previews.map(p =>
                        `<div style="padding: 6px 10px; margin: 4px 0; background: #f8f9fa; border-radius: 6px; font-size: 14px;">
                            <strong>${p.sender}:</strong> ${p.content}${p.content.length >= 100 ? '...' : ''}
                        </div>`
                    ).join('');

                    return `
                        <div style="margin-bottom: 20px; padding: 16px; background: #fff; border-radius: 10px; border: 1px solid #e9ecef;">
                            <h3 style="margin: 0 0 8px 0; color: #333; font-size: 15px;">${digest.sessionName}</h3>
                            <p style="margin: 0 0 10px 0; color: #6c757d; font-size: 13px;">${summary.join(', ')}</p>
                            ${previewsHtml}
                            <a href="${viewUrl}" style="display: inline-block; margin-top: 10px; padding: 8px 16px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-decoration: none; border-radius: 6px; font-size: 13px; font-weight: 500;">View Plan</a>
                        </div>
                    `;
                }).join('');

                const emailHtml = `
                    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f5f5f5;">
                        <div style="text-align: center; margin-bottom: 20px;">
                            <h2 style="color: #333; margin: 0;">Your Daily Activity Digest</h2>
                            <p style="color: #6c757d; font-size: 14px; margin-top: 4px;">${totalActivity} new update${totalActivity !== 1 ? 's' : ''} across ${sessionDigests.length} plan${sessionDigests.length !== 1 ? 's' : ''}</p>
                        </div>
                        ${sessionSections}
                        <p style="text-align: center; color: #999; font-size: 12px; margin-top: 24px;">
                            You're receiving this because your notification preference is set to Daily Digest.
                            <br>Update your preferences in your account settings.
                        </p>
                    </div>
                `;

                await sgMail.send({
                    to: userEmail,
                    from: DEFAULT_FROM,
                    subject: `Daily Digest: ${totalActivity} new update${totalActivity !== 1 ? 's' : ''} in your plans`,
                    html: emailHtml
                });

                emailsSent++;
                console.log(`[daily-digest] Sent digest to ${userEmail} (${sessionDigests.length} plans, ${totalActivity} updates)`);

                // 6. Update LastDigestSentAt for this user
                await fetch(`${AIRTABLE_BASE}/${USERS_TABLE}/${user.id}`, {
                    method: 'PATCH',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fields: { LastDigestSentAt: new Date().toISOString() }
                    })
                });

            } catch (userError) {
                console.error(`[daily-digest] Error processing user ${user.id}:`, userError.message);
            }
        }

        console.log(`[daily-digest] Completed. Sent ${emailsSent} digest emails.`);

        return {
            statusCode: 200,
            body: JSON.stringify({
                message: `Sent ${emailsSent} digest emails to ${digestUsers.length} users.`
            })
        };

    } catch (error) {
        console.error('[daily-digest] Fatal error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
