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


// --- INITIALIZATION & MAIN FLOW ---
async function initialize() {
    ui.initStateHelpers({ getItemState });

    ui.toggleLoading(true);
    try {
        state.records.all = await api.fetchAllRecords();
    } catch (error) {
        console.error("Failed to load initial data:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        return;
    }
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    const mainDatePicker = initializeEventListeners(imageCache);
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

    applyFiltersAndSort(imageCache);
    ui.updateFavoritesCarousel();
    updateSaveShareButton();
}

initialize();
