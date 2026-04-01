/**
 * Reactions
 * Core reaction logic: scoring, rendering, emoji indicators, event-level
 * sentiment, reaction click handling, and Pusher broadcast.
 * Extracted from presentation.js — Phase 5 modularization.
 */

import { state, getRecordById, getAggregateReactions } from '../../state.js';
import { EMOJI_REACTIONS, REACTION_SCORES, computeDemocraticAverage } from '../../config.js';
import { getCurrentUser } from '../../chat.js';
import { triggerSave } from '../../events.js';
import { getComponentMessageReactions } from '../forumPanel.js';

// Dependencies injected via init()
let _deps = null;

/**
 * Initialize the reactions module.
 * @param {Object} deps
 * @param {Object} deps.reactionRankings - reactionRankings module reference
 * @param {Function} deps.getChannel - () => Pusher channel (from presentationChat)
 * @param {Function} deps.updateReactionZoneSummary - (recordId) => void (from reactionSummaryBar)
 * @param {Function} deps.showExpandedEmojiPicker - (recordId, anchorEl) => void (from emojiPicker)
 */
export function init(deps) {
    _deps = deps;

    // Register global helper for external callers (modal.js, actionMenu.js)
    if (typeof window !== 'undefined') {
        window.broadcastReactionUpdate = broadcastReactionUpdate;
    }
}

export function cleanup() {
    // Note: Do NOT wipe _deps here. The presentation view may be hidden and
    // re-shown without re-calling init() (syncUiWithUrl closes all overlays
    // before re-opening). Wiping _deps causes failures on re-show.
}

/**
 * Broadcast a reaction update to other clients via Pusher.
 * @param {string} recordId
 * @param {Map} itemReactions - Map<userId, Set<emoji>>
 * @param {string} userId
 */
export function broadcastReactionUpdate(recordId, itemReactions, userId) {
    const channel = _deps ? _deps.getChannel() : null;
    if (!channel) {
        console.log('[REACTIONS-DEBUG] broadcastReactionUpdate: no Pusher channel available');
        return;
    }
    const reactionsObj = {};
    itemReactions.forEach((emojiData, odUserId) => {
        if (emojiData instanceof Set) {
            reactionsObj[odUserId] = Array.from(emojiData);
        } else {
            reactionsObj[odUserId] = emojiData;
        }
    });
    channel.trigger('client-item-reaction-update', {
        recordId,
        reactions: reactionsObj,
        userId
    });
}

/**
 * Calculate score for a single reaction emoji.
 * @param {string} emoji
 * @returns {number}
 */
export function getReactionScore(emoji) {
    return REACTION_SCORES[emoji] || 0;
}

/**
 * Calculate total reaction score for an item.
 * @param {string} recordId
 * @returns {number}
 */
export function getItemReactionScore(recordId) {
    const reactions = state.session.reactions.get(recordId);
    if (!reactions || !(reactions instanceof Map)) return 0;

    let score = 0;
    reactions.forEach((emojiData) => {
        const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
        for (const emoji of emojis) {
            score += getReactionScore(emoji);
        }
    });
    return score;
}

/**
 * Get reaction count for an item (hierarchical: includes variations + comments).
 * @param {string} recordId
 * @returns {number}
 */
export function getItemReactionCount(recordId) {
    const aggregateReactions = getAggregateReactions(recordId);
    if (!aggregateReactions || aggregateReactions.size === 0) return 0;
    let count = 0;
    aggregateReactions.forEach((emojiData) => {
        const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
        count += emojis.size;
    });
    // Also count comment reactions
    try {
        const commentReactions = getComponentMessageReactions(recordId);
        if (commentReactions && commentReactions.size > 0) {
            commentReactions.forEach((emojiData) => {
                const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
                count += emojis.size;
            });
        }
    } catch (e) { /* comment reactions may not be available during early init */ }
    return count;
}

/**
 * Get a hierarchical summary emoji for an item, incorporating:
 * 1. Direct reactions on the item
 * 2. Reactions on variations/options (via compound keys like recordId::*)
 * 3. Reactions from comment threads linked to this item (via componentId)
 * Returns the emoji whose score is closest to the combined democratic average.
 * @param {string} recordId
 * @returns {string}
 */
export function getItemSummaryEmoji(recordId) {
    const aggregateReactions = getAggregateReactions(recordId);

    let commentReactionsMerged = false;
    try {
        const commentReactions = getComponentMessageReactions(recordId);
        if (commentReactions && commentReactions.size > 0) {
            for (const [userId, emojiSet] of commentReactions) {
                if (!aggregateReactions.has(userId)) aggregateReactions.set(userId, new Set());
                const userSet = aggregateReactions.get(userId);
                for (const emoji of emojiSet) userSet.add(emoji);
            }
            commentReactionsMerged = true;
        }
    } catch (e) {
        // Comment reactions may not be available during early initialization
    }

    if (!aggregateReactions || aggregateReactions.size === 0) {
        return '';
    }

    const { summaryEmoji, democraticAverage, userCount, totalReactions } = computeDemocraticAverage(aggregateReactions);
    return summaryEmoji || '💬';
}

/**
 * Update the emoji indicator next to an item's name.
 * @param {string} recordId
 */
export function updateItemEmojiIndicator(recordId) {
    const emojiIndicator = document.querySelector(`.item-emoji-indicator[data-record-id="${recordId}"]`);
    if (!emojiIndicator) return;

    const summaryEmoji = getItemSummaryEmoji(recordId);
    const reactionCount = getItemReactionCount(recordId);

    if (summaryEmoji && reactionCount > 0) {
        emojiIndicator.innerHTML = `<span class="emoji-indicator-emoji">${summaryEmoji}</span>${reactionCount > 1 ? `<span class="emoji-indicator-count">${reactionCount}</span>` : ''}`;
        emojiIndicator.style.display = 'inline-flex';
        emojiIndicator.classList.add('has-reactions');
        emojiIndicator.classList.remove('no-reactions');
        const tooltip = _deps && _deps.reactionRankings ? _deps.reactionRankings.getItemRankingTooltip(recordId) : null;
        if (tooltip) {
            emojiIndicator.title = tooltip;
        }
    } else {
        emojiIndicator.innerHTML = '<span class="emoji-indicator-emoji">\u{1F60A}</span><span class="emoji-indicator-prompt">React</span>';
        emojiIndicator.style.display = 'inline-flex';
        emojiIndicator.classList.remove('has-reactions');
        emojiIndicator.classList.add('no-reactions');
        emojiIndicator.title = 'Tap to react';
    }
}

/**
 * Calculate the plan-level emoji by averaging all item hierarchical summary scores.
 * @returns {{emoji: string, count: number, totalReactions: number, averageScore: number}}
 */
export function getEventSummaryEmoji() {
    const favorites = Array.from(state.cart.items.keys());
    const locked = Array.from(state.cart.lockedItems.keys());
    const allItemIds = [...new Set([...locked, ...favorites])];

    const componentAverages = [];
    let totalReactionCount = 0;

    allItemIds.forEach(recordId => {
        const aggregateReactions = getAggregateReactions(recordId);

        try {
            const commentReactions = getComponentMessageReactions(recordId);
            if (commentReactions && commentReactions.size > 0) {
                for (const [userId, emojiSet] of commentReactions) {
                    if (!aggregateReactions.has(userId)) aggregateReactions.set(userId, new Set());
                    const userSet = aggregateReactions.get(userId);
                    for (const emoji of emojiSet) userSet.add(emoji);
                }
            }
        } catch (e) { /* comment reactions may not be available */ }

        if (!aggregateReactions || aggregateReactions.size === 0) return;

        const { democraticAverage, totalReactions } = computeDemocraticAverage(aggregateReactions);

        if (totalReactions > 0) {
            componentAverages.push(democraticAverage);
            totalReactionCount += totalReactions;
        }
    });

    if (componentAverages.length === 0) {
        return { emoji: '', count: 0, totalReactions: 0, averageScore: 0 };
    }

    const eventAverageScore = componentAverages.reduce((sum, avg) => sum + avg, 0) / componentAverages.length;

    let closestEmoji = '';
    let closestDifference = Infinity;

    Object.entries(REACTION_SCORES).forEach(([emoji, score]) => {
        const difference = Math.abs(score - eventAverageScore);
        if (difference < closestDifference) {
            closestDifference = difference;
            closestEmoji = emoji;
        }
    });

    return {
        emoji: closestEmoji || '💬',
        count: componentAverages.length,
        totalReactions: totalReactionCount,
        averageScore: eventAverageScore
    };
}

/**
 * Update the event-level emoji indicator in the presentation header.
 */
export function updateEventEmojiIndicator() {
    const eventEmojiEl = document.getElementById('event-emoji-indicator');
    if (!eventEmojiEl) return;

    const { emoji, count, totalReactions, averageScore } = getEventSummaryEmoji();

    if (emoji && count > 0) {
        const countDisplay = count > 1 ? `<span class="event-emoji-count">${count}</span>` : '';
        eventEmojiEl.innerHTML = `<span class="event-emoji-icon">${emoji}</span>${countDisplay}`;
        eventEmojiEl.classList.add('visible');
        eventEmojiEl.title = `Event sentiment: ${emoji} (${totalReactions} reaction${totalReactions !== 1 ? 's' : ''} across ${count} component${count !== 1 ? 's' : ''})`;
    } else {
        eventEmojiEl.innerHTML = '';
        eventEmojiEl.classList.remove('visible');
        eventEmojiEl.title = '';
    }
}

/**
 * Render reaction buttons for an item.
 * @param {string} recordId
 * @param {HTMLElement} reactionContainer
 */
export function renderReactions(recordId, reactionContainer) {
    const currentUser = getCurrentUser();
    let allReactions = state.session.reactions.get(recordId);
    if (!(allReactions instanceof Map)) {
        allReactions = new Map();
    }
    const currentUserEmojiSet = allReactions.get(currentUser.id);

    const buttonsHTML = EMOJI_REACTIONS.map(emoji => {
        const isSelected = currentUserEmojiSet instanceof Set
            ? currentUserEmojiSet.has(emoji)
            : currentUserEmojiSet === emoji;
        return `<button class="reaction-btn ${isSelected ? 'selected' : ''}" data-emoji="${emoji}" data-record-id="${recordId}">${emoji}</button>`;
    }).join('');

    const moreButtonHTML = `<button class="reaction-btn reaction-more-btn" data-record-id="${recordId}" title="More reactions">+</button>`;

    let summaryHTML = '';
    if (allReactions.size > 0) {
        summaryHTML = Array.from(allReactions.entries()).map(([userId, emojiData]) => {
            const name = state.session.userProfiles.get(userId) || 'A User';
            const emojiStr = emojiData instanceof Set ? Array.from(emojiData).join('') : emojiData;
            return `<span class="reaction-user">${name}: ${emojiStr}</span>`;
        }).join('');
    }

    reactionContainer.innerHTML = `
        <div class="reaction-bar-buttons">${buttonsHTML}${moreButtonHTML}</div>
        <div class="reaction-info-row">
            <div class="reaction-summary-display">${summaryHTML || 'Tap an emoji to share your reaction'}</div>
        </div>
    `;
}

/**
 * Handle click on a reaction button (delegated event handler).
 * @param {Event} e
 */
export function handleReactionClick(e) {
    const button = e.target.closest('.reaction-btn');
    if (!button) return;

    e.stopPropagation();
    e.preventDefault();

    const recordId = button.dataset.recordId;

    // Check if this is the "more" button to open expanded picker
    if (button.classList.contains('reaction-more-btn')) {
        if (_deps && _deps.showExpandedEmojiPicker) {
            _deps.showExpandedEmojiPicker(recordId, button);
        }
        return;
    }

    const emoji = button.dataset.emoji;
    const currentUser = getCurrentUser();

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

    // Re-render reactions for this item
    const reactionContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
    if (reactionContainer) {
        renderReactions(recordId, reactionContainer);
    }

    // Update the emoji indicator next to item name
    updateItemEmojiIndicator(recordId);

    // Update the reactions summary
    if (_deps && _deps.reactionRankings) {
        _deps.reactionRankings.renderReactionsSummary();
    }

    // Update the reaction zone summary on compact cards
    if (_deps && _deps.updateReactionZoneSummary) {
        _deps.updateReactionZoneSummary(recordId);
    }

    // Update the event-level emoji indicator
    updateEventEmojiIndicator();

    // Broadcast item reaction update via Pusher for real-time sync
    broadcastReactionUpdate(recordId, itemReactions, currentUser.id);

    triggerSave();
}
