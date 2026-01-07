// REPURPOSED FILE: This is now the /api/profile-item function.
const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY } = process.env;

const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD'; // Main catalog table
// --- THIS IS THE CHANGE ---
const PROFILE_FIELD = 'AI_Profile'; // Use the new safe field
// --- END CHANGE ---
const NAME_FIELD = 'Name';
const DESCRIPTION_FIELD = 'Description';

/**
 * Extracts a JSON object from a string, even if it's wrapped in markdown.
 * @param {string} text - The raw text response from the AI.
 * @returns {object} The parsed JSON object.
 */
function cleanAndParseGeminiJson(text) {
  console.log('[Debug] Raw Gemini Text:', text);
  const jsonMatch = text.match(/{[\s\S]*}/);
  if (!jsonMatch) {
    throw new Error('Gemini response did not contain a valid JSON object.');
  }
  const jsonString = jsonMatch[0];
  try {
    return JSON.parse(jsonString);
  } catch (parseError) {
    console.error('[Debug] Failed to parse extracted JSON:', parseError);
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
    console.log(`[Debug] getProfileFromGemini: Profiling item: ${itemName}`);
    if (!GEMINI_API_KEY) {
        console.error("[Debug] CRITICAL: GEMINI_API_KEY is missing!");
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

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    console.log(`[Debug] getProfileFromGemini: Sending request to Gemini...`);
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    console.log(`[Debug] getProfileFromGemini: Received status ${response.status} from Gemini.`);

    if (!response.ok) {
        let errorBody = await response.text();
        console.error("[Debug] Gemini API Error Response Body:", errorBody);
        throw new Error(`Gemini API call failed with status ${response.status}`);
    }

    const result = await response.json();
    let jsonText = '';
    try {
        jsonText = result.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error('[Debug] Error extracting text from Gemini response structure:', JSON.stringify(result, null, 2));
        throw new Error('Could not extract text from Gemini response.');
    }
    
    console.log(`[Debug] getProfileFromGemini: Received text response from Gemini.`);
    return cleanAndParseGeminiJson(jsonText); // This will parse and return the object
}

exports.handler = async (event) => {
    console.log(`[Debug] /api/profile-item handler invoked. Method: ${event.httpMethod}`);
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { recordId } = JSON.parse(event.body);
        if (!recordId) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing recordId' }) };
        }

        console.log(`[Debug] Processing profile for record: ${recordId}`);

        // 1. Fetch the Item's Name and Description
        const fetchUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${recordId}?fields[]=${NAME_FIELD}&fields[]=${DESCRIPTION_FIELD}`;
        console.log(`[Debug] Fetching item details from: ${fetchUrl}`);
        const itemResponse = await fetch(fetchUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });

        if (!itemResponse.ok) {
            console.error(`[Debug] Airtable fetch failed: ${itemResponse.status}`);
            throw new Error(`Failed to fetch item ${recordId} from Airtable. Status: ${itemResponse.statusText}`);
        }

        const itemRecord = await itemResponse.json();
        const itemName = itemRecord.fields[NAME_FIELD];
        const itemDescription = itemRecord.fields[DESCRIPTION_FIELD];

        if (!itemName) {
            console.warn(`[Debug] Item ${recordId} has no Name field. Aborting.`);
            return { statusCode: 400, body: JSON.stringify({ error: `Item ${recordId} has no name.` }) };
        }
         console.log(`[Debug] Fetched item. Name: ${itemName}`);

        // 2. Generate the Universal Profile via Gemini
        const profileJson = await getProfileFromGemini(itemName, itemDescription);
        console.log(`[Debug] AI profile generated for ${recordId}.`);

        // 3. Update the Item record in Airtable
        const patchUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}/${recordId}`;
        const payload = {
            fields: {
                // --- THIS IS THE CHANGE ---
                [PROFILE_FIELD]: JSON.stringify(profileJson, null, 2) // Pretty-print the JSON
                // --- END CHANGE ---
            }
        };

        console.log(`[Debug] Patching Airtable record ${recordId} in field ${PROFILE_FIELD}...`);
        const patchRes = await fetch(patchUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!patchRes.ok) {
            const errorBody = await patchRes.text();
            console.error(`[Debug] Airtable patch failed. Status: ${patchRes.status}, Body: ${errorBody}`);
            throw new Error(`Failed to update ${PROFILE_FIELD} for item ${recordId} in Airtable.`);
        }

        console.log(`[Debug] Successfully profiled and updated item ${recordId}.`);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, recordId: recordId, profile: profileJson })
        };

    } catch (error) {
        console.error('[ERROR] /api/profile-item handler failed:', error.message, error.stack);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Function execution failed: ${error.message}` })
        };
    }
};
