// FILE: vitality/vitalityEngine.js
// Core logic engine for Universal Vitality calculations.
// Computes time-integral vitality scores for plan items and detects synergies.

import { state, getRecordById, setState } from '../state.js';
import { CONSTANTS, REACTION_SCORES } from '../config.js';
import {
    VITALITY_PROFILES,
    DEFAULT_PROFILE,
    TIME_SCOPES,
    DEFAULT_TIME_SCOPE_INDEX,
    REALM_META,
    NET_EMOJI_SCALE,
    SYNERGY_PAIRS
} from './vitalityProfiles.js';

// Throttle recalculation to animation frames
let recalcPending = false;

/**
 * Get the vitality profile for a record based on its categories.
 * Checks subcategories first for a more specific match, then falls back to primary categories.
 * Multi-category items get an averaged profile.
 * Local overrides stored in state.cart.items are applied on top.
 *
 * @param {Object} record - Airtable record
 * @param {string} recordId - Record ID
 * @returns {Object} Profile with { cosmological, planetary, collective, internal }
 */
export function getItemProfile(record, recordId) {
    if (!record || !record.fields) return { ...DEFAULT_PROFILE };

    // Check for local override in cart items
    const cartOverride = state.cart.items.get(recordId);
    if (cartOverride && cartOverride.vitalityOverride) {
        return { ...cartOverride.vitalityOverride };
    }

    const categories = (record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '')
        .split(',')
        .map(c => c.trim())
        .filter(Boolean);

    const subcategories = (record.fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || '')
        .split(',')
        .map(c => c.trim())
        .filter(Boolean);

    // Try subcategories first (more specific)
    const matchedProfiles = [];
    for (const sub of subcategories) {
        if (VITALITY_PROFILES[sub]) {
            matchedProfiles.push(VITALITY_PROFILES[sub]);
        }
    }

    // If no subcategory match, use primary categories
    if (matchedProfiles.length === 0) {
        for (const cat of categories) {
            if (VITALITY_PROFILES[cat]) {
                matchedProfiles.push(VITALITY_PROFILES[cat]);
            }
        }
    }

    // No match at all — use default
    if (matchedProfiles.length === 0) {
        return { ...DEFAULT_PROFILE };
    }

    // Average across all matched profiles
    if (matchedProfiles.length === 1) {
        return { ...matchedProfiles[0] };
    }

    const avg = { cosmological: 0, planetary: 0, collective: 0, internal: 0 };
    for (const p of matchedProfiles) {
        avg.cosmological += p.cosmological;
        avg.planetary += p.planetary;
        avg.collective += p.collective;
        avg.internal += p.internal;
    }
    const n = matchedProfiles.length;
    avg.cosmological /= n;
    avg.planetary /= n;
    avg.collective /= n;
    avg.internal /= n;
    return avg;
}

/**
 * Compute the time-integral vitality score for a single realm value.
 *
 * Extractive actions (negative values) create "Vitality Debt" that grows
 * with longer time scopes (debt compounds).
 *
 * Regenerative actions (positive values) create "Resonance" that compounds
 * logarithmically over time (diminishing but persistent returns).
 *
 * @param {number} realmValue - Base realm score (-1.0 to 1.0)
 * @param {number} hours - Time scope in hours
 * @returns {number} Time-integrated realm score (-1.0 to 1.0, clamped)
 */
function timeIntegral(realmValue, hours) {
    if (realmValue === 0) return 0;

    // Normalize hours to a 0-1 scale where 1 Year = 1.0
    const t = hours / 8760;

    if (realmValue > 0) {
        // Resonance: positive values compound logarithmically
        // f(v, t) = v * (1 + ln(1 + t)) / (1 + ln(2))
        // At t=1 (1 year), this equals v * 1.0 (no change from base)
        // At t>1, slight amplification; at t<1, slight reduction
        const resonance = realmValue * (1 + Math.log(1 + t)) / (1 + Math.log(2));
        return Math.min(resonance, 1.0);
    } else {
        // Vitality Debt: negative values grow with time (debt compounds)
        // f(v, t) = v * (1 + sqrt(t))
        // At t=1 (1 year), this equals v * 2.0 (doubled debt)
        // At t=0.001 (1 hour), barely changed
        const debt = realmValue * (1 + Math.sqrt(t));
        return Math.max(debt, -1.0);
    }
}

/**
 * Compute the Net Emoji for a given net vitality score.
 * @param {number} netScore - Net vitality score (-1.0 to 1.0)
 * @returns {{ emoji: string, label: string }}
 */
export function getNetEmoji(netScore) {
    for (const bracket of NET_EMOJI_SCALE) {
        if (netScore >= bracket.min && netScore < bracket.max) {
            return { emoji: bracket.emoji, label: bracket.label };
        }
    }
    // Fallback (should not happen)
    return { emoji: '⚖️', label: 'Neutral' };
}

/**
 * Detect active synergies among the current plan items.
 * Checks each synergy pair definition against the categories present in locked items.
 *
 * @returns {Array<{ itemA: string, itemB: string, categoryA: string, categoryB: string, label: string, multiplier: number }>}
 */
function detectSynergies() {
    const synergies = [];

    // Build a map of category -> [recordIds] for all plan items (Ideas + Locked)
    const allItems = getAllPlanItems();
    const categoryToItems = new Map();
    allItems.forEach((itemInfo, recordId) => {
        const record = getRecordById(recordId);
        if (!record || !record.fields) return;

        const categories = (record.fields[CONSTANTS.FIELD_NAMES.CATEGORIES] || '')
            .split(',')
            .map(c => c.trim())
            .filter(Boolean);
        const subcategories = (record.fields[CONSTANTS.FIELD_NAMES.SUBCATEGORIES] || '')
            .split(',')
            .map(c => c.trim())
            .filter(Boolean);

        const allCats = [...categories, ...subcategories];
        for (const cat of allCats) {
            if (!categoryToItems.has(cat)) categoryToItems.set(cat, []);
            categoryToItems.get(cat).push(recordId);
        }
    });

    // Check each synergy pair
    for (const pair of SYNERGY_PAIRS) {
        const itemsA = categoryToItems.get(pair.a) || [];
        const itemsB = categoryToItems.get(pair.b) || [];

        if (itemsA.length > 0 && itemsB.length > 0) {
            // Create synergy links between the first matched item in each category
            // (could be extended to all pairs)
            synergies.push({
                itemA: itemsA[0],
                itemB: itemsB[0],
                categoryA: pair.a,
                categoryB: pair.b,
                label: pair.label,
                multiplier: pair.multiplier
            });
        }
    }

    return synergies;
}

/**
 * Get the confidence-based fidelity multiplier for a record.
 * Maps the 4-tier confidence system (pencil/pen/typed/premium) to pulse intensity.
 *
 * @param {Object} record - Airtable record
 * @param {string} recordId - Record ID
 * @returns {number} 0.0 to 1.0 intensity multiplier
 */
export function getFidelityMultiplier(record, recordId) {
    if (!record) return 0.3;

    // Determine confidence the same way the card system does
    const isAIItem = recordId.startsWith('custom-') ||
                     recordId.startsWith('ai-search-') ||
                     recordId.startsWith('ai-group-') ||
                     recordId.startsWith('ai-presentation-') ||
                     recordId.startsWith('solution-');
    const isSolutionItem = recordId.startsWith('solution-');
    const isManualItem = recordId.startsWith('manual-presentation-') || recordId.startsWith('manual-');

    let confidence = null;
    if (record.solutionData && record.solutionData.confidence !== undefined) {
        confidence = record.solutionData.confidence;
    } else if (record.fields && record.fields.Confidence !== undefined) {
        confidence = record.fields.Confidence;
    } else if (isAIItem || isSolutionItem || isManualItem) {
        confidence = null; // Will be treated as pencil
    } else {
        // Catalog items (verified) get premium by default
        return 1.0;
    }

    // Map confidence tiers to intensity multipliers
    if (confidence === null || confidence === undefined) {
        return 0.25; // Pencil tier - dim pulse
    } else if (confidence < 0.5) {
        return 0.25; // Pencil tier
    } else if (confidence < 0.75) {
        return 0.5;  // Pen tier
    } else if (confidence < 0.95) {
        return 0.75; // Typed tier
    } else {
        return 1.0;  // Premium tier - full intensity
    }
}

/**
 * Build a combined Map of all plan items (both Ideas and Locked/Confirmed).
 * The vitality engine should consider all items visible in the presentation view.
 * @returns {Map} Combined map of recordId -> itemInfo
 */
function getAllPlanItems() {
    const combined = new Map();
    // Add Ideas (state.cart.items) first
    state.cart.items.forEach((itemInfo, recordId) => {
        combined.set(recordId, itemInfo);
    });
    // Add Locked/Confirmed items (state.cart.lockedItems) — these take priority
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        combined.set(recordId, itemInfo);
    });
    return combined;
}

/**
 * Compute the sentiment score for a single item from reactions.
 * Returns a value normalized to -1..+1.
 * Uses REACTION_SCORES config for per-emoji weights.
 * The raw score range for a single reaction is roughly -5..+5,
 * so we normalize by dividing by 5.
 * When multiple reactions exist, we use the average reaction score.
 * @param {string} recordId - Record ID
 * @returns {{ raw: number, normalized: number, count: number }}
 */
export function getItemSentiment(recordId) {
    const reactions = state.session.reactions?.get(recordId);
    if (!reactions || !(reactions instanceof Map) || reactions.size === 0) {
        return { raw: 0, normalized: 0, count: 0 };
    }
    let total = 0;
    reactions.forEach((emoji) => {
        total += (REACTION_SCORES[emoji] || 0);
    });
    const avg = total / reactions.size;
    // Normalize: reaction scores range roughly -5..+5, map to -1..+1
    const normalized = Math.max(-1, Math.min(1, avg / 5));
    return { raw: total, normalized, count: reactions.size };
}

/**
 * Main recalculation function. Recomputes vitality scores for all plan items
 * (both Ideas and Locked/Confirmed), detects synergies, blends in community
 * sentiment to produce a unified "goodness" score, and updates state.vitality.
 *
 * Called via requestAnimationFrame to avoid blocking the UI.
 */
export function recalculateVitality() {
    const allItems = getAllPlanItems();
    console.log('[Vitality DEBUG] recalculateVitality() CALLED');
    console.log('[Vitality DEBUG] state.cart.items size:', state.cart.items.size);
    console.log('[Vitality DEBUG] state.cart.lockedItems size:', state.cart.lockedItems.size);
    console.log('[Vitality DEBUG] Combined allItems size:', allItems.size, 'keys:', [...allItems.keys()]);
    const timeScopeIndex = state.vitality ? state.vitality.timeScopeIndex : DEFAULT_TIME_SCOPE_INDEX;
    const hours = TIME_SCOPES[timeScopeIndex].hours;
    console.log('[Vitality DEBUG] timeScopeIndex:', timeScopeIndex, 'hours:', hours);
    const synergies = detectSynergies();

    // Build a set of items that benefit from synergy
    const synergyBonusMap = new Map(); // recordId -> total multiplier
    for (const syn of synergies) {
        const currentA = synergyBonusMap.get(syn.itemA) || 1.0;
        synergyBonusMap.set(syn.itemA, currentA * syn.multiplier);
        const currentB = synergyBonusMap.get(syn.itemB) || 1.0;
        synergyBonusMap.set(syn.itemB, currentB * syn.multiplier);
    }

    const itemScores = new Map();
    let totalNet = 0;
    let totalCount = 0;
    const realmTotals = { cosmological: 0, planetary: 0, collective: 0, internal: 0 };

    allItems.forEach((itemInfo, recordId) => {
        const record = getRecordById(recordId);
        if (!record) {
            console.warn('[Vitality DEBUG] getRecordById returned null for plan item:', recordId);
            return;
        }
        console.log('[Vitality DEBUG] Processing plan item:', recordId, '| Categories:', record.fields?.[CONSTANTS.FIELD_NAMES.CATEGORIES]);

        const profile = getItemProfile(record, recordId);
        console.log('[Vitality DEBUG] Item profile for', recordId, ':', JSON.stringify(profile));
        const synergyMult = synergyBonusMap.get(recordId) || 1.0;

        // Compute time-integrated score for each realm
        const scores = {
            cosmological: timeIntegral(profile.cosmological * synergyMult, hours),
            planetary: timeIntegral(profile.planetary * synergyMult, hours),
            collective: timeIntegral(profile.collective * synergyMult, hours),
            internal: timeIntegral(profile.internal * synergyMult, hours)
        };

        // Net score = average of all realms
        scores.net = (scores.cosmological + scores.planetary + scores.collective + scores.internal) / 4;

        // Clamp net to -1..1
        scores.net = Math.max(-1, Math.min(1, scores.net));

        // Get Net Emoji for this item
        const emojiResult = getNetEmoji(scores.net);
        scores.netEmoji = emojiResult.emoji;
        scores.netLabel = emojiResult.label;

        // Get fidelity multiplier
        scores.fidelity = getFidelityMultiplier(record, recordId);

        // Blend sentiment into a unified "goodness" score
        // Formula: 70% vitality net + 30% community sentiment (normalized to -1..+1)
        // When no reactions exist, sentiment is 0 so goodness gracefully equals vitality
        const sentiment = getItemSentiment(recordId);
        scores.sentiment = sentiment;
        scores.goodnessScore = (0.7 * scores.net) + (0.3 * sentiment.normalized);
        scores.goodnessScore = Math.max(-1, Math.min(1, scores.goodnessScore));

        // Compute goodness emoji from the blended score
        const goodnessEmojiResult = getNetEmoji(scores.goodnessScore);
        scores.goodnessEmoji = goodnessEmojiResult.emoji;
        scores.goodnessLabel = goodnessEmojiResult.label;

        itemScores.set(recordId, scores);

        totalNet += scores.net;
        totalCount++;
        realmTotals.cosmological += scores.cosmological;
        realmTotals.planetary += scores.planetary;
        realmTotals.collective += scores.collective;
        realmTotals.internal += scores.internal;
    });

    // Plan-level net vitality (average across items)
    const planNet = totalCount > 0 ? totalNet / totalCount : 0;
    const planNetClamped = Math.max(-1, Math.min(1, planNet));
    const planEmojiResult = getNetEmoji(planNetClamped);

    // Plan-level goodness (average of per-item goodnessScores)
    let planGoodnessTotal = 0;
    itemScores.forEach(scores => { planGoodnessTotal += scores.goodnessScore; });
    const planGoodness = totalCount > 0 ? planGoodnessTotal / totalCount : 0;
    const planGoodnessClamped = Math.max(-1, Math.min(1, planGoodness));
    const planGoodnessEmojiResult = getNetEmoji(planGoodnessClamped);

    console.log('[Vitality DEBUG] Plan-level results: totalCount=', totalCount, 'planNet=', planNetClamped.toFixed(4), 'emoji=', planEmojiResult.emoji, 'label=', planEmojiResult.label);
    console.log('[Vitality DEBUG] Plan goodness:', planGoodnessClamped.toFixed(4), 'emoji:', planGoodnessEmojiResult.emoji);
    console.log('[Vitality DEBUG] itemScores Map size:', itemScores.size, 'entries:', [...itemScores.keys()]);

    // Determine dominant realm
    let dominantRealm = null;
    if (totalCount > 0) {
        const avgRealms = {
            cosmological: realmTotals.cosmological / totalCount,
            planetary: realmTotals.planetary / totalCount,
            collective: realmTotals.collective / totalCount,
            internal: realmTotals.internal / totalCount
        };
        let maxVal = -Infinity;
        for (const [realm, val] of Object.entries(avgRealms)) {
            if (Math.abs(val) > maxVal) {
                maxVal = Math.abs(val);
                dominantRealm = realm;
            }
        }
    }

    // Update state
    console.log('[Vitality DEBUG] Calling setState with planNetEmoji:', planEmojiResult.emoji, 'planNet:', planNetClamped.toFixed(4));
    setState({
        vitality: {
            timeScopeIndex,
            itemScores,
            planNet: planNetClamped,
            planNetEmoji: planEmojiResult.emoji,
            planGoodness: planGoodnessClamped,
            planGoodnessEmoji: planGoodnessEmojiResult.emoji,
            synergies,
            dominantRealm
        }
    });

    // Dispatch event for UI components to react
    console.log('[Vitality DEBUG] Dispatching vitalityRecalculated event with planNetEmoji:', planEmojiResult.emoji);
    document.dispatchEvent(new CustomEvent('vitalityRecalculated', {
        detail: {
            planNet: planNetClamped,
            planNetEmoji: planEmojiResult.emoji,
            planNetLabel: planEmojiResult.label,
            planGoodness: planGoodnessClamped,
            planGoodnessEmoji: planGoodnessEmojiResult.emoji,
            planGoodnessLabel: planGoodnessEmojiResult.label,
            itemScores,
            synergies,
            dominantRealm
        }
    }));
}

/**
 * Request a throttled recalculation via requestAnimationFrame.
 * Safe to call rapidly — only one recalc per frame.
 */
export function requestVitalityRecalc() {
    console.log('[Vitality DEBUG] requestVitalityRecalc() called, recalcPending=', recalcPending);
    if (!recalcPending) {
        recalcPending = true;
        requestAnimationFrame(() => {
            console.log('[Vitality DEBUG] rAF callback firing, calling recalculateVitality()');
            recalcPending = false;
            recalculateVitality();
        });
    } else {
        console.log('[Vitality DEBUG] requestVitalityRecalc SKIPPED - recalc already pending');
    }
}

/**
 * Set the time scope and trigger recalculation.
 * @param {number} index - Index into TIME_SCOPES
 */
export function setTimeScope(index) {
    if (index < 0 || index >= TIME_SCOPES.length) return;
    setState({
        vitality: {
            ...state.vitality,
            timeScopeIndex: index
        }
    });
    requestVitalityRecalc();
}

/**
 * Set a local vitality override for an item (stored in cart.items).
 * @param {string} recordId - Record ID
 * @param {Object} profileOverride - { cosmological, planetary, collective, internal }
 */
export function setItemVitalityOverride(recordId, profileOverride) {
    const current = state.cart.items.get(recordId) || {};
    state.cart.items.set(recordId, {
        ...current,
        vitalityOverride: { ...profileOverride }
    });
    requestVitalityRecalc();
}

/**
 * Clear a local vitality override for an item.
 * @param {string} recordId - Record ID
 */
export function clearItemVitalityOverride(recordId) {
    const current = state.cart.items.get(recordId);
    if (current && current.vitalityOverride) {
        delete current.vitalityOverride;
        state.cart.items.set(recordId, current);
        requestVitalityRecalc();
    }
}
