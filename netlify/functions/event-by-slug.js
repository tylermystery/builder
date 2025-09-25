// In netlify/functions/get-event-by-slug.js
const fetch = require('node-fetch');
const { AIRTABLE_PAT, BASE_ID } = process.env;

exports.handler = async (event) => {
    const { slug } = event.queryStringParameters;
    if (!slug) {
        return { statusCode: 400, body: 'Missing event slug.' };
    }

    try {
        // 1. Find the Event record using the slug
        const eventFormula = `({Event Slug} = '${slug}')`;
        const eventUrl = `https://api.airtable.com/v0/${BASE_ID}/Events?filterByFormula=${encodeURIComponent(eventFormula)}`;
        const eventResponse = await fetch(eventUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        const eventData = await eventResponse.json();

        if (!eventData.records || eventData.records.length === 0) {
            return { statusCode: 404, body: 'Event not found.' };
        }
        const eventRecord = eventData.records[0];
        const sessionId = eventRecord.fields.Session[0];

        // 2. Fetch the linked Session record
        const sessionUrl = `https://api.airtable.com/v0/${BASE_ID}/Sessions/${sessionId}`;
        const sessionResponse = await fetch(sessionUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
        if (!sessionResponse.ok) {
            throw new Error('Could not fetch the linked session data.');
        }
        const sessionRecord = await sessionResponse.json();

        // 3. Return all the data together
        return {
            statusCode: 200,
            body: JSON.stringify({
                event: eventRecord,
                session: sessionRecord
            }),
        };
    } catch (error) {
        return { statusCode: 500, body: error.toString() };
    }
};
