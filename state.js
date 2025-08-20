/*
 * Version: 1.5.0
 * Last Modified: 2025-08-18
 *
 * Changelog:
 *
 * v1.5.0 - 2025-08-18
 * - [cite_start]Added `cardImageIndexes` map to UI state to track image gallery positions. [cite: 407]
 *
 * v1.2.0 - 2025-08-17
 * - [cite_start]Added `currentSort` property to the UI state for unified sorting. [cite: 408]
 *
 * v1.0.0 - 2025-08-17
 * - Initial versioning and changelog added.
 [cite_start]*/ [cite: 409]

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
       
        [cite_start]user: '', [cite: 410]
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
       
        [cite_start]redoStack: [], [cite: 411]
        isRestoring: false,
    }
};
