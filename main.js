/*
 * Version: 1.8.7
 * Last Modified: 2025-08-22
 *
 * Changelog:
 *
 * v1.8.7 - 2025-08-22
 * - Implemented filtering logic for Categories and Subcategories.
 * - Added event listeners for new filter dropdowns.
 *
 * v1.8.6 - 2025-08-22
 * - Restored Undo/Redo functionality and connected to new "History Mode" toggle.
 *
 * v1.8.5 - 2025-08-21
 * - Implemented event listeners for Beta Toolkit toggles to show/hide features.
 *
 * v1.8.4 - 2025-08-21
 * - Added logic to hide "Sort by Reactions" option by default for MVP.
 *
 * v1.8.3 - 2025-08-21
 * - Stripped down to MVP: Removed reaction bar and complex button listeners.
 *
 * v1.8.2 - 2025-08-21
 * - Fixed bug where action buttons (promote, demote, remove) on favorites carousel were not working.
 *
 * v1.8.1 - 2025-08-21
 * - Refined card interactions: Emoji clicks no longer open the modal.
 * - Added mouse wheel scrolling to the horizontal favorites carousel.
 *
 * v1.8.0 - 2025-08-21
 * - Removed Undo/Redo and Autosave functionality for MVP simplification.
 *
 * v1.7.2 - 2025-08-21
 * - Updated scroll listeners to support a vertical catalog layout.
 * - Removed horizontal mouse wheel scroll functionality.
 */



import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD, REACTION_SCORES } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
const imageCache = new Map();



// --- STATE & HISTORY ---
export function recordStateForUndo() {
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
                return variation.absolutePrice;
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
export function storeSession(id, name) { const sessions = getStoredSessions(); sessions[id] = name;
localStorage.setItem('savedSessions', JSON.stringify(sessions)); }
async function applyFilters() {
    state.ui.recordsCurrentlyDisplayed = 0;
    ui.catalogContainer.innerHTML = '';

    const nameValue = ui.nameFilter.value.toLowerCase();
    const priceValue = ui.priceFilter.value;
    const durationValue = ui.durationFilter.value;
    const statusValue = ui.statusFilter.value;
    const categoryValue = ui.categoryFilter.value;
    const subcategoryValue = ui.subcategoryFilter.value;
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
        const categoryMatch = categoryValue === 'all' || (record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] && record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES].includes(categoryValue));
        const subcategoryMatch = subcategoryValue === 'all' || (record.fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] && record.fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES].includes(subcategoryValue));
        
        return nameMatch && priceMatch && durationMatch && statusMatch && categoryMatch && subcategoryMatch;
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
}

function setupEventListeners() {
    // BETA TOOLKIT LISTENERS
    document.getElementById('beta-trigger').addEventListener('click', () => {
        document.getElementById('beta-toolkit').classList.toggle('visible');
    });

    document.getElementById('collab-mode-toggle').addEventListener('change', (e) => {
        document.body.classList.toggle('collab-mode-enabled', e.target.checked);
        const reactionsSortOption = document.getElementById('sort-by-reactions');
        reactionsSortOption.style.display = e.target.checked ? 'block' : 'none';
        if (!e.target.checked && ui.sortBy.value === 'reactions-desc') {
            ui.sortBy.value = 'price-asc'; // Reset to default sort
        }
        updateRender();
    });

    document.getElementById('planner-mode-toggle').addEventListener('change', (e) => {
        document.body.classList.toggle('planner-mode-enabled', e.target.checked);
        updateRender();
    });

    document.getElementById('history-mode-toggle').addEventListener('change', (e) => {
        document.body.classList.toggle('history-mode-enabled', e.target.checked);
    });

    // REGULAR EVENT LISTENERS
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);
    
    const filterInputs = [ui.nameFilter, ui.priceFilter, ui.durationFilter, ui.statusFilter, ui.categoryFilter, ui.subcategoryFilter, ui.sortBy];
    filterInputs.forEach(input => {
        input.addEventListener('change', applyFilters);
    });
    document.getElementById('reset-filters').addEventListener('click', () => {
        ui.nameFilter.value = '';
        ui.priceFilter.value = 'all';
        ui.durationFilter.value = 'all';
        ui.statusFilter.value = 'all';
        ui.categoryFilter.value = 'all';
        ui.subcategoryFilter.value = 'all';
        ui.sortBy.value = document.body.classList.contains('collab-mode-enabled') ? 'reactions-desc' : 'price-asc';
        applyFilters();
    });
    document.getElementById('add-collaborator-btn').addEventListener('click', () => {
        const newName = prompt("Enter collaborator's name:");
        if (newName && !state.session.collaborators.includes(newName)) {
            state.session.collaborators.push(newName);
            ui.renderCollaborators(getInitials);
        }
    });
    
    window.addEventListener('scroll', () => {
        if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - 500) {
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

    ui.favoritesCarousel.addEventListener('wheel', (e) => {
        if (e.deltaY !== 0) {
            e.preventDefault();
            ui.favoritesCarousel.scrollLeft += e.deltaY;
        }
    });

    ui.favoritesCarousel.addEventListener('click', async (e) => {
        const removeBtn = e.target.closest('.remove-btn');
        if (removeBtn) {
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = removeBtn.dataset.compositeId;
            state.cart.items.delete(compositeId);
            state.cart.lockedItems.delete(compositeId);
            await updateRender();
            return;
        }

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

        const favoriteItem = e.target.closest('.favorite-item');
        if (favoriteItem && !e.target.closest('button')) {
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
                const newCard = await ui.createInteractiveCard(record, imageCache);
                card.replaceWith(newCard);
            }
            
            await ui.updateFavoritesCarousel();
            return;
        }
        
        if (e.target.closest('button')) {
            return;
        }

        const card = e.target.closest('.event-card');
        if (card) {
            const compositeId = card.querySelector('.heart-icon').dataset.compositeId;
            await ui.openDetailModal(compositeId, imageCache);
        }
    });
    
    const headerInputs = [ui.headerEventNameInput, ui.headerDateInput, ui.headerHeadcountInput, ui.headerGoalsInput];
    headerInputs.forEach(input => {
        input.addEventListener('change', (e) => {
            recordStateForUndo();
            const value = e.target.value;
            let detailType;
            switch (e.target.id) {
                case 'header-event-name': detailType = CONSTANTS.DETAIL_TYPES.EVENT_NAME; break;
                case 'header-date': detailType = CONSTANTS.DETAIL_TYPES.DATE; break;
                case 'header-headcount': detailType = CONSTANTS.DETAIL_TYPES.GUEST_COUNT; break;
                case 'header-goals': detailType = CONSTANTS.DETAIL_TYPES.GOALS; break;
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
    
    ui.sessionsDropdown.addEventListener('change', async (e) => {
        const selectedId = e.target.value;
        if (selectedId) {
            await api.loadSessionFromAirtable(selectedId);
            await updateRender();
            e.target.value = '';
        }
    });
}



// --- INITIALIZATION ---
async function initialize() {
    console.log('Starting initialize...');
    ui.toggleLoading(true);
    
    try {
        console.log('Fetching records from Airtable...');
        state.records.all = await api.fetchAllRecords();
        console.log('Records fetched:', state.records.all.length);
    } catch (error) {
        console.error("Failed to load records:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        ui.toggleLoading(false);
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
    ui.populateFilter(ui.categoryFilter, CONSTANTS.FIELD_NAMES.CATEGORIES);
    ui.populateFilter(ui.subcategoryFilter, CONSTANTS.FIELD_NAMES.SUBCATEGORIES);
    
    console.log('Setting up event listeners...');
    setupEventListeners();
    ui.collapseHeaderOnScroll();
    
    document.getElementById('sort-by-reactions').style.display = 'none';
    ui.sortBy.value = 'price-asc'; 

    console.log('Updating render...');
    await updateRender();
    console.log('Initialize complete');
}



initialize();
