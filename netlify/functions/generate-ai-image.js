/**
 * AI Image Generation Function
 * Generates an AI-approximated image for manually added items based on their name, description, and metadata.
 * Uses multi-provider AI with automatic fallback (Imagen → gpt-image-1)
 * Uploads the result to Cloudinary for persistent storage.
 */

const crypto = require('crypto');
const { generateImage } = require('./utils/ai-provider');

const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;

/**
 * Generate a descriptive prompt for image generation based on item metadata
 */
function buildImagePrompt(itemData) {
    const { name, description, category, serviceType, tags } = itemData;

    const parts = [];
    parts.push(`Professional product/service photo of "${name}"`);

    if (category) {
        parts.push(`in the ${category} category`);
    }

    if (serviceType && serviceType !== 'Custom Item') {
        parts.push(`as a ${serviceType}`);
    }

    if (description && description.length < 200 && !description.includes('Manually added')) {
        parts.push(`. ${description}`);
    }

    if (tags && tags.length > 0) {
        const tagList = Array.isArray(tags) ? tags.slice(0, 5).join(', ') : tags;
        parts.push(`. Keywords: ${tagList}`);
    }

    parts.push('. Clean, professional photography style with good lighting. White or neutral background preferred. High quality product shot.');

    return parts.join(' ');
}

/**
 * Upload base64 image to Cloudinary
 */
async function uploadToCloudinary(base64Image, itemId, sessionId) {
    console.log('[AI IMAGE] Uploading to Cloudinary...');

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    const uploadTimestamp = Math.floor(Date.now() / 1000);

    const timestamp = Date.now();
    const sanitizedSessionId = (sessionId || 'ai-gen').replace(/[^a-zA-Z0-9_-]/g, '_');
    const sanitizedItemId = (itemId || 'manual').replace(/[^a-zA-Z0-9_-]/g, '_');
    const publicId = `ai_generated_${sanitizedSessionId}_${sanitizedItemId}_${timestamp}`;
    const displayName = `ai-generated-${sanitizedItemId}-${timestamp}`;

    const params = {
        display_name: displayName,
        folder: 'ai-generated-images',
        public_id: publicId,
        timestamp: uploadTimestamp,
        tags: `ai-generated,session-${sanitizedSessionId},item-${sanitizedItemId}`
    };

    const signatureString = Object.keys(params)
        .sort()
        .map(key => `${key}=${params[key]}`)
        .join('&') + CLOUDINARY_API_SECRET;

    const signature = crypto.createHash('sha1').update(signatureString).digest('hex');

    const dataUrl = `data:image/png;base64,${base64Image}`;

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
    const _startTime = Date.now();
    console.log('[AI IMAGE FUNC] ====== generate-ai-image function called ======');
    console.log('[AI IMAGE FUNC] HTTP Method:', event.httpMethod);
    console.log('[AI IMAGE FUNC] Timestamp:', new Date().toISOString());
    console.log('[AI IMAGE FUNC] Body length:', event.body?.length || 0, 'isBase64Encoded:', event.isBase64Encoded);

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

    // Debug: Log credential availability (NEVER log actual values)
    console.log('[AI IMAGE FUNC] Credentials check:', {
        CLOUDINARY_CLOUD_NAME: !!CLOUDINARY_CLOUD_NAME ? `set (${CLOUDINARY_CLOUD_NAME.length} chars)` : 'MISSING',
        CLOUDINARY_API_KEY: !!CLOUDINARY_API_KEY ? `set (${CLOUDINARY_API_KEY.length} chars)` : 'MISSING',
        CLOUDINARY_API_SECRET: !!CLOUDINARY_API_SECRET ? `set (${CLOUDINARY_API_SECRET.length} chars)` : 'MISSING',
    });

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
        let body;
        try {
            let rawBody = event.body;
            if (event.isBase64Encoded && event.body) {
                rawBody = Buffer.from(event.body, 'base64').toString('utf-8');
            }
            body = JSON.parse(rawBody);
        } catch (parseError) {
            console.error('[AI IMAGE FUNC] JSON parse error:', parseError.message);
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({ error: 'Invalid JSON body' })
            };
        }

        const { name, description, category, serviceType, tags, itemId, sessionId, customPrompt } = body;

        console.log('[AI IMAGE FUNC] Parsed request body:', {
            name: name || '(empty)',
            description: description ? `${description.substring(0, 100)}...` : '(empty)',
            category: category || '(empty)',
            serviceType: serviceType || '(empty)',
            tags: tags || '(empty)',
            itemId: itemId || '(empty)',
            sessionId: sessionId || '(empty)',
            hasCustomPrompt: !!customPrompt,
        });

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

        // Build the image generation prompt
        const prompt = customPrompt || buildImagePrompt({ name, description, category, serviceType, tags });
        console.log('[AI IMAGE FUNC] Generated prompt:', prompt.substring(0, 300));
        console.log('[AI IMAGE FUNC] Prompt length:', prompt.length);

        // Generate the image using multi-provider AI (Imagen → gpt-image-1)
        console.log('[AI IMAGE FUNC] Calling generateImage()...');
        const _genStartTime = Date.now();
        const imageResult = await generateImage(prompt, {
            caller: 'generate-ai-image',
            maxRetries: 1,
        });
        const _genElapsed = Date.now() - _genStartTime;
        console.log('[AI IMAGE FUNC] generateImage() completed in', _genElapsed, 'ms');
        console.log('[AI IMAGE FUNC] generateImage() result:', {
            ok: imageResult.ok,
            provider: imageResult.provider,
            providerName: imageResult.providerName,
            hasBase64: !!imageResult.base64,
            base64Length: imageResult.base64?.length || 0,
            format: imageResult.format,
            error: imageResult.error || null,
            quotaExhausted: imageResult.quotaExhausted || false,
        });

        if (!imageResult.ok) {
            console.error('[AI IMAGE] Image generation failed:', imageResult.error);
            const isQuota = imageResult.quotaExhausted || false;
            const statusCode = isQuota ? 429 : 500;
            return {
                statusCode,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: isQuota
                        ? 'AI image generation quota exceeded. Images will use placeholders.'
                        : 'Failed to generate AI image',
                    message: imageResult.error,
                    retryable: !isQuota,
                    quotaExhausted: isQuota
                })
            };
        }

        console.log(`[AI IMAGE] Image generated via ${imageResult.providerName}`);

        // Upload to Cloudinary
        console.log('[AI IMAGE FUNC] Uploading to Cloudinary...', {
            base64Length: imageResult.base64?.length || 0,
            itemId,
            sessionId,
        });
        const _uploadStartTime = Date.now();
        const cloudinaryResult = await uploadToCloudinary(imageResult.base64, itemId, sessionId);
        const _uploadElapsed = Date.now() - _uploadStartTime;
        console.log('[AI IMAGE FUNC] Cloudinary upload completed in', _uploadElapsed, 'ms');

        const _totalElapsed = Date.now() - _startTime;
        console.log('[AI IMAGE FUNC] ====== TOTAL TIME:', _totalElapsed, 'ms ======');

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
                prompt: prompt,
                _aiProvider: imageResult.provider,
            })
        };

    } catch (error) {
        const _totalElapsed = Date.now() - _startTime;
        console.error('[AI IMAGE] Function error:', error.message);
        console.error('[AI IMAGE] Stack:', error.stack);
        console.error('[AI IMAGE] Error type:', error.constructor.name);
        console.error('[AI IMAGE] Error occurred after', _totalElapsed, 'ms');

        const statusCode = error.statusCode === 429 ? 429 : 500;
        const isQuota = error.quotaExhausted || false;
        return {
            statusCode,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: isQuota
                    ? 'AI image generation quota exceeded. Images will use placeholders.'
                    : 'Failed to generate AI image',
                message: error.message,
                retryable: statusCode === 429 && !isQuota,
                quotaExhausted: isQuota
            })
        };
    }
};
