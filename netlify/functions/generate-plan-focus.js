/**
 * AI-powered Plan Focus Generator
 * Generates a plan title and description based on goal items.
 * Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)
 */

const { generateText, parseJsonResponse } = require('./utils/ai-provider');

/**
 * Generate plan title and description from goal items using AI
 */
async function generatePlanFocusWithAI(goalItems, currentTitle, currentDescription) {
    console.log(`[Debug] generatePlanFocusWithAI: Generating focus from ${goalItems.length} goal items`);

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

    const aiResult = await generateText(prompt, {
        temperature: 0.7,
        maxTokens: 512,
        caller: 'generate-plan-focus',
    });

    if (!aiResult.ok) {
        const err = new Error(aiResult.error || 'AI plan focus generation failed');
        err.statusCode = aiResult.statusCode || 500;
        err.quotaExhausted = aiResult.quotaExhausted || false;
        throw err;
    }

    console.log(`[Debug] generatePlanFocusWithAI: Response from ${aiResult.providerName}`);

    const result = parseJsonResponse(aiResult.text);
    console.log(`[Debug] generatePlanFocusWithAI: Successfully parsed result:`, result);
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
        const statusCode = error.statusCode === 429 ? 429 : 500;
        const isQuota = error.quotaExhausted || false;
        return {
            statusCode,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                error: 'Failed to generate plan focus',
                message: error.message,
                quotaExhausted: isQuota,
                retryable: statusCode === 429 && !isQuota
            })
        };
    }
};
