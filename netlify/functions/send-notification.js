// REPLACE THE ENTIRE CONTENTS OF: netlify/functions/send-notification.js

const fetch = require('node-fetch');
const twilio = require('twilio');
const { 
  AIRTABLE_PAT, 
  BASE_ID, 
  TWILIO_ACCOUNT_SID, 
  TWILIO_AUTH_TOKEN, 
  TWILIO_PHONE_NUMBER,
  SITE_URL 
} = process.env;
const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { recordId } = JSON.parse(event.body);
    if (!recordId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Message Record ID is required.' }) };
    }

    // --- DEBUG LOGS ---
    console.log(`[INFO] Notification function triggered for message recordId: ${recordId}`);

    // 1. Fetch the new message from Airtable
    const messageUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages/${recordId}`;
    const messageResponse = await fetch(messageUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!messageResponse.ok) throw new Error('Failed to fetch message from Airtable.');
    const message = await messageResponse.json();
    const { Content, SenderName, SessionID, SenderID } = message.fields;
    const sessionId = SessionID[0];

    console.log(`[INFO] Message fetched. Content: "${Content}", SenderID: ${SenderID}, SessionID: ${sessionId}`);

    // 2. Fetch the session to find the collaborators
    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;
    const sessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!sessionResponse.ok) throw new Error('Failed to fetch session from Airtable.');
    const session = await sessionResponse.json();
    const collaboratorIds = session.fields.Collaborators;

    if (!collaboratorIds || collaboratorIds.length === 0) {
      console.log('[INFO] No collaborators found on this session record. Exiting.');
      return { statusCode: 200, body: JSON.stringify({ message: 'No collaborators to notify.' }) };
    }
    
    console.log(`[INFO] Found collaborator IDs on session: ${collaboratorIds.join(', ')}`);

    // 3. Fetch user records to get their notification preferences
    const formula = `OR(${collaboratorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const usersUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${encodeURIComponent(formula)}`;
    const usersResponse = await fetch(usersUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!usersResponse.ok) throw new Error('Failed to fetch users from Airtable.');
    const { records: users } = await usersResponse.json();

    console.log(`[INFO] Fetched ${users.length} user records from the collaborators list.`);

    // 4. Filter for users who want real-time SMS and didn't send the message
    const usersToNotify = users.filter(user => 
        user.fields.NotificationFrequency === 'Real-Time' && 
        user.fields.PhoneNumber &&
        user.id !== SenderID
    );

    console.log(`[INFO] Found ${usersToNotify.length} users who opted-in for real-time SMS and were not the sender.`);

    const notificationsToSend = usersToNotify.map(user => {
        const smsBody = `${SenderName}: "${Content}"\n\nView plan: ${SITE_URL}/?session=${sessionId}`;
        console.log(`[ACTION] Preparing to send SMS to ${user.fields.PhoneNumber}`);
        return twilioClient.messages.create({
          body: smsBody,
          from: TWILIO_PHONE_NUMBER,
          to: user.fields.PhoneNumber
        });
    });

    await Promise.all(notificationsToSend);

    console.log(`[SUCCESS] Sent ${notificationsToSend.length} notifications.`);
    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Sent ${notificationsToSend.length} notifications.` }),
    };
  } catch (error) {
    console.error('[ERROR] send-notification function failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
