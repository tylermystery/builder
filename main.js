/*
 * Version: 4.8.0 (Refactored)
 * Last Modified: 2025-09-01
 */
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { getDayStatus, checkAvailability, AVAILABILITY_STATUS } from './availability.js';
import { applyFiltersAndSort } from './filtering.js';
import { initializeEventListeners, getItemState, updateSaveShareButton } from './events.js';
const imageCache = new Map();

// --- AVAILABILITY LOGIC ---
async function updateAllCardAvailabilityIcons() {
    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) return;
    const startDate = mainDatePicker.selectedDates[0];
    const requestedEnd = mainDatePicker.selectedDates[1];
    const cards = document.querySelectorAll('.event-card');
    for (const card of cards) {
        const recordId = card.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        const busyTimes = await api.fetchCalendarForRecord(record);
        const dayStatus = getDayStatus(startDate, busyTimes, record);
        const isAvailable = checkAvailability(startDate, requestedEnd, busyTimes);
        const icon = card.querySelector('.availability-btn');
        if (icon) {
            if (icon._tippy) icon._tippy.destroy();
            let statusIcon, statusText;
            if (dayStatus === AVAILABILITY_STATUS.NONE || !isAvailable) {
                statusIcon = '❌'; statusText = 'Unavailable';
            } else if (dayStatus === AVAILABILITY_STATUS.PARTIAL) {
                statusIcon = '🟠'; statusText = 'Partially Available';
            } else {
                statusIcon = '✅'; statusText = 'Fully Available';
            }
            const dateString = startDate.toLocaleDateString();
            const tooltipContent = `<div style="text-align: left;"><strong>${dateString}</strong><hr style="margin: 2px 0 5px;"><span>${statusIcon} ${record.fields.Name}: ${statusText}</span></div>`;
            tippy(icon, { content: tooltipContent, allowHTML: true, placement: 'top', arrow: true });
            icon.title = statusText;
        }
    }
}

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
    initializeEventListeners(imageCache);
    if (sessionId) {
        await api.loadSessionFromAirtable(sessionId);
        ui.updateHeader();
        
        ui.updateEventPlanPanel();
        ui.updateTotalCost();

        const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        if (savedDate && Array.isArray(savedDate) && savedDate.length === 2) {
            // This will rely on mainDatePicker being initialized within events.js
            const mainDatePicker = flatpickr("#date-filter");
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
