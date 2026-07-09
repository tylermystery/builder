/**
 * Emoji Picker
 * Full emoji picker overlay with categories/tiers and emoji selection.
 * Extracted from presentation.js — Phase 2 modularization.
 */

import { state, getRecordById } from '../../state.js';
import { EMOJI_CATEGORIES, REACTION_SCORES, getModalZIndex } from '../../config.js';
import { log } from '../../utils/debug.js';
import { getCurrentUser } from '../../chat.js';
import { triggerSave } from '../../events.js';
import * as reactionRankings from './reactionRankings.js';

// Dependencies injected via init()
let _getReactionScore = null;
let _renderReactions = null;
let _updateItemEmojiIndicator = null;
let _updateReactionZoneSummary = null;
let _updateEventEmojiIndicator = null;
let _getPresentationChatChannel = null;

/**
 * Initialize the emoji picker module.
 * @param {Object} deps
 * @param {Function} deps.getReactionScore - Returns sentiment score for an emoji
 * @param {Function} deps.renderReactions - Re-renders reactions for a record
 * @param {Function} deps.updateItemEmojiIndicator - Updates emoji indicator next to item name
 * @param {Function} deps.updateReactionZoneSummary - Updates reaction zone on compact cards
 * @param {Function} deps.updateEventEmojiIndicator - Updates event-level emoji indicator
 * @param {Function} deps.getPresentationChatChannel - Returns the Pusher channel
 */
export function init(deps) {
    _getReactionScore = deps.getReactionScore;
    _renderReactions = deps.renderReactions;
    _updateItemEmojiIndicator = deps.updateItemEmojiIndicator;
    _updateReactionZoneSummary = deps.updateReactionZoneSummary;
    _updateEventEmojiIndicator = deps.updateEventEmojiIndicator;
    _getPresentationChatChannel = deps.getPresentationChatChannel;
}

/**
 * Cleanup module state.
 */
export function cleanup() {
    closeExpandedEmojiPicker();
}

// Generate the expanded emoji picker HTML
function createEmojiPickerHTML(recordId) {
    let categoriesHTML = '';
    Object.entries(EMOJI_CATEGORIES).forEach(([categoryKey, category]) => {
        const emojisHTML = category.emojis.map(emoji => {
            const score = _getReactionScore(emoji);
            const scoreClass = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
            return `<button class="emoji-picker-emoji ${scoreClass}" data-emoji="${emoji}" data-record-id="${recordId}" title="Score: ${score > 0 ? '+' : ''}${score.toFixed(2)}">${emoji}</button>`;
        }).join('');

        categoriesHTML += `
            <div class="emoji-picker-category" data-category="${categoryKey}">
                <div class="emoji-picker-category-label">${category.label}</div>
                <div class="emoji-picker-category-emojis">${emojisHTML}</div>
            </div>
        `;
    });

    return `
        <div class="emoji-picker-modal" data-record-id="${recordId}">
            <div class="emoji-picker-header">
                <span class="emoji-picker-title">Choose a Reaction</span>
                <button class="emoji-picker-close" aria-label="Close emoji picker">&times;</button>
            </div>
            <div class="emoji-picker-categories">${categoriesHTML}</div>
            <div class="emoji-picker-footer">
                <span class="emoji-score-legend">
                    <span class="legend-item positive">● Positive</span>
                    <span class="legend-item neutral">● Neutral</span>
                    <span class="legend-item negative">● Negative</span>
                </span>
            </div>
        </div>
    `;
}

// Show the expanded emoji picker
export function showExpandedEmojiPicker(recordId, anchorElement) {
    console.log('[ExpandedEmojiPicker DEBUG] showExpandedEmojiPicker called');
    console.log('[ExpandedEmojiPicker DEBUG] recordId:', recordId);
    console.log('[ExpandedEmojiPicker DEBUG] anchorElement:', anchorElement);

    // Close any existing picker
    closeExpandedEmojiPicker();

    const pickerHTML = createEmojiPickerHTML(recordId);
    console.log('[ExpandedEmojiPicker DEBUG] pickerHTML length:', pickerHTML.length);

    // Get the appropriate z-index for the picker (very high to ensure visibility above presentation view)
    const pickerZIndex = getModalZIndex('picker');
    const isPresentationActive = document.body.classList.contains('presentation-active');
    console.log('[ExpandedEmojiPicker DEBUG] z-index:', pickerZIndex, 'presentation active:', isPresentationActive);

    const pickerContainer = document.createElement('div');
    pickerContainer.className = 'emoji-picker-overlay';
    pickerContainer.innerHTML = pickerHTML;

    // Apply inline styles to ensure the overlay is always visible above presentation view
    // This prevents CSS load timing issues from hiding the picker
    pickerContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        z-index: ${pickerZIndex};
        display: flex;
        justify-content: center;
        align-items: center;
        pointer-events: auto;
    `;
    console.log('[ExpandedEmojiPicker DEBUG] pickerContainer created with z-index:', pickerZIndex);

    // Add to DOM
    document.body.appendChild(pickerContainer);
    console.log('[ExpandedEmojiPicker DEBUG] ✅ pickerContainer appended to document.body');

    // Position near the anchor
    const picker = pickerContainer.querySelector('.emoji-picker-modal');
    const rect = anchorElement.getBoundingClientRect();
    console.log('[ExpandedEmojiPicker DEBUG] anchor rect:', rect);

    // Center the picker on screen for mobile, near anchor for desktop
    // Use fixed positioning to keep the modal within the viewport
    if (window.innerWidth <= 768) {
        picker.style.position = 'fixed';
        picker.style.top = '50%';
        picker.style.left = '50%';
        picker.style.transform = 'translate(-50%, -50%)';
        picker.style.zIndex = String(pickerZIndex + 1);
        console.log('[ExpandedEmojiPicker DEBUG] Mobile positioning: centered');
    } else {
        // Use fixed positioning for desktop too, but offset from center based on anchor
        picker.style.position = 'fixed';
        // Position the modal near the anchor button, but ensure it's visible
        const modalWidth = 400; // max-width from CSS
        const modalHeight = Math.min(window.innerHeight * 0.8, 500); // approximate height

        // Calculate position - try to position below and slightly left of the anchor
        let top = rect.bottom + 10;
        let left = rect.left - 100;

        // Ensure modal stays within viewport
        if (top + modalHeight > window.innerHeight) {
            top = Math.max(10, rect.top - modalHeight - 10);
        }
        if (left < 10) {
            left = 10;
        }
        if (left + modalWidth > window.innerWidth) {
            left = window.innerWidth - modalWidth - 10;
        }

        picker.style.top = `${top}px`;
        picker.style.left = `${left}px`;
        picker.style.zIndex = String(pickerZIndex + 1);
        console.log('[ExpandedEmojiPicker DEBUG] Desktop positioning:', picker.style.top, picker.style.left);
    }

    // Verify picker visibility
    setTimeout(() => {
        const verifyPicker = document.querySelector('.emoji-picker-overlay');
        console.log('[ExpandedEmojiPicker DEBUG] Verify picker in DOM:', verifyPicker);
        if (verifyPicker) {
            const modal = verifyPicker.querySelector('.emoji-picker-modal');
            if (modal) {
                const computedStyle = window.getComputedStyle(modal);
                console.log('[ExpandedEmojiPicker DEBUG] Modal computed styles:', {
                    display: computedStyle.display,
                    visibility: computedStyle.visibility,
                    opacity: computedStyle.opacity,
                    position: computedStyle.position,
                    zIndex: computedStyle.zIndex,
                    width: computedStyle.width,
                    height: computedStyle.height
                });
                // Check if it's correctly layered above presentation
                const presentationView = document.getElementById('itinerary-fullpage-view');
                if (presentationView) {
                    const presentationZIndex = window.getComputedStyle(presentationView).zIndex;
                    console.log('[ExpandedEmojiPicker DEBUG] Presentation z-index:', presentationZIndex);
                    if (parseInt(computedStyle.zIndex) > parseInt(presentationZIndex)) {
                        console.log('[ExpandedEmojiPicker DEBUG] ✓ Picker is correctly above presentation view');
                    } else {
                        console.warn('[ExpandedEmojiPicker DEBUG] ⚠ Picker may be below presentation view');
                    }
                }
            }
        }
    }, 10);

    // Add event listeners
    pickerContainer.addEventListener('click', handleEmojiPickerClick);

    // Close on outside click (clicking the overlay background)
    pickerContainer.addEventListener('click', (e) => {
        // Stop propagation to prevent any parent handlers from firing
        e.stopPropagation();
        if (e.target === pickerContainer) {
            closeExpandedEmojiPicker();
        }
    });

    // Close on Escape
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeExpandedEmojiPicker();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// Close the expanded emoji picker
export function closeExpandedEmojiPicker() {
    const existingPicker = document.querySelector('.emoji-picker-overlay');
    if (existingPicker) {
        existingPicker.remove();
    }
}

// Handle clicks within the emoji picker
function handleEmojiPickerClick(e) {
    // Stop propagation to prevent any parent handlers from firing
    e.stopPropagation();

    // Close button
    if (e.target.classList.contains('emoji-picker-close')) {
        closeExpandedEmojiPicker();
        return;
    }

    // Emoji selection
    const emojiBtn = e.target.closest('.emoji-picker-emoji');
    if (emojiBtn) {
        const emoji = emojiBtn.dataset.emoji;
        const recordId = emojiBtn.dataset.recordId;
        selectEmoji(recordId, emoji);
        closeExpandedEmojiPicker();
    }
}

// Select an emoji reaction for an item
export function selectEmoji(recordId, emoji) {
    const currentUser = getCurrentUser();
    console.log(`[REACTIONS-DEBUG] selectEmoji called: recordId="${recordId}", emoji="${emoji}", userId="${currentUser.id}"`);

    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    // Multi-emoji model: each user has a Set of emojis
    let userEmojiSet = itemReactions.get(currentUser.id);
    if (!(userEmojiSet instanceof Set)) {
        userEmojiSet = userEmojiSet ? new Set([userEmojiSet]) : new Set();
    }

    // Toggle: if emoji already in set, remove it; otherwise add it
    if (userEmojiSet.has(emoji)) {
        userEmojiSet.delete(emoji);
    } else {
        userEmojiSet.add(emoji);
    }

    // Clean up empty sets, otherwise store the updated set
    if (userEmojiSet.size === 0) {
        itemReactions.delete(currentUser.id);
    } else {
        itemReactions.set(currentUser.id, userEmojiSet);
    }
    console.log(`[REACTIONS-DEBUG] selectEmoji result: key="${recordId}", userEmojis=[${Array.from(userEmojiSet)}], totalUsers=${itemReactions.size}`);

    // Re-render reactions for this item
    const reactionContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
    if (reactionContainer) {
        _renderReactions(recordId, reactionContainer);
    }

    // Update the emoji indicator next to item name
    _updateItemEmojiIndicator(recordId);

    // Update the reactions summary
    reactionRankings.renderReactionsSummary();

    // Update the reaction zone summary on compact cards
    _updateReactionZoneSummary(recordId);

    // Update the event-level emoji indicator
    _updateEventEmojiIndicator();

    // Broadcast item reaction update via Pusher for real-time sync
    const presentationChatChannel = _getPresentationChatChannel();
    if (presentationChatChannel) {
        // Convert Map<userId, Set<emoji>> to object for Pusher transmission
        const reactionsObj = {};
        itemReactions.forEach((emojiData, odUserId) => {
            if (emojiData instanceof Set) {
                reactionsObj[odUserId] = Array.from(emojiData);
            } else {
                reactionsObj[odUserId] = emojiData;
            }
        });
        console.log(`[REACTIONS-DEBUG] Pusher broadcast: recordId="${recordId}", payload=`, JSON.stringify(reactionsObj));
        presentationChatChannel.trigger('client-item-reaction-update', {
            recordId,
            reactions: reactionsObj,
            userId: currentUser.id
        });
    }

    triggerSave();
}
