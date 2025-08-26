/*
 * Version: 1.8.1
 * Last Modified: 2025-08-26
 *
 * Changelog:
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
    },
    history: {
        undoStack: [],
        redoStack: [],
        isRestoring: false,
    }
};
