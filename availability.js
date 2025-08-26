// availability.js
import { CONSTANTS } from './config.js';

// Placeholder for API call to our new serverless function
async function getBusySlots(calendarUrl) {
    // This will be implemented in a later step
    return []; 
}

export async function checkAvailability(record, selectedDateTime) {
    if (!selectedDateTime) return 'UNKNOWN';

    const status = record.fields.Status;

    // Handle iCal links
    if (status && (status.startsWith('http://') || status.startsWith('https://'))) {
        // Logic for this will be added in the next phase
        return 'AVAILABLE'; // Placeholder for now
    }

    // Handle lead time
    const leadTimeDays = record.fields['Lead Time (Days)'] || 0;
    const now = new Date();
    const availableFrom = new Date(now.setDate(now.getDate() + leadTimeDays));

    return selectedDateTime > availableFrom ? 'AVAILABLE' : 'UNAVAILABLE';
}
