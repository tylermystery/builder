/*
 * Version: 1.0.0
 * Last Modified: 2025-08-26
 *
 * Changelog:
 *
 * v1.0.0 - 2025-08-26
 * - Initial version. Fetches and parses a remote iCal feed.
 */

const fetch = require('node-fetch');

// A simple, dependency-free iCal parser.
function parseICal(icalData) {
    const events = [];
    const eventBlocks = icalData.split('BEGIN:VEVENT');
    eventBlocks.shift(); // Remove the header

    eventBlocks.forEach(block => {
        const startMatch = block.match(/DTSTART(?:;[^:]+)?:([0-9T]+)/);
        const endMatch = block.match(/DTEND(?:;[^:]+)?:([0-9T]+)/);

        if (startMatch && endMatch) {
            events.push({
                start: startMatch[1],
                end: endMatch[1]
            });
        }
    });
    return events;
}

exports.handler = async function (event, context) {
    // This URL can be replaced with your actual private iCal feed.
    const ICAL_URL = 'https://www.thunderbird.net/media/caldata/USHolidays.ics';

    try {
        const response = await fetch(ICAL_URL);
        if (!response.ok) {
            throw new Error(`Failed to fetch iCal feed with status: ${response.statusText}`);
        }
        const icalData = await response.text();
        const busyTimes = parseICal(icalData);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(busyTimes),
        };
    } catch (error) {
        console.error('iCal fetch/parse error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process calendar data.' }),
        };
    }
};
