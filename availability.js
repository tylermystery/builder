// PASTE THIS ENTIRE CODE INTO: availability.js
import { CONSTANTS } from './config.js';
import { log } from './utils/debug.js';
import * as api from './api.js';
import { state } from './state.js';

export const AVAILABILITY_STATUS = {
    FULL: 'full',
    PARTIAL: 'partial',
    NONE: 'none',
};

export function parseICalDate(dateString) {
    if (!dateString) return null;
    const year = parseInt(dateString.substring(0, 4), 10);
    const month = parseInt(dateString.substring(4, 6), 10) - 1;
    const day = parseInt(dateString.substring(6, 8), 10);
    const hour = parseInt(dateString.substring(9, 11), 10);
    const minute = parseInt(dateString.substring(11, 13), 10);
    const second = parseInt(dateString.substring(13, 15), 10);
    return new Date(Date.UTC(year, month, day, hour, minute, second));
}

export function getDayStatus(day, busyTimes, record) {
    const leadTime = parseInt(record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0, 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const leadTimeDate = new Date(today.getTime() + leadTime * 24 * 60 * 60 * 1000);
    if (day < leadTimeDate) {
        return { status: AVAILABILITY_STATUS.NONE, reason: `Unavailable due to ${leadTime} day lead time.` };
    }

    if (!busyTimes || busyTimes.length === 0) {
        return { status: AVAILABILITY_STATUS.FULL, reason: 'Fully Available' };
    }

    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    const busyPeriods = busyTimes.filter(busy => {
        const busyStart = new Date(busy.start);
        const busyEnd = new Date(busy.end);
        return busyStart <= dayEnd && busyEnd >= dayStart;
    });

    if (busyPeriods.length === 0) {
        return { status: AVAILABILITY_STATUS.FULL, reason: 'Fully Available' };
    }

    const totalMinutes = 24 * 60;
    let busyMinutes = 0;
    busyPeriods.forEach(busy => {
        const start = new Date(Math.max(busy.start, dayStart));
        const end = new Date(Math.min(busy.end, dayEnd));
        const minutes = (end - start) / (1000 * 60);
        busyMinutes += minutes;
    });

    const availablePercentage = ((totalMinutes - busyMinutes) / totalMinutes) * 100;
    if (availablePercentage > 50) {
        return { status: AVAILABILITY_STATUS.PARTIAL, reason: 'Partially Available (some times are booked).' };
    } else {
        return { status: AVAILABILITY_STATUS.NONE, reason: 'No availability today (all time slots are booked).' };
    }
}

export function getRangeStatus(start, end, record, busyTimes) {
    const leadTime = parseInt(record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0, 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const leadTimeCutoffDate = new Date(today.getTime() + leadTime * 24 * 60 * 60 * 1000);

    if (end < leadTimeCutoffDate) {
        return { status: AVAILABILITY_STATUS.NONE, reason: `Unavailable due to ${leadTime} day lead time.` };
    }

    if (start < leadTimeCutoffDate) {
        const availableDate = leadTimeCutoffDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return { status: AVAILABILITY_STATUS.PARTIAL, reason: `Partially available due to lead time. Becomes available on ${availableDate}.` };
    }

    if (checkAvailability(start, end, busyTimes) === false) {
        return { status: AVAILABILITY_STATUS.PARTIAL, reason: 'Partially available. Some days or times within this period are booked.' };
    }

    return { status: AVAILABILITY_STATUS.FULL, reason: 'Fully available during this period.' };
}

export function checkAvailability(start, end, busyTimes) {
    // Add a check to ensure busyTimes is an array before iterating
    if (!Array.isArray(busyTimes)) return true;

    for (const event of busyTimes) {
        const eventStart = new Date(event.start);
        const eventEnd = new Date(event.end);
        if (start < eventEnd && end > eventStart) {
            return false;
        }
    }
    return true;
}

export function getAvailableSlotsForDay(day, busyTimes) {
    if (!busyTimes || busyTimes.length === 0) {
        return '8:00 AM - 5:00 PM';
        // Default availability if no data
    }

    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    const availableSlots = [];
    let lastEnd = dayStart;

    busyTimes.sort((a, b) => new Date(a.start) - new Date(b.start));
    busyTimes.forEach(busy => {
        const start = new Date(Math.max(busy.start, dayStart));
        const end = new Date(Math.min(busy.end, dayEnd));

        if (start > lastEnd) {
            availableSlots.push({
                start: lastEnd,
                end: start
            });
        }
        lastEnd = end > lastEnd ? end : lastEnd;
    });
    if (lastEnd < dayEnd) {
        availableSlots.push({
            start: lastEnd,
            end: dayEnd
        });
    }

    return availableSlots.map(slot => {
        const startTime = new Date(slot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const endTime = new Date(slot.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `${startTime} - ${endTime}`;
    }).join('\n') ||
        'No available slots';
}

export async function getCombinedPlanStatus(date, lockedItems) {
    let overallStatus = AVAILABILITY_STATUS.FULL;
    for (const record of lockedItems) {
        if (record && record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]) {
            const busyTimes = await api.fetchCalendarForRecord(record);
            const status = getDayStatus(date, busyTimes, record).status;

            if (status === AVAILABILITY_STATUS.NONE) {
                return AVAILABILITY_STATUS.NONE;
                // If any item is unavailable, the whole plan is unavailable
            }
            if (status === AVAILABILITY_STATUS.PARTIAL) {
                overallStatus = AVAILABILITY_STATUS.PARTIAL;
                // If at least one is partial, the plan is partial
            }
        }
    }

    return overallStatus;
}

// In: availability.js
// Action: REPLACE the entire `calculateMissingCategories` function

/**
 * [Recommendation Engine v1.2]
 * Calculates the "health" of the event to find missing "Pillar" categories.
 * @returns {Array<string>} A list of missing categories (e.g., ["Venue", "Food/Drink"])
 */
export function calculateMissingCategories() {
    // Your 4 Pillars (Using the exact, case-sensitive names)
    const requiredCategories = {
        "Activities": false,
        "Food/Drink": false,
        "Venue": false,
        "Extras": false,
    };

    for (const recordId of state.cart.lockedItems.keys()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        // We will check the raw string for a case-insensitive match
        const itemCategories = (record.fields.Categories || '').toLowerCase();

        // Check against our "required" list
        if (itemCategories.includes('activities')) {
            requiredCategories["Activities"] = true;
        }
        if (itemCategories.includes('food/drink') || itemCategories.includes('food')) {
            requiredCategories["Food/Drink"] = true;
        }
        if (itemCategories.includes('venue')) {
            requiredCategories["Venue"] = true;
        }
        if (itemCategories.includes('extras')) {
            requiredCategories["Extras"] = true;
        }
    }

    let suggestions = [];
    for (const category in requiredCategories) {
        if (!requiredCategories[category]) {
            suggestions.push(category); // Add the *missing* category (e.g., "Activities")
        }
    }
    return suggestions;
}
