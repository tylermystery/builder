/**
 * AI Image Generation Function
 * Generates an AI-approximated image for manually added items based on their name, description, and metadata.
 * Uses Together AI's FLUX model for fast, high-quality image generation.
 * Uploads the result to Cloudinary for persistent storage.
 */

const crypto = require('crypto');

const { TOGETHER_API_KEY, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;

/**
 * Generate a descriptive prompt for image generation based on item metadata
 */
function buildImagePrompt(itemData) {
    const { name, description, category, serviceType, tags } = itemData;

    // Build a descriptive prompt for the image
    const parts = [];

    // Start with what we're creating
    parts.push(`Professional product/service photo of "${name}"`);

    // Add category context if available
    if (category) {
        parts.push(`in the ${category} category`);
    }

    // Add service type context if available
    if (serviceType && serviceType !== 'Custom Item') {
        parts.push(`as a ${serviceType}`);
    }

    // Add description-based details if not too long
    if (description && description.length < 200 && !description.includes('Manually added')) {
        parts.push(`. ${description}`);
    }

    // Add tags for additional context
    if (tags && tags.length > 0) {
        const tagList = Array.isArray(tags) ? tags.slice(0, 5).join(', ') : tags;
        parts.push(`. Keywords: ${tagList}`);
    }

    // Add style guidance
    parts.push('. Clean, professional photography style with good lighting. White or neutral background preferred. High quality product shot.');

    return parts.join(' ');
}

/**
 * Generate an image using Together AI's FLUX model
 */
async function generateImageWithTogether(prompt) {
    console.log('[AI IMAGE] Generating image with Together AI...');
    console.log('[AI IMAGE] Prompt:', prompt);

    const response = await fetch('https://api.together.xyz/v1/images/generations', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${TOGETHER_API_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'black-forest-labs/FLUX.1-schnell-Free',
            prompt: prompt,
            width: 768,
            height: 768,
            steps: 4,
            n: 1,
            response_format: 'b64_json'
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[AI IMAGE] Together AI error:', response.status, errorText);
        throw new Error(`Together AI API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    console.log('[AI IMAGE] Together AI response received');

    if (!result.data || !result.data[0] || !result.data[0].b64_json) {
        console.error('[AI IMAGE] Unexpected response structure:', JSON.stringify(result).substring(0, 200));
        throw new Error('Invalid response from Together AI - no image data');
    }

    return result.data[0].b64_json;
}

/**
 * Upload base64 image to Cloudinary
 */
async function uploadToCloudinary(base64Image, itemId, sessionId) {
    console.log('[AI IMAGE] Uploading to Cloudinary...');

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    const uploadTimestamp = Math.floor(Date.now() / 1000);

    // Generate unique identifiers
    const timestamp = Date.now();
    const sanitizedSessionId = (sessionId || 'ai-gen').replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedItemId = (itemId || 'manual').replace(/[^a-zA-Z0-9_-]/g, '_');
    const publicId = `ai_generated_${sanitizedSessionId}_${sanitizedItemId}_${timestamp}`;
    const displayName = `ai-generated-${sanitizedItemId}-${timestamp}`;

    // Build params for signing
    const params = {
        display_name: displayName,
        folder: 'ai-generated-images',
        public_id: publicId,
        timestamp: uploadTimestamp,
        tags: `ai-generated,session-${sanitizedSessionId},item-${sanitizedItemId}`
    };

    // Create signature
    const signatureString = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&') + CLOUDINARY_API_SECRET;

    const signature = crypto.createHash('sha1').update(signatureString).digest('hex');

    // Prepare the data URL
    const dataUrl = `data:image/png;base64,${base64Image}`;

    // Use FormData for upload
    const formData = new FormData();
    formData.append('file', dataUrl);
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('timestamp', uploadTimestamp.toString());
    formData.append('signature', signature);
    formData.append('display_name', displayName);
    formData.append('folder', params.folder);
    formData.append('public_id', publicId);
    formData.append('tags', params.tags);

    const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('[AI IMAGE] Cloudinary upload error:', response.status, errorText);
        throw new Error(`Cloudinary upload failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('[AI IMAGE] Cloudinary upload successful:', data.secure_url);

    return {
        url: data.secure_url,
        publicId: data.public_id,
        width: data.width,
        height: data.height
    };
}

// Main Handler
exports.handler = async function(event, context) {
    // Handle CORS preflight
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: ''
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    // Check required environment variables
    if (!TOGETHER_API_KEY) {
        console.error('[AI IMAGE] Missing TOGETHER_API_KEY');
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'AI image generation not configured - missing API key' })
        };
    }

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        console.error('[AI IMAGE] Missing Cloudinary credentials');
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({ error: 'Image storage not configured - missing Cloudinary credentials' })
        };
    }

    try {
        // Parse request body
        let body;
        try {
            let rawBody = event.body;
            if (event.isBase64Encoded && event.body) {
                rawBody = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = JSON.parse(rawBody);
        } catch (parseError) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Invalid JSON body' })
            };
        }

        const { name, description, category, serviceType, tags, itemId, sessionId } = body;

        if (!name) {
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Missing required field: name' })
            };
        }

        console.log('[AI IMAGE] Generating image for:', name);
        console.log('[AI IMAGE] Item ID:', itemId);
        console.log('[AI IMAGE] Description:', description?.substring(0, 100));

        // Build the image generation prompt
        const prompt = buildImagePrompt({ name, description, category, serviceType, tags });

        // Generate the image
        const base64Image = await generateImageWithTogether(prompt);

        // Upload to Cloudinary
        const cloudinaryResult = await uploadToCloudinary(base64Image, itemId, sessionId);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                imageUrl: cloudinaryResult.url,
                publicId: cloudinaryResult.publicId,
                width: cloudinaryResult.width,
                height: cloudinaryResult.height,
                isAIGenerated: true,
                prompt: prompt
            })
        };

    } catch (error) {
        console.error('[AI IMAGE] Function error:', error.message);
        console.error('[AI IMAGE] Stack:', error.stack);

        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Failed to generate AI image',
                message: error.message
            })
        };
    }
};
