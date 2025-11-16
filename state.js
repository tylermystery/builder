// FILE: state.js (REPLACE ENTIRE FILE)
/*
 * Version: 3.4.1
 * Last Modified: 2025-11-01
 *
 * Changelog:
 * v3.4.1 - 2025-11-01
 * - FIX: Implemented a specific deep-merge for the 'ui' property to prevent 'toFixed of undefined' errors 
 * when updating nested state variables (like currentProgress) that rely on the previous state.
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
        items: new Map(),       // \"Ideas\" (formerly Favorites), populated by \"Save for Later\"
        lockedItems: new Map(), // \"Event Plan\"
        customItems: new Map(), // ADD THIS LINE: Holds AI-parsed item data
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
        
        // --- THIS IS THE NEW LINE ---
        itemPositions: new Map(), // Stores { x: 120, y: 50, z: 1 } for each recordId
        // --- END NEW LINE ---
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
        currentProgress: 0.3, // NEW: Background color progress (0.0 to 1.0) - Start at cyan/blue range
    },
};

export function setState(newState) {
    let updatedState = { ...state, ...newState };

    // FIX: Deep merge for UI properties to ensure continuity
    if (newState.ui) {
        updatedState.ui = { 
            ...state.ui, 
            ...newState.ui 
        };
        if (newState.ui.currentProgress === undefined && state.ui.currentProgress !== undefined) {
            updatedState.ui.currentProgress = state.ui.currentProgress;
        }
    }
    
    // --- ADD THIS BLOCK TO FIX THE BUG ---
    if (newState.records) {
        updatedState.records = {
            ...state.records,
            ...newState.records
        };
    }
    
    // Also ensuring deep merge for session.user is always safe
    if (newState.session && newState.session.user) {
        updatedState.session = {
            ...state.session,
            ...newState.session,
            user: {
                ...state.session.user,
                ...newState.session.user
            }
        };
    } else if (newState.session) {
        // Handle session updates without user data
        updatedState.session = {
            ...state.session,
            ...newState.session,
        };
    }


    state = updatedState;
}
