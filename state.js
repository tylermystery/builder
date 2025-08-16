// state.js
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
    },
    history: {
        undoStack: [],
        redoStack: [],
        isRestoring: false,
    }
};
