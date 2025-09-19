// FILE: state.js
/*
 * Version: 1.9.0
 * Last Modified: 2025-09-19
 *
 * Changelog:
 * v1.9.0 - 2025-09-19
 * - Added `amountReceived` and `amountReceivedNote` to the user session object for payment tracking.
 * v1.8.2 - 2025-09-10
 * - Added ui.isInitializing flag to prevent "Fork on Load" bug.
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
        isOwned: false,
        user: { // User object can hold auth state and payment info
            isAuthenticated: false,
            name: '',
            email: '',
            amountReceived: 0,
            amountReceivedNote: '',
        },
        collaborators: [],
        userProfiles: new Map(),
        reactions: new Map(),
    },
    calendar: {
        busyTimes: new Map(),
    },
    ui: {
        recordsCurrentlyDisplayed: 0,
        isLoadingMore: false,
        currentSort: 'reactions-desc',
        cardImageIndexes: new Map(),
        saveState: 'SAVED',
        isInitializing: true,
    },
    history: {
        undoStack: [],
        redoStack: [],
        isRestoring: false,
    }
};
