// netlify/functions/calendar.js
const ical = require('node-ical');

exports.handler = async function (event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { calendarUrl } = JSON.parse(event.body);
        if (!calendarUrl) {
            return { statusCode: 400, body: 'Missing calendarUrl' };
        }

        const events = await ical.async.fromURL(calendarUrl);
        const busySlots = [];
        for (const key in events) {
            if (events[key].type === 'VEVENT') {
                busySlots.push({
                    start: events[key].start,
                    end: events[key].end
                });
            }
        }
        return { statusCode: 200, body: JSON.stringify(busySlots) };

    } catch (error) {
        console.error('Error parsing iCal feed:', error);
        return { statusCode: 500, body: 'Error parsing iCal feed.' };
    }
};
