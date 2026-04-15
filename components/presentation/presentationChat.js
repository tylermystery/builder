/**
 * Presentation Chat
 * Embedded chat system with Pusher real-time messaging, reactions, replies,
 * threads, presence, and floating chat button.
 * Extracted from presentation.js — Phase 3 modularization.
 */

import { state, setState, getRecordById } from '../../state.js';
import * as api from '../../api.js';
import { getModalZIndex } from '../../config.js';
import { log } from '../../utils/debug.js';
import { getCurrentUser, ROLE_COLORS, getInitials } from '../../chat.js';
import { triggerSave } from '../../events.js';
import { showToast } from '../../ui.js';
import { applyCloudinaryTransform } from '../../utils/imageOptimizer.js';
import { refreshForumData, onNewItemReceived } from '../forumPanel.js';
import { handlePusherEvent as handleToastPusherEvent } from '../toastNotifications.js';
import { updateUCPVideoArea, updateUCPLiveBadge, populateFocusSelect, updateFocusBarUI, applyRemoteFocusItem, applyRemotePin } from '../unifiedChatPanel.js';
import * as reactionRankings from './reactionRankings.js';
import * as liveStream from '../liveStream.js';

// Quick emoji reactions available for messages and comments
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

// --- Module state ---
let presentationPusher = null;
let presentationChatChannel = null;
let presentationReplyingToMessage = null;
let presentationEditingMessage = null;
let savedScrollPosition = null;
let floatingChatScrollHandler = null;

// --- DOM element caches (set via init) ---
let chatMessagesEl = null;
let presentationMessageInput = null;
let presentationMessageForm = null;
let presentationUserNameInput = null;
let presentationWhosHereCount = null;
let presentationWhosHereList = null;
let floatingChatBtn = null;
let modal = null;

// --- Injected dependencies ---
let _getAccordionState = null;
let _renderReactions = null;
let _updateItemEmojiIndicator = null;
let _updateReactionZoneSummary = null;
let _updateEventEmojiIndicator = null;
let _updateLiveStreamToolbarUI = null;
let _updatePresentationLiveBadge = null;
let _spawnHostReactionOverlay = null;
let _loadComponentComments = null;
let _updateCommentReactionsDisplay = null;

/**
 * Initialize the presentation chat module.
 * @param {Object} deps
 * @param {Object} deps.elements - Pre-cached DOM elements
 * @param {HTMLElement} deps.elements.chatMessagesEl
 * @param {HTMLElement} deps.elements.presentationMessageInput
 * @param {HTMLElement} deps.elements.presentationMessageForm
 * @param {HTMLElement} deps.elements.presentationUserNameInput
 * @param {HTMLElement} deps.elements.presentationWhosHereCount
 * @param {HTMLElement} deps.elements.presentationWhosHereList
 * @param {HTMLElement} deps.elements.floatingChatBtn
 * @param {HTMLElement} deps.elements.modal
 * @param {Function} deps.getAccordionState - Function to get accordion state
 * @param {Function} deps.renderReactions - Re-render reactions for a record
 * @param {Function} deps.updateItemEmojiIndicator - Update emoji indicator next to item name
 * @param {Function} deps.updateReactionZoneSummary - Update reaction zone summary
 * @param {Function} deps.updateEventEmojiIndicator - Update event-level emoji
 * @param {Function} deps.updateLiveStreamToolbarUI - Update live stream toolbar
 * @param {Function} deps.updatePresentationLiveBadge - Update live badge
 * @param {Function} deps.spawnHostReactionOverlay - Spawn host reaction overlay
 * @param {Function} deps.loadComponentComments - Reload component comments
 * @param {Function} [deps.updateCommentReactionsDisplay] - Update comment reactions display
 */
export function init(deps) {
    if (deps.elements) {
        chatMessagesEl = deps.elements.chatMessagesEl;
        presentationMessageInput = deps.elements.presentationMessageInput;
        presentationMessageForm = deps.elements.presentationMessageForm;
        presentationUserNameInput = deps.elements.presentationUserNameInput;
        presentationWhosHereCount = deps.elements.presentationWhosHereCount;
        presentationWhosHereList = deps.elements.presentationWhosHereList;
        floatingChatBtn = deps.elements.floatingChatBtn;
        modal = deps.elements.modal;
    }
    _getAccordionState = deps.getAccordionState;
    _renderReactions = deps.renderReactions;
    _updateItemEmojiIndicator = deps.updateItemEmojiIndicator;
    _updateReactionZoneSummary = deps.updateReactionZoneSummary;
    _updateEventEmojiIndicator = deps.updateEventEmojiIndicator;
    _updateLiveStreamToolbarUI = deps.updateLiveStreamToolbarUI;
    _updatePresentationLiveBadge = deps.updatePresentationLiveBadge;
    _spawnHostReactionOverlay = deps.spawnHostReactionOverlay;
    _loadComponentComments = deps.loadComponentComments;
    _updateCommentReactionsDisplay = deps.updateCommentReactionsDisplay || null;
}

/**
 * Cleanup module state — disconnects Pusher, clears references.
 */
export function cleanup() {
    cleanupPresentationChat();
    cleanupFloatingChatButton();
    chatMessagesEl = null;
    presentationMessageInput = null;
    presentationMessageForm = null;
    presentationUserNameInput = null;
    presentationWhosHereCount = null;
    presentationWhosHereList = null;
    floatingChatBtn = null;
    modal = null;
    _getAccordionState = null;
    _renderReactions = null;
    _updateItemEmojiIndicator = null;
    _updateReactionZoneSummary = null;
    _updateEventEmojiIndicator = null;
    _updateLiveStreamToolbarUI = null;
    _updatePresentationLiveBadge = null;
    _spawnHostReactionOverlay = null;
    _loadComponentComments = null;
    _updateCommentReactionsDisplay = null;
}

/**
 * Return the Pusher channel (needed by emoji picker, component comments, etc.)
 */
export function getChannel() {
    return presentationChatChannel;
}

/**
 * Return the Pusher instance.
 */
export function getPusher() {
    return presentationPusher;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Message UI
// ---------------------------------------------------------------------------

export function addPresentationMessageToUI(sender, message, isSent, timestamp, senderId, options = {}) {
    if (!chatMessagesEl) return;

    const { messageId = null, reactions = {}, isEdited = false, isDeleted = false, replyCount = 0, parentMessageId = null, isReply = false, componentInfo = null } = options;
    const currentUser = getCurrentUser();

    // Skip deleted messages
    if (isDeleted) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'} deleted-message`;
        wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;
        chatMessagesEl.appendChild(wrapper);
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
    senderElement.className = 'message-author';
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
        e.preventDefault();
        showPresentationReactionPicker(wrapper, messageId, senderId);
    });
    actionsContainer.appendChild(reactionBtn);

    // Reply button
    const replyBtn = document.createElement('button');
    replyBtn.className = 'msg-action-btn reply-btn';
    replyBtn.innerHTML = '↩';
    replyBtn.title = 'Reply';
    replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startPresentationReply(messageId, sender, message);
    });
    actionsContainer.appendChild(replyBtn);

    // Edit button (only for own messages)
    if (isSent && messageId) {
        const editBtn = document.createElement('button');
        editBtn.className = 'msg-action-btn edit-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = 'Edit message';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startPresentationEdit(messageId, message, wrapper);
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
            confirmPresentationDelete(messageId, wrapper);
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
            // Refresh chat to reflect changes
            await initializePresentationChat();
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
                    togglePresentationReaction(messageId, emoji, !hasUserReacted, wrapper);
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
            togglePresentationThreadView(messageId, wrapper);
        });
        messageElement.appendChild(threadIndicator);
    }

    wrapper.appendChild(messageElement);
    chatMessagesEl.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth' });

    return wrapper;
}

// ---------------------------------------------------------------------------
// Reaction Picker
// ---------------------------------------------------------------------------

/**
 * Shows the emoji reaction picker near a message in presentation view
 */
function showPresentationReactionPicker(wrapper, messageId, senderId) {
    console.log('[ReactionPicker DEBUG] showPresentationReactionPicker called');
    console.log('[ReactionPicker DEBUG] wrapper:', wrapper);
    console.log('[ReactionPicker DEBUG] messageId:', messageId);
    console.log('[ReactionPicker DEBUG] QUICK_REACTIONS:', QUICK_REACTIONS);

    // Remove any existing picker
    const existingPickers = document.querySelectorAll('.reaction-picker');
    console.log('[ReactionPicker DEBUG] Existing pickers found:', existingPickers.length);
    existingPickers.forEach(p => p.remove());

    // Find the reaction button to position near it
    const reactionBtn = wrapper.querySelector('.msg-action-btn.reaction-btn');
    console.log('[ReactionPicker DEBUG] reactionBtn found:', reactionBtn);
    if (!reactionBtn) {
        console.log('[ReactionPicker DEBUG] ❌ No reaction button found, returning early');
        return;
    }

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    console.log('[ReactionPicker DEBUG] Created picker element:', picker);

    QUICK_REACTIONS.forEach((emoji, index) => {
        console.log(`[ReactionPicker DEBUG] Adding emoji ${index}:`, emoji, 'type:', typeof emoji);
        const btn = document.createElement('button');
        btn.className = 'reaction-picker-btn';
        btn.textContent = emoji;
        console.log(`[ReactionPicker DEBUG] Button ${index} textContent set to:`, btn.textContent);
        btn.addEventListener('click', async () => {
            console.log('[ReactionPicker DEBUG] Emoji button clicked:', emoji);
            picker.remove();
            await togglePresentationReaction(messageId, emoji, true, wrapper);
        });
        picker.appendChild(btn);
    });

    console.log('[ReactionPicker DEBUG] Picker innerHTML:', picker.innerHTML);
    console.log('[ReactionPicker DEBUG] Picker children count:', picker.children.length);

    // Append to body to avoid overflow clipping issues in presentation view
    document.body.appendChild(picker);
    console.log('[ReactionPicker DEBUG] ✅ Picker appended to document.body');

    // Position the picker near the reaction button
    const rect = reactionBtn.getBoundingClientRect();
    console.log('[ReactionPicker DEBUG] Button rect:', rect);

    picker.style.position = 'fixed';
    picker.style.zIndex = '10001'; // Higher than presentation modal (z-index: 1000)

    // Position above the button if there's room, otherwise below
    const pickerHeight = 50; // Approximate height
    if (rect.top > pickerHeight + 10) {
        picker.style.top = `${rect.top - pickerHeight - 8}px`;
    } else {
        picker.style.top = `${rect.bottom + 8}px`;
    }
    picker.style.left = `${Math.max(10, rect.left - 50)}px`;

    console.log('[ReactionPicker DEBUG] Final picker styles:', {
        position: picker.style.position,
        top: picker.style.top,
        left: picker.style.left,
        zIndex: picker.style.zIndex
    });

    // Verify picker is in DOM
    setTimeout(() => {
        const verifyPicker = document.querySelector('.reaction-picker');
        console.log('[ReactionPicker DEBUG] Verify picker in DOM after append:', verifyPicker);
        if (verifyPicker) {
            const computedStyle = window.getComputedStyle(verifyPicker);
            console.log('[ReactionPicker DEBUG] Picker computed styles:', {
                display: computedStyle.display,
                visibility: computedStyle.visibility,
                opacity: computedStyle.opacity,
                position: computedStyle.position,
                zIndex: computedStyle.zIndex,
                width: computedStyle.width,
                height: computedStyle.height
            });
        }
    }, 10);

    // Close picker when clicking elsewhere
    const closePicker = (e) => {
        console.log('[ReactionPicker DEBUG] closePicker triggered, target:', e.target);
        if (!picker.contains(e.target)) {
            console.log('[ReactionPicker DEBUG] Click outside picker, removing');
            picker.remove();
            document.removeEventListener('click', closePicker);
        }
    };
    setTimeout(() => document.addEventListener('click', closePicker), 0);
}

// ---------------------------------------------------------------------------
// Reaction Toggle & Display
// ---------------------------------------------------------------------------

/**
 * Toggles a reaction on a message in presentation view
 */
async function togglePresentationReaction(messageId, emoji, add, wrapper) {
    const currentUser = getCurrentUser();
    if (!messageId || !currentUser) return;

    const result = await api.toggleMessageReaction(messageId, currentUser.id, emoji, add);
    if (result !== null) {
        // Update the reactions display
        updatePresentationReactionsDisplay(wrapper, result);

        // Broadcast via Pusher if available
        if (presentationChatChannel) {
            presentationChatChannel.trigger('client-reaction-update', {
                messageId,
                reactions: result,
                userId: currentUser.id
            });
        }
    }
}

/**
 * Updates the reactions display on a message wrapper in presentation view
 */
function updatePresentationReactionsDisplay(wrapper, reactions) {
    const messageElement = wrapper.querySelector('.chat-message');
    if (!messageElement) return;

    const currentUser = getCurrentUser();

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
                    togglePresentationReaction(messageId, emoji, !hasUserReacted, wrapper);
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

// ---------------------------------------------------------------------------
// Reply
// ---------------------------------------------------------------------------

/**
 * Starts replying to a message in presentation view
 */
function startPresentationReply(messageId, senderName, messagePreview) {
    presentationReplyingToMessage = { id: messageId, sender: senderName, preview: messagePreview };

    // Show reply indicator in the input area
    const formContainer = presentationMessageForm;
    if (!formContainer || !formContainer.parentElement) return;

    // Remove existing reply indicator
    const existingIndicator = formContainer.parentElement.querySelector('.reply-indicator');
    if (existingIndicator) existingIndicator.remove();

    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'reply-indicator';
    replyIndicator.innerHTML = `
        <span class="reply-indicator-text">Replying to <strong>${escapeHtml(senderName)}</strong>: ${escapeHtml(messagePreview.substring(0, 50))}${messagePreview.length > 50 ? '...' : ''}</span>
        <button class="cancel-reply-btn" type="button">✕</button>
    `;

    replyIndicator.querySelector('.cancel-reply-btn').addEventListener('click', cancelPresentationReply);
    formContainer.parentElement.insertBefore(replyIndicator, formContainer);

    // Focus the input
    if (presentationMessageInput) presentationMessageInput.focus();
}

/**
 * Cancels the current reply in presentation view
 */
function cancelPresentationReply() {
    presentationReplyingToMessage = null;
    const formContainer = presentationMessageForm;
    if (formContainer && formContainer.parentElement) {
        const indicator = formContainer.parentElement.querySelector('.reply-indicator');
        if (indicator) indicator.remove();
    }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

/**
 * Starts editing a message in presentation view
 */
function startPresentationEdit(messageId, currentContent, wrapper) {
    presentationEditingMessage = { id: messageId, originalContent: currentContent };

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
    const currentUser = getCurrentUser();

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
                if (presentationChatChannel) {
                    presentationChatChannel.trigger('client-message-edited', {
                        messageId,
                        newContent,
                        userId: currentUser.id
                    });
                }
            }
        } else {
            cancelEditMode();
        }
        presentationEditingMessage = null;
    };

    const cancelEditMode = () => {
        contentElement.innerHTML = '';
        contentElement.textContent = originalText;
        presentationEditingMessage = null;
    };

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEditMode);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') cancelEditMode();
    });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Confirms and deletes a message in presentation view
 */
async function confirmPresentationDelete(messageId, wrapper) {
    if (!confirm('Delete this message? This cannot be undone.')) return;

    const currentUser = getCurrentUser();
    const result = await api.deleteChatMessage(messageId, currentUser.id);
    if (result) {
        wrapper.classList.add('deleted-message');
        wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;

        // Broadcast delete via Pusher
        if (presentationChatChannel) {
            presentationChatChannel.trigger('client-message-deleted', {
                messageId,
                userId: currentUser.id
            });
        }
    }
}

// ---------------------------------------------------------------------------
// Thread View
// ---------------------------------------------------------------------------

/**
 * Toggles the thread view for a message in presentation view
 */
async function togglePresentationThreadView(messageId, wrapper) {
    const existingThread = wrapper.querySelector('.thread-replies');
    if (existingThread) {
        existingThread.remove();
        return;
    }

    const currentUser = getCurrentUser();
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
        // Use createdTime from record level, fall back to fields.Timestamp
        const replyTime = new Date(reply.createdTime || Timestamp || Date.now());

        const replyWrapper = document.createElement('div');
        replyWrapper.className = `reply-message ${isSent ? 'sent' : 'received'}`;
        replyWrapper.dataset.messageId = reply.id;

        if (IsDeleted) {
            replyWrapper.innerHTML = `<em class="deleted-reply">This reply was deleted</em>`;
        } else {
            replyWrapper.innerHTML = `
                <span class="reply-sender">${isSent ? 'You' : escapeHtml(SenderName)}</span>
                <span class="reply-content">${escapeHtml(Content)}${IsEdited ? ' <em class="edited-indicator">(edited)</em>' : ''}</span>
                <span class="reply-time">${replyTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            `;
        }

        threadContainer.appendChild(replyWrapper);
    });

    wrapper.appendChild(threadContainer);
}

// ---------------------------------------------------------------------------
// Presence UI
// ---------------------------------------------------------------------------

function updatePresentationPresenceUI(members) {
    const count = members.count;
    if (presentationWhosHereCount) presentationWhosHereCount.innerText = count;

    // Track which member IDs are currently online
    const onlineMemberIds = new Set();
    members.each((member) => {
        onlineMemberIds.add(member.id);
    });

    if (presentationWhosHereList) {
        presentationWhosHereList.innerHTML = '';
        members.each((member) => {
            const currentUser = getCurrentUser();
            const profileId = state.session.user.isAuthenticated ? state.session.user.id : member.id;
            const profileName = state.session.user.isAuthenticated ? state.session.user.name : member.info.name;

            if (!state.session.userProfiles.has(profileId)) {
                state.session.userProfiles.set(profileId, profileName);
                triggerSave();
            }

            const userElement = document.createElement('div');
            userElement.className = 'presentation-presence-item';
            const displayName = member.id === currentUser.id ? currentUser.name : member.info.name;
            userElement.innerHTML = `<span class="presence-dot"></span>${displayName}${member.id === currentUser.id ? ' (You)' : ''}`;
            presentationWhosHereList.appendChild(userElement);
        });
    }

    // Update presentation header presence avatar bar
    updatePresentationPresenceAvatarBar(members);

    // Update collaborator name buttons with online presence indicators
    const collabBtns = document.querySelectorAll('.collaborator-name-btn[data-collaborator-id]');
    collabBtns.forEach(btn => {
        const collabId = btn.dataset.collaboratorId;
        if (onlineMemberIds.has(collabId)) {
            btn.classList.add('online');
        } else {
            btn.classList.remove('online');
        }
    });

    // Update Team count badge to show online/total
    const teamCountNumber = document.getElementById('team-count-number');
    if (teamCountNumber) {
        const totalTeam = state.session.userProfiles?.size || 1;
        if (count > 1) {
            teamCountNumber.textContent = `${count}/${totalTeam}`;
        } else {
            teamCountNumber.textContent = totalTeam;
        }
    }
}

/**
 * Update the presence avatar bar in the presentation header
 */
function updatePresentationPresenceAvatarBar(members) {
    const container = document.getElementById('presentation-presence-avatar-bar');
    if (!container) return;

    container.innerHTML = '';
    const MAX_AVATARS = 5;
    const memberList = [];
    const currentUser = getCurrentUser();
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
        container.appendChild(avatar);
    });

    if (overflowCount > 0) {
        const overflow = document.createElement('div');
        overflow.className = 'presence-avatar presence-avatar-overflow';
        overflow.textContent = `+${overflowCount}`;
        overflow.title = `${overflowCount} more online`;
        container.appendChild(overflow);
    }

    container.style.display = memberList.length > 0 ? 'flex' : 'none';
}

// ---------------------------------------------------------------------------
// Main Chat Initialization
// ---------------------------------------------------------------------------

export async function initializePresentationChat() {
    const currentUser = getCurrentUser();
    const sessionId = state.session.id || 'default-session';

    // Set up user name input
    if (presentationUserNameInput) {
        presentationUserNameInput.value = currentUser.name;
        presentationUserNameInput.addEventListener('change', (e) => {
            const newName = e.target.value.trim();
            if (newName && newName !== currentUser.name) {
                currentUser.name = newName;
                localStorage.setItem('chatUserName', newName);
                state.session.userProfiles.set(currentUser.id, newName);
                log('Presentation', `User name changed to: ${newName}`);
                if (presentationChatChannel && presentationChatChannel.members) {
                    updatePresentationPresenceUI(presentationChatChannel.members);
                }
                triggerSave();
            } else {
                e.target.value = currentUser.name;
            }
        });
    }

    // Load existing chat messages with enhanced data
    chatMessagesEl.innerHTML = '';
    try {
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
            records.forEach(record => {
                const { SenderID, SenderName, Content, Timestamp, EventType, Reactions, IsEdited, IsDeleted, ParentMessageID } = record.fields;
                const itemLink = record.fields['Item Link']; // Array of linked item IDs (for component comments)

                // Skip reply messages (they're shown in threads) and system events
                if (ParentMessageID) return;
                if (SenderID === 'system' && EventType) return;

                const isSent = SenderID === currentUser.id;
                let parsedReactions = {};
                if (Reactions) {
                    try { parsedReactions = JSON.parse(Reactions); } catch (e) {}
                }

                // Get component name if this is a component comment (has Item Link)
                let componentInfo = null;
                if (itemLink && itemLink.length > 0) {
                    const componentId = itemLink[0];
                    const componentRecord = getRecordById(componentId);
                    componentInfo = {
                        id: componentId,
                        name: componentRecord?.fields?.Name || 'Unknown Item'
                    };
                }

                // Use createdTime from record level, fall back to fields.Timestamp
                const messageTime = record.createdTime || Timestamp;

                addPresentationMessageToUI(SenderName, Content, isSent, messageTime, SenderID, {
                    messageId: record.id,
                    reactions: parsedReactions,
                    isEdited: IsEdited || false,
                    isDeleted: IsDeleted || false,
                    replyCount: replyCountMap[record.id] || 0,
                    componentInfo // Include component info for @component tags
                });
            });
        } else {
            chatMessagesEl.innerHTML = '<p class="chat-empty">No messages yet. Start the conversation!</p>';
        }
    } catch (err) {
        log('Presentation', `Failed to load chat messages: ${err.message}`);
        chatMessagesEl.innerHTML = '<p class="chat-empty">Unable to load messages.</p>';
    }

    // Wait for Pusher library to be loaded
    if (typeof window.waitForPusher === 'function') {
        try {
            await window.waitForPusher();
        } catch (err) {
            if (presentationMessageInput) {
                presentationMessageInput.placeholder = 'Chat unavailable - please refresh';
                presentationMessageInput.disabled = true;
            }
            return;
        }
    } else if (typeof Pusher === 'undefined') {
        if (presentationMessageInput) {
            presentationMessageInput.placeholder = 'Chat unavailable - please refresh';
            presentationMessageInput.disabled = true;
        }
        return;
    }

    // Disconnect existing connection if any
    if (presentationPusher) {
        presentationPusher.disconnect();
    }

    // Initialize Pusher for real-time chat
    presentationPusher = new Pusher('236f480714e5001590b5', {
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
    presentationChatChannel = presentationPusher.subscribe(channelName);

    // Bind presence events
    presentationChatChannel.bind('pusher:subscription_succeeded', (members) => {
        if (presentationMessageInput) {
            presentationMessageInput.disabled = false;
            presentationMessageInput.placeholder = 'Type a message...';
        }
        updatePresentationPresenceUI(members);
    });

    presentationChatChannel.bind('pusher:member_added', (member) => {
        updatePresentationPresenceUI(presentationChatChannel.members);
        // Show toast when someone joins
        handleToastPusherEvent('member-joined', {
            name: member?.info?.name || 'Someone',
            userId: member?.id
        });
    });

    presentationChatChannel.bind('pusher:member_removed', () => {
        updatePresentationPresenceUI(presentationChatChannel.members);
    });

    // Bind to receive new messages
    presentationChatChannel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            // Remove empty state message if present
            const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
            if (emptyMsg) emptyMsg.remove();

            addPresentationMessageToUI(data.senderName, data.content, false, data.timestamp, data.senderId, {
                messageId: data.messageId
            });
            // Refresh forum panel if open
            refreshForumData();
            // Update notification counts
            onNewItemReceived('message', { timestamp: data.timestamp });
            // Show toast notification
            const isIdea = (data.content || '').startsWith('[IDEA]');
            handleToastPusherEvent('new-message', {
                sender: data.senderName,
                message: isIdea ? data.content.replace(/^\[IDEA\]\s*/, '') : data.content,
                senderId: data.senderId,
                isIdea: isIdea
            });
        }
    });

    // Handle real-time reaction updates from other users
    presentationChatChannel.bind('client-reaction-update', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = chatMessagesEl.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                updatePresentationReactionsDisplay(wrapper, data.reactions);
            }
            // Refresh forum panel if open to show updated reactions
            refreshForumData();
            // Update notification counts
            onNewItemReceived('reaction', { timestamp: new Date().toISOString() });
        }
    });

    // Handle real-time message edits from other users
    presentationChatChannel.bind('client-message-edited', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = chatMessagesEl.querySelector(`[data-message-id="${data.messageId}"]`);
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
        }
    });

    // Handle real-time message deletes from other users
    presentationChatChannel.bind('client-message-deleted', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = chatMessagesEl.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                wrapper.classList.add('deleted-message');
                wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;
            }
            // Refresh forum panel if open to show deleted message
            refreshForumData();
        }
    });

    // Handle real-time replies from other users
    presentationChatChannel.bind('client-new-reply', (data) => {
        if (data.senderId !== currentUser.id) {
            const parentWrapper = chatMessagesEl.querySelector(`[data-message-id="${data.parentMessageId}"]`);
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
                        togglePresentationThreadView(data.parentMessageId, parentWrapper);
                    });
                    parentWrapper.querySelector('.chat-message')?.appendChild(threadIndicator);
                }
            }
            // Refresh forum panel if open to show new replies
            refreshForumData();
            // Update notification counts
            onNewItemReceived('reply', { timestamp: new Date().toISOString() });
        }
    });

    // Handle real-time component comments from other users
    presentationChatChannel.bind('client-component-comment', (data) => {
        if (data.senderId !== currentUser.id) {
            const componentId = data.componentId;
            // Update count
            const countEl = document.querySelector(`.comments-count[data-component-id="${componentId}"]`);
            if (countEl) {
                const currentCount = parseInt(countEl.textContent) || 0;
                countEl.textContent = currentCount + 1;
            }
            // Reload comments if section is open
            const body = document.querySelector(`.component-comments-body[data-component-id="${componentId}"]`);
            if (body && body.style.display !== 'none') {
                if (_loadComponentComments) _loadComponentComments(componentId);
            }

            // Also add the comment to the chat area with @component tag
            if (chatMessagesEl && data.comment) {
                const componentRecord = getRecordById(componentId);
                const componentInfo = {
                    id: componentId,
                    name: componentRecord?.fields?.Name || 'Unknown Item'
                };

                // Remove empty state if present
                const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
                if (emptyMsg) emptyMsg.remove();

                addPresentationMessageToUI(
                    data.comment.fields?.SenderName || 'Unknown',
                    data.comment.fields?.Content || '',
                    false,
                    data.comment.fields?.Timestamp || new Date().toISOString(),
                    data.senderId,
                    {
                        messageId: data.comment.id,
                        componentInfo
                    }
                );
            }

            // Refresh forum panel if open to show new component comments
            refreshForumData();
            // Update notification counts for new component comment
            onNewItemReceived('comment', { timestamp: data.comment.fields?.Timestamp || new Date().toISOString() });
            log('Presentation', `Received component comment from ${data.senderId} on ${componentId}`);
        }
    });

    // Handle real-time component comment reactions from other users
    presentationChatChannel.bind('client-component-comment-reaction', (data) => {
        if (data.senderId !== currentUser.id) {
            const commentEl = document.querySelector(`.component-comment[data-comment-id="${data.commentId}"]`);
            if (commentEl) {
                if (_updateCommentReactionsDisplay) _updateCommentReactionsDisplay(commentEl, data.reactions);
            }
            // Refresh forum panel if open to show updated reactions
            refreshForumData();
        }
    });

    // Handle real-time item reaction updates from other users
    presentationChatChannel.bind('client-item-reaction-update', (data) => {
        if (data.userId !== currentUser.id) {
            const { recordId, reactions } = data;
            console.log(`[REACTIONS-DEBUG] Pusher received: recordId="${recordId}", from="${data.userId}", payload=`, JSON.stringify(reactions));

            // Update local state from received reactions object
            if (!state.session.reactions.has(recordId)) {
                state.session.reactions.set(recordId, new Map());
            }
            const itemReactions = state.session.reactions.get(recordId);

            // Clear existing and rebuild from received data
            itemReactions.clear();
            if (reactions && typeof reactions === 'object') {
                Object.entries(reactions).forEach(([odUserId, emojiData]) => {
                    // Support both array (new multi-emoji) and string (legacy) formats
                    if (Array.isArray(emojiData)) {
                        itemReactions.set(odUserId, new Set(emojiData));
                    } else if (typeof emojiData === 'string') {
                        itemReactions.set(odUserId, new Set([emojiData]));
                    }
                });
            }

            // Re-render reactions for this item
            const reactionContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
            if (reactionContainer) {
                if (_renderReactions) _renderReactions(recordId, reactionContainer);
            }

            // Update the emoji indicator next to item name
            if (_updateItemEmojiIndicator) _updateItemEmojiIndicator(recordId);

            // Update the reactions summary
            reactionRankings.renderReactionsSummary();

            // Update the reaction zone summary on compact cards
            if (_updateReactionZoneSummary) _updateReactionZoneSummary(recordId);

            // Update the event-level emoji indicator
            if (_updateEventEmojiIndicator) _updateEventEmojiIndicator();
        }
    });

    // v3.8: Handle stream-started broadcast from another user (viewer auto-join)
    presentationChatChannel.bind('client-stream-started', (data) => {
        if (data.hostUserId !== currentUser.id) {
            log('Presentation', `Stream started by ${data.hostName} (channel: ${data.channelName})`);
            setState({
                stream: {
                    isActive: true,
                    isHost: false,
                    hostUserId: data.hostUserId,
                    channelName: data.channelName,
                    startedAt: Date.now(),
                }
            });
            if (_updateLiveStreamToolbarUI) _updateLiveStreamToolbarUI();
            if (_updatePresentationLiveBadge) _updatePresentationLiveBadge();
            populateFocusSelect();
            updateFocusBarUI();
            showToast(`${data.hostName} is now live!`);

            // Auto-join as viewer
            liveStream.joinAsViewer({ channelName: data.channelName });
        }
    });

    // v3.8: Handle stream-ended broadcast from another user
    presentationChatChannel.bind('client-stream-ended', (data) => {
        if (data.hostUserId !== currentUser.id) {
            log('Presentation', 'Remote stream ended');
            liveStream.endStream();
            if (_updateLiveStreamToolbarUI) _updateLiveStreamToolbarUI();
            if (_updatePresentationLiveBadge) _updatePresentationLiveBadge();
            updateFocusBarUI();
            showToast('Stream has ended');
        }
    });

    // v3.8 Phase 3: Handle focus item change broadcast from another user
    // Use socketId (unique per connection) instead of userId for echo prevention,
    // so same-user different-browser scenarios still receive updates.
    presentationChatChannel.bind('client-focus-item', (data) => {
        const mySocketId = presentationPusher?.connection?.socket_id;
        const isEcho = data.socketId && data.socketId === mySocketId;
        console.warn('[SYNC DEBUG] Received client-focus-item:', {
            itemId: data.itemId,
            senderSocketId: data.socketId,
            senderUserId: data.userId,
            mySocketId,
            myUserId: currentUser.id,
            isEcho,
            streamActive: state.stream?.isActive,
        });
        if (!isEcho) {
            log('Presentation', `Remote focus item change: ${data.itemId || 'cleared'}`);
            applyRemoteFocusItem(data.itemId || null);
        } else {
            console.warn('[SYNC DEBUG] Ignoring own focus-item echo');
        }
    });

    // v3.8 Phase 3: Handle pin message broadcast from another user
    presentationChatChannel.bind('client-pin-message', (data) => {
        const mySocketId = presentationPusher?.connection?.socket_id;
        const isEcho = data.socketId && data.socketId === mySocketId;
        console.warn('[SYNC DEBUG] Received client-pin-message:', {
            messageId: data.messageId,
            itemId: data.itemId,
            senderSocketId: data.socketId,
            senderUserId: data.userId,
            mySocketId,
            myUserId: currentUser.id,
            isEcho,
        });
        if (!isEcho) {
            log('Presentation', `Remote pin: message ${data.messageId} → item ${data.itemId || 'none'}`);
            applyRemotePin(data.messageId, data.itemId || null);
        } else {
            console.warn('[SYNC DEBUG] Ignoring own pin-message echo');
        }
    });

    // v3.8 Phase 3: Bridge UCP focus/pin events to Pusher broadcasts
    // Include socketId for echo prevention (allows same-user, different-browser sync)
    window.addEventListener('ucp-focus-item-changed', (e) => {
        const socketId = presentationPusher?.connection?.socket_id;
        const channelSubscribed = presentationChatChannel?.subscribed;
        console.warn('[SYNC DEBUG] Bridge: ucp-focus-item-changed window event received:', {
            itemId: e.detail.itemId,
            hasChannel: !!presentationChatChannel,
            channelSubscribed,
            socketId,
        });
        if (presentationChatChannel) {
            if (!channelSubscribed) {
                console.warn('[SYNC DEBUG] WARNING: Channel not yet subscribed, trigger may fail');
            }
            const sent = presentationChatChannel.trigger('client-focus-item', {
                itemId: e.detail.itemId,
                userId: currentUser.id,
                socketId: socketId,
            });
            console.warn('[SYNC DEBUG] Pusher trigger client-focus-item result:', sent);
        } else {
            console.warn('[SYNC DEBUG] ERROR: No presentationChatChannel — focus event not sent');
        }
    });

    window.addEventListener('ucp-pin-message', (e) => {
        const socketId = presentationPusher?.connection?.socket_id;
        const channelSubscribed = presentationChatChannel?.subscribed;
        console.warn('[SYNC DEBUG] Bridge: ucp-pin-message window event received:', {
            messageId: e.detail.messageId,
            itemId: e.detail.itemId,
            hasChannel: !!presentationChatChannel,
            channelSubscribed,
            socketId,
        });
        if (presentationChatChannel) {
            if (!channelSubscribed) {
                console.warn('[SYNC DEBUG] WARNING: Channel not yet subscribed, trigger may fail');
            }
            const sent = presentationChatChannel.trigger('client-pin-message', {
                messageId: e.detail.messageId,
                itemId: e.detail.itemId,
                userId: currentUser.id,
                socketId: socketId,
            });
            console.warn('[SYNC DEBUG] Pusher trigger client-pin-message result:', sent);
        } else {
            console.warn('[SYNC DEBUG] ERROR: No presentationChatChannel — pin event not sent');
        }
    });

    // v3.8 Phase 6: Handle viewer messages from the public stream channel (relayed by server)
    presentationChatChannel.bind('viewer-message', (data) => {
        log('Presentation', `Viewer message from ${data.senderName}: ${data.content}`);
        // Display in presentation chat as a viewer message
        addPresentationMessageToUI(
            `${data.senderName} (Viewer)`,
            data.content,
            false,
            data.timestamp,
            null,
            { isViewerMessage: true }
        );
    });

    // v3.8 Phase 6: Handle viewer reactions (floating emoji overlay on host side)
    presentationChatChannel.bind('viewer-reaction', (data) => {
        if (_spawnHostReactionOverlay) _spawnHostReactionOverlay(data.emoji);
    });

    // v3.8 Phase 6: Bridge focus item changes to viewer public channel
    window.addEventListener('ucp-focus-item-changed', (e) => {
        if (!state.stream?.isActive || !state.stream?.isHost) return;
        const itemId = e.detail?.itemId;
        // Find item name for display on viewer page
        let itemName = '';
        if (itemId) {
            const record = state.records.all.find(r => r && r.id === itemId);
            itemName = record?.fields?.Name || 'Item';
        }
        // Relay to viewer public channel via server
        fetch('/api/viewer-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessionId: state.session.id,
                senderName: 'host',
                content: itemName,
                type: 'state-update',
            }),
        }).catch(err => console.warn('[Presentation] Focus state relay failed:', err.message));
    });

    // Set up message form submission
    if (presentationMessageForm) {
        const newForm = presentationMessageForm.cloneNode(true);
        presentationMessageForm.parentNode.replaceChild(newForm, presentationMessageForm);
        presentationMessageForm = newForm;

        const newInput = document.getElementById('presentation-message-input');
        presentationMessageInput = newInput;

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const message = presentationMessageInput.value.trim();
            if (!message) return;

            // Remove empty state message if present
            const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
            if (emptyMsg) emptyMsg.remove();

            const timestamp = new Date().toISOString();

            // Check if this is a reply
            if (presentationReplyingToMessage) {
                const result = await api.postReplyMessage(presentationReplyingToMessage.id, sessionId, null, currentUser.id, currentUser.name, message);
                if (result) {
                    // Update the parent message's reply count in UI
                    const parentWrapper = chatMessagesEl.querySelector(`[data-message-id="${presentationReplyingToMessage.id}"]`);
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
                                togglePresentationThreadView(presentationReplyingToMessage.id, parentWrapper);
                            });
                            parentWrapper.querySelector('.chat-message')?.appendChild(threadIndicator);
                        }
                    }
                    presentationChatChannel.trigger('client-new-reply', {
                        parentMessageId: presentationReplyingToMessage.id,
                        content: message,
                        senderId: currentUser.id,
                        senderName: currentUser.name,
                        timestamp: timestamp
                    });
                }
                cancelPresentationReply();
            } else {
                // Regular message (not a reply)
                addPresentationMessageToUI(currentUser.name, message, true, timestamp, currentUser.id);

                // Send via API and broadcast
                try {
                    await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message);
                    presentationChatChannel.trigger('client-new-message', {
                        content: message,
                        senderId: currentUser.id,
                        senderName: currentUser.name,
                        timestamp: timestamp
                    });
                } catch (err) {
                    log('Presentation', `Failed to send message: ${err.message}`);
                }
            }

            // Clear input
            presentationMessageInput.value = '';
        });
    }

    log('Presentation', 'Embedded chat initialized with enhanced features');
}

// ---------------------------------------------------------------------------
// Chat Cleanup
// ---------------------------------------------------------------------------

export function cleanupPresentationChat() {
    // Disconnect Pusher when leaving presentation view
    if (presentationChatChannel) {
        presentationChatChannel.unbind_all();
    }
    if (presentationPusher) {
        presentationPusher.disconnect();
        presentationPusher = null;
        presentationChatChannel = null;
    }
    // Clear reply state
    presentationReplyingToMessage = null;
    presentationEditingMessage = null;
}

// ---------------------------------------------------------------------------
// Floating Chat Button
// ---------------------------------------------------------------------------

/**
 * Initializes the floating chat button for the presentation view
 * Shows/hides based on scroll position and handles jump to chat functionality
 */
export function initializeFloatingChatButton() {
    if (!floatingChatBtn || !modal) return;

    const presentationContent = modal.querySelector('.presentation-content');
    const chatContainer = modal.querySelector('#presentation-chat-container');

    if (!presentationContent || !chatContainer) return;

    // Function to check if chat section is visible in viewport
    const isChatInView = () => {
        const chatRect = chatContainer.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        // Chat is "in view" if its top is visible within the modal
        return chatRect.top < modalRect.bottom - 100 && chatRect.bottom > modalRect.top;
    };

    // Scroll handler
    floatingChatScrollHandler = () => {
        const chatVisible = isChatInView();

        // Toggle scrolled-to-chat class for icon rotation
        if (chatVisible) {
            floatingChatBtn.classList.add('scrolled-to-chat');
            floatingChatBtn.title = 'Back to top';
        } else {
            floatingChatBtn.classList.remove('scrolled-to-chat');
            floatingChatBtn.title = 'Jump to Chat';
        }
    };

    // Add scroll listener to modal (presentation content scrolls within it)
    presentationContent.addEventListener('scroll', floatingChatScrollHandler);

    // Click handler for the floating button
    const clickHandler = () => {
        const chatVisible = isChatInView();

        if (chatVisible) {
            // If viewing chat, scroll back to top or saved position
            if (savedScrollPosition !== null) {
                presentationContent.scrollTo({ top: savedScrollPosition, behavior: 'smooth' });
                savedScrollPosition = null;
            } else {
                presentationContent.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } else {
            // Save current position and scroll to chat
            savedScrollPosition = presentationContent.scrollTop;
            chatContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Also expand the hosts-chat sub-accordion if it's collapsed
            if (_getAccordionState && !_getAccordionState()['hosts-chat']) {
                const hostsChatAccordion = modal.querySelector('.sub-accordion[data-section="hosts-chat"]');
                const hostsChatHeader = hostsChatAccordion?.querySelector('.sub-accordion-header');
                if (hostsChatHeader) hostsChatHeader.click();
            }

            // Focus the input after scrolling
            setTimeout(() => {
                if (presentationMessageInput) presentationMessageInput.focus();
            }, 500);
        }
    };

    // Store handler for cleanup
    floatingChatBtn._clickHandler = clickHandler;
    floatingChatBtn.addEventListener('click', clickHandler);

    // Show the button
    floatingChatBtn.classList.add('visible');

    // Initial check
    floatingChatScrollHandler();

    log('Presentation', 'Floating chat button initialized');
}

/**
 * Cleans up the floating chat button event listeners
 */
export function cleanupFloatingChatButton() {
    if (floatingChatBtn) {
        floatingChatBtn.classList.remove('visible', 'scrolled-to-chat');

        if (floatingChatBtn._clickHandler) {
            floatingChatBtn.removeEventListener('click', floatingChatBtn._clickHandler);
            floatingChatBtn._clickHandler = null;
        }
    }

    if (floatingChatScrollHandler && modal) {
        const presentationContent = modal.querySelector('.presentation-content');
        if (presentationContent) {
            presentationContent.removeEventListener('scroll', floatingChatScrollHandler);
        }
        floatingChatScrollHandler = null;
    }

    savedScrollPosition = null;
    log('Presentation', 'Floating chat button cleaned up');
}

// ---------------------------------------------------------------------------
// Legacy Stub
// ---------------------------------------------------------------------------

export function renderChatMessages() {
    // Legacy function - now handled by initializePresentationChat
    // Kept for compatibility but no longer clones messages
    if (!chatMessagesEl) return;
    chatMessagesEl.innerHTML = '<p class="chat-empty">Loading chat...</p>';
}
