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
        archive: [], // Ghost items (archived/deleted items referenced in session history)
        _byId: null, // Lazy-built Map<id, record> index for O(1) lookups
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
            ownedStoreId: null,
            likedItemIds: new Set(), // ADDED: Stores persistent liked item IDs
        },
        userProfiles: new Map(),
        reactions: new Map(),
        flaggedUsers: new Set(),
        bannedUsers: new Set(),

        // --- THIS IS THE NEW LINE ---
        itemPositions: new Map(), // Stores { x: 120, y: 50, z: 1 } for each recordId
        // --- END NEW LINE ---

        // Plan item organization for presentation view
        planItemOrder: [], // Array of record IDs for custom ordering (empty = default order)
        archivedItems: new Set(), // Set of record IDs that have been archived
        completedItems: new Set(), // Set of record IDs that have been marked as completed
        goalItems: new Set(), // Set of record IDs marked as goals/inspiration (typically top-ranked items)
        relatedGroups: [], // Array of arrays, each containing record IDs that are related/merged together

        // Iteration history for versioned evolution (Maturity Engine)
        // Map of recordId -> { currentIndex: number, iterations: Array<{ title, description, imageURL, tags, realm, timestamp, author, refinementNote, maturityDelta }> }
        itemIterations: new Map(),

        // Recent chats list for expandable chat history
        recentChats: [], // Array of { id, type: 'session'|'item', name, lastMessage, lastMessageTime, unreadCount }
    },
    calendar: {
        busyTimes: new Map(),
    },
    // Universal Vitality system - tracks net health benefit across four realms
    // goodnessScore blends vitality (70%) with community sentiment (30%)
    vitality: {
        timeScopeIndex: 4,        // Index into TIME_SCOPES (default: '1 Year')
        itemScores: new Map(),    // recordId -> { cosmological, planetary, collective, internal, net, netEmoji, goodnessScore, goodnessEmoji, sentiment }
        planNet: 0,               // Overall plan net vitality (-1.0 to 1.0)
        planNetEmoji: '⚖️',      // Current Net Emoji for the plan
        planGoodness: 0,          // Overall plan goodness (-1.0 to 1.0), blends vitality + sentiment
        planGoodnessEmoji: '⚖️',  // Current Goodness Emoji for the plan
        synergies: [],            // Array of { itemA, itemB, label, multiplier } active synergies
        dominantRealm: null,      // 'cosmological' | 'planetary' | 'collective' | 'internal' | null
    },
    ui: {
        recordsCurrentlyDisplayed: 0,
        isLoadingMore: false,
        saveState: 'SAVED',
        isInitializing: true,
        activeShopId: null,
        currentProgress: 0.3, // NEW: Background color progress (0.0 to 1.0) - Start at cyan/blue range
    },
    // Phase 3: Tasks for Project Management
    tasks: {
        all: new Map(),           // taskId -> task record
        byProject: new Map(),     // projectId -> [task records]
    },
    // Phase 4: Permissions & Security
    permissions: {
        currentRole: null,        // 'owner' | 'editor' | 'viewer' | null (loading/unknown)
        isLoading: true,          // True while permissions are being fetched
        permissionRecord: null,   // The Collaborator_Permissions record if exists
    },
};

/**
 * Get a record by ID using a lazily-built index for O(1) lookups.
 * Falls back to linear search if the index is stale.
 * @param {string} id - The record ID
 * @returns {Object|undefined} The record, or undefined if not found
 */
export function getRecordById(id) {
    if (!id) return undefined;
    // Build index lazily on first access or when invalidated
    if (!state.records._byId) {
        state.records._byId = new Map();
        for (const r of state.records.all) {
            if (r && r.id) state.records._byId.set(r.id, r);
        }
    }
    return state.records._byId.get(id);
}

/**
 * Invalidate the records-by-id index. Call this whenever state.records.all changes.
 */
export function invalidateRecordsIndex() {
    state.records._byId = null;
}

/**
 * Get aggregate reactions across all variations for an item.
 * With per-variation compound keys (recordId::variationAuthorId),
 * this aggregates reactions across all variations into a single Map.
 * @param {string} recordId
 * @returns {Map<userId, emoji>} Aggregated reactions
 */
export function getAggregateReactions(recordId) {
    const aggregate = new Map();
    const prefix = `${recordId}::`;

    for (const [key, reactionsMap] of state.session.reactions.entries()) {
        if (key === recordId || key.startsWith(prefix)) {
            if (reactionsMap instanceof Map) {
                for (const [userId, emoji] of reactionsMap.entries()) {
                    aggregate.set(userId, emoji);
                }
            }
        }
    }
    return aggregate;
}

export function setState(newState) {
    // Defensive check: ensure newState is a valid object
    if (!newState || typeof newState !== 'object') {
        console.warn('[State] setState called with invalid newState:', newState);
        return;
    }

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

    // Deep merge for records to preserve all properties
    if (newState.records) {
        updatedState.records = {
            ...state.records,
            ...newState.records,
            _byId: null // Invalidate index when records change
        };
    }

    // Deep merge for stores to preserve all properties
    if (newState.stores) {
        updatedState.stores = {
            ...state.stores,
            ...newState.stores
        };
    }

    // Deep merge for cart to preserve Maps
    if (newState.cart) {
        updatedState.cart = {
            ...state.cart,
            ...newState.cart
        };
    }

    // Deep merge for eventDetails to preserve Maps
    if (newState.eventDetails) {
        updatedState.eventDetails = {
            ...state.eventDetails,
            ...newState.eventDetails
        };
    }

    // Deep merge for tasks to preserve Maps
    if (newState.tasks) {
        updatedState.tasks = {
            ...state.tasks,
            ...newState.tasks
        };
    }

    // Deep merge for vitality to preserve Maps
    if (newState.vitality) {
        updatedState.vitality = {
            ...state.vitality,
            ...newState.vitality
        };
    }

    // Deep merge for permissions
    if (newState.permissions) {
        updatedState.permissions = {
            ...state.permissions,
            ...newState.permissions
        };
    }

    // Deep merge for session.user is always safe
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
