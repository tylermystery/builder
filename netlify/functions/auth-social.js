// CREATE A NEW FILE AT: netlify/functions/auth-social.js

const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { AIRTABLE_PAT, BASE_ID, JWT_SECRET } = process.env;

exports.handler = async (event, context) => {
  // 1. Verify the user is a valid Netlify Identity user
  const { user } = context.clientContext;
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized.' }) };
  }

  try {
    const { email, user_metadata } = user;
    const name = user_metadata.full_name || email.split('@')[0];

    // 2. Find or create the user in your Airtable 'Users' table
    const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula={Email}='${email}'`;
    const userRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
    const userData = await userRes.json();
    
    let userRecord;
    if (userData.records && userData.records.length > 0) {
        userRecord = userData.records[0];
    } else {
        const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users`;
        const createUserRes = await fetch(createUserUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: [{ fields: { Email: email, Name: name } }] })
        });
        const newUserData = await createUserRes.json();
        userRecord = newUserData.records[0];
    }

    // 3. Generate your application-specific JWT (same as magic link flow)
    let ownerData = { isOwner: false, ownerDashboardId: null };
    // (This logic can be expanded to check for ownership as in auth-verify.js)

    const sessionToken = jwt.sign(
        { userId: userRecord.id, name: userRecord.fields.Name, email: userRecord.fields.Email, isOwner: ownerData.isOwner },
        JWT_SECRET,
        { expiresIn: '30d' }
    );

    // 4. Return the same payload your app expects
    return {
        statusCode: 200,
        body: JSON.stringify({
            token: sessionToken,
            user: { 
                id: userRecord.id, 
                name: userRecord.fields.Name, 
                email: userRecord.fields.Email
            },
            ownerData: ownerData
        }),
    };
  } catch (error) {
    console.error('auth-social error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'An internal error occurred.' }) };
  }
};
