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
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { recordId } = JSON.parse(event.body);
    if (!recordId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Message Record ID is required.' }) };
    }

    console.log(`[INFO] RSVP notification function triggered for message recordId: ${recordId}`);

    const messageUrl = `https://api.airtable.com/v0/${BASE_ID}/Messages/${recordId}`;
    const messageResponse = await fetch(messageUrl, { 
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } 
    });
    
    if (!messageResponse.ok) {
      throw new Error('Failed to fetch message from Airtable.');
    }

    const message = await messageResponse.json();
    const { Content, SenderName, 'Item Link': itemLinks, SenderID } = message.fields;

    if (!itemLinks || itemLinks.length === 0) {
      console.log('[INFO] Message is not linked to an item. Skipping notification.');
      return { statusCode: 200, body: JSON.stringify({ message: 'Not an item message.' }) };
    }

    const itemId = itemLinks[0];
    console.log(`[INFO] Message is for item ${itemId}. Fetching item details...`);

    const itemUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${itemId}`;
    const itemResponse = await fetch(itemUrl, { 
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } 
    });
    
    if (!itemResponse.ok) {
      throw new Error('Failed to fetch item from Airtable.');
    }

    const item = await itemResponse.json();
    const { Name: itemName, 'Item Type': itemType, RSVPs: rsvpUserIds } = item.fields;

    if (itemType !== 'Event') {
      console.log('[INFO] Item is not an event. Skipping notification.');
      return { statusCode: 200, body: JSON.stringify({ message: 'Not an event.' }) };
    }

    if (!rsvpUserIds || rsvpUserIds.length === 0) {
      console.log('[INFO] No RSVPs for this event. Exiting.');
      return { statusCode: 200, body: JSON.stringify({ message: 'No RSVPs to notify.' }) };
    }

    console.log(`[INFO] Found ${rsvpUserIds.length} RSVP'd users for event "${itemName}".`);

    const formula = `OR(${rsvpUserIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const usersUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula=${encodeURIComponent(formula)}`;
    const usersResponse = await fetch(usersUrl, { 
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } 
    });
    
    if (!usersResponse.ok) {
      throw new Error('Failed to fetch users from Airtable.');
    }

    const { records: users } = await usersResponse.json();
    console.log(`[INFO] Fetched ${users.length} user records.`);

    const usersToNotify = users.filter(user => 
      user.fields.NotificationFrequency === 'Real-Time' && 
      user.fields.PhoneNumber &&
      user.id !== SenderID
    );

    console.log(`[INFO] Found ${usersToNotify.length} users who opted-in for real-time notifications.`);

    const notificationsToSend = usersToNotify.map(user => {
      const smsBody = `New message in "${itemName}" event chat:\n${SenderName}: "${Content}"\n\nView: ${SITE_URL}/?openItem=${itemId}`;
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
      body: JSON.stringify({ message: `Sent ${notificationsToSend.length} notifications.` })
    };
  } catch (error) {
    console.error('[ERROR] notify-rsvp-users function failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
