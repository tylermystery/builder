// Debug flag: set to true (or window.__PRES_DEBUG__) for verbose logging in hot paths
const PRES_DEBUG = typeof window !== 'undefined' && window.__PRES_DEBUG__;

console.log('[MODULE DEBUG] presentation.js module starting to load...', performance.now().toFixed(2) + 'ms');

import { state, setState, getRecordById, invalidateRecordsIndex } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, EMOJI_REACTIONS, EMOJI_CATEGORIES, REACTION_SCORES, getModalZIndex } from '../config.js';
import { updateUrl, getRecordPrice, parseOptions, flattenOptionGroups } from '../utils.js';
import { log } from '../utils/debug.js';
import { getCurrentUser, sendMessage as sendChatMessage, getReplyingToMessage, clearReplyState } from '../chat.js';
import { triggerSave } from '../events.js';
import { showDetailModal, showGroupDetailModal, showCheckoutModal, getShopSettings } from './modal.js';
import { Shader } from '../utils/shader.js';
import { showWtfPlansPanel } from './wtfPlansPanel.js';
import { updateEventPlanSection, updateIdeasCarousel } from './sidebar.js';
import { syncPlanState, registerSyncCallback, unregisterSyncCallback } from '../utils/planStateSync.js';
import { showUserModal } from '../auth.js';
import { showToast } from '../ui.js';
import { applyCloudinaryTransform } from '../utils/imageOptimizer.js';
import { resizeImageForUpload } from '../utils/imageResizer.js';
import { refreshForumData, onNewItemReceived } from './forumPanel.js';
import { initializeToastNotifications, handlePusherEvent as handleToastPusherEvent } from './toastNotifications.js';
import { initializeUnifiedChatPanel, showUnifiedChatPanel, hideUnifiedChatPanel, setUCPGetCurrentUser, setUCPSendMessage } from './unifiedChatPanel.js';
import { initVitalityUI, cleanupVitalityUI, refreshFlowLines } from '../vitality/vitalityUI.js';
import { requestVitalityRecalc, recalculateVitality } from '../vitality/vitalityEngine.js';
import { openActionMenu, closeActionMenu, isActionMenuOpen, registerActionHandler } from './actionMenu.js';

console.log('[MODULE DEBUG] presentation.js imports resolved successfully.', performance.now().toFixed(2) + 'ms');

// Quick emoji reactions available for messages and comments
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

// Task status options for plan elements
const ELEMENT_TASK_STATUS = {
    NONE: 'none',           // Default - no status set
    GTG: 'gtg',             // Good to go / confirmed
    NO_ACTION: 'no-action', // No action needed
    CHECK: 'check',         // Needs checking
    NEEDS_ATTENTION: 'needs-attention' // Needs attention
};

// Task status labels and icons
const TASK_STATUS_CONFIG = {
    [ELEMENT_TASK_STATUS.NONE]: { label: 'Set Status', icon: '○', className: 'task-status-none' },
    [ELEMENT_TASK_STATUS.GTG]: { label: 'Good to Go', icon: '✓', className: 'task-status-gtg' },
    [ELEMENT_TASK_STATUS.NO_ACTION]: { label: 'No Action', icon: '—', className: 'task-status-no-action' },
    [ELEMENT_TASK_STATUS.CHECK]: { label: 'Check', icon: '?', className: 'task-status-check' },
    [ELEMENT_TASK_STATUS.NEEDS_ATTENTION]: { label: 'Needs Attention', icon: '!', className: 'task-status-attention' }
};

// Cache for element task statuses (stored in Items with Variations JSON)
// Key format: 'item:{recordId}' or 'detail:{detailType}'
let elementTaskStatuses = new Map();

// Cache for component comments - keyed by componentType:componentId
const componentCommentsCache = new Map();

// Track message being replied to in presentation view
let presentationReplyingToMessage = null;

// Track message being edited in presentation view
let presentationEditingMessage = null;

// Track component comment reply state (separate from chat reply)
let componentCommentReplyingTo = null;

// Track scroll position before scrolling to chat
let savedScrollPosition = null;

// Flag to track if catalog needs rendering when exiting presentation view
let catalogNeedsRender = false;

/**
 * Handle sync updates from other views (e.g., catalog, event plan panel)
 * @param {string} changeType - Type of change ('itemAdded', 'itemRemoved', 'dateChanged', etc.)
 * @param {Object} summary - Current plan summary
 * @param {Object} changeData - Details about the change
 */
async function handlePlanSyncUpdate(changeType, summary, changeData) {
    switch (changeType) {
        case 'itemAdded':
        case 'itemRemoved':
        case 'itemUpdated':
            // Re-render the items list
            await renderAllItems();
            generateItemsSummary();
            // Update running total in header
            updatePresentationHeaderTotal();
            updatePlanSummaryDashboard();
            break;
        case 'dateChanged':
            // Update the date display
            renderEventHeader();
            generateHeaderSummary();
            break;
        case 'detailsChanged':
        case 'fullRefresh':
        case 'sessionLoaded':
            // Full refresh of all presentation elements
            renderEventHeader();
            await renderAllItems();
            initializeAccordions();
            // Update running total in header
            updatePresentationHeaderTotal();
            updatePlanSummaryDashboard();
            break;
        default:
    }
}

// DOM element references - lazily initialized to ensure DOM is ready
let modal = null;
let closeBtn = null;
// summaryEventNameEl removed - event name now only shown in header
let summaryEventNotesEl = null;
let summaryEventDateEl = null;
// shareBtn removed - share functionality merged into collaborators add/share button
let collaboratorsListEl = null;
let itineraryItemsListEl = null;

// Presentation header elements
let presentationBackBtn = null;
let presentationLogoContainer = null;
let presentationShopTitle = null;
let presentationEventLabel = null;
// Note: presentationHeaderShareBtn removed - share merged into collaborators add/share button

// Collaborators modal elements (carousel removed, using inline list instead)
let collaboratorsModal = null;
let collaboratorsModalClose = null;
let collaboratorsModalList = null;
let presentationAccountBtn = null;
let collaboratorsAddShareBtn = null;

// Accordion summary elements
let headerSummaryEl = null;
let itemsSummaryEl = null;

// Floating chat button (no longer used but kept for cleanup)
let floatingChatBtn = null;

// Reactions summary DOM element
let reactionsSummaryEl = null;

// Track loaded images for each item
const itemImagesCache = new Map();
// Expose to window for cross-component updates (e.g., modal cover photo changes)
window.itemImagesCache = itemImagesCache;

// Track accordion state (all sections start expanded)
const accordionState = {
    header: true,
    items: true
};

// Pusher instance for presentation chat
let presentationPusher = null;
let presentationChatChannel = null;

// Chat elements (may not exist in all presentation contexts)
let chatMessagesEl = null;
let presentationMessageInput = null;
let presentationMessageForm = null;
let presentationUserNameInput = null;
let presentationWhosHereCount = null;
let presentationWhosHereList = null;

// Search modal elements
let presentationAddBtn = null;
let presentationToggleAllBtn = null;
let presentationSearchModal = null;
let presentationSearchClose = null;
let presentationSearchInput = null;
let presentationSearchClear = null;
let presentationSearchResults = null;
let presentationRefinementChips = null;
let presentationBrowseCategories = null;

// Search modal state
let presentationSearchController = null;
let presentationSearchDebounceTimer = null;

// Drag-drop state
let sortableInstance = null;
let dragBucketsEl = null;
// Left side buckets (actions)
let dragBucketGoal = null;
let dragBucketIdeas = null;
let dragBucketLock = null;
let dragBucketMerge = null;
let dragBucketArchive = null;
let dragBucketDelete = null;
// Right side buckets (reactions/comments)
let dragBucketReactions = null;
let dragBucketQuickComment = null;
let dragBucketCustomComment = null;
let dragBucketCompleted = null;
// Merge indicator
let dragMergeIndicator = null;

// Plan focus auto-generation state
let planFocusSuggestionEl = null; // The suggestion banner element
let goalChipsContainerEl = null;  // Container for goal item chips in header area
let planFocusGenerateTimer = null; // Debounce timer for auto-generation
let pendingPlanFocusSuggestion = null; // { title, description } awaiting user confirmation
let isPlanFocusGenerating = false; // Whether we're currently generating
const PLAN_FOCUS_DEBOUNCE_MS = 2000; // Wait 2s after goal changes settle
// Merge options dialog elements
let mergeOptionsDialog = null;
let mergeDialogSourceName = null;
let mergeDialogTargetName = null;
let pendingMergeSource = null;
let pendingMergeTarget = null;
// Action tooltip
let dragActionTooltip = null;
let currentHoveredAction = null;
// Drag state
let isDragging = false;
let dragDelayTimer = null;
let currentDraggedItem = null;
let currentDraggedRecordId = null;

// Cached bucket bounding rects - rebuilt when drag buckets are shown, avoids
// calling getBoundingClientRect() on every mousemove (60fps)
let cachedBucketRects = null;
let hoveredReactionEmoji = null;
let hoveredQuickComment = null;

// Merge mode state (activated when user drops item on Merge bucket)
let isMergeModeActive = false;
let mergeModeSourceRecordId = null; // The record ID of the item being merged
let mergeModeOverlay = null;
let mergeModeBanner = null;
let potentialMergeTarget = null;
let potentialMergeZone = null; // 'hybrid' (dropped on name/header) or 'options' (dropped on content/details)
let mergeSelectedItems = []; // Multi-select: array of selected record/group IDs
let mergeSelectFab = null; // Floating action button for multi-select merge
const DRAG_DELAY_MS = 300; // Delay before drag buckets appear (ms)

// Merge dwell-time tracking - hover over an item for a moment to trigger merge
let mergeHoverItemId = null;      // The recordId of the item currently being hovered
let mergeHoverStartTime = null;   // When the hover started
let mergeHoverTimer = null;       // Timer to activate merge after dwell time
let mergeHoverZone = null;        // Which zone of the item is being hovered: 'hybrid' or 'options'
const MERGE_DWELL_TIME_MS = 250;  // How long to hover before merge activates (ms)

// Radial menu state
let radialMenuContainer = null;
let radialMenuActive = false;
let radialMenuOrigin = { x: 0, y: 0 }; // The initial touch/click point
let initialTouchPoint = null; // Track initial touch for direction detection
let directionDetected = false; // Whether we've determined horizontal vs vertical
const DIRECTION_THRESHOLD = 15; // Pixels of movement before deciding direction
const RADIAL_MENU_RADIUS = 200; // Distance from center to buckets (desktop) - 2x size
const RADIAL_MENU_RADIUS_MOBILE = 160; // Distance from center to buckets (mobile) - 2x size

// Show/hide state for archived and completed items
let showArchivedItems = true;
let showCompletedItems = true;
const PRESENTATION_SEARCH_DEBOUNCE = 300;

// --- Presentation Background Engine ---
// WebGL Shader code for the fluid effect (same as catalog background)
const vsSource = `
    attribute vec4 a_position;
    void main() {
        gl_Position = a_position;
    }
`;

const fsSource = `
    precision mediump float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform float u_energy;
    uniform float u_progress;

    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    float noise(vec2 st) {
        vec2 i = floor(st);
        vec2 f = fract(st);
        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.y * u.x;
    }

    void main() {
        vec2 st = gl_FragCoord.xy / u_resolution.xy;
        st.x *= u_resolution.x / u_resolution.y;
        vec2 centered_st = st - vec2(0.5, 0.5);
        float angle = atan(centered_st.y, centered_st.x);
        float radius = length(centered_st);
        float vortex_speed = u_time * (0.2 + u_energy * 2.0);
        float vortex_twist = u_energy * 5.0;
        float n = noise(vec2(angle * (3.0 + vortex_twist) + vortex_speed, radius * 2.0));
        float base_wave = n * 1.5 + u_progress * 10.0;
        const float PI_2_OVER_3 = 2.0943951;
        float r = pow(sin(base_wave + 0.0) * 0.5 + 0.5, 1.1) + 0.1;
        float g = pow(sin(base_wave + PI_2_OVER_3) * 0.5 + 0.5, 1.1) + 0.1;
        float b = pow(sin(base_wave + PI_2_OVER_3 * 2.0) * 0.5 + 0.5, 1.1) + 0.1;
        float vignette = 1.0 - (radius * 0.2);
        gl_FragColor = vec4(r * vignette, g * vignette, b * vignette, 1.0);
    }
`;

let presentationBgCanvas = null;
let presentationGl = null;
let presentationShader = null;
let presentationAnimationFrameId = null;
let presentationBgStartTime = 0;
let presentationBgEnergy = 0.0;
const presentationEnergyDecayRate = 0.985;

function initPresentationBackground() {
    presentationBgCanvas = document.getElementById('presentation-bg-canvas');
    if (!presentationBgCanvas) {
        log('Presentation', 'Background canvas not found');
        return false;
    }

    // Size canvas to fill the presentation view
    presentationBgCanvas.width = window.innerWidth;
    presentationBgCanvas.height = window.innerHeight;

    presentationGl = presentationBgCanvas.getContext('webgl') || presentationBgCanvas.getContext('experimental-webgl');
    if (!presentationGl) {
        log('Presentation', 'WebGL not available for presentation background');
        return false;
    }

    // Initialize shader
    presentationShader = new Shader(presentationGl, vsSource, fsSource);
    presentationBgStartTime = performance.now();

    log('Presentation', 'Background engine initialized');
    return true;
}

function startPresentationBackgroundAnimation() {
    if (!presentationGl || !presentationShader) {
        if (!initPresentationBackground()) {
            return;
        }
    }

    // Reset timing
    presentationBgStartTime = performance.now();
    presentationBgEnergy = 0.3; // Start with some energy for visual effect

    function animate(timestamp) {
        if (!modal || !modal.classList.contains('active')) {
            presentationAnimationFrameId = null;
            return;
        }

        const elapsedTime = (timestamp - presentationBgStartTime) / 1000.0;
        presentationBgEnergy *= presentationEnergyDecayRate;
        if (presentationBgEnergy < 0.01) presentationBgEnergy = 0.0;

        const currentProgress = state.ui.currentProgress || 0.5;

        presentationShader.use();
        presentationGl.uniform2f(presentationShader.getUniformLocation("u_resolution"), presentationBgCanvas.width, presentationBgCanvas.height);
        presentationGl.uniform1f(presentationShader.getUniformLocation("u_time"), elapsedTime);
        presentationGl.uniform1f(presentationShader.getUniformLocation("u_energy"), presentationBgEnergy);
        presentationGl.uniform1f(presentationShader.getUniformLocation("u_progress"), currentProgress);
        presentationGl.drawArrays(presentationGl.TRIANGLES, 0, 6);

        presentationAnimationFrameId = requestAnimationFrame(animate);
    }

    if (presentationAnimationFrameId) {
        cancelAnimationFrame(presentationAnimationFrameId);
    }
    presentationAnimationFrameId = requestAnimationFrame(animate);
    log('Presentation', 'Background animation started');
}

function stopPresentationBackgroundAnimation() {
    if (presentationAnimationFrameId) {
        cancelAnimationFrame(presentationAnimationFrameId);
        presentationAnimationFrameId = null;
        log('Presentation', 'Background animation stopped');
    }
}

function resizePresentationBackground() {
    if (presentationBgCanvas && presentationGl) {
        presentationBgCanvas.width = window.innerWidth;
        presentationBgCanvas.height = window.innerHeight;
        presentationGl.viewport(0, 0, presentationBgCanvas.width, presentationBgCanvas.height);
    }
}

function ensureDOMElements() {
    if (PRES_DEBUG) console.log('[PRESENTATION DEBUG] ensureDOMElements called, modal already set:', !!modal);
    if (modal) return true; // Already initialized

    modal = document.getElementById('presentation-modal-overlay');
    closeBtn = document.getElementById('presentation-close-btn');
    if (PRES_DEBUG) console.log('[PRESENTATION DEBUG] DOM lookup results:', {
        modal: !!modal,
        closeBtn: !!closeBtn,
        itemsList: !!document.getElementById('itinerary-items-list'),
        collaboratorsList: !!document.getElementById('itinerary-collaborators-list'),
        summaryDateEl: !!document.getElementById('summary-event-date')
    });
    // summaryEventNameEl removed - event name is now only in header
    summaryEventNotesEl = document.getElementById('summary-event-notes');
    summaryEventDateEl = document.getElementById('summary-event-date');
    // shareBtn removed - share functionality merged into collaborators add/share button
    collaboratorsListEl = document.getElementById('itinerary-collaborators-list');
    itineraryItemsListEl = document.getElementById('itinerary-items-list');

    // Presentation header elements
    presentationBackBtn = document.getElementById('presentation-back-btn');
    presentationLogoContainer = document.getElementById('presentation-logo-container');
    presentationShopTitle = document.getElementById('presentation-shop-title');
    presentationEventLabel = document.getElementById('presentation-event-label');
    // presentationHeaderShareBtn removed - share merged into collaborators add/share button

    // Plan focus elements
    planFocusSuggestionEl = document.getElementById('plan-focus-suggestion');
    goalChipsContainerEl = document.getElementById('goal-chips-container');

    // Collaborators modal elements (carousel removed, using inline list instead)
    collaboratorsModal = document.getElementById('collaborators-modal');
    collaboratorsModalClose = document.getElementById('collaborators-modal-close');
    collaboratorsModalList = document.getElementById('collaborators-modal-list');
    presentationAccountBtn = document.getElementById('presentation-account-btn');
    collaboratorsAddShareBtn = document.getElementById('collaborators-add-share-btn');

    // Floating chat button (kept for cleanup but no longer used)
    floatingChatBtn = document.getElementById('presentation-floating-chat-btn');

    // Accordion summary elements
    headerSummaryEl = document.getElementById('header-summary');
    itemsSummaryEl = document.getElementById('items-summary');

    // Search modal elements
    presentationAddBtn = document.getElementById('presentation-add-btn');
    presentationToggleAllBtn = document.getElementById('presentation-toggle-all-btn');
    presentationSearchModal = document.getElementById('presentation-search-modal');
    presentationSearchClose = document.getElementById('presentation-search-close');
    presentationSearchInput = document.getElementById('presentation-search-input');
    presentationSearchClear = document.getElementById('presentation-search-clear');
    presentationSearchResults = document.getElementById('presentation-search-results');
    presentationRefinementChips = document.getElementById('presentation-refinement-chips');
    presentationBrowseCategories = document.getElementById('presentation-browse-categories');

    // Drag-drop bucket elements
    dragBucketsEl = document.getElementById('presentation-drag-buckets');

    // CRITICAL: Move drag buckets to body level for proper fixed positioning
    // Fixed positioning doesn't work correctly when inside transformed/positioned ancestors
    if (dragBucketsEl && dragBucketsEl.parentElement !== document.body) {
        document.body.appendChild(dragBucketsEl);
    }

    // Left side buckets (actions)
    dragBucketGoal = document.getElementById('drag-bucket-goal');
    dragBucketIdeas = document.getElementById('drag-bucket-ideas');
    dragBucketLock = document.getElementById('drag-bucket-lock');
    dragBucketMerge = document.getElementById('drag-bucket-merge');
    dragBucketArchive = document.getElementById('drag-bucket-archive');
    dragBucketDelete = document.getElementById('drag-bucket-delete');
    // Right side buckets (reactions/comments)
    dragBucketReactions = document.getElementById('drag-bucket-reactions');
    dragBucketQuickComment = document.getElementById('drag-bucket-quick-comment');
    dragBucketCustomComment = document.getElementById('drag-bucket-custom-comment');
    dragBucketCompleted = document.getElementById('drag-bucket-completed');
    // Merge indicator
    dragMergeIndicator = document.getElementById('drag-merge-indicator');
    // Merge mode elements (overlay + banner for merge target selection)
    mergeModeOverlay = document.getElementById('merge-mode-overlay');
    mergeModeBanner = document.getElementById('merge-mode-banner');
    mergeSelectFab = document.getElementById('merge-select-fab');

    // Merge options dialog
    mergeOptionsDialog = document.getElementById('merge-options-dialog');
    mergeDialogSourceName = document.getElementById('merge-source-name');
    mergeDialogTargetName = document.getElementById('merge-target-name');

    console.log('[MERGE DEBUG] ── DOM INIT: Merge element caching ──');
    console.log('[MERGE DEBUG]   mergeModeOverlay:', mergeModeOverlay ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   mergeModeBanner:', mergeModeBanner ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   mergeSelectFab:', mergeSelectFab ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   mergeOptionsDialog:', mergeOptionsDialog ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   dragBucketMerge:', dragBucketMerge ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   dragMergeIndicator:', dragMergeIndicator ? '✅ FOUND' : '❌ NOT FOUND');
    if (mergeModeOverlay) {
        console.log('[MERGE DEBUG]   overlay parent:', mergeModeOverlay.parentElement?.id || mergeModeOverlay.parentElement?.tagName || 'UNKNOWN');
        console.log('[MERGE DEBUG]   overlay inDOM:', document.body.contains(mergeModeOverlay));
    }
    if (mergeModeBanner) {
        console.log('[MERGE DEBUG]   banner parent:', mergeModeBanner.parentElement?.id || mergeModeBanner.parentElement?.tagName || 'UNKNOWN');
    }

    // Action tooltip
    dragActionTooltip = document.getElementById('drag-action-tooltip');
    // Radial menu container
    radialMenuContainer = document.getElementById('radial-menu-container');

    /* DEBUG: DOM elements after init
    console.log('[Accordion DEBUG] DOM elements after init:', {
        modal: !!modal,
        closeBtn: !!closeBtn,
        headerSummaryEl: !!headerSummaryEl,
        itemsSummaryEl: !!itemsSummaryEl
    });
    */

    if (!modal) {
        console.error('[Presentation] Modal element #presentation-modal-overlay not found in DOM');
        return false;
    }

    log('Presentation', `DOM elements initialized for itinerary view`);
    return true;
}

function renderEventHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Event Itinerary';
    const goals = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);

    // Event name is now shown only in the presentation header (presentationEventLabel)
    // No longer set in summaryEventNameEl since that element was removed

    // Render goals/notes with task status button
    if (summaryEventNotesEl) {
        if (goals) {
            const goalsStatusBtn = renderTaskStatusButton('detail', 'goals');
            summaryEventNotesEl.innerHTML = `
                <div class="event-detail-with-status">
                    ${goalsStatusBtn}
                    <span class="detail-content">${escapeHtml(goals)}</span>
                </div>
            `;
        } else {
            summaryEventNotesEl.innerHTML = '';
        }
    }

    // Plan name removed from accordion title per design request
    // The first accordion panel now simply shows the list of users

    // Render date with task status button
    if (summaryEventDateEl) {
        if (dateValue) {
            const date = Array.isArray(dateValue) ? new Date(dateValue[0]) : new Date(dateValue);
            const dateStr = date.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric'
            });
            const dateStatusBtn = renderTaskStatusButton('detail', 'date');
            summaryEventDateEl.innerHTML = `
                <div class="event-detail-with-status">
                    ${dateStatusBtn}
                    <span class="detail-content">${dateStr}</span>
                </div>
            `;
        } else {
            summaryEventDateEl.innerHTML = '';
        }
    }
}

function renderPresentationHeader() {
    // Copy the shop logo from the main header
    const mainLogoContainer = document.getElementById('shop-logo-container');
    if (mainLogoContainer && presentationLogoContainer) {
        const mainLogo = mainLogoContainer.querySelector('img');
        if (mainLogo) {
            presentationLogoContainer.innerHTML = `<img src="${mainLogo.src}" alt="${mainLogo.alt || 'Logo'}">`;
        }
    }

    // Copy the shop title from the main header
    const mainShopTitle = document.getElementById('main-shop-title');
    if (mainShopTitle && presentationShopTitle) {
        presentationShopTitle.textContent = mainShopTitle.textContent;
    }

    // Set the event label in the center of the header
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'Event Plan';
    if (presentationEventLabel) {
        presentationEventLabel.textContent = eventName;
        // Show auto-generated indicator if the title was AI-generated
        const isAutoGenerated = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.TITLE_AUTO_GENERATED);
        if (isAutoGenerated) {
            presentationEventLabel.classList.add('auto-generated');
        } else {
            presentationEventLabel.classList.remove('auto-generated');
        }
    }
}

/**
 * Update the running total cost displayed in the presentation header
 */
function updatePresentationHeaderTotal() {
    const totalEl = document.getElementById('presentation-header-total');
    if (!totalEl) return;

    let subtotal = 0;
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = getRecordById(recordId);
        if (!record) return;

        // Use selections for price if available, otherwise fall back to selectedOptionIndex
        const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
            ? itemInfo.selections
            : itemInfo.selectedOptionIndex;

        let unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
        if (isNaN(unitPrice)) return;

        // Apply package discount if this item came from a package
        if (itemInfo.packageId && state.session.activePackages) {
            const packageInfo = state.session.activePackages.get(itemInfo.packageId);
            if (packageInfo && packageInfo.discount > 0) {
                unitPrice = unitPrice * (1 - packageInfo.discount / 100);
            }
        }

        // Use itemInfo.quantity for all items
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, 1);
        subtotal += unitPrice * effectiveQuantity;
    });

    // Calculate total due (subtotal minus any payments received)
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = subtotal - amountReceived;

    // Display the total - show subtotal if no payments, otherwise show total due
    if (subtotal > 0) {
        if (amountReceived > 0) {
            totalEl.textContent = `$${totalDue.toFixed(2)} due`;
        } else {
            totalEl.textContent = `$${subtotal.toFixed(2)}`;
        }
    } else {
        totalEl.textContent = '';
    }
}

/**
 * Update the presentation account button with current user info
 */
function updatePresentationAccountButton() {
    if (!presentationAccountBtn) return;

    const currentUser = getCurrentUser();

    if (currentUser && currentUser.name) {
        // Show user's name in the button
        presentationAccountBtn.textContent = currentUser.name;
        presentationAccountBtn.title = state.session.user.isAuthenticated
            ? 'Account settings'
            : 'Sign in to save your plan';
    } else {
        // Hide button if no user
        presentationAccountBtn.textContent = '';
    }
}

/**
 * Handles user login in presentation view.
 * Removes the old temporary user identity from the collaborators list and
 * re-initializes the presence channel with the authenticated user.
 */
async function handlePresentationUserLogin() {
    log('Presentation', 'User logged in - updating collaborators and presence');

    // Get the old temporary user ID from localStorage (if it exists)
    // This was the ID used before the user authenticated
    const oldTempUserId = localStorage.getItem('chatUserId');

    // If there was a temporary user ID, remove it from userProfiles
    // The authenticated user now has a new ID (starting with 'rec')
    if (oldTempUserId && state.session.userProfiles.has(oldTempUserId)) {
        log('Presentation', `Removing old temporary user from collaborators: ${oldTempUserId}`);
        state.session.userProfiles.delete(oldTempUserId);
        triggerSave();
    }

    // Update the account button with the authenticated user's name
    updatePresentationAccountButton();

    // Re-render the collaborators list (without the old temp user)
    renderCollaborators();

    // Re-initialize the presentation chat with the new authenticated identity
    // This reconnects to Pusher with the real user ID and name
    if (presentationPusher) {
        await initializePresentationChat();
    }
}

function renderCollaborators() {
    const userProfiles = state.session.userProfiles;
    const collaboratorsContainer = document.getElementById('itinerary-collaborators');

    // Update the account button with current user info
    updatePresentationAccountButton();

    if (userProfiles.size === 0) {
        // Empty state - just show the add/share button is enough
        if (collaboratorsListEl) {
            collaboratorsListEl.innerHTML = '';
        }
        return;
    }

    // Build all collaborator items (excluding current user since they have their own button)
    const collaboratorsArray = [];
    userProfiles.forEach((name, odId) => {
        const isCurrentUser = state.session.user.id === odId;
        if (!isCurrentUser) {
            collaboratorsArray.push({ name, odId });
        }
    });

    // Render as a simple inline list of names (no carousel needed)
    let html = '';
    collaboratorsArray.forEach((collab) => {
        html += `
            <button class="collaborator-name-btn" data-collaborator-id="${collab.odId}" title="${collab.name}">
                ${collab.name}
            </button>
        `;
    });

    if (collaboratorsListEl) {
        collaboratorsListEl.innerHTML = html;
    }
}

// ============================================
// INVITE MODAL FOR COLLABORATOR EMAIL INVITES
// ============================================

/**
 * Show the invite modal for sending email invitations
 */
function showInviteModal() {
    const overlay = document.getElementById('invite-modal-overlay');
    const emailInput = document.getElementById('invite-email-input');
    const statusEl = document.getElementById('invite-status');
    const sendBtn = document.getElementById('invite-send-btn');

    if (!overlay) return;

    // Reset form
    if (emailInput) emailInput.value = '';
    if (statusEl) {
        statusEl.style.display = 'none';
        statusEl.textContent = '';
    }
    if (sendBtn) sendBtn.disabled = false;

    overlay.classList.add('active');

    // Set up event listeners (only once)
    if (!overlay._listenersSetup) {
        overlay._listenersSetup = true;

        // Send invite
        const form = document.getElementById('invite-form');
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                await handleSendInvite();
            });
        }

        // Copy link button
        const copyBtn = document.getElementById('invite-copy-link-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', () => {
                const baseURL = window.location.origin + window.location.pathname;
                const sessionID = state.session.id;
                const shareURL = `${baseURL}?session=${sessionID}&view=present`;

                navigator.clipboard.writeText(shareURL).then(() => {
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => { copyBtn.textContent = 'Copy Link'; }, 1500);
                });
            });
        }

        // Cancel/close button
        const cancelBtn = document.getElementById('invite-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', hideInviteModal);
        }

        // Close on overlay click
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) hideInviteModal();
        });
    }

    if (emailInput) emailInput.focus();
}

function hideInviteModal() {
    const overlay = document.getElementById('invite-modal-overlay');
    if (overlay) overlay.classList.remove('active');
}

async function handleSendInvite() {
    const emailInput = document.getElementById('invite-email-input');
    const roleSelect = document.getElementById('invite-role-select');
    const statusEl = document.getElementById('invite-status');
    const sendBtn = document.getElementById('invite-send-btn');

    const email = emailInput?.value?.trim();
    const role = roleSelect?.value || 'Editor';

    if (!email) return;

    if (sendBtn) sendBtn.disabled = true;
    if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.textContent = 'Sending invitation...';
        statusEl.className = 'invite-status';
    }

    try {
        const currentUser = getCurrentUser();
        const eventName = state.eventDetails?.combined?.get?.('Event Name') || 'Event Plan';

        const response = await fetch('/api/send-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                sessionId: state.session.id,
                invitedBy: currentUser?.id,
                inviterName: currentUser?.name || 'Someone',
                role,
                sessionName: eventName
            })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to send invitation');
        }

        if (statusEl) {
            statusEl.textContent = `Invitation sent to ${email}`;
            statusEl.className = 'invite-status success';
        }
        if (emailInput) emailInput.value = '';
        if (sendBtn) sendBtn.disabled = false;

        log('Presentation', `Invite sent to ${email} as ${role}`);

    } catch (error) {
        if (statusEl) {
            statusEl.textContent = error.message;
            statusEl.className = 'invite-status error';
        }
        if (sendBtn) sendBtn.disabled = false;
        log('Presentation', `Invite error: ${error.message}`);
    }
}

// Note: Carousel functions (updateCarouselVisibility, carouselPrev, carouselNext) removed
// Collaborators are now displayed as a simple inline list instead of a carousel

// Show the expanded collaborators modal with full list
function showCollaboratorsModal() {
    if (!collaboratorsModal || !collaboratorsModalList) return;

    const userProfiles = state.session.userProfiles;
    const currentUserIsAuthenticated = state.session.user.isAuthenticated;

    let html = '';
    userProfiles.forEach((name, odId) => {
        const isCurrentUser = state.session.user.id === odId;
        const badge = isCurrentUser ? '<span class="collaborator-badge">You</span>' : '';
        // Unauthenticated collaborators don't have IDs starting with 'rec' (Airtable record IDs)
        const isUnauthenticatedCollaborator = !odId.startsWith('rec');
        // Only show remove button if current user is authenticated and the collaborator is unauthenticated
        const showRemoveBtn = currentUserIsAuthenticated && isUnauthenticatedCollaborator && !isCurrentUser;
        const removeBtn = showRemoveBtn
            ? `<button class="collaborator-remove-btn" data-collaborator-id="${odId}" title="Remove this collaborator">&#10005;</button>`
            : '';
        html += `
            <div class="collaborator-item${isUnauthenticatedCollaborator ? ' unauthenticated' : ''}">
                <span class="collaborator-avatar">${name.charAt(0).toUpperCase()}</span>
                <span class="collaborator-name">${name}${badge}</span>
                ${removeBtn}
            </div>
        `;
    });

    collaboratorsModalList.innerHTML = html;

    // Add event listeners for remove buttons
    collaboratorsModalList.querySelectorAll('.collaborator-remove-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const collaboratorId = btn.dataset.collaboratorId;
            await removeUnauthenticatedCollaborator(collaboratorId);
        });
    });

    collaboratorsModal.classList.add('active');
}

/**
 * Remove an unauthenticated collaborator from the plan
 * @param {string} collaboratorId - The collaborator ID to remove
 */
async function removeUnauthenticatedCollaborator(collaboratorId) {
    if (!collaboratorId) return;

    // Safety check - don't allow removing authenticated users (with 'rec' IDs)
    if (collaboratorId.startsWith('rec')) {
        console.warn('Cannot remove authenticated collaborators via this function');
        return;
    }

    const collaboratorName = state.session.userProfiles.get(collaboratorId) || 'Unknown';

    // Confirm removal
    if (!confirm(`Remove "${collaboratorName}" from this plan? Their reactions will remain but they won't appear in the team list.`)) {
        return;
    }

    // Remove from userProfiles
    state.session.userProfiles.delete(collaboratorId);

    // Trigger save to persist the change
    await triggerSave();

    // Refresh the modal to reflect the change
    showCollaboratorsModal();

    // Also refresh the main collaborators list
    renderCollaborators();

    log('Presentation', `Removed unauthenticated collaborator: ${collaboratorName} (${collaboratorId})`);
}

// Hide the expanded collaborators modal
function hideCollaboratorsModal() {
    if (collaboratorsModal) {
        collaboratorsModal.classList.remove('active');
    }
}

// ============================================
// RSVP FUNCTIONALITY FOR PRESENTATION VIEW
// ============================================

// Cache for the linked event record
let linkedEventRecord = null;

/**
 * Fetches and renders the RSVP section for events
 * This is called during presentation view initialization
 */
async function renderRsvpSection() {
    const rsvpSection = document.getElementById('presentation-rsvp-section');
    const rsvpButtonsContainer = document.getElementById('presentation-rsvp-buttons');
    const rsvpListContainer = document.getElementById('presentation-rsvp-list');

    if (!rsvpSection || !rsvpButtonsContainer || !rsvpListContainer) {
        console.log('[Presentation] RSVP section elements not found');
        return;
    }

    // Try to get eventId from URL first
    const urlParams = new URLSearchParams(window.location.search);
    const eventIdFromUrl = urlParams.get('eventId');

    // Find the linked event record
    let eventRecord = null;

    if (eventIdFromUrl) {
        // Look for the event in state.records.all
        eventRecord = getRecordById(eventIdFromUrl);
        if (!eventRecord) {
            // Try fetching the event if not in state
            try {
                const fetchedItems = await api.fetchGhostItems([eventIdFromUrl]);
                if (fetchedItems && fetchedItems.length > 0) {
                    eventRecord = fetchedItems[0];
                }
            } catch (err) {
                console.error('[Presentation] Error fetching event record:', err);
            }
        }
    }

    // If no eventId in URL, try to find it from session's LinkedItem
    if (!eventRecord && state.session.id) {
        try {
            // Fetch the session to get its LinkedItem
            const sessionData = await api.fetchSessionById(state.session.id);
            if (sessionData?.fields?.LinkedItem?.length > 0) {
                const linkedItemId = sessionData.fields.LinkedItem[0];
                eventRecord = getRecordById(linkedItemId);
                if (!eventRecord) {
                    const fetchedItems = await api.fetchGhostItems([linkedItemId]);
                    if (fetchedItems && fetchedItems.length > 0) {
                        eventRecord = fetchedItems[0];
                    }
                }
            }
        } catch (err) {
            console.error('[Presentation] Error fetching session LinkedItem:', err);
        }
    }

    // If no event record found or it's not an Event type, hide the section
    if (!eventRecord || eventRecord.fields['Item Type'] !== 'Event') {
        rsvpSection.style.display = 'none';
        linkedEventRecord = null;
        return;
    }

    // Store the event record for RSVP updates
    linkedEventRecord = eventRecord;

    // Show the RSVP section
    rsvpSection.style.display = 'block';

    // Render RSVP buttons
    renderRsvpButtons(rsvpButtonsContainer, eventRecord);

    // Render RSVP list
    await renderRsvpList(rsvpListContainer, eventRecord);
}

/**
 * Renders the RSVP buttons (Yes, Maybe, No)
 */
function renderRsvpButtons(container, eventRecord) {
    const rsvpYes = eventRecord.fields.RSVPs || [];
    const rsvpMaybe = eventRecord.fields.RSVPMaybe || [];
    const rsvpNo = eventRecord.fields.RSVPNo || [];
    const userId = state.session.user.id;

    const hasRsvpdYes = rsvpYes.includes(userId);
    const hasRsvpdMaybe = rsvpMaybe.includes(userId);
    const hasRsvpdNo = rsvpNo.includes(userId);

    container.innerHTML = `
        <div class="presentation-rsvp-label">Are you going?</div>
        <div class="rsvp-button-group">
            <button class="rsvp-btn rsvp-yes ${hasRsvpdYes ? 'active' : ''}"
                    data-record-id="${eventRecord.id}"
                    data-rsvp-type="yes">
                ${hasRsvpdYes ? "Going ✅" : "Yes"}
            </button>
            <button class="rsvp-btn rsvp-maybe ${hasRsvpdMaybe ? 'active' : ''}"
                    data-record-id="${eventRecord.id}"
                    data-rsvp-type="maybe">
                ${hasRsvpdMaybe ? "Maybe ❓" : "Maybe"}
            </button>
            <button class="rsvp-btn rsvp-no ${hasRsvpdNo ? 'active' : ''}"
                    data-record-id="${eventRecord.id}"
                    data-rsvp-type="no">
                ${hasRsvpdNo ? "Can't Go ❌" : "No"}
            </button>
        </div>
    `;
}

/**
 * Renders the RSVP list showing who has RSVPed
 */
async function renderRsvpList(container, eventRecord) {
    const rsvpYes = eventRecord.fields.RSVPs || [];
    const rsvpMaybe = eventRecord.fields.RSVPMaybe || [];
    const rsvpNo = eventRecord.fields.RSVPNo || [];

    // If no RSVPs at all, show empty state
    if (rsvpYes.length === 0 && rsvpMaybe.length === 0 && rsvpNo.length === 0) {
        container.innerHTML = '<div class="rsvp-empty-state">No responses yet</div>';
        return;
    }

    // Build initial HTML with loading placeholders
    let html = '';

    if (rsvpYes.length > 0) {
        html += `
            <div class="rsvp-list-group">
                <div class="rsvp-list-label">Going (${rsvpYes.length})</div>
                <div class="rsvp-list-items" data-rsvp-type="yes">Loading...</div>
            </div>
        `;
    }

    if (rsvpMaybe.length > 0) {
        html += `
            <div class="rsvp-list-group">
                <div class="rsvp-list-label">Maybe (${rsvpMaybe.length})</div>
                <div class="rsvp-list-items" data-rsvp-type="maybe">Loading...</div>
            </div>
        `;
    }

    if (rsvpNo.length > 0) {
        html += `
            <div class="rsvp-list-group">
                <div class="rsvp-list-label">Can't Go (${rsvpNo.length})</div>
                <div class="rsvp-list-items" data-rsvp-type="no">Loading...</div>
            </div>
        `;
    }

    container.innerHTML = html;

    // Fetch user names asynchronously and update the display
    const allUserIds = [...rsvpYes, ...rsvpMaybe, ...rsvpNo];
    try {
        const userNameMap = await api.fetchUserNamesByIds(allUserIds);

        // Helper to format names list
        const formatNames = (userIds) => {
            if (userIds.length === 0) return '';
            const names = userIds.map(id => userNameMap.get(id) || 'Guest');
            return names.join(', ');
        };

        // Update each RSVP group with actual names
        const yesEl = container.querySelector('[data-rsvp-type="yes"]');
        if (yesEl) yesEl.textContent = formatNames(rsvpYes) || 'Guest';

        const maybeEl = container.querySelector('[data-rsvp-type="maybe"]');
        if (maybeEl) maybeEl.textContent = formatNames(rsvpMaybe) || 'Guest';

        const noEl = container.querySelector('[data-rsvp-type="no"]');
        if (noEl) noEl.textContent = formatNames(rsvpNo) || 'Guest';
    } catch (err) {
        console.error('[Presentation] Error fetching RSVP user names:', err);
        // Fallback to generic text on error
        const items = container.querySelectorAll('.rsvp-list-items');
        items.forEach(el => el.textContent = 'Guests');
    }
}

/**
 * Handles RSVP button clicks in the presentation view
 */
async function handlePresentationRsvpClick(e) {
    const rsvpBtn = e.target.closest('.rsvp-btn');
    if (!rsvpBtn) return;

    // Check if we're in the presentation view
    if (!modal || !modal.classList.contains('active')) return;

    // Check if user is authenticated
    if (!state.session.user.isAuthenticated) {
        showToast('Please sign in to RSVP');
        showUserModal();
        return;
    }

    const recordId = rsvpBtn.dataset.recordId;
    const rsvpType = rsvpBtn.dataset.rsvpType;
    const userId = state.session.user.id;

    if (!recordId || !rsvpType || !linkedEventRecord) {
        console.error('[Presentation] Missing RSVP data');
        return;
    }

    // Show loading state
    const originalText = rsvpBtn.innerHTML;
    rsvpBtn.disabled = true;
    rsvpBtn.innerHTML = '...';

    try {
        // Determine if we're toggling off (clicking same button again)
        const currentlyActive = rsvpBtn.classList.contains('active');
        const newRsvpType = currentlyActive ? null : rsvpType;

        // Call API to update RSVP
        const result = await api.updateRsvpForEvent(recordId, userId, newRsvpType);

        if (result) {
            // Update the local event record with new RSVP data
            linkedEventRecord.fields.RSVPs = result.RSVPs || [];
            linkedEventRecord.fields.RSVPMaybe = result.RSVPMaybe || [];
            linkedEventRecord.fields.RSVPNo = result.RSVPNo || [];

            // Also update in state.records.all if it exists there
            const stateRecord = getRecordById(recordId);
            if (stateRecord) {
                stateRecord.fields.RSVPs = result.RSVPs || [];
                stateRecord.fields.RSVPMaybe = result.RSVPMaybe || [];
                stateRecord.fields.RSVPNo = result.RSVPNo || [];
            }

            // Re-render both buttons and list
            const rsvpButtonsContainer = document.getElementById('presentation-rsvp-buttons');
            const rsvpListContainer = document.getElementById('presentation-rsvp-list');

            if (rsvpButtonsContainer) {
                renderRsvpButtons(rsvpButtonsContainer, linkedEventRecord);
            }
            if (rsvpListContainer) {
                await renderRsvpList(rsvpListContainer, linkedEventRecord);
            }

            log('Presentation', `RSVP updated: ${rsvpType} for event ${recordId}`);
        } else {
            throw new Error('RSVP update failed');
        }
    } catch (error) {
        console.error('[Presentation] RSVP Error:', error);
        showToast(`RSVP Error: ${error.message}`);
        rsvpBtn.innerHTML = originalText;
        rsvpBtn.disabled = false;
    }
}

// ============================================
// END RSVP FUNCTIONALITY
// ============================================

// Calculate score for a single reaction
function getReactionScore(emoji) {
    return REACTION_SCORES[emoji] || 0;
}

// Calculate total reaction score for an item
function getItemReactionScore(recordId) {
    const reactions = state.session.reactions.get(recordId);
    if (!reactions || !(reactions instanceof Map)) return 0;

    let score = 0;
    reactions.forEach((emoji) => {
        score += getReactionScore(emoji);
    });
    return score;
}

// Get reaction count for an item
function getItemReactionCount(recordId) {
    const reactions = state.session.reactions.get(recordId);
    if (!reactions || !(reactions instanceof Map)) return 0;
    return reactions.size;
}

/**
 * Get a summary emoji that represents the overall sentiment/activity for an item
 * based on the average score of all reactions. Returns the emoji whose score is
 * closest to the calculated average score from all collaborators' reactions.
 * @param {string} recordId - The item record ID
 * @returns {string} A single emoji closest to the average reaction score, or empty string if none
 */
function getItemSummaryEmoji(recordId) {
    const reactions = state.session.reactions.get(recordId);
    if (!reactions || !(reactions instanceof Map) || reactions.size === 0) {
        return '';
    }

    // Calculate the average score from all reactions
    let totalScore = 0;
    let reactionCount = 0;
    reactions.forEach((emoji) => {
        totalScore += getReactionScore(emoji);
        reactionCount++;
    });

    if (reactionCount === 0) {
        return '';
    }

    const averageScore = totalScore / reactionCount;

    // Find the emoji with the score closest to the average
    let closestEmoji = '';
    let closestDifference = Infinity;

    Object.entries(REACTION_SCORES).forEach(([emoji, score]) => {
        const difference = Math.abs(score - averageScore);
        if (difference < closestDifference) {
            closestDifference = difference;
            closestEmoji = emoji;
        }
    });

    return closestEmoji || '💬';
}

/**
 * Update the emoji indicator next to an item's name
 * @param {string} recordId - The item record ID
 */
function updateItemEmojiIndicator(recordId) {
    const emojiIndicator = document.querySelector(`.item-emoji-indicator[data-record-id="${recordId}"]`);
    if (!emojiIndicator) return;

    const summaryEmoji = getItemSummaryEmoji(recordId);
    const reactionCount = getItemReactionCount(recordId);

    if (summaryEmoji && reactionCount > 0) {
        emojiIndicator.innerHTML = `<span class="emoji-indicator-emoji">${summaryEmoji}</span>${reactionCount > 1 ? `<span class="emoji-indicator-count">${reactionCount}</span>` : ''}`;
        emojiIndicator.style.display = 'inline-flex';
        emojiIndicator.classList.add('has-reactions');
        emojiIndicator.classList.remove('no-reactions');
        // Update tooltip with ranking info
        const tooltip = getItemRankingTooltip(recordId);
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
 * Calculate the event-level emoji by averaging all component summary emojis.
 * Uses the same averaging logic as individual components, but aggregates
 * the averaged scores from each component that has reactions.
 * @returns {{emoji: string, count: number, totalReactions: number}} Event emoji, component count, and total reactions
 */
function getEventSummaryEmoji() {
    // Get all items in the plan (locked and favorites/ideas)
    const favorites = Array.from(state.cart.items.keys());
    const locked = Array.from(state.cart.lockedItems.keys());
    const allItemIds = [...new Set([...locked, ...favorites])];

    // Collect average scores from each component that has reactions
    const componentAverages = [];
    let totalReactionCount = 0;

    allItemIds.forEach(recordId => {
        const reactions = state.session.reactions.get(recordId);
        if (!reactions || !(reactions instanceof Map) || reactions.size === 0) {
            return;
        }

        // Calculate this component's average score (same as getItemSummaryEmoji)
        let totalScore = 0;
        let reactionCount = 0;
        reactions.forEach((emoji) => {
            totalScore += getReactionScore(emoji);
            reactionCount++;
        });

        if (reactionCount > 0) {
            const averageScore = totalScore / reactionCount;
            componentAverages.push(averageScore);
            totalReactionCount += reactionCount;
        }
    });

    // No components with reactions
    if (componentAverages.length === 0) {
        return { emoji: '', count: 0, totalReactions: 0 };
    }

    // Calculate the average of all component averages (event-level average)
    const eventAverageScore = componentAverages.reduce((sum, avg) => sum + avg, 0) / componentAverages.length;

    // Find the emoji with the score closest to the event average
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
        totalReactions: totalReactionCount
    };
}

/**
 * Update the event-level emoji indicator in the presentation header.
 * This shows a real-time averaged emoji representing overall sentiment
 * across all components in the plan.
 */
function updateEventEmojiIndicator() {
    const eventEmojiEl = document.getElementById('event-emoji-indicator');
    if (!eventEmojiEl) return;

    const { emoji, count, totalReactions } = getEventSummaryEmoji();

    if (emoji && count > 0) {
        // Show count of components with reactions if more than 1
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

// Generate the expanded emoji picker HTML
function createEmojiPickerHTML(recordId) {
    let categoriesHTML = '';
    Object.entries(EMOJI_CATEGORIES).forEach(([categoryKey, category]) => {
        const emojisHTML = category.emojis.map(emoji => {
            const score = getReactionScore(emoji);
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
                <button class="emoji-picker-close" title="Close">&times;</button>
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
function showExpandedEmojiPicker(recordId, anchorElement) {
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
function closeExpandedEmojiPicker() {
    const existingPicker = document.querySelector('.emoji-picker-overlay');
    if (existingPicker) {
        existingPicker.remove();
    }
}

// ============================================
// SENTIMENT ANALYSIS POPUP
// ============================================

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
        const reactionCount = reactions instanceof Map ? reactions.size : 0;
        const totalScore = getItemReactionScore(item.recordId);

        // Calculate average score per reaction for positioning on scale
        const avgScore = reactionCount > 0 ? totalScore / reactionCount : 0;

        // Get emoji breakdown
        const emojiBreakdown = {};
        if (reactions instanceof Map) {
            reactions.forEach((emoji) => {
                emojiBreakdown[emoji] = (emojiBreakdown[emoji] || 0) + 1;
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
            summaryEmoji: getItemSummaryEmoji(item.recordId)
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
                    <button class="sentiment-popup-close" title="Close">&times;</button>
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
                <button class="sentiment-popup-close" title="Close">&times;</button>
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
function showSentimentPopup() {
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
function closeSentimentPopup() {
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

/**
 * Initialize click handler for the event emoji indicator to open sentiment popup
 */
function initializeEventEmojiClickHandler() {
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
function selectEmoji(recordId, emoji) {
    const currentUser = getCurrentUser();

    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    // Toggle if same emoji, otherwise set new
    if (itemReactions.get(currentUser.id) === emoji) {
        itemReactions.delete(currentUser.id);
    } else {
        itemReactions.set(currentUser.id, emoji);
    }

    // Re-render reactions for this item
    const reactionContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
    if (reactionContainer) {
        renderReactions(recordId, reactionContainer);
    }

    // Update the emoji indicator next to item name
    updateItemEmojiIndicator(recordId);

    // Update the reactions summary
    renderReactionsSummary();

    // Update the event-level emoji indicator
    updateEventEmojiIndicator();

    // Broadcast item reaction update via Pusher for real-time sync
    if (presentationChatChannel) {
        // Convert Map to object for Pusher transmission
        const reactionsObj = {};
        itemReactions.forEach((userEmoji, odUserId) => {
            reactionsObj[odUserId] = userEmoji;
        });
        presentationChatChannel.trigger('client-item-reaction-update', {
            recordId,
            reactions: reactionsObj,
            userId: currentUser.id
        });
    }

    triggerSave();
}

function renderReactions(recordId, reactionContainer) {
    const currentUser = getCurrentUser();
    let allReactions = state.session.reactions.get(recordId);
    if (!(allReactions instanceof Map)) {
        allReactions = new Map();
    }
    const currentUserReaction = allReactions.get(currentUser.id);

    // Quick reaction buttons (8 most common)
    const buttonsHTML = EMOJI_REACTIONS.map(emoji =>
        `<button class="reaction-btn ${currentUserReaction === emoji ? 'selected' : ''}" data-emoji="${emoji}" data-record-id="${recordId}">${emoji}</button>`
    ).join('');

    // More button to open full picker
    const moreButtonHTML = `<button class="reaction-btn reaction-more-btn" data-record-id="${recordId}" title="More reactions">+</button>`;

    // Summary showing who reacted (simplified - just names and emojis)
    let summaryHTML = '';
    if (allReactions.size > 0) {
        summaryHTML = Array.from(allReactions.entries()).map(([userId, reaction]) => {
            const name = state.session.userProfiles.get(userId) || 'A User';
            return `<span class="reaction-user">${name}: ${reaction}</span>`;
        }).join('');
    }

    reactionContainer.innerHTML = `
        <div class="reaction-bar-buttons">${buttonsHTML}${moreButtonHTML}</div>
        <div class="reaction-info-row">
            <div class="reaction-summary-display">${summaryHTML || 'Tap an emoji to share your reaction'}</div>
        </div>
    `;
}

function createMediaCarousel(images, recordId) {
    if (!images || images.length === 0) {
        return '<div class="itinerary-item-no-images">No images available</div>';
    }

    const currentIndex = itemImagesCache.get(recordId)?.currentIndex || 0;

    const thumbnails = images.map((url, index) =>
        `<div class="itinerary-thumbnail ${index === currentIndex ? 'active' : ''}"
              data-record-id="${recordId}"
              data-index="${index}"
              style="background-image: url('${url}')"></div>`
    ).join('');

    return `
        <div class="itinerary-media-carousel" data-record-id="${recordId}">
            <div class="itinerary-main-image" style="background-image: url('${images[currentIndex]}')"></div>
            ${images.length > 1 ? `
                <div class="itinerary-thumbnails">${thumbnails}</div>
            ` : ''}
        </div>
    `;
}

/**
 * Get the selected options text for display.
 * Returns an array of objects with group name and selected option name.
 * Supports both single-select (number) and multi-select (array) formats.
 * @param {Object} record - The Airtable record
 * @param {Object} itemInfo - The item info containing selections
 * @returns {Array<{groupName: string, optionName: string}>} Array of selected options
 */
function getSelectedOptionsDisplay(record, itemInfo) {
    const rawOptions = record.fields.Options;
    if (!rawOptions) return [];

    const groups = parseOptions(rawOptions);
    if (!groups || groups.length === 0) return [];

    const results = [];

    // Handle new selections object format: { group0: optionIndex, group1: optionIndex, ... }
    // Also supports multi-select arrays: { group0: [0, 2], group1: 1 }
    if (itemInfo?.selections && typeof itemInfo.selections === 'object' && Object.keys(itemInfo.selections).length > 0) {
        for (const [groupKey, optionValue] of Object.entries(itemInfo.selections)) {
            const groupIndexMatch = groupKey.match(/^group(\d+)$/);
            if (!groupIndexMatch) continue;

            const groupIndex = parseInt(groupIndexMatch[1], 10);
            const group = groups[groupIndex];
            if (!group || !group.options) continue;

            // Handle both single index and array of indices (multi-select)
            const optionIndices = Array.isArray(optionValue) ? optionValue : [optionValue];

            for (const optionIndex of optionIndices) {
                const option = group.options[optionIndex];
                if (option) {
                    results.push({
                        groupName: group.name || 'Options',
                        optionName: option.name
                    });
                }
            }
        }
        return results;
    }

    // Handle legacy single index format
    if (typeof itemInfo?.selectedOptionIndex === 'number' && itemInfo.selectedOptionIndex >= 0) {
        const flatOptions = flattenOptionGroups(groups);
        const option = flatOptions[itemInfo.selectedOptionIndex];
        if (option) {
            // Find which group this option belongs to
            let groupName = 'Options';
            for (const group of groups) {
                if (group.options && group.options.includes(option)) {
                    groupName = group.name || 'Options';
                    break;
                }
            }
            results.push({
                groupName: groupName,
                optionName: option.name
            });
        }
        return results;
    }

    // No selections - return empty (don't show defaults since they weren't explicitly selected)
    return results;
}

// Generate summary text for an item when collapsed in accordion
function generateItemSummary(record, itemInfo, type) {
    // Use selections if available, fall back to selectedOptionIndex for legacy
    const selectionsOrIndex = itemInfo?.selections || itemInfo?.selectedOptionIndex;
    const price = getRecordPrice(record, selectionsOrIndex);
    const quantity = itemInfo?.quantity || 1;
    const typeLabel = type === 'favorites' ? 'Idea' : 'Confirmed';
    const note = itemInfo?.note || '';

    // Get category/subcategory if available
    const category = record.fields.Category || '';
    const subcategory = record.fields.Subcategory || '';

    // Get selected options for display
    const selectedOptions = getSelectedOptionsDisplay(record, itemInfo);

    let summary = `<span class="item-summary-price">$${price.toFixed(2)}</span>`;

    if (quantity > 1) {
        summary += ` <span class="item-summary-qty">(×${quantity})</span>`;
    }

    // Show selected options if any
    if (selectedOptions.length > 0) {
        const optionNames = selectedOptions.map(opt => opt.optionName).join(', ');
        summary += ` &bull; <span class="item-summary-options">${optionNames}</span>`;
    }

    // Add category hint if available (only if no options shown)
    if (category && selectedOptions.length === 0) {
        summary += ` &bull; <span class="item-summary-category">${category}</span>`;
    }

    // Show truncated note if present
    if (note) {
        const truncatedNote = note.length > 30 ? note.substring(0, 30) + '...' : note;
        summary += ` &bull; <span class="item-summary-note">"${truncatedNote}"</span>`;
    }

    return summary;
}

async function renderItineraryItem(item, index) {
    const { recordId, type, itemStatus = 'active' } = item;
    const record = getRecordById(recordId);

    if (!record) {
        return '';
    }

    // Check if this item has been combined into another item (it's a source)
    if (isItemCombinedSource(recordId)) {
        // Don't render combined source items - they're visually merged into target
        return '';
    }

    const itemInfo = type === 'favorites' ? state.cart.items.get(recordId) : state.cart.lockedItems.get(recordId);
    // Use hybrid name as the display name if this is a combined item
    const hybridDataForName = getCombinedHybridData(recordId);
    const name = hybridDataForName?.hybridName || record.fields.Name || 'Untitled Item';
    // Use selections if available, fall back to selectedOptionIndex for legacy
    const selectionsOrIndex = itemInfo?.selections || itemInfo?.selectedOptionIndex;
    const price = getRecordPrice(record, selectionsOrIndex);
    const quantity = itemInfo?.quantity || 1;
    const note = itemInfo?.note || '';
    const description = record.fields.Description || '';

    // Build time/duration schedule display for this item
    const itemStartTime = itemInfo?.itemStartTime || '';
    const itemDuration = itemInfo?.itemDuration || 0;
    const itemEndTime = itemInfo?.itemEndTime || '';
    const itemDate = itemInfo?.itemDate || '';
    let scheduleHTML = '';
    {
        const parts = [];
        if (itemDate) {
            try {
                const d = new Date(itemDate);
                parts.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            } catch (e) { /* skip invalid date */ }
        }
        if (itemStartTime) {
            let timePart = itemStartTime;
            if (itemEndTime) {
                timePart += ` – ${itemEndTime}`;
            }
            parts.push(timePart);
        }
        if (itemDuration && itemDuration > 0) {
            const h = Math.floor(itemDuration / 60);
            const m = itemDuration % 60;
            const durStr = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
            parts.push(durStr);
        }
        if (parts.length > 0) {
            scheduleHTML = `
                <div class="itinerary-item-schedule">
                    <span class="schedule-icon">🕐</span>
                    <span class="schedule-text">${parts.join(' · ')}</span>
                </div>
            `;
        }
    }

    // --- Confidence tier for itinerary board items (AI, solutions, and manual items) ---
    const isAIItem = recordId.startsWith('custom-') ||
                     recordId.startsWith('ai-search-') ||
                     recordId.startsWith('ai-group-') ||
                     recordId.startsWith('ai-child-');
    const isSolutionItem = recordId.startsWith('solution-') || record.isSolution === true;
    const isManualItem = recordId.startsWith('manual-add-') ||
                         recordId.startsWith('manual-presentation-') ||
                         record.isManual === true;
    const needsConfidenceStyling = isAIItem || isSolutionItem || isManualItem;

    console.log('[DEBUG Presentation Itinerary] Confidence detection for', recordId, ':', {
        isAIItem,
        isSolutionItem,
        isManualItem,
        needsConfidenceStyling,
        'record.isManual': record.isManual,
        'record.isSolution': record.isSolution,
        '_researchData?.confidence': record._researchData?.confidence,
        '_aiConfidence': record._aiConfidence,
        'solutionData?.confidence': record.solutionData?.confidence
    });

    let itineraryConfidenceClass = '';
    if (needsConfidenceStyling) {
        let confidence;
        if (record._researchData?.confidence != null) {
            confidence = record._researchData.confidence;
        } else if (isAIItem) {
            confidence = record._aiConfidence ?? record.fields?._aiConfidence ?? null;
        } else if (isSolutionItem && record.solutionData?.confidence) {
            const solutionConfidenceMap = { high: 0.85, medium: 0.6, low: 0.35 };
            confidence = solutionConfidenceMap[record.solutionData.confidence] ?? 0.6;
        } else if (isManualItem) {
            confidence = 0.5; // Manual items default to 50% (pen/approximated)
        } else {
            confidence = null;
        }

        if (confidence === null || confidence === undefined) {
            itineraryConfidenceClass = 'confidence-pencil';
        } else if (confidence < 0.5) {
            itineraryConfidenceClass = 'confidence-pencil';
        } else if (confidence < 0.75) {
            itineraryConfidenceClass = 'confidence-pen';
        } else if (confidence < 0.95) {
            itineraryConfidenceClass = 'confidence-typed';
        } else {
            itineraryConfidenceClass = 'confidence-premium';
        }

        console.log('[DEBUG Presentation Itinerary] Applied confidence class for', recordId, ':', {
            confidence,
            itineraryConfidenceClass,
            confidenceSource: record._researchData?.confidence != null ? 'researchData' :
                             isAIItem ? 'aiConfidence' :
                             (isSolutionItem && record.solutionData?.confidence) ? 'solutionData' :
                             isManualItem ? 'manualDefault(0.5)' : 'null'
        });
    }

    // Get selected options for expanded view
    const selectedOptions = getSelectedOptionsDisplay(record, itemInfo);

    // Fetch images if not cached
    if (!itemImagesCache.has(recordId)) {
        const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        // Use the selectedImageIndex from itemInfo if set, otherwise default to 0
        const selectedIndex = itemInfo?.selectedImageIndex ?? 0;
        const validIndex = Math.min(selectedIndex, (imageUrls?.length || 1) - 1);
        itemImagesCache.set(recordId, { images: imageUrls || [], currentIndex: validIndex });
    }

    const cachedImages = itemImagesCache.get(recordId);
    const mediaCarouselHTML = createMediaCarousel(cachedImages.images, recordId);

    // Determine the display label based on itemStatus
    let typeLabel = type === 'favorites' ? 'Idea' : 'Confirmed';
    let typeClass = type === 'favorites' ? 'item-type-idea' : 'item-type-confirmed';

    // Override label/class if item is archived or completed
    if (itemStatus === 'archived') {
        typeLabel = 'Archived';
        typeClass = 'item-type-archived';
    } else if (itemStatus === 'completed') {
        typeLabel = 'Completed';
        typeClass = 'item-type-completed';
    }

    // Add status class to section
    const statusClass = itemStatus !== 'active' ? `item-status-${itemStatus}` : '';

    // Add goal class if item is marked as a goal
    const isGoal = state.session.goalItems?.has(recordId);
    const goalClass = isGoal ? 'item-status-goal' : '';

    // Generate summary for collapsed state
    const itemSummary = generateItemSummary(record, itemInfo, type);

    // Generate selected options HTML for expanded view
    let selectedOptionsHTML = '';
    if (selectedOptions.length > 0) {
        selectedOptionsHTML = `
            <div class="itinerary-item-options">
                ${selectedOptions.map(opt => `
                    <span class="itinerary-item-option-tag">
                        <span class="option-group-label">${opt.groupName}:</span> ${opt.optionName}
                    </span>
                `).join('')}
            </div>
        `;
    }

    // Get the initial emoji indicator for this item
    const summaryEmoji = getItemSummaryEmoji(recordId);
    const reactionCount = getItemReactionCount(recordId);
    const emojiIndicatorHTML = summaryEmoji && reactionCount > 0
        ? `<span class="item-emoji-indicator has-reactions" data-record-id="${recordId}" style="display: inline-flex;"><span class="emoji-indicator-emoji">${summaryEmoji}</span>${reactionCount > 1 ? `<span class="emoji-indicator-count">${reactionCount}</span>` : ''}</span>`
        : `<span class="item-emoji-indicator no-reactions" data-record-id="${recordId}" style="display: inline-flex;" title="Tap to react"><span class="emoji-indicator-emoji">😊</span><span class="emoji-indicator-prompt">React</span></span>`;

    // Check for combined items indicator
    const combinedSources = getCombinedSources(recordId);
    const hybridData = getCombinedHybridData(recordId);
    let combinedIndicatorHTML = '';
    let combinedSourcesHTML = '';
    let combinedClass = '';
    if (combinedSources.length > 0) {
        combinedClass = 'is-combined';
        const sourceNames = combinedSources.map(sourceId => {
            const sourceRecord = getRecordById(sourceId);
            return sourceRecord?.fields?.Name || 'Item';
        });
        // Show hybrid indicator badge (name is now shown as the main title)
        const hybridName = hybridData?.hybridName;
        const hybridDesc = hybridData?.hybridDescription;
        const indicatorLabel = hybridName ? `Hybrid` : `${combinedSources.length + 1} combined`;
        combinedIndicatorHTML = `
            <span class="item-combined-indicator ${hybridName ? 'has-hybrid' : ''}" title="${hybridDesc || `Combined from: ${sourceNames.join(', ')}`}">
                <span class="combined-icon">✨</span>
                <span>${indicatorLabel}</span>
            </span>
        `;
        // Build expandable combined sources section with uncombine actions
        combinedSourcesHTML = `
            <div class="combined-sources-section">
                <div class="combined-sources-header">
                    <button class="combined-sources-toggle" data-record-id="${recordId}">
                        <span>📋</span>
                        <span>Show ${combinedSources.length} combined item${combinedSources.length > 1 ? 's' : ''}</span>
                        <span class="toggle-arrow">▼</span>
                    </button>
                    <button class="uncombine-all-btn" data-target-id="${recordId}" title="Split all items apart">
                        Split All
                    </button>
                </div>
                <div class="combined-sources-list" data-record-id="${recordId}" style="display: none;">
                    ${hybridDesc ? `<div class="combined-hybrid-description">${hybridDesc}</div>` : ''}
                    ${sourceNames.map((sourceName, idx) => `
                        <div class="combined-source-item" data-source-id="${combinedSources[idx]}">
                            <span>• ${sourceName}</span>
                            <button class="uncombine-source-btn" data-source-id="${combinedSources[idx]}" data-target-id="${recordId}" title="Remove from hybrid">✕</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Check for group indicator
    const itemGroup = getItemGroup(recordId);
    let groupIndicatorHTML = '';
    let groupClass = '';
    if (itemGroup) {
        const groupItems = Array.isArray(itemGroup) ? itemGroup : (itemGroup.items || []);
        const groupName = itemGroup.name || `${groupItems.length} Options`;
        const groupDescription = itemGroup.description || '';
        const groupId = itemGroup.id || '';
        groupClass = 'in-group';
        groupIndicatorHTML = `
            <span class="item-group-indicator" title="${groupDescription || `Part of: ${groupName}`}" data-group-id="${groupId}">
                <span class="group-icon">📂</span>
                <span class="group-name">${groupName}</span>
                <span class="group-count">(${groupItems.length})</span>
                <button class="leave-group-btn" data-record-id="${recordId}" data-group-id="${groupId}" title="Remove from group">✕</button>
            </span>
        `;
    }

    // Task status button for this item
    const taskStatusButtonHTML = renderTaskStatusButton('item', recordId);

    // Each item is wrapped in its own section container for independent layout
    return `
        <section class="itinerary-section itinerary-item-section ${statusClass} ${goalClass} ${combinedClass} ${groupClass} ${itineraryConfidenceClass}" data-section="item-${recordId}" data-item-status="${itemStatus}" data-is-goal="${isGoal}">
            <article class="itinerary-item item-accordion expanded ${itineraryConfidenceClass}" data-record-id="${recordId}" data-index="${index}" data-item-name="${escapeHtml(name)}">
                <div class="item-accordion-header" data-record-id="${recordId}">
                    <div class="item-accordion-title-row">
                        ${taskStatusButtonHTML}
                        <h3 class="item-accordion-title">${name}</h3>
                        ${emojiIndicatorHTML}
                        ${combinedIndicatorHTML}
                        ${groupIndicatorHTML}
                        <span class="itinerary-item-type ${typeClass}">${typeLabel}</span>
                        <span class="item-accordion-icon"></span>
                    </div>
                    <p class="item-accordion-summary">${itemSummary}</p>
                </div>
                <div class="item-accordion-content itinerary-item-clickable">
                    <div class="itinerary-item-content">
                        ${mediaCarouselHTML}
                        <div class="itinerary-item-details">
                            <div class="itinerary-item-price-qty">
                                <span class="itinerary-item-price">$${price.toFixed(2)}</span>
                                ${quantity > 1 ? `<span class="itinerary-item-qty">× ${quantity}</span>` : ''}
                            </div>
                            ${scheduleHTML}
                            ${description ? `
                                <div class="itinerary-item-description">${description}</div>
                            ` : ''}
                            ${selectedOptionsHTML}
                            ${note ? `
                                <div class="itinerary-item-note">
                                    <strong>Note:</strong> ${note}
                                </div>
                            ` : ''}
                            ${combinedSourcesHTML}
                            <div class="itinerary-item-reactions" data-record-id="${recordId}"></div>
                            <button class="itinerary-item-expand-btn" data-record-id="${recordId}" title="View full details">
                                <span class="expand-btn-icon">↗</span>
                                <span class="expand-btn-text">More Details</span>
                            </button>
                        </div>
                    </div>
                    <!-- Component Comments Section -->
                    <div class="component-comments-section" data-component-type="item" data-component-id="${recordId}">
                        <div class="component-comments-header">
                            <button class="component-comments-toggle" data-component-id="${recordId}" title="Show comments">
                                <span class="comments-icon">💬</span>
                                <span class="comments-count" data-component-id="${recordId}">0</span>
                                <span class="comments-label">Add a comment</span>
                                <span class="comments-toggle-icon">▼</span>
                            </button>
                        </div>
                        <div class="component-comments-body" data-component-id="${recordId}" style="display: none;">
                            <div class="component-comments-list" data-component-id="${recordId}">
                                <!-- Comments will be rendered here -->
                            </div>
                            <div class="component-comment-input-wrapper">
                                <div class="comment-image-preview" data-component-id="${recordId}" style="display: none;">
                                    <img class="comment-preview-thumbnail" src="" alt="Preview" />
                                    <button class="comment-preview-remove" data-component-id="${recordId}" title="Remove image">×</button>
                                </div>
                                <div class="comment-input-row">
                                    <input type="file" class="comment-image-input" data-component-id="${recordId}" accept="image/*" style="display: none;" />
                                    <button class="comment-image-btn" data-component-id="${recordId}" title="Attach image">
                                        <span>📷</span>
                                    </button>
                                    <input type="text" class="component-comment-input" data-component-id="${recordId}" placeholder="Add a comment..." />
                                    <button class="component-comment-submit" data-component-id="${recordId}" title="Post comment">
                                        <span>→</span>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </article>
        </section>
    `;
}

// =============================================================================
// COMPACT CARD RENDERER (Board View - Phase 1)
// =============================================================================

/**
 * Determine the source type of an item for visual badges.
 * @param {string} recordId - The record ID
 * @param {Object} record - The record object
 * @returns {{ key: string, label: string, icon: string }}
 */
function getCompactCardSourceType(recordId, record) {
    if (recordId.startsWith('custom-') || recordId.startsWith('ai-search-') ||
        recordId.startsWith('ai-group-') || recordId.startsWith('ai-child-')) {
        return { key: 'ai', label: 'AI Suggested', icon: '🤖' };
    }
    if (recordId.startsWith('solution-') || record?.isSolution === true) {
        return { key: 'solution', label: 'Solution', icon: '💡' };
    }
    if (recordId.startsWith('manual-add-') || recordId.startsWith('manual-presentation-') || record?.isManual === true) {
        return { key: 'manual', label: 'Manually Added', icon: '✏️' };
    }
    return { key: 'catalog', label: 'From Catalog', icon: '📋' };
}

/**
 * Render a compact card tile for the board view.
 * Shows: hero photo with floating status/emoji overlays, name, provenance,
 * variation pills, reaction summary, and comment/task count badges.
 * @param {Object} item - { recordId, type, itemStatus }
 * @returns {Promise<string>} HTML string for the compact card
 */
async function renderCompactCard(item) {
    const { recordId, type, itemStatus = 'active' } = item;
    let record = getRecordById(recordId);
    console.log(`[CARD DEBUG] renderCompactCard called for: ${recordId} (type=${type}, status=${itemStatus})`);
    console.log(`[CARD DEBUG]   record found: ${!!record}`, record ? `name="${record.fields?.Name}"` : 'NULL');
    if (!record) {
        // Attempt to recover custom items from solution records registry or cart info
        const solutionRec = window._solutionRecords?.get(recordId);
        const cartInfo = state.cart.lockedItems.get(recordId) || state.cart.items.get(recordId);
        if (solutionRec) {
            record = solutionRec;
            console.log(`[CARD DEBUG]   Recovered from _solutionRecords: name="${record.fields?.Name}"`);
        } else if (cartInfo && cartInfo._recordSnapshot) {
            record = cartInfo._recordSnapshot;
            console.log(`[CARD DEBUG]   Recovered from cart _recordSnapshot: name="${record.fields?.Name}"`);
        } else if (cartInfo) {
            // Build a minimal record from cart info for items that truly have no record
            record = {
                id: recordId,
                fields: {
                    Name: cartInfo.name || cartInfo.itemName || 'Custom Item',
                    Description: cartInfo.description || '',
                    _customImages: cartInfo._customImages || [],
                    _hasAIGeneratedImage: cartInfo._hasAIGeneratedImage || false,
                },
                isManual: recordId.startsWith('manual-'),
                isSolution: recordId.startsWith('solution-'),
            };
            console.log(`[CARD DEBUG]   Built minimal record from cart info: name="${record.fields.Name}"`);
        }
        if (!record) {
            console.warn(`[CARD DEBUG]   ⚠️ SKIPPING ${recordId} - getRecordById returned null and no recovery possible!`);
            console.log(`[CARD DEBUG]   state.records.all has ${state.records.all.length} records`);
            console.log(`[CARD DEBUG]   Checking if record exists in state.records.all:`, state.records.all.some(r => r.id === recordId));
            return '';
        }
    }

    // Skip combined source items
    const isCombinedSrc = isItemCombinedSource(recordId);
    if (isCombinedSrc) {
        console.log(`[CARD DEBUG]   ⚠️ SKIPPING ${recordId} - is a combined source item`);
        return '';
    }

    const itemInfo = type === 'favorites' ? state.cart.items.get(recordId) : state.cart.lockedItems.get(recordId);

    // Use hybrid name for combined items
    const hybridDataForName = getCombinedHybridData(recordId);
    const name = hybridDataForName?.hybridName || record.fields?.Name || 'Untitled Item';

    // --- Confidence tier ---
    const isAIItem = recordId.startsWith('custom-') || recordId.startsWith('ai-search-') ||
                     recordId.startsWith('ai-group-') || recordId.startsWith('ai-child-');
    const isSolutionItem = recordId.startsWith('solution-') || record.isSolution === true;
    const isManualItem = recordId.startsWith('manual-add-') || recordId.startsWith('manual-presentation-') || record.isManual === true;
    const needsConfidenceStyling = isAIItem || isSolutionItem || isManualItem;

    let confidenceClass = '';
    if (needsConfidenceStyling) {
        let confidence;
        if (record._researchData?.confidence != null) confidence = record._researchData.confidence;
        else if (isAIItem) confidence = record._aiConfidence ?? record.fields?._aiConfidence ?? null;
        else if (isSolutionItem && record.solutionData?.confidence) {
            const solutionConfidenceMap = { high: 0.85, medium: 0.6, low: 0.35 };
            confidence = solutionConfidenceMap[record.solutionData.confidence] ?? 0.6;
        } else if (isManualItem) confidence = 0.5;
        else confidence = null;

        if (confidence === null || confidence === undefined) confidenceClass = 'confidence-pencil';
        else if (confidence < 0.5) confidenceClass = 'confidence-pencil';
        else if (confidence < 0.75) confidenceClass = 'confidence-pen';
        else if (confidence < 0.95) confidenceClass = 'confidence-typed';
        else confidenceClass = 'confidence-premium';
    }

    // --- Status classes ---
    const isGoal = state.session.goalItems?.has(recordId);
    const isArchived = state.session.archivedItems?.has(recordId);
    const isCompleted = state.session.completedItems?.has(recordId);
    const isLocked = state.cart.lockedItems.has(recordId);

    let lifecycleClass = 'compact-card-idea'; // default
    if (isArchived) lifecycleClass = 'compact-card-archived';
    else if (isCompleted) lifecycleClass = 'compact-card-completed';
    else if (isLocked) lifecycleClass = 'compact-card-locked';
    else if (isGoal) lifecycleClass = 'compact-card-goal';

    // --- Photo ---
    if (!itemImagesCache.has(recordId)) {
        const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        const selectedIndex = itemInfo?.selectedImageIndex ?? 0;
        const validIndex = Math.min(selectedIndex, (imageUrls?.length || 1) - 1);
        itemImagesCache.set(recordId, { images: imageUrls || [], currentIndex: validIndex });
    }
    const cachedImages = itemImagesCache.get(recordId);
    const photoUrl = cachedImages?.images?.[cachedImages.currentIndex] || cachedImages?.images?.[0] || '';
    const optimizedPhoto = photoUrl ? applyCloudinaryTransform(photoUrl, 'w_400,h_250,c_fill,f_auto,q_auto') : '';

    // --- Task status overlay (top-left) ---
    const taskStatus = getElementTaskStatus('item', recordId);
    const taskConfig = TASK_STATUS_CONFIG[taskStatus] || TASK_STATUS_CONFIG[ELEMENT_TASK_STATUS.NONE];
    const showStatus = taskStatus !== ELEMENT_TASK_STATUS.NONE;
    const statusOverlayHTML = showStatus
        ? `<span class="compact-card-status ${taskConfig.className}" title="${taskConfig.label}"><span class="task-status-icon">${taskConfig.icon}</span> ${taskConfig.label}</span>`
        : '';

    // --- Summary emoji overlay (top-right) ---
    const summaryEmoji = getItemSummaryEmoji(recordId);
    const reactionCount = getItemReactionCount(recordId);
    const rankingTooltip = getItemRankingTooltip(recordId);
    const emojiOverlayHTML = summaryEmoji && reactionCount > 0
        ? `<span class="compact-card-emoji item-emoji-indicator has-reactions" data-record-id="${recordId}" title="${escapeHtml(rankingTooltip)}">${summaryEmoji}${reactionCount > 1 ? `<span class="compact-card-emoji-count">${reactionCount}</span>` : ''}</span>`
        : '';

    // --- Provenance line (combined items) ---
    const combinedSources = getCombinedSources(recordId);
    let provenanceHTML = '';
    if (combinedSources.length > 0) {
        const sourceNames = combinedSources.map(sourceId => {
            const sourceRecord = getRecordById(sourceId);
            return sourceRecord?.fields?.Name || 'Item';
        });
        const sourceTypeBadges = combinedSources.map(sourceId => {
            const sourceRecord = getRecordById(sourceId);
            const srcType = getCompactCardSourceType(sourceId, sourceRecord);
            return `<span class="provenance-source-badge provenance-source-${srcType.key}" title="${escapeHtml((sourceRecord?.fields?.Name || 'Item') + ' (' + srcType.label + ')')}">${srcType.icon} ${escapeHtml(sourceRecord?.fields?.Name || 'Item')}</span>`;
        });
        const displayBadges = sourceTypeBadges.length <= 3
            ? sourceTypeBadges.join('')
            : sourceTypeBadges.slice(0, 3).join('') + `<span class="provenance-source-badge provenance-source-more">+${sourceTypeBadges.length - 3}</span>`;
        const hybridData = getCombinedHybridData(recordId);
        const hybridLabel = hybridData?.hybridName ? '<span class="provenance-hybrid-icon" title="Hybrid item">✨</span>' : '';
        provenanceHTML = `<div class="compact-card-provenance" title="${escapeHtml(sourceNames.join(' + '))}">${hybridLabel}<span class="provenance-label">Merged:</span> ${displayBadges}<button class="compact-card-split-btn compact-card-split-hybrid" data-target-id="${recordId}" title="Split hybrid apart">✂</button></div>`;
    }

    // --- Goal indicator ---
    const goalBadgeHTML = isGoal ? '<span class="compact-card-goal-badge" title="Goal">⭐</span>' : '';

    // --- Lifecycle badge (floating bottom-right of photo) ---
    let lifecycleBadgeIcon = '';
    let lifecycleBadgeLabel = '';
    let lifecycleBadgeClass = '';
    if (isArchived) {
        lifecycleBadgeIcon = '📦'; lifecycleBadgeLabel = 'Archived'; lifecycleBadgeClass = 'lifecycle-archived';
    } else if (isCompleted) {
        lifecycleBadgeIcon = '✓'; lifecycleBadgeLabel = 'Done'; lifecycleBadgeClass = 'lifecycle-completed';
    } else if (isLocked) {
        lifecycleBadgeIcon = '🔒'; lifecycleBadgeLabel = 'Confirmed'; lifecycleBadgeClass = 'lifecycle-locked';
    } else if (isGoal) {
        lifecycleBadgeIcon = '⭐'; lifecycleBadgeLabel = 'Goal'; lifecycleBadgeClass = 'lifecycle-goal';
    }
    // Ideas don't show a badge (default state)
    const lifecycleBadgeHTML = lifecycleBadgeClass
        ? `<span class="compact-card-lifecycle-badge ${lifecycleBadgeClass}">${lifecycleBadgeIcon} ${lifecycleBadgeLabel}</span>`
        : '';

    // --- Entry source type badge ---
    const sourceType = getCompactCardSourceType(recordId, record);
    const sourceTypeBadgeHTML = sourceType.key !== 'catalog'
        ? `<span class="compact-card-source-badge source-badge-${sourceType.key}" title="${sourceType.label}">${sourceType.icon}</span>`
        : '';

    // --- Type label ---
    let typeLabel = type === 'favorites' ? 'Idea' : 'Confirmed';
    if (itemStatus === 'archived') typeLabel = 'Archived';
    else if (itemStatus === 'completed') typeLabel = 'Completed';

    // --- Variation / option pills ---
    const itemGroup = getItemGroup(recordId);
    let pillsHTML = '';
    if (itemGroup) {
        const groupItems = Array.isArray(itemGroup) ? itemGroup : (itemGroup.items || []);
        const otherItems = groupItems.filter(gId => gId !== recordId);
        const pillNames = otherItems.slice(0, 2).map(gId => {
            const gRec = getRecordById(gId);
            return gRec?.fields?.Name || 'Option';
        });
        const pillElements = pillNames.map(pn => `<span class="compact-card-pill">${escapeHtml(pn)}</span>`).join('');
        const moreCount = otherItems.length - 2;
        const morePill = moreCount > 0 ? `<span class="compact-card-pill compact-card-pill-more">+${moreCount} more</span>` : '';
        pillsHTML = `<div class="compact-card-pills">${pillElements}${morePill}</div>`;
    }

    // --- Compact reaction bar ---
    const reactions = state.session.reactions?.get(recordId);
    let reactionBarHTML = '';
    if (reactions && reactions instanceof Map && reactions.size > 0) {
        const emojiCounts = {};
        reactions.forEach((emoji) => {
            emojiCounts[emoji] = (emojiCounts[emoji] || 0) + 1;
        });
        const sorted = Object.entries(emojiCounts).sort((a, b) => b[1] - a[1]);
        const top3 = sorted.slice(0, 3).map(([emoji, count]) =>
            `<span class="compact-reaction-pill" title="${emoji} ${count}">${emoji}<span class="compact-reaction-count">${count}</span></span>`
        ).join('');
        const moreReactions = sorted.length > 3 ? `<span class="compact-reaction-pill compact-reaction-overflow">+${sorted.length - 3}</span>` : '';
        const totalReactions = reactions.size;
        reactionBarHTML = `<span class="compact-card-reactions" data-record-id="${recordId}" title="${totalReactions} reaction${totalReactions !== 1 ? 's' : ''}">${top3}${moreReactions}</span>`;
    }

    // --- Comment count badge ---
    const commentCacheKey = `item:${recordId}`;
    const cachedComments = componentCommentsCache.get(commentCacheKey);
    const commentCount = cachedComments?.length || 0;
    const commentBadgeHTML = commentCount > 0
        ? `<span class="compact-badge-pill compact-badge-comment" title="${commentCount} comment${commentCount !== 1 ? 's' : ''}"><span class="compact-badge-icon">💬</span><span class="compact-badge-count">${commentCount}</span></span>`
        : '';

    // --- Task status badge in meta bar ---
    const taskStatusForBadge = getElementTaskStatus('item', recordId);
    const taskConfigForBadge = TASK_STATUS_CONFIG[taskStatusForBadge] || TASK_STATUS_CONFIG[ELEMENT_TASK_STATUS.NONE];
    const showTaskBadge = taskStatusForBadge !== ELEMENT_TASK_STATUS.NONE;
    const taskBadgeHTML = showTaskBadge
        ? `<span class="compact-badge-pill compact-badge-task ${taskConfigForBadge.className}" title="${taskConfigForBadge.label}"><span class="compact-badge-icon">${taskConfigForBadge.icon}</span><span class="compact-badge-label">${taskConfigForBadge.label}</span></span>`
        : '';

    // --- Time badge (shows scheduled start time or duration) ---
    let timeBadgeHTML = '';
    if (itemInfo) {
        const startT = itemInfo.itemStartTime;
        const endT = itemInfo.itemEndTime; // computed from start + duration
        const dur = itemInfo.itemDuration;
        const itemDate = itemInfo.itemDate;
        // Also check catalog duration as fallback
        const catalogDurHours = parseFloat(record.fields?.['Duration (hours)'] || 0);
        const catalogDurMin = Math.round(catalogDurHours * 60);
        const effectiveDur = dur || catalogDurMin;

        // Format a date for display in tooltips
        const fmtDate = (iso) => {
            if (!iso) return '';
            try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
        };

        // Build date context string for tooltip
        let dateCtx = '';
        if (itemDate) {
            dateCtx = fmtDate(itemDate);
        }

        if (startT || effectiveDur) {
            let timeText = '';
            let timeTooltip = '';
            if (startT && endT) {
                timeText = `${startT} - ${endT}`;
                timeTooltip = dateCtx ? `${dateCtx}: ${startT} - ${endT}` : `${startT} - ${endT}`;
            } else if (startT) {
                timeText = startT;
                timeTooltip = dateCtx ? `${dateCtx} at ${startT}` : `Starts ${startT}`;
            } else if (effectiveDur) {
                const hrs = Math.floor(effectiveDur / 60);
                const mins = effectiveDur % 60;
                timeText = hrs > 0 ? `${hrs}h${mins > 0 ? `${mins}m` : ''}` : `${mins}m`;
                timeTooltip = `Duration: ${timeText}${dur ? ' (custom)' : ''}`;
            }
            if (timeText) {
                timeBadgeHTML = `<span class="compact-badge-pill compact-badge-time" title="${escapeHtml(timeTooltip)}"><span class="compact-badge-icon">🕐</span><span class="compact-badge-label">${escapeHtml(timeText)}</span></span>`;
            }
        }
    }

    // --- Photo section or fallback ---
    const photoStyle = optimizedPhoto ? `background-image: url('${optimizedPhoto}')` : '';
    const noPhotoClass = !optimizedPhoto ? 'compact-card-no-photo' : '';

    // --- Price badge on photo ---
    let priceBadgeHTML = '';
    if (itemInfo) {
        const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
            ? itemInfo.selections
            : itemInfo.selectedOptionIndex;
        let unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
        if (!isNaN(unitPrice) && unitPrice > 0) {
            const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, 1);
            const totalPrice = unitPrice * effectiveQuantity;
            const priceText = effectiveQuantity > 1
                ? `$${totalPrice.toFixed(0)} (${effectiveQuantity}x)`
                : `$${unitPrice % 1 === 0 ? unitPrice.toFixed(0) : unitPrice.toFixed(2)}`;
            priceBadgeHTML = `<span class="compact-card-price">${priceText}</span>`;
        } else if (unitPrice === 0) {
            priceBadgeHTML = `<span class="compact-card-price price-free">Free</span>`;
        }
    }

    // --- Vitality/Goodness emoji for compact card ---
    const compactVitalityScores = state.vitality?.itemScores?.get(recordId);
    const compactVitalityEmoji = compactVitalityScores?.goodnessEmoji || compactVitalityScores?.netEmoji || '';
    const compactGoodnessLabel = compactVitalityScores?.goodnessLabel || compactVitalityScores?.netLabel || 'Neutral';
    const compactVitalityHTML = compactVitalityEmoji ? `<span class="compact-card-vitality" title="Goodness: ${compactGoodnessLabel} (click for details)">${compactVitalityEmoji}</span>` : '';

    return `
        <div class="compact-card ${lifecycleClass} ${confidenceClass} ${noPhotoClass}" data-record-id="${recordId}" data-item-type="${type}" data-item-status="${itemStatus}" role="article" tabindex="0" aria-label="${escapeHtml(name)}${showStatus ? ', ' + taskConfig.label : ''}">
            <div class="compact-card-photo" style="${photoStyle}">
                ${statusOverlayHTML}
                ${emojiOverlayHTML}
                ${lifecycleBadgeHTML}
                <span class="compact-card-valuation">${priceBadgeHTML}${compactVitalityHTML}</span>
            </div>
            <div class="compact-card-body">
                <div class="compact-card-title-row">
                    ${goalBadgeHTML}
                    <h4 class="compact-card-name" title="${escapeHtml(name)}">${escapeHtml(name)}</h4>
                    ${sourceTypeBadgeHTML}
                </div>
                ${provenanceHTML}
                ${pillsHTML}
                <div class="compact-card-meta">
                    ${reactionBarHTML}
                    <span class="compact-card-badges">
                        ${timeBadgeHTML}
                        ${taskBadgeHTML}
                        ${commentBadgeHTML}
                    </span>
                </div>
            </div>
        </div>
    `;
}

/**
 * Render a compact card for an options group in board view.
 * @param {Object} group - The related group object
 * @returns {Promise<string>} HTML string for the group compact card
 */
async function renderCompactGroupCard(group) {
    const groupItems = Array.isArray(group) ? group : (group.items || []);
    const groupName = group.name || `${groupItems.length} Options`;
    const groupId = group.id || '';

    // Use the first item for photo
    const firstItemId = groupItems[0];
    const firstRecord = getRecordById(firstItemId);
    if (!firstRecord) return '';

    if (!itemImagesCache.has(firstItemId)) {
        const { imageUrls } = await api.fetchImagesForRecord(firstRecord, state.records.all, new Map());
        itemImagesCache.set(firstItemId, { images: imageUrls || [], currentIndex: 0 });
    }
    const cachedImages = itemImagesCache.get(firstItemId);
    const photoUrl = cachedImages?.images?.[0] || '';
    const optimizedPhoto = photoUrl ? applyCloudinaryTransform(photoUrl, 'w_400,h_250,c_fill,f_auto,q_auto') : '';

    // Member name pills with lifecycle indicators
    const maxPills = Math.min(groupItems.length, 4);
    const memberPills = groupItems.slice(0, maxPills).map(gId => {
        const gRec = getRecordById(gId);
        const memberName = escapeHtml(gRec?.fields?.Name || 'Option');
        const isGoal = state.session.goalItems?.has(gId);
        const isArchived = state.session.archivedItems?.has(gId);
        const isCompleted = state.session.completedItems?.has(gId);
        const isLocked = state.cart.lockedItems.has(gId);
        let pillStateClass = '';
        let pillIcon = '';
        if (isArchived) { pillStateClass = 'pill-archived'; pillIcon = '📦 '; }
        else if (isCompleted) { pillStateClass = 'pill-completed'; pillIcon = '✓ '; }
        else if (isLocked) { pillStateClass = 'pill-locked'; pillIcon = '🔒 '; }
        else if (isGoal) { pillStateClass = 'pill-goal'; pillIcon = '⭐ '; }
        return `<span class="compact-card-pill ${pillStateClass}">${pillIcon}${memberName}</span>`;
    }).join('');
    const moreCount = groupItems.length - maxPills;
    const morePill = moreCount > 0 ? `<span class="compact-card-pill compact-card-pill-more">+${moreCount} more</span>` : '';

    // Aggregate lifecycle summary for the group
    let lockedCount = 0, goalCount = 0, archivedCount = 0, completedCount = 0;
    for (const gId of groupItems) {
        if (state.session.archivedItems?.has(gId)) archivedCount++;
        else if (state.session.completedItems?.has(gId)) completedCount++;
        else if (state.cart.lockedItems.has(gId)) lockedCount++;
        else if (state.session.goalItems?.has(gId)) goalCount++;
    }
    const activeCount = groupItems.length - archivedCount;
    let groupStatusHTML = '';
    const statusParts = [];
    if (lockedCount > 0) statusParts.push(`<span class="group-status-chip group-chip-locked">🔒 ${lockedCount}</span>`);
    if (goalCount > 0) statusParts.push(`<span class="group-status-chip group-chip-goal">⭐ ${goalCount}</span>`);
    if (completedCount > 0) statusParts.push(`<span class="group-status-chip group-chip-completed">✓ ${completedCount}</span>`);
    if (archivedCount > 0) statusParts.push(`<span class="group-status-chip group-chip-archived">📦 ${archivedCount}</span>`);
    if (statusParts.length > 0) {
        groupStatusHTML = `<div class="compact-card-group-status">${statusParts.join('')}</div>`;
    }

    // Determine type from first item
    const firstItemType = state.cart.lockedItems.has(firstItemId) ? 'locked' : 'favorites';

    // Determine dominant lifecycle class for group card border
    let groupLifecycleClass = '';
    if (lockedCount === groupItems.length) groupLifecycleClass = 'compact-card-locked';
    else if (completedCount === groupItems.length) groupLifecycleClass = 'compact-card-completed';
    else if (archivedCount === groupItems.length) groupLifecycleClass = 'compact-card-archived';
    else if (goalCount > 0 && lockedCount === 0) groupLifecycleClass = 'compact-card-goal';

    // --- Aggregate comment count across group members ---
    let groupCommentCount = 0;
    for (const gId of groupItems) {
        const memberComments = componentCommentsCache.get(`item:${gId}`);
        groupCommentCount += memberComments?.length || 0;
    }
    const groupCommentBadgeHTML = groupCommentCount > 0
        ? `<span class="compact-badge-pill compact-badge-comment" title="${groupCommentCount} comment${groupCommentCount !== 1 ? 's' : ''} across group"><span class="compact-badge-icon">💬</span><span class="compact-badge-count">${groupCommentCount}</span></span>`
        : '';

    // --- Aggregate task status summary for group ---
    const taskStatusCounts = {};
    for (const gId of groupItems) {
        const memberTaskStatus = getElementTaskStatus('item', gId);
        if (memberTaskStatus !== ELEMENT_TASK_STATUS.NONE) {
            taskStatusCounts[memberTaskStatus] = (taskStatusCounts[memberTaskStatus] || 0) + 1;
        }
    }
    let groupTaskBadgeHTML = '';
    const taskEntries = Object.entries(taskStatusCounts);
    if (taskEntries.length > 0) {
        const taskChips = taskEntries.map(([status, count]) => {
            const config = TASK_STATUS_CONFIG[status] || TASK_STATUS_CONFIG[ELEMENT_TASK_STATUS.NONE];
            return `<span class="compact-badge-pill compact-badge-task ${config.className}" title="${config.label}: ${count}"><span class="compact-badge-icon">${config.icon}</span><span class="compact-badge-count">${count}</span></span>`;
        }).join('');
        groupTaskBadgeHTML = taskChips;
    }

    // --- Aggregate reaction bar across group members ---
    const groupEmojiCounts = {};
    let groupTotalReactions = 0;
    for (const gId of groupItems) {
        const memberReactions = state.session.reactions?.get(gId);
        if (memberReactions && memberReactions instanceof Map) {
            memberReactions.forEach((emoji) => {
                groupEmojiCounts[emoji] = (groupEmojiCounts[emoji] || 0) + 1;
                groupTotalReactions++;
            });
        }
    }
    let groupReactionBarHTML = '';
    if (groupTotalReactions > 0) {
        const sortedGroupEmoji = Object.entries(groupEmojiCounts).sort((a, b) => b[1] - a[1]);
        const top3Group = sortedGroupEmoji.slice(0, 3).map(([emoji, count]) =>
            `<span class="compact-reaction-pill" title="${emoji} ${count}">${emoji}<span class="compact-reaction-count">${count}</span></span>`
        ).join('');
        const moreGroupReactions = sortedGroupEmoji.length > 3 ? `<span class="compact-reaction-pill compact-reaction-overflow">+${sortedGroupEmoji.length - 3}</span>` : '';
        groupReactionBarHTML = `<span class="compact-card-reactions" title="${groupTotalReactions} reaction${groupTotalReactions !== 1 ? 's' : ''} across group">${top3Group}${moreGroupReactions}</span>`;
    }

    // Build group meta bar HTML (only if there's content)
    const hasGroupMeta = groupReactionBarHTML || groupTaskBadgeHTML || groupCommentBadgeHTML;
    const groupMetaHTML = hasGroupMeta ? `
                <div class="compact-card-meta">
                    ${groupReactionBarHTML}
                    <span class="compact-card-badges">
                        ${groupTaskBadgeHTML}
                        ${groupCommentBadgeHTML}
                    </span>
                </div>` : '';

    const photoStyle = optimizedPhoto ? `background-image: url('${optimizedPhoto}')` : '';
    const noPhotoClass = !optimizedPhoto ? 'compact-card-no-photo' : '';

    return `
        <div class="compact-card compact-card-group ${groupLifecycleClass} ${noPhotoClass}" data-group-id="${groupId}" data-item-type="${firstItemType}" role="article" tabindex="0" aria-label="${escapeHtml(groupName)}, ${groupItems.length} options">
            <div class="compact-card-photo" style="${photoStyle}">
                <span class="compact-card-group-badge">${groupItems.length} options</span>
            </div>
            <div class="compact-card-body">
                <div class="compact-card-title-row">
                    <h4 class="compact-card-name" title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</h4>
                    <button class="compact-card-split-btn" data-group-id="${groupId}" title="Split group apart">✂</button>
                </div>
                ${groupStatusHTML}
                <div class="compact-card-pills">${memberPills}${morePill}</div>
                ${groupMetaHTML}
            </div>
        </div>
    `;
}

// Debounced version of renderAllItems - coalesces rapid successive calls
// Use this for non-critical re-renders (action handlers, background updates).
// Use renderAllItems() directly for initial render where timing matters.
let renderDebounceTimer = null;
function scheduleRenderAllItems() {
    if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
    renderDebounceTimer = setTimeout(() => {
        renderDebounceTimer = null;
        renderAllItems();
    }, 50);
}

async function renderAllItems() {
    console.log('[ITEMS DEBUG] ========== renderAllItems CALLED ==========');
    console.log('[ITEMS DEBUG] state.cart.lockedItems.size:', state.cart.lockedItems.size);
    console.log('[ITEMS DEBUG] state.cart.items.size:', state.cart.items.size);
    console.log('[ITEMS DEBUG] lockedItem IDs:', Array.from(state.cart.lockedItems.keys()));
    console.log('[ITEMS DEBUG] ideaItem IDs:', Array.from(state.cart.items.keys()));
    console.log('[ITEMS DEBUG] itineraryItemsListEl exists:', !!itineraryItemsListEl);
    console.log('[ITEMS DEBUG] itineraryItemsListEl tag:', itineraryItemsListEl?.tagName, 'id:', itineraryItemsListEl?.id);
    if (PRES_DEBUG) console.log('[PRESENTATION DEBUG] renderAllItems called.', {
        lockedItemCount: state.cart.lockedItems.size,
        ideaItemCount: state.cart.items.size,
        lockedItemIds: Array.from(state.cart.lockedItems.keys()).slice(0, 5),
        ideaItemIds: Array.from(state.cart.items.keys()).slice(0, 5)
    });
    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    let combinedList = [...locked, ...favorites]; // Confirmed items first, then ideas

    // Debug: Log combinedItems map that might be filtering items out
    console.log('[ITEMS DEBUG] state.session.combinedItems:', state.session.combinedItems ?
        { size: state.session.combinedItems.size, entries: Array.from(state.session.combinedItems.entries()).map(([t, e]) => ({ target: t, sources: Array.from(getSourcesFromEntry(e)) })) }
        : 'null/undefined');

    // Get archived and completed items sets
    const archivedItems = state.session.archivedItems || new Set();
    const completedItems = state.session.completedItems || new Set();

    // Add status to each item (active, archived, or completed)
    combinedList = combinedList.map(item => {
        let itemStatus = 'active';
        if (archivedItems.has(item.recordId)) {
            itemStatus = 'archived';
        } else if (completedItems.has(item.recordId)) {
            itemStatus = 'completed';
        }
        return { ...item, itemStatus };
    });

    // Filter based on show/hide toggles
    combinedList = combinedList.filter(item => {
        if (item.itemStatus === 'archived' && !showArchivedItems) return false;
        if (item.itemStatus === 'completed' && !showCompletedItems) return false;
        return true;
    });

    // Apply custom ordering if available
    const customOrder = state.session.planItemOrder || [];
    if (customOrder.length > 0) {
        const orderMap = new Map(customOrder.map((id, index) => [id, index]));
        combinedList.sort((a, b) => {
            const orderA = orderMap.has(a.recordId) ? orderMap.get(a.recordId) : Infinity;
            const orderB = orderMap.has(b.recordId) ? orderMap.get(b.recordId) : Infinity;
            return orderA - orderB;
        });
    }

    // Count archived and completed items for toggle visibility
    const archivedCount = archivedItems.size;
    const completedCount = completedItems.size;

    // Update toggle buttons visibility
    updateStatusToggles(archivedCount, completedCount);

    console.log('[ITEMS DEBUG] combinedList after filtering:', combinedList.length, 'items');
    combinedList.forEach((item, i) => {
        console.log(`[ITEMS DEBUG]   [${i}] id=${item.recordId} type=${item.type} status=${item.itemStatus}`);
    });

    if (combinedList.length === 0) {
        // Show enhanced empty state when no items exist
        const allCategories = ["Activities", "Food & Drink", "Venues", "Extras"];
        const categoryIcons = { "Activities": "🎯", "Food & Drink": "🍽️", "Venues": "📍", "Extras": "✨" };
        let emptyStateHTML = `
            <section class="itinerary-section itinerary-empty-section" data-section="empty" role="status" aria-label="Empty plan board">
                <div class="presentation-empty-state board-empty-state">
                    <div class="board-empty-icon" aria-hidden="true">📋</div>
                    <p class="itinerary-empty-title">Your Plan Board is Empty</p>
                    <p class="itinerary-empty-subtitle">Start by browsing items from a category below, or use the search to find something specific.</p>
                    <div class="presentation-suggestions" role="group" aria-label="Category suggestions">
        `;

        allCategories.forEach(cat => {
            const filterTag = cat.toLowerCase().replace(/\s+/g, ' ');
            const icon = categoryIcons[cat] || '📦';
            emptyStateHTML += `
                <button class="filter-btn presentation-suggestion-btn" data-category-filter="${filterTag}" aria-label="Browse ${cat}">
                    <span class="suggestion-btn-icon" aria-hidden="true">${icon}</span>
                    <span class="suggestion-btn-text">${cat}</span>
                </button>
            `;
        });

        emptyStateHTML += `
                    </div>
                    <p class="board-empty-hint">Tip: Swipe horizontally on any card to access quick actions</p>
                </div>
            </section>
        `;

        itineraryItemsListEl.innerHTML = emptyStateHTML;
        return;
    }

    // Single item state — show a contextual nudge below the card
    const showSingleItemNudge = combinedList.length === 1;

    itineraryItemsListEl.innerHTML = '<p class="itinerary-loading" role="status" aria-live="polite">Loading items...</p>';

    // --- BOARD VIEW (compact card grid) ---
    itineraryItemsListEl.classList.add('board-view');
    itineraryItemsListEl.setAttribute('role', 'list');
    itineraryItemsListEl.setAttribute('aria-label', 'Plan board items');

    const relatedGroups = state.session.relatedGroups || [];
    const renderedGroupIds = new Set();
    const itemsHTML = [];

    // Pre-build a lookup map: recordId -> group
    const itemToGroupMap = new Map();
    for (const g of relatedGroups) {
        const gItems = Array.isArray(g) ? g : (g.items || []);
        for (const gId of gItems) {
            itemToGroupMap.set(gId, g);
        }
    }

    // Track sections for divider insertion
    let lastSection = null;
    const activeLockedItems = combinedList.filter(item => item.itemStatus === 'active' && item.type === 'locked');
    const activeIdeaItems = combinedList.filter(item => item.itemStatus === 'active' && item.type === 'favorites');
    const archivedVisibleItems = combinedList.filter(item => item.itemStatus === 'archived');
    const completedVisibleItems = combinedList.filter(item => item.itemStatus === 'completed');

    for (let i = 0; i < combinedList.length; i++) {
        const item = combinedList[i];
        const itemGroup = itemToGroupMap.get(item.recordId);

        // Insert section dividers between confirmed/idea/archived/completed
        let currentSection;
        if (item.itemStatus === 'archived') currentSection = 'archived';
        else if (item.itemStatus === 'completed') currentSection = 'completed';
        else if (item.type === 'locked') currentSection = 'confirmed';
        else currentSection = 'ideas';

        if (currentSection !== lastSection) {
            // Only show section dividers when there are multiple sections
            const hasMixedSections = (activeLockedItems.length > 0 && activeIdeaItems.length > 0)
                || archivedVisibleItems.length > 0 || completedVisibleItems.length > 0;

            if (hasMixedSections) {
                const sectionLabels = {
                    confirmed: { label: 'Confirmed', count: activeLockedItems.length },
                    ideas: { label: 'Ideas', count: activeIdeaItems.length },
                    archived: { label: 'Archived', count: archivedVisibleItems.length },
                    completed: { label: 'Completed', count: completedVisibleItems.length }
                };
                const sec = sectionLabels[currentSection];
                if (sec && sec.count > 0) {
                    itemsHTML.push(`
                        <div class="board-section-divider" role="separator">
                            <span class="board-section-divider-line"></span>
                            <span class="board-section-divider-label">${sec.label}<span class="board-section-divider-count">(${sec.count})</span></span>
                            <span class="board-section-divider-line"></span>
                        </div>
                    `);
                }
            }
            lastSection = currentSection;
        }

        if (itemGroup && itemGroup.id && !renderedGroupIds.has(itemGroup.id)) {
            renderedGroupIds.add(itemGroup.id);
            try {
                const html = await renderCompactGroupCard(itemGroup);
                console.log(`[ITEMS DEBUG] Group card for ${itemGroup.id}: html=${html ? 'OK (' + html.length + ' chars)' : 'EMPTY'}`);
                if (html) itemsHTML.push(html);
            } catch (groupErr) {
                console.warn('[Presentation] Failed to render group card for', itemGroup.id, groupErr);
            }
        } else if (itemGroup && itemGroup.id && renderedGroupIds.has(itemGroup.id)) {
            console.log(`[ITEMS DEBUG] Skipping ${item.recordId} - group ${itemGroup.id} already rendered`);
            continue; // Already rendered this group
        } else {
            try {
                const html = await renderCompactCard(item);
                console.log(`[ITEMS DEBUG] Card for ${item.recordId}: html=${html ? 'OK (' + html.length + ' chars)' : 'EMPTY'}`);
                if (html) itemsHTML.push(html);
                else console.warn(`[ITEMS DEBUG] ⚠️ renderCompactCard returned empty for ${item.recordId}`);
            } catch (cardErr) {
                console.warn('[Presentation] Failed to render compact card for', item.recordId, cardErr);
            }
        }
    }

    // Add single-item nudge if only one card on the board
    if (showSingleItemNudge) {
        itemsHTML.push(`
            <div class="board-single-item-nudge" role="status" aria-label="Add more items suggestion">
                <div class="single-item-nudge-content">
                    <span class="nudge-icon" aria-hidden="true">💡</span>
                    <p class="nudge-text">Add more items to compare options, merge ideas, and build your perfect plan.</p>
                </div>
            </div>
        `);
    }

    // Show welcome engagement tip for collaborators viewing the plan
    // Only show once per session (tracked via sessionStorage)
    const welcomeTipKey = `welcomeTipShown_${state.session.id}`;
    const hasShownWelcomeTip = sessionStorage.getItem(welcomeTipKey);
    if (!hasShownWelcomeTip && combinedList.length > 0) {
        sessionStorage.setItem(welcomeTipKey, 'true');
        itemsHTML.unshift(`
            <div class="board-welcome-tip" role="status" aria-label="Welcome tip">
                <div class="welcome-tip-content">
                    <span class="welcome-tip-icon" aria-hidden="true">👋</span>
                    <div class="welcome-tip-text">
                        <p class="welcome-tip-title">Welcome to the plan!</p>
                        <p class="welcome-tip-body">Tap the <strong>React</strong> badge on any item to share your opinion, or expand an item to leave a comment.</p>
                    </div>
                    <button class="welcome-tip-dismiss" aria-label="Dismiss tip" title="Dismiss">×</button>
                </div>
            </div>
        `);
    }

    itineraryItemsListEl.innerHTML = itemsHTML.join('');

    // Quick render verification
    if (PRES_DEBUG) {
        const cards = itineraryItemsListEl.querySelectorAll('.compact-card');
        console.log('[RENDER DEBUG] renderAllItems: itemsHTML entries:', itemsHTML.length, 'DOM cards:', cards.length);
    }

    // After entrance animations complete, remove will-change to free GPU memory
    setTimeout(() => {
        const cards = itineraryItemsListEl.querySelectorAll('.compact-card');
        cards.forEach(card => card.classList.add('settled'));
    }, 600);

    // Attach click handlers for compact cards
    initializeCompactCardClicks();

    // Render the reactions summary after items
    renderReactionsSummary();
    updateEventEmojiIndicator();

    // Initialize drag-and-drop (will work in grid mode for reordering)
    initializeItemDragDrop();
    initializeRadialMenu();
    attachRadialMenuListeners();

    // Register the unified action menu handler so badge clicks and the action menu
    // can trigger the same actions as the drag buckets
    console.log('[Presentation DEBUG] About to call registerActionHandler with handleActionMenuAction');
    registerActionHandler(handleActionMenuAction);
    console.log('[Presentation DEBUG] ✅ registerActionHandler() completed');

    // Update plan summary dashboard with latest metrics
    updatePlanSummaryDashboard();

    // Re-apply vitality badges and pulse animations to newly rendered cards.
    // Use setTimeout(0) instead of requestAnimationFrame to avoid the rAF firing
    // during async card rendering (before innerHTML is set). setTimeout(0) ensures
    // the recalc runs after the current call stack completes and DOM is settled.
    setTimeout(() => {
        console.log('[Vitality DEBUG] renderAllItems post-render recalc firing via setTimeout');
        recalculateVitality();
    }, 0);
}

// Initialize click handlers for compact cards in board view
function initializeCompactCardClicks() {
    if (!itineraryItemsListEl) return;

    // Regular item cards - open detail modal on click or Enter/Space key
    const itemCards = itineraryItemsListEl.querySelectorAll('.compact-card[data-record-id]');
    itemCards.forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't trigger on status badge, emoji indicator, vitality badge, or split button clicks
            const isExcluded = e.target.closest('.compact-card-status') || e.target.closest('.compact-card-emoji') || e.target.closest('.compact-card-split-btn') || e.target.closest('.compact-card-vitality') || e.target.closest('.valuation-vitality-emoji') || e.target.closest('.vitality-score-badge');
            if (isExcluded) {
                console.log('[Presentation DEBUG] Compact card click EXCLUDED (vitality/status/emoji element):', e.target.className);
                return;
            }
            const recordId = card.dataset.recordId;
            const record = getRecordById(recordId);
            if (record) {
                showDetailModal(record);
            }
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const recordId = card.dataset.recordId;
                const record = getRecordById(recordId);
                if (record) {
                    showDetailModal(record);
                }
            }
        });
    });

    // Group cards - open group detail modal on click or Enter/Space key
    const groupCards = itineraryItemsListEl.querySelectorAll('.compact-card-group[data-group-id]');
    groupCards.forEach(card => {
        card.addEventListener('click', (e) => {
            // Don't open modal when clicking the split button
            if (e.target.closest('.compact-card-split-btn')) return;
            const groupId = card.dataset.groupId;
            if (groupId) {
                openGroupDetailModal(groupId);
            }
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const groupId = card.dataset.groupId;
                if (groupId) {
                    openGroupDetailModal(groupId);
                }
            }
        });
    });

    // Split buttons on group cards - dissolve the group
    const groupSplitBtns = itineraryItemsListEl.querySelectorAll('.compact-card-group .compact-card-split-btn[data-group-id]');
    groupSplitBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const groupId = btn.dataset.groupId;
            if (groupId) {
                dissolveGroup(groupId);
            }
        });
    });

    // Split buttons on hybrid compact cards - uncombine all sources
    const hybridSplitBtns = itineraryItemsListEl.querySelectorAll('.compact-card-split-hybrid[data-target-id]');
    hybridSplitBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            const targetId = btn.dataset.targetId;
            if (targetId) {
                uncombineAll(targetId);
            }
        });
    });
}

// Initialize toggle handlers for combined sources sections
function initializeCombinedSourcesToggles() {
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

// Load SortableJS dynamically if not already loaded
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

// Initialize drag-and-drop for plan items
async function initializeItemDragDrop() {
    if (!itineraryItemsListEl) {
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
                if (isActionMenuOpen()) {
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
                openActionMenu(currentDraggedRecordId, {
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
                    if (isActionMenuOpen()) {
                        console.log('[Drag DEBUG] onEnd: closing action menu (drag ended without action selection)');
                        closeActionMenu();
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
                    refreshFlowLines();

                } catch (error) {
                    console.error('[Presentation] Exception in drag onEnd:', error);
                    // Clean up anyway
                    isDragging = false;
                    if (isBoardView) itineraryItemsListEl.classList.remove('is-sorting');
                    if (isActionMenuOpen()) closeActionMenu();
                    hideDragBuckets();
                }
            }
        });

        log('Presentation', `Drag-drop initialized for plan items (${isBoardView ? 'board' : 'list'} view)`);
    } catch (error) {
        console.error('[Presentation] Failed to initialize drag-drop:', error);
    }
}

// Update drag zone positions to be adjacent to the dragged item
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

// Show drag buckets during drag (colorize them)
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

// Cache bucket bounding rects for use during drag hover checks
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

// Hide drag buckets (decolorize them, but keep visible)
function hideDragBuckets() {
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
function initializeRadialMenu() {
    if (!radialMenuContainer || !dragBucketsEl) {
        console.error('[Radial Menu] Missing radialMenuContainer or dragBucketsEl');
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

/**
 * Handle action menu selections from the unified Action Menu component.
 * Maps action IDs to the same functions used by drag bucket drops.
 * @param {string} actionId - The action ID (e.g. 'goal', 'archive', 'delete')
 * @param {string} recordId - The item record ID
 * @param {string} [context] - The action menu context ('plan-item', 'chat', 'image', 'variation')
 */
function handleActionMenuAction(actionId, recordId, context) {
    if (!recordId) {
        console.log('[ActionMenu Handler DEBUG] handleActionMenuAction called with no recordId, returning');
        return;
    }
    console.log('[ActionMenu Handler DEBUG] Action:', actionId, 'for item:', recordId, 'context:', context || 'plan-item');

    switch (actionId) {
        case 'goal':
            setItemAsGoal(recordId);
            break;
        case 'ideas':
            moveToIdeas(recordId);
            break;
        case 'lock':
            lockItem(recordId);
            break;
        case 'merge':
            console.log('[ActionMenu Handler DEBUG] 🔗 MERGE action triggered, calling enterMergeMode...');
            console.log('[ActionMenu Handler DEBUG]   recordId:', recordId);
            console.log('[ActionMenu Handler DEBUG]   isMergeModeActive (before):', isMergeModeActive);
            console.log('[ActionMenu Handler DEBUG]   mergeModeOverlay ref:', mergeModeOverlay ? 'EXISTS' : '❌ NULL');
            console.log('[ActionMenu Handler DEBUG]   mergeModeBanner ref:', mergeModeBanner ? 'EXISTS' : '❌ NULL');
            console.log('[ActionMenu Handler DEBUG]   mergeSelectFab ref:', mergeSelectFab ? 'EXISTS' : '❌ NULL');
            enterMergeMode(recordId);
            console.log('[ActionMenu Handler DEBUG]   After enterMergeMode: isMergeModeActive:', isMergeModeActive);
            break;
        case 'archive':
            archiveItem(recordId);
            break;
        case 'delete':
            deleteItem(recordId);
            break;
        case 'quick-comment':
            openCustomCommentDialog(recordId);
            break;
        case 'completed':
            completeItem(recordId);
            break;
        default:
            console.log('[ActionMenu Handler] Unknown action:', actionId);
    }
}

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
        executeMergeByZone(sourceId, mergeTargetId, mergeZone);
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
            setItemAsGoal(currentDraggedRecordId);
            break;
        case 'drag-bucket-ideas':
            moveToIdeas(currentDraggedRecordId);
            break;
        case 'drag-bucket-lock':
            lockItem(currentDraggedRecordId);
            break;
        case 'drag-bucket-merge':
            enterMergeMode(currentDraggedRecordId);
            break;
        case 'drag-bucket-archive':
            archiveItem(currentDraggedRecordId);
            break;
        case 'drag-bucket-delete':
            deleteItem(currentDraggedRecordId);
            break;
        case 'drag-bucket-reactions':
            if (hoveredReactionEmoji) {
                addReactionToItem(currentDraggedRecordId, hoveredReactionEmoji);
            } else {
                addReactionToItem(currentDraggedRecordId, '👍'); // Default reaction
            }
            break;
        case 'drag-bucket-quick-comment':
            if (hoveredQuickComment) {
                addQuickCommentToItem(currentDraggedRecordId, hoveredQuickComment);
            } else {
                addQuickCommentToItem(currentDraggedRecordId, 'Great idea'); // Default comment
            }
            break;
        case 'drag-bucket-custom-comment':
            openCustomCommentDialog(currentDraggedRecordId);
            break;
        case 'drag-bucket-completed':
            completeItem(currentDraggedRecordId);
            break;
        default:
            console.log('[Radial Menu] Unknown bucket:', originalBucketId);
    }

    hideRadialMenu();
    currentDraggedItem = null;
    currentDraggedRecordId = null;
    return true;
}

// Touch/mouse event handlers for radial menu direction detection
let radialTouchMoveHandler = null;
let radialTouchEndHandler = null;
let radialMouseMoveHandler = null;
let radialMouseUpHandler = null;

function handleItemPointerDown(event, itemElement) {
    // Only handle if presentation is active
    if (!document.body.classList.contains('presentation-active')) return;

    // Get initial touch/click coordinates
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    initialTouchPoint = { x: clientX, y: clientY };
    directionDetected = false;

    console.log('[ActionMenu Swipe DEBUG] Pointer down at', clientX, clientY);

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
    if (isActionMenuOpen()) {
        console.log('[ActionMenu Swipe DEBUG] Pointer move ignored - action menu already open');
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
            console.log('[ActionMenu Swipe DEBUG] Horizontal swipe detected - opening action menu');

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
                console.log('[ActionMenu Swipe DEBUG] Swipe → opening Action Menu for recordId:', swipedRecordId, 'at:', initialTouchPoint.x, initialTouchPoint.y);
                openActionMenu(swipedRecordId, {
                    x: initialTouchPoint.x,
                    y: initialTouchPoint.y,
                    onAction: handleActionMenuAction
                });
            }

            cleanupRadialEventListeners();
        } else {
            // Vertical movement - allow scrolling, cleanup handlers
            console.log('[ActionMenu Swipe DEBUG] Vertical swipe detected - allowing scroll');
            cleanupRadialEventListeners();
        }
    }
}

function handleItemPointerUp(event) {
    const clientX = event.changedTouches ? event.changedTouches[0].clientX : event.clientX;
    const clientY = event.changedTouches ? event.changedTouches[0].clientY : event.clientY;

    console.log('[ActionMenu Swipe DEBUG] Pointer up at', clientX, clientY);

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
let radialListenersAttached = false;
function attachRadialMenuListeners() {
    if (!itineraryItemsListEl) {
        console.log('[ActionMenu Swipe DEBUG] attachRadialMenuListeners: no itineraryItemsListEl, skipping');
        return;
    }
    // Guard: only attach once since we use event delegation on a persistent element
    if (radialListenersAttached) {
        console.log('[ActionMenu Swipe DEBUG] attachRadialMenuListeners: already attached, skipping');
        return;
    }
    radialListenersAttached = true;
    console.log('[ActionMenu Swipe DEBUG] attachRadialMenuListeners: attaching touch/mouse listeners for swipe-to-action-menu');

    // Use event delegation on the items list
    itineraryItemsListEl.addEventListener('touchstart', handleRadialTouchStart, { passive: true });
    itineraryItemsListEl.addEventListener('mousedown', handleRadialMouseDown);
}

function handleRadialTouchStart(event) {
    // Board view: target compact cards; List view: target item sections
    const targetEl = event.target.closest('.compact-card') || event.target.closest('.itinerary-item-section');
    if (targetEl) {
        console.log('[ActionMenu Swipe DEBUG] Touch start on card/section, delegating to handleItemPointerDown');
        handleItemPointerDown(event, targetEl);
    }
}

function handleRadialMouseDown(event) {
    // Only handle left mouse button
    if (event.button !== 0) return;

    // Board view: target compact cards; List view: target item sections
    const targetEl = event.target.closest('.compact-card') || event.target.closest('.itinerary-item-section');
    if (targetEl) {
        console.log('[ActionMenu Swipe DEBUG] Mouse down on card/section, delegating to handleItemPointerDown');
        handleItemPointerDown(event, targetEl);
    }
}

// =============================================================================
// END RADIAL MENU FUNCTIONS (DEPRECATED — migrated to unified Action Menu)
// =============================================================================

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

// Check if pointer is over a bucket and update hover state
let bucketHoverDebugCounter = 0;
function checkBucketHover(event) {

    if (!dragBucketsEl || !isDragging) {
        return;
    }

    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    // All buckets to check with their display info
    const buckets = [
        { el: dragBucketGoal, name: 'goal', icon: '⭐', label: 'Set as Goal' },
        { el: dragBucketIdeas, name: 'ideas', icon: '💡', label: 'Move to Ideas' },
        { el: dragBucketLock, name: 'lock', icon: '🔒', label: 'Lock Item' },
        { el: dragBucketMerge, name: 'merge', icon: '🔗', label: 'Merge Item' },
        { el: dragBucketArchive, name: 'archive', icon: '📦', label: 'Archive Item' },
        { el: dragBucketDelete, name: 'delete', icon: '🗑️', label: 'Delete Item' },
        { el: dragBucketReactions, name: 'reactions', icon: '👍', label: 'Add Reaction' },
        { el: dragBucketQuickComment, name: 'quick-comment', icon: '💬', label: 'Quick Comment' },
        { el: dragBucketCustomComment, name: 'custom-comment', icon: '✏️', label: 'Add Comment' },
        { el: dragBucketCompleted, name: 'completed', icon: '✓', label: 'Mark Done' }
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
            if (iconEl) iconEl.textContent = '💬';
            if (textEl) textEl.textContent = `"${hoveredQuickComment}"`;
        } else {
            if (iconEl) iconEl.textContent = hoveredBucket.icon;
            if (textEl) textEl.textContent = hoveredBucket.label;
        }
    } else if (potentialMergeTarget) {
        // Show merge action
        currentHoveredAction = 'merge';
        dragActionTooltip.classList.add('action-merge');
        if (iconEl) iconEl.textContent = '🔗';
        if (textEl) textEl.textContent = 'Merge Items';
    } else {
        // Default neutral state - drag to edges hint
        currentHoveredAction = null;
        dragActionTooltip.classList.add('action-neutral');
        if (iconEl) iconEl.textContent = '↔';
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

// Check if hovering over another item for potential merge
// DWELL-TIME BASED MERGE: Hover over an item for MERGE_DWELL_TIME_MS to activate merge
// This works better with SortableJS since cursor position relative to items changes constantly
const MERGE_ZONE_THRESHOLD = 0.15; // 15% from top/bottom = central 70% is merge zone (much wider)
let mergeHoverDebugCounter = 0;

function checkMergeTargetHover(clientX, clientY) {
    // === MERGE ZONE DEBUG (reduced verbosity) ===
    mergeHoverDebugCounter++;

    if (!itineraryItemsListEl) {
        return;
    }

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
    const isDraggedInGroup = currentDraggedRecordId && getItemGroup(currentDraggedRecordId);

    let icon, label;
    if (isHybrid) {
        icon = '✨';
        label = 'Merge as Hybrid';
    } else if (isTargetGroup || isDraggedGroup || isDraggedInGroup) {
        icon = '📂';
        label = 'Merge Groups';
    } else {
        icon = '📂';
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

// Handle mouse/touch move during drag - throttled with rAF
let dragMoveDebugCounter = 0;
let dragRafPending = false;
let lastDragEvent = null;
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
        setItemAsGoal(recordId);
        return true;
    }

    // Check ideas bucket
    if (checkDropOnBucket(dragBucketIdeas)) {
        moveToIdeas(recordId);
        return true;
    }

    // Check lock bucket
    if (checkDropOnBucket(dragBucketLock)) {
        lockItem(recordId);
        return true;
    }

    // Check merge bucket
    if (checkDropOnBucket(dragBucketMerge)) {
        enterMergeMode(recordId);
        return true;
    }

    // Check archive bucket
    if (checkDropOnBucket(dragBucketArchive)) {
        archiveItem(recordId);
        return true;
    }

    // Check delete bucket
    if (checkDropOnBucket(dragBucketDelete)) {
        deleteItem(recordId);
        return true;
    }

    // RIGHT SIDE BUCKETS (Reactions/Comments)

    // Check reactions bucket (check individual emoji options first)
    if (checkDropOnBucket(dragBucketReactions)) {
        // Check if dropped on a specific emoji option
        if (hoveredReactionEmoji) {
            addReactionToItem(recordId, hoveredReactionEmoji);
        } else {
            // Default reaction if no specific emoji hovered
            addReactionToItem(recordId, '👍');
        }
        return true;
    }

    // Check quick comment bucket (check individual comment options first)
    if (checkDropOnBucket(dragBucketQuickComment)) {
        if (hoveredQuickComment) {
            addQuickCommentToItem(recordId, hoveredQuickComment);
        } else {
            // Default quick comment
            addQuickCommentToItem(recordId, 'Great idea');
        }
        return true;
    }

    // Check custom comment bucket
    if (checkDropOnBucket(dragBucketCustomComment)) {
        openCustomCommentDialog(recordId);
        return true;
    }

    // Check completed bucket
    if (checkDropOnBucket(dragBucketCompleted)) {
        completeItem(recordId);
        return true;
    }

    // Check for merge (drop on another item) - execute directly based on zone
    if (mergeTargetId) {
        const mergeZone = capturedMergeZone || 'hybrid';
        executeMergeByZone(recordId, mergeTargetId, mergeZone);
        return true;
    }

    return false;
}

// Archive an item
async function archiveItem(recordId) {
    if (!recordId) return;

    // Initialize archivedItems if not exists
    if (!state.session.archivedItems) {
        state.session.archivedItems = new Set();
    }

    // Add to archived items (item stays in its position, just changes status)
    state.session.archivedItems.add(recordId);

    // Get item name for toast
    const record = getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();
    updatePlanSummaryDashboard();

    // Show toast notification
    showToast(`"${itemName}" archived`, 'info');

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} archived`);
}

// Mark an item as completed
async function completeItem(recordId) {
    if (!recordId) return;

    // Initialize completedItems if not exists
    if (!state.session.completedItems) {
        state.session.completedItems = new Set();
    }

    // Add to completed items (item stays in its position, just changes status)
    state.session.completedItems.add(recordId);

    // Get item name for toast
    const record = getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();
    updatePlanSummaryDashboard();

    // Show toast notification
    showToast(`"${itemName}" marked complete`, 'success');

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} marked completed`);
}

// =====================================================
// NEW DRAG ACTION HANDLERS
// =====================================================

// Set item as a goal/inspiration (top-ranked target)
async function setItemAsGoal(recordId) {
    if (!recordId) return;

    // Initialize goalItems if not exists
    if (!state.session.goalItems) {
        state.session.goalItems = new Set();
    }

    // Toggle goal status
    if (state.session.goalItems.has(recordId)) {
        state.session.goalItems.delete(recordId);
        showToast('Removed from goals', 'info');
    } else {
        state.session.goalItems.add(recordId);
        const record = getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        showToast(`"${itemName}" set as goal`, 'success');
    }

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Update goal chips and trigger plan focus generation
    renderGoalChips();
    triggerPlanFocusGeneration();

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} goal status toggled`);
}

// =====================================================
// PLAN FOCUS AUTO-GENERATION (Goals → Title/Description)
// =====================================================

/**
 * Render goal item chips/badges in the presentation header.
 * Shows compact chips below the event name for each goal item.
 */
function renderGoalChips() {
    if (!goalChipsContainerEl) return;

    const goalIds = state.session.goalItems;
    if (!goalIds || goalIds.size === 0) {
        goalChipsContainerEl.innerHTML = '';
        goalChipsContainerEl.style.display = 'none';
        updateRegenerateButton();
        return;
    }

    goalChipsContainerEl.style.display = 'flex';
    let chipsHtml = '';

    for (const recordId of goalIds) {
        const record = getRecordById(recordId);
        if (!record) continue;
        const itemName = record.fields?.Name || 'Item';
        const shortName = itemName.length > 20 ? itemName.substring(0, 18) + '...' : itemName;
        chipsHtml += `<span class="goal-chip" data-record-id="${recordId}" title="${escapeHtml(itemName)}"><span class="goal-chip-star">&#x2B50;</span>${escapeHtml(shortName)}</span>`;
    }

    goalChipsContainerEl.innerHTML = chipsHtml;
    updateRegenerateButton();
}

/**
 * Show or hide the regenerate button based on whether there are goal items.
 */
function updateRegenerateButton() {
    const btn = document.getElementById('plan-focus-regenerate-btn');
    if (!btn) return;

    const hasGoals = state.session.goalItems && state.session.goalItems.size > 0;
    btn.style.display = hasGoals ? 'inline-flex' : 'none';

    // Show spinning animation if currently generating
    if (isPlanFocusGenerating) {
        btn.classList.add('generating');
    } else {
        btn.classList.remove('generating');
    }
}

/**
 * Debounced trigger for plan focus auto-generation.
 * Called whenever goal items change. Waits for activity to settle, then
 * generates if title/description is empty or was previously auto-generated.
 */
function triggerPlanFocusGeneration() {
    clearTimeout(planFocusGenerateTimer);

    const goalIds = state.session.goalItems;
    if (!goalIds || goalIds.size === 0) {
        // No goals — hide suggestion if visible
        hidePlanFocusSuggestion();
        return;
    }

    planFocusGenerateTimer = setTimeout(() => {
        const titleAutoGenerated = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.TITLE_AUTO_GENERATED);
        const currentTitle = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
        const currentDescription = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';

        // Auto-generate if:
        // - Title is empty or was previously auto-generated
        // - OR Description is empty or was previously auto-generated
        const shouldGenerate = !currentTitle || titleAutoGenerated ||
            !currentDescription || state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DESCRIPTION_AUTO_GENERATED);

        if (shouldGenerate) {
            generatePlanFocus();
        }
    }, PLAN_FOCUS_DEBOUNCE_MS);
}

/**
 * Call the AI endpoint to generate a plan title/description from goal items.
 */
async function generatePlanFocus() {
    if (isPlanFocusGenerating) return;

    const goalIds = state.session.goalItems;
    if (!goalIds || goalIds.size === 0) return;

    // Collect goal item data (name and description only, per Decision 3)
    const goalItemsData = [];
    for (const recordId of goalIds) {
        const record = getRecordById(recordId);
        if (!record) continue;

        // Check for hybrid/merged name
        const combinedEntry = state.session.combinedItems?.get(recordId);
        const hybridName = combinedEntry?.hybridData?.hybridName;
        const hybridDesc = combinedEntry?.hybridData?.hybridDescription;

        goalItemsData.push({
            name: hybridName || record.fields?.Name || 'Unknown Item',
            description: hybridDesc || record.fields?.Description || ''
        });
    }

    if (goalItemsData.length === 0) return;

    isPlanFocusGenerating = true;
    updateRegenerateButton();
    log('Presentation', `Generating plan focus from ${goalItemsData.length} goal items...`);

    try {
        const currentTitle = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
        const currentDescription = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';

        const response = await fetch('/.netlify/functions/generate-plan-focus', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                goalItems: goalItemsData,
                currentTitle: currentTitle || null,
                currentDescription: currentDescription || null
            })
        });

        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }

        const result = await response.json();
        if (result.success && result.title && result.description) {
            pendingPlanFocusSuggestion = {
                title: result.title,
                description: result.description
            };
            showPlanFocusSuggestion(result.title, result.description);
            log('Presentation', `Plan focus generated: "${result.title}"`);
        }
    } catch (error) {
        console.error('[Presentation] Failed to generate plan focus:', error);
        showToast('Could not generate plan focus', 'warning');
    } finally {
        isPlanFocusGenerating = false;
        updateRegenerateButton();
    }
}

/**
 * Display the plan focus suggestion banner for user confirmation (Decision 2b).
 */
function showPlanFocusSuggestion(title, description) {
    if (!planFocusSuggestionEl) return;

    const titleEl = planFocusSuggestionEl.querySelector('.plan-focus-suggestion-title');
    const descEl = planFocusSuggestionEl.querySelector('.plan-focus-suggestion-description');

    if (titleEl) titleEl.textContent = title;
    if (descEl) descEl.textContent = description;

    planFocusSuggestionEl.style.display = 'block';

    // Set up event handlers (remove old ones first to prevent duplication)
    const acceptBtn = planFocusSuggestionEl.querySelector('.plan-focus-accept-btn');
    const editBtn = planFocusSuggestionEl.querySelector('.plan-focus-edit-btn');
    const dismissBtn = planFocusSuggestionEl.querySelector('.plan-focus-suggestion-dismiss');

    if (acceptBtn) {
        acceptBtn.onclick = () => applyPlanFocusSuggestion(false);
    }
    if (editBtn) {
        editBtn.onclick = () => applyPlanFocusSuggestion(true);
    }
    if (dismissBtn) {
        dismissBtn.onclick = () => hidePlanFocusSuggestion();
    }
}

/**
 * Hide the plan focus suggestion banner.
 */
function hidePlanFocusSuggestion() {
    if (planFocusSuggestionEl) {
        planFocusSuggestionEl.style.display = 'none';
    }
    pendingPlanFocusSuggestion = null;
}

/**
 * Apply the pending plan focus suggestion to the event name and goals.
 * @param {boolean} allowEdit - If true, prompts user to edit before applying
 */
function applyPlanFocusSuggestion(allowEdit) {
    if (!pendingPlanFocusSuggestion) return;

    let { title, description } = pendingPlanFocusSuggestion;

    if (allowEdit) {
        // Prompt user to edit the suggested title
        const editedTitle = prompt('Edit plan title:', title);
        if (editedTitle === null) return; // User cancelled
        title = editedTitle.trim() || title;

        const editedDescription = prompt('Edit plan description:', description);
        if (editedDescription === null) return; // User cancelled
        description = editedDescription.trim() || description;
    }

    // Apply to event details
    state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, title);
    state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, description);
    state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.TITLE_AUTO_GENERATED, true);
    state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DESCRIPTION_AUTO_GENERATED, true);

    // Update the UI
    renderPresentationHeader();
    renderEventHeader();

    // Update the main toolbar inputs if they exist
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) eventNameInput.value = title;
    const goalsInput = document.getElementById('header-goals');
    if (goalsInput) goalsInput.value = description;

    // Hide the suggestion banner
    hidePlanFocusSuggestion();

    // Save
    triggerSave();

    showToast('Plan focus applied', 'success');
    log('Presentation', `Plan focus applied: "${title}"`);
}

/**
 * Initialize event handlers for the plan focus feature.
 * Called once when the presentation view opens.
 */
function initializePlanFocusHandlers() {
    // Regenerate button
    const regenerateBtn = document.getElementById('plan-focus-regenerate-btn');
    if (regenerateBtn) {
        regenerateBtn.onclick = () => {
            generatePlanFocus();
        };
    }

    // Goal chip clicks (for scrolling to item, or future interactions)
    if (goalChipsContainerEl) {
        goalChipsContainerEl.onclick = (e) => {
            const chip = e.target.closest('.goal-chip');
            if (!chip) return;
            const recordId = chip.dataset.recordId;
            if (recordId) {
                const targetItem = document.querySelector(`.itinerary-item[data-record-id="${recordId}"]`);
                if (targetItem) {
                    targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Brief highlight
                    targetItem.classList.add('item-highlight');
                    setTimeout(() => targetItem.classList.remove('item-highlight'), 1500);
                }
            }
        };
    }
}

// Move item to Ideas bucket (from lockedItems to items)
async function moveToIdeas(recordId) {
    if (!recordId) return;

    // Check if item is currently in lockedItems
    const itemInfo = state.cart.lockedItems.get(recordId);
    if (itemInfo) {
        // Move from lockedItems to items
        state.cart.lockedItems.delete(recordId);
        state.cart.items.set(recordId, itemInfo);

        // Get item name for toast
        const record = getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        showToast(`"${itemName}" moved to Ideas`, 'info');
    } else {
        // Item might already be in ideas, just confirm
        showToast('Item is already in Ideas', 'info');
    }

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} moved to Ideas`);
}

// Lock an item (move from items to lockedItems if not already)
async function lockItem(recordId) {
    if (!recordId) return;

    // Check if item is in items (Ideas)
    const itemInfo = state.cart.items.get(recordId);
    if (itemInfo) {
        // Move from items to lockedItems
        state.cart.items.delete(recordId);
        state.cart.lockedItems.set(recordId, itemInfo);

        const record = getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        showToast(`"${itemName}" locked in plan`, 'success');
    } else if (state.cart.lockedItems.has(recordId)) {
        showToast('Item is already locked', 'info');
    } else {
        // Item not found, add it to locked
        state.cart.lockedItems.set(recordId, { quantity: 1, selections: {} });
        const record = getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        showToast(`"${itemName}" locked in plan`, 'success');
    }

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} locked in plan`);
}

// Demote an item (move from locked to idea status while keeping in view)
async function demoteItem(recordId) {
    if (!recordId) return;

    // Move from lockedItems to items if applicable
    const itemInfo = state.cart.lockedItems.get(recordId);
    if (itemInfo) {
        state.cart.lockedItems.delete(recordId);
        state.cart.items.set(recordId, itemInfo);

        const record = getRecordById(recordId);
        const itemName = record?.fields?.Name || 'Item';
        showToast(`"${itemName}" demoted to idea`, 'info');
    } else {
        showToast('Item is already an idea', 'info');
    }

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} demoted to idea`);
}

// Delete an item (remove from plan entirely with confirmation)
async function deleteItem(recordId) {
    if (!recordId) return;

    // Get item name for confirmation
    const record = getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Show confirmation dialog
    const confirmed = confirm(`Are you sure you want to remove "${itemName}" from the plan?`);
    if (!confirmed) return;

    // Remove from all collections
    state.cart.lockedItems.delete(recordId);
    state.cart.items.delete(recordId);
    state.session.archivedItems?.delete(recordId);
    state.session.completedItems?.delete(recordId);
    state.session.goalItems?.delete(recordId);

    // Remove from plan order if present
    const orderIndex = state.session.planItemOrder?.indexOf(recordId);
    if (orderIndex !== -1 && orderIndex !== undefined) {
        state.session.planItemOrder.splice(orderIndex, 1);
    }

    showToast(`"${itemName}" removed from plan`, 'info');

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Update goal chips if the deleted item was a goal
    renderGoalChips();

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} deleted from plan`);
}

// Add a reaction to an item
async function addReactionToItem(recordId, emoji) {
    if (!recordId || !emoji) return;

    // Initialize reactions map if not exists
    if (!state.session.reactions) {
        state.session.reactions = new Map();
    }

    // Get or create the reactions for this item
    let itemReactions = state.session.reactions.get(recordId);
    if (!itemReactions || !(itemReactions instanceof Map)) {
        itemReactions = new Map();
        state.session.reactions.set(recordId, itemReactions);
    }

    // Use current user ID or generate anonymous ID
    const userId = state.session.user?.id || `anon-${Date.now()}`;

    // Add/update reaction
    itemReactions.set(userId, emoji);

    // Get item name for toast
    const record = getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';
    showToast(`${emoji} added to "${itemName}"`, 'success');

    // Re-render items to show updated reactions
    await renderAllItems();

    // Save session
    triggerSave();

    // Recalculate vitality (sentiment changed, so goodness scores need updating)
    requestVitalityRecalc();

    log('Presentation', `Reaction ${emoji} added to item ${recordId}`);
}

// Add a quick comment to an item
async function addQuickCommentToItem(recordId, comment) {
    if (!recordId || !comment) return;

    // Use the existing comment system if available, otherwise add to notes
    const itemInfo = state.cart.lockedItems.get(recordId) || state.cart.items.get(recordId);
    if (itemInfo) {
        // Append to item notes
        const existingNote = itemInfo.note || '';
        const newNote = existingNote ? `${existingNote}\n• ${comment}` : `• ${comment}`;
        itemInfo.note = newNote;
    }

    const record = getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';
    showToast(`Comment added to "${itemName}"`, 'success');

    // Re-render items
    await renderAllItems();

    // Save session
    triggerSave();

    log('Presentation', `Quick comment added to item ${recordId}: ${comment}`);
}

// Open custom comment dialog for an item
async function openCustomCommentDialog(recordId) {
    if (!recordId) return;

    const record = getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Use prompt for simple implementation (can be enhanced with modal later)
    const comment = prompt(`Add a comment to "${itemName}":`);
    if (comment && comment.trim()) {
        await addQuickCommentToItem(recordId, comment.trim());
    }
}

// =============================================================================
// MERGE MODE - Activated when user drops item on Merge bucket
// Shows all other items as highlighted targets for merging
// =============================================================================

function enterMergeMode(sourceRecordId) {
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
        const sourceRecord = getRecordById(sourceRecordId);
        sourceName = sourceRecord?.fields?.Name || 'Item';
    }
    console.log('[MERGE DEBUG]   sourceName resolved to:', sourceName);

    isMergeModeActive = true;
    mergeModeSourceRecordId = sourceRecordId;

    // Initialize multi-select with the source item pre-selected
    mergeSelectedItems = [sourceRecordId];

    log('Presentation', `Entering multi-select merge mode for: ${sourceName} (${sourceRecordId})`);

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
    showToast(`Select items to merge (${sourceName} already selected)`, 'info');

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

function exitMergeMode() {
    console.log('[MERGE DEBUG] exitMergeMode() called, isMergeModeActive:', isMergeModeActive);
    if (!isMergeModeActive) {
        console.log('[MERGE DEBUG]   Not active, returning early');
        return;
    }

    isMergeModeActive = false;
    mergeModeSourceRecordId = null;
    mergeSelectedItems = [];

    log('Presentation', 'Exiting merge mode');
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

// ── Global Debug Helper ──
// Call window.debugMergeMode() from browser console for instant diagnostics
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

// =============================================================================
// MULTI-SELECT MERGE HELPERS
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
function getItemDisplayName(recordId) {
    if (!recordId) return 'Item';
    if (recordId.startsWith('group-')) {
        const group = state.session.relatedGroups?.find(g => g.id === recordId);
        return group?.name || 'Group';
    }
    const record = getRecordById(recordId);
    return record?.fields?.Name || 'Item';
}

// Open merge dialog for multiple selected items (N items, N >= 2)
function openMergeDialogMulti(selectedIds) {
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
            const rec = getRecordById(id);
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
            const rec = getRecordById(id);
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

    log('Presentation', `Multi-select merge dialog opened for ${allRecordIds.length} items`);

    // Fetch AI estimation in background using all items
    const allItems = allRecordIds.map(id => {
        const rec = getRecordById(id);
        return {
            name: rec?.fields?.Name || 'Item',
            description: rec?.fields?.Description || '',
            category: rec?.fields?.Category || '',
            price: rec?.fields?.Price || ''
        };
    });
    fetchMergeEstimationMulti(allItems);
}

// Store for pending merge estimations
let pendingMergeEstimation = null;
let pendingMergeAllItems = null; // Array of all selected item IDs for multi-select merge

// Execute merge directly based on the drop zone (no dialog)
// zone: 'hybrid' = merge as hybrid, 'options' = add as option
// sourceId/targetId can be either record IDs or group IDs (prefixed with 'group-')
async function executeMergeByZone(sourceId, targetId, zone) {
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
    const sourceRecord = getRecordById(primarySourceId);
    const targetRecord = getRecordById(primaryTargetId);

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
            const rec = getRecordById(id);
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
                    scheduleRenderAllItems();
                    triggerSave();
                    log('Presentation', `Updated hybrid "${actualTarget}" with AI estimation`);
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
            const rec = getRecordById(id);
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
                    scheduleRenderAllItems();
                    triggerSave();
                    log('Presentation', `Updated options group with AI estimation`);
                }
            }
        }).catch(err => {
            console.warn('[Presentation] Background options estimation failed:', err.message);
        });
    }
}

// Open merge dialog for two items (or groups of items)
async function openMergeDialog(sourceRecordId, targetRecordId) {
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
            const rec = getRecordById(id);
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
            const rec = getRecordById(id);
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

    log('Presentation', `Merge dialog opened for ${allRecordIds.length} items`);

    // Fetch AI estimation in background using all items
    const allItems = allRecordIds.map(id => {
        const rec = getRecordById(id);
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

// Close the merge options dialog
function closeMergeDialog() {
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

// Handle merge option: Combine into single idea (As Hybrid)
async function handleMergeCombine() {
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
                const rec = getRecordById(id);
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
                        scheduleRenderAllItems();
                        triggerSave();
                        log('Presentation', `Updated multi-select hybrid "${actualTarget}" with AI estimation`);
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
async function handleMergeGroup() {
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
                const rec = getRecordById(id);
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
                        scheduleRenderAllItems();
                        triggerSave();
                        log('Presentation', `Updated multi-select options group with AI estimation`);
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

// Combine two items into a single cohesive idea (As Hybrid)
async function combineItemsIntoOne(sourceRecordId, targetRecordId, hybridEstimation = null) {
    // Initialize combinedItems if not exists
    // Structure: Map<targetRecordId, { sources: Set<sourceRecordIds>, hybridData: Object|null }>
    if (!state.session.combinedItems) {
        state.session.combinedItems = new Map();
    }

    const sourceRecord = getRecordById(sourceRecordId);
    const targetRecord = getRecordById(targetRecordId);
    const sourceName = sourceRecord?.fields?.Name || 'Item';
    const targetName = targetRecord?.fields?.Name || 'Item';

    // Check if source is already combined into something else
    let actualTarget = targetRecordId;
    for (const [target, data] of state.session.combinedItems.entries()) {
        const sources = data instanceof Set ? data : (data.sources || new Set());
        if (sources.has(sourceRecordId)) {
            // Source is already a source of another combined item
            showToast(`"${sourceName}" is already combined with another item`, 'info');
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

    const finalTargetRecord = getRecordById(actualTarget);
    const hybridName = hybridEstimation?.hybridName;
    const finalDisplayName = hybridName || finalTargetRecord?.fields?.Name || 'Item';

    showToast(`Created hybrid: "${finalDisplayName}"`, 'success');

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Save session
    triggerSave();

    log('Presentation', `Combined ${sourceRecordId} into ${actualTarget}`);

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
            itemImagesCache.set(actualTarget, { images: [collageUrl], currentIndex: 0 });

            // Re-render to show the collage
            scheduleRenderAllItems();
            triggerSave();
            log('Presentation', `Collage image set for hybrid: ${actualTarget}`);
        }
    });
}

// Create a related category linking two items (Group as Options)
async function createRelatedCategory(recordId1, recordId2, optionsEstimation = null) {
    // Initialize relatedGroups if not exists
    // Structure: Array of { id: string, name: string, description: string, items: string[] }
    if (!state.session.relatedGroups) {
        state.session.relatedGroups = [];
    }

    const record1 = getRecordById(recordId1);
    const record2 = getRecordById(recordId2);
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
        showToast('Items are already grouped together', 'info');
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

        showToast(`Merged into "${newGroup.name}"`, 'success');
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
        showToast(`"${name2}" added to "${groupName}"`, 'success');
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
        showToast(`"${name1}" added to "${groupName}"`, 'success');
    } else {
        // Create new group with AI estimation or fallback to generated name
        const newGroup = {
            id: `group-${Date.now()}`,
            name: estimatedName || generateGroupName([recordId1, recordId2]),
            description: estimatedDescription || '',
            items: [recordId1, recordId2]
        };
        state.session.relatedGroups.push(newGroup);
        showToast(`Created category: "${newGroup.name}"`, 'success');
    }

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Save session
    triggerSave();

    log('Presentation', `Created/updated option group for ${recordId1} and ${recordId2}`);
}

// Create a related category from multiple items (Group as Options - multi-item version)
// Merges all provided record IDs into a single options group, consolidating any existing groups
async function createRelatedCategoryMulti(recordIds, optionsEstimation = null) {
    if (!recordIds || recordIds.length < 2) return;

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
            showToast('Items are already grouped together', 'info');
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
        const rec = getRecordById(id);
        return rec?.fields?.Name || 'Item';
    });
    const suffix = mergedItems.length > 3 ? ` +${mergedItems.length - 3} more` : '';
    showToast(`Created "${newGroup.name}" with ${mergedItems.length} options`, 'success');

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Save session
    triggerSave();

    log('Presentation', `Created/updated option group with ${mergedItems.length} items`);
}

// Generate a name for a group based on its items
function generateGroupName(itemIds) {
    if (!itemIds || itemIds.length === 0) return 'Options';

    // Try to find common category or type among items
    const categories = new Set();
    const types = new Set();

    itemIds.forEach(id => {
        const record = getRecordById(id);
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
function getSourcesFromEntry(entry) {
    if (!entry) return new Set();
    if (entry instanceof Set) return entry;
    return entry.sources || new Set();
}

// Check if an item is a source that has been combined into another item
function isItemCombinedSource(recordId) {
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
function getCombinedTarget(sourceRecordId) {
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
function getCombinedSources(targetRecordId) {
    if (!state.session.combinedItems) return [];

    const entry = state.session.combinedItems.get(targetRecordId);
    const sources = getSourcesFromEntry(entry);
    return sources ? Array.from(sources) : [];
}

// Get hybrid data for a combined item target
function getCombinedHybridData(targetRecordId) {
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
async function createCollageImage(targetRecordId, sourceRecordIds) {
    try {
        // Gather all record IDs involved (target + sources)
        const allRecordIds = [targetRecordId, ...sourceRecordIds];
        const imageUrls = [];

        // Fetch the first image for each item
        for (const recordId of allRecordIds) {
            const record = getRecordById(recordId);
            if (!record) continue;

            let urls = [];
            // Check the presentation image cache first
            if (itemImagesCache.has(recordId)) {
                urls = itemImagesCache.get(recordId).images || [];
            } else {
                const result = await api.fetchImagesForRecord(record, state.records.all, new Map());
                urls = result.imageUrls || [];
            }

            if (urls.length > 0) {
                imageUrls.push(urls[0]);
            }
        }

        if (imageUrls.length < 2) {
            log('Presentation', 'Not enough images to create collage');
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
                log('Presentation', `Skipping image that failed to load: ${e.message}`);
            }
        }

        if (images.length < 2) {
            log('Presentation', 'Not enough images loaded for collage');
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
            log('Presentation', `Collage upload failed: ${uploadResponse.status}`);
            return null;
        }

        const uploadResult = await uploadResponse.json();
        if (uploadResult.success && uploadResult.secure_url) {
            log('Presentation', `Collage created and uploaded: ${uploadResult.secure_url}`);
            return uploadResult.secure_url;
        }

        return null;
    } catch (error) {
        log('Presentation', `Error creating collage: ${error.message}`);
        return null;
    }
}

// Check if an item belongs to a related group
function getItemGroup(recordId) {
    if (!state.session.relatedGroups) return null;

    return state.session.relatedGroups.find(g => {
        const items = Array.isArray(g) ? g : (g.items || []);
        return items.includes(recordId);
    });
}

// Open the group detail modal for an options group by its ID
function openGroupDetailModal(groupId) {
    if (!state.session.relatedGroups) return;
    const group = state.session.relatedGroups.find(g => g.id === groupId);
    if (!group) {
        log('Presentation', `Group not found for ID: ${groupId}`);
        return;
    }
    showGroupDetailModal(group, state.records.all);
}

// Uncombine a single source item from a hybrid merge
async function uncombineSource(sourceId, targetId) {
    if (!state.session.combinedItems) return;

    const entry = state.session.combinedItems.get(targetId);
    if (!entry) return;

    const sources = getSourcesFromEntry(entry);
    if (!sources.has(sourceId)) return;

    sources.delete(sourceId);

    const sourceRecord = getRecordById(sourceId);
    const sourceName = sourceRecord?.fields?.Name || 'Item';

    // If no more sources, remove the combined entry entirely
    if (sources.size === 0) {
        state.session.combinedItems.delete(targetId);
    }

    showToast(`"${sourceName}" separated from hybrid`, 'success');

    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();
    triggerSave();
}

// Uncombine all sources from a hybrid merge (split all apart)
async function uncombineAll(targetId) {
    if (!state.session.combinedItems) return;

    state.session.combinedItems.delete(targetId);

    showToast('Hybrid split apart', 'success');

    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();
    triggerSave();
}

// Remove an item from its related group
async function removeFromGroup(recordId, groupId) {
    if (!state.session.relatedGroups) return;

    const groupIndex = state.session.relatedGroups.findIndex(g => g.id === groupId);
    if (groupIndex === -1) return;

    const group = state.session.relatedGroups[groupIndex];
    const items = Array.isArray(group) ? group : (group.items || []);
    const itemIndex = items.indexOf(recordId);
    if (itemIndex === -1) return;

    items.splice(itemIndex, 1);

    const record = getRecordById(recordId);
    const itemName = record?.fields?.Name || 'Item';

    // If group has fewer than 2 items, dissolve it
    if (items.length < 2) {
        state.session.relatedGroups.splice(groupIndex, 1);
        showToast(`"${itemName}" removed, group dissolved`, 'success');
    } else {
        if (!Array.isArray(group)) {
            group.items = items;
        }
        showToast(`"${itemName}" removed from group`, 'success');
    }

    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();
    triggerSave();
}

// Dissolve an entire related group (ungroup all items)
async function dissolveGroup(groupId) {
    if (!state.session.relatedGroups) return;

    const groupIndex = state.session.relatedGroups.findIndex(g => g.id === groupId);
    if (groupIndex === -1) return;

    const group = state.session.relatedGroups[groupIndex];
    const groupName = group.name || 'Group';
    state.session.relatedGroups.splice(groupIndex, 1);

    showToast(`"${groupName}" dissolved`, 'success');

    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();
    triggerSave();
}

// Initialize merge dialog event listeners
function initializeMergeDialogListeners() {
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

// Update the status toggle buttons visibility and state
function updateStatusToggles(archivedCount, completedCount) {
    const archivedToggle = document.getElementById('presentation-toggle-archived');
    const completedToggle = document.getElementById('presentation-toggle-completed');

    // Show/hide archived toggle based on whether there are archived items
    if (archivedToggle) {
        if (archivedCount > 0) {
            archivedToggle.style.display = 'inline-flex';
            archivedToggle.classList.toggle('active', showArchivedItems);
            const countEl = archivedToggle.querySelector('.toggle-count');
            if (countEl) countEl.textContent = archivedCount;
        } else {
            archivedToggle.style.display = 'none';
        }
    }

    // Show/hide completed toggle based on whether there are completed items
    if (completedToggle) {
        if (completedCount > 0) {
            completedToggle.style.display = 'inline-flex';
            completedToggle.classList.toggle('active', showCompletedItems);
            const countEl = completedToggle.querySelector('.toggle-count');
            if (countEl) countEl.textContent = completedCount;
        } else {
            completedToggle.style.display = 'none';
        }
    }
}

// Toggle archived items visibility
async function toggleArchivedItems() {
    showArchivedItems = !showArchivedItems;
    await renderAllItems();
    log('Presentation', `Archived items ${showArchivedItems ? 'shown' : 'hidden'}`);
}

// Toggle completed items visibility
async function toggleCompletedItems() {
    showCompletedItems = !showCompletedItems;
    await renderAllItems();
    log('Presentation', `Completed items ${showCompletedItems ? 'shown' : 'hidden'}`);
}

// Update item order in state after drag reorder
function updateItemOrder() {
    if (!itineraryItemsListEl) return;

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
    triggerSave();

    log('Presentation', `Item order updated: ${newOrder.length} items`);
}

// Cleanup drag-drop on presentation view close
function cleanupItemDragDrop() {
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

/**
 * Calculate reaction rankings for all items in the plan.
 * Returns an array of ranked items with their ranking info.
 * @returns {Array<{recordId: string, rank: number, score: number, reactionCount: number, emojiBreakdown: Object, totalItems: number}>}
 */
function calculateReactionRankings() {
    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    const combinedList = [...locked, ...favorites];

    // Calculate scores for all items
    const itemsWithScores = combinedList.map(item => {
        const reactions = state.session.reactions.get(item.recordId);
        const reactionCount = reactions instanceof Map ? reactions.size : 0;
        const score = getItemReactionScore(item.recordId);

        // Get emoji breakdown
        const emojiBreakdown = {};
        if (reactions instanceof Map) {
            reactions.forEach((emoji) => {
                emojiBreakdown[emoji] = (emojiBreakdown[emoji] || 0) + 1;
            });
        }

        return {
            recordId: item.recordId,
            score,
            reactionCount,
            emojiBreakdown
        };
    });

    // Sort by score (descending), then by reaction count
    const rankedItems = [...itemsWithScores].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.reactionCount - a.reactionCount;
    });

    // Filter items with reactions and add rank
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
 * @param {string} recordId - The item record ID
 * @returns {string} Tooltip text showing rank and emoji breakdown
 */
function getItemRankingTooltip(recordId) {
    const rankings = calculateReactionRankings();
    const itemRanking = rankings.find(item => item.recordId === recordId);

    if (!itemRanking) {
        return '';
    }

    // Build emoji breakdown string
    const emojiBreakdownStr = Object.entries(itemRanking.emojiBreakdown)
        .map(([emoji, count]) => `${emoji}${count > 1 ? '×' + count : ''}`)
        .join(' ');

    // Build medal string for top 3
    let medal = '';
    if (itemRanking.rank === 1) medal = '🥇 ';
    else if (itemRanking.rank === 2) medal = '🥈 ';
    else if (itemRanking.rank === 3) medal = '🥉 ';

    // Build score indicator
    const scoreStr = itemRanking.score > 0 ? `+${itemRanking.score}` : itemRanking.score.toString();

    return `${medal}Rank #${itemRanking.rank} of ${itemRanking.totalItems} | Score: ${scoreStr} | ${emojiBreakdownStr}`;
}

// Render the reactions summary section - now hidden, ranking info moved to tooltips
function renderReactionsSummary() {
    if (!reactionsSummaryEl) {
        reactionsSummaryEl = document.getElementById('reactions-summary-container');
    }
    if (!reactionsSummaryEl) return;

    // Hide the reactions summary container - ranking info is now in item emoji tooltips
    reactionsSummaryEl.innerHTML = '';
    reactionsSummaryEl.style.display = 'none';

    // Update all item emoji indicator tooltips with ranking info
    updateAllItemEmojiTooltips();
}

/**
 * Update all item emoji indicator tooltips with current ranking info.
 * Computes rankings once and looks up each item in the result map (O(n) total).
 */
function updateAllItemEmojiTooltips() {
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

/**
 * Format a ranking object into a tooltip string.
 * Extracted from getItemRankingTooltip to avoid redundant recalculation.
 */
function formatRankingTooltip(itemRanking) {
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

// =============================================================================
// TASK STATUS FUNCTIONS FOR PLAN ELEMENTS
// =============================================================================

/**
 * Get task status for an element (item or detail)
 * @param {string} elementType - 'item' or 'detail'
 * @param {string} elementId - Record ID for items, detail type key for details
 * @returns {string} - Task status value from ELEMENT_TASK_STATUS
 */
function getElementTaskStatus(elementType, elementId) {
    const key = `${elementType}:${elementId}`;
    return elementTaskStatuses.get(key) || ELEMENT_TASK_STATUS.NONE;
}

/**
 * Set task status for an element and persist to state
 * @param {string} elementType - 'item' or 'detail'
 * @param {string} elementId - Record ID for items, detail type key for details
 * @param {string} status - Task status value from ELEMENT_TASK_STATUS
 */
async function setElementTaskStatus(elementType, elementId, status) {
    const key = `${elementType}:${elementId}`;
    elementTaskStatuses.set(key, status);

    // Persist task statuses to session state
    saveElementTaskStatuses();

    // Update UI
    updateElementTaskStatusUI(elementType, elementId, status);

    // Trigger save to persist to Airtable
    triggerSave();

    log('Presentation', `Set task status for ${key}: ${status}`);
}

/**
 * Save element task statuses to the session's Items with Variations JSON
 */
function saveElementTaskStatuses() {
    // Store task statuses as a plain object in eventDetails
    const statusesObj = {};
    elementTaskStatuses.forEach((status, key) => {
        if (status !== ELEMENT_TASK_STATUS.NONE) {
            statusesObj[key] = status;
        }
    });

    // Store in eventDetails combined map with a special key
    state.eventDetails.combined.set('_taskStatuses', statusesObj);
}

/**
 * Load element task statuses from session state
 */
function loadElementTaskStatuses() {
    const statusesObj = state.eventDetails.combined.get('_taskStatuses');
    elementTaskStatuses.clear();

    if (statusesObj && typeof statusesObj === 'object') {
        Object.entries(statusesObj).forEach(([key, status]) => {
            elementTaskStatuses.set(key, status);
        });
    }

    log('Presentation', `Loaded ${elementTaskStatuses.size} element task statuses`);
}

// ========== COMMENT-TO-TASK LINK PERSISTENCE ==========
// Stores mapping of commentId -> taskId for tasks created from comments
// This is persisted to session data since Airtable Tasks table doesn't have a SourceCommentId field

/**
 * Save a comment-to-task link to session storage
 * @param {string} commentId - The comment record ID
 * @param {string} taskId - The task record ID
 */
function saveCommentTaskLink(commentId, taskId) {
    const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
    linksObj[commentId] = taskId;
    state.eventDetails.combined.set('_commentTaskLinks', linksObj);

    console.log('[TASK PERSISTENCE DEBUG] Saved comment-task link:', { commentId, taskId });
    console.log('[TASK PERSISTENCE DEBUG] All comment-task links:', linksObj);

    // Trigger save to persist to Airtable
    triggerSave();
}

/**
 * Load comment-to-task links from session storage and apply to in-memory tasks
 * This restores SourceCommentId on task objects so the UI can show linked tasks correctly
 */
function loadCommentTaskLinks() {
    const linksObj = state.eventDetails.combined.get('_commentTaskLinks');

    console.log('[TASK PERSISTENCE DEBUG] ========== LOADING COMMENT-TASK LINKS ==========');
    console.log('[TASK PERSISTENCE DEBUG] Raw links from session:', linksObj);

    if (!linksObj || typeof linksObj !== 'object') {
        console.log('[TASK PERSISTENCE DEBUG] No comment-task links found in session');
        return;
    }

    const projectId = state.session.id;
    const projectTasks = state.tasks.byProject.get(projectId) || [];

    console.log('[TASK PERSISTENCE DEBUG] Project ID:', projectId);
    console.log('[TASK PERSISTENCE DEBUG] Project tasks count:', projectTasks.length);

    let appliedCount = 0;
    Object.entries(linksObj).forEach(([commentId, taskId]) => {
        // Find the task and apply the SourceCommentId to its fields
        const task = projectTasks.find(t => t.id === taskId);
        if (task) {
            if (!task.fields) {
                task.fields = {};
            }
            task.fields.SourceCommentId = commentId;
            appliedCount++;
            console.log('[TASK PERSISTENCE DEBUG] Applied SourceCommentId to task:', { taskId, commentId, taskName: task.fields?.Name });
        } else {
            console.log('[TASK PERSISTENCE DEBUG] Task not found for link:', { commentId, taskId });
        }
    });

    console.log('[TASK PERSISTENCE DEBUG] Applied', appliedCount, 'comment-task links');
    console.log('[TASK PERSISTENCE DEBUG] ==================================================');
}

/**
 * Get the task ID linked to a comment, if any
 * @param {string} commentId - The comment record ID
 * @returns {string|null} - The linked task ID or null
 */
function getLinkedTaskId(commentId) {
    const linksObj = state.eventDetails.combined.get('_commentTaskLinks') || {};
    return linksObj[commentId] || null;
}

/**
 * Update the UI for a specific element's task status
 * @param {string} elementType - 'item' or 'detail'
 * @param {string} elementId - Record ID for items, detail type key for details
 * @param {string} status - Task status value
 */
function updateElementTaskStatusUI(elementType, elementId, status) {
    const statusBtn = document.querySelector(`.task-status-btn[data-element-type="${elementType}"][data-element-id="${elementId}"]`);
    if (!statusBtn) return;

    const config = TASK_STATUS_CONFIG[status] || TASK_STATUS_CONFIG[ELEMENT_TASK_STATUS.NONE];

    // Update button appearance
    statusBtn.innerHTML = `<span class="task-status-icon">${config.icon}</span>`;
    statusBtn.className = `task-status-btn ${config.className}`;
    statusBtn.title = config.label;
}

/**
 * Render task status button HTML for an element
 * @param {string} elementType - 'item' or 'detail'
 * @param {string} elementId - Record ID for items, detail type key for details
 * @returns {string} - HTML string for the task status button
 */
function renderTaskStatusButton(elementType, elementId) {
    const status = getElementTaskStatus(elementType, elementId);
    const config = TASK_STATUS_CONFIG[status];

    return `
        <button class="task-status-btn ${config.className}"
                data-element-type="${elementType}"
                data-element-id="${elementId}"
                title="${config.label}">
            <span class="task-status-icon">${config.icon}</span>
        </button>
    `;
}

/**
 * Show task status picker dropdown for an element
 * @param {HTMLElement} button - The status button that was clicked
 */
function showTaskStatusPicker(button) {
    const elementType = button.dataset.elementType;
    const elementId = button.dataset.elementId;
    const currentStatus = getElementTaskStatus(elementType, elementId);

    // Remove any existing picker
    const existingPicker = document.querySelector('.task-status-picker');
    if (existingPicker) {
        existingPicker.remove();
    }

    // Create picker dropdown
    const picker = document.createElement('div');
    picker.className = 'task-status-picker';

    // Build options
    const optionsHTML = Object.entries(TASK_STATUS_CONFIG)
        .map(([statusValue, config]) => `
            <button class="task-status-option ${config.className} ${statusValue === currentStatus ? 'active' : ''}"
                    data-status="${statusValue}">
                <span class="option-icon">${config.icon}</span>
                <span class="option-label">${config.label}</span>
            </button>
        `).join('');

    picker.innerHTML = optionsHTML;

    // Position picker near button
    const rect = button.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = `${rect.bottom + 4}px`;
    picker.style.left = `${rect.left}px`;
    picker.style.zIndex = '10001';

    document.body.appendChild(picker);

    // Handle option clicks
    picker.addEventListener('click', async (e) => {
        const option = e.target.closest('.task-status-option');
        if (option) {
            const newStatus = option.dataset.status;
            await setElementTaskStatus(elementType, elementId, newStatus);
            picker.remove();
        }
    });

    // Close picker on outside click
    const closeHandler = (e) => {
        if (!picker.contains(e.target) && e.target !== button) {
            picker.remove();
            document.removeEventListener('click', closeHandler);
        }
    };

    // Delay adding close handler to avoid immediate close
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
    }, 0);
}

/**
 * Show task detail popup/modal for refining task details
 * @param {string} elementType - 'item' or 'detail'
 * @param {string} elementId - Record ID for items, detail type key for details
 * @param {string} elementName - Display name of the element
 */
function showTaskDetailPopup(elementType, elementId, elementName) {
    console.log('[TaskStatus DEBUG] showTaskDetailPopup called:', { elementType, elementId, elementName });

    const currentStatus = getElementTaskStatus(elementType, elementId);
    const config = TASK_STATUS_CONFIG[currentStatus];

    console.log('[TaskStatus DEBUG] Current status:', currentStatus, 'config:', config);

    // Check if user can edit
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    // Fallback: If permissions weren't loaded (direct URL access), use session.isOwned
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;

    // Build affiliated tasks list
    const projectTasks = state.tasks.byProject.get(state.session.id) || [];
    const affiliatableTasksHTML = projectTasks.length > 0 ? `
        <div class="task-detail-section">
            <label>Affiliate with Task</label>
            <select id="task-affiliate-select" class="task-affiliate-select">
                <option value="">-- No affiliation --</option>
                ${projectTasks.map(t => `
                    <option value="${t.id}">${escapeHtml(t.fields?.Name || 'Unnamed Task')}</option>
                `).join('')}
            </select>
        </div>
    ` : '';

    // Map elementType to componentType for comments
    // Items use 'item' component type, details (goals, date) use 'header' type
    const componentType = elementType === 'item' ? api.COMPONENT_TYPES.ITEM : api.COMPONENT_TYPES.HEADER;
    console.log('[TaskStatus DEBUG] componentType for comments:', componentType);

    // Create modal HTML
    const modalHTML = `
        <div id="task-detail-modal-overlay" class="task-detail-modal-overlay">
            <div class="task-detail-modal">
                <div class="task-detail-modal-header">
                    <h3>Task Details</h3>
                    <button class="task-detail-modal-close" id="task-detail-modal-close">&times;</button>
                </div>
                <div class="task-detail-modal-body">
                    <div class="task-detail-element-name">
                        <span class="element-label">${elementType === 'item' ? 'Item' : 'Detail'}:</span>
                        <span class="element-name">${escapeHtml(elementName)}</span>
                    </div>

                    <div class="task-detail-section">
                        <label>Status</label>
                        <div class="task-status-options">
                            ${Object.entries(TASK_STATUS_CONFIG).map(([statusValue, cfg]) => `
                                <button class="task-status-option-btn ${cfg.className} ${statusValue === currentStatus ? 'active' : ''}"
                                        data-status="${statusValue}"
                                        ${!canUserEdit ? 'disabled' : ''}>
                                    <span class="option-icon">${cfg.icon}</span>
                                    <span class="option-label">${cfg.label}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    ${affiliatableTasksHTML}

                    <div class="task-detail-section task-detail-comments-section">
                        <label>💬 Comments</label>
                        <div class="task-detail-comments-list" id="task-detail-comments-list">
                            <div class="comments-loading">Loading comments...</div>
                        </div>
                        <div class="task-detail-comment-input-wrapper">
                            <input type="text"
                                   class="task-detail-comment-input"
                                   id="task-detail-comment-input"
                                   placeholder="Add a comment..."
                                   ${!canUserEdit ? 'disabled' : ''} />
                            <button class="task-detail-comment-submit"
                                    id="task-detail-comment-submit"
                                    title="Post comment"
                                    ${!canUserEdit ? 'disabled' : ''}>
                                <span>→</span>
                            </button>
                        </div>
                    </div>
                </div>
                <div class="task-detail-modal-footer">
                    <button class="task-detail-done-btn" id="task-detail-done-btn">Done</button>
                </div>
            </div>
        </div>
    `;

    // Insert modal
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const overlay = document.getElementById('task-detail-modal-overlay');
    const closeBtn = document.getElementById('task-detail-modal-close');
    const doneBtn = document.getElementById('task-detail-done-btn');

    const closeModal = () => {
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    };

    // Attach event listeners
    closeBtn.addEventListener('click', closeModal);
    doneBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Handle status option clicks
    overlay.querySelectorAll('.task-status-option-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!canUserEdit) return;

            const newStatus = btn.dataset.status;
            await setElementTaskStatus(elementType, elementId, newStatus);

            // Update active state in modal
            overlay.querySelectorAll('.task-status-option-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Handle comment submission
    const commentInput = document.getElementById('task-detail-comment-input');
    const commentSubmitBtn = document.getElementById('task-detail-comment-submit');

    const submitPopupComment = async () => {
        if (!canUserEdit) return;

        const content = commentInput.value.trim();
        if (!content) return;

        const currentUser = getCurrentUser();
        if (!currentUser) {
            showToast('Please sign in to comment', 3000);
            return;
        }

        console.log('[TaskStatus DEBUG] Submitting popup comment:', { content, componentType, elementId });

        // Disable input while submitting
        commentInput.disabled = true;
        commentSubmitBtn.disabled = true;

        try {
            const sessionId = state.session.id;
            const result = await api.postComponentComment(
                sessionId,
                componentType,
                elementId,
                currentUser.id,
                currentUser.name || currentUser.email || 'Anonymous',
                content
            );

            if (result) {
                console.log('[TaskStatus DEBUG] Comment posted successfully:', result.id);
                commentInput.value = '';
                // Reload comments in the popup
                await loadTaskDetailComments(overlay, componentType, elementId);
            } else {
                console.log('[TaskStatus DEBUG] Failed to post comment');
                showToast('Failed to post comment', 3000);
            }
        } catch (error) {
            console.log('[TaskStatus DEBUG] Error posting comment:', error);
            showToast('Failed to post comment', 3000);
        } finally {
            if (canUserEdit) {
                commentInput.disabled = false;
                commentSubmitBtn.disabled = false;
            }
            commentInput.focus();
        }
    };

    commentSubmitBtn.addEventListener('click', submitPopupComment);
    commentInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitPopupComment();
        }
    });

    // Load comments for this element
    loadTaskDetailComments(overlay, componentType, elementId);

    // Show modal with animation
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });
}

/**
 * Load and render comments in the task detail popup
 * @param {HTMLElement} overlay - The modal overlay element
 * @param {string} componentType - The component type (item or header)
 * @param {string} elementId - The element ID
 */
async function loadTaskDetailComments(overlay, componentType, elementId) {
    console.log('[TaskStatus DEBUG] loadTaskDetailComments called:', { componentType, elementId });

    const commentsList = overlay.querySelector('#task-detail-comments-list');
    if (!commentsList) {
        console.log('[TaskStatus DEBUG] No commentsList element found');
        return;
    }

    const sessionId = state.session.id;
    if (!sessionId) {
        commentsList.innerHTML = '<div class="comments-empty">No session loaded</div>';
        return;
    }

    commentsList.innerHTML = '<div class="comments-loading">Loading comments...</div>';

    try {
        const comments = await api.fetchComponentComments(sessionId, componentType, elementId);
        console.log('[TaskStatus DEBUG] Fetched comments for popup:', comments?.length);

        if (!comments || comments.length === 0) {
            commentsList.innerHTML = '<div class="comments-empty">No comments yet. Be the first to comment!</div>';
            return;
        }

        const currentUser = getCurrentUser();

        const commentsHTML = comments.map(comment => {
            const fields = comment.fields;
            const isOwn = fields.SenderID === currentUser?.id;
            const isDeleted = fields.IsDeleted;
            const isEdited = fields.IsEdited;
            const timestamp = new Date(comment.createdTime || fields.Timestamp || Date.now());
            const timeAgo = getTimeAgo(timestamp);

            // Strip out [PLAN_COMMENT:xxx] or [PLAN_COMMENT:item:componentId] prefix from display content
            let displayContent = fields.Content || '';
            displayContent = displayContent.replace(/^\[PLAN_COMMENT:[^\]]+\]\s*/i, '');

            // Strip out embedded [ATTACHMENTS:...] from display content
            let attachments = [];
            const attachmentMatch = displayContent.match(/\[ATTACHMENTS:(.*?)\]$/);
            if (attachmentMatch) {
                try {
                    attachments = JSON.parse(attachmentMatch[1]);
                    displayContent = displayContent.replace(/\[ATTACHMENTS:.*?\]$/, '').trim();
                } catch (e) {
                    console.warn('[TaskStatus] Failed to parse embedded attachments:', e);
                }
            }

            if (isDeleted) {
                return `
                    <div class="task-detail-comment deleted" data-comment-id="${comment.id}">
                        <em class="deleted-comment-text">This comment was deleted</em>
                    </div>
                `;
            }

            // Build attachments HTML for popup comments
            let attachmentsHTML = '';
            if (Array.isArray(attachments) && attachments.length > 0) {
                attachmentsHTML = '<div class="comment-attachments">';
                attachments.forEach(attachment => {
                    if (attachment.type === 'image' && attachment.url) {
                        const optimizedUrl = applyCloudinaryTransform(attachment.url, 'w_200,h_150,c_limit,f_auto,q_auto');
                        attachmentsHTML += `
                            <a href="${escapeHtml(attachment.url)}" target="_blank" class="comment-attachment comment-attachment-image">
                                <img src="${escapeHtml(optimizedUrl)}" alt="Attached image" loading="lazy" />
                            </a>
                        `;
                    }
                });
                attachmentsHTML += '</div>';
            }

            return `
                <div class="task-detail-comment ${isOwn ? 'own-comment' : ''}" data-comment-id="${comment.id}">
                    <div class="comment-header">
                        <span class="comment-author">${escapeHtml(fields.SenderName)}${isOwn ? ' (You)' : ''}</span>
                        <span class="comment-time" title="${timestamp.toLocaleString()}">${timeAgo}</span>
                        ${isEdited ? '<span class="comment-edited">(edited)</span>' : ''}
                    </div>
                    ${displayContent ? `<div class="comment-content">${escapeHtml(displayContent)}</div>` : ''}
                    ${attachmentsHTML}
                </div>
            `;
        }).join('');

        commentsList.innerHTML = commentsHTML;
        console.log('[TaskStatus DEBUG] Rendered', comments.length, 'comments in popup');
    } catch (error) {
        console.log('[TaskStatus DEBUG] Error loading popup comments:', error);
        commentsList.innerHTML = '<div class="comments-error">Failed to load comments</div>';
    }
}

/**
 * Create a task from a comment
 * @param {string} commentId - The comment record ID
 * @param {string} commentContent - The comment text content
 * @param {string} componentId - The component/item ID the comment is on (if any)
 */
async function createTaskFromComment(commentId, commentContent, componentId = null) {
    const currentUser = getCurrentUser();
    if (!currentUser) {
        showToast('Please sign in to create tasks', 3000);
        return;
    }

    // Check permissions
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    // Fallback: If permissions weren't loaded (direct URL access), use session.isOwned
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;

    if (!canUserEdit) {
        showToast('You do not have permission to create tasks', 3000);
        return;
    }

    const projectId = state.session.id;
    if (!projectId) {
        showToast('No active project', 3000);
        return;
    }

    // Get max order for new task
    const projectTasks = state.tasks.byProject.get(projectId) || [];
    const maxOrder = projectTasks.reduce((max, t) => Math.max(max, t.fields?.Order || 0), 0);

    // Create task data
    const taskData = {
        Name: commentContent.substring(0, 100) + (commentContent.length > 100 ? '...' : ''),
        Description: commentContent,
        Status: api.TASK_STATUS.PENDING,
        Order: maxOrder + 1
    };

    // Auto-affiliate with plan item if comment is on a component
    // Only set LinkedItem if it's a valid Airtable record ID (starts with 'rec')
    // AI-generated items have temporary IDs like 'ai-child-*', 'ai-search-*', etc.
    if (componentId && componentId.startsWith('rec')) {
        taskData.LinkedItem = componentId;
    } else if (componentId) {
        // For AI-generated items, store the item name in the task name/description instead
        const itemRecord = getRecordById(componentId);
        if (itemRecord) {
            const itemName = itemRecord.fields?.Name || itemRecord.fields?.['Item Name'] || 'AI Item';
            // Prefix the task name with the item name for context
            taskData.Name = `[${itemName}] ${taskData.Name}`;
        }
    }

    try {
        const newTask = await api.createTask(projectId, taskData);
        if (newTask) {
            // Update local state
            state.tasks.all.set(newTask.id, newTask);
            const existingTasks = state.tasks.byProject.get(projectId) || [];
            state.tasks.byProject.set(projectId, [...existingTasks, newTask]);

            // IMPORTANT: Persist the comment-to-task link if commentId is provided
            if (commentId) {
                saveCommentTaskLink(commentId, newTask.id);

                // Also apply the SourceCommentId to the in-memory task object
                if (!newTask.fields) {
                    newTask.fields = {};
                }
                newTask.fields.SourceCommentId = commentId;
            }

            showToast('Task created from comment!', 2000);
            log('Presentation', `Created task from comment: ${newTask.id}`);
        }
    } catch (error) {
        console.error('Error creating task from comment:', error);
        showToast('Failed to create task', 3000);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function addPresentationMessageToUI(sender, message, isSent, timestamp, senderId, options = {}) {
    if (!chatMessagesEl) return;

    const { messageId = null, reactions = {}, isEdited = false, isDeleted = false, replyCount = 0, parentMessageId = null, isReply = false, componentInfo = null } = options;
    const currentUser = getCurrentUser();

    // Skip deleted messages
    if (isDeleted) {
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'} deleted-message`;
        wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;
        chatMessagesEl.appendChild(wrapper);
        return wrapper;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${isSent ? 'sent' : 'received'}${isReply ? ' is-reply' : ''}${componentInfo ? ' component-comment-msg' : ''}`;
    if (messageId) wrapper.dataset.messageId = messageId;
    if (componentInfo) wrapper.dataset.componentId = componentInfo.id;

    const messageElement = document.createElement('div');
    const isFlagged = state.session.flaggedUsers.has(senderId);
    const isBanned = state.session.bannedUsers.has(senderId);
    const displayMessage = (isFlagged || isBanned) ? '[CENSORED BY MODERATOR]' : message;

    messageElement.className = 'chat-message';
    if (isBanned) messageElement.classList.add('banned');
    if (isFlagged) messageElement.classList.add('flagged');

    // Component tag (shown before sender for component comments)
    if (componentInfo) {
        const componentTag = document.createElement('div');
        componentTag.className = 'component-tag';
        componentTag.innerHTML = `<span class="component-tag-icon">📍</span><span class="component-tag-name">@${escapeHtml(componentInfo.name)}</span>`;
        componentTag.title = `Comment on: ${componentInfo.name}`;
        messageElement.appendChild(componentTag);
    }

    // Create inline header with sender name and timestamp
    const headerRow = document.createElement('div');
    headerRow.className = 'message-header';

    // Sender name (inline)
    const senderElement = document.createElement('span');
    senderElement.className = 'message-author';
    senderElement.innerText = isSent ? 'You' : sender;
    headerRow.appendChild(senderElement);

    // Timestamp (inline with sender)
    const timestampElement = document.createElement('span');
    timestampElement.className = 'timestamp';
    const date = timestamp ? new Date(timestamp) : new Date();
    timestampElement.innerText = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    headerRow.appendChild(timestampElement);

    messageElement.appendChild(headerRow);

    // Message content container
    const contentElement = document.createElement('div');
    contentElement.className = 'message-content';
    contentElement.textContent = displayMessage;

    // Edited indicator
    if (isEdited) {
        const editedIndicator = document.createElement('span');
        editedIndicator.className = 'edited-indicator';
        editedIndicator.textContent = ' (edited)';
        contentElement.appendChild(editedIndicator);
    }

    messageElement.appendChild(contentElement);

    // --- Message Actions (hover menu) ---
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'message-actions';

    // Reaction button
    const reactionBtn = document.createElement('button');
    reactionBtn.className = 'msg-action-btn reaction-btn';
    reactionBtn.innerHTML = '😀';
    reactionBtn.title = 'Add reaction';
    reactionBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showPresentationReactionPicker(wrapper, messageId, senderId);
    });
    actionsContainer.appendChild(reactionBtn);

    // Reply button
    const replyBtn = document.createElement('button');
    replyBtn.className = 'msg-action-btn reply-btn';
    replyBtn.innerHTML = '↩';
    replyBtn.title = 'Reply';
    replyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        startPresentationReply(messageId, sender, message);
    });
    actionsContainer.appendChild(replyBtn);

    // Edit button (only for own messages)
    if (isSent && messageId) {
        const editBtn = document.createElement('button');
        editBtn.className = 'msg-action-btn edit-btn';
        editBtn.innerHTML = '✏️';
        editBtn.title = 'Edit message';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startPresentationEdit(messageId, message, wrapper);
        });
        actionsContainer.appendChild(editBtn);
    }

    // Delete button (only for own messages)
    if (isSent && messageId) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'msg-action-btn delete-btn';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.title = 'Delete message';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmPresentationDelete(messageId, wrapper);
        });
        actionsContainer.appendChild(deleteBtn);
    }

    // Moderation actions for owner (on others' messages)
    if (state.session.user.isOwner && !isSent) {
        const flagBtn = document.createElement('button');
        flagBtn.className = 'msg-action-btn flag-btn';
        flagBtn.innerHTML = isFlagged ? '✅' : '⚠️';
        flagBtn.title = isFlagged ? 'Un-flag user' : 'Flag user';
        flagBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (isFlagged) {
                state.session.flaggedUsers.delete(senderId);
            } else {
                state.session.flaggedUsers.add(senderId);
            }
            await api.updateUserFlagStatus(senderId, !isFlagged);
            // Refresh chat to reflect changes
            await initializePresentationChat();
        });
        actionsContainer.appendChild(flagBtn);

        const banBtn = document.createElement('button');
        banBtn.className = 'msg-action-btn ban-btn';
        banBtn.innerHTML = '⛔';
        banBtn.title = 'Ban user';
        banBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await api.banUser(senderId);
        });
        actionsContainer.appendChild(banBtn);
    }

    messageElement.appendChild(actionsContainer);

    // --- Reactions Display ---
    if (reactions && Object.keys(reactions).length > 0) {
        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'message-reactions';

        for (const [emoji, users] of Object.entries(reactions)) {
            if (users.length > 0) {
                const reactionBadge = document.createElement('button');
                reactionBadge.className = 'reaction-badge';
                const hasUserReacted = users.includes(currentUser?.id);
                if (hasUserReacted) reactionBadge.classList.add('user-reacted');
                reactionBadge.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
                reactionBadge.title = users.length === 1 ? '1 reaction' : `${users.length} reactions`;
                reactionBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePresentationReaction(messageId, emoji, !hasUserReacted, wrapper);
                });
                reactionsContainer.appendChild(reactionBadge);
            }
        }

        messageElement.appendChild(reactionsContainer);
    }

    // --- Thread indicator ---
    if (replyCount > 0) {
        const threadIndicator = document.createElement('button');
        threadIndicator.className = 'thread-indicator';
        threadIndicator.innerHTML = `↳ ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`;
        threadIndicator.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePresentationThreadView(messageId, wrapper);
        });
        messageElement.appendChild(threadIndicator);
    }

    wrapper.appendChild(messageElement);
    chatMessagesEl.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: 'smooth' });

    return wrapper;
}

/**
 * Shows the emoji reaction picker near a message in presentation view
 */
function showPresentationReactionPicker(wrapper, messageId, senderId) {
    console.log('[ReactionPicker DEBUG] showPresentationReactionPicker called');
    console.log('[ReactionPicker DEBUG] wrapper:', wrapper);
    console.log('[ReactionPicker DEBUG] messageId:', messageId);
    console.log('[ReactionPicker DEBUG] QUICK_REACTIONS:', QUICK_REACTIONS);

    // Remove any existing picker
    const existingPickers = document.querySelectorAll('.reaction-picker');
    console.log('[ReactionPicker DEBUG] Existing pickers found:', existingPickers.length);
    existingPickers.forEach(p => p.remove());

    // Find the reaction button to position near it
    const reactionBtn = wrapper.querySelector('.msg-action-btn.reaction-btn');
    console.log('[ReactionPicker DEBUG] reactionBtn found:', reactionBtn);
    if (!reactionBtn) {
        console.log('[ReactionPicker DEBUG] ❌ No reaction button found, returning early');
        return;
    }

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    console.log('[ReactionPicker DEBUG] Created picker element:', picker);

    QUICK_REACTIONS.forEach((emoji, index) => {
        console.log(`[ReactionPicker DEBUG] Adding emoji ${index}:`, emoji, 'type:', typeof emoji);
        const btn = document.createElement('button');
        btn.className = 'reaction-picker-btn';
        btn.textContent = emoji;
        console.log(`[ReactionPicker DEBUG] Button ${index} textContent set to:`, btn.textContent);
        btn.addEventListener('click', async () => {
            console.log('[ReactionPicker DEBUG] Emoji button clicked:', emoji);
            picker.remove();
            await togglePresentationReaction(messageId, emoji, true, wrapper);
        });
        picker.appendChild(btn);
    });

    console.log('[ReactionPicker DEBUG] Picker innerHTML:', picker.innerHTML);
    console.log('[ReactionPicker DEBUG] Picker children count:', picker.children.length);

    // Append to body to avoid overflow clipping issues in presentation view
    document.body.appendChild(picker);
    console.log('[ReactionPicker DEBUG] ✅ Picker appended to document.body');

    // Position the picker near the reaction button
    const rect = reactionBtn.getBoundingClientRect();
    console.log('[ReactionPicker DEBUG] Button rect:', rect);

    picker.style.position = 'fixed';
    picker.style.zIndex = '10001'; // Higher than presentation modal (z-index: 1000)

    // Position above the button if there's room, otherwise below
    const pickerHeight = 50; // Approximate height
    if (rect.top > pickerHeight + 10) {
        picker.style.top = `${rect.top - pickerHeight - 8}px`;
    } else {
        picker.style.top = `${rect.bottom + 8}px`;
    }
    picker.style.left = `${Math.max(10, rect.left - 50)}px`;

    console.log('[ReactionPicker DEBUG] Final picker styles:', {
        position: picker.style.position,
        top: picker.style.top,
        left: picker.style.left,
        zIndex: picker.style.zIndex
    });

    // Verify picker is in DOM
    setTimeout(() => {
        const verifyPicker = document.querySelector('.reaction-picker');
        console.log('[ReactionPicker DEBUG] Verify picker in DOM after append:', verifyPicker);
        if (verifyPicker) {
            const computedStyle = window.getComputedStyle(verifyPicker);
            console.log('[ReactionPicker DEBUG] Picker computed styles:', {
                display: computedStyle.display,
                visibility: computedStyle.visibility,
                opacity: computedStyle.opacity,
                position: computedStyle.position,
                zIndex: computedStyle.zIndex,
                width: computedStyle.width,
                height: computedStyle.height
            });
        }
    }, 10);

    // Close picker when clicking elsewhere
    const closePicker = (e) => {
        console.log('[ReactionPicker DEBUG] closePicker triggered, target:', e.target);
        if (!picker.contains(e.target)) {
            console.log('[ReactionPicker DEBUG] Click outside picker, removing');
            picker.remove();
            document.removeEventListener('click', closePicker);
        }
    };
    setTimeout(() => document.addEventListener('click', closePicker), 0);
}

/**
 * Toggles a reaction on a message in presentation view
 */
async function togglePresentationReaction(messageId, emoji, add, wrapper) {
    const currentUser = getCurrentUser();
    if (!messageId || !currentUser) return;

    const result = await api.toggleMessageReaction(messageId, currentUser.id, emoji, add);
    if (result !== null) {
        // Update the reactions display
        updatePresentationReactionsDisplay(wrapper, result);

        // Broadcast via Pusher if available
        if (presentationChatChannel) {
            presentationChatChannel.trigger('client-reaction-update', {
                messageId,
                reactions: result,
                userId: currentUser.id
            });
        }
    }
}

/**
 * Updates the reactions display on a message wrapper in presentation view
 */
function updatePresentationReactionsDisplay(wrapper, reactions) {
    const messageElement = wrapper.querySelector('.chat-message');
    if (!messageElement) return;

    const currentUser = getCurrentUser();

    // Remove existing reactions container
    const existingReactions = messageElement.querySelector('.message-reactions');
    if (existingReactions) existingReactions.remove();

    // Add new reactions if any exist
    if (reactions && Object.keys(reactions).length > 0) {
        const reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'message-reactions';

        for (const [emoji, users] of Object.entries(reactions)) {
            if (users.length > 0) {
                const reactionBadge = document.createElement('button');
                reactionBadge.className = 'reaction-badge';
                const hasUserReacted = users.includes(currentUser?.id);
                if (hasUserReacted) reactionBadge.classList.add('user-reacted');
                reactionBadge.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
                const messageId = wrapper.dataset.messageId;
                reactionBadge.addEventListener('click', (e) => {
                    e.stopPropagation();
                    togglePresentationReaction(messageId, emoji, !hasUserReacted, wrapper);
                });
                reactionsContainer.appendChild(reactionBadge);
            }
        }

        // Insert before thread indicator or at end
        const threadIndicator = messageElement.querySelector('.thread-indicator');
        if (threadIndicator) {
            messageElement.insertBefore(reactionsContainer, threadIndicator);
        } else {
            messageElement.appendChild(reactionsContainer);
        }
    }
}

/**
 * Starts replying to a message in presentation view
 */
function startPresentationReply(messageId, senderName, messagePreview) {
    presentationReplyingToMessage = { id: messageId, sender: senderName, preview: messagePreview };

    // Show reply indicator in the input area
    const formContainer = presentationMessageForm;
    if (!formContainer || !formContainer.parentElement) return;

    // Remove existing reply indicator
    const existingIndicator = formContainer.parentElement.querySelector('.reply-indicator');
    if (existingIndicator) existingIndicator.remove();

    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'reply-indicator';
    replyIndicator.innerHTML = `
        <span class="reply-indicator-text">Replying to <strong>${escapeHtml(senderName)}</strong>: ${escapeHtml(messagePreview.substring(0, 50))}${messagePreview.length > 50 ? '...' : ''}</span>
        <button class="cancel-reply-btn" type="button">✕</button>
    `;

    replyIndicator.querySelector('.cancel-reply-btn').addEventListener('click', cancelPresentationReply);
    formContainer.parentElement.insertBefore(replyIndicator, formContainer);

    // Focus the input
    if (presentationMessageInput) presentationMessageInput.focus();
}

/**
 * Cancels the current reply in presentation view
 */
function cancelPresentationReply() {
    presentationReplyingToMessage = null;
    const formContainer = presentationMessageForm;
    if (formContainer && formContainer.parentElement) {
        const indicator = formContainer.parentElement.querySelector('.reply-indicator');
        if (indicator) indicator.remove();
    }
}

/**
 * Starts editing a message in presentation view
 */
function startPresentationEdit(messageId, currentContent, wrapper) {
    presentationEditingMessage = { id: messageId, originalContent: currentContent };

    const contentElement = wrapper.querySelector('.message-content');
    if (!contentElement) return;

    // Replace content with input
    const originalText = currentContent;
    contentElement.innerHTML = `
        <input type="text" class="edit-message-input" value="${escapeHtml(originalText)}">
        <div class="edit-actions">
            <button class="save-edit-btn" type="button">Save</button>
            <button class="cancel-edit-btn" type="button">Cancel</button>
        </div>
    `;

    const input = contentElement.querySelector('.edit-message-input');
    const saveBtn = contentElement.querySelector('.save-edit-btn');
    const cancelBtn = contentElement.querySelector('.cancel-edit-btn');
    const currentUser = getCurrentUser();

    input.focus();
    input.select();

    const saveEdit = async () => {
        const newContent = input.value.trim();
        if (newContent && newContent !== originalText) {
            const result = await api.updateChatMessage(messageId, newContent, currentUser.id);
            if (result) {
                contentElement.innerHTML = '';
                contentElement.textContent = newContent;
                const editedIndicator = document.createElement('span');
                editedIndicator.className = 'edited-indicator';
                editedIndicator.textContent = ' (edited)';
                contentElement.appendChild(editedIndicator);

                // Broadcast edit via Pusher
                if (presentationChatChannel) {
                    presentationChatChannel.trigger('client-message-edited', {
                        messageId,
                        newContent,
                        userId: currentUser.id
                    });
                }
            }
        } else {
            cancelEditMode();
        }
        presentationEditingMessage = null;
    };

    const cancelEditMode = () => {
        contentElement.innerHTML = '';
        contentElement.textContent = originalText;
        presentationEditingMessage = null;
    };

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEditMode);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') cancelEditMode();
    });
}

/**
 * Confirms and deletes a message in presentation view
 */
async function confirmPresentationDelete(messageId, wrapper) {
    if (!confirm('Delete this message? This cannot be undone.')) return;

    const currentUser = getCurrentUser();
    const result = await api.deleteChatMessage(messageId, currentUser.id);
    if (result) {
        wrapper.classList.add('deleted-message');
        wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;

        // Broadcast delete via Pusher
        if (presentationChatChannel) {
            presentationChatChannel.trigger('client-message-deleted', {
                messageId,
                userId: currentUser.id
            });
        }
    }
}

/**
 * Toggles the thread view for a message in presentation view
 */
async function togglePresentationThreadView(messageId, wrapper) {
    const existingThread = wrapper.querySelector('.thread-replies');
    if (existingThread) {
        existingThread.remove();
        return;
    }

    const currentUser = getCurrentUser();
    const replies = await api.fetchMessageReplies(messageId);
    if (replies.length === 0) return;

    const threadContainer = document.createElement('div');
    threadContainer.className = 'thread-replies';

    replies.forEach(reply => {
        const { SenderID, SenderName, Content, Timestamp, IsEdited, IsDeleted, Reactions } = reply.fields;
        const isSent = SenderID === currentUser?.id;
        let parsedReactions = {};
        if (Reactions) {
            try { parsedReactions = JSON.parse(Reactions); } catch (e) {}
        }
        // Use createdTime from record level, fall back to fields.Timestamp
        const replyTime = new Date(reply.createdTime || Timestamp || Date.now());

        const replyWrapper = document.createElement('div');
        replyWrapper.className = `reply-message ${isSent ? 'sent' : 'received'}`;
        replyWrapper.dataset.messageId = reply.id;

        if (IsDeleted) {
            replyWrapper.innerHTML = `<em class="deleted-reply">This reply was deleted</em>`;
        } else {
            replyWrapper.innerHTML = `
                <span class="reply-sender">${isSent ? 'You' : escapeHtml(SenderName)}</span>
                <span class="reply-content">${escapeHtml(Content)}${IsEdited ? ' <em class="edited-indicator">(edited)</em>' : ''}</span>
                <span class="reply-time">${replyTime.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            `;
        }

        threadContainer.appendChild(replyWrapper);
    });

    wrapper.appendChild(threadContainer);
}

function updatePresentationPresenceUI(members) {
    const count = members.count;
    if (presentationWhosHereCount) presentationWhosHereCount.innerText = count;

    // Track which member IDs are currently online
    const onlineMemberIds = new Set();
    members.each((member) => {
        onlineMemberIds.add(member.id);
    });

    if (presentationWhosHereList) {
        presentationWhosHereList.innerHTML = '';
        members.each((member) => {
            const currentUser = getCurrentUser();
            const profileId = state.session.user.isAuthenticated ? state.session.user.id : member.id;
            const profileName = state.session.user.isAuthenticated ? state.session.user.name : member.info.name;

            if (!state.session.userProfiles.has(profileId)) {
                state.session.userProfiles.set(profileId, profileName);
                triggerSave();
            }

            const userElement = document.createElement('div');
            userElement.className = 'presentation-presence-item';
            const displayName = member.id === currentUser.id ? currentUser.name : member.info.name;
            userElement.innerHTML = `<span class="presence-dot"></span>${displayName}${member.id === currentUser.id ? ' (You)' : ''}`;
            presentationWhosHereList.appendChild(userElement);
        });
    }

    // Update collaborator name buttons with online presence indicators
    const collabBtns = document.querySelectorAll('.collaborator-name-btn[data-collaborator-id]');
    collabBtns.forEach(btn => {
        const collabId = btn.dataset.collaboratorId;
        if (onlineMemberIds.has(collabId)) {
            btn.classList.add('online');
        } else {
            btn.classList.remove('online');
        }
    });

    // Update Team metric count to show online/total
    const teamMetric = document.querySelector('#plan-metric-team .plan-metric-value');
    if (teamMetric) {
        const totalTeam = state.session.userProfiles?.size || 1;
        if (count > 1) {
            teamMetric.textContent = `${count}/${totalTeam}`;
        } else {
            teamMetric.textContent = totalTeam;
        }
    }
}

async function initializePresentationChat() {
    const currentUser = getCurrentUser();
    const sessionId = state.session.id || 'default-session';

    // Set up user name input
    if (presentationUserNameInput) {
        presentationUserNameInput.value = currentUser.name;
        presentationUserNameInput.addEventListener('change', (e) => {
            const newName = e.target.value.trim();
            if (newName && newName !== currentUser.name) {
                currentUser.name = newName;
                localStorage.setItem('chatUserName', newName);
                state.session.userProfiles.set(currentUser.id, newName);
                log('Presentation', `User name changed to: ${newName}`);
                if (presentationChatChannel && presentationChatChannel.members) {
                    updatePresentationPresenceUI(presentationChatChannel.members);
                }
                triggerSave();
            } else {
                e.target.value = currentUser.name;
            }
        });
    }

    // Load existing chat messages with enhanced data
    chatMessagesEl.innerHTML = '';
    try {
        const records = await api.fetchChatMessages(sessionId);

        // Count replies per message for thread indicators
        const replyCountMap = {};
        records.forEach(record => {
            const parentId = record.fields.ParentMessageID;
            if (parentId) {
                replyCountMap[parentId] = (replyCountMap[parentId] || 0) + 1;
            }
        });

        if (records.length > 0) {
            records.forEach(record => {
                const { SenderID, SenderName, Content, Timestamp, EventType, Reactions, IsEdited, IsDeleted, ParentMessageID } = record.fields;
                const itemLink = record.fields['Item Link']; // Array of linked item IDs (for component comments)

                // Skip reply messages (they're shown in threads) and system events
                if (ParentMessageID) return;
                if (SenderID === 'system' && EventType) return;

                const isSent = SenderID === currentUser.id;
                let parsedReactions = {};
                if (Reactions) {
                    try { parsedReactions = JSON.parse(Reactions); } catch (e) {}
                }

                // Get component name if this is a component comment (has Item Link)
                let componentInfo = null;
                if (itemLink && itemLink.length > 0) {
                    const componentId = itemLink[0];
                    const componentRecord = getRecordById(componentId);
                    componentInfo = {
                        id: componentId,
                        name: componentRecord?.fields?.Name || 'Unknown Item'
                    };
                }

                // Use createdTime from record level, fall back to fields.Timestamp
                const messageTime = record.createdTime || Timestamp;

                addPresentationMessageToUI(SenderName, Content, isSent, messageTime, SenderID, {
                    messageId: record.id,
                    reactions: parsedReactions,
                    isEdited: IsEdited || false,
                    isDeleted: IsDeleted || false,
                    replyCount: replyCountMap[record.id] || 0,
                    componentInfo // Include component info for @component tags
                });
            });
        } else {
            chatMessagesEl.innerHTML = '<p class="chat-empty">No messages yet. Start the conversation!</p>';
        }
    } catch (err) {
        log('Presentation', `Failed to load chat messages: ${err.message}`);
        chatMessagesEl.innerHTML = '<p class="chat-empty">Unable to load messages.</p>';
    }

    // Wait for Pusher library to be loaded
    if (typeof window.waitForPusher === 'function') {
        try {
            await window.waitForPusher();
        } catch (err) {
            if (presentationMessageInput) {
                presentationMessageInput.placeholder = 'Chat unavailable - please refresh';
                presentationMessageInput.disabled = true;
            }
            return;
        }
    } else if (typeof Pusher === 'undefined') {
        if (presentationMessageInput) {
            presentationMessageInput.placeholder = 'Chat unavailable - please refresh';
            presentationMessageInput.disabled = true;
        }
        return;
    }

    // Disconnect existing connection if any
    if (presentationPusher) {
        presentationPusher.disconnect();
    }

    // Initialize Pusher for real-time chat
    presentationPusher = new Pusher('236f480714e5001590b5', {
        cluster: 'us3',
        authEndpoint: '/api/pusher-auth',
        auth: {
            params: {
                user_id: currentUser.id,
                user_name: currentUser.name
            }
        }
    });

    const channelName = `presence-session-${sessionId}`;
    presentationChatChannel = presentationPusher.subscribe(channelName);

    // Bind presence events
    presentationChatChannel.bind('pusher:subscription_succeeded', (members) => {
        if (presentationMessageInput) {
            presentationMessageInput.disabled = false;
            presentationMessageInput.placeholder = 'Type a message...';
        }
        updatePresentationPresenceUI(members);
    });

    presentationChatChannel.bind('pusher:member_added', (member) => {
        updatePresentationPresenceUI(presentationChatChannel.members);
        // Show toast when someone joins
        handleToastPusherEvent('member-joined', {
            name: member?.info?.name || 'Someone',
            userId: member?.id
        });
    });

    presentationChatChannel.bind('pusher:member_removed', () => {
        updatePresentationPresenceUI(presentationChatChannel.members);
    });

    // Bind to receive new messages
    presentationChatChannel.bind('client-new-message', (data) => {
        if (data.senderId !== currentUser.id) {
            // Remove empty state message if present
            const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
            if (emptyMsg) emptyMsg.remove();

            addPresentationMessageToUI(data.senderName, data.content, false, data.timestamp, data.senderId, {
                messageId: data.messageId
            });
            // Refresh forum panel if open
            refreshForumData();
            // Update notification counts
            onNewItemReceived('message', { timestamp: data.timestamp });
            // Show toast notification
            const isIdea = (data.content || '').startsWith('[IDEA]');
            handleToastPusherEvent('new-message', {
                sender: data.senderName,
                message: isIdea ? data.content.replace(/^\[IDEA\]\s*/, '') : data.content,
                senderId: data.senderId,
                isIdea: isIdea
            });
        }
    });

    // Handle real-time reaction updates from other users
    presentationChatChannel.bind('client-reaction-update', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = chatMessagesEl.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                updatePresentationReactionsDisplay(wrapper, data.reactions);
            }
            // Refresh forum panel if open to show updated reactions
            refreshForumData();
            // Update notification counts
            onNewItemReceived('reaction', { timestamp: new Date().toISOString() });
        }
    });

    // Handle real-time message edits from other users
    presentationChatChannel.bind('client-message-edited', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = chatMessagesEl.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                const contentElement = wrapper.querySelector('.message-content');
                if (contentElement) {
                    contentElement.textContent = data.newContent;
                    if (!contentElement.querySelector('.edited-indicator')) {
                        const editedIndicator = document.createElement('span');
                        editedIndicator.className = 'edited-indicator';
                        editedIndicator.textContent = ' (edited)';
                        contentElement.appendChild(editedIndicator);
                    }
                }
            }
            // Refresh forum panel if open to show edited message
            refreshForumData();
        }
    });

    // Handle real-time message deletes from other users
    presentationChatChannel.bind('client-message-deleted', (data) => {
        if (data.userId !== currentUser.id) {
            const wrapper = chatMessagesEl.querySelector(`[data-message-id="${data.messageId}"]`);
            if (wrapper) {
                wrapper.classList.add('deleted-message');
                wrapper.innerHTML = `<div class="chat-message deleted"><em>This message was deleted</em></div>`;
            }
            // Refresh forum panel if open to show deleted message
            refreshForumData();
        }
    });

    // Handle real-time replies from other users
    presentationChatChannel.bind('client-new-reply', (data) => {
        if (data.senderId !== currentUser.id) {
            const parentWrapper = chatMessagesEl.querySelector(`[data-message-id="${data.parentMessageId}"]`);
            if (parentWrapper) {
                const existingIndicator = parentWrapper.querySelector('.thread-indicator');
                if (existingIndicator) {
                    const currentCount = parseInt(existingIndicator.textContent.match(/\d+/)?.[0] || '0');
                    existingIndicator.innerHTML = `↳ ${currentCount + 1} ${currentCount + 1 === 1 ? 'reply' : 'replies'}`;
                } else {
                    const threadIndicator = document.createElement('button');
                    threadIndicator.className = 'thread-indicator';
                    threadIndicator.innerHTML = `↳ 1 reply`;
                    threadIndicator.addEventListener('click', (e) => {
                        e.stopPropagation();
                        togglePresentationThreadView(data.parentMessageId, parentWrapper);
                    });
                    parentWrapper.querySelector('.chat-message')?.appendChild(threadIndicator);
                }
            }
            // Refresh forum panel if open to show new replies
            refreshForumData();
            // Update notification counts
            onNewItemReceived('reply', { timestamp: new Date().toISOString() });
        }
    });

    // Handle real-time component comments from other users
    presentationChatChannel.bind('client-component-comment', (data) => {
        if (data.senderId !== currentUser.id) {
            const componentId = data.componentId;
            // Update count
            const countEl = document.querySelector(`.comments-count[data-component-id="${componentId}"]`);
            if (countEl) {
                const currentCount = parseInt(countEl.textContent) || 0;
                countEl.textContent = currentCount + 1;
            }
            // Reload comments if section is open
            const body = document.querySelector(`.component-comments-body[data-component-id="${componentId}"]`);
            if (body && body.style.display !== 'none') {
                loadComponentComments(componentId);
            }

            // Also add the comment to the chat area with @component tag
            if (chatMessagesEl && data.comment) {
                const componentRecord = getRecordById(componentId);
                const componentInfo = {
                    id: componentId,
                    name: componentRecord?.fields?.Name || 'Unknown Item'
                };

                // Remove empty state if present
                const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
                if (emptyMsg) emptyMsg.remove();

                addPresentationMessageToUI(
                    data.comment.fields?.SenderName || 'Unknown',
                    data.comment.fields?.Content || '',
                    false,
                    data.comment.fields?.Timestamp || new Date().toISOString(),
                    data.senderId,
                    {
                        messageId: data.comment.id,
                        componentInfo
                    }
                );
            }

            // Refresh forum panel if open to show new component comments
            refreshForumData();
            // Update notification counts for new component comment
            onNewItemReceived('comment', { timestamp: data.comment.fields?.Timestamp || new Date().toISOString() });
            log('Presentation', `Received component comment from ${data.senderId} on ${componentId}`);
        }
    });

    // Handle real-time component comment reactions from other users
    presentationChatChannel.bind('client-component-comment-reaction', (data) => {
        if (data.senderId !== currentUser.id) {
            const commentEl = document.querySelector(`.component-comment[data-comment-id="${data.commentId}"]`);
            if (commentEl) {
                updateCommentReactionsDisplay(commentEl, data.reactions);
            }
            // Refresh forum panel if open to show updated reactions
            refreshForumData();
        }
    });

    // Handle real-time item reaction updates from other users
    presentationChatChannel.bind('client-item-reaction-update', (data) => {
        if (data.userId !== currentUser.id) {
            const { recordId, reactions } = data;

            // Update local state from received reactions object
            if (!state.session.reactions.has(recordId)) {
                state.session.reactions.set(recordId, new Map());
            }
            const itemReactions = state.session.reactions.get(recordId);

            // Clear existing and rebuild from received data
            itemReactions.clear();
            if (reactions && typeof reactions === 'object') {
                Object.entries(reactions).forEach(([odUserId, userEmoji]) => {
                    itemReactions.set(odUserId, userEmoji);
                });
            }

            // Re-render reactions for this item
            const reactionContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
            if (reactionContainer) {
                renderReactions(recordId, reactionContainer);
            }

            // Update the emoji indicator next to item name
            updateItemEmojiIndicator(recordId);

            // Update the reactions summary
            renderReactionsSummary();

            // Update the event-level emoji indicator
            updateEventEmojiIndicator();
        }
    });

    // Set up message form submission
    if (presentationMessageForm) {
        const newForm = presentationMessageForm.cloneNode(true);
        presentationMessageForm.parentNode.replaceChild(newForm, presentationMessageForm);
        presentationMessageForm = newForm;

        const newInput = document.getElementById('presentation-message-input');
        presentationMessageInput = newInput;

        newForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const message = presentationMessageInput.value.trim();
            if (!message) return;

            // Remove empty state message if present
            const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
            if (emptyMsg) emptyMsg.remove();

            const timestamp = new Date().toISOString();

            // Check if this is a reply
            if (presentationReplyingToMessage) {
                const result = await api.postReplyMessage(presentationReplyingToMessage.id, sessionId, null, currentUser.id, currentUser.name, message);
                if (result) {
                    // Update the parent message's reply count in UI
                    const parentWrapper = chatMessagesEl.querySelector(`[data-message-id="${presentationReplyingToMessage.id}"]`);
                    if (parentWrapper) {
                        const existingIndicator = parentWrapper.querySelector('.thread-indicator');
                        if (existingIndicator) {
                            const currentCount = parseInt(existingIndicator.textContent.match(/\d+/)?.[0] || '0');
                            existingIndicator.innerHTML = `↳ ${currentCount + 1} ${currentCount + 1 === 1 ? 'reply' : 'replies'}`;
                        } else {
                            const threadIndicator = document.createElement('button');
                            threadIndicator.className = 'thread-indicator';
                            threadIndicator.innerHTML = `↳ 1 reply`;
                            threadIndicator.addEventListener('click', (e) => {
                                e.stopPropagation();
                                togglePresentationThreadView(presentationReplyingToMessage.id, parentWrapper);
                            });
                            parentWrapper.querySelector('.chat-message')?.appendChild(threadIndicator);
                        }
                    }
                    presentationChatChannel.trigger('client-new-reply', {
                        parentMessageId: presentationReplyingToMessage.id,
                        content: message,
                        senderId: currentUser.id,
                        senderName: currentUser.name,
                        timestamp: timestamp
                    });
                }
                cancelPresentationReply();
            } else {
                // Regular message (not a reply)
                addPresentationMessageToUI(currentUser.name, message, true, timestamp, currentUser.id);

                // Send via API and broadcast
                try {
                    await api.postChatMessage(sessionId, currentUser.id, currentUser.name, message);
                    presentationChatChannel.trigger('client-new-message', {
                        content: message,
                        senderId: currentUser.id,
                        senderName: currentUser.name,
                        timestamp: timestamp
                    });
                } catch (err) {
                    log('Presentation', `Failed to send message: ${err.message}`);
                }
            }

            // Clear input
            presentationMessageInput.value = '';
        });
    }

    log('Presentation', 'Embedded chat initialized with enhanced features');
}

function cleanupPresentationChat() {
    // Disconnect Pusher when leaving presentation view
    if (presentationChatChannel) {
        presentationChatChannel.unbind_all();
    }
    if (presentationPusher) {
        presentationPusher.disconnect();
        presentationPusher = null;
        presentationChatChannel = null;
    }
    // Clear reply state
    presentationReplyingToMessage = null;
    presentationEditingMessage = null;
}

// Scroll handler reference for cleanup
let floatingChatScrollHandler = null;

/**
 * Initializes the floating chat button for the presentation view
 * Shows/hides based on scroll position and handles jump to chat functionality
 */
function initializeFloatingChatButton() {
    if (!floatingChatBtn || !modal) return;

    const presentationContent = modal.querySelector('.presentation-content');
    const chatContainer = modal.querySelector('#presentation-chat-container');

    if (!presentationContent || !chatContainer) return;

    // Function to check if chat section is visible in viewport
    const isChatInView = () => {
        const chatRect = chatContainer.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        // Chat is "in view" if its top is visible within the modal
        return chatRect.top < modalRect.bottom - 100 && chatRect.bottom > modalRect.top;
    };

    // Scroll handler
    floatingChatScrollHandler = () => {
        const chatVisible = isChatInView();

        // Toggle scrolled-to-chat class for icon rotation
        if (chatVisible) {
            floatingChatBtn.classList.add('scrolled-to-chat');
            floatingChatBtn.title = 'Back to top';
        } else {
            floatingChatBtn.classList.remove('scrolled-to-chat');
            floatingChatBtn.title = 'Jump to Chat';
        }
    };

    // Add scroll listener to modal (presentation content scrolls within it)
    presentationContent.addEventListener('scroll', floatingChatScrollHandler);

    // Click handler for the floating button
    const clickHandler = () => {
        const chatVisible = isChatInView();

        if (chatVisible) {
            // If viewing chat, scroll back to top or saved position
            if (savedScrollPosition !== null) {
                presentationContent.scrollTo({ top: savedScrollPosition, behavior: 'smooth' });
                savedScrollPosition = null;
            } else {
                presentationContent.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } else {
            // Save current position and scroll to chat
            savedScrollPosition = presentationContent.scrollTop;
            chatContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });

            // Also expand the hosts-chat sub-accordion if it's collapsed
            if (!accordionState['hosts-chat']) {
                const hostsChatAccordion = modal.querySelector('.sub-accordion[data-section="hosts-chat"]');
                const hostsChatHeader = hostsChatAccordion?.querySelector('.sub-accordion-header');
                if (hostsChatHeader) hostsChatHeader.click();
            }

            // Focus the input after scrolling
            setTimeout(() => {
                if (presentationMessageInput) presentationMessageInput.focus();
            }, 500);
        }
    };

    // Store handler for cleanup
    floatingChatBtn._clickHandler = clickHandler;
    floatingChatBtn.addEventListener('click', clickHandler);

    // Show the button
    floatingChatBtn.classList.add('visible');

    // Initial check
    floatingChatScrollHandler();

    log('Presentation', 'Floating chat button initialized');
}

/**
 * Cleans up the floating chat button event listeners
 */
function cleanupFloatingChatButton() {
    if (floatingChatBtn) {
        floatingChatBtn.classList.remove('visible', 'scrolled-to-chat');

        if (floatingChatBtn._clickHandler) {
            floatingChatBtn.removeEventListener('click', floatingChatBtn._clickHandler);
            floatingChatBtn._clickHandler = null;
        }
    }

    if (floatingChatScrollHandler && modal) {
        const presentationContent = modal.querySelector('.presentation-content');
        if (presentationContent) {
            presentationContent.removeEventListener('scroll', floatingChatScrollHandler);
        }
        floatingChatScrollHandler = null;
    }

    savedScrollPosition = null;
    log('Presentation', 'Floating chat button cleaned up');
}

function renderChatMessages() {
    // Legacy function - now handled by initializePresentationChat
    // Kept for compatibility but no longer clones messages
    if (!chatMessagesEl) return;
    chatMessagesEl.innerHTML = '<p class="chat-empty">Loading chat...</p>';
}

// Generate summary for the event header section
function generateHeaderSummary() {
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    const collaboratorCount = state.session.userProfiles.size;

    let datePart = '';
    if (dateValue) {
        const date = Array.isArray(dateValue) ? new Date(dateValue[0]) : new Date(dateValue);
        datePart = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    let summaryParts = [];
    if (datePart) {
        summaryParts.push(datePart);
    }
    if (collaboratorCount > 0) {
        const hostWord = collaboratorCount === 1 ? 'host' : 'hosts';
        summaryParts.push(`<span class="summary-count">${collaboratorCount}</span> ${hostWord}`);
    }

    const summary = summaryParts.join(' &bull; ') || 'Event details';

    if (headerSummaryEl) {
        headerSummaryEl.innerHTML = summary;
    }
}

/**
 * Update the Plan Summary Dashboard with key metrics
 * Provides a quick-glance overview: Items, Budget, Team, Status
 */
function updatePlanSummaryDashboard() {
    const dashboard = document.getElementById('plan-summary-dashboard');
    if (!dashboard) return;

    // --- Items count ---
    const favoritesCount = state.cart.items.size;
    const lockedCount = state.cart.lockedItems.size;
    const totalItems = favoritesCount + lockedCount;

    const itemsMetric = document.querySelector('#plan-metric-items .plan-metric-value');
    if (itemsMetric) {
        itemsMetric.textContent = totalItems;
    }

    // --- Budget ---
    let subtotal = 0;
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = getRecordById(recordId);
        if (!record) return;
        const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
            ? itemInfo.selections
            : itemInfo.selectedOptionIndex;
        let unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
        if (isNaN(unitPrice)) return;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, 1);
        subtotal += unitPrice * effectiveQuantity;
    });
    // Also add idea items for a total picture
    state.cart.items.forEach((itemInfo, recordId) => {
        const record = getRecordById(recordId);
        if (!record) return;
        const priceParam = (itemInfo.selections && Object.keys(itemInfo.selections).length > 0)
            ? itemInfo.selections
            : itemInfo.selectedOptionIndex;
        let unitPrice = itemInfo.overridePrice ?? getRecordPrice(record, priceParam);
        if (isNaN(unitPrice)) return;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, 1);
        subtotal += unitPrice * effectiveQuantity;
    });

    const budgetMetric = document.querySelector('#plan-metric-budget .plan-metric-value');
    if (budgetMetric) {
        if (subtotal > 0) {
            budgetMetric.textContent = subtotal >= 1000 ? `$${(subtotal / 1000).toFixed(1)}k` : `$${Math.round(subtotal)}`;
        } else {
            budgetMetric.textContent = '--';
        }
    }

    // --- Team ---
    const teamCount = state.session.userProfiles?.size || 0;
    const teamMetric = document.querySelector('#plan-metric-team .plan-metric-value');
    if (teamMetric) {
        teamMetric.textContent = teamCount || 1; // At least the current user
    }

    // --- Status ---
    const statusMetric = document.querySelector('#plan-metric-status .plan-metric-value');
    if (statusMetric) {
        if (totalItems === 0) {
            statusMetric.textContent = 'Draft';
        } else if (lockedCount === totalItems) {
            statusMetric.textContent = 'Ready';
        } else if (lockedCount > 0) {
            statusMetric.textContent = 'In Progress';
        } else {
            statusMetric.textContent = 'Planning';
        }
    }

    // --- Plan Health (Vitality + Sentiment Goodness) ---
    const healthMetric = document.querySelector('#plan-metric-health .plan-metric-value');
    if (healthMetric) {
        const planEmoji = state.vitality?.planGoodnessEmoji || state.vitality?.planNetEmoji || '⚖️';
        healthMetric.textContent = planEmoji;
    }

    // Hide dashboard if no items and no team (very early state)
    dashboard.style.display = (totalItems === 0 && teamCount <= 1) ? 'none' : '';
}

// Generate summary for the items section
function generateItemsSummary() {
    const favoritesCount = state.cart.items.size;
    const lockedCount = state.cart.lockedItems.size;
    const totalCount = favoritesCount + lockedCount;

    if (totalCount === 0) {
        if (itemsSummaryEl) {
            itemsSummaryEl.textContent = 'No items added yet';
        }
        return;
    }

    // Get first few item names for preview
    const allItems = [...state.cart.lockedItems.keys(), ...state.cart.items.keys()];
    const itemNames = allItems.slice(0, 3).map(id => {
        const record = getRecordById(id);
        return record?.fields?.Name || 'Item';
    });

    let summary = `<span class="summary-count">${totalCount}</span> item${totalCount !== 1 ? 's' : ''}`;

    if (lockedCount > 0 && favoritesCount > 0) {
        summary += ` (<span class="summary-count">${lockedCount}</span> confirmed, <span class="summary-count">${favoritesCount}</span> idea${favoritesCount !== 1 ? 's' : ''})`;
    } else if (lockedCount > 0) {
        summary += ` (all confirmed)`;
    } else {
        summary += ` (all ideas)`;
    }

    if (itemNames.length > 0) {
        const namePreview = itemNames.join(', ');
        const moreCount = totalCount - itemNames.length;
        summary += ` &bull; <span class="item-preview">${namePreview}${moreCount > 0 ? ` +${moreCount} more` : ''}</span>`;
    }

    if (itemsSummaryEl) {
        itemsSummaryEl.innerHTML = summary;
    }
}

// Generate summary for the hosts-chat section (Hosts, Collaborators & Plan Chat)
function generateHostsChatSummary() {
    const collaboratorCount = state.session.userProfiles.size;

    // Count messages from the chat
    let messageCount = 0;
    if (chatMessagesEl) {
        const messages = chatMessagesEl.querySelectorAll('.message-wrapper');
        messageCount = messages.length;
    }

    let summary = '';

    // Show host/collaborator count
    if (collaboratorCount > 0) {
        const hostWord = collaboratorCount === 1 ? 'host' : 'hosts';
        summary = `<span class="summary-count">${collaboratorCount}</span> ${hostWord}`;
    } else {
        summary = 'No hosts yet';
    }

    // Show message count
    if (messageCount > 0) {
        summary += ` &bull; <span class="summary-count">${messageCount}</span> message${messageCount !== 1 ? 's' : ''}`;

        // Get preview of latest message
        const messages = chatMessagesEl.querySelectorAll('.message-wrapper');
        const lastMessage = messages[messages.length - 1];
        const lastContent = lastMessage?.querySelector('.message-content');
        if (lastContent) {
            const text = lastContent.textContent.trim();
            if (text) {
                const truncated = text.length > 40 ? text.substring(0, 40) + '...' : text;
                summary += ` &bull; "${truncated}"`;
            }
        }
    } else {
        summary += ' &bull; No messages yet';
    }

    if (hostsChatSummaryEl) {
        hostsChatSummaryEl.innerHTML = summary;
    }
}

// Toggle accordion section
function toggleAccordion(section) {
    // console.log('[Accordion DEBUG] toggleAccordion called with section:', section);
    // console.log('[Accordion DEBUG] modal element:', modal);

    // Check both main accordions and sub-accordions
    let sectionEl = modal.querySelector(`.itinerary-accordion[data-section="${section}"]`);
    if (!sectionEl) {
        sectionEl = modal.querySelector(`.sub-accordion[data-section="${section}"]`);
    }
    // console.log('[Accordion DEBUG] Found section element:', sectionEl);

    if (!sectionEl) {
        // console.warn('[Accordion DEBUG] Section element not found for:', section);
        return;
    }

    accordionState[section] = !accordionState[section];
    // console.log('[Accordion DEBUG] New state for', section, ':', accordionState[section]);

    if (accordionState[section]) {
        sectionEl.classList.add('expanded');
        // console.log('[Accordion DEBUG] Added expanded class to', section);
    } else {
        sectionEl.classList.remove('expanded');
        // console.log('[Accordion DEBUG] Removed expanded class from', section);
    }

    // console.log('[Accordion DEBUG] Section classList after toggle:', sectionEl.classList.toString());

    log('Presentation', `Accordion ${section} ${accordionState[section] ? 'expanded' : 'collapsed'}`);
}

// Toggle individual item accordion
function toggleItemAccordion(itemElement) {
    if (!itemElement) return;

    const isExpanded = itemElement.classList.contains('expanded');

    if (isExpanded) {
        itemElement.classList.remove('expanded');
    } else {
        itemElement.classList.add('expanded');
    }

    log('Presentation', `Item accordion ${isExpanded ? 'collapsed' : 'expanded'} for record ${itemElement.dataset.recordId}`);
}

// Track the collapsed/expanded state for "toggle all" functionality
let allItemsCollapsed = false;

// Toggle all item accordions (collapse/expand all)
function toggleAllItemAccordions() {
    const itemAccordions = modal?.querySelectorAll('.item-accordion');
    if (!itemAccordions || itemAccordions.length === 0) return;

    // Determine new state: if currently "all collapsed", expand all; otherwise collapse all
    const shouldExpand = allItemsCollapsed;

    itemAccordions.forEach(item => {
        if (shouldExpand) {
            item.classList.add('expanded');
        } else {
            item.classList.remove('expanded');
        }
    });

    // Update the state
    allItemsCollapsed = !shouldExpand;

    // Update button text and icon
    if (presentationToggleAllBtn) {
        const textEl = presentationToggleAllBtn.querySelector('.toggle-all-text');
        if (textEl) {
            textEl.textContent = allItemsCollapsed ? 'Expand All' : 'Collapse All';
        }
        if (allItemsCollapsed) {
            presentationToggleAllBtn.classList.add('collapsed');
        } else {
            presentationToggleAllBtn.classList.remove('collapsed');
        }
    }

    log('Presentation', `All item accordions ${shouldExpand ? 'expanded' : 'collapsed'}`);
}

// Handle item accordion header clicks
function handleItemAccordionClick(e) {
    // Check if clicking on the item accordion header specifically
    const itemAccordionHeader = e.target.closest('.item-accordion-header');
    if (!itemAccordionHeader) return;

    // If clicking on the emoji indicator, open the action menu instead of toggling accordion
    const emojiIndicator = e.target.closest('.item-emoji-indicator');
    if (emojiIndicator) {
        e.stopPropagation();
        const recordId = emojiIndicator.dataset.recordId;
        if (recordId) {
            const rect = emojiIndicator.getBoundingClientRect();
            openActionMenu(recordId, {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            });
        }
        return;
    }

    // Don't trigger accordion on interactive elements (buttons, links, etc.)
    if (e.target.closest('button') || e.target.closest('a') || e.target.closest('.reaction-btn')) {
        return;
    }

    const itemElement = itemAccordionHeader.closest('.item-accordion');
    if (itemElement) {
        e.stopPropagation(); // Prevent triggering parent click handlers
        toggleItemAccordion(itemElement);
    }
}

// Handle task status button clicks
function handleTaskStatusClick(e) {
    console.log('[TaskStatus DEBUG] handleTaskStatusClick called, target:', e.target);

    const taskStatusBtn = e.target.closest('.task-status-btn');
    console.log('[TaskStatus DEBUG] taskStatusBtn found:', taskStatusBtn);

    if (!taskStatusBtn) {
        console.log('[TaskStatus DEBUG] No task-status-btn found, returning');
        return;
    }

    e.stopPropagation(); // Prevent triggering other click handlers

    const elementType = taskStatusBtn.dataset.elementType;
    const elementId = taskStatusBtn.dataset.elementId;

    console.log('[TaskStatus DEBUG] Button data:', { elementType, elementId });

    // Get the element name for the popup
    let elementName = '';
    if (elementType === 'item') {
        // For items, find the item name from the accordion or state
        const itemAccordion = taskStatusBtn.closest('.itinerary-item');
        if (itemAccordion) {
            elementName = itemAccordion.dataset.itemName || '';
            console.log('[TaskStatus DEBUG] Item name from accordion:', elementName);
        }
        // Fallback: get from locked items state
        if (!elementName) {
            const lockedItem = state.cart.lockedItems.get(elementId);
            elementName = lockedItem?.fields?.Name || elementId;
            console.log('[TaskStatus DEBUG] Item name from state:', elementName);
        }
    } else if (elementType === 'detail') {
        // For details, use a friendly name based on the detail type
        const detailNames = {
            'goals': 'Goals/Notes',
            'date': 'Event Date',
            'eventName': 'Event Name'
        };
        elementName = detailNames[elementId] || elementId;
        console.log('[TaskStatus DEBUG] Detail name:', elementName);
    }

    console.log('[TaskStatus DEBUG] Calling showTaskDetailPopup with:', { elementType, elementId, elementName });

    // Show task detail popup instead of simple picker
    showTaskDetailPopup(elementType, elementId, elementName);
}

// Initialize accordion states and update UI
function initializeAccordions() {
    // console.log('[Accordion DEBUG] initializeAccordions called');
    // console.log('[Accordion DEBUG] modal element:', modal);

    // Set all sections to expanded state initially
    Object.keys(accordionState).forEach(section => {
        accordionState[section] = true;
        // Check for main accordions first, then sub-accordions
        let sectionEl = modal.querySelector(`.itinerary-accordion[data-section="${section}"]`);
        if (!sectionEl) {
            sectionEl = modal.querySelector(`.sub-accordion[data-section="${section}"]`);
        }
        // console.log(`[Accordion DEBUG] Initializing section "${section}":`, sectionEl);
        if (sectionEl) {
            sectionEl.classList.add('expanded');
            // console.log(`[Accordion DEBUG] Section "${section}" classList after init:`, sectionEl.classList.toString());
        } else {
            // console.warn(`[Accordion DEBUG] Section element not found for "${section}" during init`);
        }
    });

    // Generate all summaries (no longer includes hosts-chat summary)
    generateHeaderSummary();
    generateItemsSummary();

    // Reset the toggle all button state (all items start expanded)
    allItemsCollapsed = false;
    if (presentationToggleAllBtn) {
        const textEl = presentationToggleAllBtn.querySelector('.toggle-all-text');
        if (textEl) {
            textEl.textContent = 'Collapse All';
        }
        presentationToggleAllBtn.classList.remove('collapsed');
    }

    // console.log('[Accordion DEBUG] initializeAccordions completed');
}

function handleThumbnailClick(e) {
    const thumbnail = e.target.closest('.itinerary-thumbnail');
    if (!thumbnail) return;

    const recordId = thumbnail.dataset.recordId;
    const index = parseInt(thumbnail.dataset.index, 10);

    if (!itemImagesCache.has(recordId)) return;

    const cached = itemImagesCache.get(recordId);
    cached.currentIndex = index;

    // Update the main image
    const carousel = document.querySelector(`.itinerary-media-carousel[data-record-id="${recordId}"]`);
    if (carousel) {
        const mainImage = carousel.querySelector('.itinerary-main-image');
        if (mainImage && cached.images[index]) {
            mainImage.style.backgroundImage = `url('${cached.images[index]}')`;
        }

        // Update active thumbnail
        carousel.querySelectorAll('.itinerary-thumbnail').forEach((thumb, i) => {
            thumb.classList.toggle('active', i === index);
        });
    }
}

/**
 * Add an image to an item's image carousel.
 * This is called when a user uploads an image via a comment.
 * @param {string} itemId - The item/component ID
 * @param {string} imageUrl - The URL of the image to add
 */
function addImageToItemCarousel(itemId, imageUrl) {
    console.log('[CommentImage DEBUG] addImageToItemCarousel called for:', itemId, 'url:', imageUrl?.substring(0, 50) + '...');

    if (!itemId || !imageUrl) {
        console.log('[CommentImage DEBUG] Missing itemId or imageUrl');
        return;
    }

    // Get or initialize the image cache for this item
    if (!itemImagesCache.has(itemId)) {
        // Initialize cache if it doesn't exist (e.g., for manual items with no initial images)
        itemImagesCache.set(itemId, { images: [], currentIndex: 0 });
        console.log('[CommentImage DEBUG] Initialized image cache for item:', itemId);
    }

    const cached = itemImagesCache.get(itemId);

    // Check if image already exists in the cache (avoid duplicates)
    if (cached.images.includes(imageUrl)) {
        console.log('[CommentImage DEBUG] Image already in carousel, skipping');
        return;
    }

    // Add the image to the cache
    cached.images.push(imageUrl);
    console.log('[CommentImage DEBUG] Added image to cache. Total images:', cached.images.length);

    // Update the carousel in the DOM
    const carousel = document.querySelector(`.itinerary-media-carousel[data-record-id="${itemId}"]`);
    const itemContainer = document.querySelector(`.itinerary-item[data-record-id="${itemId}"]`);

    if (carousel) {
        // Re-render the carousel with the new image
        const newCarouselHTML = createMediaCarousel(cached.images, itemId);
        carousel.outerHTML = newCarouselHTML;
        console.log('[CommentImage DEBUG] Updated carousel with new image');
    } else if (itemContainer) {
        // If there was no carousel (e.g., item had no images), create one
        const noImagesDiv = itemContainer.querySelector('.itinerary-item-no-images');
        if (noImagesDiv) {
            const newCarouselHTML = createMediaCarousel(cached.images, itemId);
            noImagesDiv.outerHTML = newCarouselHTML;
            console.log('[CommentImage DEBUG] Created new carousel replacing "no images" placeholder');
        }
    } else {
        console.log('[CommentImage DEBUG] No carousel element found for item:', itemId);
    }
}

function handleReactionClick(e) {
    console.log('[ReactionClick DEBUG] handleReactionClick called, target:', e.target);
    const button = e.target.closest('.reaction-btn');
    console.log('[ReactionClick DEBUG] button found:', button);
    if (!button) return;

    // Stop propagation to prevent click from bubbling up and triggering
    // parent handlers (like accordion collapse or presentation view close)
    e.stopPropagation();
    e.preventDefault();

    const recordId = button.dataset.recordId;
    console.log('[ReactionClick DEBUG] recordId:', recordId);

    // Check if this is the "more" button to open expanded picker
    if (button.classList.contains('reaction-more-btn')) {
        console.log('[ReactionClick DEBUG] More button clicked, calling showExpandedEmojiPicker');
        showExpandedEmojiPicker(recordId, button);
        return;
    }

    const emoji = button.dataset.emoji;
    const currentUser = getCurrentUser();

    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    if (itemReactions.get(currentUser.id) === emoji) {
        itemReactions.delete(currentUser.id);
    } else {
        itemReactions.set(currentUser.id, emoji);
    }

    // Re-render reactions for this item
    const reactionContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
    if (reactionContainer) {
        renderReactions(recordId, reactionContainer);
    }

    // Update the emoji indicator next to item name
    updateItemEmojiIndicator(recordId);

    // Update the reactions summary
    renderReactionsSummary();

    // Update the event-level emoji indicator
    updateEventEmojiIndicator();

    // Broadcast item reaction update via Pusher for real-time sync
    if (presentationChatChannel) {
        // Convert Map to object for Pusher transmission
        const reactionsObj = {};
        itemReactions.forEach((userEmoji, odUserId) => {
            reactionsObj[odUserId] = userEmoji;
        });
        presentationChatChannel.trigger('client-item-reaction-update', {
            recordId,
            reactions: reactionsObj,
            userId: currentUser.id
        });
    }

    triggerSave();
}

function handleItemClick(e) {
    // Don't trigger if clicking on reactions, thumbnails, expand button, comments, or other interactive elements
    if (e.target.closest('.reaction-btn') ||
        e.target.closest('.itinerary-thumbnail') ||
        e.target.closest('.itinerary-item-reactions') ||
        e.target.closest('.itinerary-item-expand-btn') ||
        e.target.closest('.component-comments-section')) {
        return;
    }

    // Handle clicks on options group card content area (open group detail modal)
    const groupCardContent = e.target.closest('.options-group-card-content');
    if (groupCardContent) {
        // Don't open modal when clicking on interactive elements inside the card
        if (e.target.closest('.options-group-members-section') ||
            e.target.closest('.options-group-dissolve-btn') ||
            e.target.closest('.leave-group-btn')) return;
        e.stopPropagation();
        const groupId = groupCardContent.dataset.groupId;
        if (groupId) {
            openGroupDetailModal(groupId);
        }
        return;
    }

    const itemElement = e.target.closest('.itinerary-item-clickable');
    if (!itemElement) return;

    const recordId = itemElement.dataset.recordId;
    if (!recordId) return;

    const record = getRecordById(recordId);
    if (!record) {
        log('Presentation', `Record not found for ID: ${recordId}`);
        return;
    }

    log('Presentation', `Opening detail modal for: ${record.fields.Name}`);
    showDetailModal(record);
}

// Handle clicks on expand button to show full item details
function handleExpandButtonClick(e) {
    const expandBtn = e.target.closest('.itinerary-item-expand-btn');
    if (!expandBtn) return;

    e.stopPropagation();
    e.preventDefault();

    // If this is an options group expand button, open the group detail modal
    if (expandBtn.classList.contains('options-group-expand-btn')) {
        const groupId = expandBtn.dataset.groupId;
        if (groupId) {
            openGroupDetailModal(groupId);
        }
        return;
    }

    const recordId = expandBtn.dataset.recordId;
    if (!recordId) return;

    const record = getRecordById(recordId);
    if (!record) {
        log('Presentation', `Record not found for ID: ${recordId}`);
        return;
    }

    log('Presentation', `Expand button clicked - opening detail modal for: ${record.fields.Name}`);
    showDetailModal(record);
}

// Handle clicks on suggestion buttons (empty state recommendations)
function handleSuggestionClick(e) {
    const suggestionBtn = e.target.closest('.presentation-suggestion-btn');
    if (!suggestionBtn) return;

    e.stopPropagation();
    const categoryToFilter = suggestionBtn.dataset.categoryFilter;
    if (!categoryToFilter) return;

    const normalizedCategory = categoryToFilter.toLowerCase().replace(/\s+/g, ' ');

    log('Presentation', `Suggestion clicked. Filtering for: ${categoryToFilter}`);

    // Close the presentation view and navigate to the filtered catalog
    hidePresentationView();
    updateUrl({ category: normalizedCategory, subcategory: null, view: null });

    // Trigger filter update via the global function
    if (typeof window.applyFiltersAndSort === 'function') {
        setTimeout(() => {
            window.applyFiltersAndSort(window.imageCache);
            document.getElementById('catalog-area')?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
    }
}

// ============================================
// COMPONENT COMMENTS FEATURE
// ============================================

/**
 * Handle click events for component comments
 */
function handleComponentCommentsClick(e) {
    // Handle toggle button clicks
    const toggleBtn = e.target.closest('.component-comments-toggle');
    if (toggleBtn) {
        e.stopPropagation();
        const componentId = toggleBtn.dataset.componentId;
        toggleComponentComments(componentId);
        return;
    }

    // Handle submit button clicks
    const submitBtn = e.target.closest('.component-comment-submit');
    if (submitBtn) {
        e.stopPropagation();
        const componentId = submitBtn.dataset.componentId;
        submitComponentComment(componentId);
        return;
    }

    // Handle image button clicks (trigger file input)
    const imageBtn = e.target.closest('.comment-image-btn');
    if (imageBtn) {
        e.stopPropagation();
        const componentId = imageBtn.dataset.componentId;
        console.log('[CommentImage DEBUG] Camera button clicked for componentId:', componentId);
        const fileInput = document.querySelector(`.comment-image-input[data-component-id="${componentId}"]`);
        console.log('[CommentImage DEBUG] fileInput found:', !!fileInput);
        if (fileInput) {
            fileInput.click();
            console.log('[CommentImage DEBUG] fileInput.click() triggered');
        }
        return;
    }

    // Handle image preview remove button
    const removeBtn = e.target.closest('.comment-preview-remove');
    if (removeBtn) {
        e.stopPropagation();
        const componentId = removeBtn.dataset.componentId;
        console.log('[CommentImage DEBUG] Remove button clicked for componentId:', componentId);
        clearCommentImagePreview(componentId);
        return;
    }

    // Handle comment action buttons (edit, delete, react)
    const actionBtn = e.target.closest('.comment-action-btn');
    if (actionBtn) {
        e.stopPropagation();
        e.preventDefault();
        const action = actionBtn.dataset.action;
        const commentId = actionBtn.closest('.component-comment').dataset.commentId;
        console.log('[ComponentComment DEBUG] Comment action button clicked:', action, commentId);
        handleCommentAction(action, commentId);
        return;
    }

    // Handle reaction badge clicks on comments
    const reactionBadge = e.target.closest('.comment-reaction-badge');
    if (reactionBadge) {
        e.stopPropagation();
        const commentId = reactionBadge.closest('.component-comment').dataset.commentId;
        const emoji = reactionBadge.dataset.emoji;
        toggleCommentReaction(commentId, emoji);
        return;
    }
}

/**
 * Handle keydown events for component comment inputs
 */
function handleComponentCommentsKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        const input = e.target.closest('.component-comment-input');
        if (input) {
            e.preventDefault();
            const componentId = input.dataset.componentId;
            submitComponentComment(componentId);
        }
    }
}

/**
 * Handle file input change for comment image attachments
 */
function handleCommentImageInputChange(e) {
    const fileInput = e.target;
    if (!fileInput.classList.contains('comment-image-input')) return;

    const componentId = fileInput.dataset.componentId;
    const file = fileInput.files?.[0];

    console.log('[CommentImage DEBUG] File input change triggered');
    console.log('[CommentImage DEBUG] componentId:', componentId);
    console.log('[CommentImage DEBUG] file:', file ? { name: file.name, type: file.type, size: file.size } : null);

    if (!file) {
        console.log('[CommentImage DEBUG] No file selected, returning');
        return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
        console.log('[CommentImage DEBUG] Invalid file type:', file.type);
        showToast('Please select an image file', 'error');
        fileInput.value = '';
        return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
        console.log('[CommentImage DEBUG] File too large:', file.size);
        showToast('Image must be less than 10MB', 'error');
        fileInput.value = '';
        return;
    }

    console.log('[CommentImage DEBUG] File validation passed, resizing if needed and creating preview');

    // Resize image if needed (handles large mobile photos), then show preview
    resizeImageForUpload(file).then(dataUrl => {
        console.log('[CommentImage DEBUG] Image processed, showing preview');
        const previewContainer = document.querySelector(`.comment-image-preview[data-component-id="${componentId}"]`);
        const thumbnail = previewContainer?.querySelector('.comment-preview-thumbnail');
        const removeBtn = previewContainer?.querySelector('.comment-preview-remove');

        console.log('[CommentImage DEBUG] previewContainer found:', !!previewContainer);
        console.log('[CommentImage DEBUG] thumbnail found:', !!thumbnail);
        console.log('[CommentImage DEBUG] removeBtn found:', !!removeBtn);

        if (previewContainer && thumbnail) {
            thumbnail.src = dataUrl;
            previewContainer.style.display = 'flex';
            // Store the resized data URL on the file input for later upload
            fileInput.dataset.resizedDataUrl = dataUrl;

            console.log('[CommentImage DEBUG] Preview displayed');
        } else {
            console.log('[CommentImage DEBUG] Could not find previewContainer or thumbnail');
        }
    }).catch(err => {
        console.error('[CommentImage DEBUG] Error processing image:', err);
        showToast('Error processing image. Please try again.', 'error');
    });
}

/**
 * Clear the comment image preview and file input
 */
function clearCommentImagePreview(componentId) {
    console.log('[CommentImage DEBUG] clearCommentImagePreview called for componentId:', componentId);
    const fileInput = document.querySelector(`.comment-image-input[data-component-id="${componentId}"]`);
    const previewContainer = document.querySelector(`.comment-image-preview[data-component-id="${componentId}"]`);
    const thumbnail = previewContainer?.querySelector('.comment-preview-thumbnail');

    console.log('[CommentImage DEBUG] Found elements - fileInput:', !!fileInput, 'previewContainer:', !!previewContainer, 'thumbnail:', !!thumbnail);

    if (fileInput) {
        fileInput.value = '';
        delete fileInput.dataset.resizedDataUrl;
        console.log('[CommentImage DEBUG] File input cleared');
    }
    if (previewContainer) {
        previewContainer.style.display = 'none';
        console.log('[CommentImage DEBUG] Preview container hidden');
    }
    if (thumbnail) {
        thumbnail.src = '';
        console.log('[CommentImage DEBUG] Thumbnail src cleared');
    }
}

/**
 * Toggle the visibility of comments for a component
 */
async function toggleComponentComments(componentId) {
    const body = document.querySelector(`.component-comments-body[data-component-id="${componentId}"]`);
    const toggle = document.querySelector(`.component-comments-toggle[data-component-id="${componentId}"]`);
    const icon = toggle?.querySelector('.comments-toggle-icon');

    if (!body || !toggle) return;

    const isHidden = body.style.display === 'none';

    if (isHidden) {
        // Show comments
        body.style.display = 'block';
        if (icon) icon.textContent = '▲';
        toggle.classList.add('expanded');

        // Load comments if not cached
        await loadComponentComments(componentId);

        // Auto-focus the comment input for quick engagement
        setTimeout(() => {
            const input = body.querySelector(`.component-comment-input[data-component-id="${componentId}"]`);
            if (input) input.focus();
        }, 150);
    } else {
        // Hide comments
        body.style.display = 'none';
        if (icon) icon.textContent = '▼';
        toggle.classList.remove('expanded');
    }
}

/**
 * Load and render comments for a component
 */
async function loadComponentComments(componentId) {
    console.log('[ComponentComment DEBUG] loadComponentComments called for:', componentId);
    const sessionId = state.session.id;
    console.log('[ComponentComment DEBUG] sessionId:', sessionId);

    if (!sessionId) {
        console.log('[ComponentComment DEBUG] ❌ No sessionId - aborting');
        return;
    }

    const cacheKey = `item:${componentId}`;
    const commentsList = document.querySelector(`.component-comments-list[data-component-id="${componentId}"]`);
    console.log('[ComponentComment DEBUG] commentsList element found:', !!commentsList);

    if (!commentsList) {
        console.log('[ComponentComment DEBUG] ❌ No commentsList element - aborting');
        return;
    }

    // Show loading state
    commentsList.innerHTML = '<div class="comments-loading">Loading comments...</div>';

    try {
        console.log('[ComponentComment DEBUG] Calling api.fetchComponentComments with:', {
            sessionId,
            componentType: api.COMPONENT_TYPES.ITEM,
            componentId
        });
        // Fetch comments from API
        const comments = await api.fetchComponentComments(sessionId, api.COMPONENT_TYPES.ITEM, componentId);
        console.log('[ComponentComment DEBUG] fetchComponentComments returned:', comments?.length, 'comments');

        // Cache comments
        componentCommentsCache.set(cacheKey, comments);

        // Extract images from comments and add to carousel
        // This ensures images from previously posted comments appear in the item's carousel
        extractAndAddCommentImages(componentId, comments);

        // Render comments
        renderComponentComments(componentId, comments);

        // Update count
        updateCommentCount(componentId, comments.length);

        log('Presentation', `Loaded ${comments.length} comments for component ${componentId}`);
    } catch (error) {
        console.log('[ComponentComment DEBUG] ❌ Error loading comments:', error);
        log('Presentation', `Error loading comments: ${error.message}`);
        commentsList.innerHTML = '<div class="comments-error">Failed to load comments</div>';
    }
}

/**
 * Extract images from comments and add them to the item's carousel.
 * This ensures images uploaded via comments appear in the item's image gallery.
 * @param {string} componentId - The item/component ID
 * @param {Array} comments - Array of comment records
 */
function extractAndAddCommentImages(componentId, comments) {
    if (!comments || comments.length === 0) return;

    let imagesAdded = 0;

    comments.forEach(comment => {
        const content = comment.fields?.Content || '';

        // Parse attachments from Content field (embedded as [ATTACHMENTS:...])
        const attachmentMatch = content.match(/\[ATTACHMENTS:(.*?)\]$/);
        if (attachmentMatch) {
            try {
                const attachments = JSON.parse(attachmentMatch[1]);
                if (Array.isArray(attachments)) {
                    attachments.forEach(attachment => {
                        if (attachment.type === 'image' && attachment.url) {
                            addImageToItemCarousel(componentId, attachment.url);
                            imagesAdded++;
                        }
                    });
                }
            } catch (e) {
                console.warn('[ComponentComment] Failed to parse attachments for carousel:', e);
            }
        }
    });

    if (imagesAdded > 0) {
        console.log('[ComponentComment DEBUG] Extracted and added', imagesAdded, 'images from comments to carousel for:', componentId);
    }
}

/**
 * Render comments for a component with nested replies
 */
function renderComponentComments(componentId, comments) {
    const commentsList = document.querySelector(`.component-comments-list[data-component-id="${componentId}"]`);
    if (!commentsList) return;

    const currentUser = getCurrentUser();

    if (comments.length === 0) {
        commentsList.innerHTML = '<div class="comments-empty">No comments yet. Be the first to comment!</div>';
        return;
    }

    // Get project tasks to check for linked tasks
    const projectId = state.session.id;
    const projectTasks = state.tasks.byProject.get(projectId) || [];

    // Separate parent comments from replies and build a map
    const parentComments = [];
    const repliesByParent = new Map();

    comments.forEach(comment => {
        const parentId = comment.fields?.ParentMessageID;
        if (parentId) {
            // This is a reply
            if (!repliesByParent.has(parentId)) {
                repliesByParent.set(parentId, []);
            }
            repliesByParent.get(parentId).push(comment);
        } else {
            // This is a parent comment
            parentComments.push(comment);
        }
    });

    console.log('[ComponentComment DEBUG] Rendering nested comments:', {
        total: comments.length,
        parents: parentComments.length,
        repliesMap: repliesByParent.size
    });

    /**
     * Render a single comment HTML
     */
    const renderSingleComment = (comment, isReply = false) => {
        const fields = comment.fields;
        const isOwn = fields.SenderID === currentUser?.id;
        const isDeleted = fields.IsDeleted;
        const isEdited = fields.IsEdited;
        const reactions = fields.Reactions ? JSON.parse(fields.Reactions) : {};
        const timestamp = new Date(comment.createdTime || fields.Timestamp || Date.now());
        const timeAgo = getTimeAgo(timestamp);

        if (isDeleted) {
            return `
                <div class="component-comment deleted ${isReply ? 'comment-reply' : ''}" data-comment-id="${comment.id}">
                    <em class="deleted-comment-text">This comment was deleted</em>
                </div>
            `;
        }

        // Check if this comment has a linked task
        const linkedTask = projectTasks.find(t => t.fields?.SourceCommentId === comment.id);
        const hasLinkedTask = !!linkedTask;
        const taskBtnHtml = hasLinkedTask
            ? `<button class="comment-action-btn comment-task-btn has-task" data-action="task" data-linked-task-id="${linkedTask.id}" title="View affiliated task">📋✓</button>`
            : `<button class="comment-action-btn comment-task-btn" data-action="task" title="Create task from comment">📋</button>`;

        // Build reactions HTML
        let reactionsHTML = '';
        if (Object.keys(reactions).length > 0) {
            reactionsHTML = '<div class="comment-reactions">';
            for (const [emoji, users] of Object.entries(reactions)) {
                if (users.length > 0) {
                    const hasReacted = users.includes(currentUser?.id);
                    reactionsHTML += `
                        <button class="comment-reaction-badge ${hasReacted ? 'user-reacted' : ''}" data-emoji="${emoji}">
                            ${emoji} <span class="reaction-count">${users.length}</span>
                        </button>
                    `;
                }
            }
            reactionsHTML += '</div>';
        }

        // Parse attachments from Content field (embedded as [ATTACHMENTS:...])
        // This is because the Messages table doesn't have a separate Attachments field
        let displayContent = fields.Content || '';
        let attachments = [];

        // Strip out [PLAN_COMMENT:xxx] or [PLAN_COMMENT:item:componentId] prefix from display content
        // The pattern now handles both formats: [PLAN_COMMENT:type] and [PLAN_COMMENT:item:manual-presentation-xxx]
        displayContent = displayContent.replace(/^\[PLAN_COMMENT:[^\]]+\]\s*/i, '');

        // Check for embedded attachments in content
        const attachmentMatch = displayContent.match(/\[ATTACHMENTS:(.*?)\]$/);
        if (attachmentMatch) {
            try {
                attachments = JSON.parse(attachmentMatch[1]);
                // Remove the attachment marker from display content
                displayContent = displayContent.replace(/\[ATTACHMENTS:.*?\]$/, '').trim();
            } catch (e) {
                console.warn('[ComponentComment] Failed to parse embedded attachments:', e);
            }
        }

        // Build attachments HTML
        let attachmentsHTML = '';
        if (Array.isArray(attachments) && attachments.length > 0) {
            attachmentsHTML = '<div class="comment-attachments">';
            attachments.forEach(attachment => {
                if (attachment.type === 'image' && attachment.url) {
                    // Apply Cloudinary transformations for optimized display
                    const optimizedUrl = applyCloudinaryTransform(attachment.url, 'w_400,h_300,c_limit,f_auto,q_auto');
                    attachmentsHTML += `
                        <a href="${escapeHtml(attachment.url)}" target="_blank" class="comment-attachment comment-attachment-image">
                            <img src="${escapeHtml(optimizedUrl)}" alt="Attached image" loading="lazy" />
                        </a>
                    `;
                }
            });
            attachmentsHTML += '</div>';
        }

        // Get reply count for parent comments
        const replies = repliesByParent.get(comment.id) || [];
        const replyCountHtml = !isReply && replies.length > 0
            ? `<span class="comment-reply-count">${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}</span>`
            : '';

        // Only show content div if there's actual text content (after removing attachment marker)
        const contentHTML = displayContent && displayContent.trim()
            ? `<div class="comment-content">${escapeHtml(displayContent)}</div>`
            : '';

        return `
            <div class="component-comment ${isOwn ? 'own-comment' : ''} ${isReply ? 'comment-reply' : ''}" data-comment-id="${comment.id}" data-sender-name="${escapeHtml(fields.SenderName)}" data-content="${escapeHtml(displayContent || '')}">
                <div class="comment-header">
                    <span class="comment-author">${escapeHtml(fields.SenderName)}${isOwn ? ' (You)' : ''}</span>
                    <span class="comment-time" title="${timestamp.toLocaleString()}">${timeAgo}</span>
                    ${isEdited ? '<span class="comment-edited">(edited)</span>' : ''}
                    ${replyCountHtml}
                </div>
                ${contentHTML}
                ${attachmentsHTML}
                ${reactionsHTML}
                <div class="comment-actions">
                    <button class="comment-action-btn" data-action="reply" title="Reply to this comment">↩</button>
                    <button class="comment-action-btn" data-action="react" title="Add reaction">😊</button>
                    ${taskBtnHtml}
                    ${isOwn ? `
                        <button class="comment-action-btn" data-action="edit" title="Edit comment">✏️</button>
                        <button class="comment-action-btn" data-action="delete" title="Delete comment">🗑️</button>
                    ` : ''}
                </div>
            </div>
        `;
    };

    // Build the full HTML with nested structure
    let commentsHTML = '';

    parentComments.forEach(parentComment => {
        // Render the parent comment
        commentsHTML += renderSingleComment(parentComment, false);

        // Render nested replies
        const replies = repliesByParent.get(parentComment.id) || [];
        if (replies.length > 0) {
            commentsHTML += '<div class="comment-replies-container">';
            replies.forEach(reply => {
                commentsHTML += renderSingleComment(reply, true);
            });
            commentsHTML += '</div>';
        }
    });

    // Also render any orphan replies (replies without visible parent - rare edge case)
    // These would be replies to deleted comments or comments not in current view
    const renderedParentIds = new Set(parentComments.map(c => c.id));
    repliesByParent.forEach((replies, parentId) => {
        if (!renderedParentIds.has(parentId)) {
            // These are orphan replies - render them at top level
            replies.forEach(reply => {
                commentsHTML += renderSingleComment(reply, false);
            });
        }
    });

    commentsList.innerHTML = commentsHTML;
}

/**
 * Submit a new comment for a component
 */
async function submitComponentComment(componentId) {
    console.log('[ComponentComment DEBUG] submitComponentComment called for:', componentId);

    const input = document.querySelector(`.component-comment-input[data-component-id="${componentId}"]`);
    if (!input) {
        console.log('[ComponentComment DEBUG] ❌ No input element found');
        return;
    }

    let content = input.value.trim();
    console.log('[ComponentComment DEBUG] Content:', content?.substring(0, 50) + (content?.length > 50 ? '...' : ''));

    // Check for attached image
    const fileInput = document.querySelector(`.comment-image-input[data-component-id="${componentId}"]`);
    const hasImage = fileInput?.files?.[0];

    // Require either content or image
    if (!content && !hasImage) {
        console.log('[ComponentComment DEBUG] ❌ Empty content and no image - aborting');
        return;
    }

    const sessionId = state.session.id;
    const currentUser = getCurrentUser();
    console.log('[ComponentComment DEBUG] sessionId:', sessionId);
    console.log('[ComponentComment DEBUG] currentUser:', currentUser ? { id: currentUser.id, name: currentUser.name } : null);

    if (!sessionId || !currentUser) {
        console.log('[ComponentComment DEBUG] ❌ No session or user - aborting');
        log('Presentation', 'Cannot submit comment - no session or user');
        return;
    }

    // Check if this is a reply - prepend @mention if so
    const isReply = componentCommentReplyingTo && componentCommentReplyingTo.componentId === componentId;
    const parentCommentId = isReply ? componentCommentReplyingTo.commentId : null;
    if (isReply) {
        console.log('[ComponentComment DEBUG] This is a reply to:', componentCommentReplyingTo.senderName, 'parentId:', parentCommentId);
        // Prepend @mention to the content for display
        content = `@${componentCommentReplyingTo.senderName}: ${content}`;
    }

    // Disable input while submitting
    input.disabled = true;
    const submitBtn = document.querySelector(`.component-comment-submit[data-component-id="${componentId}"]`);
    const imageBtn = document.querySelector(`.comment-image-btn[data-component-id="${componentId}"]`);
    if (submitBtn) submitBtn.disabled = true;
    if (imageBtn) imageBtn.disabled = true;

    // Show loading state on input wrapper
    const inputWrapper = input.closest('.component-comment-input-wrapper');
    if (inputWrapper) inputWrapper.classList.add('uploading');

    let attachments = [];

    try {
        // Upload image if attached
        if (hasImage) {
            console.log('[ComponentComment DEBUG] Uploading attached image...');

            // Use pre-resized data URL from the preview step, or resize now as fallback
            let base64Data = fileInput.dataset.resizedDataUrl;
            if (!base64Data && fileInput.files[0]) {
                base64Data = await resizeImageForUpload(fileInput.files[0]);
            }

            // Upload to Cloudinary via serverless function
            const uploadResponse = await fetch('/.netlify/functions/cloudinary-upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    imageData: base64Data,
                    sessionId: sessionId,
                    itemId: componentId
                })
            });

            if (!uploadResponse.ok) {
                // Try to parse JSON error, but handle plain text errors gracefully
                let errorMessage = 'Image upload failed';
                const responseText = await uploadResponse.text();
                try {
                    const errorData = JSON.parse(responseText);
                    errorMessage = errorData.error || errorData.message || errorMessage;
                } catch (parseErr) {
                    // Response wasn't JSON, use the text or status as the error
                    // Netlify returns "Internal Error. ID: xxx" for crashed functions
                    if (responseText.startsWith('Internal Error')) {
                        errorMessage = 'Image upload service error. Please try again or use a smaller image.';
                    } else {
                        errorMessage = responseText || `Upload failed with status ${uploadResponse.status}`;
                    }
                }
                console.error('[ComponentComment DEBUG] Upload error:', errorMessage);
                throw new Error(errorMessage);
            }

            const uploadResult = await uploadResponse.json();
            console.log('[ComponentComment DEBUG] Image uploaded:', uploadResult.secure_url);

            attachments = [{ url: uploadResult.secure_url, type: 'image' }];
        }

        console.log('[ComponentComment DEBUG] Calling api.postComponentComment...');
        // Post comment via API with parent comment ID if this is a reply
        const newComment = await api.postComponentComment(
            sessionId,
            api.COMPONENT_TYPES.ITEM,
            componentId,
            currentUser.id,
            currentUser.name,
            content,
            parentCommentId,
            attachments
        );
        console.log('[ComponentComment DEBUG] postComponentComment result:', newComment ? 'SUCCESS (id: ' + newComment.id + ')' : 'FAILED');

        if (newComment) {
            // Clear input and reply state
            input.value = '';
            input.placeholder = 'Add a comment...';

            // Clear image preview if an image was attached
            clearCommentImagePreview(componentId);

            // If an image was attached, add it to the item's image carousel
            if (attachments.length > 0) {
                attachments.forEach(attachment => {
                    if (attachment.type === 'image' && attachment.url) {
                        addImageToItemCarousel(componentId, attachment.url);
                    }
                });
            }

            // Clear reply state if this was a reply
            if (isReply) {
                cancelCommentReply(componentId);
            }

            // Reload comments to show the new one in the component's comment section
            console.log('[ComponentComment DEBUG] Reloading comments...');
            await loadComponentComments(componentId);

            // Also add to the chat area with @component tag
            if (chatMessagesEl) {
                const componentRecord = getRecordById(componentId);
                const componentInfo = {
                    id: componentId,
                    name: componentRecord?.fields?.Name || 'Unknown Item'
                };

                // Remove empty state if present
                const emptyMsg = chatMessagesEl.querySelector('.chat-empty');
                if (emptyMsg) emptyMsg.remove();

                addPresentationMessageToUI(
                    currentUser.name,
                    content,
                    true,
                    new Date().toISOString(),
                    currentUser.id,
                    {
                        messageId: newComment.id,
                        componentInfo
                    }
                );
            }

            // Broadcast via Pusher if available
            if (presentationChatChannel) {
                console.log('[ComponentComment DEBUG] Broadcasting via Pusher...');
                presentationChatChannel.trigger('client-component-comment', {
                    componentType: api.COMPONENT_TYPES.ITEM,
                    componentId,
                    comment: newComment,
                    senderId: currentUser.id
                });
            }

            console.log('[ComponentComment DEBUG] ✅ Comment posted successfully');
            log('Presentation', `Comment posted to component ${componentId}`);
        } else {
            console.log('[ComponentComment DEBUG] ❌ postComponentComment returned null/false');
            showToast('Failed to post comment', 'error');
        }
    } catch (error) {
        console.log('[ComponentComment DEBUG] ❌ Exception:', error);
        log('Presentation', `Error posting comment: ${error.message}`);
        showToast(error.message || 'Failed to post comment', 'error');
    } finally {
        // Re-enable inputs and remove loading state
        input.disabled = false;
        if (submitBtn) submitBtn.disabled = false;
        if (imageBtn) imageBtn.disabled = false;
        if (inputWrapper) inputWrapper.classList.remove('uploading');
        input.focus();
    }
}

/**
 * Handle comment actions (edit, delete, react, reply, task)
 */
async function handleCommentAction(action, commentId) {
    console.log('[ComponentComment DEBUG] handleCommentAction called:', action, commentId);
    const currentUser = getCurrentUser();
    if (!currentUser) {
        console.log('[ComponentComment DEBUG] ❌ No current user for action');
        return;
    }

    switch (action) {
        case 'reply':
            startCommentReply(commentId);
            break;
        case 'edit':
            startCommentEdit(commentId);
            break;
        case 'delete':
            await deleteComment(commentId);
            break;
        case 'react':
            console.log('[ComponentComment DEBUG] About to call showCommentReactionPicker');
            showCommentReactionPicker(commentId);
            break;
        case 'task':
            console.log('[ComponentComment DEBUG] Creating task from comment');
            await handleCreateTaskFromComment(commentId);
            break;
    }
}

/**
 * Handle creating a task from a comment or opening existing linked task
 * @param {string} commentId - The comment record ID
 */
async function handleCreateTaskFromComment(commentId) {
    console.log('[CreateTaskFromComment DEBUG] handleCreateTaskFromComment called:', commentId);

    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    if (!commentEl) {
        console.log('[CreateTaskFromComment DEBUG] ❌ Comment element not found for task creation');
        return;
    }

    // Check if this comment already has a linked task (from data attribute or from state)
    const taskBtn = commentEl.querySelector('.comment-task-btn');
    const linkedTaskId = taskBtn?.dataset.linkedTaskId;

    if (linkedTaskId) {
        console.log('[CreateTaskFromComment DEBUG] Comment already has linked task:', linkedTaskId);
        // Open the existing task
        const task = state.tasks.all.get(linkedTaskId);
        if (task) {
            showLinkedTaskPopup(task, commentId);
            return;
        } else {
            console.log('[CreateTaskFromComment DEBUG] Linked task not found in state, allowing new task creation');
        }
    }

    // Check if any existing task has this comment as its source
    const projectId = state.session.id;
    const projectTasks = state.tasks.byProject.get(projectId) || [];
    const existingTask = projectTasks.find(t => t.fields?.SourceCommentId === commentId);

    if (existingTask) {
        console.log('[CreateTaskFromComment DEBUG] Found existing task for this comment:', existingTask.id);
        // Update the button and show the task
        if (taskBtn) {
            taskBtn.dataset.linkedTaskId = existingTask.id;
            taskBtn.innerHTML = '📋✓';
            taskBtn.title = 'View affiliated task';
            taskBtn.classList.add('has-task');
        }
        showLinkedTaskPopup(existingTask, commentId);
        return;
    }

    const commentContent = commentEl.dataset.content || '';
    const componentSection = commentEl.closest('.component-comments-section');
    const componentId = componentSection?.dataset.componentId || null;
    const componentType = componentSection?.dataset.componentType || 'item';

    console.log('[CreateTaskFromComment DEBUG] Comment data:', { commentContent, componentId, componentType });

    // Get the element name for display in the popup
    let elementName = 'Unknown';
    if (componentType === 'item') {
        // Try to find the item name from the accordion
        const accordion = commentEl.closest('.itinerary-item-accordion');
        if (accordion) {
            elementName = accordion.dataset.itemName || 'Unknown Item';
        } else {
            // Fallback: try to get from locked/cart items
            const itemRecord = getRecordById(componentId);
            if (itemRecord) {
                elementName = itemRecord.fields?.Name || itemRecord.fields?.['Item Name'] || 'Unknown Item';
            }
        }
    } else if (componentType === 'header') {
        // Header/detail component
        elementName = componentId === 'goals' ? 'Goals/Notes' :
                      componentId === 'date' ? 'Event Date' :
                      'Event Detail';
    }

    console.log('[CreateTaskFromComment DEBUG] Element name resolved:', elementName);

    // Show the task creation popup instead of directly creating the task
    showCreateTaskFromCommentPopup(commentId, commentContent, componentId, componentType, elementName);
}

/**
 * Show popup for viewing a linked task from a comment
 * @param {Object} task - The task object
 * @param {string} sourceCommentId - The source comment ID
 */
function showLinkedTaskPopup(task, sourceCommentId) {
    console.log('[LinkedTaskPopup DEBUG] showLinkedTaskPopup called:', { taskId: task.id, taskName: task.fields?.Name, sourceCommentId });

    // Check if user can edit
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;

    const taskName = task.fields?.Name || 'Unnamed Task';
    const taskDescription = task.fields?.Description || '';
    const taskStatus = task.fields?.Status || 'pending';
    const statusConfig = TASK_STATUS_CONFIG[taskStatus] || TASK_STATUS_CONFIG.pending;

    // Create modal HTML
    const modalHTML = `
        <div id="linked-task-modal-overlay" class="task-detail-modal-overlay">
            <div class="task-detail-modal">
                <div class="task-detail-modal-header">
                    <h3>📋 Linked Task</h3>
                    <button class="task-detail-modal-close" id="linked-task-modal-close">&times;</button>
                </div>
                <div class="task-detail-modal-body">
                    <div class="task-detail-section">
                        <label>Task Name</label>
                        <div class="linked-task-name">${escapeHtml(taskName)}</div>
                    </div>

                    ${taskDescription ? `
                        <div class="task-detail-section">
                            <label>Description</label>
                            <div class="linked-task-description">${escapeHtml(taskDescription)}</div>
                        </div>
                    ` : ''}

                    <div class="task-detail-section">
                        <label>Status</label>
                        <div class="task-status-options">
                            ${Object.entries(TASK_STATUS_CONFIG).map(([statusValue, cfg]) => `
                                <button class="task-status-option-btn ${cfg.className} ${statusValue === taskStatus ? 'active' : ''}"
                                        data-status="${statusValue}"
                                        ${!canUserEdit ? 'disabled' : ''}>
                                    <span class="option-icon">${cfg.icon}</span>
                                    <span class="option-label">${cfg.label}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    <div class="linked-task-info">
                        <span class="info-label">Task ID:</span> ${task.id}
                    </div>
                </div>
                <div class="task-detail-modal-footer">
                    <button class="task-detail-done-btn" id="linked-task-done-btn">Done</button>
                </div>
            </div>
        </div>
    `;

    console.log('[LinkedTaskPopup DEBUG] Inserting modal HTML');

    // Insert modal
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const overlay = document.getElementById('linked-task-modal-overlay');
    const closeBtn = document.getElementById('linked-task-modal-close');
    const doneBtn = document.getElementById('linked-task-done-btn');

    const closeModal = () => {
        console.log('[LinkedTaskPopup DEBUG] Closing modal');
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    };

    // Attach event listeners
    closeBtn.addEventListener('click', closeModal);
    doneBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Handle status option clicks
    if (canUserEdit) {
        overlay.querySelectorAll('.task-status-option-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const newStatus = btn.dataset.status;
                console.log('[LinkedTaskPopup DEBUG] Status change requested:', newStatus);

                // Update the task status
                const updatedTask = await api.updateTask(task.id, { Status: newStatus });

                if (updatedTask) {
                    console.log('[LinkedTaskPopup DEBUG] Task status updated successfully');
                    // Update local state
                    state.tasks.all.set(task.id, updatedTask);
                    const projectId = state.session.id;
                    const projectTasks = state.tasks.byProject.get(projectId) || [];
                    const taskIndex = projectTasks.findIndex(t => t.id === task.id);
                    if (taskIndex >= 0) {
                        projectTasks[taskIndex] = updatedTask;
                        state.tasks.byProject.set(projectId, [...projectTasks]);
                    }

                    // Update active state in modal
                    overlay.querySelectorAll('.task-status-option-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');

                    showToast('Task status updated', 2000);
                } else {
                    showToast('Failed to update task status', 3000);
                }
            });
        });
    }

    // Show modal with animation
    console.log('[LinkedTaskPopup DEBUG] Showing modal with animation');
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });
}

/**
 * Show popup for creating a task from a comment
 * @param {string} commentId - The comment record ID
 * @param {string} commentContent - The comment text content
 * @param {string} componentId - The component/item ID
 * @param {string} componentType - The component type ('item' or 'header')
 * @param {string} elementName - Display name of the element
 */
function showCreateTaskFromCommentPopup(commentId, commentContent, componentId, componentType, elementName) {
    console.log('[CreateTaskFromComment DEBUG] showCreateTaskFromCommentPopup called:', {
        commentId,
        commentContent: commentContent?.substring(0, 50) + '...',
        componentId,
        componentType,
        elementName
    });

    // Check if user can edit
    const currentRole = state.permissions?.currentRole;
    const isLoading = state.permissions?.isLoading !== false;
    const canEditByRole = api.canEdit(currentRole);
    const canEditByOwnership = state.session.isOwned === true;
    const canUserEdit = (!isLoading && canEditByRole) || canEditByOwnership;

    console.log('[CreateTaskFromComment DEBUG] Permission check:', {
        currentRole,
        canEditByRole,
        canEditByOwnership,
        canUserEdit
    });

    if (!canUserEdit) {
        showToast('You do not have permission to create tasks', 3000);
        return;
    }

    // Truncate comment content for task name (max 100 chars)
    const suggestedTaskName = commentContent.substring(0, 100) + (commentContent.length > 100 ? '...' : '');

    // Build affiliated tasks list for the dropdown
    const projectTasks = state.tasks.byProject.get(state.session.id) || [];
    const affiliatableTasksHTML = projectTasks.length > 0 ? `
        <div class="task-detail-section">
            <label>Affiliate with Existing Task</label>
            <select id="create-task-affiliate-select" class="task-affiliate-select">
                <option value="">-- No affiliation --</option>
                ${projectTasks.map(t => `
                    <option value="${t.id}">${escapeHtml(t.fields?.Name || 'Unnamed Task')}</option>
                `).join('')}
            </select>
        </div>
    ` : '';

    // Create modal HTML
    const modalHTML = `
        <div id="create-task-modal-overlay" class="task-detail-modal-overlay">
            <div class="task-detail-modal">
                <div class="task-detail-modal-header">
                    <h3>📋 Create Task from Comment</h3>
                    <button class="task-detail-modal-close" id="create-task-modal-close">&times;</button>
                </div>
                <div class="task-detail-modal-body">
                    <div class="task-detail-element-name">
                        <span class="element-label">${componentType === 'item' ? 'Item' : 'Detail'}:</span>
                        <span class="element-name">${escapeHtml(elementName)}</span>
                    </div>

                    <div class="task-detail-section">
                        <label>Task Name</label>
                        <input type="text"
                               id="create-task-name-input"
                               class="create-task-name-input"
                               value="${escapeHtml(suggestedTaskName)}"
                               placeholder="Enter task name..." />
                    </div>

                    <div class="task-detail-section">
                        <label>Description</label>
                        <textarea id="create-task-description-input"
                                  class="create-task-description-input"
                                  rows="3"
                                  placeholder="Task description...">${escapeHtml(commentContent)}</textarea>
                    </div>

                    <div class="task-detail-section">
                        <label>Status</label>
                        <div class="task-status-options">
                            ${Object.entries(TASK_STATUS_CONFIG).map(([statusValue, cfg]) => `
                                <button class="task-status-option-btn ${cfg.className} ${statusValue === 'pending' ? 'active' : ''}"
                                        data-status="${statusValue}">
                                    <span class="option-icon">${cfg.icon}</span>
                                    <span class="option-label">${cfg.label}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>

                    ${affiliatableTasksHTML}

                    <div class="task-detail-section create-task-source-info">
                        <label>Source Comment</label>
                        <div class="source-comment-preview">"${escapeHtml(commentContent.substring(0, 200))}${commentContent.length > 200 ? '...' : ''}"</div>
                    </div>
                </div>
                <div class="task-detail-modal-footer">
                    <button class="task-detail-cancel-btn" id="create-task-cancel-btn">Cancel</button>
                    <button class="task-detail-done-btn create-task-submit-btn" id="create-task-submit-btn">Create Task</button>
                </div>
            </div>
        </div>
    `;

    console.log('[CreateTaskFromComment DEBUG] Inserting modal HTML');

    // Insert modal
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    const overlay = document.getElementById('create-task-modal-overlay');
    const closeBtn = document.getElementById('create-task-modal-close');
    const cancelBtn = document.getElementById('create-task-cancel-btn');
    const submitBtn = document.getElementById('create-task-submit-btn');
    const nameInput = document.getElementById('create-task-name-input');
    const descriptionInput = document.getElementById('create-task-description-input');

    console.log('[CreateTaskFromComment DEBUG] Modal elements:', {
        overlay: !!overlay,
        closeBtn: !!closeBtn,
        cancelBtn: !!cancelBtn,
        submitBtn: !!submitBtn,
        nameInput: !!nameInput,
        descriptionInput: !!descriptionInput
    });

    let selectedStatus = 'pending';

    const closeModal = () => {
        console.log('[CreateTaskFromComment DEBUG] Closing modal');
        overlay.classList.remove('active');
        setTimeout(() => overlay.remove(), 200);
    };

    // Attach event listeners
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
    });

    // Handle status option clicks
    overlay.querySelectorAll('.task-status-option-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const newStatus = btn.dataset.status;
            console.log('[CreateTaskFromComment DEBUG] Status selected:', newStatus);
            selectedStatus = newStatus;

            // Update active state
            overlay.querySelectorAll('.task-status-option-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Handle submit button click
    submitBtn.addEventListener('click', async () => {
        console.log('[CreateTaskFromComment DEBUG] Submit button clicked');

        const taskName = nameInput.value.trim();
        const taskDescription = descriptionInput.value.trim();
        const affiliateSelect = document.getElementById('create-task-affiliate-select');
        const affiliatedTaskId = affiliateSelect?.value || null;

        console.log('[CreateTaskFromComment DEBUG] Task data:', {
            taskName,
            taskDescription: taskDescription?.substring(0, 50) + '...',
            selectedStatus,
            affiliatedTaskId
        });

        if (!taskName) {
            showToast('Please enter a task name', 3000);
            return;
        }

        // Disable submit button while creating
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating...';

        try {
            const projectId = state.session.id;
            const projectTasks = state.tasks.byProject.get(projectId) || [];
            const maxOrder = projectTasks.reduce((max, t) => Math.max(max, t.fields?.Order || 0), 0);

            // Build task data
            const taskData = {
                Name: taskName,
                Description: taskDescription,
                Status: selectedStatus,
                Order: maxOrder + 1
            };

            // Handle item linking - only link if it's a valid Airtable record ID
            if (componentId && componentId.startsWith('rec')) {
                taskData.LinkedItem = componentId;
            } else if (componentId) {
                // For AI-generated items, include the item name in the task name
                const itemRecord = getRecordById(componentId);
                if (itemRecord) {
                    const itemName = itemRecord.fields?.Name || itemRecord.fields?.['Item Name'] || 'AI Item';
                    if (!taskName.includes(`[${itemName}]`)) {
                        taskData.Name = `[${itemName}] ${taskName}`;
                    }
                    console.log('[CreateTaskFromComment DEBUG] Task linked to AI item:', itemName);
                }
            }

            // Store the source comment ID so we can track which tasks came from comments
            taskData.SourceCommentId = commentId;

            console.log('[CreateTaskFromComment DEBUG] Creating task with data:', taskData);

            const newTask = await api.createTask(projectId, taskData);

            if (newTask) {
                console.log('[CreateTaskFromComment DEBUG] ✅ Task created successfully:', newTask.id);

                // Update local state
                state.tasks.all.set(newTask.id, newTask);
                const existingTasks = state.tasks.byProject.get(projectId) || [];
                state.tasks.byProject.set(projectId, [...existingTasks, newTask]);

                // IMPORTANT: Persist the comment-to-task link so it survives page refresh
                // Since Airtable Tasks table doesn't have SourceCommentId field, we store this mapping in session data
                saveCommentTaskLink(commentId, newTask.id);

                // Also apply the SourceCommentId to the in-memory task object
                if (!newTask.fields) {
                    newTask.fields = {};
                }
                newTask.fields.SourceCommentId = commentId;

                // Update the task button to show "View Task" instead of "Create Task"
                const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
                if (commentEl) {
                    const taskBtn = commentEl.querySelector('.comment-task-btn');
                    if (taskBtn) {
                        taskBtn.dataset.linkedTaskId = newTask.id;
                        taskBtn.innerHTML = '📋✓';
                        taskBtn.title = 'View affiliated task';
                        taskBtn.classList.add('has-task');
                        console.log('[CreateTaskFromComment DEBUG] Updated task button to show linked task');
                    }
                }

                showToast('Task created successfully!', 2000);
                closeModal();
            } else {
                console.log('[CreateTaskFromComment DEBUG] ❌ Failed to create task');
                showToast('Failed to create task', 3000);
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Task';
            }
        } catch (error) {
            console.error('[CreateTaskFromComment DEBUG] Error creating task:', error);
            showToast('Failed to create task', 3000);
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Task';
        }
    });

    // Show modal with animation
    console.log('[CreateTaskFromComment DEBUG] Showing modal with animation');
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });

    // Focus on the name input
    setTimeout(() => {
        nameInput.focus();
        nameInput.select();
    }, 100);
}

/**
 * Start replying to a comment
 */
function startCommentReply(commentId) {
    console.log('[ComponentComment DEBUG] startCommentReply called for:', commentId);
    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    if (!commentEl) {
        console.log('[ComponentComment DEBUG] ❌ Comment element not found');
        return;
    }

    const senderName = commentEl.dataset.senderName || 'Unknown';
    const commentContent = commentEl.dataset.content || '';
    const componentSection = commentEl.closest('.component-comments-section');
    const componentId = componentSection?.dataset.componentId;

    if (!componentId) {
        console.log('[ComponentComment DEBUG] ❌ No componentId found');
        return;
    }

    console.log('[ComponentComment DEBUG] Replying to:', { commentId, senderName, componentId, preview: commentContent.substring(0, 30) });

    // Set the reply state
    componentCommentReplyingTo = {
        commentId,
        senderName,
        preview: commentContent,
        componentId
    };

    // Find the comment input for this component
    const inputContainer = document.querySelector(`.component-comment-form[data-component-id="${componentId}"]`) ||
                          document.querySelector(`.component-comments-body[data-component-id="${componentId}"]`);
    const input = document.querySelector(`.component-comment-input[data-component-id="${componentId}"]`);

    if (!inputContainer || !input) {
        console.log('[ComponentComment DEBUG] ❌ Input elements not found');
        return;
    }

    // Remove existing reply indicator if any
    const existingIndicator = inputContainer.querySelector('.comment-reply-indicator');
    if (existingIndicator) existingIndicator.remove();

    // Create and insert the reply indicator
    const replyIndicator = document.createElement('div');
    replyIndicator.className = 'comment-reply-indicator';
    const truncatedPreview = commentContent.length > 40 ? commentContent.substring(0, 40) + '...' : commentContent;
    replyIndicator.innerHTML = `
        <span class="reply-indicator-text">↩ Replying to <strong>${escapeHtml(senderName)}</strong>: ${escapeHtml(truncatedPreview)}</span>
        <button class="cancel-reply-btn" type="button" title="Cancel reply">✕</button>
    `;

    // Add cancel handler
    replyIndicator.querySelector('.cancel-reply-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        cancelCommentReply(componentId);
    });

    // Insert the indicator before the input
    input.parentElement.insertBefore(replyIndicator, input);

    // Update placeholder and focus
    input.placeholder = `Reply to ${senderName}...`;
    input.focus();

    console.log('[ComponentComment DEBUG] ✅ Reply indicator added');
}

/**
 * Cancel the current comment reply
 */
function cancelCommentReply(componentId) {
    console.log('[ComponentComment DEBUG] cancelCommentReply called for:', componentId);
    componentCommentReplyingTo = null;

    // Remove reply indicator
    const indicator = document.querySelector(`.component-comments-body[data-component-id="${componentId}"] .comment-reply-indicator`);
    if (indicator) indicator.remove();

    // Reset placeholder
    const input = document.querySelector(`.component-comment-input[data-component-id="${componentId}"]`);
    if (input) {
        input.placeholder = 'Add a comment...';
    }
}

/**
 * Start editing a comment
 */
function startCommentEdit(commentId) {
    console.log('[ComponentComment DEBUG] startCommentEdit called for:', commentId);
    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    if (!commentEl) {
        console.log('[ComponentComment DEBUG] ❌ Comment element not found');
        return;
    }

    const contentEl = commentEl.querySelector('.comment-content');
    if (!contentEl) {
        console.log('[ComponentComment DEBUG] ❌ Content element not found');
        return;
    }

    const currentContent = contentEl.textContent;
    console.log('[ComponentComment DEBUG] Current content:', currentContent?.substring(0, 30));

    // Replace content with edit input
    contentEl.innerHTML = `
        <input type="text" class="comment-edit-input" value="${escapeHtml(currentContent)}">
        <div class="comment-edit-actions">
            <button class="comment-edit-save" data-comment-id="${commentId}">Save</button>
            <button class="comment-edit-cancel" data-comment-id="${commentId}">Cancel</button>
        </div>
    `;

    const input = contentEl.querySelector('.comment-edit-input');
    const saveBtn = contentEl.querySelector('.comment-edit-save');
    const cancelBtn = contentEl.querySelector('.comment-edit-cancel');

    input.focus();
    input.select();

    const saveEdit = async () => {
        const newContent = input.value.trim();
        console.log('[ComponentComment DEBUG] Saving edit - new content:', newContent?.substring(0, 30));
        if (newContent && newContent !== currentContent) {
            const currentUser = getCurrentUser();
            console.log('[ComponentComment DEBUG] Calling api.updateComponentComment...');
            const result = await api.updateComponentComment(commentId, newContent, currentUser.id);
            console.log('[ComponentComment DEBUG] Update result:', result ? 'SUCCESS' : 'FAILED');
            if (result) {
                contentEl.textContent = newContent;

                // Add edited indicator
                const header = commentEl.querySelector('.comment-header');
                if (header && !header.querySelector('.comment-edited')) {
                    const editedSpan = document.createElement('span');
                    editedSpan.className = 'comment-edited';
                    editedSpan.textContent = '(edited)';
                    header.appendChild(editedSpan);
                }

                // Also update the data attribute for future replies
                commentEl.dataset.content = newContent;
                console.log('[ComponentComment DEBUG] ✅ Edit saved successfully');
            } else {
                console.log('[ComponentComment DEBUG] ❌ Edit failed - reverting');
                contentEl.textContent = currentContent;
            }
        } else {
            console.log('[ComponentComment DEBUG] No changes or empty - canceling');
            contentEl.textContent = currentContent;
        }
    };

    const cancelEdit = () => {
        console.log('[ComponentComment DEBUG] Edit canceled');
        contentEl.textContent = currentContent;
    };

    saveBtn.addEventListener('click', saveEdit);
    cancelBtn.addEventListener('click', cancelEdit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveEdit();
        if (e.key === 'Escape') cancelEdit();
    });
}

/**
 * Delete a comment
 */
async function deleteComment(commentId) {
    console.log('[ComponentComment DEBUG] deleteComment called for:', commentId);
    if (!confirm('Delete this comment?')) {
        console.log('[ComponentComment DEBUG] Delete canceled by user');
        return;
    }

    const currentUser = getCurrentUser();
    console.log('[ComponentComment DEBUG] Calling api.deleteComponentComment...');
    const result = await api.deleteComponentComment(commentId, currentUser.id);
    console.log('[ComponentComment DEBUG] Delete result:', result ? 'SUCCESS' : 'FAILED');

    if (result) {
        const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
        if (commentEl) {
            commentEl.classList.add('deleted');
            commentEl.innerHTML = '<em class="deleted-comment-text">This comment was deleted</em>';
            console.log('[ComponentComment DEBUG] ✅ Comment marked as deleted in UI');
        }

        // Update count
        const componentSection = commentEl?.closest('.component-comments-section');
        if (componentSection) {
            const componentId = componentSection.dataset.componentId;
            const countEl = document.querySelector(`.comments-count[data-component-id="${componentId}"]`);
            if (countEl) {
                const currentCount = parseInt(countEl.textContent) || 0;
                countEl.textContent = Math.max(0, currentCount - 1);
                console.log('[ComponentComment DEBUG] Updated count from', currentCount, 'to', Math.max(0, currentCount - 1));
            }
        }
    } else {
        console.log('[ComponentComment DEBUG] ❌ Delete failed - no UI changes made');
    }
}

/**
 * Show reaction picker for a comment
 */
function showCommentReactionPicker(commentId) {
    console.log('[CommentReactionPicker DEBUG] showCommentReactionPicker called');
    console.log('[CommentReactionPicker DEBUG] commentId:', commentId);
    console.log('[CommentReactionPicker DEBUG] QUICK_REACTIONS:', QUICK_REACTIONS);

    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    console.log('[CommentReactionPicker DEBUG] commentEl found:', commentEl);
    if (!commentEl) {
        console.log('[CommentReactionPicker DEBUG] ❌ No comment element found, returning early');
        return;
    }

    // Find the react button to position near it
    const reactBtn = commentEl.querySelector('.comment-action-btn[data-action="react"]');
    console.log('[CommentReactionPicker DEBUG] reactBtn found:', reactBtn);
    if (!reactBtn) {
        console.log('[CommentReactionPicker DEBUG] ❌ No react button found, returning early');
        return;
    }

    // Remove existing picker
    const existingPicker = document.querySelector('.comment-reaction-picker');
    console.log('[CommentReactionPicker DEBUG] Existing picker found:', existingPicker);
    if (existingPicker) existingPicker.remove();

    const picker = document.createElement('div');
    picker.className = 'comment-reaction-picker';
    console.log('[CommentReactionPicker DEBUG] Created picker element:', picker);

    QUICK_REACTIONS.forEach((emoji, index) => {
        console.log(`[CommentReactionPicker DEBUG] Adding emoji ${index}:`, emoji, 'type:', typeof emoji);
        const btn = document.createElement('button');
        btn.className = 'reaction-picker-btn';
        btn.textContent = emoji;
        console.log(`[CommentReactionPicker DEBUG] Button ${index} textContent:`, btn.textContent);
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            console.log('[CommentReactionPicker DEBUG] Emoji button clicked:', emoji);
            picker.remove();
            await toggleCommentReaction(commentId, emoji);
        });
        picker.appendChild(btn);
    });

    console.log('[CommentReactionPicker DEBUG] Picker innerHTML:', picker.innerHTML);
    console.log('[CommentReactionPicker DEBUG] Picker children count:', picker.children.length);

    // Append to body to avoid overflow clipping issues in presentation view
    document.body.appendChild(picker);
    console.log('[CommentReactionPicker DEBUG] ✅ Picker appended to document.body');

    // Position the picker near the react button
    const rect = reactBtn.getBoundingClientRect();
    console.log('[CommentReactionPicker DEBUG] Button rect:', rect);

    picker.style.position = 'fixed';
    picker.style.zIndex = '10001'; // Higher than presentation modal (z-index: 1000)

    // Position above the button if there's room, otherwise below
    const pickerHeight = 50; // Approximate height
    if (rect.top > pickerHeight + 10) {
        picker.style.top = `${rect.top - pickerHeight - 8}px`;
    } else {
        picker.style.top = `${rect.bottom + 8}px`;
    }
    picker.style.left = `${Math.max(10, rect.left - 50)}px`;

    console.log('[CommentReactionPicker DEBUG] Final picker styles:', {
        position: picker.style.position,
        top: picker.style.top,
        left: picker.style.left,
        zIndex: picker.style.zIndex
    });

    // Verify picker is in DOM
    setTimeout(() => {
        const verifyPicker = document.querySelector('.comment-reaction-picker');
        console.log('[CommentReactionPicker DEBUG] Verify picker in DOM after append:', verifyPicker);
        if (verifyPicker) {
            const computedStyle = window.getComputedStyle(verifyPicker);
            console.log('[CommentReactionPicker DEBUG] Picker computed styles:', {
                display: computedStyle.display,
                visibility: computedStyle.visibility,
                opacity: computedStyle.opacity,
                position: computedStyle.position,
                zIndex: computedStyle.zIndex,
                width: computedStyle.width,
                height: computedStyle.height
            });
        }
    }, 10);

    // Close picker on outside click
    const closePicker = (e) => {
        console.log('[CommentReactionPicker DEBUG] closePicker triggered, target:', e.target);
        if (!picker.contains(e.target)) {
            console.log('[CommentReactionPicker DEBUG] Click outside picker, removing');
            picker.remove();
            document.removeEventListener('click', closePicker);
        }
    };
    setTimeout(() => document.addEventListener('click', closePicker), 0);
}

/**
 * Toggle a reaction on a comment
 */
async function toggleCommentReaction(commentId, emoji) {
    const currentUser = getCurrentUser();
    if (!currentUser) return;

    const commentEl = document.querySelector(`.component-comment[data-comment-id="${commentId}"]`);
    if (!commentEl) return;

    // Check if user already reacted
    const existingBadge = commentEl.querySelector(`.comment-reaction-badge[data-emoji="${emoji}"]`);
    const hasReacted = existingBadge?.classList.contains('user-reacted');

    const result = await api.toggleComponentCommentReaction(commentId, currentUser.id, emoji, !hasReacted);

    if (result) {
        // Update the reactions display
        updateCommentReactionsDisplay(commentEl, result);

        // Broadcast via Pusher if available
        if (presentationChatChannel) {
            presentationChatChannel.trigger('client-component-comment-reaction', {
                commentId,
                reactions: result,
                senderId: currentUser.id
            });
        }
    }
}

/**
 * Update the reactions display on a comment
 */
function updateCommentReactionsDisplay(commentEl, reactions) {
    const currentUser = getCurrentUser();

    // Remove existing reactions container
    let reactionsContainer = commentEl.querySelector('.comment-reactions');
    if (reactionsContainer) reactionsContainer.remove();

    // Create new reactions container if there are any
    if (reactions && Object.keys(reactions).length > 0) {
        reactionsContainer = document.createElement('div');
        reactionsContainer.className = 'comment-reactions';

        for (const [emoji, users] of Object.entries(reactions)) {
            if (users.length > 0) {
                const hasReacted = users.includes(currentUser?.id);
                const badge = document.createElement('button');
                badge.className = `comment-reaction-badge ${hasReacted ? 'user-reacted' : ''}`;
                badge.dataset.emoji = emoji;
                badge.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
                reactionsContainer.appendChild(badge);
            }
        }

        // Insert before actions
        const actions = commentEl.querySelector('.comment-actions');
        if (actions) {
            commentEl.insertBefore(reactionsContainer, actions);
        } else {
            commentEl.appendChild(reactionsContainer);
        }
    }
}

/**
 * Update the comment count badge for a component
 */
function updateCommentCount(componentId, count) {
    const countEl = document.querySelector(`.comments-count[data-component-id="${componentId}"]`);
    if (countEl) {
        countEl.textContent = count;
        if (count > 0) {
            countEl.classList.add('has-comments');
        } else {
            countEl.classList.remove('has-comments');
        }
    }
    // Update the label text to be more inviting when comments exist
    const toggle = document.querySelector(`.component-comments-toggle[data-component-id="${componentId}"]`);
    if (toggle) {
        const label = toggle.querySelector('.comments-label');
        if (label) {
            label.textContent = count > 0 ? `Comment${count !== 1 ? 's' : ''}` : 'Add a comment';
        }
    }
}

/**
 * Get time ago string from a date
 */
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

/**
 * Load initial comment counts for all items (lightweight)
 */
async function loadAllCommentCounts() {
    console.log('[ComponentComment DEBUG] loadAllCommentCounts called');
    const sessionId = state.session.id;
    console.log('[ComponentComment DEBUG] sessionId for counts:', sessionId);

    if (!sessionId) {
        console.log('[ComponentComment DEBUG] ❌ No sessionId - skipping comment counts');
        return;
    }

    try {
        console.log('[ComponentComment DEBUG] Calling api.fetchAllComponentComments...');
        // Fetch all component comments for the session in one call
        const allComments = await api.fetchAllComponentComments(sessionId);
        console.log('[ComponentComment DEBUG] fetchAllComponentComments returned:', allComments?.length, 'comments');

        // Group by componentId and count
        // Also collect comments by component for image extraction
        const countsByComponent = new Map();
        const commentsByComponent = new Map();

        allComments.forEach(comment => {
            let componentId = null;

            // Check for Item Link field (regular items starting with 'rec')
            const itemLinks = comment.fields['Item Link'];
            if (itemLinks && itemLinks.length > 0) {
                componentId = itemLinks[0]; // Get the first linked item ID
            }

            // Check for custom items via content prefix [PLAN_COMMENT:item:componentId]
            // Matches all custom ID formats: manual-presentation-*, manual-add-*, ai-child-*, ai-presentation-*, solution-*
            if (!componentId) {
                const content = comment.fields?.Content || '';
                const manualItemMatch = content.match(/^\[PLAN_COMMENT:item:([^\]]+)\]/);
                if (manualItemMatch) {
                    componentId = manualItemMatch[1];
                }
            }

            if (componentId) {
                // Update count
                const current = countsByComponent.get(componentId) || 0;
                countsByComponent.set(componentId, current + 1);

                // Collect comments for image extraction
                if (!commentsByComponent.has(componentId)) {
                    commentsByComponent.set(componentId, []);
                }
                commentsByComponent.get(componentId).push(comment);
            }
        });

        console.log('[ComponentComment DEBUG] Comment counts by component:', Object.fromEntries(countsByComponent));

        // Update all count badges
        countsByComponent.forEach((count, componentId) => {
            updateCommentCount(componentId, count);
        });

        // Extract images from comments and add to carousels
        commentsByComponent.forEach((comments, componentId) => {
            extractAndAddCommentImages(componentId, comments);
        });

        console.log('[ComponentComment DEBUG] ✅ Updated badges for', countsByComponent.size, 'components');
        log('Presentation', `Loaded comment counts for ${countsByComponent.size} components`);
    } catch (error) {
        console.log('[ComponentComment DEBUG] ❌ Error loading comment counts:', error);
        log('Presentation', `Error loading comment counts: ${error.message}`);
    }
}

// ============================================
// END COMPONENT COMMENTS FEATURE
// ============================================

function handleKeyDown(e) {
    if (e.key === 'Escape') {
        updateUrl({ view: null });
        hidePresentationView();
    }
}

export async function showPresentationView(listType, startRecordId = null) {
    if (PRES_DEBUG) {
        console.log('[PRESENTATION DEBUG] ========== showPresentationView called ==========');
        console.log('[PRESENTATION DEBUG] listType:', listType, 'startRecordId:', startRecordId);
        console.log('[PRESENTATION DEBUG] state.cart.lockedItems.size:', state.cart.lockedItems.size);
        console.log('[PRESENTATION DEBUG] state.cart.items.size:', state.cart.items.size);
        console.log('[PRESENTATION DEBUG] state.session.id:', state.session.id);
        console.log('[PRESENTATION DEBUG] DOM check:', {
            modalExists: !!document.getElementById('presentation-modal-overlay'),
            closeBtnExists: !!document.getElementById('presentation-close-btn'),
            itemsListExists: !!document.getElementById('itinerary-items-list')
        });
    }
    log('Presentation', `Showing itinerary presentation`);
    // console.log('[Accordion DEBUG] showPresentationView called');

    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot show presentation view - DOM elements not available');
        // console.error('[Accordion DEBUG] ensureDOMElements failed');
        return;
    }
    // console.log('[Accordion DEBUG] ensureDOMElements succeeded');

    // Load user permissions if not already loaded (handles direct URL access)
    if (state.permissions?.isLoading !== false && state.session.id && state.session.user?.isAuthenticated && state.session.user?.id) {
        try {
            const { role, permissionRecord } = await api.fetchUserRole(state.session.id, state.session.user.id);
            setState({
                permissions: {
                    currentRole: role,
                    isLoading: false,
                    permissionRecord: permissionRecord
                }
            });
        } catch (error) {
            console.error('[Presentation DEBUG] Error loading permissions:', error);
            // On error, set isLoading to false so fallback (isOwned) can be used
            setState({
                permissions: {
                    currentRole: null,
                    isLoading: false,
                    permissionRecord: null
                }
            });
        }
    }

    // Register sync callback to handle updates from other views
    registerSyncCallback('presentation', handlePlanSyncUpdate);

    // Initialize toast notification system
    initializeToastNotifications({ getCurrentUser });

    // Initialize and show the Unified Chat Panel
    setUCPGetCurrentUser(getCurrentUser);
    setUCPSendMessage(sendChatMessage);
    initializeUnifiedChatPanel();
    showUnifiedChatPanel();

    // Initialize the Universal Vitality UI system (pulse/aura, Net Emoji, flow lines)
    // NOTE: Only register event listeners here. Actual recalc happens AFTER cards are rendered.
    initVitalityUI();

    // Fetch tasks for this project if not already loaded (critical for comment-task linking)
    // This ensures comment-created tasks are visible when page is refreshed or link is shared
    const projectId = state.session.id;
    if (projectId && !state.tasks.byProject.has(projectId)) {
        try {
            const tasks = await api.fetchTasks(projectId);
            if (Array.isArray(tasks)) {
                // Update tasks.all map
                tasks.forEach(task => {
                    state.tasks.all.set(task.id, task);
                });
                // Update tasks.byProject map
                state.tasks.byProject.set(projectId, tasks);

                // IMPORTANT: After tasks are loaded, restore comment-to-task links from session storage
                // This applies SourceCommentId to task objects so the UI shows linked tasks correctly
                loadCommentTaskLinks();

                // Notify UCP (and any other listeners) that task data is now available
                // so badges can refresh with correct statuses instead of showing "pending"
                console.log('[Presentation DEBUG] Dispatching tasks-state-updated after task load');
                window.dispatchEvent(new CustomEvent('tasks-state-updated'));
            }
        } catch (error) {
            console.error('[Presentation DEBUG] Error fetching tasks:', error);
            // Non-blocking - comments will still render, just without task links
        }
    } else {
        // Even if tasks were already loaded, restore comment-to-task links
        loadCommentTaskLinks();
        // Notify UCP that task data is available for badge refresh
        console.log('[Presentation DEBUG] Dispatching tasks-state-updated (tasks already loaded)');
        window.dispatchEvent(new CustomEvent('tasks-state-updated'));
    }

    // Mark that catalog will need rendering when exiting presentation view
    // (since we skip catalog rendering while in presentation view)
    catalogNeedsRender = true;

    // Clear image cache and comments cache for fresh load
    itemImagesCache.clear();
    componentCommentsCache.clear();

    // Load task statuses from session state
    loadElementTaskStatuses();

    // Render presentation header (copies logo and title from main header)
    renderPresentationHeader();

    // Initialize click handler for sentiment popup on emoji indicator
    initializeEventEmojiClickHandler();

    // Update the running total cost in the header
    updatePresentationHeaderTotal();

    // Render all sections
    renderEventHeader();
    renderCollaborators();
    await renderRsvpSection(); // Render RSVP buttons and list for events
    await renderAllItems();

    // Vitality recalculation is now handled inside renderAllItems() itself
    // via a setTimeout(0) call that fires after innerHTML is set, ensuring
    // cards are in the DOM when applyCardPulses() queries for them.

    // Render goal chips in header and set up regenerate button
    renderGoalChips();
    initializePlanFocusHandlers();

    // Initialize accordions and generate summaries
    initializeAccordions();

    // Update the plan summary dashboard
    updatePlanSummaryDashboard();

    // Show modal - let CSS handle display via .active class
    // CSS: .presentation-fullpage.active { display: flex }
    // UCP panel is now a fixed overlay (body.ucp-panel-open) rather than a grid column
    // IMPORTANT: Do NOT set modal.style.display here - inline styles override CSS class rules

    // Remove early-loading optimization class BEFORE adding .active
    // The loading CSS has `display: flex !important` which would override the grid layout
    document.body.classList.remove('presentation-loading');
    document.documentElement.classList.remove('presentation-loading');

    modal.classList.add('active');
    modal.style.display = ''; // Clear any leftover inline display style
    document.body.classList.add('modal-open');
    document.body.classList.add('presentation-active');
    document.documentElement.classList.add('presentation-active');
    if (PRES_DEBUG) console.log('[PRESENTATION DEBUG] Modal shown. Classes:', modal.className, 'Computed display:', getComputedStyle(modal).display);

    // === LAYOUT DEBUG: Verify layout is correct after modal activation ===
    requestAnimationFrame(() => {
        const contentEl = modal.querySelector('.presentation-content');
        const ucpPanel = document.getElementById('unified-chat-panel');
        const modalComputed = getComputedStyle(modal);
        if (PRES_DEBUG) {
            console.log('[LAYOUT DEBUG] Post-activation:', {
                display: modalComputed.display,
                gridCols: modalComputed.gridTemplateColumns,
                contentHeight: contentEl ? contentEl.offsetHeight : 'N/A',
                ucpWidth: ucpPanel ? ucpPanel.offsetWidth : 'N/A',
                classes: modal.className
            });
        }
    });

    document.addEventListener('keydown', handleKeyDown);

    // Show drag buckets (grayed out initially, colorize on drag)
    if (dragBucketsEl) {
        // Reset any inline styles that might have been set when hiding
        dragBucketsEl.style.display = '';
        dragBucketsEl.style.visibility = '';
        dragBucketsEl.classList.add('buckets-shown');
    }

    // Start the background animation
    startPresentationBackgroundAnimation();

    // Load comment counts in background (non-blocking)
    loadAllCommentCounts();

    // Scroll to specific item if provided
    if (startRecordId) {
        const targetItem = document.querySelector(`.itinerary-item[data-record-id="${startRecordId}"]`);
        if (targetItem) {
            setTimeout(() => {
                targetItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        }
    }

    // Initialize merge dialog event listeners
    initializeMergeDialogListeners();

    log('Presentation', 'Itinerary view rendered successfully');
    if (PRES_DEBUG) console.log('[PRESENTATION DEBUG] ========== showPresentationView COMPLETE ==========');
}

export function hidePresentationView() {
    if (PRES_DEBUG) console.log('[PRESENTATION DEBUG] hidePresentationView called. modal:', !!modal);
    if (!modal) return;

    // Unregister sync callback when closing presentation view
    unregisterSyncCallback('presentation');

    // Clean up Vitality UI (flow lines, etc.)
    cleanupVitalityUI();

    // Hide the Unified Chat Panel
    hideUnifiedChatPanel();

    // Stop the background animation
    stopPresentationBackgroundAnimation();

    // Hide collaborators modal if open
    hideCollaboratorsModal();

    // Cleanup drag-drop functionality
    cleanupItemDragDrop();

    // Exit merge mode if active
    exitMergeMode();

    // Hide drag buckets and related elements - comprehensive cleanup
    if (dragBucketsEl) {
        dragBucketsEl.classList.remove('buckets-shown');
        dragBucketsEl.classList.remove('drag-active');
        dragBucketsEl.classList.remove('radial-mode'); // Remove radial mode class
        // Explicitly set visibility to ensure elements don't leak through
        dragBucketsEl.style.display = 'none';
        dragBucketsEl.style.visibility = 'hidden';
    }

    // Close action menu and clean up old radial state
    if (isActionMenuOpen()) {
        console.log('[PRES-MENU DEBUG] Closing action menu on presentation deactivation');
        closeActionMenu();
    }
    if (radialMenuContainer) {
        radialMenuContainer.classList.remove('radial-active');
        radialMenuActive = false;
        cleanupRadialEventListeners();
    }
    // Remove delegated swipe listeners so they can be re-attached on next open
    if (itineraryItemsListEl && radialListenersAttached) {
        itineraryItemsListEl.removeEventListener('touchstart', handleRadialTouchStart);
        itineraryItemsListEl.removeEventListener('mousedown', handleRadialMouseDown);
        radialListenersAttached = false;
    }

    // Ensure drag tooltip is hidden
    if (dragActionTooltip) {
        dragActionTooltip.style.display = 'none';
        dragActionTooltip.style.visibility = 'hidden';
    }

    // Ensure merge indicator is hidden
    if (dragMergeIndicator) {
        dragMergeIndicator.style.display = 'none';
        dragMergeIndicator.style.visibility = 'hidden';
    }

    modal.classList.remove('active');
    modal.style.display = ''; // Clear any inline display style; CSS handles hiding via .active removal
    document.body.classList.remove('modal-open');
    document.body.classList.remove('presentation-active');
    document.documentElement.classList.remove('presentation-active');
    document.removeEventListener('keydown', handleKeyDown);
    console.log('[PRES-MENU DEBUG] Presentation view deactivated, presentation-active class removed');

    // If catalog rendering was skipped when entering presentation view,
    // trigger it now via the global applyFiltersAndSort function
    if (catalogNeedsRender && typeof window.applyFiltersAndSort === 'function') {
        log('Presentation', 'Triggering catalog render after exiting presentation view');
        // Small delay to ensure URL is updated first
        setTimeout(() => {
            window.applyFiltersAndSort(window.imageCache);
        }, 50);
        catalogNeedsRender = false;
    }
}

export function setupPresentationEventListeners() {
    if (PRES_DEBUG) console.log('[PRESENTATION DEBUG] setupPresentationEventListeners called.');
    if (!ensureDOMElements()) {
        console.error('[PRESENTATION DEBUG] Cannot setup event listeners - DOM elements not available');
        return;
    }
    if (PRES_DEBUG) console.log('[PRESENTATION DEBUG] DOM elements available for event listener setup.');

    // Listen for user login/logout events to update the account button and collaborators
    document.addEventListener('userLoggedIn', handlePresentationUserLogin);
    document.addEventListener('userLoggedOut', updatePresentationAccountButton);

    // Listen for navigateToCatalog event (from WTF Plans panel "Browse Catalog" button)
    document.addEventListener('navigateToCatalog', () => {
        log('Presentation', 'navigateToCatalog event received — closing presentation view');
        hidePresentationView();
    });

    // Handle window resize for background canvas
    window.addEventListener('resize', () => {
        if (modal && modal.classList.contains('active')) {
            resizePresentationBackground();
        }
    });

    closeBtn.addEventListener('click', () => {
        updateUrl({ view: null });
        hidePresentationView();
    });

    // Presentation header hamburger button (opens WTF Plans panel as overlay)
    if (presentationBackBtn) {
        presentationBackBtn.addEventListener('click', () => {
            console.log('[PRES-MENU DEBUG] Hamburger button clicked in presentation view');
            const panel = document.getElementById('wtf-plans-panel');
            const overlay = document.getElementById('wtf-plans-panel-overlay');
            const presModal = document.getElementById('presentation-modal-overlay');
            console.log('[PRES-MENU DEBUG] Before showWtfPlansPanel:', {
                panelExists: !!panel,
                panelDisplay: panel?.style.display,
                panelComputedDisplay: panel ? getComputedStyle(panel).display : 'N/A',
                panelComputedZIndex: panel ? getComputedStyle(panel).zIndex : 'N/A',
                panelClassList: panel?.classList.toString(),
                overlayExists: !!overlay,
                overlayClassList: overlay?.classList.toString(),
                presModalZIndex: presModal ? getComputedStyle(presModal).zIndex : 'N/A',
                bodyHasPresentationActive: document.body.classList.contains('presentation-active'),
            });
            // Open WTF Plans panel directly on top of the presentation view
            // so users can quickly switch between plans without leaving the view
            showWtfPlansPanel();
            // Log state after showWtfPlansPanel completes (async, so use microtask)
            setTimeout(() => {
                console.log('[PRES-MENU DEBUG] After showWtfPlansPanel:', {
                    panelDisplay: panel?.style.display,
                    panelComputedDisplay: panel ? getComputedStyle(panel).display : 'N/A',
                    panelComputedZIndex: panel ? getComputedStyle(panel).zIndex : 'N/A',
                    panelClassList: panel?.classList.toString(),
                    panelTransform: panel ? getComputedStyle(panel).transform : 'N/A',
                    overlayComputedDisplay: overlay ? getComputedStyle(overlay).display : 'N/A',
                    overlayClassList: overlay?.classList.toString(),
                    panelBoundingRect: panel?.getBoundingClientRect(),
                });
            }, 50);
        });
    } else {
        console.warn('[PRES-MENU DEBUG] presentationBackBtn NOT found in DOM during event listener setup');
    }

    // Note: presentationHeaderShareBtn removed - share functionality now in collaborators add/share button

    // Presentation header total button (opens checkout modal)
    const presentationHeaderTotalBtn = document.getElementById('presentation-header-total');
    if (presentationHeaderTotalBtn) {
        presentationHeaderTotalBtn.addEventListener('click', () => {
            // Only show checkout if there's a total (button is visible)
            if (presentationHeaderTotalBtn.textContent.trim()) {
                const shopSettings = getShopSettings();
                showCheckoutModal(shopSettings);
            }
        });
    }

    // Handle accordion header clicks
    const scrollContainer = modal.querySelector('.presentation-itinerary-scroll');
    // console.log('[Accordion DEBUG] setupPresentationEventListeners - scrollContainer:', scrollContainer);

    if (scrollContainer) {
        // Debug: Log all accordion headers found (both main and sub)
        // const accordionHeaders = scrollContainer.querySelectorAll('.itinerary-accordion-header, .sub-accordion-header');
        // console.log('[Accordion DEBUG] Found accordion headers:', accordionHeaders.length);
        // accordionHeaders.forEach((header, index) => {
        //     console.log(`[Accordion DEBUG] Header ${index}:`, header, 'data-section:', header.dataset.section);
        // });

        scrollContainer.addEventListener('click', (e) => {
            // console.log('[Accordion DEBUG] Click event on scrollContainer');
            // console.log('[Accordion DEBUG] Click target:', e.target);
            // console.log('[Accordion DEBUG] Target tagName:', e.target.tagName);
            // console.log('[Accordion DEBUG] Target classList:', e.target.classList.toString());

            // Check for both main and sub accordion headers
            let accordionHeader = e.target.closest('.itinerary-accordion-header');
            if (!accordionHeader) {
                accordionHeader = e.target.closest('.sub-accordion-header');
            }
            // console.log('[Accordion DEBUG] Closest accordion header:', accordionHeader);

            if (!accordionHeader) {
                // console.log('[Accordion DEBUG] No accordion header found - ignoring click');
                return;
            }

            // Don't trigger accordion on interactive elements inside
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) {
                // console.log('[Accordion DEBUG] Clicked on button/link/input inside header - ignoring');
                return;
            }

            const section = accordionHeader.dataset.section;
            // console.log('[Accordion DEBUG] Section from data-section attribute:', section);

            if (section) {
                // console.log('[Accordion DEBUG] Calling toggleAccordion for section:', section);
                toggleAccordion(section);
            } else {
                // console.warn('[Accordion DEBUG] No section data attribute found on header');
            }
        });
        // console.log('[Accordion DEBUG] Click listener added to scrollContainer');
    } else {
        console.error('[Accordion DEBUG] scrollContainer not found!');
    }

    // Handle thumbnail clicks for image carousel
    itineraryItemsListEl.addEventListener('click', handleThumbnailClick);

    // Handle reaction clicks
    console.log('[Events DEBUG] Adding handleReactionClick listener to itineraryItemsListEl:', itineraryItemsListEl);
    itineraryItemsListEl.addEventListener('click', handleReactionClick);

    // Handle item accordion header clicks (for per-item collapse/expand)
    itineraryItemsListEl.addEventListener('click', handleItemAccordionClick);

    // Handle item clicks to open detail modal
    itineraryItemsListEl.addEventListener('click', handleItemClick);

    // Handle expand button clicks to show full item details
    itineraryItemsListEl.addEventListener('click', handleExpandButtonClick);

    // Handle suggestion button clicks (for empty state recommendations)
    itineraryItemsListEl.addEventListener('click', handleSuggestionClick);

    // Handle welcome tip dismiss
    itineraryItemsListEl.addEventListener('click', (e) => {
        const dismissBtn = e.target.closest('.welcome-tip-dismiss');
        if (dismissBtn) {
            e.stopPropagation();
            const tipEl = dismissBtn.closest('.board-welcome-tip');
            if (tipEl) {
                tipEl.style.transition = 'opacity 0.3s, transform 0.3s';
                tipEl.style.opacity = '0';
                tipEl.style.transform = 'translateY(-10px)';
                setTimeout(() => tipEl.remove(), 300);
            }
        }
    });

    // Handle component comments interactions
    console.log('[Events DEBUG] Adding handleComponentCommentsClick listener to itineraryItemsListEl');
    itineraryItemsListEl.addEventListener('click', handleComponentCommentsClick);
    itineraryItemsListEl.addEventListener('keydown', handleComponentCommentsKeydown);
    itineraryItemsListEl.addEventListener('change', handleCommentImageInputChange);

    // Handle task status button clicks on items
    console.log('[Events DEBUG] Adding handleTaskStatusClick listener to itineraryItemsListEl:', itineraryItemsListEl);
    itineraryItemsListEl.addEventListener('click', handleTaskStatusClick);

    // Handle group dissolved events from modal
    window.addEventListener('groupDissolved', async (e) => {
        log('Presentation', `Group dissolved from modal: ${e.detail?.groupId}`);
        await renderAllItems();
        generateItemsSummary();
        updatePresentationHeaderTotal();
        triggerSave();
    });

    // Handle individual item removed from group via modal
    window.addEventListener('groupItemRemoved', async (e) => {
        log('Presentation', `Item removed from group via modal: ${e.detail?.recordId} from ${e.detail?.groupId}`);
        await renderAllItems();
        generateItemsSummary();
        updatePresentationHeaderTotal();
        triggerSave();
    });

    // Handle task status button clicks on event details (date, goals, etc.)
    const headerAccordionContent = modal.querySelector('.itinerary-header .itinerary-accordion-content');
    console.log('[Events DEBUG] Adding handleTaskStatusClick listener to headerAccordionContent:', headerAccordionContent);
    if (headerAccordionContent) {
        headerAccordionContent.addEventListener('click', handleTaskStatusClick);
        // Handle RSVP button clicks in the presentation view
        headerAccordionContent.addEventListener('click', handlePresentationRsvpClick);
    }

    // Also add RSVP click handler to the RSVP section directly (in case it's outside accordion content)
    const rsvpSection = document.getElementById('presentation-rsvp-section');
    if (rsvpSection) {
        rsvpSection.addEventListener('click', handlePresentationRsvpClick);
    }

    // Note: shareBtn removed - share functionality now in collaborators add/share button

    // Collaborators add/share button - opens invite modal for authenticated users, copies link for guests
    if (collaboratorsAddShareBtn) {
        collaboratorsAddShareBtn.addEventListener('click', () => {
            if (state.session.user.isAuthenticated) {
                // Open invite modal for authenticated users
                showInviteModal();
            } else {
                // Fallback to copy link for unauthenticated users
                const baseURL = window.location.origin + window.location.pathname;
                const sessionID = state.session.id;
                const shareURL = `${baseURL}?session=${sessionID}&view=present`;

                navigator.clipboard.writeText(shareURL).then(() => {
                    const originalHTML = collaboratorsAddShareBtn.innerHTML;
                    collaboratorsAddShareBtn.innerHTML = '<span class="add-share-icon">✓</span><span class="add-share-text">Copied!</span>';
                    collaboratorsAddShareBtn.title = 'Link Copied!';
                    setTimeout(() => {
                        collaboratorsAddShareBtn.innerHTML = originalHTML;
                        collaboratorsAddShareBtn.title = 'Add people or share this plan';
                    }, 1500);
                });
            }
        });
    }

    // Account button in team section header - opens user profile modal
    if (presentationAccountBtn) {
        presentationAccountBtn.addEventListener('click', showUserModal);
    }

    // Collaborators modal close button
    if (collaboratorsModalClose) {
        collaboratorsModalClose.addEventListener('click', hideCollaboratorsModal);
    }

    // Close collaborators modal on backdrop click
    if (collaboratorsModal) {
        collaboratorsModal.addEventListener('click', (e) => {
            if (e.target === collaboratorsModal) {
                hideCollaboratorsModal();
            }
        });
    }

    // Search modal event listeners
    setupSearchModalEventListeners();

    // Plan summary dashboard metric click handlers (scroll to relevant sections)
    const dashboard = document.getElementById('plan-summary-dashboard');
    if (dashboard) {
        dashboard.addEventListener('click', (e) => {
            const metric = e.target.closest('.plan-summary-metric');
            if (!metric) return;

            const metricId = metric.id;
            if (metricId === 'plan-metric-items') {
                // Scroll to first item in the list
                const firstItem = itineraryItemsListEl?.querySelector('.itinerary-item');
                if (firstItem) {
                    firstItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            } else if (metricId === 'plan-metric-budget') {
                // Open checkout/total summary
                const totalBtn = document.getElementById('presentation-header-total');
                if (totalBtn) totalBtn.click();
            } else if (metricId === 'plan-metric-team') {
                // Scroll to collaborators section (first accordion)
                const headerSection = modal?.querySelector('.itinerary-accordion[data-section="header"]');
                if (headerSection) {
                    headerSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    // Expand it if collapsed
                    if (!accordionState.header) {
                        toggleAccordion('header');
                    }
                }
            } else if (metricId === 'plan-metric-status' || metricId === 'plan-metric-health') {
                // Show a toast with current plan status detail
                const statusVal = document.querySelector('#plan-metric-status .plan-metric-value')?.textContent;
                const healthVal = document.querySelector('#plan-metric-health .plan-metric-value')?.textContent;
                const itemCount = state.cart.items.size + state.cart.lockedItems.size;
                const lockedCount = state.cart.lockedItems.size;
                showToast(`Plan: ${statusVal} ${healthVal} \u2022 ${lockedCount} confirmed, ${itemCount} total items`, 3000);
            }
        });
    }
}

// ============================================
// PRESENTATION SEARCH MODAL FUNCTIONALITY
// ============================================

/**
 * Sets up event listeners for the search modal
 */
function setupSearchModalEventListeners() {
    // Add button opens search modal
    if (presentationAddBtn) {
        presentationAddBtn.addEventListener('click', openSearchModal);
    }

    // Toggle all button collapses/expands all item accordions
    if (presentationToggleAllBtn) {
        presentationToggleAllBtn.addEventListener('click', toggleAllItemAccordions);
    }

    // Toggle archived items button
    const archivedToggle = document.getElementById('presentation-toggle-archived');
    if (archivedToggle) {
        archivedToggle.addEventListener('click', toggleArchivedItems);
    }

    // Toggle completed items button
    const completedToggle = document.getElementById('presentation-toggle-completed');
    if (completedToggle) {
        completedToggle.addEventListener('click', toggleCompletedItems);
    }

    // Close button
    if (presentationSearchClose) {
        presentationSearchClose.addEventListener('click', closeSearchModal);
    }

    // Close on backdrop click
    if (presentationSearchModal) {
        presentationSearchModal.addEventListener('click', (e) => {
            if (e.target === presentationSearchModal) {
                closeSearchModal();
            }
        });
    }

    // Search input handler
    if (presentationSearchInput) {
        presentationSearchInput.addEventListener('input', handleSearchInput);
        presentationSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeSearchModal();
            }
        });
    }

    // Clear search button
    if (presentationSearchClear) {
        presentationSearchClear.addEventListener('click', () => {
            presentationSearchInput.value = '';
            presentationSearchClear.style.display = 'none';
            showInitialSearchState();
            clearPresentationRefinementChips();
        });
    }

    // Escape key to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && presentationSearchModal?.classList.contains('active')) {
            closeSearchModal();
        }
    });
}

/**
 * Opens the search modal
 */
function openSearchModal() {
    if (!presentationSearchModal) return;

    presentationSearchModal.classList.add('active');
    document.body.classList.add('search-modal-open');

    // Focus search input
    setTimeout(() => {
        presentationSearchInput?.focus();
    }, 100);

    // Initialize with browse categories
    showInitialSearchState();

    log('Presentation', 'Search modal opened');
}

/**
 * Closes the search modal
 */
function closeSearchModal() {
    if (!presentationSearchModal) return;

    presentationSearchModal.classList.remove('active');
    document.body.classList.remove('search-modal-open');

    // Cancel any pending search
    if (presentationSearchController) {
        presentationSearchController.abort();
        presentationSearchController = null;
    }

    // Clear search state
    if (presentationSearchInput) {
        presentationSearchInput.value = '';
    }
    if (presentationSearchClear) {
        presentationSearchClear.style.display = 'none';
    }
    clearPresentationRefinementChips();

    log('Presentation', 'Search modal closed');
}

/**
 * Shows the initial search state with browse categories
 */
function showInitialSearchState() {
    if (!presentationSearchResults || !presentationBrowseCategories) return;

    // Get unique categories from catalog
    const categories = new Set();
    state.records.all.forEach(record => {
        if (record.fields.Category) {
            categories.add(record.fields.Category);
        }
    });

    // Build category buttons
    presentationBrowseCategories.innerHTML = '';
    categories.forEach(category => {
        const btn = document.createElement('button');
        btn.className = 'presentation-category-btn';
        btn.textContent = category;
        btn.addEventListener('click', () => {
            presentationSearchInput.value = category;
            handleSearchInput({ target: presentationSearchInput });
        });
        presentationBrowseCategories.appendChild(btn);
    });

    // Show initial state
    presentationSearchResults.innerHTML = `
        <div class="presentation-search-initial">
            <p class="presentation-search-hint">Search for something specific, or browse popular categories below</p>
            <div class="presentation-browse-categories" id="presentation-browse-categories-inner">
                ${presentationBrowseCategories.innerHTML}
            </div>
        </div>
    `;
}

/**
 * Handles search input changes with debouncing
 */
function handleSearchInput(e) {
    const searchTerm = e.target.value.trim();

    // Show/hide clear button
    if (presentationSearchClear) {
        presentationSearchClear.style.display = searchTerm ? 'flex' : 'none';
    }

    // Clear previous debounce timer
    if (presentationSearchDebounceTimer) {
        clearTimeout(presentationSearchDebounceTimer);
    }

    // If search is cleared, show initial state
    if (!searchTerm) {
        showInitialSearchState();
        clearPresentationRefinementChips();
        return;
    }

    // Debounce the search
    presentationSearchDebounceTimer = setTimeout(() => {
        performPresentationSearch(searchTerm);
    }, PRESENTATION_SEARCH_DEBOUNCE);
}

/**
 * Performs the hybrid search (catalog + AI)
 */
async function performPresentationSearch(searchTerm) {
    if (!presentationSearchResults) return;

    // Abort any existing search
    if (presentationSearchController) {
        presentationSearchController.abort();
    }
    presentationSearchController = new AbortController();
    const signal = presentationSearchController.signal;

    log('Presentation', `Performing search for: "${searchTerm}"`);

    // Filter catalog items
    const searchLower = searchTerm.toLowerCase();
    const catalogMatches = state.records.all.filter(record => {
        const name = (record.fields.Name || '').toLowerCase();
        const description = (record.fields.Description || '').toLowerCase();
        const category = (record.fields.Category || '').toLowerCase();
        const tags = (record.fields.Tags || []).join(' ').toLowerCase();

        return name.includes(searchLower) ||
               description.includes(searchLower) ||
               category.includes(searchLower) ||
               tags.includes(searchLower);
    }).slice(0, 15); // Limit to 15 catalog matches

    // Clear results and show catalog results first
    presentationSearchResults.innerHTML = '';

    if (catalogMatches.length > 0) {
        const catalogSection = await createPresentationResultSection(
            `Catalog Matches`,
            'From our curated catalog',
            catalogMatches,
            false
        );
        presentationSearchResults.appendChild(catalogSection);
    }

    // Show AI loading section
    const aiLoadingSection = document.createElement('div');
    aiLoadingSection.className = 'presentation-search-loading';
    aiLoadingSection.innerHTML = `
        <div class="presentation-search-spinner"></div>
        <span class="presentation-search-loading-text">Finding more options with AI...</span>
    `;
    presentationSearchResults.appendChild(aiLoadingSection);

    // Fetch AI results
    try {
        const response = await fetch('/.netlify/functions/process-weblink', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: searchTerm }),
            signal: signal
        });

        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }

        if (signal.aborted) return;

        const aiData = await response.json();
        log('Presentation', 'AI Search Response:', aiData);

        // Remove loading indicator
        aiLoadingSection.remove();

        // Handle relatedKeywords for refinement chips
        if (aiData.relatedKeywords && Array.isArray(aiData.relatedKeywords)) {
            renderPresentationRefinementChips(aiData.relatedKeywords);
        }

        // Create AI records from the response
        const aiRecords = [];
        const timestamp = Date.now();

        /**
         * Helper function to build a comprehensive AI record with all business details
         * Matches the format used in events.js for catalog search AI results
         */
        const buildAIRecord = (source, recordId, searchTermForTags) => {
            // Build comprehensive Rankings JSON with AI profile scores
            const rankingsData = {
                "profileSource": "ai_presentation_search",
                "Tags": [searchTermForTags.toLowerCase(), "ai-generated", "partner activity"]
            };
            // Add activity profile scores if provided by AI
            const sourceRankings = source.Rankings || source.rankings;
            if (sourceRankings && typeof sourceRankings === 'object') {
                rankingsData.Fun = sourceRankings.Fun || 0;
                rankingsData.Social = sourceRankings.Social || 0;
                rankingsData.Active = sourceRankings.Active || 0;
                rankingsData.Creative = sourceRankings.Creative || 0;
                rankingsData.Learning = sourceRankings.Learning || 0;
                rankingsData.Relaxing = sourceRankings.Relaxing || 0;
            }

            // Build location details with availability and address
            let locationDetails = '';
            const location = source.Location || source.location || source.Address || source.address || '';
            const availability = source.Availability || source.availability || source.Hours || source.hours || source.OperatingHours || '';
            const phone = source.Phone || source.phone || '';
            const email = source.Email || source.email || '';

            if (location) locationDetails += location;
            if (availability) {
                locationDetails += locationDetails ? '\n\n' : '';
                locationDetails += `Hours: ${availability}`;
            }
            if (phone) {
                locationDetails += locationDetails ? '\n\n' : '';
                locationDetails += `Phone: ${phone}`;
            }
            if (email) {
                locationDetails += locationDetails ? '\n\n' : '';
                locationDetails += `Email: ${email}`;
            }

            // Build "Good to Know" / Additional Information with lead time, website, and extra info
            let additionalInfo = '';
            const leadTime = source.LeadTime || source.leadTime || '';
            const goodToKnow = source.GoodToKnow || source.goodToKnow || '';
            const website = source.Website || source.website || '';
            const duration = source.Duration || source.duration || '';
            const capacity = source.Capacity || source.capacity || '';

            if (leadTime) additionalInfo += `Booking: ${leadTime}`;
            if (duration) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += `Duration: ${duration}`;
            }
            if (capacity) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += `Capacity: ${capacity}`;
            }
            if (goodToKnow) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += goodToKnow;
            }
            if (website) {
                additionalInfo += additionalInfo ? '\n\n' : '';
                additionalInfo += `Website: ${website}`;
            }

            // Ensure price is a number - handle all edge cases including objects/arrays
            let price = source.Price || source.price || 0;
            if (typeof price === 'object') {
                // Handle cases where price might be an object or array
                price = 0;
            } else if (typeof price === 'string') {
                price = parseFloat(price.replace(/[^0-9.-]/g, '')) || 0;
            } else if (typeof price !== 'number') {
                price = 0;
            }
            // Ensure we have a valid number
            price = isNaN(price) ? 0 : price;

            return {
                id: recordId,
                fields: {
                    Name: source.Name || source.name || 'AI Suggestion',
                    Description: source.Description || source.description || '',
                    Price: price,
                    Category: source.Category || source.category || searchTermForTags,
                    'Image URL': source.imageUrl || source['Image URL'] || '',
                    ServiceType: source.ServiceType || 'Partner Activity',
                    'Item Type': 'Bookable Item',
                    Status: 'Available',
                    'Pricing Type': source.PricingType || source.pricingType || 'flat rate',
                    // Business details for modal display
                    Duration: duration || null,
                    Capacity: capacity || null,
                    'Location Details': locationDetails || null,
                    'Additional Information': additionalInfo || null,
                    // Rankings as JSON string (required by modal.js parsing)
                    Rankings: JSON.stringify(rankingsData),
                    // Keep raw fields for backwards compatibility
                    Location: location,
                    Availability: availability,
                    Website: website,
                    LeadTime: leadTime,
                    GoodToKnow: goodToKnow,
                    Phone: phone,
                    Email: email,
                    Hours: availability,
                    // AI confidence score (0.0-1.0)
                    '_aiConfidence': source.Confidence || source.confidence || null,
                    // Store website URL for image scraping (to match events.js structure)
                    '_aiWebsite': website || null,
                    // Null fields to match events.js structure
                    Options: null, 'Parent Item': null, 'Headcount min': null,
                    'Media Tags': source.ImageKeywords || source.imageKeywords || null,
                    'Curated Images': null, Subcategories: null,
                    'iCal URL': null, 'Lead Time (days)': null, RSVPs: null, Date: null,
                    'Chat Enabled': false
                },
                isAI: true
            };
        };

        if (aiData.itemType === 'Grouping' && aiData.children && Array.isArray(aiData.children)) {
            aiData.children.forEach((child, index) => {
                const childId = `ai-presentation-${timestamp}-${index}`;
                const record = buildAIRecord(child, childId, searchTerm);
                console.log('[DEBUG Presentation] Built AI record from grouping child:', {
                    id: record.id,
                    name: record.fields?.Name,
                    isAI: record.isAI,
                    _aiConfidence: record.fields?._aiConfidence,
                    sourceConfidence: child.Confidence || child.confidence
                });
                aiRecords.push(record);
            });
        } else if (aiData.Name || aiData.name) {
            // Single AI result
            const record = buildAIRecord(aiData, `ai-presentation-${timestamp}-0`, searchTerm);
            console.log('[DEBUG Presentation] Built single AI record:', {
                id: record.id,
                name: record.fields?.Name,
                isAI: record.isAI,
                _aiConfidence: record.fields?._aiConfidence,
                sourceConfidence: aiData.Confidence || aiData.confidence
            });
            aiRecords.push(record);
        }

        // Display AI results
        if (aiRecords.length > 0) {
            const aiSection = await createPresentationResultSection(
                'AI Discoveries',
                `Suggested options for "${searchTerm}"`,
                aiRecords,
                true
            );
            presentationSearchResults.appendChild(aiSection);
        }

        // Always add manual add option after AI results
        const manualAddSection = createPresentationManualAddOption(searchTerm);
        presentationSearchResults.appendChild(manualAddSection);

        // Show no results message if nothing found (but keep manual add option)
        if (catalogMatches.length === 0 && aiRecords.length === 0) {
            // Insert no results message before the manual add section
            const noResultsDiv = document.createElement('div');
            noResultsDiv.className = 'presentation-no-results';
            noResultsDiv.innerHTML = `
                <div class="presentation-no-results-icon">🔍</div>
                <p class="presentation-no-results-text">No results found for "${searchTerm}"</p>
                <p class="presentation-no-results-hint">Try a different search term, browse categories, or add a custom item below</p>
            `;
            presentationSearchResults.insertBefore(noResultsDiv, manualAddSection);
        }

    } catch (error) {
        if (error.name === 'AbortError') {
            log('Presentation', 'Search was aborted');
            return;
        }

        log('Presentation', `AI search error: ${error.message}`);
        aiLoadingSection.remove();

        // Add manual add option even on error
        const manualAddSection = createPresentationManualAddOption(searchTerm);
        presentationSearchResults.appendChild(manualAddSection);

        // Show error state if no catalog matches either (but keep manual add option)
        if (catalogMatches.length === 0) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'presentation-no-results';
            errorDiv.innerHTML = `
                <div class="presentation-no-results-icon">⚠️</div>
                <p class="presentation-no-results-text">Search encountered an issue</p>
                <p class="presentation-no-results-hint">Please try again, browse categories, or add a custom item below</p>
            `;
            presentationSearchResults.insertBefore(errorDiv, manualAddSection);
        }
    }
}

/**
 * Creates a manual add item section for the presentation search modal
 * Allows users to add a custom item with the search term as the default name
 * @param {string} searchTerm - The search term to use as default item name
 * @returns {HTMLElement} The manual add section element
 */
function createPresentationManualAddOption(searchTerm) {
    const section = document.createElement('div');
    section.className = 'presentation-manual-add-section';
    section.innerHTML = `
        <div class="presentation-manual-add-header">
            <span class="presentation-manual-add-icon">+</span>
            <span class="presentation-manual-add-title">Can't find what you're looking for?</span>
        </div>
        <div class="presentation-manual-add-content">
            <p class="presentation-manual-add-description">Add a custom item to your plan:</p>
            <div class="presentation-manual-add-form">
                <input type="text" class="presentation-manual-add-input" value="${searchTerm.replace(/"/g, '&quot;')}" placeholder="Item name">
                <button class="presentation-manual-add-btn">Add to Plan</button>
            </div>
        </div>
    `;

    // Attach click handler for the add button
    const addBtn = section.querySelector('.presentation-manual-add-btn');
    const nameInput = section.querySelector('.presentation-manual-add-input');

    addBtn.addEventListener('click', async () => {
        const itemName = nameInput.value.trim();
        if (!itemName) {
            nameInput.focus();
            return;
        }

        addBtn.disabled = true;
        addBtn.textContent = 'Adding...';

        try {
            // Create a manual item record
            const timestamp = Date.now();
            const manualId = `manual-presentation-${timestamp}`;

            const manualRecord = {
                id: manualId,
                fields: {
                    Name: itemName,
                    Description: `Manually added item from presentation search: "${searchTerm}"`,
                    Price: 0,
                    ServiceType: 'Custom Item',
                    'Item Type': 'Bookable Item',
                    Status: 'Available',
                    'Pricing Type': 'flat rate',
                    Stores: [state.ui.activeShopId],
                    Rankings: JSON.stringify({
                        "profileSource": "manual_presentation_add",
                        "Tags": [searchTerm.toLowerCase(), "manual-add", "custom"]
                    }),
                    'Location Details': null,
                    'Additional Information': null,
                    Options: null,
                    'Parent Item': null,
                    'Headcount min': null,
                    'Media Tags': null,
                    'Curated Images': null,
                    Subcategories: null,
                    'iCal URL': null,
                    'Lead Time (days)': null,
                    RSVPs: null,
                    Date: null,
                    'Chat Enabled': false,
                    Duration: null,
                    Capacity: null
                },
                isManual: true
            };

            // Add to records
            state.records.all.push(manualRecord);
            invalidateRecordsIndex();
            // Add to plan (cart.items as idea first)
            state.cart.items.set(manualId, {
                quantity: 1,
                selectedOptionIndex: 0,
                selections: {},
                note: `Manually added from presentation search: "${searchTerm}"`
            });

            // Trigger save to persist changes
            await triggerSave();

            // Update the presentation view items list
            await renderAllItems();

            // Update the catalog view's event plan panel
            await updateEventPlanSection();

            // Sync plan state across all views
            syncPlanState('presentation', 'itemAdded', { recordId: manualId, itemName: itemName });

            // Update button state
            addBtn.textContent = 'Added!';
            addBtn.classList.add('added');
            nameInput.disabled = true;

            log('Presentation', `Manually added item: ${manualId} - "${itemName}"`);

        } catch (error) {
            log('Presentation', `Error adding manual item: ${error.message}`);
            addBtn.disabled = false;
            addBtn.textContent = 'Add to Plan';
        }
    });

    // Allow Enter key to submit
    nameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addBtn.click();
        }
    });

    return section;
}

/**
 * Creates a result section with carousel
 */
async function createPresentationResultSection(title, subtitle, records, isAI = false) {
    console.log('[DEBUG Presentation] createPresentationResultSection called:', {
        title,
        isAI,
        recordCount: records.length,
        recordIds: records.map(r => r.id),
        recordsHaveIsAI: records.map(r => ({ id: r.id, isAI: r.isAI, confidence: r.fields?._aiConfidence }))
    });

    const section = document.createElement('div');
    section.className = `presentation-result-section${isAI ? ' ai-section' : ''}`;

    // Header
    const header = document.createElement('div');
    header.className = 'presentation-result-header';
    header.innerHTML = `
        <h4 class="presentation-result-title">${title}</h4>
        ${isAI ? '<span class="presentation-ai-badge">AI Discovery</span>' : ''}
        <span class="presentation-result-count">${records.length} items</span>
        ${subtitle ? `<p class="presentation-result-subtitle">${subtitle}</p>` : ''}
    `;
    section.appendChild(header);

    // Carousel wrapper
    const wrapper = document.createElement('div');
    wrapper.className = 'presentation-results-carousel-wrapper';

    // Carousel container
    const carousel = document.createElement('div');
    carousel.className = 'presentation-results-carousel';

    // Create cards for each record (await since image fetching is async)
    for (const record of records) {
        console.log('[DEBUG Presentation] Creating card for record:', { id: record.id, isAI_param: isAI, record_isAI: record.isAI });
        const card = await createPresentationResultCard(record, isAI);
        carousel.appendChild(card);
    }

    wrapper.appendChild(carousel);

    // Navigation buttons
    const leftNav = document.createElement('button');
    leftNav.className = 'presentation-carousel-nav left';
    leftNav.innerHTML = '◄';
    leftNav.setAttribute('aria-label', 'Scroll left');
    leftNav.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardWidth = carousel.querySelector('.presentation-result-card')?.offsetWidth || 240;
        carousel.scrollBy({ left: -(cardWidth + 16), behavior: 'smooth' });
    });

    const rightNav = document.createElement('button');
    rightNav.className = 'presentation-carousel-nav right';
    rightNav.innerHTML = '►';
    rightNav.setAttribute('aria-label', 'Scroll right');
    rightNav.addEventListener('click', (e) => {
        e.stopPropagation();
        const cardWidth = carousel.querySelector('.presentation-result-card')?.offsetWidth || 240;
        carousel.scrollBy({ left: cardWidth + 16, behavior: 'smooth' });
    });

    wrapper.appendChild(leftNav);
    wrapper.appendChild(rightNav);

    // Update nav visibility based on scroll
    const updateNavVisibility = () => {
        const hasOverflow = carousel.scrollWidth > carousel.clientWidth;
        if (hasOverflow) {
            wrapper.classList.add('has-overflow');
            leftNav.style.opacity = carousel.scrollLeft <= 0 ? '0.3' : '';
            leftNav.style.pointerEvents = carousel.scrollLeft <= 0 ? 'none' : '';
            const atEnd = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 5;
            rightNav.style.opacity = atEnd ? '0.3' : '';
            rightNav.style.pointerEvents = atEnd ? 'none' : '';
        } else {
            wrapper.classList.remove('has-overflow');
        }
    };

    carousel.addEventListener('scroll', updateNavVisibility);
    setTimeout(updateNavVisibility, 100);

    section.appendChild(wrapper);
    return section;
}

/**
 * Creates a single result card
 */
async function createPresentationResultCard(record, isAI = false) {
    console.log('[DEBUG Presentation] createPresentationResultCard called:', {
        recordId: record.id,
        recordName: record.fields?.Name,
        isAI_param: isAI,
        record_isAI: record.isAI,
        fields_aiConfidence: record.fields?._aiConfidence,
        record_aiConfidence: record._aiConfidence,
        researchData: record._researchData
    });

    const card = document.createElement('div');
    card.className = 'presentation-result-card';
    card.dataset.recordId = record.id;
    if (isAI) {
        card.dataset.isAi = 'true';
    }

    const fields = record.fields;

    // Get confidence level for AI items, solution items, and manual items (0.0-1.0)
    // Check multiple possible sources for confidence data
    const isSolutionItem = record.isSolution === true || record.id?.startsWith('solution-');
    const isManualItem = record.isManual === true ||
                         record.id?.startsWith('manual-add-') ||
                         record.id?.startsWith('manual-presentation-');
    const needsConfidenceStyling = isAI || isSolutionItem || isManualItem;

    let confidence;
    if (needsConfidenceStyling) {
        if (record._researchData?.confidence != null) {
            confidence = record._researchData.confidence;
        } else if (isAI) {
            confidence = record._aiConfidence ?? fields._aiConfidence ?? null;
        } else if (isSolutionItem && record.solutionData?.confidence) {
            const solutionConfidenceMap = { high: 0.85, medium: 0.6, low: 0.35 };
            confidence = solutionConfidenceMap[record.solutionData.confidence] ?? 0.6;
        } else if (isManualItem) {
            confidence = 0.5; // Manual items default to 50% (pen/approximated)
        } else {
            confidence = null;
        }
    } else {
        confidence = null;
    }

    console.log('[DEBUG Presentation] Confidence resolved for', record.id, ':', {
        confidence,
        confidenceType: typeof confidence,
        isAI,
        isSolutionItem,
        isManualItem,
        needsConfidenceStyling,
        confidenceSource: record._researchData?.confidence != null ? 'researchData' :
                         isAI ? 'aiConfidence' :
                         (isSolutionItem && record.solutionData?.confidence) ? 'solutionData' :
                         isManualItem ? 'manualDefault(0.5)' : 'null/not-styled',
        'record.isManual': record.isManual,
        'record.isSolution': record.isSolution
    });

    // Determine confidence class based on score:
    // < 50%: pencil (sketchy, draft-like)
    // 50-75%: pen (handwritten but cleaner)
    // 75-95%: typed (clean, professional)
    // 95-100%: premium (elegant typography)
    let confidenceClass = '';
    let confidenceLabel = '';
    let confidenceIndicatorClass = '';

    if (needsConfidenceStyling) {
        if (confidence === null || confidence === undefined) {
            // Unknown confidence - show as pencil (draft)
            confidenceClass = 'confidence-pencil';
            confidenceLabel = 'Draft';
            confidenceIndicatorClass = 'pencil';
        } else if (confidence < 0.5) {
            confidenceClass = 'confidence-pencil';
            confidenceLabel = `~${Math.round(confidence * 100)}%`;
            confidenceIndicatorClass = 'pencil';
        } else if (confidence < 0.75) {
            confidenceClass = 'confidence-pen';
            confidenceLabel = `~${Math.round(confidence * 100)}%`;
            confidenceIndicatorClass = 'pen';
        } else if (confidence < 0.95) {
            confidenceClass = 'confidence-typed';
            confidenceLabel = `${Math.round(confidence * 100)}%`;
            confidenceIndicatorClass = 'typed';
        } else {
            confidenceClass = 'confidence-premium';
            confidenceLabel = `${Math.round(confidence * 100)}%`;
            confidenceIndicatorClass = 'premium';
        }
        card.classList.add(confidenceClass);
        console.log('[DEBUG Presentation] Applied confidence class to card:', {
            recordId: record.id,
            confidenceClass,
            confidenceLabel,
            confidenceIndicatorClass,
            cardClassList: card.className
        });
    }

    // Fetch image using the multi-tier approach (website scraping, logo, etc.)
    let imageUrl = '';
    let imageSource = null; // Track where the image came from for AI indicator
    try {
        console.log('[AI IMAGE DEBUG] About to fetch images for record:', {
            recordId: record.id,
            isAI: isAI,
            recordFields: Object.keys(record.fields || {})
        });
        const { imageUrls, status } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        console.log('[AI IMAGE DEBUG] fetchImagesForRecord returned:', {
            recordId: record.id,
            imageUrlsCount: imageUrls?.length,
            status: status,
            firstImageUrl: imageUrls?.[0]?.substring(0, 80)
        });
        if (imageUrls && imageUrls.length > 0) {
            imageUrl = imageUrls[0];
            imageSource = status; // 'ai_approximation', 'placeholder', 'website', 'curated', 'media_tags', etc.
        }
    } catch (e) {
        console.warn('Failed to fetch image for presentation card:', record.id, e);
    }

    // ============================================================
    // AUTO AI IMAGE GENERATION: For AI discovery items with only placeholder/approximation images
    // ============================================================
    if (!window._aiImageGenerationAttempted) {
        window._aiImageGenerationAttempted = new Set();
    }
    if (!window._aiImageGenerationInProgress) {
        window._aiImageGenerationInProgress = new Set();
    }
    // Limit concurrent AI image generations to avoid overwhelming the API
    if (!window._aiImageGenerationQueue) {
        window._aiImageGenerationQueue = [];
        window._aiImageGenerationActive = 0;
    }
    const MAX_CONCURRENT_AI_IMAGES = 2;

    const isAIDiscoveryItem = record.id?.startsWith('ai-search-') ||
                               record.id?.startsWith('ai-child-') ||
                               record.id?.startsWith('ai-presentation-');
    const hasOnlyPlaceholderImage = imageSource === 'ai_approximation' || imageSource === 'placeholder' || imageSource === 'using_placeholder';
    const hasNoCustomImagesForGen = !record.fields?._customImages || record.fields._customImages.length === 0;
    const genAlreadyAttempted = window._aiImageGenerationAttempted.has(record.id);
    const genInProgress = window._aiImageGenerationInProgress.has(record.id);

    if (isAIDiscoveryItem && hasOnlyPlaceholderImage && hasNoCustomImagesForGen && !genAlreadyAttempted && !genInProgress) {
        console.log('[AI IMAGE AUTO-GEN PRES] Queuing background AI image generation for:', record.fields?.Name);
        window._aiImageGenerationInProgress.add(record.id);

        const generateForCard = async () => {
            window._aiImageGenerationActive++;
            try {
                const genPayload = {
                    name: record.fields?.Name || 'Unnamed Item',
                    description: record.fields?.Description || '',
                    category: record.fields?.Category || '',
                    serviceType: record.fields?.ServiceType || record.fields?.['Service Type'] || '',
                    tags: record.fields?.['Media Tags'] || '',
                    itemId: record.id,
                    sessionId: state.session?.id || 'unsaved'
                };

                const aiResp = await fetch('/.netlify/functions/generate-ai-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(genPayload)
                });

                if (aiResp.ok) {
                    const aiResult = await aiResp.json();
                    if (aiResult.success && aiResult.imageUrl) {
                        // Store the AI image in the record so it persists
                        const aiGenImage = { url: aiResult.imageUrl, isAIGenerated: true, prompt: aiResult.prompt };
                        record.fields._customImages = [aiGenImage];
                        record.fields._hasAIGeneratedImage = true;

                        // Update state records as well
                        const stateRec = getRecordById(record.id);
                        if (stateRec) {
                            stateRec.fields._customImages = [aiGenImage];
                            stateRec.fields._hasAIGeneratedImage = true;
                        }

                        // Trigger save to persist
                        triggerSave();

                        // Update the card image in the DOM
                        const cardImageEl = card.querySelector('.presentation-result-card-image');
                        if (cardImageEl) {
                            cardImageEl.style.backgroundImage = `url('${aiResult.imageUrl}')`;
                            // Update the AI source indicator badge
                            const existingBadge = cardImageEl.querySelector('.ai-image-source');
                            if (existingBadge) {
                                existingBadge.textContent = 'AI Generated';
                                existingBadge.title = 'This image was automatically generated by AI based on the item details';
                                existingBadge.className = 'ai-image-source approximation';
                            } else {
                                const newBadge = document.createElement('span');
                                newBadge.className = 'ai-image-source approximation';
                                newBadge.textContent = 'AI Generated';
                                newBadge.title = 'This image was automatically generated by AI based on the item details';
                                cardImageEl.appendChild(newBadge);
                            }
                        }

                        console.log('[AI IMAGE AUTO-GEN PRES] SUCCESS - Updated card with AI image:', aiResult.imageUrl);
                    } else {
                        window._aiImageGenerationAttempted.add(record.id);
                    }
                } else {
                    window._aiImageGenerationAttempted.add(record.id);
                    console.warn('[AI IMAGE AUTO-GEN PRES] FAILED:', await aiResp.text());
                }
            } catch (err) {
                window._aiImageGenerationAttempted.add(record.id);
                console.warn('[AI IMAGE AUTO-GEN PRES] EXCEPTION:', err.message);
            } finally {
                window._aiImageGenerationInProgress.delete(record.id);
                window._aiImageGenerationActive--;
                // Process next item in queue
                if (window._aiImageGenerationQueue.length > 0) {
                    const next = window._aiImageGenerationQueue.shift();
                    next();
                }
            }
        };

        // Throttle: only run MAX_CONCURRENT_AI_IMAGES at once, queue the rest
        if (window._aiImageGenerationActive < MAX_CONCURRENT_AI_IMAGES) {
            generateForCard();
        } else {
            window._aiImageGenerationQueue.push(generateForCard);
        }
    }

    const name = fields.Name || 'Unnamed Item';
    // Use centralized getRecordPrice for consistent price handling across all views
    const price = getRecordPrice(record);
    const category = fields.Category || '';

    // Check if already in plan (check cart.items, cart.lockedItems, and likedItemIds)
    const isInPlan = state.cart.lockedItems.has(record.id) ||
                     state.cart.items.has(record.id) ||
                     state.session.user.likedItemIds.has(record.id);

    // Check if item has been researched (has research data with confidence)
    const hasBeenResearched = record._researchData?.confidence != null;

    // Build AI image source indicator for AI items
    let aiImageSourceHtml = '';
    // Show AI image indicator for AI records or for manual items with AI-generated images
    // Note: isManualItem is already declared above in this scope (confidence styling section)
    const hasAIGeneratedImage = record.fields?._customImages?.some(img => img.isAIGenerated === true);

    if (isAI || (isManualItem && hasAIGeneratedImage)) {
        const isAIGenerated = imageSource === 'ai_generated' || imageSource === 'mixed_ai_custom' || hasAIGeneratedImage;
        const isPolished = imageSource && imageSource !== 'ai_approximation' && imageSource !== 'placeholder' && !isAIGenerated;
        console.log('[AI IMAGE DEBUG] Building AI image source indicator:', {
            recordId: record.id,
            isAI: isAI,
            isManualItem: isManualItem,
            hasAIGeneratedImage: hasAIGeneratedImage,
            imageSource: imageSource,
            isPolished: isPolished,
            isAIGenerated: isAIGenerated,
            imageUrl: imageUrl?.substring(0, 80)
        });

        let badgeText, badgeTitle;
        if (isAIGenerated) {
            badgeText = 'AI Generated';
            badgeTitle = 'This image was automatically generated by AI based on the item details';
        } else if (isPolished) {
            badgeText = 'Verified';
            badgeTitle = `Image from: ${imageSource}`;
        } else {
            badgeText = 'AI Approx';
            badgeTitle = 'AI-approximated image - click Dig Into for better results';
        }

        aiImageSourceHtml = `
            <span class="ai-image-source ${isPolished ? 'polished' : 'approximation'}"
                  title="${badgeTitle}">
                ${badgeText}
            </span>
        `;
        console.log('[AI IMAGE DEBUG] Built aiImageSourceHtml:', aiImageSourceHtml.trim());
    } else {
        console.log('[AI IMAGE DEBUG] NOT building AI image indicator because isAI is false:', {
            recordId: record.id,
            isAI: isAI
        });
    }

    // Confidence is now communicated purely through visual styling of the card
    // (font, color, background, borders) — no text label badge needed
    let confidenceStyleTextHtml = '';
    if (isAI) {
        console.log('[DEBUG Presentation] Confidence tier for', record.id, ':', confidenceIndicatorClass, '- expressed via card styling');
    }

    // Build dig button or accuracy badge HTML for AI items
    let digButtonHtml = '';
    if (isAI) {
        if (hasBeenResearched) {
            // Show accuracy badge for researched items
            const accuracyPercent = Math.round(record._researchData.confidence * 100);
            const accuracyLevel = accuracyPercent >= 80 ? 'high' : accuracyPercent >= 50 ? 'medium' : 'low';
            digButtonHtml = `
                <span class="presentation-accuracy-badge ${accuracyLevel}" title="Research accuracy: ${accuracyPercent}%">
                    ✓ ${accuracyPercent}%
                </span>
            `;
            console.log('[DEBUG Presentation] Built accuracy badge for researched item', record.id);
        } else {
            // Show dig button for unresearched AI items
            digButtonHtml = `
                <button class="presentation-dig-btn" data-record-id="${record.id}" title="Research this item to improve accuracy">
                    <span class="dig-icon">🔍</span> Dig Into
                </button>
            `;
            console.log('[DEBUG Presentation] Built dig button for AI item', record.id);
        }
    } else {
        console.log('[DEBUG Presentation] NOT building dig button for', record.id, '- isAI:', isAI);
    }

    card.innerHTML = `
        ${confidenceStyleTextHtml}
        <div class="presentation-result-card-image${isAI ? ' ai-item' : ''}" style="${imageUrl ? `background-image: url('${imageUrl}')` : ''}">
            ${aiImageSourceHtml}
        </div>
        <div class="presentation-result-card-content">
            <h5 class="presentation-result-card-name">${name}</h5>
            <div class="presentation-result-card-meta">
                <span class="presentation-result-card-price${isAI ? ' estimate' : ''}">
                    ${price > 0 ? `$${price.toFixed(2)}${isAI ? ' (Est.)' : ''}` : 'Price varies'}
                </span>
                ${category ? `<span class="presentation-result-card-category">${category}</span>` : ''}
            </div>
            <button class="presentation-quick-add-btn${isInPlan ? ' added' : ''}" data-record-id="${record.id}">
                ${isInPlan ? '✓ Added' : '+ Quick Add'}
            </button>
        </div>
        ${digButtonHtml}
    `;

    // Click on card (not button) opens detail modal
    card.addEventListener('click', (e) => {
        if (e.target.closest('.presentation-quick-add-btn') || e.target.closest('.presentation-dig-btn')) return;
        handleCardClick(record, isAI);
    });

    // Quick add button handler
    const quickAddBtn = card.querySelector('.presentation-quick-add-btn');
    quickAddBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleQuickAdd(record, quickAddBtn, isAI);
    });

    // Dig Into button handler for AI items
    const digBtn = card.querySelector('.presentation-dig-btn');
    if (digBtn) {
        digBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await handleDigInto(record, digBtn, card);
        });
    }

    return card;
}

/**
 * Handles clicking on a result card to show detail modal
 */
function handleCardClick(record, isAI) {
    log('Presentation', `Card clicked: ${record.fields.Name}, isAI: ${isAI}`);

    if (isAI) {
        // For AI items, create a temporary record in state for the modal to use
        const existingIndex = state.records.all.findIndex(r => r.id === record.id);
        if (existingIndex === -1) {
            state.records.all.push(record);
            invalidateRecordsIndex();
        }
    }

    // Close search modal and show detail modal
    closeSearchModal();
    showDetailModal(record);
}

/**
 * Handles quick add button click
 */
async function handleQuickAdd(record, button, isAI) {
    if (button.classList.contains('added')) return;

    log('Presentation', `Quick adding: ${record.fields.Name}`);

    button.disabled = true;
    button.textContent = 'Adding...';

    try {
        if (isAI) {
            // For AI items, we need to create a proper record first
            const existingIndex = state.records.all.findIndex(r => r.id === record.id);
            if (existingIndex === -1) {
                state.records.all.push(record);
                invalidateRecordsIndex();
            }
        }

        // Add to cart.items (ideas list) so it appears in presentation view and catalog event plan panel
        if (!state.cart.items.has(record.id) && !state.cart.lockedItems.has(record.id)) {
            const itemInfo = {
                quantity: 1,
                selectedOptionIndex: 0,
                selections: {},
                note: ''
            };
            state.cart.items.set(record.id, itemInfo);
            log('Presentation', `Added ${record.fields.Name} to cart.items (ideas)`);
        }

        // Also add to liked items for authenticated users (persists across sessions)
        if (state.session.user.isAuthenticated && !state.session.user.likedItemIds.has(record.id)) {
            state.session.user.likedItemIds.add(record.id);
        }

        // Trigger save to persist changes
        await triggerSave();

        // Update the presentation view items list in real-time
        await renderAllItems();

        // Update the catalog view's event plan panel and ideas carousel
        await updateEventPlanSection();
        await updateIdeasCarousel();

        // Sync plan state across all views
        syncPlanState('presentation', 'itemAdded', { recordId: record.id, itemName: record.fields.Name });

        // Update button state
        button.classList.add('added');
        button.textContent = '✓ Added';
        button.disabled = false;

        log('Presentation', `Successfully added ${record.fields.Name} to plan`);

    } catch (error) {
        log('Presentation', `Error adding item: ${error.message}`);
        button.disabled = false;
        button.textContent = '+ Quick Add';
    }
}

/**
 * Handles "Dig Into" button click for AI items to research and improve accuracy
 */
async function handleDigInto(record, button, card) {
    log('Presentation', `Digging into AI item: ${record.fields.Name}`);

    // Update button to show loading state
    const originalContent = button.innerHTML;
    button.innerHTML = '<span class="dig-icon">⏳</span> Researching...';
    button.classList.add('researching');
    button.disabled = true;

    try {
        // Prepare the solution data for research
        const solutionData = {
            name: record.fields.Name || 'Unknown Item',
            description: record.fields.Description || '',
            category: record.fields.Category || '',
            price: record.fields.Price || null
        };

        // Call the API to research the item
        const result = await api.digSolutionDetails({
            fields: solutionData,
            id: record.id
        });

        if (!result.success) {
            throw new Error(result.error || 'Failed to research item');
        }

        const research = result.research;
        log('Presentation', `Successfully researched ${record.fields.Name} with confidence ${research.confidence}`);

        // Update the record with research data
        record._researchData = research;
        record._aiConfidence = research.confidence;

        // Update fields with researched information
        if (research.name) record.fields.Name = research.name;
        if (research.description) record.fields.Description = research.description;
        if (research.price?.estimate) record.fields.Price = research.price.estimate;
        if (research.price?.pricingType) record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE] = research.price.pricingType;

        // Add location details
        if (research.location?.serviceArea) {
            record.fields['Location Details'] = research.location.serviceArea;
            if (research.location.type) {
                record.fields['Location Details'] += ` (${research.location.type} service)`;
            }
        }

        // Add rankings
        if (research.rankings) {
            const rankingsData = {
                profileSource: 'ai_presentation_research',
                Fun: research.rankings.Fun || 0,
                Social: research.rankings.Social || 0,
                Active: research.rankings.Active || 0,
                Creative: research.rankings.Creative || 0,
                Learning: research.rankings.Learning || 0,
                Relaxing: research.rankings.Relaxing || 0,
                Tags: research.imageKeywords || []
            };
            record.fields.Rankings = JSON.stringify(rankingsData);
        }

        // Add media tags for image searching
        if (research.imageKeywords && research.imageKeywords.length > 0) {
            record.fields['Media Tags'] = research.imageKeywords.join(' ');
        }

        // Update the record in state if present
        const stateIndex = state.records.all.findIndex(r => r.id === record.id);
        if (stateIndex !== -1) {
            state.records.all[stateIndex] = record;
        }

        // ============================================================
        // REFRESH IMAGE: Use improved keywords from research to find a better image
        // ============================================================
        const imageContainer = card.querySelector('.presentation-result-card-image');
        if (imageContainer) {
            console.log('[DEBUG Presentation] Refreshing image after dig research for:', record.id);

            // Clear the image cache for this record so we get fresh results
            // Note: api.fetchImagesForRecord uses an internal cache, so we need to re-fetch
            try {
                // Update record confidence so the placeholder reflects new confidence level
                record._aiConfidence = research.confidence;
                record.fields._aiConfidence = research.confidence;

                // Fetch new image with updated keywords/confidence
                const { imageUrls, status } = await api.fetchImagesForRecord(record, state.records.all, new Map());

                if (imageUrls && imageUrls.length > 0) {
                    const newImageUrl = imageUrls[0];
                    imageContainer.style.backgroundImage = `url('${newImageUrl}')`;

                    // Update or add the image source indicator
                    let sourceIndicator = imageContainer.querySelector('.ai-image-source');
                    if (!sourceIndicator) {
                        sourceIndicator = document.createElement('span');
                        sourceIndicator.className = 'ai-image-source';
                        imageContainer.appendChild(sourceIndicator);
                    }

                    // Update source indicator based on where image came from
                    const isAIGenerated = status === 'ai_generated' || status === 'mixed_ai_custom';
                    const isPolished = status !== 'ai_approximation' && status !== 'placeholder' && !isAIGenerated;
                    sourceIndicator.className = `ai-image-source ${isPolished ? 'polished' : 'approximation'}`;

                    if (isAIGenerated) {
                        sourceIndicator.textContent = 'AI Generated';
                        sourceIndicator.title = 'This image was automatically generated by AI based on the item details';
                    } else if (isPolished) {
                        sourceIndicator.textContent = 'Verified';
                        sourceIndicator.title = `Image from: ${status}`;
                    } else {
                        sourceIndicator.textContent = 'AI Approx';
                        sourceIndicator.title = 'AI-approximated image - click Dig Into for better results';
                    }

                    console.log('[DEBUG Presentation] Image refreshed after dig:', {
                        recordId: record.id,
                        imageSource: status,
                        isPolished
                    });

                    // If still just a placeholder after research, trigger AI image generation
                    if ((status === 'ai_approximation' || status === 'placeholder' || status === 'using_placeholder') &&
                        !window._aiImageGenerationAttempted?.has(record.id) &&
                        !window._aiImageGenerationInProgress?.has(record.id)) {
                        console.log('[AI IMAGE AUTO-GEN DIG] Generating AI image after dig research for:', record.fields?.Name);
                        if (!window._aiImageGenerationInProgress) window._aiImageGenerationInProgress = new Set();
                        window._aiImageGenerationInProgress.add(record.id);

                        try {
                            const digGenPayload = {
                                name: record.fields?.Name || 'Unnamed Item',
                                description: record.fields?.Description || '',
                                category: record.fields?.Category || '',
                                serviceType: record.fields?.ServiceType || record.fields?.['Service Type'] || '',
                                tags: record.fields?.['Media Tags'] || '',
                                itemId: record.id,
                                sessionId: state.session?.id || 'unsaved'
                            };

                            const digAiResp = await fetch('/.netlify/functions/generate-ai-image', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(digGenPayload)
                            });

                            if (digAiResp.ok) {
                                const digAiResult = await digAiResp.json();
                                if (digAiResult.success && digAiResult.imageUrl) {
                                    const digAiImg = { url: digAiResult.imageUrl, isAIGenerated: true, prompt: digAiResult.prompt };
                                    record.fields._customImages = [digAiImg];
                                    record.fields._hasAIGeneratedImage = true;
                                    const digStateRec = getRecordById(record.id);
                                    if (digStateRec) {
                                        digStateRec.fields._customImages = [digAiImg];
                                        digStateRec.fields._hasAIGeneratedImage = true;
                                    }
                                    triggerSave();

                                    imageContainer.style.backgroundImage = `url('${digAiResult.imageUrl}')`;
                                    if (sourceIndicator) {
                                        sourceIndicator.textContent = 'AI Generated';
                                        sourceIndicator.title = 'This image was automatically generated by AI based on the item details';
                                        sourceIndicator.className = 'ai-image-source approximation';
                                    }
                                    console.log('[AI IMAGE AUTO-GEN DIG] SUCCESS:', digAiResult.imageUrl);
                                } else {
                                    window._aiImageGenerationAttempted?.add(record.id);
                                }
                            } else {
                                window._aiImageGenerationAttempted?.add(record.id);
                            }
                        } catch (digGenErr) {
                            window._aiImageGenerationAttempted?.add(record.id);
                            console.warn('[AI IMAGE AUTO-GEN DIG] EXCEPTION:', digGenErr.message);
                        } finally {
                            window._aiImageGenerationInProgress?.delete(record.id);
                        }
                    }
                }
            } catch (imgError) {
                console.warn('[DEBUG Presentation] Failed to refresh image after dig:', imgError);
            }
        }

        // Determine new confidence class
        const confidence = research.confidence;
        let newConfidenceClass = '';
        let newConfidenceIndicatorClass = '';
        let newConfidenceLabel = '';

        if (confidence < 0.5) {
            newConfidenceClass = 'confidence-pencil';
            newConfidenceIndicatorClass = 'pencil';
            newConfidenceLabel = `~${Math.round(confidence * 100)}%`;
        } else if (confidence < 0.75) {
            newConfidenceClass = 'confidence-pen';
            newConfidenceIndicatorClass = 'pen';
            newConfidenceLabel = `~${Math.round(confidence * 100)}%`;
        } else if (confidence < 0.95) {
            newConfidenceClass = 'confidence-typed';
            newConfidenceIndicatorClass = 'typed';
            newConfidenceLabel = `${Math.round(confidence * 100)}%`;
        } else {
            newConfidenceClass = 'confidence-premium';
            newConfidenceIndicatorClass = 'premium';
            newConfidenceLabel = `${Math.round(confidence * 100)}%`;
        }

        // Remove old confidence classes and add new one
        card.classList.remove('confidence-pencil', 'confidence-pen', 'confidence-typed', 'confidence-premium');
        card.classList.add(newConfidenceClass);

        // Update confidence style text element
        const confidenceStyleText = card.querySelector('.confidence-style-text');
        if (confidenceStyleText) {
            // Generate new style text
            let newStyleText;
            if (newConfidenceIndicatorClass === 'pencil') {
                newStyleText = `Pencil (~${Math.round(confidence * 100)}%)`;
            } else if (newConfidenceIndicatorClass === 'pen') {
                newStyleText = `Pen (~${Math.round(confidence * 100)}%)`;
            } else if (newConfidenceIndicatorClass === 'typed') {
                newStyleText = `Typed (${Math.round(confidence * 100)}%)`;
            } else {
                newStyleText = `Premium (${Math.round(confidence * 100)}%)`;
            }

            confidenceStyleText.className = `confidence-style-text confidence-style-${newConfidenceIndicatorClass}`;
            confidenceStyleText.title = `Confidence level: ${newConfidenceLabel}`;
            confidenceStyleText.textContent = newStyleText;
            console.log('[DEBUG Presentation] Updated confidence style text after dig:', newStyleText);
        }

        // Legacy: Update confidence indicator if still present
        const confidenceIndicator = card.querySelector('.confidence-indicator');
        if (confidenceIndicator) {
            confidenceIndicator.className = `confidence-indicator ${newConfidenceIndicatorClass}`;
            confidenceIndicator.title = `Confidence: ${newConfidenceLabel}`;
            confidenceIndicator.innerHTML = `
                ${newConfidenceIndicatorClass === 'pencil' ? '✏️' : newConfidenceIndicatorClass === 'pen' ? '🖊️' : newConfidenceIndicatorClass === 'typed' ? '⌨️' : '✨'}
                ${newConfidenceLabel}
            `;
        }

        // Update the name in the card if it changed
        const nameEl = card.querySelector('.presentation-result-card-name');
        if (nameEl && research.name) {
            nameEl.textContent = research.name;
        }

        // Update the price in the card if it changed
        const priceEl = card.querySelector('.presentation-result-card-price');
        if (priceEl && research.price?.estimate) {
            priceEl.textContent = `$${research.price.estimate.toFixed(2)} (Est.)`;
        }

        // Replace dig button with accuracy badge
        const accuracyPercent = Math.round(confidence * 100);
        const accuracyLevel = accuracyPercent >= 80 ? 'high' : accuracyPercent >= 50 ? 'medium' : 'low';
        button.outerHTML = `
            <span class="presentation-accuracy-badge ${accuracyLevel}" title="Research accuracy: ${accuracyPercent}%">
                ✓ ${accuracyPercent}%
            </span>
        `;

        // Show success toast
        showToast(`Research complete! Accuracy: ${accuracyPercent}%`);

        // Trigger save to persist the research data
        triggerSave();

        log('Presentation', `Dig Into complete for ${record.fields.Name}, new confidence: ${confidence}`);

    } catch (error) {
        console.error('Error researching AI item:', error);
        log('Presentation', `Error digging into item: ${error.message}`);

        // Restore button
        button.innerHTML = originalContent;
        button.classList.remove('researching');
        button.disabled = false;

        // Show error toast
        showToast('Failed to research item. Try again.');
    }
}

/**
 * Renders refinement chips for AI suggestions
 */
function renderPresentationRefinementChips(keywords) {
    if (!presentationRefinementChips || !keywords || keywords.length === 0) return;

    presentationRefinementChips.innerHTML = '';

    keywords.slice(0, 6).forEach(keyword => {
        const chip = document.createElement('button');
        chip.className = 'presentation-refinement-chip';
        chip.textContent = keyword;
        chip.title = `Search for "${keyword}"`;

        chip.addEventListener('click', () => {
            presentationSearchInput.value = keyword;
            handleSearchInput({ target: presentationSearchInput });
        });

        presentationRefinementChips.appendChild(chip);
    });
}

/**
 * Clears refinement chips
 */
function clearPresentationRefinementChips() {
    if (presentationRefinementChips) {
        presentationRefinementChips.innerHTML = '';
    }
}

// Export the search modal functions for external use if needed
export { openSearchModal as openPresentationSearchModal, closeSearchModal as closePresentationSearchModal };
