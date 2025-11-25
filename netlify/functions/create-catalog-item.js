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

    // Price field in Airtable is a single line text field - must be written as a string
    let priceValue = itemData.Price;
    if (priceValue !== undefined && priceValue !== null) {
      airtableFields['Price'] = String(priceValue);
      console.log('[DEBUG] Price field set as string:', airtableFields['Price']);
    }

    // Handle Categories field (comma-separated string)
    if (itemData.Categories) {
      airtableFields['Categories'] = itemData.Categories;
      console.log('[DEBUG] Categories field set:', airtableFields['Categories']);
    }

    // Handle Parent Item field
    if (itemData.ParentItem) {
      airtableFields['Parent Item'] = itemData.ParentItem;
      console.log('[DEBUG] Parent Item field set:', airtableFields['Parent Item']);
    }

    // Map SearchTerms to Subcategories field (comma-separated string)
    if (itemData.SearchTerms && Array.isArray(itemData.SearchTerms) && itemData.SearchTerms.length > 0) {
      airtableFields['Subcategories'] = itemData.SearchTerms.join(', ');
      console.log('[DEBUG] Subcategories field set from SearchTerms:', airtableFields['Subcategories']);
    }

    // Store Rankings in the Rankings field
    if (itemData.Rankings) {
      airtableFields['Rankings'] = typeof itemData.Rankings === 'string'
        ? itemData.Rankings
        : JSON.stringify(itemData.Rankings, null, 2);
    }

    // Build the AI_Profile object which combines:
    // - SearchTerms from the AI parser (also stored in Subcategories field)
    // - Profile attributes (activity level, social level, etc.)
    // - Suggested price as a backup reference
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
