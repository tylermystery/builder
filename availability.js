import { CONSTANTS } from './config.js';
import { log } from './utils/debug.js';

export const AVAILABILITY_STATUS = {
    FULL: 'full',
    PARTIAL: 'partial',
    NONE: 'none',
};

export function getDayStatus(day, busyTimes, record) {
    const leadTime = parseInt(record.fields[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0, 10);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const leadTimeDate = new Date(today.getTime() + leadTime * 24 * 60 * 60 * 1000);

    if (day < leadTimeDate) {
        log('Availability', `Day ${day.toDateString()} unavailable due to lead time: ${leadTime} days`);
        return AVAILABILITY_STATUS.NONE;
    }

    if (!busyTimes || busyTimes.length === 0) {
        log('Availability', `Day ${day.toDateString()} fully available (no busy times or iCal)`);
        return AVAILABILITY_STATUS.FULL; // 100% availability if no iCal data
    }

    // Check busy times for the day
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
        log('Availability', `Day ${day.toDateString()} fully available (no conflicts)`);
        return AVAILABILITY_STATUS.FULL;
    }

    // Calculate available time slots
    const totalMinutes = 24 * 60; // 24 hours in minutes
    let busyMinutes = 0;
    busyPeriods.forEach(busy => {
        const start = new Date(Math.max(busy.start, dayStart));
        const end = new Date(Math.min(busy.end, dayEnd));
        const minutes = (end - start) / (1000 * 60);
        busyMinutes += minutes;
    });

    const availablePercentage = ((totalMinutes - busyMinutes) / totalMinutes) * 100;
    if (availablePercentage > 50) {
        log('Availability', `Day ${day.toDateString()} partially available (${availablePercentage.toFixed(1)}%)`);
        return AVAILABILITY_STATUS.PARTIAL;
    } else {
        log('Availability', `Day ${day.toDateString()} unavailable (${availablePercentage.toFixed(1)}% available)`);
        return AVAILABILITY_STATUS.NONE;
    }
}

export function getAvailableSlotsForDay(day, busyTimes) {
    if (!busyTimes || busyTimes.length === 0) {
        return '8:00 AM - 5:00 PM'; // Default availability if no data
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
    }).join('\n') || 'No available slots';
}
