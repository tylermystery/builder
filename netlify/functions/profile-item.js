// FILE: netlify/functions/profile-item.js
const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY } = process.env;

const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Main catalog table
const RANKINGS_FIELD = 'Rankings'; // The field to update
const NAME_FIELD = 'Name';
const DESCRIPTION_FIELD = 'Description';

// Use the current Gemini model name (gemini-pro was deprecated)
const GEMINI_MODEL = 'gemini-1.5-flash';

/**
 * Extracts a JSON object from a string, even if it's wrapped in markdown.
 * @param {string} text - The raw text response from the AI.
 * @returns {object} The parsed JSON object.
 */
function cleanAndParseGeminiJson(text) {
  console.log('[Debug][cleanAndParseGeminiJson] Raw Gemini Text length:', text ? text.length : 0);
  console.log('[Debug][cleanAndParseGeminiJson] Raw Gemini Text preview:', text ? text.substring(0, 500) : 'null/empty');
  // Look for the first { and the last } to get the JSON block
  const jsonMatch = text.match(/{[\s\S]*}/);
  if (!jsonMatch) {
    console.error('[Debug][cleanAndParseGeminiJson] No JSON object found in response');
    throw new Error('Gemini response did not contain a valid JSON object.');
  }
  const jsonString = jsonMatch[0];
  console.log('[Debug][cleanAndParseGeminiJson] Extracted JSON string length:', jsonString.length);
  try {
    const parsed = JSON.parse(jsonString);
    console.log('[Debug][cleanAndParseGeminiJson] Successfully parsed JSON with keys:', Object.keys(parsed).join(', '));
    return parsed;
  } catch (parseError) {
    console.error('[Debug][cleanAndParseGeminiJson] Failed to parse extracted JSON:', parseError.message);
    console.error('[Debug][cleanAndParseGeminiJson] JSON string that failed to parse:', jsonString.substring(0, 500));
    throw new Error(`Failed to parse AI response as JSON: ${parseError.message}`);
  }
}

/**
 * Calls the Gemini API to generate a "Universal Profile" for an item.
 * @param {string} itemName - The name of the item.
 * @param {string} itemDescription - The description of the item.
 * @returns {object} The parsed "Universal Profile" JSON object.
 */
async function getProfileFromGemini(itemName, itemDescription) {
    console.log(`[Debug][getProfileFromGemini] === STARTING GEMINI API CALL ===`);
    console.log(`[Debug][getProfileFromGemini] Profiling item: "${itemName}"`);
    console.log(`[Debug][getProfileFromGemini] Description length: ${(itemDescription || '').length} chars`);
    console.log(`[Debug][getProfileFromGemini] Description preview: "${(itemDescription || 'No description').substring(0, 200)}..."`);

    // Check environment variables
    console.log(`[Debug][getProfileFromGemini] ENV CHECK - GEMINI_API_KEY present: ${!!GEMINI_API_KEY}`);
    console.log(`[Debug][getProfileFromGemini] ENV CHECK - GEMINI_API_KEY length: ${GEMINI_API_KEY ? GEMINI_API_KEY.length : 0}`);
    console.log(`[Debug][getProfileFromGemini] ENV CHECK - GEMINI_API_KEY prefix: ${GEMINI_API_KEY ? GEMINI_API_KEY.substring(0, 5) + '...' : 'N/A'}`);

    if (!GEMINI_API_KEY) {
        console.error("[Debug][getProfileFromGemini] CRITICAL: GEMINI_API_KEY is missing!");
        throw new Error("Server configuration error: Missing Gemini API Key.");
    }

    const prompt = `
      You are an expert event profiler for an event planning company.
      Based on this item's name and description, score it from 0 (none) to 10 (max) on the following attributes.
      Respond ONLY with a valid JSON object. Do not include markdown \`\`\`json or any text before or after the JSON.

      The JSON must have this exact structure:
      {
        "profileSource": "ai_v1_gemini_profile",
        "Pillars": { "Activities": 0, "Food/Drink": 0, "Venue": 0, "Extras": 0 },
        "Vibe": { "Energy": 0, "Relaxation": 0, "Formality": 0, "Novelty": 0 },
        "Intellect": { "Creative": 0, "Analytical": 0 },
        "Physicality": { "Intensity": 0, "Accessibility": 0 },
        "Tags": [],
        "SearchTerms": []
      }

      INSTRUCTIONS:
      1.  **Pillars:** Score 1-10 if the item *is* this thing (e.g., Go-Karts is "Activities": 10. A taco bar is "Food/Drink": 10). Most items are only one pillar.
      2.  **Vibe:** Score 0-10 for Energy (active) vs. Relaxation (calm), Formality (fancy) vs. Novelty (unique).
      3.  **Intellect/Physicality:** Score 0-10 for these attributes.
      4.  **Tags (CRITICAL):** Populate this array with lowercase string keywords.
          * **Attribute Tags:** Descriptive words (e.g., "competitive", "outdoor", "relaxing", "loud", "daytime").
          * **Concrete Noun Tags:** Specific keywords for content, theme, or category (e.g., "go-kart", "racing", "museum", "art", "science", "tacos", "mexican food", "bar").
      5.  **SearchTerms (CRITICAL):** Populate this array with 10-20 lowercase search terms for better matching including:
          * The exact name (lowercase) and common variations
          * Synonyms and related activity types
          * Category keywords (e.g., "restaurant", "museum", "outdoor activity")
          * Descriptive attributes that someone might search for
          * Related concepts and themes
          * Common misspellings or alternate names if applicable
    `;

    const payload = {
        contents: [
            {
                parts: [
                    { text: prompt },
                    { text: `Item Name: "${itemName}"\nItem Description: "${itemDescription || 'No description provided.'}"` }
                ]
            }
        ],
    };

    // IMPORTANT: Use current Gemini model (gemini-pro was deprecated and returns 404)
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    console.log(`[Debug][getProfileFromGemini] Using Gemini model: ${GEMINI_MODEL}`);
    console.log(`[Debug][getProfileFromGemini] API URL (without key): https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
    console.log(`[Debug][getProfileFromGemini] Payload size: ${JSON.stringify(payload).length} bytes`);
    console.log(`[Debug][getProfileFromGemini] Sending request to Gemini API...`);

    const startTime = Date.now();
    let response;
    try {
        response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (fetchError) {
        console.error(`[Debug][getProfileFromGemini] FETCH ERROR: ${fetchError.message}`);
        console.error(`[Debug][getProfileFromGemini] FETCH ERROR Stack: ${fetchError.stack}`);
        throw new Error(`Network error calling Gemini API: ${fetchError.message}`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Debug][getProfileFromGemini] Response received in ${elapsed}ms`);
    console.log(`[Debug][getProfileFromGemini] Response status: ${response.status} ${response.statusText}`);
    console.log(`[Debug][getProfileFromGemini] Response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);

    if (!response.ok) {
        let errorBody = await response.text();
        console.error(`[Debug][getProfileFromGemini] API ERROR - Status: ${response.status}`);
        console.error(`[Debug][getProfileFromGemini] API ERROR - StatusText: ${response.statusText}`);
        console.error(`[Debug][getProfileFromGemini] API ERROR - Body: ${errorBody}`);
        throw new Error(`Gemini API call failed with status ${response.status}: ${errorBody.substring(0, 500)}`);
    }

    console.log(`[Debug][getProfileFromGemini] Response OK, parsing JSON...`);
    const result = await response.json();
    console.log(`[Debug][getProfileFromGemini] Response JSON keys: ${Object.keys(result).join(', ')}`);

    // Log safety/filter info if present
    if (result.promptFeedback) {
        console.log(`[Debug][getProfileFromGemini] promptFeedback: ${JSON.stringify(result.promptFeedback)}`);
    }
    if (result.candidates && result.candidates[0]) {
        console.log(`[Debug][getProfileFromGemini] Candidate finishReason: ${result.candidates[0].finishReason || 'not specified'}`);
        if (result.candidates[0].safetyRatings) {
            console.log(`[Debug][getProfileFromGemini] safetyRatings: ${JSON.stringify(result.candidates[0].safetyRatings)}`);
        }
    }

    let jsonText = '';
    try {
        if (!result.candidates || result.candidates.length === 0) {
            console.error(`[Debug][getProfileFromGemini] No candidates in response. Full response: ${JSON.stringify(result)}`);
            throw new Error('Gemini response contained no candidates');
        }
        if (!result.candidates[0].content) {
            console.error(`[Debug][getProfileFromGemini] No content in first candidate. Candidate: ${JSON.stringify(result.candidates[0])}`);
            throw new Error('Gemini response candidate has no content');
        }
        if (!result.candidates[0].content.parts || result.candidates[0].content.parts.length === 0) {
            console.error(`[Debug][getProfileFromGemini] No parts in content. Content: ${JSON.stringify(result.candidates[0].content)}`);
            throw new Error('Gemini response content has no parts');
        }
        jsonText = result.candidates[0].content.parts[0].text;
        console.log(`[Debug][getProfileFromGemini] Successfully extracted text from response. Length: ${jsonText.length}`);
    } catch (e) {
        console.error(`[Debug][getProfileFromGemini] Error extracting text: ${e.message}`);
        console.error(`[Debug][getProfileFromGemini] Full response structure: ${JSON.stringify(result, null, 2)}`);
        throw new Error(`Could not extract text from Gemini response: ${e.message}`);
    }

    console.log(`[Debug][getProfileFromGemini] Parsing AI response JSON...`);
    const profileJson = cleanAndParseGeminiJson(jsonText);
    console.log(`[Debug][getProfileFromGemini] === GEMINI API CALL COMPLETE ===`);
    return profileJson;
}

exports.handler = async (event) => {
    console.log(`[Debug][handler] ========================================`);
    console.log(`[Debug][handler] /api/profile-item invoked`);
    console.log(`[Debug][handler] Method: ${event.httpMethod}`);
    console.log(`[Debug][handler] Path: ${event.path}`);
    console.log(`[Debug][handler] Headers: ${JSON.stringify(event.headers)}`);
    console.log(`[Debug][handler] ========================================`);

    // Environment variable check at handler level
    console.log(`[Debug][handler] ENV CHECK - AIRTABLE_PAT present: ${!!AIRTABLE_PAT}`);
    console.log(`[Debug][handler] ENV CHECK - BASE_ID: ${BASE_ID || 'NOT SET'}`);
    console.log(`[Debug][handler] ENV CHECK - GEMINI_API_KEY present: ${!!GEMINI_API_KEY}`);
    console.log(`[Debug][handler] ENV CHECK - GEMINI_MODEL: ${GEMINI_MODEL}`);

    if (event.httpMethod !== 'POST') {
        console.log(`[Debug][handler] Rejecting non-POST request`);
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        console.log(`[Debug][handler] Request body: ${event.body}`);
        const { recordId } = JSON.parse(event.body);
        if (!recordId) {
            console.log(`[Debug][handler] Missing recordId in request body`);
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing recordId' }) };
        }

        console.log(`[Debug][handler] Processing profile for record: ${recordId}`);

        // 1. Fetch the Item's Name and Description
        // Note: The fields[] parameter is NOT supported on single record GET requests (only on List Records)
        // Single record endpoint returns all fields automatically - no filtering needed
        const fetchUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${recordId}`;
        console.log(`[Debug][handler] STEP 1: Fetching item from Airtable`);
        console.log(`[Debug][handler] Airtable URL: ${fetchUrl}`);
        console.log(`[Debug][handler] Airtable PAT prefix: ${AIRTABLE_PAT ? AIRTABLE_PAT.substring(0, 10) + '...' : 'NOT SET'}`);

        const itemResponse = await fetch(fetchUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        console.log(`[Debug][handler] Airtable response status: ${itemResponse.status} ${itemResponse.statusText}`);

        if (!itemResponse.ok) {
            const errorBody = await itemResponse.text();
            console.error(`[Debug][handler] Airtable fetch FAILED - Status: ${itemResponse.status}`);
            console.error(`[Debug][handler] Airtable fetch FAILED - Body: ${errorBody}`);
            throw new Error(`Failed to fetch item ${recordId} from Airtable. Status: ${itemResponse.statusText}`);
        }

        const itemRecord = await itemResponse.json();
        console.log(`[Debug][handler] Airtable record fetched. ID: ${itemRecord.id}`);
        console.log(`[Debug][handler] Airtable record fields: ${Object.keys(itemRecord.fields || {}).join(', ')}`);

        const itemName = itemRecord.fields[NAME_FIELD];
        const itemDescription = itemRecord.fields[DESCRIPTION_FIELD];

        console.log(`[Debug][handler] Item Name: "${itemName}"`);
        console.log(`[Debug][handler] Item Description length: ${(itemDescription || '').length}`);

        if (!itemName) {
            console.warn(`[Debug][handler] Item ${recordId} has no Name field. Aborting.`);
            return { statusCode: 400, body: JSON.stringify({ error: `Item ${recordId} has no name.` }) };
        }

        // 2. Generate the Universal Profile via Gemini
        console.log(`[Debug][handler] STEP 2: Calling Gemini API for profiling`);
        const profileJson = await getProfileFromGemini(itemName, itemDescription);
        console.log(`[Debug][handler] AI profile generated successfully`);
        console.log(`[Debug][handler] Profile keys: ${Object.keys(profileJson).join(', ')}`);

        // 3. Update the Item record in Airtable
        console.log(`[Debug][handler] STEP 3: Updating Airtable record`);
        const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${recordId}`;
        const payload = {
            fields: {
                [RANKINGS_FIELD]: JSON.stringify(profileJson, null, 2) // Pretty-print the JSON
            }
        };

        console.log(`[Debug][handler] Patch URL: ${patchUrl}`);
        console.log(`[Debug][handler] Patching field: ${RANKINGS_FIELD}`);
        console.log(`[Debug][handler] Payload size: ${JSON.stringify(payload).length} bytes`);

        const patchRes = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log(`[Debug][handler] Patch response status: ${patchRes.status} ${patchRes.statusText}`);

        if (!patchRes.ok) {
            const errorBody = await patchRes.text();
            console.error(`[Debug][handler] Airtable patch FAILED - Status: ${patchRes.status}`);
            console.error(`[Debug][handler] Airtable patch FAILED - Body: ${errorBody}`);
            throw new Error(`Failed to update Rankings for item ${recordId} in Airtable.`);
        }

        console.log(`[Debug][handler] ========================================`);
        console.log(`[Debug][handler] SUCCESS: Item ${recordId} profiled and updated`);
        console.log(`[Debug][handler] ========================================`);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, recordId: recordId, profile: profileJson })
        };

    } catch (error) {
        console.error(`[ERROR][handler] Function execution failed`);
        console.error(`[ERROR][handler] Error message: ${error.message}`);
        console.error(`[ERROR][handler] Error stack: ${error.stack}`);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Function execution failed: ${error.message}` })
        };
    }
};
