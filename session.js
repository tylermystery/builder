/*
 * This is a shared utility module for session management.
 * It should not have any dependencies on other project files.
 */

export function getStoredSessions() { 
    return JSON.parse(localStorage.getItem('savedSessions') || '{}'); 
}

export function storeSession(id, name) { 
    const sessions = getStoredSessions(); 
    sessions[id] = name;
    localStorage.setItem('savedSessions', JSON.stringify(sessions)); 
}
