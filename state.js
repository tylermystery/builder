// FILE: state.js
/*
 * Version: 3.2.0
 * Last Modified: 2025-09-24
 *
 * Changelog:
 * v3.2.0 - 2025-09-24
 * - Added `flaggedUsers` and `bannedUsers` sets for moderation.
 * - Added a new Pusher channel map for item-specific chats.
 * v3.1.0 - 2025-09-21
 * - Added a `stores` object to the state to hold records from the new Stores table.
 * v3.0.0 - 2025-09-20
 * - Updated user session object to support full authentication state.
 */

export let state = {
    stores: {
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
        storeId: null,
        user: { 
            isAuthenticated: false,
            id: null,
            name: '',
            email: '',
            amountReceived: 0,
            amountReceivedNote: '',
            isOwner: false,
            ownerDashboardId: null
        },
        userProfiles: new Map(),
        reactions: new Map(),
        flaggedUsers: new Set(), // New: Stores IDs of users with flagged content
        bannedUsers: new Set(), // New: Stores IDs of banned users
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
