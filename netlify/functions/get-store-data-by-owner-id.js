// In netlify/functions/get-store-data-by-owner-id.js
const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

exports.handler = async (event) => {
    console.log('[Dashboard Function] RUNNING IN DEBUG MODE: Fetching all stores.');

    try {
        // Temporarily remove the filter to fetch all records from the Stores table
        const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/Stores`;
        console.log(`[Dashboard Function] Querying Airtable with URL: ${storeUrl}`);

        const storeResponse = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const storeData = await storeResponse.json();

        // Log the data we get back from Airtable
        if (storeData.records && storeData.records.length > 0) {
            console.log(`[Dashboard Function] Successfully fetched ${storeData.records.length} records. Here they are:`);
            storeData.records.forEach(record => {
                console.log(`- Name: "${record.fields.Name}", OwnerDashboardID: "${record.fields.OwnerDashboardID}"`);
            });
        } else {
            console.log('[Dashboard Function] Airtable returned 0 records even without a filter.');
            console.log('[Dashboard Function] Raw Airtable Response:', JSON.stringify(storeData, null, 2));
        }

        // The function will stop here for the test.
        return { statusCode: 200, body: 'Debug test complete. Check function logs.' };

    } catch (error) {
        console.error('[Dashboard Function] An error occurred during the debug test:', error);
        return { statusCode: 500, body: error.toString() };
    }
};
