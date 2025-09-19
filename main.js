// FILE: main.js
/*
 * Version: 4.9.4
 * Last Modified: 2025-09-19
 * * Changelog:
 * v4.9.4 - 2025-09-19
 * - Automatically checks the "Keep open" checkbox when the chat is first opened in presentation view.
 * v4.9.3 - 2025-09-19
 * - Added logic to auto-open the chat window on the first visit to a session's presentation view.
 * v4.9.2 - 2025-09-10
 * - Set isInitializing flag to false after setup to prevent "Fork on Load" bug.
 * v4.9.1 - 2025-09-09
 * - Implemented dynamic availability for locked-in items and the event plan date.
 * - Synced the detail modal calendar with the event plan date.
 * - Updated event handlers for adding/removing items to trigger an availability refresh.
 */
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { getStoredSessions } from './session.js';
import { log } from './utils/debug.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, getCombinedPlanStatus } from './availability.js';
import { debounce } from './utils.js';
import { initializeEventListeners, updateSaveShareButton, initializeChatEventListeners } from './events.js';
import { initializeChat } from './chat.js';

const imageCache = new Map();
let mainDatePicker = null;

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
        mainDatePicker.clear();
        mainDatePicker.config.onDayCreate = (dObj, dStr, fp, dayElem) => {
            const day = dayElem.dateObj;
            let status = AVAILABILITY_STATUS.FULL;
            
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
            
            if (status === AVAILABILITY_STATUS.FULL) {
                dayElem.classList.add('available-full');
            } else if (status === AVAILABILITY_STATUS.PARTIAL) {
                dayElem.classList.add('available-partial');
            } else {
                dayElem.classList.add('unavailable');
            }
        };
        mainDatePicker.redraw();
    }
}

async function initialize() {
    log('Main', '1. Initialization started.');
    try {
        log('Main', '2. Cleared localStorage to prevent storage errors.');
    } catch (e) {
        log('Main', `2. Failed to clear localStorage: ${e.message}`);
    }

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
    const { mainDatePicker, eventPlanDatePicker } = initializeEventListeners(imageCache, window.flatpickr);
    log('Main', '9. Event listeners initialized.');
    
    ui.setupItineraryEventListeners();
    if (sessionId) {
        try {
            await api.loadSessionFromAirtable(sessionId);
            log('Main', '10. Session loaded successfully.');
            ui.updateHeader();
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
    log('Main', '21. Header calendar updated.');

    initializeChatEventListeners();
    initializeChat();
    log('Main', '22. Chat initialized.');

    state.ui.isInitializing = false;
    log('Main', '23. Initialization complete, ready for user interaction.');

    const finalUrlParams = new URLSearchParams(window.location.search);
    if (finalUrlParams.get('view') === 'present') {
        log('Main', 'URL indicates to start in presentation view.');

        // --- NEW LOGIC START ---
        const storageKey = `session-viewed-${state.session.id}`;
        if (!localStorage.getItem(storageKey)) {
            log('Main', 'First time in presentation view for this session, opening chat.');
            const chatWidgetContainer = document.getElementById('chat-widget-container');
            if (chatWidgetContainer) {
                chatWidgetContainer.classList.add('chat-open');
                // Automatically check the "Keep open" checkbox.
                document.getElementById('chat-remain-open-checkbox').checked = true;
            }
            // Mark this session as viewed to prevent the chat from auto-opening on subsequent loads.
            localStorage.setItem(storageKey, 'true');
        }
        // --- NEW LOGIC END ---
        
        const listToShow = state.cart.items.size > 0 ? 'favorites' : 'locked';
        if (state.cart.items.size > 0 || state.cart.lockedItems.size > 0) {
            setTimeout(() => ui.showPresentationView(listToShow), 100);
        }
    }

    state.ui.isInitializing = false;
    log('Main', '23. Initialization complete, ready for user interaction.');
}

initialize();
