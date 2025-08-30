/*
 * Version: 4.0.0
 * Last Modified: 2025-08-29
 *
 * Changelog:
 *
 * v4.0.0 - 2025-08-29
 * - Refactored to support the new consolidated filter panel in the left sidebar.
 * - Moved date picker and headcount logic from the main header to the sidebar.
 * - Implemented new filtering logic for Headcount, Location, and Budget.
 * - Replaced category filter buttons with a more scalable dropdown menu.
 * - Relocated the Sort By dropdown logic to the new catalog toolbar.
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
function applyFiltersAndSort() {
    // 1. Get all filter values from the new UI
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const headcountFilter = document.getElementById('headcount-filter').value;
    const customHeadcount = document.getElementById('headcount-custom').value;
    const locationFilter = document.getElementById('location-filter').value;
    const budgetFilter = document.getElementById('budget-filter').value;
    const categoryFilter = document.getElementById('category-filter').value;
    const sortBy = document.getElementById('sort-by').value;
    
    let recordsToDisplay = state.records.all;

    // 2. Apply each filter sequentially

    // HEADCOUNT FILTER
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
            // Assuming a max headcount field might exist, otherwise check against min
            const recordMax = record.fields['Headcount max'] || Infinity; 
            return recordMin <= max && recordMax >= min;
        });
    }

    // LOCATION FILTER (Assumes a 'Location' field in Airtable)
    if (locationFilter !== 'any') {
        recordsToDisplay = recordsToDisplay.filter(record => {
            return record.fields['Location']?.toLowerCase().replace(/\s+/g, '-') === locationFilter;
        });
    }

    // BUDGET FILTER (Maps friendly names to price ranges)
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

    // CATEGORY FILTER
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

    // SEARCH TERM FILTER
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
    
    // 3. Apply Sorting
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

    // 4. Render the final list of records
    ui.renderRecords(recordsToDisplay, imageCache);
}

// --- AVAILABILITY LOGIC ---
async function updateAllCardAvailabilityIcons() {
    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) {
        return;
    }
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
            if (icon._tippy) {
                icon._tippy.destroy();
            }
            let statusIcon, statusText;
            if (dayStatus === AVAILABILITY_STATUS.NONE || !isAvailable) {
                statusIcon = '❌';
                statusText = 'Unavailable';
            } else if (dayStatus === AVAILABILITY_STATUS.PARTIAL) {
                statusIcon = '🟠';
                statusText = 'Partially Available';
            } else {
                statusIcon = '✅';
                statusText = 'Fully Available';
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
        ui.updateHeader(); // Still need to update event name/goals
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

    // --- NEW FILTER LISTENERS ---
    safeAddEventListener('name-filter', 'input', debounce(() => applyFiltersAndSort()));
    safeAddEventListener('headcount-custom', 'input', debounce(() => applyFiltersAndSort()));
    safeAddEventListener('headcount-filter', 'change', (e) => {
        const customInput = document.getElementById('headcount-custom');
        customInput.style.display = (e.target.value === 'custom') ? 'block' : 'none';
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

    // --- MAIN DATE PICKER (Now in sidebar) ---
    mainDatePicker = flatpickr("#date-filter", {
        mode: "range",
        enableTime: true,
        dateFormat: "M j, Y h:i K",
        onClose: (selectedDates) => {
            if (selectedDates.length === 2) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                triggerSave(); // Autosave date changes
                updateAllCardAvailabilityIcons();
            }
        },
    });

    // --- AUTOSAVE TRIGGERS (For header fields) ---
    safeAddEventListener('header-event-name', 'change', (e) => { 
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
    });
    safeAddEventListener('header-goals', 'change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
    });
    
    // --- PAYMENT FORM SUBMISSION ---
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

    // --- NAVIGATION GUARD ---
    window.addEventListener('beforeunload', (e) => {
        if (state.ui.saveState === 'MODIFIED' || state.ui.saveState === 'SAVING') {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    });
    
    // --- UNIFIED CLICK LISTENER (No changes needed here for now) ---
    document.body.addEventListener('click', async (e) => {
        if (e.target.matches('#detail-modal-overlay, #modal-close-btn')) {
            ui.hideDetailModal();
            return;
        }
        if (e.target.matches('#checkout-modal-overlay, #checkout-close-btn')) {
            ui.hideCheckoutModal();
            return;
        }
        const card = e.target.closest('.event-card');
        const heartIcon = e.target.closest('.heart-icon');
        const saveShareBtn = e.target.closest('#save-share-btn');
        // ... (rest of the unified click listener is largely unaffected)
        if (saveShareBtn) {
             navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            });
        } else if (heartIcon) {
            e.stopPropagation();
            const recordId = heartIcon.closest('[data-record-id]').dataset.recordId;
            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
            } else {
                state.cart.items.set(recordId, { quantity: 1 });
            }
            heartIcon.classList.toggle('hearted', state.cart.items.has(recordId));
            document.getElementById('modal-heart-btn')?.classList.toggle('hearted', state.cart.items.has(recordId));
            await ui.updateFavoritesCarousel();
            triggerSave();
        } else if (card) {
            if (e.target.closest('.options-selector, .quantity-selector, .parent-link')) {
                return;
            }
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                ui.showDetailModal(record);
            }
        }
    });
}

initialize();

