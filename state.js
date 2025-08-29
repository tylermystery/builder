/*
 * Version: 1.8.2
 * Last Modified: 2025-08-29
 *
 * Changelog:
 *
 * v1.8.2 - 2025-08-29
 * - Added ui.activeCategoryFilter to track sidebar filter state.
 *
 * v1.8.1 - 2025-08-26
 * - Added ui.saveState to track autosave status.
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
        user: '',
        collaborators: [],
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
        activeCategoryFilter: null, // New property to track the selected category
    },
    history: {
        undoStack: [],
        redoStack: [],
        isRestoring: false,
    }
};
