// REPLACE the entire contents of: crm.js

// --- Configuration ---
const AIRTABLE_PAT = 'patI1bum8NZvXmYV5.9961c676b00f5e5a9f006c6c26d1ba93ecde2b489f419a68d2a1cb43ff781c57';
const BASE_ID = 'app5yTznb3R5YNUFw';
const SESSIONS_TABLE = 'Sessions';
const MESSAGES_TABLE = 'Messages';
const CATALOG_TABLE = 'tblUA4uuS8IYlhKpD'; 
const TEAMMATES_TABLE = 'Teammates';
const PUSHER_KEY = '236f480714e5001590b5';
const PUSHER_CLUSTER = 'us3';
const ARCHIVE_STORAGE_KEY = 'tmt-archived-sessions';

// --- State ---
let currentlySelectedSessionId = null;
let allSessions = [];
let allMessages = [];
let allCatalogItems = [];
let allTeammates = []; // <-- Made this global for the search
let sessionMap = new Map();
let catalogMap = new Map();
let archivedSessionIds = new Set();
let unreadArchivedSessions = new Set();
let pusherChannelMap = new Map();

// --- DOM Elements ---
const loadingIndicator = document.getElementById('loading');
const sessionListContainer = document.getElementById('session-list');
const archiveListContainer = document.getElementById('archive-list');
const archivePane = document.getElementById('archive-pane');
const activityFeed = document.getElementById('activity-feed');
const planView = document.getElementById('plan-view');
const planViewPlaceholder = document.getElementById('plan-view-placeholder');
const chatPane = document.getElementById('chat-pane');
const chatPlaceholder = document.getElementById('chat-placeholder');
const chatMessagesContainer = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
// --- NEW OMNI-SEARCH DOM ELEMENTS ---
const omniSearchForm = document.getElementById('omni-search-form');
const omniSearchInput = document.getElementById('omni-search-input');
const omniSearchBtn = document.getElementById('omni-search-btn');
const omniSearchResults = document.getElementById('omni-search-results');


// --- Airtable & Storage ---
function loadArchivedState() {
    const stored = localStorage.getItem(ARCHIVE_STORAGE_KEY);
    if (stored) {
        archivedSessionIds = new Set(JSON.parse(stored));
    }
}
function saveArchivedState() {
    localStorage.setItem(ARCHIVE_STORAGE_KEY, JSON.stringify(Array.from(archivedSessionIds)));
}

async function fetchAirtableData(tableName) {
    let allRecords = [];
    let offset = null;
    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${tableName}`; // Base URL
    
    try {
        do {
            let fetchUrl = baseUrl;
            if (offset) {
                if (typeof offset === 'string' && offset.startsWith('itr')) {
                    fetchUrl = `${baseUrl}?offset=${offset}`;
                } else {
                    console.warn(`Invalid Airtable offset detected for ${tableName}: ${offset}`);
                    break; 
                }
            }

            const response = await fetch(fetchUrl, { headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}` } });
            
            if (!response.ok) {
                console.error(`Airtable API request failed for URL: ${fetchUrl}`);
                throw new Error(`Failed to fetch from ${tableName} (Status: ${response.status})`);
            }
            
            const data = await response.json();
            allRecords = allRecords.concat(data.records);
            offset = data.offset; 
        } while (offset);
        
        return allRecords;
    } catch (error) {
        console.error("Airtable fetch error:", error);
        throw error;
    }
}
async function postChatMessage(sessionId, content) {
    const url = `https://api.airtable.com/v0/${BASE_ID}/${MESSAGES_TABLE}`;
    const payload = { records: [{ fields: { SessionID: [sessionId], SenderID: 'admin-dashboard', SenderName: 'TMT Admin', Content: content, Timestamp: new Date().toISOString() } }] };
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${AIRTABLE_PAT}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!response.ok) {
            console.error("Airtable response error:", await response.json());
            throw new Error('Failed to post message to Airtable.');
        }
    } catch (error) { console.error("Error posting chat message:", error); }
}

// --- Message Analysis ---
function analyzeMessageContent(content) {
    if (!content) return ''; 
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
    item.innerHTML = `<p>"${message.fields.Content}"</p><div class="meta"><strong>${message.fields.SenderName}</strong> in <a href="#" class="session-link">${sessionName || message.fields.SessionID[0]}</a><small> - ${time}</small></div>`;
    if (prepend) activityFeed.prepend(item); else activityFeed.appendChild(item);
}

function renderSessionLists() {
    sessionListContainer.innerHTML = '';
    archiveListContainer.innerHTML = '';
    
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
                    totalValue += (catalogItem?.fields?.Price || 0) * (itemInfo.quantity || 1);
                });
            } catch(e) {}
        }
        session.totalValue = totalValue;
        session.stage = (session.fields['Amount Received'] || 0) > 0 ? 'Reserved' : 'Planning';
    });

    const activeSessions = allSessions.filter(s => !archivedSessionIds.has(s.id));
    const archivedSessions = allSessions.filter(s => archivedSessionIds.has(s.id));
    
    activeSessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
    
    archivedSessions.sort((a, b) => {
        const aIsUnread = unreadArchivedSessions.has(a.id);
        const bIsUnread = unreadArchivedSessions.has(b.id);
        if (aIsUnread !== bIsUnread) return aIsUnread ? -1 : 1;
        return new Date(b.lastActivity) - new Date(a.lastActivity);
    });

    const renderList = (sessions, container) => {
        sessions.forEach(session => {
            const item = document.createElement('div');
            item.className = 'session-list-item';
            item.dataset.sessionId = session.id;
            if (session.id === currentlySelectedSessionId) item.classList.add('selected');
            if (unreadArchivedSessions.has(session.id)) item.classList.add('unread');
            item.innerHTML = `<strong>${session.fields.Name || 'Unnamed Session'}</strong><div class="session-stats"><span>Value: $${session.totalValue.toFixed(2)}</span><span>Stage: ${session.stage}</span><span>${session.messageCount} messages</span></div><small>Last active: ${new Date(session.lastActivity).toLocaleString()}</small>`;
            container.appendChild(item);
        });
    };
    renderList(activeSessions, sessionListContainer);
    renderList(archivedSessions, archiveListContainer);
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
        planHtml += `<div class="plan-details-grid"><div><strong>Event Name</strong> ${session.fields.Name || 'N/A'}</div><div><strong>Date</strong> ${eventDate ? new Date(eventDate).toLocaleDateString() : 'Not set'}</div><div style="grid-column: 1 / -1;"><strong>Goals/Notes</strong> ${session.fields.Goals || 'N/A'}</div></div>`;
        planHtml += '<h3>Locked-In Items</h3>';
        let totalValue = 0;
        if (lockedItems.size > 0) {
            lockedItems.forEach((info, id) => {
                const item = catalogMap.get(id);
                totalValue += (item?.fields?.Price || 0) * (info.quantity || 1);
                const imageUrl = item?.fields?.Attachments?.[0]?.thumbnails?.small?.url || 'https://via.placeholder.com/50';
                planHtml += `<div class="plan-item"><img src="${imageUrl}" alt=""><div class="plan-item-info"><strong>${item?.fields?.Name || 'Unknown Item'}</strong><br><small>Qty: ${info.quantity || 1} - Note: ${info.note || 'none'}</small></div></div>`;
            });
        } else { planHtml += '<p>No items locked in.</p>'; }
        planHtml += '<h3>Favorited Ideas</h3>';
        if (favoritedItems.size > 0) {
            favoritedItems.forEach((info, id) => {
                const item = catalogMap.get(id);
                const imageUrl = item?.fields?.Attachments?.[0]?.thumbnails?.small?.url || 'https://via.placeholder.com/50';
                planHtml += `<div class="plan-item"><img src="${imageUrl}" alt=""><div><strong>${item?.fields?.Name || 'Unknown Item'}</strong></div></div>`;
            });
        } else { planHtml += '<p>No favorited items.</p>'; }
        planHtml += `<div class="plan-total">Total Plan Value: $${totalValue.toFixed(2)}</div>`;
    } catch(e) {
        console.error("Error rendering plan:", e);
        planHtml += '<p>Could not load event plan details.</p>';
    }
    planView.innerHTML = planHtml;
}

function renderChatPane(sessionId) {
    const session = allSessions.find(s => s.id === sessionId);
    if (!session || !session.fields) {
        chatPane.style.display = 'none';
        chatPlaceholder.style.display = 'block';
        chatPlaceholder.textContent = 'Could not find data for this session.';
        return;
    }
    chatMessagesContainer.innerHTML = '';
    const messagesForSession = allMessages.filter(m => m.fields.SessionID && m.fields.SessionID[0] === sessionId).sort((a,b) => new Date(a.fields.Timestamp) - new Date(b.fields.Timestamp));
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

// --- NEW OMNI-SEARCH RENDER FUNCTION ---
/**
 * Renders the results from the client-side search into the results container.
 * @param {object} results - The aggregated data from the handleOmniSearch function.
 */
function renderOmniSearchResults(results) {
    omniSearchResults.innerHTML = ''; // Clear loading/previous results
    let html = '';
    const { item, session, user, itemMessages, sessionMessages } = results;

    if (!item && !session && !user) {
        omniSearchResults.innerHTML = `<p style="color: #7f8c8d; text-align: center;">No matches found in local data. Attempting to parse as new item...</p>`;
        return false; // Signal that no results were found
    }

    if (item) {
        html += `<h5>✅ Found Catalog Item: ${item.fields.Name}</h5>`;
        html += `<pre>ID: ${item.id}</pre>`;
        // Note: Image/Message data isn't pre-loaded in crm.js, so we can't show it here in the MVP
        // We'll add a note for the admin.
        html += `<p style="font-size: 0.8em; color: #666;"><i>Full item details, photos, and item-specific messages are visible on the main catalog page.</i></p>`;
    }

    if (session) {
        html += `<h5>✅ Found Session: ${session.fields.Name}</h5>`;
        html += `<pre>ID: ${session.id} (Click session in list to load)</pre>`;
        if (sessionMessages && sessionMessages.length > 0) {
            html += `<p style="font-size: 0.9em;"><strong>Found ${sessionMessages.length} Session Messages:</strong></p><ul>`;
            html += sessionMessages.map(msg => `<li><strong>${msg.fields.SenderName}:</strong> "${msg.fields.Content}"</li>`).slice(0, 5).join(''); // Show top 5
            if (sessionMessages.length > 5) html += `<li>...and ${sessionMessages.length - 5} more.</li>`;
            html += `</ul>`;
        }
    }

    if (user) {
        html += `<h5>✅ Found User: ${user.fields.Name} (${user.fields.Email})</h5>`;
        html += `<pre>ID: ${user.id}</pre>`;
        const userSessions = allSessions.filter(s => (s.fields.Collaborators || []).includes(user.id));
        if (userSessions.length > 0) {
            html += `<p style="font-size: 0.9em;"><strong>Found ${userSessions.length} Linked Sessions:</strong></p><ul>`;
            html += userSessions.map(s => `<li>${s.fields.Name || 'Unnamed Session'} (ID: ${s.id})</li>`).join('');
            html += `</ul>`;
        }
    }

    omniSearchResults.innerHTML = html;
    return true; // Signal that results were found
}

// --- NEW OMNI-SEARCH HANDLER ---
/**
 * Performs a client-side search across all loaded data.
 * If no item is found, triggers the weblink parser.
 * @param {string} query - The user's search term.
 */
async function handleOmniSearch(query) {
    const lowerQuery = query.toLowerCase();
    let results = {
        item: null,
        session: null,
        user: null,
        sessionMessages: []
    };

    // 1. Search all local data
    results.item = allCatalogItems.find(item => (item.fields.Name || '').toLowerCase().includes(lowerQuery));
    results.session = allSessions.find(session => (session.fields.Name || '').toLowerCase().includes(lowerQuery));
    // Use `allTeammates` which is loaded at init
    results.user = allTeammates.find(user => (user.fields.Email || '').toLowerCase() === lowerQuery || (user.fields.Name || '').toLowerCase().includes(lowerQuery));

    if (results.session) {
        results.sessionMessages = allMessages
            .filter(m => m.fields.SessionID && m.fields.SessionID[0] === results.session.id)
            .sort((a,b) => new Date(b.fields.Timestamp) - new Date(a.fields.Timestamp)); // Newest first
    }
    
    // 2. Render what we found
    const resultsFound = renderOmniSearchResults(results);

    // 3. If no item (specifically) was found, try to parse it
    if (!results.item) {
        omniSearchResults.innerHTML += `<p style="color: #3498db; text-align: center;">No item match found. Calling external parser for "${query}"...</p>`;
        try {
            const parseResponse = await fetch('/api/process-weblink', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query })
            });
            if (!parseResponse.ok) {
                 const errorText = await parseResponse.text();
                 throw new Error(`Weblink Parser API failed: ${errorText}`);
            }

            const newItemData = await parseResponse.json();
            omniSearchResults.innerHTML += `
                <h5>✅ Parsed as New Item (Stub)</h5>
                <p style="font-size: 0.9em;">This item is not in Airtable yet. This is the data that would be used to create it.</p>
                <pre>${JSON.stringify(newItemData, null, 2)}</pre>
            `;
            // In a real implementation, you would now POST this data to Airtable
            // For the MVP, just displaying it is sufficient.
            
        } catch (error) {
            omniSearchResults.innerHTML += `<p style="color: #dc3545; text-align: center;"><strong>Parser Error:</strong> ${error.message}</p>`;
            console.error('Weblink Parser Error:', error);
        }
    }
}


// --- Event Handlers & Initialization ---
function handleSessionSelect(sessionId) {
    if (!sessionMap.has(sessionId)) {
        console.warn(`Attempted to select a non-existent session: ${sessionId}`);
        planView.style.display = 'none';
        planViewPlaceholder.style.display = 'block';
        planViewPlaceholder.textContent = 'This session may have been deleted.';
        chatPane.style.display = 'none';
        chatPlaceholder.style.display = 'block';
        chatPlaceholder.textContent = '';
        return;
    }

    currentlySelectedSessionId = sessionId;
    if (unreadArchivedSessions.has(sessionId)) {
        unreadArchivedSessions.delete(sessionId);
    }
    planView.style.display = 'block';
    planViewPlaceholder.style.display = 'none';
    renderSessionLists(); 
    renderEventPlan(sessionId);
    renderChatPane(sessionId);
}

function setupDragAndDrop() {
    const lists = [sessionListContainer, archiveListContainer];
    lists.forEach(list => {
        new Sortable(list, {
            group: 'sessions',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: (evt) => {
                const sessionId = evt.item.dataset.sessionId;
                if (evt.to === archiveListContainer) {
                    archivedSessionIds.add(sessionId);
                } else {
                    archivedSessionIds.delete(sessionId);
                    unreadArchivedSessions.delete(sessionId);
                }
                saveArchivedState();
                renderSessionLists();
            }
        });
    });
}

async function initializeDashboard() {
    loadArchivedState();
    
    try {
        const [allSessionsData, allMessagesData, allCatalogItemsData, allTeammatesData] = await Promise.all([
            fetchAirtableData(SESSIONS_TABLE),
            fetchAirtableData(MESSAGES_TABLE),
            fetchAirtableData(CATALOG_TABLE),
            fetchAirtableData(TEAMMATES_TABLE)
        ]);

        // Store in global state for omni-search
        allSessions = allSessionsData;
        allMessages = allMessagesData;
        allCatalogItems = allCatalogItemsData;
        allTeammates = allTeammatesData; // Now globally accessible

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
        
        renderSessionLists();
        setupPusher();
        setupDragAndDrop();

        const teammateListContainer = document.createElement('div');
        teammateListContainer.innerHTML = '<h2 style="margin-top: 30px;">Teammates</h2>';
        
        allTeammates.forEach(tm => {
            const link = document.createElement('a');
            link.href = `/teammate.html?id=${tm.id}`;
            link.textContent = tm.fields.Name;
            link.className = 'session-list-item';
            teammateListContainer.appendChild(link);
        });
        
        document.querySelector('.sessions-pane').appendChild(teammateListContainer);

    } catch (e) {
        console.error("Catastrophic error during Dashboard Initialization:", e);
        loadingIndicator.textContent = `CRITICAL ERROR: Failed to load data from Airtable (${e.message}). Please check API keys or table configuration.`;
        loadingIndicator.style.color = '#dc3545';
        return; 
    }

    // --- Attach All Event Listeners ---
    
    document.body.addEventListener('click', (e) => {
        const sessionItem = e.target.closest('.session-list-item, .feed-item');
        if (sessionItem) {
            e.preventDefault();
            if (sessionItem.href && sessionItem.href.includes('teammate.html')) {
                window.location.href = sessionItem.href;
            } else {
                handleSessionSelect(sessionItem.dataset.sessionId);
            }
        }
    });

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const content = chatInput.value.trim();
        if (content && currentlySelectedSessionId) {
            const tempMessageEl = document.createElement('div');
            tempMessageEl.className = 'chat-message admin';
            tempMessageEl.innerHTML = `<strong>You:</strong> ${content}`;
            chatMessagesContainer.appendChild(tempMessageEl);
            chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
            const messageToSend = chatInput.value;
            chatInput.value = '';
            await postChatMessage(currentlySelectedSessionId, messageToSend);
            const channel = pusherChannelMap.get(currentlySelectedSessionId);
            if (channel) {
                channel.trigger('client-new-message', {
                    content: messageToSend,
                    senderId: 'admin-dashboard',
                    senderName: 'TMT Admin',
                    timestamp: new Date().toISOString()
                });
            }
        }
    });

    document.getElementById('archive-toggle').addEventListener('click', () => {
        archivePane.classList.toggle('expanded');
    });

    // --- AI QA TESTER LISTENER (Restored) ---
    const testAIForm = document.getElementById('test-ai-form');
    const publicIdInput = document.getElementById('test-public-id');
    const statusMessage = document.getElementById('single-ai-status');

    if (testAIForm) {
        testAIForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const publicId = publicIdInput.value.trim();
            if (!publicId) {
                statusMessage.textContent = 'Status: Please enter a Public ID.';
                statusMessage.style.color = '#dc3545';
                return;
            }
            statusMessage.textContent = `Status: Processing ${publicId}... (Check Netlify logs for progress)`;
            statusMessage.style.color = '#3498db';
            document.getElementById('trigger-single-ai').disabled = true;
            try {
                // Call the AI processing function directly
                const response = await fetch('/.netlify/functions/process-image-ai', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ publicId: publicId })
                });
                const data = await response.json();
                if (response.ok) {
                    statusMessage.textContent = `✅ SUCCESS: ${data.message}`;
                    statusMessage.style.color = '#2ecc71';
                    publicIdInput.value = '';
                } else {
                    statusMessage.textContent = `❌ FAILURE: ${data.error}`;
                    statusMessage.style.color = '#dc3545';
                }
            } catch (error) {
                statusMessage.textContent = `❌ CRITICAL ERROR: Could not connect to API.`;
                statusMessage.style.color = '#dc3545';
                console.error('Manual AI Trigger Error:', error);
            } finally {
                document.getElementById('trigger-single-ai').disabled = false;
            }
        });
    }
    
    // --- NEW OMNI-SEARCH LISTENER ---
    if (omniSearchForm) {
        omniSearchForm.addEventListener('submit', async (e) => {
            e.preventDefault();
Storage
            const query = omniSearchInput.value.trim();
            if (!query) return;
            
            omniSearchBtn.disabled = true;
            omniSearchResults.innerHTML = `<p style="color: #3498db; text-align: center;">Searching local data for "${query}"...</p>`;
            
            // Use a try/finally to ensure button is re-enabled
            try {
                await handleOmniSearch(query);
            } catch (error) {
                 omniSearchResults.innerHTML = `<p style="color: #dc3545; text-align: center;"><strong>Error:</strong> ${error.message}</p>`;
                 console.error('Omni-Search Handler Error:', error);
            } finally {
                omniSearchBtn.disabled = false;
            }
        });
    }
}

function setupPusher() {
    if (sessionMap.size === 0) return; 

    const pusher = new Pusher(PUSHER_KEY, {
        cluster: PUSHER_CLUSTER,
        authEndpoint: '/api/pusher-auth',
        auth: { params: { user_id: `admin-${Date.now()}`, user_name: 'Dashboard Admin' } }
    });
    sessionMap.forEach((name, id) => {
        const channel = pusher.subscribe(`presence-session-${id}`);
        pusherChannelMap.set(id, channel);
        channel.bind('client-new-message', (data) => {
            if (data.senderId === 'admin-dashboard') return;

            const fakeMessageRecord = { fields: { Content: data.content, SenderName: data.senderName, SessionID: [id], Timestamp: data.timestamp } };
            allMessages.unshift(fakeMessageRecord);
            renderActivityItem(fakeMessageRecord, name, true);
            if (archivedSessionIds.has(id)) {
                unreadArchivedSessions.add(id);
            }
            renderSessionLists();
            if (id === currentlySelectedSessionId) renderChatPane(id);
        });
    });
}

initializeDashboard();
