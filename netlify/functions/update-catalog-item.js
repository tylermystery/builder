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

    // Price field in Airtable is a single line text field - must be written as a string
    if (updates.Price !== undefined && updates.Price !== null) {
      // Convert to string for text field
      airtableFields['Price'] = String(updates.Price);
      console.log('[DEBUG] Price field set as string:', airtableFields['Price']);
    }

    if (updates.ServiceType !== undefined) airtableFields['Item Type'] = updates.ServiceType;

    // Handle Categories field (comma-separated string)
    if (updates.Categories !== undefined) {
      airtableFields['Categories'] = updates.Categories;
      console.log('[DEBUG] Categories field set:', airtableFields['Categories']);
    }

    // Handle Parent Item field
    if (updates.ParentItem !== undefined) {
      airtableFields['Parent Item'] = updates.ParentItem;
      console.log('[DEBUG] Parent Item field set:', airtableFields['Parent Item']);
    }

    // Map SearchTerms to Subcategories field (comma-separated string)
    if (updates.SearchTerms !== undefined && Array.isArray(updates.SearchTerms) && updates.SearchTerms.length > 0) {
      airtableFields['Subcategories'] = updates.SearchTerms.join(', ');
      console.log('[DEBUG] Subcategories field set from SearchTerms:', airtableFields['Subcategories']);
    }

    // Build/update the AI_Profile object which combines:
    // - SearchTerms from the AI parser (also stored in Subcategories field)
    // - Profile attributes (activity level, social level, etc.)
    // - Suggested price as a backup reference
    const hasSearchTerms = updates.SearchTerms !== undefined && Array.isArray(updates.SearchTerms);
    const hasProfile = updates.Profile !== undefined;
    const hasPrice = updates.Price !== undefined && updates.Price !== null;

    if (hasSearchTerms || hasProfile || hasPrice) {
      // Fetch existing AI_Profile to merge data
      // Note: The fields[] parameter is NOT supported on single record GET requests (only on List Records)
      // Single record endpoint returns all fields automatically - we just use the AI_Profile field from the response
      const fetchUrl = `https://api.airtable.com/v0/${BASE_ID}/${CATALOG_TABLE}/${recordId}`;
      const fetchResponse = await fetch(fetchUrl, {
        headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
      });

      let existingAiProfile = {};
      if (fetchResponse.ok) {
        const record = await fetchResponse.json();
        try {
          existingAiProfile = record.fields.AI_Profile ? JSON.parse(record.fields.AI_Profile) : {};
        } catch (e) {
          console.warn('[DEBUG] Could not parse existing AI_Profile, starting fresh');
        }
      }

      // Build the updated AI_Profile
      let aiProfileData = {
        ...existingAiProfile,
        updatedAt: new Date().toISOString()
      };
      if (!aiProfileData.source) {
        aiProfileData.source = 'weblink_parser';
      }

      // Update SearchTerms if provided
      if (hasSearchTerms) {
        aiProfileData.SearchTerms = updates.SearchTerms;
      }

      // Update Profile attributes if provided
      if (hasProfile) {
        const profileData = typeof updates.Profile === 'string'
          ? JSON.parse(updates.Profile)
          : updates.Profile;
        aiProfileData.Profile = profileData;
      }

      // Update suggested price if provided
      if (hasPrice) {
        const parsedPrice = typeof updates.Price === 'string'
          ? parseFloat(String(updates.Price).replace(/[$,]/g, ''))
          : updates.Price;
        if (!isNaN(parsedPrice)) {
          aiProfileData.suggestedPrice = parsedPrice;
        }
      }

      // Write the combined AI_Profile data
      airtableFields['AI_Profile'] = JSON.stringify(aiProfileData, null, 2);
    }

    // Handle Rankings (AI Profile data)
    if (updates.Rankings !== undefined) {
      airtableFields['Rankings'] = typeof updates.Rankings === 'string'
        ? updates.Rankings
        : JSON.stringify(updates.Rankings, null, 2);
    }

    console.log('[DEBUG] Airtable fields to update:', JSON.stringify(airtableFields, null, 2));

    // Update the record in Airtable
    const url = `https://api.airtable.com/v0/${BASE_ID}/${CATALOG_TABLE}/${recordId}`;
    const requestBody = JSON.stringify({
      fields: airtableFields
    });
    console.log('[DEBUG] Airtable request body:', requestBody);

    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_PAT}`,
        'Content-Type': 'application/json'
      },
      body: requestBody
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
