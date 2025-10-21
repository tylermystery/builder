// FULL FUNCTIONAL VERSION
// REPLACE the entire contents of: netlify/functions/process-image-ai.js (or ai_image_processor.js)

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

const Airtable = {
    IMAGE_GALLERY_TABLE: 'Image_Gallery',
    ITEMS_TABLE: 'tblUA4uuS8IYlhKpD',
    CURATED_IMAGES_FIELD_NAME: 'Curated Images',
    IMAGE_TAGS_FIELD_NAME: 'Tags'
};

// --- Cloudinary Helper (Includes debug logs) ---
async function getCloudinarySecureUrl(publicId) {
    console.log(`[Debug] getCloudinarySecureUrl: Initiated for publicId: "${publicId}"`);
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        console.error("[Debug] CRITICAL: Cloudinary environment variables missing!");
        throw new Error("Server configuration error: Missing Cloudinary credentials.");
    }
    const auth = 'Basic ' + Buffer.from(CLOUDINARY_API_KEY + ':' + CLOUDINARY_API_SECRET).toString('base64');
    // --- THIS IS THE FIX ---
    // The endpoint needs to include the resource type (e.g., 'image', 'video', 'raw')
    // Assuming your images are uploaded as resource type 'image'.
    // Also, the endpoint path is slightly different for fetching a single resource's details.
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/image/upload/${publicId}`;
    // --- END FIX ---
    console.log(`[Debug] getCloudinarySecureUrl: Attempting to fetch URL: ${url}`);
    const response = await fetch(url, { headers: { 'Authorization': auth } });
    console.log(`[Debug] getCloudinarySecureUrl: Received status ${response.status} from Cloudinary.`);
    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`[Debug] getCloudinarySecureUrl: Cloudinary error response: ${errorBody}`);
        throw new Error(`Cloudinary lookup failed for ${publicId}: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    if (!data.secure_url) {
         console.error(`[Debug] getCloudinarySecureUrl: 'secure_url' not found in Cloudinary response for ${publicId}. Response:`, data);
         throw new Error(`Could not retrieve secure_url from Cloudinary for ${publicId}.`);
    }
    return data.secure_url;
}

// --- Gemini Call Helper (Includes debug logs) ---
async function analyzeImageWithGemini(imageUrl) {
    console.log(`[Debug] analyzeImageWithGemini: Analyzing URL: ${imageUrl.substring(0, 80)}...`);
     if (!GEMINI_API_KEY) {
        console.error("[Debug] CRITICAL: GEMINI_API_KEY is missing!");
        throw new Error("Server configuration error: Missing Gemini API Key.");
    }
    const prompt = `Analyze this TMT event photo. You must identify the specific TMT catalog item shown, assess image quality, group size, and location. Respond ONLY with a valid JSON object. Do not include markdown code blocks (e.g., \\\`\\\`\\\`json).`;

    // --- THIS IS THE FIX ---
    // Update the schema to match the expected field names in Airtable and the code logic.
    // Make sure the enum values match potential outputs and Airtable field types.
    const responseSchema = {
        type: "OBJECT",
        properties: {
            "catalogItemName": { "type": "STRING", "description": "The name of the TMT catalog item in the image (e.g., Fort Battle). If unknown, use 'Historical Activity'." },
            "groupSizeTag": { "type": "STRING", "enum": ["Small", "Medium", "Large"], "description": "Group size in the photo: Small (1-10), Medium (11-25), Large (26+)." },
            "locationTag": { "type": "STRING", "enum": ["Indoor", "Outdoor", "Hybrid"], "description": "The primary setting of the event: Indoor, Outdoor, or Hybrid." },
            "qualityScore": { "type": "INTEGER", "description": "Rate image quality and brand fit on a scale of 1 to 10." },
            "imageTags": { "type": "STRING", "description": "A comma-separated list of 5-10 relevant visual keywords (e.g., laughter, blue sky, cannon, summer)." }
        },
        required: ["catalogItemName", "groupSizeTag", "locationTag", "qualityScore", "imageTags"]
    };
    // --- END FIX ---

    const payload = {
        contents: [ { role: "user", parts: [ { text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString('base64') } } ] } ],
        generationConfig: { responseMimeType: "application/json", responseSchema: responseSchema }
    };
    // --- THIS IS THE FIX ---
    // Ensure you are using the correct model name. `gemini-pro` doesn't support inline images directly in this API structure.
    // Use a model that supports multimodal input like 'gemini-1.5-flash-latest' or 'gemini-pro-vision' (older).
    // Let's use gemini-1.5-flash-latest as it's current.
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;
    // --- END FIX ---
    console.log(`[Debug] analyzeImageWithGemini: Sending request to Gemini...`);
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    console.log(`[Debug] analyzeImageWithGemini: Received status ${response.status} from Gemini.`);

    if (!response.ok) {
        // Log the detailed error response from Gemini
        let errorBody = await response.text(); // Read as text first for flexibility
        try {
            errorBody = JSON.parse(errorBody); // Try parsing as JSON
        } catch (e) { /* Ignore if not JSON */ }
        console.error("[Debug] Gemini API Error Response Body:", errorBody);
        throw new Error(`Gemini API call failed with status ${response.status}`);
    }

    const result = await response.json();
    // Add more robust checking for the Gemini response structure
    if (!result.candidates || !result.candidates[0] || !result.candidates[0].content || !result.candidates[0].content.parts || !result.candidates[0].content.parts[0].text) {
         console.error('[Debug] Unexpected Gemini response structure:', JSON.stringify(result, null, 2));
         throw new Error('Could not extract text from Gemini response. Structure might have changed.');
    }
    const jsonText = result.candidates[0].content.parts[0].text;
     console.log(`[Debug] analyzeImageWithGemini: Received JSON text from Gemini.`);
    try {
        return JSON.parse(jsonText);
    } catch (e) {
        console.error("[Debug] Failed to parse JSON response from Gemini:", jsonText);
        throw new Error("Gemini returned invalid JSON.");
    }
}


// --- Main Handler ---
exports.handler = async (event) => {
    // --- THIS IS THE FIX ---
    // Add console log at the very beginning to confirm invocation
    console.log(`[Debug] Full process-image-ai handler invoked. Method: ${event.httpMethod}`);
    // --- END FIX ---

    if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({error: 'Method Not Allowed'}) };

    try {
        const { publicId } = JSON.parse(event.body);
        if (!publicId) return { statusCode: 400, body: JSON.stringify({error: 'Missing publicId'}) };

        console.log(`[Debug] Processing image: ${publicId}`);

        // 1. Fetch Cloudinary URL
        const imageUrl = await getCloudinarySecureUrl(publicId);
         console.log(`[Debug] Got Image URL: ${imageUrl.substring(0,80)}...`);

        // 2. Analyze with Gemini
        const aiData = await analyzeImageWithGemini(imageUrl);
        console.log(`[Debug] Got AI Data:`, aiData);
        const isBestOf = aiData.qualityScore >= 9;

        // 3. Find existing Item Record (Escape single quotes in name for Airtable formula)
        const escapedItemName = aiData.catalogItemName.replace(/'/g, "\\'");
        console.log(`[Debug] Searching for item named: "${escapedItemName}"`);
        const findItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}?filterByFormula=({Name}='${escapedItemName}')&maxRecords=1`;
        const itemRes = await fetch(findItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (!itemRes.ok) { // Add check for Airtable find request
             console.error('[Debug] Airtable Find Item Request Failed Status:', itemRes.status);
             const errorBody = await itemRes.json();
             console.error('[Debug] Airtable Find Item Error Body:', errorBody);
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
                    [Airtable.IMAGE_TAGS_FIELD_NAME]: aiData.imageTags, // Use the constant
                }
            }]
        };
        console.log(`[Debug] Creating Image_Gallery record... Payload fields:`, galleryPayload.records[0].fields);
        const airtableCreateUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.IMAGE_GALLERY_TABLE}`;
        const createGalleryRes = await fetch(airtableCreateUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(galleryPayload)
        });
        if (!createGalleryRes.ok) {
             console.error('[Debug] Airtable Create Gallery Record Failed Status:', createGalleryRes.status);
             const errorBody = await createGalleryRes.json();
             console.error('[Debug] Airtable Create Gallery Record Error Body:', errorBody);
             throw new Error(`Failed to create Image_Gallery record: ${createGalleryRes.statusText}`);
        }
        const createGalleryResponseData = await createGalleryRes.json();
        // Add check for successful record creation
        if (!createGalleryResponseData.records || createGalleryResponseData.records.length === 0) {
             console.error('[Debug] Airtable create response did not contain records:', createGalleryResponseData);
             throw new Error('Airtable create operation did not return the new record ID.');
        }
        const newGalleryRecordId = createGalleryResponseData.records[0].id;
        console.log(`[Debug] Created Image_Gallery record ID: ${newGalleryRecordId}`);

        // 5. Update the parent Item record (if found)
        if (catalogRecordId) {
            console.log(`[Debug] Updating Item record ${catalogRecordId} to link Image ${newGalleryRecordId}...`);
            // Fetch existing links first
            const getItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}/${catalogRecordId}?fields[]=${encodeURIComponent(Airtable.CURATED_IMAGES_FIELD_NAME)}`;
            const existingItemRes = await fetch(getItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
             if (!existingItemRes.ok) { // Add check
                 console.error('[Debug] Airtable Get Existing Links Failed Status:', existingItemRes.status);
                 const errorBody = await existingItemRes.json();
                 console.error('[Debug] Airtable Get Existing Links Error Body:', errorBody);
                 throw new Error(`Failed to fetch existing links for item ${catalogRecordId}: ${existingItemRes.statusText}`);
             }
            const existingItem = await existingItemRes.json();
            const existingLinks = existingItem.fields && existingItem.fields[Airtable.CURATED_IMAGES_FIELD_NAME] ? existingItem.fields[Airtable.CURATED_IMAGES_FIELD_NAME] : [];
            console.log(`[Debug] Existing links on Item: ${existingLinks.length}`);
            // Combine and ensure uniqueness (using Set)
            const updatedLinks = Array.from(new Set([...existingLinks, newGalleryRecordId]));

            const updateItemPayload = {
                fields: {
                    [Airtable.CURATED_IMAGES_FIELD_NAME]: updatedLinks
                }
            };
            console.log(`[Debug] Patching Item record with updated links:`, updatedLinks);
            const updateItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}/${catalogRecordId}`;
            const updateItemRes = await fetch(updateItemUrl, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(updateItemPayload)
            });
            if (!updateItemRes.ok) {
                 console.error('[Debug] Airtable Patch Item Failed Status:', updateItemRes.status);
                 const errorBody = await updateItemRes.json();
                 console.error('[Debug] Airtable Patch Item Error Body:', errorBody);
                 // Log error but don't throw, as the image record was still created
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
        // Return a more informative error message to the client
        return {
            statusCode: 500,
            body: JSON.stringify({ error: `Function execution failed: ${error.message}` })
         };
    }
};
