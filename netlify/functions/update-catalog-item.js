// netlify/functions/update-catalog-item.js

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const CATALOG_TABLE = 'tblUA4uuS8IYlhKpD'; // Main catalog table

exports.handler = async (event) => {
  console.log('[DEBUG] update-catalog-item handler invoked');

  if (event.httpMethod !== 'PATCH') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!AIRTABLE_PAT || !BASE_ID) {
    console.error('[DEBUG] CRITICAL: Missing Airtable credentials');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  try {
    const { recordId, updates } = JSON.parse(event.body);
    console.log('[DEBUG] Updating catalog item with data:', JSON.stringify({ recordId, updates }, null, 2));

    // Validate required fields
    if (!recordId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required field: recordId' }) };
    }

    if (!updates || typeof updates !== 'object') {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid updates object' }) };
    }

    // Build the Airtable record update
    const airtableFields = {};

    // Allow updating these fields
    if (updates.Name !== undefined) airtableFields['Name'] = updates.Name;
    if (updates.Description !== undefined) airtableFields['Description'] = updates.Description;
    if (updates.Price !== undefined) airtableFields['Price'] = updates.Price;
    if (updates.ServiceType !== undefined) airtableFields['Service Type'] = updates.ServiceType;

    // Handle SearchTerms - store in AI_Profile
    if (updates.SearchTerms !== undefined && Array.isArray(updates.SearchTerms)) {
      // Fetch existing AI_Profile to merge data
      const fetchUrl = `https://api.airtable.com/v0/${BASE_ID}/${CATALOG_TABLE}/${recordId}?fields[]=AI_Profile`;
      const fetchResponse = await fetch(fetchUrl, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
      });

      let existingProfile = {};
      if (fetchResponse.ok) {
        const record = await fetchResponse.json();
        try {
          existingProfile = record.fields.AI_Profile ? JSON.parse(record.fields.AI_Profile) : {};
        } catch (e) {
          console.warn('[DEBUG] Could not parse existing AI_Profile, starting fresh');
        }
      }

      // Merge the search terms
      airtableFields['AI_Profile'] = JSON.stringify({
        ...existingProfile,
        SearchTerms: updates.SearchTerms,
        source: existingProfile.source || 'weblink_parser',
        updatedAt: new Date().toISOString()
      }, null, 2);
    }

    // Handle Rankings (AI Profile data)
    if (updates.Rankings !== undefined) {
      airtableFields['Rankings'] = typeof updates.Rankings === 'string'
        ? updates.Rankings
        : JSON.stringify(updates.Rankings, null, 2);
    }

    // Handle Profile (new profiling attributes for sorting/comparing)
    if (updates.Profile !== undefined) {
      airtableFields['Profile'] = typeof updates.Profile === 'string'
        ? updates.Profile
        : JSON.stringify(updates.Profile, null, 2);
    }

    console.log('[DEBUG] Airtable fields to update:', JSON.stringify(airtableFields, null, 2));

    // Update the record in Airtable
    const url = `https://api.airtable.com/v0/${BASE_ID}/${CATALOG_TABLE}/${recordId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: airtableFields
      })
    });

    console.log('[DEBUG] Airtable response status:', response.status);

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('[DEBUG] Airtable error response:', errorBody);
      throw new Error(`Airtable API request failed: ${errorBody}`);
    }

    const result = await response.json();

    console.log('[DEBUG] Successfully updated catalog item with ID:', recordId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        recordId: recordId,
        message: `Item updated successfully`
      })
    };

  } catch (error) {
    console.error('[DEBUG] update-catalog-item function failed:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to update catalog item: ${error.message}` })
    };
  }
};
