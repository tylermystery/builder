const fetch = require('node-fetch');
require('temporal-polyfill/global');
const { RRuleTemporal } = require('rrule-temporal');

exports.handler = async function (event) {
    const { url, debug } = event.queryStringParameters;
    const debugMode = debug === '1' || debug === 'true';

    if (!url) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Missing "url" query parameter.' }),
        };
    }

    const decodedUrl = decodeURIComponent(url);
    console.log(`[CAL] Fetching: ${decodedUrl}`);

    try {
        const response = await fetch(decodedUrl);
        if (!response.ok) {
            throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
        }
        const rawText = await response.text();
        console.log(`[CAL] Received ${rawText.length} chars`);

        const now = new Date();
        const windowStart = new Date(now);
        windowStart.setMonth(windowStart.getMonth() - 3);
        const windowEnd = new Date(now);
        windowEnd.setFullYear(windowEnd.getFullYear() + 2);

        const { busyTimes, meta } = parseICalFeed(rawText, windowStart, windowEnd);

        console.log(`[CAL] Returning ${busyTimes.length} busy times`);
        if (busyTimes.length <= 100) {
            console.log(`[CAL] All busy times: ${JSON.stringify(busyTimes)}`);
        } else {
            console.log(`[CAL] First 20: ${JSON.stringify(busyTimes.slice(0, 20))}`);
        }

        // Default contract is unchanged: a plain array of busy times. When the
        // caller opts in with ?debug=1, return the same busy times alongside a
        // `meta` object describing exactly how every VEVENT was classified, so
        // the diagnosis (parsed / dropped / out-of-window) is visible wherever
        // the response is inspected — including the browser console.
        const payload = debugMode ? { busyTimes, meta } : busyTimes;

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        };
    } catch (error) {
        console.error('[CAL] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process calendar data.' }),
        };
    }
};

/**
 * Parse an iCal feed and return busy times within the given window.
 * Completely self-contained — no dependency on node-ical.
 */
function parseICalFeed(rawText, windowStart, windowEnd) {
    const text = unfold(rawText);

    const vevents = extractBlocks(text, 'VEVENT');
    console.log(`[CAL] Found ${vevents.length} VEVENT blocks`);

    // Parse every VEVENT, keeping an explicit account of any that are dropped so
    // a silently-discarded event always leaves a visible trace in the logs.
    const parsed = [];
    const dropped = [];
    for (const body of vevents) {
        const ev = parseVEvent(body);
        if (ev) {
            parsed.push(ev);
        } else {
            dropped.push(summarizeVEvent(body));
        }
    }
    if (dropped.length) {
        console.warn(`[CAL] DROPPED ${dropped.length} of ${vevents.length} VEVENT(s) — could not parse:`);
        dropped.forEach((d, i) => console.warn(`[CAL]   dropped[${i}] ${d}`));
    }

    const byUid = new Map();
    const standalone = [];
    let counts = { recurring: 0, override: 0, standalone: 0, dropped: dropped.length };

    for (const ev of parsed) {
        if (ev.recurrenceId) {
            counts.override++;
            const list = byUid.get(ev.uid) || { base: null, overrides: [] };
            list.overrides.push(ev);
            byUid.set(ev.uid, list);
        } else if (ev.rruleText) {
            counts.recurring++;
            const list = byUid.get(ev.uid) || { base: null, overrides: [] };
            list.base = ev;
            byUid.set(ev.uid, list);
        } else {
            counts.standalone++;
            standalone.push(ev);
        }
    }
    console.log(`[CAL] Classified: ${JSON.stringify(counts)}`);

    const busyTimes = [];

    // Process standalone events
    const standaloneIncluded = [];
    const standaloneOutOfWindowList = [];
    let standaloneOutOfWindow = 0;
    for (const ev of standalone) {
        const start = ev.startUTC;
        const end = ev.endUTC;
        if (end >= windowStart && start <= windowEnd) {
            busyTimes.push({ start: start.toISOString(), end: end.toISOString() });
            standaloneIncluded.push({ summary: ev.summary, start: start.toISOString(), end: end.toISOString() });
            console.log(`[CAL] Standalone: "${ev.summary}" ${start.toISOString()} -> ${end.toISOString()}`);
        } else {
            standaloneOutOfWindow++;
            standaloneOutOfWindowList.push({ summary: ev.summary, start: start.toISOString(), end: end.toISOString() });
            console.log(`[CAL] Standalone OUT OF WINDOW: "${ev.summary}" ${start.toISOString()} -> ${end.toISOString()} (window ${windowStart.toISOString()} .. ${windowEnd.toISOString()})`);
        }
    }
    if (standaloneOutOfWindow) {
        console.log(`[CAL] ${standaloneOutOfWindow} standalone event(s) excluded by the look-back/look-ahead window`);
    }

    // Process recurring events
    for (const [uid, group] of byUid) {
        const base = group.base;
        const overrides = group.overrides;

        // Dates overridden by RECURRENCE-ID (keyed by date string for matching)
        const overrideDateKeys = new Set();

        // Add override events
        for (const ov of overrides) {
            const start = ov.startUTC;
            const end = ov.endUTC;
            if (end >= windowStart && start <= windowEnd) {
                busyTimes.push({ start: start.toISOString(), end: end.toISOString() });
            }
            if (ov.recurrenceIdUTC) {
                overrideDateKeys.add(ov.recurrenceIdUTC.toISOString().slice(0, 10));
            }
        }

        if (!base) {
            // Only overrides exist for this UID (orphaned overrides — unusual but handle it)
            continue;
        }

        // Expand RRULE
        const duration = base.endUTC.getTime() - base.startUTC.getTime();
        const exdateKeys = new Set((base.exdates || []).map(d => d.toISOString().slice(0, 10)));

        const occurrences = expandRRule(base.rruleText, base.startUTC, base.tzid, windowStart, windowEnd);

        let rruleCount = 0;
        for (const occ of occurrences) {
            const dateKey = occ.toISOString().slice(0, 10);
            if (overrideDateKeys.has(dateKey) || exdateKeys.has(dateKey)) continue;
            const occEnd = new Date(occ.getTime() + duration);
            if (occEnd >= windowStart && occ <= windowEnd) {
                busyTimes.push({ start: occ.toISOString(), end: occEnd.toISOString() });
                rruleCount++;
            }
        }
        console.log(`[CAL] Recurring "${base.summary}" (${uid}): ${rruleCount} occurrences from RRULE, ${overrides.length} overrides, ${exdateKeys.size} exdates`);
    }

    // Deduplicate
    const seen = new Set();
    const deduped = busyTimes.filter(bt => {
        const key = bt.start + '|' + bt.end;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    console.log(`[CAL] Total: ${deduped.length} busy times (${busyTimes.length - deduped.length} dupes removed)`);

    const meta = {
        veventBlocks: vevents.length,
        counts,
        window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
        standaloneIncluded,
        standaloneOutOfWindow: standaloneOutOfWindowList,
        dropped,
        totalBusyTimes: deduped.length,
    };

    return { busyTimes: deduped, meta };
}

// ---- iCal text processing ----

/** RFC 5545 Section 3.1: unfold long content lines (CRLF + whitespace → nothing) */
function unfold(text) {
    return text.replace(/\r?\n[ \t]/g, '');
}

/** Extract all blocks of a given type (e.g. VEVENT, VTIMEZONE) */
function extractBlocks(text, type) {
    const blocks = [];
    const regex = new RegExp(`BEGIN:${type}\\r?\\n([\\s\\S]*?)END:${type}`, 'g');
    let m;
    while ((m = regex.exec(text)) !== null) {
        blocks.push(m[1]);
    }
    return blocks;
}

// ---- VEVENT parsing ----

/**
 * Build a short human-readable description of a VEVENT for diagnostic logging.
 * Used when an event is dropped, so the offending raw values are never invisible.
 */
function summarizeVEvent(body) {
    const summary = getPropValue(body, 'SUMMARY') || '(no summary)';
    const dtstart = getPropFull(body, 'DTSTART');
    const dtstartDesc = dtstart
        ? `DTSTART${dtstart.params}:${dtstart.value}`
        : 'MISSING DTSTART';
    const rrule = getPropValue(body, 'RRULE');
    return `"${summary}" [${dtstartDesc}]${rrule ? ' (recurring)' : ' (single)'}`;
}

function parseVEvent(body) {
    const dtstartRaw = getPropFull(body, 'DTSTART');
    if (!dtstartRaw) return null;

    const dtendRaw = getPropFull(body, 'DTEND');
    const durationRaw = getPropValue(body, 'DURATION');
    const rruleText = getPropValue(body, 'RRULE');
    const recurrenceIdRaw = getPropFull(body, 'RECURRENCE-ID');
    const uid = getPropValue(body, 'UID') || '';
    const summary = getPropValue(body, 'SUMMARY') || '';
    const exdateLines = getAllPropFull(body, 'EXDATE');

    const isDateOnly = hasParam(dtstartRaw.params, 'VALUE', 'DATE') &&
                       !hasParam(dtstartRaw.params, 'VALUE', 'DATE-TIME');
    const tzid = getParamValue(dtstartRaw.params, 'TZID');

    const startUTC = toUTC(dtstartRaw.value, tzid, isDateOnly);
    if (!startUTC) {
        console.log(`[CAL] SKIP: unparseable DTSTART for "${summary}": raw="${dtstartRaw.value}" tzid="${tzid}"`);
        return null;
    }

    let endUTC;
    if (dtendRaw) {
        const endTzid = getParamValue(dtendRaw.params, 'TZID') || tzid;
        const endDateOnly = hasParam(dtendRaw.params, 'VALUE', 'DATE') &&
                            !hasParam(dtendRaw.params, 'VALUE', 'DATE-TIME');
        endUTC = toUTC(dtendRaw.value, endTzid, endDateOnly);
    }
    if (!endUTC && durationRaw) {
        endUTC = new Date(startUTC.getTime() + parseDuration(durationRaw));
    }
    if (!endUTC) {
        endUTC = isDateOnly
            ? new Date(startUTC.getTime() + 24 * 60 * 60 * 1000)
            : new Date(startUTC.getTime());
    }

    let recurrenceIdUTC = null;
    if (recurrenceIdRaw) {
        const ridTzid = getParamValue(recurrenceIdRaw.params, 'TZID') || tzid;
        const ridDateOnly = hasParam(recurrenceIdRaw.params, 'VALUE', 'DATE');
        recurrenceIdUTC = toUTC(recurrenceIdRaw.value, ridTzid, ridDateOnly);
    }

    // Parse EXDATE values
    const exdates = [];
    for (const ex of exdateLines) {
        const exTzid = getParamValue(ex.params, 'TZID') || tzid;
        const exDateOnly = hasParam(ex.params, 'VALUE', 'DATE');
        for (const val of ex.value.split(',')) {
            const d = toUTC(val.trim(), exTzid, exDateOnly);
            if (d) exdates.push(d);
        }
    }

    return {
        uid,
        summary,
        startUTC,
        endUTC,
        isDateOnly,
        tzid,
        rruleText: rruleText || null,
        recurrenceId: recurrenceIdRaw ? recurrenceIdRaw.value : null,
        recurrenceIdUTC,
        exdates,
    };
}

// ---- Property extraction ----

/** Get a single property's full info: { params, value } */
function getPropFull(body, name) {
    const regex = new RegExp(`(?:^|\\n)(${name}(?:;[^:]*)?):(.*)`, 'm');
    const m = body.match(regex);
    if (!m) return null;
    return { params: m[1].slice(name.length), value: m[2].trim() };
}

/** Get just the value of a property */
function getPropValue(body, name) {
    const full = getPropFull(body, name);
    return full ? full.value : null;
}

/** Get ALL instances of a property (e.g. multiple EXDATE lines) */
function getAllPropFull(body, name) {
    const results = [];
    const regex = new RegExp(`(?:^|\\n)(${name}(?:;[^:]*)?):(.*)`, 'gm');
    let m;
    while ((m = regex.exec(body)) !== null) {
        results.push({ params: m[1].slice(name.length), value: m[2].trim() });
    }
    return results;
}

function hasParam(paramsStr, paramName, paramValue) {
    if (!paramsStr) return false;
    const regex = new RegExp(`${paramName}=${paramValue}(?:;|$)`, 'i');
    return regex.test(paramsStr);
}

function getParamValue(paramsStr, paramName) {
    if (!paramsStr) return null;
    const regex = new RegExp(`${paramName}=([^;]+)`, 'i');
    const m = paramsStr.match(regex);
    return m ? m[1].trim() : null;
}

// ---- Date/time conversion ----

/** Parse an iCal date/time value and convert to a JS Date in UTC */
function toUTC(dateStr, tzid, isDateOnly) {
    if (!dateStr) return null;
    dateStr = dateStr.trim();

    // VALUE=DATE: 20260704
    if (/^\d{8}$/.test(dateStr)) {
        return new Date(Date.UTC(
            parseInt(dateStr.slice(0, 4)),
            parseInt(dateStr.slice(4, 6)) - 1,
            parseInt(dateStr.slice(6, 8))
        ));
    }

    // DateTime: 20260725T100000 or 20260725T100000Z (seconds optional, e.g. 20260725T1000)
    const dtMatch = dateStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
    if (dtMatch) {
        const [, y, mo, d, h, mi, s, z] = dtMatch;
        const sec = s ? +s : 0;
        if (z) {
            // Explicit UTC
            return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, sec));
        }
        if (tzid) {
            // Convert from local timezone to UTC
            return tzToUTC(`${y}-${mo}-${d}T${h}:${mi}:${String(sec).padStart(2, '0')}`, tzid);
        }
        // No timezone specified — treat as UTC (common for floating times)
        return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, sec));
    }

    // Date with separators, e.g. 2026-07-25 (some non-conformant feeds emit these)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [y, mo, d] = dateStr.split('-');
        return new Date(Date.UTC(+y, +mo - 1, +d));
    }

    // Fallback: try native Date parsing
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d;
}

/** Convert a local time string to UTC using the IANA timezone */
function tzToUTC(isoLocal, tzid) {
    try {
        // isoLocal is like "2026-07-25T10:00:00"
        // Create a date assuming it's UTC
        const asUTC = new Date(isoLocal + 'Z');
        // Find what that UTC instant looks like in the target timezone
        const localStr = asUTC.toLocaleString('en-US', { timeZone: tzid, hour12: false });
        const asLocal = new Date(localStr);
        // The offset is the difference
        const offset = asUTC.getTime() - asLocal.getTime();
        return new Date(asUTC.getTime() + offset);
    } catch {
        // Invalid timezone — fall back to treating as UTC
        return new Date(isoLocal + 'Z');
    }
}

// ---- RRULE expansion ----

function expandRRule(rruleText, startUTC, tzid, windowStart, windowEnd) {
    if (!rruleText) return [];

    try {
        const opts = parseRRuleText(rruleText);
        const tz = tzid || 'UTC';
        const isoStr = startUTC.toISOString().replace('Z', '');
        const dtstart = Temporal.ZonedDateTime.from(`${isoStr}[UTC]`).withTimeZone(tz);

        opts.dtstart = dtstart;

        const rule = new RRuleTemporal(opts);
        const wsT = Temporal.Instant.fromEpochMilliseconds(windowStart.getTime()).toZonedDateTimeISO('UTC');
        const weT = Temporal.Instant.fromEpochMilliseconds(windowEnd.getTime()).toZonedDateTimeISO('UTC');

        const occurrences = rule.between(wsT, weT);
        return occurrences.map(o => new Date(o.toInstant().epochMilliseconds));
    } catch (err) {
        console.warn(`[CAL] RRULE expansion failed: ${err.message} | rule: ${rruleText}`);
        // Fallback: return just the start date itself
        return [startUTC];
    }
}

function parseRRuleText(text) {
    const opts = {};
    for (const part of text.split(';')) {
        const [key, val] = part.split('=');
        if (!key || !val) continue;
        switch (key.toUpperCase()) {
            case 'FREQ':
                opts.freq = val.toUpperCase();
                break;
            case 'COUNT':
                opts.count = parseInt(val, 10);
                break;
            case 'INTERVAL':
                opts.interval = parseInt(val, 10);
                break;
            case 'UNTIL': {
                const d = toUTC(val, null, false);
                if (d) {
                    const iso = d.toISOString().replace('Z', '');
                    opts.until = Temporal.ZonedDateTime.from(`${iso}[UTC]`);
                }
                break;
            }
            case 'BYDAY':
                opts.byday = val.split(',').map(s => s.trim());
                break;
            case 'BYMONTH':
                opts.bymonth = val.split(',').map(s => parseInt(s, 10));
                break;
            case 'BYMONTHDAY':
                opts.bymonthday = val.split(',').map(s => parseInt(s, 10));
                break;
            case 'BYHOUR':
                opts.byhour = val.split(',').map(s => parseInt(s, 10));
                break;
            case 'BYMINUTE':
                opts.byminute = val.split(',').map(s => parseInt(s, 10));
                break;
            case 'BYSECOND':
                opts.bysecond = val.split(',').map(s => parseInt(s, 10));
                break;
            case 'BYSETPOS':
                opts.bysetpos = val.split(',').map(s => parseInt(s, 10));
                break;
            case 'BYWEEKNO':
                opts.byweekno = val.split(',').map(s => parseInt(s, 10));
                break;
            case 'BYYEARDAY':
                opts.byyearday = val.split(',').map(s => parseInt(s, 10));
                break;
            case 'WKST':
                opts.wkst = val.toUpperCase();
                break;
        }
    }
    return opts;
}

// ---- Duration parsing ----

function parseDuration(dur) {
    if (!dur || typeof dur !== 'string') return 0;
    let ms = 0;
    const w = dur.match(/(\d+)W/); if (w) ms += parseInt(w[1]) * 7 * 24 * 60 * 60 * 1000;
    const d = dur.match(/(\d+)D/); if (d) ms += parseInt(d[1]) * 24 * 60 * 60 * 1000;
    const h = dur.match(/(\d+)H/); if (h) ms += parseInt(h[1]) * 60 * 60 * 1000;
    const m = dur.match(/(\d+)M/); if (m) ms += parseInt(m[1]) * 60 * 1000;
    const s = dur.match(/(\d+)S/); if (s) ms += parseInt(s[1]) * 1000;
    return ms;
}
