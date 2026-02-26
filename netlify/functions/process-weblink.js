// netlify/functions/process-weblink.js
// Hybrid Search AI Processor - Handles both specific items and broad category queries
// Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)

const { generateText, parseJsonResponse } = require('./utils/ai-provider');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  console.log(`[process-weblink] Handler invoked. Method: ${event.httpMethod}`);

  try {
    const { query } = JSON.parse(event.body);
    if (!query) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing "query" in request body.' }) };
    }

    console.log(`[process-weblink] Parsing query: "${query}"`);

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
- "Confidence": A confidence score from 0.0 to 1.0 indicating how certain you are about this information:
  - 1.0: Certain - verified real business, well-known, URL provided, direct knowledge
  - 0.8-0.99: High confidence - real business you recognize, details likely accurate
  - 0.6-0.79: Moderate - generic/category-based suggestion, some details may be estimates
  - 0.4-0.59: Low - speculative suggestion, details are best guesses
  - 0.0-0.39: Very low - highly uncertain, placeholder information
  Be honest - if the user provided a specific URL, that's high confidence. If you're making general category suggestions, that's moderate confidence.
- "Website": The official website URL (use actual known URLs, or null if unknown)
- "Location": Full address or neighborhood/area (e.g., "123 Main St, San Francisco, CA" or "Mission District, San Francisco")
- "Availability": General availability info (e.g., "Open daily 10am-6pm", "Reservations required", "Weekends only", "By appointment")
- "LeadTime": Approximate booking lead time (e.g., "Book 1-2 weeks ahead", "Same-day available", "2-4 weeks for groups", "Walk-ins welcome")
- "GoodToKnow": Any helpful additional info (e.g., "Free parking available", "21+ only", "Vegetarian options available", "Wheelchair accessible")
- "ImageKeywords": A concise, space-separated string of 2-4 descriptive keywords that would match stock/event photos for this activity. Use simple, searchable terms like "wine tasting", "escape room", "kayak ocean", "cooking class", "golf course", "museum art". Do NOT use commas. Examples:
  - For a wine tasting venue: "wine tasting vineyard"
  - For an escape room: "escape room puzzle"
  - For a cooking class: "cooking class kitchen"
  - For a charter bus: "charter bus transportation"
  - For a restaurant: "restaurant dining fine"
  - For outdoor activities: "hiking nature outdoor"
- "PricingType": How the service is priced. IMPORTANT - select the most appropriate type:
  - "per person" - Most common. Use for restaurants, individual tickets, per-person experiences (e.g., escape rooms, museum admission, cooking classes, wine tastings, individual tours)
  - "per charter" or "per bus" - For charter bus services, coach rentals, party buses. Price is for the whole vehicle, not per seat.
  - "per vehicle" - For limo services, car rentals, boat charters. Price is for the entire vehicle.
  - "per hour" - For services charged hourly (e.g., private chef, DJ, photographer, venue rentals by the hour)
  - "per group" - For activities priced per group regardless of size (e.g., private event packages, group workshops with fixed pricing)
  - "flat rate" - For services with a single fixed price (e.g., venue rental for the day, private event space)
  Default to "flat rate" if unclear, but be intelligent about transportation and vehicle services.
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
  "Confidence": <0.0-1.0 - how certain you are about this info>,
  "Price": <number - estimated price, use 0 if free or unknown>,
  "PricingType": "<per person|per charter|per bus|per vehicle|per hour|per group|flat rate>",
  "ServiceType": "Partner Activity",
  "Website": "https://example.com",
  "Location": "Full address or area, City, CA",
  "Availability": "Operating hours or booking info",
  "LeadTime": "How far ahead to book",
  "GoodToKnow": "Any helpful additional details",
  "ImageKeywords": "space-separated keywords for photo search",
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
      "Confidence": <0.0-1.0>,
      "Price": <number>,
      "PricingType": "<per person|per charter|per bus|per vehicle|per hour|per group|flat rate>",
      "ServiceType": "Partner Activity",
      "Website": "https://example1.com",
      "Location": "Address or area",
      "Availability": "Hours/booking info",
      "LeadTime": "Booking lead time",
      "GoodToKnow": "Additional helpful info",
      "ImageKeywords": "space-separated keywords for photo search",
      "Rankings": { "Fun": 8, "Social": 7, "Active": 3, "Creative": 5, "Learning": 6, "Relaxing": 4 }
    }
  ],
  "relatedKeywords": ["related1", "related2", "related3", "related4", "related5"]
}

Query: "${query}"`;

    console.log('[process-weblink] Sending query to AI provider (with fallback).');
    const aiResult = await generateText(aiPrompt, {
      caller: 'process-weblink',
      maxRetries: 1,
    });

    if (!aiResult.ok) {
      console.error('[process-weblink] AI provider failed:', aiResult.error);
      const isQuota = aiResult.quotaExhausted || false;
      return {
        statusCode: isQuota ? 429 : 500,
        body: JSON.stringify({
          error: isQuota
            ? 'AI quota exceeded. The AI search feature is temporarily unavailable. You can still add items manually.'
            : 'AI service is currently unavailable. Please try again in a moment.',
          retryable: !isQuota,
          quotaExhausted: isQuota,
          provider: aiResult.provider,
        })
      };
    }

    console.log(`[process-weblink] AI response received from ${aiResult.providerName}`);

    const extractedData = parseJsonResponse(aiResult.text);

    // Log the response type for debugging
    console.log(`[process-weblink] Success via ${aiResult.providerName}. Response type: ${extractedData.itemType}`);

    // === IMAGE DEBUG: Log ImageKeywords specifically ===
    console.log('[IMAGE DEBUG] ========== PROCESS-WEBLINK IMAGE DATA ==========');
    if (extractedData.itemType === 'Grouping' && extractedData.children) {
      extractedData.children.forEach((child, idx) => {
        console.log(`[IMAGE DEBUG] Child ${idx} "${child.Name}" - ImageKeywords: "${child.ImageKeywords}"`);
      });
    } else if (extractedData.Name) {
      console.log(`[IMAGE DEBUG] Single item "${extractedData.Name}" - ImageKeywords: "${extractedData.ImageKeywords}"`);
    }
    console.log('[IMAGE DEBUG] ====================================================');

    // Return the JSON data with provider info - frontend will handle both Specific and Grouping types
    return {
      statusCode: 200,
      body: JSON.stringify({ ...extractedData, _aiProvider: aiResult.provider }),
    };

  } catch (error) {
    console.error('--- [process-weblink] FUNCTION FAILED ---');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    return { statusCode: 500, body: JSON.stringify({ error: 'Failed to process search: ' + error.message, errorName: error.name, debugStack: error.stack?.split('\n').slice(0, 3).join(' | ') }) };
  }
};
