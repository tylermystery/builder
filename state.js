/*
 * Version: 1.6.1
 * Last Modified: 2025-08-22
 *
 * Changelog:
 *
 * v1.6.1 - 2025-08-22
 * - Restored history object to state for Beta Toolkit.
 *
 * v1.6.0 - 2025-08-21
 * - Removed obsolete history object for MVP cleanup.
 *
 * v1.5.0 - 2025-08-18
 * - Added `cardImageIndexes` map to UI state to track image gallery positions.
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
        currentSort: 'reactions-desc',
        cardImageIndexes: new Map(), // Tracks current image index for each card
    },
    history: {
        undoStack: [],
        redoStack: [],
        isRestoring: false,
    }
};
