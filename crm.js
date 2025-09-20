// --- Configuration ---
const AIRTABLE_PAT = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const SESSIONS_TABLE = 'Sessions';
const MESSAGES_TABLE = 'Messages';
const PUSHER_KEY = '236f480714e5001590b5';
const PUSHER_CLUSTER = 'us3';

// --- DOM Elements ---
const activityFeed = document.getElementById('activity-feed');
const sessionListContainer = document.getElementById('session-list');
const loadingIndicator = document.getElementById('loading');

// --- Airtable Fetching ---
async function fetchAirtableData(tableName) {
    let allRecords = [];
    let offset = null;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${tableName}`;
    
    try {
        do {
            const response = await fetch(`${url}?offset=${offset || ''}`, {
                headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` }
            });
            if (!response.ok) throw new Error(`Failed to fetch from ${tableName}`);
            
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset;
        } while (offset);
        return allRecords;
    } catch (error) {
        console.error("Airtable fetch error:", error);
        loadingIndicator.textContent = `Error loading data: ${error.message}`;
        return [];
    }
}

// --- UI Rendering ---
function renderActivityItem(message, sessionName, prepend = false) {
    const item = document.createElement('div');
    item.className = 'feed-item';

    const time = new Date(message.fields.Timestamp).toLocaleString();
    const sessionUrl = `/?session=${message.fields.SessionID[0]}`;

    item.innerHTML = `
        <p>"${message.fields.Content}"</p>
        <div class="meta">
            <strong>${message.fields.SenderName}</strong> in 
            <a href="${sessionUrl}" target="_blank">${sessionName || message.fields.SessionID[0]}</a>
            <small> - ${time}</small>
        </div>
    `;

    if (prepend) {
        activityFeed.prepend(item);
    } else {
        activityFeed.appendChild(item);
    }
}

function renderSessionList(sessions) {
    sessionListContainer.innerHTML = ''; // Clear existing list
    sessions.forEach(session => {
        const link = document.createElement('a');
        link.href = `/?session=${session.id}`;
        link.target = '_blank';
        
        const lastActivity = new Date(session.lastActivity).toLocaleString();
        
        link.innerHTML = `
            <strong>${session.fields.Name || 'Unnamed Session'}</strong>
            <small>Last message: ${lastActivity}</small>
        `;
        sessionListContainer.appendChild(link);
    });
}

// --- Main Initialization ---
async function initializeDashboard() {
    const [sessions, messages] = await Promise.all([
        fetchAirtableData(SESSIONS_TABLE),
        fetchAirtableData(MESSAGES_TABLE)
    ]);
    
    loadingIndicator.style.display = 'none';

    // Create a map for quick session name lookup
    const sessionMap = new Map(sessions.map(s => [s.id, s.fields.Name]));

    // Sort messages by timestamp descending
    messages.sort((a, b) => new Date(b.fields.Timestamp) - new Date(a.fields.Timestamp));
    
    // Render the initial activity feed
    messages.forEach(message => {
        // --- FIX: Add a check to ensure SessionID exists and is a valid array ---
        if (message.fields.SessionID && Array.isArray(message.fields.SessionID) && message.fields.SessionID.length > 0) {
            const sessionName = sessionMap.get(message.fields.SessionID[0]);
            renderActivityItem(message, sessionName);
        }
    });
    
    // Calculate last activity for each session
    sessions.forEach(session => {
        // --- FIX: Add a check here as well to safely find the last message ---
        const lastMessage = messages.find(m => 
            m.fields.SessionID && Array.isArray(m.fields.SessionID) && m.fields.SessionID.length > 0 && m.fields.SessionID[0] === session.id
        );
        session.lastActivity = lastMessage ? lastMessage.fields.Timestamp : session.createdTime;
    });

    // Sort sessions by last activity descending
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    // Render the sorted session list
    renderSessionList(sessions);
    
    // Initialize Pusher for real-time updates
    setupPusher(sessionMap);
}

// --- Real-Time Updates ---
function setupPusher(sessionMap) {
    const pusher = new Pusher(PUSHER_KEY, { cluster: PUSHER_CLUSTER });
    
    // We need to listen to all possible session channels. This is a simple approach.
    // A more advanced system might use a single "admin" channel.
    sessionMap.forEach((name, id) => {
        const channel = pusher.subscribe(`presence-session-${id}`);
        channel.bind('client-new-message', (data) => {
            const fakeMessageRecord = {
                fields: {
                    Content: data.content,
                    SenderName: data.senderName,
                    SessionID: [id],
                    Timestamp: data.timestamp
                }
            };
            // Prepend new messages to the top of the feed
            renderActivityItem(fakeMessageRecord, name, true);
        });
    });
}

// Start the application
initializeDashboard();
