/*
 * Version: 4.8.1
 * Last Modified: 2025-09-02
 * Changelog:
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

const imageCache = new Map();

async function initialize() {
    console.log("1. Initialization started.");
    ui.initStateHelpers({ getItemState });

    ui.toggleLoading(true);
    try {
        state.records.all = await api.fetchAllRecords();
        console.log("2. All records fetched from Airtable:", state.records.all.length, "records found.");
    } catch (error) {
        console.error("Failed to load initial data:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    const mainDatePicker = initializeEventListeners(imageCache);
    console.log("3. Event listeners initialized.");

    if (sessionId) {
        try {
            await api.loadSessionFromAirtable(sessionId);
            ui.updateHeader();
            ui.updateEventPlanPanel();
            ui.updateTotalCost();

            const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
            if (savedDate && Array.isArray(savedDate) && savedDate.length === 2) {
                if(mainDatePicker) mainDatePicker.setDate([savedDate[0], savedDate[1]], true);
            }
        } catch (error) {
            console.error("Failed to load session:", error);
            if (error.message.includes('FILE_ERROR_NO_SPACE')) {
                console.warn('Clearing local storage due to storage error.');
                localStorage.removeItem('eventBuilderSessions');
            }
        }
    } else {
        state.session.isOwned = true;
    }
    ui.toggleLoading(false);

    document.getElementById('status-filter').value = 'Available';

    console.log("4. Applying initial filters and rendering...");
    applyFiltersAndSort(imageCache);
    ui.updateFavoritesCarousel();
    updateSaveShareButton();

    console.log("5. Initialization complete.");
}

initialize();
