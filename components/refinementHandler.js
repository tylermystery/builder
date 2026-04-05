// FILE: components/refinementHandler.js
// Highlight-to-Refine & Versioned Evolution handler.
// Listens for text selection in the detail modal, shows a "Refine" tooltip,
// and manages the iteration/version carousel for plan items.
//
// Data Model (Decision 2B): Linear array with user-based deduplication
// - iterations[0] = Original (Decision 5A: own variation slot, key = "original")
// - Subsequent entries keyed by author userId
// - When a user refines again, their existing entry is updated (not appended)
//
// Storage (Decision 1C): Hybrid — Item-level in Airtable, session-level active selection
// Naming (Decision 6): AI suggests variationName, user can override

import { state, getAggregateReactions } from '../state.js';
import { requestVitalityRecalc } from '../vitality/vitalityEngine.js';

// Re-export getAggregateReactions for consumers that import it from this module
export { getAggregateReactions };

console.log('[RefinementHandler] Module loaded');

// --- Internal State ---
let refineTooltip = null;
let currentRecordId = null;
let isRefining = false;

// --- localStorage keys for unauthenticated user data ---
const TEMP_ITERATIONS_KEY = 'tempIterations';
const TEMP_REACTIONS_KEY = 'tempReactions';

// --- Tooltip Management ---

/**
 * Create the "Refine" tooltip element (singleton, reused across selections).
 */
function ensureTooltip() {
    if (refineTooltip) return refineTooltip;

    refineTooltip = document.createElement('div');
    refineTooltip.className = 'refine-tooltip';
    refineTooltip.id = 'refine-tooltip';
    refineTooltip.innerHTML = `
        <button class="refine-tooltip-btn" aria-label="Refine this text with AI">
            <span class="refine-tooltip-icon">✨</span>
            <span class="refine-tooltip-label">Refine</span>
        </button>
    `;
    refineTooltip.style.display = 'none';
    document.body.appendChild(refineTooltip);

    // Click handler for the refine button
    refineTooltip.querySelector('.refine-tooltip-btn').addEventListener('click', handleRefineClick);

    return refineTooltip;
}

/**
 * Show the tooltip near the user's text selection.
 * @param {DOMRect} selectionRect - Bounding rect of the selection
 */
function showTooltip(selectionRect) {
    const tooltip = ensureTooltip();
    const tooltipWidth = 100;
    const tooltipHeight = 36;

    // Position above the selection, centered horizontally
    let left = selectionRect.left + (selectionRect.width / 2) - (tooltipWidth / 2);
    let top = selectionRect.top - tooltipHeight - 8 + window.scrollY;

    // Keep within viewport bounds
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipWidth - 8));
    if (top < window.scrollY + 8) {
        // If no room above, show below
        top = selectionRect.bottom + 8 + window.scrollY;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.display = 'flex';
}

function hideTooltip() {
    if (refineTooltip) {
        refineTooltip.style.display = 'none';
    }
}

// --- Selection Handling ---

/** @type {{ text: string, source: 'title' | 'description' } | null} */
let pendingSelection = null;

/**
 * Handle mouseup/touchend on the title or description elements.
 * Checks for a non-empty text selection and shows the refine tooltip.
 * @param {Event} e
 * @param {'title' | 'description'} source
 */
function handleTextSelection(e, source) {
    // Don't interfere if user is clicking a button or link
    if (e.target.closest('button, a, .refine-tooltip')) return;

    const selection = window.getSelection();
    const selectedText = selection ? selection.toString().trim() : '';

    if (selectedText.length < 3) {
        hideTooltip();
        pendingSelection = null;
        return;
    }

    // Store the selection data
    pendingSelection = { text: selectedText, source };

    // Get the selection's bounding rect
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    showTooltip(rect);
}

/**
 * Get the current user's ID and name for authoring iterations.
 * Returns a consistent identity for both authenticated and unauthenticated users.
 */
function getAuthorInfo() {
    const user = state.session.user;
    if (user && user.isAuthenticated && user.id) {
        return {
            authorId: user.id,
            authorName: user.name || user.email || 'User'
        };
    }
    // Unauthenticated user — use localStorage-based identity
    let anonId = localStorage.getItem('chatUserId');
    if (!anonId) {
        anonId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('chatUserId', anonId);
    }
    const anonName = localStorage.getItem('chatUserName') || 'Anonymous';
    return { authorId: anonId, authorName: anonName };
}

/**
 * Handle click on the "Refine" tooltip button.
 * Calls the AI refinement endpoint and creates/updates the user's iteration.
 * Unauthenticated users can create variations but they're stored in localStorage
 * until login (Decision 4).
 */
async function handleRefineClick(e) {
    e.stopPropagation();

    if (!pendingSelection || !currentRecordId || isRefining) return;

    const { text: highlightedText, source: highlightSource } = pendingSelection;

    // Get current item data from the modal DOM
    const titleEl = document.getElementById('modal-item-name');
    const descEl = document.getElementById('modal-item-description');
    const title = titleEl ? titleEl.textContent : '';
    const description = descEl ? descEl.textContent : '';

    // Get existing iterations for this record
    const existingIterations = state.session.itemIterations.get(currentRecordId);
    const iterationCount = existingIterations ? existingIterations.iterations.length : 0;

    // Get current tags/realm from the latest iteration or from the record
    let currentTags = [];
    let currentRealm = '';
    if (existingIterations && existingIterations.iterations.length > 0) {
        const latest = existingIterations.iterations[existingIterations.iterations.length - 1];
        currentTags = latest.tags || [];
        currentRealm = latest.realm || '';
    }

    // Show loading state
    isRefining = true;
    const tooltipBtn = refineTooltip.querySelector('.refine-tooltip-btn');
    const originalHTML = tooltipBtn.innerHTML;
    tooltipBtn.innerHTML = '<span class="refine-tooltip-icon">⏳</span><span class="refine-tooltip-label">Refining...</span>';
    tooltipBtn.disabled = true;

    try {
        const response = await fetch('/api/refine-item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title,
                description,
                category: '',
                tags: currentTags,
                realm: currentRealm,
                highlightedText,
                highlightSource,
                iterationCount
            })
        });

        if (!response.ok) {
            throw new Error(`Refinement failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success || !data.refinement) {
            throw new Error(data.error || 'Unexpected response format');
        }

        const refinement = data.refinement;
        const { authorId, authorName } = getAuthorInfo();

        // Create iteration entry
        const newIteration = {
            title: refinement.title,
            description: refinement.description,
            imageURL: '', // Will be populated if AI image generation is triggered
            tags: refinement.tags,
            realm: refinement.realm,
            timestamp: refinement.timestamp,
            authorId: authorId,
            authorName: authorName,
            variationName: refinement.variationName || `${authorName}'s Take`,
            refinementNote: refinement.refinementNote,
            maturityDelta: refinement.maturityDelta,
            highlightedText: refinement.highlightedText,
            highlightSource: refinement.highlightSource,
            imagePrompt: refinement.imagePrompt
        };

        // Add/update iteration using user-based deduplication (Decision 2B)
        const resultIndex = upsertIteration(currentRecordId, authorId, newIteration);

        // Clear selection
        window.getSelection().removeAllRanges();
        hideTooltip();
        pendingSelection = null;

        // Update the modal to show the new version
        const iterations = state.session.itemIterations.get(currentRecordId);
        if (iterations) {
            // Navigate to the user's iteration
            iterations.currentIndex = resultIndex;
            syncModalToIteration(currentRecordId, iterations.currentIndex);

            // Dispatch event so the modal can update version UI (selector, thumbnails)
            document.dispatchEvent(new CustomEvent('iterationAdded', {
                detail: {
                    recordId: currentRecordId,
                    iterationIndex: resultIndex,
                    iteration: newIteration,
                    isUpdate: existingIterations ? findUserIterationIndex(existingIterations, authorId) !== -1 : false
                }
            }));
        }

        // If unauthenticated, persist to localStorage for later merge (Decision 4)
        if (!state.session.user.isAuthenticated) {
            saveTempIterations();
        }

        // Trigger vitality recalculation (maturity change)
        requestVitalityRecalc();

        console.log('[RefinementHandler] Refinement complete:', refinement.title, '| Realm:', refinement.realm, '| Tags:', refinement.tags, '| Author:', authorName);

    } catch (err) {
        console.error('[RefinementHandler] Refinement failed:', err);
        // Show error briefly on tooltip
        tooltipBtn.innerHTML = '<span class="refine-tooltip-icon">❌</span><span class="refine-tooltip-label">Failed</span>';
        setTimeout(() => {
            tooltipBtn.innerHTML = originalHTML;
            tooltipBtn.disabled = false;
            hideTooltip();
        }, 2000);
        isRefining = false;
        return;
    }

    // Reset button state
    tooltipBtn.innerHTML = originalHTML;
    tooltipBtn.disabled = false;
    isRefining = false;
}

// --- Iteration Management ---

/**
 * Find the index of a user's existing iteration in the array.
 * @param {Object} record - The iterations record { currentIndex, iterations[] }
 * @param {string} authorId - The user's ID
 * @returns {number} Index of the user's iteration, or -1 if not found
 */
function findUserIterationIndex(record, authorId) {
    for (let i = 0; i < record.iterations.length; i++) {
        if (record.iterations[i].authorId === authorId) {
            return i;
        }
    }
    return -1;
}

/**
 * Upsert (add or update) an iteration for a record using user-based deduplication.
 * Decision 2B: If the user already has an iteration, it's updated in place.
 * Decision 5A: Original is always at index 0 with authorId = "original".
 * @param {string} recordId
 * @param {string} authorId - The user creating/updating the iteration
 * @param {Object} iteration - The iteration data
 * @returns {number} The index of the added/updated iteration
 */
function upsertIteration(recordId, authorId, iteration) {
    let record = state.session.itemIterations.get(recordId);

    if (!record) {
        // First iteration — capture the current state as "Original" (Decision 5A)
        const titleEl = document.getElementById('modal-item-name');
        const descEl = document.getElementById('modal-item-description');
        const mainImage = document.getElementById('modal-main-image');

        record = {
            currentIndex: 0,
            iterations: [{
                title: titleEl ? titleEl.textContent : '',
                description: descEl ? descEl.textContent : '',
                imageURL: mainImage ? (mainImage.style.backgroundImage ? mainImage.style.backgroundImage.replace(/url\(['"]?([^'"]+)['"]?\)/, '$1') : mainImage.src || '') : '',
                tags: [],
                realm: '',
                timestamp: new Date().toISOString(),
                authorId: 'original',
                authorName: 'Original',
                variationName: 'Original',
                refinementNote: 'Original version',
                maturityDelta: 0,
                highlightedText: '',
                highlightSource: ''
            }]
        };
        state.session.itemIterations.set(recordId, record);
    }

    // Check if user already has an iteration (Decision 2B: deduplication)
    const existingIdx = findUserIterationIndex(record, authorId);

    if (existingIdx !== -1) {
        // Update existing iteration in place
        record.iterations[existingIdx] = {
            ...record.iterations[existingIdx],
            ...iteration,
            authorId: authorId // Ensure authorId stays correct
        };
        console.log(`[RefinementHandler] Updated iteration at index ${existingIdx} for user ${authorId} on ${recordId}`);
        return existingIdx;
    } else {
        // Append new iteration
        record.iterations.push(iteration);
        const newIndex = record.iterations.length - 1;
        console.log(`[RefinementHandler] Added new iteration at index ${newIndex} for user ${authorId} on ${recordId}`);
        return newIndex;
    }
}

/**
 * Get all iterations for a record.
 * @param {string} recordId
 * @returns {{ currentIndex: number, iterations: Array } | null}
 */
export function getIterations(recordId) {
    return state.session.itemIterations.get(recordId) || null;
}

/**
 * Get the total maturity score accumulated from all iterations for a record.
 * @param {string} recordId
 * @returns {number} 0.0 to 1.0
 */
export function getMaturityScore(recordId) {
    const record = state.session.itemIterations.get(recordId);
    if (!record || !record.iterations) return 0;

    let maturity = 0;
    for (const iter of record.iterations) {
        maturity += iter.maturityDelta || 0;
    }
    return Math.min(1.0, maturity);
}

/**
 * Update the variation name for a specific iteration (Decision 6: user-editable).
 * @param {string} recordId
 * @param {number} iterationIndex
 * @param {string} newName
 */
export function updateVariationName(recordId, iterationIndex, newName) {
    const record = state.session.itemIterations.get(recordId);
    if (!record || !record.iterations[iterationIndex]) return;

    record.iterations[iterationIndex].variationName = newName;
    console.log(`[RefinementHandler] Updated variation name at index ${iterationIndex}: "${newName}"`);

    // Dispatch event so the modal can update the version selector
    document.dispatchEvent(new CustomEvent('variationNameChanged', {
        detail: { recordId, iterationIndex, newName }
    }));
}

// --- Per-Variation Reaction Keys (Decision 3A: Compound keys) ---

/**
 * Generate a compound key for per-variation reactions.
 * Format: recordId::variationAuthorId (e.g., "rec123::original", "rec123::userId_abc")
 * @param {string} recordId
 * @param {string} variationAuthorId - "original" or user ID
 * @returns {string} Compound key
 */
export function getVariationReactionKey(recordId, variationAuthorId) {
    return `${recordId}::${variationAuthorId || 'original'}`;
}

/**
 * Get the variation author ID for the currently selected iteration.
 * @param {string} recordId
 * @returns {string} The authorId of the current variation ("original" or userId)
 */
export function getCurrentVariationAuthorId(recordId) {
    const record = state.session.itemIterations.get(recordId);
    if (!record || !record.iterations[record.currentIndex]) return 'original';
    return record.iterations[record.currentIndex].authorId || 'original';
}

/**
 * Get aggregate reactions across all variations for an item.
 * Used by presentation view and other components that need item-level reaction summaries.
 * The compound key format is "recordId::variationAuthorId" — this finds all keys
 * starting with the recordId and merges their reaction Maps.
 * @param {string} recordId
 * @returns {Map<userId, emoji>} Aggregated reactions (last-wins if user reacted on multiple variations)
 */
// --- Version Carousel UI ---
// The standalone dot-based version carousel has been replaced by integration
// with the detail modal's image carousel and a version name selector in the
// options area. See modal.js for the meshed version UI.

/**
 * Sync the detail modal's title, description, and metadata to a specific iteration.
 * This is the core of the "Synchronized State" requirement — ensures a 1:1 relationship
 * between the carousel position and the displayed content.
 * @param {string} recordId
 * @param {number} iterationIndex
 */
export function syncModalToIteration(recordId, iterationIndex) {
    const record = state.session.itemIterations.get(recordId);
    if (!record || !record.iterations[iterationIndex]) return;

    const iteration = record.iterations[iterationIndex];

    const titleEl = document.getElementById('modal-item-name');
    const descEl = document.getElementById('modal-item-description');
    const mainImage = document.getElementById('modal-main-image');

    if (titleEl && iteration.title) {
        titleEl.textContent = iteration.title;
    }
    if (descEl && iteration.description) {
        descEl.textContent = iteration.description;
    }
    if (mainImage && iteration.imageURL) {
        mainImage.style.backgroundImage = `url('${iteration.imageURL}')`;
    }

    // Dispatch event for other components to react
    document.dispatchEvent(new CustomEvent('iterationChanged', {
        detail: { recordId, iterationIndex, iteration }
    }));

    console.log(`[RefinementHandler] Synced modal to iteration ${iterationIndex}: "${iteration.title}" by ${iteration.authorName || 'Unknown'}`);
}

/**
 * Generate an AI image for a specific iteration using its imagePrompt or metadata.
 * Calls the generate-ai-image endpoint and stores the resulting URL in the iteration.
 * @param {string} recordId
 * @param {number} iterationIndex
 * @returns {Promise<string>} The generated image URL
 */
export async function generateVersionImage(recordId, iterationIndex) {
    const record = state.session.itemIterations.get(recordId);
    if (!record || !record.iterations[iterationIndex]) {
        throw new Error('Iteration not found');
    }

    const iteration = record.iterations[iterationIndex];

    try {
        const response = await fetch('/.netlify/functions/generate-ai-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: iteration.title || 'Refined Item',
                description: iteration.description || '',
                category: iteration.realm || '',
                tags: (iteration.tags || []).join(', '),
                itemId: `${recordId}-v${iterationIndex}`,
                sessionId: state.session.id || 'refinement',
                customPrompt: iteration.imagePrompt || null
            })
        });

        if (!response.ok) {
            throw new Error(`Image generation failed: ${response.status}`);
        }

        const data = await response.json();
        if (!data.success || !data.imageUrl) {
            throw new Error(data.error || 'No image URL in response');
        }

        // Store the image URL in the iteration
        iteration.imageURL = data.imageUrl;

        // Dispatch event so the modal can update the image carousel
        document.dispatchEvent(new CustomEvent('versionImageGenerated', {
            detail: { recordId, iterationIndex, imageUrl: data.imageUrl }
        }));

        console.log(`[RefinementHandler] Generated image for ${recordId} v${iterationIndex}:`, data.imageUrl);
        return data.imageUrl;
    } catch (err) {
        console.error('[RefinementHandler] Image generation failed:', err);
        throw err;
    }
}

// --- Temporary Storage for Unauthenticated Users (Decision 4) ---

/**
 * Save unauthenticated user's iterations to localStorage for later merge.
 */
function saveTempIterations() {
    try {
        const tempData = {};
        for (const [recordId, iterData] of state.session.itemIterations.entries()) {
            const { authorId } = getAuthorInfo();
            // Only save this user's iterations (not others' data)
            const userIters = iterData.iterations.filter(it => it.authorId === authorId);
            if (userIters.length > 0) {
                tempData[recordId] = userIters;
            }
        }
        localStorage.setItem(TEMP_ITERATIONS_KEY, JSON.stringify(tempData));
        console.log('[RefinementHandler] Saved temp iterations to localStorage');
    } catch (e) {
        console.error('[RefinementHandler] Failed to save temp iterations:', e);
    }
}

/**
 * Save unauthenticated user's reactions to localStorage for later merge.
 * @param {Map} reactions - The full reactions Map
 */
export function saveTempReactions(reactions) {
    try {
        const { authorId } = getAuthorInfo();
        const tempReactions = {};
        for (const [key, userReactionsMap] of reactions.entries()) {
            const userReaction = userReactionsMap.get(authorId);
            if (userReaction) {
                // Multi-emoji model: convert Set to array for JSON storage
                if (userReaction instanceof Set) {
                    tempReactions[key] = Array.from(userReaction);
                } else {
                    tempReactions[key] = [userReaction]; // Legacy string -> array
                }
            }
        }
        localStorage.setItem(TEMP_REACTIONS_KEY, JSON.stringify(tempReactions));
        console.log('[RefinementHandler] Saved temp reactions to localStorage');
    } catch (e) {
        console.error('[RefinementHandler] Failed to save temp reactions:', e);
    }
}

/**
 * Merge temporary iterations and reactions from localStorage into the authenticated user's account.
 * Called after successful login (Decision 4).
 * @param {string} newUserId - The newly authenticated user's ID
 * @param {string} newUserName - The user's display name
 */
export function mergeTempDataOnLogin(newUserId, newUserName) {
    // Merge temp iterations
    try {
        const tempIterStr = localStorage.getItem(TEMP_ITERATIONS_KEY);
        if (tempIterStr) {
            const tempData = JSON.parse(tempIterStr);
            let mergedCount = 0;

            for (const [recordId, userIters] of Object.entries(tempData)) {
                for (const iter of userIters) {
                    // Re-attribute to the newly authenticated user
                    iter.authorId = newUserId;
                    iter.authorName = newUserName;
                    if (iter.variationName && iter.variationName.includes('Anonymous')) {
                        iter.variationName = iter.variationName.replace('Anonymous', newUserName);
                    }
                    upsertIteration(recordId, newUserId, iter);
                    mergedCount++;
                }
            }

            localStorage.removeItem(TEMP_ITERATIONS_KEY);
            console.log(`[RefinementHandler] Merged ${mergedCount} temp iterations for user ${newUserId}`);
        }
    } catch (e) {
        console.error('[RefinementHandler] Failed to merge temp iterations:', e);
        localStorage.removeItem(TEMP_ITERATIONS_KEY);
    }

    // Merge temp reactions
    try {
        const tempReactStr = localStorage.getItem(TEMP_REACTIONS_KEY);
        if (tempReactStr) {
            const tempReactions = JSON.parse(tempReactStr);
            let mergedCount = 0;

            for (const [reactionKey, emojiData] of Object.entries(tempReactions)) {
                if (!state.session.reactions.has(reactionKey)) {
                    state.session.reactions.set(reactionKey, new Map());
                }
                const reactionMap = state.session.reactions.get(reactionKey);
                // Only set if user hasn't already reacted (don't overwrite)
                if (!reactionMap.has(newUserId)) {
                    // Multi-emoji model: convert array to Set
                    const emojiSet = Array.isArray(emojiData) ? new Set(emojiData) : new Set([emojiData]);
                    reactionMap.set(newUserId, emojiSet);
                    mergedCount++;
                }
            }

            localStorage.removeItem(TEMP_REACTIONS_KEY);
            console.log(`[RefinementHandler] Merged ${mergedCount} temp reactions for user ${newUserId}`);
        }
    } catch (e) {
        console.error('[RefinementHandler] Failed to merge temp reactions:', e);
        localStorage.removeItem(TEMP_REACTIONS_KEY);
    }
}

/**
 * Load temporary iterations from localStorage into state (for unauthenticated users
 * who return to the page). This preserves their work across page refreshes.
 */
export function loadTempIterations() {
    try {
        const tempIterStr = localStorage.getItem(TEMP_ITERATIONS_KEY);
        if (!tempIterStr) return;

        const tempData = JSON.parse(tempIterStr);
        for (const [recordId, userIters] of Object.entries(tempData)) {
            for (const iter of userIters) {
                upsertIteration(recordId, iter.authorId, iter);
            }
        }
        console.log('[RefinementHandler] Loaded temp iterations from localStorage');
    } catch (e) {
        console.error('[RefinementHandler] Failed to load temp iterations:', e);
    }
}

/**
 * Load temporary reactions from localStorage into state.
 */
export function loadTempReactions() {
    try {
        const tempReactStr = localStorage.getItem(TEMP_REACTIONS_KEY);
        if (!tempReactStr) return;

        const tempReactions = JSON.parse(tempReactStr);
        for (const [reactionKey, emoji] of Object.entries(tempReactions)) {
            if (!state.session.reactions.has(reactionKey)) {
                state.session.reactions.set(reactionKey, new Map());
            }
            const { authorId } = getAuthorInfo();
            state.session.reactions.get(reactionKey).set(authorId, emoji);
        }
        console.log('[RefinementHandler] Loaded temp reactions from localStorage');
    } catch (e) {
        console.error('[RefinementHandler] Failed to load temp reactions:', e);
    }
}

// --- Serialization helpers for persistence (Decision 1C) ---

/**
 * Serialize iterations for a specific record for Airtable persistence (item-level).
 * @param {string} recordId
 * @returns {Object|null} Serializable iteration data
 */
export function serializeIterations(recordId) {
    const record = state.session.itemIterations.get(recordId);
    if (!record) return null;
    return {
        iterations: record.iterations.map(iter => ({
            title: iter.title,
            description: iter.description,
            imageURL: iter.imageURL || '',
            tags: iter.tags || [],
            realm: iter.realm || '',
            timestamp: iter.timestamp,
            authorId: iter.authorId,
            authorName: iter.authorName,
            variationName: iter.variationName || '',
            refinementNote: iter.refinementNote || '',
            maturityDelta: iter.maturityDelta || 0,
            highlightedText: iter.highlightedText || '',
            highlightSource: iter.highlightSource || '',
            imagePrompt: iter.imagePrompt || ''
        }))
    };
}

/**
 * Deserialize and load iterations from Airtable data into state.
 * @param {string} recordId
 * @param {Object} data - Serialized iteration data from Airtable
 * @param {number} [activeIndex=0] - The session-level active index (Decision 1C: hybrid)
 */
export function deserializeIterations(recordId, data, activeIndex = 0) {
    if (!data || !Array.isArray(data.iterations) || data.iterations.length === 0) return;

    const record = {
        currentIndex: Math.min(activeIndex, data.iterations.length - 1),
        iterations: data.iterations.map(iter => ({
            title: iter.title || '',
            description: iter.description || '',
            imageURL: iter.imageURL || '',
            tags: iter.tags || [],
            realm: iter.realm || '',
            timestamp: iter.timestamp || new Date().toISOString(),
            authorId: iter.authorId || 'original',
            authorName: iter.authorName || 'Unknown',
            variationName: iter.variationName || '',
            refinementNote: iter.refinementNote || '',
            maturityDelta: iter.maturityDelta || 0,
            highlightedText: iter.highlightedText || '',
            highlightSource: iter.highlightSource || '',
            imagePrompt: iter.imagePrompt || ''
        }))
    };

    state.session.itemIterations.set(recordId, record);
    console.log(`[RefinementHandler] Deserialized ${record.iterations.length} iterations for ${recordId}`);
}

// --- Initialization & Cleanup ---

/** Track if listeners are bound to avoid duplicates */
let listenersActive = false;

/**
 * Initialize the refinement handler for the detail modal.
 * Call this when the detail modal opens for a record.
 * @param {string} recordId - The record being displayed
 */
export function initRefinementHandler(recordId) {
    currentRecordId = recordId;

    const titleEl = document.getElementById('modal-item-name');
    const descEl = document.getElementById('modal-item-description');

    if (!titleEl || !descEl) {
        console.warn('[RefinementHandler] Modal title/description elements not found');
        return;
    }

    // Make title and description selectable
    titleEl.style.userSelect = 'text';
    titleEl.style.webkitUserSelect = 'text';
    descEl.style.userSelect = 'text';
    descEl.style.webkitUserSelect = 'text';

    // Bind selection listeners
    if (!listenersActive) {
        titleEl.addEventListener('mouseup', (e) => handleTextSelection(e, 'title'));
        descEl.addEventListener('mouseup', (e) => handleTextSelection(e, 'description'));

        // Touch support
        titleEl.addEventListener('touchend', (e) => {
            // Small delay to let the selection finalize on touch
            setTimeout(() => handleTextSelection(e, 'title'), 100);
        });
        descEl.addEventListener('touchend', (e) => {
            setTimeout(() => handleTextSelection(e, 'description'), 100);
        });

        // Hide tooltip when clicking elsewhere
        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.refine-tooltip') && !e.target.closest('#modal-item-name') && !e.target.closest('#modal-item-description')) {
                hideTooltip();
                pendingSelection = null;
            }
        });

        listenersActive = true;
    }

    // Version UI is now handled by modal.js (image carousel mesh + version selector)

    console.log('[RefinementHandler] Initialized for record:', recordId);
}

/**
 * Clean up the refinement handler when the modal closes.
 */
export function cleanupRefinementHandler() {
    hideTooltip();
    pendingSelection = null;
    currentRecordId = null;
    isRefining = false;
}
