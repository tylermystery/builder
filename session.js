const SESSIONS_KEY = 'eventBuilderSessions';

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
    const sessions = getStoredSessions();
    sessions[id] = { name, lastAccessed: new Date().toISOString() };
    try {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {
        console.error("Failed to store session:", e);
    }
}
