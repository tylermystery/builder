/*
 * Version: 3.0.1
 * Last Modified: 2025-08-24
 *
 * Changelog:
 *
 * v3.0.1 - 2025-08-24
 * - Imported parseOptions from utils.js to fix circular dependency.
 *
 * v3.0.0 - 2025-08-24
 * - Implemented "Live URL" and "Fork on Edit" functionality.
 */

import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { getStoredSessions, storeSession } from './session.js';
import { parseOptions } from './utils.js'; // IMPORT ADDED

const imageCache = new Map();

// --- DEBOUNCER FOR SAVING ---
// Prevents the app from saving to Airtable on every single keystroke.
let saveTimeout;
function debouncedSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        api.saveSessionToAirtable();
    }, 1000); // Wait 1 second after the last change before saving
}

// --- CORE LOGIC ---
function renderTopLevel() {
    const topLevelRecords = state.records.all.filter(r => !r.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]);
    ui.renderRecords(topLevelRecords, imageCache);
}

// --- INITIALIZATION & MAIN FLOW ---
async function initialize() {
    ui.toggleLoading(true);
    try {
        state.records.all = await api.fetchAllRecords();
    } catch (error) {
        console.error("Failed to load records:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        return;
    }

    // --- SESSION LOADING FROM URL ---
    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');

    if (sessionId) {
        await api.loadSessionFromAirtable(sessionId);
        ui.updateHeader();
    } else {
        // This is a new session, so the user owns it.
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
    document.getElementById('header-date').addEventListener('change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, e.target.value);
        debouncedSave();
    });
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

    // --- UNIFIED CARD INTERACTION LISTENER ---
// This listener handles the dropdowns on the interactive cards.
document.body.addEventListener('change', async (e) => {
    const card = e.target.closest('.event-card');
    if (!card) return;

    // Handles configuration changes on Bookable Items.
    if (e.target.classList.contains('configure-options')) {
        const recordId = card.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);
        const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        
        const selectedIndex = parseInt(e.target.value, 10);
        const selectedOption = rawOptions[selectedIndex];
        
        // --- Update Price and Description ---
        const initialPrice = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]/g, ""));
        let newPrice = initialPrice;
        if (selectedOption) {
            if (selectedOption.absolutePrice != null) {
                newPrice = selectedOption.absolutePrice;
            } else if (selectedOption.priceChange != null) {
                newPrice += selectedOption.priceChange;
            }
        }
        card.querySelector('.price').textContent = `$${newPrice.toFixed(2)}`;
        card.querySelector('.description').textContent = selectedOption.description || record.fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '';
        
        // --- NEW: Update Image Based On Multi-Tag Search ---
        if (selectedOption) {
            const formatForTag = (name) => name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
            
            const itemTag = formatForTag(record.fields[CONSTANTS.FIELD_NAMES.NAME]);
            const optionTag = formatForTag(selectedOption.name);

            // 1. Look for images with BOTH the item and option tags.
            const optionImageUrls = await api.fetchImagesByTags([itemTag, optionTag]);
            
            if (optionImageUrls && optionImageUrls.length > 0) {
                card.style.backgroundImage = `url('${optionImageUrls[0]}')`;
            } else {
                // 2. If none found, fall back to the default item image.
                const defaultImageUrls = await api.fetchImagesForRecord(record, state.records.all, imageCache);
                card.style.backgroundImage = `url('${defaultImageUrls[0]}')`;
            }
        }
    }

    // Handles navigation changes on Grouping Items.
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
    // This listener handles the dropdowns on the interactive cards.
    document.body.addEventListener('change', async (e) => {
        const card = e.target.closest('.event-card');
        if (!card) return;

        // Handles configuration changes on Bookable Items.
        if (e.target.classList.contains('configure-options')) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const initialPrice = parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE] || '0').replace(/[^0-9.-]/g, ""));
            
            const selectedIndex = parseInt(e.target.value, 10);
            const selectedOption = rawOptions[selectedIndex];
            
            let newPrice = initialPrice;
            if (selectedOption) {
                if (selectedOption.absolutePrice != null) {
                    newPrice = selectedOption.absolutePrice;
                } else if (selectedOption.priceChange != null) {
                    newPrice += selectedOption.priceChange;
                }
            }
            card.querySelector('.price').textContent = `$${newPrice.toFixed(2)}`;
            card.querySelector('.description').textContent = selectedOption.description || record.fields[CONSTANTS.FIELD_NAMES.DESCRIPTION] || '';
        }

        // Handles navigation changes on Grouping Items.
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
