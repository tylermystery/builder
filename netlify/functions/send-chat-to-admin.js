// PASTE THIS ENTIRE CODE INTO: netlify/functions/send-chat-to-admin.js

const fetch = require('node-fetch');
const sgMail = require('@sendgrid/mail');
const { SENDER_EMAIL, buildFrom, fetchStoreName } = require('./utils/email-config');
const { AIRTABLE_PAT, BASE_ID, SENDGRID_API_KEY, SITE_URL, URL } = process.env;

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
    const { Content, SenderName, SessionID } = message.fields;
    const sessionId = SessionID[0];

    // 2. Fetch the session to get its name
    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;
    const sessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    if (!sessionResponse.ok) throw new Error('Failed to fetch session from Airtable.');
    const session = await sessionResponse.json();
    const sessionName = session.fields.Name || 'an event plan';

    // Resolve store name for dynamic sender
    const storeId = session.fields.Stores && session.fields.Stores[0];
    const storeName = await fetchStoreName(storeId);
    const emailFrom = buildFrom(storeName);

    // 3. Construct and send the email
    const baseUrl = SITE_URL || URL; // Use production URL or fallback to Netlify's default
    const viewPlanUrl = `${baseUrl}/?session=${sessionId}`;
    const adminEmail = SENDER_EMAIL;

    const msg = {
      to: adminEmail,
      from: emailFrom, // Must be a verified SendGrid sender
      subject: `[New Chat Message] In plan: "${sessionName}"`,
      html: `
        <p>A new chat message was sent in the plan: <strong>${sessionName}</strong></p>
        <ul>
          <li><strong>Sender:</strong> ${SenderName}</li>
          <li><strong>Message:</strong> "${Content}"</li>
        </ul>
        <p><a href="${viewPlanUrl}">Click here to view the plan and reply directly from the CRM.</a></p>
      `,
    };

    await sgMail.send(msg);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Sent chat notification to ${adminEmail}.` }),
    };
  } catch (error) {
    console.error('send-chat-to-admin error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
