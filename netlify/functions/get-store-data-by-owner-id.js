// In netlify/functions/get-store-data-by-owner-id.js
const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

exports.handler = async (event) => {
    console.log('[Dashboard Function] Invoked.'); // <-- ADD THIS
    const { id } = event.queryStringParameters;
    console.log(`[Dashboard Function] Searching for OwnerDashboardID: ${id}`); // <-- ADD THIS

    if (!id) {
        return { statusCode: 400, body: 'Missing owner dashboard ID.' };
    }

    try {
        const storeFormula = `({OwnerDashboardID} = '${id}')`;
        const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/Stores?filterByFormula=${encodeURIComponent(storeFormula)}`;
        console.log(`[Dashboard Function] Querying Airtable with URL: ${storeUrl}`); // <-- ADD THIS

        const storeResponse = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const storeData = await storeResponse.json();

        console.log(`[Dashboard Function] Airtable response received. Found ${storeData.records?.length || 0} records.`); // <-- ADD THIS

        if (!storeData.records || storeData.records.length === 0) {
            return { statusCode: 404, body: 'Store not found.' };
        }

        const storeRecord = storeData.records[0];
        const storeId = storeRecord.id;

        // 2. Find all items linked to that store's record ID
        const itemsFormula = `SEARCH('${storeId}', ARRAYJOIN({Stores}))`;
        const itemsUrl = `https://api.airtable.com/v0/${BASE_ID}/tblUA4uuS8IYlhKpD?filterByFormula=${encodeURIComponent(itemsFormula)}`;
        const itemsResponse = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const itemsData = await itemsResponse.json();

        // 3. Return all the data together
        return {
            statusCode: 200,
            body: JSON.stringify({
                store: storeRecord,
                items: itemsData.records
            }),
        };
    } catch (error) {
        return { statusCode: 500, body: error.toString() };
    }
};
