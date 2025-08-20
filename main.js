/*
 * Version: 1.8.0
 * Last Modified: 2025-08-20
 *
 * Changelog:
 *
 * v1.8.0 - 2025-08-20
 * - Activated scroll listener to enable dynamic header collapsing for improved UI.
 *
 * v1.7.0 - 2025-08-19
 * - [cite_start]Implemented autosave functionality with 30-second interval when toggle is enabled. [cite: 95]
 *
 * v1.6.6 - 2025-08-19
 * - [cite_start]Exported recordStateForUndo to fix import error in ui.js. [cite: 96]
 *
 * v1.6.5 - 2025-08-19
 * - [cite_start]Fixed syntax error in catalog click handler (missing template literal for composite ID). [cite: 97]
 *
 * v1.6.4 - 2025-08-19
 * - [cite_start]Added debug logs to initialize function to diagnose "Catalog loading" issue. [cite: 98]
 * - [cite_start]Improved error handling to ensure loading message updates on failure. [cite: 99]
 *
 * v1.6.3 - 2025-08-19
 * - [cite_start]Exported updateRender for use in ui.js modal changes. [cite: 100]
 *
 * v1.6.2 - 2025-08-18 06:15 PM PDT
 * - [cite_start]Updated "Download Source" button logic to use pre-built project_source.txt from export.js. [cite: 101]
 *
 * v1.6.1 - 2025-08-18 06:00 PM PDT
 * - [cite_start]Added event listener for "Download Source" button to dynamically generate and download project_source.txt. [cite: 102]
 *
 * v1.6.0 - 2025-08-18
 * - [cite_start]Made event cards clickable to open detailed editable modal view. [cite: 103]
 * - [cite_start]Added save button in modal to apply edits to state/cart. [cite: 104]
 *
 * v1.5.0 - 2025-08-18
 * - [cite_start]Added event listener to sessions-dropdown for loading selected sessions. [cite: 105]
 *
 * v1.4.0 - 2025-08-18
 * - [cite_start]Updated `getRecordPrice` to correctly handle absolute vs. relative price changes for variations. [cite: 106]
 *
 * v1.3.0 - 2025-08-18
 * - [cite_start]Implemented logic to remove event cards from the catalog only after all their variations have been favorited. [cite: 107]
 * - [cite_start]Event cards now auto-select the next available variation after one is favorited. [cite: 108]
 *
 * v1.2.1 - 2025-08-17
 * - [cite_start]Fixed a critical HTML structure error in index.html. [cite: 109]
 *
 * v1.2.0 - 2025-08-17
 * - [cite_start]Fixed broken filters by adding event listeners. [cite: 110]
 * - [cite_start]Implemented a unified sorting system controlled by a new dropdown. [cite: 111]
 * - [cite_start]Refactored `applyFilters` to handle both filtering and sorting. [cite: 112]
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */



import { state } from './state.js';
[cite_start]import { CONSTANTS, RECORDS_PER_LOAD, REACTION_SCORES } from './config.js'; [cite: 113]
import * as api from './api.js';
import * as ui from './ui.js';
[cite_start]const imageCache = new Map(); [cite: 114]



// --- STATE & HISTORY ---
export function recordStateForUndo() {  // Added export
    if (state.history.isRestoring) return;
    const currentState = {
        items: new Map(state.cart.items),
        lockedItems: new Map(state.cart.lockedItems),
        combined: new Map(state.eventDetails.combined)
    [cite_start]}; [cite: 115]
    [cite_start]state.history.undoStack.push(currentState); [cite: 116]
    state.history.redoStack = [];
    ui.updateHistoryButtons();
}



async function restoreState(newState) {
    state.history.isRestoring = true;
    state.cart.items = newState.items;
    [cite_start]state.cart.lockedItems = newState.lockedItems; [cite: 117]
    state.eventDetails.combined = newState.combined;
    state.history.isRestoring = false;
    [cite_start]await updateRender(); [cite: 118]
}



function undo() {
    if (state.history.undoStack.length > 1) {
        const currentState = state.history.undoStack.pop();
        [cite_start]state.history.redoStack.push(currentState); [cite: 119]
        const prevState = state.history.undoStack[state.history.undoStack.length - 1];
        restoreState(prevState);
    }
}



function redo() {
    if (state.history.redoStack.length > 0) {
        const nextState = state.history.redoStack.pop();
        [cite_start]state.history.undoStack.push(nextState); [cite: 120]
        restoreState(nextState);
    }
}



// --- CORE LOGIC ---
function getInitials(name = '') { return name.split(' ').map(n => n[0]).join('').toUpperCase();
[cite_start]} [cite: 121]



export function calculateReactionScore(recordId) {
    const reactions = state.session.reactions.get(recordId) || [cite_start]{}; [cite: 122]
    [cite_start]return Object.values(reactions).reduce((score, emoji) => score + (REACTION_SCORES[emoji] || 0), 0); [cite: 123]
}



export function getRecordPrice(record, optionIndex = null) {
    [cite_start]let price = record.fields[CONSTANTS.FIELD_NAMES.PRICE] ? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : 0; [cite: 124]
    if (optionIndex !== null) {
        const options = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        [cite_start]if (variation) { [cite: 125]
            if (variation.absolutePrice !== null) {
                [cite_start]return variation.absolutePrice; [cite: 126]
// Return absolute price directly
            }
            if (variation.priceChange !== null) {
                [cite_start]price += variation.priceChange; [cite: 127]
            }
        }
    }
    [cite_start]return price; [cite: 128]
}





function checkUserProfile() {
    state.session.user = localStorage.getItem('userName');
    if (!state.session.user) {
        state.session.user = prompt("Welcome! Please enter your name to collaborate:", "");
        [cite_start]if (state.session.user) { [cite: 129]
            localStorage.setItem('userName', state.session.user);
            [cite_start]if (!state.session.collaborators.includes(state.session.user)) state.session.collaborators.push(state.session.user); [cite: 130]
        } else {
            state.session.user = 'Guest';
            [cite_start]if (!state.session.collaborators.includes('Guest')) state.session.collaborators.push('Guest'); [cite: 131]
        }
    } else {
        if (!state.session.collaborators.includes(state.session.user)) {
            [cite_start]state.session.collaborators.push(state.session.user); [cite: 132]
        }
    }
    ui.renderCollaborators(getInitials);
}



export async function handleReaction(recordId, emoji) {
    if (!state.session.reactions.has(recordId)) {
        [cite_start]state.session.reactions.set(recordId, {}); [cite: 133]
    }
    const reactions = state.session.reactions.get(recordId);
    if (reactions[state.session.user] === emoji) {
        [cite_start]delete reactions[state.session.user]; [cite: 134]
    } else {
        reactions[state.session.user] = emoji;
    }
    [cite_start]await updateRender(); [cite: 135]
}



export function getStoredSessions() { return JSON.parse(localStorage.getItem('savedSessions') || '{}'); }
export function storeSession(id, name) { const sessions = getStoredSessions(); sessions[id] = name;
localStorage.setItem('savedSessions', JSON.stringify(sessions)); [cite_start]} [cite: 136]



async function applyFilters() {
    state.ui.recordsCurrentlyDisplayed = 0;
    ui.catalogContainer.innerHTML = '';

    const nameValue = ui.nameFilter.value.toLowerCase();
    [cite_start]const priceValue = ui.priceFilter.value; [cite: 137]
    const durationValue = ui.durationFilter.value;
    const statusValue = ui.statusFilter.value;
    state.ui.currentSort = ui.sortBy.value;
    [cite_start]state.records.filtered = state.records.all.filter(record => { [cite: 138]
        const nameMatch = !nameValue || (record.fields[CONSTANTS.FIELD_NAMES.NAME] && record.fields[CONSTANTS.FIELD_NAMES.NAME].toLowerCase().includes(nameValue));
        const priceMatch = (priceValue === 'all') ? true : (() => {
            const price = getRecordPrice(record);
            if (price === null) return false;
            switch (priceValue) {
                
                [cite_start]case '0-50': return price < 50; [cite: 139]
                case '50-100': return price >= 50 && price <= 100;
                case '100-250': return price > 100 && price <= 250;
                case '250-plus': return price > 250;
                default: return true;
      
            [cite_start]} [cite: 140]
        })();
        const durationMatch = durationValue === 'all' || (record.fields[CONSTANTS.FIELD_NAMES.DURATION] && String(record.fields[CONSTANTS.FIELD_NAMES.DURATION]) === durationValue);
        const statusMatch = statusValue === 'all' || (record.fields[CONSTANTS.FIELD_NAMES.STATUS] && record.fields[CONSTANTS.FIELD_NAMES.STATUS] === statusValue);
        [cite_start]return nameMatch && priceMatch && durationMatch && statusMatch; [cite: 141]
    });

    state.records.filtered.sort((a, b) => {
        switch (state.ui.currentSort) {
            case 'price-asc':
                return getRecordPrice(a) - getRecordPrice(b);
            case 'price-desc':
                return getRecordPrice(b) - getRecordPrice(a);
            case 'name-asc':
 
                [cite_start]return (a.fields[CONSTANTS.FIELD_NAMES.NAME] || '').localeCompare(b.fields[CONSTANTS.FIELD_NAMES.NAME] || ''); [cite: 142]
            case 'reactions-desc':
                default:
                    return calculateReactionScore(b.id) - calculateReactionScore(a.id);
        }
    });
    [cite_start]loadMoreRecords(); [cite: 143]
}



async function loadMoreRecords() {
    if (state.ui.isLoadingMore || state.ui.recordsCurrentlyDisplayed >= state.records.filtered.length) {
        [cite_start]return; [cite: 144]
    }
    state.ui.isLoadingMore = true;
    const start = state.ui.recordsCurrentlyDisplayed;
    const end = start + RECORDS_PER_LOAD;
    [cite_start]const recordsToLoad = state.records.filtered.slice(start, end); [cite: 145]
    await ui.renderRecords(recordsToLoad, imageCache);
    state.ui.recordsCurrentlyDisplayed = end;
    [cite_start]state.ui.isLoadingMore = false; [cite: 146]
}



export async function updateRender() { // Exported for ui.js
    ui.updateHeader();
    await ui.updateFavoritesCarousel();
    await applyFilters();
    [cite_start]ui.updateSummaryToolbar(); [cite: 147]
}



function setupEventListeners() {
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);

    const filterInputs = [ui.nameFilter, ui.priceFilter, ui.durationFilter, ui.statusFilter, ui.sortBy];
    [cite_start]filterInputs.forEach(input => { [cite: 148]
        input.addEventListener('change', applyFilters);
    });
    [cite_start]document.getElementById('reset-filters').addEventListener('click', () => { [cite: 149]
        ui.nameFilter.value = '';
        ui.priceFilter.value = 'all';
        ui.durationFilter.value = 'all';
        ui.statusFilter.value = 'all';
        ui.sortBy.value = 'reactions-desc';
        applyFilters();
    });
    [cite_start]document.getElementById('add-collaborator-btn').addEventListener('click', () => { [cite: 150]
        const newName = prompt("Enter collaborator's name:");
        if (newName && !state.session.collaborators.includes(newName)) {
            state.session.collaborators.push(newName);
            ui.renderCollaborators(getInitials);
        }
    });
    [cite_start]ui.catalogContainer.addEventListener('wheel', (e) => { [cite: 151]
        if (e.deltaY !== 0) {
            e.preventDefault();
            ui.catalogContainer.scrollLeft += e.deltaY;
        }
    });
    [cite_start]ui.catalogContainer.addEventListener('scroll', () => { [cite: 152]
        const { scrollTop, scrollHeight, clientHeight } = ui.catalogContainer;
        if (scrollTop + clientHeight >= scrollHeight - 500) {
            loadMoreRecords();
        }
    });
    [cite_start]document.body.addEventListener('click', async (e) => { [cite: 153]
        const reactionBtn = e.target.closest('.reaction-bar button');
        if (reactionBtn) {
            e.stopPropagation();
            await handleReaction(reactionBtn.dataset.recordId, reactionBtn.dataset.emoji);
        }
    });
    [cite_start]ui.favoritesCarousel.addEventListener('click', async (e) => { [cite: 154]
        const promoteBtn = e.target.closest('.promote-btn');
        if (promoteBtn) {
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = promoteBtn.dataset.compositeId;
            const itemData = state.cart.items.get(compositeId);
            if (itemData) {
       
                [cite_start]state.cart.lockedItems.set(compositeId, itemData); [cite: 155]
                state.cart.items.delete(compositeId);
                await updateRender();
            }
            return;
        }
        const demoteBtn = e.target.closest('.demote-btn');
        if (demoteBtn) {
    
            [cite_start]e.stopPropagation(); [cite: 156]
            recordStateForUndo();
            const compositeId = demoteBtn.dataset.compositeId;
            const itemData = state.cart.lockedItems.get(compositeId);
            if (itemData) {
                state.cart.items.set(compositeId, itemData);
                state.cart.lockedItems.delete(compositeId);
                [cite_start]await updateRender(); [cite: 157]
            }
            return;
        [cite_start]} [cite: 158]
        const removeBtn = e.target.closest('.remove-btn');
        [cite_start]if (removeBtn) { [cite: 159]
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = removeBtn.dataset.compositeId;
            [cite_start]state.cart.items.delete(compositeId); [cite: 160]
            await updateRender();
            return;
        }
        const editBtn = e.target.closest('.edit-card-btn');
        [cite_start]if (editBtn) { [cite: 161]
            e.stopPropagation();
            await ui.openDetailModal(editBtn.dataset.compositeId, imageCache);
            [cite_start]return; [cite: 162]
        }

        // New: Click on favorite item (not on buttons) to open modal
        const favoriteItem = e.target.closest('.favorite-item');
        [cite_start]if (favoriteItem) { [cite: 163]
            const compositeId = favoriteItem.dataset.compositeId;
            [cite_start]await ui.openDetailModal(compositeId, imageCache); [cite: 164]
        }
    });

    ui.catalogContainer.addEventListener('click', async function(e) {
        const heart = e.target.closest('.heart-icon');
        if (heart) {
            e.stopPropagation();
            recordStateForUndo();
            
            const card = heart.closest('.event-card');
            const recordId = card.dataset.recordId;
  
            [cite_start]const record = state.records.all.find(r => r.id === recordId); [cite: 165]
            const options = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            
            const compositeId = heart.dataset.compositeId;
            if (state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId)) {
                return;
         
            [cite_start]} [cite: 166]

            const quantity = card.querySelector('.quantity-input').value;
            const itemInfo = { quantity: parseInt(quantity), requests: '' };
            state.cart.items.set(compositeId, itemInfo);

            const allOptionsFavorited = options.every((opt, index) => {
                const id = `${recordId}-${index}`;
                [cite_start]return state.cart.items.has(id) || state.cart.lockedItems.has(id); [cite: 167]
            });

            if (options.length > 0 && allOptionsFavorited) {
                [cite_start]card.remove(); [cite: 168]
            } else if (options.length === 0) {
                [cite_start]card.remove(); [cite: 169]
            } else {
                const newCard = await ui.createEventCardElement(record, imageCache);
                [cite_start]card.replaceWith(newCard); [cite: 170]
            }
            
            await ui.updateFavoritesCarousel();
            [cite_start]return; [cite: 171]
        }
        
        const editBtn = e.target.closest('.edit-card-btn');
        [cite_start]if (editBtn) { [cite: 172]
            e.stopPropagation();
            const card = editBtn.closest('.event-card');
            [cite_start]const compositeId = card.querySelector('.heart-icon').dataset.compositeId; [cite: 173]
            await ui.openDetailModal(compositeId, imageCache);
            return;
        }

        // New: Click on card (not on buttons) to open modal
        const card = e.target.closest('.event-card');
        [cite_start]if (card) { [cite: 174]
            const compositeId = card.querySelector('.heart-icon').dataset.compositeId;
            [cite_start]await ui.openDetailModal(compositeId, imageCache); [cite: 175]
        }
    });
    
    const toolbarInputs = [ui.summaryEventNameInput, ui.summaryDateInput, ui.summaryHeadcountInput, ui.summaryLocationInput];
    [cite_start]toolbarInputs.forEach(input => { [cite: 176]
        input.addEventListener('change', (e) => {
            recordStateForUndo();
            const value = e.target.value;
            let detailType;
            switch (e.target.id) {
                case 'summary-event-name': detailType = CONSTANTS.DETAIL_TYPES.EVENT_NAME; break;
            
                [cite_start]case 'summary-date': detailType = CONSTANTS.DETAIL_TYPES.DATE; break; [cite: 177]
                case 'summary-headcount': detailType = CONSTANTS.DETAIL_TYPES.GUEST_COUNT; ui.guestCountInput.value = value; ui.guestCountInput.dispatchEvent(new Event('input')); break;
                case 'summary-location': detailType = CONSTANTS.DETAIL_TYPES.LOCATION; break;
            }
            if (detailType) {
                state.eventDetails.combined.set(detailType, value);
 
                [cite_start]ui.updateHeader(); [cite: 178]
            }
        });
    });
    [cite_start]document.getElementById('save-share-btn').addEventListener('click', async () => { [cite: 179]
        const success = await api.saveSessionToAirtable();
        if (success) {
            document.getElementById('save-status').textContent = 'Saved!';
            const shareLinkContainer = document.getElementById('share-link-container');
            shareLinkContainer.style.display = 'inline-flex';
            document.getElementById('share-link').value = window.location.href;
            ui.populateSessionsDropdown(getStoredSessions);
     
        [cite_start]} [cite: 180]
        setTimeout(() => {
            if (document.getElementById('save-status').textContent !== 'Saving...') {
                document.getElementById('save-status').textContent = '';
            }
        }, 3000);
    });
    // Add listener for sessions dropdown to load selected session
    [cite_start]ui.sessionsDropdown.addEventListener('change', async (e) => { [cite: 181]
        const selectedId = e.target.value;
        if (selectedId) {
            await api.loadSessionFromAirtable(selectedId);
            await updateRender();
            // Reset dropdown to default after load (optional edge case handling)
            e.target.value = 
            [cite_start]''; [cite: 182]
        }
    });
    // Add listener for Download Source button
    [cite_start]document.getElementById('download-source-btn').addEventListener('click', () => { [cite: 183]
        const link = document.createElement('a');
        link.href = '/project_source.txt';
        link.download = 'project_source.txt';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
    // Autosave setup
    [cite_start]const autosaveToggle = document.getElementById('autosave-toggle'); [cite: 184]
    let autosaveInterval;
    [cite_start]function setupAutosave() { [cite: 185]
        if (autosaveToggle.checked) {
            autosaveInterval = setInterval(async () => {
                const success = await api.saveSessionToAirtable();
                if (success) {
                    document.getElementById('save-status').textContent = 'Autosaved!';
           
                    [cite_start]setTimeout(() => { document.getElementById('save-status').textContent = ''; }, 2000); [cite: 186]
                }
            [cite_start]}, 30000); [cite: 187]
// 30 seconds
        }
    }
    autosaveToggle.addEventListener('change', () => {
        if (autosaveToggle.checked) {
            setupAutosave();
        } else {
            clearInterval(autosaveInterval);
        }
    });
    setupAutosave(); [cite_start]// Initial setup if checked by default [cite: 188]
}



// --- INITIALIZATION ---
async function initialize() {
    console.log('Starting initialize...');
    ui.toggleLoading(true);
    [cite_start]console.log('Loading toggled on'); [cite: 189]
    try {
        console.log('Fetching records from Airtable...');
        state.records.all = await api.fetchAllRecords();
        [cite_start]console.log('Records fetched:', state.records.all.length); [cite: 190]
    } catch (error) {
        console.error("Failed to load records:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. [cite_start]Please try again later.</p>`; [cite: 191]
        ui.toggleLoading(false);
        [cite_start]// Ensure loading is toggled off [cite: 192]
        [cite_start]return; [cite: 193]
    }
    
    console.log('Checking for session ID in URL...');
    const urlParams = new URLSearchParams(window.location.search);
    [cite_start]const sessionIdFromUrl = urlParams.get('session'); [cite: 194]
    if (sessionIdFromUrl) {
        console.log('Loading session:', sessionIdFromUrl);
        await api.loadSessionFromAirtable(sessionIdFromUrl);
        [cite_start]console.log('Session loaded'); [cite: 195]
    }
    
    console.log('Recording initial state for undo...');
    recordStateForUndo();
    console.log('Checking user profile...');
    checkUserProfile();
    [cite_start]console.log('Populating sessions dropdown...'); [cite: 196]
    ui.populateSessionsDropdown(getStoredSessions);
    console.log('Toggling loading off...');
    ui.toggleLoading(false);
    
    console.log('Populating filters...');
    ui.populateFilter(ui.durationFilter, CONSTANTS.FIELD_NAMES.DURATION);
    ui.populateFilter(ui.statusFilter, CONSTANTS.FIELD_NAMES.STATUS);
    
    console.log('Setting up event listeners...');
    setupEventListeners();
    ui.collapseHeaderOnScroll(); // Activate the header collapse feature
    console.log('Updating render...');
    [cite_start]await updateRender(); [cite: 197]
    console.log('Initialize complete');
}



initialize();
