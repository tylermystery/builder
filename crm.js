// --- Configuration ---
const AIRTABLE_PAT = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const SESSIONS_TABLE = 'Sessions';
const MESSAGES_TABLE = 'Messages';
const CATALOG_TABLE = 'tblUA4uuS8IYlhKpD'; 
const PUSHER_KEY = '236f480714e5001590b5';
const PUSHER_CLUSTER = 'us3';

// --- State ---
let currentlySelectedSessionId = null;
let allSessions = [];
let allMessages = [];
let allCatalogItems = [];
let sessionMap = new Map();
let catalogMap = new Map();

// --- DOM Elements ---
const loadingIndicator = document.getElementById('loading');
const sessionListContainer = document.getElementById('session-list');
const activityFeed = document.getElementById('activity-feed');
const planView = document.getElementById('plan-view');
const planViewPlaceholder = document.getElementById('plan-view-placeholder');
const chatPane = document.getElementById('chat-pane');
const chatPlaceholder = document.getElementById('chat-placeholder');
const chatMessagesContainer = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

// --- Airtable Fetching ---
async function fetchAirtableData(tableName) {
    let allRecords = [];
    let offset = null;
    const url = `https://api.airtable.com/v0/${BASE_ID}/${tableName}`;
    try {
        do {
            const response = await fetch(`${url}?offset=${offset || ''}`, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
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

async function postChatMessage(sessionId, content) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${MESSAGES_TABLE}`;
    const payload = {
        records: [{
            fields: {
                SessionID: [sessionId],
                SenderID: 'admin-dashboard',
                SenderName: 'TMT Admin',
                Content: content,
                Timestamp: new Date().toISOString() // FIX: Add timestamp to the payload
            }
        }]
    };
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to post message to Airtable.');
    } catch (error) {
        console.error("Error posting chat message:", error);
    }
}

// --- Message Analysis ---
function analyzeMessageContent(content) {
    const questionKeywords = ['?', 'how', 'what', 'when', 'where', 'why', 'can we', 'is it', 'tmt'];
    const followupKeywords = ['follow up', 'circle back', 'next steps', 'send me', 'proposal'];
    const lowerCaseContent = content.toLowerCase();

    if (questionKeywords.some(keyword => lowerCaseContent.includes(keyword))) return 'highlight-question';
    if (followupKeywords.some(keyword => lowerCaseContent.includes(keyword))) return 'highlight-followup';
    return '';
}

// --- UI Rendering ---
function renderActivityItem(message, sessionName, prepend = false) {
    const item = document.createElement('div');
    const highlightClass = analyzeMessageContent(message.fields.Content);
    item.className = `feed-item ${highlightClass}`;
    item.dataset.sessionId = message.fields.SessionID[0];

    const time = new Date(message.fields.Timestamp).toLocaleString();
    
    item.innerHTML = `
        <p>"${message.fields.Content}"</p>
        <div class="meta">
            <strong>${message.fields.SenderName}</strong> in 
            <a href="#" class="session-link">${sessionName || message.fields.SessionID[0]}</a>
            <small> - ${time}</small>
        </div>
    `;

    if (prepend) activityFeed.prepend(item);
    else activityFeed.appendChild(item);
}

function renderSessionList() {
    sessionListContainer.innerHTML = '';
    
    allSessions.forEach(session => {
        const sessionMessages = allMessages.filter(m => m.fields.SessionID && m.fields.SessionID[0] === session.id);
        const lastMessage = sessionMessages[0];
        
        session.lastActivity = lastMessage ? lastMessage.fields.Timestamp : session.createdTime;
        session.messageCount = sessionMessages.length;
        
        let totalValue = 0;
        if (session.fields['Items with Variations']) {
            try {
                const data = JSON.parse(session.fields['Items with Variations']);
                const lockedItems = new Map(Object.entries(data.lockedInItems || {}));
                lockedItems.forEach((itemInfo, itemId) => {
                    const catalogItem = catalogMap.get(itemId);
                    const price = catalogItem ? (catalogItem.fields.Price || 0) : 0;
                    totalValue += price * (itemInfo.quantity || 1);
                });
            } catch(e) {}
        }
        session.totalValue = totalValue;
        session.stage = (session.fields['Amount Received'] || 0) > 0 ? 'Reserved' : 'Planning';
    });

    allSessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    allSessions.forEach(session => {
        const item = document.createElement('div');
        item.className = 'session-list-item';
        item.dataset.sessionId = session.id;
        if (session.id === currentlySelectedSessionId) {
            item.classList.add('selected');
        }
        
        item.innerHTML = `
            <strong>${session.fields.Name || 'Unnamed Session'}</strong>
            <div class="session-stats">
                <span>Value: $${session.totalValue.toFixed(2)}</span>
                <span>Stage: ${session.stage}</span>
                <span>${session.messageCount} messages</span>
            </div>
            <small>Last active: ${new Date(session.lastActivity).toLocaleString()}</small>
        `;
        sessionListContainer.appendChild(item);
    });
}

function renderEventPlan(sessionId) {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session) return;
    
    let planHtml = `<div class="pane-header"><h2>Event Plan</h2> <a href="/?session=${sessionId}" target="_blank" class="open-new-tab">Open in New Tab ↗</a></div>`;
    
    try {
        const data = JSON.parse(session.fields['Items with Variations'] || '{}');
        const sessionDetails = new Map(Object.entries(data.favoritedDetails || {}));
        const lockedItems = new Map(Object.entries(data.lockedInItems || {}));
        const favoritedItems = new Map(Object.entries(data.favoritedItems || {}));
        
        const eventDate = sessionDetails.get('date');
        planHtml += `
            <div class="plan-details-grid">
                <div><strong>Event Name</strong> ${session.fields.Name || 'N/A'}</div>
                <div><strong>Date</strong> ${eventDate ? new Date(eventDate).toLocaleDateString() : 'Not set'}</div>
                <div style="grid-column: 1 / -1;"><strong>Goals/Notes</strong> ${session.fields.Goals || 'N/A'}</div>
            </div>
        `;

        planHtml += '<h3>Locked-In Items</h3>';
        let totalValue = 0;
        if (lockedItems.size > 0) {
            lockedItems.forEach((info, id) => {
                const item = catalogMap.get(id);
                const price = item ? (item.fields.Price || 0) : 0;
                totalValue += price * (info.quantity || 1);
                // FIX: Add a placeholder for missing images
                const imageUrl = item?.fields?.Attachments?.[0]?.thumbnails?.small?.url || 'https://via.placeholder.com/50';
                planHtml += `<div class="plan-item">
                    <img src="${imageUrl}" alt="">
                    <div class="plan-item-info"><strong>${item?.fields?.Name || 'Unknown Item'}</strong><br><small>Qty: ${info.quantity || 1} - Note: ${info.note || 'none'}</small></div>
                </div>`;
            });
        } else {
            planHtml += '<p>No items locked in.</p>';
        }

        planHtml += '<h3>Favorited Ideas</h3>';
        if (favoritedItems.size > 0) {
            favoritedItems.forEach((info, id) => {
                const item = catalogMap.get(id);
                 // FIX: Add a placeholder for missing images
                const imageUrl = item?.fields?.Attachments?.[0]?.thumbnails?.small?.url || 'https://via.placeholder.com/50';
                planHtml += `<div class="plan-item">
                     <img src="${imageUrl}" alt="">
                    <div><strong>${item?.fields?.Name || 'Unknown Item'}</strong></div>
                </div>`;
            });
        } else {
             planHtml += '<p>No favorited items.</p>';
        }
        
        planHtml += `<div class="plan-total">Total Plan Value: $${totalValue.toFixed(2)}</div>`;

    } catch(e) {
        console.error("Error rendering plan:", e);
        planHtml += '<p>Could not load event plan details.</p>';
    }

    planView.innerHTML = planHtml;
}

function renderChatPane(sessionId) {
    const session = allSessions.find(s => s.id === sessionId);
    // FIX: Add a guard clause to prevent crash on missing session
    if (!session) {
        chatPane.style.display = 'none';
        chatPlaceholder.style.display = 'block';
        chatPlaceholder.textContent = 'Could not find data for this session.';
        return;
    }

    chatMessagesContainer.innerHTML = '';
    
    const messagesForSession = allMessages.filter(m => m.fields.SessionID && m.fields.SessionID[0] === sessionId);
    messagesForSession.sort((a,b) => new Date(a.fields.Timestamp) - new Date(b.fields.Timestamp));
    
    messagesForSession.forEach(msg => {
        const messageEl = document.createElement('div');
        const sender = msg.fields.SenderName;
        const isAdmin = sender === 'TMT Admin';
        messageEl.className = `chat-message ${isAdmin ? 'admin' : 'user'}`;
        messageEl.innerHTML = `<strong>${sender}:</strong> ${msg.fields.Content}`;
        chatMessagesContainer.appendChild(messageEl);
    });

    document.getElementById('chat-header-title').textContent = `Chat: ${session.fields.Name || 'Session'}`;
    document.getElementById('chat-open-link').href = `/?session=${sessionId}`;

    chatPane.style.display = 'flex';
    chatPlaceholder.style.display = 'none';
    chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

// --- Event Handlers ---
function handleSessionSelect(sessionId) {
    currentlySelectedSessionId = sessionId;
    
    planView.style.display = 'block';
    planViewPlaceholder.style.display = 'none';
    
    renderSessionList(); 
    renderEventPlan(sessionId);
    renderChatPane(sessionId);
}

// --- Main Initialization ---
async function initializeDashboard() {
    [allSessions, allMessages, allCatalogItems] = await Promise.all([
        fetchAirtableData(SESSIONS_TABLE),
        fetchAirtableData(MESSAGES_TABLE),
        fetchAirtableData(CATALOG_TABLE)
    ]);
    
    loadingIndicator.style.display = 'none';

    sessionMap = new Map(allSessions.map(s => [s.id, s.fields.Name]));
    catalogMap = new Map(allCatalogItems.map(item => [item.id, item]));
    
    allMessages.sort((a, b) => new Date(b.fields.Timestamp) - new Date(a.fields.Timestamp));
    
    activityFeed.innerHTML = '';
    allMessages.forEach(message => {
        if (message.fields.SessionID && message.fields.SessionID[0]) {
            const sessionName = sessionMap.get(message.fields.SessionID[0]);
            renderActivityItem(message, sessionName);
        }
    });
    
    renderSessionList();
    setupPusher();

    document.body.addEventListener('click', (e) => {
        const sessionItem = e.target.closest('[data-session-id]');
        if (sessionItem) {
            handleSessionSelect(sessionItem.dataset.sessionId);
        }
    });

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = chatInput.value.trim();
        if (content && currentlySelectedSessionId) {
            chatInput.value = '';
            
            // Immediately display the message optimistically
            const messageEl = document.createElement('div');
            messageEl.className = 'chat-message admin';
            messageEl.innerHTML = `<strong>You:</strong> ${content}`;
            chatMessagesContainer.appendChild(messageEl);
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;

            // Send the message to the backend
            await postChatMessage(currentlySelectedSessionId, content);
            // The real-time listener will receive the message back and re-render the pane,
            // which will replace our optimistic message with the confirmed one.
        }
    });
}

// --- Real-Time Updates ---
function setupPusher() {
    const pusher = new Pusher(PUSHER_KEY, {
        cluster: PUSHER_CLUSTER,
        authEndpoint: '/api/pusher-auth',
        auth: { params: { user_id: `admin-${Date.now()}`, user_name: 'Dashboard Admin' } }
    });
    
    sessionMap.forEach((name, id) => {
        const channel = pusher.subscribe(`presence-session-${id}`);
        channel.bind('client-new-message', (data) => {
            const fakeMessageRecord = { fields: { Content: data.content, SenderName: data.senderName, SessionID: [id], Timestamp: data.timestamp } };
            
            allMessages.unshift(fakeMessageRecord);
            renderActivityItem(fakeMessageRecord, name, true);
            renderSessionList();

            if (id === currentlySelectedSessionId) {
                renderChatPane(id); // Re-render the whole chat to maintain order
            }
        });
    });
}

// Start the application
initializeDashboard();

