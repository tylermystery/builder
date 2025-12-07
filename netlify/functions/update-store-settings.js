// In: netlify/functions/update-store-settings.js
// Purpose: Update store settings in Airtable

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const STORES_TABLE = 'Stores';

// Define which fields are allowed to be updated via this endpoint
const ALLOWED_FIELDS = [
    'Name',
    'Shop Title',
    'Description',
    'LogoTag',
    'ShopType',
    'EnabledFilters',
    'PaymentOptions',
    'TermsAndConditions',
    'CartLabels',
    'Marquee Text',
    'DefaultStatusFilter'
];

exports.handler = async (event) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed. Use POST.' })
        };
    }

    try {
        const { ownerDashboardId, settings } = JSON.parse(event.body);

        if (!ownerDashboardId) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing ownerDashboardId.' })
            };
        }

        if (!settings || typeof settings !== 'object') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Missing or invalid settings object.' })
            };
        }

        // 1. Find the Store record using the OwnerDashboardID to verify ownership
        const storeFormula = `({OwnerDashboardID} = '${ownerDashboardId}')`;
        const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE}?filterByFormula=${encodeURIComponent(storeFormula)}`;

        const storeResponse = await fetch(storeUrl, {
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
        });
        const storeData = await storeResponse.json();

        if (!storeData.records || storeData.records.length === 0) {
            return {
                statusCode: 404,
                body: JSON.stringify({ error: 'Store not found for this dashboard ID.' })
            };
        }

        const storeRecord = storeData.records[0];
        const storeId = storeRecord.id;

        // 2. Filter settings to only allowed fields
        const filteredSettings = {};
        for (const [key, value] of Object.entries(settings)) {
            if (ALLOWED_FIELDS.includes(key)) {
                filteredSettings[key] = value;
            } else {
                console.warn(`Ignoring non-allowed field: ${key}`);
            }
        }

        if (Object.keys(filteredSettings).length === 0) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'No valid settings provided to update.' })
            };
        }

        // 3. Update the store record in Airtable
        const updateUrl = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE}/${storeId}`;
        const updateResponse = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${AIRTABLE_PAT}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                fields: filteredSettings
            })
        });

        if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            console.error('Airtable update error:', errorData);
            return {
                statusCode: 500,
                body: JSON.stringify({ error: 'Failed to update store settings in Airtable.' })
            };
        }

        const updatedRecord = await updateResponse.json();

        // 4. Return success with updated record
        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                message: 'Store settings updated successfully.',
                store: updatedRecord
            })
        };

    } catch (error) {
        console.error('Error in update-store-settings:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
