/**
 * Drag and Drop System
 * Drag-and-drop reordering, radial menu, bucket hover/drop handling,
 * item ordering, and swipe-to-action-menu functionality.
 * Extracted from presentation.js — Phase 4B modularization.
 */

// Dependencies injected via init()
let deps = {};

// ─── State variables ────────────────────────────────────────────────────────

let sortableInstance = null;
let dragBucketsEl = null;
let dragBucketGoal = null;
let dragBucketIdeas = null;
let dragBucketLock = null;
let dragBucketMerge = null;
let dragBucketArchive = null;
let dragBucketDelete = null;
let dragBucketReactions = null;
let dragBucketQuickComment = null;
let dragBucketCustomComment = null;
let dragBucketCompleted = null;
let dragMergeIndicator = null;
let dragActionTooltip = null;
let currentHoveredAction = null;
let isDragging = false;
let dragDelayTimer = null;
let currentDraggedItem = null;
let currentDraggedRecordId = null;
let cachedBucketRects = null;
let hoveredReactionEmoji = null;
let hoveredQuickComment = null;
let potentialMergeTarget = null;
let potentialMergeZone = null;
const DRAG_DELAY_MS = 300;

// Merge dwell-time tracking
let mergeHoverItemId = null;
let mergeHoverStartTime = null;
let mergeHoverTimer = null;
let mergeHoverZone = null;
const MERGE_DWELL_TIME_MS = 250;

// Radial menu state
let radialMenuContainer = null;
let radialMenuActive = false;
let radialMenuOrigin = { x: 0, y: 0 };
let initialTouchPoint = null;
let directionDetected = false;
const DIRECTION_THRESHOLD = 15;
const RADIAL_MENU_RADIUS = 200;
const RADIAL_MENU_RADIUS_MOBILE = 160;

const MERGE_ZONE_THRESHOLD = 0.15;
let mergeHoverDebugCounter = 0;
let dragMoveDebugCounter = 0;
let bucketHoverDebugCounter = 0;
let dragRafPending = false;
let lastDragEvent = null;

// Radial event handler refs
let radialTouchMoveHandler = null;
let radialTouchEndHandler = null;
let radialMouseMoveHandler = null;
let radialMouseUpHandler = null;
let radialListenersAttached = false;

// ─── init / cleanup ─────────────────────────────────────────────────────────

/**
 * Initialize the drag-and-drop module.
 * @param {Object} injectedDeps - All required dependencies
 */
export function init(injectedDeps) {
    deps = injectedDeps;
}

/**
 * Set DOM element references used by this module.
 * @param {Object} elements - Map of element name → DOM element
 */
export function setElements(elements) {
    if (elements.dragBucketsEl !== undefined) dragBucketsEl = elements.dragBucketsEl;
    if (elements.dragBucketGoal !== undefined) dragBucketGoal = elements.dragBucketGoal;
    if (elements.dragBucketIdeas !== undefined) dragBucketIdeas = elements.dragBucketIdeas;
    if (elements.dragBucketLock !== undefined) dragBucketLock = elements.dragBucketLock;
    if (elements.dragBucketMerge !== undefined) dragBucketMerge = elements.dragBucketMerge;
    if (elements.dragBucketArchive !== undefined) dragBucketArchive = elements.dragBucketArchive;
    if (elements.dragBucketDelete !== undefined) dragBucketDelete = elements.dragBucketDelete;
    if (elements.dragBucketReactions !== undefined) dragBucketReactions = elements.dragBucketReactions;
    if (elements.dragBucketQuickComment !== undefined) dragBucketQuickComment = elements.dragBucketQuickComment;
    if (elements.dragBucketCustomComment !== undefined) dragBucketCustomComment = elements.dragBucketCustomComment;
    if (elements.dragBucketCompleted !== undefined) dragBucketCompleted = elements.dragBucketCompleted;
    if (elements.dragMergeIndicator !== undefined) dragMergeIndicator = elements.dragMergeIndicator;
    if (elements.dragActionTooltip !== undefined) dragActionTooltip = elements.dragActionTooltip;
    if (elements.radialMenuContainer !== undefined) radialMenuContainer = elements.radialMenuContainer;
}

/**
 * Cleanup the module (alias for cleanupItemDragDrop).
 */
export function cleanup() {
    cleanupItemDragDrop();

    // Comprehensive UI teardown (mirrors what hidePresentationView previously did inline)
    if (dragBucketsEl) {
        dragBucketsEl.classList.remove('buckets-shown');
        dragBucketsEl.classList.remove('drag-active');
        dragBucketsEl.classList.remove('radial-mode');
        dragBucketsEl.style.display = 'none';
        dragBucketsEl.style.visibility = 'hidden';
    }
    if (radialMenuContainer) {
        radialMenuContainer.classList.remove('radial-active');
        radialMenuActive = false;
        cleanupRadialEventListeners();
    }
    const itineraryItemsListEl = deps.getItineraryItemsListEl ? deps.getItineraryItemsListEl() : null;
    if (itineraryItemsListEl && radialListenersAttached) {
        itineraryItemsListEl.removeEventListener('touchstart', handleRadialTouchStart);
        itineraryItemsListEl.removeEventListener('mousedown', handleRadialMouseDown);
        radialListenersAttached = false;
    }
    if (dragActionTooltip) {
        dragActionTooltip.style.display = 'none';
        dragActionTooltip.style.visibility = 'hidden';
    }
    if (dragMergeIndicator) {
        dragMergeIndicator.style.display = 'none';
        dragMergeIndicator.style.visibility = 'hidden';
    }

    // Note: Do NOT reset deps here. The presentation view may be hidden and
    // re-shown without re-calling init() (e.g., syncUiWithUrl closes all overlays
    // before re-opening the target view). Wiping deps causes initializeItemDragDrop
    // and attachRadialMenuListeners to fail on re-show because deps.getItineraryItemsListEl
    // becomes undefined. deps are only set via init() when ensureDOMElements() runs fresh.
}

/**
 * Make drag buckets visible when presentation view activates (grayed out, colorize on drag).
 */
export function activateBuckets() {
    if (dragBucketsEl) {
        dragBucketsEl.style.display = '';
        dragBucketsEl.style.visibility = '';
        dragBucketsEl.classList.add('buckets-shown');
    }
}

// ─── Getters / Setters ──────────────────────────────────────────────────────

export function getIsDragging() {
    return isDragging;
}

export function getCurrentDraggedRecordId() {
    return currentDraggedRecordId;
}

export function getRadialListenersAttached() {
    return radialListenersAttached;
}

export function setRadialListenersAttached(value) {
    radialListenersAttached = value;
}

/**
 * Exit merge-target state: clear visuals and deactivate.
 */
export function exitMergeTargetState() {
    clearMergeTarget();
    deactivateMergeTarget();
}

// ─── SortableJS Loader ──────────────────────────────────────────────────────

async function loadSortableJS() {
    if (window.Sortable) {
        return window.Sortable;
    }
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/Sortable.min.js';
        script.onload = () => resolve(window.Sortable);
        script.onerror = () => reject(new Error('Failed to load SortableJS'));
        document.head.appendChild(script);
    });
}

// ─── Initialize drag-and-drop for plan items ────────────────────────────────

export async function initializeItemDragDrop() {
    const itineraryItemsListEl = deps.getItineraryItemsListEl ? deps.getItineraryItemsListEl() : null;
    if (!itineraryItemsListEl) {
        console.warn('[DragDrop] initializeItemDragDrop: itineraryItemsListEl not available, aborting');
        return;
    }

    // Destroy existing sortable instance if exists
    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }

    // Detect board view (compact card grid mode)
    const isBoardView = itineraryItemsListEl.classList.contains('board-view');

    try {
        const Sortable = await loadSortableJS();

        sortableInstance = new Sortable(itineraryItemsListEl, {
            animation: 200,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            // In board view, drag compact cards directly; in list view, drag item sections
            draggable: isBoardView ? '.compact-card' : '.itinerary-item-section',
            delay: 300, // Increased delay - action menu activates on long-press drag
            delayOnTouchOnly: true,
            touchStartThreshold: 20, // Require more movement before starting SortableJS drag

            onStart: function(evt) {

                // If the action menu is already open, cancel the SortableJS drag
                if (deps.isActionMenuOpen()) {
                    console.log('[Drag DEBUG] onStart: action menu is open, cancelling drag');
                    evt.preventDefault && evt.preventDefault();
                    return false;
                }

                isDragging = true;
                console.log('[Drag DEBUG] onStart: drag started, isDragging=true');
                // Add sorting class to board for CSS pointer-events optimization
                if (isBoardView) itineraryItemsListEl.classList.add('is-sorting');
                // Reset debug counters
                dragMoveDebugCounter = 0;
                bucketHoverDebugCounter = 0;
                mergeHoverDebugCounter = 0; // Reset merge debug counter too

                // Track the currently dragged item
                currentDraggedItem = evt.item;

                // In board view, record ID is on the card itself; in list view, it's on the article child
                if (isBoardView) {
                    currentDraggedRecordId = evt.item.dataset.recordId || evt.item.dataset.groupId || null;
                } else {
                    const article = evt.item.querySelector('.itinerary-item');
                    currentDraggedRecordId = article?.dataset.recordId;
                }
                console.log('[Drag DEBUG] onStart: recordId:', currentDraggedRecordId);

                // For SortableJS drag (long press/hold), open the unified action menu at the item position
                const itemRect = evt.item.getBoundingClientRect();
                const centerX = itemRect.left + itemRect.width / 2;
                const centerY = itemRect.top + itemRect.height / 2;
                console.log('[Drag DEBUG] onStart: opening ActionMenu at centerX:', centerX, 'centerY:', centerY, 'for recordId:', currentDraggedRecordId);
                deps.openActionMenu(currentDraggedRecordId, {
                    x: centerX,
                    y: centerY,
                    onAction: handleActionMenuAction
                });

                // Add document-level listeners to track drag position
                document.addEventListener('mousemove', handleDragMove);
                document.addEventListener('touchmove', handleDragMove, { passive: true });
            },

            onMove: function(evt) {
                // During SortableJS move, check for merge targets
                // (the action menu handles its own interaction - no drag-bucket hover needed)
                const clientX = evt.originalEvent?.touches ? evt.originalEvent.touches[0].clientX : evt.originalEvent?.clientX;
                const clientY = evt.originalEvent?.touches ? evt.originalEvent.touches[0].clientY : evt.originalEvent?.clientY;
                if (clientX !== undefined && clientY !== undefined) {
                    checkMergeTargetHover(clientX, clientY);
                }
            },

            onEnd: function(evt) {
                try {
                    // Capture merge target ID and zone (string) before clearing state
                    const capturedMergeTargetId = potentialMergeTarget ? potentialMergeTarget.recordId : null;
                    const capturedMergeZone = potentialMergeZone;

                    isDragging = false;
                    console.log('[Drag DEBUG] onEnd: drag ended, isDragging=false');
                    // Remove sorting class from board
                    if (isBoardView) itineraryItemsListEl.classList.remove('is-sorting');
                    clearTimeout(dragDelayTimer);

                    // Clear merge hover state - but we've already captured the ID and zone above
                    clearMergeHoverState();
                    deactivateMergeTarget();

                    // Remove document-level listeners
                    document.removeEventListener('mousemove', handleDragMove);
                    document.removeEventListener('touchmove', handleDragMove);

                    // Close the action menu if it's open (user dropped without selecting an action)
                    if (deps.isActionMenuOpen()) {
                        console.log('[Drag DEBUG] onEnd: closing action menu (drag ended without action selection)');
                        deps.closeActionMenu();
                    }

                    // Legacy bucket drop check - pass captured merge target ID and zone
                    const droppedOnBucket = checkBucketDrop(evt.originalEvent, evt.item, capturedMergeTargetId, capturedMergeZone);
                    if (droppedOnBucket) {
                        console.log('[Drag DEBUG] onEnd: item dropped on bucket');
                        hideDragBuckets();
                        return; // Item was moved to bucket, don't update order
                    }
                    hideDragBuckets();

                    // Update the order in state
                    updateItemOrder();

                    // Refresh vitality flow lines after reorder
                    deps.refreshFlowLines();

                } catch (error) {
                    console.error('[Presentation] Exception in drag onEnd:', error);
                    // Clean up anyway
                    isDragging = false;
                    if (isBoardView) itineraryItemsListEl.classList.remove('is-sorting');
                    if (deps.isActionMenuOpen()) deps.closeActionMenu();
                    hideDragBuckets();
                }
            }
        });

        deps.log('Presentation', `Drag-drop initialized for plan items (${isBoardView ? 'board' : 'list'} view)`);
    } catch (error) {
        console.error('[Presentation] Failed to initialize drag-drop:', error);
    }
}

// ─── Drag zone positioning ──────────────────────────────────────────────────

function updateDragZonePositions(itemRect) {
    if (!dragBucketsEl || !isDragging) return;

    const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
    const rightZone = dragBucketsEl.querySelector('.drag-zone-right');

    if (!leftZone || !rightZone) return;

    // Get zone dimensions for calculations
    const leftZoneRect = leftZone.getBoundingClientRect();
    const rightZoneRect = rightZone.getBoundingClientRect();
    const leftZoneWidth = leftZoneRect.width || 120;
    const rightZoneWidth = rightZoneRect.width || 120;

    // Determine if we're on mobile (< 768px)
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isMobile = viewportWidth < 768;

    // Fixed positioning: zones stay at screen edges, vertically centered
    const edgeGap = isMobile ? 4 : 8;
    const leftX = edgeGap;
    const rightX = viewportWidth - rightZoneWidth - edgeGap;

    // Vertically centered in viewport
    const leftZoneHeight = leftZoneRect.height || 400;
    const rightZoneHeight = rightZoneRect.height || 300;

    const topPadding = 60; // Leave room for header
    const bottomPadding = 20;

    let leftTop = (viewportHeight - leftZoneHeight) / 2;
    let rightTop = (viewportHeight - rightZoneHeight) / 2;

    // Constrain to viewport bounds with padding
    if (leftTop < topPadding) leftTop = topPadding;
    if (leftTop + leftZoneHeight > viewportHeight - bottomPadding) {
        leftTop = viewportHeight - leftZoneHeight - bottomPadding;
    }

    if (rightTop < topPadding) rightTop = topPadding;
    if (rightTop + rightZoneHeight > viewportHeight - bottomPadding) {
        rightTop = viewportHeight - rightZoneHeight - bottomPadding;
    }

    // Apply fixed positions (not relative to item)
    leftZone.style.left = `${leftX}px`;
    leftZone.style.top = `${leftTop}px`;
    leftZone.style.transform = 'none';

    rightZone.style.left = `${rightX}px`;
    rightZone.style.right = 'auto';
    rightZone.style.top = `${rightTop}px`;
    rightZone.style.transform = 'none';
}

// ─── Show drag buckets during drag ──────────────────────────────────────────

function showDragBuckets() {

    // Safety check: Only show drag buckets if presentation view is active
    if (!document.body.classList.contains('presentation-active')) {
        return;
    }

    if (dragBucketsEl && isDragging) {

        // Add drag-active class - let CSS handle the styling
        dragBucketsEl.classList.add('drag-active');

        const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
        const rightZone = dragBucketsEl.querySelector('.drag-zone-right');

        // Apply inline styles - position zones at fixed screen edges
        const applyZoneStyles = () => {
            // Determine if we're on mobile (< 768px)
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const isMobile = viewportWidth < 768;
            const bucketSize = isMobile ? '72px' : '88px';
            const zoneGap = isMobile ? 8 : 10;
            const zonePadding = isMobile ? 12 : 16;

            // Base styles for both zones
            const baseZoneStyles = `
                position: fixed !important;
                display: flex !important;
                flex-direction: column !important;
                gap: ${zoneGap}px !important;
                opacity: 1 !important;
                visibility: visible !important;
                pointer-events: auto !important;
                z-index: 5100 !important;
                background: rgba(0, 0, 0, 0.75) !important;
                padding: ${zonePadding}px !important;
                border-radius: 20px !important;
                max-height: 70vh !important;
                overflow-y: auto !important;
            `;

            if (leftZone) {
                leftZone.style.cssText = '';
                leftZone.setAttribute('style', baseZoneStyles);
            }
            if (rightZone) {
                rightZone.style.cssText = '';
                rightZone.setAttribute('style', baseZoneStyles);
            }

            // Force visibility on all bucket elements with increased size
            const allBuckets = dragBucketsEl.querySelectorAll('.drag-bucket');
            allBuckets.forEach((bucket) => {
                bucket.style.opacity = '0.95';
                bucket.style.visibility = 'visible';
                bucket.style.display = 'flex';
                bucket.style.pointerEvents = 'auto';
                bucket.style.width = bucketSize;
                bucket.style.height = bucketSize;
                bucket.style.minWidth = bucketSize;
                bucket.style.minHeight = bucketSize;
            });

            // Fixed positioning: zones at screen edges, vertically centered
            updateDragZonePositions(null);
        };

        // Apply immediately
        applyZoneStyles();

        // Force a repaint/reflow to ensure styles are applied
        void dragBucketsEl.offsetHeight;

        // Build cached bucket rects after layout settles
        requestAnimationFrame(() => {
            cacheBucketRects();
        });
    }
}

// ─── Cache bucket bounding rects ────────────────────────────────────────────

function cacheBucketRects() {
    const bucketEls = [
        { el: dragBucketGoal, name: 'goal' },
        { el: dragBucketIdeas, name: 'ideas' },
        { el: dragBucketLock, name: 'lock' },
        { el: dragBucketMerge, name: 'merge' },
        { el: dragBucketArchive, name: 'archive' },
        { el: dragBucketDelete, name: 'delete' },
        { el: dragBucketReactions, name: 'reactions' },
        { el: dragBucketQuickComment, name: 'quick-comment' },
        { el: dragBucketCustomComment, name: 'custom-comment' },
        { el: dragBucketCompleted, name: 'completed' }
    ];
    cachedBucketRects = new Map();
    for (const { el, name } of bucketEls) {
        if (el) {
            cachedBucketRects.set(name, el.getBoundingClientRect());
        }
    }
}

// ─── Hide drag buckets ──────────────────────────────────────────────────────

export function hideDragBuckets() {
    cachedBucketRects = null;
    if (dragBucketsEl) {
        dragBucketsEl.classList.remove('drag-active');

        const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
        const rightZone = dragBucketsEl.querySelector('.drag-zone-right');

        // Clear all inline styles from zones by resetting cssText
        if (leftZone) leftZone.style.cssText = '';
        if (rightZone) rightZone.style.cssText = '';

        // Clear inline styles from all bucket elements
        const allBuckets = dragBucketsEl.querySelectorAll('.drag-bucket');
        allBuckets.forEach(bucket => {
            bucket.style.cssText = '';
        });
        // Remove drag-over from all left side buckets
        if (dragBucketGoal) dragBucketGoal.classList.remove('drag-over');
        if (dragBucketIdeas) dragBucketIdeas.classList.remove('drag-over');
        if (dragBucketLock) dragBucketLock.classList.remove('drag-over');
        if (dragBucketMerge) dragBucketMerge.classList.remove('drag-over');
        if (dragBucketArchive) dragBucketArchive.classList.remove('drag-over');
        if (dragBucketDelete) dragBucketDelete.classList.remove('drag-over');
        // Remove drag-over from all right side buckets
        if (dragBucketReactions) dragBucketReactions.classList.remove('drag-over');
        if (dragBucketQuickComment) dragBucketQuickComment.classList.remove('drag-over');
        if (dragBucketCustomComment) dragBucketCustomComment.classList.remove('drag-over');
        if (dragBucketCompleted) dragBucketCompleted.classList.remove('drag-over');
        // Clear reaction/comment hover states
        clearReactionHoverStates();
        clearQuickCommentHoverStates();
        // Hide merge indicator with robust cssText override (same pattern as radial menu fix)
        if (dragMergeIndicator) {
            dragMergeIndicator.style.cssText = `
                position: fixed !important;
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            `;
        }
        // Remove any insertion zone indicators
        const insertionIndicators = document.querySelectorAll('.insertion-zone-indicator');
        insertionIndicators.forEach(ind => ind.remove());
        // Hide action tooltip
        hideDragActionTooltip();
        // Clear merge target
        clearMergeTarget();
    }
    // Reset drag state
    currentDraggedItem = null;
    currentDraggedRecordId = null;
    hoveredReactionEmoji = null;
    hoveredQuickComment = null;
    potentialMergeTarget = null;
    potentialMergeZone = null;
}

// =============================================================================
// RADIAL MENU FUNCTIONS
// =============================================================================

// Initialize radial menu with cloned bucket elements
export function initializeRadialMenu() {
    if (!radialMenuContainer || !dragBucketsEl) {
        console.error('[Radial Menu] Missing radialMenuContainer or dragBucketsEl', {
            radialMenuContainer: !!radialMenuContainer,
            dragBucketsEl: !!dragBucketsEl,
        });
        return;
    }

    // Get all buckets from left and right zones
    const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
    const rightZone = dragBucketsEl.querySelector('.drag-zone-right');

    if (!leftZone || !rightZone) {
        console.error('[Radial Menu] Missing drag zones');
        return;
    }

    // Clear any existing cloned buckets (keep center indicator and direction indicator)
    const existingBuckets = radialMenuContainer.querySelectorAll('.drag-bucket');
    existingBuckets.forEach(b => b.remove());

    // Clone buckets from both zones
    const leftBuckets = leftZone.querySelectorAll('.drag-bucket');
    const rightBuckets = rightZone.querySelectorAll('.drag-bucket');

    // Combine all buckets - left buckets first, then right buckets
    const allBuckets = [...leftBuckets, ...rightBuckets];
    const totalBuckets = allBuckets.length;

    console.log('[Radial Menu] Initializing with', totalBuckets, 'buckets');

    // Clone each bucket and position in radial layout
    allBuckets.forEach((bucket, index) => {
        const clone = bucket.cloneNode(true);
        // Remove original ID to avoid duplicates
        clone.id = 'radial-' + clone.id;
        // Store original bucket data attribute
        clone.dataset.originalBucket = bucket.id;
        radialMenuContainer.appendChild(clone);
    });

    console.log('[Radial Menu] Initialized successfully');
}

// Position radial menu buckets around the origin point
function positionRadialBuckets() {
    if (!radialMenuContainer) return;

    const buckets = radialMenuContainer.querySelectorAll('.drag-bucket');
    const totalBuckets = buckets.length;

    if (totalBuckets === 0) return;

    // Determine radius based on viewport
    const isMobile = window.innerWidth < 768;
    const radius = isMobile ? RADIAL_MENU_RADIUS_MOBILE : RADIAL_MENU_RADIUS;
    const bucketSize = isMobile ? 112 : 128; // 2x size
    const halfBucket = bucketSize / 2;

    // Calculate angle step - distribute buckets around a circle
    // Start from top (- PI/2) and go clockwise
    const startAngle = -Math.PI / 2;
    const angleStep = (2 * Math.PI) / totalBuckets;

    buckets.forEach((bucket, index) => {
        const angle = startAngle + (index * angleStep);
        const x = Math.cos(angle) * radius - halfBucket;
        const y = Math.sin(angle) * radius - halfBucket;

        bucket.style.left = `${x}px`;
        bucket.style.top = `${y}px`;
    });
}

// Show radial menu at a specific point (DEPRECATED - migrated to unified Action Menu)
function showRadialMenu(x, y, itemElement) {
    console.log('[Radial Menu] showRadialMenu called but DEPRECATED - use openActionMenu() instead');
    return; // No-op: old radial menu replaced by unified Action Menu

    if (!dragBucketsEl || !radialMenuContainer) {
        console.error('[Radial Menu] Missing required elements');
        return;
    }

    // Safety check: Only show if presentation view is active
    if (!document.body.classList.contains('presentation-active')) {
        console.warn('[Radial Menu] Aborted - presentation view is not active');
        return;
    }

    // Check if radial menu has buckets, re-initialize if needed
    let bucketCount = radialMenuContainer.querySelectorAll('.drag-bucket').length;
    if (bucketCount === 0) {
        console.log('[Radial Menu] No buckets found, initializing...');
        initializeRadialMenu();
        bucketCount = radialMenuContainer.querySelectorAll('.drag-bucket').length;
    }
    console.log('[Radial Menu] Bucket count in radial container:', bucketCount);

    // Store origin point
    radialMenuOrigin = { x, y };
    radialMenuActive = true;

    // Get viewport dimensions for boundary checks
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isMobile = viewportWidth < 768;
    const radius = isMobile ? RADIAL_MENU_RADIUS_MOBILE : RADIAL_MENU_RADIUS;
    const margin = radius + 40;

    // Constrain position to keep radial menu within viewport
    let constrainedX = Math.max(margin, Math.min(viewportWidth - margin, x));
    let constrainedY = Math.max(margin + 50, Math.min(viewportHeight - margin, y));

    // === ROBUST VISIBILITY FIX ===
    // Move radial menu container to document.body to bypass any parent CSS inheritance issues
    if (radialMenuContainer.parentElement !== document.body) {
        document.body.appendChild(radialMenuContainer);
        console.log('[Radial Menu] Moved container to document.body');
    }

    // Apply comprehensive inline styles to container - use cssText for maximum override
    radialMenuContainer.style.cssText = `
        position: fixed !important;
        left: ${constrainedX}px !important;
        top: ${constrainedY}px !important;
        width: 0 !important;
        height: 0 !important;
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        z-index: 99999 !important;
        pointer-events: auto !important;
        overflow: visible !important;
        clip: auto !important;
        clip-path: none !important;
        transform: none !important;
    `;

    // Show the drag buckets container in radial mode
    dragBucketsEl.classList.add('buckets-shown', 'drag-active', 'radial-mode');

    // Hide the left/right drag zones when showing radial menu
    const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
    const rightZone = dragBucketsEl.querySelector('.drag-zone-right');
    if (leftZone) {
        leftZone.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important;';
    }
    if (rightZone) {
        rightZone.style.cssText = 'display: none !important; visibility: hidden !important; opacity: 0 !important;';
    }

    // Position buckets in radial layout
    positionRadialBuckets();

    // Activate the radial menu with robust bucket visibility
    requestAnimationFrame(() => {
        radialMenuContainer.classList.add('radial-active');

        // Get viewport info for bucket sizing
        const isMobileBucket = window.innerWidth < 768;
        const bucketSize = isMobileBucket ? 112 : 128; // 2x size

        // FORCE bucket visibility with comprehensive inline styles
        const radialBuckets = radialMenuContainer.querySelectorAll('.drag-bucket');
        console.log('[Radial Menu] Activating', radialBuckets.length, 'buckets');

        radialBuckets.forEach((bucket) => {
            // Get the original bucket class for background color
            const originalId = bucket.dataset.originalBucket || bucket.id.replace('radial-', '');

            // Determine background gradient based on bucket type
            let background = 'rgba(0, 0, 0, 0.85)'; // default
            if (originalId.includes('goal')) background = 'linear-gradient(135deg, rgba(255, 193, 7, 0.95), rgba(255, 160, 0, 0.95))';
            else if (originalId.includes('ideas')) background = 'linear-gradient(135deg, rgba(156, 39, 176, 0.95), rgba(123, 31, 162, 0.95))';
            else if (originalId.includes('lock')) background = 'linear-gradient(135deg, rgba(33, 150, 243, 0.95), rgba(25, 118, 210, 0.95))';
            else if (originalId.includes('merge')) background = 'linear-gradient(135deg, rgba(0, 150, 136, 0.95), rgba(0, 121, 107, 0.95))';
            else if (originalId.includes('archive')) background = 'linear-gradient(135deg, rgba(108, 117, 125, 0.95), rgba(73, 80, 87, 0.95))';
            else if (originalId.includes('delete')) background = 'linear-gradient(135deg, rgba(220, 53, 69, 0.95), rgba(176, 42, 55, 0.95))';
            else if (originalId.includes('reactions')) background = 'linear-gradient(135deg, rgba(76, 175, 80, 0.95), rgba(56, 142, 60, 0.95))';
            else if (originalId.includes('quick-comment')) background = 'linear-gradient(135deg, rgba(0, 188, 212, 0.95), rgba(0, 151, 167, 0.95))';
            else if (originalId.includes('custom-comment')) background = 'linear-gradient(135deg, rgba(233, 30, 99, 0.95), rgba(194, 24, 91, 0.95))';
            else if (originalId.includes('completed')) background = 'linear-gradient(135deg, rgba(76, 175, 80, 0.95), rgba(46, 125, 50, 0.95))';

            // Get existing position from CSS
            const currentStyle = bucket.getAttribute('style') || '';
            const leftMatch = currentStyle.match(/left:\s*(-?[\d.]+px)/);
            const topMatch = currentStyle.match(/top:\s*(-?[\d.]+px)/);
            const left = leftMatch ? leftMatch[1] : '0px';
            const top = topMatch ? topMatch[1] : '0px';

            // Apply comprehensive inline styles to FORCE visibility
            bucket.style.cssText = `
                position: absolute !important;
                left: ${left} !important;
                top: ${top} !important;
                width: ${bucketSize}px !important;
                height: ${bucketSize}px !important;
                min-width: ${bucketSize}px !important;
                min-height: ${bucketSize}px !important;
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                visibility: visible !important;
                opacity: 0.95 !important;
                pointer-events: auto !important;
                z-index: 100000 !important;
                transform: scale(1) !important;
                background: ${background} !important;
                border: 2px solid rgba(255, 255, 255, 0.5) !important;
                border-radius: 50% !important;
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4) !important;
                cursor: pointer !important;
                transition: transform 0.15s ease-out, opacity 0.15s ease-out, box-shadow 0.15s ease-out !important;
            `;
        });

        // Log final state for debugging
        const firstBucket = radialMenuContainer.querySelector('.drag-bucket');
        if (firstBucket) {
            const rect = firstBucket.getBoundingClientRect();
            console.log('[Radial Menu] First bucket state:', {
                visible: rect.width > 0 && rect.height > 0,
                rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) }
            });
        }
    });

    // Store the item element for later - support both board view (compact cards) and list view
    if (itemElement) {
        if (itemElement.classList.contains('compact-card')) {
            // Board view: record ID is directly on the compact card
            currentDraggedRecordId = itemElement.dataset.recordId || itemElement.dataset.groupId || null;
        } else {
            // List view: record ID is on the .itinerary-item article child
            const article = itemElement.querySelector('.itinerary-item');
            currentDraggedRecordId = article?.dataset.recordId;
        }
        currentDraggedItem = itemElement;
    }

    console.log('[Radial Menu] Shown at', constrainedX, constrainedY, 'for item:', currentDraggedRecordId);
}

// Hide radial menu (DEPRECATED - migrated to unified Action Menu)
function hideRadialMenu() {
    console.log('[Radial Menu] hideRadialMenu called but DEPRECATED - use closeActionMenu() instead');
    // Still clean up radial state in case it was somehow left active
    if (!radialMenuContainer) {
        return;
    }

    radialMenuActive = false;

    // Remove radial-active class for animation
    radialMenuContainer.classList.remove('radial-active');

    // Reset container inline styles completely
    radialMenuContainer.style.cssText = '';

    // Restore left/right zones (clear inline styles so CSS controls them)
    if (dragBucketsEl) {
        const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
        const rightZone = dragBucketsEl.querySelector('.drag-zone-right');
        if (leftZone) leftZone.style.cssText = '';
        if (rightZone) rightZone.style.cssText = '';

        // Remove radial mode classes after a short delay for animation
        setTimeout(() => {
            dragBucketsEl.classList.remove('buckets-shown', 'drag-active', 'radial-mode');
        }, 150);
    }

    // Clear hover states on radial buckets and reset their inline styles
    const buckets = radialMenuContainer.querySelectorAll('.drag-bucket');
    buckets.forEach(b => {
        b.classList.remove('drag-over');
        b.style.cssText = '';
    });

    // Reset state
    initialTouchPoint = null;
    directionDetected = false;
    hoveredReactionEmoji = null;
    hoveredQuickComment = null;

    // Clear merge hover state
    clearMergeHoverState();
    deactivateMergeTarget();

    console.log('[Radial Menu] Hidden');
}

// Update radial direction indicator
function updateRadialDirectionIndicator(currentX, currentY) {
    if (!radialMenuContainer || !radialMenuActive) return;

    const indicator = radialMenuContainer.querySelector('.radial-direction-indicator');
    if (!indicator) return;

    // Calculate angle from center to current position
    const dx = currentX - radialMenuOrigin.x;
    const dy = currentY - radialMenuOrigin.y;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90; // Convert to degrees, offset by 90

    indicator.style.transform = `rotate(${angle}deg)`;
}

// Check if pointer is over a radial bucket and update hover state
function checkRadialBucketHover(clientX, clientY) {
    if (!radialMenuContainer || !radialMenuActive) return null;

    const buckets = radialMenuContainer.querySelectorAll('.drag-bucket');
    let hoveredBucket = null;

    buckets.forEach(bucket => {
        const rect = bucket.getBoundingClientRect();
        const isOver = isPointInRect(clientX, clientY, rect);

        if (isOver) {
            bucket.classList.add('drag-over');
            hoveredBucket = bucket;

            // Dynamic scaling effect - make hovered bucket larger
            bucket.style.transform = 'scale(1.25)';
            bucket.style.zIndex = '100001';
            bucket.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.5)';

            // Check for reaction/comment sub-options
            const reactionOptions = bucket.querySelectorAll('.reaction-option');
            const commentOptions = bucket.querySelectorAll('.quick-comment-option');

            reactionOptions.forEach(opt => {
                const optRect = opt.getBoundingClientRect();
                if (isPointInRect(clientX, clientY, optRect)) {
                    opt.classList.add('drag-over');
                    hoveredReactionEmoji = opt.dataset.emoji;
                } else {
                    opt.classList.remove('drag-over');
                }
            });

            commentOptions.forEach(opt => {
                const optRect = opt.getBoundingClientRect();
                if (isPointInRect(clientX, clientY, optRect)) {
                    opt.classList.add('drag-over');
                    hoveredQuickComment = opt.dataset.comment;
                } else {
                    opt.classList.remove('drag-over');
                }
            });
        } else {
            bucket.classList.remove('drag-over');
            // Reset scaling for non-hovered buckets
            bucket.style.transform = 'scale(1)';
            bucket.style.zIndex = '100000';
            bucket.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.4)';
            // Clear sub-options
            const options = bucket.querySelectorAll('.reaction-option, .quick-comment-option');
            options.forEach(opt => opt.classList.remove('drag-over'));
        }
    });

    return hoveredBucket;
}

// ─── Action Menu Handler ────────────────────────────────────────────────────

/**
 * Handle action menu selections from the unified Action Menu component.
 * Maps action IDs to the same functions used by drag bucket drops.
 * @param {string} actionId - The action ID (e.g. 'goal', 'archive', 'delete')
 * @param {string} recordId - The item record ID
 * @param {string} [context] - The action menu context ('plan-item', 'chat', 'image', 'variation')
 */
export function handleActionMenuAction(actionId, recordId, context) {
    if (!recordId) {
        console.log('[ActionMenu Handler DEBUG] handleActionMenuAction called with no recordId, returning');
        return;
    }
    console.log('[ActionMenu Handler DEBUG] Action:', actionId, 'for item:', recordId, 'context:', context || 'plan-item');

    switch (actionId) {
        case 'goal':
            deps.setItemAsGoal(recordId);
            break;
        case 'ideas':
            deps.moveToIdeas(recordId);
            break;
        case 'lock':
            deps.lockItem(recordId);
            break;
        case 'merge':
            console.log('[ActionMenu Handler DEBUG] MERGE action triggered, calling enterMergeMode...');
            console.log('[ActionMenu Handler DEBUG]   recordId:', recordId);
            deps.enterMergeMode(recordId);
            break;
        case 'archive':
            deps.archiveItem(recordId);
            break;
        case 'delete':
            deps.deleteItem(recordId);
            break;
        case 'quick-comment':
            deps.openCustomCommentDialog(recordId);
            break;
        case 'completed':
            deps.completeItem(recordId);
            break;
        default:
            console.log('[ActionMenu Handler] Unknown action:', actionId);
    }
}

// ─── Radial bucket drop ─────────────────────────────────────────────────────

// Handle radial bucket selection (on release)
// capturedMergeTargetId can be either a string (recordId) or an object with recordId property
function handleRadialBucketDrop(clientX, clientY, capturedMergeTargetId = null, capturedMergeZone = null) {
    // Normalize to string: accept both string ID or object with recordId
    const mergeTargetId = typeof capturedMergeTargetId === 'string'
        ? capturedMergeTargetId
        : (capturedMergeTargetId?.recordId || null);

    if (!radialMenuActive || !currentDraggedRecordId) {
        hideRadialMenu();
        return false;
    }

    const hoveredBucket = checkRadialBucketHover(clientX, clientY);

    // If no bucket is hovered but we have a merge target, trigger merge directly based on zone
    if (!hoveredBucket && mergeTargetId) {
        const sourceId = currentDraggedRecordId;
        const mergeZone = capturedMergeZone || 'hybrid';
        hideRadialMenu();
        currentDraggedItem = null;
        currentDraggedRecordId = null;
        deps.executeMergeByZone(sourceId, mergeTargetId, mergeZone);
        return true;
    }

    if (!hoveredBucket) {
        hideRadialMenu();
        return false;
    }

    // Get the bucket type from the original bucket ID
    const originalBucketId = hoveredBucket.dataset.originalBucket;
    console.log('[Radial Menu] Dropped on bucket:', originalBucketId, 'for item:', currentDraggedRecordId);

    // Execute the action based on bucket type
    switch (originalBucketId) {
        case 'drag-bucket-goal':
            deps.setItemAsGoal(currentDraggedRecordId);
            break;
        case 'drag-bucket-ideas':
            deps.moveToIdeas(currentDraggedRecordId);
            break;
        case 'drag-bucket-lock':
            deps.lockItem(currentDraggedRecordId);
            break;
        case 'drag-bucket-merge':
            deps.enterMergeMode(currentDraggedRecordId);
            break;
        case 'drag-bucket-archive':
            deps.archiveItem(currentDraggedRecordId);
            break;
        case 'drag-bucket-delete':
            deps.deleteItem(currentDraggedRecordId);
            break;
        case 'drag-bucket-reactions':
            if (hoveredReactionEmoji) {
                deps.addReactionToItem(currentDraggedRecordId, hoveredReactionEmoji);
            } else {
                deps.addReactionToItem(currentDraggedRecordId, '\u{1F44D}'); // Default reaction
            }
            break;
        case 'drag-bucket-quick-comment':
            if (hoveredQuickComment) {
                deps.addQuickCommentToItem(currentDraggedRecordId, hoveredQuickComment);
            } else {
                deps.addQuickCommentToItem(currentDraggedRecordId, 'Great idea'); // Default comment
            }
            break;
        case 'drag-bucket-custom-comment':
            deps.openCustomCommentDialog(currentDraggedRecordId);
            break;
        case 'drag-bucket-completed':
            deps.completeItem(currentDraggedRecordId);
            break;
        default:
            console.log('[Radial Menu] Unknown bucket:', originalBucketId);
    }

    hideRadialMenu();
    currentDraggedItem = null;
    currentDraggedRecordId = null;
    return true;
}

// ─── Pointer / Touch event handlers ─────────────────────────────────────────

function handleItemPointerDown(event, itemElement) {
    // Only handle if presentation is active
    if (!document.body.classList.contains('presentation-active')) {
        return;
    }

    // Get initial touch/click coordinates
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    initialTouchPoint = { x: clientX, y: clientY };
    directionDetected = false;

    // Set up move and end handlers
    if (event.touches) {
        // Touch events
        radialTouchMoveHandler = (e) => handleItemPointerMove(e, itemElement);
        radialTouchEndHandler = (e) => handleItemPointerUp(e);

        document.addEventListener('touchmove', radialTouchMoveHandler, { passive: false });
        document.addEventListener('touchend', radialTouchEndHandler);
        document.addEventListener('touchcancel', radialTouchEndHandler);
    } else {
        // Mouse events
        radialMouseMoveHandler = (e) => handleItemPointerMove(e, itemElement);
        radialMouseUpHandler = (e) => handleItemPointerUp(e);

        document.addEventListener('mousemove', radialMouseMoveHandler);
        document.addEventListener('mouseup', radialMouseUpHandler);
    }
}

function handleItemPointerMove(event, itemElement) {
    if (!initialTouchPoint) return;

    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    // If the action menu is already open, no further swipe detection needed
    if (deps.isActionMenuOpen()) {
        return;
    }

    // Calculate movement delta
    const deltaX = Math.abs(clientX - initialTouchPoint.x);
    const deltaY = Math.abs(clientY - initialTouchPoint.y);

    // Check if we've moved enough to determine direction
    if (!directionDetected && (deltaX > DIRECTION_THRESHOLD || deltaY > DIRECTION_THRESHOLD)) {
        directionDetected = true;

        if (deltaX > deltaY) {
            // Horizontal movement - open the unified action menu

            // Prevent default to stop scrolling
            if (event.cancelable) {
                event.preventDefault();
            }

            // Determine the record ID from the swiped element
            let swipedRecordId = null;
            if (itemElement) {
                if (itemElement.classList.contains('compact-card')) {
                    swipedRecordId = itemElement.dataset.recordId || itemElement.dataset.groupId || null;
                } else {
                    const article = itemElement.querySelector('.itinerary-item');
                    swipedRecordId = article?.dataset.recordId;
                }
            }

            if (swipedRecordId) {
                deps.openActionMenu(swipedRecordId, {
                    x: initialTouchPoint.x,
                    y: initialTouchPoint.y,
                    onAction: handleActionMenuAction
                });
            }

            cleanupRadialEventListeners();
        } else {
            // Vertical movement - allow scrolling, cleanup handlers
            cleanupRadialEventListeners();
        }
    }
}

function handleItemPointerUp(event) {
    // The action menu handles its own click-based interactions,
    // so no bucket-drop logic is needed here anymore.

    cleanupRadialEventListeners();
}

function cleanupRadialEventListeners() {
    if (radialTouchMoveHandler) {
        document.removeEventListener('touchmove', radialTouchMoveHandler);
        radialTouchMoveHandler = null;
    }
    if (radialTouchEndHandler) {
        document.removeEventListener('touchend', radialTouchEndHandler);
        document.removeEventListener('touchcancel', radialTouchEndHandler);
        radialTouchEndHandler = null;
    }
    if (radialMouseMoveHandler) {
        document.removeEventListener('mousemove', radialMouseMoveHandler);
        radialMouseMoveHandler = null;
    }
    if (radialMouseUpHandler) {
        document.removeEventListener('mouseup', radialMouseUpHandler);
        radialMouseUpHandler = null;
    }

    initialTouchPoint = null;
    directionDetected = false;
}

// Attach swipe/pointer event listeners for action menu activation on itinerary items
export function attachRadialMenuListeners() {
    const itineraryItemsListEl = deps.getItineraryItemsListEl ? deps.getItineraryItemsListEl() : null;
    if (!itineraryItemsListEl) {
        return;
    }
    // Guard: only attach once since we use event delegation on a persistent element
    if (radialListenersAttached) {
        return;
    }
    radialListenersAttached = true;

    // Use event delegation on the items list
    itineraryItemsListEl.addEventListener('touchstart', handleRadialTouchStart, { passive: true });
    itineraryItemsListEl.addEventListener('mousedown', handleRadialMouseDown);
}

export function handleRadialTouchStart(event) {
    // Board view: target compact cards; List view: target item sections
    const targetEl = event.target.closest('.compact-card') || event.target.closest('.itinerary-item-section');
    if (targetEl) {
        handleItemPointerDown(event, targetEl);
    }
}

export function handleRadialMouseDown(event) {
    // Only handle left mouse button
    if (event.button !== 0) return;

    // Board view: target compact cards; List view: target item sections
    const targetEl = event.target.closest('.compact-card') || event.target.closest('.itinerary-item-section');
    if (targetEl) {
        handleItemPointerDown(event, targetEl);
    }
}

// =============================================================================
// END RADIAL MENU FUNCTIONS (DEPRECATED — migrated to unified Action Menu)
// =============================================================================

// ─── Hover state helpers ────────────────────────────────────────────────────

// Clear reaction option hover states
function clearReactionHoverStates() {
    if (dragBucketReactions) {
        const options = dragBucketReactions.querySelectorAll('.reaction-option');
        options.forEach(opt => opt.classList.remove('drag-over'));
    }
    hoveredReactionEmoji = null;
}

// Clear quick comment option hover states
function clearQuickCommentHoverStates() {
    if (dragBucketQuickComment) {
        const options = dragBucketQuickComment.querySelectorAll('.quick-comment-option');
        options.forEach(opt => opt.classList.remove('drag-over'));
    }
    hoveredQuickComment = null;
}

// Clear merge target highlight
function clearMergeTarget() {
    const currentTarget = document.querySelector('.itinerary-item-section.merge-target, .compact-card.merge-target');
    if (currentTarget) {
        currentTarget.classList.remove('merge-target', 'merge-target-hybrid', 'merge-target-options');
        // Clear inline styles applied for merge highlighting
        currentTarget.style.outline = '';
        currentTarget.style.outlineOffset = '';
        currentTarget.style.background = '';
        currentTarget.style.zIndex = '';
        // Clear sub-zone highlights (list view)
        const header = currentTarget.querySelector('.item-accordion-header');
        const content = currentTarget.querySelector('.item-accordion-content');
        if (header) { header.style.background = ''; header.style.borderRadius = ''; }
        if (content) { content.style.background = ''; content.style.borderRadius = ''; }
        // Clear sub-zone highlights (board view)
        const photoEl = currentTarget.querySelector('.compact-card-photo');
        const bodyEl = currentTarget.querySelector('.compact-card-body');
        if (photoEl) { photoEl.style.background = ''; }
        if (bodyEl) { bodyEl.style.background = ''; }
    }
    potentialMergeTarget = null;
    potentialMergeZone = null;
}

// Helper to check if point is within a rect
function isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// ─── Bucket hover / drop ────────────────────────────────────────────────────

// Check if pointer is over a bucket and update hover state
function checkBucketHover(event) {

    if (!dragBucketsEl || !isDragging) {
        return;
    }

    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    // All buckets to check with their display info
    const buckets = [
        { el: dragBucketGoal, name: 'goal', icon: '\u2B50', label: 'Set as Goal' },
        { el: dragBucketIdeas, name: 'ideas', icon: '\u{1F4A1}', label: 'Move to Ideas' },
        { el: dragBucketLock, name: 'lock', icon: '\u{1F512}', label: 'Lock Item' },
        { el: dragBucketMerge, name: 'merge', icon: '\u{1F517}', label: 'Merge Item' },
        { el: dragBucketArchive, name: 'archive', icon: '\u{1F4E6}', label: 'Archive Item' },
        { el: dragBucketDelete, name: 'delete', icon: '\u{1F5D1}\uFE0F', label: 'Delete Item' },
        { el: dragBucketReactions, name: 'reactions', icon: '\u{1F44D}', label: 'Add Reaction' },
        { el: dragBucketQuickComment, name: 'quick-comment', icon: '\u{1F4AC}', label: 'Quick Comment' },
        { el: dragBucketCustomComment, name: 'custom-comment', icon: '\u270F\uFE0F', label: 'Add Comment' },
        { el: dragBucketCompleted, name: 'completed', icon: '\u2713', label: 'Mark Done' }
    ];

    let isOverAnyBucket = false;
    let hoveredBucket = null;

    buckets.forEach((bucket) => {
        const { el, name } = bucket;
        if (el) {
            // Use cached rects when available (buckets are fixed during drag)
            const rect = cachedBucketRects?.get(name) || el.getBoundingClientRect();
            const isOver = isPointInRect(clientX, clientY, rect);
            el.classList.toggle('drag-over', isOver);

            if (isOver) {
                isOverAnyBucket = true;
                hoveredBucket = bucket;
                // Special handling for reaction and quick comment buckets
                if (name === 'reactions') {
                    checkReactionOptionHover(clientX, clientY);
                } else if (name === 'quick-comment') {
                    checkQuickCommentOptionHover(clientX, clientY);
                }
            }
        }
    });

    // Update action tooltip
    updateDragActionTooltip(clientX, clientY, hoveredBucket, isOverAnyBucket);

    // If not over any bucket, check for potential merge target
    if (!isOverAnyBucket && currentDraggedRecordId) {
        checkMergeTargetHover(clientX, clientY);
    } else {
        clearMergeTarget();
        if (dragMergeIndicator) {
            // Use robust hide pattern
            dragMergeIndicator.style.cssText = `
                position: fixed !important;
                display: none !important;
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            `;
        }
    }
}

// ─── Drag action tooltip ────────────────────────────────────────────────────

// Update the drag action tooltip based on current position
function updateDragActionTooltip(clientX, clientY, hoveredBucket, isOverAnyBucket) {
    if (!dragActionTooltip) return;

    // Safety check: Only show tooltip if presentation view is active
    if (!document.body.classList.contains('presentation-active')) {
        hideDragActionTooltip();
        return;
    }

    // Position tooltip near cursor (offset to avoid finger/cursor)
    const tooltipOffset = 25;
    dragActionTooltip.style.left = `${clientX + tooltipOffset}px`;
    dragActionTooltip.style.top = `${clientY - tooltipOffset}px`;
    dragActionTooltip.style.display = 'flex';
    dragActionTooltip.style.visibility = 'visible';

    // Get tooltip elements
    const iconEl = dragActionTooltip.querySelector('.tooltip-icon');
    const textEl = dragActionTooltip.querySelector('.tooltip-text');

    // Remove all action classes
    const actionClasses = [
        'action-goal', 'action-ideas', 'action-lock', 'action-merge',
        'action-archive', 'action-delete', 'action-reactions',
        'action-quick-comment', 'action-custom-comment', 'action-completed',
        'action-merge', 'action-neutral'
    ];
    dragActionTooltip.classList.remove(...actionClasses);

    if (hoveredBucket && isOverAnyBucket) {
        // Show the action for the hovered bucket
        currentHoveredAction = hoveredBucket.name;
        dragActionTooltip.classList.add(`action-${hoveredBucket.name}`);

        // Special handling for reactions with specific emoji
        if (hoveredBucket.name === 'reactions' && hoveredReactionEmoji) {
            if (iconEl) iconEl.textContent = hoveredReactionEmoji;
            if (textEl) textEl.textContent = `React with ${hoveredReactionEmoji}`;
        } else if (hoveredBucket.name === 'quick-comment' && hoveredQuickComment) {
            if (iconEl) iconEl.textContent = '\u{1F4AC}';
            if (textEl) textEl.textContent = `"${hoveredQuickComment}"`;
        } else {
            if (iconEl) iconEl.textContent = hoveredBucket.icon;
            if (textEl) textEl.textContent = hoveredBucket.label;
        }
    } else if (potentialMergeTarget) {
        // Show merge action
        currentHoveredAction = 'merge';
        dragActionTooltip.classList.add('action-merge');
        if (iconEl) iconEl.textContent = '\u{1F517}';
        if (textEl) textEl.textContent = 'Merge Items';
    } else {
        // Default neutral state - drag to edges hint
        currentHoveredAction = null;
        dragActionTooltip.classList.add('action-neutral');
        if (iconEl) iconEl.textContent = '\u2194';
        if (textEl) textEl.textContent = 'Drag to sides for actions';
    }
}

// Hide the drag action tooltip
function hideDragActionTooltip() {
    if (dragActionTooltip) {
        dragActionTooltip.style.display = 'none';
        dragActionTooltip.style.visibility = 'hidden';
        dragActionTooltip.classList.remove(
            'action-goal', 'action-ideas', 'action-lock', 'action-merge',
            'action-archive', 'action-delete', 'action-reactions',
            'action-quick-comment', 'action-custom-comment', 'action-completed',
            'action-merge', 'action-neutral'
        );
    }
    currentHoveredAction = null;
}

// ─── Reaction / quick comment option hover ──────────────────────────────────

// Check if hovering over a specific reaction emoji option
function checkReactionOptionHover(clientX, clientY) {
    if (!dragBucketReactions) return;

    const options = dragBucketReactions.querySelectorAll('.reaction-option');
    let foundHover = false;

    options.forEach(opt => {
        const rect = opt.getBoundingClientRect();
        const isOver = isPointInRect(clientX, clientY, rect);
        opt.classList.toggle('drag-over', isOver);
        if (isOver) {
            hoveredReactionEmoji = opt.dataset.emoji;
            foundHover = true;
        }
    });

    if (!foundHover) {
        hoveredReactionEmoji = null;
    }
}

// Check if hovering over a specific quick comment option
function checkQuickCommentOptionHover(clientX, clientY) {
    if (!dragBucketQuickComment) return;

    const options = dragBucketQuickComment.querySelectorAll('.quick-comment-option');
    let foundHover = false;

    options.forEach(opt => {
        const rect = opt.getBoundingClientRect();
        const isOver = isPointInRect(clientX, clientY, rect);
        opt.classList.toggle('drag-over', isOver);
        if (isOver) {
            hoveredQuickComment = opt.dataset.comment;
            foundHover = true;
        }
    });

    if (!foundHover) {
        hoveredQuickComment = null;
    }
}

// ─── Merge target hover ─────────────────────────────────────────────────────

// Check if hovering over another item for potential merge
// DWELL-TIME BASED MERGE: Hover over an item for MERGE_DWELL_TIME_MS to activate merge
// This works better with SortableJS since cursor position relative to items changes constantly
function checkMergeTargetHover(clientX, clientY) {
    // === MERGE ZONE DEBUG (reduced verbosity) ===
    mergeHoverDebugCounter++;

    const itineraryItemsListEl = deps.getItineraryItemsListEl();
    if (!itineraryItemsListEl) {
        return;
    }

    const state = deps.getState();
    const isBoardView = itineraryItemsListEl.classList.contains('board-view');

    // In board view, target compact cards; in list view, target item sections
    const itemSelector = isBoardView
        ? '.compact-card:not(.sortable-drag)'
        : '.itinerary-item-section:not(.sortable-drag)';
    const items = itineraryItemsListEl.querySelectorAll(itemSelector);

    let foundHoveredItem = null;
    let foundHoveredItemId = null;
    let foundHoveredZone = null; // 'hybrid' or 'options'

    items.forEach((item, index) => {
        let itemRecordId;
        if (isBoardView) {
            // Compact cards have data-record-id or data-group-id directly
            itemRecordId = item.dataset.recordId || item.dataset.groupId;
        } else {
            const article = item.querySelector('.itinerary-item');
            itemRecordId = article?.dataset.recordId;
        }

        // Don't merge with self
        if (itemRecordId === currentDraggedRecordId) {
            return;
        }

        // Don't show merge when dragging an item onto its own group
        if (itemRecordId && itemRecordId.startsWith('group-') && currentDraggedRecordId) {
            const hoveredGroup = state.session.relatedGroups?.find(g => g.id === itemRecordId);
            if (hoveredGroup) {
                const groupItems = hoveredGroup.items || [];
                if (groupItems.includes(currentDraggedRecordId)) {
                    return;
                }
            }
        }

        const rect = item.getBoundingClientRect();
        const isInBounds = isPointInRect(clientX, clientY, rect);

        if (isInBounds) {
            // Calculate where in the item the cursor is (0 = top, 1 = bottom)
            const relativeY = (clientY - rect.top) / rect.height;

            // Use a very wide merge zone - only extreme edges (15% top/bottom) are insertion zones
            // This means 70% of the item height is merge zone
            const isInMergeZone = relativeY >= MERGE_ZONE_THRESHOLD && relativeY <= (1 - MERGE_ZONE_THRESHOLD);

            if (isInMergeZone) {
                foundHoveredItem = item;
                foundHoveredItemId = itemRecordId;

                if (isBoardView) {
                    // In board view: photo area (top) = hybrid, body area (bottom) = options
                    const photoEl = item.querySelector('.compact-card-photo');
                    if (photoEl) {
                        const photoRect = photoEl.getBoundingClientRect();
                        foundHoveredZone = clientY <= photoRect.bottom ? 'hybrid' : 'options';
                    } else {
                        foundHoveredZone = relativeY < 0.5 ? 'hybrid' : 'options';
                    }
                } else {
                    // Determine which zone: header (name) = hybrid, content (description/details) = options
                    const header = item.querySelector('.item-accordion-header');
                    if (header) {
                        const headerRect = header.getBoundingClientRect();
                        if (clientY <= headerRect.bottom) {
                            foundHoveredZone = 'hybrid';
                        } else {
                            foundHoveredZone = 'options';
                        }
                    } else {
                        // Fallback: top half = hybrid, bottom half = options
                        foundHoveredZone = relativeY < 0.5 ? 'hybrid' : 'options';
                    }
                }
            }
        }
    });

    // DWELL-TIME LOGIC: Track how long we've been hovering over the same item
    if (foundHoveredItemId && foundHoveredItemId !== mergeHoverItemId) {
        // Started hovering over a new item - reset the timer
        mergeHoverItemId = foundHoveredItemId;
        mergeHoverStartTime = Date.now();
        mergeHoverZone = foundHoveredZone;

        // Clear any existing timer
        if (mergeHoverTimer) {
            clearTimeout(mergeHoverTimer);
        }

        // Set a timer to activate merge after dwell time
        mergeHoverTimer = setTimeout(() => {
            if (mergeHoverItemId === foundHoveredItemId && isDragging) {
                activateMergeTarget(foundHoveredItem, foundHoveredItemId, clientX, clientY, mergeHoverZone);
            }
        }, MERGE_DWELL_TIME_MS);

    } else if (!foundHoveredItemId) {
        // No longer hovering over any valid item - clear merge state
        clearMergeHoverState();
        deactivateMergeTarget();
    } else if (foundHoveredItemId === mergeHoverItemId && potentialMergeTarget) {
        // Still hovering over the same item and merge is active - update indicator position and zone
        if (foundHoveredZone !== potentialMergeZone) {
            // Zone changed within same item - update visual feedback
            potentialMergeZone = foundHoveredZone;
            updateMergeTargetZoneVisual(potentialMergeTarget.element, foundHoveredZone);
            updateMergeIndicatorContent(foundHoveredZone);
        }
        updateMergeIndicatorPosition(clientX, clientY);
    }
    // If still hovering over the same item but merge not yet active, the timer will handle activation
}

// Clear merge hover tracking state
function clearMergeHoverState() {
    mergeHoverItemId = null;
    mergeHoverStartTime = null;
    mergeHoverZone = null;
    if (mergeHoverTimer) {
        clearTimeout(mergeHoverTimer);
        mergeHoverTimer = null;
    }
}

// ─── Merge target activation / indicator ────────────────────────────────────

// Activate merge target with visual feedback
function activateMergeTarget(element, recordId, clientX, clientY, zone = 'hybrid') {

    // Remove highlight from any previous target (support both list and board view selectors)
    const prevTargetSelectors = '.itinerary-item-section.merge-target, .compact-card.merge-target';
    const currentTarget = document.querySelector(prevTargetSelectors);
    if (currentTarget && currentTarget !== element) {
        currentTarget.classList.remove('merge-target', 'merge-target-hybrid', 'merge-target-options');
        currentTarget.style.outline = '';
        currentTarget.style.outlineOffset = '';
        currentTarget.style.background = '';
        currentTarget.style.animation = '';
        // Clear sub-zone highlights (list view)
        const prevHeader = currentTarget.querySelector('.item-accordion-header');
        const prevContent = currentTarget.querySelector('.item-accordion-content');
        if (prevHeader) prevHeader.style.cssText = prevHeader.style.cssText.replace(/background:[^;]*;?/g, '');
        if (prevContent) prevContent.style.cssText = prevContent.style.cssText.replace(/background:[^;]*;?/g, '');
        // Clear sub-zone highlights (board view)
        const prevPhoto = currentTarget.querySelector('.compact-card-photo');
        const prevBody = currentTarget.querySelector('.compact-card-body');
        if (prevPhoto) { prevPhoto.style.background = ''; prevPhoto.style.borderRadius = ''; }
        if (prevBody) { prevBody.style.background = ''; prevBody.style.borderRadius = ''; }
    }

    // Apply merge target styling
    element.classList.add('merge-target');

    // Zone-specific colors
    const isHybrid = zone === 'hybrid';
    const color = isHybrid ? 'rgba(156, 39, 176, 0.9)' : 'rgba(76, 175, 80, 0.9)';
    const bgColor = isHybrid ? 'rgba(156, 39, 176, 0.1)' : 'rgba(76, 175, 80, 0.1)';

    element.style.cssText = element.style.cssText + `
        outline: 3px solid ${color} !important;
        outline-offset: 4px !important;
        background: ${bgColor} !important;
        position: relative !important;
        z-index: 100 !important;
    `;

    // Highlight the specific zone within the item
    updateMergeTargetZoneVisual(element, zone);

    potentialMergeTarget = { element, recordId };
    potentialMergeZone = zone;

    // Show merge indicator with zone-appropriate content
    showMergeIndicator(clientX, clientY, zone);
}

// Show the merge indicator near the cursor
function showMergeIndicator(clientX, clientY, zone = 'hybrid') {
    if (!dragMergeIndicator) {
        return;
    }

    // Move merge indicator to document.body to bypass any parent CSS inheritance issues
    if (dragMergeIndicator.parentElement !== document.body) {
        document.body.appendChild(dragMergeIndicator);
    }

    const isHybrid = zone === 'hybrid';
    const bgGrad = isHybrid
        ? 'linear-gradient(135deg, rgba(156, 39, 176, 0.95), rgba(123, 31, 162, 0.95))'
        : 'linear-gradient(135deg, rgba(76, 175, 80, 0.95), rgba(56, 142, 60, 0.95))';
    const shadowColor = isHybrid ? 'rgba(156, 39, 176, 0.5)' : 'rgba(76, 175, 80, 0.5)';

    // Apply comprehensive inline styles
    const indicatorStyles = `
        position: fixed !important;
        left: ${clientX + 20}px !important;
        top: ${clientY - 20}px !important;
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        z-index: 99998 !important;
        pointer-events: none !important;
        padding: 12px 20px !important;
        background: ${bgGrad} !important;
        border: 2px solid rgba(255, 255, 255, 0.8) !important;
        border-radius: 20px !important;
        box-shadow: 0 8px 32px ${shadowColor} !important;
        align-items: center !important;
        gap: 8px !important;
        color: white !important;
        font-weight: 600 !important;
        font-size: 14px !important;
    `;
    dragMergeIndicator.style.cssText = indicatorStyles;

    // Update indicator content based on zone
    updateMergeIndicatorContent(zone);
}

// Update merge indicator text to reflect current zone
function updateMergeIndicatorContent(zone) {
    if (!dragMergeIndicator) return;
    const isHybrid = zone === 'hybrid';

    // Check if hovering over a group card for contextual label
    const isTargetGroup = mergeHoverItemId && mergeHoverItemId.startsWith('group-');
    const isDraggedGroup = currentDraggedRecordId && currentDraggedRecordId.startsWith('group-');
    const isDraggedInGroup = currentDraggedRecordId && deps.getItemGroup(currentDraggedRecordId);

    let icon, label;
    if (isHybrid) {
        icon = '\u2728';
        label = 'Merge as Hybrid';
    } else if (isTargetGroup || isDraggedGroup || isDraggedInGroup) {
        icon = '\u{1F4C2}';
        label = 'Merge Groups';
    } else {
        icon = '\u{1F4C2}';
        label = 'Add as Option';
    }
    dragMergeIndicator.innerHTML = `<span style="font-size: 18px;">${icon}</span><span>${label}</span>`;

    // Update colors when zone changes
    const bgGrad = isHybrid
        ? 'linear-gradient(135deg, rgba(156, 39, 176, 0.95), rgba(123, 31, 162, 0.95))'
        : 'linear-gradient(135deg, rgba(76, 175, 80, 0.95), rgba(56, 142, 60, 0.95))';
    const shadowColor = isHybrid ? 'rgba(156, 39, 176, 0.5)' : 'rgba(76, 175, 80, 0.5)';
    dragMergeIndicator.style.background = bgGrad;
    dragMergeIndicator.style.boxShadow = `0 8px 32px ${shadowColor}`;
}

// Update the visual highlight on sub-zones of the merge target
function updateMergeTargetZoneVisual(element, zone) {
    const isHybrid = zone === 'hybrid';
    const activeColor = isHybrid ? 'rgba(156, 39, 176, 0.2)' : 'rgba(76, 175, 80, 0.2)';
    const outlineColor = isHybrid ? 'rgba(156, 39, 176, 0.9)' : 'rgba(76, 175, 80, 0.9)';

    // Update the outer outline color
    element.style.outline = `3px solid ${outlineColor}`;

    // Board view: photo = hybrid zone, body = options zone
    const photoEl = element.querySelector('.compact-card-photo');
    const bodyEl = element.querySelector('.compact-card-body');

    if (photoEl && bodyEl) {
        photoEl.style.background = isHybrid ? activeColor : '';
        photoEl.style.transition = 'background 0.15s ease';
        bodyEl.style.background = isHybrid ? '' : activeColor;
        bodyEl.style.transition = 'background 0.15s ease';
        return;
    }

    // List view: header = hybrid zone, content = options zone
    const header = element.querySelector('.item-accordion-header');
    const content = element.querySelector('.item-accordion-content');

    if (header) {
        header.style.background = isHybrid ? activeColor : 'transparent';
        header.style.borderRadius = '8px';
        header.style.transition = 'background 0.15s ease';
    }
    if (content) {
        content.style.background = isHybrid ? 'transparent' : activeColor;
        content.style.borderRadius = '8px';
        content.style.transition = 'background 0.15s ease';
    }
}

// Update merge indicator position while hovering
function updateMergeIndicatorPosition(clientX, clientY) {
    if (!dragMergeIndicator) return;

    // Just update the position
    dragMergeIndicator.style.left = `${clientX + 20}px`;
    dragMergeIndicator.style.top = `${clientY - 20}px`;
}

// Deactivate merge target and hide indicator
function deactivateMergeTarget() {

    // Remove merge-target class from any highlighted item (support both list and board view)
    const currentTarget = document.querySelector('.itinerary-item-section.merge-target, .compact-card.merge-target');
    if (currentTarget) {
        currentTarget.classList.remove('merge-target', 'merge-target-hybrid', 'merge-target-options');
        currentTarget.style.outline = '';
        currentTarget.style.outlineOffset = '';
        currentTarget.style.background = '';
        currentTarget.style.animation = '';
        // Clear sub-zone highlights (list view)
        const header = currentTarget.querySelector('.item-accordion-header');
        const content = currentTarget.querySelector('.item-accordion-content');
        if (header) { header.style.background = ''; header.style.borderRadius = ''; }
        if (content) { content.style.background = ''; content.style.borderRadius = ''; }
        // Clear sub-zone highlights (board view)
        const photoEl = currentTarget.querySelector('.compact-card-photo');
        const bodyEl = currentTarget.querySelector('.compact-card-body');
        if (photoEl) { photoEl.style.background = ''; }
        if (bodyEl) { bodyEl.style.background = ''; }
    }

    potentialMergeTarget = null;
    potentialMergeZone = null;

    // Hide the merge indicator
    if (dragMergeIndicator) {
        dragMergeIndicator.style.cssText = `
            position: fixed !important;
            display: none !important;
            visibility: hidden !important;
            opacity: 0 !important;
            pointer-events: none !important;
        `;
    }
}

// ─── Drag move (rAF throttled) ──────────────────────────────────────────────

// Handle mouse/touch move during drag - throttled with rAF
function handleDragMove(event) {
    dragMoveDebugCounter++;
    // Store the latest event and schedule a rAF if not already pending
    lastDragEvent = event;
    if (dragRafPending) return;
    dragRafPending = true;
    requestAnimationFrame(() => {
        dragRafPending = false;
        if (lastDragEvent) {
            checkBucketHover(lastDragEvent);
        }
    });
}

// ─── Check bucket drop ──────────────────────────────────────────────────────

// Check if item was dropped on a bucket
function checkBucketDrop(event, item, capturedMergeTargetId = null, capturedMergeZone = null) {
    // Normalize to string: accept both string ID or object with recordId
    const mergeTargetId = typeof capturedMergeTargetId === 'string'
        ? capturedMergeTargetId
        : (capturedMergeTargetId?.recordId || null);

    if (!dragBucketsEl) return false;

    const clientX = event?.changedTouches ? event.changedTouches[0].clientX : event?.clientX;
    const clientY = event?.changedTouches ? event.changedTouches[0].clientY : event?.clientY;

    // Get record ID from the dragged item
    const itemSection = item.closest('.itinerary-item-section');
    const article = itemSection?.querySelector('.itinerary-item');
    const recordId = article?.dataset.recordId;

    if (!recordId) return false;

    // Helper to check drop on bucket
    const checkDropOnBucket = (bucket) => {
        if (!bucket) return false;
        const rect = bucket.getBoundingClientRect();
        return isPointInRect(clientX, clientY, rect);
    };

    // LEFT SIDE BUCKETS (Actions)

    // Check goal bucket
    if (checkDropOnBucket(dragBucketGoal)) {
        deps.setItemAsGoal(recordId);
        return true;
    }

    // Check ideas bucket
    if (checkDropOnBucket(dragBucketIdeas)) {
        deps.moveToIdeas(recordId);
        return true;
    }

    // Check lock bucket
    if (checkDropOnBucket(dragBucketLock)) {
        deps.lockItem(recordId);
        return true;
    }

    // Check merge bucket
    if (checkDropOnBucket(dragBucketMerge)) {
        deps.enterMergeMode(recordId);
        return true;
    }

    // Check archive bucket
    if (checkDropOnBucket(dragBucketArchive)) {
        deps.archiveItem(recordId);
        return true;
    }

    // Check delete bucket
    if (checkDropOnBucket(dragBucketDelete)) {
        deps.deleteItem(recordId);
        return true;
    }

    // RIGHT SIDE BUCKETS (Reactions/Comments)

    // Check reactions bucket (check individual emoji options first)
    if (checkDropOnBucket(dragBucketReactions)) {
        // Check if dropped on a specific emoji option
        if (hoveredReactionEmoji) {
            deps.addReactionToItem(recordId, hoveredReactionEmoji);
        } else {
            // Default reaction if no specific emoji hovered
            deps.addReactionToItem(recordId, '\u{1F44D}');
        }
        return true;
    }

    // Check quick comment bucket (check individual comment options first)
    if (checkDropOnBucket(dragBucketQuickComment)) {
        if (hoveredQuickComment) {
            deps.addQuickCommentToItem(recordId, hoveredQuickComment);
        } else {
            // Default quick comment
            deps.addQuickCommentToItem(recordId, 'Great idea');
        }
        return true;
    }

    // Check custom comment bucket
    if (checkDropOnBucket(dragBucketCustomComment)) {
        deps.openCustomCommentDialog(recordId);
        return true;
    }

    // Check completed bucket
    if (checkDropOnBucket(dragBucketCompleted)) {
        deps.completeItem(recordId);
        return true;
    }

    // Check for merge (drop on another item) - execute directly based on zone
    if (mergeTargetId) {
        const mergeZone = capturedMergeZone || 'hybrid';
        deps.executeMergeByZone(recordId, mergeTargetId, mergeZone);
        return true;
    }

    return false;
}

// ─── Update item order ──────────────────────────────────────────────────────

export function updateItemOrder() {
    const itineraryItemsListEl = deps.getItineraryItemsListEl();
    if (!itineraryItemsListEl) return;

    const state = deps.getState();
    const isBoardView = itineraryItemsListEl.classList.contains('board-view');
    const newOrder = [];

    if (isBoardView) {
        // Board view: compact cards have data-record-id or data-group-id directly
        const cards = itineraryItemsListEl.querySelectorAll('.compact-card');
        cards.forEach(card => {
            const recordId = card.dataset.recordId;
            const groupId = card.dataset.groupId;
            if (recordId) {
                newOrder.push(recordId);
            } else if (groupId) {
                // For group cards, push the first member's record ID (used for ordering)
                const relatedGroups = state.session.relatedGroups || [];
                const group = relatedGroups.find(g => (g.id || '') === groupId);
                if (group) {
                    const groupItems = Array.isArray(group) ? group : (group.items || []);
                    if (groupItems.length > 0) {
                        newOrder.push(groupItems[0]);
                    }
                }
            }
        });
    } else {
        // List view: item sections with article children
        const itemSections = itineraryItemsListEl.querySelectorAll('.itinerary-item-section');
        itemSections.forEach(section => {
            const article = section.querySelector('.itinerary-item');
            if (article && article.dataset.recordId) {
                newOrder.push(article.dataset.recordId);
            }
        });
    }

    // Update state
    state.session.planItemOrder = newOrder;

    // Save session
    deps.triggerSave();

    deps.log('Presentation', `Item order updated: ${newOrder.length} items`);
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

// Cleanup drag-drop on presentation view close
export function cleanupItemDragDrop() {
    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }
    isDragging = false;
    clearTimeout(dragDelayTimer);
    document.removeEventListener('mousemove', handleDragMove);
    document.removeEventListener('touchmove', handleDragMove);
    hideDragBuckets();
}
