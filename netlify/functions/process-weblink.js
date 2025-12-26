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
    // Now includes comprehensive business info: website, location, availability, lead time, rankings
    const aiPrompt = `
You are an expert event planner for the San Francisco Bay Area. A user has provided a search query that could be:
1. A SPECIFIC ITEM: A URL, a specific restaurant/venue name, or a clearly defined activity (e.g., "https://exploratorium.edu", "Chez Panisse", "Alcatraz tour")
2. A BROAD CATEGORY: A general type of activity or cuisine (e.g., "Italian food", "Team Building", "outdoor activities", "fun restaurants")

Your task is to:
1. First, analyze whether the query is a SPECIFIC ITEM or a BROAD CATEGORY
2. Return a JSON response based on the query type WITH COMPREHENSIVE BUSINESS INFORMATION

RESPOND ONLY WITH A VALID JSON OBJECT. Do not include markdown code blocks or any text before/after the JSON.

=== COMPREHENSIVE BUSINESS INFO FIELDS (include in ALL items) ===
- "Website": The official website URL (use actual known URLs, or null if unknown)
- "Location": Full address or neighborhood/area (e.g., "123 Main St, San Francisco, CA" or "Mission District, San Francisco")
- "Availability": General availability info (e.g., "Open daily 10am-6pm", "Reservations required", "Weekends only", "By appointment")
- "LeadTime": Approximate booking lead time (e.g., "Book 1-2 weeks ahead", "Same-day available", "2-4 weeks for groups", "Walk-ins welcome")
- "GoodToKnow": Any helpful additional info (e.g., "Free parking available", "21+ only", "Vegetarian options available", "Wheelchair accessible")
- "PricingType": How the service is priced. IMPORTANT - select the most appropriate type:
  - "per person" - Most common. Use for restaurants, individual tickets, per-person experiences (e.g., escape rooms, museum admission, cooking classes, wine tastings, individual tours)
  - "per charter" or "per bus" - For charter bus services, coach rentals, party buses. Price is for the whole vehicle, not per seat.
  - "per vehicle" - For limo services, car rentals, boat charters. Price is for the entire vehicle.
  - "per hour" - For services charged hourly (e.g., private chef, DJ, photographer, venue rentals by the hour)
  - "per group" - For activities priced per group regardless of size (e.g., private event packages, group workshops with fixed pricing)
  - "flat rate" - For services with a single fixed price (e.g., venue rental for the day, private event space)
  Default to "per person" if unclear, but be intelligent about transportation and vehicle services.
- "Rankings": An object with activity profile scores from 0-10:
  - "Fun": How entertaining/enjoyable (0=boring, 10=extremely fun)
  - "Social": How much social interaction (0=solo, 10=highly social)
  - "Active": Physical activity level (0=sedentary, 10=very active)
  - "Creative": Creativity involved (0=none, 10=highly creative)
  - "Learning": Educational value (0=none, 10=very educational)
  - "Relaxing": How relaxing/calming (0=stressful, 10=very relaxing)

=== IF SPECIFIC ITEM ===
Return this structure:
{
  "itemType": "Specific",
  "Name": "The official name",
  "Description": "A 1-2 sentence compelling description for an event plan.",
  "Price": <number - estimated price, use 0 if free or unknown>,
  "PricingType": "<per person|per charter|per bus|per vehicle|per hour|per group|flat rate>",
  "ServiceType": "Partner Activity",
  "Website": "https://example.com",
  "Location": "Full address or area, City, CA",
  "Availability": "Operating hours or booking info",
  "LeadTime": "How far ahead to book",
  "GoodToKnow": "Any helpful additional details",
  "Rankings": {
    "Fun": <0-10>,
    "Social": <0-10>,
    "Active": <0-10>,
    "Creative": <0-10>,
    "Learning": <0-10>,
    "Relaxing": <0-10>
  },
  "relatedKeywords": ["keyword1", "keyword2", "keyword3"]
}

=== IF BROAD CATEGORY ===
Return this structure with 3-5 top recommendations, EACH with comprehensive info:
{
  "itemType": "Grouping",
  "name": "Top [Category] Options",
  "Description": "A brief description of this category of options.",
  "children": [
    {
      "Name": "Specific Place 1",
      "Description": "1-2 sentence description",
      "Price": <number>,
      "PricingType": "<per person|per charter|per bus|per vehicle|per hour|per group|flat rate>",
      "ServiceType": "Partner Activity",
      "Website": "https://example1.com",
      "Location": "Address or area",
      "Availability": "Hours/booking info",
      "LeadTime": "Booking lead time",
      "GoodToKnow": "Additional helpful info",
      "Rankings": { "Fun": 8, "Social": 7, "Active": 3, "Creative": 5, "Learning": 6, "Relaxing": 4 }
    },
    {
      "Name": "Specific Place 2",
      "Description": "1-2 sentence description",
      "Price": <number>,
      "PricingType": "<per person|per charter|per bus|per vehicle|per hour|per group|flat rate>",
      "ServiceType": "Partner Activity",
      "Website": "https://example2.com",
      "Location": "Address or area",
      "Availability": "Hours/booking info",
      "LeadTime": "Booking lead time",
      "GoodToKnow": "Additional helpful info",
      "Rankings": { "Fun": 7, "Social": 8, "Active": 5, "Creative": 6, "Learning": 4, "Relaxing": 5 }
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
  "PricingType": "per person",
  "ServiceType": "Partner Activity",
  "Website": "https://www.exploratorium.edu/visit/after-dark",
  "Location": "Pier 15, Embarcadero, San Francisco, CA 94111",
  "Availability": "Thursday evenings 6-10pm (18+ only)",
  "LeadTime": "Book 1 week ahead for guaranteed entry, walk-ins if not sold out",
  "GoodToKnow": "Cash bar available, no outside food/drinks, coat check available",
  "Rankings": {
    "Fun": 9,
    "Social": 8,
    "Active": 4,
    "Creative": 7,
    "Learning": 9,
    "Relaxing": 5
  },
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
      "PricingType": "per person",
      "ServiceType": "Partner Activity",
      "Website": "https://www.flourandwater.com",
      "Location": "2401 Harrison St, San Francisco, CA 94110",
      "Availability": "Dinner nightly 5:30-10pm, limited walk-in bar seating",
      "LeadTime": "Reservations recommended 2-3 weeks ahead for dinner",
      "GoodToKnow": "Street parking only, counter seating available for walk-ins, excellent wine list",
      "Rankings": { "Fun": 7, "Social": 8, "Active": 1, "Creative": 6, "Learning": 3, "Relaxing": 7 }
    },
    {
      "Name": "Delfina",
      "Description": "Neighborhood Italian favorite serving seasonal Californian-Italian cuisine in a warm atmosphere.",
      "Price": 55,
      "PricingType": "per person",
      "ServiceType": "Partner Activity",
      "Website": "https://www.delfinasf.com",
      "Location": "3621 18th St, San Francisco, CA 94110",
      "Availability": "Dinner Tue-Sun 5:30-10pm, closed Mondays",
      "LeadTime": "Book 1-2 weeks ahead, easier on weeknights",
      "GoodToKnow": "Connected to Pizzeria Delfina next door, cozy intimate space",
      "Rankings": { "Fun": 6, "Social": 7, "Active": 1, "Creative": 5, "Learning": 3, "Relaxing": 8 }
    },
    {
      "Name": "Cotogna",
      "Description": "Michael Tusk's rustic Italian kitchen featuring house-made pastas and wood-fired dishes.",
      "Price": 75,
      "PricingType": "per person",
      "ServiceType": "Partner Activity",
      "Website": "https://www.cotognasf.com",
      "Location": "490 Pacific Ave, San Francisco, CA 94133",
      "Availability": "Lunch Mon-Fri, Dinner nightly, Sunday brunch",
      "LeadTime": "Reservations 1-2 weeks ahead, lunch easier to book",
      "GoodToKnow": "Adjacent to sister restaurant Quince, valet parking available",
      "Rankings": { "Fun": 7, "Social": 7, "Active": 1, "Creative": 6, "Learning": 4, "Relaxing": 7 }
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
      "PricingType": "per person",
      "ServiceType": "Partner Activity",
      "Website": "https://www.escapesf.com",
      "Location": "Multiple locations in San Francisco",
      "Availability": "Daily 10am-10pm, groups of 4-8 per room",
      "LeadTime": "Book 1-2 weeks ahead for weekends, shorter for weekdays",
      "GoodToKnow": "Private rooms available for corporate events, difficulty levels vary by room",
      "Rankings": { "Fun": 9, "Social": 9, "Active": 3, "Creative": 8, "Learning": 5, "Relaxing": 2 }
    },
    {
      "Name": "Urban Putt",
      "Description": "Indoor miniature golf in a creative, art-filled space perfect for casual team outings.",
      "Price": 15,
      "PricingType": "per person",
      "ServiceType": "Partner Activity",
      "Website": "https://www.urbanputt.com",
      "Location": "1096 South Van Ness Ave, San Francisco, CA 94110",
      "Availability": "Mon-Thu 4pm-12am, Fri-Sun 11am-12am, 21+ after 8pm",
      "LeadTime": "Walk-ins welcome, groups 8+ should reserve",
      "GoodToKnow": "Full bar and restaurant on-site, artist-designed holes, private event space available",
      "Rankings": { "Fun": 9, "Social": 8, "Active": 2, "Creative": 7, "Learning": 2, "Relaxing": 6 }
    },
    {
      "Name": "The Winery SF",
      "Description": "Wine blending workshops where teams create their own custom blend in an urban winery.",
      "Price": 75,
      "PricingType": "per person",
      "ServiceType": "Partner Activity",
      "Website": "https://www.winery-sf.com",
      "Location": "200 California St, San Francisco, CA 94111",
      "Availability": "Classes Wed-Sun, private events available any day",
      "LeadTime": "Book 2-3 weeks ahead for group workshops",
      "GoodToKnow": "Take home your custom-labeled bottle, food pairings available, 21+ only",
      "Rankings": { "Fun": 8, "Social": 8, "Active": 2, "Creative": 9, "Learning": 7, "Relaxing": 7 }
    }
  ],
  "relatedKeywords": ["corporate events", "group activities", "workshops", "games", "bonding"]
}

Example Query: "charter bus rental"
Example Response (Grouping):
{
  "itemType": "Grouping",
  "name": "Top Charter Bus Options",
  "Description": "Charter bus and coach rental services in the Bay Area for group transportation needs.",
  "children": [
    {
      "Name": "SF Charter Bus Company",
      "Description": "Full-service charter bus rental with professional drivers for corporate events, weddings, and group outings.",
      "Price": 1200,
      "PricingType": "per charter",
      "ServiceType": "Partner Activity",
      "Website": "https://www.sfcharterbus.com",
      "Location": "San Francisco Bay Area - pickup anywhere",
      "Availability": "24/7 availability, advance booking recommended",
      "LeadTime": "Book 2-4 weeks ahead for best availability",
      "GoodToKnow": "Buses seat 30-56 passengers, ADA accessible options available, WiFi on most buses",
      "Rankings": { "Fun": 5, "Social": 8, "Active": 1, "Creative": 1, "Learning": 1, "Relaxing": 6 }
    },
    {
      "Name": "Bay Area Party Bus",
      "Description": "Luxury party buses with premium sound systems, lighting, and bar setups for celebrations.",
      "Price": 800,
      "PricingType": "per bus",
      "ServiceType": "Partner Activity",
      "Website": "https://www.bayareapartybus.com",
      "Location": "Serves entire Bay Area",
      "Availability": "Evenings and weekends most popular, weekday availability",
      "LeadTime": "Book 1-3 weeks ahead, longer for peak season",
      "GoodToKnow": "BYOB allowed, fits 20-40 passengers, 4-hour minimum rental",
      "Rankings": { "Fun": 9, "Social": 9, "Active": 2, "Creative": 3, "Learning": 1, "Relaxing": 4 }
    },
    {
      "Name": "Wine Country Tour Coaches",
      "Description": "Comfortable coach buses perfect for wine country tours and corporate retreats.",
      "Price": 950,
      "PricingType": "per charter",
      "ServiceType": "Partner Activity",
      "Website": "https://www.winecountrytours.com",
      "Location": "San Francisco, Napa, Sonoma",
      "Availability": "Daily tours and private charters available",
      "LeadTime": "Book 1-2 weeks ahead for private charters",
      "GoodToKnow": "Includes experienced driver familiar with wine country routes, cooler for wine purchases",
      "Rankings": { "Fun": 8, "Social": 8, "Active": 1, "Creative": 2, "Learning": 5, "Relaxing": 7 }
    }
  ],
  "relatedKeywords": ["transportation", "group travel", "coach rental", "party bus", "shuttle service"]
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
