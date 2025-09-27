// CREATE A NEW FILE AT: netlify/functions/update-user-prefs.js

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userId, phone, frequency } = JSON.parse(event.body);

    if (!userId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'User ID is required.' }) };
    }

    const payload = {
      records: [{
        id: userId,
        fields: {
          'PhoneNumber': phone,
          'NotificationFrequency': frequency,
        }
      }]
    };

    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Users`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Airtable API Error:', errorData);
      throw new Error(`Airtable API Error: ${errorData.error.message}`);
    }

    const responseData = await response.json();
    const updatedUser = responseData.records[0];

    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: 'Preferences updated successfully.',
        // Return the updated fields so the app state can be refreshed
        user: {
            phoneNumber: updatedUser.fields.PhoneNumber || '',
            notificationFrequency: updatedUser.fields.NotificationFrequency || 'None'
        }
      }),
    };

  } catch (error) {
    console.error('Update user prefs error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
