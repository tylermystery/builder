/*
 * Version: 3.12.1
 * Last Modified: 2025-08-28
 *
 * Changelog:
 *
 * v3.12.1 - 2025-08-28
 * - Replaced the native browser tooltip on card availability icons with a tippy.js tooltip.
 * - Positioned the new tooltip above the icon as requested.
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
    const searchTerm = document.getElementById('name-filter').value.toLowerCase();
    const activeCategoryNodes = document.querySelectorAll('#category-filters .category-filter-btn.active');
    const activeCategories = Array.from(activeCategoryNodes).map(btn => btn.dataset.filter.toLowerCase());
    const priceFilter = document.getElementById('price-filter').value;
    const sortBy = document.getElementById('sort-by').value;
    let recordsToDisplay = state.records.all;

    if (activeCategories.length > 0) {
        recordsToDisplay = recordsToDisplay.filter(record => {
            const recordTags = [
                ...(record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || []),
                ...(record.fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || [])
            ].map(t => t.toLowerCase());
            return activeCategories.some(cat => recordTags.includes(cat));
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
            // Destroy previous tippy instance if it exists to prevent memory leaks
            if (icon._tippy) {
                icon._tippy.destroy();
            }

            let statusIcon, statusText, titleText;
            if (dayStatus === AVAILABILITY_STATUS.NONE || !isAvailable) {
                icon.textContent = '❌';
                statusIcon = '❌';
                statusText = 'Unavailable';
                titleText = 'Unavailable';
            } else if (dayStatus === AVAILABILITY_STATUS.PARTIAL) {
                icon.textContent = '🟠';
                statusIcon = '🟠';
                statusText = 'Partially Available';
                titleText = 'Partially Available';
            } else {
                icon.textContent = '✅';
                statusIcon = '✅';
                statusText = 'Fully Available';
                titleText = 'Fully Available';
            }
            
            const dateString = startDate.toLocaleDateString();
            const tooltipContent = `
                <div style="text-align: left;">
                    <strong>${dateString}</strong>
                    <hr style="margin: 2px 0 5px;">
                    <span>${statusIcon} ${record.fields.Name}: ${statusText}</span>
                 </div>
            `;
            tippy(icon, {
                content: tooltipContent,
                allowHTML: true,
                placement: 'top',
                arrow: true,
            });
            icon.title = titleText; // Keep native title as a simple fallback
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
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) {
            element.addEventListener(event, handler);
        } else {
            console.warn(`Element with ID "${selector}" not found.`);
        }
    };

    // --- FILTER & RESET LISTENERS ---
    safeAddEventListener('name-filter', 'input', debounce(() => applyFiltersAndSort()));
    document.getElementById('category-filters')?.addEventListener('click', (e) => {
        if (e.target.classList.contains('category-filter-btn')) {
            e.target.classList.toggle('active');
            applyFiltersAndSort();
        }
    });
    safeAddEventListener('price-filter', 'change', applyFiltersAndSort);
    safeAddEventListener('sort-by', 'change', applyFiltersAndSort);
    safeAddEventListener('reset-filters-btn', 'click', () => {
        document.getElementById('name-filter').value = '';
        document.getElementById('price-filter').selectedIndex = 0;
        document.getElementById('sort-by').selectedIndex = 0;
        document.querySelectorAll('#category-filters .category-filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
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
