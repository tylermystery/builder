/**
 * Cloudinary Upload Function
 * Handles uploading user images to Cloudinary for persistent storage
 * Returns a secure URL that can be stored in the session data
 */

const fetch = require('node-fetch');

exports.handler = async function (event, context) {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = process.env;

    console.log('[UPLOAD DEBUG] Cloudinary upload function called');
    console.log('[UPLOAD DEBUG] CLOUDINARY_CLOUD_NAME configured:', !!CLOUDINARY_CLOUD_NAME);

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        console.error('[UPLOAD DEBUG] Missing Cloudinary credentials');
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Cloudinary credentials not configured' })
        };
    }

    try {
        const body = JSON.parse(event.body);
        const { imageData, sessionId, itemId } = body;

        if (!imageData) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing imageData' })
            };
        }

        console.log('[UPLOAD DEBUG] Uploading image for session:', sessionId, 'item:', itemId);
        console.log('[UPLOAD DEBUG] Image data length:', imageData.length);

        // Generate a unique public_id for the upload
        const timestamp = Date.now();
        const publicId = `user-uploads/${sessionId || 'unsaved'}/${itemId || 'manual'}-${timestamp}`;

        // Cloudinary upload URL
        const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

        // Create the upload signature
        const crypto = require('crypto');
        const uploadTimestamp = Math.floor(Date.now() / 1000);

        // Build params for signing (alphabetical order, exclude file and api_key)
        const params = {
            folder: 'user-uploads',
            public_id: publicId,
            timestamp: uploadTimestamp,
            tags: `user-upload,session-${sessionId || 'unsaved'},item-${itemId || 'manual'}`
        };

        // Create signature string (params in alphabetical order)
        const signatureString = Object.keys(params)
            .sort()
            .map(key => `${key}=${params[key]}`)
            .join('&') + CLOUDINARY_API_SECRET;

        const signature = crypto.createHash('sha1').update(signatureString).digest('hex');

        console.log('[UPLOAD DEBUG] Generated signature for upload');

        // Make the upload request
        const formData = new URLSearchParams();
        formData.append('file', imageData);
        formData.append('api_key', CLOUDINARY_API_KEY);
        formData.append('timestamp', uploadTimestamp.toString());
        formData.append('signature', signature);
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
                body: JSON.stringify({ error: 'Upload failed', details: errorText })
            };
        }

        const data = await response.json();
        console.log('[UPLOAD DEBUG] Upload successful, secure_url:', data.secure_url);

        return {
            statusCode: 200,
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
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
