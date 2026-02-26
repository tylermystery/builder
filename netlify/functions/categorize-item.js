/**
 * AI-powered Item Categorizer
 * Assigns items to base categories (Activities, Food & Drink, Venues, Extras)
 * and adds relevant tags for filtering and discovery.
 * Uses multi-provider AI with automatic fallback (Gemini → OpenAI → Anthropic)
 */

const { generateText, parseJsonResponse } = require('./utils/ai-provider');

// Base categories - items must belong to at least one
const BASE_CATEGORIES = ['Activities', 'Food & Drink', 'Venues', 'Extras'];

// Curated tag list organized by theme
const AVAILABLE_TAGS = [
    // Audience
    'Family Friendly', 'Kids', 'Adults Only', 'All Ages', 'Couples', 'Groups', 'Solo',
    // Setting
    'Outdoors', 'Indoors', 'Waterfront', 'Rooftop', 'Beachside',
    // Vibe / Style
    'Luxury', 'Budget Friendly', 'Casual', 'Formal', 'Themed', 'Unique', 'Classic', 'Trendy', 'Rustic', 'Elegant',
    // Experience
    'Interactive', 'Live Entertainment', 'Music', 'DIY', 'Educational', 'Hands-On', 'Spectator', 'Relaxing', 'Adventurous', 'Cultural',
    // Event Type Fit
    'Wedding', 'Birthday', 'Corporate', 'Holiday', 'Date Night', 'Team Building', 'Celebration', 'Festival',
    // Logistics
    'Late Night', 'Daytime', 'Seasonal', 'Year Round', 'Weekend', 'Private', 'Public',
    // Food & Drink Specific
    'Catering', 'Bar Service', 'Desserts', 'Local Cuisine', 'Dietary Options', 'BYOB',
    // Venue Specific
    'Photo Worthy', 'Scenic', 'Spacious', 'Intimate', 'Historic', 'Modern',
];

/**
 * Categorize an item using AI to assign base categories and relevant tags
 */
async function categorizeItemWithAI(itemData) {
    console.log(`[Debug] categorizeItemWithAI: Categorizing item: ${itemData.name}`);

    const prompt = `You are an expert event planner and item classifier. Analyze the following item/service and:
1. Assign it to one or more BASE CATEGORIES (must pick at least one)
2. Add all relevant TAGS that describe this item

Item Name: ${itemData.name}
Description: ${itemData.description || 'No description provided'}
${itemData.category ? 'Current Category: ' + itemData.category : ''}
${itemData.price ? 'Price: $' + itemData.price : ''}

BASE CATEGORIES (assign one or more):
- Activities: Things to do — tours, games, classes, adventures, entertainment acts, performances
- Food & Drink: Anything edible or drinkable — restaurants, catering, bars, food trucks, tastings
- Venues: Physical spaces — event halls, parks, hotels, unique locations, rental spaces
- Extras: Supporting items — decorations, rentals, photography, planning services, equipment, favors, supplies

AVAILABLE TAGS (pick all that genuinely apply, typically 3-8 tags):
${AVAILABLE_TAGS.join(', ')}

You may also suggest 1-2 custom tags if nothing in the list fits a key attribute of this item.

Think carefully:
- An item can belong to MULTIPLE base categories (e.g., a restaurant with private dining = "Food & Drink" + "Venues")
- Only assign categories and tags that truly fit — don't force irrelevant ones
- Err on the side of including more relevant tags rather than fewer

Respond with a JSON object (and nothing else) with this exact structure:
{
  "baseCategories": ["Activities"],
  "tags": ["Family Friendly", "Outdoors", "Interactive"],
  "confidence": 0.85,
  "reasoning": "One sentence explaining the categorization logic"
}

RULES:
- baseCategories: Array of 1-4 strings, must only contain: "Activities", "Food & Drink", "Venues", "Extras"
- tags: Array of 3-10 strings from the available tags list (plus up to 2 custom)
- confidence: 0.0 to 1.0, how confident you are in the categorization

Generate the categorization now:`;

    const aiResult = await generateText(prompt, {
        temperature: 0.4,
        maxTokens: 1024,
        caller: 'categorize-item',
    });

    if (!aiResult.ok) {
        const err = new Error(aiResult.error || 'AI categorization failed');
        err.statusCode = aiResult.statusCode || 500;
        err.quotaExhausted = aiResult.quotaExhausted || false;
        throw err;
    }

    console.log(`[Debug] categorizeItemWithAI: Response from ${aiResult.providerName}`);

    const categorization = parseJsonResponse(aiResult.text);

    // Validate and normalize base categories
    const rawCategories = Array.isArray(categorization.baseCategories)
        ? categorization.baseCategories
        : [];
    const validCategories = rawCategories.filter(c => BASE_CATEGORIES.includes(c));

    // Ensure at least one base category - default to 'Extras' if AI gave none valid
    if (validCategories.length === 0) {
        validCategories.push('Extras');
    }

    // Validate and normalize tags
    const rawTags = Array.isArray(categorization.tags)
        ? categorization.tags
        : [];
    // Allow tags from our list + up to 2 custom tags
    const knownTags = rawTags.filter(t => AVAILABLE_TAGS.includes(t));
    const customTags = rawTags
        .filter(t => !AVAILABLE_TAGS.includes(t))
        .slice(0, 2)
        .map(t => String(t).trim())
        .filter(t => t.length > 0 && t.length <= 30);
    const allTags = [...knownTags, ...customTags];

    const normalizedResult = {
        baseCategories: validCategories,
        tags: allTags,
        confidence: Math.min(1, Math.max(0, parseFloat(categorization.confidence) || 0.7)),
        reasoning: categorization.reasoning || '',
        categorizedAt: new Date().toISOString(),
        _aiProvider: aiResult.provider,
    };

    console.log(`[Debug] categorizeItemWithAI: Assigned ${normalizedResult.baseCategories.length} categories and ${normalizedResult.tags.length} tags`);
    return normalizedResult;
}

// Main Handler
exports.handler = async (event) => {
    console.log(`[categorize-item] Handler invoked. Method: ${event.httpMethod}`);

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
        const { name, description, category, price } = body;

        if (!name) {
            return {
                statusCode: 400,
                headers: { 'Access-Control-Allow-Origin': '*' },
                body: JSON.stringify({ error: 'Missing required field: name' })
            };
        }

        console.log(`[Debug] Categorizing item: ${name}`);

        const categorization = await categorizeItemWithAI({ name, description, category, price });

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                success: true,
                categorization: categorization,
                availableCategories: BASE_CATEGORIES,
                availableTags: AVAILABLE_TAGS,
                message: 'Item categorized successfully'
            })
        };

    } catch (error) {
        console.error('[categorize-item] Handler FAILED:', error.name, error.message);
        console.error('[categorize-item] Stack:', error.stack);
        const statusCode = error.statusCode === 429 ? 429 : 500;
        const isQuota = error.quotaExhausted || false;
        return {
            statusCode,
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify({
                error: isQuota
                    ? 'AI quota exceeded. Categorization is temporarily unavailable.'
                    : `Failed to categorize item: ${error.message}`,
                errorName: error.name,
                retryable: statusCode === 429 && !isQuota,
                quotaExhausted: isQuota
            })
        };
    }
};
