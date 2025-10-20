// REPLACE the entire contents of: netlify/functions/process-image-ai.js

const fetch = require('node-fetch');
// NOTE: We assume CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, and GEMINI_API_KEY
// are set as Netlify Environment Variables.
const { AIRTABLE_PAT, BASE_ID, GEMINI_API_KEY, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
const Airtable = {
    IMAGE_GALLERY_TABLE: 'Image_Gallery', // New table for all images
    ITEMS_TABLE: 'tblUA4uuS8IYlhKpD', // Existing Items table
    CURATED_IMAGES_FIELD_NAME: 'Curated Images', // The new linked field in Items
    IMAGE_TAGS_FIELD_NAME: 'Tags' // <-- NEW: The general tags column in Image_Gallery
};

// --- Cloudinary Helper ---
// REPLACE the getCloudinarySecureUrl function in: netlify/functions/process-image-ai.js

async function getCloudinarySecureUrl(publicId) {
    console.log(`[Debug] getCloudinarySecureUrl: Initiated for publicId: "${publicId}"`);

    // 1. Check if critical environment variables are loaded
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
        console.error("[Debug] CRITICAL: Cloudinary environment variables (CLOUD_NAME, API_KEY, or API_SECRET) are missing!");
        // We throw an error here to stop the function and make the problem clear
        throw new Error("Server configuration error: Missing Cloudinary credentials.");
    }
    
    // 2. Construct the URL and log it
    const auth = 'Basic ' + Buffer.from(CLOUDINARY_API_KEY + ':' + CLOUDINARY_API_SECRET).toString('base64');
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/resources/upload/${publicId}`;

    console.log(`[Debug] getCloudinarySecureUrl: Attempting to fetch URL: ${url}`);
    
    // 3. Make the request and log the immediate response status
    const response = await fetch(url, { headers: { 'Authorization': auth } });
    
    console.log(`[Debug] getCloudinarySecureUrl: Received status ${response.status} from Cloudinary.`);

    if (!response.ok) {
        // 4. If it fails, log the text body of the error from Cloudinary
        const errorBody = await response.text();
        console.error(`[Debug] getCloudinarySecureUrl: Cloudinary error response: ${errorBody}`);
        // This is the original error that the user sees in the browser
        throw new Error(`Cloudinary lookup failed for ${publicId}: ${response.status} ${response.statusText}`);
    }
    
    // 5. If successful, proceed as normal
    const data = await response.json();
    return data.secure_url;
}
// --- Gemini Call Helper ---
async function analyzeImageWithGemini(imageUrl) {
    const prompt = `Analyze this TMT event photo. You must identify the specific TMT catalog item shown, assess image quality, group size, and location. Respond ONLY with a valid JSON object. Do not include markdown code blocks (e.g., \`\`\`json).`;
    
    // Schema definition for structured output
    const responseSchema = {
        type: "OBJECT",
        properties: {
            "catalogItemName": { "type": "STRING", "description": "The name of the TMT catalog item in the image (e.g., Fort Battle). If unknown, use 'Historical Activity'." },
            "groupSizeTag": { "type": "STRING", "enum": ["Small", "Medium", "Large"], "description": "Group size in the photo: Small (1-10), Medium (11-25), Large (26+)." },
            "locationTag": { "type": "STRING", "enum": ["Indoor", "Outdoor", "Hybrid"], "description": "The primary setting of the event: Indoor, Outdoor, or Hybrid." },
            "qualityScore": { "type": "INTEGER", "description": "Rate image quality and brand fit on a scale of 1 to 10." },
            "imageTags": { "type": "STRING", "description": "A comma-separated list of 10 relevant visual keywords (e.g., laughter, blue sky, cannon, summer)." } // Aligned with the 'Tags' field data type
        },
        required: ["catalogItemName", "groupSizeTag", "locationTag", "qualityScore", "imageTags"],
        propertyOrdering: ["catalogItemName", "groupSizeTag", "locationTag", "qualityScore", "imageTags"]
    };

    const payload = {
        contents: [
            {
                role: "user",
                parts: [
                    { text: prompt },
                    // Fetch the image data inline for the API call
                    { inlineData: { mimeType: 'image/jpeg', data: Buffer.from(await (await fetch(imageUrl)).arrayBuffer()).toString('base64') } }
                ]
            }
        ],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema
        }
    };
    
    // Use the non-streaming Gemini endpoint
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${GEMINI_API_KEY}`;
    
    const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorBody = await response.json();
        console.error("Gemini API Error:", errorBody);
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
        if (!publicId) return { statusCode: 400, body: 'Missing publicId' };
        
        console.log(`Processing image: ${publicId}`);

        // 1. Fetch Cloudinary URL
        const imageUrl = await getCloudinarySecureUrl(publicId);

        // 2. Analyze with Gemini
        const aiData = await analyzeImageWithGemini(imageUrl);
        const isBestOf = aiData.qualityScore >= 9;

        // 3. Find existing Item Record
        const findItemUrl = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}?filterByFormula=({Name}='${aiData.catalogItemName}')&maxRecords=1`;
        const itemRes = await fetch(findItemUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const itemData = await itemRes.json();
        const catalogRecordId = itemData.records[0]?.id;

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
                    // Map the Gemini output field to the Airtable field name constant
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
            console.error('Airtable Error:', await createGalleryRes.json());
            throw new Error('Failed to create Image_Gallery record.');
        }
        
        // IMPORTANT: We need to parse the response to get the newly created record ID
        const createGalleryResponseData = await createGalleryRes.json();
        const newGalleryRecordId = createGalleryResponseData.records[0].id;

        // 5. Update the parent Item record to link to this new Image_Gallery record (Curated Images field)
        if (catalogRecordId) {
            // Fetch existing links to avoid overwriting them
            const existingItemRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}/${catalogRecordId}?fields[]=${encodeURIComponent(Airtable.CURATED_IMAGES_FIELD_NAME)}`, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            const existingItem = await existingItemRes.json();
            const existingLinks = existingItem.fields[Airtable.CURATED_IMAGES_FIELD_NAME] || [];

            const updateItemPayload = {
                fields: {
                    // Append the new gallery record ID to the existing array of links
                    [Airtable.CURATED_IMAGES_FIELD_NAME]: [...existingLinks, newGalleryRecordId]
                }
            };
            
            const updateItemRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${Airtable.ITEMS_TABLE}/${catalogRecordId}`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${PERSONAL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(updateItemPayload)
            });

            if (!updateItemRes.ok) {
                 console.error('Airtable Link Update Error:', await updateItemRes.json());
                 // Log error but continue, as the image record itself was created
            }
        }


        return { statusCode: 200, body: JSON.stringify({ message: 'Image processed and tagged successfully.', publicId }) };

    } catch (error) {
        console.error('AI Processing Error:', error.message);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
