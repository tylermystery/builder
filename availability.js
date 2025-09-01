import { CONSTANTS } from './config.js';

export const AVAILABILITY_STATUS = {
    FULL: 'FULL',
    PARTIAL: 'PARTIAL',
    NONE: 'NONE'
};

function parseICalDate(dateString) {
    if (!dateString) return null;
    const year = parseInt(dateString.substring(0, 4), 10);
    const month = parseInt(dateString.substring(4, 6), 10) - 1;
    const day = parseInt(dateString.substring(6, 8), 10);
    const hour = parseInt(dateString.substring(9, 11), 10);
    const minute = parseInt(dateString.substring(11, 13), 10);
    const second = parseInt(dateString.substring(13, 15), 10);
    return new Date(Date.UTC(year, month, day, hour, minute, second));
}

export function getDayStatus(date, busyTimes, record) {
    const leadTimeDays = record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0;
    const now = new Date();
    const leadTimeCutoff = new Date(now.setDate(now.getDate() + leadTimeDays));

    if (date < leadTimeCutoff) {
        return AVAILABILITY_STATUS.NONE;
    }

    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const eventsThisDay = busyTimes.filter(event => {
        const start = parseICalDate(event.DTSTART);
        const end = parseICalDate(event.DTEND);
        return start < dayEnd && end > dayStart;
    });

    if (eventsThisDay.length === 0) {
        return AVAILABILITY_STATUS.FULL;
    }
    return AVAILABILITY_STATUS.PARTIAL;
}

export function checkAvailability(start, end, busyTimes) {
    for (const event of busyTimes) {
        const eventStart = parseICalDate(event.DTSTART);
        const eventEnd = parseICalDate(event.DTEND);
        if (start < eventEnd && end > eventStart) {
            return false;
        }
    }
    return true;
}

export function getBusySlotsForDay(day, busyTimes) {
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const timeFormat = { hour: 'numeric', minute: '2-digit', hour12: true };

    return busyTimes.filter(event => {
        const start = parseICalDate(event.DTSTART);
        const end = parseICalDate(event.DTEND);
        return start < dayEnd && end > dayStart;
    }).map(event => {
        const start = parseICalDate(event.DTSTART);
        const end = parseICalDate(event.DTEND);
        return `${start.toLocaleTimeString([], timeFormat)} - ${end.toLocaleTimeString([], timeFormat)}`;
    }).join(', ');
}

