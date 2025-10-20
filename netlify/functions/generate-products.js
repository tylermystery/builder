const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;
const Airtable = {
    IMAGE_GALLERY_TABLE: 'Image_Gallery',
    HISTORICAL_PRODUCTS_TABLE: 'Historical_Products',
};

exports.handler = async () => {
    // This is designed to be run as a scheduled function (cron job)

    try {
        // 1. Fetch all Image_Gallery records that DO NOT link to an active Item
        // Formula: {CatalogItemLink} = BLANK()
        const formula = "NOT({CatalogItemLink})";
        const url = `https://api.airtable.com/v0/${BASE_ID}/${Airtable.IMAGE_GALLERY_TABLE}?filterByFormula=${encodeURIComponent(formula)}`;
        
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const galleryData = await response.json();
        const unlinkedPhotos = galleryData.records || [];

        if (unlinkedPhotos.length === 0) {
            return { statusCode: 200, body: JSON.stringify({ message: 'No new historical products to generate.' }) };
        }

        // 2. Group photos by combination of AI tags
        const groups = {};
        unlinkedPhotos.forEach(photo => {
            const tags = photo.fields.GeneralTags || '';
            const groupKey = `${photo.fields.LocationTag}-${photo.fields.GroupSizeTag}-${tags.split(',')[0]}`;
            if (!groups[groupKey]) {
                groups[groupKey] = { photos: [], tags: tags };
            }
            groups[groupKey].photos.push(photo.id);
        });

        const newProductsToCreate = [];
        for (const key in groups) {
            const group = groups[key];
            if (group.photos.length >= 5) { // Only create a product if there are at least 5 photos
                const [location, size, theme] = key.split('-');
                const name = `Historical: ${theme} - ${size} ${location}`;
                const description = `This is an AI-generated product draft based on past activities matching the ${theme} theme, ideal for a ${size} group, and typically held ${location.toLowerCase()}.`;
                
                newProductsToCreate.push({
                    fields: {
                        Name: name,
                        Description: description,
                        Tags: group.tags,
                        MediaTags: group.photos, // Link to all grouped photos
                        Status: 'Draft - AI Generated',
                    }
                });
            }
        }

        // 3. Create records in Historical_Products table
        if (newProductsToCreate.length > 0) {
            const createRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${Airtable.HISTORICAL_PRODUCTS_TABLE}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: newProductsToCreate })
            });

            if (!createRes.ok) {
                console.error('Airtable Product Creation Error:', await createRes.json());
                throw new Error('Failed to create historical product drafts.');
            }
        }

        return { statusCode: 200, body: JSON.stringify({ message: `Generated ${newProductsToCreate.length} new historical product drafts.` }) };
    } catch (error) {
        console.error('Historical Product Generation failed:', error.message);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
