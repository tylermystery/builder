/*
 * Version: 4.3.1
 * Last Modified: 2025-08-29
 *
 * Changelog:
 *
 * v4.3.1 - 2025-08-29
 * - Restored "Checkout" button functionality.
 *
 * v4.3.0 - 2025-08-29
 * - Implemented the "One-Way Street" model for item state.
 * - "Add to Plan" now moves an item from Favorites to the Event Plan.
 * - Editing a locked item now correctly updates the Event Plan.
 * - Added logic for the new "Remove from Plan" button.
 *
 * v4.2.2 - 2025-08-29
 * - Restored "Edit" button functionality for items in the Event Plan.
 *
 * v4.2.1 - 2025-08-29
 * - Fixed core state management bugs and restored button functionalities.
 */

import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { getStoredSessions, storeSession } from './session.js';
import { parseOptions } from './utils.js';
import { getDayStatus, checkAvailability, getBusySlotsForDay, AVAILABILITY_STATUS } from './availability.js';
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

// --- STATE MANAGEMENT HELPERS ---
function getItemState(recordId) {
    const record = state.records.all.find(r => r.id === recordId);
    if (!record) return null;

    const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const defaultState = {
        quantity: headcountMin,
        selectedOptionIndex: 0,
        note: ''
    };
    return state.cart.items.get(recordId) || defaultState;
}

function updateItemState(recordId, updates) {
    if (!state.records.all.find(r => r.id === recordId)) return;
    
    if (!state.cart.items.has(recordId)) {
        state.cart.items.set(recordId, getItemState(recordId));
    }
    
    const currentState = state.cart.items.get(recordId);
    const newState = { ...currentState, ...updates };
    state.cart.items.set(recordId, newState);
    
    ui.updateFavoritesCarousel();
    triggerSave();
}

function updateLockedItemState(recordId, updates) {
    if (!state.cart.lockedItems.has(recordId)) return;
    
    const currentState = state.cart.lockedItems.get(recordId);
    const newState = { ...currentState, ...updates };
    state.cart.lockedItems.set(recordId, newState);
    
    ui.updateEventPlanPanel();
    ui.updateTotalCost();
    triggerSave();
}


// --- INFINITE SCROLL LOGIC ---
function loadMoreRecords() {
    if (state.ui.isLoadingMore) return;

    const start = state.ui.recordsCurrentlyDisplayed;
    const end = start + RECORDS_PER_LOAD;
    const recordsToLoad = state.records.filtered.slice(start, end);

    if (recordsToLoad.length > 0) {
        state.ui.isLoadingMore = true;
        ui.renderRecords(recordsToLoad, imageCache, true).then(() => {
            state.ui.recordsCurrentlyDisplayed += recordsToLoad.length;
            state.ui.isLoadingMore = false;
        });
    }
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
    const headcountFilter = document.getElementById('headcount-filter').value;
    const customHeadcount = document.getElementById('headcount-custom').value;
    const locationFilter = document.getElementById('location-filter').value;
    const budgetFilter = document.getElementById('budget-filter').value;
    const categoryFilter = document.getElementById('category-filter').value;
    const sortBy = document.getElementById('sort-by').value;
    
    let recordsToDisplay = state.records.all;

    if (headcountFilter !== 'any' || (headcountFilter === 'custom' && customHeadcount)) {
        let min = 0, max = Infinity;
        if (headcountFilter === 'custom') {
            min = parseInt(customHeadcount, 10) || 0;
            max = min;
        } else {
            const [minStr, maxStr] = headcountFilter.split('-');
            min = parseInt(minStr, 10);
            max = maxStr === 'plus' ? Infinity : parseInt(maxStr, 10);
        }
        recordsToDisplay = recordsToDisplay.filter(record => {
            const recordMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
            const recordMax = record.fields['Headcount max'] || Infinity; 
            return recordMin <= max && recordMax >= min;
        });
    }

    if (locationFilter !== 'any') {
        recordsToDisplay = recordsToDisplay.filter(record => {
            return record.fields['Location']?.toLowerCase().replace(/\s+/g, '-') === locationFilter;
        });
    }

    if (budgetFilter !== 'any') {
        const BUDGET_RANGES = {
            'budget-friendly': { min: 0, max: 50 },
            'moderate': { min: 51, max: 100 },
            'executive': { min: 101, max: 250 },
            'luxury': { min: 251, max: Infinity }
        };
        const range = BUDGET_RANGES[budgetFilter];
        recordsToDisplay = recordsToDisplay.filter(record => {
             const price = ui.getGroupPriceRange(record)?.min ?? parseFloat(String(record.fields.Price || '0').replace(/[^0-9.-]+/g, ""));
             return price >= range.min && price <= range.max;
        });
    }

    if (categoryFilter !== 'any') {
        recordsToDisplay = recordsToDisplay.filter(record => {
            const getTagsFromString = (str) => {
                if (!str || typeof str !== 'string') return [];
                return str.split(',').map(tag => tag.trim().toLowerCase());
            };
            const recordTags = [
                ...getTagsFromString(record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES]),
                ...getTagsFromString(record.fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES])
            ];
            return recordTags.includes(categoryFilter.toLowerCase());
        });
    }

    if (searchTerm) {
        const scoredRecords = [];
        recordsToDisplay.forEach(record => {
            let score = 0;
            const fields = record.fields;
            const name = (fields.Name || '').toLowerCase();
            const description = (fields.Description || '').toLowerCase();
            const tags = [...(fields[CONSTANTS.FIELD_NAMES.CATEGORIES]?.split(',') || []), ...(fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES]?.split(',') || []), ...(fields[CONSTANTS.FIELD_NAMES.MEDIA_TAGS]?.split(',') || [])].map(t => t.toLowerCase().trim());
            
           if (name.includes(searchTerm)) score = 3;
            else if (description.includes(searchTerm)) score = 2;
            else if (tags.some(tag => tag.includes(searchTerm))) score = 1;
            if (score > 0) { scoredRecords.push({ record, score }); }
        });
        scoredRecords.sort((a, b) => b.score - a.score);
        recordsToDisplay = scoredRecords.map(item => item.record);
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

    state.records.filtered = recordsToDisplay;
    state.ui.recordsCurrentlyDisplayed = 0;
    
    const initialRecords = state.records.filtered.slice(0, RECORDS_PER_LOAD);
    ui.renderRecords(initialRecords, imageCache, false).then(() => {
        state.ui.recordsCurrentlyDisplayed = initialRecords.length;
    });
}

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
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) element.addEventListener(event, handler);
        else console.warn(`Element with ID "${selector}" not found.`);
    };

    let scrollTimeout;
    window.addEventListener('scroll', () => {
        if (scrollTimeout) return;
        scrollTimeout = setTimeout(() => {
            const buffer = 300;
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - buffer) {
                loadMoreRecords();
            }
            scrollTimeout = null;
        }, 100);
    });

    safeAddEventListener('name-filter', 'input', debounce(() => applyFiltersAndSort()));
    safeAddEventListener('headcount-custom', 'input', debounce(() => applyFiltersAndSort()));
    safeAddEventListener('headcount-filter', 'change', (e) => {
        document.getElementById('headcount-custom').style.display = (e.target.value === 'custom') ? 'block' : 'none';
        applyFiltersAndSort();
    });
    safeAddEventListener('location-filter', 'change', applyFiltersAndSort);
    safeAddEventListener('budget-filter', 'change', applyFiltersAndSort);
    safeAddEventListener('category-filter', 'change', applyFiltersAndSort);
    safeAddEventListener('sort-by', 'change', applyFiltersAndSort);

    safeAddEventListener('reset-filters-btn', 'click', () => {
        document.getElementById('name-filter').value = '';
        document.getElementById('headcount-filter').selectedIndex = 0;
        document.getElementById('headcount-custom').value = '';
        document.getElementById('headcount-custom').style.display = 'none';
        document.getElementById('location-filter').selectedIndex = 0;
        document.getElementById('budget-filter').selectedIndex = 0;
        document.getElementById('category-filter').selectedIndex = 0;
        document.getElementById('sort-by').selectedIndex = 0;
        mainDatePicker.clear();
        applyFiltersAndSort();
    });

    mainDatePicker = flatpickr("#date-filter", {
        mode: "range", enableTime: true, dateFormat: "M j, Y h:i K",
        onClose: (selectedDates) => {
            if (selectedDates.length === 2) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                triggerSave();
                updateAllCardAvailabilityIcons();
            }
        },
    });

    safeAddEventListener('header-event-name', 'change', (e) => { 
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
    });
    safeAddEventListener('header-goals', 'change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
    });
    
    safeAddEventListener('payment-form', 'submit', async (e) => {
        e.preventDefault();
        const { stripe, cardElement, clientSecret } = ui.getStripeContext();
        if (!stripe || !cardElement || !clientSecret) return;
        const { error } = await stripe.confirmCardPayment(clientSecret, {
            payment_method: {
                card: cardElement,
                billing_details: {
                    name: document.getElementById('customer-name').value,
                    email: document.getElementById('customer-email').value,
                },
            },
        });
        const cardErrors = document.getElementById('card-errors');
        if (error) cardErrors.textContent = error.message;
        else {
            cardErrors.textContent = '';
            alert('Payment successful! Your event is booked.');
            ui.hideCheckoutModal();
        }
    });

    window.addEventListener('beforeunload', (e) => {
        if (state.ui.saveState === 'MODIFIED' || state.ui.saveState === 'SAVING') {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    });
    
    // --- UNIFIED CLICK LISTENER ---
    document.body.addEventListener('click', async (e) => {
        if (e.target.matches('#detail-modal-overlay, #modal-close-btn')) { ui.hideDetailModal(); return; }
        if (e.target.matches('#checkout-modal-overlay, #checkout-close-btn')) { ui.hideCheckoutModal(); return; }
        
        const card = e.target.closest('.event-card');
        const heartIcon = e.target.closest('.heart-icon:not(.locked)');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const addToPlanBtn = e.target.closest('#modal-add-to-plan-btn');
        const favoriteItem = e.target.closest('.favorite-item');
        const removeBtn = favoriteItem?.querySelector('.remove-btn');
        const editBtn = e.target.closest('.edit-btn');
        const removeLockedItemBtn = e.target.closest('.remove-locked-item-btn');
        const checkoutBtn = e.target.closest('#checkout-btn'); // **THE FIX**

        if (saveShareBtn) {
             navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            });
        } else if (checkoutBtn) { // **THE FIX**
            ui.showCheckoutModal();
        } else if (heartIcon) {
            e.stopPropagation();
            const recordId = heartIcon.closest('[data-record-id]').dataset.recordId;
            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
            } else {
                updateItemState(recordId, {}); 
            }
            ui.updateCardIcon(recordId);
            await ui.updateFavoritesCarousel();
            triggerSave();
        } else if (addToPlanBtn) {
            const modal = addToPlanBtn.closest('#detail-modal-overlay');
            const recordId = modal.dataset.recordId;
            const mode = modal.dataset.mode;
            
            const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
            const selectedOptionEl = document.querySelector('#modal-options-container .option-btn.selected');
            const noteInput = document.getElementById('modal-item-note');
            
            const currentItemInfo = {
                quantity: quantityInput ? parseInt(quantityInput.value, 10) : 1,
                selectedOptionIndex: selectedOptionEl ? parseInt(selectedOptionEl.dataset.optionIndex, 10) : 0,
                note: noteInput ? noteInput.value.trim() : ''
            };

            if (mode === 'edit-locked') {
                updateLockedItemState(recordId, currentItemInfo);
            } else {
                state.cart.lockedItems.set(recordId, currentItemInfo);
                state.cart.items.delete(recordId);
            }
            
            ui.updateCardIcon(recordId);
            await ui.updateFavoritesCarousel();
            await ui.updateEventPlanPanel();
            ui.updateTotalCost();
            triggerSave();
            ui.hideDetailModal();
        } else if (editBtn) {
            const lockedItemCard = editBtn.closest('.locked-item-card');
            if (!lockedItemCard) return;
            const recordId = lockedItemCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        } else if (removeLockedItemBtn) {
             const lockedItemCard = removeLockedItemBtn.closest('.locked-item-card');
             if (!lockedItemCard) return;
             const recordId = lockedItemCard.dataset.recordId;
             state.cart.lockedItems.delete(recordId);
             ui.updateCardIcon(recordId);
             await ui.updateEventPlanPanel();
             ui.updateTotalCost();
             triggerSave();
        } else if (removeBtn && e.target === removeBtn) {
            e.stopPropagation();
            const recordId = favoriteItem.dataset.recordId;
            state.cart.items.delete(recordId);
            ui.updateCardIcon(recordId);
            await ui.updateFavoritesCarousel();
            triggerSave();
        } else if (favoriteItem) {
            const recordId = favoriteItem.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        } else if (card) {
            if (e.target.closest('.options-selector, .quantity-selector, .parent-link, .item-note, .heart-icon')) return;
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        }
    });

    // --- UNIFIED CHANGE LISTENER ---
    document.body.addEventListener('change', (e) => {
        const target = e.target;
        const modal = document.getElementById('detail-modal-overlay');
        const container = target.closest('[data-record-id]');
        
        const isInModal = modal.style.display === 'flex' && modal.contains(target);
        const isEditLockedMode = isInModal && modal.dataset.mode === 'edit-locked';
        
        if (!container) return;
        const recordId = container.dataset.recordId;
        
        let updates = {};
        if (target.matches('.quantity-input')) {
            updates.quantity = parseInt(target.value, 10);
        } else if (target.matches('.configure-options')) {
            updates.selectedOptionIndex = parseInt(target.value, 10);
        } else if (target.matches('.item-note, #modal-item-note')) {
            updates.note = target.value;
        } else if (target.matches('.option-btn')) {
            if(e.detail?.selectedOptionIndex !== undefined) {
                 updates.selectedOptionIndex = e.detail.selectedOptionIndex;
            }
        }
        
        if (Object.keys(updates).length > 0) {
            if (isEditLockedMode) {
                updateLockedItemState(recordId, updates);
            } else {
                updateItemState(recordId, updates);
            }
        }
    });
}

initialize();
