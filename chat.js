// REPLACE THE ENTIRE CONTENTS OF: chat.js

import { state, setState } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import { log } from './utils/debug.js';
import { triggerSave, openChatWidget } from './events.js';
import { updateUrl } from './utils.js';
import { getDebugLogs, isDebugPanelInitialized } from './utils/debug-panel.js';
import { refreshForumData, setGetCurrentUser, onNewItemReceived, updateNotificationBadges, initializeNotificationTracking } from './components/forumPanel.js';
import * as unifiedStream from './components/unifiedStream.js';
import { initializeToastNotifications, handlePusherEvent as handleToastPusherEvent } from './components/toastNotifications.js';
import { refreshUnifiedChatPanel, onUCPNewItem, updateUCPOnlineCount } from './components/unifiedChatPanel.js';
import { registerChatThread, registerRealtimeChatThread } from './components/planAtmosphere.js';

let currentUser = null;
let pusher = null;
let sessionChatChannel = null;
const FUN_ADJECTIVES = ['Happy', 'Clever', 'Sunny', 'Lucky', 'Creative', 'Brave', 'Sparkling', 'Cosmic', 'Witty', 'Zesty'];
const FUN_NOUNS = ['Panda', 'Wombat', 'Explorer', 'Starship', 'Juggler', 'Wizard', 'Dolphin', 'Robot', 'Pineapple', 'Comet'];
let isTabActive = true;

// Unified stream state
let showReactions = true;
let allTopicsExpanded = false;
let selectedComponent = null;

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
  document.title = document.title.replace(/^New (Message|Comment)! - /, '');
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
 * Initialize stream toggle controls (reactions, expand/collapse, view mode)
 * Sets up event listeners for the toggle buttons in chat header and forum header
 */
function initializeStreamToggles() {
    // Chat header toggle buttons
    const chatReactionsBtn = document.getElementById('stream-toggle-reactions');
    const chatExpandBtn = document.getElementById('stream-toggle-expand');
    const chatViewToggle = document.getElementById('stream-view-toggle');

    // Forum header toggle buttons
    const forumReactionsBtn = document.getElementById('forum-toggle-reactions');
    const forumExpandBtn = document.getElementById('forum-toggle-expand');

    // Toggle reactions visibility
    const handleReactionsToggle = () => {
        showReactions = !showReactions;
        // Update all reaction containers
        document.querySelectorAll('.message-reactions, .stream-reactions, .forum-reactions').forEach(el => {
            el.style.display = showReactions ? 'flex' : 'none';
        });
        // Update button states
        [chatReactionsBtn, forumReactionsBtn].forEach(btn => {
            if (btn) {
                btn.classList.toggle('active', showReactions);
                btn.setAttribute('aria-pressed', showReactions.toString());
                btn.title = showReactions ? 'Hide Reactions' : 'Show Reactions';
            }
        });
        log('Chat', `Reactions visibility toggled: ${showReactions}`);
    };

    // Toggle expand/collapse all
    const handleExpandToggle = () => {
        allTopicsExpanded = !allTopicsExpanded;
        // Expand/collapse all thread replies
        document.querySelectorAll('.thread-replies, .stream-replies, .forum-replies-container').forEach(el => {
            if (allTopicsExpanded) {
                el.classList.add('expanded');
            } else {
                el.classList.remove('expanded');
            }
        });
        // Update thread indicators
        document.querySelectorAll('.thread-indicator, .forum-thread-indicator').forEach(el => {
            if (allTopicsExpanded) {
                el.classList.add('expanded');
                const arrow = el.querySelector('.thread-arrow');
                if (arrow) arrow.textContent = '▼';
            } else {
                el.classList.remove('expanded');
                const arrow = el.querySelector('.thread-arrow');
                if (arrow) arrow.textContent = '▶';
            }
        });
        // Update button states
        [chatExpandBtn, forumExpandBtn].forEach(btn => {
            if (btn) {
                btn.classList.toggle('active', allTopicsExpanded);
                btn.setAttribute('aria-pressed', allTopicsExpanded.toString());
                btn.title = allTopicsExpanded ? 'Collapse All' : 'Expand All';
            }
        });
        log('Chat', `All topics ${allTopicsExpanded ? 'expanded' : 'collapsed'}`);
    };

    // Toggle view mode (compact/expanded)
    const handleViewToggle = () => {
        const chatWindow = document.getElementById('chat-window');
        if (!chatWindow) return;

        const isExpanded = chatWindow.classList.contains('stream-view-expanded');

        if (isExpanded) {
            chatWindow.classList.remove('stream-view-expanded');
            chatWindow.classList.add('stream-view-compact');
            if (chatViewToggle) {
                chatViewToggle.innerHTML = '<span>⛶</span>';
                chatViewToggle.title = 'Expand View';
            }
        } else {
            chatWindow.classList.remove('stream-view-compact');
            chatWindow.classList.add('stream-view-expanded');
            if (chatViewToggle) {
                chatViewToggle.innerHTML = '<span>⛶</span>';
                chatViewToggle.title = 'Compact View';
            }
        }
        log('Chat', `View mode toggled: ${isExpanded ? 'compact' : 'expanded'}`);
    };

    // Attach event listeners
    if (chatReactionsBtn) chatReactionsBtn.addEventListener('click', handleReactionsToggle);
    if (chatExpandBtn) chatExpandBtn.addEventListener('click', handleExpandToggle);
    if (chatViewToggle) chatViewToggle.addEventListener('click', handleViewToggle);
    if (forumReactionsBtn) forumReactionsBtn.addEventListener('click', handleReactionsToggle);
    if (forumExpandBtn) forumExpandBtn.addEventListener('click', handleExpandToggle);

    log('Chat', 'Stream toggle controls initialized');
}

/**
 * Initialize component selector for message affiliation
 * Populates the dropdown with plan items
 */
function initializeComponentSelector() {
    const chatSelector = document.getElementById('stream-component-select');
    const forumSelector = document.getElementById('forum-component-select');

    const populateSelector = (selector) => {
        if (!selector) return;

        // Clear existing options except the first one
        while (selector.options.length > 1) {
            selector.remove(1);
        }

        // Use plan items (locked items in the event plan) instead of full catalog
        // This ensures the "Attach to" dropdown only shows items relevant to the current plan
        const lockedItemIds = Array.from(state.cart.lockedItems.keys());
        log('Chat', `[DEBUG] Populating component selector - lockedItems count: ${lockedItemIds.length}, records.all count: ${state.records?.all?.length || 0}`);

        if (lockedItemIds.length > 0) {
            // Show plan items first
            lockedItemIds.forEach(recordId => {
                const record = state.records?.all?.find(r => r.id === recordId);
                if (record?.fields?.Name) {
                    const option = document.createElement('option');
                    option.value = record.id;
                    option.textContent = record.fields.Name;
                    selector.appendChild(option);
                }
            });
        } else {
            // Fallback: if no plan items exist yet, show all catalog items
            const allItems = state.records?.all || [];
            allItems.forEach(item => {
                if (item.fields?.Name) {
                    const option = document.createElement('option');
                    option.value = item.id;
                    option.textContent = item.fields.Name;
                    selector.appendChild(option);
                }
            });
        }
    };

    // Populate both selectors
    populateSelector(chatSelector);
    populateSelector(forumSelector);

    // Handle selection changes
    const handleSelectorChange = (e) => {
        selectedComponent = e.target.value || null;
        // Sync both selectors
        if (chatSelector) chatSelector.value = selectedComponent || '';
        if (forumSelector) forumSelector.value = selectedComponent || '';
        log('Chat', `[DEBUG] Component affiliation set to: ${selectedComponent || 'Plan-wide'}`);
    };

    if (chatSelector) chatSelector.addEventListener('change', handleSelectorChange);
    if (forumSelector) forumSelector.addEventListener('change', handleSelectorChange);

    // Show selector when there are plan items
    const chatSelectorContainer = document.getElementById('stream-component-selector');
    const lockedCount = state.cart.lockedItems.size;
    const allCount = state.records?.all?.length || 0;
    if (chatSelectorContainer && (lockedCount > 0 || allCount > 0)) {
        chatSelectorContainer.style.display = 'flex';
    }

    log('Chat', `Component selector initialized with ${lockedCount > 0 ? lockedCount + ' plan items' : allCount + ' catalog items (fallback)'}`);
}

/**
 * Get the currently selected component for message affiliation
 */
export function getSelectedComponent() {
    return selectedComponent;
}

/**
 * Set the selected component (for context-based default)
 */
export function setSelectedComponent(componentId) {
    selectedComponent = componentId;
    const chatSelector = document.getElementById('stream-component-select');
    const forumSelector = document.getElementById('forum-component-select');
    if (chatSelector) chatSelector.value = componentId || '';
    if (forumSelector) forumSelector.value = componentId || '';
}

// ===== CONTEXT MENU AND MARK UNREAD FEATURE =====

// Track unread messages
let unreadMessages = new Set();
let contextMenuTarget = null;

/**
 * Initialize context menu for messages
 * Provides actions: Reply, React, Mark Unread, Create Task, Copy Text
 */
function initializeContextMenu() {
    // Create context menu if it doesn't exist
    let menu = document.getElementById('message-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'message-context-menu';
        menu.className = 'stream-context-menu';
        menu.style.display = 'none';
        menu.innerHTML = `
            <button class="context-menu-item" data-action="reply">
                <span class="context-icon">↩</span> Reply
            </button>
            <button class="context-menu-item" data-action="react">
                <span class="context-icon">😊</span> Add Reaction
            </button>
            <hr class="context-divider">
            <button class="context-menu-item" data-action="mark-unread">
                <span class="context-icon">📬</span> Mark as Unread
            </button>
            <button class="context-menu-item" data-action="create-task">
                <span class="context-icon">✅</span> Create Task
            </button>
            <hr class="context-divider">
            <button class="context-menu-item" data-action="copy">
                <span class="context-icon">📋</span> Copy Text
            </button>
        `;
        document.body.appendChild(menu);
    }

    // Load unread messages from localStorage
    loadUnreadMessages();

    // Context menu trigger on right-click
    document.addEventListener('contextmenu', (e) => {
        const messageWrapper = e.target.closest('.message-wrapper, .forum-thread');
        if (messageWrapper) {
            e.preventDefault();
            showContextMenu(e, messageWrapper);
        }
    });

    // Hide context menu on click elsewhere
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.stream-context-menu')) {
            hideContextMenu();
        }
    });

    // Context menu action handler
    menu.addEventListener('click', (e) => {
        const action = e.target.closest('.context-menu-item')?.dataset.action;
        if (action && contextMenuTarget) {
            handleContextMenuAction(action);
        }
        hideContextMenu();
    });

    log('Chat', 'Context menu initialized');
}

/**
 * Show context menu at position
 */
function showContextMenu(e, target) {
    const menu = document.getElementById('message-context-menu');
    if (!menu) return;

    contextMenuTarget = target;
    const messageId = target.dataset.messageId;

    // Update mark unread text based on current state
    const markUnreadItem = menu.querySelector('[data-action="mark-unread"]');
    if (markUnreadItem && messageId) {
        const isUnread = unreadMessages.has(messageId);
        markUnreadItem.innerHTML = `<span class="context-icon">${isUnread ? '📭' : '📬'}</span> ${isUnread ? 'Mark as Read' : 'Mark as Unread'}`;
    }

    // Position menu
    menu.style.display = 'block';
    menu.style.left = `${e.pageX}px`;
    menu.style.top = `${e.pageY}px`;

    // Ensure menu stays in viewport
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = `${e.pageX - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = `${e.pageY - rect.height}px`;
    }
}

/**
 * Hide context menu
 */
function hideContextMenu() {
    const menu = document.getElementById('message-context-menu');
    if (menu) {
        menu.style.display = 'none';
    }
    contextMenuTarget = null;
}

/**
 * Handle context menu action
 */
async function handleContextMenuAction(action) {
    if (!contextMenuTarget) return;

    const messageId = contextMenuTarget.dataset.messageId;
    const messageContent = contextMenuTarget.querySelector('.message-content, .forum-message-content')?.textContent || '';
    const senderName = contextMenuTarget.querySelector('.sender, .forum-sender-name')?.textContent || 'Unknown';

    switch (action) {
        case 'reply':
            if (messageId) {
                startReply(messageId, senderName, messageContent);
            }
            break;

        case 'react':
            if (messageId) {
                showReactionPicker(contextMenuTarget, messageId, null);
            }
            break;

        case 'mark-unread':
            if (messageId) {
                toggleMessageUnread(messageId);
            }
            break;

        case 'create-task':
            await createTaskFromMessage(messageId, messageContent);
            break;

        case 'copy':
            copyMessageToClipboard(messageContent);
            break;
    }

    log('Chat', `Context menu action: ${action} on message ${messageId}`);
}

/**
 * Toggle message unread state
 */
export function toggleMessageUnread(messageId) {
    if (!messageId) return;

    if (unreadMessages.has(messageId)) {
        unreadMessages.delete(messageId);
    } else {
        unreadMessages.add(messageId);
    }

    saveUnreadMessages();
    updateMessageUnreadUI(messageId);
    updateUnreadBadge();

    log('Chat', `Message ${messageId} unread state: ${unreadMessages.has(messageId)}`);
}

/**
 * Mark message as unread
 */
export function markMessageUnread(messageId) {
    if (!messageId) return;

    unreadMessages.add(messageId);
    saveUnreadMessages();
    updateMessageUnreadUI(messageId);
    updateUnreadBadge();
}

/**
 * Mark message as read
 */
export function markMessageRead(messageId) {
    if (!messageId) return;

    unreadMessages.delete(messageId);
    saveUnreadMessages();
    updateMessageUnreadUI(messageId);
    updateUnreadBadge();
}

/**
 * Update message UI to show unread state
 */
function updateMessageUnreadUI(messageId) {
    const wrapper = document.querySelector(`[data-message-id="${messageId}"]`);
    if (wrapper) {
        wrapper.classList.toggle('unread', unreadMessages.has(messageId));
    }
}

/**
 * Update unread badge count
 */
function updateUnreadBadge() {
    const count = unreadMessages.size;

    // Update any unread badges
    const badges = document.querySelectorAll('.stream-unread-badge');
    badges.forEach(badge => {
        badge.textContent = count > 99 ? '99+' : count.toString();
        badge.style.display = count > 0 ? 'inline-flex' : 'none';
    });
}

/**
 * Load unread messages from localStorage
 */
function loadUnreadMessages() {
    const sessionId = state.session?.id;
    const userId = currentUser?.id;
    if (!sessionId || !userId) return;

    const key = `wtf_unread_${sessionId}_${userId}`;
    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            unreadMessages = new Set(JSON.parse(stored));
        }
    } catch (e) {
        log('Chat', 'Error loading unread messages:', e);
    }
}

/**
 * Save unread messages to localStorage
 */
function saveUnreadMessages() {
    const sessionId = state.session?.id;
    const userId = currentUser?.id;
    if (!sessionId || !userId) return;

    const key = `wtf_unread_${sessionId}_${userId}`;
    try {
        localStorage.setItem(key, JSON.stringify([...unreadMessages]));
    } catch (e) {
        log('Chat', 'Error saving unread messages:', e);
    }
}

/**
 * Create task from message content
 */
async function createTaskFromMessage(messageId, content) {
    if (!currentUser) {
        log('Chat', 'Cannot create task: no current user');
        return;
    }

    const projectId = state.session.id;
    if (!projectId) {
        log('Chat', 'Cannot create task: no active project');
        showToast('No active project', 'error');
        return;
    }

    try {
        // Find the message in session history
        const message = sessionHistoryItems.find(item =>
            item.type === 'chat' && item.data?.messageId === messageId
        );

        const componentId = message?.data?.componentInfo?.id || selectedComponent;
        const taskName = content.substring(0, 100) + (content.length > 100 ? '...' : '');
        const taskDescription = `From chat message: ${content}`;

        log('Chat', `Creating task from message: ${taskName}`);

        // Get max order for new task positioning
        const projectTasks = state.tasks.byProject.get(projectId) || [];
        const maxOrder = projectTasks.reduce((max, t) => Math.max(max, t.fields?.Order || 0), 0);

        const taskData = {
            Name: taskName,
            Description: taskDescription,
            Status: api.TASK_STATUS.PENDING,
            Order: maxOrder + 1
        };

        if (componentId && componentId.startsWith('rec')) {
            taskData.LinkedItem = componentId;
        }

        console.log('[Chat-TASK DEBUG] Creating task from message:', { messageId, taskName, projectId });

        const newTask = await api.createTask(projectId, taskData);
        if (newTask) {
            // Update local state
            state.tasks.all.set(newTask.id, newTask);
            const existingTasks = state.tasks.byProject.get(projectId) || [];
            state.tasks.byProject.set(projectId, [...existingTasks, newTask]);

            // Save comment-to-task link for persistence
            if (messageId) {
                const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
                linksObj[messageId] = newTask.id;
                state.eventDetails.combined.set('_commentTaskLinks', linksObj);

                if (!newTask.fields) newTask.fields = {};
                newTask.fields.SourceCommentId = messageId;

                triggerSave();
                console.log('[Chat-TASK DEBUG] Comment-task link saved:', { messageId, taskId: newTask.id });
            }

            showToast(`Task created: "${taskName.substring(0, 30)}${taskName.length > 30 ? '...' : ''}"`);
            log('Chat', `Task created from message: ${newTask.id}`);
        } else {
            throw new Error('API returned null');
        }

    } catch (error) {
        log('Chat', `Error creating task: ${error.message}`);
        console.error('[Chat-TASK DEBUG] Error creating task:', error);
        showToast('Failed to create task', 'error');
    }
}

/**
 * Copy message text to clipboard
 */
function copyMessageToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Text copied to clipboard');
    }).catch(err => {
        log('Chat', 'Failed to copy text:', err);
        showToast('Failed to copy text', 'error');
    });
}

/**
 * Show a toast notification
 */
function showToast(message, type = 'success') {
    let toast = document.querySelector('.stream-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.className = 'stream-toast';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = `stream-toast ${type} visible`;

    setTimeout(() => {
        toast.classList.remove('visible');
    }, 3000);
}

// ===== END CONTEXT MENU AND MARK UNREAD FEATURE =====

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

    // Empty state removed - chat window starts clean without placeholder text

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
        const { sender, message, isSent, timestamp, senderId, messageId, reactions, isEdited, isDeleted, replyCount, parentMessageId, componentInfo } = item.data;
        addMessageToUI(messagesList, sender, message, isSent, timestamp, false, messageId, senderId, {
            reactions: reactions || {},
            isEdited: isEdited || false,
            isDeleted: isDeleted || false,
            replyCount: replyCount || 0,
            parentMessageId: parentMessageId || null,
            componentInfo: componentInfo || null // Pass component info for @component tags
        });
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
    // console.log('[ItemChat DEBUG] getSimpleUserIdentity called');
    // console.log('[ItemChat DEBUG] authenticatedUser:', JSON.stringify(authenticatedUser));
    // console.log('[ItemChat DEBUG] authenticatedUser.isAuthenticated:', authenticatedUser?.isAuthenticated);
    if (authenticatedUser && authenticatedUser.isAuthenticated) {
        // User is authenticated - always use their real ID and name
        // Update cached user if it doesn't match (e.g., user logged in after initial load)
        if (!currentUser || currentUser.id !== authenticatedUser.id) {
            currentUser = { id: authenticatedUser.id, name: authenticatedUser.name };
            log('Chat', `Updated currentUser to authenticated user: ${authenticatedUser.id}`);
            // console.log('[ItemChat DEBUG] Returning authenticated user:', JSON.stringify(currentUser));
        }
        return currentUser;
    }

    // User is not authenticated - use localStorage-based identity
    // console.log('[ItemChat DEBUG] User not authenticated, using localStorage identity');
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
    // Update unified chat panel online count
    updateUCPOnlineCount(count);

    // Update presence avatar bar (near chat toggle)
    updatePresenceAvatarBar(members);

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
 * Role-based color mapping for presence avatars
 */
const ROLE_COLORS = {
    owner: '#764ba2',   // Purple
    editor: '#667eea',  // Blue
    viewer: '#6c757d'   // Gray
};

/**
 * Get initials from a display name (up to 2 characters)
 */
function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

/**
 * Update the presence avatar bar in the catalog view (near chat toggle)
 */
function updatePresenceAvatarBar(members) {
    const container = document.getElementById('presence-avatar-bar');
    if (!container) return;

    container.innerHTML = '';
    const MAX_AVATARS = 5;
    const memberList = [];
    members.each((member) => memberList.push(member));

    const visibleMembers = memberList.slice(0, MAX_AVATARS);
    const overflowCount = memberList.length - MAX_AVATARS;

    visibleMembers.forEach((member) => {
        const displayName = member.id === currentUser.id ? currentUser.name : member.info.name;
        const role = member.info?.role || 'viewer';
        const color = ROLE_COLORS[role] || ROLE_COLORS.viewer;
        const initials = getInitials(displayName);
        const isYou = member.id === currentUser.id;

        const avatar = document.createElement('div');
        avatar.className = 'presence-avatar';
        avatar.style.backgroundColor = color;
        avatar.textContent = initials;
        avatar.title = `${displayName}${isYou ? ' (You)' : ''} — ${role}`;
        avatar.setAttribute('data-member-id', member.id);
        container.appendChild(avatar);
    });

    if (overflowCount > 0) {
        const overflow = document.createElement('div');
        overflow.className = 'presence-avatar presence-avatar-overflow';
        overflow.textContent = `+${overflowCount}`;
        overflow.title = `${overflowCount} more online`;
        container.appendChild(overflow);
    }

    // Show/hide the bar based on member count
    container.style.display = memberList.length > 0 ? 'flex' : 'none';
}

// Export for use in other modules
export { updatePresenceAvatarBar, ROLE_COLORS, getInitials };

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

// Quick emoji reactions available for messages
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

// Track message being replied to
let replyingToMessage = null;

// Track message being edited
let editingMessage = null;

/**
 * Enhanced addMessageToUI with reactions, edit/delete, thread support, and component tags
 */
function addMessageToUI(messagesList, sender, message, isSent, timestamp, isAdmin, messageId, senderId, options = {}) {
    const { reactions = {}, isEdited = false, isDeleted = false, replyCount = 0, parentMessageId = null, isReply = false, componentInfo = null } = options;

    // Skip deleted messages
    if (isDeleted) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'} deleted-message`;
        wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;
        messagesList.appendChild(wrapper);
        return wrapper;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}${isReply ? ' is-reply' : ''}${componentInfo ? ' component-comment-msg' : ''}`;
    if (messageId) wrapper.dataset.messageId = messageId;
    if (componentInfo) wrapper.dataset.componentId = componentInfo.id;

    const messageElement = document.createElement('div');
    const isFlagged = state.session.flaggedUsers.has(senderId);
    const isBanned = state.session.bannedUsers.has(senderId);
    const displayMessage = (isFlagged || isBanned) ? '[CENSORED BY MODERATOR]' : message;
    messageElement.className = 'chat-message';
    if (isBanned) messageElement.classList.add('banned');
    if (isFlagged) messageElement.classList.add('flagged');

    // Component tag (shown before sender for component comments)
    if (componentInfo) {
        const componentTag = document.createElement('div');
        componentTag.className = 'component-tag';
        componentTag.innerHTML = `<span class="component-tag-icon">📍</span><span class="component-tag-name">@${escapeHtml(componentInfo.name)}</span>`;
        componentTag.title = `Comment on: ${componentInfo.name}`;
        messageElement.appendChild(componentTag);
    }

    // Create inline header with sender name and timestamp
    const headerRow = document.createElement('div');
    headerRow.className = 'message-header';

    // Sender name (inline)
    const senderElement = document.createElement('span');
    senderElement.className = 'sender';
    senderElement.innerText = isSent ? 'You' : sender;
    headerRow.appendChild(senderElement);

    // Timestamp (inline with sender)
    const timestampElement = document.createElement('span');
    timestampElement.className = 'timestamp';
    const date = timestamp ? new Date(timestamp) : new Date();
    timestampElement.innerText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    headerRow.appendChild(timestampElement);

    messageElement.appendChild(headerRow);

    // Message content container
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    contentElement.textContent = displayMessage;

    // Edited indicator
    if (isEdited) {
        const editedIndicator = document.createElement('span');
        editedIndicator.className = 'edited-indicator';
        editedIndicator.textContent = ' (edited)';
        contentElement.appendChild(editedIndicator);
    }

    messageElement.appendChild(contentElement);

    // --- Message Actions (hover menu) ---
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'message-actions';

    // Reaction button
    const reactionBtn = document.createElement('button');
    reactionBtn.className = 'msg-action-btn reaction-btn';
    reactionBtn.innerHTML = '😀';
    reactionBtn.title = 'Add reaction';
    reactionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showReactionPicker(wrapper, messageId, senderId);
    });
    actionsContainer.appendChild(reactionBtn);

    // Reply button (only for messages with valid IDs - not for newly sent messages that haven't been saved yet)
    if (messageId && messageId.startsWith && messageId.startsWith('rec')) {
        const replyBtn = document.createElement('button');
        replyBtn.className = 'msg-action-btn reply-btn';
        replyBtn.innerHTML = '↩';
        replyBtn.title = 'Reply';
        replyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startReply(messageId, sender, message);
        });
        actionsContainer.appendChild(replyBtn);
    }

    // Edit button (only for own messages)
    if (isSent && messageId) {
        const editBtn = document.createElement('button');
        editBtn.className = 'msg-action-btn edit-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = 'Edit message';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startEdit(messageId, message, wrapper);
        });
        actionsContainer.appendChild(editBtn);
    }

    // Delete button (only for own messages)
    if (isSent && messageId) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'msg-action-btn delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete message';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDelete(messageId, wrapper);
        });
        actionsContainer.appendChild(deleteBtn);
    }

    // Moderation actions for owner (on others' messages)
    if (state.session.user.isOwner && !isSent) {
        const flagBtn = document.createElement('button');
        flagBtn.className = 'msg-action-btn flag-btn';
        flagBtn.innerHTML = isFlagged ? '✅' : '⚠️';
        flagBtn.title = isFlagged ? 'Un-flag user' : 'Flag user';
        flagBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isFlagged) {
                state.session.flaggedUsers.delete(senderId);
            } else {
                state.session.flaggedUsers.add(senderId);
            }
            await api.updateUserFlagStatus(senderId, !isFlagged);
        });
        actionsContainer.appendChild(flagBtn);

        const banBtn = document.createElement('button');
        banBtn.className = 'msg-action-btn ban-btn';
        banBtn.innerHTML = '⛔';
        banBtn.title = 'Ban user';
        banBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await api.banUser(senderId);
        });
        actionsContainer.appendChild(banBtn);
    }

    messageElement.appendChild(actionsContainer);

    // --- Reactions Display ---
    if (reactions && Object.keys(reactions).length > 0) {
        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'message-reactions';

        for (const [emoji, users] of Object.entries(reactions)) {
            if (users.length > 0) {
                const reactionBadge = document.createElement('button');
                reactionBadge.className = 'reaction-badge';
                const hasUserReacted = users.includes(currentUser?.id);
                if (hasUserReacted) reactionBadge.classList.add('user-reacted');
                reactionBadge.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
                reactionBadge.title = users.length === 1 ? '1 reaction' : `${users.length} reactions`;
                reactionBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleReaction(messageId, emoji, !hasUserReacted, wrapper);
                });
                reactionsContainer.appendChild(reactionBadge);
            }
        }

        messageElement.appendChild(reactionsContainer);
    }

    // --- Thread indicator ---
    if (replyCount > 0) {
        const threadIndicator = document.createElement('button');
        threadIndicator.className = 'thread-indicator';
        threadIndicator.innerHTML = `↳ ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`;
        threadIndicator.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleThreadView(messageId, wrapper);
        });
        messageElement.appendChild(threadIndicator);
    }

    wrapper.appendChild(messageElement);
    messagesList.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth' });

    return wrapper;
}

/**
 * Shows the emoji reaction picker near a message
 */
function showReactionPicker(wrapper, messageId, senderId) {
    // Remove any existing picker
    document.querySelectorAll('.reaction-picker').forEach(p => p.remove());

    // Find the reaction button to position near it
    const reactionBtn = wrapper.querySelector('.msg-action-btn.reaction-btn');
    if (!reactionBtn) return;

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';

    QUICK_REACTIONS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'reaction-picker-btn';
        btn.textContent = emoji;
        btn.addEventListener('click', async () => {
            picker.remove();
            await toggleReaction(messageId, emoji, true, wrapper);
        });
        picker.appendChild(btn);
    });

    // Append to body to avoid overflow clipping issues
    document.body.appendChild(picker);

    // Position the picker near the reaction button
    const rect = reactionBtn.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.zIndex = '10001';

    // Position above the button if there's room, otherwise below
    const pickerHeight = 50; // Approximate height
    if (rect.top > pickerHeight + 10) {
        picker.style.top = `${rect.top - pickerHeight - 8}px`;
    } else {
        picker.style.top = `${rect.bottom + 8}px`;
    }
    picker.style.left = `${Math.max(10, rect.left - 50)}px`;

    // Close picker when clicking elsewhere
    const closePicker = (e) => {
        if (!picker.contains(e.target)) {
            picker.remove();
            document.removeEventListener('click', closePicker);
        }
    };
    setTimeout(() => document.addEventListener('click', closePicker), 0);
}

/**
 * Toggles a reaction on a message
 */
async function toggleReaction(messageId, emoji, add, wrapper) {
    if (!messageId || !currentUser) return;

    const result = await api.toggleMessageReaction(messageId, currentUser.id, emoji, add);
    if (result !== null) {
        // Update the reactions display
        updateReactionsDisplay(wrapper, result);

        // Broadcast via Pusher if available
        if (sessionChatChannel) {
            sessionChatChannel.trigger('client-reaction-update', {
                messageId,
                reactions: result,
                userId: currentUser.id
            });
        }
    }
}

/**
 * Updates the reactions display on a message wrapper
 */
function updateReactionsDisplay(wrapper, reactions) {
    const messageElement = wrapper.querySelector('.chat-message');
    if (!messageElement) return;

    // Remove existing reactions container
    const existingReactions = messageElement.querySelector('.message-reactions');
    if (existingReactions) existingReactions.remove();

    // Add new reactions if any exist
    if (reactions && Object.keys(reactions).length > 0) {
        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'message-reactions';

        for (const [emoji, users] of Object.entries(reactions)) {
            if (users.length > 0) {
                const reactionBadge = document.createElement('button');
                reactionBadge.className = 'reaction-badge';
                const hasUserReacted = users.includes(currentUser?.id);
                if (hasUserReacted) reactionBadge.classList.add('user-reacted');
                reactionBadge.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
                const messageId = wrapper.dataset.messageId;
                reactionBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleReaction(messageId, emoji, !hasUserReacted, wrapper);
                });
                reactionsContainer.appendChild(reactionBadge);
            }
        }

        // Insert before thread indicator or at end
        const threadIndicator = messageElement.querySelector('.thread-indicator');
        if (threadIndicator) {
            messageElement.insertBefore(reactionsContainer, threadIndicator);
        } else {
            messageElement.appendChild(reactionsContainer);
        }
    }
}

/**
 * Starts replying to a message
 */
function startReply(messageId, senderName, messagePreview) {
    replyingToMessage = { id: messageId, sender: senderName, preview: messagePreview };

    // Show reply indicator in the input area
    const formContainer = document.getElementById('message-form') || document.getElementById('message-form-item');
    if (!formContainer) return;

    // Remove existing reply indicator
    const existingIndicator = formContainer.parentElement.querySelector('.reply-indicator');
    if (existingIndicator) existingIndicator.remove();

    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'reply-indicator';
    replyIndicator.innerHTML = `
        <span class="reply-indicator-text">Replying to <strong>${escapeHtml(senderName)}</strong>: ${escapeHtml(messagePreview.substring(0, 50))}${messagePreview.length > 50 ? '...' : ''}</span>
        <button class="cancel-reply-btn" type="button">✕</button>
    `;

    replyIndicator.querySelector('.cancel-reply-btn').addEventListener('click', cancelReply);
    formContainer.parentElement.insertBefore(replyIndicator, formContainer);

    // Focus the input
    const input = formContainer.querySelector('input[type="text"]');
    if (input) input.focus();
}

/**
 * Cancels the current reply
 */
function cancelReply() {
    replyingToMessage = null;
    document.querySelectorAll('.reply-indicator').forEach(el => el.remove());
}

/**
 * Starts editing a message
 */
function startEdit(messageId, currentContent, wrapper) {
    editingMessage = { id: messageId, originalContent: currentContent };

    const contentElement = wrapper.querySelector('.message-content');
    if (!contentElement) return;

    // Replace content with input
    const originalText = currentContent;
    contentElement.innerHTML = `
        <input type="text" class="edit-message-input" value="${escapeHtml(originalText)}">
        <div class="edit-actions">
            <button class="save-edit-btn" type="button">Save</button>
            <button class="cancel-edit-btn" type="button">Cancel</button>
        </div>
    `;

    const input = contentElement.querySelector('.edit-message-input');
    const saveBtn = contentElement.querySelector('.save-edit-btn');
    const cancelBtn = contentElement.querySelector('.cancel-edit-btn');

    input.focus();
    input.select();

    const saveEdit = async () => {
        const newContent = input.value.trim();
        if (newContent && newContent !== originalText) {
            const result = await api.updateChatMessage(messageId, newContent, currentUser.id);
            if (result) {
                contentElement.innerHTML = '';
                contentElement.textContent = newContent;
                const editedIndicator = document.createElement('span');
                editedIndicator.className = 'edited-indicator';
                editedIndicator.textContent = ' (edited)';
                contentElement.appendChild(editedIndicator);

                // Broadcast edit via Pusher
                if (sessionChatChannel) {
                    sessionChatChannel.trigger('client-message-edited', {
                        messageId,
                        newContent,
                        userId: currentUser.id
                    });
                }
            }
        } else {
            cancelEditMode();
        }
        editingMessage = null;
    };

    const cancelEditMode = () => {
        contentElement.innerHTML = '';
        contentElement.textContent = originalText;
        editingMessage = null;
    };

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEditMode);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') cancelEditMode();
    });
}

/**
 * Confirms and deletes a message
 */
async function confirmDelete(messageId, wrapper) {
    if (!confirm('Delete this message? This cannot be undone.')) return;

    const result = await api.deleteChatMessage(messageId, currentUser.id);
    if (result) {
        wrapper.classList.add('deleted-message');
        wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;

        // Broadcast delete via Pusher
        if (sessionChatChannel) {
            sessionChatChannel.trigger('client-message-deleted', {
                messageId,
                userId: currentUser.id
            });
        }
    }
}

/**
 * Toggles the thread view for a message
 */
async function toggleThreadView(messageId, wrapper) {
    const existingThread = wrapper.querySelector('.thread-replies');
    if (existingThread) {
        existingThread.remove();
        return;
    }

    const replies = await api.fetchMessageReplies(messageId);
    if (replies.length === 0) return;

    const threadContainer = document.createElement('div');
    threadContainer.className = 'thread-replies';

    replies.forEach(reply => {
        const { SenderID, SenderName, Content, Timestamp, IsEdited, IsDeleted, Reactions } = reply.fields;
        const isSent = SenderID === currentUser?.id;
        let parsedReactions = {};
        if (Reactions) {
            try { parsedReactions = JSON.parse(Reactions); } catch (e) {}
        }

        const replyWrapper = document.createElement('div');
        replyWrapper.className = `reply-message ${isSent ? 'sent' : 'received'}`;
        replyWrapper.dataset.messageId = reply.id;

        if (IsDeleted) {
            replyWrapper.innerHTML = `<em class="deleted-reply">This reply was deleted</em>`;
        } else {
            replyWrapper.innerHTML = `
                <span class="reply-sender">${isSent ? 'You' : escapeHtml(SenderName)}</span>
                <span class="reply-content">${escapeHtml(Content)}${IsEdited ? ' <em class="edited-indicator">(edited)</em>' : ''}</span>
                <span class="reply-time">${new Date(Timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            `;
        }

        threadContainer.appendChild(replyWrapper);
    });

    wrapper.appendChild(threadContainer);
}

/**
 * Gets the current reply target (if replying)
 */
export function getReplyingToMessage() {
    return replyingToMessage;
}

/**
 * Clears reply state after sending
 */
export function clearReplyState() {
    cancelReply();
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
        // Show toast when someone joins
        handleToastPusherEvent('member-joined', {
            name: member?.info?.name || 'Someone',
            userId: member?.id
        });
        // Notify activity log of new collaborator joining
        onNewItemReceived('event', { timestamp: new Date().toISOString(), sessionHistoryItems });
    });
    sessionChatChannel.bind('pusher:member_removed', (member) => {
        updatePresenceUI(sessionChatChannel.members);
    });
}
export function getCurrentUser() {
    // Always call getSimpleUserIdentity to ensure authentication status is checked
    return getSimpleUserIdentity();
}

// Initialize forum panel with getCurrentUser reference to avoid circular dependency
setGetCurrentUser(getCurrentUser);

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

    // Initialize toast notification system
    initializeToastNotifications({ getCurrentUser: () => currentUser });

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

    // Initialize stream toggle controls (reactions, expand/collapse, view mode)
    initializeStreamToggles();

    // Initialize component selector for message affiliation
    initializeComponentSelector();

    // Initialize unified stream context menu
    initializeContextMenu();

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

        // Count replies per message for thread indicators
        const replyCountMap = {};
        records.forEach(record => {
            const parentId = record.fields.ParentMessageID;
            if (parentId) {
                replyCountMap[parentId] = (replyCountMap[parentId] || 0) + 1;
            }
        });

        if (records.length > 0) {
            let eventCount = 0;
            let messageCount = 0;

            records.forEach(record => {
                const { SenderID, SenderName, Content, Timestamp, EventType, Reactions, IsEdited, IsDeleted, ParentMessageID } = record.fields;
                const itemLink = record.fields['Item Link']; // Array of linked item IDs (for component comments)

                // Use createdTime from record level, fall back to fields.Timestamp
                const recordTimestamp = record.createdTime || Timestamp || new Date().toISOString();

                // Skip reply messages (they're shown in threads)
                if (ParentMessageID) return;

                // Check if this is a system event (plan history)
                if (SenderID === 'system' && EventType) {
                    // Store in sessionHistoryItems for filtering
                    sessionHistoryItems.push({
                        type: 'planEvent',
                        timestamp: recordTimestamp,
                        data: record
                    });
                    eventCount++;
                } else {
                    // Regular chat message - store in sessionHistoryItems with enhanced data
                    const isSent = SenderID === currentUser.id;
                    let parsedReactions = {};
                    if (Reactions) {
                        try { parsedReactions = JSON.parse(Reactions); } catch (e) {}
                    }

                    // Get component name if this is a component comment (has Item Link)
                    let componentInfo = null;
                    let displayContent = Content;
                    if (itemLink && itemLink.length > 0) {
                        const componentId = itemLink[0];
                        const componentRecord = state.records.all.find(r => r.id === componentId);
                        componentInfo = {
                            id: componentId,
                            name: componentRecord?.fields?.Name || 'Unknown Item'
                        };
                    }

                    // Also check for [PLAN_COMMENT:item:ID] prefix (for custom/non-rec item IDs)
                    if (!componentInfo && Content) {
                        const planCommentMatch = Content.match(/^\[PLAN_COMMENT:item:([^\]]+)\]\s*/);
                        if (planCommentMatch) {
                            const customItemId = planCommentMatch[1];
                            const componentRecord = state.records.all.find(r => r.id === customItemId);
                            componentInfo = {
                                id: customItemId,
                                name: componentRecord?.fields?.Name || 'Unknown Item'
                            };
                            displayContent = Content.replace(/^\[PLAN_COMMENT:item:[^\]]+\]\s*/, '');
                        }
                    }

                    sessionHistoryItems.push({
                        type: 'chat',
                        timestamp: recordTimestamp,
                        data: {
                            sender: SenderName,
                            message: displayContent,
                            isSent,
                            timestamp: recordTimestamp,
                            senderId: SenderID,
                            messageId: record.id,
                            reactions: parsedReactions,
                            isEdited: IsEdited || false,
                            isDeleted: IsDeleted || false,
                            replyCount: replyCountMap[record.id] || 0,
                            parentMessageId: null,
                            componentInfo // Include component info for @component tags
                        }
                    });
                    messageCount++;
                }
            });

            log('Chat', `Loaded ${eventCount} plan events and ${messageCount} messages into session history`);
        }

        // Render the filtered history
        renderFilteredHistory();

        // Initialize notification tracking early (before forum panel is opened)
        // This sets baseline timestamps for first-time visitors
        initializeNotificationTracking();

        // Update forum panel notification badges after loading chat history
        // Pass the loaded messages and events so badge counts work before forum panel is opened
        const chatMessages = sessionHistoryItems.filter(item => item.type === 'chat');
        const planEvents = sessionHistoryItems.filter(item => item.type === 'planEvent');
        updateNotificationBadges({ messages: chatMessages, events: planEvents });
    }

    pusher = new Pusher('236f480714e5001590b5', {
        cluster: 'us3',
        authEndpoint: '/api/pusher-auth',
        auth: {
            params: {
                user_id: currentUser.id,
                user_name: currentUser.name,
                user_role: state.session.permissions?.currentRole || 'viewer'
           }
        }
    });
    const channelName = `presence-session-${sessionId}`;
    sessionChatChannel = pusher.subscribe(channelName);
    bindPresenceEvents();
    sessionChatChannel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            // A collaborator opening a new conversation is an open component of the plan, so
            // the background should move now rather than on the next load.
            registerRealtimeChatThread(state.session.id, data.content, data.componentInfo?.id || null);
            requestNotificationPermissionIfNeeded();
            // Add to session history items
            const timestamp = data.timestamp || new Date().toISOString();

            // Parse [PLAN_COMMENT:item:ID] prefix from real-time messages
            let realtimeContent = data.content;
            let realtimeComponentInfo = data.componentInfo || null;
            if (!realtimeComponentInfo && realtimeContent) {
                const planCommentMatch = realtimeContent.match(/^\[PLAN_COMMENT:item:([^\]]+)\]\s*/);
                if (planCommentMatch) {
                    const customItemId = planCommentMatch[1];
                    const componentRecord = state.records.all.find(r => r.id === customItemId);
                    realtimeComponentInfo = {
                        id: customItemId,
                        name: componentRecord?.fields?.Name || 'Unknown Item'
                    };
                    realtimeContent = realtimeContent.replace(/^\[PLAN_COMMENT:item:[^\]]+\]\s*/, '');
                }
            }

            const messageData = {
                type: 'chat',
                timestamp: timestamp,
                data: {
                    sender: data.senderName,
                    message: realtimeContent,
                    isSent: false,
                    timestamp: timestamp,
                    senderId: data.senderId,
                    messageId: data.messageId,
                    reactions: {},
                    isEdited: false,
                    isDeleted: false,
                    replyCount: 0,
                    componentInfo: realtimeComponentInfo
                }
            };
            sessionHistoryItems.push(messageData);
            // Append to UI directly (without re-rendering entire list to avoid duplicates)
            if (historyFilters.chat) {
                const messagesList = document.getElementById('messages-list');
                if (messagesList) {
                    renderHistoryItem(messagesList, messageData);
                }
            }
            // Refresh forum panel if open
            refreshForumData();
            // Refresh unified chat panel
            refreshUnifiedChatPanel();
            // Update notification counts for new message
            onNewItemReceived('message', { timestamp, sessionHistoryItems });
            showNewMessageNotification(data.senderName, realtimeContent);
            // Show toast notification
            const isIdea = (realtimeContent || '').startsWith('[IDEA]');
            handleToastPusherEvent('new-message', {
                sender: data.senderName,
                message: isIdea ? realtimeContent.replace(/^\[IDEA\]\s*/, '') : realtimeContent,
                senderId: data.senderId,
                isIdea: isIdea
            });
            if (!isTabActive) {
                document.title = 'New Message! - ' + document.title.replace(/^New (Message|Comment)! - /, '');
            }
        }
    });

    // Handle real-time reaction updates from other users
    sessionChatChannel.bind('client-reaction-update', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                updateReactionsDisplay(wrapper, data.reactions);
            }
            // Refresh forum panel if open to show updated reactions
            refreshForumData();
            // Refresh unified chat panel for reaction updates
            refreshUnifiedChatPanel();
            // Update notification counts for new reaction
            onNewItemReceived('reaction', { timestamp: new Date().toISOString(), sessionHistoryItems });
        }
    });

    // Handle real-time message edits from other users
    sessionChatChannel.bind('client-message-edited', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                const contentElement = wrapper.querySelector('.message-content');
                if (contentElement) {
                    contentElement.textContent = data.newContent;
                    if (!contentElement.querySelector('.edited-indicator')) {
                        const editedIndicator = document.createElement('span');
                        editedIndicator.className = 'edited-indicator';
                        editedIndicator.textContent = ' (edited)';
                        contentElement.appendChild(editedIndicator);
                    }
                }
            }
            // Refresh forum panel if open to show edited message
            refreshForumData();
            // Refresh unified chat panel
            refreshUnifiedChatPanel();
        }
    });

    // Handle real-time message deletes from other users
    sessionChatChannel.bind('client-message-deleted', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = document.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                wrapper.classList.add('deleted-message');
                wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;
            }
            // Refresh forum panel if open to show deleted message
            refreshForumData();
            // Refresh unified chat panel
            refreshUnifiedChatPanel();
        }
    });

    // Handle real-time replies from other users
    sessionChatChannel.bind('client-new-reply', (data) => {
        if (data.senderId !== currentUser.id) {
            const parentWrapper = document.querySelector(`[data-message-id="${data.parentMessageId}"]`);
            if (parentWrapper) {
                const existingIndicator = parentWrapper.querySelector('.thread-indicator');
                if (existingIndicator) {
                    const currentCount = parseInt(existingIndicator.textContent.match(/\d+/)?.[0] || '0');
                    existingIndicator.innerHTML = `↳ ${currentCount + 1} ${currentCount + 1 === 1 ? 'reply' : 'replies'}`;
                } else {
                    const threadIndicator = document.createElement('button');
                    threadIndicator.className = 'thread-indicator';
                    threadIndicator.innerHTML = `↳ 1 reply`;
                    threadIndicator.addEventListener('click', (e) => {
                        e.stopPropagation();
                        toggleThreadView(data.parentMessageId, parentWrapper);
                    });
                    parentWrapper.querySelector('.chat-message')?.appendChild(threadIndicator);
                }
            }
            // Refresh forum panel if open to show new replies
            refreshForumData();
            // Refresh unified chat panel
            refreshUnifiedChatPanel();
            // Update notification counts for new reply
            onNewItemReceived('reply', { timestamp: new Date().toISOString(), sessionHistoryItems });
        }
    });

    // Handle real-time component comments from other users
    sessionChatChannel.bind('client-component-comment', (data) => {
        if (data.senderId !== currentUser.id && data.comment) {
            registerChatThread(state.session.id, data.comment.fields);
            const componentId = data.componentId;
            const componentRecord = state.records.all.find(r => r.id === componentId);
            const componentInfo = {
                id: componentId,
                name: componentRecord?.fields?.Name || 'Unknown Item'
            };

            // Use createdTime from record level, fall back to fields.Timestamp
            const timestamp = data.comment.createdTime || data.comment.fields?.Timestamp || new Date().toISOString();

            // Add to session history items
            const commentData = {
                type: 'chat',
                timestamp: timestamp,
                data: {
                    sender: data.comment.fields?.SenderName || 'Unknown',
                    message: data.comment.fields?.Content || '',
                    isSent: false,
                    timestamp: timestamp,
                    senderId: data.senderId,
                    messageId: data.comment.id,
                    reactions: {},
                    isEdited: false,
                    isDeleted: false,
                    replyCount: 0,
                    componentInfo
                }
            };
            sessionHistoryItems.push(commentData);

            // Append to UI directly (without re-rendering entire list to avoid duplicates)
            if (historyFilters.chat) {
                const messagesList = document.getElementById('messages-list');
                if (messagesList) {
                    renderHistoryItem(messagesList, commentData);
                }
            }

            showNewMessageNotification(data.comment.fields?.SenderName || 'Unknown', `@${componentInfo.name}: ${data.comment.fields?.Content || ''}`);
            if (!isTabActive) {
                document.title = 'New Comment! - ' + document.title.replace(/^New (Message|Comment)! - /, '');
            }

            // Refresh forum panel if open to show new component comments
            refreshForumData();
            // Refresh unified chat panel
            refreshUnifiedChatPanel();
            // Update notification counts for new component comment
            onNewItemReceived('comment', { timestamp, sessionHistoryItems });

            log('Chat', `Received component comment from ${data.senderId} on ${componentId}`);
        }
    });
}

export async function sendMessage(message, recordId = null) {
    if (!sessionChatChannel || !currentUser) return;

    requestNotificationPermissionIfNeeded();
    const sessionId = state.session.id || 'default-session';
    const timestamp = new Date().toISOString();

    // Get component affiliation (from parameter, selector, or null for plan-wide)
    const componentId = recordId || selectedComponent || null;
    let componentInfo = null;
    if (componentId) {
        const componentRecord = state.records?.all?.find(r => r.id === componentId);
        if (componentRecord) {
            componentInfo = {
                id: componentId,
                name: componentRecord.fields?.Name || 'Item'
            };
        }
    }

    // Check if this is a reply
    if (replyingToMessage) {
        const result = await api.postReplyMessage(replyingToMessage.id, sessionId, null, currentUser.id, currentUser.name, message);
        if (result) {
            // Update the parent message's reply count in UI
            const parentWrapper = document.querySelector(`[data-message-id="${replyingToMessage.id}"]`);
            if (parentWrapper) {
                const existingIndicator = parentWrapper.querySelector('.thread-indicator');
                if (existingIndicator) {
                    const currentCount = parseInt(existingIndicator.textContent.match(/\d+/)?.[0] || '0');
                    existingIndicator.innerHTML = `↳ ${currentCount + 1} ${currentCount + 1 === 1 ? 'reply' : 'replies'}`;
                } else {
                    // Add thread indicator
                    const threadIndicator = document.createElement('button');
                    threadIndicator.className = 'thread-indicator';
                    threadIndicator.innerHTML = `↳ 1 reply`;
                    threadIndicator.addEventListener('click', (e) => {
                        e.stopPropagation();
                        toggleThreadView(replyingToMessage.id, parentWrapper);
                    });
                    parentWrapper.querySelector('.chat-message')?.appendChild(threadIndicator);
                }
            }
            sessionChatChannel.trigger('client-new-reply', {
                parentMessageId: replyingToMessage.id,
                content: message,
                senderId: currentUser.id,
                senderName: currentUser.name,
                timestamp: timestamp
            });
        }
        cancelReply();
    } else {
        // Regular message (not a reply)
        // Add to session history items
        const messageData = {
            type: 'chat',
            timestamp: timestamp,
            data: {
                sender: currentUser.name,
                message: message,
                isSent: true,
                timestamp: timestamp,
                senderId: currentUser.id,
                messageId: null, // Will be updated when we get the response
                reactions: {},
                isEdited: false,
                isDeleted: false,
                replyCount: 0,
                componentInfo: componentInfo // Include component affiliation
            }
        };
        sessionHistoryItems.push(messageData);

        // Append to UI directly (without re-rendering entire list to avoid duplicates)
        if (historyFilters.chat) {
            const messagesList = document.getElementById('messages-list');
            if (messagesList) {
                renderHistoryItem(messagesList, messageData);
            }
        }

        // Pass componentId to the API call
        const newMessageId = await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message, componentId);

        // Update the message data and UI element with the real message ID
        if (newMessageId) {
            messageData.data.messageId = newMessageId;

            // Find and update the wrapper element (it's the last one without a messageId)
            const messagesList = document.getElementById('messages-list');
            if (messagesList) {
                const wrappers = messagesList.querySelectorAll('.message-wrapper.sent:not([data-message-id])');
                const lastWrapper = wrappers.length > 0 ? wrappers[wrappers.length - 1] : null;
                if (lastWrapper) {
                    lastWrapper.dataset.messageId = newMessageId;
                    // Add the reply button now that we have a valid message ID
                    const actionsContainer = lastWrapper.querySelector('.message-actions');
                    if (actionsContainer && !actionsContainer.querySelector('.reply-btn')) {
                        const replyBtn = document.createElement('button');
                        replyBtn.className = 'msg-action-btn reply-btn';
                        replyBtn.innerHTML = '↩';
                        replyBtn.title = 'Reply';
                        replyBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            startReply(newMessageId, currentUser.name, message);
                        });
                        // Insert after the reaction button
                        const reactionBtn = actionsContainer.querySelector('.reaction-btn');
                        if (reactionBtn && reactionBtn.nextSibling) {
                            actionsContainer.insertBefore(replyBtn, reactionBtn.nextSibling);
                        } else {
                            actionsContainer.appendChild(replyBtn);
                        }
                    }
                }
            }
        }

        sessionChatChannel.trigger('client-new-message', {
            content: message,
            senderId: currentUser.id,
            senderName: currentUser.name,
            timestamp: timestamp,
            messageId: newMessageId, // Include the message ID for other clients
            componentInfo: componentInfo // Include component affiliation
        });

        // Reset component selector after sending (optional - uncomment if desired)
        // setSelectedComponent(null);
    }
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
    // Use createdTime from record level, fall back to fields.Timestamp
    const timestamp = record.createdTime || record.fields?.Timestamp || new Date().toISOString();
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

    // Refresh forum panel if open to show new plan event
    refreshForumData();
}
