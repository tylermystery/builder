// FILE: components/unifiedChatPanel.js
// Unified Chat Panel - Side panel for conversations (shared across catalog and presentation views)
// Single main thread timeline with nested item comments and sub-threads on replies
// Features: chronological timeline, inline reactions, task modal, message editing

import { state, getRecordById } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import { showToast } from '../ui.js';
import { showTaskModal } from './taskManager.js';

// ===== MODULE STATE =====
let getCurrentUserFn = null;
let sendChatMessageFn = null; // Setter-injected from chat.js to avoid circular dep
let panelOpen = false;
let currentFilter = 'all'; // 'all' | 'comments' | 'ideas' | 'tasks'
let ucpMessages = [];
let ucpPlanEvents = [];
let replyingTo = null;
let editingMessage = null; // { id, content } for inline editing
let isLoading = false;
let collapsedThreads = new Set();
let openEmojiPicker = null;
let initialized = false;
let shouldScrollToBottom = true;
let hideCompleted = false; // Toggle to hide/show completed tasks and their linked comments
let isFullscreen = false; // v3.8: Full-screen mode state

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '🎉', '😮', '👀', '💯'];

// ===== INITIALIZATION =====

export function setUCPGetCurrentUser(fn) {
    getCurrentUserFn = fn;
}

export function setUCPSendMessage(fn) {
    sendChatMessageFn = fn;
}

function getCurrentUser() {
    if (getCurrentUserFn) return getCurrentUserFn();
    return state.session?.user?.id ? {
        id: state.session.user.id,
        name: state.session.user.name || 'User'
    } : null;
}

export function initializeUnifiedChatPanel() {
    if (initialized) {
        log('UCP', 'Already initialized, skipping.');
        return;
    }
    log('UCP', 'Initializing Unified Chat Panel...');
    console.log('[UCP DEBUG] Task state at UCP init:', {
        tasksAllSize: state.tasks.all.size,
        tasksByProjectKeys: [...state.tasks.byProject.keys()],
        commentTaskLinks: state.eventDetails.combined.get('_commentTaskLinks')
    });

    setupPanelClose();
    setupFilters();
    setupMessageForm();
    setupChatMenuActions();
    setupTaskCreationListener();
    setupHideCompletedToggle();
    setupFullscreenToggle();

    initialized = true;
    log('UCP', 'Unified Chat Panel initialized.');
}

export async function showUnifiedChatPanel() {
    console.log('[UCP DEBUG] showUnifiedChatPanel called. Task state:', {
        tasksAllSize: state.tasks.all.size,
        sessionId: state.session?.id,
        commentTaskLinks: state.eventDetails.combined.get('_commentTaskLinks')
    });
    document.body.classList.add('ucp-panel-open');
    // Also maintain legacy class for any CSS that still references it
    document.body.classList.add('ucp-panel-active');
    panelOpen = true;
    shouldScrollToBottom = true;

    populateAttachSelect();
    await loadPanelData();
    updateOnlineCount();

    // Debug: log layout dimensions
    requestAnimationFrame(() => {
        const panel = document.getElementById('unified-chat-panel');
        const content = document.getElementById('ucp-content');
        const inputArea = document.getElementById('ucp-input-area');
        console.log('[UCP LAYOUT DEBUG] Panel dimensions:', {
            panelHeight: panel?.offsetHeight,
            panelClientHeight: panel?.clientHeight,
            contentHeight: content?.offsetHeight,
            contentScrollHeight: content?.scrollHeight,
            inputAreaHeight: inputArea?.offsetHeight,
            inputAreaOffsetTop: inputArea?.offsetTop,
            inputAreaVisible: inputArea ? (inputArea.offsetTop + inputArea.offsetHeight <= (panel?.offsetHeight || 0)) : 'N/A',
            viewportHeight: window.innerHeight
        });
    });
}

export function hideUnifiedChatPanel() {
    // Exit fullscreen if active
    if (isFullscreen) {
        const panel = document.getElementById('unified-chat-panel');
        if (panel) panel.classList.remove('ucp-fullscreen');
        document.body.classList.remove('ucp-fullscreen-active');
        isFullscreen = false;
        const icon = document.getElementById('ucp-fullscreen-icon');
        if (icon) icon.innerHTML = '&#x26F6;';
    }
    document.body.classList.remove('ucp-panel-open');
    document.body.classList.remove('ucp-panel-active');
    panelOpen = false;
}

export async function toggleUnifiedChatPanel() {
    if (panelOpen) {
        hideUnifiedChatPanel();
    } else {
        await showUnifiedChatPanel();
    }
}

export async function refreshUnifiedChatPanel() {
    if (!panelOpen) return;
    shouldScrollToBottom = false;
    await loadPanelData();
}

export function onUCPNewItem(itemType, data) {
    if (!panelOpen) return;
    log('UCP', `New ${itemType} received, refreshing panel`);
    shouldScrollToBottom = true;
    setTimeout(() => {
        loadPanelData();
    }, 300);
}

// ===== SETUP FUNCTIONS =====

function setupPanelClose() {
    const closeBtn = document.getElementById('ucp-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            hideUnifiedChatPanel();
        });
    }
}

function setupFilters() {
    const filterBtns = document.querySelectorAll('.ucp-filter-btn');
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentFilter = btn.dataset.filter;
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            shouldScrollToBottom = true;
            renderContent();
        });
    });
}

function setupMessageForm() {
    const form = document.getElementById('ucp-message-form');
    if (form) {
        form.addEventListener('submit', handleMessageSubmit);
    }

    const cancelReplyBtn = document.querySelector('.ucp-reply-cancel');
    if (cancelReplyBtn) {
        cancelReplyBtn.addEventListener('click', cancelReply);
    }
}

function setupHideCompletedToggle() {
    const checkbox = document.getElementById('ucp-hide-completed-cb');
    if (checkbox) {
        checkbox.addEventListener('change', () => {
            hideCompleted = checkbox.checked;
            renderContent();
        });
    }
}

function populateAttachSelect() {
    const select = document.getElementById('ucp-attach-select');
    if (!select) return;

    select.innerHTML = '<option value="">Plan-wide chat</option>';

    // Gather plan item IDs from locked items (confirmed) and ideas (favorites)
    const planItemIds = new Set();
    if (state.cart?.lockedItems) {
        state.cart.lockedItems.forEach((info, id) => planItemIds.add(id));
    }
    if (state.cart?.items) {
        state.cart.items.forEach((info, id) => planItemIds.add(id));
    }

    // Fall back to all records if no plan items
    if (planItemIds.size === 0 && state.records?.all) {
        state.records.all.forEach(r => { if (r?.id) planItemIds.add(r.id); });
    }

    // Build options by looking up actual record data for proper names
    const entries = [];
    planItemIds.forEach(id => {
        const record = getRecordById(id);
        const name = record?.fields?.Name || record?.fields?.['Item Name'] || 'Unknown';
        entries.push({ id, name });
    });

    // Sort alphabetically
    entries.sort((a, b) => a.name.localeCompare(b.name));

    entries.forEach(({ id, name }) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        select.appendChild(option);
    });
}

// ===== DATA LOADING =====

async function loadPanelData() {
    const sessionId = state.session?.id;
    if (!sessionId) {
        showEmptyState('No active session');
        return;
    }

    if (isLoading) return;
    isLoading = true;

    const container = document.getElementById('ucp-content');
    if (container && ucpMessages.length === 0) {
        container.innerHTML = '<div class="ucp-loading">Loading conversations...</div>';
    }

    try {
        const messages = await api.fetchChatMessages(sessionId);

        ucpMessages = [];
        ucpPlanEvents = [];

        if (messages && Array.isArray(messages)) {
            messages.forEach(record => {
                const fields = record.fields || record;
                const senderId = fields.SenderID;
                const content = fields.Content || '';

                if (senderId === 'system') {
                    try {
                        const eventData = JSON.parse(content);
                        ucpPlanEvents.push({
                            id: record.id,
                            type: eventData.type,
                            data: eventData.data,
                            timestamp: record.createdTime || fields.Timestamp || new Date().toISOString(),
                            ...eventData
                        });
                    } catch (e) {
                        ucpMessages.push(createMessageObj(record));
                    }
                } else {
                    ucpMessages.push(createMessageObj(record));
                }
            });
        }

        buildThreads();

        isLoading = false;
        renderContent();

    } catch (error) {
        log('UCP', 'Error loading panel data:', error);
        isLoading = false;
        showEmptyState('Error loading conversations');
    }
}

function createMessageObj(record) {
    const fields = record.fields || record;
    const currentUser = getCurrentUser();
    const timestamp = record.createdTime || fields.Timestamp || new Date().toISOString();

    const isIdea = fields.MessageType === 'idea' || (fields.Content || '').startsWith('[IDEA]');
    let content = isIdea && (fields.Content || '').startsWith('[IDEA]')
        ? (fields.Content || '').replace(/^\[IDEA\]\s*/, '')
        : (fields.Content || '');

    const itemLinkField = fields['Item Link'];
    let componentId = itemLinkField ? (Array.isArray(itemLinkField) ? itemLinkField[0] : itemLinkField) : null;

    if (!componentId) {
        const match = content.match(/^\[PLAN_COMMENT:item:([^\]]+)\]\s*/);
        if (match) {
            componentId = match[1];
            content = content.replace(/^\[PLAN_COMMENT:item:[^\]]+\]\s*/, '');
        }
    }

    return {
        id: record.id,
        senderId: fields.SenderID,
        senderName: fields.SenderName || 'Anonymous',
        content,
        timestamp,
        parentMessageId: fields.ParentMessageID,
        reactions: parseReactions(fields.Reactions),
        isEdited: fields.IsEdited || false,
        isDeleted: fields.IsDeleted || false,
        isIdea,
        componentId,
        isSent: fields.SenderID === currentUser?.id,
        replies: [],
        replyCount: 0
    };
}

function parseReactions(reactions) {
    if (!reactions) return {};
    if (typeof reactions === 'string') {
        try { return JSON.parse(reactions); } catch (e) { return {}; }
    }
    return reactions;
}

function buildThreads() {
    const messageMap = new Map();
    const topLevel = [];

    ucpMessages.forEach(msg => messageMap.set(msg.id, msg));

    ucpMessages.forEach(msg => {
        msg.replies = [];
        msg.replyCount = 0;
    });

    ucpMessages.forEach(msg => {
        if (msg.parentMessageId && messageMap.has(msg.parentMessageId)) {
            const parent = messageMap.get(msg.parentMessageId);
            parent.replies.push(msg);
            parent.replyCount++;
        } else if (!msg.parentMessageId) {
            topLevel.push(msg);
        }
    });

    topLevel.forEach(msg => {
        if (msg.replies.length > 0) {
            msg.replies.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        }
    });

    // Sort chronologically for single-thread timeline
    topLevel.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    ucpMessages = topLevel;
}

// ===== RENDERING =====

function renderContent() {
    const container = document.getElementById('ucp-content');
    if (!container) return;

    // Tasks tab has its own rendering path
    if (currentFilter === 'tasks') {
        renderTasksTab(container);
        return;
    }

    // Ensure input area is visible when NOT in tasks tab
    const inputArea = document.getElementById('ucp-input-area');
    if (inputArea) inputArea.style.display = '';

    container.innerHTML = '';

    let items = [];

    switch (currentFilter) {
        case 'all':
            items = ucpMessages;
            break;
        case 'comments':
            items = ucpMessages.filter(m => m.componentId);
            break;
        case 'ideas':
            items = ucpMessages.filter(m => m.isIdea);
            break;
        default:
            items = ucpMessages;
    }

    if (items.length === 0) {
        showEmptyState(getEmptyMessage());
        return;
    }

    // Group messages by date for the timeline
    let lastDateLabel = '';
    items.forEach(msg => {
        const dateLabel = getDateLabel(msg.timestamp);
        if (dateLabel !== lastDateLabel) {
            const divider = document.createElement('div');
            divider.className = 'ucp-date-divider';
            divider.innerHTML = `<span>${dateLabel}</span>`;
            container.appendChild(divider);
            lastDateLabel = dateLabel;
        }
        container.appendChild(createTimelineMessage(msg));
    });

    updateInputPlaceholder();

    // Scroll to bottom for chat-like experience
    if (shouldScrollToBottom) {
        container.scrollTop = container.scrollHeight;
        shouldScrollToBottom = false;
    }

    // Debug: verify UCP content area is scrollable and input is visible
    requestAnimationFrame(() => {
        const panel = document.getElementById('unified-chat-panel');
        const inputArea = document.getElementById('ucp-input-area');
        console.log('[UCP RENDER DEBUG] After renderContent:', {
            contentOffsetH: container.offsetHeight,
            contentScrollH: container.scrollHeight,
            contentCanScroll: container.scrollHeight > container.offsetHeight,
            inputAreaDisplay: inputArea?.style.display,
            inputAreaBottom: inputArea ? (inputArea.offsetTop + inputArea.offsetHeight) : 'N/A',
            panelBottom: panel?.offsetHeight,
            inputVisible: inputArea && panel ? (inputArea.offsetTop + inputArea.offsetHeight <= panel.offsetHeight + 1) : 'N/A'
        });
    });
}

function getDateLabel(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === now.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function updateInputPlaceholder() {
    const input = document.getElementById('ucp-message-input');
    if (!input) return;
    switch (currentFilter) {
        case 'comments': input.placeholder = 'Comment on a plan item...'; break;
        case 'ideas': input.placeholder = 'Share an idea...'; break;
        case 'tasks': input.placeholder = 'Message the team...'; break;
        default: input.placeholder = 'Message the team...'; break;
    }
}

function getEmptyMessage() {
    switch (currentFilter) {
        case 'comments': return 'No item comments yet. Discuss plan items!';
        case 'ideas': return 'No ideas shared yet. Suggest something!';
        case 'tasks': return 'No tasks yet. Create one from any message or the Tasks panel.';
        default: return 'No conversations yet. Say hello!';
    }
}

function showEmptyState(message) {
    const container = document.getElementById('ucp-content');
    if (!container) return;
    container.innerHTML = `
        <div class="ucp-empty">
            <span class="ucp-empty-icon">💬</span>
            <div>${escapeHtml(message)}</div>
        </div>
    `;
}

// ===== TIMELINE MESSAGE RENDERING =====

function createTimelineMessage(message) {
    const currentUser = getCurrentUser();
    const isOwn = message.senderId === currentUser?.id;
    const el = document.createElement('div');

    // Check if this message has a linked task that is completed
    const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
    const linkedTaskId = linksObj[message.id];
    const linkedTask = linkedTaskId ? state.tasks.all.get(linkedTaskId) : null;
    const isTaskCompleted = linkedTask?.fields?.Status === 'completed';

    let classes = 'ucp-msg';
    if (isOwn) classes += ' ucp-msg-own';
    if (message.componentId) classes += ' ucp-msg-comment';
    if (message.isIdea) classes += ' ucp-msg-idea';
    if (isTaskCompleted) classes += ' ucp-msg-task-completed';
    if (isTaskCompleted && hideCompleted) classes += ' ucp-hide-done';
    el.className = classes;
    el.dataset.messageId = message.id;

    // Context badge for item comments (nested inline)
    if (message.componentId) {
        const record = getRecordById(message.componentId);
        const itemName = record?.fields?.Name || 'Item';
        const badge = document.createElement('div');
        badge.className = 'ucp-msg-context';
        badge.innerHTML = `<span class="ucp-context-icon">📎</span> <span class="ucp-context-name">${escapeHtml(itemName)}</span>`;
        el.appendChild(badge);
    }

    if (message.isIdea) {
        const badge = document.createElement('div');
        badge.className = 'ucp-msg-context ucp-msg-context-idea';
        badge.innerHTML = `<span class="ucp-context-icon">💡</span> <span class="ucp-context-name">Idea</span>`;
        el.appendChild(badge);
    }

    // Message header: sender + time
    const header = document.createElement('div');
    header.className = 'ucp-msg-header';
    header.innerHTML = `
        <span class="ucp-msg-sender">${escapeHtml(message.senderName)}</span>
        <span class="ucp-msg-time">${formatTime(message.timestamp)}</span>
    `;
    el.appendChild(header);

    // Message body
    const body = document.createElement('div');
    body.className = 'ucp-msg-body';
    body.dataset.messageId = message.id;
    if (message.isDeleted) {
        body.innerHTML = '<em class="ucp-deleted-text">This message was deleted</em>';
    } else {
        body.innerHTML = formatMessageContent(message.content);
        if (message.isEdited) {
            body.innerHTML += ' <span class="ucp-edited-tag">(edited)</span>';
        }
    }
    el.appendChild(body);

    // Task link badge - shows when this message has been turned into a task
    const linkedTaskBadge = createTaskLinkBadge(message);
    if (linkedTaskBadge) {
        el.appendChild(linkedTaskBadge);
    }

    // Reactions row
    if (message.reactions && Object.keys(message.reactions).length > 0) {
        el.appendChild(createReactionsRow(message));
    }

    // Actions row (Reply, React, Edit, Task) - shown on hover
    if (!message.isDeleted && message.id) {
        el.appendChild(createActionsRow(message, isOwn));
    }

    // Sub-thread: replies (only created when message has replies)
    if (message.replyCount > 0) {
        el.appendChild(createSubThread(message));
    }

    return el;
}

function createReactionsRow(message) {
    const currentUser = getCurrentUser();
    const row = document.createElement('div');
    row.className = 'ucp-reactions';
    for (const [emoji, users] of Object.entries(message.reactions)) {
        if (users && users.length > 0) {
            const badge = document.createElement('button');
            badge.className = 'ucp-reaction';
            const hasReacted = users.includes(currentUser?.id);
            if (hasReacted) badge.classList.add('reacted');
            badge.innerHTML = `${emoji} <span class="ucp-reaction-count">${users.length}</span>`;
            badge.title = `${users.length} reaction${users.length !== 1 ? 's' : ''}`;
            badge.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleReaction(message.id, emoji, !hasReacted);
            });
            row.appendChild(badge);
        }
    }
    return row;
}

function createActionsRow(message, isOwn) {
    const actions = document.createElement('div');
    actions.className = 'ucp-actions';
    actions.style.position = 'relative';

    // Reply
    const replyBtn = document.createElement('button');
    replyBtn.className = 'ucp-action-btn';
    replyBtn.innerHTML = '↩ Reply';
    replyBtn.addEventListener('click', () => startReply(message));
    actions.appendChild(replyBtn);

    // React
    const reactBtn = document.createElement('button');
    reactBtn.className = 'ucp-action-btn';
    reactBtn.innerHTML = '😊 React';
    reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleEmojiPicker(message.id, actions);
    });
    actions.appendChild(reactBtn);

    // Edit (only own messages)
    if (isOwn) {
        const editBtn = document.createElement('button');
        editBtn.className = 'ucp-action-btn';
        editBtn.innerHTML = '✏️ Edit';
        editBtn.addEventListener('click', () => startEditMessage(message));
        actions.appendChild(editBtn);
    }

    // Task - opens the task GUI modal (shows different state if task already linked)
    const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
    const hasLinkedTask = !!linksObj[message.id];
    const taskBtn = document.createElement('button');
    taskBtn.className = `ucp-action-btn ucp-task-btn${hasLinkedTask ? ' has-task' : ''}`;
    if (hasLinkedTask) {
        const linkedTaskId = linksObj[message.id];
        const linkedTask = state.tasks.all.get(linkedTaskId);
        const linkedStatus = linkedTask?.fields?.Status || 'pending';
        taskBtn.innerHTML = `☑ View Task`;
        taskBtn.classList.add(`task-btn-${linkedStatus}`);
    } else {
        taskBtn.innerHTML = '☑ Task';
    }
    taskBtn.addEventListener('click', () => openTaskModalFromMessage(message));
    actions.appendChild(taskBtn);

    // Keep actions row visible when a task is linked
    if (hasLinkedTask) {
        actions.classList.add('has-linked-task');
    }

    return actions;
}

// ===== TASK LINK BADGE =====

/**
 * Get a human-readable label for task status.
 * @param {string} status
 * @returns {string}
 */
function getTaskStatusLabel(status) {
    switch (status) {
        case 'pending': return 'Pending';
        case 'in_progress': return 'In Progress';
        case 'blocked': return 'Blocked';
        case 'completed': return 'Completed';
        default: return status || 'Pending';
    }
}

/**
 * Apply the correct status CSS class to a task link badge element.
 * Removes any existing task-badge-* class and adds the new one.
 * @param {HTMLElement} badge
 * @param {string} status
 */
function applyBadgeStatusClass(badge, status) {
    // Remove any existing status class
    badge.classList.remove('task-badge-pending', 'task-badge-in_progress', 'task-badge-blocked', 'task-badge-completed');
    const statusClass = `task-badge-${status || 'pending'}`;
    badge.classList.add(statusClass);
}

/**
 * Create a clickable badge showing that this message has been turned into a task.
 * Returns null if no linked task exists.
 * @param {Object} message - The message object
 * @returns {HTMLElement|null}
 */
function createTaskLinkBadge(message) {
    const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
    const linkedTaskId = linksObj[message.id];
    if (!linkedTaskId) return null;

    // Look up task at render time for initial display, but always re-lookup at click time
    const task = state.tasks.all.get(linkedTaskId);
    const taskName = task?.fields?.Name || 'Task';
    const taskStatus = task?.fields?.Status || 'pending';

    console.log('[UCP-TASK DEBUG] createTaskLinkBadge:', { messageId: message.id, linkedTaskId, taskName, taskStatus, taskFound: !!task });

    const badge = document.createElement('div');
    badge.className = 'ucp-task-link-badge';
    badge.dataset.taskId = linkedTaskId;
    badge.dataset.messageId = message.id;
    applyBadgeStatusClass(badge, taskStatus);
    badge.innerHTML = `<span class="ucp-task-link-icon">☑</span> <span class="ucp-task-link-name">${escapeHtml(taskName)}</span> <span class="ucp-task-link-status">${escapeHtml(getTaskStatusLabel(taskStatus))}</span>`;
    badge.title = `Click to open task: ${taskName}`;
    badge.style.cursor = 'pointer';

    badge.addEventListener('click', (e) => {
        e.stopPropagation();
        // Always look up the latest task at click time, not the stale closure reference
        const latestTask = state.tasks.all.get(linkedTaskId);
        console.log('[UCP-TASK DEBUG] Task link badge clicked:', { linkedTaskId, found: !!latestTask });
        if (latestTask) {
            showTaskModal(latestTask, state.session.id);
        } else {
            showToast('Task not found. It may have been deleted.', 3000);
        }
    });

    return badge;
}

/**
 * Listen for task-created-from-message and task-updated events to update the UCP UI in real-time.
 * This avoids needing a full re-render when a task is created or updated from a message.
 */
function setupTaskCreationListener() {
    // Handle new task created from a message
    window.addEventListener('task-created-from-message', (e) => {
        const { messageId, taskId, task } = e.detail;
        console.log('[UCP-TASK DEBUG] Received task-created-from-message event:', { messageId, taskId });
        upsertTaskBadgeForMessage(messageId, taskId, task);
        // Bidirectional: sync task's LinkedItem to the message's context badge
        syncMessageContextFromTask(messageId, task);
        // Refresh tasks tab if it's currently active
        if (currentFilter === 'tasks') {
            const container = document.getElementById('ucp-content');
            if (container) renderTasksTab(container);
        }
    });

    // Handle task updated (name/status changed) — update all badges referencing this task
    window.addEventListener('task-updated-in-chat', (e) => {
        const { taskId, task } = e.detail;
        console.log('[UCP-TASK DEBUG] Received task-updated-in-chat event:', { taskId, name: task?.fields?.Name });
        updateAllBadgesForTask(taskId, task);
        // Bidirectional: sync task's LinkedItem to any linked message's context badge
        const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
        const linkedMessageId = Object.keys(linksObj).find(msgId => linksObj[msgId] === taskId);
        if (linkedMessageId) {
            syncMessageContextFromTask(linkedMessageId, task);
        }
        // Refresh tasks tab if it's currently active
        if (currentFilter === 'tasks') {
            const container = document.getElementById('ucp-content');
            if (container) renderTasksTab(container);
        }
    });

    // When tasks finish loading (e.g. after page refresh), refresh all badges
    // that may have rendered with stale/missing data
    window.addEventListener('tasks-state-updated', () => {
        refreshAllTaskBadges();
        // Refresh tasks tab if it's currently active
        if (currentFilter === 'tasks') {
            const container = document.getElementById('ucp-content');
            if (container) renderTasksTab(container);
        }
    });
}

/**
 * Insert or update a task link badge for a specific message, and update the action button.
 */
function upsertTaskBadgeForMessage(messageId, taskId, task) {
    const msgEl = document.querySelector(`.ucp-msg[data-message-id="${messageId}"]`);
    if (!msgEl) return;

    const taskName = task?.fields?.Name || 'Task';
    const taskStatus = task?.fields?.Status || 'pending';

    // Check if badge already exists
    let badge = msgEl.querySelector('.ucp-task-link-badge');
    if (badge) {
        // Update existing badge content
        badge.dataset.taskId = taskId;
        applyBadgeStatusClass(badge, taskStatus);
        const nameEl = badge.querySelector('.ucp-task-link-name');
        const statusEl = badge.querySelector('.ucp-task-link-status');
        if (nameEl) nameEl.textContent = taskName;
        if (statusEl) statusEl.textContent = getTaskStatusLabel(taskStatus);
        badge.title = `Click to open task: ${taskName}`;
    } else {
        // Create new badge
        badge = document.createElement('div');
        badge.className = 'ucp-task-link-badge';
        badge.dataset.taskId = taskId;
        badge.dataset.messageId = messageId;
        applyBadgeStatusClass(badge, taskStatus);
        badge.innerHTML = `<span class="ucp-task-link-icon">☑</span> <span class="ucp-task-link-name">${escapeHtml(taskName)}</span> <span class="ucp-task-link-status">${escapeHtml(getTaskStatusLabel(taskStatus))}</span>`;
        badge.title = `Click to open task: ${taskName}`;
        badge.style.cursor = 'pointer';

        badge.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const latestTask = state.tasks.all.get(taskId);
            if (latestTask) {
                showTaskModal(latestTask, state.session.id);
            } else {
                showToast('Task not found.', 3000);
            }
        });

        // Insert badge after the message body
        const body = msgEl.querySelector('.ucp-msg-body');
        if (body) {
            body.after(badge);
        } else {
            msgEl.appendChild(badge);
        }
    }

    // Update the task button text in the actions row
    const taskBtn = msgEl.querySelector('.ucp-task-btn');
    if (taskBtn) {
        taskBtn.innerHTML = '☑ View Task';
        taskBtn.classList.add('has-task');
    }
    // Keep actions row visible when task is linked
    const actionsRow = msgEl.querySelector('.ucp-actions');
    if (actionsRow) {
        actionsRow.classList.add('has-linked-task');
    }
}

/**
 * Update all task link badges in the DOM that reference a specific task (after edit).
 */
function updateAllBadgesForTask(taskId, task) {
    const taskName = task?.fields?.Name || 'Task';
    const taskStatus = task?.fields?.Status || 'pending';

    // Find all badges for this task
    const badges = document.querySelectorAll(`.ucp-task-link-badge[data-task-id="${taskId}"]`);
    badges.forEach(badge => {
        applyBadgeStatusClass(badge, taskStatus);
        const nameEl = badge.querySelector('.ucp-task-link-name');
        const statusEl = badge.querySelector('.ucp-task-link-status');
        if (nameEl) nameEl.textContent = taskName;
        if (statusEl) statusEl.textContent = getTaskStatusLabel(taskStatus);
        badge.title = `Click to open task: ${taskName}`;
    });
}

/**
 * Refresh all task link badges currently in the DOM with the latest task data from state.
 * Called when tasks finish loading to fix badges that rendered before task data was available.
 */
function refreshAllTaskBadges() {
    const badges = document.querySelectorAll('.ucp-task-link-badge[data-task-id]');
    if (badges.length === 0) return;

    console.log('[UCP-TASK DEBUG] Refreshing all task badges after tasks-state-updated:', badges.length);
    badges.forEach(badge => {
        const taskId = badge.dataset.taskId;
        const task = state.tasks.all.get(taskId);
        if (task) {
            const taskStatus = task.fields?.Status || 'pending';
            applyBadgeStatusClass(badge, taskStatus);
            const nameEl = badge.querySelector('.ucp-task-link-name');
            const statusEl = badge.querySelector('.ucp-task-link-status');
            if (nameEl) nameEl.textContent = task.fields?.Name || 'Task';
            if (statusEl) statusEl.textContent = getTaskStatusLabel(taskStatus);
            badge.title = `Click to open task: ${task.fields?.Name || 'Task'}`;
            console.log('[UCP-TASK DEBUG] Badge refreshed:', { taskId, status: taskStatus, name: task.fields?.Name });
        }
    });

    // Also refresh the action buttons to reflect linked task state and status color
    const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
    for (const [messageId, taskId] of Object.entries(linksObj)) {
        const msgEl = document.querySelector(`.ucp-msg[data-message-id="${messageId}"]`);
        if (msgEl) {
            const taskBtn = msgEl.querySelector('.ucp-task-btn');
            if (taskBtn) {
                if (!taskBtn.classList.contains('has-task')) {
                    taskBtn.innerHTML = '☑ View Task';
                    taskBtn.classList.add('has-task');
                }
                // Update status color class on the button
                const task = state.tasks.all.get(taskId);
                const taskStatus = task?.fields?.Status || 'pending';
                taskBtn.classList.remove('task-btn-pending', 'task-btn-in_progress', 'task-btn-blocked', 'task-btn-completed');
                taskBtn.classList.add(`task-btn-${taskStatus}`);
            }
            const actionsRow = msgEl.querySelector('.ucp-actions');
            if (actionsRow && !actionsRow.classList.contains('has-linked-task')) {
                actionsRow.classList.add('has-linked-task');
            }
        }
    }
}

/**
 * Sync a message's context badge (plan item attachment) from its linked task's LinkedItem.
 * If the task has a LinkedItem and the message doesn't have a context badge, add one.
 * If the task's LinkedItem changed, update the badge.
 * @param {string} messageId - The message ID
 * @param {Object} task - The task record
 */
function syncMessageContextFromTask(messageId, task) {
    const linkedItemId = task?.fields?.LinkedItem?.[0] || null;
    if (!linkedItemId) return;

    const msgEl = document.querySelector(`.ucp-msg[data-message-id="${messageId}"]`);
    if (!msgEl) return;

    const record = getRecordById(linkedItemId);
    const itemName = record?.fields?.Name || 'Item';

    // Check if a context badge already exists
    let contextBadge = msgEl.querySelector('.ucp-msg-context');
    if (contextBadge) {
        // Update existing badge name
        const nameEl = contextBadge.querySelector('.ucp-context-name');
        if (nameEl) nameEl.textContent = itemName;
    } else {
        // Create a new context badge and insert before the header
        contextBadge = document.createElement('div');
        contextBadge.className = 'ucp-msg-context';
        contextBadge.innerHTML = `<span class="ucp-context-icon">📎</span> <span class="ucp-context-name">${escapeHtml(itemName)}</span>`;
        const header = msgEl.querySelector('.ucp-msg-header');
        if (header) {
            msgEl.insertBefore(contextBadge, header);
        } else {
            msgEl.prepend(contextBadge);
        }
    }

    // Also update the in-memory message's componentId so subsequent renders are correct
    const msg = ucpMessages.find(m => m.id === messageId);
    if (msg && !msg.componentId) {
        msg.componentId = linkedItemId;
    }
}

// ===== TASKS TAB =====

/**
 * Render the Tasks tab content — shows all tasks for the current project
 * grouped by status with color-coded badges.
 * @param {HTMLElement} container - The UCP content container
 */
function renderTasksTab(container) {
    container.innerHTML = '';

    const projectId = state.session?.id;
    const projectTasks = projectId ? (state.tasks.byProject.get(projectId) || []) : [];

    console.log('[UCP-TASKS TAB DEBUG] Rendering tasks tab:', { projectId, taskCount: projectTasks.length });

    if (projectTasks.length === 0) {
        // Check if tasks might still be loading
        const isLoading = projectId && !state.tasks.byProject.has(projectId);
        if (isLoading) {
            container.innerHTML = `
                <div class="ucp-empty">
                    <span class="ucp-empty-icon">⏳</span>
                    <div>Loading tasks...</div>
                </div>
            `;
        } else {
            container.innerHTML = `
                <div class="ucp-empty">
                    <span class="ucp-empty-icon">☑</span>
                    <div>No tasks yet. Create one from any message or the Tasks panel.</div>
                </div>
            `;
        }
        // Hide the input area when in tasks tab
        const inputArea = document.getElementById('ucp-input-area');
        if (inputArea) inputArea.style.display = 'none';
        return;
    }

    // Hide message input when viewing tasks (tasks are managed via the modal)
    const inputArea = document.getElementById('ucp-input-area');
    if (inputArea) inputArea.style.display = 'none';

    // Group tasks by status
    const STATUS_ORDER = [
        { key: 'in_progress', label: 'In Progress', color: '#007bff' },
        { key: 'pending', label: 'Pending', color: '#ffc107' },
        { key: 'blocked', label: 'Blocked', color: '#dc3545' },
        { key: 'completed', label: 'Completed', color: '#28a745' }
    ];

    const grouped = {};
    STATUS_ORDER.forEach(s => { grouped[s.key] = []; });

    projectTasks.forEach(task => {
        const status = task.fields?.Status || 'pending';
        if (grouped[status]) {
            grouped[status].push(task);
        } else {
            grouped['pending'].push(task);
        }
    });

    // Sort each group by Order then createdTime
    Object.values(grouped).forEach(arr => {
        arr.sort((a, b) => {
            const orderA = a.fields?.Order ?? Infinity;
            const orderB = b.fields?.Order ?? Infinity;
            if (orderA !== orderB) return orderA - orderB;
            return new Date(a.createdTime || 0) - new Date(b.createdTime || 0);
        });
    });

    // Create summary header
    const summaryEl = document.createElement('div');
    summaryEl.className = 'ucp-tasks-summary';
    const totalActive = grouped['in_progress'].length + grouped['pending'].length + grouped['blocked'].length;
    const totalCompleted = grouped['completed'].length;
    summaryEl.innerHTML = `
        <div class="ucp-tasks-summary-stats">
            <span class="ucp-tasks-stat"><strong>${projectTasks.length}</strong> total</span>
            <span class="ucp-tasks-stat ucp-tasks-stat-active"><strong>${totalActive}</strong> active</span>
            <span class="ucp-tasks-stat ucp-tasks-stat-done"><strong>${totalCompleted}</strong> done</span>
        </div>
    `;
    container.appendChild(summaryEl);

    // Render each status group
    STATUS_ORDER.forEach(statusDef => {
        const tasks = grouped[statusDef.key];
        if (tasks.length === 0) return;

        const groupEl = document.createElement('div');
        groupEl.className = 'ucp-tasks-group';
        // Hide completed group when toggle is active
        if (statusDef.key === 'completed' && hideCompleted) {
            groupEl.classList.add('ucp-completed-group-hidden');
        }

        const headerEl = document.createElement('div');
        headerEl.className = 'ucp-tasks-group-header';
        headerEl.innerHTML = `
            <span class="ucp-tasks-group-dot" style="background:${statusDef.color}"></span>
            <span class="ucp-tasks-group-label">${statusDef.label}</span>
            <span class="ucp-tasks-group-count">${tasks.length}</span>
        `;
        groupEl.appendChild(headerEl);

        tasks.forEach(task => {
            groupEl.appendChild(createTaskTabCard(task, statusDef));
        });

        container.appendChild(groupEl);
    });
}

/**
 * Create a task card element for the tasks tab in the UCP.
 * @param {Object} task - The task record
 * @param {Object} statusDef - Status definition {key, label, color}
 * @returns {HTMLElement}
 */
function createTaskTabCard(task, statusDef) {
    const fields = task.fields || {};
    const name = fields.Name || 'Untitled Task';
    const status = fields.Status || 'pending';
    const dueDate = fields.DueDate;
    const assignee = fields.Assignee;
    const isCompleted = status === 'completed';

    const card = document.createElement('div');
    card.className = `ucp-task-card${isCompleted ? ' ucp-task-card-completed' : ''}`;
    card.dataset.taskId = task.id;

    let metaHtml = '';
    if (dueDate) {
        const dateObj = new Date(dueDate);
        const formatted = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const isPast = dateObj < new Date() && !isCompleted;
        metaHtml += `<span class="ucp-task-card-due${isPast ? ' overdue' : ''}">${formatted}</span>`;
    }
    if (assignee) {
        const names = assignee.split(',').map(n => n.trim()).filter(Boolean);
        metaHtml += names.map(n => `<span class="ucp-task-card-assignee">${escapeHtml(n)}</span>`).join('');
    }

    card.innerHTML = `
        <div class="ucp-task-card-status-bar" style="background:${statusDef.color}"></div>
        <div class="ucp-task-card-body">
            <span class="ucp-task-card-name${isCompleted ? ' completed' : ''}">${escapeHtml(name)}</span>
            ${metaHtml ? `<div class="ucp-task-card-meta">${metaHtml}</div>` : ''}
        </div>
    `;

    card.style.cursor = 'pointer';
    card.addEventListener('click', () => {
        const latestTask = state.tasks.all.get(task.id);
        if (latestTask) {
            showTaskModal(latestTask, state.session.id);
        } else {
            showToast('Task not found.', 3000);
        }
    });

    return card;
}

// ===== SUB-THREAD (Replies) =====

function createSubThread(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'ucp-subthread';

    const isExpanded = !collapsedThreads.has(message.id);

    const toggle = document.createElement('button');
    toggle.className = 'ucp-subthread-toggle';
    toggle.innerHTML = `
        <span class="ucp-subthread-arrow">${isExpanded ? '▾' : '▸'}</span>
        <span>${message.replyCount} ${message.replyCount === 1 ? 'reply' : 'replies'}</span>
    `;
    toggle.addEventListener('click', () => {
        toggleSubThread(message.id, wrapper);
    });
    wrapper.appendChild(toggle);

    const repliesContainer = document.createElement('div');
    repliesContainer.className = `ucp-subthread-replies ${isExpanded ? 'expanded' : ''}`;
    repliesContainer.id = `ucp-replies-${message.id}`;

    if (isExpanded && message.replies.length > 0) {
        message.replies.forEach(reply => {
            repliesContainer.appendChild(createReplyMessage(reply));
        });
    }
    wrapper.appendChild(repliesContainer);

    return wrapper;
}

function createReplyMessage(reply) {
    const currentUser = getCurrentUser();
    const isOwn = reply.senderId === currentUser?.id;
    const el = document.createElement('div');
    el.className = 'ucp-reply';
    el.dataset.messageId = reply.id;

    const header = document.createElement('div');
    header.className = 'ucp-reply-header';
    header.innerHTML = `
        <span class="ucp-reply-sender">${escapeHtml(reply.senderName)}</span>
        <span class="ucp-reply-time">${formatTime(reply.timestamp)}</span>
    `;
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'ucp-reply-body';
    body.dataset.messageId = reply.id;
    if (reply.isDeleted) {
        body.innerHTML = '<em class="ucp-deleted-text">Deleted</em>';
    } else {
        body.innerHTML = formatMessageContent(reply.content);
        if (reply.isEdited) {
            body.innerHTML += ' <span class="ucp-edited-tag">(edited)</span>';
        }
    }
    el.appendChild(body);

    // Reactions on replies
    if (reply.reactions && Object.keys(reply.reactions).length > 0) {
        el.appendChild(createReactionsRow(reply));
    }

    // Reply actions (react, edit for own)
    if (!reply.isDeleted && reply.id) {
        const actions = document.createElement('div');
        actions.className = 'ucp-actions ucp-reply-actions';
        actions.style.position = 'relative';

        const reactBtn = document.createElement('button');
        reactBtn.className = 'ucp-action-btn';
        reactBtn.innerHTML = '😊';
        reactBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleEmojiPicker(reply.id, actions);
        });
        actions.appendChild(reactBtn);

        if (isOwn) {
            const editBtn = document.createElement('button');
            editBtn.className = 'ucp-action-btn';
            editBtn.innerHTML = '✏️';
            editBtn.addEventListener('click', () => startEditMessage(reply));
            actions.appendChild(editBtn);
        }

        el.appendChild(actions);
    }

    return el;
}

function toggleSubThread(messageId, wrapper) {
    const container = wrapper.querySelector(`#ucp-replies-${messageId}`);
    const toggle = wrapper.querySelector('.ucp-subthread-toggle');
    if (!container) return;

    const isExpanded = !collapsedThreads.has(messageId);

    if (isExpanded) {
        collapsedThreads.add(messageId);
        container.classList.remove('expanded');
        if (toggle) toggle.querySelector('.ucp-subthread-arrow').textContent = '▸';
    } else {
        collapsedThreads.delete(messageId);
        container.classList.add('expanded');
        if (toggle) toggle.querySelector('.ucp-subthread-arrow').textContent = '▾';

        const msg = ucpMessages.find(m => m.id === messageId);
        if (container.children.length === 0 && msg?.replies.length > 0) {
            msg.replies.forEach(reply => {
                container.appendChild(createReplyMessage(reply));
            });
        }
    }
}

// ===== EMOJI PICKER =====

function toggleEmojiPicker(messageId, actionsContainer) {
    const existing = document.querySelector('.ucp-emoji-picker.open');
    if (existing) {
        existing.classList.remove('open');
        if (openEmojiPicker === messageId) {
            openEmojiPicker = null;
            return;
        }
    }

    let picker = actionsContainer.querySelector('.ucp-emoji-picker');
    if (!picker) {
        picker = document.createElement('div');
        picker.className = 'ucp-emoji-picker';
        QUICK_REACTIONS.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = 'ucp-emoji-pick';
            btn.textContent = emoji;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleReaction(messageId, emoji, true);
                picker.classList.remove('open');
                openEmojiPicker = null;
            });
            picker.appendChild(btn);
        });
        actionsContainer.appendChild(picker);
    }

    picker.classList.add('open');
    openEmojiPicker = messageId;

    const closeHandler = (e) => {
        if (!picker.contains(e.target) && !e.target.closest('.ucp-action-btn')) {
            picker.classList.remove('open');
            openEmojiPicker = null;
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

// ===== REACTIONS =====

async function toggleReaction(messageId, emoji, add) {
    const currentUser = getCurrentUser();
    if (!messageId || !currentUser) return;

    const result = await api.toggleMessageReaction(messageId, currentUser.id, emoji, add);
    if (result !== null) {
        const msg = findMessageById(messageId);
        if (msg) {
            msg.reactions = result;
        }
        renderContent();
    }
}

function findMessageById(id) {
    const found = ucpMessages.find(m => m.id === id);
    if (found) return found;
    for (const msg of ucpMessages) {
        const reply = msg.replies.find(r => r.id === id);
        if (reply) return reply;
    }
    return null;
}

// ===== REPLY SYSTEM =====

function startReply(message) {
    replyingTo = { id: message.id, sender: message.senderName, preview: message.content };

    const indicator = document.getElementById('ucp-reply-indicator');
    const textEl = indicator?.querySelector('.ucp-reply-text');
    if (indicator && textEl) {
        textEl.innerHTML = `Replying to <strong>${escapeHtml(message.senderName)}</strong>: ${escapeHtml(message.content.substring(0, 50))}${message.content.length > 50 ? '...' : ''}`;
        indicator.style.display = 'flex';
    }

    const input = document.getElementById('ucp-message-input');
    if (input) input.focus();
}

function cancelReply() {
    replyingTo = null;
    const indicator = document.getElementById('ucp-reply-indicator');
    if (indicator) indicator.style.display = 'none';
}

// ===== MESSAGE EDITING =====

function startEditMessage(message) {
    editingMessage = { id: message.id, content: message.content };

    // Find the body element for this message
    const bodyEl = document.querySelector(`.ucp-msg-body[data-message-id="${message.id}"], .ucp-reply-body[data-message-id="${message.id}"]`);
    if (!bodyEl) return;

    const originalContent = message.content;
    bodyEl.innerHTML = '';

    const editInput = document.createElement('input');
    editInput.type = 'text';
    editInput.className = 'ucp-edit-input';
    editInput.value = originalContent;
    bodyEl.appendChild(editInput);

    const editActions = document.createElement('div');
    editActions.className = 'ucp-edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'ucp-edit-save';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'ucp-edit-cancel';
    cancelBtn.textContent = 'Cancel';

    editActions.appendChild(saveBtn);
    editActions.appendChild(cancelBtn);
    bodyEl.appendChild(editActions);

    editInput.focus();
    editInput.select();

    const saveEdit = async () => {
        const newContent = editInput.value.trim();
        if (newContent && newContent !== originalContent) {
            const currentUser = getCurrentUser();
            const result = await api.updateChatMessage(message.id, newContent, currentUser?.id);
            if (result) {
                showToast('Message updated', 1500);
                editingMessage = null;
                await loadPanelData();
                return;
            }
        }
        cancelEdit();
    };

    const cancelEdit = () => {
        editingMessage = null;
        bodyEl.innerHTML = formatMessageContent(originalContent);
        if (message.isEdited) {
            bodyEl.innerHTML += ' <span class="ucp-edited-tag">(edited)</span>';
        }
    };

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEdit);
    editInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') cancelEdit();
    });
}

// ===== MESSAGE SUBMISSION =====

async function handleMessageSubmit(e) {
    e.preventDefault();

    const input = document.getElementById('ucp-message-input');
    const message = input?.value?.trim();
    if (!message) return;

    const currentUser = getCurrentUser();
    if (!currentUser) {
        showToast('Please sign in to send messages', 3000);
        return;
    }

    const sessionId = state.session?.id;
    if (!sessionId) return;

    input.value = '';
    shouldScrollToBottom = true;

    try {
        if (replyingTo) {
            const result = await api.postReplyMessage(
                replyingTo.id, sessionId, null,
                currentUser.id, currentUser.name, message
            );
            if (result) {
                cancelReply();
                await loadPanelData();
            }
        } else if (currentFilter === 'ideas') {
            const ideaContent = `[IDEA] ${message}`;
            if (sendChatMessageFn) {
                await sendChatMessageFn(ideaContent, null);
            } else {
                await api.postChatMessage(sessionId, currentUser.id, currentUser.name, ideaContent, null);
            }
            await loadPanelData();
        } else {
            const attachSelect = document.getElementById('ucp-attach-select');
            const itemId = attachSelect?.value || null;
            if (sendChatMessageFn) {
                await sendChatMessageFn(message, itemId);
            } else {
                await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message, itemId);
            }
            await loadPanelData();
        }
    } catch (error) {
        log('UCP', 'Error sending message:', error);
        showToast('Failed to send message', 3000);
    }
}

// ===== TASK CREATION (opens task GUI modal) =====

function openTaskModalFromMessage(message) {
    const currentUser = getCurrentUser();
    if (!currentUser) {
        showToast('Please sign in to create tasks', 3000);
        return;
    }

    // Permission check
    const currentRole = state.permissions?.currentRole;
    const isLoadingPerms = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoadingPerms && canEditByRole) || canEditByOwnership;

    if (!canUserEdit) {
        showToast('You do not have permission to create tasks', 3000);
        return;
    }

    console.log('[UCP-TASK DEBUG] openTaskModalFromMessage called:', {
        messageId: message.id,
        content: message.content?.substring(0, 50),
        componentId: message.componentId,
        sessionId: state.session.id
    });

    // Check if this message already has a linked task
    const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
    const existingTaskId = linksObj[message.id];
    if (existingTaskId) {
        const existingTask = state.tasks.all.get(existingTaskId);
        if (existingTask) {
            console.log('[UCP-TASK DEBUG] Message already has linked task, opening for edit:', existingTaskId);
            showTaskModal(existingTask, state.session.id);
            return;
        }
    }

    // Pre-fill task data from the message and open the full task modal
    const prefillTask = {
        fields: {
            Name: message.content.substring(0, 100) + (message.content.length > 100 ? '...' : ''),
            Description: `From comment by ${message.senderName}: ${message.content}`,
            Status: api.TASK_STATUS.PENDING,
            LinkedItem: (message.componentId && message.componentId.startsWith('rec')) ? [message.componentId] : null
        }
    };

    // Open the task manager's GUI modal with pre-filled data and the source message ID
    showTaskModal(prefillTask, state.session.id, message.id);
}

// ===== ONLINE COUNT =====

function updateOnlineCount() {
    const countEl = document.getElementById('ucp-online-count');
    if (!countEl) return;

    const presenceCounter = document.getElementById('presence-counter');
    const count = presenceCounter ? parseInt(presenceCounter.textContent || '0', 10) : 0;
    countEl.textContent = count || 0;

    const whosHereCount = document.getElementById('whos-here-count');
    if (whosHereCount) {
        const whCount = parseInt(whosHereCount.textContent || '0', 10);
        if (whCount > count) countEl.textContent = whCount;
    }
}

export function updateUCPOnlineCount(count) {
    const countEl = document.getElementById('ucp-online-count');
    if (countEl) countEl.textContent = count;
}

/**
 * Open the UCP filtered to comments for a specific item.
 * Called from the detail modal's discussion button.
 * Expands the panel if collapsed, switches to Comments filter,
 * pre-selects the item in the attach dropdown, and scrolls to show relevant messages.
 * @param {string} recordId - The item record ID to filter discussion for
 */
export async function openUCPForItem(recordId) {
    // Ensure the panel is visible
    const panel = document.getElementById('unified-chat-panel');
    if (!panel) return;

    // Open the panel using the standard mechanism
    document.body.classList.add('ucp-panel-open');
    document.body.classList.add('ucp-panel-active');
    panelOpen = true;

    // Switch to Comments filter
    currentFilter = 'comments';
    const filterBtns = document.querySelectorAll('.ucp-filter-btn');
    filterBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === 'comments');
    });

    // Pre-select the item in the attach dropdown
    const attachSelect = document.getElementById('ucp-attach-select');
    if (attachSelect) {
        // Ensure the option exists
        let optionExists = false;
        for (const opt of attachSelect.options) {
            if (opt.value === recordId) {
                optionExists = true;
                break;
            }
        }
        if (!optionExists) {
            populateAttachSelect();
        }
        attachSelect.value = recordId;
    }

    // Load data and render with comments filter
    shouldScrollToBottom = true;
    await loadPanelData();

    // Focus the input for immediate typing
    const input = document.getElementById('ucp-message-input');
    if (input) {
        input.placeholder = 'Comment on this item...';
        setTimeout(() => input.focus(), 100);
    }
}

// ===== v3.8: FULL-SCREEN MODE =====

function setupFullscreenToggle() {
    const btn = document.getElementById('ucp-fullscreen-btn');
    if (btn) {
        btn.addEventListener('click', toggleFullscreen);
    }
}

export function toggleFullscreen() {
    const panel = document.getElementById('unified-chat-panel');
    if (!panel) return;

    isFullscreen = !isFullscreen;

    if (isFullscreen) {
        panel.classList.add('ucp-fullscreen');
        document.body.classList.add('ucp-fullscreen-active');
    } else {
        panel.classList.remove('ucp-fullscreen');
        document.body.classList.remove('ucp-fullscreen-active');
    }

    // Update icon
    const icon = document.getElementById('ucp-fullscreen-icon');
    if (icon) {
        icon.innerHTML = isFullscreen ? '&#x2716;' : '&#x26F6;';
    }

    // Update button title
    const btn = document.getElementById('ucp-fullscreen-btn');
    if (btn) {
        btn.title = isFullscreen ? 'Exit full screen' : 'Expand to full screen';
    }

    // Show/hide video area based on stream state
    updateUCPVideoArea();
}

export function updateUCPVideoArea() {
    const videoArea = document.getElementById('ucp-video-area');
    if (!videoArea) return;

    const streamActive = state.stream?.isActive;

    // Show video area only when in fullscreen AND stream is active
    if (isFullscreen && streamActive) {
        videoArea.style.display = '';
    } else {
        videoArea.style.display = 'none';
    }
}

export function updateUCPLiveBadge() {
    const badge = document.getElementById('ucp-live-badge');
    if (!badge) return;

    badge.style.display = state.stream?.isActive ? '' : 'none';
}

export function isUCPFullscreen() {
    return isFullscreen;
}

export function exitFullscreen() {
    if (!isFullscreen) return;
    toggleFullscreen();
}

// ===== UTILITIES =====

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatMessageContent(content) {
    if (!content) return '';

    let html = escapeHtml(content);

    html = html.replace(
        /(https?:\/\/[^\s<]+)/g,
        '<a href="$1" target="_blank" rel="noopener">$1</a>'
    );

    html = html.replace(/\n/g, '<br>');

    return html;
}

// ===== CHAT MENU ACTIONS (Clear/Archive) =====

function setupChatMenuActions() {
    const menuBtn = document.getElementById('ucp-menu-btn');
    if (!menuBtn) return;

    menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleChatMenu();
    });
}

function toggleChatMenu() {
    const existing = document.querySelector('.ucp-chat-menu');
    if (existing) {
        existing.remove();
        return;
    }

    const menuBtn = document.getElementById('ucp-menu-btn');
    if (!menuBtn) return;

    const menu = document.createElement('div');
    menu.className = 'ucp-chat-menu';

    // Permission check
    const currentRole = state.permissions?.currentRole;
    const isLoadingPerms = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit ? api.canEdit(currentRole) : false;
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoadingPerms && canEditByRole) || canEditByOwnership;

    const messageCount = ucpMessages.length;

    menu.innerHTML = `
        <button class="ucp-chat-menu-item ${!canUserEdit || messageCount === 0 ? 'disabled' : ''}" data-action="clear">
            <span class="ucp-chat-menu-icon">🗑</span>
            <span>Clear Conversation</span>
            ${messageCount > 0 ? `<span class="ucp-chat-menu-count">${messageCount}</span>` : ''}
        </button>
    `;

    menuBtn.parentElement.appendChild(menu);

    // Attach handlers
    const clearBtn = menu.querySelector('[data-action="clear"]');
    if (clearBtn && canUserEdit && messageCount > 0) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.remove();
            handleClearConversation();
        });
    }

    // Close on outside click
    const closeHandler = (e) => {
        if (!menu.contains(e.target) && e.target !== menuBtn) {
            menu.remove();
            document.removeEventListener('click', closeHandler);
        }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 10);
}

async function handleClearConversation() {
    const messageCount = ucpMessages.length;
    if (messageCount === 0) {
        showToast('No messages to clear', 2000);
        return;
    }

    // Show confirmation dialog
    const confirmed = confirm(
        `Clear all ${messageCount} message${messageCount !== 1 ? 's' : ''} in this conversation?\n\nThis cannot be undone.`
    );

    if (!confirmed) return;

    const sessionId = state.session?.id;
    if (!sessionId) return;

    showToast('Clearing conversation...', 2000);

    try {
        const result = await api.clearChatMessages(sessionId);

        if (result.success > 0) {
            // Clear local state
            ucpMessages = [];
            ucpPlanEvents = [];
            shouldScrollToBottom = true;
            renderContent();
            showToast(`Cleared ${result.success} message${result.success !== 1 ? 's' : ''}`, 3000);
        } else if (result.failed > 0) {
            showToast('Failed to clear some messages', 3000);
        } else {
            showToast('No messages to clear', 2000);
        }
    } catch (error) {
        log('UCP', 'Error clearing conversation:', error);
        showToast('Failed to clear conversation', 3000);
    }
}
