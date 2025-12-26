/**
 * AI-powered Top Options Generator
 * Analyzes an item's name, description, and category to generate recommended variations/options
 * Uses Google Gemini AI to intelligently determine appropriate option groups
 */

const fetch = require('node-fetch');
const { GEMINI_API_KEY } = process.env;

/**
 * Generate top recommended options for an item using AI
 * @param {Object} itemData - Item information including name, description, category
 * @returns {Promise<string>} - Options string in bracket format
 */
async function generateTopOptionsWithAI(itemData) {
    console.log(`[Debug] generateTopOptionsWithAI: Processing item: ${itemData.name}`);

    if (!GEMINI_API_KEY) {
        console.error("[Debug] CRITICAL: GEMINI_API_KEY is missing!");
        throw new Error("Server configuration error: Missing Gemini API Key.");
    }

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
- Price modifiers use: [price: +10] for additions, [price: -5] for discounts, [price: 25] for overrides
- Keep option names concise but descriptive
- Make price adjustments realistic and proportional to the base price
- Only include options that make sense for this specific type of item
- If the item doesn't need variations, return just: [Options]\nStandard

Generate options now:`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
        }
    };

    const modelId = "gemini-1.5-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;

    console.log(`[Debug] generateTopOptionsWithAI: Sending request to Gemini...`);
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    console.log(`[Debug] generateTopOptionsWithAI: Received status ${response.status} from Gemini.`);

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
    let optionsText = '';

    try {
        optionsText = result.candidates[0].content.parts[0].text;
        // Clean up any markdown code blocks if present
        optionsText = optionsText.replace(/```[\w]*\n?/g, '').trim();
    } catch (e) {
        console.error('[Debug] Error extracting text from Gemini response structure:', JSON.stringify(result, null, 2));
        throw new Error('Could not extract text from Gemini response.');
    }

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

        // Generate options using AI
        const optionsString = await generateTopOptionsWithAI({
            name,
            description,
            category,
            price,
            pricingType
        });

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
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: `Failed to generate options: ${error.message}` })
        };
    }
};
