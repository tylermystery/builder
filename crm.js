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
const MODULE_STATE_KEY = 'tmt-active-modules';

// --- State ---
let currentlySelectedSessionId = null;
let allSessions = [];
let allMessages = [];
let allCatalogItems = [];
let allTeammates = [];
let sessionMap = new Map();
let catalogMap = new Map();
let archivedSessionIds = new Set();
let unreadArchivedSessions = new Set();
let pusherChannelMap = new Map();
let pendingNewItemData = null;
let activeModules = new Set(['sessions', 'feed']); // Default active modules

// --- DOM Elements ---
const loadingIndicator = document.getElementById('loading');
const sessionListContainer = document.getElementById('session-list');
const archiveListContainer = document.getElementById('archive-list');
const activityFeed = document.getElementById('activity-feed');
const planView = document.getElementById('plan-view');
const planViewPlaceholder = document.getElementById('plan-view-placeholder');
const chatPane = document.getElementById('chat-pane');
const chatPlaceholder = document.getElementById('chat-placeholder');
const chatMessagesContainer = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const omniSearchForm = document.getElementById('omni-search-form');
const omniSearchInput = document.getElementById('omni-search-input');
const omniSearchBtn = document.getElementById('omni-search-btn');
const omniSearchResults = document.getElementById('omni-search-results');
const modulesGrid = document.querySelector('.modules-grid');

// --- Module Management Functions ---
function loadModuleState() {
    const stored = localStorage.getItem(MODULE_STATE_KEY);
    if (stored) {
        activeModules = new Set(JSON.parse(stored));
    }
}

function saveModuleState() {
    localStorage.setItem(MODULE_STATE_KEY, JSON.stringify(Array.from(activeModules)));
}

function updateModuleVisibility() {
    const moduleToggleButtons = document.querySelectorAll('.module-toggle');

    // Update button states
    moduleToggleButtons.forEach(btn => {
        const moduleName = btn.dataset.module;
        if (activeModules.has(moduleName)) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Update panel visibility
    const allPanels = document.querySelectorAll('.panel');
    allPanels.forEach(panel => {
        const moduleName = panel.id.replace('module-', '');
        if (activeModules.has(moduleName)) {
            panel.classList.add('visible');
        } else {
            panel.classList.remove('visible');
        }
    });

    // Update grid columns based on active module count
    const activeCount = activeModules.size;
    modulesGrid.className = 'modules-grid';
    if (activeCount === 1) modulesGrid.classList.add('cols-1');
    else if (activeCount === 2) modulesGrid.classList.add('cols-2');
    else if (activeCount === 3) modulesGrid.classList.add('cols-3');
    else if (activeCount === 4) modulesGrid.classList.add('cols-4');
    else modulesGrid.classList.add('cols-5');
}

function toggleModule(moduleName) {
    if (activeModules.has(moduleName)) {
        activeModules.delete(moduleName);
    } else {
        activeModules.add(moduleName);
    }
    saveModuleState();
    updateModuleVisibility();
}

function setupModuleToggles() {
    const moduleToggleButtons = document.querySelectorAll('.module-toggle');
    moduleToggleButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            toggleModule(btn.dataset.module);
        });
    });
}


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
                // Optimize images with proper alt text and dimensions for better performance
                const optimizedImageUrl = imageUrl.includes('via.placeholder.com') 
                    ? 'https://via.placeholder.com/50?text=No+Image'
                    : imageUrl;
                planHtml += `<div class="plan-item"><img src="${optimizedImageUrl}" alt="${item?.fields?.Name || 'Item'}" width="50" height="50" loading="lazy"><div class="plan-item-info"><strong>${item?.fields?.Name || 'Unknown Item'}</strong><br><small>Qty: ${info.quantity || 1} - Note: ${info.note || 'none'}</small></div></div>`;
            });
        } else { planHtml += '<p>No items locked in.</p>'; }
        planHtml += '<h3>Favorited Ideas</h3>';
        if (favoritedItems.size > 0) {
            favoritedItems.forEach((info, id) => {
                const item = catalogMap.get(id);
                const imageUrl = item?.fields?.Attachments?.[0]?.thumbnails?.small?.url || 'https://via.placeholder.com/50';
                const optimizedImageUrl = imageUrl.includes('via.placeholder.com')
                    ? 'https://via.placeholder.com/50?text=No+Image'
                    : imageUrl;
                planHtml += `<div class="plan-item"><img src="${optimizedImageUrl}" alt="${item?.fields?.Name || 'Item'}" width="50" height="50" loading="lazy"><div><strong>${item?.fields?.Name || 'Unknown Item'}</strong></div></div>`;
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
    console.log('[DEBUG] renderOmniSearchResults called with:', results);
    omniSearchResults.innerHTML = ''; // Clear loading/previous results
    let html = '';
    const { item, session, user, itemMessages, sessionMessages } = results;

    if (!item && !session && !user) {
        console.log('[DEBUG] No matches found in local data');
        omniSearchResults.innerHTML = `<p style="color: #7f8c8d; text-align: center;">No matches found in local data. Attempting to parse as new item...</p>`;
        return false; // Signal that no results were found
    }

    if (item) {
        console.log('[DEBUG] Found catalog item:', item.fields.Name);
        html += `<h5>✅ Found Catalog Item: ${item.fields.Name}</h5>`;
        html += `<pre>ID: ${item.id}</pre>`;

        // Show current item details
        html += `<div style="background: #f9f9f9; padding: 10px; border-radius: 4px; margin: 10px 0;">`;
        html += `<p style="margin: 5px 0;"><strong>Description:</strong> ${item.fields.Description || 'N/A'}</p>`;
        html += `<p style="margin: 5px 0;"><strong>Price:</strong> $${item.fields.Price || 0}</p>`;
        html += `<p style="margin: 5px 0;"><strong>Service Type:</strong> ${item.fields['Item Type'] || 'N/A'}</p>`;
        html += `</div>`;

        // Add Global Parse button
        html += `<button
            id="global-parse-btn"
            data-item-id="${item.id}"
            data-item-name="${item.fields.Name}"
            style="
                width: 100%;
                padding: 12px;
                background-color: #3498db;
                color: white;
                border: none;
                border-radius: 5px;
                cursor: pointer;
                font-weight: bold;
                margin-top: 10px;
            ">
            🌐 Global Parse - Compare with Internet Data
        </button>`;

        html += `<p style="font-size: 0.8em; color: #666; margin-top: 10px;"><i>Click "Global Parse" to fetch current information from the internet and compare with this item's data.</i></p>`;
    }

    if (session) {
        console.log('[DEBUG] Found session:', session.fields.Name);
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
        console.log('[DEBUG] Found user:', user.fields.Name);
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
    console.log('[DEBUG] Rendered search results');

    // Attach event listener to Global Parse button if it exists
    const globalParseBtn = document.getElementById('global-parse-btn');
    if (globalParseBtn) {
        globalParseBtn.addEventListener('click', async () => {
            const itemId = globalParseBtn.dataset.itemId;
            const itemName = globalParseBtn.dataset.itemName;
            console.log('[DEBUG] Global Parse clicked for item:', itemId, itemName);

            // Show loading state
            globalParseBtn.disabled = true;
            globalParseBtn.textContent = 'Fetching data from internet...';

            try {
                // Get the full item data
                const fullItem = allCatalogItems.find(i => i.id === itemId);
                if (!fullItem) {
                    throw new Error('Item not found in local data');
                }

                // Extract search terms from AI_Profile if available
                let searchTerms = [];
                if (fullItem.fields.AI_Profile) {
                    try {
                        const profile = JSON.parse(fullItem.fields.AI_Profile);
                        searchTerms = profile.SearchTerms || [];
                    } catch (e) {
                        console.warn('[DEBUG] Could not parse AI_Profile');
                    }
                }

                // Prepare existing item data
                const existingItemData = {
                    Name: fullItem.fields.Name,
                    Description: fullItem.fields.Description,
                    Price: fullItem.fields.Price,
                    ServiceType: fullItem.fields['Item Type'],
                    SearchTerms: searchTerms
                };

                // Call parser with existing item data
                const parseResponse = await fetch('/api/process-weblink', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: itemName,
                        existingItem: existingItemData
                    })
                });

                if (!parseResponse.ok) {
                    const errorText = await parseResponse.text();
                    throw new Error(`Parser failed: ${errorText}`);
                }

                const parsedData = await parseResponse.json();
                console.log('[DEBUG] Parsed data from internet:', parsedData);

                // Open comparison modal with both existing and parsed data
                openComparisonModalForExisting(fullItem, parsedData);

                globalParseBtn.textContent = '✅ Data Fetched - See Comparison';
            } catch (error) {
                console.error('[DEBUG] Global Parse error:', error);
                globalParseBtn.textContent = '❌ Error - Try Again';
                globalParseBtn.disabled = false;
                alert(`Error fetching data: ${error.message}`);
            }
        });
    }

    return true; // Signal that results were found
}

// --- COMPARISON MODAL FUNCTIONS ---
/**
 * Opens the comparison modal with parsed item data
 * @param {object} itemData - The parsed item data from weblink parser
 */
function openComparisonModal(itemData) {
    console.log('[DEBUG] Opening comparison modal with data:', itemData);
    pendingNewItemData = itemData;

    const tableBody = document.getElementById('comparison-table-body');
    tableBody.innerHTML = '';

    // Create editable rows for each field
    const fields = ['Name', 'Description', 'Price', 'ServiceType', 'SearchTerms', 'Rankings', 'Profile'];
    fields.forEach(field => {
        const row = document.createElement('tr');
        const value = itemData[field];
        let displayValue;

        if (field === 'Rankings' && value && typeof value === 'object') {
            // Format Rankings as a readable string
            displayValue = JSON.stringify(value, null, 2);
        } else if (field === 'Profile' && value && typeof value === 'object') {
            // Format Profile as a readable string
            displayValue = JSON.stringify(value, null, 2);
        } else {
            displayValue = Array.isArray(value) ? value.join(', ') : value;
        }

        row.innerHTML = `
            <td><strong>${field}</strong></td>
            <td>
                ${field === 'Description'
                    ? `<textarea id="edit-${field}" style="width: 100%; min-height: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">${displayValue || ''}</textarea>`
                    : field === 'SearchTerms'
                    ? `<textarea id="edit-${field}" style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" placeholder="Comma-separated terms">${displayValue || ''}</textarea>`
                    : field === 'Rankings'
                    ? `<textarea id="edit-${field}" style="width: 100%; min-height: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.9em;" placeholder='{"google": 4.5, "yelp": 4.0, ...}'>${displayValue || ''}</textarea>`
                    : field === 'Profile'
                    ? `<textarea id="edit-${field}" style="width: 100%; min-height: 120px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.9em;" placeholder='{"activityLevel": 5, "indoorOutdoor": 5, ...}'>${displayValue || ''}</textarea>`
                    : `<input type="text" id="edit-${field}" value="${displayValue || ''}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">`
                }
            </td>
        `;
        tableBody.appendChild(row);
    });

    document.getElementById('comparison-modal').classList.add('active');
    console.log('[DEBUG] Comparison modal opened');
}

/**
 * Opens the comparison modal for an existing item with parsed data comparison
 * @param {object} existingItem - The existing Airtable item record
 * @param {object} parsedData - The parsed item data from weblink parser
 */
function openComparisonModalForExisting(existingItem, parsedData) {
    console.log('[DEBUG] Opening comparison modal for existing item with parsed data');
    pendingNewItemData = {
        mode: 'update',
        existingItem: existingItem,
        parsedData: parsedData
    };

    // Update modal header
    const modalHeader = document.querySelector('.comparison-header h2');
    modalHeader.textContent = 'Compare Current vs Parsed Data';

    // Show mode indicator
    const modeIndicator = document.getElementById('comparison-mode-indicator');
    const modeText = document.getElementById('comparison-mode-text');
    modeIndicator.style.display = 'block';
    modeText.textContent = `Updating Existing Item: ${existingItem.fields.Name}`;

    // Update table header
    const tableHeader = document.getElementById('comparison-table-header');
    tableHeader.innerHTML = `
        <tr>
            <th>Field</th>
            <th>Current Value</th>
            <th>Parsed Value (from Internet)</th>
        </tr>
    `;

    const tableBody = document.getElementById('comparison-table-body');
    tableBody.innerHTML = '';

    // Extract search terms from AI_Profile if available
    let existingSearchTerms = [];
    if (existingItem.fields.AI_Profile) {
        try {
            const profile = JSON.parse(existingItem.fields.AI_Profile);
            existingSearchTerms = profile.SearchTerms || [];
        } catch (e) {
            console.warn('[DEBUG] Could not parse AI_Profile');
        }
    }

    // Extract existing Rankings if available
    let existingRankings = null;
    if (existingItem.fields.Rankings) {
        try {
            existingRankings = typeof existingItem.fields.Rankings === 'string'
                ? JSON.parse(existingItem.fields.Rankings)
                : existingItem.fields.Rankings;
        } catch (e) {
            console.warn('[DEBUG] Could not parse Rankings');
        }
    }

    // Extract existing Profile if available
    let existingProfile = null;
    if (existingItem.fields.Profile) {
        try {
            existingProfile = typeof existingItem.fields.Profile === 'string'
                ? JSON.parse(existingItem.fields.Profile)
                : existingItem.fields.Profile;
        } catch (e) {
            console.warn('[DEBUG] Could not parse Profile');
        }
    }

    // Create comparison rows for each field
    const fields = [
        { key: 'Name', label: 'Name', existingKey: 'Name' },
        { key: 'Description', label: 'Description', existingKey: 'Description' },
        { key: 'Price', label: 'Price', existingKey: 'Price' },
        { key: 'ServiceType', label: 'Service Type', existingKey: 'Item Type' },
        { key: 'SearchTerms', label: 'Search Terms', existingKey: null, customExisting: existingSearchTerms },
        { key: 'Rankings', label: 'Rankings', existingKey: null, customExisting: existingRankings },
        { key: 'Profile', label: 'Profile', existingKey: null, customExisting: existingProfile }
    ];

    fields.forEach(field => {
        const row = document.createElement('tr');

        // Get existing value
        let existingValue = field.customExisting !== undefined
            ? field.customExisting
            : existingItem.fields[field.existingKey];

        // Get parsed value
        const parsedValue = parsedData[field.key];

        // Format values for display
        let existingDisplay, parsedDisplay;

        if (field.key === 'Rankings' || field.key === 'Profile') {
            existingDisplay = existingValue
                ? (typeof existingValue === 'object' ? JSON.stringify(existingValue, null, 2) : existingValue)
                : 'N/A';
            parsedDisplay = parsedValue
                ? (typeof parsedValue === 'object' ? JSON.stringify(parsedValue, null, 2) : parsedValue)
                : 'N/A';
        } else if (field.key === 'Price') {
            // Special handling for Price field - treat 0 as a valid value, not N/A
            existingDisplay = (existingValue !== null && existingValue !== undefined)
                ? existingValue
                : 'N/A';
            parsedDisplay = (parsedValue !== null && parsedValue !== undefined)
                ? parsedValue
                : 'N/A';
            console.log('[DEBUG] Price field display values:', { existingDisplay, parsedDisplay, existingValue, parsedValue });
        } else {
            existingDisplay = Array.isArray(existingValue) ? existingValue.join(', ') : (existingValue || 'N/A');
            parsedDisplay = Array.isArray(parsedValue) ? parsedValue.join(', ') : (parsedValue || 'N/A');
        }

        // Check if values differ
        const isDifferent = JSON.stringify(existingValue) !== JSON.stringify(parsedValue);

        row.innerHTML = `
            <td><strong>${field.label}</strong></td>
            <td class="${isDifferent ? 'existing-value' : 'value-unchanged'}">
                ${field.key === 'Description'
                    ? `<div style="max-height: 100px; overflow-y: auto;">${existingDisplay}</div>`
                    : field.key === 'Rankings' || field.key === 'Profile'
                    ? `<pre style="margin: 0; padding: 8px; background: #f5f5f5; border-radius: 4px; font-size: 0.85em; max-height: 120px; overflow-y: auto;">${existingDisplay}</pre>`
                    : existingDisplay}
            </td>
            <td class="${isDifferent ? 'parsed-value' : 'value-unchanged'}">
                ${field.key === 'Description'
                    ? `<textarea id="edit-${field.key}" style="width: 100%; min-height: 80px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">${parsedDisplay}</textarea>`
                    : field.key === 'SearchTerms'
                    ? `<textarea id="edit-${field.key}" style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px;" placeholder="Comma-separated terms">${parsedDisplay}</textarea>`
                    : field.key === 'Rankings'
                    ? `<textarea id="edit-${field.key}" style="width: 100%; min-height: 100px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.85em;" placeholder='{"google": 4.5, ...}'>${parsedDisplay}</textarea>`
                    : field.key === 'Profile'
                    ? `<textarea id="edit-${field.key}" style="width: 100%; min-height: 140px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.85em;" placeholder='{"activityLevel": 5, ...}'>${parsedDisplay}</textarea>`
                    : `<input type="text" id="edit-${field.key}" value="${parsedDisplay}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;">`
                }
            </td>
        `;
        tableBody.appendChild(row);
    });

    // Update the action buttons
    const actionsDiv = document.querySelector('.comparison-actions');
    actionsDiv.innerHTML = `
        <button class="btn-cancel" onclick="closeComparisonModal()">Cancel</button>
        <button class="btn-confirm" onclick="adoptParsedData()">Adopt Parsed Data</button>
    `;

    document.getElementById('comparison-modal').classList.add('active');
    console.log('[DEBUG] Comparison modal opened for existing item');
}

/**
 * Closes the comparison modal
 */
function closeComparisonModal() {
    console.log('[DEBUG] Closing comparison modal');
    document.getElementById('comparison-modal').classList.remove('active');
    document.getElementById('comparison-status').textContent = '';

    // Reset modal state
    const modalHeader = document.querySelector('.comparison-header h2');
    modalHeader.textContent = 'Review New Item';

    const modeIndicator = document.getElementById('comparison-mode-indicator');
    modeIndicator.style.display = 'none';

    const tableHeader = document.getElementById('comparison-table-header');
    tableHeader.innerHTML = `
        <tr>
            <th>Field</th>
            <th>AI-Suggested Value</th>
        </tr>
    `;

    const actionsDiv = document.querySelector('.comparison-actions');
    actionsDiv.innerHTML = `
        <button class="btn-cancel" onclick="closeComparisonModal()">Cancel</button>
        <button class="btn-confirm" onclick="confirmNewItem()">Confirm & Add to Catalog</button>
    `;

    pendingNewItemData = null;
}

/**
 * Adopts the parsed data and updates the existing item in Airtable
 */
async function adoptParsedData() {
    console.log('[DEBUG] adoptParsedData called');

    if (!pendingNewItemData || pendingNewItemData.mode !== 'update') {
        console.error('[DEBUG] Invalid state for adoptParsedData');
        return;
    }

    const statusDiv = document.getElementById('comparison-status');
    statusDiv.textContent = 'Updating item in Airtable...';
    statusDiv.style.color = '#3498db';

    const { existingItem } = pendingNewItemData;

    // Get edited values from the form
    const priceInputRaw = document.getElementById('edit-Price').value;
    const priceInputTrimmed = priceInputRaw.trim();
    // Strip currency symbols, commas, and handle "N/A" case
    const priceInputCleaned = priceInputTrimmed === 'N/A' ? '0' : priceInputTrimmed.replace(/[$,]/g, '');
    const priceParsed = parseFloat(priceInputCleaned);

    console.log('[DEBUG] Price field processing:', {
        raw: priceInputRaw,
        trimmed: priceInputTrimmed,
        cleaned: priceInputCleaned,
        parsed: priceParsed,
        isNaN: isNaN(priceParsed),
        finalValue: isNaN(priceParsed) ? 0 : priceParsed
    });

    const updates = {
        Name: document.getElementById('edit-Name').value.trim(),
        Description: document.getElementById('edit-Description').value.trim(),
        Price: isNaN(priceParsed) ? 0 : priceParsed,
        ServiceType: document.getElementById('edit-ServiceType').value.trim(),
        SearchTerms: document.getElementById('edit-SearchTerms').value.split(',').map(t => t.trim()).filter(t => t)
    };

    // Handle Rankings if present
    const rankingsTextarea = document.getElementById('edit-Rankings');
    if (rankingsTextarea) {
        const rankingsValue = rankingsTextarea.value.trim();
        if (rankingsValue && rankingsValue !== 'N/A') {
            try {
                updates.Rankings = JSON.parse(rankingsValue);
            } catch (e) {
                console.warn('[DEBUG] Could not parse Rankings JSON, storing as string:', e);
                updates.Rankings = rankingsValue;
            }
        }
    }

    // Handle Profile if present
    const profileTextarea = document.getElementById('edit-Profile');
    if (profileTextarea) {
        const profileValue = profileTextarea.value.trim();
        if (profileValue && profileValue !== 'N/A') {
            try {
                updates.Profile = JSON.parse(profileValue);
            } catch (e) {
                console.warn('[DEBUG] Could not parse Profile JSON, storing as string:', e);
                updates.Profile = profileValue;
            }
        }
    }

    console.log('[DEBUG] Updates to apply:', updates);

    // Disable adopt button
    const adoptBtn = document.querySelector('.btn-confirm');
    if (adoptBtn) {
        adoptBtn.disabled = true;
    }

    try {
        // Call the update-catalog-item function
        const response = await fetch('/api/update-catalog-item', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                recordId: existingItem.id,
                updates: updates
            })
        });

        console.log('[DEBUG] Update item response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] Update item error:', errorText);
            throw new Error(`Failed to update item: ${errorText}`);
        }

        const result = await response.json();
        console.log('[DEBUG] Update item result:', result);

        statusDiv.textContent = `✅ Item updated successfully!`;
        statusDiv.style.color = '#28a745';

        // Close modal after 2 seconds
        setTimeout(() => {
            closeComparisonModal();
            // Refresh catalog items
            fetchAirtableData(CATALOG_TABLE).then(data => {
                allCatalogItems = data;
                catalogMap = new Map(allCatalogItems.map(item => [item.id, item]));
                console.log('[DEBUG] Catalog refreshed');
            });
        }, 2000);

    } catch (error) {
        console.error('[DEBUG] Error updating item:', error);
        statusDiv.textContent = `❌ Error: ${error.message}`;
        statusDiv.style.color = '#dc3545';
        if (adoptBtn) {
            adoptBtn.disabled = false;
        }
    }
}

/**
 * Confirms the new item and creates it in Airtable
 */
async function confirmNewItem(event) {
    console.log('[DEBUG] confirmNewItem called');
    const statusDiv = document.getElementById('comparison-status');
    statusDiv.textContent = 'Creating item in Airtable...';
    statusDiv.style.color = '#3498db';

    // Get edited values from the form
    const priceInputRaw = document.getElementById('edit-Price').value;
    // Strip currency symbols, commas, and handle "N/A" case
    const priceInputCleaned = priceInputRaw.trim() === 'N/A' ? '0' : priceInputRaw.trim().replace(/[$,]/g, '');
    const priceParsed = parseFloat(priceInputCleaned);

    console.log('[DEBUG] Price field processing (confirmNewItem):', {
        raw: priceInputRaw,
        cleaned: priceInputCleaned,
        parsed: priceParsed,
        finalValue: isNaN(priceParsed) ? 0 : priceParsed
    });

    const editedData = {
        Name: document.getElementById('edit-Name').value.trim(),
        Description: document.getElementById('edit-Description').value.trim(),
        Price: isNaN(priceParsed) ? 0 : priceParsed,
        ServiceType: document.getElementById('edit-ServiceType').value.trim(),
        SearchTerms: document.getElementById('edit-SearchTerms').value.split(',').map(t => t.trim()).filter(t => t)
    };

    // Handle Rankings if present
    const rankingsTextarea = document.getElementById('edit-Rankings');
    if (rankingsTextarea) {
        const rankingsValue = rankingsTextarea.value.trim();
        if (rankingsValue) {
            try {
                editedData.Rankings = JSON.parse(rankingsValue);
            } catch (e) {
                console.warn('[DEBUG] Could not parse Rankings JSON, storing as string:', e);
                editedData.Rankings = rankingsValue;
            }
        }
    }

    // Handle Profile if present
    const profileTextarea = document.getElementById('edit-Profile');
    if (profileTextarea) {
        const profileValue = profileTextarea.value.trim();
        if (profileValue) {
            try {
                editedData.Profile = JSON.parse(profileValue);
            } catch (e) {
                console.warn('[DEBUG] Could not parse Profile JSON, storing as string:', e);
                editedData.Profile = profileValue;
            }
        }
    }

    console.log('[DEBUG] Edited data:', editedData);

    // Disable confirm button
    if (event && event.target) {
        event.target.disabled = true;
    }

    try {
        // Call the create-catalog-item function
        const response = await fetch('/api/create-catalog-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(editedData)
        });

        console.log('[DEBUG] Create item response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[DEBUG] Create item error:', errorText);
            throw new Error(`Failed to create item: ${errorText}`);
        }

        const result = await response.json();
        console.log('[DEBUG] Create item result:', result);

        statusDiv.textContent = `✅ Item created successfully! Record ID: ${result.recordId}`;
        statusDiv.style.color = '#28a745';

        // Optionally trigger auto-profile
        if (result.recordId) {
            console.log('[DEBUG] Triggering auto-profile for:', result.recordId);
            statusDiv.textContent += ' | Generating AI profile...';

            try {
                const profileResponse = await fetch('/api/profile-item', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ recordId: result.recordId })
                });

                console.log('[DEBUG] Profile response status:', profileResponse.status);

                if (profileResponse.ok) {
                    statusDiv.textContent += ' ✅ Profile generated!';
                    console.log('[DEBUG] Profile generated successfully');
                } else {
                    statusDiv.textContent += ' ⚠️ Profile generation failed (item still created)';
                    console.error('[DEBUG] Profile generation failed');
                }
            } catch (profileError) {
                console.error('[DEBUG] Profile error:', profileError);
                statusDiv.textContent += ' ⚠️ Profile generation error';
            }
        }

        // Close modal after 3 seconds
        setTimeout(() => {
            closeComparisonModal();
            // Refresh catalog items
            fetchAirtableData(CATALOG_TABLE).then(data => {
                allCatalogItems = data;
                catalogMap = new Map(allCatalogItems.map(item => [item.id, item]));
                console.log('[DEBUG] Catalog refreshed');
            });
        }, 3000);

    } catch (error) {
        console.error('[DEBUG] Error creating item:', error);
        statusDiv.textContent = `❌ Error: ${error.message}`;
        statusDiv.style.color = '#dc3545';
        if (event && event.target) {
            event.target.disabled = false;
        }
    }
}

// Make functions globally available
window.closeComparisonModal = closeComparisonModal;
window.confirmNewItem = confirmNewItem;
window.adoptParsedData = adoptParsedData;

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
        console.log('[DEBUG] No item found, calling weblink parser for:', query);
        omniSearchResults.innerHTML += `<p style="color: #3498db; text-align: center;">No item match found. Calling external parser for "${query}"...</p>`;
        try {
            const parseResponse = await fetch('/api/process-weblink', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query: query })
            });

            console.log('[DEBUG] Parser response status:', parseResponse.status);

            if (!parseResponse.ok) {
                 const errorText = await parseResponse.text();
                 console.error('[DEBUG] Parser error response:', errorText);
                 throw new Error(`Weblink Parser API failed: ${errorText}`);
            }

            const newItemData = await parseResponse.json();
            console.log('[DEBUG] Parsed new item data:', newItemData);

            // Open comparison modal instead of just displaying
            openComparisonModal(newItemData);

            omniSearchResults.innerHTML += `
                <h5>✅ Item Parsed Successfully</h5>
                <p style="font-size: 0.9em; color: #28a745;">Review the parsed data in the modal to confirm or edit before adding to catalog.</p>
            `;

        } catch (error) {
            console.error('[DEBUG] Weblink Parser Error:', error);
            omniSearchResults.innerHTML += `<p style="color: #dc3545; text-align: center;"><strong>Parser Error:</strong> ${error.message}</p>`;
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
    loadModuleState();
    updateModuleVisibility();

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
        allTeammates = allTeammatesData;

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
        setupModuleToggles();

        const teammateListContainer = document.getElementById('teammates-list');

        allTeammates.forEach(tm => {
            const link = document.createElement('a');
            link.href = `/teammate.html?id=${tm.id}`;
            link.textContent = tm.fields.Name;
            link.className = 'session-list-item';
            teammateListContainer.appendChild(link);
        });

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

    try {
        const pusher = new Pusher(PUSHER_KEY, {
            cluster: PUSHER_CLUSTER,
            authEndpoint: '/api/pusher-auth',
            auth: { params: { user_id: `admin-${Date.now()}`, user_name: 'Dashboard Admin' } },
            // Add error handling and connection management
            enabledTransports: ['ws', 'wss'],
            disabledTransports: [],
            // Prevent too many reconnection attempts
            activityTimeout: 120000,
            pongTimeout: 30000,
            unavailableTimeout: 10000
        });

        // Handle connection errors
        pusher.connection.bind('error', (err) => {
            console.error('[DEBUG] Pusher connection error:', err);
        });

        pusher.connection.bind('failed', () => {
            console.error('[DEBUG] Pusher connection failed - check credentials');
        });

        pusher.connection.bind('connected', () => {
            console.log('[DEBUG] Pusher connected successfully');
        });

        sessionMap.forEach((name, id) => {
            const channel = pusher.subscribe(`presence-session-${id}`);
            pusherChannelMap.set(id, channel);

            channel.bind('pusher:subscription_error', (status) => {
                console.error('[DEBUG] Pusher subscription error for session', id, ':', status);
            });

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
    } catch (error) {
        console.error('[DEBUG] Failed to initialize Pusher:', error);
    }
}

initializeDashboard();
