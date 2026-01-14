/**
 * AI-powered Solution Detail Digger
 * Takes a solution item and researches it to provide comprehensive details
 * similar to the AI parsing tool - including location, website, pricing, rankings, etc.
 * Returns an accuracy/confidence score for the researched information.
 */

const fetch = require('node-fetch');
const { GEMINI_API_KEY } = process.env;

/**
 * Research a solution item and generate detailed information using AI
 * @param {Object} solutionData - Solution information including name, description, price
 * @returns {Promise<Object>} - Detailed information with accuracy score
 */
async function researchSolutionWithAI(solutionData) {
    console.log(`[Debug] researchSolutionWithAI: Researching solution: ${solutionData.name}`);

    if (!GEMINI_API_KEY) {
        console.error("[Debug] CRITICAL: GEMINI_API_KEY is missing!");
        throw new Error("Server configuration error: Missing Gemini API Key.");
    }

    const prompt = `You are an expert event planning researcher. You need to research and provide detailed, accurate information about a service/product that could be used for events.

Service/Solution to Research: ${solutionData.name}
Current Description: ${solutionData.description || 'No description provided'}
Category Context: ${solutionData.category || 'General event service'}
${solutionData.price ? 'Current Price Estimate: $' + solutionData.price : ''}
${solutionData.parentConcept ? 'Originally From Concept: ' + solutionData.parentConcept : ''}

Research this service/solution and provide comprehensive, realistic details that an event planner would need. Be specific and practical.

IMPORTANT: Provide REALISTIC information that represents typical offerings for this type of service. Use your knowledge of the event industry to estimate accurate details.

Respond with a JSON object (and nothing else) with this exact structure:
{
  "name": "Refined/official name for this service",
  "description": "Detailed 2-3 sentence description of what this service offers",
  "price": {
    "estimate": 0,
    "pricingType": "per person|flat fee|per hour|varies",
    "rangeMin": 0,
    "rangeMax": 0,
    "notes": "Any pricing notes or conditions"
  },
  "location": {
    "type": "mobile|fixed|virtual|hybrid",
    "serviceArea": "Description of where they typically operate",
    "address": null
  },
  "availability": {
    "leadTime": "How far in advance to book (e.g., '2-4 weeks')",
    "hours": "Typical availability hours if applicable",
    "seasonality": "Any seasonal considerations"
  },
  "rankings": {
    "Fun": 0,
    "Social": 0,
    "Active": 0,
    "Creative": 0,
    "Learning": 0,
    "Relaxing": 0
  },
  "imageKeywords": ["keyword1", "keyword2", "keyword3"],
  "goodToKnow": "Important tips or considerations for booking this service",
  "websiteSearchTerms": ["search term 1", "search term 2"],
  "confidence": 0.0,
  "confidenceNotes": "Brief explanation of confidence level"
}

SCORING INSTRUCTIONS:
- Rankings: Score each from 0-10 based on how much this service embodies that quality
- Confidence: Score from 0.0 to 1.0 based on how confident you are in the accuracy of the details:
  - 0.9-1.0: Information is well-established for this type of service
  - 0.7-0.89: Reasonable estimates based on industry norms
  - 0.5-0.69: Educated guesses, may vary significantly
  - Below 0.5: Highly speculative

Generate the research now:`;

    const payload = {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.5, // Lower temperature for more factual responses
            maxOutputTokens: 2048,
        }
    };

    const modelId = "gemini-2.0-flash";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${GEMINI_API_KEY}`;

    console.log(`[Debug] researchSolutionWithAI: Sending request to Gemini...`);
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    console.log(`[Debug] researchSolutionWithAI: Received status ${response.status} from Gemini.`);

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
    let researchText = '';

    try {
        researchText = result.candidates[0].content.parts[0].text;
        // Clean up any markdown code blocks if present
        researchText = researchText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } catch (e) {
        console.error('[Debug] Error extracting text from Gemini response structure:', JSON.stringify(result, null, 2));
        throw new Error('Could not extract text from Gemini response.');
    }

    console.log(`[Debug] researchSolutionWithAI: Raw research text:\n${researchText}`);

    // Parse the JSON response
    let research;
    try {
        research = JSON.parse(researchText);
    } catch (e) {
        console.error('[Debug] Failed to parse research JSON:', e.message);
        // Try to extract JSON object from the text
        const jsonMatch = researchText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            research = JSON.parse(jsonMatch[0]);
        } else {
            throw new Error('Could not parse research from AI response');
        }
    }

    // Validate and normalize the response
    const normalizedResearch = {
        name: research.name || solutionData.name,
        description: research.description || solutionData.description || '',
        price: {
            estimate: parseFloat(research.price?.estimate) || parseFloat(solutionData.price) || 0,
            pricingType: research.price?.pricingType || 'varies',
            rangeMin: parseFloat(research.price?.rangeMin) || 0,
            rangeMax: parseFloat(research.price?.rangeMax) || 0,
            notes: research.price?.notes || ''
        },
        location: {
            type: research.location?.type || 'mobile',
            serviceArea: research.location?.serviceArea || '',
            address: research.location?.address || null
        },
        availability: {
            leadTime: research.availability?.leadTime || 'Varies',
            hours: research.availability?.hours || '',
            seasonality: research.availability?.seasonality || ''
        },
        rankings: {
            Fun: Math.min(10, Math.max(0, parseInt(research.rankings?.Fun) || 0)),
            Social: Math.min(10, Math.max(0, parseInt(research.rankings?.Social) || 0)),
            Active: Math.min(10, Math.max(0, parseInt(research.rankings?.Active) || 0)),
            Creative: Math.min(10, Math.max(0, parseInt(research.rankings?.Creative) || 0)),
            Learning: Math.min(10, Math.max(0, parseInt(research.rankings?.Learning) || 0)),
            Relaxing: Math.min(10, Math.max(0, parseInt(research.rankings?.Relaxing) || 0))
        },
        imageKeywords: Array.isArray(research.imageKeywords) ? research.imageKeywords : [],
        goodToKnow: research.goodToKnow || '',
        websiteSearchTerms: Array.isArray(research.websiteSearchTerms) ? research.websiteSearchTerms : [],
        confidence: Math.min(1, Math.max(0, parseFloat(research.confidence) || 0.5)),
        confidenceNotes: research.confidenceNotes || '',
        researchedAt: new Date().toISOString()
    };

    console.log(`[Debug] researchSolutionWithAI: Parsed research with confidence ${normalizedResearch.confidence}`);
    return normalizedResearch;
}

// Main Handler
exports.handler = async (event) => {
    console.log(`[Debug] dig-solution-details handler invoked. Method: ${event.httpMethod}`);

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
        const { name, description, price, category, parentConcept } = body;

        if (!name) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Missing required field: name' })
            };
        }

        console.log(`[Debug] Researching solution: ${name}`);

        // Research the solution using AI
        const research = await researchSolutionWithAI({
            name,
            description,
            price,
            category,
            parentConcept
        });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                research: research,
                message: 'Solution details researched successfully'
            })
        };

    } catch (error) {
        console.error('[ERROR] dig-solution-details handler failed:', error.message, error.stack);
        return {
            statusCode: 500,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: `Failed to research solution: ${error.message}` })
        };
    }
};
