// FILE: state.js
/*
 * Version: 1.8.2
 * Last Modified: 2025-09-10
 *
 * Changelog:
 *
 * v1.8.2 - 2025-09-10
 * - Added ui.isInitializing flag to prevent "Fork on Load" bug.
 *
 * v1.8.1 - 2025-08-26
 * - Added ui.saveState to track autosave status.
 *
 * v1.8.0 - 2025-08-26
 * - Converted calendar.busyTimes to a Map to act as a cache for iCal feeds.
 *
 * v1.7.0 - 2025-08-24
 * - Added session.isOwned flag for "Fork on Edit" functionality.
 */

export const state = {
    records: {
        all: [],
        filtered: [],
    },
    cart: {
        items: new Map(),
        lockedItems: new Map(),
    },
    eventDetails: {
        combined: new Map(),
    },
    session: {
        id: null,
       
        isOwned: false, // true if the user created this session, false if loaded from a shared URL
        user: '',
        collaborators: [],
        reactions: new Map(),
    },
    calendar: {
        busyTimes: new Map(), // Will cache events from iCal feeds, keyed by URL
    },
    ui: {
        recordsCurrentlyDisplayed: 0,
 
        isLoadingMore: false,
        currentSort: 'reactions-desc',
        cardImageIndexes: new Map(), // Tracks current image index for each card
        saveState: 'SAVED', // Can be 'SAVED', 'MODIFIED', 'SAVING'
        isInitializing: true, // --- ADDED: Flag to prevent actions during initial load
    },
    history: {
        undoStack: [],
        redoStack: [],
        isRestoring: false,
    }
};
