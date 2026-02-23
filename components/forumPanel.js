// FILE: components/forumPanel.js
// Forum Panel - Expanded view for threaded discussions, comments, and plan history
// Slides in from the right side, parallel to the presentation view

import { state, getRecordById } from '../state.js';
import { log } from '../utils/debug.js';
import { computeDemocraticAverage, convertMessageReactions } from '../config.js';
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
    // Fallback to state-based user info
    return state.session?.user?.id ? {
        id: state.session.user.id,
        name: state.session.user.name || 'User'
    } : null;
}

// Forum filter types
export const FORUM_FILTER_TYPES = {
    ALL: 'all',
    THREADS: 'threads',    // Only messages with replies (Chat tab)
    COMMENTS: 'comments',  // Component comments
    IDEAS: 'ideas',        // Ideas - free-form suggestions from collaborators
    HISTORY: 'history'     // Plan events
};

// Event type display labels and icons (same as chat.js)
const EVENT_TYPE_DISPLAY = {
    'plan_created': { icon: '🎯', label: 'Plan Created', color: '#667eea' },
    'ai_interpretation': { icon: '🤖', label: 'AI Analysis', color: '#764ba2' },
    'plan_updated': { icon: '✏️', label: 'Plan Updated', color: '#28a745' },
    'task_added': { icon: '✅', label: 'Task Added', color: '#17a2b8' },
    'item_added': { icon: '📦', label: 'Item Added', color: '#ffc107' },
    'collaborator_joined': { icon: '👋', label: 'Collaborator Joined', color: '#6f42c1' },
    'reaction_added': { icon: '😊', label: 'Reaction', color: '#ff6b6b' },
    'idea_posted': { icon: '💡', label: 'New Idea', color: '#f0ad4e' },
    'idea_promoted': { icon: '🚀', label: 'Idea Promoted', color: '#28a745' },
    'rsvp_response': { icon: '📬', label: 'RSVP Response', color: '#17a2b8' },
    'task_completed': { icon: '🏁', label: 'Task Completed', color: '#28a745' }
};

// Quick emoji reactions
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

// Local state
let currentFilter = FORUM_FILTER_TYPES.ALL;
let currentItemFilter = null; // When set, filters comments to a specific item recordId
let forumMessages = [];
let forumPlanEvents = [];
let isLoading = false;
// Track collapsed threads (inverted logic - threads are expanded by default)
let collapsedThreads = new Set();
let replyingToMessage = null; // Track message being replied to in forum

// ===== NOTIFICATION COUNTS SYSTEM =====
// Tracks last-seen timestamps per filter type to calculate unread counts
// Stored in localStorage for persistence across sessions

const STORAGE_KEY_PREFIX = 'wtf_forum_seen_';

/**
 * Get the localStorage key for storing last-seen timestamps
 * @returns {string} Storage key unique to user and session
 */
function getStorageKey() {
    const sessionId = state.session?.id;
    const userId = getCurrentUser()?.id;
    if (!sessionId || !userId) return null;
    return `${STORAGE_KEY_PREFIX}${sessionId}_${userId}`;
}

/**
 * Get last-seen timestamps for all filter types
 * @returns {Object} Object with filter types as keys and ISO timestamp strings as values
 */
function getLastSeenTimestamps() {
    const key = getStorageKey();
    if (!key) return {};
    try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : {};
    } catch (e) {
        log('ForumPanel', 'Error reading last-seen timestamps:', e);
        return {};
    }
}

/**
 * Save last-seen timestamp for a filter type
 * @param {string} filterType - Filter type from FORUM_FILTER_TYPES
 * @param {string} timestamp - ISO timestamp string
 */
function saveLastSeenTimestamp(filterType, timestamp) {
    const key = getStorageKey();
    if (!key) return;
    try {
        const timestamps = getLastSeenTimestamps();
        timestamps[filterType] = timestamp;
        localStorage.setItem(key, JSON.stringify(timestamps));
        log('ForumPanel', `Saved last-seen for ${filterType}: ${timestamp}`);
    } catch (e) {
        log('ForumPanel', 'Error saving last-seen timestamp:', e);
    }
}

/**
 * Mark current filter as seen (called when user views content)
 * Uses the most recent item's timestamp in that filter
 */
function markCurrentFilterAsSeen() {
    const items = getItemsForFilter(currentFilter);
    log('ForumPanel', `[Notification] markCurrentFilterAsSeen - filter: ${currentFilter}, items count: ${items.length}`);
    if (items.length === 0) {
        log('ForumPanel', '[Notification] No items to mark as seen');
        return;
    }

    // Debug: log first few items' timestamps
    const sampleItems = items.slice(0, 3).map(item => ({
        id: item.id,
        timestamp: item.timestamp,
        itemType: item.itemType || 'message'
    }));
    log('ForumPanel', `[Notification] Sample items timestamps: ${JSON.stringify(sampleItems)}`);

    // Find the most recent timestamp in the current view
    const mostRecentTimestamp = items.reduce((latest, item) => {
        const itemTime = new Date(item.timestamp);
        const latestTime = new Date(latest);
        // Handle invalid dates
        if (isNaN(itemTime.getTime())) {
            log('ForumPanel', `[Notification] Invalid timestamp for item ${item.id}: ${item.timestamp}`);
            return latest;
        }
        if (isNaN(latestTime.getTime())) {
            return item.timestamp;
        }
        return itemTime > latestTime ? item.timestamp : latest;
    }, items[0].timestamp);

    log('ForumPanel', `[Notification] Most recent timestamp determined: ${mostRecentTimestamp}`);
    saveLastSeenTimestamp(currentFilter, mostRecentTimestamp);
    updateNotificationBadges();
}

/**
 * Get items for a specific filter type
 * @param {string} filterType - Filter type from FORUM_FILTER_TYPES
 * @returns {Array} Array of items (messages or events) for that filter
 */
function getItemsForFilter(filterType) {
    switch (filterType) {
        case FORUM_FILTER_TYPES.ALL:
            return [
                ...forumMessages.map(m => ({ ...m, itemType: 'message' })),
                ...forumPlanEvents.map(e => ({ ...e, itemType: 'event' }))
            ];
        case FORUM_FILTER_TYPES.THREADS:
            return forumMessages.filter(m => !m.isIdea);
        case FORUM_FILTER_TYPES.COMMENTS:
            return forumMessages.filter(m => m.componentId);
        case FORUM_FILTER_TYPES.IDEAS:
            return forumMessages.filter(m => m.isIdea);
        case FORUM_FILTER_TYPES.HISTORY:
            return forumPlanEvents;
        default:
            return [];
    }
}

/**
 * Calculate unread count for a specific filter type
 * @param {string} filterType - Filter type from FORUM_FILTER_TYPES
 * @returns {number} Number of unread items
 */
function getUnreadCount(filterType) {
    const lastSeen = getLastSeenTimestamps()[filterType];
    const items = getItemsForFilter(filterType);

    if (!lastSeen) {
        // Never seen this filter - all items are "new" but show 0 initially
        // (user needs to view once to set baseline)
        log('ForumPanel', `[Notification] getUnreadCount(${filterType}): no lastSeen, returning 0`);
        return 0;
    }

    const lastSeenDate = new Date(lastSeen);
    const currentUser = getCurrentUser();

    // Count items newer than last-seen, excluding user's own messages
    const unreadItems = items.filter(item => {
        const itemDate = new Date(item.timestamp);
        const isNewer = itemDate > lastSeenDate;
        const isOwnMessage = item.senderId === currentUser?.id;
        return isNewer && !isOwnMessage;
    });

    log('ForumPanel', `[Notification] getUnreadCount(${filterType}): lastSeen=${lastSeen}, items=${items.length}, unread=${unreadItems.length}`);
    return unreadItems.length;
}

/**
 * Get total unread count across all filters (for trigger button badge)
 * Uses the 'all' filter's timestamp as the baseline
 * @returns {number} Total unread items
 */
function getTotalUnreadCount() {
    const lastSeen = getLastSeenTimestamps()[FORUM_FILTER_TYPES.ALL];
    if (!lastSeen) return 0;

    const lastSeenDate = new Date(lastSeen);
    const currentUser = getCurrentUser();

    // Combine all unique items (messages + events)
    const allItems = [
        ...forumMessages,
        ...forumPlanEvents
    ];

    return allItems.filter(item => {
        const itemDate = new Date(item.timestamp);
        const isNewer = itemDate > lastSeenDate;
        const isOwnMessage = item.senderId === currentUser?.id;
        return isNewer && !isOwnMessage;
    }).length;
}

/**
 * Update notification badges on filter tabs and trigger button
 * @param {Object} options - Optional configuration
 * @param {Array} options.messages - Messages array from external source (chat.js sessionHistoryItems)
 * @param {Array} options.events - Events array from external source
 */
export function updateNotificationBadges(options = {}) {
    // If external data is provided, use it to populate the local arrays
    // This allows badge calculation before the forum panel is opened
    if (options.messages || options.events) {
        if (options.messages && options.messages.length > 0) {
            // Transform chat.js sessionHistoryItems format to forumPanel format
            forumMessages = options.messages.map(item => ({
                id: item.data?.messageId || item.id,
                senderId: item.data?.senderId || item.senderId,
                senderName: item.data?.sender || item.senderName || 'Anonymous',
                content: item.data?.message || item.content || '',
                timestamp: item.timestamp || item.data?.timestamp,
                reactions: item.data?.reactions || {},
                replyCount: item.data?.replyCount || 0,
                componentId: item.data?.componentInfo?.id || null,
                itemType: 'message'
            }));
        }
        if (options.events && options.events.length > 0) {
            forumPlanEvents = options.events.map(item => {
                // Parse system event content
                let eventData = {};
                try {
                    const content = item.data?.fields?.Content || item.data?.Content || '';
                    if (content) eventData = JSON.parse(content);
                } catch (e) {
                    // Not JSON, use raw data
                }
                return {
                    id: item.data?.id || item.id,
                    type: eventData.type || item.data?.fields?.EventType || 'event',
                    data: eventData.data || {},
                    timestamp: item.timestamp || item.data?.createdTime,
                    itemType: 'event'
                };
            });
        }
        log('ForumPanel', `[Notification] Populated from external data - messages: ${forumMessages.length}, events: ${forumPlanEvents.length}`);
    }

    // Debug: log current state
    log('ForumPanel', `[Notification] updateNotificationBadges - messages: ${forumMessages.length}, events: ${forumPlanEvents.length}`);

    // Update filter tab badges
    const filterBtns = document.querySelectorAll('.forum-filter-btn');
    log('ForumPanel', `[Notification] Found ${filterBtns.length} filter buttons`);

    filterBtns.forEach(btn => {
        const filterType = btn.dataset.filter;
        const count = getUnreadCount(filterType);
        log('ForumPanel', `[Notification] Filter ${filterType}: unread count = ${count}`);

        // Remove existing badge
        const existingBadge = btn.querySelector('.notification-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // Add badge if there are unread items
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'notification-badge';
            badge.textContent = count > 99 ? '99+' : count.toString();
            btn.appendChild(badge);
            log('ForumPanel', `[Notification] Added badge to ${filterType} with count ${count}`);
        }
    });

    // Update forum trigger button badge
    updateTriggerButtonBadge();

    log('ForumPanel', 'Notification badges updated');
}

/**
 * Update the forum trigger button badge with total unread count
 */
function updateTriggerButtonBadge() {
    const triggerBtn = document.getElementById('forum-panel-trigger');
    if (!triggerBtn) return;

    const totalCount = getTotalUnreadCount();
    log('ForumPanel', `[Notification] Trigger button - total unread: ${totalCount}`);

    // Remove existing badge
    const existingBadge = triggerBtn.querySelector('.notification-badge');
    if (existingBadge) {
        existingBadge.remove();
    }

    // Add badge if there are unread items
    if (totalCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'notification-badge';
        badge.textContent = totalCount > 99 ? '99+' : totalCount.toString();
        triggerBtn.appendChild(badge);
        log('ForumPanel', `[Notification] Added trigger badge with count ${totalCount}`);
    }
}

/**
 * Initialize notification tracking for a new session
 * Sets initial baseline timestamps if user has never visited
 * Exported so it can be called early from chat.js when messages load
 */
export function initializeNotificationTracking() {
    const key = getStorageKey();
    log('ForumPanel', `[Notification] initializeNotificationTracking - storage key: ${key}`);
    if (!key) {
        log('ForumPanel', '[Notification] No storage key available - user or session not ready');
        return;
    }

    const existing = getLastSeenTimestamps();
    const now = new Date().toISOString();
    log('ForumPanel', `[Notification] Existing timestamps: ${JSON.stringify(existing)}`);

    // If user has never visited, set current time as baseline for all filters
    // This prevents showing all historical items as "unread"
    if (Object.keys(existing).length === 0) {
        const initialTimestamps = {
            [FORUM_FILTER_TYPES.ALL]: now,
            [FORUM_FILTER_TYPES.THREADS]: now,
            [FORUM_FILTER_TYPES.COMMENTS]: now,
            [FORUM_FILTER_TYPES.IDEAS]: now,
            [FORUM_FILTER_TYPES.HISTORY]: now
        };
        try {
            localStorage.setItem(key, JSON.stringify(initialTimestamps));
            log('ForumPanel', `[Notification] Initialized notification tracking with baseline: ${now}`);
        } catch (e) {
            log('ForumPanel', 'Error initializing notification tracking:', e);
        }
    } else {
        log('ForumPanel', '[Notification] Notification tracking already initialized');
    }
}

/**
 * Increment unread count for new items received via Pusher
 * Called when real-time events arrive (new messages, reactions, etc.)
 * @param {string} itemType - Type of item: 'message', 'reaction', 'event'
 * @param {Object} data - Item data with timestamp and optional sessionHistoryItems
 */
export function onNewItemReceived(itemType, data) {
    // Just update badges - the data is already added to forumMessages/forumPlanEvents
    // via refreshForumData() calls from chat.js
    log('ForumPanel', `New ${itemType} received, updating badges`);

    // Small delay to allow refreshForumData to complete first
    setTimeout(() => {
        // If session history items are provided, use them to update badges
        // This allows badge updates to work even when forum panel hasn't been opened
        if (data.sessionHistoryItems) {
            const chatMessages = data.sessionHistoryItems.filter(item => item.type === 'chat');
            const planEvents = data.sessionHistoryItems.filter(item => item.type === 'planEvent');
            updateNotificationBadges({ messages: chatMessages, events: planEvents });
        } else {
            updateNotificationBadges();
        }
    }, 500);
}

// ===== END NOTIFICATION COUNTS SYSTEM =====

/**
 * Initialize the Forum Panel
 * Sets up event listeners for filters, close button, and overlay
 */
export function initializeForumPanel() {
    log('ForumPanel', 'Initializing Forum Panel...');

    const panel = document.getElementById('forum-panel');
    const closeBtn = document.getElementById('forum-panel-close');
    const filterBtns = document.querySelectorAll('.forum-filter-btn');
    const triggerBtn = document.getElementById('forum-panel-trigger');

    // Close button handler
    if (closeBtn) {
        closeBtn.addEventListener('click', hideForumPanel);
    }

    // Note: Overlay click handler removed - overlay now has pointer-events: none
    // to allow simultaneous interaction with forum and plan content

    // Filter button handlers
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;
            setForumFilter(filter);

            // Update active state
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Mark this filter as seen and update badges
            markCurrentFilterAsSeen();
        });
    });

    // Trigger button handler (in chat header)
    if (triggerBtn) {
        triggerBtn.addEventListener('click', () => {
            toggleForumPanel();
        });
    }

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && panel && panel.classList.contains('open')) {
            hideForumPanel();
        }
    });

    // Initialize forum message form
    initializeForumMessageForm();

    // Item filter clear button
    const itemFilterClearBtn = document.getElementById('forum-item-filter-clear');
    if (itemFilterClearBtn) {
        itemFilterClearBtn.addEventListener('click', () => {
            currentItemFilter = null;
            const indicator = document.getElementById('forum-item-filter-indicator');
            if (indicator) indicator.style.display = 'none';
            // Pre-select "All" in component selector
            const componentSelect = document.getElementById('forum-component-select');
            if (componentSelect) componentSelect.value = '';
            renderForumContent();
        });
    }

    log('ForumPanel', 'Forum Panel initialized.');
}

/**
 * Show the Forum Panel with slide-in animation
 * @param {Object} options - Options for showing the panel
 */
export async function showForumPanel(options = {}) {
    const { skipPushState = false, filter = null, componentId = null } = options;
    const panel = document.getElementById('forum-panel');
    const overlay = document.getElementById('forum-panel-overlay');

    if (panel) {
        panel.style.display = 'flex';
        // Trigger reflow for animation
        panel.offsetHeight;
        panel.classList.add('open');
    }

    // Show overlay with pointer-events: none so users can still interact with plan beneath
    if (overlay) {
        overlay.classList.add('visible');
    }

    // Keep chat window visible - allow simultaneous forum and chat/plan interaction
    // (Previously hidden to avoid confusion, but users prefer both accessible)

    // Update trigger button state
    const triggerBtn = document.getElementById('forum-panel-trigger');
    if (triggerBtn) {
        triggerBtn.classList.add('active');
        triggerBtn.setAttribute('aria-expanded', 'true');
    }

    // Add forumPanel=open to URL for browser history support
    if (!skipPushState) {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('forumPanel', 'open');
        if (filter) {
            currentUrl.searchParams.set('forumFilter', filter);
        }
        window.history.pushState({ forumPanel: 'open' }, '', currentUrl.toString());
        log('ForumPanel', 'Pushed forumPanel=open to history');
    }

    // Set filter if specified
    if (filter && Object.values(FORUM_FILTER_TYPES).includes(filter)) {
        currentFilter = filter;
        const filterBtns = document.querySelectorAll('.forum-filter-btn');
        filterBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
    }

    // Set item-specific filter (shows only comments for a specific item)
    currentItemFilter = componentId || null;
    // Show/hide the item filter indicator
    const itemFilterIndicator = document.getElementById('forum-item-filter-indicator');
    if (itemFilterIndicator) {
        if (currentItemFilter) {
            // Try to get item name from state
            const record = getRecordById(currentItemFilter);
            const itemName = record?.fields?.Name || 'this item';
            itemFilterIndicator.querySelector('.item-filter-text').textContent = `Showing discussion for: ${itemName}`;
            itemFilterIndicator.style.display = 'flex';
        } else {
            itemFilterIndicator.style.display = 'none';
        }
    }

    // Load forum data
    await loadForumData();

    // Initialize notification tracking and mark current filter as seen
    initializeNotificationTracking();
    markCurrentFilterAsSeen();

    log('ForumPanel', 'Forum Panel opened.');
}

/**
 * Hide the Forum Panel with slide-out animation
 * @param {Object} options - Options for hiding the panel
 */
export function hideForumPanel(options = {}) {
    const { skipPushState = false } = options;
    const panel = document.getElementById('forum-panel');
    const overlay = document.getElementById('forum-panel-overlay');

    if (panel) {
        panel.classList.remove('open');
        // Wait for animation to complete before hiding
        setTimeout(() => {
            if (!panel.classList.contains('open')) {
                panel.style.display = 'none';
            }
        }, 300);
    }

    if (overlay) {
        overlay.classList.remove('visible');
    }

    // Chat window is no longer hidden when forum opens, so no need to restore

    // Update trigger button state
    const triggerBtn = document.getElementById('forum-panel-trigger');
    if (triggerBtn) {
        triggerBtn.classList.remove('active');
        triggerBtn.setAttribute('aria-expanded', 'false');
    }

    // Remove forumPanel from URL
    if (!skipPushState) {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.delete('forumPanel');
        currentUrl.searchParams.delete('forumFilter');
        window.history.pushState({}, '', currentUrl.toString());
        log('ForumPanel', 'Removed forumPanel from history');
    }

    // Clear item-specific filter
    currentItemFilter = null;
    const itemFilterIndicator = document.getElementById('forum-item-filter-indicator');
    if (itemFilterIndicator) itemFilterIndicator.style.display = 'none';

    log('ForumPanel', 'Forum Panel closed.');
}

/**
 * Toggle the Forum Panel visibility
 */
export function toggleForumPanel() {
    const panel = document.getElementById('forum-panel');
    if (panel && panel.classList.contains('open')) {
        hideForumPanel();
    } else {
        showForumPanel();
    }
}

/**
 * Check if Forum Panel is open
 */
export function isForumPanelOpen() {
    const panel = document.getElementById('forum-panel');
    return panel && panel.classList.contains('open');
}

/**
 * Set the current forum filter and re-render
 * @param {string} filter - Filter type from FORUM_FILTER_TYPES
 */
function setForumFilter(filter) {
    if (Object.values(FORUM_FILTER_TYPES).includes(filter)) {
        currentFilter = filter;
        renderForumContent();
        log('ForumPanel', `Filter set to: ${filter}`);
    }
}

/**
 * Load forum data from the current session
 */
async function loadForumData() {
    const sessionId = state.session?.id;
    if (!sessionId) {
        log('ForumPanel', 'No session ID available');
        showEmptyState('No active session');
        return;
    }

    isLoading = true;
    showLoadingState();

    try {
        // Fetch all messages for this session
        const messages = await api.fetchChatMessages(sessionId);

        // Separate messages and plan events
        forumMessages = [];
        forumPlanEvents = [];

        if (messages && Array.isArray(messages)) {
            messages.forEach(record => {
                const fields = record.fields || record;
                const content = fields.Content || '';
                const senderId = fields.SenderID;
                const reactions = parseReactions(fields.Reactions);
                // Get timestamp with fallback chain: record.createdTime -> fields.Timestamp -> eventData.timestamp -> now
                const recordTimestamp = record.createdTime || fields.Timestamp || new Date().toISOString();

                // Check if this is a system event (plan history)
                if (senderId === 'system') {
                    try {
                        const eventData = JSON.parse(content);
                        forumPlanEvents.push({
                            id: record.id,
                            type: eventData.type,
                            data: eventData.data,
                            timestamp: recordTimestamp || eventData.timestamp,
                            ...eventData
                        });
                    } catch (e) {
                        // Not a valid JSON event, treat as system message
                        forumMessages.push(createMessageObject(record));
                    }
                } else {
                    forumMessages.push(createMessageObject(record));

                    // Add reactions as history events (for history filter)
                    if (reactions && Object.keys(reactions).length > 0) {
                        const senderName = fields.SenderName || 'Anonymous';
                        const messagePreview = content.length > 30 ? content.substring(0, 30) + '...' : content;

                        for (const [emoji, users] of Object.entries(reactions)) {
                            if (users && users.length > 0) {
                                // Create a reaction event for each emoji type on the message
                                forumPlanEvents.push({
                                    id: `${record.id}-reaction-${emoji}`,
                                    type: 'reaction_added',
                                    data: {
                                        emoji: emoji,
                                        count: users.length,
                                        messagePreview: messagePreview,
                                        messageSender: senderName,
                                        messageId: record.id
                                    },
                                    timestamp: recordTimestamp // Use message timestamp
                                });
                            }
                        }
                    }
                }
            });
        }

        // Build reply count map and organize threads
        await buildThreadStructure();

        isLoading = false;
        renderForumContent();

        // Update notification badges after loading data
        updateNotificationBadges();

    } catch (error) {
        log('ForumPanel', 'Error loading forum data:', error);
        isLoading = false;
        showEmptyState('Error loading messages');
    }
}

/**
 * Create a normalized message object from a record
 */
function createMessageObject(record) {
    const fields = record.fields || record;
    const currentUser = getCurrentUser();

    // Use createdTime from record level, fall back to fields.Timestamp, then current time
    const timestamp = record.createdTime || fields.Timestamp || new Date().toISOString();

    // Detect idea messages by MessageType field or content prefix
    const isIdea = fields.MessageType === 'idea' || (fields.Content || '').startsWith('[IDEA]');
    let content = isIdea && (fields.Content || '').startsWith('[IDEA]')
        ? (fields.Content || '').replace(/^\[IDEA\]\s*/, '')
        : (fields.Content || '');

    // Extract component link from Item Link field (for Airtable rec* IDs)
    const itemLinkField = fields['Item Link'];
    let componentId = itemLinkField ? (Array.isArray(itemLinkField) ? itemLinkField[0] : itemLinkField) : null;

    // Also check for [PLAN_COMMENT:item:ID] prefix in content (for custom/non-rec item IDs)
    if (!componentId) {
        const planCommentMatch = content.match(/^\[PLAN_COMMENT:item:([^\]]+)\]\s*/);
        if (planCommentMatch) {
            componentId = planCommentMatch[1];
            content = content.replace(/^\[PLAN_COMMENT:item:[^\]]+\]\s*/, '');
        }
    }

    log('ForumPanel', `[DEBUG] createMessageObject - record.id: ${record.id}, Item Link field: ${JSON.stringify(itemLinkField)}, resolved componentId: ${componentId}, content preview: "${(fields.Content || '').substring(0, 40)}"`);

    return {
        id: record.id,
        senderId: fields.SenderID,
        senderName: fields.SenderName || 'Anonymous',
        content: content,
        timestamp: timestamp,
        parentMessageId: fields.ParentMessageID,
        reactions: parseReactions(fields.Reactions),
        isEdited: fields.IsEdited || false,
        isDeleted: fields.IsDeleted || false,
        isIdea: isIdea,
        componentId: componentId,
        isSent: fields.SenderID === currentUser?.id,
        replies: [],
        replyCount: 0
    };
}

/**
 * Parse reactions from string or object
 */
function parseReactions(reactions) {
    if (!reactions) return {};
    if (typeof reactions === 'string') {
        try {
            return JSON.parse(reactions);
        } catch (e) {
            return {};
        }
    }
    return reactions;
}

/**
 * Build thread structure - organize messages by parent/child relationships
 */
async function buildThreadStructure() {
    const messageMap = new Map();
    const topLevelMessages = [];

    // First pass: create map of all messages
    forumMessages.forEach(msg => {
        messageMap.set(msg.id, msg);
    });

    // Second pass: organize by parent/child
    forumMessages.forEach(msg => {
        if (msg.parentMessageId && messageMap.has(msg.parentMessageId)) {
            const parent = messageMap.get(msg.parentMessageId);
            parent.replies.push(msg);
            parent.replyCount = (parent.replyCount || 0) + 1;
        } else if (!msg.parentMessageId) {
            topLevelMessages.push(msg);
        }
    });

    // Sort replies by timestamp
    topLevelMessages.forEach(msg => {
        if (msg.replies.length > 0) {
            msg.replies.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        }
    });

    // Replace forumMessages with only top-level messages (replies are nested)
    forumMessages = topLevelMessages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

// ─── Phase 2: Thread & Component Summary Layer ────────────────────────────────

/**
 * Compute a summary emoji for a thread (parent message + all replies).
 * Aggregates all message reactions across the thread using the democratic average.
 * @param {Object} message - A top-level message object with .reactions and .replies[]
 * @returns {{ summaryEmoji: string, democraticAverage: number, userCount: number, totalReactions: number }}
 */
function getThreadSummaryEmoji(message) {
    // Collect all messages in the thread: parent + replies
    const allMessages = [message, ...(message.replies || [])];

    // Merge all message reactions into a single Map<userId, Set<emoji>>
    const mergedReactions = new Map();
    let messageCount = 0;

    for (const msg of allMessages) {
        if (!msg.reactions || Object.keys(msg.reactions).length === 0) continue;
        messageCount++;
        const converted = convertMessageReactions(msg.reactions);
        for (const [userId, emojiSet] of converted) {
            if (!mergedReactions.has(userId)) mergedReactions.set(userId, new Set());
            const userSet = mergedReactions.get(userId);
            for (const emoji of emojiSet) userSet.add(emoji);
        }
    }

    if (mergedReactions.size === 0) {
        console.log(`[SUMMARY-DEBUG] getThreadSummaryEmoji(${message.id}): no reactions across ${allMessages.length} messages`);
        return { summaryEmoji: '', democraticAverage: 0, userCount: 0, totalReactions: 0 };
    }

    const result = computeDemocraticAverage(mergedReactions);
    console.log(`[SUMMARY-DEBUG] getThreadSummaryEmoji(${message.id}): ${messageCount} msgs with reactions, ${allMessages.length} total msgs, ${result.userCount} users, ${result.totalReactions} reactions → ${result.summaryEmoji} (avg: ${result.democraticAverage.toFixed(2)})`);
    return result;
}

/**
 * Get aggregated message reactions for a specific component (plan item).
 * Finds all forum messages linked to the given componentId and merges their reactions
 * into a single Map<userId, Set<emoji>> for use by the hierarchical item summary.
 * @param {string} componentId - The item recordId to find comments for
 * @returns {Map<string, Set<string>>} Merged reactions Map<userId, Set<emoji>>
 */
export function getComponentMessageReactions(componentId) {
    if (!componentId) return new Map();

    // Find all messages (top-level and replies) linked to this component
    const linkedMessages = [];
    for (const msg of forumMessages) {
        if (msg.componentId === componentId) {
            linkedMessages.push(msg);
            // Also include all replies in this thread
            if (msg.replies) linkedMessages.push(...msg.replies);
        }
        // Check replies of other threads for component-linked replies
        if (msg.replies) {
            for (const reply of msg.replies) {
                if (reply.componentId === componentId && !linkedMessages.includes(reply)) {
                    linkedMessages.push(reply);
                }
            }
        }
    }

    // Merge all their reactions
    const mergedReactions = new Map();
    for (const msg of linkedMessages) {
        if (!msg.reactions || Object.keys(msg.reactions).length === 0) continue;
        const converted = convertMessageReactions(msg.reactions);
        for (const [userId, emojiSet] of converted) {
            if (!mergedReactions.has(userId)) mergedReactions.set(userId, new Set());
            const userSet = mergedReactions.get(userId);
            for (const emoji of emojiSet) userSet.add(emoji);
        }
    }

    console.log(`[SUMMARY-DEBUG] getComponentMessageReactions(${componentId}): ${linkedMessages.length} linked messages, ${mergedReactions.size} users with reactions`);
    return mergedReactions;
}

/**
 * Show loading state in the forum panel
 */
function showLoadingState() {
    const container = document.getElementById('forum-content-container');
    if (container) {
        container.innerHTML = '<div class="forum-loading">Loading discussions...</div>';
    }
}

/**
 * Show empty state message
 */
function showEmptyState(message = 'No discussions yet') {
    const container = document.getElementById('forum-content-container');
    if (container) {
        container.innerHTML = `<div class="forum-empty">${message}</div>`;
    }
}

/**
 * Render the forum content based on current filter
 */
function renderForumContent() {
    const container = document.getElementById('forum-content-container');
    if (!container) return;

    container.innerHTML = '';

    let itemsToRender = [];

    switch (currentFilter) {
        case FORUM_FILTER_TYPES.ALL:
            // Combine messages and events, sorted by time
            itemsToRender = [
                ...forumMessages.map(m => ({ ...m, itemType: 'message' })),
                ...forumPlanEvents.map(e => ({ ...e, itemType: 'event' }))
            ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            break;

        case FORUM_FILTER_TYPES.THREADS:
            // All chat messages (non-ideas)
            itemsToRender = forumMessages
                .filter(m => !m.isIdea)
                .map(m => ({ ...m, itemType: 'message' }));
            break;

        case FORUM_FILTER_TYPES.COMMENTS:
            // Only component comments
            itemsToRender = forumMessages
                .filter(m => m.componentId)
                .map(m => ({ ...m, itemType: 'message' }));
            break;

        case FORUM_FILTER_TYPES.IDEAS:
            // Only idea messages
            itemsToRender = forumMessages
                .filter(m => m.isIdea)
                .map(m => ({ ...m, itemType: 'idea' }));
            break;

        case FORUM_FILTER_TYPES.HISTORY:
            // Only plan events
            itemsToRender = forumPlanEvents.map(e => ({ ...e, itemType: 'event' }));
            break;
    }

    // Apply item-specific filter if active
    if (currentItemFilter) {
        itemsToRender = itemsToRender.filter(item => {
            if (item.itemType === 'message' || item.itemType === 'idea') {
                return item.componentId === currentItemFilter;
            }
            return false; // Hide events when filtering by item
        });
    }

    // Update input placeholder based on current filter
    updateInputPlaceholder();

    if (itemsToRender.length === 0) {
        showEmptyState(currentItemFilter ? 'No comments yet for this item. Start the discussion!' : getEmptyMessage());
        return;
    }

    itemsToRender.forEach(item => {
        if (item.itemType === 'idea') {
            container.appendChild(createIdeaElement(item));
        } else if (item.itemType === 'message') {
            container.appendChild(createThreadElement(item));
        } else if (item.itemType === 'event') {
            container.appendChild(createEventElement(item));
        }
    });
}

/**
 * Get appropriate empty message for current filter
 */
function getEmptyMessage() {
    switch (currentFilter) {
        case FORUM_FILTER_TYPES.THREADS:
            return 'No chat messages yet. Start a conversation!';
        case FORUM_FILTER_TYPES.COMMENTS:
            return 'No component comments yet';
        case FORUM_FILTER_TYPES.IDEAS:
            return 'No ideas yet. Share a suggestion for this plan!';
        case FORUM_FILTER_TYPES.HISTORY:
            return 'No plan history yet';
        default:
            return 'No activity yet. Start a conversation!';
    }
}

/**
 * Create a thread element for a message
 */
function createThreadElement(message) {
    const currentUser = getCurrentUser();
    const isSent = message.senderId === currentUser?.id;
    // Threads are expanded by default unless user collapsed them
    const isExpanded = !collapsedThreads.has(message.id);

    const threadWrapper = document.createElement('div');
    threadWrapper.className = `forum-thread ${isSent ? 'sent' : 'received'}`;
    threadWrapper.dataset.messageId = message.id;

    // Thread header with sender info
    const header = document.createElement('div');
    header.className = 'forum-thread-header';

    // Resolve component name for the badge
    let componentBadgeHtml = '';
    if (message.componentId) {
        const record = getRecordById(message.componentId);
        const itemName = record?.fields?.Name || 'Item';
        componentBadgeHtml = `<span class="forum-component-badge" title="${escapeHtml(itemName)}">📎 ${escapeHtml(itemName)}</span>`;
    }

    header.innerHTML = `
        <span class="forum-sender-name">${escapeHtml(message.senderName)}</span>
        <span class="forum-timestamp">${formatTimestamp(message.timestamp)}</span>
        ${componentBadgeHtml}
    `;
    threadWrapper.appendChild(header);

    // Message content
    const content = document.createElement('div');
    content.className = 'forum-message-content';
    if (message.isDeleted) {
        content.innerHTML = '<em class="deleted-message">This message was deleted</em>';
    } else {
        content.innerHTML = formatMessageContent(message.content);
        if (message.isEdited) {
            content.innerHTML += ' <span class="edited-indicator">(edited)</span>';
        }
    }
    threadWrapper.appendChild(content);

    // Reactions display
    if (message.reactions && Object.keys(message.reactions).length > 0) {
        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'forum-reactions';
        for (const [emoji, users] of Object.entries(message.reactions)) {
            if (users && users.length > 0) {
                const badge = document.createElement('span');
                badge.className = 'forum-reaction-badge';
                const hasReacted = users.includes(currentUser?.id);
                if (hasReacted) badge.classList.add('user-reacted');
                badge.innerHTML = `${emoji} ${users.length}`;
                badge.title = `${users.length} reaction${users.length !== 1 ? 's' : ''}`;
                reactionsContainer.appendChild(badge);
            }
        }
        threadWrapper.appendChild(reactionsContainer);
    }

    // Action buttons (reply)
    if (!message.isDeleted && message.id) {
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'forum-thread-actions';

        const replyBtn = document.createElement('button');
        replyBtn.className = 'forum-action-btn';
        replyBtn.innerHTML = '↩ Reply';
        replyBtn.addEventListener('click', () => {
            startForumReply(message.id, message.senderName, message.content);
        });
        actionsContainer.appendChild(replyBtn);

        threadWrapper.appendChild(actionsContainer);
    }

    // Thread indicator and replies
    if (message.replyCount > 0) {
        // Phase 2: Compute thread-level summary emoji
        const threadSummary = getThreadSummaryEmoji(message);
        const threadEmojiHTML = threadSummary.summaryEmoji
            ? `<span class="thread-summary-emoji" title="Thread sentiment: ${threadSummary.summaryEmoji} (${threadSummary.totalReactions} reactions from ${threadSummary.userCount} users, avg: ${threadSummary.democraticAverage >= 0 ? '+' : ''}${threadSummary.democraticAverage.toFixed(1)})">${threadSummary.summaryEmoji}</span>`
            : '';

        const threadIndicator = document.createElement('button');
        threadIndicator.className = `forum-thread-indicator ${isExpanded ? 'expanded' : ''}`;
        threadIndicator.innerHTML = `
            <span class="thread-arrow">${isExpanded ? '▼' : '▶'}</span>
            <span class="thread-count">${message.replyCount} ${message.replyCount === 1 ? 'reply' : 'replies'}</span>
            ${threadEmojiHTML}
        `;
        threadIndicator.addEventListener('click', () => {
            toggleThreadExpansion(message.id, threadWrapper);
        });
        threadWrapper.appendChild(threadIndicator);

        // Replies container
        const repliesContainer = document.createElement('div');
        repliesContainer.className = `forum-replies-container ${isExpanded ? 'expanded' : ''}`;
        repliesContainer.id = `replies-${message.id}`;

        // Show replies if expanded (which is the default now)
        if (isExpanded && message.replies.length > 0) {
            message.replies.forEach(reply => {
                repliesContainer.appendChild(createReplyElement(reply));
            });
        }
        threadWrapper.appendChild(repliesContainer);
    }

    return threadWrapper;
}

/**
 * Create a reply element
 */
function createReplyElement(reply) {
    const currentUser = getCurrentUser();
    const isSent = reply.senderId === currentUser?.id;

    const replyEl = document.createElement('div');
    replyEl.className = `forum-reply ${isSent ? 'sent' : 'received'}`;
    replyEl.innerHTML = `
        <div class="forum-reply-header">
            <span class="forum-sender-name">${escapeHtml(reply.senderName)}</span>
            <span class="forum-timestamp">${formatTimestamp(reply.timestamp)}</span>
        </div>
        <div class="forum-reply-content">${reply.isDeleted ? '<em class="deleted-message">Deleted</em>' : formatMessageContent(reply.content)}</div>
    `;

    return replyEl;
}

/**
 * Toggle thread expansion
 * With inverted logic: threads start expanded, clicking collapses them
 */
function toggleThreadExpansion(messageId, threadWrapper) {
    const repliesContainer = threadWrapper.querySelector(`#replies-${messageId}`);
    const indicator = threadWrapper.querySelector('.forum-thread-indicator');
    const message = forumMessages.find(m => m.id === messageId);

    if (!repliesContainer || !message) return;

    // Inverted logic: if NOT in collapsedThreads, it's currently expanded
    const isCurrentlyExpanded = !collapsedThreads.has(messageId);

    if (isCurrentlyExpanded) {
        // Currently expanded, so collapse it
        collapsedThreads.add(messageId);
        repliesContainer.classList.remove('expanded');
        indicator.classList.remove('expanded');
        indicator.querySelector('.thread-arrow').textContent = '▶';
    } else {
        // Currently collapsed, so expand it
        collapsedThreads.delete(messageId);
        repliesContainer.classList.add('expanded');
        indicator.classList.add('expanded');
        indicator.querySelector('.thread-arrow').textContent = '▼';

        // Render replies if not already rendered
        if (repliesContainer.children.length === 0 && message.replies.length > 0) {
            message.replies.forEach(reply => {
                repliesContainer.appendChild(createReplyElement(reply));
            });
        }
    }
}

/**
 * Create a plan event element
 */
function createEventElement(event) {
    const eventConfig = EVENT_TYPE_DISPLAY[event.type] || {
        icon: '📌',
        label: event.type || 'Event',
        color: '#6c757d'
    };

    const eventEl = document.createElement('div');
    eventEl.className = 'forum-event';
    eventEl.style.borderLeftColor = eventConfig.color;

    let eventDetails = '';
    if (event.data) {
        if (event.type === 'reaction_added' && event.data.emoji) {
            // Special handling for reaction events
            const countText = event.data.count > 1 ? `${event.data.count}x ` : '';
            eventDetails = `<span class="event-detail">${countText}${event.data.emoji} on "${escapeHtml(event.data.messagePreview)}"</span>`;
        } else if (event.data.itemName) {
            eventDetails = `<span class="event-detail">${escapeHtml(event.data.itemName)}</span>`;
        } else if (event.data.collaboratorName) {
            eventDetails = `<span class="event-detail">${escapeHtml(event.data.collaboratorName)} joined</span>`;
        } else if (event.data.eventName) {
            eventDetails = `<span class="event-detail">${escapeHtml(event.data.eventName)}</span>`;
        }
    }

    // For reaction events, use the emoji as the icon
    const displayIcon = event.type === 'reaction_added' && event.data?.emoji ? event.data.emoji : eventConfig.icon;

    eventEl.innerHTML = `
        <div class="forum-event-icon" style="background-color: ${eventConfig.color}20; color: ${eventConfig.color}">
            ${displayIcon}
        </div>
        <div class="forum-event-content">
            <span class="forum-event-label">${eventConfig.label}</span>
            ${eventDetails}
        </div>
        <span class="forum-event-time">${formatTimestamp(event.timestamp)}</span>
    `;

    return eventEl;
}

/**
 * Format message content with basic markdown-like formatting
 */
function formatMessageContent(content) {
    if (!content) return '';

    let formatted = escapeHtml(content);

    // Bold: **text**
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Links: [text](url)
    formatted = formatted.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
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
 * Sync forum panel with URL parameters
 */
export function syncForumPanelWithUrl(params) {
    const forumParam = params.get('forumPanel');
    const filterParam = params.get('forumFilter');

    if (forumParam === 'open') {
        showForumPanel({ skipPushState: true, filter: filterParam });
    } else {
        const panel = document.getElementById('forum-panel');
        if (panel && panel.classList.contains('open')) {
            hideForumPanel({ skipPushState: true });
        }
    }
}

/**
 * Refresh forum data (can be called when new messages arrive)
 */
export async function refreshForumData() {
    if (isForumPanelOpen()) {
        await loadForumData();
    }
}

/**
 * Initialize the forum message form
 */
function initializeForumMessageForm() {
    const form = document.getElementById('forum-message-form');
    const input = document.getElementById('forum-message-input');
    const replyIndicator = document.getElementById('forum-reply-indicator');
    const cancelReplyBtn = replyIndicator?.querySelector('.cancel-reply-btn');

    if (form) {
        form.addEventListener('submit', handleForumMessageSubmit);
    }

    if (cancelReplyBtn) {
        cancelReplyBtn.addEventListener('click', cancelForumReply);
    }

    log('ForumPanel', 'Forum message form initialized');
}

/**
 * Handle forum message form submission
 */
async function handleForumMessageSubmit(e) {
    e.preventDefault();

    const input = document.getElementById('forum-message-input');
    const message = input?.value?.trim();

    if (!message) return;

    const currentUser = getCurrentUser();
    if (!currentUser) {
        log('ForumPanel', 'No current user, cannot send message');
        // Show sign-in prompt for unauthenticated users
        const signInPrompt = document.createElement('div');
        signInPrompt.className = 'forum-signin-prompt';
        signInPrompt.textContent = 'Sign in to participate in the discussion';
        signInPrompt.style.cssText = 'padding: 8px 12px; background: #fff3cd; color: #856404; border-radius: 6px; margin: 8px; font-size: 0.85em; text-align: center; cursor: pointer;';
        signInPrompt.addEventListener('click', () => {
            document.dispatchEvent(new CustomEvent('requestSignIn'));
            signInPrompt.remove();
        });
        const formContainer = document.getElementById('forum-input-container');
        if (formContainer) {
            const existing = formContainer.querySelector('.forum-signin-prompt');
            if (existing) existing.remove();
            formContainer.prepend(signInPrompt);
        }
        return;
    }

    const sessionId = state.session?.id;
    if (!sessionId) {
        log('ForumPanel', 'No session ID, cannot send message');
        return;
    }

    // Clear input
    input.value = '';

    try {
        if (replyingToMessage) {
            // Post as a reply
            log('ForumPanel', `Posting reply to message ${replyingToMessage.id}`);
            const result = await api.postReplyMessage(
                replyingToMessage.id,
                sessionId,
                null, // itemId
                currentUser.id,
                currentUser.name,
                message
            );

            if (result) {
                log('ForumPanel', 'Reply posted successfully');
                cancelForumReply();
                await refreshForumData();
            }
        } else if (currentFilter === FORUM_FILTER_TYPES.IDEAS) {
            // Post as an idea - prefix with [IDEA] marker for identification
            const ideaContent = `[IDEA] ${message}`;
            log('ForumPanel', 'Posting new idea');
            const messageId = await api.postChatMessage(sessionId, currentUser.id, currentUser.name, ideaContent, null);

            if (messageId) {
                log('ForumPanel', `Idea posted with ID: ${messageId}`);
                await refreshForumData();
            }
        } else {
            // Post as a new message - use component selector dropdown, falling back to item filter
            const componentSelect = document.getElementById('forum-component-select');
            const selectedComponentId = componentSelect?.value || null;
            const itemId = selectedComponentId || currentItemFilter || null;
            log('ForumPanel', `[DEBUG] Posting new forum message - componentSelect value: "${componentSelect?.value}", currentItemFilter: "${currentItemFilter}", resolved itemId: "${itemId}"`);
            const messageId = await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message, itemId);

            if (messageId) {
                log('ForumPanel', `Message posted with ID: ${messageId}`);
                await refreshForumData();
            }
        }
    } catch (error) {
        log('ForumPanel', `Error posting message: ${error.message}`);
    }
}

/**
 * Start replying to a message in the forum
 */
export function startForumReply(messageId, senderName, messagePreview) {
    replyingToMessage = { id: messageId, sender: senderName, preview: messagePreview };

    const replyIndicator = document.getElementById('forum-reply-indicator');
    const replyText = replyIndicator?.querySelector('.reply-indicator-text');
    const input = document.getElementById('forum-message-input');

    if (replyIndicator && replyText) {
        const preview = messagePreview.length > 50 ? messagePreview.substring(0, 50) + '...' : messagePreview;
        replyText.innerHTML = `Replying to <strong>${escapeHtml(senderName)}</strong>: ${escapeHtml(preview)}`;
        replyIndicator.style.display = 'flex';
    }

    if (input) {
        input.placeholder = `Reply to ${senderName}...`;
        input.focus();
    }

    log('ForumPanel', `Started reply to message ${messageId}`);
}

/**
 * Update the input placeholder based on the current filter tab
 */
function updateInputPlaceholder() {
    const input = document.getElementById('forum-message-input');
    const submitBtn = document.getElementById('forum-message-submit');
    if (!input) return;

    if (currentFilter === FORUM_FILTER_TYPES.IDEAS) {
        input.placeholder = 'Share an idea or suggestion...';
        if (submitBtn) submitBtn.textContent = 'Post Idea';
    } else {
        input.placeholder = replyingToMessage ? `Reply to ${replyingToMessage.sender}...` : 'Type a message...';
        if (submitBtn) submitBtn.textContent = 'Send';
    }
}

/**
 * Create an idea card element with upvote support
 */
function createIdeaElement(idea) {
    const currentUser = getCurrentUser();
    const isSent = idea.senderId === currentUser?.id;

    const ideaWrapper = document.createElement('div');
    ideaWrapper.className = `forum-idea-card ${isSent ? 'own-idea' : ''}`;
    ideaWrapper.dataset.messageId = idea.id;

    // Calculate upvote count from thumbs-up reactions
    const reactions = idea.reactions || {};
    const upvoteEmojis = ['👍', 'thumbs-up'];
    let upvoteCount = 0;
    let hasUpvoted = false;
    upvoteEmojis.forEach(emoji => {
        const users = reactions[emoji] || [];
        upvoteCount += users.length;
        if (users.includes(currentUser?.id)) hasUpvoted = true;
    });

    // Idea header
    const header = document.createElement('div');
    header.className = 'forum-idea-header';
    header.innerHTML = `
        <span class="forum-idea-icon">💡</span>
        <span class="forum-sender-name">${escapeHtml(idea.senderName)}</span>
        <span class="forum-timestamp">${formatTimestamp(idea.timestamp)}</span>
    `;
    ideaWrapper.appendChild(header);

    // Idea content
    const content = document.createElement('div');
    content.className = 'forum-idea-content';
    if (idea.isDeleted) {
        content.innerHTML = '<em class="deleted-message">This idea was removed</em>';
    } else {
        content.innerHTML = formatMessageContent(idea.content);
    }
    ideaWrapper.appendChild(content);

    // Idea actions (upvote + reply + promote)
    if (!idea.isDeleted) {
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'forum-idea-actions';

        // Upvote button
        const upvoteBtn = document.createElement('button');
        upvoteBtn.className = `forum-idea-upvote ${hasUpvoted ? 'upvoted' : ''}`;
        upvoteBtn.innerHTML = `<span class="upvote-icon">👍</span> <span class="upvote-count">${upvoteCount || ''}</span>`;
        upvoteBtn.title = hasUpvoted ? 'Remove upvote' : 'Upvote this idea';
        upvoteBtn.addEventListener('click', async () => {
            try {
                const result = await api.toggleMessageReaction(idea.id, currentUser?.id, '👍', !hasUpvoted);
                if (result !== null) {
                    await refreshForumDataLocal();
                }
            } catch (err) {
                log('ForumPanel', `Error toggling upvote: ${err.message}`);
            }
        });
        actionsContainer.appendChild(upvoteBtn);

        // Reply button
        const replyBtn = document.createElement('button');
        replyBtn.className = 'forum-action-btn';
        replyBtn.innerHTML = '↩ Reply';
        replyBtn.addEventListener('click', () => {
            startForumReply(idea.id, idea.senderName, idea.content);
        });
        actionsContainer.appendChild(replyBtn);

        ideaWrapper.appendChild(actionsContainer);
    }

    // Thread replies for ideas
    if (idea.replyCount > 0) {
        const isExpanded = !collapsedThreads.has(idea.id);
        const threadIndicator = document.createElement('button');
        threadIndicator.className = `forum-thread-indicator ${isExpanded ? 'expanded' : ''}`;
        threadIndicator.innerHTML = `
            <span class="thread-arrow">${isExpanded ? '▼' : '▶'}</span>
            <span class="thread-count">${idea.replyCount} ${idea.replyCount === 1 ? 'reply' : 'replies'}</span>
        `;
        threadIndicator.addEventListener('click', () => {
            toggleThreadExpansion(idea.id, ideaWrapper);
        });
        ideaWrapper.appendChild(threadIndicator);

        const repliesContainer = document.createElement('div');
        repliesContainer.className = `forum-replies-container ${isExpanded ? 'expanded' : ''}`;
        repliesContainer.id = `replies-${idea.id}`;
        if (isExpanded && idea.replies.length > 0) {
            idea.replies.forEach(reply => {
                repliesContainer.appendChild(createReplyElement(reply));
            });
        }
        ideaWrapper.appendChild(repliesContainer);
    }

    return ideaWrapper;
}

/**
 * Internal refresh that reloads forum data
 */
async function refreshForumDataLocal() {
    await loadForumData();
}

/**
 * Cancel the current reply in the forum
 */
function cancelForumReply() {
    replyingToMessage = null;

    const replyIndicator = document.getElementById('forum-reply-indicator');
    const input = document.getElementById('forum-message-input');

    if (replyIndicator) {
        replyIndicator.style.display = 'none';
    }

    if (input) {
        input.placeholder = 'Type a message...';
    }

    log('ForumPanel', 'Cancelled forum reply');
}
