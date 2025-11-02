// FILE: state.js (REPLACE ENTIRE FILE)
/*
 * Version: 3.3.0
 * Last Modified: 2025-10-24
 *
 * Changelog:
 * v3.4.0 - 2025-11-01
 * - Added 'currentProgress' to state.ui for the background color engine.
 * v3.3.0 - 2025-10-24
 * - Added `likedItemIds` Set to state.session.user for persistent like tracking.
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
        items: new Map(),       // "Ideas" (formerly Favorites), populated by "Save for Later"
        lockedItems: new Map(), // "Event Plan"
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
            paymentHistory: [],
            rsvps: new Set(),
            isOwner: false,
            ownerDashboardId: null,
            likedItemIds: new Set(), // ADDED: Stores persistent liked item IDs
        },
        userProfiles: new Map(),
        reactions: new Map(),
        flaggedUsers: new Set(),
        bannedUsers: new Set(),
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
        currentProgress: 0.0, // NEW: Background color progress (0.0 to 1.0)
    },
};

// Allows modules to update the state and trigger re-renders if needed
export function setState(newState) {
    // Basic merge, assumes newState is flat or carefully structured
    // For nested updates like user properties, the caller should provide the full nested object
    state = { ...state, ...newState };

    // Example deep merge for session.user if needed (more robust but complex)
    // if (newState.session && newState.session.user) {
    //     state = {
    //         ...state,
    //         session: {
    //             ...state.session,
    //             user: {
    //                 ...state.session.user,
    //                 ...newState.session.user
    //             }
    //         }
    //     };
    //     // Handle other potential nested updates similarly
    // } else {
    //      state = { ...state, ...newState };
    // }

    // Optionally, trigger events or re-renders here if using a framework/library
    // document.dispatchEvent(new CustomEvent('stateChanged'));
}
