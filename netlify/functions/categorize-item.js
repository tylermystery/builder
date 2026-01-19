/**
 * AI-powered Item Categorizer
 * Takes an item and generates top 3 recommended event categories/use cases
 * Uses Google Gemini AI to intelligently categorize items based on their name, description, and context.
 */

const fetch = require('node-fetch');
const { GEMINI_API_KEY } = process.env;

/**
 * Categorize an item using AI to find the top 3 event types it's best suited for
 * @param {Object} itemData - Item information including name, description, category
 * @returns {Promise<Object>} - Array of top 3 recommended categories with relevance scores
 */
async function categorizeItemWithAI(itemData) {
    console.log(`[Debug] categorizeItemWithAI: Categorizing item: ${itemData.name}`);

    if (!GEMINI_API_KEY) {
        console.error("[Debug] CRITICAL: GEMINI_API_KEY is missing!");
        throw new Error("Server configuration error: Missing Gemini API Key.");
    }

    const prompt = `You are an expert event planner. Analyze the following item/service and determine the TOP 3 types of events or occasions where this item would be most useful or appropriate.

Item Name: ${itemData.name}
Description: ${itemData.description || 'No description provided'}
${itemData.category ? 'Current Category: ' + itemData.category : ''}
${itemData.price ? 'Price: $' + itemData.price : ''}

Think about what types of events would benefit most from this item or service. Consider:
- Event formality (casual, formal, professional)
- Event purpose (celebration, corporate, social)
- Audience (families, adults, professionals, mixed)
- Setting (indoor, outdoor, both)

Common event types to consider (but not limited to):
- Wedding / Reception
- Birthday Party
- Corporate Event / Team Building
- Anniversary Celebration
- Baby Shower / Gender Reveal
- Graduation Party
- Holiday Party
- Bachelor/Bachelorette Party
- Retirement Party
- Family Reunion
- Networking Event
- Product Launch
- Fundraiser / Charity Event
- Kids Party
- Outdoor / Garden Party
- Cocktail Party / Happy Hour
- Dinner Party
- Festival / Fair

Respond with a JSON object (and nothing else) with this exact structure:
{
  "categories": [
    {
      "name": "Event type name (2-4 words)",
      "relevance": 0.95,
      "reason": "Brief explanation why this item fits this event type (1 sentence)"
    },
    {
      "name": "Second event type",
      "relevance": 0.85,
      "reason": "Brief explanation"
    },
    {
      "name": "Third event type",
      "relevance": 0.75,
      "reason": "Brief explanation"
    }
  ],
  "confidence": 0.85,
  "generalNote": "One sentence summary of what makes this item versatile or specialized"
}

SCORING:
- relevance: 0.0 to 1.0, how well this item fits that event type
- confidence: 0.0 to 1.0, how confident you are in these categorizations overall

Generate the categorization now:`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.5, // Lower temperature for more consistent categorization
            maxOutputTokens: 1024,
        }
    };

    const modelId = "gemini-2.0-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;

    console.log(`[Debug] categorizeItemWithAI: Sending request to Gemini...`);
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    console.log(`[Debug] categorizeItemWithAI: Received status ${response.status} from Gemini.`);

    if (!response.ok) {
        let errorBody = await response.text();
        try { errorBody = JSON.parse(errorBody); } catch (e) { /* Ignore */ }
        console.error("[Debug] Gemini API Error Response Body:", errorBody);
        let errorMessage = `Gemini API call failed with status ${response.status}`;
        if (response.status === 400) errorMessage += ". Check payload/prompt structure.";
        if (response.status === 403) errorMessage += ". Check API key permissions/billing.";
        if (response.status === 429) errorMessage += ". Rate limit exceeded.";
        throw new Error(errorMessage);
    }

    const result = await response.json();
    let categorizationText = '';

    try {
        categorizationText = result.candidates[0].content.parts[0].text;
        // Clean up any markdown code blocks if present
        categorizationText = categorizationText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } catch (e) {
        console.error('[Debug] Error extracting text from Gemini response structure:', JSON.stringify(result, null, 2));
        throw new Error('Could not extract text from Gemini response.');
    }

    console.log(`[Debug] categorizeItemWithAI: Raw categorization text:\n${categorizationText}`);

    // Parse the JSON response
    let categorization;
    try {
        categorization = JSON.parse(categorizationText);
    } catch (e) {
        console.error('[Debug] Failed to parse categorization JSON:', e.message);
        // Try to extract JSON object from the text
        const jsonMatch = categorizationText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            categorization = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('Could not parse categorization from AI response');
        }
    }

    // Validate and normalize the response
    const normalizedResult = {
        categories: (categorization.categories || []).slice(0, 3).map((cat, index) => ({
            name: cat.name || `Category ${index + 1}`,
            relevance: Math.min(1, Math.max(0, parseFloat(cat.relevance) || 0.5)),
            reason: cat.reason || ''
        })),
        confidence: Math.min(1, Math.max(0, parseFloat(categorization.confidence) || 0.7)),
        generalNote: categorization.generalNote || '',
        categorizedAt: new Date().toISOString()
    };

    // Ensure we have exactly 3 categories (pad if needed)
    while (normalizedResult.categories.length < 3) {
        normalizedResult.categories.push({
            name: 'General Event',
            relevance: 0.5,
            reason: 'Could work for various event types'
        });
    }

    console.log(`[Debug] categorizeItemWithAI: Parsed categorization with ${normalizedResult.categories.length} categories`);
    return normalizedResult;
}

// Main Handler
exports.handler = async (event) => {
    console.log(`[Debug] categorize-item handler invoked. Method: ${event.httpMethod}`);

    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        const body = JSON.parse(event.body);
        const { name, description, category, price } = body;

        if (!name) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Missing required field: name' })
            };
        }

        console.log(`[Debug] Categorizing item: ${name}`);

        // Categorize the item using AI
        const categorization = await categorizeItemWithAI({
            name,
            description,
            category,
            price
        });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                categorization: categorization,
                message: 'Item categorized successfully'
            })
        };

    } catch (error) {
        console.error('[ERROR] categorize-item handler failed:', error.message, error.stack);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: `Failed to categorize item: ${error.message}` })
        };
    }
};
