// In: netlify/functions/get-store-data-by-owner-id.js
// Action: REPLACE THE ENTIRE FILE with this code.

const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

const STORES_TABLE = 'Stores';
const ITEMS_TABLE = 'tblUA4uuS8IYlhKpD';

exports.handler = async (event) => {
    const { id } = event.queryStringParameters;
    if (!id) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing dashboard ID.' }) };
    }

    try {
        // 1. Find the Store record using the OwnerDashboardID
        const storeFormula = `({OwnerDashboardID} = '${id}')`;
        const storeUrl = `https://api.airtable.com/v0/${BASE_ID}/${STORES_TABLE}?filterByFormula=${encodeURIComponent(storeFormula)}`;
        
        const storeResponse = await fetch(storeUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const storeData = await storeResponse.json();

        if (!storeData.records || storeData.records.length === 0) {
            return { statusCode: 404, body: JSON.stringify({ error: 'Store not found for this ID.' }) };
        }
        
        const storeRecord = storeData.records[0];
        const itemIds = storeRecord.fields.Items || [];

        let itemRecords = [];
        // 2. If the store has items, fetch them
        if (itemIds.length > 0) {
            const itemsFormula = `OR(${itemIds.map(itemId => `RECORD_ID()='${itemId}'`).join(',')})`;
            const itemsUrl = `https://api.airtable.com/v0/${BASE_ID}/${ITEMS_TABLE}?filterByFormula=${encodeURIComponent(itemsFormula)}`;
            
            const itemsResponse = await fetch(itemsUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            if (itemsResponse.ok) {
                const itemsData = await itemsResponse.json();
                itemRecords = itemsData.records;
            } else {
                console.warn(`Could not fetch items for store ${storeRecord.id}`);
            }
        }

        // 3. Return all the data together
        return {
            statusCode: 200,
            body: JSON.stringify({
                store: storeRecord,
                items: itemRecords
            }),
        };
    } catch (error) {
        console.error('Error in get-store-data-by-owner-id:', error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};
