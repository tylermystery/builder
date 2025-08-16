// main.js
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

async function handleReaction(recordId, emoji) {
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

    state.records.filtered = state.records.all.filter(record => {
        const nameMatch = !nameValue || (record.fields[CONSTANTS.FIELD_NAMES.NAME] && record.fields[CONSTANTS.FIELD_NAMES.NAME].toLowerCase().includes(nameValue));
        const priceMatch = (priceValue === 'all') ? true : (() => {
            const price = record.fields[CONSTANTS.FIELD_NAMES.PRICE] ? parseFloat(String(record.fields[CONSTANTS.FIELD_NAMES.PRICE]).replace(/[^0-9.-]+/g, "")) : null;
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

    state.records.filtered.sort((a, b) => calculateReactionScore(b.id) - calculateReactionScore(a.id));

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

async function updateRender() {
    ui.updateHeader();
    await ui.updateFavoritesCarousel();
    await applyFilters();
    ui.updateSummaryToolbar();
}

function setupEventListeners() {
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);
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
        const { scrollLeft, scrollWidth, clientWidth } = ui.catalogContainer;
        if (scrollLeft + clientWidth >= scrollWidth - 500) {
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
                await ui.updateFavoritesCarousel();
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
                await ui.updateFavoritesCarousel();
            }
            return;
        }
        const removeBtn = e.target.closest('.remove-btn');
        if (removeBtn) {
            e.stopPropagation();
            recordStateForUndo();
            const compositeId = removeBtn.dataset.compositeId;
            state.cart.items.delete(compositeId);
            await ui.updateFavoritesCarousel();
            await applyFilters();
            return;
        }
        // *** THE FIX IS HERE: More specific listener ***
        const editBtn = e.target.closest('.edit-card-btn');
        if (editBtn) {
            e.stopPropagation();
            await ui.openDetailModal(editBtn.dataset.compositeId, imageCache);
        }
    });

    ui.catalogContainer.addEventListener('click', async function(e) {
        const heart = e.target.closest('.heart-icon');
        if (heart) {
            e.stopPropagation();
            recordStateForUndo();
            heart.classList.add('hearted');
            const card = heart.closest('.event-card');
            const compositeId = heart.dataset.compositeId;
            if (state.cart.items.has(compositeId) || state.cart.lockedItems.has(compositeId)) {
                return;
            }
            const quantity = card.querySelector('.quantity-input').value;
            const itemInfo = { quantity: parseInt(quantity), requests: '' };
            state.cart.items.set(compositeId, itemInfo);
            card.remove();
            await ui.updateFavoritesCarousel();
            return;
        }
        
        // *** THE FIX IS HERE: More specific listener ***
        const editBtn = e.target.closest('.edit-card-btn');
        if (editBtn) {
            const card = editBtn.closest('.event-card');
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
    
    // ... other listeners
}


// --- INITIALIZATION ---
async function initialize() {
    ui.toggleLoading(true);
    try {
        state.records.all = await api.fetchAllRecords();
    } catch (error) {
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog. Please try again later.</p>`;
        return;
    }
    
    const urlParams = new URLSearchParams(window.location.search);
    const sessionIdFromUrl = urlParams.get('session');
    if (sessionIdFromUrl) {
        await api.loadSessionFromAirtable(sessionIdFromUrl);
    }
    
    recordStateForUndo();
    checkUserProfile();
    ui.populateSessionsDropdown(getStoredSessions);
    ui.toggleLoading(false);
    
    ui.populateFilter(ui.durationFilter, CONSTANTS.FIELD_NAMES.DURATION);
    ui.populateFilter(ui.statusFilter, CONSTANTS.FIELD_NAMES.STATUS);

    setupEventListeners();
    await updateRender();
}

initialize();

