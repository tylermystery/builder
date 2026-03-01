/**
 * Reaction Rankings
 * Calculates reaction rankings for plan items and updates emoji tooltip indicators.
 * Extracted from presentation.js — Phase 1 modularization.
 */

// Dependencies injected via init()
let _getState = null;
let _getItemReactionCount = null;
let _getItemReactionScore = null;

// Cached DOM element
let reactionsSummaryEl = null;

/**
 * Initialize the reaction rankings module.
 * @param {Object} deps
 * @param {Function} deps.getState - Returns the app state object
 * @param {Function} deps.getItemReactionCount - Function to get reaction count for an item
 * @param {Function} deps.getItemReactionScore - Function to get reaction score for an item
 */
export function init({ getState, getItemReactionCount, getItemReactionScore }) {
    _getState = getState;
    _getItemReactionCount = getItemReactionCount;
    _getItemReactionScore = getItemReactionScore;
}

/**
 * Calculate reaction rankings for all items in the plan.
 * @returns {Array<{recordId: string, rank: number, score: number, reactionCount: number, emojiBreakdown: Object, totalItems: number}>}
 */
export function calculateReactionRankings() {
    const state = _getState();
    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    const combinedList = [...locked, ...favorites];

    const itemsWithScores = combinedList.map(item => {
        const reactions = state.session.reactions.get(item.recordId);
        const reactionCount = _getItemReactionCount(item.recordId);
        const score = _getItemReactionScore(item.recordId);

        const emojiBreakdown = {};
        if (reactions instanceof Map) {
            reactions.forEach((emojiData) => {
                const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
                for (const emoji of emojis) {
                    emojiBreakdown[emoji] = (emojiBreakdown[emoji] || 0) + 1;
                }
            });
        }

        return {
            recordId: item.recordId,
            score,
            reactionCount,
            emojiBreakdown
        };
    });

    const rankedItems = [...itemsWithScores].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.reactionCount - a.reactionCount;
    });

    const itemsWithReactions = rankedItems.filter(item => item.reactionCount > 0);
    const totalItemsWithReactions = itemsWithReactions.length;

    return itemsWithReactions.map((item, index) => ({
        ...item,
        rank: index + 1,
        totalItems: totalItemsWithReactions
    }));
}

/**
 * Get ranking tooltip text for an item's emoji indicator.
 * @param {string} recordId
 * @returns {string} Tooltip text
 */
export function getItemRankingTooltip(recordId) {
    const rankings = calculateReactionRankings();
    const itemRanking = rankings.find(item => item.recordId === recordId);

    if (!itemRanking) {
        return '';
    }

    return formatRankingTooltip(itemRanking);
}

/**
 * Format a ranking object into a tooltip string.
 * @param {Object} itemRanking
 * @returns {string}
 */
export function formatRankingTooltip(itemRanking) {
    const emojiBreakdownStr = Object.entries(itemRanking.emojiBreakdown)
        .map(([emoji, count]) => `${emoji}${count > 1 ? '\u00d7' + count : ''}`)
        .join(' ');
    let medal = '';
    if (itemRanking.rank === 1) medal = '\ud83e\udd47 ';
    else if (itemRanking.rank === 2) medal = '\ud83e\udd48 ';
    else if (itemRanking.rank === 3) medal = '\ud83e\udd49 ';
    const scoreStr = itemRanking.score > 0 ? `+${itemRanking.score}` : itemRanking.score.toString();
    return `${medal}Rank #${itemRanking.rank} of ${itemRanking.totalItems} | Score: ${scoreStr} | ${emojiBreakdownStr}`;
}

/**
 * Render the reactions summary section (currently hidden — ranking info is in tooltips).
 */
export function renderReactionsSummary() {
    if (!reactionsSummaryEl) {
        reactionsSummaryEl = document.getElementById('reactions-summary-container');
    }
    if (!reactionsSummaryEl) return;

    reactionsSummaryEl.innerHTML = '';
    reactionsSummaryEl.style.display = 'none';

    updateAllItemEmojiTooltips();
}

/**
 * Update all item emoji indicator tooltips with current ranking info.
 */
export function updateAllItemEmojiTooltips() {
    const rankings = calculateReactionRankings();
    const rankingsMap = new Map(rankings.map(r => [r.recordId, r]));

    const emojiIndicators = document.querySelectorAll('.item-emoji-indicator[data-record-id]');
    emojiIndicators.forEach(indicator => {
        const recordId = indicator.dataset.recordId;
        const itemRanking = rankingsMap.get(recordId);
        if (itemRanking) {
            indicator.title = formatRankingTooltip(itemRanking);
        } else {
            indicator.removeAttribute('title');
        }
    });
}

export function cleanup() {
    reactionsSummaryEl = null;
}
