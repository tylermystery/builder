// CREATE NEW FILE AT: netlify/functions/create-catalog-item.js

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const CATALOG_TABLE = 'tblUA4uuS8IYlhKpD'; // Main catalog table

exports.handler = async (event) => {
  console.log('[DEBUG] create-catalog-item handler invoked');

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!AIRTABLE_PAT || !BASE_ID) {
    console.error('[DEBUG] CRITICAL: Missing Airtable credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  try {
    const itemData = JSON.parse(event.body);
    console.log('[DEBUG] Creating catalog item with data:', JSON.stringify(itemData, null, 2));

    // Validate required fields
    if (!itemData.Name) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required field: Name' }) };
    }

    // Build the Airtable record
    const airtableFields = {
      'Name': itemData.Name,
      'Description': itemData.Description || '',
      'Price': itemData.Price || 0,
      'Service Type': itemData.ServiceType || 'Partner Activity'
    };

    // Store Rankings in the Rankings field
    if (itemData.Rankings) {
      airtableFields['Rankings'] = typeof itemData.Rankings === 'string'
        ? itemData.Rankings
        : JSON.stringify(itemData.Rankings, null, 2);
    }

    // Store Profile in the Profile field (new profiling attributes)
    if (itemData.Profile) {
      airtableFields['Profile'] = typeof itemData.Profile === 'string'
        ? itemData.Profile
        : JSON.stringify(itemData.Profile, null, 2);
    }

    // Store SearchTerms in AI_Profile as a simple JSON structure
    // This allows it to be searched and profiled later
    if (itemData.SearchTerms && Array.isArray(itemData.SearchTerms) && itemData.SearchTerms.length > 0) {
      airtableFields['AI_Profile'] = JSON.stringify({
        SearchTerms: itemData.SearchTerms,
        source: 'weblink_parser',
        createdAt: new Date().toISOString()
      }, null, 2);
    }

    console.log('[DEBUG] Airtable fields to create:', JSON.stringify(airtableFields, null, 2));

    // Create the record in Airtable
    const url = `https://api.airtable.com/v0/${BASE_ID}/${CATALOG_TABLE}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records: [{
          fields: airtableFields
        }]
      })
    });

    console.log('[DEBUG] Airtable response status:', response.status);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[DEBUG] Airtable error response:', errorBody);
      throw new Error(`Airtable API request failed: ${errorBody}`);
    }

    const result = await response.json();
    const recordId = result.records[0].id;

    console.log('[DEBUG] Successfully created catalog item with ID:', recordId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        recordId: recordId,
        message: `Item "${itemData.Name}" created successfully`
      })
    };

  } catch (error) {
    console.error('[DEBUG] create-catalog-item function failed:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to create catalog item: ${error.message}` })
    };
  }
};
