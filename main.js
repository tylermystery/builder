// FILE: main.js
/*
 * Version: 4.9.1
 * Last Modified: 2025-09-09
 * * Changelog:
 * v4.9.1 - 2025-09-09
 * - Implemented dynamic availability for locked-in items and the 
 event plan date.
 * - Synced the detail modal calendar with the event plan date.
 * - Updated event handlers for adding/removing items to trigger an availability refresh.
 * v4.9.0 - 2025-09-09
 * - Finalized itinerary builder functionality with live editing and date sync.
 * v4.8.9 - 2025-09-09
 * - Added functionality to open the new itinerary builder modal.
 * v4.8.8 - 2025-09-09
 * - Fixed SyntaxError: Corrected import of getItemState from events.js to ui.js.
 * - Added functionality for carousel navigation buttons.
 * v4.8.7 - 2025-09-08
 * - Corrected a ReferenceError by providing flatpickr as a global object to the event listeners.
 * v4.8.6 - 2025-09-08
 * - Added functionality to update the header calendar based on favorited items.
 * v4.8.5 - 2025-09-02
 * - Added initial localStorage clear to mitigate FILE_ERROR_NO_SPACE.
 * v4.8.4 - 2025-09-02
 * - Added debug logging for initialization steps.
 * v4.8.3 - 2025-09-02
 * - Continue initialization if session loading fails due to storage errors.
 * v4.8.2 - 2025-09-02
 * - Added retry logic for fetchAllRecords to handle transient errors.
 * v4.8.1 - 2025-09-02
 * - Added storage error handling during initialization.
 */
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
// FIX: Import the new setupItineraryEventListeners function from ui.js
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { initializeEventListeners, updateSaveShareButton } from './events.js';
import { getStoredSessions } from './session.js';
import { log } from './utils/debug.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, getCombinedPlanStatus } from './availability.js';
import { debounce } from './utils.js';

const imageCache = new Map();
let mainDatePicker = null;
// New function to handle the header calendar's availability display
async function updateHeaderCalendarAvailability() {
    log('Main', 'Updating header calendar availability based on favorited items.');
    const allBusyTimes = [];
    const favoriteItems = state.cart.items;
    
    for (const [recordId] of favoriteItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record && record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]) {
            const busyTimes = await api.fetchCalendarForRecord(record);
            allBusyTimes.push(...busyTimes);
        }
    }
    
    if (mainDatePicker) {
        // Clear previous date highlighting
        mainDatePicker.clear();
        // Use the combined busy times to highlight dates on the main calendar
        mainDatePicker.config.onDayCreate = (dObj, dStr, fp, dayElem) => {
            const day = dayElem.dateObj;
            let status = AVAILABILITY_STATUS.FULL;
            
            // Check against lead time first for all items
            let hasLeadTimeConflict = false;
            for (const [recordId] of favoriteItems.entries()) {
                const record = state.records.all.find(r => r.id === recordId);
                const leadTimeDays = record?.fields?.[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const leadTimeCutoff = new Date(today.getTime() + leadTimeDays * 24 * 60 * 60 * 1000);
                if (day < leadTimeCutoff) {
                    hasLeadTimeConflict = true;
                    break;
                }
            }
            if (hasLeadTimeConflict) {
                status = AVAILABILITY_STATUS.NONE;
            } else {
                const dayStart = new Date(day);
                dayStart.setHours(0, 0, 0, 0);
                const dayEnd = new Date(day);
                dayEnd.setHours(23, 59, 59, 999);
                const busyPeriods = allBusyTimes.filter(busy => {
                    const busyStart = new Date(busy.start);
                    const busyEnd = new Date(busy.end);
                    return busyStart <= dayEnd && busyEnd >= dayStart;
                });
                if (busyPeriods.length > 0) {
                    const totalMinutes = 24 * 60;
                    let busyMinutes = 0;
                    busyPeriods.forEach(busy => {
                        const start = new Date(Math.max(busy.start, dayStart));
                        const end = new Date(Math.min(busy.end, dayEnd));
                        const minutes = (end - start) / (1000 * 60);
                        busyMinutes += minutes;
                    });
                    const availablePercentage = ((totalMinutes - busyMinutes) / totalMinutes) * 100;
                    if (availablePercentage <= 50) {
                        status = AVAILABILITY_STATUS.NONE;
                    } else {
                        status = AVAILABILITY_STATUS.PARTIAL;
                    }
                }
            }
            
            // Apply classes based on the calculated status
            if (status === AVAILABILITY_STATUS.FULL) {
                dayElem.classList.add('available-full');
            } else if (status === AVAILABILITY_STATUS.PARTIAL) {
                dayElem.classList.add('available-partial');
            } else {
                dayElem.classList.add('unavailable');
            }
        };

        // Redraw the calendar to apply the new highlights
        mainDatePicker.redraw();
    }
}

async function initialize() {
    log('Main', '1. Initialization started.');
    try {
        localStorage.clear();
        log('Main', '2. Cleared localStorage to prevent storage errors.');
    } catch (e) {
        log('Main', `2. Failed to clear localStorage: ${e.message}`);
    }

    // FIX: Passing the correct function from ui.js
    ui.initStateHelpers({ getItemState: ui.getItemState });
    log('Main', '3. State helpers initialized.');

    ui.toggleLoading(true);
    log('Main', '4. Loading UI toggled on.');
    try {
        let retries = 3;
        while (retries > 0) {
            try {
                state.records.all = await api.fetchAllRecords();
                log('Main', `5. Fetched ${state.records.all.length} records from Airtable.`);
                break;
            } catch (error) {
                retries--;
                log('Main', `6. Fetch failed, retries left: ${retries}, error: ${error.message}`);
                if (retries === 0) throw error;
                log('Main', `Retrying fetchAllRecords (${retries} attempts left)...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    } catch (error) {
        console.error("Failed to load initial data:", error);
        log('Main', `7. Failed to load initial data: ${error.message}`);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    log('Main', `8. Session ID from URL: ${sessionId || 'none'}`);
    // FIX: Removed the redundant call to initializeEventListeners
    const { mainDatePicker, eventPlanDatePicker } = initializeEventListeners(imageCache, window.flatpickr);
    log('Main', '9. Event listeners initialized.');
    
    // FIX: Call the new setup function for the itinerary modal's event listeners from ui.js
    ui.setupItineraryEventListeners();
    
    if (sessionId) {
        try {
            await api.loadSessionFromAirtable(sessionId);
            log('Main', '10. Session loaded successfully.');
            ui.updateHeader();
            // FIX: Corrected function name
            ui.updateEventPlanSection();
            ui.updateTotalCost();
            log('Main', '11. Updated header, event plan, and total cost.');
            const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
            if (savedDate && eventPlanDatePicker) {
                eventPlanDatePicker.setDate(savedDate, true);
                log('Main', '12. Set saved date in event plan date picker.');
            }
        } catch (error) {
            console.error("Failed to load session:", error);
            log('Main', `13. Failed to load session: ${error.message}`);
            if (error.message.includes('FILE_ERROR_NO_SPACE')) {
                console.warn('Clearing local storage due to storage error.');
                log('Main', '14. Clearing local storage due to storage error.');
                localStorage.clear();
            }
            state.session.isOwned = true;
            log('Main', '15. Set session as owned due to load failure.');
        }
    } else {
        state.session.isOwned = true;
        log('Main', '16. No session ID, set session as owned.');
    }
    ui.toggleLoading(false);
    log('Main', '17. Loading UI toggled off.');
    document.getElementById('status-filter').value = 'Available';
    log('Main', '18. Set status filter to Available.');

    log('Main', '19. Applying initial filters and rendering...');
    applyFiltersAndSort(imageCache);
    ui.updateFavoritesCarousel();
    updateSaveShareButton();
    log('Main', '20. Filters applied, favorites and share button updated.');

    await updateHeaderCalendarAvailability();
    log('Main', '21. Initialization complete.');
}

initialize();
