/**
 * AI-powered Solution Detail Digger
 * Takes a solution item and researches it to provide comprehensive details
 * Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)
 */

const { generateText, parseJsonResponse } = require('./utils/ai-provider');

/**
 * Research a solution item and generate detailed information using AI
 */
async function researchSolutionWithAI(solutionData) {
    console.log(`[Debug] researchSolutionWithAI: Researching solution: ${solutionData.name}`);

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
    "pricingType": "per person|per guest|flat rate|per hour|per group|per vehicle",
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

    const aiResult = await generateText(prompt, {
        temperature: 0.5,
        maxTokens: 2048,
        caller: 'dig-solution-details',
    });

    if (!aiResult.ok) {
        const err = new Error(aiResult.error || 'AI research failed');
        err.statusCode = aiResult.statusCode || 500;
        err.quotaExhausted = aiResult.quotaExhausted || false;
        throw err;
    }

    console.log(`[Debug] researchSolutionWithAI: Response from ${aiResult.providerName}`);

    const research = parseJsonResponse(aiResult.text);

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
        researchedAt: new Date().toISOString(),
        _aiProvider: aiResult.provider,
    };

    console.log(`[Debug] researchSolutionWithAI: Parsed research with confidence ${normalizedResearch.confidence}`);
    return normalizedResearch;
}

// Main Handler
exports.handler = async (event) => {
    console.log(`[dig-solution-details] Handler invoked. Method: ${event.httpMethod}`);

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

        const research = await researchSolutionWithAI({ name, description, price, category, parentConcept });

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
        console.error('[dig-solution-details] Handler FAILED:', error.name, error.message);
        console.error('[dig-solution-details] Stack:', error.stack);
        const statusCode = error.statusCode === 429 ? 429 : 500;
        const isQuota = error.quotaExhausted || false;
        return {
            statusCode,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                error: isQuota
                    ? 'AI quota exceeded. Research is temporarily unavailable.'
                    : `Failed to research solution: ${error.message}`,
                errorName: error.name,
                retryable: statusCode === 429 && !isQuota,
                quotaExhausted: isQuota
            })
        };
    }
};
