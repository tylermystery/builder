/**
 * AI-powered Concept-to-Solutions Generator
 * For conceptual/idea items, generates specific solutions (catalog items or AI-parsed providers)
 * instead of product variations.
 * Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)
 */

const { generateText, parseJsonResponse } = require('./utils/ai-provider');

/**
 * Generate solutions for a concept/idea using AI
 */
async function generateSolutionsWithAI(conceptData) {
    console.log(`[Debug] generateSolutionsWithAI: Processing concept: ${conceptData.name}`);

    const prompt = `You are an expert event planner and service finder. Given a conceptual idea or goal, generate specific solutions or providers that could fulfill it.

Concept/Goal: ${conceptData.name}
Description: ${conceptData.description || 'No description provided'}
Category: ${conceptData.category || 'General'}
Location Context: ${conceptData.location || 'Not specified'}
${conceptData.budget ? 'Budget: $' + conceptData.budget : ''}

Generate 3-5 SPECIFIC solutions that could fulfill this concept. Each solution should be a real type of service, product, or provider that could be found in a catalog or searched for.

IMPORTANT: These are NOT variations of the concept - they are SPECIFIC ITEMS that could replace or fulfill the conceptual idea.

Examples of good solutions:
- Concept: "live entertainment" → Solutions: "Jazz Quartet", "DJ Service", "Acoustic Solo Artist", "String Trio"
- Concept: "private dining" → Solutions: "Chef's Table Experience", "Private Room at Upscale Restaurant", "In-Home Private Chef"
- Concept: "team building activity" → Solutions: "Escape Room", "Cooking Class", "Axe Throwing", "Wine Tasting Tour"

Respond with a JSON array (and nothing else). Each solution object must have:
- "name": A specific, searchable name for the solution (1-4 words)
- "description": Brief description of what this solution offers (1 sentence)
- "estimatedPrice": Rough price range as a string (e.g., "$50-150/person", "$500-1000", "Varies")
- "confidence": How well this matches the concept: "high", "medium", or "low"
- "searchTerms": Array of 2-3 keywords to find this in a catalog

Example response format:
[
  {
    "name": "Jazz Quartet",
    "description": "Four-piece ensemble playing classic and contemporary jazz standards",
    "estimatedPrice": "$800-1500",
    "confidence": "high",
    "searchTerms": ["jazz", "live music", "quartet"]
  }
]

Generate solutions now:`;

    const aiResult = await generateText(prompt, {
        temperature: 0.7,
        maxTokens: 2048,
        caller: 'generate-concept-solutions',
    });

    if (!aiResult.ok) {
        const err = new Error(aiResult.error || 'AI solution generation failed');
        err.statusCode = aiResult.statusCode || 500;
        err.quotaExhausted = aiResult.quotaExhausted || false;
        throw err;
    }

    console.log(`[Debug] generateSolutionsWithAI: Response from ${aiResult.providerName}`);

    let solutions = parseJsonResponse(aiResult.text);

    // Handle if response is an object wrapping the array
    if (!Array.isArray(solutions) && solutions.solutions) {
        solutions = solutions.solutions;
    }
    if (!Array.isArray(solutions)) {
        throw new Error('AI response is not an array of solutions');
    }

    // Validate and normalize solutions
    solutions = solutions.map((sol, index) => ({
        id: `solution-${Date.now()}-${index}`,
        name: sol.name || `Solution ${index + 1}`,
        description: sol.description || '',
        estimatedPrice: sol.estimatedPrice || 'Varies',
        confidence: ['high', 'medium', 'low'].includes(sol.confidence) ? sol.confidence : 'medium',
        searchTerms: Array.isArray(sol.searchTerms) ? sol.searchTerms : [],
        isSolution: true
    }));

    console.log(`[Debug] generateSolutionsWithAI: Parsed ${solutions.length} solutions`);
    return solutions;
}

// Main Handler
exports.handler = async (event) => {
    console.log(`[Debug] generate-concept-solutions handler invoked. Method: ${event.httpMethod}`);

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
        const { name, description, category, location, budget } = body;

        if (!name) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Missing required field: name' })
            };
        }

        console.log(`[Debug] Processing concept: ${name}`);

        const solutions = await generateSolutionsWithAI({ name, description, category, location, budget });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                solutions: solutions,
                message: 'Solutions generated successfully'
            })
        };

    } catch (error) {
        console.error('[ERROR] generate-concept-solutions handler failed:', error.message, error.stack);
        const statusCode = error.statusCode === 429 ? 429 : 500;
        const isQuota = error.quotaExhausted || false;
        return {
            statusCode,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: `Failed to generate solutions: ${error.message}`, quotaExhausted: isQuota, retryable: statusCode === 429 && !isQuota })
        };
    }
};
