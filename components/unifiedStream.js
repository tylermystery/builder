// FILE: components/unifiedStream.js
// Unified Stream - Single stream/chat for the plan with topics, reactions, and resizable view
// User design choices:
// 1. Unified model with unified rendering layer (keep separate data, unified rendering)
// 2. Any top-level message is automatically a topic
// 3. Same DOM that resizes between chat widget and thread view
// 4. Toggle placement in the chat header and thread header
// 5. Content-based default with ability to change (component affiliation)
// 6. Context menu action for task conversion and mark unread

import { state } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';

// Store reference to getCurrentUser - will be set via setter to avoid circular dependency
let getCurrentUserFn = null;

/**
 * Set the getCurrentUser function reference (called from chat.js initialization)
 */
export function setGetCurrentUser(fn) {
    getCurrentUserFn = fn;
}

/**
 * Get current user from the stored function or fallback to state
 */
function getCurrentUser() {
    if (getCurrentUserFn) {
        return getCurrentUserFn();
    }
    return state.session?.user?.id ? {
        id: state.session.user.id,
        name: state.session.user.name || 'User'
    } : null;
}

// Quick emoji reactions
const QUICK_REACTIONS = ['thumbs-up', 'heart', 'smile', 'surprised', 'sad', 'party'];

// Stream state
let streamItems = [];          // All items in the unified stream
let expandedTopics = new Set(); // Track expanded topic IDs (topics are collapsed by default initially)
let showReactions = true;       // Toggle for showing/hiding reactions
let allExpanded = false;        // Track collapse/expand all state
let selectedComponent = null;   // Selected component for message affiliation
let contextMenuTarget = null;   // Current target for context menu
let unreadItems = new Set();    // Track items marked as unread
let viewMode = 'compact';       // 'compact' (chat) or 'expanded' (thread view)
let pusherChannel = null;       // Pusher channel reference

// Storage keys
const STORAGE_PREFIX = 'wtf_stream_';
const getStorageKey = (key) => {
    const sessionId = state.session?.id;
    const userId = getCurrentUser()?.id;
    if (!sessionId || !userId) return null;
    return `${STORAGE_PREFIX}${key}_${sessionId}_${userId}`;
};

/**
 * Initialize the unified stream system
 * @param {Object} options - Configuration options
 * @param {Function} options.getCurrentUser - Function to get current user
 * @param {Object} options.pusherChannel - Pusher channel for real-time events
 */
export function initializeUnifiedStream(options = {}) {
    if (options.getCurrentUser) {
        setGetCurrentUser(options.getCurrentUser);
    }
    if (options.pusherChannel) {
        pusherChannel = options.pusherChannel;
    }

    // Load preferences from localStorage
    loadPreferences();

    // Set up event listeners
    setupEventListeners();

    // Initialize context menu
    createContextMenu();

    // Initialize component selector
    createComponentSelector();

    log('UnifiedStream', 'Unified Stream initialized');
}

/**
 * Load user preferences from localStorage
 */
function loadPreferences() {
    const key = getStorageKey('preferences');
    if (!key) return;

    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            const prefs = JSON.parse(stored);
            showReactions = prefs.showReactions !== false;
            viewMode = prefs.viewMode || 'compact';
        }
    } catch (e) {
        log('UnifiedStream', 'Error loading preferences:', e);
    }
}

/**
 * Save user preferences to localStorage
 */
function savePreferences() {
    const key = getStorageKey('preferences');
    if (!key) return;

    try {
        localStorage.setItem(key, JSON.stringify({
            showReactions,
            viewMode
        }));
    } catch (e) {
        log('UnifiedStream', 'Error saving preferences:', e);
    }
}

/**
 * Load unread items from localStorage
 */
function loadUnreadItems() {
    const key = getStorageKey('unread');
    if (!key) return;

    try {
        const stored = localStorage.getItem(key);
        if (stored) {
            unreadItems = new Set(JSON.parse(stored));
        }
    } catch (e) {
        log('UnifiedStream', 'Error loading unread items:', e);
    }
}

/**
 * Save unread items to localStorage
 */
function saveUnreadItems() {
    const key = getStorageKey('unread');
    if (!key) return;

    try {
        localStorage.setItem(key, JSON.stringify([...unreadItems]));
    } catch (e) {
        log('UnifiedStream', 'Error saving unread items:', e);
    }
}

/**
 * Set up event listeners for the unified stream
 */
function setupEventListeners() {
    // Toggle reactions visibility
    document.addEventListener('click', (e) => {
        if (e.target.closest('.stream-toggle-reactions')) {
            toggleReactionsVisibility();
        }
    });

    // Collapse/Expand all topics
    document.addEventListener('click', (e) => {
        if (e.target.closest('.stream-toggle-expand-all')) {
            toggleExpandAll();
        }
    });

    // View mode toggle (resize between compact/expanded)
    document.addEventListener('click', (e) => {
        if (e.target.closest('.stream-view-toggle')) {
            toggleViewMode();
        }
    });

    // Context menu trigger
    document.addEventListener('contextmenu', (e) => {
        const topicItem = e.target.closest('.stream-topic, .stream-message');
        if (topicItem) {
            e.preventDefault();
            showContextMenu(e, topicItem);
        }
    });

    // Close context menu on click elsewhere
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.stream-context-menu')) {
            hideContextMenu();
        }
    });

    // Component selector change
    document.addEventListener('change', (e) => {
        if (e.target.closest('.stream-component-select')) {
            selectedComponent = e.target.value || null;
        }
    });

    log('UnifiedStream', 'Event listeners set up');
}

/**
 * Create the context menu element
 */
function createContextMenu() {
    let menu = document.getElementById('stream-context-menu');
    if (menu) return;

    menu = document.createElement('div');
    menu.id = 'stream-context-menu';
    menu.className = 'stream-context-menu';
    menu.style.display = 'none';
    menu.innerHTML = `
        <button class="context-menu-item" data-action="reply">
            <span class="context-icon">reply</span> Reply
        </button>
        <button class="context-menu-item" data-action="react">
            <span class="context-icon">add_reaction</span> Add Reaction
        </button>
        <hr class="context-divider">
        <button class="context-menu-item" data-action="mark-unread">
            <span class="context-icon">mark_as_unread</span> Mark as Unread
        </button>
        <button class="context-menu-item" data-action="create-task">
            <span class="context-icon">add_task</span> Create Task
        </button>
        <hr class="context-divider">
        <button class="context-menu-item" data-action="copy">
            <span class="context-icon">content_copy</span> Copy Text
        </button>
    `;

    document.body.appendChild(menu);

    // Context menu actions
    menu.addEventListener('click', (e) => {
        const action = e.target.closest('.context-menu-item')?.dataset.action;
        if (action && contextMenuTarget) {
            handleContextMenuAction(action, contextMenuTarget);
        }
        hideContextMenu();
    });
}

/**
 * Show context menu at position
 */
function showContextMenu(e, target) {
    const menu = document.getElementById('stream-context-menu');
    if (!menu) return;

    contextMenuTarget = target;
    const messageId = target.dataset.messageId;
    const currentUser = getCurrentUser();
    const message = streamItems.find(m => m.id === messageId);

    // Update menu items based on message state
    const markUnreadItem = menu.querySelector('[data-action="mark-unread"]');
    if (markUnreadItem && message) {
        const isUnread = unreadItems.has(messageId);
        markUnreadItem.innerHTML = `<span class="context-icon">${isUnread ? 'mark_email_read' : 'mark_as_unread'}</span> ${isUnread ? 'Mark as Read' : 'Mark as Unread'}`;
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
    const menu = document.getElementById('stream-context-menu');
    if (menu) {
        menu.style.display = 'none';
    }
    contextMenuTarget = null;
}

/**
 * Handle context menu action
 */
async function handleContextMenuAction(action, target) {
    const messageId = target.dataset.messageId;
    const message = streamItems.find(m => m.id === messageId);

    if (!message) return;

    switch (action) {
        case 'reply':
            startReply(message);
            break;

        case 'react':
            showReactionPicker(target, messageId);
            break;

        case 'mark-unread':
            toggleUnreadState(messageId);
            break;

        case 'create-task':
            await createTaskFromMessage(message);
            break;

        case 'copy':
            copyMessageText(message);
            break;
    }

    log('UnifiedStream', `Context menu action: ${action} on message ${messageId}`);
}

/**
 * Toggle unread state for a message
 */
export function toggleUnreadState(messageId) {
    if (unreadItems.has(messageId)) {
        unreadItems.delete(messageId);
    } else {
        unreadItems.add(messageId);
    }
    saveUnreadItems();

    // Update UI
    const element = document.querySelector(`[data-message-id="${messageId}"]`);
    if (element) {
        element.classList.toggle('unread', unreadItems.has(messageId));
    }

    // Update notification badges
    updateUnreadBadges();

    log('UnifiedStream', `Toggled unread state for message ${messageId}: ${unreadItems.has(messageId)}`);
}

/**
 * Mark a message as unread
 */
export function markAsUnread(messageId) {
    if (!unreadItems.has(messageId)) {
        unreadItems.add(messageId);
        saveUnreadItems();

        const element = document.querySelector(`[data-message-id="${messageId}"]`);
        if (element) {
            element.classList.add('unread');
        }

        updateUnreadBadges();
    }
}

/**
 * Mark a message as read
 */
export function markAsRead(messageId) {
    if (unreadItems.has(messageId)) {
        unreadItems.delete(messageId);
        saveUnreadItems();

        const element = document.querySelector(`[data-message-id="${messageId}"]`);
        if (element) {
            element.classList.remove('unread');
        }

        updateUnreadBadges();
    }
}

/**
 * Update unread count badges
 */
function updateUnreadBadges() {
    const count = unreadItems.size;

    // Update chat toggle button badge
    const toggleBadge = document.getElementById('presence-counter');
    if (toggleBadge) {
        // Show unread count if > 0, otherwise show online users count
        // For now, we'll add a separate badge element
    }

    // Update stream header badge
    const headerBadge = document.querySelector('.stream-unread-badge');
    if (headerBadge) {
        headerBadge.textContent = count > 99 ? '99+' : count.toString();
        headerBadge.style.display = count > 0 ? 'inline-flex' : 'none';
    }

    log('UnifiedStream', `Updated unread badges: ${count} unread`);
}

/**
 * Create task from message content
 */
async function createTaskFromMessage(message) {
    const currentUser = getCurrentUser();
    if (!currentUser) {
        log('UnifiedStream', 'Cannot create task: no current user');
        showToast('Please sign in to create tasks', 'error');
        return;
    }

    const projectId = state.session.id;
    if (!projectId) {
        log('UnifiedStream', 'Cannot create task: no active project');
        showToast('No active project', 'error');
        return;
    }

    // Check permissions
    const currentRole = state.permissions?.currentRole;
    const isLoadingPerms = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoadingPerms && canEditByRole) || canEditByOwnership;

    if (!canUserEdit) {
        showToast('You do not have permission to create tasks', 'error');
        return;
    }

    try {
        // Determine component association
        const componentId = message.componentId || selectedComponent;

        // Get max order for new task positioning
        const projectTasks = state.tasks.byProject.get(projectId) || [];
        const maxOrder = projectTasks.reduce((max, t) => Math.max(max, t.fields?.Order || 0), 0);

        // Build task data matching the API's expected format
        const taskData = {
            Name: message.content.substring(0, 100) + (message.content.length > 100 ? '...' : ''),
            Description: `From stream message by ${message.senderName || currentUser.name}: ${message.content}`,
            Status: api.TASK_STATUS.PENDING,
            Order: maxOrder + 1
        };

        // Link to plan item if the message is on a valid component
        if (componentId && componentId.startsWith('rec')) {
            taskData.LinkedItem = componentId;
        }

        // Persist to Airtable via API
        const newTask = await api.createTask(projectId, taskData);
        if (newTask) {
            // Update local state so task appears immediately
            state.tasks.all.set(newTask.id, newTask);
            const existingTasks = state.tasks.byProject.get(projectId) || [];
            state.tasks.byProject.set(projectId, [...existingTasks, newTask]);

            log('UnifiedStream', `Task created from message: ${newTask.id}`);
            showToast('Task created from message');
        } else {
            throw new Error('API returned null');
        }
    } catch (error) {
        log('UnifiedStream', `Error creating task: ${error.message}`);
        showToast('Failed to create task', 'error');
    }
}

/**
 * Copy message text to clipboard
 */
function copyMessageText(message) {
    navigator.clipboard.writeText(message.content).then(() => {
        showToast('Text copied to clipboard');
    }).catch(err => {
        log('UnifiedStream', 'Failed to copy text:', err);
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

/**
 * Create component selector dropdown
 */
function createComponentSelector() {
    // Component selector will be rendered in the message input area
    // when user is composing a message
}

/**
 * Toggle reactions visibility
 */
export function toggleReactionsVisibility() {
    showReactions = !showReactions;
    savePreferences();

    // Update all reaction containers
    document.querySelectorAll('.stream-reactions').forEach(el => {
        el.style.display = showReactions ? 'flex' : 'none';
    });

    // Update toggle button state
    const btn = document.querySelector('.stream-toggle-reactions');
    if (btn) {
        btn.classList.toggle('active', showReactions);
        btn.setAttribute('aria-pressed', showReactions.toString());
        btn.title = showReactions ? 'Hide Reactions' : 'Show Reactions';
    }

    log('UnifiedStream', `Reactions visibility: ${showReactions}`);
}

/**
 * Toggle expand/collapse all topics
 */
export function toggleExpandAll() {
    allExpanded = !allExpanded;

    // Expand or collapse all topics
    const topics = document.querySelectorAll('.stream-topic');
    topics.forEach(topic => {
        const messageId = topic.dataset.messageId;
        const repliesContainer = topic.querySelector('.stream-replies');
        const indicator = topic.querySelector('.topic-expand-indicator');

        if (allExpanded) {
            expandedTopics.add(messageId);
            repliesContainer?.classList.add('expanded');
            if (indicator) indicator.textContent = 'expand_less';
        } else {
            expandedTopics.delete(messageId);
            repliesContainer?.classList.remove('expanded');
            if (indicator) indicator.textContent = 'expand_more';
        }
    });

    // Update toggle button state
    const btn = document.querySelector('.stream-toggle-expand-all');
    if (btn) {
        btn.classList.toggle('active', allExpanded);
        btn.setAttribute('aria-pressed', allExpanded.toString());
        btn.innerHTML = allExpanded ?
            '<span class="material-icons">unfold_less</span> Collapse All' :
            '<span class="material-icons">unfold_more</span> Expand All';
    }

    log('UnifiedStream', `All topics ${allExpanded ? 'expanded' : 'collapsed'}`);
}

/**
 * Toggle view mode between compact and expanded
 */
export function toggleViewMode() {
    viewMode = viewMode === 'compact' ? 'expanded' : 'compact';
    savePreferences();

    const container = document.getElementById('unified-stream-container') ||
                      document.getElementById('chat-window');

    if (container) {
        container.classList.toggle('stream-view-expanded', viewMode === 'expanded');
        container.classList.toggle('stream-view-compact', viewMode === 'compact');
    }

    // Update toggle button
    const btn = document.querySelector('.stream-view-toggle');
    if (btn) {
        btn.innerHTML = viewMode === 'expanded' ?
            '<span class="material-icons">fullscreen_exit</span>' :
            '<span class="material-icons">fullscreen</span>';
        btn.title = viewMode === 'expanded' ? 'Compact View' : 'Expanded View';
    }

    log('UnifiedStream', `View mode: ${viewMode}`);
}

/**
 * Get current view mode
 */
export function getViewMode() {
    return viewMode;
}

/**
 * Show reaction picker for a message
 */
function showReactionPicker(wrapper, messageId) {
    // Remove any existing picker
    document.querySelectorAll('.stream-reaction-picker').forEach(p => p.remove());

    const picker = document.createElement('div');
    picker.className = 'stream-reaction-picker';

    QUICK_REACTIONS.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'reaction-picker-btn';
        btn.textContent = getEmojiFromName(emoji);
        btn.title = emoji;
        btn.addEventListener('click', async () => {
            picker.remove();
            await toggleReaction(messageId, emoji, true);
        });
        picker.appendChild(btn);
    });

    document.body.appendChild(picker);

    // Position near the target
    const rect = wrapper.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.zIndex = '10001';
    picker.style.top = `${rect.top - 50}px`;
    picker.style.left = `${rect.left}px`;

    // Close on click elsewhere
    const closePicker = (e) => {
        if (!picker.contains(e.target)) {
            picker.remove();
            document.removeEventListener('click', closePicker);
        }
    };
    setTimeout(() => document.addEventListener('click', closePicker), 0);
}

/**
 * Get emoji character from name
 */
function getEmojiFromName(name) {
    const emojiMap = {
        'thumbs-up': '\u{1F44D}',
        'heart': '\u{2764}\u{FE0F}',
        'smile': '\u{1F602}',
        'surprised': '\u{1F62E}',
        'sad': '\u{1F622}',
        'party': '\u{1F389}'
    };
    return emojiMap[name] || name;
}

/**
 * Toggle a reaction on a message
 */
export async function toggleReaction(messageId, emoji, add) {
    const currentUser = getCurrentUser();
    if (!messageId || !currentUser) return;

    try {
        const result = await api.toggleMessageReaction(messageId, currentUser.id, emoji, add);
        if (result !== null) {
            // Update the message in streamItems
            const message = streamItems.find(m => m.id === messageId);
            if (message) {
                message.reactions = result;
            }

            // Update UI
            updateReactionsDisplay(messageId, result);

            // Broadcast via Pusher if available
            if (pusherChannel) {
                pusherChannel.trigger('client-reaction-update', {
                    messageId,
                    reactions: result,
                    userId: currentUser.id
                });
            }
        }
    } catch (error) {
        log('UnifiedStream', `Error toggling reaction: ${error.message}`);
    }
}

/**
 * Update reactions display for a message
 */
function updateReactionsDisplay(messageId, reactions) {
    const wrapper = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!wrapper) return;

    const currentUser = getCurrentUser();
    let container = wrapper.querySelector('.stream-reactions');

    // Remove existing if empty
    if (!reactions || Object.keys(reactions).length === 0) {
        if (container) container.remove();
        return;
    }

    // Create container if needed
    if (!container) {
        container = document.createElement('div');
        container.className = 'stream-reactions';
        container.style.display = showReactions ? 'flex' : 'none';

        // Insert after content
        const content = wrapper.querySelector('.stream-content, .message-content');
        if (content) {
            content.after(container);
        }
    }

    container.innerHTML = '';

    for (const [emoji, users] of Object.entries(reactions)) {
        if (users && users.length > 0) {
            const badge = document.createElement('button');
            badge.className = 'stream-reaction-badge';
            const hasReacted = users.includes(currentUser?.id);
            if (hasReacted) badge.classList.add('user-reacted');
            badge.innerHTML = `${getEmojiFromName(emoji)} <span>${users.length}</span>`;
            badge.title = `${users.length} reaction${users.length !== 1 ? 's' : ''}`;
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleReaction(messageId, emoji, !hasReacted);
            });
            container.appendChild(badge);
        }
    }
}

/**
 * Start replying to a message
 */
let replyingTo = null;

export function startReply(message) {
    replyingTo = message;

    // Show reply indicator in input area
    const inputContainer = document.getElementById('message-form') ||
                           document.getElementById('forum-message-form');
    if (!inputContainer) return;

    // Remove existing indicator
    document.querySelectorAll('.stream-reply-indicator').forEach(el => el.remove());

    const indicator = document.createElement('div');
    indicator.className = 'stream-reply-indicator';
    indicator.innerHTML = `
        <span class="reply-text">Replying to <strong>${escapeHtml(message.senderName)}</strong></span>
        <button class="cancel-reply" type="button">&times;</button>
    `;

    indicator.querySelector('.cancel-reply').addEventListener('click', cancelReply);
    inputContainer.parentElement.insertBefore(indicator, inputContainer);

    // Focus input
    const input = inputContainer.querySelector('input[type="text"]');
    if (input) input.focus();

    log('UnifiedStream', `Started reply to message ${message.id}`);
}

/**
 * Cancel current reply
 */
export function cancelReply() {
    replyingTo = null;
    document.querySelectorAll('.stream-reply-indicator').forEach(el => el.remove());
}

/**
 * Get current reply target
 */
export function getReplyingTo() {
    return replyingTo;
}

/**
 * Clear reply state after sending
 */
export function clearReplyState() {
    cancelReply();
}

/**
 * Get selected component for message affiliation
 */
export function getSelectedComponent() {
    return selectedComponent;
}

/**
 * Set selected component for message affiliation
 */
export function setSelectedComponent(componentId) {
    selectedComponent = componentId;

    // Update selector UI
    const selector = document.querySelector('.stream-component-select');
    if (selector) {
        selector.value = componentId || '';
    }
}

/**
 * Render the unified stream header with toggle controls
 */
export function renderStreamHeader(container) {
    const header = document.createElement('div');
    header.className = 'stream-header';
    header.innerHTML = `
        <div class="stream-header-title">
            <span id="stream-title">Plan Discussion</span>
            <span class="stream-unread-badge" style="display: none;">0</span>
        </div>
        <div class="stream-header-controls">
            <button class="stream-toggle-reactions ${showReactions ? 'active' : ''}"
                    title="${showReactions ? 'Hide Reactions' : 'Show Reactions'}"
                    aria-pressed="${showReactions}">
                <span class="material-icons">sentiment_satisfied</span>
            </button>
            <button class="stream-toggle-expand-all"
                    title="${allExpanded ? 'Collapse All' : 'Expand All'}"
                    aria-pressed="${allExpanded}">
                <span class="material-icons">${allExpanded ? 'unfold_less' : 'unfold_more'}</span>
            </button>
            <button class="stream-view-toggle"
                    title="${viewMode === 'expanded' ? 'Compact View' : 'Expanded View'}">
                <span class="material-icons">${viewMode === 'expanded' ? 'fullscreen_exit' : 'fullscreen'}</span>
            </button>
        </div>
    `;

    container.appendChild(header);
    updateUnreadBadges();

    return header;
}

/**
 * Render the component selector in the input area
 */
export function renderComponentSelector(container, components = []) {
    let selector = container.querySelector('.stream-component-selector');
    if (selector) selector.remove();

    selector = document.createElement('div');
    selector.className = 'stream-component-selector';

    // Get current context (if user is viewing a specific component)
    const currentComponentId = state.currentViewingComponent || null;

    selector.innerHTML = `
        <label for="stream-component-select">Attach to:</label>
        <select class="stream-component-select" id="stream-component-select">
            <option value="">Plan-wide (no specific item)</option>
            ${components.map(c => `
                <option value="${c.id}" ${c.id === currentComponentId ? 'selected' : ''}>
                    ${escapeHtml(c.name)}
                </option>
            `).join('')}
        </select>
    `;

    // Set default based on context
    if (currentComponentId) {
        selectedComponent = currentComponentId;
    }

    container.insertBefore(selector, container.firstChild);

    return selector;
}

/**
 * Render a topic (top-level message) with its replies
 */
export function renderTopic(message) {
    const currentUser = getCurrentUser();
    const isSent = message.senderId === currentUser?.id;
    const isExpanded = expandedTopics.has(message.id);
    const isUnread = unreadItems.has(message.id);

    const topic = document.createElement('div');
    topic.className = `stream-topic ${isSent ? 'sent' : 'received'} ${isUnread ? 'unread' : ''}`;
    topic.dataset.messageId = message.id;
    if (message.componentId) {
        topic.dataset.componentId = message.componentId;
        topic.classList.add('has-component');
    }

    // Component badge (if affiliated with a component)
    const componentBadge = message.componentId ? `
        <div class="stream-component-badge">
            <span class="badge-icon">\u{1F4CD}</span>
            <span class="badge-name">${escapeHtml(message.componentName || 'Item')}</span>
        </div>
    ` : '';

    // Header with sender and timestamp
    const header = `
        <div class="stream-topic-header">
            ${componentBadge}
            <span class="stream-sender">${isSent ? 'You' : escapeHtml(message.senderName)}</span>
            <span class="stream-timestamp">${formatTimestamp(message.timestamp)}</span>
        </div>
    `;

    // Content
    const content = `
        <div class="stream-content">
            ${message.isDeleted ? '<em class="deleted">This message was deleted</em>' : escapeHtml(message.content)}
            ${message.isEdited && !message.isDeleted ? '<span class="edited-indicator">(edited)</span>' : ''}
        </div>
    `;

    // Reactions
    const reactions = renderReactionsHtml(message.reactions, currentUser);

    // Reply count and expand indicator
    const replyCount = message.replies?.length || message.replyCount || 0;
    const replyIndicator = replyCount > 0 ? `
        <button class="stream-topic-replies-btn" data-expanded="${isExpanded}">
            <span class="topic-expand-indicator material-icons">${isExpanded ? 'expand_less' : 'expand_more'}</span>
            <span class="reply-count">${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}</span>
        </button>
    ` : '';

    // Actions (shown on hover)
    const actions = message.isDeleted ? '' : `
        <div class="stream-topic-actions">
            <button class="stream-action-btn" data-action="reply" title="Reply">
                <span class="material-icons">reply</span>
            </button>
            <button class="stream-action-btn" data-action="react" title="React">
                <span class="material-icons">add_reaction</span>
            </button>
        </div>
    `;

    // Replies container
    const repliesHtml = replyCount > 0 ? `
        <div class="stream-replies ${isExpanded ? 'expanded' : ''}" id="replies-${message.id}">
            ${isExpanded && message.replies ? message.replies.map(r => renderReplyHtml(r)).join('') : ''}
        </div>
    ` : '';

    topic.innerHTML = `
        ${header}
        ${content}
        ${reactions}
        ${replyIndicator}
        ${actions}
        ${repliesHtml}
    `;

    // Event listeners
    setupTopicEventListeners(topic, message);

    return topic;
}

/**
 * Set up event listeners for a topic element
 */
function setupTopicEventListeners(topic, message) {
    // Toggle replies expansion
    const repliesBtn = topic.querySelector('.stream-topic-replies-btn');
    if (repliesBtn) {
        repliesBtn.addEventListener('click', () => {
            toggleTopicExpansion(message.id, topic);
        });
    }

    // Reply action
    const replyBtn = topic.querySelector('[data-action="reply"]');
    if (replyBtn) {
        replyBtn.addEventListener('click', () => startReply(message));
    }

    // React action
    const reactBtn = topic.querySelector('[data-action="react"]');
    if (reactBtn) {
        reactBtn.addEventListener('click', () => showReactionPicker(topic, message.id));
    }

    // Reaction badge clicks
    topic.querySelectorAll('.stream-reaction-badge').forEach(badge => {
        const emoji = badge.dataset.emoji;
        badge.addEventListener('click', () => {
            const hasReacted = badge.classList.contains('user-reacted');
            toggleReaction(message.id, emoji, !hasReacted);
        });
    });
}

/**
 * Toggle topic expansion
 */
function toggleTopicExpansion(messageId, topicElement) {
    const isExpanded = expandedTopics.has(messageId);
    const repliesContainer = topicElement.querySelector(`#replies-${messageId}`);
    const indicator = topicElement.querySelector('.topic-expand-indicator');
    const btn = topicElement.querySelector('.stream-topic-replies-btn');

    if (isExpanded) {
        expandedTopics.delete(messageId);
        repliesContainer?.classList.remove('expanded');
        if (indicator) indicator.textContent = 'expand_more';
        if (btn) btn.dataset.expanded = 'false';
    } else {
        expandedTopics.add(messageId);
        repliesContainer?.classList.add('expanded');
        if (indicator) indicator.textContent = 'expand_less';
        if (btn) btn.dataset.expanded = 'true';

        // Load replies if not already loaded
        const message = streamItems.find(m => m.id === messageId);
        if (message && repliesContainer && repliesContainer.children.length === 0 && message.replies) {
            message.replies.forEach(reply => {
                repliesContainer.innerHTML += renderReplyHtml(reply);
            });
        }
    }
}

/**
 * Render reactions HTML
 */
function renderReactionsHtml(reactions, currentUser) {
    if (!reactions || Object.keys(reactions).length === 0) return '';

    const badges = Object.entries(reactions)
        .filter(([, users]) => users && users.length > 0)
        .map(([emoji, users]) => {
            const hasReacted = users.includes(currentUser?.id);
            return `
                <button class="stream-reaction-badge ${hasReacted ? 'user-reacted' : ''}"
                        data-emoji="${emoji}"
                        title="${users.length} reaction${users.length !== 1 ? 's' : ''}">
                    ${getEmojiFromName(emoji)} <span>${users.length}</span>
                </button>
            `;
        })
        .join('');

    return `<div class="stream-reactions" style="display: ${showReactions ? 'flex' : 'none'};">${badges}</div>`;
}

/**
 * Render a reply HTML string
 */
function renderReplyHtml(reply) {
    const currentUser = getCurrentUser();
    const isSent = reply.senderId === currentUser?.id;

    return `
        <div class="stream-reply ${isSent ? 'sent' : 'received'}" data-message-id="${reply.id}">
            <div class="stream-reply-header">
                <span class="stream-sender">${isSent ? 'You' : escapeHtml(reply.senderName)}</span>
                <span class="stream-timestamp">${formatTimestamp(reply.timestamp)}</span>
            </div>
            <div class="stream-content">
                ${reply.isDeleted ? '<em class="deleted">Deleted</em>' : escapeHtml(reply.content)}
            </div>
        </div>
    `;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(timestamp) {
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
    });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Load stream items from session history
 */
export function loadStreamItems(sessionHistoryItems) {
    // Transform session history items to stream format
    streamItems = sessionHistoryItems
        .filter(item => item.type === 'chat')
        .map(item => ({
            id: item.data?.messageId || item.id,
            senderId: item.data?.senderId,
            senderName: item.data?.sender || 'Anonymous',
            content: item.data?.message || '',
            timestamp: item.timestamp || item.data?.timestamp,
            reactions: item.data?.reactions || {},
            isEdited: item.data?.isEdited || false,
            isDeleted: item.data?.isDeleted || false,
            replyCount: item.data?.replyCount || 0,
            replies: item.data?.replies || [],
            parentMessageId: item.data?.parentMessageId || null,
            componentId: item.data?.componentInfo?.id || null,
            componentName: item.data?.componentInfo?.name || null
        }));

    // Build thread structure (any top-level message is a topic)
    buildThreadStructure();

    // Load unread items
    loadUnreadItems();

    log('UnifiedStream', `Loaded ${streamItems.length} stream items`);
}

/**
 * Build thread structure - organize messages by parent/child
 */
function buildThreadStructure() {
    const messageMap = new Map();
    const topLevelMessages = [];

    // First pass: create map of all messages
    streamItems.forEach(msg => {
        messageMap.set(msg.id, { ...msg, replies: [] });
    });

    // Second pass: organize by parent/child
    streamItems.forEach(msg => {
        if (msg.parentMessageId && messageMap.has(msg.parentMessageId)) {
            const parent = messageMap.get(msg.parentMessageId);
            parent.replies.push(messageMap.get(msg.id));
            parent.replyCount = parent.replies.length;
        } else if (!msg.parentMessageId) {
            topLevelMessages.push(messageMap.get(msg.id));
        }
    });

    // Sort replies by timestamp
    topLevelMessages.forEach(msg => {
        if (msg.replies.length > 0) {
            msg.replies.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        }
    });

    // Update streamItems with organized topics
    streamItems = topLevelMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Get all stream items (topics)
 */
export function getStreamItems() {
    return streamItems;
}

/**
 * Add a new item to the stream
 */
export function addStreamItem(item) {
    if (item.parentMessageId) {
        // This is a reply - add to parent's replies
        const parent = streamItems.find(m => m.id === item.parentMessageId);
        if (parent) {
            if (!parent.replies) parent.replies = [];
            parent.replies.push(item);
            parent.replyCount = parent.replies.length;
        }
    } else {
        // This is a new topic
        streamItems.push(item);
    }

    log('UnifiedStream', `Added item to stream: ${item.id}`);
}

/**
 * Export current state for external use
 */
export function getStreamState() {
    return {
        showReactions,
        allExpanded,
        viewMode,
        selectedComponent,
        unreadCount: unreadItems.size
    };
}
