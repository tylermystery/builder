// FILE: vitality/vitalityUI.js
// UI bridge for the Universal Vitality system.
// Listens for vitalityRecalculated events and applies CSS classes,
// custom properties, pulse animations, synergy flow lines, and the Net Emoji morph.

import { state, getRecordById } from '../state.js';
import { REALM_META, TIME_SCOPES, NET_EMOJI_SCALE } from './vitalityProfiles.js';
import { setTimeScope, getFidelityMultiplier, getNetEmoji, getItemSentiment } from './vitalityEngine.js';
import { getRecordPrice } from '../utils.js';
import { getModalZIndex, REACTION_SCORES } from '../config.js';

// Track previous Net Emoji for morph transition
let previousPlanEmoji = '⚖️';
let morphContainerEl = null;

// Track the flow lines SVG
let flowLinesSvg = null;

// Track whether event listener is already registered
let vitalityListenerRegistered = false;

/**
 * Initialize the Vitality UI system.
 * Call this once after the DOM is ready and the presentation view exists.
 */
export function initVitalityUI() {
    console.log('[VitalityUI DEBUG] initVitalityUI() called, listenerRegistered:', vitalityListenerRegistered);
    // Listen for recalculation events (only register once)
    if (!vitalityListenerRegistered) {
        document.addEventListener('vitalityRecalculated', (e) => {
            console.log('[VitalityUI DEBUG] vitalityRecalculated event received:', {
                planNet: e.detail.planNet,
                planNetEmoji: e.detail.planNetEmoji,
                planNetLabel: e.detail.planNetLabel,
                itemScoresSize: e.detail.itemScores?.size,
                synergiesCount: e.detail.synergies?.length,
                dominantRealm: e.detail.dominantRealm
            });
            const { planNet, planNetEmoji, planNetLabel, planGoodnessEmoji, planGoodnessLabel, itemScores, synergies, dominantRealm } = e.detail;
            applyCardPulses(itemScores, synergies, dominantRealm);
            // Use the goodness emoji (vitality + sentiment blend) for the header display
            updateNetEmojiMorph(planGoodnessEmoji || planNetEmoji, planGoodnessLabel || planNetLabel);
            drawSynergyFlowLines(synergies);

            // Update the modal badge if a detail modal is open
            const modalOverlay = document.getElementById('detail-modal-overlay');
            if (modalOverlay && modalOverlay.style.display !== 'none') {
                const modalRecordId = modalOverlay.dataset.recordId;
                if (modalRecordId) updateModalVitalityBadge(modalRecordId);
            }
        });
        vitalityListenerRegistered = true;
        console.log('[VitalityUI DEBUG] vitalityRecalculated event listener REGISTERED');
    }

    // Inject the Net Emoji container + time scope selector into the presentation header
    injectHeaderVitality();
}

/**
 * Inject the Net Emoji morph container and time scope selector
 * into the presentation header (right side, before the total).
 */
function injectHeaderVitality() {
    console.log('[VitalityUI DEBUG] injectHeaderVitality() called');
    const headerRight = document.getElementById('presentation-header-right');
    if (!headerRight) {
        console.warn('[VitalityUI DEBUG] presentation-header-right NOT FOUND - cannot inject header');
        return;
    }
    console.log('[VitalityUI DEBUG] presentation-header-right found');

    // Avoid double injection
    if (document.getElementById('vitality-header-section')) {
        console.log('[VitalityUI DEBUG] vitality-header-section already exists, skipping injection');
        return;
    }

    const section = document.createElement('div');
    section.className = 'vitality-header-section';
    section.id = 'vitality-header-section';

    // Net Emoji morph container
    const emojiContainer = document.createElement('div');
    emojiContainer.className = 'net-emoji-morph-container';
    emojiContainer.id = 'net-emoji-morph-container';
    emojiContainer.title = 'Plan Vitality';

    // Two layers for crossfade morph
    const layerA = document.createElement('span');
    layerA.className = 'net-emoji-layer emoji-entering';
    layerA.id = 'net-emoji-layer-a';
    layerA.textContent = '⚖️';

    const layerB = document.createElement('span');
    layerB.className = 'net-emoji-layer emoji-hidden';
    layerB.id = 'net-emoji-layer-b';
    layerB.textContent = '';

    emojiContainer.appendChild(layerA);
    emojiContainer.appendChild(layerB);

    // Time scope selector
    const scopeSelector = document.createElement('div');
    scopeSelector.className = 'vitality-time-scope-selector';
    scopeSelector.title = 'Vitality Time Scope';

    const select = document.createElement('select');
    select.id = 'vitality-time-scope-select';
    TIME_SCOPES.forEach((scope, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = scope.label;
        if (i === (state.vitality ? state.vitality.timeScopeIndex : 4)) {
            opt.selected = true;
        }
        select.appendChild(opt);
    });
    select.addEventListener('change', (e) => {
        setTimeScope(parseInt(e.target.value));
    });
    scopeSelector.appendChild(select);

    section.appendChild(emojiContainer);
    section.appendChild(scopeSelector);

    // Insert before the total button
    const totalBtn = document.getElementById('presentation-header-total');
    if (totalBtn) {
        headerRight.insertBefore(section, totalBtn);
    } else {
        headerRight.appendChild(section);
    }

    morphContainerEl = emojiContainer;
}

/**
 * Apply pulse/aura CSS classes and custom properties to presentation cards.
 *
 * @param {Map} itemScores - recordId -> score object
 * @param {Array} synergies - Active synergy pairs
 * @param {string|null} dominantRealm - Plan-level dominant realm
 */
function applyCardPulses(itemScores, synergies, dominantRealm) {
    console.log('[VitalityUI DEBUG] applyCardPulses() called, itemScores size:', itemScores?.size, 'synergies:', synergies?.length);
    // Build synergy sync groups: items in same synergy share animation-delay
    const synergySyncMap = new Map(); // recordId -> delay (seconds)
    let synergyGroupIndex = 0;
    for (const syn of synergies) {
        const delay = synergyGroupIndex * 0.05; // Tiny offset per group, but items in same group match
        if (!synergySyncMap.has(syn.itemA)) synergySyncMap.set(syn.itemA, delay);
        if (!synergySyncMap.has(syn.itemB)) synergySyncMap.set(syn.itemB, synergySyncMap.get(syn.itemA));
        synergyGroupIndex++;
    }

    // Iterate all presentation cards
    const cards = document.querySelectorAll('.presentation-result-card, .compact-card');
    console.log('[VitalityUI DEBUG] Found', cards.length, 'presentation/compact cards in DOM');
    cards.forEach(card => {
        const recordId = card.dataset.recordId || card.dataset.id;
        if (!recordId) {
            console.log('[VitalityUI DEBUG] Card found but no recordId/data-id attribute:', card.className);
            return;
        }

        const scores = itemScores.get(recordId);
        if (!scores) {
            console.log('[VitalityUI DEBUG] No scores found for card recordId:', recordId, '| itemScores keys:', [...itemScores.keys()].slice(0, 5));
            // Remove vitality classes if no score
            card.classList.remove('vitality-pulse-card', 'vitality-realm-planetary',
                'vitality-realm-collective', 'vitality-realm-cosmological',
                'vitality-realm-internal', 'vitality-drain');
            return;
        }

        // Determine this item's dominant realm
        let itemRealm = null;
        let maxRealmVal = -Infinity;
        for (const realm of ['cosmological', 'planetary', 'collective', 'internal']) {
            if (scores[realm] > maxRealmVal) {
                maxRealmVal = scores[realm];
                itemRealm = realm;
            }
        }

        // If net is negative, use drain animation instead
        const isDrain = scores.net < -0.05;

        // Remove old realm classes
        card.classList.remove('vitality-realm-planetary', 'vitality-realm-collective',
            'vitality-realm-cosmological', 'vitality-realm-internal', 'vitality-drain');

        // Add base class
        card.classList.add('vitality-pulse-card');

        if (isDrain) {
            card.classList.add('vitality-drain');
        } else if (itemRealm) {
            card.classList.add(`vitality-realm-${itemRealm}`);
        }

        // Set CSS custom properties
        const intensity = scores.fidelity !== undefined ? scores.fidelity : 0.5;
        card.style.setProperty('--vitality-intensity', intensity.toFixed(2));

        // Synergy breathing: synchronized delay
        const syncDelay = synergySyncMap.has(recordId) ? synergySyncMap.get(recordId) : Math.random() * 0.5;
        card.style.setProperty('--vitality-delay', `${syncDelay.toFixed(2)}s`);

        // Add/update vitality score badge
        updateCardVitalityBadge(card, scores);
        console.log('[VitalityUI DEBUG] Applied vitality to card:', recordId, '| realm:', itemRealm, '| isDrain:', isDrain, '| intensity:', intensity.toFixed(2), '| netEmoji:', scores.netEmoji);
    });
}

/**
 * Add or update a small vitality badge on a card showing the item's goodness emoji.
 * Uses the blended goodnessEmoji (vitality + sentiment) when available.
 * Targets the price/valuation container so the emoji sits adjacent to the price.
 * Falls back to photo area for cards without a price container.
 * Badges are clickable — clicking opens the Goodness Report popup.
 */
function updateCardVitalityBadge(card, scores) {
    const emoji = scores.goodnessEmoji || scores.netEmoji || '⚖️';
    const recordId = card.dataset.recordId || card.dataset.id;

    // --- Interactive cards (card.js): update the .valuation-vitality-emoji inside .valuation-meta ---
    const valuationEmoji = card.querySelector('.valuation-vitality-emoji');
    if (valuationEmoji) {
        valuationEmoji.textContent = emoji;
        valuationEmoji.style.cursor = 'pointer';
        valuationEmoji.title = `Goodness: ${scores.goodnessLabel || scores.netLabel || 'Neutral'} (click for details)`;
        if (!valuationEmoji._goodnessClickBound) {
            valuationEmoji.addEventListener('click', (e) => { e.stopPropagation(); showGoodnessReport(recordId); });
            valuationEmoji._goodnessClickBound = true;
        }
        return;
    }

    // --- Compact cards (presentation.js): update .compact-card-vitality inside .compact-card-valuation ---
    const compactVitality = card.querySelector('.compact-card-vitality');
    if (compactVitality) {
        compactVitality.textContent = emoji;
        compactVitality.style.cursor = 'pointer';
        compactVitality.title = `Goodness: ${scores.goodnessLabel || scores.netLabel || 'Neutral'} (click for details)`;
        if (!compactVitality._goodnessClickBound) {
            compactVitality.addEventListener('click', (e) => { e.stopPropagation(); showGoodnessReport(recordId); });
            compactVitality._goodnessClickBound = true;
        }
        return;
    }

    // --- Fallback: inject into .valuation-meta or .price-wrapper if the spans weren't pre-rendered ---
    const valuationMeta = card.querySelector('.valuation-meta');
    if (valuationMeta && !valuationMeta.querySelector('.valuation-vitality-emoji')) {
        const span = document.createElement('span');
        span.className = 'valuation-vitality-emoji';
        span.title = `Goodness: ${scores.goodnessLabel || 'Neutral'} (click for details)`;
        span.textContent = emoji;
        span.style.cursor = 'pointer';
        span.addEventListener('click', (e) => { e.stopPropagation(); showGoodnessReport(recordId); });
        span._goodnessClickBound = true;
        valuationMeta.appendChild(span);
        return;
    }

    // --- Compact card fallback: inject into .compact-card-valuation ---
    const compactValuation = card.querySelector('.compact-card-valuation');
    if (compactValuation && !compactValuation.querySelector('.compact-card-vitality')) {
        const span = document.createElement('span');
        span.className = 'compact-card-vitality';
        span.title = `Goodness: ${scores.goodnessLabel || 'Neutral'} (click for details)`;
        span.textContent = emoji;
        span.style.cursor = 'pointer';
        span.addEventListener('click', (e) => { e.stopPropagation(); showGoodnessReport(recordId); });
        span._goodnessClickBound = true;
        compactValuation.appendChild(span);
        return;
    }

    // --- Last resort: original photo-area badge for cards without price containers ---
    let badge = card.querySelector('.vitality-score-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'vitality-score-badge';
        badge.style.cursor = 'pointer';
        badge.addEventListener('click', (e) => { e.stopPropagation(); showGoodnessReport(recordId); });

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'vitality-emoji';
        badge.appendChild(emojiSpan);

        const photoArea = card.querySelector('.compact-card-photo, .presentation-result-card-image-container');
        if (photoArea) {
            photoArea.style.position = 'relative';
            photoArea.appendChild(badge);
        } else {
            card.style.position = 'relative';
            card.appendChild(badge);
        }
    }

    const emojiSpan = badge.querySelector('.vitality-emoji');
    if (emojiSpan) {
        emojiSpan.textContent = emoji;
    }
}

/**
 * Update the Net Emoji morph in the header with a smooth crossfade transition.
 *
 * Uses two stacked layers: when the emoji changes, the old one fades/scales out
 * while the new one fades/scales in, creating a fluid morph effect.
 */
function updateNetEmojiMorph(newEmoji, label) {
    console.log('[VitalityUI DEBUG] updateNetEmojiMorph() called with newEmoji:', newEmoji, 'label:', label, 'previousPlanEmoji:', previousPlanEmoji);
    if (!morphContainerEl) {
        // Try to find it if it was injected after init
        morphContainerEl = document.getElementById('net-emoji-morph-container');
        console.log('[VitalityUI DEBUG] morphContainerEl was null, re-queried:', morphContainerEl ? 'FOUND' : 'STILL NULL');
    }
    if (!morphContainerEl) {
        console.warn('[VitalityUI DEBUG] morphContainerEl is NULL - cannot update emoji morph');
        return;
    }

    // No change — skip
    if (newEmoji === previousPlanEmoji) {
        console.log('[VitalityUI DEBUG] newEmoji === previousPlanEmoji, SKIPPING morph (no change)');
        return;
    }
    console.log('[VitalityUI DEBUG] Emoji CHANGED from', previousPlanEmoji, 'to', newEmoji, '- performing morph');

    const layerA = document.getElementById('net-emoji-layer-a');
    const layerB = document.getElementById('net-emoji-layer-b');
    if (!layerA || !layerB) return;

    // Determine which layer is currently active (entering)
    const aIsActive = layerA.classList.contains('emoji-entering');

    if (aIsActive) {
        // A is showing — put new emoji on B, crossfade
        layerB.textContent = newEmoji;
        layerA.classList.remove('emoji-entering');
        layerA.classList.add('emoji-exiting');
        layerB.classList.remove('emoji-hidden');
        layerB.classList.add('emoji-entering');

        // Clean up A after transition
        setTimeout(() => {
            layerA.classList.remove('emoji-exiting');
            layerA.classList.add('emoji-hidden');
        }, 400);
    } else {
        // B is showing — put new emoji on A, crossfade
        layerA.textContent = newEmoji;
        layerB.classList.remove('emoji-entering');
        layerB.classList.add('emoji-exiting');
        layerA.classList.remove('emoji-hidden');
        layerA.classList.add('emoji-entering');

        setTimeout(() => {
            layerB.classList.remove('emoji-exiting');
            layerB.classList.add('emoji-hidden');
        }, 400);
    }

    // Update tooltip
    morphContainerEl.title = `Plan Vitality: ${label || newEmoji}`;
    previousPlanEmoji = newEmoji;
}

/**
 * Draw SVG "Flow Lines" between synergetic items on the presentation board.
 * Lines are cubic beziers connecting the center of each card pair.
 */
function drawSynergyFlowLines(synergies) {
    const boardGrid = document.querySelector('.presentation-results-grid, .compact-card-grid');
    if (!boardGrid) return;

    // Remove old SVG
    if (flowLinesSvg) {
        flowLinesSvg.remove();
        flowLinesSvg = null;
    }

    if (!synergies || synergies.length === 0) return;

    // Create SVG overlay
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('vitality-flow-lines-svg');
    boardGrid.style.position = 'relative';
    boardGrid.appendChild(svg);
    flowLinesSvg = svg;

    const gridRect = boardGrid.getBoundingClientRect();

    for (const syn of synergies) {
        const cardA = boardGrid.querySelector(`[data-record-id="${syn.itemA}"], [data-id="${syn.itemA}"]`);
        const cardB = boardGrid.querySelector(`[data-record-id="${syn.itemB}"], [data-id="${syn.itemB}"]`);
        if (!cardA || !cardB) continue;

        const rectA = cardA.getBoundingClientRect();
        const rectB = cardB.getBoundingClientRect();

        // Calculate centers relative to the grid container
        const ax = rectA.left - gridRect.left + rectA.width / 2;
        const ay = rectA.top - gridRect.top + rectA.height / 2;
        const bx = rectB.left - gridRect.left + rectB.width / 2;
        const by = rectB.top - gridRect.top + rectB.height / 2;

        // Cubic bezier control points for a gentle curve
        const midX = (ax + bx) / 2;
        const midY = (ay + by) / 2;
        const curveOffset = Math.abs(ax - bx) * 0.3 + 20;

        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${ax} ${ay} Q ${midX} ${midY - curveOffset} ${bx} ${by}`);
        path.classList.add('vitality-flow-line');
        path.setAttribute('data-synergy-label', syn.label);

        // Color by synergy multiplier
        const alpha = Math.min(0.6, 0.2 + (syn.multiplier - 1.0) * 1.5);
        path.style.stroke = `rgba(245, 158, 11, ${alpha.toFixed(2)})`;

        svg.appendChild(path);
    }

    // Set SVG viewBox to match grid dimensions
    svg.setAttribute('viewBox', `0 0 ${gridRect.width} ${gridRect.height}`);
    svg.setAttribute('width', gridRect.width);
    svg.setAttribute('height', gridRect.height);
}

/**
 * Show a Goodness Report popup for a specific item.
 * Displays the formula breakdown: vitality (70%) + sentiment (30%) = goodness score.
 * Shows the 4-realm bar chart, community sentiment reaction pills, and rank among plan items.
 */
export function showGoodnessReport(recordId) {
    if (!recordId) return;

    // Close any existing report popup
    closeGoodnessReport();

    const record = getRecordById(recordId);
    if (!record) return;

    const name = record.fields?.Name || 'Item';
    const scores = state.vitality?.itemScores?.get(recordId);
    if (!scores) return;

    const sentiment = scores.sentiment || { raw: 0, normalized: 0, count: 0 };

    // Get price for the value section
    const cartInfo = state.cart.lockedItems.get(recordId) || state.cart.items.get(recordId);
    const priceParam = (cartInfo?.selections && Object.keys(cartInfo.selections).length > 0)
        ? cartInfo.selections : cartInfo?.selectedOptionIndex;
    const price = cartInfo ? (cartInfo.overridePrice ?? getRecordPrice(record, priceParam)) : getRecordPrice(record);
    const priceText = (!isNaN(price) && price > 0) ? `$${price.toFixed(2)}` : 'Free';

    // Calculate goodness per dollar
    let valueText = '--';
    if (!isNaN(price) && price > 0 && scores.goodnessScore > 0) {
        valueText = `${(scores.goodnessScore / price * 100).toFixed(1)}¢/pt`;
    } else if ((!price || price === 0) && scores.goodnessScore > 0) {
        valueText = 'Free + Good';
    } else if (scores.goodnessScore < 0) {
        valueText = 'Drain';
    }

    // Realm bars
    const realms = ['cosmological', 'planetary', 'collective', 'internal'];
    const realmBarsHTML = realms.map(realm => {
        const val = scores[realm] || 0;
        const meta = REALM_META[realm];
        const pct = Math.abs(val) * 100;
        const isNeg = val < 0;
        return `
            <div class="goodness-realm-row">
                <span class="goodness-realm-label">${meta.emoji} ${meta.label}</span>
                <div class="goodness-realm-bar-track">
                    <div class="goodness-realm-bar-fill ${isNeg ? 'negative' : 'positive'}" style="width: ${pct}%; background: ${isNeg ? '#ef4444' : meta.color};"></div>
                </div>
                <span class="goodness-realm-value" style="color: ${isNeg ? '#ef4444' : meta.color}">${val >= 0 ? '+' : ''}${val.toFixed(2)}</span>
            </div>
        `;
    }).join('');

    // Sentiment reactions display
    const reactions = state.session.reactions?.get(recordId);
    let reactionPillsHTML = '<span class="goodness-no-reactions">No reactions yet</span>';
    if (reactions && reactions instanceof Map && reactions.size > 0) {
        const emojiCounts = {};
        reactions.forEach((emoji) => { emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1; });
        reactionPillsHTML = Object.entries(emojiCounts)
            .map(([emoji, count]) => {
                const score = REACTION_SCORES[emoji] || 0;
                const scoreClass = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';
                return `<span class="goodness-reaction-pill ${scoreClass}">${emoji}${count > 1 ? `<sup>${count}</sup>` : ''} <small>${score >= 0 ? '+' : ''}${score.toFixed(1)}</small></span>`;
            }).join('');
    }

    // Rank among plan items
    let rankHTML = '';
    if (state.vitality?.itemScores?.size > 1) {
        const sorted = [...state.vitality.itemScores.entries()]
            .sort((a, b) => b[1].goodnessScore - a[1].goodnessScore);
        const rank = sorted.findIndex(([id]) => id === recordId) + 1;
        const total = sorted.length;
        rankHTML = `<div class="goodness-rank">#${rank} of ${total} items in plan</div>`;
    }

    const popupHTML = `
        <div class="goodness-report-modal">
            <div class="goodness-report-header">
                <div>
                    <h3 class="goodness-report-title">Goodness Report</h3>
                    <div class="goodness-report-item-name">${name}</div>
                </div>
                <button class="goodness-report-close">&times;</button>
            </div>

            <div class="goodness-report-body">
                <div class="goodness-score-hero">
                    <span class="goodness-hero-emoji">${scores.goodnessEmoji || scores.netEmoji}</span>
                    <div class="goodness-hero-details">
                        <div class="goodness-hero-label">${scores.goodnessLabel || scores.netLabel || 'Neutral'}</div>
                        <div class="goodness-hero-score">${scores.goodnessScore >= 0 ? '+' : ''}${scores.goodnessScore.toFixed(3)}</div>
                    </div>
                </div>

                <div class="goodness-formula">
                    <div class="goodness-formula-row">
                        <span class="goodness-formula-component vitality-component">
                            <span class="formula-pct">70%</span>
                            <span class="formula-label">Vitality</span>
                            <span class="formula-emoji">${scores.netEmoji}</span>
                            <span class="formula-value">${scores.net >= 0 ? '+' : ''}${scores.net.toFixed(3)}</span>
                        </span>
                        <span class="goodness-formula-plus">+</span>
                        <span class="goodness-formula-component sentiment-component">
                            <span class="formula-pct">30%</span>
                            <span class="formula-label">Sentiment</span>
                            <span class="formula-value">${sentiment.normalized >= 0 ? '+' : ''}${sentiment.normalized.toFixed(3)}</span>
                            <span class="formula-count">${sentiment.count} reaction${sentiment.count !== 1 ? 's' : ''}</span>
                        </span>
                        <span class="goodness-formula-equals">=</span>
                        <span class="goodness-formula-result">
                            <span class="formula-emoji">${scores.goodnessEmoji || scores.netEmoji}</span>
                            <span class="formula-value">${scores.goodnessScore >= 0 ? '+' : ''}${scores.goodnessScore.toFixed(3)}</span>
                        </span>
                    </div>
                </div>

                <div class="goodness-section">
                    <div class="goodness-section-title">Four Realms</div>
                    ${realmBarsHTML}
                </div>

                <div class="goodness-section">
                    <div class="goodness-section-title">Community Sentiment</div>
                    <div class="goodness-reactions-list">${reactionPillsHTML}</div>
                </div>

                <div class="goodness-section goodness-value-section">
                    <div class="goodness-section-title">Value</div>
                    <div class="goodness-value-row">
                        <span>${priceText}</span>
                        <span>${scores.goodnessEmoji || scores.netEmoji} ${scores.goodnessLabel || ''}</span>
                        <span class="goodness-value-ratio">${valueText}</span>
                    </div>
                </div>

                ${rankHTML}
            </div>
        </div>
    `;

    const overlay = document.createElement('div');
    overlay.className = 'goodness-report-overlay';
    overlay.id = 'goodness-report-overlay';

    let zIndex = 100000;
    try { zIndex = getModalZIndex('picker'); } catch(e) { /* use default */ }

    overlay.style.zIndex = zIndex;
    overlay.innerHTML = popupHTML;
    document.body.appendChild(overlay);

    // Close handlers
    const closeBtn = overlay.querySelector('.goodness-report-close');
    if (closeBtn) closeBtn.addEventListener('click', closeGoodnessReport);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeGoodnessReport();
    });
    document.addEventListener('keydown', goodnessEscHandler);
}

function goodnessEscHandler(e) {
    if (e.key === 'Escape') closeGoodnessReport();
}

function closeGoodnessReport() {
    const existing = document.getElementById('goodness-report-overlay');
    if (existing) existing.remove();
    document.removeEventListener('keydown', goodnessEscHandler);
}

/**
 * Update the vitality/goodness badge inside the detail modal's price area.
 * Called after vitality recalculates while the modal is open.
 * @param {string} recordId - The record currently displayed in the modal
 */
export function updateModalVitalityBadge(recordId) {
    if (!recordId) return;
    const scores = state.vitality?.itemScores?.get(recordId);
    const emoji = scores?.goodnessEmoji || scores?.netEmoji || '⚖️';
    const label = scores?.goodnessLabel || scores?.netLabel || 'Neutral';

    const badge = document.getElementById('modal-vitality-badge');
    if (badge) {
        badge.textContent = emoji;
        badge.title = `Goodness: ${label} (click for details)`;
    }
}

/**
 * Clean up flow lines (call on view exit).
 */
export function cleanupVitalityUI() {
    if (flowLinesSvg) {
        flowLinesSvg.remove();
        flowLinesSvg = null;
    }
}

/**
 * Force a re-draw of flow lines (call on window resize or card reorder).
 */
export function refreshFlowLines() {
    if (state.vitality && state.vitality.synergies) {
        drawSynergyFlowLines(state.vitality.synergies);
    }
}
