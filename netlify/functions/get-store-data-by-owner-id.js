// In netlify/functions/get-event-by-slug.js
const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

exports.handler = async (event) => {
    try {
        // --- TEMPORARY DIAGNOSTIC CODE ---
        // This will fetch ALL records from the Events table without a filter
        const eventUrl = `https://api.airtable.com/v0/${BASE_ID}/Events`;
        console.log('Fetching all records from:', eventUrl);

        const eventResponse = await fetch(eventUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const eventData = await eventResponse.json();

        if (!eventData.records || eventData.records.length === 0) {
            console.log('No records found in the Events table.');
            return { statusCode: 404, body: 'No records found in Events table.' };
        }

        // Log the fields of the very first record Airtable returns
        console.log('Airtable returned the following fields for the first record:', eventData.records[0].fields);

        // Return a success message so we can see the log
        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Diagnostic check complete. Please see function logs." }),
        };
        // --- END TEMPORARY CODE ---

    } catch (error) {
        console.error('Error during diagnostic check:', error);
        return { statusCode: 500, body: error.toString() };
    }
};
