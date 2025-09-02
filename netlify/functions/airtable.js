const fetch = require('node-fetch');

const AIRTABLE_PAT = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const TABLE_ID = 'tblUA4uuS8IYlhKpD';
const SESSIONS_TABLE_NAME = 'Sessions';

exports.handler = async function (event) {
  const { path, method, body } = event;
  const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}${path.replace('/api/airtable', '')}`;

  try {
    const response = await fetch(airtableUrl, {
      method: method || 'GET',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json',
      },
      body: method !== 'GET' ? body : undefined,
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: await response.json() }),
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (error) {
    console.error('Airtable proxy error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};
