/**
 * AI-powered Merge Estimator
 * Estimates the result of combining two items either as Options (category) or as Hybrid (blend)
 * Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)
 */

const { generateText, parseJsonResponse } = require('./utils/ai-provider');

/**
 * Estimate merge result using AI
 */
async function estimateMergeWithAI(items, mergeType) {
    const itemNames = items.map(i => `"${i.name}"`).join(' + ');
    console.log(`[Debug] estimateMergeWithAI: Estimating ${mergeType} merge for ${itemNames}`);

    // Build item descriptions for the prompt
    const itemDescriptions = items.map((item, idx) => `Item ${idx + 1}:
- Name: ${item.name}
- Description: ${item.description || 'No description'}
- Category: ${item.category || 'Uncategorized'}
${item.price ? '- Price: $' + item.price : ''}`).join('\n\n');

    let prompt;

    if (mergeType === 'options') {
        prompt = `You are an expert event planner helping to organize items for an event planning app.

${items.length} items are being grouped together as alternative options. Analyze them and determine:
1. A parent category name that would encompass all items
2. A brief description of what this options category represents

${itemDescriptions}

Think about what these items have in common and what category they would all fit under.

Respond with a JSON object (and nothing else) with this exact structure:
{
  "categoryName": "A concise category name (2-4 words) that encompasses all items",
  "categoryDescription": "A brief description (1-2 sentences) of what this category represents and why these items are alternatives",
  "confidence": 0.85
}

IMPORTANT: The category name should be short and descriptive. The confidence score (0.0-1.0) indicates how well these items fit together as alternatives.`;
    } else if (mergeType === 'hybrid') {
        prompt = `You are a creative event planner helping to combine ideas in an event planning app.

${items.length} items are being merged into a single hybrid idea. Analyze them and create a blended combination that captures the best of all:

${itemDescriptions}

Think creatively about how these items could be combined or merged into a single cohesive idea. Find the "merriment" - the joy, fun, or essence - that combining them would create.

Respond with a JSON object (and nothing else) with this exact structure:
{
  "hybridName": "A creative name for the combined idea (2-5 words)",
  "hybridDescription": "A description (2-3 sentences) of what this hybrid idea represents and how it combines elements from all original items",
  "reasoning": "Brief explanation of why this combination works well",
  "confidence": 0.85
}

IMPORTANT: Be creative but practical. The hybrid should be something that could realistically be used in event planning. The confidence score (0.0-1.0) indicates how well these items combine.`;
    } else {
        throw new Error(`Invalid merge type: ${mergeType}`);
    }

    const aiResult = await generateText(prompt, {
        temperature: 0.7,
        maxTokens: 1024,
        caller: 'estimate-merge',
    });

    if (!aiResult.ok) {
        const err = new Error(aiResult.error || 'AI merge estimation failed');
        err.statusCode = aiResult.statusCode || 500;
        err.quotaExhausted = aiResult.quotaExhausted || false;
        throw err;
    }

    console.log(`[Debug] estimateMergeWithAI: Response from ${aiResult.providerName}`);

    const result = parseJsonResponse(aiResult.text);
    console.log(`[Debug] estimateMergeWithAI: Successfully parsed result:`, result);
    return result;
}

exports.handler = async (event) => {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
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
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const body = JSON.parse(event.body);
        const { item1, item2, items: itemsArray, mergeType } = body;

        // Support both new `items` array and legacy `item1`/`item2` format
        let items;
        if (itemsArray && Array.isArray(itemsArray) && itemsArray.length >= 2) {
            items = itemsArray;
        } else if (item1 && item2) {
            items = [item1, item2];
        } else {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Missing items data. Provide either "items" array (2+) or "item1" and "item2"' })
            };
        }

        if (!mergeType || !['options', 'hybrid'].includes(mergeType)) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Invalid or missing mergeType. Must be "options" or "hybrid"' })
            };
        }

        console.log(`[estimate-merge] Processing ${mergeType} estimation for ${items.length} items:`,
            items.map(i => i.name)
        );

        const result = await estimateMergeWithAI(items, mergeType);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                mergeType,
                estimation: result
            })
        };

    } catch (error) {
        console.error('[estimate-merge] Error:', error);
        const statusCode = error.statusCode === 429 ? 429 : 500;
        const isQuota = error.quotaExhausted || false;
        return {
            statusCode,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                error: 'Failed to estimate merge',
                message: error.message,
                quotaExhausted: isQuota,
                retryable: statusCode === 429 && !isQuota
            })
        };
    }
};
