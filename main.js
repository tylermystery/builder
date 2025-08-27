/*
 * Version: 3.8.4
 * Last Modified: 2025-08-27
 *
 * Changelog:
 *
 * v3.8.4 - 2025-08-27
 * - Made DOM element selection in event listeners more robust to prevent load-time errors.
 *
 * v3.8.3 - 2025-08-27
 * - Unified click listener now handles heart and explode buttons within the detail modal.
 */

import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { getStoredSessions, storeSession } from './session.js';
import { parseOptions } from './utils.js';
import { getDayStatus, checkAvailability, getBusySlotsForDay } from './availability.js';
const imageCache = new Map();
let mainDatePicker = null;

// --- UTILITY FUNCTIONS ---
function debounce(func, delay = 300) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

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
function applyFiltersAndSort() {
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const priceFilter = document.getElementById('price-filter').value;
    const sortBy = document.getElementById('sort-by').value;
    let recordsToDisplay = state.records.all;

    if (searchTerm) {
        const scoredRecords = [];
        recordsToDisplay.forEach(record => {
            let score = 0;
            const fields = record.fields;
            const name = (fields.Name || '').toLowerCase();
            const description = (fields.Description || '').toLowerCase();
            const tags = [...(fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || []), ...(fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || []), ...(fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]?.split(',') || [])].map(t => t.toLowerCase().trim());
            if (name.includes(searchTerm)) score = 3;
            else if (description.includes(searchTerm)) score = 2;
            else if (tags.some(tag => tag.includes(searchTerm))) score = 1;
            if (score > 0) { scoredRecords.push({ record, score }); }
        });
        scoredRecords.sort((a, b) => b.score - a.score);
        recordsToDisplay = scoredRecords.map(item => item.record);
    } else {
        recordsToDisplay = recordsToDisplay.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    }

    if (priceFilter !== 'all') {
        const [minStr, maxStr] = priceFilter.split('-');
        const min = parseFloat(minStr);
        const max = maxStr === 'plus' ? Infinity : parseFloat(maxStr);
        recordsToDisplay = recordsToDisplay.filter(record => {
            const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const childRecordNames = new Set(state.records.all.map(r => r.fields.Name));
            const isGrouping = rawOptions.some(opt => childRecordNames.has(opt.name));
            if (isGrouping) {
                const range = ui.getGroupPriceRange(record);
                return range && range.min <= max && range.max >= min;
            } else {
                const price = parseFloat(String(record.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
                return price >= min && price <= max;
            }
        });
    }

    recordsToDisplay.sort((a, b) => {
        const aPrice = ui.getGroupPriceRange(a)?.min ?? parseFloat(String(a.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
        const bPrice = ui.getGroupPriceRange(b)?.min ?? parseFloat(String(b.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
        const aName = a.fields.Name || '';
        const bName = b.fields.Name || '';
        switch (sortBy) {
            case 'price-asc': return aPrice - bPrice;
            case 'price-desc': return bPrice - aPrice;
            case 'name-asc': return aName.localeCompare(bName);
            default: return 0;
        }
    });
    ui.renderRecords(recordsToDisplay, imageCache);
}

// --- AVAILABILITY LOGIC ---
async function updateAllCardAvailabilityIcons() {
    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) { return; }
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
    applyFiltersAndSort();
    ui.updateFavoritesCarousel();
    updateSaveShareButton();
}

function setupEventListeners() {
    // --- FILTER & RESET LISTENERS ---
    const debouncedSearch = debounce(() => applyFiltersAndSort());
    document.getElementById('name-filter').addEventListener('input', debouncedSearch);
    document.getElementById('price-filter').addEventListener('change', applyFiltersAndSort);
    document.getElementById('sort-by').addEventListener('change', applyFiltersAndSort);
    document.getElementById('reset-filters-btn').addEventListener('click', () => {
        document.getElementById('name-filter').value = '';
        document.getElementById('price-filter').selectedIndex = 0;
        document.getElementById('sort-by').selectedIndex = 0;
        applyFiltersAndSort();
    });

    // --- AUTOSAVE TRIGGERS ---
    // THE FIX IS HERE: Query for the element directly instead of importing.
    document.getElementById('header-event-name').addEventListener('change', (e) => { 
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
        dateFormat: "M j, Y h:i K",
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
            if (finalStatus === AVAILABILITY_STATUS.NONE) { dayElem.classList.add('flatpickr-disabled'); }
            else if (finalStatus === AVAILABILITY_STATUS.PARTIAL) { dayElem.classList.add('flatpickr-partial'); }
            else { dayElem.classList.add('flatpickr-available'); }
            tippy(dayElem, {
                content: tooltipContent.join('<br>'),
                allowHTML: true,
                appendTo: () => document.body,
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
        if (e.target.matches('#detail-modal-overlay, #modal-close-btn')) {
            ui.hideDetailModal();
            return;
        }

        const modalHeartBtn = e.target.closest('#modal-heart-btn');
        const modalExplodeBtn = e.target.closest('#modal-explode-btn');
        if(e.target.closest('.modal-content') && !modalHeartBtn && !modalExplodeBtn) {
            return;
        }

        const heartIcon = e.target.closest('.heart-icon');
        const parentBtn = e.target.closest('.parent-btn');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');
        const availabilityBtn = e.target.closest('.availability-btn');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const removeBtn = e.target.closest('.remove-btn');
        const card = e.target.closest('.event-card');

        if (saveShareBtn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            });
        } else if (availabilityBtn) {
            e.stopPropagation();
            const record = state.records.all.find(r => r.id === availabilityBtn.closest('.event-card').dataset.recordId);
            if (record) ui.showDetailModal(record);
        } else if (heartIcon || modalHeartBtn) {
            e.stopPropagation();
            const targetElement = heartIcon || modalHeartBtn;
            const recordId = targetElement.closest('[data-record-id]').dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const isGrouping = !!(parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]).find(opt => state.records.all.some(r => r.fields.Name === opt.name)));
            let itemInfo = state.cart.items.get(recordId) || { quantity: 1, selectedOptionIndex: null, note: '' };

            if (!isGrouping) {
                const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input') || targetElement.closest('.event-card')?.querySelector('.quantity-input');
                if (quantityInput) itemInfo.quantity = parseInt(quantityInput.value);
            }

            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
            } else {
                state.cart.items.set(recordId, itemInfo);
            }

            document.querySelector(`.event-card[data-record-id="${recordId}"] .heart-icon`)?.classList.toggle('hearted', state.cart.items.has(recordId));
            document.getElementById('modal-heart-btn')?.classList.toggle('hearted', state.cart.items.has(recordId));
            
            await ui.updateFavoritesCarousel();
            mainDatePicker.redraw();
            triggerSave();
        } else if (removeBtn) {
            e.stopPropagation();
            const favoriteCard = removeBtn.closest('.favorite-item');
            if (!favoriteCard) return;
            const recordId = favoriteCard.dataset.recordId;
            if (state.cart.items.has(recordId)) { state.cart.items.delete(recordId); }
            const mainCatalogCard = document.querySelector(`.event-card[data-record-id="${recordId}"]`);
            if (mainCatalogCard) {
                mainCatalogCard.querySelector('.heart-icon')?.classList.remove('hearted');
            }
            document.getElementById('modal-heart-btn')?.classList.remove('hearted');
            await ui.updateFavoritesCarousel();
            mainDatePicker.redraw();
            triggerSave();
        } else if (parentBtn) {
            e.stopPropagation();
            const card = parentBtn.closest('.event-card');
            if (!card) return;
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const parentName = record?.fields?.[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
            const parentRecord = parentName ? state.records.all.find(p => p.fields.Name === parentName) : null;
            if (parentRecord) {
                const newCard = await ui.createInteractiveCard(parentRecord, imageCache);
                card.replaceWith(newCard);
            } else {
                applyFiltersAndSort();
            }
        } else if (explodeBtn || modalExplodeBtn) {
            e.stopPropagation();
            const recordId = (explodeBtn || modalExplodeBtn).closest('[data-record-id]').dataset.recordId;
            ui.hideDetailModal();
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
            applyFiltersAndSort();
        } else if (card) {
            if (e.target.closest('.options-selector, .quantity-selector')) {
                return;
            }
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                ui.showDetailModal(record);
            }
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
