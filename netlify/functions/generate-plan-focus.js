/**
 * AI-powered Plan Focus Generator
 * Generates a plan title and description based on goal items.
 * Uses Google Gemini AI to synthesize goal item names/descriptions into a cohesive plan focus.
 */

const fetch = require('node-fetch');
const { GEMINI_API_KEY } = process.env;

/**
 * Generate plan title and description from goal items using AI
 * @param {Array<Object>} goalItems - Array of { name, description } objects
 * @param {string|null} currentTitle - Current plan title (if any)
 * @param {string|null} currentDescription - Current plan description (if any)
 * @returns {Promise<Object>} - Generated title and description
 */
async function generatePlanFocusWithAI(goalItems, currentTitle, currentDescription) {
    console.log(`[Debug] generatePlanFocusWithAI: Generating focus from ${goalItems.length} goal items`);

    if (!GEMINI_API_KEY) {
        console.error("[Debug] CRITICAL: GEMINI_API_KEY is missing!");
        throw new Error("Server configuration error: Missing Gemini API Key.");
    }

    const goalItemsList = goalItems.map((item, i) => {
        let entry = `${i + 1}. Name: ${item.name}`;
        if (item.description) {
            entry += `\n   Description: ${item.description}`;
        }
        return entry;
    }).join('\n');

    let contextNote = '';
    if (currentTitle || currentDescription) {
        contextNote = `\nThe plan currently has:`;
        if (currentTitle) contextNote += `\n- Title: "${currentTitle}"`;
        if (currentDescription) contextNote += `\n- Description: "${currentDescription}"`;
        contextNote += `\nYou may incorporate or refine the existing title/description, but generate a fresh focus that reflects ALL goal items.\n`;
    }

    const prompt = `You are an expert event planner helping to define the focus of an event plan.

The user has marked the following items as goals/inspiration for their plan:

${goalItemsList}
${contextNote}
Based on these goal items, generate:
1. A concise plan title (2-6 words) that captures the essence or theme of what these goals represent together
2. A brief plan description (1-2 sentences) that summarizes the focus, purpose, or vision of the plan based on these goals

The title should be catchy and descriptive. The description should help someone understand what the plan is about at a glance.

Respond with a JSON object (and nothing else) with this exact structure:
{
  "title": "A concise plan title",
  "description": "A brief description of the plan focus"
}

IMPORTANT: Be creative but practical. The title should feel natural for an event plan name.`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 512,
        }
    };

    const modelId = "gemini-2.0-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;

    console.log(`[Debug] generatePlanFocusWithAI: Sending request to Gemini...`);
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Debug] Gemini API error: ${response.status} - ${errorText}`);
        throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[Debug] generatePlanFocusWithAI: Received response from Gemini`);

    const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textContent) {
        console.error('[Debug] No text content in Gemini response:', JSON.stringify(data));
        throw new Error('No content in AI response');
    }

    // Parse the JSON from the response
    let jsonStr = textContent.trim();
    if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    try {
        const result = JSON.parse(jsonStr);
        console.log(`[Debug] generatePlanFocusWithAI: Successfully parsed result:`, result);
        return result;
    } catch (parseError) {
        console.error('[Debug] Failed to parse AI response as JSON:', jsonStr);
        throw new Error('Failed to parse AI response');
    }
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
        const { goalItems, currentTitle, currentDescription } = body;

        if (!goalItems || !Array.isArray(goalItems) || goalItems.length === 0) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Missing or empty goalItems array' })
            };
        }

        console.log(`[generate-plan-focus] Generating focus from ${goalItems.length} goal items`);

        const result = await generatePlanFocusWithAI(goalItems, currentTitle || null, currentDescription || null);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                ...result
            })
        };

    } catch (error) {
        console.error('[generate-plan-focus] Error:', error);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                error: 'Failed to generate plan focus',
                message: error.message
            })
        };
    }
};
