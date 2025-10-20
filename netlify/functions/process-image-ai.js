// This file contains the fix for the Cloudinary 404 Not Found error.
const fetch = require('node-fetch');
const { Buffer } = require('buffer');
const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

const Airtable = {
    IMAGE_GALLERY_TABLE: 'Image_Gallery',
    ITEMS_TABLE: 'Items', // Use Table Name for clarity
    CURATED_IMAGES_FIELD_NAME: 'Curated Images',
    IMAGE_TAGS_FIELD_NAME: 'Tags',
};

// --- Cloudinary Helper ---
async function getCloudinarySecureUrl(publicId) {
    const auth = 'Basic ' + Buffer.from(`${CLOUDINARY_API_KEY}:${CLOUDINARY_API_SECRET}`).toString('base64');
    
    // --- THIS IS THE FIX ---
    // The Cloudinary Admin API requires the resource_type ('image') in the URL path.
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/image/upload/${publicId}`;
    // --- END FIX ---
    
    console.log(`[process-image-ai] Fetching from Cloudinary URL: ${url}`);
    const response = await fetch(url, { headers: { 'Authorization': auth } });
    
    if (!response.ok) {
        // Provide more detailed error logging
        const errorText = await response.text();
        console.error(`[process-image-ai] Cloudinary API Error Response: ${errorText}`);
        throw new Error(`Cloudinary lookup failed for ${publicId}: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.secure_url;
}

// --- Gemini Call Helper ---
async function analyzeImageWithGemini(imageUrl) {
    const prompt = `Analyze this TMT event photo. You must identify the specific TMT catalog item shown, assess image quality, group size, and location. Respond ONLY with a valid JSON object. Do not include markdown code blocks (e.g., \`\`\`json).`;
    
    const responseSchema = {
        type: "OBJECT",
        properties: {
            "catalogItemName": { "type": "STRING", "description": "The name of the TMT catalog item in the image (e.g., Fort Battle). If unknown, use 'Historical Activity'." },
            "groupSizeTag": { "type": "STRING", "enum": ["Small", "Medium", "Large"], "description": "Group size in the photo: Small (1-10), Medium (11-25), Large (26+)." },
            "locationTag": { "type": "STRING", "enum": ["Indoor", "Outdoor", "Hybrid"], "description": "The primary setting of the event: Indoor, Outdoor, or Hybrid." },
            "qualityScore": { "type": "INTEGER", "description": "Rate image quality and brand fit on a scale of 1 to 10." },
            "imageTags": { "type": "STRING", "description": "A comma-separated list of 10 relevant visual keywords (e.g., laughter, blue sky, cannon, summer)." }
        },
        required: ["catalogItemName", "groupSizeTag", "locationTag", "qualityScore", "imageTags"],
    };

    const payload = {
        contents: [{
            parts: [
                { text: prompt },
                { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString('base64') } }
            ]
        }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema
        }
    };
    
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.json();
        console.error("[process-image-ai] Gemini API Error:", errorBody);
        throw new Error(`Gemini API call failed with status ${response.status}`);
    }

    const result = await response.json();
    const jsonText = result.candidates[0].content.parts[0].text;
    return JSON.parse(jsonText);
}

// --- Main Handler ---
exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    
    try {
        const { publicId } = JSON.parse(event.body);
        if (!publicId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing publicId' }) };
        
        console.log(`[process-image-ai] Started processing: ${publicId}`);

        const imageUrl = await getCloudinarySecureUrl(publicId);
        const aiData = await analyzeImageWithGemini(imageUrl);
        const isBestOf = aiData.qualityScore >= 9;

        const findItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}?filterByFormula=({Name}='${encodeURIComponent(aiData.catalogItemName)}')&maxRecords=1`;
        const itemRes = await fetch(findItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const itemData = await itemRes.json();
        const catalogRecordId = itemData.records && itemData.records.length > 0 ? itemData.records[0].id : null;

        const galleryPayload = {
            records: [{
                fields: {
                    PublicID: publicId,
                    ImageURL: imageUrl,
                    CatalogItemLink: catalogRecordId ? [catalogRecordId] : null,
                    isBestOf: isBestOf,
                    GroupSizeTag: aiData.groupSizeTag,
                    LocationTag: aiData.locationTag,
                    [Airtable.IMAGE_TAGS_FIELD_NAME]: aiData.imageTags,
                }
            }]
        };

        const airtableUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.IMAGE_GALLERY_TABLE}`;
        const createGalleryRes = await fetch(airtableUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(galleryPayload)
        });

        if (!createGalleryRes.ok) {
            console.error('[process-image-ai] Airtable Error:', await createGalleryRes.json());
            throw new Error('Failed to create Image_Gallery record.');
        }
        
        const createGalleryResponseData = await createGalleryRes.json();
        const newGalleryRecordId = createGalleryResponseData.records[0].id;

        if (catalogRecordId) {
            const existingItemRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}/${catalogRecordId}`, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            const existingItem = await existingItemRes.json();
            const existingLinks = existingItem.fields[Airtable.CURATED_IMAGES_FIELD_NAME] || [];

            const updateItemPayload = {
                fields: {
                    [Airtable.CURATED_IMAGES_FIELD_NAME]: [...new Set([...existingLinks, newGalleryRecordId])]
                }
            };
            
            const updateItemRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}/${catalogRecordId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(updateItemPayload)
            });

            if (!updateItemRes.ok) {
                 console.error('[process-image-ai] Airtable Link Update Error:', await updateItemRes.json());
            }
        }

        return { statusCode: 200, body: JSON.stringify({ message: 'Image processed and tagged successfully.', publicId }) };

    } catch (error) {
        console.error('[process-image-ai] AI Processing Error:', error.message);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};

