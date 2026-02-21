// netlify/functions/process-image-ai.js
// AI-powered image analysis and tagging
// Uses multi-provider AI vision with automatic fallback (Gemini → OpenAI → Anthropic)

const { AIRTABLE_PAT, BASE_ID, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
const { analyzeImage, parseJsonResponse } = require('./utils/ai-provider');

const Airtable = {
    IMAGE_GALLERY_TABLE: 'Image_Gallery',
    ITEMS_TABLE: 'tblUA4uuS8IYlhKpD',
    CURATED_IMAGES_FIELD_NAME: 'Curated Images',
    IMAGE_TAGS_FIELD_NAME: 'Tags'
};

// --- Cloudinary Helper ---
async function getCloudinarySecureUrl(publicId) {
    console.log(`[Debug] getCloudinarySecureUrl: Initiated for publicId: "${publicId}"`);
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        throw new Error("Server configuration error: Missing Cloudinary credentials.");
    }
    const auth = 'Basic ' + Buffer.from(CLOUDINARY_API_KEY + ':' + CLOUDINARY_API_SECRET).toString('base64');
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/image/upload/${publicId}`;
    const response = await fetch(url, { headers: { 'Authorization': auth } });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Cloudinary lookup failed for ${publicId}: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.secure_url) {
         throw new Error(`Could not retrieve secure_url from Cloudinary for ${publicId}.`);
    }
    return data.secure_url;
}

async function analyzeImageWithAI(imageUrl) {
    console.log(`[Debug] analyzeImageWithAI: Analyzing URL: ${imageUrl.substring(0, 80)}...`);

    const prompt = `Analyze this TMT event photo. Identify the specific TMT catalog item shown, assess image quality, group size, and location.
Respond ONLY with a valid JSON object containing these exact fields: "catalogItemName" (string, use 'Historical Activity' if unknown), "groupSizeTag" (string enum: "Small", "Medium", "Large"), "locationTag" (string enum: "Indoor", "Outdoor", "Hybrid"), "qualityScore" (integer 1-10), "imageTags" (string, comma-separated keywords).
Do NOT include markdown code blocks or any text before or after the JSON object.`;

    // Fetch and encode image data
    let base64ImageData;
    try {
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) throw new Error(`Failed to fetch image from Cloudinary: ${imageResponse.statusText}`);
        const imageBuffer = await imageResponse.arrayBuffer();
        base64ImageData = Buffer.from(imageBuffer).toString('base64');
        console.log(`[Debug] analyzeImageWithAI: Base64 image data length: ${base64ImageData.length}`);
    } catch (fetchError) {
        throw new Error(`Failed to process image data from ${imageUrl}: ${fetchError.message}`);
    }

    // Use multi-provider vision with fallback
    const aiResult = await analyzeImage(prompt, base64ImageData, {
        caller: 'process-image-ai',
        temperature: 0.5,
        maxTokens: 1024,
    });

    if (!aiResult.ok) {
        throw new Error(`AI image analysis failed: ${aiResult.error}`);
    }

    console.log(`[Debug] analyzeImageWithAI: Response from ${aiResult.providerName}`);
    return parseJsonResponse(aiResult.text);
}

// --- Main Handler ---
exports.handler = async (event) => {
    console.log(`[Debug] process-image-ai handler invoked. Method: ${event.httpMethod}`);

    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({error: 'Method Not Allowed'}) };

    try {
        const { publicId } = JSON.parse(event.body);
        if (!publicId) return { statusCode: 400, body: JSON.stringify({error: 'Missing publicId'}) };

        console.log(`[Debug] Processing image: ${publicId}`);

        // 1. Fetch Cloudinary URL
        const imageUrl = await getCloudinarySecureUrl(publicId);
         console.log(`[Debug] Got Image URL: ${imageUrl.substring(0,80)}...`);

        // 2. Analyze with AI (multi-provider)
        const aiData = await analyzeImageWithAI(imageUrl);
        console.log(`[Debug] Got AI Data:`, aiData);
        const isBestOf = aiData.qualityScore >= 9;

        // 3. Find existing Item Record
        const escapedItemName = aiData.catalogItemName.replace(/'/g, "\\'");
        console.log(`[Debug] Searching for item named: "${escapedItemName}"`);
        const findItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}?filterByFormula=({Name}='${escapedItemName}')&maxRecords=1`;
        const itemRes = await fetch(findItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (!itemRes.ok) {
             const errorBody = await itemRes.json();
             throw new Error(`Airtable find item request failed: ${itemRes.statusText}`);
        }
        const itemData = await itemRes.json();
        const catalogRecordId = itemData.records && itemData.records.length > 0 ? itemData.records[0]?.id : null;
        console.log(`[Debug] Found Catalog Item ID: ${catalogRecordId || 'None'}`);

        // 4. Create record in Image_Gallery
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
        const airtableCreateUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.IMAGE_GALLERY_TABLE}`;
        const createGalleryRes = await fetch(airtableCreateUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(galleryPayload)
        });
        if (!createGalleryRes.ok) {
             const errorBody = await createGalleryRes.json();
             throw new Error(`Failed to create Image_Gallery record: ${createGalleryRes.statusText}`);
        }
        const createGalleryResponseData = await createGalleryRes.json();
        if (!createGalleryResponseData.records || createGalleryResponseData.records.length === 0) {
             throw new Error('Airtable create operation did not return the new record ID.');
        }
        const newGalleryRecordId = createGalleryResponseData.records[0].id;
        console.log(`[Debug] Created Image_Gallery record ID: ${newGalleryRecordId}`);

        // 5. Update the parent Item record (if found)
        if (catalogRecordId) {
            const getItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}/${catalogRecordId}?fields[]=${encodeURIComponent(Airtable.CURATED_IMAGES_FIELD_NAME)}`;
            const existingItemRes = await fetch(getItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
             if (!existingItemRes.ok) {
                 throw new Error(`Failed to fetch existing links for item ${catalogRecordId}: ${existingItemRes.statusText}`);
             }
            const existingItem = await existingItemRes.json();
            const existingLinks = existingItem.fields && existingItem.fields[Airtable.CURATED_IMAGES_FIELD_NAME] ? existingItem.fields[Airtable.CURATED_IMAGES_FIELD_NAME] : [];
            const updatedLinks = Array.from(new Set([...existingLinks, newGalleryRecordId]));

            const updateItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}/${catalogRecordId}`;
            const updateItemRes = await fetch(updateItemUrl, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: { [Airtable.CURATED_IMAGES_FIELD_NAME]: updatedLinks } })
            });
            if (!updateItemRes.ok) {
                 console.warn(`Failed to update Item ${catalogRecordId} with new link, but image gallery record ${newGalleryRecordId} was created.`);
            } else {
                console.log(`[Debug] Successfully updated Item record ${catalogRecordId}.`);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Image processed and tagged successfully.', publicId })
         };

    } catch (error) {
        console.error('[ERROR] process-image-ai handler failed:', error.message, error.stack);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Function execution failed: ${error.message}` })
         };
    }
};
