// CREATE A NEW FILE AT: netlify/functions/identity-signup.js

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

exports.handler = async (event, context) => {
    const { user } = JSON.parse(event.body);
    const { email, user_metadata } = user;
    const name = user_metadata.full_name || email.split('@')[0];

    try {
        // Check if user already exists
        const findUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users?filterByFormula={Email}='${email}'`;
        const findRes = await fetch(findUserUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const existing = await findRes.json();

        if (existing.records && existing.records.length > 0) {
            console.log(`User ${email} already exists in Airtable.`);
            return { statusCode: 200, body: 'User already exists.' };
        }

        // Create user if they don't exist
        const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/Users`;
        await fetch(createUserUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: [{ fields: { Email: email, Name: name } }] })
        });

        console.log(`Successfully created user ${email} in Airtable.`);
        return { statusCode: 200, body: 'User created.' };

    } catch (error) {
        console.error('Airtable sync error:', error);
        return { statusCode: 500, body: 'Internal Server Error' };
    }
};
