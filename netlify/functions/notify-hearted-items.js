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
    const { itemId } = JSON.parse(event.body);
    if (!itemId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Item ID is required.' }) };
    }

    console.log(`[INFO] Notification function triggered for item converted to event: ${itemId}`);

    const itemUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${itemId}`;
    const itemResponse = await fetch(itemUrl, { 
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } 
    });
    
    if (!itemResponse.ok) {
      throw new Error('Failed to fetch item from Airtable.');
    }

    const item = await itemResponse.json();
    const { Name: itemName, 'Liked By Users': likedByUserIds, 'Item Type': itemType, Date: eventDate } = item.fields;

    if (itemType !== 'Event') {
      console.log('[INFO] Item is not an event. Skipping notification.');
      return { statusCode: 200, body: JSON.stringify({ message: 'Item is not an event.' }) };
    }

    if (!likedByUserIds || likedByUserIds.length === 0) {
      console.log('[INFO] No users have liked this item. Exiting.');
      return { statusCode: 200, body: JSON.stringify({ message: 'No users to notify.' }) };
    }

    console.log(`[INFO] Found ${likedByUserIds.length} users who liked this item.`);

    const formula = `OR(${likedByUserIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
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
      user.fields.PhoneNumber
    );

    console.log(`[INFO] Found ${usersToNotify.length} users who opted-in for real-time notifications.`);

    const dateString = eventDate ? new Date(eventDate).toLocaleDateString() : 'TBD';
    const notificationsToSend = usersToNotify.map(user => {
      const smsBody = `Good news! "${itemName}" you hearted is now scheduled as an event on ${dateString}! 🎉\n\nView details: ${SITE_URL}/?openItem=${itemId}`;
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
    console.error('[ERROR] notify-hearted-items function failed:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
