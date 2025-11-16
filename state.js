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
    console.log('[State] ========== setState CALLED ==========');
    console.log('[State] Timestamp:', new Date().toISOString());
    console.log('[State] New state being applied:', JSON.stringify(newState, (key, value) => {
        // Convert Sets to arrays for logging
        if (value instanceof Set) {
            return Array.from(value);
        }
        // Convert Maps to objects for logging
        if (value instanceof Map) {
            return Object.fromEntries(value);
        }
        return value;
    }, 2));
    
    // Log user state changes specifically
    if (newState.session?.user) {
        console.log('[State] User state update detected:');
        console.log('[State]   - isAuthenticated:', newState.session.user.isAuthenticated);
        console.log('[State]   - id:', newState.session.user.id);
        console.log('[State]   - name:', newState.session.user.name);
        console.log('[State]   - email:', newState.session.user.email);
        if (newState.session.user.likedItemIds) {
            console.log('[State]   - likedItemIds:', Array.from(newState.session.user.likedItemIds));
        }
    }
    
    let updatedState = { ...state, ...newState };

    // FIX: Deep merge for UI properties to ensure continuity
    if (newState.ui) {
        updatedState.ui = { 
            ...state.ui, 
            ...newState.ui 
        };
        // CRITICAL: Ensure currentProgress never gets lost during initialization
        // If the new state doesn't explicitly include currentProgress, preserve the old value
        if (newState.ui.currentProgress === undefined && state.ui.currentProgress !== undefined) {
            console.log('[State] Preserving currentProgress during setState:', state.ui.currentProgress);
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
    // --- END FIX ---
    
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
    console.log('[State] State updated successfully');
    console.log('[State] Current user state after update:');
    console.log('[State]   - isAuthenticated:', state.session.user.isAuthenticated);
    console.log('[State]   - id:', state.session.user.id);
    console.log('[State]   - name:', state.session.user.name);
    console.log('[State]   - likedItemIds.size:', state.session.user.likedItemIds.size);
    console.log('[State] ========== setState COMPLETE ==========');
    // document.dispatchEvent(new CustomEvent('stateChanged'));
}
