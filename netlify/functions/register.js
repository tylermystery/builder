// FILE: netlify/functions/register.js

const fetch = require('node-fetch');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const { AIRTABLE_PAT, JWT_SECRET } = process.env;
const BASE_ID = 'app5yTznb3R5YNUFw';
const USERS_TABLE_ID = 'Users'; // Or whatever your Users table is called

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { name, email, password } = JSON.parse(event.body);

    if (!name || !email || !password) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Name, email, and password are required.' }) };
    }

    // 1. Check if user already exists
    const checkUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}?filterByFormula=${encodeURIComponent(`{Email} = '${email}'`)}`;
    const checkResponse = await fetch(checkUserUrl, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
    });
    const checkData = await checkResponse.json();

    if (checkData.records && checkData.records.length > 0) {
      return { statusCode: 409, body: JSON.stringify({ error: 'A user with this email already exists.' }) };
    }

    // 2. Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 3. Create new user in Airtable
    const createUserUrl = `https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE_ID}`;
    const createResponse = await fetch(createUserUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        records: [{
          fields: {
            Name: name,
            Email: email,
            Password: hashedPassword,
          }
        }]
      })
    });

    if (!createResponse.ok) {
      const errorBody = await createResponse.json();
      console.error('Airtable API Error:', errorBody);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to create user.' }) };
    }

    const createData = await createResponse.json();
    const newUser = {
      id: createData.records[0].id,
      ...createData.records[0].fields
    };

    // 4. Generate a JWT
    const token = jwt.sign(
      { id: newUser.id, email: newUser.Email, name: newUser.Name },
      JWT_SECRET,
      { expiresIn: '7d' } // Token expires in 7 days
    );

    return {
      statusCode: 201, // 201 Created
      body: JSON.stringify({
        message: 'User created successfully!',
        token: token,
        user: { id: newUser.id, name: newUser.Name, email: newUser.Email }
      }),
    };

  } catch (error) {
    console.error('Registration Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: 'An internal server error occurred.' }) };
  }
};
