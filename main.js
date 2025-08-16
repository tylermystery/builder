// main.js
import { state } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';

// --- STATE & HISTORY MANAGEMENT ---
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

function restoreState(newState) {
    state.history.isRestoring = true;
    state.cart.items = newState.items;
    state.cart.lockedItems = newState.lockedItems;
    state.eventDetails.combined = newState.combined;
    state.history.isRestoring = false;
    updateRender();
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

// --- INITIALIZATION & MAIN LOGIC ---
async function initialize() {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionIdFromUrl = urlParams.get('session');
    
    try {
        state.records.all = await api.fetchAllRecords();
    } catch (error) {
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog. Please try again later.</p>`;
        return;
    }

    if (sessionIdFromUrl) {
        await api.loadSessionFromAirtable(sessionIdFromUrl);
        recordStateForUndo(); // Set initial state after load
    } else {
        recordStateForUndo(); // Set initial blank state
    }

    // ... remaining initialization logic ...
    
    ui.hideLoadingState();
    setupEventListeners();
    updateRender();
}

function setupEventListeners() {
    // Setup all your event listeners here, e.g.
    document.getElementById('undo-btn').addEventListener('click', undo);
    document.getElementById('redo-btn').addEventListener('click', redo);
    
    // ... and so on for all other listeners ...
}

async function updateRender() {
    ui.updateHeader();
    await ui.updateFavoritesCarousel(api.calculateReactionScore); // Assuming calculateReactionScore is exported from api.js or moved
    await ui.applyFilters(); // Assuming applyFilters is in ui.js
    ui.updateSummaryToolbar();
}

initialize();
