/**
 * AI-powered Item Categorizer
 * Takes an item and generates top 3 recommended event categories/use cases
 * Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)
 */

const { generateText, parseJsonResponse } = require('./utils/ai-provider');

/**
 * Categorize an item using AI to find the top 3 event types it's best suited for
 */
async function categorizeItemWithAI(itemData) {
    console.log(`[Debug] categorizeItemWithAI: Categorizing item: ${itemData.name}`);

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

    const aiResult = await generateText(prompt, {
        temperature: 0.5,
        maxTokens: 1024,
        caller: 'categorize-item',
    });

    if (!aiResult.ok) {
        const err = new Error(aiResult.error || 'AI categorization failed');
        err.statusCode = aiResult.statusCode || 500;
        err.quotaExhausted = aiResult.quotaExhausted || false;
        throw err;
    }

    console.log(`[Debug] categorizeItemWithAI: Response from ${aiResult.providerName}`);

    const categorization = parseJsonResponse(aiResult.text);

    // Validate and normalize the response
    const normalizedResult = {
        categories: (categorization.categories || []).slice(0, 3).map((cat, index) => ({
            name: cat.name || `Category ${index + 1}`,
            relevance: Math.min(1, Math.max(0, parseFloat(cat.relevance) || 0.5)),
            reason: cat.reason || ''
        })),
        confidence: Math.min(1, Math.max(0, parseFloat(categorization.confidence) || 0.7)),
        generalNote: categorization.generalNote || '',
        categorizedAt: new Date().toISOString(),
        _aiProvider: aiResult.provider,
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
    console.log(`[categorize-item] Handler invoked. Method: ${event.httpMethod}`);

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

        const categorization = await categorizeItemWithAI({ name, description, category, price });

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
        console.error('[categorize-item] Handler FAILED:', error.name, error.message);
        console.error('[categorize-item] Stack:', error.stack);
        const statusCode = error.statusCode === 429 ? 429 : 500;
        const isQuota = error.quotaExhausted || false;
        return {
            statusCode,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                error: isQuota
                    ? 'AI quota exceeded. Categorization is temporarily unavailable.'
                    : `Failed to categorize item: ${error.message}`,
                errorName: error.name,
                retryable: statusCode === 429 && !isQuota,
                quotaExhausted: isQuota
            })
        };
    }
};
