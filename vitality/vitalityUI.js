// FILE: vitality/vitalityUI.js
// UI bridge for the Universal Vitality system.
// Listens for vitalityRecalculated events and applies CSS classes,
// custom properties, pulse animations, synergy flow lines, and the Net Emoji morph.

import { state, getRecordById } from '../state.js';
import { REALM_META, TIME_SCOPES } from './vitalityProfiles.js';
import { setTimeScope, getFidelityMultiplier } from './vitalityEngine.js';

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
            const { planNet, planNetEmoji, planNetLabel, itemScores, synergies, dominantRealm } = e.detail;
            applyCardPulses(itemScores, synergies, dominantRealm);
            updateNetEmojiMorph(planNetEmoji, planNetLabel);
            drawSynergyFlowLines(synergies);
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
 * Add or update a small vitality badge on a card showing the item's net emoji.
 */
function updateCardVitalityBadge(card, scores) {
    let badge = card.querySelector('.vitality-score-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.className = 'vitality-score-badge';

        const emojiSpan = document.createElement('span');
        emojiSpan.className = 'vitality-emoji';
        badge.appendChild(emojiSpan);

        // Find the photo area or card body to append to
        const photoArea = card.querySelector('.compact-card-photo, .presentation-result-card-image-container');
        if (photoArea) {
            photoArea.style.position = 'relative';
            photoArea.appendChild(badge);
            console.log('[VitalityUI DEBUG] Badge CREATED in photoArea for card:', card.dataset.recordId);
        } else {
            card.style.position = 'relative';
            card.appendChild(badge);
            console.log('[VitalityUI DEBUG] Badge CREATED on card (no photo area) for:', card.dataset.recordId);
        }
    }

    const emojiSpan = badge.querySelector('.vitality-emoji');
    if (emojiSpan) {
        emojiSpan.textContent = scores.netEmoji || '⚖️';
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
