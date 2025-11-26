const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL } = process.env;

sgMail.setApiKey(SENDGRID_API_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { eventId, collaboratorName, collaboratorEmail, inviterName, planSummaryHtml } = JSON.parse(event.body);

    if (!eventId || !collaboratorEmail || !inviterName) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields.' }) };
    }

    // 1. Fetch Session to get Name
    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${eventId}`;
    const sessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    
    let sessionName = 'Event Plan';
    if (sessionResponse.ok) {
        const session = await sessionResponse.json();
        sessionName = session.fields.Name || 'Event Plan';
    }

    // 2. Fetch Recent Chat Messages
    // Formula: FIND('rec...', {SessionID_Rollup})
    const chatFormula = `FIND('${eventId}', {SessionID_Rollup})`;
    const chatUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages?filterByFormula=${encodeURIComponent(chatFormula)}&sort%5B0%5D%5Bfield%5D=Timestamp&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=5`;
    
    let chatHtml = '<p><em>No recent chat messages.</em></p>';
    
    try {
        const chatResponse = await fetch(chatUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (chatResponse.ok) {
            const chatData = await chatResponse.json();
            if (chatData.records && chatData.records.length > 0) {
                chatHtml = '<ul style="list-style: none; padding: 0;">';
                chatData.records.forEach(record => {
                    const { SenderName, Content, Timestamp } = record.fields;
                    chatHtml += `
                        <li style="margin-bottom: 10px; border-bottom: 1px solid #eee; padding-bottom: 5px;">
                            <strong>${SenderName || 'Unknown'}</strong>: ${Content}
                        </li>`;
                });
                chatHtml += '</ul>';
            }
        }
    } catch (e) {
        console.error('Error fetching chat for invite:', e);
    }

    // 3. Construct Email
    const baseUrl = SITE_URL || URL || 'https://whatthefunfinder.com';
    const link = `${baseUrl}/?session=${eventId}`;
    
    const emailContent = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>You're invited to collaborate!</h2>
            <p><strong>${inviterName}</strong> has invited you to collaborate on the event plan: <strong>${sessionName}</strong>.</p>
            
            <div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 5px;">
                <h3 style="margin-top: 0;">Plan Summary</h3>
                ${planSummaryHtml || '<p>No items in plan yet.</p>'}
            </div>

            <div style="margin: 20px 0;">
                <h3>Recent Chat Activity</h3>
                ${chatHtml}
            </div>

            <div style="text-align: center; margin-top: 30px;">
                <a href="${link}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">View & Edit Plan</a>
            </div>
            
            <p style="text-align: center; margin-top: 20px; font-size: 0.9em; color: #666;">
                <a href="${link}">${link}</a>
            </p>
        </div>
    `;

    const msg = {
      to: collaboratorEmail,
      from: 'info@tylersmysterytours.com', // Verified sender
      subject: `Invitation to edit: ${sessionName}`,
      html: emailContent,
    };

    await sgMail.send(msg);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Invitation sent successfully.' }),
    };

  } catch (error) {
    console.error('invite-collaborator error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
