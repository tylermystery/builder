/*
 * Version: 3.2.0
 * Last Modified: 2025-08-26
 *
 * Changelog:
 *
 * v3.2.0 - 2025-08-26
 * - Refactored calendar logic to support item-specific calendars and lead times.
 *
 * v3.1.2 - 2025-08-26
 * - Fixed a startup crash by removing the call to the obsolete api.fetchCalendarData function.
 *
 * v3.1.1 - 2025-08-26
 * - Polished calendar views to be color-coded (green/orange/red).
 */

import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { getStoredSessions, storeSession } from './session.js';
import { parseOptions } from './utils.js';
import { checkAvailability, AVAILABILITY_STATUS } from './availability.js';

const imageCache = new Map();
let mainDatePicker = null; // To hold the main flatpickr instance

// --- DEBOUNCER FOR SAVING ---
let saveTimeout;
function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        api.saveSessionToAirtable();
    }, 1000);
}

// --- CORE LOGIC ---
function renderTopLevel() {
    const topLevelRecords = state.records.all.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    ui.renderRecords(topLevelRecords, imageCache);
}

// --- AVAILABILITY LOGIC ---

/**
 * Updates all visible card icons to reflect availability for a given date range.
 */
async function updateAllCardAvailabilityIcons() {
    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) {
        return;
    }

    const startDate = mainDatePicker.selectedDates[0];
    const durationHours = parseInt(document.getElementById('header-duration').value, 10) || 1;
    const requestedEnd = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);

    const cards = document.querySelectorAll('.event-card');
    for (const card of cards) {
        const recordId = card.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        const busyTimes = await api.fetchCalendarForRecord(record);
        const status = checkAvailability(startDate, requestedEnd, busyTimes, record);
        const icon = card.querySelector('.availability-btn');

        if (icon) {
            switch (status) {
                case AVAILABILITY_STATUS.FULL:
                    icon.textContent = '✅';
                    icon.title = 'Fully Available';
                    break;
                case AVAILABILITY_STATUS.PARTIAL:
                    icon.textContent = '🟠';
                    icon.title = 'Partially Available';
                    break;
                case AVAILABILITY_STATUS.NONE:
                    icon.textContent = '❌';
                    icon.title = 'Unavailable';
                    break;
            }
        }
    }
}

/**
 * Opens a read-only pop-up calendar for a single item.
 * @param {object} record - The Airtable record for the item.
 */
async function showItemDetailCalendar(record) {
    const busyTimes = await api.fetchCalendarForRecord(record);

    const detailPicker = flatpickr(document.createElement('input'), {
        defaultDate: mainDatePicker?.selectedDates[0] || new Date(),
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            const dayStart = new Date(dayElem.dateObj);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(dayElem.dateObj);
            dayEnd.setHours(23, 59, 59, 999);

            const status = checkAvailability(dayStart, dayEnd, busyTimes, record);
            if (status === AVAILABILITY_STATUS.NONE) {
                dayElem.classList.add('flatpickr-disabled');
                dayElem.title = 'Unavailable';
            } else if (status === AVAILABILITY_STATUS.PARTIAL) {
                dayElem.classList.add('flatpickr-partial');
                dayElem.title = 'Partially Available';
            } else if (status === AVAILABILITY_STATUS.FULL) {
                dayElem.classList.add('flatpickr-available');
                dayElem.title = 'Fully Available';
            }
        },
        onClose: function(selectedDates, dateStr, instance) {
            instance.destroy();
        }
    });

    detailPicker.open();
}


// --- INITIALIZATION & MAIN FLOW ---
async function initialize() {
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
    if (sessionId) {
        await api.loadSessionFromAirtable(sessionId);
        ui.updateHeader();
    } else {
        state.session.isOwned = true;
    }
    
    ui.toggleLoading(false);
    setupEventListeners();
    renderTopLevel();
    ui.updateFavoritesCarousel();
}

function setupEventListeners() {
    // --- AUTOSAVE TRIGGERS FOR HEADER ---
    ui.headerEventNameInput.addEventListener('change', () => { 
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, ui.headerEventNameInput.value);
        ui.updateHeader();
        debouncedSave();
    });
    document.getElementById('header-duration').addEventListener('change', updateAllCardAvailabilityIcons);

    document.getElementById('header-headcount').addEventListener('change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GUEST_COUNT, e.target.value);
        debouncedSave();
    });
    document.getElementById('header-goals').addEventListener('change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        debouncedSave();
    });

    // --- BETA TOOLKIT LISTENERS ---
    document.getElementById('beta-trigger').addEventListener('click', () => {
        document.getElementById('beta-toolkit').classList.toggle('visible');
    });

    // --- MAIN DATE PICKER INITIALIZATION ---
    mainDatePicker = flatpickr("#header-date", {
        mode: "range",
        dateFormat: "M j, Y",
        onClose: (selectedDates) => {
            if (selectedDates.length === 2) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString().split('T')[0]));
                debouncedSave();
                updateAllCardAvailabilityIcons();
            }
        },
        onDayCreate: (dObj, dStr, fp, dayElem) => {
            // This logic will be fully updated in the next step to show combined availability.
            // For now, it will be incorrect if multiple items are favorited.
            const dayStart = new Date(dayElem.dateObj);
            dayStart.setHours(0, 0, 0, 0);
            const dayEnd = new Date(dayElem.dateObj);
            dayEnd.setHours(23, 59, 59, 999);
            
            // Placeholder: This doesn't use any specific record, so lead time won't work here yet.
            const status = checkAvailability(dayStart, dayEnd, [], {});
            if (status === AVAILABILITY_STATUS.NONE) {
                dayElem.classList.add('flatpickr-disabled');
                dayElem.title = "Unavailable";
            } else if (status === AVAILABILITY_STATUS.PARTIAL) {
                dayElem.classList.add('flatpickr-partial');
                dayElem.title = "Partially Available";
            } else if (status === AVAILABILITY_STATUS.FULL) {
                dayElem.classList.add('flatpickr-available');
                dayElem.title = "Available";
            }
        }
    });

    // --- UNIFIED CLICK LISTENER ---
    document.body.addEventListener('click', async (e) => {
        const heartIcon = e.target.closest('.heart-icon');
        const parentBtn = e.target.closest('.parent-btn');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');
        const availabilityBtn = e.target.closest('.availability-btn');

        if (availabilityBtn) {
            e.stopPropagation();
            const card = availabilityBtn.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                showItemDetailCalendar(record);
            }
        } else if (heartIcon) {
            e.stopPropagation();
            const currentCard = heartIcon.closest('.event-card, .favorite-item');
            if (!currentCard) return; 
            const recordId = currentCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            
            const isGrouping = state.records.all.some(r => r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0] === recordId);
            
            let itemInfo = { quantity: 1, selectedOptionIndex: null, note: '' };
            if (!isGrouping) {
                const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
                const noteEl = currentCard.querySelector('.item-note');
                const optionsEl = currentCard.querySelector('.configure-options');
                const quantityEl = currentCard.querySelector('.quantity-input');
        
                if (quantityEl) {
                    itemInfo.quantity = parseInt(quantityEl.value, 10);
                }
        
                if (optionsEl && rawOptions.length > 0) {
                    itemInfo.selectedOptionIndex = parseInt(optionsEl.value, 10);
                }
                if (noteEl) itemInfo.note = noteEl.value;
            }
        
            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
                heartIcon.classList.remove('hearted');
            } else {
                state.cart.items.set(recordId, itemInfo);
                heartIcon.classList.add('hearted');
            }
            await ui.updateFavoritesCarousel();
            // When favorites change, we need to redraw the main calendar
            mainDatePicker.redraw();
            debouncedSave();
        } else if (parentBtn) {
            e.stopPropagation();
            const card = parentBtn.closest('.event-card');
            if (!card) return;
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const parentRecord = state.records.all.find(p => p.id === record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]?.[0]);
            if (parentRecord) {
                const newCard = await ui.createInteractiveCard(parentRecord, imageCache);
                card.replaceWith(newCard);
            } else {
                renderTopLevel();
            }
        } else if (explodeBtn) {
            e.stopPropagation();
            const card = explodeBtn.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childNames = new Set(rawOptions.map(opt => opt.name));
            const children = state.records.all.filter(r => childNames.has(r.fields.Name));
            
            ui.renderRecords(children, imageCache);
            const implodeButton = document.createElement('div');
            implodeButton.id = 'implode-container';
            implodeButton.innerHTML = `<button class="card-btn implode-btn" title="Implode"> اجمع </button>`;
            document.querySelector('#catalog-container').insertAdjacentElement('beforebegin', implodeButton);
        } else if (implodeBtn) {
            e.stopPropagation();
            implodeBtn.closest('#implode-container').remove();
            renderTopLevel();
        }
    });

    // --- UNIFIED CHANGE LISTENER ---
    document.body.addEventListener('change', async (e) => {
        const card = e.target.closest('.event-card');
        if (!card) return;

        // Handles configuration changes (Bookable Items)
        if (e.target.classList.contains('configure-options')) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
    
            const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const selectedIndex = parseInt(e.target.value, 10);
            const selectedOption = rawOptions[selectedIndex];
            
            const initialPrice = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]/g, ""));
            let newPrice = initialPrice;
            if (selectedOption) {
                if (selectedOption.absolutePrice != null) newPrice = selectedOption.absolutePrice;
                else if (selectedOption.priceChange != null) newPrice += selectedOption.priceChange;
            }
            card.querySelector('.price').textContent = `$${newPrice.toFixed(2)}`;
            card.querySelector('.description').textContent = selectedOption.description || record.fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '';
            
            if (selectedOption) {
                const formatForTag = (name) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
                const itemTag = formatForTag(record.fields[CONSTANTS.FIELD_NAMES.NAME]);
                const optionTag = formatForTag(selectedOption.name);
                const optionImageUrls = await api.fetchImagesByTags([itemTag, optionTag]);
                if (optionImageUrls && optionImageUrls.length > 0) {
                    card.style.backgroundImage = `url('${optionImageUrls[0]}')`;
                } else {
                    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
                    card.style.backgroundImage = `url('${imageUrls[0]}')`;
                }
            }
        }

        // Handles navigation changes (Grouping Items)
        if (e.target.classList.contains('navigate-options')) {
            const childName = e.target.value;
            if (!childName) return;
            const childRecord = state.records.all.find(r => r.fields.Name === childName);
            if (childRecord) {
                const newCard = await ui.createInteractiveCard(childRecord, imageCache);
                card.replaceWith(newCard);
            }
        }
    });
}

initialize();
