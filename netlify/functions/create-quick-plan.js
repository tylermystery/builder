// FILE: netlify/functions/create-quick-plan.js
// PURPOSE: Creates a new Plan (Projects record) from a single text input
// Used by the /start-a-plan.html quick entry page

const fetch = require('node-fetch');

// Environment variables for Airtable access
const { AIRTABLE_PAT, BASE_ID } = process.env;

// Target the existing Projects table
const PROJECTS_TABLE = 'Projects';

exports.handler = async (event) => {
  console.log('[create-quick-plan] Function invoked');

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method Not Allowed' })
    };
  }

  // Validate environment variables
  if (!AIRTABLE_PAT || !BASE_ID) {
    console.error('[create-quick-plan] CRITICAL: Missing required environment variables');
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Server configuration error' })
    };
  }

  try {
    // Parse the incoming request body
    console.log('[create-quick-plan] Parsing request body');
    const requestData = JSON.parse(event.body || '{}');
    const { idea } = requestData;

    // Validate the idea text
    if (!idea || typeof idea !== 'string' || idea.trim().length === 0) {
      console.log('[create-quick-plan] Validation failed: Missing or empty idea');
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing required field: idea' })
      };
    }

    const ideaText = idea.trim();
    console.log(`[create-quick-plan] Creating plan with idea (${ideaText.length} chars)`);

    // Prepare the record fields
    // Name: First 50 characters of the idea text
    // Description: Full idea text
    const planName = ideaText.length > 50
      ? ideaText.substring(0, 50)
      : ideaText;

    const airtableFields = {
      'Name': planName,
      'Description': ideaText
    };

    console.log('[create-quick-plan] Airtable fields prepared:', JSON.stringify({
      Name: planName,
      DescriptionLength: ideaText.length
    }));

    // Create the record in Airtable
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(PROJECTS_TABLE)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields: airtableFields })
    });

    console.log('[create-quick-plan] Airtable response status:', response.status);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[create-quick-plan] Airtable error:', errorBody);
      throw new Error(`Airtable API request failed: ${response.status}`);
    }

    const result = await response.json();
    const newRecordId = result.id;

    console.log('[create-quick-plan] Successfully created plan with ID:', newRecordId);

    // Return success response with the new record ID
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        newPlanId: newRecordId
      })
    };

  } catch (error) {
    console.error('[create-quick-plan] Function failed:', error.message);
    console.error('[create-quick-plan] Stack:', error.stack);

    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'Failed to create plan',
        details: error.message
      })
    };
  }
};
