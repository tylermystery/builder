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

// --- NEW: Message Analysis for Highlighting ---
function analyzeMessageContent(content) {
    const questionKeywords = ['?', 'how', 'what', 'when', 'where', 'why', 'can we', 'is it', 'tmt'];
    const followupKeywords = ['follow up', 'circle back', 'next steps', 'send me', 'proposal'];

    const lowerCaseContent = content.toLowerCase();

    if (questionKeywords.some(keyword => lowerCaseContent.includes(keyword))) {
        return 'highlight-question'; // Yellow for questions
    }
    if (followupKeywords.some(keyword => lowerCaseContent.includes(keyword))) {
        return 'highlight-followup'; // Green for follow-ups
    }
    return ''; // No highlight
}

// --- UI Rendering ---
function renderActivityItem(message, sessionName, prepend = false) {
    const item = document.createElement('div');
    const highlightClass = analyzeMessageContent(message.fields.Content);
    item.className = `feed-item ${highlightClass}`;

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

// --- UPDATED: Session List Rendering with More Stats ---
function renderSessionList(sessions, messages) {
    sessionListContainer.innerHTML = ''; // Clear existing list

    // First, calculate stats for each session
    sessions.forEach(session => {
        const sessionMessages = messages.filter(m => m.fields.SessionID && m.fields.SessionID[0] === session.id);
        const lastMessage = sessionMessages[0]; // Messages are pre-sorted descending
        
        session.lastActivity = lastMessage ? lastMessage.fields.Timestamp : session.createdTime;
        session.messageCount = sessionMessages.length;
        
        // Calculate total value (requires parsing the JSON)
        let totalValue = 0;
        if (session.fields['Items with Variations']) {
            try {
                const sessionData = JSON.parse(session.fields['Items with Variations']);
                const lockedItems = new Map(Object.entries(sessionData.lockedInItems || {}));
                lockedItems.forEach(item => {
                    // This is a simplified calculation. A full version would need to fetch item prices.
                    // For now, we assume a placeholder or that price is stored with the item.
                    totalValue += (item.price || 100) * (item.quantity || 1); 
                });
            } catch (e) { /* Ignore parsing errors */ }
        }
        session.totalValue = totalValue;

        // Determine event stage
        session.stage = (session.fields['Amount Received'] || 0) > 0 ? 'Reserved' : 'Planning';
    });

    // Sort sessions by last activity
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    // Now, render the list
    sessions.forEach(session => {
        const link = document.createElement('a');
        link.href = `/?session=${session.id}`;
        link.target = '_blank';
        
        const lastActivity = new Date(session.lastActivity).toLocaleString();
        
        link.innerHTML = `
            <strong>${session.fields.Name || 'Unnamed Session'}</strong>
            <div class="session-stats">
                <span>Value: $${session.totalValue.toFixed(2)}</span>
                <span>Stage: ${session.stage}</span>
                <span>${session.messageCount} messages</span>
            </div>
            <small>Last active: ${lastActivity}</small>
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

    const sessionMap = new Map(sessions.map(s => [s.id, s.fields.Name]));

    messages.sort((a, b) => new Date(b.fields.Timestamp) - new Date(a.fields.Timestamp));
    
    messages.forEach(message => {
        if (message.fields.SessionID && Array.isArray(message.fields.SessionID) && message.fields.SessionID.length > 0) {
            const sessionName = sessionMap.get(message.fields.SessionID[0]);
            renderActivityItem(message, sessionName);
        }
    });
    
    renderSessionList(sessions, messages);
    
    setupPusher(sessionMap, sessions, messages);
}

// --- Real-Time Updates ---
function setupPusher(sessionMap, sessions, messages) {
    const pusher = new Pusher(PUSHER_KEY, {
        cluster: PUSHER_CLUSTER,
        authEndpoint: '/api/pusher-auth',
        auth: {
            params: {
                user_id: `admin-${Date.now()}`,
                user_name: 'Dashboard Admin'
            }
        }
    });
    
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
            
            renderActivityItem(fakeMessageRecord, name, true);
            
            // Add the new message to our local cache and re-render the session list
            messages.unshift(fakeMessageRecord);
            const currentSessions = sessions.map(s => s.id === id ? { ...s } : s);
            renderSessionList(currentSessions, messages);
        });
    });
}

// Start the application
initializeDashboard();

