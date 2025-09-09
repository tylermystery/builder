/*
 * Version: 1.8.2
 * Last Modified: 2025-09-09
 *
 * Changelog:
 * v1.8.2 - 2025-09-09
 * - Added cart.orderedLockedItems to track order of locked items for itinerary.
 * v1.8.1 - 2025-08-26
 * - Added ui.saveState to track autosave status.
 * v1.8.0 - 2025-08-26
 * - Converted calendar.busyTimes to a Map to act as a cache for iCal feeds.
 * v1.7.0 - 2025-08-24
 * - Added session.isOwned flag for "Fork on Edit" functionality.
 */

export const state = {
    records: {
        all: [],
        filtered: [],
    },
    cart: {
        items: new Map(),
        lockedItems: new Map(),
        orderedLockedItems: [], // Array of recordIds in display order
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
    },
    history: {
        undoStack: [],
        redoStack: [],
        isRestoring: false,
    }
};
