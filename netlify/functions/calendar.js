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

    const decodedUrl = decodeURIComponent(url);
    console.log(`[CAL-DEBUG] Request for iCal URL: ${decodedUrl}`);

    try {
        const response = await fetch(decodedUrl);
        console.log(`[CAL-DEBUG] Fetch status: ${response.status}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch iCal feed: ${response.statusText}`);
        }
        const icalData = await response.text();
        console.log(`[CAL-DEBUG] Raw data: ${icalData.length} chars`);

        const now = new Date();
        const windowStart = new Date(now);
        windowStart.setMonth(windowStart.getMonth() - 3);
        const windowEnd = new Date(now);
        windowEnd.setFullYear(windowEnd.getFullYear() + 2);
        console.log(`[CAL-DEBUG] Window: ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);

        const rawBlocks = extractAllVEventBlocks(icalData);
        console.log(`[CAL-DEBUG] Raw VEVENT blocks found: ${rawBlocks.length}`);

        const parsed = ical.sync.parseICS(icalData);
        const nodeIcalVevents = Object.keys(parsed).filter(k => parsed[k].type === 'VEVENT');
        console.log(`[CAL-DEBUG] node-ical returned ${nodeIcalVevents.length} VEVENTs (UID-merged)`);

        const busyTimes = [];
        const overrideDates = new Set();

        let rawOccurrenceCount = 0;
        let rruleExpandedCount = 0;
        let singleEventCount = 0;

        for (const block of rawBlocks) {
            const hasRecurrenceId = block.recurrenceId !== null;
            if (hasRecurrenceId) {
                const start = block.start;
                const end = block.end || new Date(start.getTime() + (block.isDateOnly ? 24 * 60 * 60 * 1000 : 0));
                if (end >= windowStart && start <= windowEnd) {
                    busyTimes.push({ start: start.toISOString(), end: end.toISOString() });
                    rawOccurrenceCount++;
                }
                overrideDates.add(start.toISOString().slice(0, 10));
            }
        }
        console.log(`[CAL-DEBUG] RECURRENCE-ID occurrences added: ${rawOccurrenceCount}, override dates: ${overrideDates.size}`);

        for (const key of nodeIcalVevents) {
            const ev = parsed[key];
            if (!ev.start) continue;

            const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
            if (isNaN(start.getTime())) continue;

            const end = getEventEnd(ev, start);

            if (ev.rrule) {
                const duration = end.getTime() - start.getTime();
                try {
                    let occurrences = ev.rrule.between(windowStart, windowEnd, true);
                    if (occurrences.length === 0) {
                        try {
                            const allOcc = ev.rrule.all((_, i) => i < 500);
                            occurrences = allOcc.filter(o => o >= windowStart && o <= windowEnd);
                        } catch (e) { /* fallback failed */ }
                    }
                    for (const occ of occurrences) {
                        const dateKey = occ.toISOString().slice(0, 10);
                        if (!overrideDates.has(dateKey)) {
                            busyTimes.push({
                                start: occ.toISOString(),
                                end: new Date(occ.getTime() + duration).toISOString(),
                            });
                            rruleExpandedCount++;
                        }
                    }
                } catch (rruleErr) {
                    console.warn(`[CAL-DEBUG] RRULE expansion failed for "${ev.summary}": ${rruleErr.message}`);
                    addIfInWindow(busyTimes, start, end, windowStart, windowEnd);
                }
            } else {
                if (addIfInWindow(busyTimes, start, end, windowStart, windowEnd)) {
                    singleEventCount++;
                }
            }
        }

        const seen = new Set();
        const dedupedBusyTimes = busyTimes.filter(bt => {
            const key = bt.start + '|' + bt.end;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        console.log(`[CAL-DEBUG] Summary: ${dedupedBusyTimes.length} busy times after dedup (raw: ${rawOccurrenceCount}, rrule: ${rruleExpandedCount}, single: ${singleEventCount}, dupes removed: ${busyTimes.length - dedupedBusyTimes.length})`);
        console.log(`[CAL-DEBUG] ALL busy times: ${JSON.stringify(dedupedBusyTimes)}`);

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dedupedBusyTimes),
        };
    } catch (error) {
        console.error('[CAL-DEBUG] iCal fetch/parse error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process calendar data.' }),
        };
    }
};

function extractAllVEventBlocks(icalText) {
    const blocks = [];
    const veventRegex = /BEGIN:VEVENT([\s\S]*?)END:VEVENT/g;
    let match;
    while ((match = veventRegex.exec(icalText)) !== null) {
        const body = match[1];
        const start = parseICalDate(getICalProp(body, 'DTSTART'));
        if (!start) continue;

        const endRaw = getICalProp(body, 'DTEND');
        const end = endRaw ? parseICalDate(endRaw) : null;
        const recurrenceId = getICalProp(body, 'RECURRENCE-ID');
        const summary = getICalPropValue(body, 'SUMMARY');
        const isDateOnly = getICalPropRaw(body, 'DTSTART').indexOf('VALUE=DATE') !== -1 &&
                           getICalPropRaw(body, 'DTSTART').indexOf('VALUE=DATE-TIME') === -1;

        blocks.push({ start, end, recurrenceId, summary, isDateOnly });
    }
    return blocks;
}

function getICalPropRaw(body, propName) {
    const regex = new RegExp(`(?:^|\\n)(${propName}[^:]*:[^\\n]*)`, 'm');
    const m = body.match(regex);
    return m ? m[1] : '';
}

function getICalProp(body, propName) {
    const raw = getICalPropRaw(body, propName);
    if (!raw) return null;
    const colonIdx = raw.indexOf(':');
    return colonIdx >= 0 ? raw.slice(colonIdx + 1).trim() : null;
}

function getICalPropValue(body, propName) {
    const raw = getICalPropRaw(body, propName);
    if (!raw) return null;
    const colonIdx = raw.indexOf(':');
    return colonIdx >= 0 ? raw.slice(colonIdx + 1).trim() : raw.trim();
}

function parseICalDate(dateStr) {
    if (!dateStr) return null;
    dateStr = dateStr.trim();
    if (/^\d{8}$/.test(dateStr)) {
        return new Date(Date.UTC(
            parseInt(dateStr.slice(0, 4)),
            parseInt(dateStr.slice(4, 6)) - 1,
            parseInt(dateStr.slice(6, 8))
        ));
    }
    if (/^\d{8}T\d{6}Z?$/.test(dateStr)) {
        const y = parseInt(dateStr.slice(0, 4));
        const mo = parseInt(dateStr.slice(4, 6)) - 1;
        const d = parseInt(dateStr.slice(6, 8));
        const h = parseInt(dateStr.slice(9, 11));
        const mi = parseInt(dateStr.slice(11, 13));
        const s = parseInt(dateStr.slice(13, 15));
        if (dateStr.endsWith('Z')) {
            return new Date(Date.UTC(y, mo, d, h, mi, s));
        }
        return new Date(Date.UTC(y, mo, d, h, mi, s));
    }
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

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
    if (ev.start && ev.start.dateOnly) {
        return new Date(start.getTime() + 24 * 60 * 60 * 1000);
    }
    return new Date(start.getTime());
}

function addIfInWindow(busyTimes, start, end, windowStart, windowEnd) {
    if (end >= windowStart && start <= windowEnd) {
        busyTimes.push({ start: start.toISOString(), end: end.toISOString() });
        return true;
    }
    return false;
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
