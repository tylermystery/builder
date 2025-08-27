/*
 * Version: 3.8.0
 * Last Modified: 2025-08-27
 *
 * Changelog:
 *
 * v3.8.0 - 2025-08-27
 * - Implemented Detailed Item View modal.
 * - Unified click listener now opens modal on card click and handles closing.
 *
 * v3.7.1 - 2025-08-27
 * - Added a "Reset" button to clear all active filters and searches.
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
async function updateAllCardAvailabilityIcons() { /* ... unchanged ... */ }
async function showItemDetailCalendar(record, targetElement) { /* ... unchanged ... */ }

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
    /* ... unchanged ... */
    // --- BETA TOOLKIT ---
    /* ... unchanged ... */
    // --- MAIN DATE PICKER ---
    /* ... unchanged ... */
    // --- NAVIGATION GUARD ---
    /* ... unchanged ... */

    // --- UNIFIED CLICK LISTENER ---
    document.body.addEventListener('click', async (e) => {
        // Modal Closing Logic
        if (e.target.matches('#detail-modal-overlay, #modal-close-btn')) {
            ui.hideDetailModal();
            return;
        }
        if (e.target.closest('.modal-content')) {
            return; // Ignore clicks inside the modal content
        }

        // Existing Button & Card Logic
        const heartIcon = e.target.closest('.heart-icon');
        const parentBtn = e.target.closest('.parent-btn');
        const explodeBtn = e.target.closest('.explode-btn');
        const implodeBtn = e.target.closest('.implode-btn');
        const availabilityBtn = e.target.closest('.availability-btn');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const removeBtn = e.target.closest('.remove-btn');
        const card = e.target.closest('.event-card');

        if (saveShareBtn) { /* ... unchanged ... */ } 
        else if (availabilityBtn) { /* ... unchanged ... */ }
        else if (heartIcon) { /* ... unchanged ... */ }
        else if (removeBtn) { /* ... unchanged ... */ }
        else if (parentBtn) { /* ... unchanged ... */ }
        else if (explodeBtn) { /* ... unchanged ... */ }
        else if (implodeBtn) { /* ... unchanged ... */ }
        else if (card) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                // Pre-fetch images and cache them on the record object before showing modal
                record.cachedImages = await api.fetchImagesForRecord(record, state.records.all, imageCache);
                ui.showDetailModal(record);
            }
        }
    });

    // --- UNIFIED CHANGE LISTENER ---
    /* ... unchanged ... */
}

initialize();
