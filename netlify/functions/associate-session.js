// CREATE A NEW FILE AT: netlify/functions/associate-session.js

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

// Helper function to prevent duplicate IDs in an array
const addUniqueId = (array, id) => {
  const set = new Set(array || []);
  set.add(id);
  return Array.from(set);
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userId, sessionId } = JSON.parse(event.body);
    if (!userId || !sessionId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'User ID and Session ID are required.' }) };
    }

    // 1. Fetch both the user and session records in parallel
    const userUrl = `https://api.airtable.com/v0/${BASE_ID}/Users/${userId}`;
    const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;

    const [userResponse, sessionResponse] = await Promise.all([
      fetch(userUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } }),
      fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } })
    ]);

    if (!userResponse.ok || !sessionResponse.ok) {
      throw new Error('Could not fetch user or session record from Airtable.');
    }

    const userRecord = await userResponse.json();
    const sessionRecord = await sessionResponse.json();

    // 2. Update the User record to link to the Session
    const updatedUserPayload = {
      records: [{
        id: userId,
        fields: { 'Associated Sessions': addUniqueId(userRecord.fields['Associated Sessions'], sessionId) }
      }]
    };
    const updateUserPromise = fetch(`https://api.airtable.com/v0/${BASE_ID}/Users`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedUserPayload)
    });

    // 3. Update the Session record to link to the User (as a collaborator)
    const updatedSessionPayload = {
      records: [{
        id: sessionId,
        fields: { 'Collaborators': addUniqueId(sessionRecord.fields['Collaborators'], userId) }
      }]
    };
    const updateSessionPromise = fetch(`https://api.airtable.com/v0/${BASE_ID}/Sessions`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updatedSessionPayload)
    });

    // 4. Run both updates and wait for them to complete
    await Promise.all([updateUserPromise, updateSessionPromise]);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Session associated successfully.' }),
    };

  } catch (error) {
    console.error('Associate session error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
