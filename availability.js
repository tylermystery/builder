/*
 * Version: 1.2.0
 * Last Modified: 2025-08-26
 *
 * Changelog:
 *
 * v1.2.0 - 2025-08-26
 * - Refactored logic to correctly handle partial day availability.
 * - Added getDayStatus for calendar coloring and getBusySlotsForDay for tooltips.
 * - Standardized date parsing to handle timezones.
 *
 * v1.1.0 - 2025-08-26
 * - Added lead time check to the beginning of the availability logic.
 */
import { CONSTANTS } from './config.js';

export const AVAILABILITY_STATUS = {
    FULL: 'FULL',
    PARTIAL: 'PARTIAL',
    NONE: 'NONE'
};

/**
 * Parses an iCal date string into a timezone-aware JS Date object.
 * Example Inputs: "20250826" or "20250826T180000Z"
 * @param {string} dateString - The date string from the iCal feed.
 * @returns {{date: Date, isAllDay: boolean}}
 */
function parseICalDate(dateString) {
    const year = dateString.substring(0, 4);
    const month = dateString.substring(4, 6);
    const day = dateString.substring(6, 8);
    
    if (dateString.length === 8) { // All-day event
        const date = new Date(`${year}-${month}-${day}T00:00:00`); // Interpreted in user's timezone
        return { date, isAllDay: true };
    } else { // Timed event
        const hour = dateString.substring(9, 11);
        const minute = dateString.substring(11, 13);
        const second = dateString.substring(13, 15);
        // By including Z, we correctly parse it as UTC and new Date() converts to local timezone.
        const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
        return { date: new Date(isoString), isAllDay: false };
    }
}

/**
 * Formats a time for display in the tooltip.
 * @param {Date} date - The date object to format.
 * @returns {string} - e.g., "11:00 AM"
 */
function formatTime(date) {
    return date.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * Gets a formatted string of busy slots for a given day for use in tooltips.
 * @param {Date} day - The day to check.
 * @param {Array} busyEvents - The array of iCal events.
 * @returns {string} - e.g., "(Busy 11:00 AM - 2:00 PM)"
 */
export function getBusySlotsForDay(day, busyEvents) {
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    
    const slots = busyEvents.map(event => {
        const busyStartInfo = parseICalDate(event.start);
        const busyEndInfo = parseICalDate(event.end);
        
        if (busyStartInfo.isAllDay) return null; // We don't list all-day events as slots
        
        // Check if the event occurs on the given day
        if (busyStartInfo.date < dayEnd && busyEndInfo.date > dayStart) {
            return `${formatTime(busyStartInfo.date)} - ${formatTime(busyEndInfo.date)}`;
        }
        return null;
    }).filter(Boolean); // Remove nulls

    return slots.length > 0 ? `(Busy ${slots.join(', ')})` : '';
}

/**
 * Determines the general availability status of a full day (for calendar coloring).
 * @param {Date} day - The day to check.
 * @param {Array} busyEvents - The array of iCal events.
 * @param {object} record - The Airtable record for the item.
 * @returns {string} - The availability status ('FULL', 'PARTIAL', or 'NONE').
 */
export function getDayStatus(day, busyEvents, record) {
    // 1. Lead Time Check
    const leadTimeDays = record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0;
    if (leadTimeDays > 0) {
        const now = new Date();
        const earliestBookableDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + leadTimeDays);
        if (day < earliestBookableDate) {
            return AVAILABILITY_STATUS.NONE;
        }
    }
    
    if (!busyEvents || busyEvents.length === 0) {
        return AVAILABILITY_STATUS.FULL;
    }

    // 2. iCal Event Check
    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);
    
    let hasTimedEvent = false;
    for (const event of busyEvents) {
        const busyStartInfo = parseICalDate(event.start);
        if (busyStartInfo.isAllDay && busyStartInfo.date.toDateString() === day.toDateString()) {
            return AVAILABILITY_STATUS.NONE; // An all-day event makes the whole day unavailable.
        }
        const busyEndInfo = parseICalDate(event.end);
        if (busyStartInfo.date < dayEnd && busyEndInfo.date > dayStart) {
            hasTimedEvent = true;
        }
    }
    
    return hasTimedEvent ? AVAILABILITY_STATUS.PARTIAL : AVAILABILITY_STATUS.FULL;
}

/**
 * Checks for a direct conflict with a specific requested time slot.
 * @param {Date} requestedStart - The start of the desired time slot.
 * @param {Date} requestedEnd - The end of the desired time slot.
 * @param {Array} busyEvents - An array of iCal events.
 * @returns {boolean} - True if there is a conflict, false otherwise.
 */
export function checkAvailability(requestedStart, requestedEnd, busyEvents) {
    if (!busyEvents || busyEvents.length === 0) {
        return true; // Is available
    }

    for (const event of busyEvents) {
        const busyStartInfo = parseICalDate(event.start);
        const busyEndInfo = parseICalDate(event.end);

        if (busyStartInfo.isAllDay) {
            const allDayStart = new Date(busyStartInfo.date);
            allDayStart.setHours(0, 0, 0, 0);
            const allDayEnd = new Date(busyStartInfo.date);
            allDayEnd.setHours(23, 59, 59, 999);
            if (requestedStart < allDayEnd && requestedEnd > allDayStart) {
                return false; // Conflict with all-day event
            }
        } else {
            // Standard overlap check for timed events
            if (requestedStart < busyEndInfo.date && requestedEnd > busyStartInfo.date) {
                return false; // Conflict with timed event
            }
        }
    }

    return true; // No conflicts found
}
