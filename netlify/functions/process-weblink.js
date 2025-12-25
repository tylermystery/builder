// netlify/functions/process-weblink.js
// Hybrid Search AI Processor - Handles both specific items and broad category queries

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

    // Enhanced AI prompt for hybrid search - handles both specific items and broad categories
    const aiPrompt = `
You are an expert event planner for the San Francisco Bay Area. A user has provided a search query that could be:
1. A SPECIFIC ITEM: A URL, a specific restaurant/venue name, or a clearly defined activity (e.g., "https://exploratorium.edu", "Chez Panisse", "Alcatraz tour")
2. A BROAD CATEGORY: A general type of activity or cuisine (e.g., "Italian food", "Team Building", "outdoor activities", "fun restaurants")

Your task is to:
1. First, analyze whether the query is a SPECIFIC ITEM or a BROAD CATEGORY
2. Return a JSON response based on the query type

RESPOND ONLY WITH A VALID JSON OBJECT. Do not include markdown code blocks or any text before/after the JSON.

=== IF SPECIFIC ITEM ===
Return this structure:
{
  "itemType": "Specific",
  "Name": "The official name",
  "Description": "A 1-2 sentence compelling description for an event plan.",
  "Price": <number - estimated price per person, use 0 if free or unknown>,
  "ServiceType": "Partner Activity",
  "relatedKeywords": ["keyword1", "keyword2", "keyword3"]
}

=== IF BROAD CATEGORY ===
Return this structure with 3-5 top recommendations:
{
  "itemType": "Grouping",
  "name": "Top [Category] Options",
  "Description": "A brief description of this category of options.",
  "children": [
    {
      "Name": "Specific Place 1",
      "Description": "1-2 sentence description",
      "Price": <number>,
      "ServiceType": "Partner Activity"
    },
    {
      "Name": "Specific Place 2",
      "Description": "1-2 sentence description",
      "Price": <number>,
      "ServiceType": "Partner Activity"
    },
    {
      "Name": "Specific Place 3",
      "Description": "1-2 sentence description",
      "Price": <number>,
      "ServiceType": "Partner Activity"
    }
  ],
  "relatedKeywords": ["related1", "related2", "related3", "related4", "related5"]
}

=== EXAMPLES ===

Example Query: "https://www.exploratorium.edu/after-dark"
Example Response (Specific):
{
  "itemType": "Specific",
  "Name": "Exploratorium After Dark",
  "Description": "A renowned hands-on museum of science and art, open for adults-only (18+) evenings with a cash bar and music.",
  "Price": 40,
  "ServiceType": "Partner Activity",
  "relatedKeywords": ["museums", "nightlife", "interactive", "science", "date night"]
}

Example Query: "Italian food"
Example Response (Grouping):
{
  "itemType": "Grouping",
  "name": "Top Italian Options",
  "Description": "Excellent Italian dining experiences in the San Francisco Bay Area, from casual trattorias to fine dining.",
  "children": [
    {
      "Name": "Flour + Water",
      "Description": "Award-winning Mission district spot known for fresh pasta and wood-fired Neapolitan pizza.",
      "Price": 65,
      "ServiceType": "Partner Activity"
    },
    {
      "Name": "Delfina",
      "Description": "Neighborhood Italian favorite serving seasonal Californian-Italian cuisine in a warm atmosphere.",
      "Price": 55,
      "ServiceType": "Partner Activity"
    },
    {
      "Name": "Cotogna",
      "Description": "Michael Tusk's rustic Italian kitchen featuring house-made pastas and wood-fired dishes.",
      "Price": 75,
      "ServiceType": "Partner Activity"
    }
  ],
  "relatedKeywords": ["pasta", "pizza", "fine dining", "trattorias", "wine bars"]
}

Example Query: "Team Building"
Example Response (Grouping):
{
  "itemType": "Grouping",
  "name": "Top Team Building Options",
  "Description": "Engaging team building activities in the Bay Area to strengthen collaboration and have fun.",
  "children": [
    {
      "Name": "Escape Room SF",
      "Description": "Challenging themed escape rooms that require teamwork and communication to solve puzzles.",
      "Price": 35,
      "ServiceType": "Partner Activity"
    },
    {
      "Name": "Urban Putt",
      "Description": "Indoor miniature golf in a creative, art-filled space perfect for casual team outings.",
      "Price": 15,
      "ServiceType": "Partner Activity"
    },
    {
      "Name": "The Winery SF",
      "Description": "Wine blending workshops where teams create their own custom blend in an urban winery.",
      "Price": 75,
      "ServiceType": "Partner Activity"
    }
  ],
  "relatedKeywords": ["corporate events", "group activities", "workshops", "games", "bonding"]
}
`;

    console.log('[process-weblink] Sending data to Gemini API for hybrid search.');
    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: aiPrompt }, { text: `Query: "${query}"` }] }]
      })
    });

    if (!geminiResponse.ok) {
      const errorBody = await geminiResponse.text();
      console.error('[process-weblink] Gemini API Error:', errorBody);
      throw new Error(`Gemini API request failed: ${errorBody}`);
    }

    const geminiResult = await geminiResponse.json();
    const geminiTextResponse = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!geminiTextResponse) {
      throw new Error('Could not find text in Gemini response.');
    }

    const extractedData = cleanAndParseGeminiJson(geminiTextResponse);

    // Log the response type for debugging
    console.log(`[process-weblink] Success. Response type: ${extractedData.itemType}`);
    console.log('[process-weblink] Parsed data:', JSON.stringify(extractedData, null, 2));

    // Return the JSON data - frontend will handle both Specific and Grouping types
    return {
      statusCode: 200,
      body: JSON.stringify(extractedData),
    };

  } catch (error) {
    console.error('--- [process-weblink] FUNCTION FAILED ---');
    console.error('Error details:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to process search: ' + error.message }) };
  }
};
