/*
 * Version: 4.8.0 (Refactored)
 * Last Modified: 2025-09-01
 */
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { initializeEventListeners, getItemState, updateSaveShareButton } from './events.js';
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
        await api.loadSessionFromAirtable(sessionId);
        ui.updateHeader();
        ui.updateEventPlanPanel();
        ui.updateTotalCost();

        const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        if (savedDate && Array.isArray(savedDate) && savedDate.length === 2) {
            if(mainDatePicker) mainDatePicker.setDate([savedDate[0], savedDate[1]], true);
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
