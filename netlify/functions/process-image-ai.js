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

// REPLACE the analyzeImageWithGemini function in: netlify/functions/process-image-ai.js (or ai_image_processor.js)

// REPLACE the analyzeImageWithGemini function again

async function analyzeImageWithGemini(imageUrl) {
    console.log(`[Debug] analyzeImageWithGemini: Analyzing URL: ${imageUrl.substring(0, 80)}...`);
     if (!GEMINI_API_KEY) {
        console.error("[Debug] CRITICAL: GEMINI_API_KEY is missing!");
        throw new Error("Server configuration error: Missing Gemini API Key.");
    }

    // --- THIS IS THE FIX ---
    // Modify the prompt slightly to be even more explicit about ONLY JSON output,
    // since we can't force it with schema parameters on the v1 endpoint.
    const prompt = `Analyze this TMT event photo. Identify the specific TMT catalog item shown, assess image quality, group size, and location.
Respond ONLY with a valid JSON object containing these exact fields: "catalogItemName" (string, use 'Historical Activity' if unknown), "groupSizeTag" (string enum: "Small", "Medium", "Large"), "locationTag" (string enum: "Indoor", "Outdoor", "Hybrid"), "qualityScore" (integer 1-10), "imageTags" (string, comma-separated keywords).
Do NOT include markdown code blocks (e.g., \\\`\\\`\\\`json) or any text before or after the JSON object.`;
    // --- END FIX ---

    // Define the schema locally for reference/validation if needed later, but don't send it.
    const expectedSchemaStructure = { /* ... keep the schema definition here for reference ... */ };

    const payload = {
        contents: [ { role: "user", parts: [ { text: prompt }, { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString('base64') } } ] } ],
        // --- THIS IS THE FIX ---
        // Remove generationConfig or ensure it doesn't contain the unsupported fields
        // generationConfig: {} // Keep empty or remove entirely
        // --- END FIX ---
    };

    // Use the stable v1 endpoint
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`;

    console.log(`[Debug] analyzeImageWithGemini: Sending request to Gemini v1 endpoint (no schema enforcement)...`);
    const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    console.log(`[Debug] analyzeImageWithGemini: Received status ${response.status} from Gemini.`);

    if (!response.ok) {
        let errorBody = await response.text();
        try { errorBody = JSON.parse(errorBody); } catch (e) { /* Ignore */ }
        console.error("[Debug] Gemini API Error Response Body:", errorBody);
        let errorMessage = `Gemini API call failed with status ${response.status}`;
        if (response.status === 400) errorMessage += ". Check the request payload."; // Removed schema mention
        if (response.status === 403) errorMessage += ". Check API key permissions.";
        if (response.status === 429) errorMessage += ". Rate limit exceeded.";
        throw new Error(errorMessage);
    }

    const result = await response.json();
    // More robust checking for safety
    let jsonText = '';
    try {
        jsonText = result.candidates[0].content.parts[0].text;
    } catch (e) {
        console.error('[Debug] Error extracting text from Gemini response structure:', JSON.stringify(result, null, 2));
        throw new Error('Could not extract text from Gemini response. Structure might have changed or response was empty.');
    }

     console.log(`[Debug] analyzeImageWithGemini: Received text response from Gemini (expecting JSON).`);
    try {
        // Attempt to parse the text response as JSON
        return JSON.parse(jsonText);
    } catch (e) {
        console.error("[Debug] Failed to parse JSON response from Gemini:", jsonText);
        throw new Error("Gemini did not return valid JSON despite the prompt.");
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
