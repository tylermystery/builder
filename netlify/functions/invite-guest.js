const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL } = process.env;

sgMail.setApiKey(SENDGRID_API_KEY);

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { sessionId, guestName, guestEmail, hostName, eventName, eventDate, planSummaryHtml } = JSON.parse(event.body);

        if (!sessionId || !guestEmail || !hostName) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields.' }) };
        }

        // 1. Fetch Session to get additional details if needed
        const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;
        const sessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        let sessionName = eventName || 'Event';
        let sessionDate = eventDate;

        if (sessionResponse.ok) {
            const session = await sessionResponse.json();
            sessionName = eventName || session.fields.Name || 'Event';
            sessionDate = eventDate || session.fields.Date;
        }

        // Format the date nicely if available
        let formattedDate = '';
        if (sessionDate) {
            const date = new Date(sessionDate);
            formattedDate = date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
        }

        // 2. Construct Email
        const baseUrl = SITE_URL || URL || 'https://whatthefunfinder.com';
        // Link to the invitee page (read-only guest view)
        const link = `${baseUrl}/invitee.html?session=${sessionId}`;

        const emailContent = `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">You're Invited!</h2>
                <p>Hi ${guestName || 'there'},</p>
                <p><strong>${hostName}</strong> has invited you to: <strong>${sessionName}</strong>!</p>

                ${formattedDate ? `
                <div style="margin: 20px 0; padding: 15px; background-color: #e7f3ff; border-radius: 8px; text-align: center;">
                    <p style="margin: 0; font-size: 0.9em; color: #666;">Event Date</p>
                    <p style="margin: 5px 0 0 0; font-size: 1.3em; font-weight: 600; color: #007bff;">${formattedDate}</p>
                </div>
                ` : ''}

                <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
                    <h3 style="margin-top: 0; color: #333;">What's Planned</h3>
                    ${planSummaryHtml || '<p>Details coming soon!</p>'}
                </div>

                <div style="text-align: center; margin-top: 30px;">
                    <a href="${link}" style="background-color: #28a745; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 1.1em;">View Event Details</a>
                </div>

                <p style="text-align: center; margin-top: 20px; font-size: 0.85em; color: #666;">
                    You can also chat with other guests on the event page!
                </p>

                <p style="text-align: center; margin-top: 10px; font-size: 0.8em; color: #999;">
                    <a href="${link}" style="color: #999;">${link}</a>
                </p>

                <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

                <p style="text-align: center; font-size: 0.8em; color: #999;">
                    Powered by WTFun - Event Planning Made Easy
                </p>
            </div>
        `;

        const msg = {
            to: guestEmail,
            from: 'info@tylersmysterytours.com', // Verified sender
            subject: `You're invited to: ${sessionName}`,
            html: emailContent,
        };

        await sgMail.send(msg);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Guest invitation sent successfully.' }),
        };

    } catch (error) {
        console.error('invite-guest error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message }),
        };
    }
};
