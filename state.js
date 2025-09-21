// FILE: state.js
/*
 * Version: 3.0.0
 * Last Modified: 2025-09-20
 *
 * Changelog:
 * v3.0.0 - 2025-09-20
 * - Updated user session object to support full authentication state.
 */

export let state = {
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
        user: { 
            isAuthenticated: false,
            id: null,
            name: '',
            email: '',
            amountReceived: 0,
            amountReceivedNote: '',
        },
        userProfiles: new Map(),
        reactions: new Map(),
    },
    calendar: {
        busyTimes: new Map(),
    },
    ui: {
        recordsCurrentlyDisplayed: 0,
        isLoadingMore: false,
        saveState: 'SAVED',
        isInitializing: true,
        activeShopId: null, // <-- ADD THIS LINE
    },

};

// Allows modules to update the state and trigger re-renders if needed
export function setState(newState) {
    state = { ...state, ...newState };
}
