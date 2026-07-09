/**
 * Sentiment Popup
 * Event-level sentiment analysis modal showing item reactions, rankings, and value metrics.
 * Extracted from presentation.js — Phase 2 modularization.
 */

import { state, getRecordById } from '../../state.js';
import { getModalZIndex } from '../../config.js';
import { log } from '../../utils/debug.js';
import { getRecordPrice } from '../../utils.js';

// Dependencies injected via init()
let _getItemReactionScore = null;
let _getItemReactionCount = null;
let _getItemSummaryEmoji = null;

/**
 * Initialize the sentiment popup module.
 * @param {Object} deps
 * @param {Function} deps.getItemReactionScore - Returns total reaction score for a record
 * @param {Function} deps.getItemReactionCount - Returns total reaction count for a record
 * @param {Function} deps.getItemSummaryEmoji - Returns summary emoji for a record
 */
export function init(deps) {
    _getItemReactionScore = deps.getItemReactionScore;
    _getItemReactionCount = deps.getItemReactionCount;
    _getItemSummaryEmoji = deps.getItemSummaryEmoji;
}

/**
 * Cleanup module state.
 */
export function cleanup() {
    closeSentimentPopup();
}

/**
 * Initialize click handler for the event emoji indicator to open sentiment popup
 */
export function initializeEventEmojiClickHandler() {
    const eventEmojiEl = document.getElementById('event-emoji-indicator');
    if (eventEmojiEl) {
        eventEmojiEl.style.cursor = 'pointer';
        eventEmojiEl.addEventListener('click', (e) => {
            e.stopPropagation();
            showSentimentPopup();
        });
        log('Presentation', 'Event emoji indicator click handler initialized');
    }
}

/**
 * Generate HTML for the sentiment analysis popup with a sentiment graph
 * showing where each item lies on the sentiment scale
 */
function createSentimentPopupHTML() {
    console.log('[SentimentPopup DEBUG] createSentimentPopupHTML called');

    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    const combinedList = [...locked, ...favorites];

    console.log('[SentimentPopup DEBUG] combinedList length:', combinedList.length);
    console.log('[SentimentPopup DEBUG] state.session.reactions:', state.session.reactions);

    // Calculate scores for all items
    const itemsWithScores = combinedList.map(item => {
        const record = getRecordById(item.recordId);
        const name = record?.fields.Name || 'Unknown Item';
        const reactions = state.session.reactions.get(item.recordId);
        const totalScore = _getItemReactionScore(item.recordId);
        const reactionCount = _getItemReactionCount(item.recordId);

        // Calculate average score per reaction for positioning on scale
        const avgScore = reactionCount > 0 ? totalScore / reactionCount : 0;

        // Get emoji breakdown (across all users' Sets)
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
            type: item.type,
            name,
            totalScore,
            avgScore,
            reactionCount,
            emojiBreakdown,
            summaryEmoji: _getItemSummaryEmoji(item.recordId)
        };
    });

    // Filter to only items with reactions for the graph
    const itemsWithReactions = itemsWithScores.filter(item => item.reactionCount > 0);

    // Calculate totals
    const totalReactions = itemsWithScores.reduce((sum, item) => sum + item.reactionCount, 0);
    const totalScore = itemsWithScores.reduce((sum, item) => sum + item.totalScore, 0);

    // Determine overall sentiment
    let overallSentiment = 'neutral';
    let sentimentEmoji = '😐';
    let sentimentText = 'Mixed reactions';
    let sentimentDescription = 'The group has varied opinions about the plan items.';

    if (totalScore > 8) {
        overallSentiment = 'very-positive';
        sentimentEmoji = '🎉';
        sentimentText = 'Very Enthusiastic!';
        sentimentDescription = 'Everyone is excited about this plan! High positive sentiment across items.';
    } else if (totalScore > 3) {
        overallSentiment = 'positive';
        sentimentEmoji = '😊';
        sentimentText = 'Generally Positive';
        sentimentDescription = 'The group is happy with most of the plan items.';
    } else if (totalScore < -8) {
        overallSentiment = 'very-negative';
        sentimentEmoji = '😟';
        sentimentText = 'Needs Attention';
        sentimentDescription = 'Multiple items have concerns. Consider reviewing the plan together.';
    } else if (totalScore < -3) {
        overallSentiment = 'negative';
        sentimentEmoji = '😕';
        sentimentText = 'Some Concerns';
        sentimentDescription = 'A few items might need discussion or alternatives.';
    }

    // Count sentiment categories
    const positiveItems = itemsWithReactions.filter(item => item.avgScore > 0.5).length;
    const negativeItems = itemsWithReactions.filter(item => item.avgScore < -0.5).length;
    const neutralItems = itemsWithReactions.filter(item => item.avgScore >= -0.5 && item.avgScore <= 0.5).length;

    // Generate graph items HTML - position items on a -5 to +5 scale
    // The scale represents average sentiment per reaction
    const minScore = -5;
    const maxScore = 5;
    const scaleRange = maxScore - minScore;

    let graphItemsHTML = '';
    if (itemsWithReactions.length > 0) {
        // Sort by average score for consistent layering
        const sortedItems = [...itemsWithReactions].sort((a, b) => a.avgScore - b.avgScore);

        graphItemsHTML = sortedItems.map((item, index) => {
            // Clamp avgScore to scale range
            const clampedScore = Math.max(minScore, Math.min(maxScore, item.avgScore));
            // Calculate position as percentage (0% = -5, 100% = +5)
            const position = ((clampedScore - minScore) / scaleRange) * 100;

            // Determine sentiment class
            let sentimentClass = 'neutral';
            if (item.avgScore > 0.5) sentimentClass = 'positive';
            else if (item.avgScore < -0.5) sentimentClass = 'negative';

            // Truncate name for display
            const displayName = item.name.length > 20 ? item.name.substring(0, 18) + '...' : item.name;

            // Create emoji pills for breakdown tooltip
            const emojiPills = Object.entries(item.emojiBreakdown)
                .map(([emoji, count]) => `${emoji}${count > 1 ? '×' + count : ''}`)
                .join(' ');

            return `
                <div class="sentiment-graph-item ${sentimentClass}"
                     style="left: ${position}%;"
                     data-record-id="${item.recordId}"
                     title="${item.name}\nAvg Score: ${item.avgScore.toFixed(2)}\nReactions: ${emojiPills}">
                    <span class="graph-item-emoji">${item.summaryEmoji || '💬'}</span>
                    <span class="graph-item-name">${displayName}</span>
                </div>
            `;
        }).join('');
    }

    // Generate ranking list for detailed breakdown
    let rankingHTML = '';
    if (itemsWithReactions.length > 0) {
        const rankedItems = [...itemsWithReactions].sort((a, b) => b.totalScore - a.totalScore);

        rankingHTML = rankedItems.map((item, index) => {
            const rank = index + 1;
            let medalHTML = '';
            if (rank === 1) medalHTML = '<span class="rank-medal">🥇</span>';
            else if (rank === 2) medalHTML = '<span class="rank-medal">🥈</span>';
            else if (rank === 3) medalHTML = '<span class="rank-medal">🥉</span>';

            const emojiPills = Object.entries(item.emojiBreakdown)
                .map(([emoji, count]) => `<span class="emoji-pill">${emoji}${count > 1 ? `<sup>${count}</sup>` : ''}</span>`)
                .join('');

            let sentimentClass = 'neutral';
            if (item.avgScore > 0.5) sentimentClass = 'positive';
            else if (item.avgScore < -0.5) sentimentClass = 'negative';

            return `
                <div class="sentiment-ranking-item ${sentimentClass}" data-record-id="${item.recordId}">
                    <div class="ranking-position">
                        ${medalHTML}
                        <span class="ranking-number">#${rank}</span>
                    </div>
                    <div class="ranking-info">
                        <div class="ranking-name">${item.name}</div>
                        <div class="ranking-reactions">${emojiPills}</div>
                    </div>
                    <div class="ranking-score">
                        <span class="score-value ${item.totalScore >= 0 ? 'positive' : 'negative'}">
                            ${item.totalScore >= 0 ? '+' : ''}${item.totalScore.toFixed(1)}
                        </span>
                        <span class="score-label">score</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    // --- Value vs. Vitality: "Bang for the Goodness" ranking ---
    let valueVitalityHTML = '';
    {
        // Build ranking of items by Goodness per Dollar (vitality net / price)
        const vitalityItems = combinedList.map(item => {
            const record = getRecordById(item.recordId);
            if (!record) return null;
            const name = record.fields.Name || 'Unknown Item';
            const cartInfo = state.cart.lockedItems.get(item.recordId) || state.cart.items.get(item.recordId);
            const priceParam = (cartInfo?.selections && Object.keys(cartInfo.selections).length > 0)
                ? cartInfo.selections
                : cartInfo?.selectedOptionIndex;
            const price = cartInfo ? (cartInfo.overridePrice ?? getRecordPrice(record, priceParam)) : getRecordPrice(record);
            const vitalityScores = state.vitality?.itemScores?.get(item.recordId);
            const goodnessScore = vitalityScores?.goodnessScore ?? vitalityScores?.net ?? 0;
            const goodnessEmoji = vitalityScores?.goodnessEmoji || vitalityScores?.netEmoji || '⚖️';

            // Calculate Goodness per Dollar ratio
            // Free items with positive goodness get a special high ranking
            let goodnessPerDollar = 0;
            if (!isNaN(price) && price > 0 && goodnessScore !== 0) {
                goodnessPerDollar = goodnessScore / price;
            } else if ((!price || price === 0) && goodnessScore > 0) {
                goodnessPerDollar = Infinity; // Free + good = best value
            }

            return {
                recordId: item.recordId,
                name,
                price: !isNaN(price) ? price : 0,
                netVitality: goodnessScore,
                netEmoji: goodnessEmoji,
                goodnessPerDollar
            };
        }).filter(item => item && (item.netVitality !== 0 || item.price > 0));

        if (vitalityItems.length > 0) {
            // Sort by Goodness per Dollar descending (best value first)
            const sorted = [...vitalityItems].sort((a, b) => {
                if (a.goodnessPerDollar === Infinity && b.goodnessPerDollar === Infinity) return b.netVitality - a.netVitality;
                if (a.goodnessPerDollar === Infinity) return -1;
                if (b.goodnessPerDollar === Infinity) return 1;
                return b.goodnessPerDollar - a.goodnessPerDollar;
            });

            valueVitalityHTML = sorted.map((item, index) => {
                const rank = index + 1;
                let medalHTML = '';
                if (rank === 1) medalHTML = '<span class="rank-medal">🏆</span>';
                else if (rank === 2) medalHTML = '<span class="rank-medal">🥈</span>';
                else if (rank === 3) medalHTML = '<span class="rank-medal">🥉</span>';

                const priceText = item.price === 0 ? 'Free' : `$${item.price % 1 === 0 ? item.price.toFixed(0) : item.price.toFixed(2)}`;
                const ratioText = item.goodnessPerDollar === Infinity
                    ? 'Free + Good'
                    : item.goodnessPerDollar > 0
                        ? `${(item.goodnessPerDollar * 100).toFixed(1)}¢/pt`
                        : item.netVitality < 0 ? 'Drain' : '--';

                const valueClass = item.netVitality > 0 ? 'positive' : item.netVitality < 0 ? 'negative' : 'neutral';

                return `
                    <div class="sentiment-ranking-item value-vitality-item ${valueClass}" data-record-id="${item.recordId}">
                        <div class="ranking-position">
                            ${medalHTML}
                            <span class="ranking-number">#${rank}</span>
                        </div>
                        <div class="ranking-info">
                            <div class="ranking-name">${item.name}</div>
                            <div class="ranking-reactions"><span class="vv-price">${priceText}</span> <span class="vv-emoji">${item.netEmoji}</span></div>
                        </div>
                        <div class="ranking-score">
                            <span class="score-value ${valueClass}">${ratioText}</span>
                            <span class="score-label">value</span>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // Empty state
    if (totalReactions === 0) {
        return `
            <div class="sentiment-popup-modal">
                <div class="sentiment-popup-header">
                    <h2 class="sentiment-popup-title">Sentiment Analysis</h2>
                    <button class="sentiment-popup-close" aria-label="Close sentiment details">&times;</button>
                </div>
                <div class="sentiment-popup-empty">
                    <span class="empty-icon">✨</span>
                    <h3>No Reactions Yet</h3>
                    <p>React to plan items using emojis to see sentiment analysis.</p>
                    <p class="empty-hint">Each collaborator's reaction contributes to the overall sentiment score.</p>
                </div>
            </div>
        `;
    }

    return `
        <div class="sentiment-popup-modal">
            <div class="sentiment-popup-header">
                <h2 class="sentiment-popup-title">Sentiment Analysis</h2>
                <button class="sentiment-popup-close" aria-label="Close sentiment details">&times;</button>
            </div>

            <div class="sentiment-popup-content">
                <!-- Overall Sentiment Banner -->
                <div class="sentiment-overall-banner ${overallSentiment}">
                    <span class="banner-emoji">${sentimentEmoji}</span>
                    <div class="banner-text">
                        <span class="banner-title">${sentimentText}</span>
                        <span class="banner-description">${sentimentDescription}</span>
                    </div>
                </div>

                <!-- Stats Row -->
                <div class="sentiment-stats-row">
                    <div class="sentiment-stat-card">
                        <span class="stat-value">${totalReactions}</span>
                        <span class="stat-label">Total Reactions</span>
                    </div>
                    <div class="sentiment-stat-card">
                        <span class="stat-value">${itemsWithReactions.length}</span>
                        <span class="stat-label">Items Rated</span>
                    </div>
                    <div class="sentiment-stat-card ${totalScore >= 0 ? 'positive' : 'negative'}">
                        <span class="stat-value">${totalScore >= 0 ? '+' : ''}${totalScore.toFixed(1)}</span>
                        <span class="stat-label">Net Score</span>
                    </div>
                </div>

                <!-- Sentiment Distribution -->
                <div class="sentiment-distribution">
                    <h3 class="section-title">Sentiment Distribution</h3>
                    <div class="distribution-bars">
                        <div class="distribution-item positive">
                            <span class="dist-icon">👍</span>
                            <div class="dist-bar-container">
                                <div class="dist-bar" style="width: ${itemsWithReactions.length > 0 ? (positiveItems / itemsWithReactions.length * 100) : 0}%"></div>
                            </div>
                            <span class="dist-count">${positiveItems}</span>
                        </div>
                        <div class="distribution-item neutral">
                            <span class="dist-icon">🤷</span>
                            <div class="dist-bar-container">
                                <div class="dist-bar" style="width: ${itemsWithReactions.length > 0 ? (neutralItems / itemsWithReactions.length * 100) : 0}%"></div>
                            </div>
                            <span class="dist-count">${neutralItems}</span>
                        </div>
                        <div class="distribution-item negative">
                            <span class="dist-icon">👎</span>
                            <div class="dist-bar-container">
                                <div class="dist-bar" style="width: ${itemsWithReactions.length > 0 ? (negativeItems / itemsWithReactions.length * 100) : 0}%"></div>
                            </div>
                            <span class="dist-count">${negativeItems}</span>
                        </div>
                    </div>
                </div>

                <!-- Sentiment Graph -->
                <div class="sentiment-graph-section">
                    <h3 class="section-title">Item Sentiment Map</h3>
                    <p class="section-hint">Items positioned by their average sentiment score</p>
                    <div class="sentiment-graph">
                        <div class="graph-scale">
                            <div class="scale-zone negative">
                                <span class="zone-label">😟 Negative</span>
                            </div>
                            <div class="scale-zone neutral">
                                <span class="zone-label">😐 Neutral</span>
                            </div>
                            <div class="scale-zone positive">
                                <span class="zone-label">😊 Positive</span>
                            </div>
                        </div>
                        <div class="graph-track">
                            <div class="track-markers">
                                <span class="marker" style="left: 0%">-5</span>
                                <span class="marker" style="left: 25%">-2.5</span>
                                <span class="marker" style="left: 50%">0</span>
                                <span class="marker" style="left: 75%">+2.5</span>
                                <span class="marker" style="left: 100%">+5</span>
                            </div>
                            <div class="graph-items">
                                ${graphItemsHTML}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Ranking List -->
                <div class="sentiment-ranking-section">
                    <h3 class="section-title">Item Rankings</h3>
                    <div class="sentiment-ranking-list">
                        ${rankingHTML}
                    </div>
                </div>

                <!-- Value vs. Vitality: Bang for the Goodness -->
                ${valueVitalityHTML ? `
                <div class="sentiment-ranking-section value-vitality-section">
                    <h3 class="section-title">Value vs. Vitality</h3>
                    <p class="section-hint">Items ranked by "Goodness per Dollar" — high-impact, low-cost virtuous choices</p>
                    <div class="sentiment-ranking-list value-vitality-list">
                        ${valueVitalityHTML}
                    </div>
                </div>
                ` : ''}

                <!-- Analysis Info -->
                <div class="sentiment-info">
                    <div class="info-icon">ℹ️</div>
                    <div class="info-text">
                        <strong>How scores are calculated:</strong> Each emoji has a sentiment value from -5 (very negative) to +5 (very positive).
                        An item's score is the sum of all reaction values. Click any item to scroll to it in the plan.
                    </div>
                </div>
            </div>
        </div>
    `;
}

/**
 * Show the sentiment analysis popup
 */
export function showSentimentPopup() {
    // Close any existing popup
    closeSentimentPopup();

    console.log('[SentimentPopup DEBUG] Starting showSentimentPopup');

    const popupHTML = createSentimentPopupHTML();
    const pickerZIndex = getModalZIndex('picker');

    console.log('[SentimentPopup DEBUG] popupHTML length:', popupHTML.length);
    console.log('[SentimentPopup DEBUG] z-index:', pickerZIndex);

    const popupContainer = document.createElement('div');
    popupContainer.className = 'sentiment-popup-overlay';
    popupContainer.innerHTML = popupHTML;

    // Apply inline styles for positioning
    popupContainer.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        z-index: ${pickerZIndex};
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 20px;
        box-sizing: border-box;
        overflow-y: auto;
    `;

    document.body.appendChild(popupContainer);

    // Apply inline styles to the modal element to ensure it displays correctly
    // This addresses potential CSS loading/specificity issues
    const modalElement = popupContainer.querySelector('.sentiment-popup-modal');
    if (modalElement) {
        console.log('[SentimentPopup DEBUG] Modal element found, applying inline styles');
        modalElement.style.cssText = `
            background: white;
            border-radius: 16px;
            max-width: 600px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            animation: sentimentPopupIn 0.3s ease-out;
            flex-shrink: 0;
        `;

        // Apply inline styles to header
        const headerElement = modalElement.querySelector('.sentiment-popup-header');
        if (headerElement) {
            headerElement.style.cssText = `
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 20px 24px;
                border-bottom: 1px solid #eee;
                position: sticky;
                top: 0;
                background: white;
                border-radius: 16px 16px 0 0;
                z-index: 1;
            `;
            console.log('[SentimentPopup DEBUG] Header styles applied');
        }

        // Apply inline styles to title
        const titleElement = modalElement.querySelector('.sentiment-popup-title');
        if (titleElement) {
            titleElement.style.cssText = `
                margin: 0;
                font-size: 1.4em;
                font-weight: 700;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            `;
        }

        // Apply inline styles to close button
        const closeBtn = modalElement.querySelector('.sentiment-popup-close');
        if (closeBtn) {
            closeBtn.style.cssText = `
                width: 32px;
                height: 32px;
                border: none;
                background: #f5f5f5;
                border-radius: 50%;
                font-size: 1.5em;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s ease;
                color: #666;
            `;
        }

        // Apply inline styles to content area
        const contentElement = modalElement.querySelector('.sentiment-popup-content');
        if (contentElement) {
            contentElement.style.cssText = `
                padding: 24px;
            `;
            console.log('[SentimentPopup DEBUG] Content styles applied');
        }

        // Apply inline styles to empty state if present
        const emptyElement = modalElement.querySelector('.sentiment-popup-empty');
        if (emptyElement) {
            emptyElement.style.cssText = `
                text-align: center;
                padding: 40px 20px;
            `;
            console.log('[SentimentPopup DEBUG] Empty state styles applied');
        }

        // Apply inline styles to key content sections
        const bannerElement = modalElement.querySelector('.sentiment-overall-banner');
        if (bannerElement) {
            bannerElement.style.cssText = `
                display: flex;
                align-items: center;
                gap: 16px;
                padding: 16px 20px;
                border-radius: 12px;
                margin-bottom: 20px;
                background: linear-gradient(135deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.05) 100%);
                border: 1px solid rgba(102, 126, 234, 0.2);
            `;
            const bannerEmoji = bannerElement.querySelector('.banner-emoji');
            if (bannerEmoji) bannerEmoji.style.fontSize = '2.5em';
            const bannerText = bannerElement.querySelector('.banner-text');
            if (bannerText) bannerText.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
            const bannerTitle = bannerElement.querySelector('.banner-title');
            if (bannerTitle) bannerTitle.style.cssText = 'font-size: 1.2em; font-weight: 700; color: #333;';
            const bannerDesc = bannerElement.querySelector('.banner-description');
            if (bannerDesc) bannerDesc.style.cssText = 'font-size: 0.9em; color: #666;';
            console.log('[SentimentPopup DEBUG] Banner styles applied');
        }

        // Stats row
        const statsRow = modalElement.querySelector('.sentiment-stats-row');
        if (statsRow) {
            statsRow.style.cssText = 'display: flex; gap: 12px; margin-bottom: 24px;';
            statsRow.querySelectorAll('.sentiment-stat-card').forEach(card => {
                card.style.cssText = 'flex: 1; background: #f8f9fa; border-radius: 10px; padding: 16px; text-align: center; border: 1px solid #eee;';
                const statValue = card.querySelector('.stat-value');
                if (statValue) statValue.style.cssText = 'display: block; font-size: 1.8em; font-weight: 700; color: #333;';
                const statLabel = card.querySelector('.stat-label');
                if (statLabel) statLabel.style.cssText = 'font-size: 0.75em; color: #666; text-transform: uppercase; letter-spacing: 0.5px;';
            });
            console.log('[SentimentPopup DEBUG] Stats row styles applied');
        }

        // Section titles
        modalElement.querySelectorAll('.section-title').forEach(title => {
            title.style.cssText = 'margin: 0 0 12px; font-size: 1em; font-weight: 600; color: #333;';
        });
        modalElement.querySelectorAll('.section-hint').forEach(hint => {
            hint.style.cssText = 'margin: -8px 0 12px; font-size: 0.8em; color: #999;';
        });

        // Distribution section
        const distSection = modalElement.querySelector('.sentiment-distribution');
        if (distSection) {
            distSection.style.cssText = 'margin-bottom: 24px; padding: 16px; background: #f8f9fa; border-radius: 12px;';
            const distBars = distSection.querySelector('.distribution-bars');
            if (distBars) distBars.style.cssText = 'display: flex; flex-direction: column; gap: 10px;';
            distSection.querySelectorAll('.distribution-item').forEach(item => {
                item.style.cssText = 'display: flex; align-items: center; gap: 12px;';
                const icon = item.querySelector('.dist-icon');
                if (icon) icon.style.cssText = 'font-size: 1.3em; width: 28px; text-align: center;';
                const barContainer = item.querySelector('.dist-bar-container');
                if (barContainer) barContainer.style.cssText = 'flex: 1; height: 24px; background: #e9ecef; border-radius: 12px; overflow: hidden;';
                const bar = item.querySelector('.dist-bar');
                if (bar) {
                    let bgColor = '#6c757d';
                    if (item.classList.contains('positive')) bgColor = 'linear-gradient(90deg, #28a745 0%, #5cb85c 100%)';
                    else if (item.classList.contains('negative')) bgColor = 'linear-gradient(90deg, #dc3545 0%, #ff6b6b 100%)';
                    bar.style.cssText = `height: 100%; border-radius: 12px; background: ${bgColor}; transition: width 0.5s ease;`;
                }
                const count = item.querySelector('.dist-count');
                if (count) count.style.cssText = 'min-width: 24px; font-weight: 600; color: #333;';
            });
            console.log('[SentimentPopup DEBUG] Distribution styles applied');
        }

        // Graph section
        const graphSection = modalElement.querySelector('.sentiment-graph-section');
        if (graphSection) {
            graphSection.style.cssText = 'margin-bottom: 24px;';
            const graph = graphSection.querySelector('.sentiment-graph');
            if (graph) {
                graph.style.cssText = 'background: #f8f9fa; border-radius: 12px; padding: 16px; overflow: hidden;';
                const graphScale = graph.querySelector('.graph-scale');
                if (graphScale) {
                    graphScale.style.cssText = 'display: flex; margin-bottom: 8px;';
                    graphScale.querySelectorAll('.scale-zone').forEach(zone => {
                        let bgColor = '#f8f9fa';
                        if (zone.classList.contains('negative')) bgColor = 'rgba(220, 53, 69, 0.1)';
                        else if (zone.classList.contains('neutral')) bgColor = 'rgba(108, 117, 125, 0.1)';
                        else if (zone.classList.contains('positive')) bgColor = 'rgba(40, 167, 69, 0.1)';
                        zone.style.cssText = `flex: 1; padding: 8px; text-align: center; font-size: 0.75em; background: ${bgColor}; border-radius: 6px; margin: 0 2px;`;
                    });
                }
                const graphTrack = graph.querySelector('.graph-track');
                if (graphTrack) {
                    graphTrack.style.cssText = 'position: relative; height: 80px; background: linear-gradient(90deg, rgba(220, 53, 69, 0.05) 0%, rgba(220, 53, 69, 0.05) 30%, rgba(108, 117, 125, 0.05) 30%, rgba(108, 117, 125, 0.05) 70%, rgba(40, 167, 69, 0.05) 70%, rgba(40, 167, 69, 0.05) 100%); border-radius: 8px; margin-top: 12px;';
                    const markers = graphTrack.querySelector('.track-markers');
                    if (markers) {
                        markers.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; height: 20px; display: flex; justify-content: space-between; padding: 0 4px;';
                        markers.querySelectorAll('.marker').forEach(m => m.style.cssText = 'font-size: 0.65em; color: #999;');
                    }
                    const graphItems = graphTrack.querySelector('.graph-items');
                    if (graphItems) {
                        graphItems.style.cssText = 'position: absolute; top: 24px; left: 0; right: 0; bottom: 8px;';
                        graphItems.querySelectorAll('.sentiment-graph-item').forEach(item => {
                            let borderColor = '#6c757d';
                            if (item.classList.contains('positive')) borderColor = '#28a745';
                            else if (item.classList.contains('negative')) borderColor = '#dc3545';
                            item.style.cssText += `; position: absolute; transform: translateX(-50%); background: white; border: 2px solid ${borderColor}; border-radius: 8px; padding: 4px 8px; font-size: 0.75em; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 8px rgba(0,0,0,0.1);`;
                        });
                    }
                }
            }
            console.log('[SentimentPopup DEBUG] Graph section styles applied');
        }

        // Ranking section
        const rankingSection = modalElement.querySelector('.sentiment-ranking-section');
        if (rankingSection) {
            rankingSection.style.cssText = 'margin-bottom: 24px;';
            const rankingList = rankingSection.querySelector('.sentiment-ranking-list');
            if (rankingList) {
                rankingList.style.cssText = 'max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;';
                rankingList.querySelectorAll('.sentiment-ranking-item').forEach(item => {
                    let borderColor = '#eee';
                    if (item.classList.contains('positive')) borderColor = '#28a745';
                    else if (item.classList.contains('negative')) borderColor = '#dc3545';
                    item.style.cssText = `display: flex; align-items: center; gap: 12px; padding: 12px; background: white; border-radius: 10px; border: 1px solid #eee; border-left: 3px solid ${borderColor}; cursor: pointer; transition: all 0.2s ease;`;
                });
            }
            console.log('[SentimentPopup DEBUG] Ranking section styles applied');
        }

        // Value vs. Vitality section
        const vvSection = modalElement.querySelector('.value-vitality-section');
        if (vvSection) {
            vvSection.style.cssText = 'margin-bottom: 24px;';
            const vvList = vvSection.querySelector('.value-vitality-list');
            if (vvList) {
                vvList.style.cssText = 'max-height: 240px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;';
                vvList.querySelectorAll('.value-vitality-item').forEach(item => {
                    let borderColor = '#667eea';
                    if (item.classList.contains('positive')) borderColor = '#28a745';
                    else if (item.classList.contains('negative')) borderColor = '#dc3545';
                    item.style.cssText = `display: flex; align-items: center; gap: 12px; padding: 12px; background: white; border-radius: 10px; border: 1px solid #eee; border-left: 3px solid ${borderColor}; cursor: pointer; transition: all 0.2s ease;`;
                    const vvPrice = item.querySelector('.vv-price');
                    if (vvPrice) vvPrice.style.cssText = 'font-size: 0.85em; color: #666; font-weight: 500;';
                    const vvEmoji = item.querySelector('.vv-emoji');
                    if (vvEmoji) vvEmoji.style.cssText = 'font-size: 1.1em;';
                });
            }
            console.log('[SentimentPopup DEBUG] Value vs. Vitality section styles applied');
        }

        // Info section
        const infoSection = modalElement.querySelector('.sentiment-info');
        if (infoSection) {
            infoSection.style.cssText = 'display: flex; gap: 12px; padding: 16px; background: #f0f4ff; border-radius: 10px; border: 1px solid #d0d8ff;';
            const infoIcon = infoSection.querySelector('.info-icon');
            if (infoIcon) infoIcon.style.fontSize = '1.2em';
            const infoText = infoSection.querySelector('.info-text');
            if (infoText) infoText.style.cssText = 'font-size: 0.85em; color: #555; line-height: 1.5;';
            console.log('[SentimentPopup DEBUG] Info section styles applied');
        }
    } else {
        console.error('[SentimentPopup DEBUG] ERROR: Modal element .sentiment-popup-modal not found in popupContainer');
        console.log('[SentimentPopup DEBUG] popupContainer innerHTML preview:', popupHTML.substring(0, 500));
    }

    // Add click handler for the popup content
    popupContainer.addEventListener('click', handleSentimentPopupClick);

    // Close on background click
    popupContainer.addEventListener('click', (e) => {
        if (e.target === popupContainer) {
            closeSentimentPopup();
        }
    });

    // Close on Escape
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeSentimentPopup();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    log('Presentation', 'Sentiment popup opened');
    console.log('[SentimentPopup DEBUG] Popup opened and appended to body');
}

/**
 * Close the sentiment analysis popup
 */
export function closeSentimentPopup() {
    const existingPopup = document.querySelector('.sentiment-popup-overlay');
    if (existingPopup) {
        existingPopup.remove();
    }
}

/**
 * Handle clicks within the sentiment popup
 */
function handleSentimentPopupClick(e) {
    e.stopPropagation();

    // Close button
    if (e.target.classList.contains('sentiment-popup-close')) {
        closeSentimentPopup();
        return;
    }

    // Click on ranking item or graph item to scroll to it
    const clickableItem = e.target.closest('.sentiment-ranking-item, .sentiment-graph-item');
    if (clickableItem) {
        const recordId = clickableItem.dataset.recordId;
        closeSentimentPopup();

        // Scroll to the item in the presentation view
        const targetItem = document.querySelector(`.itinerary-item[data-record-id="${recordId}"]`);
        if (targetItem) {
            targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Brief highlight
            targetItem.classList.add('highlight');
            setTimeout(() => targetItem.classList.remove('highlight'), 2000);
        }
    }
}
