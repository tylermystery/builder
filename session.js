const SESSIONS_KEY = 'eventBuilderSessions';
const MAX_STORED_SESSIONS = 10;

export function getStoredSessions() {
    try {
        const stored = localStorage.getItem(SESSIONS_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch (e) {
        console.error("Failed to parse stored sessions:", e);
        if (e.name === 'QuotaExceededError' || e.message.includes('FILE_ERROR_NO_SPACE')) {
            console.warn('Clearing local storage due to quota error.');
            localStorage.removeItem(SESSIONS_KEY);
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
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {
        console.error("Failed to store session:", e);
        if (e.name === 'QuotaExceededError' || e.message.includes('FILE_ERROR_NO_SPACE')) {
            console.warn('Storage quota exceeded; clearing oldest sessions.');
            localStorage.removeItem(SESSIONS_KEY);
            sessions = { [id]: { name, lastAccessed: new Date().toISOString() } };
            localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
        }
    }
}
