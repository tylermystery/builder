/**
 * AI-powered Concept-to-Solutions Generator
 * For conceptual/idea items, generates specific solutions (catalog items or AI-parsed providers)
 * instead of product variations.
 * Uses Google Gemini AI to intelligently find solutions for a concept/goal.
 */

const fetch = require('node-fetch');
const { GEMINI_API_KEY } = process.env;

/**
 * Generate solutions for a concept/idea using AI
 * @param {Object} conceptData - Concept information including name, description, category
 * @returns {Promise<Object>} - Solutions array with structured data
 */
async function generateSolutionsWithAI(conceptData) {
    console.log(`[Debug] generateSolutionsWithAI: Processing concept: ${conceptData.name}`);

    if (!GEMINI_API_KEY) {
        console.error("[Debug] CRITICAL: GEMINI_API_KEY is missing!");
        throw new Error("Server configuration error: Missing Gemini API Key.");
    }

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

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 2048,
        }
    };

    const modelId = "gemini-2.0-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;

    console.log(`[Debug] generateSolutionsWithAI: Sending request to Gemini...`);
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    console.log(`[Debug] generateSolutionsWithAI: Received status ${response.status} from Gemini.`);

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
    let solutionsText = '';

    try {
        solutionsText = result.candidates[0].content.parts[0].text;
        // Clean up any markdown code blocks if present
        solutionsText = solutionsText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } catch (e) {
        console.error('[Debug] Error extracting text from Gemini response structure:', JSON.stringify(result, null, 2));
        throw new Error('Could not extract text from Gemini response.');
    }

    console.log(`[Debug] generateSolutionsWithAI: Raw solutions text:\n${solutionsText}`);

    // Parse the JSON response
    let solutions;
    try {
        solutions = JSON.parse(solutionsText);
        if (!Array.isArray(solutions)) {
            throw new Error('Response is not an array');
        }
    } catch (e) {
        console.error('[Debug] Failed to parse solutions JSON:', e.message);
        // Try to extract JSON array from the text
        const jsonMatch = solutionsText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            solutions = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('Could not parse solutions from AI response');
        }
    }

    // Validate and normalize solutions
    solutions = solutions.map((sol, index) => ({
        id: `solution-${Date.now()}-${index}`,
        name: sol.name || `Solution ${index + 1}`,
        description: sol.description || '',
        estimatedPrice: sol.estimatedPrice || 'Varies',
        confidence: ['high', 'medium', 'low'].includes(sol.confidence) ? sol.confidence : 'medium',
        searchTerms: Array.isArray(sol.searchTerms) ? sol.searchTerms : [],
        isSolution: true // Flag to identify this as a solution item
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

        // Generate solutions using AI
        const solutions = await generateSolutionsWithAI({
            name,
            description,
            category,
            location,
            budget
        });

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
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: `Failed to generate solutions: ${error.message}` })
        };
    }
};
