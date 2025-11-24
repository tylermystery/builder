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
    const { query, existingItem } = JSON.parse(event.body);
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing "query" in request body.' }) };
    }

    console.log(`[process-weblink] Parsing query: ${query}`);
    if (existingItem) {
      console.log(`[process-weblink] Comparing against existing item:`, existingItem);
    }

    const aiPrompt = existingItem
      ? `
      You are an expert event planner for the San Francisco Bay Area. A user is comparing an existing catalog item against current information from the internet.
      Your task is to search the web for the most accurate, up-to-date information about this item and return it in a structured format.

      EXISTING ITEM DATA:
      - Name: ${existingItem.Name || 'N/A'}
      - Description: ${existingItem.Description || 'N/A'}
      - Price: ${existingItem.Price || 'N/A'}
      - Service Type: ${existingItem.ServiceType || 'N/A'}
      - Current Tags/Search Terms: ${existingItem.SearchTerms ? existingItem.SearchTerms.join(', ') : 'N/A'}

      Your task is to use web search to find the CURRENT, ACCURATE information for this item and return it in the same format.
      Respond ONLY with a valid JSON object. Do not include markdown \`\`\`json or any text before or after the JSON.

      The JSON object must have these fields:
      - "Name": The official name of the item as it appears on the web.
      - "Description": A 1-2 sentence compelling description for an event plan.
      - "Price": An *estimated* price per person as a single number. Use 0 if it's free or the price is unknown/complex.
      - "ServiceType": This should always be "Partner Activity".
      - "SearchTerms": An array of 10-20 lowercase search terms including:
          * The exact name (lowercase)
          * Synonyms and variations of the activity type
          * Related categories and themes
          * Key descriptive attributes
          * Location-specific terms if relevant
      - "Rankings": An object containing quality/popularity rankings from the web:
          * "google": Google rating (out of 5.0) if available, otherwise null
          * "yelp": Yelp rating (out of 5.0) if available, otherwise null
          * "tripadvisor": TripAdvisor rating (out of 5.0) if available, otherwise null
          * "reviews": Total number of reviews across platforms (approximate)
          * "popularity": A text description like "Very Popular", "Moderately Popular", "Niche", based on web presence
      - "Profile": An object containing profiling attributes to help users sort and compare items (all ratings are 1-10 scale):
          * "activityLevel": How physically active is this (1=sedentary/relaxed, 10=very active/intense)
          * "indoorOutdoor": Indoor/outdoor suitability (1=indoor only, 5=both equally, 10=outdoor only)
          * "socialLevel": How social/interactive is this (1=solo/quiet, 10=highly social/collaborative)
          * "competitiveness": How competitive is this activity (1=non-competitive/casual, 10=highly competitive)
          * "uniqueness": How unique/unusual is this (1=common/mainstream, 10=rare/unique)
          * "formalityLevel": How formal is the setting (1=very casual, 10=very formal)
          * "groupSize": Ideal group size category ("individual", "small" (2-6), "medium" (7-15), "large" (15+))
          * "ageAppropriate": Age range suitability ("kids", "teens", "adults", "all-ages")
          * "duration": Typical duration category ("quick" (<1hr), "moderate" (1-3hrs), "extended" (3-6hrs), "full-day" (6+hrs))
          * "accessibility": Accessibility for people with disabilities (1=limited access, 10=fully accessible)
          * "budget": Cost level beyond the listed price (1=very budget-friendly, 10=luxury/premium experience)
          * "weatherDependent": How dependent on weather (1=not affected, 10=highly weather dependent)

      IMPORTANT: Use web search to find accurate, up-to-date information about the item. If any information differs from the existing item, provide the most current information you find online.
      `
      : `
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
      - "Rankings": An object containing quality/popularity rankings from the web:
          * "google": Google rating (out of 5.0) if available, otherwise null
          * "yelp": Yelp rating (out of 5.0) if available, otherwise null
          * "tripadvisor": TripAdvisor rating (out of 5.0) if available, otherwise null
          * "reviews": Total number of reviews across platforms (approximate)
          * "popularity": A text description like "Very Popular", "Moderately Popular", "Niche", based on web presence
      - "Profile": An object containing profiling attributes to help users sort and compare items (all ratings are 1-10 scale):
          * "activityLevel": How physically active is this (1=sedentary/relaxed, 10=very active/intense)
          * "indoorOutdoor": Indoor/outdoor suitability (1=indoor only, 5=both equally, 10=outdoor only)
          * "socialLevel": How social/interactive is this (1=solo/quiet, 10=highly social/collaborative)
          * "competitiveness": How competitive is this activity (1=non-competitive/casual, 10=highly competitive)
          * "uniqueness": How unique/unusual is this (1=common/mainstream, 10=rare/unique)
          * "formalityLevel": How formal is the setting (1=very casual, 10=very formal)
          * "groupSize": Ideal group size category ("individual", "small" (2-6), "medium" (7-15), "large" (15+))
          * "ageAppropriate": Age range suitability ("kids", "teens", "adults", "all-ages")
          * "duration": Typical duration category ("quick" (<1hr), "moderate" (1-3hrs), "extended" (3-6hrs), "full-day" (6+hrs))
          * "accessibility": Accessibility for people with disabilities (1=limited access, 10=fully accessible)
          * "budget": Cost level beyond the listed price (1=very budget-friendly, 10=luxury/premium experience)
          * "weatherDependent": How dependent on weather (1=not affected, 10=highly weather dependent)

      Example Query: "https://www.exploratorium.edu/after-dark"
      Example Response:
      {
        "Name": "Exploratorium After Dark",
        "Description": "A renowned hands-on museum of science and art, open for adults-only (18+) evenings with a cash bar and music.",
        "Price": 40,
        "ServiceType": "Partner Activity",
        "SearchTerms": ["exploratorium after dark", "science museum", "interactive museum", "hands-on exhibits", "adults only", "18+", "evening event", "nightlife", "museum bar", "san francisco museum", "educational entertainment", "stem activities"],
        "Rankings": {
          "google": 4.7,
          "yelp": 4.5,
          "tripadvisor": 4.5,
          "reviews": 8500,
          "popularity": "Very Popular"
        },
        "Profile": {
          "activityLevel": 3,
          "indoorOutdoor": 1,
          "socialLevel": 7,
          "competitiveness": 1,
          "uniqueness": 7,
          "formalityLevel": 4,
          "groupSize": "medium",
          "ageAppropriate": "adults",
          "duration": "moderate",
          "accessibility": 8,
          "budget": 5,
          "weatherDependent": 1
        }
      }

      Example Query: "Hike at Mount Tamalpais"
      Example Response:
      {
        "Name": "Hike at Mount Tamalpais",
        "Description": "A scenic hike at Mt. Tamalpais State Park, offering stunning views of the Bay Area and the Pacific Ocean.",
        "Price": 0,
        "ServiceType": "Partner Activity",
        "SearchTerms": ["mount tamalpais", "mt tam", "hiking", "outdoor activity", "nature walk", "trail", "scenic views", "bay area views", "state park", "marin county", "exercise", "wellness", "group hike"],
        "Rankings": {
          "google": 4.8,
          "yelp": null,
          "tripadvisor": 4.5,
          "reviews": 2300,
          "popularity": "Very Popular"
        },
        "Profile": {
          "activityLevel": 7,
          "indoorOutdoor": 10,
          "socialLevel": 5,
          "competitiveness": 2,
          "uniqueness": 4,
          "formalityLevel": 1,
          "groupSize": "small",
          "ageAppropriate": "all-ages",
          "duration": "moderate",
          "accessibility": 3,
          "budget": 1,
          "weatherDependent": 9
        }
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
