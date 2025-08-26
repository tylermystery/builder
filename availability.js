/*
 * Version: 1.1.0
 * Last Modified: 2025-08-26
 *
 * Changelog:
 *
 * v1.1.0 - 2025-08-26
 * - Added lead time check to the beginning of the availability logic.
 *
 * v1.0.0 - 2025-08-26
 * - Initial version. Contains core availability checking logic.
 */
import { CONSTANTS } from './config.js';

// Exportable constants for availability status.
export const AVAILABILITY_STATUS = {
    FULL: 'FULL',       // The requested time slot is completely available.
    PARTIAL: 'PARTIAL', // The slot is available, but overlaps with an all-day event (e.g., a holiday).
    NONE: 'NONE'        // The slot is not available due to a direct time conflict.
};

/**
 * Parses an iCal date string (e.g., "20250826" or "20250826T180000Z") into a JS Date object.
 * @param {string} dateString - The date string from the iCal feed.
 * @returns {{date: Date, isAllDay: boolean}}
 */
function parseICalDate(dateString) {
    const isAllDay = dateString.length === 8; // YYYYMMDD format indicates an all-day event.
    const year = parseInt(dateString.substring(0, 4), 10);
    const month = parseInt(dateString.substring(4, 6), 10) - 1; // JS months are 0-indexed
    const day = parseInt(dateString.substring(6, 8), 10);

    if (isAllDay) {
        return { date: new Date(Date.UTC(year, month, day)), isAllDay: true };
    } else {
        const hour = parseInt(dateString.substring(9, 11), 10);
        const minute = parseInt(dateString.substring(11, 13), 10);
        const second = parseInt(dateString.substring(13, 15), 10);
        return { date: new Date(Date.UTC(year, month, day, hour, minute, second)), isAllDay: false };
    }
}


/**
 * Checks the availability of a time range against a list of busy events and lead time.
 * @param {Date} requestedStart - The start of the desired time slot.
 * @param {Date} requestedEnd - The end of the desired time slot.
 * @param {Array} busyEvents - An array of objects with {start, end} string properties from our calendar API.
 * @param {object} record - The Airtable record for the item being checked.
 * @returns {string} - The availability status ('FULL', 'PARTIAL', or 'NONE').
 */
export function checkAvailability(requestedStart, requestedEnd, busyEvents, record) {
    // --- 1. LEAD TIME CHECK ---
    const leadTimeDays = record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0;
    if (leadTimeDays > 0) {
        const now = new Date();
        const earliestBookableDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + leadTimeDays);
        if (requestedStart < earliestBookableDate) {
            return AVAILABILITY_STATUS.NONE; // Requested date is within the lead time period.
        }
    }

    // --- 2. ICAL EVENT CHECK ---
    if (!busyEvents || busyEvents.length === 0) {
        return AVAILABILITY_STATUS.FULL;
    }

    let hasPartialConflict = false;

    for (const event of busyEvents) {
        const busyStartInfo = parseICalDate(event.start);
        const busyEndInfo = parseICalDate(event.end);

        // For all-day events, we check for date overlap only (ignoring time).
        // This is considered a "partial" conflict.
        if (busyStartInfo.isAllDay) {
            // Set end of day for comparison to include the whole day
            const busyAllDayEnd = new Date(busyStartInfo.date);
            busyAllDayEnd.setUTCDate(busyAllDayEnd.getUTCDate() + 1);

            if (requestedStart < busyAllDayEnd && requestedEnd > busyStartInfo.date) {
                hasPartialConflict = true;
                continue; // Check other events for a full conflict.
            }
        }

        // For timed events, check for a direct time overlap.
        // This is a "full" conflict.
        if (requestedStart < busyEndInfo.date && requestedEnd > busyStartInfo.date) {
            return AVAILABILITY_STATUS.NONE; // Direct conflict, no need to check further.
        }
    }

    return hasPartialConflict ? AVAILABILITY_STATUS.PARTIAL : AVAILABILITY_STATUS.FULL;
}
