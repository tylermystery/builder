const fetch = require('node-fetch');
const ical = require('node-ical');

exports.handler = async function (event, context) {
    const { url } = event.queryStringParameters;

    if (!url) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing "url" query parameter.' }),
        };
    }

    try {
        const response = await fetch(decodeURIComponent(url));
        if (!response.ok) {
            throw new Error(`Failed to fetch iCal feed: ${response.statusText}`);
        }
        const icalData = await response.text();

        const parsed = ical.sync.parseICS(icalData);
        const busyTimes = [];
        const now = new Date();
        const windowStart = new Date(now);
        windowStart.setMonth(windowStart.getMonth() - 3);
        const windowEnd = new Date(now);
        windowEnd.setFullYear(windowEnd.getFullYear() + 2);

        for (const key of Object.keys(parsed)) {
            const ev = parsed[key];
            if (ev.type !== 'VEVENT') continue;
            if (!ev.start) continue;

            const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
            if (isNaN(start.getTime())) continue;

            const end = getEventEnd(ev, start);

            if (ev.rrule) {
                const duration = end.getTime() - start.getTime();
                try {
                    const occurrences = ev.rrule.between(windowStart, windowEnd, true);
                    for (const occ of occurrences) {
                        busyTimes.push({
                            start: occ.toISOString(),
                            end: new Date(occ.getTime() + duration).toISOString(),
                        });
                    }
                } catch (rruleErr) {
                    console.warn(`[CAL-DEBUG] RRULE expansion failed for "${ev.summary}":`, rruleErr.message);
                    addIfInWindow(busyTimes, start, end, windowStart, windowEnd);
                }
            } else {
                addIfInWindow(busyTimes, start, end, windowStart, windowEnd);
            }
        }

        console.log(`[CAL-DEBUG] Total events (with RRULE expansion): ${busyTimes.length}`);

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

function getEventEnd(ev, start) {
    if (ev.end) {
        const end = ev.end instanceof Date ? ev.end : new Date(ev.end);
        if (!isNaN(end.getTime())) return end;
    }
    if (ev.duration) {
        const ms = typeof ev.duration === 'number'
            ? ev.duration
            : parseDurationToMs(ev.duration);
        if (ms > 0) return new Date(start.getTime() + ms);
    }
    return new Date(start.getTime());
}

function addIfInWindow(busyTimes, start, end, windowStart, windowEnd) {
    if (end >= windowStart && start <= windowEnd) {
        busyTimes.push({ start: start.toISOString(), end: end.toISOString() });
    }
}

function parseDurationToMs(dur) {
    if (!dur) return 0;
    if (typeof dur === 'number') return dur;
    if (typeof dur === 'object') {
        let ms = 0;
        if (dur.weeks) ms += dur.weeks * 7 * 24 * 60 * 60 * 1000;
        if (dur.days) ms += dur.days * 24 * 60 * 60 * 1000;
        if (dur.hours) ms += dur.hours * 60 * 60 * 1000;
        if (dur.minutes) ms += dur.minutes * 60 * 1000;
        if (dur.seconds) ms += dur.seconds * 1000;
        return ms;
    }
    if (typeof dur !== 'string') return 0;
    let ms = 0;
    const w = dur.match(/(\d+)W/); if (w) ms += parseInt(w[1]) * 7 * 24 * 60 * 60 * 1000;
    const d = dur.match(/(\d+)D/); if (d) ms += parseInt(d[1]) * 24 * 60 * 60 * 1000;
    const h = dur.match(/(\d+)H/); if (h) ms += parseInt(h[1]) * 60 * 60 * 1000;
    const m = dur.match(/(\d+)M/); if (m) ms += parseInt(m[1]) * 60 * 1000;
    const s = dur.match(/(\d+)S/); if (s) ms += parseInt(s[1]) * 1000;
    return ms;
}
