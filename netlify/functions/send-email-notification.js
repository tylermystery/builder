
const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');

const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL } = process.env;
sgMail.setApiKey(SENDGRID_API_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { recordId } = JSON.parse(event.body);
    if (!recordId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Message Record ID is required.' }) };
    }

    // 1. Fetch the new message from Airtable
    const messageUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages/${recordId}`;
    const messageResponse = await fetch(messageUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!messageResponse.ok) throw new Error('Failed to fetch message from Airtable.');
    const message = await messageResponse.json();
    const { Content, SenderName, SessionID, SenderID } = message.fields;
    const sessionId = SessionID[0];

    // 2. Fetch the session to find the collaborators (users) and the session name
    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;
    const sessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!sessionResponse.ok) throw new Error('Failed to fetch session from Airtable.');
    const session = await sessionResponse.json();
    const sessionName = session.fields.Name || 'your event plan';

    const collaboratorIds = session.fields.Collaborators;
    if (!collaboratorIds || collaboratorIds.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No collaborators to notify.' }) };
    }

    // 3. Fetch user records to get their notification preferences and email addresses
    const formula = `OR(${collaboratorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const usersUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${encodeURIComponent(formula)}`;
    const usersResponse = await fetch(usersUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!usersResponse.ok) throw new Error('Failed to fetch users from Airtable.');
    const { records: users } = await usersResponse.json();

    // 4. Filter for users who want real-time notifications and didn't send the message
    const notificationsToSend = users
      .filter(user => 
        user.fields.NotificationFrequency === 'Real-Time' && 
        user.fields.Email &&
        user.id !== SenderID
      )
      .map(user => {
        const viewPlanUrl = `${SITE_URL}/?session=${sessionId}`;
        const msg = {
          to: user.fields.Email,
          from: 'info@tylersmysterytours.com', // Your verified SendGrid sender
          subject: `New Message in your plan: "${sessionName}"`,
          html: `
            <p>Hi ${user.fields.Name},</p>
            <p>You have a new message from <strong>${SenderName}</strong> in your event plan, "${sessionName}":</p>
            <p style="padding: 12px; border-left: 4px solid #ccc; background: #f4f4f4;"><em>"${Content}"</em></p>
            <p><a href="${viewPlanUrl}">Click here to view the plan and reply.</a></p>
          `,
        };
        return sgMail.send(msg);
      });

    await Promise.all(notificationsToSend);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Sent ${notificationsToSend.length} email notifications.` }),
    };
  } catch (error) {
    console.error('Send-email-notification error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
