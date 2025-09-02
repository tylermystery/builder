/*
 * Version: 4.8.5
 * Last Modified: 2025-09-02
 * Changelog:
 * v4.8.5 - 2025-09-02
 *   - Added initial localStorage clear to mitigate FILE_ERROR_NO_SPACE.
 * v4.8.4 - 2025-09-02
 *   - Added debug logging for initialization steps.
 * v4.8.3 - 2025-09-02
 *   - Continue initialization if session loading fails due to storage errors.
 * v4.8.2 - 2025-09-02
 *   - Added retry logic for fetchAllRecords to handle transient errors.
 * v4.8.1 - 2025-09-02
 *   - Added storage error handling during initialization.
 */
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { initializeEventListeners, getItemState, updateSaveShareButton } from './events.js';
import { getStoredSessions } from './session.js';
import { log } from './utils/debug.js';

const imageCache = new Map();

async function initialize() {
    log('Main', '1. Initialization started.');
    // Clear localStorage to mitigate FILE_ERROR_NO_SPACE
    try {
        localStorage.clear();
        log('Main', '2. Cleared localStorage to prevent storage errors.');
    } catch (e) {
        log('Main', `2. Failed to clear localStorage: ${e.message}`);
    }

    ui.initStateHelpers({ getItemState });
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
    const mainDatePicker = initializeEventListeners(imageCache);
    log('Main', '9. Event listeners initialized.');

    if (sessionId) {
        try {
            await api.loadSessionFromAirtable(sessionId);
            log('Main', '10. Session loaded successfully.');
            ui.updateHeader();
            ui.updateEventPlanPanel();
            ui.updateTotalCost();
            log('Main', '11. Updated header, event plan, and total cost.');

            const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
            if (savedDate && Array.isArray(savedDate) && savedDate.length === 2) {
                if(mainDatePicker) {
                    mainDatePicker.setDate([savedDate[0], savedDate[1]], true);
                    log('Main', '12. Set saved date in date picker.');
                }
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

    log('Main', '21. Initialization complete.');
}

initialize();
