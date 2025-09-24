// FILE: state.js
/*
 * Version: 3.1.0
 * Last Modified: 2025-09-21
 *
 * Changelog:
 * v3.1.0 - 2025-09-21
 * - Added a `stores` object to the state to hold records from the new Stores table.
 * v3.0.0 - 2025-09-20
 * - Updated user session object to support full authentication state.
 */

export let state = {
    stores: { // <-- ADD THIS OBJECT
        all: [],
    },
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
        storeId: null, // <-- ADD THIS LINE
        user: { 
            isAuthenticated: false,
            id: null,
            name: '',
            email: '',
            amountReceived: 0,
            amountReceivedNote: '',
            isOwner: false, // <-- ADD THIS
            ownerDashboardId: null // <-- ADD THIS
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
        activeShopId: null,
    },
};

// Allows modules to update the state and trigger re-renders if needed
export function setState(newState) {
    state = { ...state, ...newState };
}
