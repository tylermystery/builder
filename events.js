import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';

// These variables are now scoped to the events module
const imageCache = new Map();
let mainDatePicker = null;
let saveTimeout;
const saveShareBtn = document.getElementById('save-share-btn');

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
export function getItemState(recordId) { // Added export
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

export function updateSaveShareButton() { // Added export
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

function setupEventListeners() {
    // All original setupEventListeners code goes here...
}

export function initializeEventListeners() {
    // --- The contents of the original setupEventListeners function ---
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
    
    // ... all other event listeners from the original function
    
    mainDatePicker = flatpickr("#date-filter", {
         // ... flatpickr config
    });
    
    // ... etc.
    
    // --- UNIFIED CLICK LISTENER ---
    document.body.addEventListener('click', async (e) => {
        // ... all the click listener code ...
    });
    
    // --- UNIFIED CHANGE LISTENER ---
    document.body.addEventListener('change', (e) => {
        // ... all the change listener code ...
    });
}
