/*
 * Version: 3.9.5
 * Last Modified: 2025-08-29
 *
 * Changelog:
 *
 * v3.9.5 - 2025-08-29
 * - Refactored all click handling into a single, unified listener on document.body.
 * - Removed separate listener for filter panel to resolve interaction conflicts.
 *
 * v3.9.4 - 2025-08-29
 * - Implemented interactive filter panel with accordion and filtering logic.
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
function isDescendantOf(record, categoryName, allRecords) {
    let current = record;
    while (current && current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]) {
        const parentName = current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
        if (parentName === categoryName) {
            return true;
        }
        current = allRecords.find(r => r.fields.Name === parentName);
    }
    return false;
}

function applyFiltersAndSort() {
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const priceFilter = document.getElementById('price-filter').value;
    const sortBy = document.getElementById('sort-by').value;
    const categoryFilter = state.ui.activeCategoryFilter;

    let recordsToDisplay = state.records.all;

    if (categoryFilter) {
        recordsToDisplay = recordsToDisplay.filter(record => {
            return record.fields.Name === categoryFilter || isDescendantOf(record, categoryFilter, state.records.all);
        });
    }

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
    } else if (!categoryFilter) {
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
    ui.renderFilterPanel();
    applyFiltersAndSort();
    ui.updateFavoritesCarousel();
    updateSaveShareButton();
}

function setupEventListeners() {
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) {
            element.addEventListener(event, handler);
        } else {
            console.warn(`Element with ID "${selector}" not found.`);
        }
    };

    // --- TOP FILTER & RESET LISTENERS ---
    safeAddEventListener('name-filter', 'input', debounce(() => applyFiltersAndSort()));
    safeAddEventListener('price-filter', 'change', applyFiltersAndSort);
    safeAddEventListener('sort-by', 'change', applyFiltersAndSort);
    safeAddEventListener('reset-filters-btn', 'click', () => {
        document.getElementById('name-filter').value = '';
        document.getElementById('price-filter').selectedIndex = 0;
        document.getElementById('sort-by').selectedIndex = 0;
        state.ui.activeCategoryFilter = null;
        document.querySelectorAll('#filter-panel li, #filter-panel h4').forEach(el => el.classList.remove('active'));
        applyFiltersAndSort();
    });

    // --- PAYMENT FORM SUBMISSION ---
    safeAddEventListener('payment-form', 'submit', async (e) => {
        e.preventDefault();
        const { stripe, cardElement, clientSecret } = ui.getStripeContext();
        if (!stripe || !cardElement || !clientSecret) return;

        const { error } = await stripe.confirmCardPayment(
            clientSecret, {
                payment_method: {
                    card: cardElement,
                    billing_details: {
                        name: document.getElementById('customer-name').value,
                        email: document.getElementById('customer-email').value,
                    },
                },
            }
        );

        const cardErrors = document.getElementById('card-errors');
        if (error) {
            cardErrors.textContent = error.message;
        } else {
            cardErrors.textContent = '';
            alert('Payment successful! Your event is booked.');
            ui.hideCheckoutModal();
        }
    });

    // --- AUTOSAVE TRIGGERS ---
    safeAddEventListener('header-event-name', 'change', (e) => { 
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
    });
    safeAddEventListener('header-headcount', 'change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GUEST_COUNT, e.target.value);
        triggerSave();
    });
    safeAddEventListener('header-goals', 'change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
    });

    // --- BETA TOOLKIT ---
    safeAddEventListener('beta-trigger', 'click', () => {
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
        // Modal Closing Logic
        if (e.target.matches('#detail-modal-overlay, #modal-close-btn')) { ui.hideDetailModal(); return; }
        if (e.target.matches('#checkout-modal-overlay, #checkout-close-btn')) { ui.hideCheckoutModal(); return; }

        // Filter Panel Logic
        const categoryHeader = e.target.closest('#filter-panel h4');
        const subcategoryItem = e.target.closest('#filter-panel li');

        // Other interaction targets
        const modalHeartBtn = e.target.closest('#modal-heart-btn');
        const modalExplodeBtn = e.target.closest('#modal-explode-btn');
        if(e.target.closest('.modal-content') && !modalHeartBtn && !modalExplodeBtn) { return; }

        const heartIcon = e.target.closest('.heart-icon:not(#modal-heart-btn)');
        const parentBtn = e.target.closest('.parent-btn');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');
        const availabilityBtn = e.target.closest('.availability-btn');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const checkoutBtn = e.target.closest('#checkout-btn');
        const removeBtn = e.target.closest('.remove-btn');
        const card = e.target.closest('.event-card');
        const favoriteItem = e.target.closest('.favorite-item');

        // Prioritized Interaction Logic
        if (categoryHeader || subcategoryItem) {
            if (categoryHeader && !subcategoryItem) {
                categoryHeader.parentElement.classList.toggle('open');
            }
            const target = subcategoryItem || categoryHeader;
            const categoryName = target.dataset.category;

            if (state.ui.activeCategoryFilter === categoryName) {
                state.ui.activeCategoryFilter = null;
            } else {
                state.ui.activeCategoryFilter = categoryName;
            }

            document.querySelectorAll('#filter-panel li, #filter-panel h4').forEach(el => el.classList.remove('active'));
            if (state.ui.activeCategoryFilter) {
                document.querySelector(`#filter-panel [data-category="${state.ui.activeCategoryFilter}"]`)?.classList.add('active');
            }
            applyFiltersAndSort();
        }
        else if (saveShareBtn) { /* ... */ } 
        else if (checkoutBtn) { /* ... */ }
        else if (availabilityBtn) { /* ... */ }
        else if (heartIcon || modalHeartBtn) { /* ... */ }
        else if (removeBtn) { /* ... */ }
        else if (parentBtn) { /* ... */ }
        else if (explodeBtn || modalExplodeBtn) { /* ... */ }
        else if (implodeBtn) { /* ... */ }
        else if (favoriteItem) { /* ... */ }
        else if (card) { /* ... */ }
    });

    // --- UNIFIED CHANGE LISTENER ---
    document.body.addEventListener('change', async (e) => { /* ... unchanged ... */ });
}

initialize();
