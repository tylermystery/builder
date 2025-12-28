// REPLACE THE ENTIRE CONTENTS OF: chat.js

import { state, setState } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import { log } from './utils/debug.js';
import { triggerSave, openChatWidget } from './events.js';
import { updateUrl } from './utils.js';
import { getDebugLogs, isDebugPanelInitialized } from './utils/debug-panel.js';

let currentUser = null;
let pusher = null;
let sessionChatChannel = null;
const itemChatChannels = new Map();
const FUN_ADJECTIVES = ['Happy', 'Clever', 'Sunny', 'Lucky', 'Creative', 'Brave', 'Sparkling', 'Cosmic', 'Witty', 'Zesty'];
const FUN_NOUNS = ['Panda', 'Wombat', 'Explorer', 'Starship', 'Juggler', 'Wizard', 'Dolphin', 'Robot', 'Pineapple', 'Comet'];
let originalTitle = document.title;
let isTabActive = true;

// Session history filter state - track which message types are visible
// DORMANT FEATURE: Plan and Debug toggles hidden - chat is always shown
// TODO: Re-enable toggles when plan history tracking and debug features are fully functional
let historyFilters = {
    chat: true,       // Always true since toggles are hidden
    planEvents: false, // Disabled - plan history not showing properly
    debug: false      // Disabled - debug toggle hidden
};

// Store all session history items for re-rendering when filters change
let sessionHistoryItems = [];

// Event type display labels and icons
const EVENT_TYPE_DISPLAY = {
    'plan_created': { icon: '🎯', label: 'Plan Created', color: '#667eea' },
    'ai_interpretation': { icon: '🤖', label: 'AI Analysis', color: '#764ba2' },
    'plan_updated': { icon: '✏️', label: 'Plan Updated', color: '#28a745' },
    'task_added': { icon: '✅', label: 'Task Added', color: '#17a2b8' },
    'item_added': { icon: '📦', label: 'Item Added', color: '#ffc107' },
    'collaborator_joined': { icon: '👋', label: 'Collaborator Joined', color: '#6f42c1' }
};

window.addEventListener('focus', () => {
  isTabActive = true;
  document.title = originalTitle;
});
window.addEventListener('blur', () => {
  isTabActive = false;
});

/**
 * Creates the history filter toggle buttons UI in the chat header.
 * DORMANT FEATURE: Toggle buttons are hidden - chat is always displayed.
 * TODO: Re-enable toggles when plan history and debug features are fully functional.
 */
function createHistoryFilterToggles() {
    const chatHeader = document.getElementById('chat-header');
    if (!chatHeader) return;

    // Remove existing filter controls if present
    const existingFilters = chatHeader.querySelector('.history-filter-controls');
    if (existingFilters) {
        existingFilters.remove();
    }

    // DORMANT FEATURE: History filter toggle buttons hidden
    // Chat messages are always shown, plan and debug toggles removed until functional
    /*
    const filterControls = document.createElement('div');
    filterControls.className = 'history-filter-controls';

    const toggles = [
        { key: 'chat', label: 'Chat', icon: '💬', title: 'Show/hide chat messages' },
        { key: 'planEvents', label: 'Plan', icon: '📋', title: 'Show/hide plan history' },
        { key: 'debug', label: 'Debug', icon: '🔧', title: 'Show/hide debug logs' }
    ];

    toggles.forEach(toggle => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `history-filter-btn ${historyFilters[toggle.key] ? 'active' : ''}`;
        btn.dataset.filterKey = toggle.key;
        btn.title = toggle.title;
        btn.innerHTML = `<span class="filter-icon">${toggle.icon}</span><span class="filter-label">${toggle.label}</span>`;

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleHistoryFilter(toggle.key);
        });

        filterControls.appendChild(btn);
    });

    // Insert after the chat options or at the end of header
    const chatOptions = chatHeader.querySelector('.chat-options');
    if (chatOptions) {
        chatOptions.insertAdjacentElement('afterend', filterControls);
    } else {
        chatHeader.appendChild(filterControls);
    }
    */
    // END DORMANT FEATURE
}

/**
 * Toggles a history filter and re-renders the messages list
 * @param {string} filterKey - The filter to toggle ('chat', 'planEvents', or 'debug')
 */
function toggleHistoryFilter(filterKey) {
    historyFilters[filterKey] = !historyFilters[filterKey];

    // Update button state
    const btn = document.querySelector(`.history-filter-btn[data-filter-key="${filterKey}"]`);
    if (btn) {
        btn.classList.toggle('active', historyFilters[filterKey]);
    }

    // Re-render the messages list with current filters
    renderFilteredHistory();
}

/**
 * Renders the session history based on current filter settings.
 * Items are sorted chronologically and only shown if their type filter is enabled.
 */
function renderFilteredHistory() {
    const messagesList = document.getElementById('messages-list');
    if (!messagesList) return;

    // Clear the messages list
    messagesList.innerHTML = '';

    // Get debug logs if filter is enabled
    let allItems = [...sessionHistoryItems];

    if (historyFilters.debug) {
        const debugLogs = getDebugLogsForHistory();
        allItems = allItems.concat(debugLogs);
    }

    // Sort all items by timestamp
    allItems.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Filter and render items based on current filters
    let visibleCount = 0;
    allItems.forEach(item => {
        if (item.type === 'chat' && !historyFilters.chat) return;
        if (item.type === 'planEvent' && !historyFilters.planEvents) return;
        if (item.type === 'debug' && !historyFilters.debug) return;

        renderHistoryItem(messagesList, item);
        visibleCount++;
    });

    // Show empty state if no items visible
    if (visibleCount === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'history-empty-state';
        emptyState.innerHTML = `
            <p>No history items to display.</p>
            <p class="empty-hint">Toggle the filters above to show chat messages, plan events, or debug logs.</p>
        `;
        messagesList.appendChild(emptyState);
    }

    // Scroll to bottom
    if (messagesList.lastElementChild) {
        messagesList.lastElementChild.scrollIntoView({ behavior: 'smooth' });
    }
}

/**
 * Gets debug logs formatted for the history view
 * @returns {Array} Array of debug log items with type, timestamp, and data
 */
function getDebugLogsForHistory() {
    try {
        const debugLogs = getDebugLogs();
        return debugLogs.map(entry => ({
            type: 'debug',
            timestamp: entry.timestamp,
            data: entry
        }));
    } catch (e) {
        console.warn('[Chat] Could not get debug logs:', e);
        return [];
    }
}

/**
 * Renders a single history item to the messages list
 * @param {HTMLElement} messagesList - The container element
 * @param {Object} item - The history item to render
 */
function renderHistoryItem(messagesList, item) {
    if (item.type === 'chat') {
        const { sender, message, isSent, timestamp, senderId } = item.data;
        addMessageToUI(messagesList, sender, message, isSent, timestamp, false, null, senderId);
    } else if (item.type === 'planEvent') {
        addEventToUI(messagesList, item.data);
    } else if (item.type === 'debug') {
        addDebugLogToUI(messagesList, item.data);
    }
}

/**
 * Adds a debug log entry to the chat history UI
 * @param {HTMLElement} messagesList - The messages container element
 * @param {Object} logEntry - The debug log entry with timestamp, action, data, type
 */
function addDebugLogToUI(messagesList, logEntry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'debug-history-wrapper';

    const debugElement = document.createElement('div');
    debugElement.className = `debug-history-entry debug-type-${logEntry.type}`;

    // Header with icon and type
    const headerEl = document.createElement('div');
    headerEl.className = 'debug-history-header';
    const typeIcon = logEntry.type === 'error' ? '❌' : logEntry.type === 'success' ? '✅' : '🔧';
    headerEl.innerHTML = `<span class="debug-icon">${typeIcon}</span><span class="debug-type-label">${logEntry.type.toUpperCase()}</span>`;
    debugElement.appendChild(headerEl);

    // Action content
    const actionEl = document.createElement('div');
    actionEl.className = 'debug-history-action';
    actionEl.textContent = logEntry.action;
    debugElement.appendChild(actionEl);

    // Data (if present)
    if (logEntry.data !== null && logEntry.data !== undefined) {
        const dataEl = document.createElement('div');
        dataEl.className = 'debug-history-data';
        const dataStr = typeof logEntry.data === 'object' ? JSON.stringify(logEntry.data, null, 2) : String(logEntry.data);
        dataEl.textContent = dataStr;
        debugElement.appendChild(dataEl);
    }

    // Timestamp
    const timestampEl = document.createElement('div');
    timestampEl.className = 'debug-history-timestamp';
    const date = new Date(logEntry.timestamp);
    timestampEl.textContent = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    debugElement.appendChild(timestampEl);

    wrapper.appendChild(debugElement);
    messagesList.appendChild(wrapper);
}

/**
 * Exports the history filter state getter for external use
 */
export function getHistoryFilters() {
    return { ...historyFilters };
}

/**
 * Exports the history filter state setter for external use
 * @param {Object} newFilters - Object with filter keys to update
 */
export function setHistoryFilters(newFilters) {
    Object.assign(historyFilters, newFilters);
    // Update button states
    Object.keys(newFilters).forEach(key => {
        const btn = document.querySelector(`.history-filter-btn[data-filter-key="${key}"]`);
        if (btn) {
            btn.classList.toggle('active', historyFilters[key]);
        }
    });
    renderFilteredHistory();
}

/**
 * Updates the chat header title to display the current plan name.
 * Falls back to 'Session Chat' if no plan name is available.
 */
function updateChatHeaderTitle() {
    const chatTitleEl = document.getElementById('chat-session-title');
    if (chatTitleEl) {
        const planName = state.eventDetails?.combined?.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
        chatTitleEl.textContent = planName || 'Session Chat';
        log('Chat', `Updated chat header title to: ${planName || 'Session Chat'}`);
    }

    // Phase 5: Update project indicator if present
    updateProjectIndicator();
}

/**
 * Phase 5: Updates the project indicator in the chat panel header.
 * Shows which project the chat is currently associated with.
 */
function updateProjectIndicator() {
    const chatHeader = document.querySelector('.chat-header, #chat-header');
    if (!chatHeader) return;

    // Remove existing indicator if present
    const existingIndicator = chatHeader.querySelector('.chat-project-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }

    // Get current project/session info
    const sessionId = state.session.id;
    if (!sessionId) return;

    // Get project name from eventDetails or recent chats
    let projectName = state.eventDetails?.combined?.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME);

    if (!projectName) {
        // Try to find from recent chats
        const currentChat = state.session.recentChats?.find(
            c => c.id === sessionId && c.type === 'session'
        );
        projectName = currentChat?.name;
    }

    if (projectName && projectName !== 'Session Chat') {
        const indicator = document.createElement('div');
        indicator.className = 'chat-project-indicator';
        indicator.innerHTML = `
            <span class="project-icon">📋</span>
            <span class="project-name">${escapeHtml(projectName)}</span>
        `;

        // Insert at the top of the chat header
        const firstChild = chatHeader.firstChild;
        if (firstChild) {
            chatHeader.insertBefore(indicator, firstChild);
        } else {
            chatHeader.appendChild(indicator);
        }
    }
}

/**
 * Phase 5: Switch chat context to a different project.
 * Call this when the user selects a different project in the Dashboard.
 * @param {string} projectId - The new project ID to switch to
 * @param {string} projectName - The name of the project (optional)
 */
export async function switchChatContext(projectId, projectName = null) {
    if (!projectId) {
        log('Chat', 'Cannot switch chat context - no project ID provided');
        return;
    }

    const currentSessionId = state.session.id;

    // If switching to the same project, just update the header
    if (projectId === currentSessionId) {
        updateChatHeaderTitle();
        return;
    }

    log('Chat', `Switching chat context from ${currentSessionId} to ${projectId}`);

    // Disconnect from current session channel if exists
    if (sessionChatChannel) {
        sessionChatChannel.unbind_all();
        if (pusher) {
            pusher.unsubscribe(`presence-session-${currentSessionId}`);
        }
        sessionChatChannel = null;
    }

    // Update the chat title
    const chatTitleEl = document.getElementById('chat-session-title');
    if (chatTitleEl) {
        chatTitleEl.textContent = projectName || 'Project Chat';
    }

    // Clear messages list
    const messagesList = document.getElementById('messages-list');
    if (messagesList) {
        messagesList.innerHTML = '<div class="chat-loading">Loading messages...</div>';
    }

    // Update project indicator
    updateProjectIndicator();

    // The full reinitialization will happen when the session is loaded
    // via initializeSessionChat() called from the session loading flow
    log('Chat', 'Chat context updated - awaiting full session reload');
}

function requestNotificationPermissionIfNeeded() {
    if ('Notification' in window) {
      if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission().then(permission => {
          if (permission === 'granted') {
            log('Chat', 'Notification permission granted.');
          }
        });
      }
    }
}

function generateFunName() {
    const adj = FUN_ADJECTIVES[Math.floor(Math.random() * FUN_ADJECTIVES.length)];
    const noun = FUN_NOUNS[Math.floor(Math.random() * FUN_NOUNS.length)];
    return `${adj} ${noun}`;
}

function getSimpleUserIdentity() {
    // Always check authentication status first - user may have logged in since last call
    const authenticatedUser = state.session.user;
    console.log('[ItemChat DEBUG] getSimpleUserIdentity called');
    console.log('[ItemChat DEBUG] authenticatedUser:', JSON.stringify(authenticatedUser));
    console.log('[ItemChat DEBUG] authenticatedUser.isAuthenticated:', authenticatedUser?.isAuthenticated);
    if (authenticatedUser && authenticatedUser.isAuthenticated) {
        // User is authenticated - always use their real ID and name
        // Update cached user if it doesn't match (e.g., user logged in after initial load)
        if (!currentUser || currentUser.id !== authenticatedUser.id) {
            currentUser = { id: authenticatedUser.id, name: authenticatedUser.name };
            log('Chat', `Updated currentUser to authenticated user: ${authenticatedUser.id}`);
            console.log('[ItemChat DEBUG] Returning authenticated user:', JSON.stringify(currentUser));
        }
        return currentUser;
    }

    // User is not authenticated - use localStorage-based identity
    console.log('[ItemChat DEBUG] User not authenticated, using localStorage identity');
    if (currentUser && !currentUser.id.startsWith('rec')) {
        // Already have an anonymous user cached
        return currentUser;
    }

    let userId = localStorage.getItem('chatUserId');
    if (!userId) {
        userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('chatUserId', userId);
    }
    let userName = localStorage.getItem('chatUserName');
    if (!userName) {
        userName = generateFunName();
        localStorage.setItem('chatUserName', userName);
    }
    currentUser = { id: userId, name: userName };
    return currentUser;
}

function updatePresenceUI(members) {
    const presenceCounter = document.getElementById('presence-counter');
    const whosHereCount = document.getElementById('whos-here-count');
    const whosHereList = document.getElementById('whos-here-list');
    const count = members.count;
    if (presenceCounter) presenceCounter.innerText = count;
    if (whosHereCount) whosHereCount.innerText = count;
    if (whosHereList) {
        whosHereList.innerHTML = '';
        members.each((member) => {
            const profileId = state.session.user.isAuthenticated ? state.session.user.id : member.id;
            const profileName = state.session.user.isAuthenticated ? state.session.user.name : member.info.name;
            if (!state.session.userProfiles.has(profileId)) {
                state.session.userProfiles.set(profileId, profileName);
                triggerSave();
            }
 
            const userElement = document.createElement('div');
            const displayName = member.id === currentUser.id ? currentUser.name : member.info.name;
            userElement.innerText = `🟢 ${displayName} ${member.id === currentUser.id ? '(You)' : ''}`;
            whosHereList.appendChild(userElement);
        });
    }
}

/**
 * Adds a plan event entry to the chat UI (system events like plan creation, AI interpretation, etc.)
 * @param {HTMLElement} messagesList - The messages container element
 * @param {object} record - The message record from Airtable
 */
function addEventToUI(messagesList, record) {
    const { Content, Timestamp, EventType } = record.fields;

    // Parse the event content JSON
    let eventData = {};
    try {
        const parsed = JSON.parse(Content);
        eventData = parsed.data || parsed;
    } catch (e) {
        // Failed to parse event content - skip rendering this event
        return;
    }

    const eventDisplay = EVENT_TYPE_DISPLAY[EventType] || { icon: '📋', label: 'Event', color: '#6c757d' };

    const wrapper = document.createElement('div');
    wrapper.className = 'event-history-wrapper';

    const eventElement = document.createElement('div');
    eventElement.className = 'event-history-entry';
    eventElement.style.borderLeftColor = eventDisplay.color;

    // Header with icon and label
    const headerEl = document.createElement('div');
    headerEl.className = 'event-history-header';
    headerEl.innerHTML = `<span class="event-icon">${eventDisplay.icon}</span><span class="event-label">${eventDisplay.label}</span>`;
    eventElement.appendChild(headerEl);

    // Event content based on type
    const contentEl = document.createElement('div');
    contentEl.className = 'event-history-content';

    if (EventType === 'plan_created') {
        contentEl.innerHTML = `
            <div class="event-field"><strong>Your input:</strong> "${escapeHtml(eventData.originalInput || 'N/A')}"</div>
        `;
    } else if (EventType === 'ai_interpretation') {
        let contentHtml = '';

        if (eventData.planName) {
            contentHtml += `<div class="event-field"><strong>Plan name:</strong> ${escapeHtml(eventData.planName)}</div>`;
        }
        if (eventData.planType) {
            contentHtml += `<div class="event-field"><strong>Type:</strong> ${escapeHtml(eventData.planType)}</div>`;
        }
        if (eventData.eventDate) {
            contentHtml += `<div class="event-field"><strong>Date:</strong> ${escapeHtml(eventData.eventDate)}</div>`;
        }
        if (eventData.goals) {
            contentHtml += `<div class="event-field"><strong>Goals:</strong> ${escapeHtml(eventData.goals)}</div>`;
        }
        if (eventData.guestCount) {
            contentHtml += `<div class="event-field"><strong>Guest count:</strong> ${eventData.guestCount}</div>`;
        }
        if (eventData.location) {
            contentHtml += `<div class="event-field"><strong>Location:</strong> ${escapeHtml(eventData.location)}</div>`;
        }
        if (eventData.itemsExtracted && eventData.itemsExtracted.length > 0) {
            contentHtml += `<div class="event-field"><strong>Items identified:</strong> ${eventData.itemsExtracted.map(i => escapeHtml(i)).join(', ')}</div>`;
        }
        if (eventData.tasksCreated && eventData.tasksCreated.length > 0) {
            contentHtml += `<div class="event-field"><strong>Tasks created:</strong> ${eventData.tasksCreated.map(t => escapeHtml(t)).join(', ')}</div>`;
        }
        if (eventData.reasoning) {
            contentHtml += `<div class="event-field event-reasoning"><em>${escapeHtml(eventData.reasoning)}</em></div>`;
        }

        contentEl.innerHTML = contentHtml || '<div class="event-field">AI analyzed your plan input</div>';
    } else if (EventType === 'plan_updated') {
        let contentHtml = '<div class="event-field">Plan details were updated:</div>';
        if (eventData.changedFields) {
            contentHtml += `<div class="event-field">${eventData.changedFields.map(f => escapeHtml(f)).join(', ')}</div>`;
        }
        contentEl.innerHTML = contentHtml;
    } else if (EventType === 'task_added') {
        contentEl.innerHTML = `<div class="event-field">Task added: ${escapeHtml(eventData.taskName || 'New task')}</div>`;
    } else if (EventType === 'item_added') {
        contentEl.innerHTML = `<div class="event-field">Item added: ${escapeHtml(eventData.itemName || 'New item')}</div>`;
    } else if (EventType === 'collaborator_joined') {
        contentEl.innerHTML = `<div class="event-field">${escapeHtml(eventData.userName || 'Someone')} joined the plan</div>`;
    } else {
        contentEl.innerHTML = `<div class="event-field">Plan activity recorded</div>`;
    }

    eventElement.appendChild(contentEl);

    // Timestamp
    const timestampEl = document.createElement('div');
    timestampEl.className = 'event-history-timestamp';
    const date = Timestamp ? new Date(Timestamp) : new Date();
    timestampEl.textContent = date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    eventElement.appendChild(timestampEl);

    wrapper.appendChild(eventElement);
    messagesList.appendChild(wrapper);
}

function addMessageToUI(messagesList, sender, message, isSent, timestamp, isAdmin, messageId, senderId) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}`;
    const messageElement = document.createElement('div');
    const isFlagged = state.session.flaggedUsers.has(senderId);
    const isBanned = state.session.bannedUsers.has(senderId);
    const displayMessage = (isFlagged || isBanned) ? '[CENSORED BY MODERATOR]' : message;
    messageElement.className = 'chat-message';
    if (isBanned) messageElement.classList.add('banned');
    if (isFlagged) messageElement.classList.add('flagged');
    const senderElement = document.createElement('div');
    senderElement.className = 'sender';
    senderElement.innerText = isSent ? 'You' : sender;
    if (state.session.user.isOwner && !isSent) {
      const moderationActions = document.createElement('div');
      moderationActions.className = 'moderation-actions';
      const flagBtn = document.createElement('button');
      flagBtn.textContent = isFlagged ? '✅ Un-Flag' : '⚠️ Flag';
      flagBtn.className = 'flag-btn';
      flagBtn.addEventListener('click', async () => {
        if (isFlagged) {
          state.session.flaggedUsers.delete(senderId);
        } else {
          state.session.flaggedUsers.add(senderId);
        }
        await api.updateUserFlagStatus(senderId, !isFlagged);
        const currentModalRecordId = document.getElementById('detail-modal-overlay')?.dataset.recordId;
        if (currentModalRecordId) {
            initializeItemChat(currentModalRecordId);
     
        }
      });
      const banBtn = document.createElement('button');
      banBtn.textContent = '⛔ Ban';
      banBtn.className = 'ban-btn';
      banBtn.addEventListener('click', async () => {
        await api.banUser(senderId);
      });
      moderationActions.appendChild(flagBtn);
      moderationActions.appendChild(banBtn);
      messageElement.appendChild(moderationActions);
    }
    messageElement.appendChild(senderElement);
    messageElement.append(document.createTextNode(displayMessage));
    const timestampElement = document.createElement('div');
    timestampElement.className = 'timestamp';
    const date = timestamp ? new Date(timestamp) : new Date();
    timestampElement.innerText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    wrapper.appendChild(messageElement);
    wrapper.appendChild(timestampElement);
    messagesList.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth' });
}

function bindPresenceEvents() {
    sessionChatChannel.bind('pusher:subscription_succeeded', (members) => {
        const messageInput = document.getElementById('message-input');
        const messageForm = document.getElementById('message-form');
        if (messageInput && messageForm) {
            messageInput.disabled = false;
            messageForm.querySelector('button').disabled = false;
            messageInput.placeholder = 'Type a message...';
        }
        updatePresenceUI(members);
    });
    sessionChatChannel.bind('pusher:member_added', (member) => {
        updatePresenceUI(sessionChatChannel.members);
    });
    sessionChatChannel.bind('pusher:member_removed', (member) => {
        updatePresenceUI(sessionChatChannel.members);
    });
}
export function getCurrentUser() {
    // Always call getSimpleUserIdentity to ensure authentication status is checked
    return getSimpleUserIdentity();
}
function showNewMessageNotification(sender, message) {
  if (Notification.permission === 'granted' && !document.hasFocus()) {
    const notification = new Notification(`New message from ${sender}`, {
      body: message,
    });
    setTimeout(notification.close.bind(notification), 4000);
  }
}

// --- NEW DEBUG FUNCTION ---
// displayDebugMessage is available for showing critical errors in the UI
function displayDebugMessage(message) {
    const messagesList = document.getElementById('messages-list');
    if (messagesList) {
        const debugEl = document.createElement('div');
        debugEl.className = 'chat-message received';
        debugEl.style.color = '#dc3545';
        debugEl.style.fontSize = '0.7em';
        debugEl.innerHTML = `<strong>[Error]</strong> ${message}`;
        messagesList.appendChild(debugEl);
        debugEl.scrollIntoView({ behavior: 'smooth' });
    }
}
// --- END NEW DEBUG FUNCTION ---

export async function initializeSessionChat() {
    // Reset session history items for new session
    sessionHistoryItems = [];

    // Show loading state in the message input while waiting for Pusher
    const messageInput = document.getElementById('message-input');
    const messageForm = document.getElementById('message-form');
    if (messageInput && messageForm) {
        messageInput.disabled = true;
        messageForm.querySelector('button').disabled = true;
        messageInput.placeholder = 'Connecting to chat...';
    }

    // Wait for Pusher library to be loaded
    if (typeof window.waitForPusher === 'function') {
        try {
            await window.waitForPusher();
        } catch (err) {
            if (messageInput) {
                messageInput.placeholder = 'Chat unavailable - please refresh';
            }
            displayDebugMessage('Could not load real-time chat library. Please refresh the page.');
            return;
        }
    } else if (typeof Pusher === 'undefined') {
        if (messageInput) {
            messageInput.placeholder = 'Chat unavailable - please refresh';
        }
        displayDebugMessage('Real-time chat library not loaded. Please refresh the page.');
        return;
    }

    if (pusher) {
        pusher.disconnect();
    }

    // Update the chat header to show the current plan name
    updateChatHeaderTitle();

    // Create the history filter toggles
    createHistoryFilterToggles();

    currentUser = getSimpleUserIdentity();
    if (!state.session.userProfiles.has(currentUser.id)) {
        state.session.userProfiles.set(currentUser.id, currentUser.name);
    }
    const sessionId = state.session.id || 'default-session';

    const chatUserNameInput = document.getElementById('chat-user-name');
    if (chatUserNameInput) {
        chatUserNameInput.value = currentUser.name;
        chatUserNameInput.addEventListener('change', (e) => {
            const newName = e.target.value.trim();
            if (newName && newName !== currentUser.name) {
                currentUser.name = newName;
                localStorage.setItem('chatUserName', newName);
                state.session.userProfiles.set(currentUser.id, newName);

                log('Chat', `User name changed to: ${newName}`);
                updatePresenceUI(sessionChatChannel.members);
                triggerSave();
            } else {
                e.target.value = currentUser.name;
            }

        });
    }

    const messagesList = document.getElementById('messages-list');
    if (messagesList) {
        messagesList.innerHTML = '';

        const records = await api.fetchChatMessages(sessionId);

        if (records.length > 0) {
            let eventCount = 0;
            let messageCount = 0;

            records.forEach(record => {
                const { SenderID, SenderName, Content, Timestamp, EventType } = record.fields;

                // Check if this is a system event (plan history)
                if (SenderID === 'system' && EventType) {
                    // Store in sessionHistoryItems for filtering
                    sessionHistoryItems.push({
                        type: 'planEvent',
                        timestamp: Timestamp || new Date().toISOString(),
                        data: record
                    });
                    eventCount++;
                } else {
                    // Regular chat message - store in sessionHistoryItems
                    const isSent = SenderID === currentUser.id;
                    sessionHistoryItems.push({
                        type: 'chat',
                        timestamp: Timestamp || new Date().toISOString(),
                        data: {
                            sender: SenderName,
                            message: Content,
                            isSent,
                            timestamp: Timestamp,
                            senderId: SenderID
                        }
                    });
                    messageCount++;
                }
            });

            log('Chat', `Loaded ${eventCount} plan events and ${messageCount} messages into session history`);
        }

        // Render the filtered history
        renderFilteredHistory();
    }

    pusher = new Pusher('236f480714e5001590b5', {
        cluster: 'us3',
        authEndpoint: '/api/pusher-auth',
        auth: {
            params: {
                user_id: currentUser.id,
                user_name: currentUser.name

           }
        }
    });
    const channelName = `presence-session-${sessionId}`;
    sessionChatChannel = pusher.subscribe(channelName);
    bindPresenceEvents();
    sessionChatChannel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            requestNotificationPermissionIfNeeded();
            // Add to session history items
            const timestamp = data.timestamp || new Date().toISOString();
            sessionHistoryItems.push({
                type: 'chat',
                timestamp: timestamp,
                data: {
                    sender: data.senderName,
                    message: data.content,
                    isSent: false,
                    timestamp: timestamp,
                    senderId: data.senderId
                }
            });
            // Re-render to include the new message (only if chat filter is on)
            if (historyFilters.chat) {
                const messagesList = document.getElementById('messages-list');
                addMessageToUI(messagesList, data.senderName, data.content, false, data.timestamp, false, null, data.senderId);
            }
            showNewMessageNotification(data.senderName, data.content);
            if (!isTabActive) {
                document.title = 'New Message! - ' + originalTitle;

            }
        }
    });
}

export async function sendMessage(message, recordId = null) {
    if (recordId) {
        console.log('[ItemChat DEBUG] sendMessage START for item chat');
        console.log('[ItemChat DEBUG] recordId:', recordId);
        console.log('[ItemChat DEBUG] currentUser at send time:', JSON.stringify(currentUser));
        const channel = itemChatChannels.get(recordId);
        console.log('[ItemChat DEBUG] channel exists:', !!channel);
        if (!channel || !currentUser) {
            console.log('[ItemChat DEBUG] sendMessage ABORTED: channel or currentUser missing');
            return;
        }
        const timestamp = new Date().toISOString();
        const messagesList = document.getElementById('messages-list-item');
        // Remove empty state placeholder if present
        const emptyState = messagesList.querySelector('.item-chat-empty-state');
        if (emptyState) {
            emptyState.remove();
        }
        addMessageToUI(messagesList, currentUser.name, message, true, timestamp, false, null, currentUser.id);
        console.log('[ItemChat DEBUG] About to call api.postItemChatMessage with:', {
            recordId,
            userId: currentUser.id,
            userName: currentUser.name,
            messagePreview: message.substring(0, 50)
        });
        await api.postItemChatMessage(recordId, currentUser.id, currentUser.name, message);
        console.log('[ItemChat DEBUG] api.postItemChatMessage completed');
        channel.trigger('client-new-message-item', {
            content: message,
            senderId: currentUser.id,
            senderName: currentUser.name,
            timestamp: timestamp
        });
    } else {
        if (!sessionChatChannel || !currentUser) return;

        requestNotificationPermissionIfNeeded();
        const sessionId = state.session.id || 'default-session';
        const timestamp = new Date().toISOString();

        // Add to session history items
        sessionHistoryItems.push({
            type: 'chat',
            timestamp: timestamp,
            data: {
                sender: currentUser.name,
                message: message,
                isSent: true,
                timestamp: timestamp,
                senderId: currentUser.id
            }
        });

        // Only add to UI if chat filter is on
        if (historyFilters.chat) {
            const messagesList = document.getElementById('messages-list');
            addMessageToUI(messagesList, currentUser.name, message, true, timestamp, false, null, currentUser.id);
        }

        await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message);
        sessionChatChannel.trigger('client-new-message', {
            content: message,
            senderId: currentUser.id,
            senderName: currentUser.name,
            timestamp: timestamp
        });
    }
}

export async function initializeItemChat(recordId) {
    console.log('[ItemChat DEBUG] ========== initializeItemChat START ==========');
    console.log('[ItemChat DEBUG] recordId:', recordId);
    console.log('[ItemChat DEBUG] recordId type:', typeof recordId);
    console.log('[ItemChat DEBUG] recordId starts with "rec":', recordId?.startsWith?.('rec'));
    log('Chat', `Initializing item chat for recordId: ${recordId}`);

    // Wait for Pusher library to be loaded
    if (typeof window.waitForPusher === 'function') {
        try {
            await window.waitForPusher();
            log('Chat', 'Pusher library is now available for item chat');
        } catch (err) {
            console.error('[Chat] Failed to wait for Pusher for item chat:', err);
            return;
        }
    } else if (typeof Pusher === 'undefined') {
        console.error('[Chat] Pusher is not defined for item chat');
        return;
    }

    const chatContainer = document.getElementById('modal-chat-container');
    if (chatContainer) chatContainer.style.display = 'block';

    currentUser = getCurrentUser();
    console.log('[ItemChat DEBUG] currentUser:', JSON.stringify(currentUser));
    console.log('[ItemChat DEBUG] currentUser.id:', currentUser?.id);
    console.log('[ItemChat DEBUG] currentUser.name:', currentUser?.name);
    console.log('[ItemChat DEBUG] state.session.user:', JSON.stringify(state.session?.user));
    const messagesList = document.getElementById('messages-list-item');
    const messageForm = document.getElementById('message-form-item');
    const messageInput = document.getElementById('message-input-item');

    // Guard against missing elements
    if (!messagesList) {
        console.warn('Chat: messages-list-item element not found');
        return;
    }
    if (!messageForm || !messageForm.parentNode) {
        console.warn('Chat: message-form-item element not found or not in DOM');
        return;
    }

    messagesList.innerHTML = '';
    itemChatChannels.forEach((channel) => channel.unsubscribe());
    itemChatChannels.clear();
    console.log('[ItemChat DEBUG] About to call api.fetchItemChatMessages for recordId:', recordId);
    const records = await api.fetchItemChatMessages(recordId);
    console.log('[ItemChat DEBUG] api.fetchItemChatMessages returned records count:', records?.length);
    console.log('[ItemChat DEBUG] api.fetchItemChatMessages records:', JSON.stringify(records, null, 2));
    if (records.length === 0) {
        // Show empty state placeholder
        const emptyState = document.createElement('div');
        emptyState.className = 'item-chat-empty-state';
        emptyState.innerHTML = '<p>No messages yet. Start the conversation!</p>';
        messagesList.appendChild(emptyState);
    } else {
        console.log('[ItemChat DEBUG] Processing', records.length, 'messages for display');
        records.forEach((record, index) => {
            const { SenderID, SenderName, Content, Timestamp } = record.fields;
            const isSent = SenderID === currentUser.id;
            console.log(`[ItemChat DEBUG] Message ${index + 1}:`, {
                SenderID,
                SenderName,
                Content: Content?.substring(0, 50) + (Content?.length > 50 ? '...' : ''),
                Timestamp,
                isSent,
                currentUserId: currentUser.id
            });
            addMessageToUI(messagesList, SenderName, Content, isSent, Timestamp, false, null, SenderID);
        });
        console.log('[ItemChat DEBUG] Finished rendering all messages to UI');
    }
    const pusher = new Pusher('236f480714e5001590b5', {
        cluster: 'us3',
        authEndpoint: '/api/pusher-auth',
        auth: {
            params: {
                user_id: currentUser.id,
                user_name: currentUser.name
            }
        }

       });
    const channelName = `presence-item-${recordId}`;
    const channel = pusher.subscribe(channelName);
    itemChatChannels.set(recordId, channel);
    channel.bind('client-new-message-item', (data) => {
        if (data.senderId !== currentUser.id) {
            // Remove empty state placeholder if present
            const emptyState = messagesList.querySelector('.item-chat-empty-state');
            if (emptyState) {
                emptyState.remove();
            }
            addMessageToUI(messagesList, data.senderName, data.content, false, data.timestamp, false, null, data.senderId);
        }
    });
    const newForm = messageForm.cloneNode(true);
    messageForm.parentNode.replaceChild(newForm, messageForm);
    const newMessageInput = document.getElementById('message-input-item');
    newForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const message = newMessageInput.value;
        if (message.trim() === '') return;
        console.log('[ItemChat DEBUG] Sending message for recordId:', recordId);
        console.log('[ItemChat DEBUG] Message content:', message);
        sendMessage(message, recordId);
        newMessageInput.value = '';
    });
    console.log('[ItemChat DEBUG] ========== initializeItemChat END ==========');
}
export async function banUser(userId) {
    if (!state.session.user.isOwner) {
        log('Moderation', 'Permission denied: Not an owner.');
        return;
    }
    log('Moderation', `Banning user: ${userId}`);
    await api.banUser(userId);
}
export async function flagMessage(messageId) {
    if (!state.session.user.isOwner) {
        log('Moderation', 'Permission denied: Not an owner.');
        return;
    }
    log('Moderation', `Flagging message: ${messageId}`);
}

// --- RECENT CHATS FUNCTIONALITY ---

let recentChatsExpanded = false;

export async function loadRecentChats() {
    const currentUserData = getCurrentUser();
    if (!currentUserData || !currentUserData.id) {
        log('Chat', 'loadRecentChats: No current user available.');
        return;
    }

    const recentChatsList = document.getElementById('recent-chats-list');
    const loadingEl = document.getElementById('recent-chats-loading');

    if (loadingEl) {
        loadingEl.style.display = 'block';
        loadingEl.textContent = 'Loading recent chats...';
    }

    try {
        const chats = await api.fetchRecentChats(currentUserData.id, 10);
        state.session.recentChats = chats;

        renderRecentChatsList(chats);
    } catch (error) {
        console.error('Error loading recent chats:', error);
        if (loadingEl) {
            loadingEl.textContent = 'Failed to load recent chats';
        }
    }
}

function renderRecentChatsList(chats) {
    const recentChatsList = document.getElementById('recent-chats-list');
    const loadingEl = document.getElementById('recent-chats-loading');

    if (!recentChatsList) return;

    // Clear existing content
    recentChatsList.innerHTML = '';

    if (!chats || chats.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'recent-chat-empty';
        emptyEl.textContent = 'No recent chats';
        recentChatsList.appendChild(emptyEl);
        return;
    }

    chats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'recent-chat-item';
        chatItem.dataset.chatId = chat.id;
        chatItem.dataset.chatType = chat.type;

        const icon = chat.type === 'session' ? '💬' : '📦';
        const timeAgo = formatTimeAgo(chat.lastMessageTime);
        const truncatedMessage = chat.lastMessage.length > 30
            ? chat.lastMessage.substring(0, 30) + '...'
            : chat.lastMessage;

        chatItem.innerHTML = `
            <div class="recent-chat-icon">${icon}</div>
            <div class="recent-chat-content">
                <div class="recent-chat-name">${escapeHtml(chat.name)}</div>
                <div class="recent-chat-preview">${escapeHtml(truncatedMessage)}</div>
            </div>
            <div class="recent-chat-time">${timeAgo}</div>
        `;

        chatItem.addEventListener('click', () => handleRecentChatClick(chat));
        recentChatsList.appendChild(chatItem);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return '';

    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return time.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

async function handleRecentChatClick(chat) {
    log('Chat', `Clicked recent chat: ${chat.type} - ${chat.id}`);

    if (chat.type === 'item') {
        // For item chats, try to open the item detail modal
        // This requires integration with the modal system
        const record = state.records.all.find(r => r.id === chat.id);
        if (record && typeof window.openDetailModal === 'function') {
            window.openDetailModal(record);
        } else {
            // If we can't find the record or open modal, just log
            log('Chat', `Could not open detail modal for item ${chat.id}`);
            alert(`Item chat: ${chat.name}`);
        }
    } else if (chat.type === 'session') {
        // For session chats, open the session for collaborators
        log('Chat', `Opening session ${chat.id} from recent chats`);

        // Update URL with session parameter and clear view filters
        updateUrl({ session: chat.id, view: null, category: null, subcategory: null });

        // Load the session data (this will fire sessionReady event when complete)
        try {
            await api.loadSessionFromAirtable(chat.id);
            log('Chat', `Session ${chat.id} loaded successfully`);

            // Refresh the catalog view to show items instead of sessions list
            if (typeof window.applyFiltersAndSort === 'function' && window.imageCache) {
                window.applyFiltersAndSort(window.imageCache);
            }

            // Scroll to the messages after session loads
            const messagesContainer = document.getElementById('messages-container');
            if (messagesContainer) {
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
            }
        } catch (err) {
            console.error('Failed to load session from recent chat:', err);
            log('Chat', `Failed to load session ${chat.id}: ${err.message}`);
        }
    }

    // Collapse the recent chats list after selection
    toggleRecentChats(false);
}

export function toggleRecentChats(forceState = null) {
    const recentChatsList = document.getElementById('recent-chats-list');
    const toggleIcon = document.querySelector('#recent-chats-toggle .toggle-icon');

    if (!recentChatsList || !toggleIcon) return;

    if (forceState !== null) {
        recentChatsExpanded = forceState;
    } else {
        recentChatsExpanded = !recentChatsExpanded;
    }

    if (recentChatsExpanded) {
        recentChatsList.classList.remove('collapsed');
        toggleIcon.textContent = '▼';
        // Load chats when expanding
        loadRecentChats();
    } else {
        recentChatsList.classList.add('collapsed');
        toggleIcon.textContent = '▶';
    }
}

export function initializeRecentChatsListeners() {
    const toggleBtn = document.getElementById('recent-chats-toggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleRecentChats();
        });
    }
}

/**
 * Updates the current session's name in the recent chats list and chat header.
 * Called when the user renames the plan via the header-event-name input.
 * @param {string} newName - The new name for the current session/plan
 */
export function updateCurrentSessionName(newName) {
    const currentSessionId = state.session.id;
    if (!currentSessionId) {
        log('Chat', 'updateCurrentSessionName: No current session ID.');
        return;
    }

    // Update the chat header title
    const chatTitleEl = document.getElementById('chat-session-title');
    if (chatTitleEl) {
        chatTitleEl.textContent = newName || 'Session Chat';
        log('Chat', `Updated chat header title to: ${newName || 'Session Chat'}`);
    }

    // Update in state.session.recentChats array
    const chatIndex = state.session.recentChats.findIndex(
        chat => chat.id === currentSessionId && chat.type === 'session'
    );

    if (chatIndex !== -1) {
        state.session.recentChats[chatIndex].name = newName || 'Session Chat';
        log('Chat', `Updated session name in recentChats to: ${newName}`);

        // Re-render the list if it's currently expanded
        if (recentChatsExpanded) {
            renderRecentChatsList(state.session.recentChats);
        }
    }
}

/**
 * Refreshes the debug logs in the session history.
 * Call this when you want to update the view with new debug logs.
 */
export function refreshDebugLogs() {
    if (historyFilters.debug) {
        renderFilteredHistory();
    }
}

/**
 * Adds a new plan event to the session history in real-time.
 * Call this when a new plan event is posted to keep the history up to date.
 * @param {Object} record - The plan event record from the API
 */
export function addPlanEventToHistory(record) {
    const timestamp = record.fields?.Timestamp || new Date().toISOString();
    sessionHistoryItems.push({
        type: 'planEvent',
        timestamp: timestamp,
        data: record
    });

    // Re-render if plan events filter is on
    if (historyFilters.planEvents) {
        const messagesList = document.getElementById('messages-list');
        if (messagesList) {
            addEventToUI(messagesList, record);
        }
    }
}
