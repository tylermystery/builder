/*
 * Version: 1.6.5
 * Last Modified: 2025-08-19
 *
 * Changelog:
 *
 * v1.6.5 - 2025-08-19
 * - Fixed syntax error in catalog click handler (missing template literal for composite ID).
 *
 * v1.6.4 - 2025-08-19
 * - Added debug logs to initialize function to diagnose "Catalog loading" issue.
 * - Improved error handling to ensure loading message updates on failure.
 *
 * v1.6.3 - 2025-08-19
 * - Exported updateRender for use in ui.js modal changes.
 *
 * v1.6.2 - 2025-08-18 06:15 PM PDT
 * - Updated "Download Source" button logic to use pre-built project_source.txt from export.js.
 *
 * v1.6.1 - 2025-08-18 06:00 PM PDT
 * - Added event listener for "Download Source" button to dynamically generate and download project_source.txt.
 *
 * v1.6.0 - 2025-08-18
 * - Made event cards clickable to open detailed editable modal view.
 * - Added save button in modal to apply edits to state/cart.
 *
 * v1.5.0 - 2025-08-18
 * - Added event listener to sessions-dropdown for loading selected sessions.
 *
 * v1.4.0 - 2025-08-18
 * - Updated `getRecordPrice` to correctly handle absolute vs. relative price changes for variations.
 *
 * v1.3.0 - 2025-08-18
 * - Implemented logic to remove event cards from the catalog only after all their variations have been favorited.
 * - Event cards now auto-select the next available variation after one is favorited.
 *
 * v1.2.1 - 2025-08-17
 * - Fixed a critical HTML structure error in index.html.
 *
 * v1.2.0 - 2025-08-17
 * - Fixed broken filters by adding event listeners.
 * - Implemented a unified sorting system controlled by a new dropdown.
 * - Refactored `applyFilters` to handle both filtering and sorting.
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 */



import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD, REACTION_SCORES } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';



const imageCache = new Map();



// --- STATE & HISTORY ---
function recordStateForUndo() {
    if (state.history.isRestoring) return;
    const currentState = {
        items: new Map(state.cart.items),
        lockedItems: new Map(state.cart.lockedItems),
        combined: new Map(state.eventDetails.combined)
    };
    state.history.undoStack.push(currentState);
    state.history.redoStack = [];
    ui.updateHistoryButtons();
}



async function restoreState(newState) {
    state.history.isRestoring = true;
    state.cart.items = newState.items;
    state.cart.lockedItems = newState.lockedItems;
    state.eventDetails.combined = newState.combined;
    state.history.isRestoring = false;
    await updateRender();
}



function undo() {
    if (state.history.undoStack.length > 1) {
        const currentState = state.history.undoStack.pop();
        state.history.redoStack.push(currentState);
        const prevState = state.history.undoStack[state.history.undoStack.length - 1];
        restoreState(prevState);
    }
}



function redo() {
    if (state.history.redoStack.length > 0) {
        const nextState = state.history.redoStack.pop();
        state.history.undoStack.push(nextState);
        restoreState(nextState);
    }
}



// --- CORE LOGIC ---
function getInitials(name = '') { return name.split(' ').map(n => n[0]).join('').toUpperCase(); }



export function calculateReactionScore(recordId) {
    const reactions = state.session.reactions.get(recordId) || {};
    return Object.values(reactions).reduce((score, emoji) => score + (REACTION_SCORES[emoji] || 0), 0);
}



export function getRecordPrice(record, optionIndex = null) {
    let price = record.fields[CONSTANTS.FIELD_NAMES.PRICE] ? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : 0;
    if (optionIndex !== null) {
        const options = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const variation = options[optionIndex];
        if (variation) {
            if (variation.absolutePrice !== null) {
                return variation.absolutePrice; // Return absolute price directly
            }
            if (variation.priceChange !== null) {
                price += variation.priceChange;
            }
        }
    }
    return price;
}





function checkUserProfile() {
    state.session.user = localStorage.getItem('userName');
    if (!state.session.user) {
        state.session.user = prompt("Welcome! Please enter your name to collaborate:", "");
        if (state.session.user) {
            localStorage.setItem('userName', state.session.user);
            if (!state.session.collaborators.includes(state.session.user)) state.session.collaborators.push(state.session.user);
        } else {
            state.session.user = 'Guest';
            if (!state.session.collaborators.includes('Guest')) state.session.collaborators.push('Guest');
        }
    } else {
        if (!state.session.collaborators.includes(state.session.user)) {
            state.session.collaborators.push(state.session.user);
        }
    }
    ui.renderCollaborators(getInitials);
}



export async function handleReaction(recordId, emoji) {
    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, {});
    }
    const reactions = state.session.reactions.get(recordId);
    if (reactions[state.session.user] === emoji) {
        delete reactions[state.session.user];
    } else {
        reactions[state.session.user] = emoji;
    }
    await updateRender();
}



export function getStoredSessions() { return JSON.parse(localStorage.getItem('savedSessions') || '{}'); }
export function storeSession(id, name) { const sessions = getStoredSessions(); sessions[id] = name; localStorage.setItem('savedSessions', JSON.stringify(sessions)); }



async function applyFilters() {
    state.ui.recordsCurrentlyDisplayed = 0;
    ui.catalogContainer.innerHTML = '';

    const nameValue = ui.nameFilter.value.toLowerCase();
    const priceValue = ui.priceFilter.value;
    const durationValue = ui.durationFilter.value;
    const statusValue = ui.statusFilter.value;
    state.ui.currentSort = ui.sortBy.value;

    state.records.filtered = state.records.all.filter(record => {
        const nameMatch = !nameValue || (record.fields[CONSTANTS.FIELD_NAMES.NAME] && record.fields[CONSTANTS.FIELD_NAMES.NAME].toLowerCase().includes(nameValue));
        const priceMatch = (priceValue === 'all') ? true : (() => {
            const price = getRecordPrice(record);
            if (price === null) return false;
            switch (priceValue) {
                case '0-50': return price < 50;
                case '50-100': return price >= 50 && price <= 100;
                case '100-250': return price > 100 && price <= 250;
                case '250-plus': return price > 250;
                default: return true;
            }
        })();
        const durationMatch = durationValue === 'all' || (record.fields[CONSTANTS.FIELD_NAMES.DURATION] && String(record.fields[CONSTANTS.FIELD_NAMES.DURATION]) === durationValue);
        const statusMatch = statusValue === 'all' || (record.fields[CONSTANTS.FIELD_NAMES.STATUS] && record.fields[CONSTANTS.FIELD_NAMES.STATUS] === statusValue);
        
        return nameMatch && priceMatch && durationMatch && statusMatch;
    });

    state.records.filtered.sort((a, b) => {
        switch (state.ui.currentSort) {
            case 'price-asc':
                return getRecordPrice(a) - getRecordPrice(b);
            case 'price-desc':
                return getRecordPrice(b) - getRecordPrice(a);
            case 'name-asc':
                return (a.fields[CONSTANTS.FIELD_NAMES.NAME] || '').localeCompare(b.fields[CONSTANTS.FIELD_NAMES.NAME] || '');
            case 'reactions-desc':
                default:
                    return calculateReactionScore(b.id) - calculateReactionScore(a.id);
        }
    });

    loadMoreRecords();
}



async function loadMoreRecords() {
    if (state.ui.isLoadingMore || state.ui.recordsCurrentlyDisplayed >= state.records.filtered.length) {
        return;
    }
    state.ui.isLoadingMore = true;
    const start = state.ui.recordsCurrentlyDisplayed;
    const end = start + RECORDS_PER_LOAD;
    const recordsToLoad = state.records.filtered.slice(start, end);
    await ui.renderRecords(recordsToLoad, imageCache);
    state.ui.recordsCurrentlyDisplayed = end;
    state.ui.isLoadingMore = false;
}



export async function updateRender() { // Exported for ui.js
    ui.updateHeader();
    await ui.updateFavoritesCarousel();
    await applyFilters();
    ui.updateSummaryToolbar();
}



function setupEventListeners() {
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);

    const filterInputs = [ui.nameFilter, ui.priceFilter, ui.durationFilter, ui.statusFilter, ui.sortBy];
    filterInputs.forEach(input => {
        input.addEventListener('change', applyFilters);
    });

    document.getElementById('reset-filters').addEventListener('click', () => {
        ui.nameFilter.value = '';
        ui.priceFilter.value = 'all';
        ui.durationFilter.value = 'all';
        ui.statusFilter.value = 'all';
        ui.sortBy.value = 'reactions-desc';
        applyFilters();
    });

    document.getElementById('add-collaborator-btn').addEventListener('click', () => {
        const newName = prompt("Enter collaborator's name:");
        if (newName && !state.session.collaborators.includes(newName)) {
            state.session.collaborators.push(newName);
            ui.renderCollaborators(getInitials);
        }
    });

    ui.catalogContainer.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            ui.catalogContainer.scrollLeft += e.deltaY;
        }
    });

    ui.catalogContainer.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = ui.catalogContainer;
        if (scrollTop + clientHeight >= scrollHeight - 500) {
            loadMoreRecords();
        }
    });

    document.body.addEventListener('click', async (e) => {
        const reactionBtn = e.target.closest('.reaction-bar button');
        if (reactionBtn) {
            e.stopPropagation();
            await handleReaction(reactionBtn.dataset.recordId, reactionBtn.dataset.emoji);
        }
    });

    ui.favoritesCarousel.addEventListener('click', async (e) => {
        const promoteBtn = e.target.closest('.promote-btn');
        if (promoteBtn) {
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = promoteBtn.dataset.compositeId;
            const itemData = state.cart.items.get(compositeId);
            if (itemData) {
                state.cart.lockedItems.set(compositeId, itemData);
                state.cart.items.delete(compositeId);
                await updateRender();
            }
            return;
        }
        const demoteBtn = e.target.closest('.demote-btn');
        if (demoteBtn) {
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = demoteBtn.dataset.compositeId;
            const itemData = state.cart.lockedItems.get(compositeId);
            if (itemData) {
                state.cart.items.set(compositeId, itemData);
                state.cart.lockedItems.delete(compositeId);
                await updateRender();
            }
            return;
        }
        const removeBtn = e.target.closest('.remove-btn');
        if (removeBtn) {
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = removeBtn.dataset.compositeId;
            state.cart.items.delete(compositeId);
            await updateRender();
            return;
        }
        const editBtn = e.target.closest('.edit-card-btn');
        if (editBtn) {
            e.stopPropagation();
            await ui.openDetailModal(editBtn.dataset.compositeId, imageCache);
            return;
        }

        // New: Click on favorite item (not on buttons) to open modal
        const favoriteItem = e.target.closest('.favorite-item');
        if (favoriteItem) {
            const compositeId = favoriteItem.dataset.compositeId;
            await ui.openDetailModal(compositeId, imageCache);
        }
    });

    ui.catalogContainer.addEventListener('click', async function(e) {
        const heart = e.target.closest('.heart-icon');
        if (heart) {
            e.stopPropagation();
            recordStateForUndo();
            
            const card = heart.closest('.event-card');
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            const options = ui.parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            
            const compositeId = heart.dataset.compositeId;
            if (state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId)) {
                return;
            }

            const quantity = card.querySelector('.quantity-input').value;
            const itemInfo = { quantity: parseInt(quantity), requests: '' };
            state.cart.items.set(compositeId, itemInfo);

            const allOptionsFavorited = options.every((opt, index) => {
                const id = `${recordId}-${index}`;
                return state.cart.items.has(id) || state.cart.lockedItems.has(id);
            });

            if (options.length > 0 && allOptionsFavorited) {
                card.remove();
            } else if (options.length === 0) {
                card.remove();
            } else {
                const newCard = await ui.createEventCardElement(record, imageCache);
                card.replaceWith(newCard);
            }
            
            await ui.updateFavoritesCarousel();
            return;
        }
        
        const editBtn = e.target.closest('.edit-card-btn');
        if (editBtn) {
            e.stopPropagation();
            const card = editBtn.closest('.event-card');
            const compositeId = card.querySelector('.heart-icon').dataset.compositeId;
            await ui.openDetailModal(compositeId, imageCache);
            return;
        }

        // New: Click on card (not on buttons) to open modal
        const card = e.target.closest('.event-card');
        if (card) {
            const compositeId = card.querySelector('.heart-icon').dataset.compositeId;
            await ui.openDetailModal(compositeId, imageCache);
        }
    });
    
    const toolbarInputs = [ui.summaryEventNameInput, ui.summaryDateInput, ui.summaryHeadcountInput, ui.summaryLocationInput];
    toolbarInputs.forEach(input => {
        input.addEventListener('change', (e) => {
            recordStateForUndo();
            const value = e.target.value;
            let detailType;
            switch (e.target.id) {
                case 'summary-event-name': detailType = CONSTANTS.DETAIL_TYPES.EVENT_NAME; break;
                case 'summary-date': detailType = CONSTANTS.DETAIL_TYPES.DATE; break;
                case 'summary-headcount': detailType = CONSTANTS.DETAIL_TYPES.GUEST_COUNT; ui.guestCountInput.value = value; ui.guestCountInput.dispatchEvent(new Event('input')); break;
                case 'summary-location': detailType = CONSTANTS.DETAIL_TYPES.LOCATION; break;
            }
            if (detailType) {
                state.eventDetails.combined.set(detailType, value);
                ui.updateHeader();
            }
        });
    });
    
    document.getElementById('save-share-btn').addEventListener('click', async () => {
        const success = await api.saveSessionToAirtable();
        if (success) {
            document.getElementById('save-status').textContent = 'Saved!';
            const shareLinkContainer = document.getElementById('share-link-container');
            shareLinkContainer.style.display = 'inline-flex';
            document.getElementById('share-link').value = window.location.href;
            ui.populateSessionsDropdown(getStoredSessions);
        }
        setTimeout(() => {
            if (document.getElementById('save-status').textContent !== 'Saving...') {
                document.getElementById('save-status').textContent = '';
            }
        }, 3000);
    });

    // Add listener for sessions dropdown to load selected session
    ui.sessionsDropdown.addEventListener('change', async (e) => {
        const selectedId = e.target.value;
        if (selectedId) {
            await api.loadSessionFromAirtable(selectedId);
            await updateRender();
            // Reset dropdown to default after load (optional edge case handling)
            e.target.value = '';
        }
    });

    // Add listener for Download Source button
    document.getElementById('download-source-btn').addEventListener('click', () => {
        const link = document.createElement('a');
        link.href = '/project_source.txt';
        link.download = 'project_source.txt';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
}



// --- INITIALIZATION ---
async function initialize() {
    console.log('Starting initialize...');
    ui.toggleLoading(true);
    console.log('Loading toggled on');
    try {
        console.log('Fetching records from Airtable...');
        state.records.all = await api.fetchAllRecords();
        console.log('Records fetched:', state.records.all.length);
    } catch (error) {
        console.error("Failed to load records:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        ui.toggleLoading(false); // Ensure loading is toggled off
        return;
    }
    
    console.log('Checking for session ID in URL...');
    const urlParams = new URLSearchParams(window.location.search);
    const sessionIdFromUrl = urlParams.get('session');
    if (sessionIdFromUrl) {
        console.log('Loading session:', sessionIdFromUrl);
        await api.loadSessionFromAirtable(sessionIdFromUrl);
        console.log('Session loaded');
    }
    
    console.log('Recording initial state for undo...');
    recordStateForUndo();
    console.log('Checking user profile...');
    checkUserProfile();
    console.log('Populating sessions dropdown...');
    ui.populateSessionsDropdown(getStoredSessions);
    console.log('Toggling loading off...');
    ui.toggleLoading(false);
    
    console.log('Populating filters...');
    ui.populateFilter(ui.durationFilter, CONSTANTS.FIELD_NAMES.DURATION);
    ui.populateFilter(ui.statusFilter, CONSTANTS.FIELD_NAMES.STATUS);
    
    console.log('Setting up event listeners...');
    setupEventListeners();
    console.log('Updating render...');
    await updateRender();
    console.log('Initialize complete');
}



initialize();
