// FILE: components/unifiedChatPanel.js
// Unified Chat Panel - Persistent side panel for presentation view
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
let panelOpen = true;
let panelCollapsed = false;
let currentFilter = 'all'; // 'all' | 'comments' | 'ideas'
let ucpMessages = [];
let ucpPlanEvents = [];
let replyingTo = null;
let editingMessage = null; // { id, content } for inline editing
let isLoading = false;
let collapsedThreads = new Set();
let openEmojiPicker = null;
let initialized = false;
let shouldScrollToBottom = true;

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

    setupPanelToggle();
    setupFilters();
    setupMessageForm();
    setupMobileToggle();
    setupChatMenuActions();

    initialized = true;
    log('UCP', 'Unified Chat Panel initialized.');
}

export async function showUnifiedChatPanel() {
    const overlay = document.getElementById('presentation-modal-overlay');
    if (overlay) {
        overlay.classList.add('ucp-open');
    }
    document.body.classList.add('ucp-panel-active');
    panelOpen = true;
    shouldScrollToBottom = true;

    populateAttachSelect();
    await loadPanelData();
    updateOnlineCount();
}

export function hideUnifiedChatPanel() {
    const overlay = document.getElementById('presentation-modal-overlay');
    if (overlay) {
        overlay.classList.remove('ucp-open');
    }
    document.body.classList.remove('ucp-panel-active');
    panelOpen = false;
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

function setupPanelToggle() {
    const toggleBtn = document.getElementById('ucp-toggle-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const panel = document.getElementById('unified-chat-panel');
            if (!panel) return;
            panelCollapsed = !panelCollapsed;
            panel.classList.toggle('collapsed', panelCollapsed);
        });
    }

    // Allow clicking anywhere on the collapsed panel to expand it
    const panel = document.getElementById('unified-chat-panel');
    if (panel) {
        panel.addEventListener('click', (e) => {
            if (panelCollapsed && !e.target.closest('.ucp-toggle-btn') && !e.target.closest('.ucp-menu-btn')) {
                panelCollapsed = false;
                panel.classList.remove('collapsed');
            }
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

function setupMobileToggle() {
    const mobileToggle = document.getElementById('ucp-mobile-toggle');
    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            const overlay = document.getElementById('presentation-modal-overlay');
            if (overlay) {
                overlay.classList.toggle('ucp-open');
                panelOpen = overlay.classList.contains('ucp-open');
                document.body.classList.toggle('ucp-panel-active', panelOpen);
                if (panelOpen) loadPanelData();
            }
        });
    }
}

function populateAttachSelect() {
    const select = document.getElementById('ucp-attach-select');
    if (!select) return;

    select.innerHTML = '<option value="">Plan-wide chat</option>';

    const planItems = state.cart?.lockedItems || new Map();
    const allItems = planItems.size > 0 ? planItems : (state.records?.all ? new Map(state.records.all.map(r => [r.id, r])) : new Map());

    allItems.forEach((item, id) => {
        const name = item.fields?.Name || item.fields?.['Item Name'] || item.name || 'Unknown';
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
        default: input.placeholder = 'Message the team...'; break;
    }
}

function getEmptyMessage() {
    switch (currentFilter) {
        case 'comments': return 'No item comments yet. Discuss plan items!';
        case 'ideas': return 'No ideas shared yet. Suggest something!';
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

    let classes = 'ucp-msg';
    if (isOwn) classes += ' ucp-msg-own';
    if (message.componentId) classes += ' ucp-msg-comment';
    if (message.isIdea) classes += ' ucp-msg-idea';
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

    // Task - opens the task GUI modal
    const taskBtn = document.createElement('button');
    taskBtn.className = 'ucp-action-btn ucp-task-btn';
    taskBtn.innerHTML = '☑ Task';
    taskBtn.addEventListener('click', () => openTaskModalFromMessage(message));
    actions.appendChild(taskBtn);

    return actions;
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

    // Pre-fill task data from the message and open the full task modal
    const prefillTask = {
        fields: {
            Name: message.content.substring(0, 100) + (message.content.length > 100 ? '...' : ''),
            Description: `From comment by ${message.senderName}: ${message.content}`,
            Status: api.TASK_STATUS.PENDING,
            LinkedItem: (message.componentId && message.componentId.startsWith('rec')) ? [message.componentId] : null
        }
    };

    // Open the task manager's GUI modal with pre-filled data
    showTaskModal(prefillTask, state.session.id);
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
    // Ensure the panel is visible and expanded
    const panel = document.getElementById('unified-chat-panel');
    if (!panel) return;

    if (panelCollapsed) {
        panelCollapsed = false;
        panel.classList.remove('collapsed');
    }

    // Ensure presentation overlay has ucp-open class
    const overlay = document.getElementById('presentation-modal-overlay');
    if (overlay && !overlay.classList.contains('ucp-open')) {
        overlay.classList.add('ucp-open');
    }
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
