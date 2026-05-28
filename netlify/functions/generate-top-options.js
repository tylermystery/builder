/**
 * AI-powered Top Options Generator
 * Analyzes an item's name, description, and category to generate recommended variations/options
 * Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)
 */

const { generateText } = require('./utils/ai-provider');

/**
 * Generate top recommended options for an item using AI
 */
async function generateTopOptionsWithAI(itemData) {
    console.log(`[Debug] generateTopOptionsWithAI: Processing item: ${itemData.name}`);

    const prompt = `You are an expert at creating product variations and options for a catalog/menu system.

Analyze this item and generate the top recommended variations/options that customers would typically want to choose from:

Item Name: ${itemData.name}
Description: ${itemData.description || 'No description provided'}
Category: ${itemData.category || 'General'}
Base Price: ${itemData.price ? '$' + itemData.price : 'Not specified'}
${itemData.pricingType ? 'Pricing Type: ' + itemData.pricingType : ''}

Generate 2-4 meaningful option groups with 2-5 options each. Consider:
- Size variations if applicable
- Material/quality tiers
- Add-ons or extras
- Time/duration options if service-based
- Quantity packages
- Customization options

Respond ONLY with the options in this exact bracket format (no markdown, no explanation):

[Group Name] (modifier)
Option 1 [price: +X]
Option 2
Option 3 [price: +X]

[Another Group]
Option A
Option B [price: +X]

Rules for the format:
- Group names go in square brackets: [Size], [Duration], [Add-ons]
- Optional modifier after group name in parentheses: (required) or (optional)
- Price modifiers use: [price: +10] for additions, [price: -5] for discounts, [price: 25] for overrides, [price: +15%] or [price: -10%] for percentage adjustments of the base price
- Keep option names concise but descriptive
- Make price adjustments realistic and proportional to the base price
- Only include options that make sense for this specific type of item
- If the item doesn't need variations, return just: [Options]\nStandard

Generate options now:`;

    const aiResult = await generateText(prompt, {
        temperature: 0.7,
        maxTokens: 1024,
        caller: 'generate-top-options',
    });

    if (!aiResult.ok) {
        const err = new Error(aiResult.error || 'AI options generation failed');
        err.statusCode = aiResult.statusCode || 500;
        err.quotaExhausted = aiResult.quotaExhausted || false;
        throw err;
    }

    console.log(`[Debug] generateTopOptionsWithAI: Response from ${aiResult.providerName}`);

    // Clean up any markdown code blocks if present
    let optionsText = aiResult.text.replace(/```[\w]*\n?/g, '').trim();

    console.log(`[Debug] generateTopOptionsWithAI: Generated options:\n${optionsText}`);
    return optionsText;
}

// Main Handler
exports.handler = async (event) => {
    console.log(`[Debug] generate-top-options handler invoked. Method: ${event.httpMethod}`);

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
        const { name, description, category, price, pricingType } = body;

        if (!name) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Missing required field: name' })
            };
        }

        console.log(`[Debug] Processing item: ${name}`);

        const optionsString = await generateTopOptionsWithAI({ name, description, category, price, pricingType });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                options: optionsString,
                message: 'Top options generated successfully'
            })
        };

    } catch (error) {
        console.error('[ERROR] generate-top-options handler failed:', error.message, error.stack);
        const statusCode = error.statusCode === 429 ? 429 : 500;
        const isQuota = error.quotaExhausted || false;
        return {
            statusCode,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: `Failed to generate options: ${error.message}`, quotaExhausted: isQuota, retryable: statusCode === 429 && !isQuota })
        };
    }
};
