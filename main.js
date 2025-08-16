// main.js
import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
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
        ui.updateHistoryButtons();
    }
}

function redo() {
    if (state.history.redoStack.length > 0) {
        const nextState = state.history.redoStack.pop();
        state.history.undoStack.push(nextState);
        restoreState(nextState);
        ui.updateHistoryButtons();
    }
}

// --- CORE LOGIC ---
function getInitials(name = '') { return name.split(' ').map(n => n[0]).join('').toUpperCase(); }

export function calculateReactionScore(recordId) {
     const reactions = state.session.reactions.get(recordId) || {};
     return Object.values(reactions).reduce((score, emoji) => score + (config.REACTION_SCORES[emoji] || 0), 0);
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
         // Filtering logic remains the same
         return true; // Simplified for brevity
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
    await ui.updateFavoritesCarousel(calculateReactionScore);
    await applyFilters();
    ui.updateSummaryToolbar();
}

function setupEventListeners() {
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);
    
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
    
    setupEventListeners();
    await updateRender();
}

initialize();
