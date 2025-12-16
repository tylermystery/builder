// REPURPOSED FILE: This is now the /api/profile-item function.
const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY } = process.env;

const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Main catalog table
// --- THIS IS THE CHANGE ---
const PROFILE_FIELD = 'AI_Profile'; // Use the new safe field
// --- END CHANGE ---
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
  console.log('[Debug][hello_world][cleanAndParseGeminiJson] Raw Gemini Text length:', text ? text.length : 0);
  console.log('[Debug][hello_world][cleanAndParseGeminiJson] Raw Gemini Text preview:', text ? text.substring(0, 500) : 'null/empty');
  const jsonMatch = text.match(/{[\s\S]*}/);
  if (!jsonMatch) {
    console.error('[Debug][hello_world][cleanAndParseGeminiJson] No JSON object found in response');
    throw new Error('Gemini response did not contain a valid JSON object.');
  }
  const jsonString = jsonMatch[0];
  console.log('[Debug][hello_world][cleanAndParseGeminiJson] Extracted JSON string length:', jsonString.length);
  try {
    const parsed = JSON.parse(jsonString);
    console.log('[Debug][hello_world][cleanAndParseGeminiJson] Successfully parsed JSON with keys:', Object.keys(parsed).join(', '));
    return parsed;
  } catch (parseError) {
    console.error('[Debug][hello_world][cleanAndParseGeminiJson] Failed to parse extracted JSON:', parseError.message);
    console.error('[Debug][hello_world][cleanAndParseGeminiJson] JSON string that failed to parse:', jsonString.substring(0, 500));
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
    console.log(`[Debug][hello_world][getProfileFromGemini] === STARTING GEMINI API CALL ===`);
    console.log(`[Debug][hello_world][getProfileFromGemini] Profiling item: "${itemName}"`);
    console.log(`[Debug][hello_world][getProfileFromGemini] Description length: ${(itemDescription || '').length} chars`);

    // Check environment variables
    console.log(`[Debug][hello_world][getProfileFromGemini] ENV CHECK - GEMINI_API_KEY present: ${!!GEMINI_API_KEY}`);
    console.log(`[Debug][hello_world][getProfileFromGemini] ENV CHECK - GEMINI_API_KEY length: ${GEMINI_API_KEY ? GEMINI_API_KEY.length : 0}`);

    if (!GEMINI_API_KEY) {
        console.error("[Debug][hello_world][getProfileFromGemini] CRITICAL: GEMINI_API_KEY is missing!");
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
        "Tags": []
      }

      INSTRUCTIONS:
      1.  **Pillars:** Score 1-10 if the item *is* this thing (e.g., Go-Karts is "Activities": 10. A taco bar is "Food/Drink": 10). Most items are only one pillar.
      2.  **Vibe:** Score 0-10 for Energy (active) vs. Relaxation (calm), Formality (fancy) vs. Novelty (unique).
      3.  **Intellect/Physicality:** Score 0-10 for these attributes.
      4.  **Tags (CRITICAL):** Populate this array with lowercase string keywords.
          * **Attribute Tags:** Descriptive words (e.g., "competitive", "outdoor", "relaxing", "loud", "daytime").
          * **Concrete Noun Tags:** Specific keywords for content, theme, or category (e.g., "go-kart", "racing", "museum", "art", "science", "tacos", "mexican food", "bar").
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

    console.log(`[Debug][hello_world][getProfileFromGemini] Using Gemini model: ${GEMINI_MODEL}`);
    console.log(`[Debug][hello_world][getProfileFromGemini] API URL (without key): https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
    console.log(`[Debug][hello_world][getProfileFromGemini] Payload size: ${JSON.stringify(payload).length} bytes`);
    console.log(`[Debug][hello_world][getProfileFromGemini] Sending request to Gemini API...`);

    const startTime = Date.now();
    let response;
    try {
        response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    } catch (fetchError) {
        console.error(`[Debug][hello_world][getProfileFromGemini] FETCH ERROR: ${fetchError.message}`);
        throw new Error(`Network error calling Gemini API: ${fetchError.message}`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[Debug][hello_world][getProfileFromGemini] Response received in ${elapsed}ms`);
    console.log(`[Debug][hello_world][getProfileFromGemini] Response status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
        let errorBody = await response.text();
        console.error(`[Debug][hello_world][getProfileFromGemini] API ERROR - Status: ${response.status}`);
        console.error(`[Debug][hello_world][getProfileFromGemini] API ERROR - Body: ${errorBody}`);
        throw new Error(`Gemini API call failed with status ${response.status}: ${errorBody.substring(0, 500)}`);
    }

    console.log(`[Debug][hello_world][getProfileFromGemini] Response OK, parsing JSON...`);
    const result = await response.json();
    console.log(`[Debug][hello_world][getProfileFromGemini] Response JSON keys: ${Object.keys(result).join(', ')}`);

    // Log safety/filter info if present
    if (result.promptFeedback) {
        console.log(`[Debug][hello_world][getProfileFromGemini] promptFeedback: ${JSON.stringify(result.promptFeedback)}`);
    }
    if (result.candidates && result.candidates[0]) {
        console.log(`[Debug][hello_world][getProfileFromGemini] Candidate finishReason: ${result.candidates[0].finishReason || 'not specified'}`);
    }

    let jsonText = '';
    try {
        if (!result.candidates || result.candidates.length === 0) {
            console.error(`[Debug][hello_world][getProfileFromGemini] No candidates in response. Full response: ${JSON.stringify(result)}`);
            throw new Error('Gemini response contained no candidates');
        }
        if (!result.candidates[0].content) {
            console.error(`[Debug][hello_world][getProfileFromGemini] No content in first candidate. Candidate: ${JSON.stringify(result.candidates[0])}`);
            throw new Error('Gemini response candidate has no content');
        }
        if (!result.candidates[0].content.parts || result.candidates[0].content.parts.length === 0) {
            console.error(`[Debug][hello_world][getProfileFromGemini] No parts in content. Content: ${JSON.stringify(result.candidates[0].content)}`);
            throw new Error('Gemini response content has no parts');
        }
        jsonText = result.candidates[0].content.parts[0].text;
        console.log(`[Debug][hello_world][getProfileFromGemini] Successfully extracted text from response. Length: ${jsonText.length}`);
    } catch (e) {
        console.error(`[Debug][hello_world][getProfileFromGemini] Error extracting text: ${e.message}`);
        console.error(`[Debug][hello_world][getProfileFromGemini] Full response structure: ${JSON.stringify(result, null, 2)}`);
        throw new Error(`Could not extract text from Gemini response: ${e.message}`);
    }

    console.log(`[Debug][hello_world][getProfileFromGemini] Parsing AI response JSON...`);
    const profileJson = cleanAndParseGeminiJson(jsonText);
    console.log(`[Debug][hello_world][getProfileFromGemini] === GEMINI API CALL COMPLETE ===`);
    return profileJson;
}

exports.handler = async (event) => {
    console.log(`[Debug][hello_world][handler] ========================================`);
    console.log(`[Debug][hello_world][handler] /api/hello_world invoked`);
    console.log(`[Debug][hello_world][handler] Method: ${event.httpMethod}`);
    console.log(`[Debug][hello_world][handler] Path: ${event.path}`);
    console.log(`[Debug][hello_world][handler] ========================================`);

    // Environment variable check at handler level
    console.log(`[Debug][hello_world][handler] ENV CHECK - AIRTABLE_PAT present: ${!!AIRTABLE_PAT}`);
    console.log(`[Debug][hello_world][handler] ENV CHECK - BASE_ID: ${BASE_ID || 'NOT SET'}`);
    console.log(`[Debug][hello_world][handler] ENV CHECK - GEMINI_API_KEY present: ${!!GEMINI_API_KEY}`);
    console.log(`[Debug][hello_world][handler] ENV CHECK - GEMINI_MODEL: ${GEMINI_MODEL}`);

    if (event.httpMethod !== 'POST') {
        console.log(`[Debug][hello_world][handler] Rejecting non-POST request`);
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        console.log(`[Debug][hello_world][handler] Request body: ${event.body}`);
        const { recordId } = JSON.parse(event.body);
        if (!recordId) {
            console.log(`[Debug][hello_world][handler] Missing recordId in request body`);
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing recordId' }) };
        }

        console.log(`[Debug][hello_world][handler] Processing profile for record: ${recordId}`);

        // 1. Fetch the Item's Name and Description
        const fetchUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${recordId}`;
        console.log(`[Debug][hello_world][handler] STEP 1: Fetching item from Airtable`);
        console.log(`[Debug][hello_world][handler] Airtable URL: ${fetchUrl}`);

        const itemResponse = await fetch(fetchUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        console.log(`[Debug][hello_world][handler] Airtable response status: ${itemResponse.status} ${itemResponse.statusText}`);

        if (!itemResponse.ok) {
            const errorBody = await itemResponse.text();
            console.error(`[Debug][hello_world][handler] Airtable fetch FAILED - Status: ${itemResponse.status}`);
            console.error(`[Debug][hello_world][handler] Airtable fetch FAILED - Body: ${errorBody}`);
            throw new Error(`Failed to fetch item ${recordId} from Airtable. Status: ${itemResponse.statusText}`);
        }

        const itemRecord = await itemResponse.json();
        console.log(`[Debug][hello_world][handler] Airtable record fetched. ID: ${itemRecord.id}`);

        const itemName = itemRecord.fields[NAME_FIELD];
        const itemDescription = itemRecord.fields[DESCRIPTION_FIELD];

        console.log(`[Debug][hello_world][handler] Item Name: "${itemName}"`);
        console.log(`[Debug][hello_world][handler] Item Description length: ${(itemDescription || '').length}`);

        if (!itemName) {
            console.warn(`[Debug][hello_world][handler] Item ${recordId} has no Name field. Aborting.`);
            return { statusCode: 400, body: JSON.stringify({ error: `Item ${recordId} has no name.` }) };
        }

        // 2. Generate the Universal Profile via Gemini
        console.log(`[Debug][hello_world][handler] STEP 2: Calling Gemini API for profiling`);
        const profileJson = await getProfileFromGemini(itemName, itemDescription);
        console.log(`[Debug][hello_world][handler] AI profile generated successfully`);
        console.log(`[Debug][hello_world][handler] Profile keys: ${Object.keys(profileJson).join(', ')}`);

        // 3. Update the Item record in Airtable
        console.log(`[Debug][hello_world][handler] STEP 3: Updating Airtable record`);
        const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${recordId}`;
        const payload = {
            fields: {
                [PROFILE_FIELD]: JSON.stringify(profileJson, null, 2)
            }
        };

        console.log(`[Debug][hello_world][handler] Patch URL: ${patchUrl}`);
        console.log(`[Debug][hello_world][handler] Patching field: ${PROFILE_FIELD}`);

        const patchRes = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        console.log(`[Debug][hello_world][handler] Patch response status: ${patchRes.status} ${patchRes.statusText}`);

        if (!patchRes.ok) {
            const errorBody = await patchRes.text();
            console.error(`[Debug][hello_world][handler] Airtable patch FAILED - Status: ${patchRes.status}`);
            console.error(`[Debug][hello_world][handler] Airtable patch FAILED - Body: ${errorBody}`);
            throw new Error(`Failed to update ${PROFILE_FIELD} for item ${recordId} in Airtable.`);
        }

        console.log(`[Debug][hello_world][handler] ========================================`);
        console.log(`[Debug][hello_world][handler] SUCCESS: Item ${recordId} profiled and updated`);
        console.log(`[Debug][hello_world][handler] ========================================`);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, recordId: recordId, profile: profileJson })
        };

    } catch (error) {
        console.error(`[ERROR][hello_world][handler] Function execution failed`);
        console.error(`[ERROR][hello_world][handler] Error message: ${error.message}`);
        console.error(`[ERROR][hello_world][handler] Error stack: ${error.stack}`);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Function execution failed: ${error.message}` })
        };
    }
};
