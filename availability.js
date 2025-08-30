import { state } from './state.js';
import { CONSTANTS } from './config.js';

export const AVAILABILITY_STATUS = {
    FULL: 'FULL',
    PARTIAL: 'PARTIAL',
    NONE: 'NONE',
};

// Helper to get the start of a given day, ignoring time
function getStartOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

/**
 * Checks the availability status of a specific day for a given record.
 * @param {Date} day - The day to check.
 * @param {Array} busyTimes - An array of busy time slots from the iCal feed.
 * @param {Object} record - The Airtable record for the item.
 * @returns {string} - The availability status (FULL, PARTIAL, or NONE).
 */
export function getDayStatus(day, busyTimes, record) {
    const today = getStartOfDay(new Date());
    const checkDay = getStartOfDay(day);

    // 1. Check for lead time
    const leadTime = record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0;
    const leadTimeCutoff = new Date(today);
    leadTimeCutoff.setDate(today.getDate() + leadTime);

    // THE FIX: Compare dates by their numeric value using getTime() for reliability
    if (checkDay.getTime() < leadTimeCutoff.getTime()) {
        return AVAILABILITY_STATUS.NONE;
    }
    
    // 2. Check iCal busy times
    const dayBusySlots = busyTimes.filter(slot => {
        const start = getStartOfDay(new Date(slot.start));
        return start.getTime() === checkDay.getTime();
    });

    if (dayBusySlots.length === 0) {
        return AVAILABILITY_STATUS.FULL;
    }
    
    // 3. Check if a busy slot is an all-day event
    const isFullDayEvent = dayBusySlots.some(slot => slot.isFullDay);
    if (isFullDayEvent) {
        return AVAILABILITY_STATUS.NONE;
    }

    return AVAILABILITY_STATUS.PARTIAL;
}

/**
 * Checks if a requested time range is available against a list of busy slots.
 * @param {Date} start - The requested start time.
 * @param {Date} end - The requested end time.
 * @param {Array} busyTimes - An array of busy time slots.
 * @returns {boolean} - True if the range is available, false otherwise.
 */
export function checkAvailability(start, end, busyTimes) {
    for (const busySlot of busyTimes) {
        const busyStart = new Date(busySlot.start);
        const busyEnd = new Date(busySlot.end);
        // Check for overlap: (StartA < EndB) and (EndA > StartB)
        if (start < busyEnd && end > busyStart) {
            return false;
        }
    }
    return true;
}

/**
 * Gets a formatted string of busy slots for a specific day.
 * @param {Date} day - The day to check.
 * @param {Array} busyTimes - An array of busy time slots.
 * @returns {string} - A formatted string of busy times (e.g., "10am-12pm").
 */
export function getBusySlotsForDay(day, busyTimes) {
    const checkDay = getStartOfDay(day);
    const timeFormat = { hour: 'numeric', minute: '2-digit' };

    return busyTimes
        .filter(slot => getStartOfDay(new Date(slot.start)).getTime() === checkDay.getTime())
        .map(slot => {
            const start = new Date(slot.start).toLocaleTimeString([], timeFormat);
            const end = new Date(slot.end).toLocaleTimeString([], timeFormat);
            return `${start}-${end}`;
        })
        .join(', ');
}
