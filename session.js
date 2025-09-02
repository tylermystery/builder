const SESSIONS_KEY = 'eventBuilderSessions';
const MAX_STORED_SESSIONS = 10;
const MAX_SESSION_DATA_SIZE = 1024 * 1024; // 1MB limit for session data

export function getStoredSessions() {
    try {
        const stored = localStorage.getItem(SESSIONS_KEY);
        if (!stored) return {};
        const sessions = JSON.parse(stored);
        // Validate size
        if (JSON.stringify(sessions).length > MAX_SESSION_DATA_SIZE) {
            console.warn('Stored sessions exceed size limit; clearing.');
            localStorage.removeItem(SESSIONS_KEY);
            return {};
        }
        return sessions;
    } catch (e) {
        console.error("Failed to parse stored sessions:", e);
        if (e.name === 'QuotaExceededError' || e.message.includes('FILE_ERROR_NO_SPACE')) {
            console.warn('Clearing all local storage due to quota error.');
            localStorage.clear(); // Clear all keys to ensure recovery
        }
        return {};
    }
}

export function storeSession(id, name) {
    if (!id || !name) return;
    let sessions = getStoredSessions();
    sessions[id] = { name, lastAccessed: new Date().toISOString() };
    
    const sortedEntries = Object.entries(sessions).sort((a, b) => new Date(b[1].lastAccessed) - new Date(a[1].lastAccessed));
    if (sortedEntries.length > MAX_STORED_SESSIONS) {
        sessions = Object.fromEntries(sortedEntries.slice(0, MAX_STORED_SESSIONS));
    }
    
    try {
        const dataString = JSON.stringify(sessions);
        if (dataString.length > MAX_SESSION_DATA_SIZE) {
            console.warn('Session data too large; clearing oldest sessions.');
            sessions = { [id]: { name, lastAccessed: new Date().toISOString() } };
        }
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {
        console.error("Failed to store session:", e);
        if (e.name === 'QuotaExceededError' || e.message.includes('FILE_ERROR_NO_SPACE')) {
            console.warn('Clearing all local storage due to quota error.');
            localStorage.clear();
            sessions = { [id]: { name, lastAccessed: new Date().toISOString() } };
            localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
        }
    }
}
