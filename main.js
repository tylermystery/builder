/*
 * Version: 3.6.0
 * Last Modified: 2025-08-27
 *
 * Changelog:
 *
 * v3.6.0 - 2025-08-27
 * - Merged favorite card and date/time picker enhancements.
 * - Enhanced date picker to include start and end time selection.
 * - Removed separate "Duration" input and related logic.
 * - Ensured date/time range is correctly saved and loaded with sessions.
 *
 * v3.5.1 - 2025-08-26
 * - Implemented remove button functionality on favorite cards.
 */

import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { getStoredSessions, storeSession } from './session.js';
import { parseOptions } from './utils.js';
import { getDayStatus, checkAvailability, getBusySlotsForDay, AVAILABILITY_STATUS } from './availability.js';
const imageCache = new Map();
let mainDatePicker = null;

// --- SAVE STATE MANAGEMENT ---
let saveTimeout;

const saveShareBtn = document.getElementById('save-share-btn');
function updateSaveShareButton() {
    switch (state.ui.saveState) {
        case 'MODIFIED':
            saveShareBtn.textContent = 'Changes pending...';
            saveShareBtn.disabled = true;
            break;
        case 'SAVING':
            saveShareBtn.textContent = '⚙️ Saving...';
            saveShareBtn.disabled = true;
            break;
        case 'SAVED':
            saveShareBtn.textContent = '🔗 Copy Link';
            saveShareBtn.disabled = false;
            break;
    }
}

function triggerSave() {
    clearTimeout(saveTimeout);
    state.ui.saveState = 'MODIFIED';
    updateSaveShareButton();
    saveTimeout = setTimeout(async () => {
        state.ui.saveState = 'SAVING';
        updateSaveShareButton();
        const success = await api.saveSessionToAirtable();
        if (success) {
            state.ui.saveState = 'SAVED';
            updateSaveShareButton();
        }
    }, 1500);
}


// --- CORE LOGIC ---
function renderTopLevel() {
    const topLevelRecords = state.records.all.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    ui.renderRecords(topLevelRecords, imageCache);
}

// --- AVAILABILITY LOGIC ---
async function updateAllCardAvailabilityIcons() {
    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) {
        return;
    }

    const startDate = mainDatePicker.selectedDates[0];
    const requestedEnd = mainDatePicker.selectedDates[1]; // Use the end time from the picker

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
            if (dayStatus === AVAILABILITY_STATUS.NONE || !isAvailable) {
                icon.textContent = '❌';
                icon.title = 'Unavailable';
            } else if (dayStatus === AVAILABILITY_STATUS.PARTIAL) {
                icon.textContent = '🟠';
                icon.title = 'Partially Available';
            } else {
                icon.textContent = '✅';
                icon.title = 'Fully Available';
            }
        }
    }
}

async function showItemDetailCalendar(record) {
    const busyTimes = await api.fetchCalendarForRecord(record);
    const detailPicker = flatpickr(document.createElement('input'), {
        defaultDate: mainDatePicker?.selectedDates[0] || new Date(),
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            const day = dayElem.dateObj;
            const status = getDayStatus(day, busyTimes, record);

            if (status === AVAILABILITY_STATUS.NONE) {
                dayElem.classList.add('flatpickr-disabled');
                dayElem.title = 'Unavailable';
            } else if (status === AVAILABILITY_STATUS.PARTIAL) {
                dayElem.classList.add('flatpickr-partial');
                const busySlots = getBusySlotsForDay(day, busyTimes);
                dayElem.title = `Partially Available ${busySlots}`;
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
    
    setupEventListeners();
    if (sessionId) {
        await api.loadSessionFromAirtable(sessionId);
        ui.updateHeader();

        const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        if (savedDate && Array.isArray(savedDate) && savedDate.length === 2) {
            mainDatePicker.setDate([savedDate[0], savedDate[1]], true);
        }
    } else {
        state.session.isOwned = true;
    }
    
    ui.toggleLoading(false);
    renderTopLevel();
    ui.updateFavoritesCarousel();
    updateSaveShareButton();
}

function setupEventListeners() {
    // --- AUTOSAVE TRIGGERS ---
    ui.headerEventNameInput.addEventListener('change', (e) => { 
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
    });
    document.getElementById('header-headcount').addEventListener('change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GUEST_COUNT, e.target.value);
        triggerSave();
    });
    document.getElementById('header-goals').addEventListener('change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
    });
    // --- BETA TOOLKIT ---
    document.getElementById('beta-trigger').addEventListener('click', () => {
        document.getElementById('beta-toolkit').classList.toggle('visible');
    });
    // --- MAIN DATE PICKER ---
    mainDatePicker = flatpickr("#header-date", {
        mode: "range",
        enableTime: true,
        dateFormat: "M j, Y h:i K", // e.g., Aug 26, 2025 05:30 PM
        onClose: (selectedDates) => {
            if (selectedDates.length === 2) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                triggerSave();
                updateAllCardAvailabilityIcons();
            }
        },
        onDayCreate: async (dObj, dStr, fp, dayElem) => {
            const day = dayElem.dateObj;
            const favoritedRecords = Array.from(state.cart.items.keys())
                .map(id => state.records.all.find(r => r.id === id))
                .filter(record => record);

            if (favoritedRecords.length === 0) {
                dayElem.classList.add('flatpickr-available');
                tippy(dayElem, { content: 'Available' });
                return;
            }

            const busyTimePromises = favoritedRecords.map(record => api.fetchCalendarForRecord(record));
            const allBusyTimes = await Promise.all(busyTimePromises);
            let finalStatus = AVAILABILITY_STATUS.FULL;
            let tooltipContent = [`<strong>${day.toLocaleDateString()}</strong><hr>`];

            for (let i = 0; i < favoritedRecords.length; i++) {
                const record = favoritedRecords[i];
                const busyTimes = allBusyTimes[i];
                const status = getDayStatus(day, busyTimes, record);
                
                let statusIcon = '✅';
                let statusText = `Available`;
                if (status === AVAILABILITY_STATUS.NONE) {
                    finalStatus = AVAILABILITY_STATUS.NONE;
                    statusIcon = '❌';
                    statusText = 'Unavailable';
                } else if (status === AVAILABILITY_STATUS.PARTIAL) {
                    if (finalStatus !== AVAILABILITY_STATUS.NONE) {
                        finalStatus = AVAILABILITY_STATUS.PARTIAL;
                    }
                    statusIcon = '🟠';
                    const busySlots = getBusySlotsForDay(day, busyTimes);
                    statusText = `Partial ${busySlots}`;
                }
                tooltipContent.push(`<span>${statusIcon} ${record.fields.Name}: ${statusText}</span>`);
            }
            
            if (finalStatus === AVAILABILITY_STATUS.NONE) {
                dayElem.classList.add('flatpickr-disabled');
            } else if (finalStatus === AVAILABILITY_STATUS.PARTIAL) {
                dayElem.classList.add('flatpickr-partial');
            } else {
                dayElem.classList.add('flatpickr-available');
            }
            
            tippy(dayElem, {
                content: tooltipContent.join('<br>'),
                allowHTML: true,
            });
        }
    });

    // --- NAVIGATION GUARD ---
    window.addEventListener('beforeunload', (e) => {
        if (state.ui.saveState === 'MODIFIED' || state.ui.saveState === 'SAVING') {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    });
    // --- UNIFIED CLICK LISTENER ---
    document.body.addEventListener('click', async (e) => {
        const heartIcon = e.target.closest('.heart-icon');
        const parentBtn = e.target.closest('.parent-btn');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');
        const availabilityBtn = e.target.closest('.availability-btn');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const removeBtn = e.target.closest('.remove-btn');

        if (saveShareBtn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => {
                    saveShareBtn.textContent = originalText;
                }, 1500);
            });
        } else if (availabilityBtn) {
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
            mainDatePicker.redraw();
            triggerSave();
        } else if (removeBtn) {
            e.stopPropagation();
            const favoriteCard = removeBtn.closest('.favorite-item');
            if (!favoriteCard) return;
    
            const recordId = favoriteCard.dataset.recordId;
            
            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
            }
    
            const mainCatalogCard = document.querySelector(`.event-card[data-record-id="${recordId}"]`);
            if (mainCatalogCard) {
                const heart = mainCatalogCard.querySelector('.heart-icon');
                if (heart) {
                    heart.classList.remove('hearted');
                }
            }
            
            await ui.updateFavoritesCarousel();
            mainDatePicker.redraw();
            triggerSave();
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
