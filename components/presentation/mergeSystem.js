/**
 * Merge System
 * Manages the entire merge system: merge mode UI, targeting, merge operations
 * (hybrid + options), combined items management, related groups management,
 * collage creation, and merge dialog.
 * Extracted from presentation.js — modularization.
 */

// Dependencies injected via init()
let deps = {};

// Merge mode state
let isMergeModeActive = false;
let mergeModeSourceRecordId = null;
let mergeModeOverlay = null;
let mergeModeBanner = null;
let mergeSelectFab = null;
let mergeSelectedItems = [];
let mergeOptionsDialog = null;
let mergeDialogSourceName = null;
let mergeDialogTargetName = null;
let pendingMergeSource = null;
let pendingMergeTarget = null;
let pendingMergeEstimation = null;
let pendingMergeAllItems = null;

/**
 * Initialize the merge system module.
 * @param {Object} d - All required dependencies
 */
export function init(d) {
    deps = d;

    // Cache DOM element references from deps.elements
    if (deps.elements) {
        mergeModeOverlay = deps.elements.mergeModeOverlay || null;
        mergeModeBanner = deps.elements.mergeModeBanner || null;
        mergeSelectFab = deps.elements.mergeSelectFab || null;
        mergeOptionsDialog = deps.elements.mergeOptionsDialog || null;
        mergeDialogSourceName = deps.elements.mergeDialogSourceName || null;
        mergeDialogTargetName = deps.elements.mergeDialogTargetName || null;
    }

    // Register global debug helper
    if (typeof window !== 'undefined') {
        window.debugMergeMode = function() {
            console.log('═══════════════════════════════════════════');
            console.log('  MERGE MODE DIAGNOSTIC REPORT');
            console.log('═══════════════════════════════════════════');
            console.log('isMergeModeActive:', isMergeModeActive);
            console.log('mergeModeSourceRecordId:', mergeModeSourceRecordId);
            console.log('mergeSelectedItems:', JSON.stringify(mergeSelectedItems));

            console.log('\n--- Cached DOM References ---');
            console.log('mergeModeOverlay:', mergeModeOverlay ? 'EXISTS (in DOM: ' + document.body.contains(mergeModeOverlay) + ')' : '❌ NULL');
            console.log('mergeModeBanner:', mergeModeBanner ? 'EXISTS (in DOM: ' + document.body.contains(mergeModeBanner) + ')' : '❌ NULL');
            console.log('mergeSelectFab:', mergeSelectFab ? 'EXISTS (in DOM: ' + document.body.contains(mergeSelectFab) + ')' : '❌ NULL');
            console.log('mergeOptionsDialog:', typeof mergeOptionsDialog !== 'undefined' && mergeOptionsDialog ? 'EXISTS' : '❌ NULL');

            console.log('\n--- Live DOM Queries ---');
            const ids = ['merge-mode-overlay', 'merge-mode-banner', 'merge-select-fab', 'merge-options-dialog', 'merge-mode-cancel-btn', 'merge-mode-banner-label', 'merge-mode-source-name', 'merge-select-fab-count', 'itinerary-items-list'];
            ids.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const cs = window.getComputedStyle(el);
                    console.log(`  #${id}: ✅ FOUND | display:${cs.display} | visibility:${cs.visibility} | opacity:${cs.opacity} | zIndex:${cs.zIndex} | position:${cs.position} | classes:${el.className.toString().substring(0, 60)}`);
                    if (id === 'merge-mode-overlay' || id === 'merge-mode-banner' || id === 'merge-select-fab') {
                        console.log(`    rect:`, JSON.stringify(el.getBoundingClientRect()));
                        // Check parent chain
                        let parent = el.parentElement;
                        let depth = 0;
                        while (parent && depth < 8) {
                            const pcs = window.getComputedStyle(parent);
                            const hidden = pcs.display === 'none' || pcs.visibility === 'hidden' || parseFloat(pcs.opacity) === 0;
                            if (hidden) {
                                console.log(`    ⚠️ HIDDEN PARENT (depth ${depth}): ${parent.tagName}#${parent.id} display:${pcs.display} visibility:${pcs.visibility} opacity:${pcs.opacity}`);
                            }
                            parent = parent.parentElement;
                            depth++;
                        }
                    }
                } else {
                    console.log(`  #${id}: ❌ NOT IN DOM`);
                }
            });

            console.log('\n--- Merge CSS Check ---');
            const testOverlay = document.createElement('div');
            testOverlay.className = 'merge-mode-overlay active';
            testOverlay.style.display = 'none';
            document.body.appendChild(testOverlay);
            const testCS = window.getComputedStyle(testOverlay);
            console.log('CSS probe (.merge-mode-overlay.active): position:', testCS.position, '(expect fixed) zIndex:', testCS.zIndex, '(expect ~8999)');
            testOverlay.remove();

            const testBanner = document.createElement('div');
            testBanner.className = 'merge-mode-banner active';
            testBanner.style.display = 'none';
            document.body.appendChild(testBanner);
            const testBCS = window.getComputedStyle(testBanner);
            console.log('CSS probe (.merge-mode-banner.active): position:', testBCS.position, '(expect fixed) zIndex:', testBCS.zIndex, '(expect ~9100) transform:', testBCS.transform);
            testBanner.remove();

            // Check the presentation view state
            const presOverlay = document.getElementById('presentation-modal-overlay');
            if (presOverlay) {
                const cs = window.getComputedStyle(presOverlay);
                console.log('\n--- Presentation View Container ---');
                console.log('  #presentation-modal-overlay: display:', cs.display, 'visibility:', cs.visibility, 'opacity:', cs.opacity, 'position:', cs.position, 'overflow:', cs.overflow);
            }

            console.log('═══════════════════════════════════════════');
            return 'Merge diagnostic report complete. Check console above.';
        };
        console.log('[MERGE DEBUG] ✅ window.debugMergeMode() helper registered - call from browser console for diagnostics');
    }
}

/**
 * Cleanup the module (exits merge mode).
 */
export function cleanup() {
    exitMergeMode();
    deps = {};
    mergeModeOverlay = null;
    mergeModeBanner = null;
    mergeSelectFab = null;
    mergeOptionsDialog = null;
    mergeDialogSourceName = null;
    mergeDialogTargetName = null;
}

/**
 * Getter for isMergeModeActive state.
 */
export function getIsMergeModeActive() {
    return isMergeModeActive;
}

// =============================================================================
// GROUP 1 - Combined Sources UI Toggles
// =============================================================================

export function initializeCombinedSourcesToggles() {
    const itineraryItemsListEl = deps.getItineraryItemsListEl();
    if (!itineraryItemsListEl) return;

    // Combined sources expand/collapse toggles
    const toggles = itineraryItemsListEl.querySelectorAll('.combined-sources-toggle');
    toggles.forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const recordId = toggle.dataset.recordId;
            const sourcesList = itineraryItemsListEl.querySelector(`.combined-sources-list[data-record-id="${recordId}"]`);
            const arrow = toggle.querySelector('.toggle-arrow');

            if (sourcesList) {
                const isHidden = sourcesList.style.display === 'none';
                sourcesList.style.display = isHidden ? 'block' : 'none';
                if (arrow) {
                    arrow.textContent = isHidden ? '▲' : '▼';
                }
            }
        });
    });

    // Uncombine individual source buttons
    const uncombineSourceBtns = itineraryItemsListEl.querySelectorAll('.uncombine-source-btn');
    uncombineSourceBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const sourceId = btn.dataset.sourceId;
            const targetId = btn.dataset.targetId;
            if (sourceId && targetId) {
                uncombineSource(sourceId, targetId);
            }
        });
    });

    // Uncombine all (split all) buttons
    const uncombineAllBtns = itineraryItemsListEl.querySelectorAll('.uncombine-all-btn');
    uncombineAllBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const targetId = btn.dataset.targetId;
            if (targetId) {
                uncombineAll(targetId);
            }
        });
    });

    // Leave group buttons
    const leaveGroupBtns = itineraryItemsListEl.querySelectorAll('.leave-group-btn');
    leaveGroupBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const recordId = btn.dataset.recordId;
            const groupId = btn.dataset.groupId;
            if (recordId && groupId) {
                removeFromGroup(recordId, groupId);
            }
        });
    });

    // Options group members toggle (expand/collapse member list)
    const groupMembersToggles = itineraryItemsListEl.querySelectorAll('.options-group-members-toggle');
    groupMembersToggles.forEach(toggle => {
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupId = toggle.dataset.groupId;
            const membersList = itineraryItemsListEl.querySelector(`.options-group-members-list[data-group-id="${groupId}"]`);
            const arrow = toggle.querySelector('.toggle-arrow');
            if (membersList) {
                const isHidden = membersList.style.display === 'none';
                membersList.style.display = isHidden ? 'block' : 'none';
                if (arrow) {
                    arrow.textContent = isHidden ? '▲' : '▼';
                }
            }
        });
    });

    // Dissolve group buttons (in group headers)
    const dissolveBtns = itineraryItemsListEl.querySelectorAll('.options-group-dissolve-btn');
    dissolveBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupId = btn.dataset.groupId;
            if (groupId) {
                dissolveGroup(groupId);
            }
        });
    });

    // Options group card - "View Options" button click
    const groupExpandBtns = itineraryItemsListEl.querySelectorAll('.options-group-expand-btn');
    groupExpandBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const groupId = btn.dataset.groupId;
            if (groupId) {
                openGroupDetailModal(groupId);
            }
        });
    });

    // Options group card - content area click (open detail modal)
    const groupCardContents = itineraryItemsListEl.querySelectorAll('.options-group-card-content');
    groupCardContents.forEach(el => {
        el.addEventListener('click', (e) => {
            // Don't open modal when clicking on interactive elements inside the card
            if (e.target.closest('.options-group-expand-btn') ||
                e.target.closest('.options-group-members-section') ||
                e.target.closest('.options-group-dissolve-btn') ||
                e.target.closest('.leave-group-btn')) return;
            e.stopPropagation();
            const groupId = el.dataset.groupId;
            if (groupId) {
                openGroupDetailModal(groupId);
            }
        });
    });
}

// =============================================================================
// GROUP 2 - Merge Mode
// =============================================================================

export function enterMergeMode(sourceRecordId) {
    const state = deps.getState();
    console.log('[MERGE DEBUG] ══════════════════════════════════════════════');
    console.log('[MERGE DEBUG] enterMergeMode() CALLED');
    console.log('[MERGE DEBUG]   sourceRecordId:', sourceRecordId);
    console.log('[MERGE DEBUG]   isMergeModeActive (before):', isMergeModeActive);

    if (!sourceRecordId || isMergeModeActive) {
        console.log('[MERGE DEBUG]   ❌ EARLY RETURN: sourceRecordId falsy?', !sourceRecordId, '| isMergeModeActive?', isMergeModeActive);
        return;
    }

    // Determine display name - could be a group or individual item
    let sourceName = 'Item';
    if (sourceRecordId.startsWith('group-')) {
        const group = state.session.relatedGroups?.find(g => g.id === sourceRecordId);
        sourceName = group?.name || 'Group';
    } else {
        const sourceRecord = deps.getRecordById(sourceRecordId);
        sourceName = sourceRecord?.fields?.Name || 'Item';
    }
    console.log('[MERGE DEBUG]   sourceName resolved to:', sourceName);

    isMergeModeActive = true;
    mergeModeSourceRecordId = sourceRecordId;

    // Initialize multi-select with the source item pre-selected
    mergeSelectedItems = [sourceRecordId];

    deps.log('Presentation', `Entering multi-select merge mode for: ${sourceName} (${sourceRecordId})`);

    // ── DEBUG: Check cached DOM references ──
    console.log('[MERGE DEBUG]   ── DOM Element References ──');
    console.log('[MERGE DEBUG]   mergeModeOverlay (cached):', mergeModeOverlay ? 'EXISTS' : '❌ NULL');
    console.log('[MERGE DEBUG]   mergeModeBanner (cached):', mergeModeBanner ? 'EXISTS' : '❌ NULL');
    console.log('[MERGE DEBUG]   mergeSelectFab (cached):', mergeSelectFab ? 'EXISTS' : '❌ NULL');

    // ── DEBUG: Try re-querying from DOM in case cached references are stale ──
    const freshOverlay = document.getElementById('merge-mode-overlay');
    const freshBanner = document.getElementById('merge-mode-banner');
    const freshFab = document.getElementById('merge-select-fab');
    console.log('[MERGE DEBUG]   freshOverlay (live DOM query):', freshOverlay ? 'FOUND' : '❌ NOT IN DOM');
    console.log('[MERGE DEBUG]   freshBanner (live DOM query):', freshBanner ? 'FOUND' : '❌ NOT IN DOM');
    console.log('[MERGE DEBUG]   freshFab (live DOM query):', freshFab ? 'FOUND' : '❌ NOT IN DOM');

    // If cached refs are stale but DOM has them, refresh the references
    if (!mergeModeOverlay && freshOverlay) {
        console.log('[MERGE DEBUG]   ⚠️ STALE REF: Refreshing mergeModeOverlay from DOM');
        mergeModeOverlay = freshOverlay;
    }
    if (!mergeModeBanner && freshBanner) {
        console.log('[MERGE DEBUG]   ⚠️ STALE REF: Refreshing mergeModeBanner from DOM');
        mergeModeBanner = freshBanner;
    }
    if (!mergeSelectFab && freshFab) {
        console.log('[MERGE DEBUG]   ⚠️ STALE REF: Refreshing mergeSelectFab from DOM');
        mergeSelectFab = freshFab;
    }

    // Show overlay
    if (mergeModeOverlay) {
        console.log('[MERGE DEBUG]   Setting overlay display=block, then adding .active');
        console.log('[MERGE DEBUG]   overlay current display:', mergeModeOverlay.style.display);
        console.log('[MERGE DEBUG]   overlay current classes:', mergeModeOverlay.className);
        console.log('[MERGE DEBUG]   overlay in DOM tree:', document.body.contains(mergeModeOverlay));
        mergeModeOverlay.style.display = 'block';
        requestAnimationFrame(() => {
            mergeModeOverlay.classList.add('active');
            const cs = window.getComputedStyle(mergeModeOverlay);
            console.log('[MERGE DEBUG]   overlay POST-ACTIVE: display:', cs.display, 'opacity:', cs.opacity, 'position:', cs.position, 'zIndex:', cs.zIndex, 'pointerEvents:', cs.pointerEvents);
            console.log('[MERGE DEBUG]   overlay boundingRect:', JSON.stringify(mergeModeOverlay.getBoundingClientRect()));
        });
    } else {
        console.log('[MERGE DEBUG]   ❌ NO mergeModeOverlay - overlay will NOT be shown!');
    }

    // Show banner - update text for multi-select mode
    const bannerLabel = document.getElementById('merge-mode-banner-label');
    if (bannerLabel) bannerLabel.textContent = 'Tap items to select for merge';
    else console.log('[MERGE DEBUG]   ❌ merge-mode-banner-label NOT FOUND in DOM');

    const sourceNameEl = document.getElementById('merge-mode-source-name');
    if (sourceNameEl) sourceNameEl.textContent = `(${sourceName} selected)`;
    else console.log('[MERGE DEBUG]   ❌ merge-mode-source-name NOT FOUND in DOM');

    if (mergeModeBanner) {
        console.log('[MERGE DEBUG]   Setting banner active');
        console.log('[MERGE DEBUG]   banner in DOM tree:', document.body.contains(mergeModeBanner));
        console.log('[MERGE DEBUG]   banner current classes:', mergeModeBanner.className);
        requestAnimationFrame(() => {
            mergeModeBanner.classList.add('active');
            const cs = window.getComputedStyle(mergeModeBanner);
            console.log('[MERGE DEBUG]   banner POST-ACTIVE: display:', cs.display, 'transform:', cs.transform, 'zIndex:', cs.zIndex, 'position:', cs.position);
            console.log('[MERGE DEBUG]   banner boundingRect:', JSON.stringify(mergeModeBanner.getBoundingClientRect()));
        });
    } else {
        console.log('[MERGE DEBUG]   ❌ NO mergeModeBanner - banner will NOT be shown!');
    }

    // Add merge-mode-active class to the items list container
    const itineraryList = document.getElementById('itinerary-items-list');
    console.log('[MERGE DEBUG]   itinerary-items-list:', itineraryList ? 'FOUND' : '❌ NOT FOUND');
    if (itineraryList) {
        itineraryList.classList.add('merge-mode-active');
        console.log('[MERGE DEBUG]   ✅ Added merge-mode-active class to itinerary list');
        console.log('[MERGE DEBUG]   itinerary list children count:', itineraryList.children.length);
    }

    // Mark the source item as selected (not dimmed - it's part of the selection)
    addMergeSelectCheckmarks();
    markItemAsSelected(sourceRecordId, true);

    // Overlay uses pointer-events: none so clicks pass through to items below.
    // Cancel is handled via the banner cancel button.

    // Set up cancel button
    const cancelBtn = document.getElementById('merge-mode-cancel-btn');
    if (cancelBtn) {
        cancelBtn.onclick = exitMergeMode;
        console.log('[MERGE DEBUG]   ✅ Cancel button click handler set');
    } else {
        console.log('[MERGE DEBUG]   ❌ merge-mode-cancel-btn NOT FOUND');
    }

    // Set up FAB click handler
    if (mergeSelectFab) {
        mergeSelectFab.onclick = () => {
            console.log('[MERGE DEBUG] FAB clicked, mergeSelectedItems.length:', mergeSelectedItems.length);
            if (mergeSelectedItems.length >= 2) {
                openMergeDialogMulti(mergeSelectedItems);
            }
        };
        console.log('[MERGE DEBUG]   ✅ FAB click handler set');
    } else {
        console.log('[MERGE DEBUG]   ❌ NO mergeSelectFab - FAB will NOT be available!');
    }

    // Set up click handlers for multi-select on target items
    if (itineraryList) {
        itineraryList._mergeModeClickHandler = (e) => {
            if (!isMergeModeActive) return;

            // Find the clicked item section
            const clickedSection = e.target.closest('.itinerary-item-section');
            const clickedCard = e.target.closest('.compact-card');
            let targetRecordId = null;

            if (clickedSection) {
                const article = clickedSection.querySelector('.itinerary-item');
                targetRecordId = article?.dataset.recordId;
            } else if (clickedCard) {
                targetRecordId = clickedCard.dataset.recordId || clickedCard.dataset.groupId;
            }

            console.log('[MERGE DEBUG] Item click in merge mode - targetRecordId:', targetRecordId, 'clickedSection:', !!clickedSection, 'clickedCard:', !!clickedCard);

            if (targetRecordId) {
                e.preventDefault();
                e.stopPropagation();
                toggleMergeSelection(targetRecordId);
            }
        };
        itineraryList.addEventListener('click', itineraryList._mergeModeClickHandler, true);
        console.log('[MERGE DEBUG]   ✅ Click handler for item selection attached to itinerary list');
    }

    updateMergeSelectFab();
    deps.showToast(`Select items to merge (${sourceName} already selected)`, 'info');

    // ── Final diagnostic check after a brief delay ──
    setTimeout(() => {
        console.log('[MERGE DEBUG]   ── POST-ENTER DIAGNOSTIC (200ms delay) ──');
        console.log('[MERGE DEBUG]   isMergeModeActive:', isMergeModeActive);
        console.log('[MERGE DEBUG]   mergeSelectedItems:', JSON.stringify(mergeSelectedItems));
        const oEl = document.getElementById('merge-mode-overlay');
        const bEl = document.getElementById('merge-mode-banner');
        const fEl = document.getElementById('merge-select-fab');
        if (oEl) {
            const cs = window.getComputedStyle(oEl);
            console.log('[MERGE DEBUG]   overlay: display=' + cs.display + ' opacity=' + cs.opacity + ' zIndex=' + cs.zIndex + ' position=' + cs.position + ' classes=' + oEl.className);
        } else {
            console.log('[MERGE DEBUG]   ❌ overlay not in DOM');
        }
        if (bEl) {
            const cs = window.getComputedStyle(bEl);
            console.log('[MERGE DEBUG]   banner: display=' + cs.display + ' transform=' + cs.transform + ' zIndex=' + cs.zIndex + ' classes=' + bEl.className);
            console.log('[MERGE DEBUG]   banner rect:', JSON.stringify(bEl.getBoundingClientRect()));
        } else {
            console.log('[MERGE DEBUG]   ❌ banner not in DOM');
        }
        if (fEl) {
            const cs = window.getComputedStyle(fEl);
            console.log('[MERGE DEBUG]   fab: display=' + cs.display + ' zIndex=' + cs.zIndex + ' classes=' + fEl.className);
        } else {
            console.log('[MERGE DEBUG]   ❌ fab not in DOM');
        }
        // Check for z-index conflicts
        const allHighZ = [];
        document.querySelectorAll('*').forEach(el => {
            const z = parseInt(window.getComputedStyle(el).zIndex);
            if (z >= 9000) {
                allHighZ.push({ tag: el.tagName, id: el.id, className: (el.className || '').toString().substring(0, 40), zIndex: z });
            }
        });
        console.log('[MERGE DEBUG]   Elements with z-index >= 9000:', allHighZ.length);
        allHighZ.forEach(item => console.log('[MERGE DEBUG]     z=' + item.zIndex + ' ' + item.tag + '#' + item.id + '.' + item.className));

        // Check parent visibility chain for overlay
        if (oEl) {
            let parent = oEl.parentElement;
            let depth = 0;
            while (parent && depth < 10) {
                const pcs = window.getComputedStyle(parent);
                const hidden = pcs.display === 'none' || pcs.visibility === 'hidden' || parseFloat(pcs.opacity) === 0;
                if (hidden) {
                    console.log('[MERGE DEBUG]   ⚠️ HIDDEN PARENT at depth ' + depth + ': ' + parent.tagName + '#' + parent.id + ' display=' + pcs.display + ' visibility=' + pcs.visibility + ' opacity=' + pcs.opacity);
                }
                parent = parent.parentElement;
                depth++;
            }
        }
        console.log('[MERGE DEBUG] ══════════════════════════════════════════════');
    }, 200);
}

export function exitMergeMode() {
    console.log('[MERGE DEBUG] exitMergeMode() called, isMergeModeActive:', isMergeModeActive);
    if (!isMergeModeActive) {
        console.log('[MERGE DEBUG]   Not active, returning early');
        return;
    }

    isMergeModeActive = false;
    mergeModeSourceRecordId = null;
    mergeSelectedItems = [];

    deps.log('Presentation', 'Exiting merge mode');
    console.log('[MERGE DEBUG]   Cleaning up merge mode UI...');

    // Hide overlay
    if (mergeModeOverlay) {
        mergeModeOverlay.classList.remove('active');
        setTimeout(() => {
            if (mergeModeOverlay) mergeModeOverlay.style.display = 'none';
        }, 300);
    }

    // Hide banner
    if (mergeModeBanner) {
        mergeModeBanner.classList.remove('active');
    }

    // Hide FAB
    if (mergeSelectFab) {
        mergeSelectFab.classList.remove('active');
        setTimeout(() => {
            if (mergeSelectFab) mergeSelectFab.style.display = 'none';
        }, 300);
        mergeSelectFab.onclick = null;
    }

    // Remove merge-mode-active from items list
    const itineraryList = document.getElementById('itinerary-items-list');
    if (itineraryList) {
        itineraryList.classList.remove('merge-mode-active');
        // Remove click handler
        if (itineraryList._mergeModeClickHandler) {
            itineraryList.removeEventListener('click', itineraryList._mergeModeClickHandler, true);
            delete itineraryList._mergeModeClickHandler;
        }
    }

    // Remove all selection markers and checkmarks
    const selectedMarkers = document.querySelectorAll('.merge-mode-selected, .merge-mode-selected-card, .merge-mode-source, .merge-mode-source-card');
    selectedMarkers.forEach(el => {
        el.classList.remove('merge-mode-selected', 'merge-mode-selected-card', 'merge-mode-source', 'merge-mode-source-card');
    });

    // Remove all checkmark indicators
    const checkmarks = document.querySelectorAll('.merge-select-check');
    checkmarks.forEach(el => el.remove());
    console.log('[MERGE DEBUG]   ✅ exitMergeMode complete');
}

// =============================================================================
// GROUP 3 - Multi-Select Merge Helpers
// =============================================================================

// Toggle an item's selection state in multi-select merge mode
function toggleMergeSelection(recordId) {
    console.log('[MERGE DEBUG] toggleMergeSelection called - recordId:', recordId, 'isMergeModeActive:', isMergeModeActive);
    if (!isMergeModeActive || !recordId) return;

    const index = mergeSelectedItems.indexOf(recordId);
    console.log('[MERGE DEBUG]   index in mergeSelectedItems:', index, 'total selected:', mergeSelectedItems.length);
    if (index >= 0) {
        // Deselect - but don't allow deselecting if it would leave < 1 item
        if (mergeSelectedItems.length <= 1) {
            console.log('[MERGE DEBUG]   Cannot deselect, only 1 item remaining');
            return;
        }
        mergeSelectedItems.splice(index, 1);
        markItemAsSelected(recordId, false);
        console.log('[MERGE DEBUG]   Deselected. Now selected:', JSON.stringify(mergeSelectedItems));
    } else {
        // Select
        mergeSelectedItems.push(recordId);
        markItemAsSelected(recordId, true);
        console.log('[MERGE DEBUG]   Selected. Now selected:', JSON.stringify(mergeSelectedItems));
    }

    updateMergeSelectFab();
    updateMergeModeBannerCount();
}

// Mark/unmark an item visually as selected
function markItemAsSelected(recordId, selected) {
    console.log('[MERGE DEBUG] markItemAsSelected - recordId:', recordId, 'selected:', selected);
    // List view: find the itinerary-item-section containing this record
    const article = document.querySelector(`.itinerary-item[data-record-id="${recordId}"]`);
    console.log('[MERGE DEBUG]   article found:', !!article);
    if (article) {
        const section = article.closest('.itinerary-item-section');
        if (section) {
            if (selected) {
                section.classList.add('merge-mode-selected');
            } else {
                section.classList.remove('merge-mode-selected');
            }
            console.log('[MERGE DEBUG]   section classes:', section.className.substring(0, 80));
        }
    }

    // Board view: find compact card
    const card = document.querySelector(`.compact-card[data-record-id="${recordId}"]`) ||
                 document.querySelector(`.compact-card-group[data-group-id="${recordId}"]`);
    console.log('[MERGE DEBUG]   card found:', !!card);
    if (card) {
        if (selected) {
            card.classList.add('merge-mode-selected-card');
        } else {
            card.classList.remove('merge-mode-selected-card');
        }
    }
}

// Add selection checkmark indicators to all items (called when entering merge mode)
function addMergeSelectCheckmarks() {
    console.log('[MERGE DEBUG] addMergeSelectCheckmarks() called');
    // List view items
    const itemSections = document.querySelectorAll('.itinerary-item-section');
    console.log('[MERGE DEBUG]   Found', itemSections.length, 'itinerary-item-section elements');
    itemSections.forEach((section) => {
        if (!section.querySelector('.merge-select-check')) {
            const itemEl = section.querySelector('.itinerary-item');
            if (itemEl) {
                section.style.position = 'relative';
                const check = document.createElement('div');
                check.className = 'merge-select-check';
                section.appendChild(check);
            }
        }
    });

    // Board view compact cards
    const cards = document.querySelectorAll('.compact-card');
    console.log('[MERGE DEBUG]   Found', cards.length, 'compact-card elements');
    cards.forEach(card => {
        if (!card.querySelector('.merge-select-check')) {
            card.style.position = 'relative';
            const check = document.createElement('div');
            check.className = 'merge-select-check';
            card.appendChild(check);
        }
    });
    console.log('[MERGE DEBUG]   Checkmarks added');
}

// Update the floating action button state and count
function updateMergeSelectFab() {
    console.log('[MERGE DEBUG] updateMergeSelectFab() called, mergeSelectFab:', mergeSelectFab ? 'EXISTS' : '❌ NULL');
    if (!mergeSelectFab) {
        console.log('[MERGE DEBUG]   ❌ No mergeSelectFab reference, cannot update FAB');
        // Try to re-query from DOM
        const freshFab = document.getElementById('merge-select-fab');
        if (freshFab) {
            console.log('[MERGE DEBUG]   ⚠️ Found FAB in DOM via fresh query, updating reference');
            mergeSelectFab = freshFab;
        } else {
            console.log('[MERGE DEBUG]   ❌ FAB not found in DOM either');
            return;
        }
    }

    const count = mergeSelectedItems.length;
    console.log('[MERGE DEBUG]   Selected items count:', count);
    const countEl = document.getElementById('merge-select-fab-count');
    if (countEl) countEl.textContent = count;

    // Update FAB text
    const textEl = mergeSelectFab.querySelector('.merge-select-fab-text');
    if (textEl) {
        textEl.innerHTML = `Merge <span id="merge-select-fab-count">${count}</span> items`;
    }

    if (count >= 2) {
        console.log('[MERGE DEBUG]   ✅ Showing FAB (count >= 2)');
        mergeSelectFab.style.display = 'block';
        requestAnimationFrame(() => {
            mergeSelectFab.classList.add('active');
            const cs = window.getComputedStyle(mergeSelectFab);
            console.log('[MERGE DEBUG]   FAB POST-ACTIVE: display:', cs.display, 'zIndex:', cs.zIndex, 'classes:', mergeSelectFab.className);
        });
    } else {
        console.log('[MERGE DEBUG]   Hiding FAB (count < 2)');
        mergeSelectFab.classList.remove('active');
        setTimeout(() => {
            if (mergeSelectFab && mergeSelectedItems.length < 2) {
                mergeSelectFab.style.display = 'none';
            }
        }, 300);
    }
}

// Update the banner text to show selection count
function updateMergeModeBannerCount() {
    const bannerLabel = document.getElementById('merge-mode-banner-label');
    const sourceNameEl = document.getElementById('merge-mode-source-name');
    if (!bannerLabel) return;

    const count = mergeSelectedItems.length;
    if (count === 0) {
        bannerLabel.textContent = 'Tap items to select for merge';
        if (sourceNameEl) sourceNameEl.textContent = '';
    } else if (count === 1) {
        bannerLabel.textContent = 'Tap items to select for merge';
        const name = getItemDisplayName(mergeSelectedItems[0]);
        if (sourceNameEl) sourceNameEl.textContent = `(${name} selected)`;
    } else {
        bannerLabel.textContent = `${count} items selected`;
        if (sourceNameEl) sourceNameEl.textContent = '- tap more or merge';
    }
}

// Get a display name for a record or group ID
export function getItemDisplayName(recordId) {
    if (!recordId) return 'Item';
    if (recordId.startsWith('group-')) {
        const state = deps.getState();
        const group = state.session.relatedGroups?.find(g => g.id === recordId);
        return group?.name || 'Group';
    }
    const record = deps.getRecordById(recordId);
    return record?.fields?.Name || 'Item';
}

// =============================================================================
// GROUP 4 - Merge Dialog
// =============================================================================

// Open merge dialog for multiple selected items (N items, N >= 2)
export function openMergeDialogMulti(selectedIds) {
    const state = deps.getState();
    console.log('[MERGE DEBUG] openMergeDialogMulti() called, selectedIds:', JSON.stringify(selectedIds));
    if (!selectedIds || selectedIds.length < 2) {
        console.log('[MERGE DEBUG]   ❌ Not enough items, returning');
        return;
    }

    // Save the selected items and exit merge mode UI (but don't clear the dialog state)
    const itemsToMerge = [...selectedIds];
    exitMergeMode();

    // Resolve all record IDs (expand any groups)
    let allRecordIds = [];
    for (const id of itemsToMerge) {
        if (id.startsWith('group-')) {
            const group = state.session.relatedGroups?.find(g => g.id === id);
            if (group?.items) allRecordIds.push(...group.items);
        } else {
            allRecordIds.push(id);
            // If this item is already in a group, expand the whole group
            const itemGroup = getItemGroup(id);
            if (itemGroup) {
                allRecordIds.push(...(itemGroup.items || []).filter(i => i !== id));
            }
        }
    }
    allRecordIds = [...new Set(allRecordIds)];

    if (allRecordIds.length < 2) {
        return;
    }

    // Use first two as source/target for the dialog's pending merge state
    // (The actual merge will use all items)
    pendingMergeSource = itemsToMerge[0];
    pendingMergeTarget = itemsToMerge.length === 2 ? itemsToMerge[1] : itemsToMerge[1];
    // Store ALL selected IDs for multi-item merge
    pendingMergeAllItems = itemsToMerge;
    pendingMergeEstimation = null;

    // Build item list display for the dialog
    const itemListContainer = document.getElementById('merge-dialog-item-list-items');
    const itemCountBadge = document.getElementById('merge-dialog-item-count');
    if (itemListContainer) {
        const rowsHTML = allRecordIds.map(id => {
            const rec = deps.getRecordById(id);
            const name = rec?.fields?.Name || 'Item';
            const categories = rec?.fields?.Categories;
            const meta = Array.isArray(categories) ? categories.slice(0, 2).join(', ') : (categories || '');
            const price = rec?.fields?.Price ? `$${rec.fields.Price}` : '';
            const metaText = [meta, price].filter(Boolean).join(' · ');
            return `<div class="merge-dialog-item-row" data-merge-item-id="${id}">
                <div class="merge-dialog-item-row-icon">🔗</div>
                <div class="merge-dialog-item-row-info">
                    <div class="merge-dialog-item-row-name">${name}</div>
                    ${metaText ? `<div class="merge-dialog-item-row-meta">${metaText}</div>` : ''}
                </div>
                ${allRecordIds.length > 2 ? `<button class="merge-dialog-item-row-remove" data-remove-id="${id}" title="Remove from merge">&times;</button>` : ''}
            </div>`;
        }).join('');
        itemListContainer.innerHTML = rowsHTML;

        // Attach remove handlers (only if more than 2 items - need minimum 2 to merge)
        itemListContainer.querySelectorAll('.merge-dialog-item-row-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const removeId = btn.dataset.removeId;
                if (!removeId || !pendingMergeAllItems) return;
                pendingMergeAllItems = pendingMergeAllItems.filter(i => i !== removeId);
                const row = btn.closest('.merge-dialog-item-row');
                if (row) row.remove();
                // Update count
                if (itemCountBadge) itemCountBadge.textContent = pendingMergeAllItems.length;
                // Hide remove buttons if down to 2 items
                if (pendingMergeAllItems.length <= 2) {
                    itemListContainer.querySelectorAll('.merge-dialog-item-row-remove').forEach(b => b.style.display = 'none');
                }
                // If less than 2, close dialog
                if (pendingMergeAllItems.length < 2) {
                    closeMergeDialog();
                }
                // Update dialog title
                const dialogTitle = document.querySelector('.merge-dialog-title');
                if (dialogTitle) {
                    dialogTitle.textContent = pendingMergeAllItems.length > 2 ? `Combine ${pendingMergeAllItems.length} Items` : 'Combine Items';
                }
                console.log('[MERGE DEBUG] Item removed from merge list:', removeId, 'remaining:', pendingMergeAllItems.length);
            });
        });
    }
    if (itemCountBadge) itemCountBadge.textContent = allRecordIds.length;

    // Also update legacy pill preview (hidden but kept for backward compat)
    const mergeItemsPreview = document.querySelector('.merge-dialog-items');
    if (mergeItemsPreview) {
        const itemPillsHTML = allRecordIds.map(id => {
            const rec = deps.getRecordById(id);
            const name = rec?.fields?.Name || 'Item';
            return `<div class="merge-item-preview"><span class="merge-item-name">${name}</span></div>`;
        }).join('<span class="merge-plus-icon">+</span>');
        mergeItemsPreview.innerHTML = itemPillsHTML;
    }

    // Update dialog title to reflect count
    const dialogTitle = document.querySelector('.merge-dialog-title');
    if (dialogTitle) {
        dialogTitle.textContent = allRecordIds.length > 2 ? `Combine ${allRecordIds.length} Items` : 'Combine Items';
    }

    // Reset tabs to default (Options tab active)
    const optionsTab = document.getElementById('merge-tab-options');
    const hybridTab = document.getElementById('merge-tab-hybrid');
    const optionsContent = document.getElementById('merge-tab-content-options');
    const hybridContent = document.getElementById('merge-tab-content-hybrid');

    if (optionsTab) optionsTab.classList.add('active');
    if (hybridTab) hybridTab.classList.remove('active');
    if (optionsContent) optionsContent.classList.add('active');
    if (hybridContent) hybridContent.classList.remove('active');

    // Update tab descriptions for item count
    const optionsDesc = optionsContent?.querySelector('.merge-tab-description');
    if (optionsDesc) {
        optionsDesc.textContent = allRecordIds.length > 2
            ? `Keep all ${allRecordIds.length} items as alternative choices under a shared category`
            : 'Keep both items as alternative choices under a shared category';
    }
    const hybridDesc = hybridContent?.querySelector('.merge-tab-description');
    if (hybridDesc) {
        hybridDesc.textContent = allRecordIds.length > 2
            ? `Blend all ${allRecordIds.length} items into a single, new hybrid idea`
            : 'Blend both items into a single, new hybrid idea';
    }

    // Reset both estimation panels to loading state
    ['options', 'hybrid'].forEach(type => {
        const panel = document.getElementById(`merge-estimation-${type}`);
        if (panel) {
            const loading = panel.querySelector('.merge-estimation-loading');
            const result = panel.querySelector('.merge-estimation-result');
            if (loading) loading.style.display = 'flex';
            if (result) result.style.display = 'none';
        }
    });

    // Show the dialog
    const dialog = mergeOptionsDialog || document.getElementById('merge-options-dialog');
    console.log('[MERGE DEBUG]   mergeOptionsDialog ref:', mergeOptionsDialog ? 'EXISTS' : '❌ NULL');
    console.log('[MERGE DEBUG]   dialog (with fallback):', dialog ? 'EXISTS' : '❌ NULL');
    if (dialog) {
        dialog.style.display = 'flex';
        console.log('[MERGE DEBUG]   ✅ Dialog display set to flex');
        setTimeout(() => {
            const cs = window.getComputedStyle(dialog);
            console.log('[MERGE DEBUG]   Dialog POST-SHOW: display:', cs.display, 'zIndex:', cs.zIndex, 'position:', cs.position, 'opacity:', cs.opacity);
            console.log('[MERGE DEBUG]   Dialog rect:', JSON.stringify(dialog.getBoundingClientRect()));
        }, 100);
    } else {
        console.log('[MERGE DEBUG]   ❌ CANNOT show merge dialog - element not found!');
    }

    deps.log('Presentation', `Multi-select merge dialog opened for ${allRecordIds.length} items`);

    // Fetch AI estimation in background using all items
    const allItems = allRecordIds.map(id => {
        const rec = deps.getRecordById(id);
        return {
            name: rec?.fields?.Name || 'Item',
            description: rec?.fields?.Description || '',
            category: rec?.fields?.Category || '',
            price: rec?.fields?.Price || ''
        };
    });
    fetchMergeEstimationMulti(allItems);
}

// Close the merge options dialog
export function closeMergeDialog() {
    console.log('[MERGE DEBUG] closeMergeDialog() called');
    if (mergeOptionsDialog) {
        mergeOptionsDialog.style.display = 'none';
        console.log('[MERGE DEBUG]   ✅ Dialog hidden');
    }
    pendingMergeSource = null;
    pendingMergeTarget = null;
    pendingMergeEstimation = null;
    pendingMergeAllItems = null;
}

// =============================================================================
// GROUP 5 - Merge Execution
// =============================================================================

// Execute merge directly based on the drop zone (no dialog)
// zone: 'hybrid' = merge as hybrid, 'options' = add as option
// sourceId/targetId can be either record IDs or group IDs (prefixed with 'group-')
export async function executeMergeByZone(sourceId, targetId, zone) {
    const state = deps.getState();
    console.log('[MERGE DEBUG] executeMergeByZone() called - sourceId:', sourceId, 'targetId:', targetId, 'zone:', zone);
    if (!sourceId || !targetId) {
        console.log('[MERGE DEBUG]   ❌ Missing sourceId or targetId, returning');
        return;
    }

    // Resolve group IDs: if target is a group card, get all its member record IDs
    const isTargetGroup = targetId.startsWith('group-');
    const isSourceGroup = sourceId.startsWith('group-');

    // Collect all record IDs involved from source side
    let sourceRecordIds = [];
    if (isSourceGroup) {
        const sourceGroup = state.session.relatedGroups?.find(g => g.id === sourceId);
        sourceRecordIds = sourceGroup ? [...(sourceGroup.items || [])] : [];
    } else {
        sourceRecordIds = [sourceId];
        // Also include group members if source is part of a group
        const sourceGroup = getItemGroup(sourceId);
        if (sourceGroup) {
            sourceRecordIds = [...(sourceGroup.items || [])];
        }
    }

    // Collect all record IDs involved from target side
    let targetRecordIds = [];
    if (isTargetGroup) {
        const targetGroup = state.session.relatedGroups?.find(g => g.id === targetId);
        targetRecordIds = targetGroup ? [...(targetGroup.items || [])] : [];
    } else {
        targetRecordIds = [targetId];
        // Also include group members if target is part of a group
        const targetGroup = getItemGroup(targetId);
        if (targetGroup) {
            targetRecordIds = [...(targetGroup.items || [])];
        }
    }

    if (sourceRecordIds.length === 0 || targetRecordIds.length === 0) return;

    // Use first record from each side for legacy 2-item operations
    const primarySourceId = sourceRecordIds[0];
    const primaryTargetId = targetRecordIds[0];
    const sourceRecord = deps.getRecordById(primarySourceId);
    const targetRecord = deps.getRecordById(primaryTargetId);

    if (zone === 'hybrid') {
        // Merge as hybrid - combine all items into the primary target
        const allRecordIds = [...new Set([...sourceRecordIds, ...targetRecordIds])];

        // Combine each item (except the target) into the primary target
        for (const id of allRecordIds) {
            if (id !== primaryTargetId) {
                await combineItemsIntoOne(id, primaryTargetId, null);
            }
        }

        // Build items array for all involved items for AI estimation
        const allItems = allRecordIds.map(id => {
            const rec = deps.getRecordById(id);
            return {
                name: rec?.fields?.Name || 'Item',
                description: rec?.fields?.Description || '',
                category: rec?.fields?.Category || '',
                price: rec?.fields?.Price || ''
            };
        });

        fetchEstimationMulti(allItems, 'hybrid').then(result => {
            if (result?.estimation && state.session.combinedItems) {
                let actualTarget = primaryTargetId;
                for (const [target, data] of state.session.combinedItems.entries()) {
                    const sources = data instanceof Set ? data : (data.sources || new Set());
                    if (sources.has(primaryTargetId)) {
                        actualTarget = target;
                        break;
                    }
                }
                const entry = state.session.combinedItems.get(actualTarget);
                if (entry && !(entry instanceof Set)) {
                    entry.hybridData = result.estimation;
                    deps.scheduleRenderAllItems();
                    deps.triggerSave();
                    deps.log('Presentation', `Updated hybrid "${actualTarget}" with AI estimation`);
                }
            }
        }).catch(err => {
            console.warn('[Presentation] Background hybrid estimation failed:', err.message);
        });

    } else {
        // Add as option - merge all items from both sides into one options group

        // Collect all unique record IDs that should end up in the group
        const allRecordIds = [...new Set([...sourceRecordIds, ...targetRecordIds])];

        // Execute group creation: pass all record IDs
        await createRelatedCategoryMulti(allRecordIds, null);

        // Fetch AI estimation in background for all items in the new group
        const allItems = allRecordIds.map(id => {
            const rec = deps.getRecordById(id);
            return {
                name: rec?.fields?.Name || 'Item',
                description: rec?.fields?.Description || '',
                category: rec?.fields?.Category || '',
                price: rec?.fields?.Price || ''
            };
        });

        fetchEstimationMulti(allItems, 'options').then(result => {
            if (result?.estimation && state.session.relatedGroups) {
                // Find the group that contains all the items
                const group = state.session.relatedGroups.find(g => {
                    const items = Array.isArray(g) ? g : (g.items || []);
                    return allRecordIds.every(id => items.includes(id));
                });
                if (group && !Array.isArray(group)) {
                    if (result.estimation.categoryName) group.name = result.estimation.categoryName;
                    if (result.estimation.categoryDescription) group.description = result.estimation.categoryDescription;
                    deps.scheduleRenderAllItems();
                    deps.triggerSave();
                    deps.log('Presentation', `Updated options group with AI estimation`);
                }
            }
        }).catch(err => {
            console.warn('[Presentation] Background options estimation failed:', err.message);
        });
    }
}

// Open merge dialog for two items (or groups of items)
export async function openMergeDialog(sourceRecordId, targetRecordId) {
    const state = deps.getState();
    console.log('[MERGE DEBUG] openMergeDialog() called - sourceRecordId:', sourceRecordId, 'targetRecordId:', targetRecordId);
    if (!sourceRecordId || !targetRecordId) {
        console.log('[MERGE DEBUG]   ❌ Missing source or target recordId, returning');
        return;
    }

    // Resolve all involved record IDs (expand groups)
    const isSourceGroup = sourceRecordId.startsWith('group-');
    const isTargetGroup = targetRecordId.startsWith('group-');

    let sourceRecordIds = [];
    if (isSourceGroup) {
        const sg = state.session.relatedGroups?.find(g => g.id === sourceRecordId);
        sourceRecordIds = sg ? [...(sg.items || [])] : [];
    } else {
        sourceRecordIds = [sourceRecordId];
        const sg = getItemGroup(sourceRecordId);
        if (sg) sourceRecordIds = [...(sg.items || [])];
    }

    let targetRecordIds = [];
    if (isTargetGroup) {
        const tg = state.session.relatedGroups?.find(g => g.id === targetRecordId);
        targetRecordIds = tg ? [...(tg.items || [])] : [];
    } else {
        targetRecordIds = [targetRecordId];
        const tg = getItemGroup(targetRecordId);
        if (tg) targetRecordIds = [...(tg.items || [])];
    }

    const allRecordIds = [...new Set([...sourceRecordIds, ...targetRecordIds])];

    // Store pending merge info
    pendingMergeSource = sourceRecordId;
    pendingMergeTarget = targetRecordId;
    pendingMergeEstimation = null;
    pendingMergeAllItems = allRecordIds;

    // Build item list display for the dialog
    const itemListContainer = document.getElementById('merge-dialog-item-list-items');
    const itemCountBadge = document.getElementById('merge-dialog-item-count');
    if (itemListContainer) {
        const rowsHTML = allRecordIds.map(id => {
            const rec = deps.getRecordById(id);
            const name = rec?.fields?.Name || 'Item';
            const categories = rec?.fields?.Categories;
            const meta = Array.isArray(categories) ? categories.slice(0, 2).join(', ') : (categories || '');
            const price = rec?.fields?.Price ? `$${rec.fields.Price}` : '';
            const metaText = [meta, price].filter(Boolean).join(' · ');
            return `<div class="merge-dialog-item-row" data-merge-item-id="${id}">
                <div class="merge-dialog-item-row-icon">🔗</div>
                <div class="merge-dialog-item-row-info">
                    <div class="merge-dialog-item-row-name">${name}</div>
                    ${metaText ? `<div class="merge-dialog-item-row-meta">${metaText}</div>` : ''}
                </div>
            </div>`;
        }).join('');
        itemListContainer.innerHTML = rowsHTML;
    }
    if (itemCountBadge) itemCountBadge.textContent = allRecordIds.length;

    // Also update legacy pill preview (hidden but kept for backward compat)
    const mergeItemsPreview = document.querySelector('.merge-dialog-items');
    if (mergeItemsPreview) {
        const itemPillsHTML = allRecordIds.map(id => {
            const rec = deps.getRecordById(id);
            const name = rec?.fields?.Name || 'Item';
            return `<div class="merge-item-preview"><span class="merge-item-name">${name}</span></div>`;
        }).join('<span class="merge-plus-icon">+</span>');
        mergeItemsPreview.innerHTML = itemPillsHTML;
    }

    // Update dialog title to reflect count
    const dialogTitle = document.querySelector('.merge-dialog-title');
    if (dialogTitle) {
        dialogTitle.textContent = allRecordIds.length > 2 ? `Combine ${allRecordIds.length} Items` : 'Combine Items';
    }

    // Reset tabs to default (Options tab active)
    const optionsTab = document.getElementById('merge-tab-options');
    const hybridTab = document.getElementById('merge-tab-hybrid');
    const optionsContent = document.getElementById('merge-tab-content-options');
    const hybridContent = document.getElementById('merge-tab-content-hybrid');

    if (optionsTab) optionsTab.classList.add('active');
    if (hybridTab) hybridTab.classList.remove('active');
    if (optionsContent) optionsContent.classList.add('active');
    if (hybridContent) hybridContent.classList.remove('active');

    // Update the options tab description to reflect item count
    const optionsDesc = optionsContent?.querySelector('.merge-tab-description');
    if (optionsDesc) {
        optionsDesc.textContent = allRecordIds.length > 2
            ? `Keep all ${allRecordIds.length} items as alternative choices under a shared category`
            : 'Keep both items as alternative choices under a shared category';
    }
    const hybridDesc = hybridContent?.querySelector('.merge-tab-description');
    if (hybridDesc) {
        hybridDesc.textContent = allRecordIds.length > 2
            ? `Blend all ${allRecordIds.length} items into a single, new hybrid idea`
            : 'Blend both items into a single, new hybrid idea';
    }

    // Reset both estimation panels to loading state
    ['options', 'hybrid'].forEach(type => {
        const panel = document.getElementById(`merge-estimation-${type}`);
        if (panel) {
            const loading = panel.querySelector('.merge-estimation-loading');
            const result = panel.querySelector('.merge-estimation-result');
            if (loading) loading.style.display = 'flex';
            if (result) result.style.display = 'none';
        }
    });

    // Show the dialog
    const dialog = mergeOptionsDialog || document.getElementById('merge-options-dialog');
    if (dialog) {
        dialog.style.display = 'flex';
    }

    deps.log('Presentation', `Merge dialog opened for ${allRecordIds.length} items`);

    // Fetch AI estimation in background using all items
    const allItems = allRecordIds.map(id => {
        const rec = deps.getRecordById(id);
        return {
            name: rec?.fields?.Name || 'Item',
            description: rec?.fields?.Description || '',
            category: rec?.fields?.Category || '',
            price: rec?.fields?.Price || ''
        };
    });
    fetchMergeEstimationMulti(allItems);
}

// Fetch AI estimation for merge - updates both tab panels
async function fetchMergeEstimation(sourceRecord, targetRecord) {
    const item1 = {
        name: sourceRecord?.fields?.Name || 'Item',
        description: sourceRecord?.fields?.Description || '',
        category: sourceRecord?.fields?.Category || '',
        price: sourceRecord?.fields?.Price || ''
    };

    const item2 = {
        name: targetRecord?.fields?.Name || 'Item',
        description: targetRecord?.fields?.Description || '',
        category: targetRecord?.fields?.Category || '',
        price: targetRecord?.fields?.Price || ''
    };

    try {
        // Fetch both estimations in parallel
        const [optionsResult, hybridResult] = await Promise.all([
            fetchEstimation(item1, item2, 'options'),
            fetchEstimation(item1, item2, 'hybrid')
        ]);

        // Store estimation for use when confirming merge
        pendingMergeEstimation = {
            options: optionsResult?.estimation || null,
            hybrid: hybridResult?.estimation || null
        };

        // Update Options tab panel
        const optionsPanel = document.getElementById('merge-estimation-options');
        if (optionsPanel) {
            const loading = optionsPanel.querySelector('.merge-estimation-loading');
            const result = optionsPanel.querySelector('.merge-estimation-result');
            if (loading) loading.style.display = 'none';
            if (result) result.style.display = 'flex';

            if (optionsResult?.estimation) {
                const categoryEl = document.getElementById('estimation-category');
                const descEl = document.getElementById('estimation-description');
                if (categoryEl) categoryEl.textContent = optionsResult.estimation.categoryName || 'Options';
                if (descEl) descEl.textContent = optionsResult.estimation.categoryDescription || '';

                // Show confidence
                const confidenceField = document.getElementById('estimation-options-confidence-field');
                const confidenceFill = document.getElementById('estimation-options-confidence');
                if (confidenceField && optionsResult.estimation.confidence) {
                    confidenceField.style.display = 'flex';
                    const pct = Math.round(optionsResult.estimation.confidence * 100);
                    if (confidenceFill) {
                        confidenceFill.style.width = pct + '%';
                        confidenceFill.style.background = pct >= 70 ? '#4CAF50' : pct >= 40 ? '#FF9800' : '#f44336';
                    }
                }
            }
        }

        // Update Hybrid tab panel
        const hybridPanel = document.getElementById('merge-estimation-hybrid');
        if (hybridPanel) {
            const loading = hybridPanel.querySelector('.merge-estimation-loading');
            const result = hybridPanel.querySelector('.merge-estimation-result');
            if (loading) loading.style.display = 'none';
            if (result) result.style.display = 'flex';

            if (hybridResult?.estimation) {
                const nameEl = document.getElementById('estimation-hybrid-name');
                const descEl = document.getElementById('estimation-hybrid-description');
                if (nameEl) nameEl.textContent = hybridResult.estimation.hybridName || 'Combined Idea';
                if (descEl) descEl.textContent = hybridResult.estimation.hybridDescription || '';

                // Show reasoning
                const reasoningField = document.getElementById('estimation-hybrid-reasoning-field');
                const reasoningEl = document.getElementById('estimation-hybrid-reasoning');
                if (reasoningField && hybridResult.estimation.reasoning) {
                    reasoningField.style.display = 'flex';
                    if (reasoningEl) reasoningEl.textContent = hybridResult.estimation.reasoning;
                }

                // Show confidence
                const confidenceField = document.getElementById('estimation-hybrid-confidence-field');
                const confidenceFill = document.getElementById('estimation-hybrid-confidence');
                if (confidenceField && hybridResult.estimation.confidence) {
                    confidenceField.style.display = 'flex';
                    const pct = Math.round(hybridResult.estimation.confidence * 100);
                    if (confidenceFill) {
                        confidenceFill.style.width = pct + '%';
                        confidenceFill.style.background = pct >= 70 ? '#4CAF50' : pct >= 40 ? '#FF9800' : '#f44336';
                    }
                }
            }
        }

    } catch (error) {
        console.error('[Presentation] Error fetching merge estimation:', error);
        // Hide loading spinners on error
        ['options', 'hybrid'].forEach(type => {
            const panel = document.getElementById(`merge-estimation-${type}`);
            if (panel) {
                const loading = panel.querySelector('.merge-estimation-loading');
                if (loading) loading.style.display = 'none';
            }
        });
    }
}

// Fetch AI estimation for merge using multiple items - updates both tab panels
async function fetchMergeEstimationMulti(items) {
    try {
        // Fetch both estimations in parallel
        const [optionsResult, hybridResult] = await Promise.all([
            fetchEstimationMulti(items, 'options'),
            fetchEstimationMulti(items, 'hybrid')
        ]);

        // Store estimation for use when confirming merge
        pendingMergeEstimation = {
            options: optionsResult?.estimation || null,
            hybrid: hybridResult?.estimation || null
        };

        // Update Options tab panel
        const optionsPanel = document.getElementById('merge-estimation-options');
        if (optionsPanel) {
            const loading = optionsPanel.querySelector('.merge-estimation-loading');
            const result = optionsPanel.querySelector('.merge-estimation-result');
            if (loading) loading.style.display = 'none';
            if (result) result.style.display = 'flex';

            if (optionsResult?.estimation) {
                const categoryEl = document.getElementById('estimation-category');
                const descEl = document.getElementById('estimation-description');
                if (categoryEl) categoryEl.textContent = optionsResult.estimation.categoryName || 'Options';
                if (descEl) descEl.textContent = optionsResult.estimation.categoryDescription || '';

                const confidenceField = document.getElementById('estimation-options-confidence-field');
                const confidenceFill = document.getElementById('estimation-options-confidence');
                if (confidenceField && optionsResult.estimation.confidence) {
                    confidenceField.style.display = 'flex';
                    const pct = Math.round(optionsResult.estimation.confidence * 100);
                    if (confidenceFill) {
                        confidenceFill.style.width = pct + '%';
                        confidenceFill.style.background = pct >= 70 ? '#4CAF50' : pct >= 40 ? '#FF9800' : '#f44336';
                    }
                }
            }
        }

        // Update Hybrid tab panel
        const hybridPanel = document.getElementById('merge-estimation-hybrid');
        if (hybridPanel) {
            const loading = hybridPanel.querySelector('.merge-estimation-loading');
            const result = hybridPanel.querySelector('.merge-estimation-result');
            if (loading) loading.style.display = 'none';
            if (result) result.style.display = 'flex';

            if (hybridResult?.estimation) {
                const nameEl = document.getElementById('estimation-hybrid-name');
                const descEl = document.getElementById('estimation-hybrid-description');
                if (nameEl) nameEl.textContent = hybridResult.estimation.hybridName || 'Combined Idea';
                if (descEl) descEl.textContent = hybridResult.estimation.hybridDescription || '';

                const reasoningField = document.getElementById('estimation-hybrid-reasoning-field');
                const reasoningEl = document.getElementById('estimation-hybrid-reasoning');
                if (reasoningField && hybridResult.estimation.reasoning) {
                    reasoningField.style.display = 'flex';
                    if (reasoningEl) reasoningEl.textContent = hybridResult.estimation.reasoning;
                }

                const confidenceField = document.getElementById('estimation-hybrid-confidence-field');
                const confidenceFill = document.getElementById('estimation-hybrid-confidence');
                if (confidenceField && hybridResult.estimation.confidence) {
                    confidenceField.style.display = 'flex';
                    const pct = Math.round(hybridResult.estimation.confidence * 100);
                    if (confidenceFill) {
                        confidenceFill.style.width = pct + '%';
                        confidenceFill.style.background = pct >= 70 ? '#4CAF50' : pct >= 40 ? '#FF9800' : '#f44336';
                    }
                }
            }
        }

    } catch (error) {
        console.error('[Presentation] Error fetching multi-item merge estimation:', error);
        ['options', 'hybrid'].forEach(type => {
            const panel = document.getElementById(`merge-estimation-${type}`);
            if (panel) {
                const loading = panel.querySelector('.merge-estimation-loading');
                if (loading) loading.style.display = 'none';
            }
        });
    }
}

// Helper to fetch a single estimation (legacy 2-item format, kept for backwards compat)
async function fetchEstimation(item1, item2, mergeType) {
    try {
        const response = await fetch('/.netlify/functions/estimate-merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ item1, item2, mergeType })
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn(`[Presentation] Estimation fetch failed for ${mergeType}:`, error.message);
        return null;
    }
}

// Helper to fetch estimation for multiple items (2+)
async function fetchEstimationMulti(items, mergeType) {
    try {
        const response = await fetch('/.netlify/functions/estimate-merge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items, mergeType })
        });

        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.warn(`[Presentation] Multi-item estimation fetch failed for ${mergeType}:`, error.message);
        return null;
    }
}

// Handle merge option: Combine into single idea (As Hybrid)
export async function handleMergeCombine() {
    const state = deps.getState();
    console.log('[MERGE DEBUG] handleMergeCombine() called');
    console.log('[MERGE DEBUG]   pendingMergeSource:', pendingMergeSource);
    console.log('[MERGE DEBUG]   pendingMergeTarget:', pendingMergeTarget);
    console.log('[MERGE DEBUG]   pendingMergeAllItems:', JSON.stringify(pendingMergeAllItems));
    if (!pendingMergeSource || !pendingMergeTarget) {
        console.log('[MERGE DEBUG]   ❌ Missing source or target, closing dialog');
        closeMergeDialog();
        return;
    }

    const sourceId = pendingMergeSource;
    const targetId = pendingMergeTarget;
    const hybridEstimation = pendingMergeEstimation?.hybrid || null;
    const allSelectedIds = pendingMergeAllItems ? [...pendingMergeAllItems] : null;
    closeMergeDialog();

    // Multi-select merge path: 3+ distinct items selected
    if (allSelectedIds && allSelectedIds.length > 2) {
        // Resolve all record IDs from the selected items (expand groups)
        let allRecordIds = [];
        for (const id of allSelectedIds) {
            if (id.startsWith('group-')) {
                const group = state.session.relatedGroups?.find(g => g.id === id);
                if (group?.items) allRecordIds.push(...group.items);
            } else {
                allRecordIds.push(id);
                const itemGroup = getItemGroup(id);
                if (itemGroup) {
                    allRecordIds.push(...(itemGroup.items || []).filter(i => i !== id));
                }
            }
        }
        allRecordIds = [...new Set(allRecordIds)];

        if (allRecordIds.length >= 2) {
            const primaryTargetId = allRecordIds[0];
            // Combine each item into the primary target
            for (const id of allRecordIds) {
                if (id !== primaryTargetId) {
                    await combineItemsIntoOne(id, primaryTargetId, null);
                }
            }

            // Fetch AI estimation in background
            const allItems = allRecordIds.map(id => {
                const rec = deps.getRecordById(id);
                return {
                    name: rec?.fields?.Name || 'Item',
                    description: rec?.fields?.Description || '',
                    category: rec?.fields?.Category || '',
                    price: rec?.fields?.Price || ''
                };
            });
            fetchEstimationMulti(allItems, 'hybrid').then(result => {
                if (result?.estimation && state.session.combinedItems) {
                    let actualTarget = primaryTargetId;
                    for (const [target, data] of state.session.combinedItems.entries()) {
                        const sources = data instanceof Set ? data : (data.sources || new Set());
                        if (sources.has(primaryTargetId)) {
                            actualTarget = target;
                            break;
                        }
                    }
                    const entry = state.session.combinedItems.get(actualTarget);
                    if (entry && !(entry instanceof Set)) {
                        entry.hybridData = result.estimation;
                        deps.scheduleRenderAllItems();
                        deps.triggerSave();
                        deps.log('Presentation', `Updated multi-select hybrid "${actualTarget}" with AI estimation`);
                    }
                }
            }).catch(err => {
                console.warn('[Presentation] Background multi-select hybrid estimation failed:', err.message);
            });
        }
        return;
    }

    // Standard 2-item or group-based merge path
    const isSourceGroup = sourceId.startsWith('group-');
    const isTargetGroup = targetId.startsWith('group-');
    const sourceGroup = !isSourceGroup ? getItemGroup(sourceId) : null;
    const targetGroup = !isTargetGroup ? getItemGroup(targetId) : null;

    if (isSourceGroup || isTargetGroup || sourceGroup || targetGroup) {
        await executeMergeByZone(sourceId, targetId, 'hybrid');
    } else {
        await combineItemsIntoOne(sourceId, targetId, hybridEstimation);
    }
}

// Handle merge option: Group as options/category (As Options)
export async function handleMergeGroup() {
    const state = deps.getState();
    console.log('[MERGE DEBUG] handleMergeGroup() called');
    console.log('[MERGE DEBUG]   pendingMergeSource:', pendingMergeSource);
    console.log('[MERGE DEBUG]   pendingMergeTarget:', pendingMergeTarget);
    console.log('[MERGE DEBUG]   pendingMergeAllItems:', JSON.stringify(pendingMergeAllItems));
    if (!pendingMergeSource || !pendingMergeTarget) {
        console.log('[MERGE DEBUG]   ❌ Missing source or target, closing dialog');
        closeMergeDialog();
        return;
    }

    const sourceId = pendingMergeSource;
    const targetId = pendingMergeTarget;
    const optionsEstimation = pendingMergeEstimation?.options || null;
    const allSelectedIds = pendingMergeAllItems ? [...pendingMergeAllItems] : null;
    closeMergeDialog();

    // Multi-select merge path: 3+ distinct items selected
    if (allSelectedIds && allSelectedIds.length > 2) {
        // Resolve all record IDs from the selected items (expand groups)
        let allRecordIds = [];
        for (const id of allSelectedIds) {
            if (id.startsWith('group-')) {
                const group = state.session.relatedGroups?.find(g => g.id === id);
                if (group?.items) allRecordIds.push(...group.items);
            } else {
                allRecordIds.push(id);
                const itemGroup = getItemGroup(id);
                if (itemGroup) {
                    allRecordIds.push(...(itemGroup.items || []).filter(i => i !== id));
                }
            }
        }
        allRecordIds = [...new Set(allRecordIds)];

        if (allRecordIds.length >= 2) {
            await createRelatedCategoryMulti(allRecordIds, optionsEstimation);

            // Fetch AI estimation in background
            const allItems = allRecordIds.map(id => {
                const rec = deps.getRecordById(id);
                return {
                    name: rec?.fields?.Name || 'Item',
                    description: rec?.fields?.Description || '',
                    category: rec?.fields?.Category || '',
                    price: rec?.fields?.Price || ''
                };
            });
            fetchEstimationMulti(allItems, 'options').then(result => {
                if (result?.estimation && state.session.relatedGroups) {
                    const group = state.session.relatedGroups.find(g => {
                        const items = Array.isArray(g) ? g : (g.items || []);
                        return allRecordIds.every(id => items.includes(id));
                    });
                    if (group && !Array.isArray(group)) {
                        if (result.estimation.categoryName) group.name = result.estimation.categoryName;
                        if (result.estimation.categoryDescription) group.description = result.estimation.categoryDescription;
                        deps.scheduleRenderAllItems();
                        deps.triggerSave();
                        deps.log('Presentation', `Updated multi-select options group with AI estimation`);
                    }
                }
            }).catch(err => {
                console.warn('[Presentation] Background multi-select options estimation failed:', err.message);
            });
        }
        return;
    }

    // Standard 2-item or group-based merge path
    const isSourceGroup = sourceId.startsWith('group-');
    const isTargetGroup = targetId.startsWith('group-');
    const sourceGroup = !isSourceGroup ? getItemGroup(sourceId) : null;
    const targetGroup = !isTargetGroup ? getItemGroup(targetId) : null;

    if (isSourceGroup || isTargetGroup || sourceGroup || targetGroup) {
        let sourceRecordIds = [];
        if (isSourceGroup) {
            const sg = state.session.relatedGroups?.find(g => g.id === sourceId);
            sourceRecordIds = sg ? [...(sg.items || [])] : [];
        } else {
            sourceRecordIds = [sourceId];
            if (sourceGroup) sourceRecordIds = [...(sourceGroup.items || [])];
        }

        let targetRecordIds = [];
        if (isTargetGroup) {
            const tg = state.session.relatedGroups?.find(g => g.id === targetId);
            targetRecordIds = tg ? [...(tg.items || [])] : [];
        } else {
            targetRecordIds = [targetId];
            if (targetGroup) targetRecordIds = [...(targetGroup.items || [])];
        }

        const allRecordIds = [...new Set([...sourceRecordIds, ...targetRecordIds])];
        await createRelatedCategoryMulti(allRecordIds, optionsEstimation);
    } else {
        await createRelatedCategory(sourceId, targetId, optionsEstimation);
    }
}

// =============================================================================
// GROUP 6 - Combine/Group Operations
// =============================================================================

// Combine two items into a single cohesive idea (As Hybrid)
export async function combineItemsIntoOne(sourceRecordId, targetRecordId, hybridEstimation = null) {
    const state = deps.getState();
    // Initialize combinedItems if not exists
    // Structure: Map<targetRecordId, { sources: Set<sourceRecordIds>, hybridData: Object|null }>
    if (!state.session.combinedItems) {
        state.session.combinedItems = new Map();
    }

    const sourceRecord = deps.getRecordById(sourceRecordId);
    const targetRecord = deps.getRecordById(targetRecordId);
    const sourceName = sourceRecord?.fields?.Name || 'Item';
    const targetName = targetRecord?.fields?.Name || 'Item';

    // Check if source is already combined into something else
    let actualTarget = targetRecordId;
    for (const [target, data] of state.session.combinedItems.entries()) {
        const sources = data instanceof Set ? data : (data.sources || new Set());
        if (sources.has(sourceRecordId)) {
            // Source is already a source of another combined item
            deps.showToast(`"${sourceName}" is already combined with another item`, 'info');
            return;
        }
        if (sources.has(targetRecordId)) {
            // Target is a source of another combined item - combine into that target instead
            actualTarget = target;
            break;
        }
    }

    // If target is itself a source in combinedItems, find the real target
    for (const [target, data] of state.session.combinedItems.entries()) {
        const sources = data instanceof Set ? data : (data.sources || new Set());
        if (sources.has(actualTarget)) {
            actualTarget = target;
            break;
        }
    }

    // Helper to get sources from combinedItems entry (handles both old Set format and new object format)
    const getSources = (entry) => {
        if (entry instanceof Set) return entry;
        return entry?.sources || new Set();
    };

    // Check if source is actually a combined target
    if (state.session.combinedItems.has(sourceRecordId)) {
        // Source has items combined into it - merge those into the target
        const sourceEntry = state.session.combinedItems.get(sourceRecordId);
        const sourcesCombined = getSources(sourceEntry);

        if (!state.session.combinedItems.has(actualTarget)) {
            state.session.combinedItems.set(actualTarget, { sources: new Set(), hybridData: null });
        }

        const targetEntry = state.session.combinedItems.get(actualTarget);
        const targetSources = targetEntry instanceof Set ? targetEntry : (targetEntry.sources || new Set());

        // Add the source itself and all its combined sources
        targetSources.add(sourceRecordId);
        sourcesCombined.forEach(s => targetSources.add(s));

        // Update with hybrid data if available
        if (targetEntry instanceof Set) {
            state.session.combinedItems.set(actualTarget, {
                sources: targetSources,
                hybridData: hybridEstimation
            });
        } else {
            targetEntry.sources = targetSources;
            targetEntry.hybridData = hybridEstimation || targetEntry.hybridData;
        }

        // Remove the old combined entry
        state.session.combinedItems.delete(sourceRecordId);
    } else {
        // Simple case: just add source to target's combined set
        if (!state.session.combinedItems.has(actualTarget)) {
            state.session.combinedItems.set(actualTarget, { sources: new Set(), hybridData: hybridEstimation });
        }

        const targetEntry = state.session.combinedItems.get(actualTarget);
        if (targetEntry instanceof Set) {
            // Migrate old format to new format
            targetEntry.add(sourceRecordId);
            state.session.combinedItems.set(actualTarget, {
                sources: targetEntry,
                hybridData: hybridEstimation
            });
        } else {
            targetEntry.sources.add(sourceRecordId);
            targetEntry.hybridData = hybridEstimation || targetEntry.hybridData;
        }
    }

    const finalTargetRecord = deps.getRecordById(actualTarget);
    const hybridName = hybridEstimation?.hybridName;
    const finalDisplayName = hybridName || finalTargetRecord?.fields?.Name || 'Item';

    deps.showToast(`Created hybrid: "${finalDisplayName}"`, 'success');

    // Re-render items
    await deps.renderAllItems();
    deps.generateItemsSummary();
    deps.updatePresentationHeaderTotal();

    // Save session
    deps.triggerSave();

    deps.log('Presentation', `Combined ${sourceRecordId} into ${actualTarget}`);

    // Create collage image from all combined items' photos (runs in background)
    const allSources = getCombinedSources(actualTarget);
    createCollageImage(actualTarget, allSources).then(collageUrl => {
        if (collageUrl && finalTargetRecord) {
            // Store the collage as the target item's custom image
            const collageImage = {
                url: collageUrl,
                isCollage: true
            };
            finalTargetRecord.fields._customImages = [collageImage];

            // Update the image cache so presentation view picks it up
            deps.itemImagesCache.set(actualTarget, { images: [collageUrl], currentIndex: 0 });

            // Re-render to show the collage
            deps.scheduleRenderAllItems();
            deps.triggerSave();
            deps.log('Presentation', `Collage image set for hybrid: ${actualTarget}`);
        }
    });
}

// Create a related category linking two items (Group as Options)
export async function createRelatedCategory(recordId1, recordId2, optionsEstimation = null) {
    const state = deps.getState();
    // Initialize relatedGroups if not exists
    // Structure: Array of { id: string, name: string, description: string, items: string[] }
    if (!state.session.relatedGroups) {
        state.session.relatedGroups = [];
    }

    const record1 = deps.getRecordById(recordId1);
    const record2 = deps.getRecordById(recordId2);
    const name1 = record1?.fields?.Name || 'Item 1';
    const name2 = record2?.fields?.Name || 'Item 2';

    // Use AI estimation for group name and description if available
    const estimatedName = optionsEstimation?.categoryName;
    const estimatedDescription = optionsEstimation?.categoryDescription;

    // Find existing groups that contain these items
    const existingGroup1 = state.session.relatedGroups.find(g =>
        (Array.isArray(g) ? g.includes(recordId1) : g.items?.includes(recordId1))
    );
    const existingGroup2 = state.session.relatedGroups.find(g =>
        (Array.isArray(g) ? g.includes(recordId2) : g.items?.includes(recordId2))
    );

    // Normalize group format (handle legacy array format)
    const getGroupItems = (g) => Array.isArray(g) ? g : (g.items || []);
    const getGroupId = (g) => Array.isArray(g) ? null : g.id;

    if (existingGroup1 && existingGroup2 && existingGroup1 === existingGroup2) {
        // Already in same group
        deps.showToast('Items are already grouped together', 'info');
        return;
    }

    if (existingGroup1 && existingGroup2) {
        // Merge two groups
        const items1 = getGroupItems(existingGroup1);
        const items2 = getGroupItems(existingGroup2);
        const mergedItems = [...new Set([...items1, ...items2])];

        // Create new merged group with AI-estimated name or generated name
        const newGroup = {
            id: `group-${Date.now()}`,
            name: estimatedName || generateGroupName(mergedItems),
            description: estimatedDescription || '',
            items: mergedItems
        };

        state.session.relatedGroups = state.session.relatedGroups.filter(
            g => g !== existingGroup1 && g !== existingGroup2
        );
        state.session.relatedGroups.push(newGroup);

        deps.showToast(`Merged into "${newGroup.name}"`, 'success');
    } else if (existingGroup1) {
        // Add to existing group 1
        const items = getGroupItems(existingGroup1);
        if (!items.includes(recordId2)) {
            items.push(recordId2);
            // Update group structure if needed
            if (Array.isArray(existingGroup1)) {
                const idx = state.session.relatedGroups.indexOf(existingGroup1);
                state.session.relatedGroups[idx] = {
                    id: `group-${Date.now()}`,
                    name: estimatedName || generateGroupName(items),
                    description: estimatedDescription || '',
                    items: items
                };
            } else {
                existingGroup1.items = items;
                // Update name and description with estimation if available
                if (estimatedName) existingGroup1.name = estimatedName;
                if (estimatedDescription) existingGroup1.description = estimatedDescription;
            }
        }
        const groupName = existingGroup1.name || 'options group';
        deps.showToast(`"${name2}" added to "${groupName}"`, 'success');
    } else if (existingGroup2) {
        // Add to existing group 2
        const items = getGroupItems(existingGroup2);
        if (!items.includes(recordId1)) {
            items.push(recordId1);
            // Update group structure if needed
            if (Array.isArray(existingGroup2)) {
                const idx = state.session.relatedGroups.indexOf(existingGroup2);
                state.session.relatedGroups[idx] = {
                    id: `group-${Date.now()}`,
                    name: estimatedName || generateGroupName(items),
                    description: estimatedDescription || '',
                    items: items
                };
            } else {
                existingGroup2.items = items;
                // Update name and description with estimation if available
                if (estimatedName) existingGroup2.name = estimatedName;
                if (estimatedDescription) existingGroup2.description = estimatedDescription;
            }
        }
        const groupName = existingGroup2.name || 'options group';
        deps.showToast(`"${name1}" added to "${groupName}"`, 'success');
    } else {
        // Create new group with AI estimation or fallback to generated name
        const newGroup = {
            id: `group-${Date.now()}`,
            name: estimatedName || generateGroupName([recordId1, recordId2]),
            description: estimatedDescription || '',
            items: [recordId1, recordId2]
        };
        state.session.relatedGroups.push(newGroup);
        deps.showToast(`Created category: "${newGroup.name}"`, 'success');
    }

    // Re-render items
    await deps.renderAllItems();
    deps.generateItemsSummary();
    deps.updatePresentationHeaderTotal();

    // Save session
    deps.triggerSave();

    deps.log('Presentation', `Created/updated option group for ${recordId1} and ${recordId2}`);
}

// Create a related category from multiple items (Group as Options - multi-item version)
// Merges all provided record IDs into a single options group, consolidating any existing groups
export async function createRelatedCategoryMulti(recordIds, optionsEstimation = null) {
    if (!recordIds || recordIds.length < 2) return;

    const state = deps.getState();
    // Initialize relatedGroups if not exists
    if (!state.session.relatedGroups) {
        state.session.relatedGroups = [];
    }

    const estimatedName = optionsEstimation?.categoryName;
    const estimatedDescription = optionsEstimation?.categoryDescription;

    // Find all existing groups that contain any of the provided items
    const existingGroups = new Set();
    for (const id of recordIds) {
        const group = state.session.relatedGroups.find(g => {
            const items = Array.isArray(g) ? g : (g.items || []);
            return items.includes(id);
        });
        if (group) existingGroups.add(group);
    }

    // Collect all unique item IDs from existing groups + provided IDs
    const allItemIds = new Set(recordIds);
    for (const group of existingGroups) {
        const items = Array.isArray(group) ? group : (group.items || []);
        items.forEach(id => allItemIds.add(id));
    }

    const mergedItems = [...allItemIds];

    // Check if all items are already in the same single group
    if (existingGroups.size === 1) {
        const onlyGroup = [...existingGroups][0];
        const groupItems = Array.isArray(onlyGroup) ? onlyGroup : (onlyGroup.items || []);
        if (mergedItems.length === groupItems.length && mergedItems.every(id => groupItems.includes(id))) {
            deps.showToast('Items are already grouped together', 'info');
            return;
        }
    }

    // Remove all existing groups that are being merged
    if (existingGroups.size > 0) {
        state.session.relatedGroups = state.session.relatedGroups.filter(g => !existingGroups.has(g));
    }

    // Create the new merged group
    const newGroup = {
        id: `group-${Date.now()}`,
        name: estimatedName || generateGroupName(mergedItems),
        description: estimatedDescription || '',
        items: mergedItems
    };
    state.session.relatedGroups.push(newGroup);

    const itemNames = mergedItems.slice(0, 3).map(id => {
        const rec = deps.getRecordById(id);
        return rec?.fields?.Name || 'Item';
    });
    const suffix = mergedItems.length > 3 ? ` +${mergedItems.length - 3} more` : '';
    deps.showToast(`Created "${newGroup.name}" with ${mergedItems.length} options`, 'success');

    // Re-render items
    await deps.renderAllItems();
    deps.generateItemsSummary();
    deps.updatePresentationHeaderTotal();

    // Save session
    deps.triggerSave();

    deps.log('Presentation', `Created/updated option group with ${mergedItems.length} items`);
}

// Generate a name for a group based on its items
export function generateGroupName(itemIds) {
    if (!itemIds || itemIds.length === 0) return 'Options';

    // Try to find common category or type among items
    const categories = new Set();
    const types = new Set();

    itemIds.forEach(id => {
        const record = deps.getRecordById(id);
        if (record?.fields?.Category) {
            categories.add(record.fields.Category);
        }
        if (record?.fields?.Type) {
            types.add(record.fields.Type);
        }
    });

    // If all items share a category, use it
    if (categories.size === 1) {
        return `${[...categories][0]} Options`;
    }

    // If all items share a type, use it
    if (types.size === 1) {
        return `${[...types][0]} Options`;
    }

    // Default name
    return `${itemIds.length} Options`;
}

// Helper to get sources Set from combinedItems entry (handles both old Set format and new object format)
export function getSourcesFromEntry(entry) {
    if (!entry) return new Set();
    if (entry instanceof Set) return entry;
    return entry.sources || new Set();
}

// Check if an item is a source that has been combined into another item
export function isItemCombinedSource(recordId) {
    const state = deps.getState();
    if (!state.session.combinedItems) return false;

    for (const entry of state.session.combinedItems.values()) {
        const sources = getSourcesFromEntry(entry);
        if (sources.has(recordId)) {
            return true;
        }
    }
    return false;
}

// Get the combined target for a source item
export function getCombinedTarget(sourceRecordId) {
    const state = deps.getState();
    if (!state.session.combinedItems) return null;

    for (const [target, entry] of state.session.combinedItems.entries()) {
        const sources = getSourcesFromEntry(entry);
        if (sources.has(sourceRecordId)) {
            return target;
        }
    }
    return null;
}

// Get all source items that have been combined into a target
export function getCombinedSources(targetRecordId) {
    const state = deps.getState();
    if (!state.session.combinedItems) return [];

    const entry = state.session.combinedItems.get(targetRecordId);
    const sources = getSourcesFromEntry(entry);
    return sources ? Array.from(sources) : [];
}

// Get hybrid data for a combined item target
export function getCombinedHybridData(targetRecordId) {
    const state = deps.getState();
    if (!state.session.combinedItems) return null;

    const entry = state.session.combinedItems.get(targetRecordId);
    if (!entry || entry instanceof Set) return null;
    return entry.hybridData || null;
}

/**
 * Create a collage image from multiple item images using Canvas.
 * Collects images from all items involved in a merge (target + sources),
 * draws them into a grid layout on a canvas, and uploads the result to Cloudinary.
 * @param {string} targetRecordId - The target (combined) item's record ID
 * @param {string[]} sourceRecordIds - Array of source item record IDs
 * @returns {Promise<string|null>} - The collage image URL, or null on failure
 */
export async function createCollageImage(targetRecordId, sourceRecordIds) {
    const state = deps.getState();
    try {
        // Gather all record IDs involved (target + sources)
        const allRecordIds = [targetRecordId, ...sourceRecordIds];
        const imageUrls = [];

        // Fetch the first image for each item
        for (const recordId of allRecordIds) {
            const record = deps.getRecordById(recordId);
            if (!record) continue;

            let urls = [];
            // Check the presentation image cache first
            if (deps.itemImagesCache.has(recordId)) {
                urls = deps.itemImagesCache.get(recordId).images || [];
            } else {
                const result = await deps.api.fetchImagesForRecord(record, state.records.all, new Map());
                urls = result.imageUrls || [];
            }

            if (urls.length > 0) {
                imageUrls.push(urls[0]);
            }
        }

        if (imageUrls.length < 2) {
            deps.log('Presentation', 'Not enough images to create collage');
            return null;
        }

        // Load all images
        const loadImage = (url) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
                img.src = url;
            });
        };

        const images = [];
        for (const url of imageUrls) {
            try {
                const img = await loadImage(url);
                images.push(img);
            } catch (e) {
                deps.log('Presentation', `Skipping image that failed to load: ${e.message}`);
            }
        }

        if (images.length < 2) {
            deps.log('Presentation', 'Not enough images loaded for collage');
            return null;
        }

        // Create canvas and draw collage
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const collageSize = 800;
        canvas.width = collageSize;
        canvas.height = collageSize;

        // Fill background
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, collageSize, collageSize);

        const count = images.length;
        const gap = 4;

        // Determine grid layout based on image count
        let cols, rows;
        if (count === 2) {
            cols = 2; rows = 1;
        } else if (count === 3) {
            cols = 2; rows = 2; // 2 top, 1 bottom centered
        } else {
            cols = 2; rows = 2; // 2x2 grid for 4+
        }

        const cellWidth = (collageSize - gap * (cols + 1)) / cols;
        const cellHeight = (collageSize - gap * (rows + 1)) / rows;

        // Draw images into grid cells
        const drawImageCover = (img, x, y, w, h) => {
            const imgRatio = img.width / img.height;
            const cellRatio = w / h;
            let sx, sy, sw, sh;
            if (imgRatio > cellRatio) {
                sh = img.height;
                sw = sh * cellRatio;
                sx = (img.width - sw) / 2;
                sy = 0;
            } else {
                sw = img.width;
                sh = sw / cellRatio;
                sx = 0;
                sy = (img.height - sh) / 2;
            }
            // Draw with rounded corners
            ctx.save();
            const radius = 8;
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + w - radius, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
            ctx.lineTo(x + w, y + h - radius);
            ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
            ctx.lineTo(x + radius, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.clip();
            ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
            ctx.restore();
        };

        if (count === 2) {
            // Side by side, full height
            const h = collageSize - gap * 2;
            drawImageCover(images[0], gap, gap, cellWidth, h);
            drawImageCover(images[1], gap * 2 + cellWidth, gap, cellWidth, h);
        } else if (count === 3) {
            // 2 on top, 1 centered on bottom
            drawImageCover(images[0], gap, gap, cellWidth, cellHeight);
            drawImageCover(images[1], gap * 2 + cellWidth, gap, cellWidth, cellHeight);
            const bottomX = (collageSize - cellWidth) / 2;
            drawImageCover(images[2], bottomX, gap * 2 + cellHeight, cellWidth, cellHeight);
        } else {
            // 2x2 grid (use first 4 images)
            const displayImages = images.slice(0, 4);
            for (let i = 0; i < displayImages.length; i++) {
                const col = i % 2;
                const row = Math.floor(i / 2);
                const x = gap + col * (cellWidth + gap);
                const y = gap + row * (cellHeight + gap);
                drawImageCover(displayImages[i], x, y, cellWidth, cellHeight);
            }
        }

        // Convert canvas to data URL
        const collageDataUrl = canvas.toDataURL('image/jpeg', 0.85);

        // Upload to Cloudinary via existing endpoint
        const uploadResponse = await fetch('/.netlify/functions/cloudinary-upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                imageData: collageDataUrl,
                sessionId: state.session?.id || 'unsaved',
                itemId: `collage-${targetRecordId}`
            })
        });

        if (!uploadResponse.ok) {
            deps.log('Presentation', `Collage upload failed: ${uploadResponse.status}`);
            return null;
        }

        const uploadResult = await uploadResponse.json();
        if (uploadResult.success && uploadResult.secure_url) {
            deps.log('Presentation', `Collage created and uploaded: ${uploadResult.secure_url}`);
            return uploadResult.secure_url;
        }

        return null;
    } catch (error) {
        deps.log('Presentation', `Error creating collage: ${error.message}`);
        return null;
    }
}

// Check if an item belongs to a related group
export function getItemGroup(recordId) {
    const state = deps.getState();
    if (!state.session.relatedGroups) return null;

    return state.session.relatedGroups.find(g => {
        const items = Array.isArray(g) ? g : (g.items || []);
        return items.includes(recordId);
    });
}

// Open the group detail modal for an options group by its ID
export function openGroupDetailModal(groupId) {
    const state = deps.getState();
    if (!state.session.relatedGroups) return;
    const group = state.session.relatedGroups.find(g => g.id === groupId);
    if (!group) {
        deps.log('Presentation', `Group not found for ID: ${groupId}`);
        return;
    }
    deps.showGroupDetailModal(group, state.records.all);
}

// Uncombine a single source item from a hybrid merge
export async function uncombineSource(sourceId, targetId) {
    const state = deps.getState();
    if (!state.session.combinedItems) return;

    const entry = state.session.combinedItems.get(targetId);
    if (!entry) return;

    const sources = getSourcesFromEntry(entry);
    if (!sources.has(sourceId)) return;

    sources.delete(sourceId);

    const sourceRecord = deps.getRecordById(sourceId);
    const sourceName = sourceRecord?.fields?.Name || 'Item';

    // If no more sources, remove the combined entry entirely
    if (sources.size === 0) {
        state.session.combinedItems.delete(targetId);
    }

    deps.showToast(`"${sourceName}" separated from hybrid`, 'success');

    await deps.renderAllItems();
    deps.generateItemsSummary();
    deps.updatePresentationHeaderTotal();
    deps.triggerSave();
}

// Uncombine all sources from a hybrid merge (split all apart)
export async function uncombineAll(targetId) {
    const state = deps.getState();
    if (!state.session.combinedItems) return;

    state.session.combinedItems.delete(targetId);

    deps.showToast('Hybrid split apart', 'success');

    await deps.renderAllItems();
    deps.generateItemsSummary();
    deps.updatePresentationHeaderTotal();
    deps.triggerSave();
}

// Remove an item from its related group
export async function removeFromGroup(recordId, groupId) {
    const state = deps.getState();
    if (!state.session.relatedGroups) return;

    const groupIndex = state.session.relatedGroups.findIndex(g => g.id === groupId);
    if (groupIndex === -1) return;

    const group = state.session.relatedGroups[groupIndex];
    const items = Array.isArray(group) ? group : (group.items || []);
    const itemIndex = items.indexOf(recordId);
    if (itemIndex === -1) return;

    items.splice(itemIndex, 1);

    const record = deps.getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // If group has fewer than 2 items, dissolve it
    if (items.length < 2) {
        state.session.relatedGroups.splice(groupIndex, 1);
        deps.showToast(`"${itemName}" removed, group dissolved`, 'success');
    } else {
        if (!Array.isArray(group)) {
            group.items = items;
        }
        deps.showToast(`"${itemName}" removed from group`, 'success');
    }

    await deps.renderAllItems();
    deps.generateItemsSummary();
    deps.updatePresentationHeaderTotal();
    deps.triggerSave();
}

// Dissolve an entire related group (ungroup all items)
export async function dissolveGroup(groupId) {
    const state = deps.getState();
    if (!state.session.relatedGroups) return;

    const groupIndex = state.session.relatedGroups.findIndex(g => g.id === groupId);
    if (groupIndex === -1) return;

    const group = state.session.relatedGroups[groupIndex];
    const groupName = group.name || 'Group';
    state.session.relatedGroups.splice(groupIndex, 1);

    deps.showToast(`"${groupName}" dissolved`, 'success');

    await deps.renderAllItems();
    deps.generateItemsSummary();
    deps.updatePresentationHeaderTotal();
    deps.triggerSave();
}

// =============================================================================
// GROUP 7 - Dialog Listeners
// =============================================================================

export function initializeMergeDialogListeners() {
    // Close button
    const closeBtn = document.getElementById('merge-dialog-close');
    if (closeBtn) closeBtn.addEventListener('click', closeMergeDialog);

    // Cancel button
    const cancelBtn = document.getElementById('merge-dialog-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', closeMergeDialog);

    // Combine option button (As Hybrid)
    const combineBtn = document.getElementById('merge-option-combine');
    if (combineBtn) combineBtn.addEventListener('click', handleMergeCombine);

    // Group option button (As Options)
    const groupBtn = document.getElementById('merge-option-group');
    if (groupBtn) groupBtn.addEventListener('click', handleMergeGroup);

    // Tab switching
    const optionsTab = document.getElementById('merge-tab-options');
    const hybridTab = document.getElementById('merge-tab-hybrid');
    const optionsContent = document.getElementById('merge-tab-content-options');
    const hybridContent = document.getElementById('merge-tab-content-hybrid');

    if (optionsTab) {
        optionsTab.addEventListener('click', () => {
            optionsTab.classList.add('active');
            hybridTab?.classList.remove('active');
            optionsContent?.classList.add('active');
            hybridContent?.classList.remove('active');
        });
    }
    if (hybridTab) {
        hybridTab.addEventListener('click', () => {
            hybridTab.classList.add('active');
            optionsTab?.classList.remove('active');
            hybridContent?.classList.add('active');
            optionsContent?.classList.remove('active');
        });
    }

    // Close on backdrop click
    if (mergeOptionsDialog) {
        mergeOptionsDialog.addEventListener('click', (e) => {
            if (e.target === mergeOptionsDialog) {
                closeMergeDialog();
            }
        });
    }
}
