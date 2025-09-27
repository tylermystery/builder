// CREATE A NEW FILE AT: netlify/functions/send-notification.js

const fetch = require('node-fetch');
// Use require() to import the twilio package
const twilio = require('twilio');

// Initialize clients with credentials from environment variables
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

    // 1. Fetch the new message from Airtable
    const messageUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages/${recordId}`;
    const messageResponse = await fetch(messageUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!messageResponse.ok) throw new Error('Failed to fetch message from Airtable.');
    const message = await messageResponse.json();
    
    const { Content, SenderName, SessionID, SenderID } = message.fields;
    const sessionId = SessionID[0];

    // 2. Fetch the session to find the collaborators (users)
    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;
    const sessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!sessionResponse.ok) throw new Error('Failed to fetch session from Airtable.');
    const session = await sessionResponse.json();

    const collaboratorIds = session.fields.Collaborators; // Assumes a 'Collaborators' linked field on Sessions table
    if (!collaboratorIds || collaboratorIds.length === 0) {
      console.log('No collaborators on this session to notify.');
      return { statusCode: 200, body: JSON.stringify({ message: 'No collaborators to notify.' }) };
    }

    // 3. Fetch user records to get their notification preferences
    const formula = `OR(${collaboratorIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const usersUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${encodeURIComponent(formula)}`;
    const usersResponse = await fetch(usersUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!usersResponse.ok) throw new Error('Failed to fetch users from Airtable.');
    const { records: users } = await usersResponse.json();

    // 4. Filter for users who want real-time SMS and didn't send the message, then send SMS
    const notificationsToSend = users
      .filter(user => 
        user.fields.NotificationFrequency === 'Real-Time' && 
        user.fields.PhoneNumber &&
        user.id !== SenderID // Don't notify the person who sent the message
      )
      .map(user => {
        const smsBody = `${SenderName}: "${Content}"\n\nView plan: ${SITE_URL}/?session=${sessionId}`;
        
        return twilioClient.messages.create({
          body: smsBody,
          from: TWILIO_PHONE_NUMBER,
          to: user.fields.PhoneNumber
        });
      });

    await Promise.all(notificationsToSend);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Sent ${notificationsToSend.length} notifications.` }),
    };

  } catch (error) {
    console.error('Send-notification error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
