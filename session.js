// FILE: session.js

export function getStoredSessions() { 
    return JSON.parse(localStorage.getItem('savedSessions') || '{}'); 
}

export function storeSession(id, name) { 
    const sessions = getStoredSessions(); 
    sessions[id] = name;
    localStorage.setItem('savedSessions', JSON.stringify(sessions)); 
}
