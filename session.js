/*
 * Version: 1.0.1
 * Last Modified: 2025-09-02
 * Changelog:
 * v1.0.1 - 2025-09-02
 *   - Added storage size logging and stricter size limits.
 */
import { log } from './utils/debug.js';

const SESSIONS_KEY = 'eventBuilderSessions';
const MAX_STORED_SESSIONS = 10;
const MAX_SESSION_DATA_SIZE = 512 * 1024; // Reduced to 512KB

export function getStoredSessions() {
    try {
        const stored = localStorage.getItem(SESSIONS_KEY);
        if (!stored) {
            log('Session', 'No stored sessions found.');
            return {};
        }
        const sessions = JSON.parse(stored);
        const size = JSON.stringify(sessions).length;
        log('Session', `Loaded sessions, size: ${size} bytes`);
        if (size > MAX_SESSION_DATA_SIZE) {
            console.warn('Stored sessions exceed size limit; clearing.');
            log('Session', 'Clearing sessions due to size limit.');
            localStorage.removeItem(SESSIONS_KEY);
            return {};
        }
        return sessions;
    } catch (e) {
        console.error("Failed to parse stored sessions:", e);
        log('Session', `Failed to parse sessions: ${e.message}`);
        if (e.name === 'QuotaExceededError' || e.message.includes('FILE_ERROR_NO_SPACE')) {
            console.warn('Clearing all local storage due to quota error.');
            log('Session', 'Clearing all local storage due to quota error.');
            localStorage.clear();
        }
        return {};
    }
}

export function storeSession(id, name) {
    if (!id || !name) {
        log('Session', 'Invalid session ID or name, skipping storage.');
        return;
    }
    let sessions = getStoredSessions();
    sessions[id] = { name, lastAccessed: new Date().toISOString() };
    
    const sortedEntries = Object.entries(sessions).sort((a, b) => new Date(b[1].lastAccessed) - new Date(a[1].lastAccessed));
    if (sortedEntries.length > MAX_STORED_SESSIONS) {
        sessions = Object.fromEntries(sortedEntries.slice(0, MAX_STORED_SESSIONS));
        log('Session', `Trimmed sessions to ${MAX_STORED_SESSIONS}`);
    }
    
    try {
        const dataString = JSON.stringify(sessions);
        const size = dataString.length;
        log('Session', `Storing sessions, size: ${size} bytes`);
        if (size > MAX_SESSION_DATA_SIZE) {
            console.warn('Session data too large; clearing oldest sessions.');
            log('Session', 'Clearing sessions due to size limit.');
            sessions = { [id]: { name, lastAccessed: new Date().toISOString() } };
        }
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
        log('Session', 'Sessions stored successfully.');
    } catch (e) {
        console.error("Failed to store session:", e);
        log('Session', `Failed to store session: ${e.message}`);
        if (e.name === 'QuotaExceededError' || e.message.includes('FILE_ERROR_NO_SPACE')) {
            console.warn('Clearing all local storage due to quota error.');
            log('Session', 'Clearing all local storage due to quota error.');
            localStorage.clear();
            sessions = { [id]: { name, lastAccessed: new Date().toISOString() } };
            localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
            log('Session', 'Stored single session after clearing.');
        }
    }
}
