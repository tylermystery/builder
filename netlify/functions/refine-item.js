/**
 * AI-powered Item Refinement
 * Takes a highlighted text snippet + full item context to generate a "Next Generation"
 * version of the item with refined title, description, image prompt, tags, and realm.
 * Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)
 */

const { generateText, parseJsonResponse } = require('./utils/ai-provider');

/**
 * Refine an item using AI based on a highlighted text snippet and full context
 */
async function refineItemWithAI(refinementData) {
    console.log(`[Debug] refineItemWithAI: Refining item: ${refinementData.title}`);

    const iterationNumber = (refinementData.iterationCount || 0) + 1;

    const prompt = `You are a visionary project refinement engine focused on the Greater Good. Your task is to take a plan item and evolve it to its next iteration based on a specific snippet the user highlighted for refinement.

CURRENT ITEM STATE:
- Title: ${refinementData.title}
- Description: ${refinementData.description || 'No description'}
- Category: ${refinementData.category || 'Uncategorized'}
- Current Tags: ${(refinementData.tags || []).join(', ') || 'None'}
- Current Realm: ${refinementData.realm || 'Unassigned'}
- Iteration: ${iterationNumber}

HIGHLIGHTED SNIPPET FOR REFINEMENT:
"${refinementData.highlightedText}"

CONTEXT OF HIGHLIGHT:
- The highlight was in the ${refinementData.highlightSource || 'description'} field.
${refinementData.userNote ? '- User note: ' + refinementData.userNote : ''}

INSTRUCTIONS:
1. Use the highlighted snippet as the focal point for refinement. The user is signaling "this part needs evolution."
2. Generate a refined "Next Generation" version that improves upon the highlighted area while maintaining coherence with the rest of the item.
3. Assign one primary Realm from: Infrastructure, Wellness, Entertainment, Education, Environment, Community, Technology, Culture, Commerce.
4. Generate 3-5 relevant hashtags that describe this iteration.
5. Generate a brief image prompt that could be used to create a visual for this iteration.

Respond with a JSON object (and nothing else) with this exact structure:
{
  "title": "Refined title (keep concise, 2-8 words)",
  "description": "Refined description (1-3 sentences, incorporating the improvement)",
  "realm": "Primary Realm",
  "tags": ["tag1", "tag2", "tag3"],
  "imagePrompt": "A brief visual prompt for AI image generation (1 sentence)",
  "refinementNote": "Brief explanation of what was refined and why (1 sentence)",
  "variationName": "A creative, short name for this variation (2-4 words, like 'Eco-Friendly Edition' or 'Premium Experience')",
  "maturityDelta": 0.1
}

SCORING:
- maturityDelta: 0.0 to 0.3, how much this refinement improves the item's maturity/viability. Higher for substantive improvements, lower for minor tweaks.

Generate the refined version now:`;

    const aiResult = await generateText(prompt, {
        temperature: 0.7,
        maxTokens: 1024,
        caller: 'refine-item',
    });

    if (!aiResult.ok) {
        const err = new Error(aiResult.error || 'AI refinement failed');
        err.statusCode = aiResult.statusCode || 500;
        err.quotaExhausted = aiResult.quotaExhausted || false;
        throw err;
    }

    console.log(`[Debug] refineItemWithAI: Response from ${aiResult.providerName}`);

    const refinement = parseJsonResponse(aiResult.text);

    // Validate and normalize
    const VALID_REALMS = ['Infrastructure', 'Wellness', 'Entertainment', 'Education', 'Environment', 'Community', 'Technology', 'Culture', 'Commerce'];

    const normalized = {
        title: refinement.title || refinementData.title,
        description: refinement.description || refinementData.description,
        realm: VALID_REALMS.includes(refinement.realm) ? refinement.realm : (refinementData.realm || 'Community'),
        tags: Array.isArray(refinement.tags) ? refinement.tags.slice(0, 5).map(t => String(t).replace(/^#/, '')) : [],
        imagePrompt: refinement.imagePrompt || '',
        refinementNote: refinement.refinementNote || '',
        variationName: refinement.variationName || '',
        maturityDelta: Math.min(0.3, Math.max(0, parseFloat(refinement.maturityDelta) || 0.1)),
        iteration: iterationNumber,
        timestamp: new Date().toISOString(),
        highlightedText: refinementData.highlightedText,
        highlightSource: refinementData.highlightSource || 'description',
        _aiProvider: aiResult.provider,
    };

    console.log(`[Debug] refineItemWithAI: Parsed refinement — title: "${normalized.title}", realm: ${normalized.realm}, tags: [${normalized.tags.join(', ')}]`);
    return normalized;
}

// Main Handler
exports.handler = async (event) => {
    console.log(`[Debug] refine-item handler invoked. Method: ${event.httpMethod}`);

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
        const { title, description, category, tags, realm, highlightedText, highlightSource, iterationCount, userNote } = body;

        if (!highlightedText) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Missing required field: highlightedText' })
            };
        }

        if (!title && !description) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'At least one of title or description is required' })
            };
        }

        console.log(`[Debug] Refining item: "${title}" with highlight: "${highlightedText.substring(0, 80)}..."`);

        const refinement = await refineItemWithAI({
            title, description, category, tags, realm,
            highlightedText, highlightSource, iterationCount, userNote
        });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                refinement,
                message: `Item refined to iteration ${refinement.iteration}`
            })
        };

    } catch (error) {
        console.error('[ERROR] refine-item handler failed:', error.message, error.stack);
        const statusCode = error.statusCode === 429 ? 429 : 500;
        const isQuota = error.quotaExhausted || false;
        return {
            statusCode,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({ error: `Failed to refine item: ${error.message}`, quotaExhausted: isQuota, retryable: statusCode === 429 && !isQuota })
        };
    }
};
