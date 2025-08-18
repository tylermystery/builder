/*
 * Version: 1.2.0
 * Last Modified: 2025-08-17
 *
 * Changelog:
 *
 * v1.2.0 - 2025-08-17
 * - Added `currentSort` property to the UI state for unified sorting.
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
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
        user: '',
        collaborators: [],
        reactions: new Map(),
    },
    ui: {
        recordsCurrentlyDisplayed: 0,
        isLoadingMore: false,
        currentSort: 'reactions-desc', // Default sort method
    },
    history: {
        undoStack: [],
        redoStack: [],
        isRestoring: false,
    }
};
