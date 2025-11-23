// CREATE NEW FILE AT: netlify/functions/process-weblink.js

const fetch = require('node-fetch');
const { GEMINI_API_KEY } = process.env;

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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  
  if (!GEMINI_API_KEY) {
      console.error("CRITICAL: GEMINI_API_KEY is not set.");
      return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error.' }) };
  }

  try {
    const { query } = JSON.parse(event.body);
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing "query" in request body.' }) };
    }

    console.log(`[process-weblink] Parsing query: ${query}`);

    const aiPrompt = `
      You are an expert event planner for the San Francisco Bay Area. A user has provided a URL or name for an activity, venue, or restaurant.
      Your task is to search the web for relevant information about this query and parse it into a structured format.
      Respond ONLY with a valid JSON object. Do not include markdown \`\`\`json or any text before or after the JSON.

      The JSON object must have these fields:
      - "Name": The official name of the item (e.g., "Exploratorium After Dark").
      - "Description": A 1-2 sentence compelling description for an event plan.
      - "Price": An *estimated* price per person as a single number. Use 0 if it's free or the price is unknown/complex (like a full restaurant buyout).
      - "ServiceType": This should always be "Partner Activity".
      - "SearchTerms": An array of 8-15 lowercase search terms including:
          * The exact name (lowercase)
          * Synonyms and variations of the activity type
          * Related categories and themes
          * Key descriptive attributes
          * Location-specific terms if relevant

      Example Query: "https://www.exploratorium.edu/after-dark"
      Example Response:
      {
        "Name": "Exploratorium After Dark",
        "Description": "A renowned hands-on museum of science and art, open for adults-only (18+) evenings with a cash bar and music.",
        "Price": 40,
        "ServiceType": "Partner Activity",
        "SearchTerms": ["exploratorium after dark", "science museum", "interactive museum", "hands-on exhibits", "adults only", "18+", "evening event", "nightlife", "museum bar", "san francisco museum", "educational entertainment", "stem activities"]
      }

      Example Query: "Hike at Mount Tamalpais"
      Example Response:
      {
        "Name": "Hike at Mount Tamalpais",
        "Description": "A scenic hike at Mt. Tamalpais State Park, offering stunning views of the Bay Area and the Pacific Ocean.",
        "Price": 0,
        "ServiceType": "Partner Activity",
        "SearchTerms": ["mount tamalpais", "mt tam", "hiking", "outdoor activity", "nature walk", "trail", "scenic views", "bay area views", "state park", "marin county", "exercise", "wellness", "group hike"]
      }

      IMPORTANT: Use web search to find accurate, up-to-date information about the item before generating the response.
    `;

    console.log('[process-weblink] Sending data to Gemini API with web grounding enabled.');
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [ { text: aiPrompt }, { text: `Query: "${query}"` } ] }],
        tools: [{
          googleSearch: {}
        }]
      })
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error('[process-weblink] Gemini API Error:', errorBody);
      console.error('[process-weblink] DEBUG - Request payload:', JSON.stringify({
        model: 'gemini-2.0-flash-exp',
        query: query,
        tools: 'googleSearch'
      }));
      throw new Error(`Gemini API request failed: ${errorBody}`);
    }

    const geminiResult = await geminiResponse.json();
    console.log('[process-weblink] DEBUG - Full Gemini response structure:', JSON.stringify(geminiResult, null, 2));

    const geminiTextResponse = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!geminiTextResponse) {
      throw new Error('Could not find text in Gemini response.');
    }

    const extractedData = cleanAndParseGeminiJson(geminiTextResponse);
    console.log('[process-weblink] Success. Parsed data:', extractedData);
    
    // Return the JSON data for the new item
    return {
      statusCode: 200,
      body: JSON.stringify(extractedData),
    };

  } catch (error) {
    console.error('--- [process-weblink] FUNCTION FAILED ---');
    console.error('Error details:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to process web link: ' + error.message }) };
  }
};
