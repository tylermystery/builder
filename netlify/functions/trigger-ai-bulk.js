// Use Node.js 22 built-in fetch instead of node-fetch to avoid module resolution issues
// NOTE: We assume CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, and CLOUDINARY_CLOUD_NAME
// are set as Netlify Environment Variables.
const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, URL } = process.env;

const CLOUDINARY_AUTH = 'Basic ' + Buffer.from(CLOUDINARY_API_KEY + ':' + CLOUDINARY_API_SECRET).toString('base64');
const AI_PROCESSOR_URL = `${URL || 'http://localhost:8888'}/.netlify/functions/process-image-ai`;

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { tagFilter, maxAssets } = JSON.parse(event.body);
        
        // 1. Fetch assets from Cloudinary Admin API
        const adminApiUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/image`;
        const response = await fetch(`${adminApiUrl}?max_results=${maxAssets || 500}&tags=${tagFilter || ''}`, {
            headers: { 'Authorization': CLOUDINARY_AUTH }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Cloudinary Admin API Error: ${errorData.error.message}`);
        }

        const data = await response.json();
        const assets = data.resources;
        
        console.log(`Starting bulk AI processing for ${assets.length} assets.`);

        const processPromises = assets.map(asset => 
            // Internal call to the processing function
            fetch(AI_PROCESSOR_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ publicId: asset.public_id })
            })
        );
        
        // Use Promise.allSettled to ensure one failure doesn't stop the whole batch
        const results = await Promise.allSettled(processPromises);
        const fulfilled = results.filter(r => r.status === 'fulfilled').length;

        return {
            statusCode: 200,
            body: JSON.stringify({ 
                message: `Bulk job completed. Triggered processing for ${assets.length} assets. Successfully processed: ${fulfilled}.`,
                processedCount: assets.length 
            })
        };

    } catch (error) {
        console.error('Bulk Trigger Error:', error.message);
        return { statusCode: 500, body: JSON.stringify({ error: `Bulk trigger failed: ${error.message}` }) };
    }
};
