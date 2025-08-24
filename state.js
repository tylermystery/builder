/*
 * Version: 1.7.0
 * Last Modified: 2025-08-24
 *
 * Changelog:
 *
 * v1.7.0 - 2025-08-24
 * - Added session.isOwned flag for "Fork on Edit" functionality.
 *
 * v1.6.1 - 2025-08-22
 * - Restored history object to state for Beta Toolkit.
 *
 * v1.6.0 - 2025-08-21
 * - Removed obsolete history object for MVP cleanup.
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
    ui: {
        recordsCurrentlyDisplayed: 0,
        isLoadingMore: false,
        currentSort: 'reactions-desc',
        cardImageIndexes: new Map(), // Tracks current image index for each card
    },
    history: {
        undoStack: [],
        redoStack: [],
        isRestoring: false,
    }
};
