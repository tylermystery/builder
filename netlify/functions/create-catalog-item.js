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
      'Item Type': itemData.ServiceType || 'Partner Activity'
    };

    // Note: The "Price" field in Airtable appears to be a computed/formula field
    // that cannot be written to directly. We skip setting it here.
    // If the Price needs to be stored, it should be set via Airtable's "Options" field
    // or another writable field that feeds into the Price formula.
    let priceValue = itemData.Price;
    console.log('[DEBUG] Price field received (not writing to Airtable - field may be computed):', {
      value: priceValue,
      type: typeof priceValue,
      isNull: priceValue === null,
      isUndefined: priceValue === undefined
    });

    // Store Price in Profile JSON if provided, so it can be referenced later
    // This preserves the AI-suggested price without trying to write to a computed field

    // Store Rankings in the Rankings field
    if (itemData.Rankings) {
      airtableFields['Rankings'] = typeof itemData.Rankings === 'string'
        ? itemData.Rankings
        : JSON.stringify(itemData.Rankings, null, 2);
    }

    // Build the AI_Profile object which combines:
    // - SearchTerms from the AI parser
    // - Profile attributes (activity level, social level, etc.)
    // - Suggested price (since the Price field is computed/read-only)
    // Note: "Profile" is not a valid Airtable field, so we merge Profile data into AI_Profile
    let aiProfileData = {
      source: 'weblink_parser',
      createdAt: new Date().toISOString()
    };

    // Add SearchTerms if provided
    if (itemData.SearchTerms && Array.isArray(itemData.SearchTerms) && itemData.SearchTerms.length > 0) {
      aiProfileData.SearchTerms = itemData.SearchTerms;
    }

    // Add Profile attributes if provided
    if (itemData.Profile) {
      const profileData = typeof itemData.Profile === 'string'
        ? JSON.parse(itemData.Profile)
        : itemData.Profile;
      aiProfileData.Profile = profileData;
    }

    // Add the suggested price so it's preserved
    if (priceValue !== undefined && priceValue !== null) {
      const parsedPrice = typeof priceValue === 'string'
        ? parseFloat(priceValue.replace(/[$,]/g, ''))
        : priceValue;
      if (!isNaN(parsedPrice)) {
        aiProfileData.suggestedPrice = parsedPrice;
      }
    }

    // Write the combined AI_Profile data
    airtableFields['AI_Profile'] = JSON.stringify(aiProfileData, null, 2);

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
