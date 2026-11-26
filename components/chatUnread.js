/**
 * Chat Unread Tracker
 *
 * Tracks, per device, which plan chat messages arrived since this person last
 * looked at the Conversations panel. The count drives the red badge on the
 * floating 💬 button; the "last read" moment lets the panel draw a "New"
 * divider and highlight the messages that arrived since then.
 *
 * Read state is kept in localStorage (one timestamp per plan), so it is
 * deliberately device-local.
 */

const STORAGE_PREFIX = 'wtf-chat-last-read:';

let sessionId = null;
let myId = null;
let unreadIds = new Set();
let panelOpen = false;

function storageKey(id) {
    return `${STORAGE_PREFIX}${id}`;
}

/** The moment this device last read the plan's chat (ISO string), or null. */
export function getChatLastRead(id = sessionId) {
    if (!id) return null;
    try {
        return localStorage.getItem(storageKey(id));
    } catch (e) {
        return null;
    }
}

function setLastRead(id, iso) {
    if (!id) return;
    try {
        localStorage.setItem(storageKey(id), iso);
    } catch (e) { /* storage full or disabled: badge still works for this visit */ }
}

function canSeePanel() {
    return panelOpen && document.visibilityState !== 'hidden';
}

function isChatRecord(fields) {
    if (!fields) return false;
    if (fields.SenderID === 'system' || fields.EventType) return false;
    if (fields.IsDeleted) return false;
    return true;
}

function renderBadges() {
    const count = unreadIds.size;
    const text = count > 99 ? '99+' : String(count);
    const label = count > 0
        ? `Open conversations (${count} new message${count === 1 ? '' : 's'})`
        : 'Open conversations';

    const badge = document.getElementById('chat-unread-badge');
    if (badge) {
        // The button's aria-label is owned by the workspace toggle; the badge
        // carries its own screen-reader text.
        badge.innerHTML = `${text}<span class="visually-hidden"> new message${count === 1 ? '' : 's'}</span>`;
        badge.hidden = count === 0;
    }
    const toggle = document.getElementById('chat-toggle-button');
    if (toggle) {
        toggle.title = label;
        toggle.classList.toggle('has-unread', count > 0);
    }
    const mobileToggle = document.getElementById('ucp-mobile-toggle');
    if (mobileToggle) {
        mobileToggle.dataset.unread = count > 0 ? text : '';
        mobileToggle.title = label;
    }
}

/**
 * Seed unread state from the plan's message history (called once the chat
 * history loads for a plan). First visit on this device starts with nothing
 * unread so old history doesn't show up as a wall of "new" messages.
 * @param {string} id - plan/session id
 * @param {Array} records - chat records ({ id, createdTime, fields })
 * @param {string} currentUserId - this device's chat user id
 */
export function seedChatUnread(id, records, currentUserId) {
    sessionId = id;
    myId = currentUserId;
    unreadIds = new Set();

    let lastRead = getChatLastRead(id);
    if (!lastRead) {
        lastRead = new Date().toISOString();
        setLastRead(id, lastRead);
    }

    if (canSeePanel()) {
        markChatRead();
        return;
    }

    const since = new Date(lastRead).getTime();
    (records || []).forEach(record => {
        const fields = record?.fields || {};
        if (!isChatRecord(fields) || fields.SenderID === myId) return;
        const ts = new Date(record.createdTime || fields.Timestamp || 0).getTime();
        if (ts > since) unreadIds.add(record.id);
    });
    renderBadges();
}

/**
 * Note a chat message or reply that just arrived from someone else in real time.
 * @param {{ id?: string, senderId?: string, timestamp?: string }} message
 */
export function noteIncomingChat(message) {
    if (!message || message.senderId === myId || message.senderId === 'system') return;
    if (canSeePanel()) {
        markChatRead();
        return;
    }
    unreadIds.add(message.id || `rt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    renderBadges();
}

/** Mark everything in the plan's chat as read on this device. */
export function markChatRead() {
    if (sessionId) setLastRead(sessionId, new Date().toISOString());
    if (unreadIds.size === 0) {
        renderBadges();
        return;
    }
    unreadIds = new Set();
    renderBadges();
}

/** The Conversations panel tells the tracker when it opens or closes. */
export function setChatPanelOpen(open) {
    const wasVisible = canSeePanel();
    panelOpen = !!open;
    // Opening reads what's there; closing reads anything that arrived while open.
    if (canSeePanel() || wasVisible) markChatRead();
}

export function getChatUnreadCount() {
    return unreadIds.size;
}

document.addEventListener('visibilitychange', () => {
    if (canSeePanel()) markChatRead();
});
