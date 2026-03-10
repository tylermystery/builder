// FILE: components/toastNotifications.js
// Toast Notification System for real-time collaboration alerts
// Shows brief notifications when messages, ideas, reactions, or joins arrive via Pusher

import { state } from '../state.js';
import { log } from '../utils/debug.js';

const MAX_VISIBLE_TOASTS = 3;
const AUTO_DISMISS_MS = 5000;
const DND_STORAGE_KEY = 'wtf_collab_dnd';

let toastContainer = null;
let activeToasts = [];
let overflowCount = 0;
let doNotDisturb = false;

// Store reference to getCurrentUser
let getCurrentUserFn = null;

/**
 * Set the getCurrentUser function reference
 */
export function setGetCurrentUser(fn) {
    getCurrentUserFn = fn;
}

function getCurrentUser() {
    if (getCurrentUserFn) return getCurrentUserFn();
    return state.session?.user?.id ? {
        id: state.session.user.id,
        name: state.session.user.name || 'User'
    } : null;
}

/**
 * Initialize the toast notification system
 */
export function initializeToastNotifications(options = {}) {
    if (options.getCurrentUser) {
        setGetCurrentUser(options.getCurrentUser);
    }

    // Load DND preference
    doNotDisturb = localStorage.getItem(DND_STORAGE_KEY) === 'true';

    // Create container if it doesn't exist
    ensureContainer();

    log('ToastNotifications', 'Toast notification system initialized');
}

/**
 * Ensure the toast container exists in the DOM
 */
function ensureContainer() {
    if (toastContainer) return;

    toastContainer = document.getElementById('collab-toast-container');
    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'collab-toast-container';
        toastContainer.className = 'collab-toast-container';
        document.body.appendChild(toastContainer);
    }
}

/**
 * Show a toast notification
 * @param {Object} options - Toast configuration
 * @param {string} options.sender - Sender name
 * @param {string} options.message - Message preview
 * @param {string} options.type - Type: 'message', 'idea', 'join', 'rsvp', 'reaction', 'task'
 * @param {string} options.senderId - Sender ID (to prevent self-notifications)
 * @param {Function} options.onView - Callback when user clicks "View"
 */
export function showToast({ sender, message, type = 'message', senderId, onView }) {
    // Don't show if DND is active
    if (doNotDisturb) return;

    // Don't show for own messages
    const currentUser = getCurrentUser();
    if (senderId && currentUser && senderId === currentUser.id) return;

    ensureContainer();

    // If we already have max toasts, increment overflow counter
    if (activeToasts.length >= MAX_VISIBLE_TOASTS) {
        overflowCount++;
        updateOverflowIndicator();
        return;
    }

    const toast = document.createElement('div');
    toast.className = 'collab-toast';
    toast.dataset.type = type;

    const initial = (sender || '?').charAt(0).toUpperCase();
    const typeIcons = {
        message: '💬',
        idea: '💡',
        join: '👋',
        rsvp: '📬',
        reaction: '😊',
        task: '✅'
    };
    const icon = typeIcons[type] || '💬';

    toast.innerHTML = `
        <div class="collab-toast-avatar">${initial}</div>
        <div class="collab-toast-body">
            <div class="collab-toast-sender">${icon} ${escapeHtml(sender || 'Someone')}</div>
            <div class="collab-toast-message">${escapeHtml(truncate(message, 80))}</div>
            <div class="collab-toast-time">just now</div>
        </div>
        <button class="collab-toast-dismiss" title="Dismiss">&times;</button>
    `;

    // Click to view
    toast.addEventListener('click', (e) => {
        if (e.target.closest('.collab-toast-dismiss')) return;
        removeToast(toast);
        if (onView) onView();
    });

    // Dismiss button
    toast.querySelector('.collab-toast-dismiss').addEventListener('click', (e) => {
        e.stopPropagation();
        removeToast(toast);
    });

    toastContainer.appendChild(toast);
    activeToasts.push(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('visible');
    });

    // Auto-dismiss
    const timer = setTimeout(() => {
        removeToast(toast);
    }, AUTO_DISMISS_MS);

    toast._dismissTimer = timer;

    log('ToastNotifications', `Showed toast: ${type} from ${sender}`);
}

/**
 * Remove a toast notification
 */
function removeToast(toast) {
    if (!toast || !toast.parentElement) return;

    clearTimeout(toast._dismissTimer);
    toast.classList.add('removing');
    toast.classList.remove('visible');

    activeToasts = activeToasts.filter(t => t !== toast);

    setTimeout(() => {
        if (toast.parentElement) {
            toast.parentElement.removeChild(toast);
        }
        // Show overflow toast if there are queued notifications
        if (overflowCount > 0) {
            overflowCount--;
            updateOverflowIndicator();
        }
    }, 300);
}

/**
 * Update the overflow indicator
 */
function updateOverflowIndicator() {
    if (!toastContainer) return;

    let indicator = toastContainer.querySelector('.collab-toast-more');

    if (overflowCount > 0) {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'collab-toast-more';
            indicator.addEventListener('click', () => {
                // Open the activity panel when clicking overflow
                document.getElementById('forum-panel-trigger')?.click();
                clearAllToasts();
            });
            toastContainer.appendChild(indicator);
        }
        indicator.textContent = `+${overflowCount} more notification${overflowCount > 1 ? 's' : ''}`;
    } else if (indicator) {
        indicator.remove();
    }
}

/**
 * Clear all active toasts
 */
export function clearAllToasts() {
    activeToasts.forEach(toast => {
        clearTimeout(toast._dismissTimer);
        if (toast.parentElement) toast.parentElement.removeChild(toast);
    });
    activeToasts = [];
    overflowCount = 0;
    updateOverflowIndicator();
}

/**
 * Toggle Do Not Disturb mode
 */
export function toggleDoNotDisturb() {
    doNotDisturb = !doNotDisturb;
    localStorage.setItem(DND_STORAGE_KEY, doNotDisturb.toString());
    if (doNotDisturb) {
        clearAllToasts();
    }
    return doNotDisturb;
}

/**
 * Check if DND is active
 */
export function isDoNotDisturb() {
    return doNotDisturb;
}

/**
 * Handle Pusher events to show toasts
 * Called from chat.js or presentation.js when real-time events arrive
 */
export function handlePusherEvent(eventType, data) {
    switch (eventType) {
        case 'new-message':
            showToast({
                sender: data.sender || data.senderName,
                message: data.message || data.content,
                type: data.isIdea ? 'idea' : 'message',
                senderId: data.senderId,
                onView: () => {
                    document.getElementById('forum-panel-trigger')?.click();
                }
            });
            break;

        case 'new-reaction':
            showToast({
                sender: data.reactorName || 'Someone',
                message: `reacted ${data.emoji} to a message`,
                type: 'reaction',
                senderId: data.reactorId,
                onView: () => {
                    document.getElementById('forum-panel-trigger')?.click();
                }
            });
            break;

        case 'member-joined':
            showToast({
                sender: data.name || 'Someone',
                message: 'joined the plan',
                type: 'join',
                senderId: data.userId,
                onView: () => {
                    document.getElementById('forum-panel-trigger')?.click();
                }
            });
            break;

        case 'rsvp-update':
            showToast({
                sender: data.name || 'Someone',
                message: `RSVP'd "${data.rsvpType}" to the event`,
                type: 'rsvp',
                senderId: data.userId,
                onView: () => {
                    document.getElementById('forum-panel-trigger')?.click();
                }
            });
            break;

        default:
            log('ToastNotifications', `Unknown event type: ${eventType}`);
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function truncate(str, maxLen) {
    if (!str) return '';
    return str.length > maxLen ? str.substring(0, maxLen) + '...' : str;
}
