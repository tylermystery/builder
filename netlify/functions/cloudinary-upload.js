/**
 * Cloudinary Upload Function
 * Handles uploading user images to Cloudinary for persistent storage
 * Returns a secure URL that can be stored in the session data
 */

const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    // Handle CORS preflight requests
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

    // Only allow POST requests
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

    const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;

    console.log('[UPLOAD DEBUG] Cloudinary upload function called');
    console.log('[UPLOAD DEBUG] CLOUDINARY_CLOUD_NAME configured:', !!CLOUDINARY_CLOUD_NAME);
    console.log('[UPLOAD DEBUG] CLOUDINARY_API_KEY configured:', !!CLOUDINARY_API_KEY);
    console.log('[UPLOAD DEBUG] CLOUDINARY_API_SECRET configured:', !!CLOUDINARY_API_SECRET);

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        console.error('[UPLOAD DEBUG] Missing Cloudinary credentials');
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Cloudinary credentials not configured',
                hasCloudName: !!CLOUDINARY_CLOUD_NAME,
                hasApiKey: !!CLOUDINARY_API_KEY,
                hasApiSecret: !!CLOUDINARY_API_SECRET
            })
        };
    }

    try {
        console.log('[UPLOAD DEBUG] Raw body length:', event.body?.length || 0);
        console.log('[UPLOAD DEBUG] Body type:', typeof event.body);
        console.log('[UPLOAD DEBUG] Is base64 encoded:', event.isBase64Encoded);

        // Handle base64-encoded body (Netlify may encode large payloads)
        let rawBody = event.body;
        if (event.isBase64Encoded && event.body) {
            console.log('[UPLOAD DEBUG] Decoding base64 event body');
            rawBody = Buffer.from(event.body, 'base64').toString('utf-8');
            console.log('[UPLOAD DEBUG] Decoded body length:', rawBody.length);
        }

        let body;
        try {
            body = JSON.parse(rawBody);
        } catch (parseError) {
            console.error('[UPLOAD DEBUG] JSON parse error:', parseError.message);
            console.error('[UPLOAD DEBUG] First 200 chars of body:', rawBody?.substring(0, 200));
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Invalid JSON body',
                    parseError: parseError.message,
                    bodyPreview: rawBody?.substring(0, 100)
                })
            };
        }

        const { imageData, sessionId, itemId } = body;

        console.log('[UPLOAD DEBUG] Parsed body fields - sessionId:', sessionId, 'itemId:', itemId);
        console.log('[UPLOAD DEBUG] imageData present:', !!imageData);
        console.log('[UPLOAD DEBUG] imageData type:', typeof imageData);

        if (!imageData) {
            console.error('[UPLOAD DEBUG] Missing imageData - body keys:', Object.keys(body || {}));
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Missing imageData',
                    receivedKeys: Object.keys(body || {}),
                    bodyPreview: JSON.stringify(body).substring(0, 200)
                })
            };
        }

        // Validate imageData format
        if (!imageData.startsWith('data:image/')) {
            console.error('[UPLOAD DEBUG] Invalid imageData format - does not start with data:image/');
            return {
                statusCode: 400,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Invalid image data format',
                    expected: 'data:image/...',
                    received: imageData.substring(0, 30)
                })
            };
        }

        console.log('[UPLOAD DEBUG] Uploading image for session:', sessionId, 'item:', itemId);
        console.log('[UPLOAD DEBUG] Image data length:', imageData.length);
        console.log('[UPLOAD DEBUG] Image data starts with:', imageData.substring(0, 50));

        // Generate a unique public_id for the upload
        // Note: public_id should NOT contain slashes when using the folder parameter
        // Cloudinary interprets slashes as folder separators in display_name, causing errors
        const timestamp = Date.now();
        const sanitizedSessionId = (sessionId || 'unsaved').replace(/[^a-zA-Z0-9_-]/g, '_');
        const sanitizedItemId = (itemId || 'manual').replace(/[^a-zA-Z0-9_-]/g, '_');
        const publicId = `${sanitizedSessionId}_${sanitizedItemId}_${timestamp}`;

        // Cloudinary upload URL
        const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

        // Create the upload signature
        const crypto = require('crypto');
        const uploadTimestamp = Math.floor(Date.now() / 1000);

        // Build params for signing (alphabetical order, exclude file and api_key)
        // Note: folder parameter handles the directory structure, public_id is just the filename
        // IMPORTANT: display_name must be set explicitly without slashes to avoid Cloudinary error
        // "Display name cannot contain slashes" - this happens when Cloudinary auto-generates
        // display_name from folder + public_id path
        const displayName = `${sanitizedSessionId}-${sanitizedItemId}-${timestamp}`;
        const params = {
            display_name: displayName,
            folder: 'user-uploads',
            public_id: publicId,
            timestamp: uploadTimestamp,
            tags: `user-upload,session-${sanitizedSessionId},item-${sanitizedItemId}`
        };

        // Create signature string (params in alphabetical order)
        const signatureString = Object.keys(params)
            .sort()
            .map(key => `${key}=${params[key]}`)
            .join('&') + CLOUDINARY_API_SECRET;

        const signature = crypto.createHash('sha1').update(signatureString).digest('hex');

        console.log('[UPLOAD DEBUG] Generated signature for upload');
        console.log('[UPLOAD DEBUG] Public ID:', publicId);
        console.log('[UPLOAD DEBUG] Display Name:', displayName);

        // Make the upload request
        const formData = new URLSearchParams();
        formData.append('file', imageData);
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

        console.log('[UPLOAD DEBUG] Cloudinary response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[UPLOAD DEBUG] Cloudinary upload error:', errorText);
            return {
                statusCode: response.status,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                body: JSON.stringify({
                    error: 'Cloudinary upload failed',
                    details: errorText,
                    cloudinaryStatus: response.status
                })
            };
        }

        const data = await response.json();
        console.log('[UPLOAD DEBUG] Upload successful, secure_url:', data.secure_url);

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                success: true,
                secure_url: data.secure_url,
                public_id: data.public_id,
                width: data.width,
                height: data.height
            })
        };

    } catch (error) {
        console.error('[UPLOAD DEBUG] Function error:', error.message);
        console.error('[UPLOAD DEBUG] Function error stack:', error.stack);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                error: 'Server error',
                message: error.message,
                stack: error.stack
            })
        };
    }
};
