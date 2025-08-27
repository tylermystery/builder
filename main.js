/*
 * Version: 3.6.1 (with debugging)
 * Last Modified: 2025-08-27
 *
 * Changelog:
 *
 * v3.6.1 - 2025-08-27
 * - Added diagnostic logging to the parent-btn click handler.
 *
 * v3.6.0 - 2025-08-27
 * - Merged favorite card and date/time picker enhancements.
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
    // ... (rest of the file is unchanged) ...
}

function triggerSave() {
    // ... (rest of the file is unchanged) ...
}


// --- CORE LOGIC ---
function renderTopLevel() {
    // ... (rest of the file is unchanged) ...
}

// --- AVAILABILITY LOGIC ---
async function updateAllCardAvailabilityIcons() {
    // ... (rest of the file is unchanged) ...
}

async function showItemDetailCalendar(record) {
    // ... (rest of the file is unchanged) ...
}

// --- INITIALIZATION & MAIN FLOW ---
async function initialize() {
    // ... (rest of the file is unchanged) ...
}

function setupEventListeners() {
    // ... (rest of the file is unchanged) ...

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
            // ...
        } else if (availabilityBtn) {
            // ...
        } else if (heartIcon) {
            // ...
        } else if (removeBtn) {
            // ...
        } else if (parentBtn) {
            e.stopPropagation();
            const card = parentBtn.closest('.event-card');
            if (!card) return;
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            
            // --- Start of Debugging Logs ---
            console.log("⬆️ Level-up button clicked on card:", record?.fields?.Name);
            const parentField = record?.fields?.[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
            console.log("Raw 'Parent Item' field from Airtable:", parentField);
            const parentId = parentField?.[0];
            console.log("Extracted Parent Record ID:", parentId);
            // --- End of Debugging Logs ---

            const parentRecord = state.records.all.find(p => p.id === parentId);
            
            if (parentRecord) {
                console.log("✅ Found parent record:", parentRecord.fields.Name);
                const newCard = await ui.createInteractiveCard(parentRecord, imageCache);
                card.replaceWith(newCard);
            } else {
                console.error("❌ Could not find parent record in state. Reverting to top level.");
                renderTopLevel();
            }
        } else if (explodeBtn) {
            // ...
        } else if (implodeBtn) {
            // ...
        }
    });

    // --- UNIFIED CHANGE LISTENER ---
    document.body.addEventListener('change', async (e) => {
        // ... (rest of the file is unchanged) ...
    });
}

initialize();
