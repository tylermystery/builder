// FILE: session.js
const SESSIONS_KEY = 'eventBuilderSessions';
const MAX_STORED_SESSIONS = 10; // Add this limit

export function getStoredSessions() {
    try {
        const stored = localStorage.getItem(SESSIONS_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch (e) {
        console.error("Failed to parse stored sessions:", e);
        return {};
    }
}

export function storeSession(id, name) {
    if (!id || !name) return;
    let sessions = getStoredSessions();
    sessions[id] = { name, lastAccessed: new Date().toISOString() };
    
    // Sort by lastAccessed descending and keep only top N
    const sortedEntries = Object.entries(sessions).sort((a, b) => new Date(b[1].lastAccessed) - new Date(a[1].lastAccessed));
    if (sortedEntries.length > MAX_STORED_SESSIONS) {
        sessions = Object.fromEntries(sortedEntries.slice(0, MAX_STORED_SESSIONS));
    }
    
    try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {
        console.error("Failed to store session:", e);
        if (e.name === 'QuotaExceededError') {
            console.warn('Storage quota exceeded; clearing oldest sessions.');
            // Optionally clear more aggressively
            localStorage.removeItem(SESSIONS_KEY);
        }
    }
}
