import { state, setState } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, EMOJI_REACTIONS, EMOJI_CATEGORIES, REACTION_SCORES, getModalZIndex } from '../config.js';
import { updateUrl, getRecordPrice, parseOptions, flattenOptionGroups } from '../utils.js';
import { log } from '../utils/debug.js';
import { getCurrentUser, sendMessage as sendChatMessage, getReplyingToMessage, clearReplyState } from '../chat.js';
import { triggerSave } from '../events.js';
import { showDetailModal, showCheckoutModal, getShopSettings } from './modal.js';
import { Shader } from '../utils/shader.js';
import { showWtfPlansPanel } from './wtfPlansPanel.js';
import { updateEventPlanSection, updateIdeasCarousel } from './sidebar.js';
import { syncPlanState, registerSyncCallback, unregisterSyncCallback } from '../utils/planStateSync.js';
import { showUserModal } from '../auth.js';
import { showToast } from '../ui.js';
import { applyCloudinaryTransform } from '../utils/imageOptimizer.js';
import { refreshForumData, onNewItemReceived } from './forumPanel.js';

console.log('[Presentation DEBUG] presentation.js module loaded');
console.log('[Presentation DEBUG] QUICK_REACTIONS available:', ['👍', '❤️', '😂', '😮', '😢', '🎉']);
console.log('[Presentation DEBUG] EMOJI_CATEGORIES imported:', EMOJI_CATEGORIES ? 'yes' : 'no');
console.log('[Presentation DEBUG] EMOJI_REACTIONS imported:', EMOJI_REACTIONS);

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
    // console.log('[Presentation DEBUG] Received sync update:', changeType, changeData);

    switch (changeType) {
        case 'itemAdded':
        case 'itemRemoved':
        case 'itemUpdated':
            // Re-render the items list
            await renderAllItems();
            generateItemsSummary();
            // Update running total in header
            updatePresentationHeaderTotal();
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
            break;
        default:
            // console.log('[Presentation DEBUG] Unknown sync change type:', changeType);
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
let dragBucketDemote = null;
let dragBucketArchive = null;
let dragBucketDelete = null;
// Right side buckets (reactions/comments)
let dragBucketReactions = null;
let dragBucketQuickComment = null;
let dragBucketCustomComment = null;
let dragBucketCompleted = null;
// Merge indicator
let dragMergeIndicator = null;
// Action tooltip
let dragActionTooltip = null;
let currentHoveredAction = null;
// Drag state
let isDragging = false;
let dragDelayTimer = null;
let currentDraggedItem = null;
let currentDraggedRecordId = null;
let hoveredReactionEmoji = null;
let hoveredQuickComment = null;
let potentialMergeTarget = null;
const DRAG_DELAY_MS = 300; // Delay before drag buckets appear (ms)

// Radial menu state
let radialMenuContainer = null;
let radialMenuActive = false;
let radialMenuOrigin = { x: 0, y: 0 }; // The initial touch/click point
let initialTouchPoint = null; // Track initial touch for direction detection
let directionDetected = false; // Whether we've determined horizontal vs vertical
const DIRECTION_THRESHOLD = 15; // Pixels of movement before deciding direction
const RADIAL_MENU_RADIUS = 100; // Distance from center to buckets (desktop)
const RADIAL_MENU_RADIUS_MOBILE = 80; // Distance from center to buckets (mobile)

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
    // console.log('[Accordion DEBUG] ensureDOMElements called, modal already set:', !!modal);
    if (modal) return true; // Already initialized

    modal = document.getElementById('presentation-modal-overlay');
    closeBtn = document.getElementById('presentation-close-btn');
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
        console.log('[Presentation DEBUG] Moving drag buckets to body for proper fixed positioning');
        document.body.appendChild(dragBucketsEl);
    }

    // Left side buckets (actions)
    dragBucketGoal = document.getElementById('drag-bucket-goal');
    dragBucketIdeas = document.getElementById('drag-bucket-ideas');
    dragBucketLock = document.getElementById('drag-bucket-lock');
    dragBucketDemote = document.getElementById('drag-bucket-demote');
    dragBucketArchive = document.getElementById('drag-bucket-archive');
    dragBucketDelete = document.getElementById('drag-bucket-delete');
    // Right side buckets (reactions/comments)
    dragBucketReactions = document.getElementById('drag-bucket-reactions');
    dragBucketQuickComment = document.getElementById('drag-bucket-quick-comment');
    dragBucketCustomComment = document.getElementById('drag-bucket-custom-comment');
    dragBucketCompleted = document.getElementById('drag-bucket-completed');
    // Merge indicator
    dragMergeIndicator = document.getElementById('drag-merge-indicator');
    // Action tooltip
    dragActionTooltip = document.getElementById('drag-action-tooltip');
    // Radial menu container
    radialMenuContainer = document.getElementById('radial-menu-container');
    console.log('[Presentation DEBUG] Bucket elements found:', {
        dragBucketsEl: !!dragBucketsEl,
        dragBucketGoal: !!dragBucketGoal,
        dragBucketIdeas: !!dragBucketIdeas,
        dragBucketLock: !!dragBucketLock,
        dragBucketDemote: !!dragBucketDemote,
        dragBucketArchive: !!dragBucketArchive,
        dragBucketDelete: !!dragBucketDelete,
        dragBucketReactions: !!dragBucketReactions,
        dragBucketQuickComment: !!dragBucketQuickComment,
        dragBucketCustomComment: !!dragBucketCustomComment,
        dragBucketCompleted: !!dragBucketCompleted,
        dragMergeIndicator: !!dragMergeIndicator
    });

    // DEBUG: Log initial styling of drag buckets container
    if (dragBucketsEl) {
        const style = window.getComputedStyle(dragBucketsEl);
        console.log('[Presentation DEBUG] Initial drag buckets container styling:', {
            display: style.display,
            visibility: style.visibility,
            opacity: style.opacity,
            position: style.position,
            zIndex: style.zIndex,
            pointerEvents: style.pointerEvents
        });

        // Check for left/right zones
        const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
        const rightZone = dragBucketsEl.querySelector('.drag-zone-right');
        console.log('[Presentation DEBUG] Drag zones found:', {
            leftZone: !!leftZone,
            rightZone: !!rightZone,
            leftZoneChildren: leftZone ? leftZone.children.length : 0,
            rightZoneChildren: rightZone ? rightZone.children.length : 0
        });
    }

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
        const record = state.records.all.find(r => r.id === recordId);
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
        eventRecord = state.records.all.find(r => r.id === eventIdFromUrl);
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
                eventRecord = state.records.all.find(r => r.id === linkedItemId);
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
            const stateRecord = state.records.all.find(r => r.id === recordId);
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
        // Update tooltip with ranking info
        const tooltip = getItemRankingTooltip(recordId);
        if (tooltip) {
            emojiIndicator.title = tooltip;
        }
    } else {
        emojiIndicator.innerHTML = '';
        emojiIndicator.style.display = 'none';
        emojiIndicator.classList.remove('has-reactions');
        emojiIndicator.removeAttribute('title');
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
        const record = state.records.all.find(r => r.id === item.recordId);
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
            <div class="reaction-summary-display">${summaryHTML || 'No reactions yet'}</div>
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
    const record = state.records.all.find(r => r.id === recordId);

    if (!record) {
        return '';
    }

    const itemInfo = type === 'favorites' ? state.cart.items.get(recordId) : state.cart.lockedItems.get(recordId);
    const name = record.fields.Name || 'Untitled Item';
    // Use selections if available, fall back to selectedOptionIndex for legacy
    const selectionsOrIndex = itemInfo?.selections || itemInfo?.selectedOptionIndex;
    const price = getRecordPrice(record, selectionsOrIndex);
    const quantity = itemInfo?.quantity || 1;
    const note = itemInfo?.note || '';

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
        : `<span class="item-emoji-indicator" data-record-id="${recordId}" style="display: none;"></span>`;

    // Task status button for this item
    const taskStatusButtonHTML = renderTaskStatusButton('item', recordId);

    // Each item is wrapped in its own section container for independent layout
    return `
        <section class="itinerary-section itinerary-item-section ${statusClass} ${goalClass}" data-section="item-${recordId}" data-item-status="${itemStatus}" data-is-goal="${isGoal}">
            <article class="itinerary-item item-accordion expanded" data-record-id="${recordId}" data-index="${index}" data-item-name="${escapeHtml(name)}">
                <div class="item-accordion-header" data-record-id="${recordId}">
                    <div class="item-accordion-title-row">
                        ${taskStatusButtonHTML}
                        <h3 class="item-accordion-title">${name}</h3>
                        ${emojiIndicatorHTML}
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
                            ${selectedOptionsHTML}
                            ${note ? `
                                <div class="itinerary-item-note">
                                    <strong>Note:</strong> ${note}
                                </div>
                            ` : ''}
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
                                <span class="comments-label">Comments</span>
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

async function renderAllItems() {
    const favorites = Array.from(state.cart.items.keys()).map(id => ({ recordId: id, type: 'favorites' }));
    const locked = Array.from(state.cart.lockedItems.keys()).map(id => ({ recordId: id, type: 'locked' }));
    let combinedList = [...locked, ...favorites]; // Confirmed items first, then ideas

    // Get archived and completed items sets
    const archivedItems = state.session.archivedItems || new Set();
    const completedItems = state.session.completedItems || new Set();

    // DEBUG: Log archived and completed items state
    console.log('[Presentation DEBUG] renderAllItems - archivedItems Set:', {
        exists: !!state.session.archivedItems,
        size: archivedItems.size,
        items: Array.from(archivedItems)
    });
    console.log('[Presentation DEBUG] renderAllItems - completedItems Set:', {
        exists: !!state.session.completedItems,
        size: completedItems.size,
        items: Array.from(completedItems)
    });
    console.log('[Presentation DEBUG] renderAllItems - combinedList count:', combinedList.length);

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

    // DEBUG: Log item status distribution
    const statusCounts = { active: 0, archived: 0, completed: 0 };
    combinedList.forEach(item => statusCounts[item.itemStatus]++);
    console.log('[Presentation DEBUG] Item status distribution BEFORE filter:', statusCounts);

    // Filter based on show/hide toggles
    combinedList = combinedList.filter(item => {
        if (item.itemStatus === 'archived' && !showArchivedItems) return false;
        if (item.itemStatus === 'completed' && !showCompletedItems) return false;
        return true;
    });

    // DEBUG: Log filtered list
    console.log('[Presentation DEBUG] After filter - combinedList count:', combinedList.length, 'showArchivedItems:', showArchivedItems, 'showCompletedItems:', showCompletedItems);

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

    if (combinedList.length === 0) {
        // Show recommendations when no items exist
        // All 4 pillars are shown as suggestions since there are no items
        const allCategories = ["Activities", "Food & Drink", "Venues", "Extras"];
        let emptyStateHTML = `
            <section class="itinerary-section itinerary-empty-section" data-section="empty">
                <div class="presentation-empty-state">
                    <p class="itinerary-empty-title">Start Building Your Event Plan</p>
                    <p class="itinerary-empty-subtitle">Add items from these categories to create your perfect event:</p>
                    <div class="presentation-suggestions">
        `;

        allCategories.forEach(cat => {
            const filterTag = cat.toLowerCase().replace(/\s+/g, ' ');
            emptyStateHTML += `
                <button class="filter-btn presentation-suggestion-btn" data-category-filter="${filterTag}">
                    + Add ${cat}
                </button>
            `;
        });

        emptyStateHTML += `
                    </div>
                </div>
            </section>
        `;

        itineraryItemsListEl.innerHTML = emptyStateHTML;
        return;
    }

    itineraryItemsListEl.innerHTML = '<p class="itinerary-loading">Loading items...</p>';

    // Render all items
    const itemsHTML = [];
    for (let i = 0; i < combinedList.length; i++) {
        const html = await renderItineraryItem(combinedList[i], i);
        if (html) {
            itemsHTML.push(html);
        }
    }

    itineraryItemsListEl.innerHTML = itemsHTML.join('');

    // Render reactions for each item
    combinedList.forEach(item => {
        const reactionContainer = itineraryItemsListEl.querySelector(`.itinerary-item-reactions[data-record-id="${item.recordId}"]`);
        if (reactionContainer) {
            renderReactions(item.recordId, reactionContainer);
        }
    });

    // Render the reactions summary after items
    renderReactionsSummary();

    // Update the event-level emoji indicator
    updateEventEmojiIndicator();

    // Initialize drag-and-drop functionality
    initializeItemDragDrop();

    // Initialize radial menu system
    initializeRadialMenu();
    attachRadialMenuListeners();
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
    console.log('[Presentation DEBUG] initializeItemDragDrop called, itineraryItemsListEl:', !!itineraryItemsListEl);
    if (!itineraryItemsListEl) {
        console.log('[Presentation DEBUG] No itineraryItemsListEl, exiting initializeItemDragDrop');
        return;
    }

    // Destroy existing sortable instance if exists
    if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
    }

    try {
        const Sortable = await loadSortableJS();
        console.log('[Presentation DEBUG] SortableJS loaded:', !!Sortable);

        sortableInstance = new Sortable(itineraryItemsListEl, {
            animation: 200,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            handle: '.itinerary-item-section', // Entire section is draggable
            delay: 300, // Increased delay - radial menu should activate first for quick swipes
            delayOnTouchOnly: true,
            touchStartThreshold: 20, // Require more movement before starting SortableJS drag

            onStart: function(evt) {
                console.log('[Presentation DEBUG] Drag onStart triggered');

                // If radial menu is already active, cancel the SortableJS drag
                if (radialMenuActive) {
                    console.log('[Presentation DEBUG] Radial menu is active, cancelling SortableJS drag');
                    evt.preventDefault && evt.preventDefault();
                    return false;
                }

                isDragging = true;
                // Reset debug counters
                dragMoveDebugCounter = 0;
                bucketHoverDebugCounter = 0;

                // Track the currently dragged item
                currentDraggedItem = evt.item;
                const article = evt.item.querySelector('.itinerary-item');
                currentDraggedRecordId = article?.dataset.recordId;
                console.log('[Presentation DEBUG] Dragging item:', currentDraggedRecordId);

                // DEBUG: Log initial state of drag buckets container
                console.log('[Presentation DEBUG] onStart - Initial drag bucket state:', {
                    dragBucketsElExists: !!dragBucketsEl,
                    dragBucketsId: dragBucketsEl?.id,
                    currentClasses: dragBucketsEl ? Array.from(dragBucketsEl.classList) : [],
                    bucketGoalExists: !!dragBucketGoal,
                    bucketReactionsExists: !!dragBucketReactions
                });

                // For SortableJS drag (long press/hold), show the radial menu at the item position
                // instead of the old linear buckets
                const itemRect = evt.item.getBoundingClientRect();
                const centerX = itemRect.left + itemRect.width / 2;
                const centerY = itemRect.top + itemRect.height / 2;
                showRadialMenu(centerX, centerY, evt.item);

                // Add document-level listeners to track drag position
                document.addEventListener('mousemove', handleDragMove);
                document.addEventListener('touchmove', handleDragMove, { passive: true });
            },

            onMove: function(evt) {
                // During SortableJS move, update radial menu hover state
                if (radialMenuActive) {
                    const clientX = evt.originalEvent?.touches ? evt.originalEvent.touches[0].clientX : evt.originalEvent?.clientX;
                    const clientY = evt.originalEvent?.touches ? evt.originalEvent.touches[0].clientY : evt.originalEvent?.clientY;
                    if (clientX !== undefined && clientY !== undefined) {
                        checkRadialBucketHover(clientX, clientY);
                        updateRadialDirectionIndicator(clientX, clientY);
                    }
                }
            },

            onEnd: function(evt) {
                console.log('[Presentation DEBUG] Drag onEnd triggered');
                console.log('[Presentation DEBUG] onEnd - Final drag state:', {
                    isDragging,
                    radialMenuActive,
                    hasDragActiveClass: dragBucketsEl ? dragBucketsEl.classList.contains('drag-active') : false,
                    dragMoveEvents: dragMoveDebugCounter,
                    bucketHoverChecks: bucketHoverDebugCounter
                });
                isDragging = false;
                clearTimeout(dragDelayTimer);

                // Remove document-level listeners
                document.removeEventListener('mousemove', handleDragMove);
                document.removeEventListener('touchmove', handleDragMove);

                // Check if dropped on a radial bucket
                if (radialMenuActive) {
                    const clientX = evt.originalEvent?.changedTouches ? evt.originalEvent.changedTouches[0].clientX : evt.originalEvent?.clientX;
                    const clientY = evt.originalEvent?.changedTouches ? evt.originalEvent.changedTouches[0].clientY : evt.originalEvent?.clientY;
                    if (clientX !== undefined && clientY !== undefined) {
                        const droppedOnBucket = handleRadialBucketDrop(clientX, clientY);
                        if (droppedOnBucket) {
                            return; // Item was moved to bucket, don't update order
                        }
                    }
                    hideRadialMenu();
                } else {
                    // Legacy bucket drop check
                    const droppedOnBucket = checkBucketDrop(evt.originalEvent, evt.item);
                    console.log('[Presentation DEBUG] droppedOnBucket:', droppedOnBucket);
                    if (droppedOnBucket) {
                        hideDragBuckets();
                        return; // Item was moved to bucket, don't update order
                    }
                    hideDragBuckets();
                }

                // Update the order in state
                updateItemOrder();
            }
        });

        console.log('[Presentation DEBUG] Sortable instance created');
        log('Presentation', 'Drag-drop initialized for plan items');
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
    const leftZoneWidth = leftZoneRect.width || 120; // fallback width
    const rightZoneWidth = rightZoneRect.width || 120;

    // Determine if we're on mobile (< 768px)
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isMobile = viewportWidth < 768;

    // Gap between item and zone
    const itemZoneGap = isMobile ? 8 : 12;

    // Calculate vertical center of the item
    const itemCenterY = itemRect.top + (itemRect.height / 2);

    // Calculate left zone position - immediately to the left of the item
    let leftX = itemRect.left - leftZoneWidth - itemZoneGap;
    // Ensure it doesn't go off the left edge
    if (leftX < 4) leftX = 4;

    // Calculate right zone position - immediately to the right of the item
    let rightX = itemRect.right + itemZoneGap;
    // Ensure it doesn't go off the right edge
    if (rightX + rightZoneWidth > viewportWidth - 4) {
        rightX = viewportWidth - rightZoneWidth - 4;
    }

    // Calculate vertical position (centered on item, but constrained to viewport)
    const leftZoneHeight = leftZoneRect.height || 400;
    const rightZoneHeight = rightZoneRect.height || 300;

    let leftTop = itemCenterY - (leftZoneHeight / 2);
    let rightTop = itemCenterY - (rightZoneHeight / 2);

    // Constrain to viewport bounds with padding
    const topPadding = 60; // Leave room for header
    const bottomPadding = 20;

    if (leftTop < topPadding) leftTop = topPadding;
    if (leftTop + leftZoneHeight > viewportHeight - bottomPadding) {
        leftTop = viewportHeight - leftZoneHeight - bottomPadding;
    }

    if (rightTop < topPadding) rightTop = topPadding;
    if (rightTop + rightZoneHeight > viewportHeight - bottomPadding) {
        rightTop = viewportHeight - rightZoneHeight - bottomPadding;
    }

    // Apply positions using left/top instead of transform for precise control
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
    console.log('[Presentation DEBUG] showDragBuckets called, isDragging:', isDragging, 'dragBucketsEl:', !!dragBucketsEl);

    // Safety check: Only show drag buckets if presentation view is active
    if (!document.body.classList.contains('presentation-active')) {
        console.log('[Presentation DEBUG] showDragBuckets aborted - presentation view is not active');
        return;
    }

    if (dragBucketsEl && isDragging) {
        console.log('[Presentation DEBUG] Adding drag-active class to buckets');

        // Add drag-active class - let CSS handle the styling
        dragBucketsEl.classList.add('drag-active');

        const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
        const rightZone = dragBucketsEl.querySelector('.drag-zone-right');

        // Apply inline styles - position zones adjacent to the dragged item
        const applyZoneStyles = () => {
            // Determine if we're on mobile (< 768px)
            const viewportWidth = window.innerWidth;
            const isMobile = viewportWidth < 768;
            const bucketSize = isMobile ? '72px' : '88px';
            const zoneGap = isMobile ? 8 : 10;
            const zonePadding = isMobile ? 12 : 16;

            console.log('[Presentation DEBUG] Viewport width:', viewportWidth, 'isMobile:', isMobile);

            // Get the currently dragged item's position
            const draggedItem = document.querySelector('.sortable-drag') || currentDraggedItem;
            let itemRect = null;

            if (draggedItem) {
                itemRect = draggedItem.getBoundingClientRect();
                console.log('[Presentation DEBUG] Dragged item rect:', {
                    left: itemRect.left,
                    right: itemRect.right,
                    top: itemRect.top,
                    bottom: itemRect.bottom,
                    width: itemRect.width,
                    height: itemRect.height
                });
            }

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

            // If we have the dragged item position, position zones adjacent to it
            if (itemRect) {
                updateDragZonePositions(itemRect);
            } else {
                // Fallback: position at viewport center if item not found yet
                const viewportHeight = window.innerHeight;
                const fallbackTop = viewportHeight / 2 - 200;

                if (leftZone) {
                    leftZone.style.left = '12px';
                    leftZone.style.top = `${fallbackTop}px`;
                    leftZone.style.transform = 'none';
                }
                if (rightZone) {
                    rightZone.style.left = 'auto';
                    rightZone.style.right = '12px';
                    rightZone.style.top = `${fallbackTop}px`;
                    rightZone.style.transform = 'none';
                }
            }
        };

        // Apply immediately
        applyZoneStyles();
        console.log('[Presentation DEBUG] Zone styles applied directly');

        // Force a repaint/reflow
        void dragBucketsEl.offsetHeight;
        if (leftZone) void leftZone.offsetHeight;
        if (rightZone) void rightZone.offsetHeight;

        // Retry with requestAnimationFrame for timing issues
        requestAnimationFrame(() => {
            applyZoneStyles();
        });

        // Final fallback retry after delay
        setTimeout(() => {
            if (isDragging && dragBucketsEl?.classList.contains('drag-active')) {
                applyZoneStyles();
                console.log('[Presentation DEBUG] Zone styles re-applied via setTimeout fallback');
            }
        }, 100);

        // DEBUG: Log styling info
        setTimeout(() => {
            if (leftZone) {
                const leftRect = leftZone.getBoundingClientRect();
                console.log('[Presentation DEBUG] Left zone rect: ' +
                    Math.round(leftRect.width) + 'x' + Math.round(leftRect.height) +
                    ' at (' + Math.round(leftRect.left) + ',' + Math.round(leftRect.top) + ')');
            }
            if (rightZone) {
                const rightRect = rightZone.getBoundingClientRect();
                console.log('[Presentation DEBUG] Right zone rect: ' +
                    Math.round(rightRect.width) + 'x' + Math.round(rightRect.height) +
                    ' at (' + Math.round(rightRect.left) + ',' + Math.round(rightRect.top) + ')');
            }
        }, 50);
    }
}

// Hide drag buckets (decolorize them, but keep visible)
function hideDragBuckets() {
    console.log('[Presentation DEBUG] hideDragBuckets called, dragBucketsEl:', !!dragBucketsEl);
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
        if (dragBucketDemote) dragBucketDemote.classList.remove('drag-over');
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
        // Hide merge indicator with explicit inline style reset
        if (dragMergeIndicator) {
            dragMergeIndicator.style.display = 'none';
            dragMergeIndicator.style.visibility = 'hidden';
        }
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
}

// =============================================================================
// RADIAL MENU FUNCTIONS
// =============================================================================

// Initialize radial menu with cloned bucket elements
function initializeRadialMenu() {
    if (!radialMenuContainer || !dragBucketsEl) {
        console.log('[Radial Menu] Missing radialMenuContainer or dragBucketsEl');
        return;
    }

    // Get all buckets from left and right zones
    const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
    const rightZone = dragBucketsEl.querySelector('.drag-zone-right');

    if (!leftZone || !rightZone) {
        console.log('[Radial Menu] Missing drag zones');
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
    const bucketSize = isMobile ? 56 : 64;
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

// Show radial menu at a specific point
function showRadialMenu(x, y, itemElement) {
    if (!dragBucketsEl || !radialMenuContainer) {
        console.log('[Radial Menu] Cannot show - missing elements', { dragBucketsEl: !!dragBucketsEl, radialMenuContainer: !!radialMenuContainer });
        return;
    }

    // Safety check: Only show if presentation view is active
    if (!document.body.classList.contains('presentation-active')) {
        console.log('[Radial Menu] Aborted - presentation view is not active');
        return;
    }

    // Check if radial menu has buckets
    const bucketCount = radialMenuContainer.querySelectorAll('.drag-bucket').length;
    console.log('[Radial Menu] Bucket count in radial container:', bucketCount);

    // If no buckets, re-initialize
    if (bucketCount === 0) {
        console.log('[Radial Menu] No buckets found, re-initializing...');
        initializeRadialMenu();
    }

    // Store origin point
    radialMenuOrigin = { x, y };
    radialMenuActive = true;

    // Get viewport dimensions for boundary checks
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const isMobile = viewportWidth < 768;
    const radius = isMobile ? RADIAL_MENU_RADIUS_MOBILE : RADIAL_MENU_RADIUS;
    const margin = radius + 40; // Extra margin for buckets

    // Constrain position to keep radial menu within viewport
    let constrainedX = Math.max(margin, Math.min(viewportWidth - margin, x));
    let constrainedY = Math.max(margin + 50, Math.min(viewportHeight - margin, y)); // Extra top margin for header

    // Position radial menu container at the touch/click point
    radialMenuContainer.style.left = `${constrainedX}px`;
    radialMenuContainer.style.top = `${constrainedY}px`;

    // Show the drag buckets container in radial mode
    dragBucketsEl.classList.add('buckets-shown', 'drag-active', 'radial-mode');

    // Debug: Log computed styles after adding classes
    const computedStyle = window.getComputedStyle(dragBucketsEl);
    console.log('[Radial Menu] dragBucketsEl after adding classes:', {
        classes: Array.from(dragBucketsEl.classList),
        display: computedStyle.display,
        visibility: computedStyle.visibility,
        opacity: computedStyle.opacity,
        zIndex: computedStyle.zIndex
    });

    // Position buckets in radial layout
    positionRadialBuckets();

    // Activate the radial menu with animation
    requestAnimationFrame(() => {
        radialMenuContainer.classList.add('radial-active');

        // Debug: Log radial container state
        const containerStyle = window.getComputedStyle(radialMenuContainer);
        console.log('[Radial Menu] radialMenuContainer after radial-active:', {
            classes: Array.from(radialMenuContainer.classList),
            display: containerStyle.display,
            visibility: containerStyle.visibility,
            opacity: containerStyle.opacity,
            zIndex: containerStyle.zIndex,
            left: containerStyle.left,
            top: containerStyle.top
        });

        // Debug: Log first bucket state
        const firstBucket = radialMenuContainer.querySelector('.drag-bucket');
        if (firstBucket) {
            const bucketStyle = window.getComputedStyle(firstBucket);
            console.log('[Radial Menu] First bucket state:', {
                display: bucketStyle.display,
                visibility: bucketStyle.visibility,
                opacity: bucketStyle.opacity,
                transform: bucketStyle.transform,
                left: bucketStyle.left,
                top: bucketStyle.top,
                width: bucketStyle.width,
                height: bucketStyle.height
            });
        }
    });

    // Store the item element for later
    if (itemElement) {
        const article = itemElement.querySelector('.itinerary-item');
        currentDraggedRecordId = article?.dataset.recordId;
        currentDraggedItem = itemElement;
    }

    console.log('[Radial Menu] Shown at', constrainedX, constrainedY, 'for item:', currentDraggedRecordId);
}

// Hide radial menu
function hideRadialMenu() {
    if (!dragBucketsEl || !radialMenuContainer) return;

    radialMenuActive = false;

    // Remove radial-active first for animation
    radialMenuContainer.classList.remove('radial-active');

    // Remove radial mode classes after a short delay for animation
    setTimeout(() => {
        dragBucketsEl.classList.remove('buckets-shown', 'drag-active', 'radial-mode');
    }, 150);

    // Clear hover states on radial buckets
    const buckets = radialMenuContainer.querySelectorAll('.drag-bucket');
    buckets.forEach(b => b.classList.remove('drag-over'));

    // Reset state
    initialTouchPoint = null;
    directionDetected = false;
    hoveredReactionEmoji = null;
    hoveredQuickComment = null;

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
            // Clear sub-options
            const options = bucket.querySelectorAll('.reaction-option, .quick-comment-option');
            options.forEach(opt => opt.classList.remove('drag-over'));
        }
    });

    return hoveredBucket;
}

// Handle radial bucket selection (on release)
function handleRadialBucketDrop(clientX, clientY) {
    if (!radialMenuActive || !currentDraggedRecordId) {
        hideRadialMenu();
        return false;
    }

    const hoveredBucket = checkRadialBucketHover(clientX, clientY);

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
        case 'drag-bucket-demote':
            demoteItem(currentDraggedRecordId);
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

    console.log('[Radial Menu] Pointer down at', clientX, clientY);

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

    // If radial menu is already active, update hover state and direction indicator
    if (radialMenuActive) {
        checkRadialBucketHover(clientX, clientY);
        updateRadialDirectionIndicator(clientX, clientY);
        return;
    }

    // Calculate movement delta
    const deltaX = Math.abs(clientX - initialTouchPoint.x);
    const deltaY = Math.abs(clientY - initialTouchPoint.y);

    // Check if we've moved enough to determine direction
    if (!directionDetected && (deltaX > DIRECTION_THRESHOLD || deltaY > DIRECTION_THRESHOLD)) {
        directionDetected = true;

        if (deltaX > deltaY) {
            // Horizontal movement - show radial menu
            console.log('[Radial Menu] Horizontal swipe detected - showing radial menu');

            // Prevent default to stop scrolling
            if (event.cancelable) {
                event.preventDefault();
            }

            // Show radial menu at the initial touch point
            showRadialMenu(initialTouchPoint.x, initialTouchPoint.y, itemElement);
        } else {
            // Vertical movement - allow scrolling, cleanup handlers
            console.log('[Radial Menu] Vertical swipe detected - allowing scroll');
            cleanupRadialEventListeners();
        }
    }

    // If radial menu is active and we detected horizontal, prevent scroll
    if (radialMenuActive && event.cancelable) {
        event.preventDefault();
    }
}

function handleItemPointerUp(event) {
    const clientX = event.changedTouches ? event.changedTouches[0].clientX : event.clientX;
    const clientY = event.changedTouches ? event.changedTouches[0].clientY : event.clientY;

    console.log('[Radial Menu] Pointer up at', clientX, clientY);

    if (radialMenuActive) {
        // Check if dropped on a bucket
        handleRadialBucketDrop(clientX, clientY);
    }

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

// Attach radial menu event listeners to itinerary items
function attachRadialMenuListeners() {
    if (!itineraryItemsListEl) return;

    // Use event delegation on the items list
    itineraryItemsListEl.addEventListener('touchstart', handleRadialTouchStart, { passive: true });
    itineraryItemsListEl.addEventListener('mousedown', handleRadialMouseDown);

    console.log('[Radial Menu] Event listeners attached');
}

function handleRadialTouchStart(event) {
    const itemSection = event.target.closest('.itinerary-item-section');
    if (itemSection) {
        handleItemPointerDown(event, itemSection);
    }
}

function handleRadialMouseDown(event) {
    // Only handle left mouse button
    if (event.button !== 0) return;

    const itemSection = event.target.closest('.itinerary-item-section');
    if (itemSection) {
        handleItemPointerDown(event, itemSection);
    }
}

// =============================================================================
// END RADIAL MENU FUNCTIONS
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
    const currentTarget = document.querySelector('.itinerary-item-section.merge-target');
    if (currentTarget) {
        currentTarget.classList.remove('merge-target');
    }
    potentialMergeTarget = null;
}

// Helper to check if point is within a rect
function isPointInRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

// Check if pointer is over a bucket and update hover state
let bucketHoverDebugCounter = 0;
function checkBucketHover(event) {
    if (!dragBucketsEl || !isDragging) return;

    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const clientY = event.touches ? event.touches[0].clientY : event.clientY;

    // All buckets to check with their display info
    const buckets = [
        { el: dragBucketGoal, name: 'goal', icon: '⭐', label: 'Set as Goal' },
        { el: dragBucketIdeas, name: 'ideas', icon: '💡', label: 'Move to Ideas' },
        { el: dragBucketLock, name: 'lock', icon: '🔒', label: 'Lock Item' },
        { el: dragBucketDemote, name: 'demote', icon: '↓', label: 'Demote Item' },
        { el: dragBucketArchive, name: 'archive', icon: '📦', label: 'Archive Item' },
        { el: dragBucketDelete, name: 'delete', icon: '🗑️', label: 'Delete Item' },
        { el: dragBucketReactions, name: 'reactions', icon: '👍', label: 'Add Reaction' },
        { el: dragBucketQuickComment, name: 'quick-comment', icon: '💬', label: 'Quick Comment' },
        { el: dragBucketCustomComment, name: 'custom-comment', icon: '✏️', label: 'Add Comment' },
        { el: dragBucketCompleted, name: 'completed', icon: '✓', label: 'Mark Done' }
    ];

    let isOverAnyBucket = false;
    let hoveredBucket = null;

    // DEBUG: Log bucket positions periodically
    bucketHoverDebugCounter++;
    const shouldLogDebug = bucketHoverDebugCounter % 60 === 0;

    if (shouldLogDebug) {
        console.log('[Presentation DEBUG] checkBucketHover - Pointer at:', { clientX, clientY });
        console.log('[Presentation DEBUG] Window dimensions:', {
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight
        });
    }

    buckets.forEach((bucket) => {
        const { el, name } = bucket;
        if (el) {
            const rect = el.getBoundingClientRect();
            const isOver = isPointInRect(clientX, clientY, rect);
            el.classList.toggle('drag-over', isOver);

            // DEBUG: Log each bucket's position periodically
            if (shouldLogDebug) {
                console.log(`[Presentation DEBUG]   Bucket "${name}":`, {
                    exists: true,
                    rect: { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
                    isOver,
                    isVisible: rect.width > 0 && rect.height > 0
                });
            }

            if (isOver) {
                isOverAnyBucket = true;
                hoveredBucket = bucket;
                console.log(`[Presentation DEBUG] HOVER DETECTED on bucket: ${name}`);
                // Special handling for reaction and quick comment buckets
                if (name === 'reactions') {
                    checkReactionOptionHover(clientX, clientY);
                } else if (name === 'quick-comment') {
                    checkQuickCommentOptionHover(clientX, clientY);
                }
            }
        } else if (shouldLogDebug) {
            console.warn(`[Presentation DEBUG]   Bucket "${name}": ELEMENT NOT FOUND`);
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
            dragMergeIndicator.style.display = 'none';
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
        'action-goal', 'action-ideas', 'action-lock', 'action-demote',
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
            'action-goal', 'action-ideas', 'action-lock', 'action-demote',
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
function checkMergeTargetHover(clientX, clientY) {
    if (!itineraryItemsListEl) return;

    const items = itineraryItemsListEl.querySelectorAll('.itinerary-item-section:not(.sortable-drag)');
    let foundTarget = null;

    items.forEach(item => {
        const article = item.querySelector('.itinerary-item');
        const itemRecordId = article?.dataset.recordId;

        // Don't merge with self
        if (itemRecordId === currentDraggedRecordId) return;

        const rect = item.getBoundingClientRect();
        if (isPointInRect(clientX, clientY, rect)) {
            foundTarget = { element: item, recordId: itemRecordId };
        }
    });

    // Update merge target highlighting
    const currentTarget = document.querySelector('.itinerary-item-section.merge-target');
    if (currentTarget && (!foundTarget || currentTarget !== foundTarget.element)) {
        currentTarget.classList.remove('merge-target');
    }

    if (foundTarget) {
        foundTarget.element.classList.add('merge-target');
        potentialMergeTarget = foundTarget;

        // Show merge indicator near cursor
        if (dragMergeIndicator) {
            dragMergeIndicator.style.display = 'flex';
            dragMergeIndicator.style.left = `${clientX + 20}px`;
            dragMergeIndicator.style.top = `${clientY - 20}px`;
        }
    } else {
        potentialMergeTarget = null;
        if (dragMergeIndicator) {
            dragMergeIndicator.style.display = 'none';
        }
    }
}

// Handle mouse/touch move during drag
let dragMoveDebugCounter = 0;
function handleDragMove(event) {
    // DEBUG: Log every 30th move event to avoid console spam
    dragMoveDebugCounter++;
    if (dragMoveDebugCounter % 30 === 0) {
        const clientX = event.touches ? event.touches[0].clientX : event.clientX;
        const clientY = event.touches ? event.touches[0].clientY : event.clientY;
        console.log('[Presentation DEBUG] handleDragMove:', {
            clientX,
            clientY,
            isDragging,
            dragBucketsElExists: !!dragBucketsEl,
            hasDragActiveClass: dragBucketsEl ? dragBucketsEl.classList.contains('drag-active') : false
        });
    }

    // Update drag zone positions to follow the dragged item
    if (isDragging && dragBucketsEl?.classList.contains('drag-active')) {
        const draggedItem = document.querySelector('.sortable-drag') || currentDraggedItem;
        if (draggedItem) {
            const itemRect = draggedItem.getBoundingClientRect();
            updateDragZonePositions(itemRect);
        }
    }

    checkBucketHover(event);
}

// Check if item was dropped on a bucket
function checkBucketDrop(event, item) {
    console.log('[Presentation DEBUG] checkBucketDrop called, event:', !!event, 'item:', !!item, 'dragBucketsEl:', !!dragBucketsEl);
    if (!dragBucketsEl) return false;

    const clientX = event?.changedTouches ? event.changedTouches[0].clientX : event?.clientX;
    const clientY = event?.changedTouches ? event.changedTouches[0].clientY : event?.clientY;
    console.log('[Presentation DEBUG] Drop coordinates:', { clientX, clientY });

    // Get record ID from the dragged item
    const itemSection = item.closest('.itinerary-item-section');
    const article = itemSection?.querySelector('.itinerary-item');
    const recordId = article?.dataset.recordId;
    console.log('[Presentation DEBUG] recordId from item:', recordId);

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
        console.log('[Presentation DEBUG] Dropped on goal bucket!');
        setItemAsGoal(recordId);
        return true;
    }

    // Check ideas bucket
    if (checkDropOnBucket(dragBucketIdeas)) {
        console.log('[Presentation DEBUG] Dropped on ideas bucket!');
        moveToIdeas(recordId);
        return true;
    }

    // Check lock bucket
    if (checkDropOnBucket(dragBucketLock)) {
        console.log('[Presentation DEBUG] Dropped on lock bucket!');
        lockItem(recordId);
        return true;
    }

    // Check demote bucket
    if (checkDropOnBucket(dragBucketDemote)) {
        console.log('[Presentation DEBUG] Dropped on demote bucket!');
        demoteItem(recordId);
        return true;
    }

    // Check archive bucket
    if (checkDropOnBucket(dragBucketArchive)) {
        console.log('[Presentation DEBUG] Dropped on archive bucket!');
        archiveItem(recordId);
        return true;
    }

    // Check delete bucket
    if (checkDropOnBucket(dragBucketDelete)) {
        console.log('[Presentation DEBUG] Dropped on delete bucket!');
        deleteItem(recordId);
        return true;
    }

    // RIGHT SIDE BUCKETS (Reactions/Comments)

    // Check reactions bucket (check individual emoji options first)
    if (checkDropOnBucket(dragBucketReactions)) {
        console.log('[Presentation DEBUG] Dropped on reactions bucket!');
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
        console.log('[Presentation DEBUG] Dropped on quick comment bucket!');
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
        console.log('[Presentation DEBUG] Dropped on custom comment bucket!');
        openCustomCommentDialog(recordId);
        return true;
    }

    // Check completed bucket
    if (checkDropOnBucket(dragBucketCompleted)) {
        console.log('[Presentation DEBUG] Dropped on completed bucket!');
        completeItem(recordId);
        return true;
    }

    // Check for merge (drop on another item)
    if (potentialMergeTarget && potentialMergeTarget.recordId) {
        console.log('[Presentation DEBUG] Dropped on another item for merge!');
        openMergeDialog(recordId, potentialMergeTarget.recordId);
        return true;
    }

    return false;
}

// Archive an item
async function archiveItem(recordId) {
    console.log('[Presentation DEBUG] archiveItem called with recordId:', recordId);
    if (!recordId) return;

    // Initialize archivedItems if not exists
    if (!state.session.archivedItems) {
        console.log('[Presentation DEBUG] Initializing archivedItems Set');
        state.session.archivedItems = new Set();
    }

    // Add to archived items (item stays in its position, just changes status)
    state.session.archivedItems.add(recordId);
    console.log('[Presentation DEBUG] Added to archivedItems, new size:', state.session.archivedItems.size);

    // Get item name for toast
    const record = state.records.all.find(r => r.id === recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Show toast notification
    showToast(`"${itemName}" archived`, 'info');

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} archived`);
}

// Mark an item as completed
async function completeItem(recordId) {
    console.log('[Presentation DEBUG] completeItem called with recordId:', recordId);
    if (!recordId) return;

    // Initialize completedItems if not exists
    if (!state.session.completedItems) {
        console.log('[Presentation DEBUG] Initializing completedItems Set');
        state.session.completedItems = new Set();
    }

    // Add to completed items (item stays in its position, just changes status)
    state.session.completedItems.add(recordId);
    console.log('[Presentation DEBUG] Added to completedItems, new size:', state.session.completedItems.size);

    // Get item name for toast
    const record = state.records.all.find(r => r.id === recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

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
    console.log('[Presentation DEBUG] setItemAsGoal called with recordId:', recordId);
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
        const record = state.records.all.find(r => r.id === recordId);
        const itemName = record?.fields?.Name || 'Item';
        showToast(`"${itemName}" set as goal`, 'success');
    }

    // Re-render items
    await renderAllItems();
    generateItemsSummary();
    updatePresentationHeaderTotal();

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} goal status toggled`);
}

// Move item to Ideas bucket (from lockedItems to items)
async function moveToIdeas(recordId) {
    console.log('[Presentation DEBUG] moveToIdeas called with recordId:', recordId);
    if (!recordId) return;

    // Check if item is currently in lockedItems
    const itemInfo = state.cart.lockedItems.get(recordId);
    if (itemInfo) {
        // Move from lockedItems to items
        state.cart.lockedItems.delete(recordId);
        state.cart.items.set(recordId, itemInfo);

        // Get item name for toast
        const record = state.records.all.find(r => r.id === recordId);
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
    console.log('[Presentation DEBUG] lockItem called with recordId:', recordId);
    if (!recordId) return;

    // Check if item is in items (Ideas)
    const itemInfo = state.cart.items.get(recordId);
    if (itemInfo) {
        // Move from items to lockedItems
        state.cart.items.delete(recordId);
        state.cart.lockedItems.set(recordId, itemInfo);

        const record = state.records.all.find(r => r.id === recordId);
        const itemName = record?.fields?.Name || 'Item';
        showToast(`"${itemName}" locked in plan`, 'success');
    } else if (state.cart.lockedItems.has(recordId)) {
        showToast('Item is already locked', 'info');
    } else {
        // Item not found, add it to locked
        state.cart.lockedItems.set(recordId, { quantity: 1, selections: {} });
        const record = state.records.all.find(r => r.id === recordId);
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
    console.log('[Presentation DEBUG] demoteItem called with recordId:', recordId);
    if (!recordId) return;

    // Move from lockedItems to items if applicable
    const itemInfo = state.cart.lockedItems.get(recordId);
    if (itemInfo) {
        state.cart.lockedItems.delete(recordId);
        state.cart.items.set(recordId, itemInfo);

        const record = state.records.all.find(r => r.id === recordId);
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
    console.log('[Presentation DEBUG] deleteItem called with recordId:', recordId);
    if (!recordId) return;

    // Get item name for confirmation
    const record = state.records.all.find(r => r.id === recordId);
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

    // Save session
    triggerSave();

    log('Presentation', `Item ${recordId} deleted from plan`);
}

// Add a reaction to an item
async function addReactionToItem(recordId, emoji) {
    console.log('[Presentation DEBUG] addReactionToItem called:', recordId, emoji);
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
    const record = state.records.all.find(r => r.id === recordId);
    const itemName = record?.fields?.Name || 'Item';
    showToast(`${emoji} added to "${itemName}"`, 'success');

    // Re-render items to show updated reactions
    await renderAllItems();

    // Save session
    triggerSave();

    log('Presentation', `Reaction ${emoji} added to item ${recordId}`);
}

// Add a quick comment to an item
async function addQuickCommentToItem(recordId, comment) {
    console.log('[Presentation DEBUG] addQuickCommentToItem called:', recordId, comment);
    if (!recordId || !comment) return;

    // Use the existing comment system if available, otherwise add to notes
    const itemInfo = state.cart.lockedItems.get(recordId) || state.cart.items.get(recordId);
    if (itemInfo) {
        // Append to item notes
        const existingNote = itemInfo.note || '';
        const newNote = existingNote ? `${existingNote}\n• ${comment}` : `• ${comment}`;
        itemInfo.note = newNote;
    }

    const record = state.records.all.find(r => r.id === recordId);
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
    console.log('[Presentation DEBUG] openCustomCommentDialog called:', recordId);
    if (!recordId) return;

    const record = state.records.all.find(r => r.id === recordId);
    const itemName = record?.fields?.Name || 'Item';

    // Use prompt for simple implementation (can be enhanced with modal later)
    const comment = prompt(`Add a comment to "${itemName}":`);
    if (comment && comment.trim()) {
        await addQuickCommentToItem(recordId, comment.trim());
    }
}

// Open merge dialog for two items
async function openMergeDialog(sourceRecordId, targetRecordId) {
    console.log('[Presentation DEBUG] openMergeDialog called:', sourceRecordId, targetRecordId);
    if (!sourceRecordId || !targetRecordId) return;

    const sourceRecord = state.records.all.find(r => r.id === sourceRecordId);
    const targetRecord = state.records.all.find(r => r.id === targetRecordId);
    const sourceName = sourceRecord?.fields?.Name || 'Source item';
    const targetName = targetRecord?.fields?.Name || 'Target item';

    // Show merge options dialog
    const choice = confirm(
        `Merge Options for "${sourceName}" and "${targetName}":\n\n` +
        `Click OK to create a related category (keeps both items linked).\n` +
        `Click Cancel to cancel the merge.`
    );

    if (choice) {
        await createRelatedCategory(sourceRecordId, targetRecordId);
    }
}

// Create a related category linking two items
async function createRelatedCategory(recordId1, recordId2) {
    console.log('[Presentation DEBUG] createRelatedCategory called:', recordId1, recordId2);

    // Initialize relatedGroups if not exists
    if (!state.session.relatedGroups) {
        state.session.relatedGroups = [];
    }

    // Create a new group or add to existing group
    const existingGroup1 = state.session.relatedGroups.find(g => g.includes(recordId1));
    const existingGroup2 = state.session.relatedGroups.find(g => g.includes(recordId2));

    if (existingGroup1 && existingGroup2 && existingGroup1 === existingGroup2) {
        // Already in same group
        showToast('Items are already related', 'info');
        return;
    }

    if (existingGroup1 && existingGroup2) {
        // Merge two groups
        const mergedGroup = [...new Set([...existingGroup1, ...existingGroup2])];
        state.session.relatedGroups = state.session.relatedGroups.filter(
            g => g !== existingGroup1 && g !== existingGroup2
        );
        state.session.relatedGroups.push(mergedGroup);
    } else if (existingGroup1) {
        existingGroup1.push(recordId2);
    } else if (existingGroup2) {
        existingGroup2.push(recordId1);
    } else {
        // Create new group
        state.session.relatedGroups.push([recordId1, recordId2]);
    }

    const record1 = state.records.all.find(r => r.id === recordId1);
    const record2 = state.records.all.find(r => r.id === recordId2);
    showToast(`"${record1?.fields?.Name}" and "${record2?.fields?.Name}" are now related`, 'success');

    // Re-render items
    await renderAllItems();

    // Save session
    triggerSave();

    log('Presentation', `Created related category for ${recordId1} and ${recordId2}`);
}

// Update the status toggle buttons visibility and state
function updateStatusToggles(archivedCount, completedCount) {
    // DEBUG: Log toggle update calls
    console.log('[Presentation DEBUG] updateStatusToggles called:', {
        archivedCount,
        completedCount,
        showArchivedItems,
        showCompletedItems
    });

    const archivedToggle = document.getElementById('presentation-toggle-archived');
    const completedToggle = document.getElementById('presentation-toggle-completed');

    // DEBUG: Log toggle element existence
    console.log('[Presentation DEBUG] Toggle elements found:', {
        archivedToggle: !!archivedToggle,
        completedToggle: !!completedToggle
    });

    // Show/hide archived toggle based on whether there are archived items
    if (archivedToggle) {
        if (archivedCount > 0) {
            archivedToggle.style.display = 'inline-flex';
            archivedToggle.classList.toggle('active', showArchivedItems);
            const countEl = archivedToggle.querySelector('.toggle-count');
            if (countEl) countEl.textContent = archivedCount;
            console.log('[Presentation DEBUG] Archived toggle shown with count:', archivedCount);
        } else {
            archivedToggle.style.display = 'none';
            console.log('[Presentation DEBUG] Archived toggle hidden (count is 0)');
        }
    }

    // Show/hide completed toggle based on whether there are completed items
    if (completedToggle) {
        if (completedCount > 0) {
            completedToggle.style.display = 'inline-flex';
            completedToggle.classList.toggle('active', showCompletedItems);
            const countEl = completedToggle.querySelector('.toggle-count');
            if (countEl) countEl.textContent = completedCount;
            console.log('[Presentation DEBUG] Completed toggle shown with count:', completedCount);
        } else {
            completedToggle.style.display = 'none';
            console.log('[Presentation DEBUG] Completed toggle hidden (count is 0)');
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

    // Get all item sections in current DOM order
    const itemSections = itineraryItemsListEl.querySelectorAll('.itinerary-item-section');
    const newOrder = [];

    itemSections.forEach(section => {
        const article = section.querySelector('.itinerary-item');
        if (article && article.dataset.recordId) {
            newOrder.push(article.dataset.recordId);
        }
    });

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
 * Update all item emoji indicator tooltips with current ranking info
 */
function updateAllItemEmojiTooltips() {
    const emojiIndicators = document.querySelectorAll('.item-emoji-indicator[data-record-id]');
    emojiIndicators.forEach(indicator => {
        const recordId = indicator.dataset.recordId;
        const tooltip = getItemRankingTooltip(recordId);
        if (tooltip) {
            indicator.title = tooltip;
        } else {
            indicator.removeAttribute('title');
        }
    });
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

    console.log('[Presentation DEBUG] showTaskDetailPopup permission check:', {
        currentRole,
        isLoading,
        canEditByRole,
        canEditByOwnership,
        canUserEdit,
        sessionIsOwned: state.session.isOwned
    });

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

            // Strip out [PLAN_COMMENT:xxx] prefix from display content
            let displayContent = fields.Content || '';
            displayContent = displayContent.replace(/^\[PLAN_COMMENT:\w+\]\s*/i, '');

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

    console.log('[Presentation DEBUG] createTaskFromComment permission check:', {
        currentRole,
        isLoading,
        canEditByRole,
        canEditByOwnership,
        canUserEdit,
        permissionsState: state.permissions,
        sessionIsOwned: state.session.isOwned
    });

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
        const itemRecord = state.records.all.find(r => r.id === componentId);
        if (itemRecord) {
            const itemName = itemRecord.fields?.Name || itemRecord.fields?.['Item Name'] || 'AI Item';
            // Prefix the task name with the item name for context
            taskData.Name = `[${itemName}] ${taskData.Name}`;
            console.log('[Presentation DEBUG] Task created from AI item - storing item name in task title:', itemName);
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
        console.log('[Presentation DEBUG] Reaction button clicked!');
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
                    const componentRecord = state.records.all.find(r => r.id === componentId);
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

    presentationChatChannel.bind('pusher:member_added', () => {
        updatePresentationPresenceUI(presentationChatChannel.members);
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
                const componentRecord = state.records.all.find(r => r.id === componentId);
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
        const record = state.records.all.find(r => r.id === id);
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

    const itemElement = e.target.closest('.itinerary-item-clickable');
    if (!itemElement) return;

    const recordId = itemElement.dataset.recordId;
    if (!recordId) return;

    const record = state.records.all.find(r => r.id === recordId);
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

    const recordId = expandBtn.dataset.recordId;
    if (!recordId) return;

    const record = state.records.all.find(r => r.id === recordId);
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

    console.log('[CommentImage DEBUG] File validation passed, creating preview');

    // Show preview
    const reader = new FileReader();
    reader.onload = (event) => {
        console.log('[CommentImage DEBUG] FileReader onload triggered');
        const previewContainer = document.querySelector(`.comment-image-preview[data-component-id="${componentId}"]`);
        const thumbnail = previewContainer?.querySelector('.comment-preview-thumbnail');
        const removeBtn = previewContainer?.querySelector('.comment-preview-remove');

        console.log('[CommentImage DEBUG] previewContainer found:', !!previewContainer);
        console.log('[CommentImage DEBUG] thumbnail found:', !!thumbnail);
        console.log('[CommentImage DEBUG] removeBtn found:', !!removeBtn);

        if (previewContainer && thumbnail) {
            thumbnail.src = event.target.result;
            previewContainer.style.display = 'flex';

            console.log('[CommentImage DEBUG] Preview displayed');
            console.log('[CommentImage DEBUG] previewContainer.style.display:', previewContainer.style.display);
            console.log('[CommentImage DEBUG] previewContainer.classList:', Array.from(previewContainer.classList));
            console.log('[CommentImage DEBUG] thumbnail.naturalWidth:', thumbnail.naturalWidth);
            console.log('[CommentImage DEBUG] thumbnail.naturalHeight:', thumbnail.naturalHeight);
            console.log('[CommentImage DEBUG] thumbnail.offsetWidth:', thumbnail.offsetWidth);
            console.log('[CommentImage DEBUG] thumbnail.offsetHeight:', thumbnail.offsetHeight);
            console.log('[CommentImage DEBUG] previewContainer computed style:', window.getComputedStyle(previewContainer).cssText.substring(0, 200));
            console.log('[CommentImage DEBUG] thumbnail computed style:', window.getComputedStyle(thumbnail).cssText.substring(0, 200));
        } else {
            console.log('[CommentImage DEBUG] ❌ Could not find previewContainer or thumbnail');
        }
    };
    reader.onerror = (error) => {
        console.log('[CommentImage DEBUG] ❌ FileReader error:', error);
    };
    reader.readAsDataURL(file);
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
            const file = fileInput.files[0];

            // Convert file to base64
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

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
                const componentRecord = state.records.all.find(r => r.id === componentId);
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
            const itemRecord = state.records.all.find(r => r.id === componentId);
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
                const itemRecord = state.records.all.find(r => r.id === componentId);
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

            // Check for manual items via content prefix [PLAN_COMMENT:item:componentId]
            if (!componentId) {
                const content = comment.fields?.Content || '';
                const manualItemMatch = content.match(/^\[PLAN_COMMENT:item:(manual-presentation-\d+)\]/);
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
        console.log('[Presentation DEBUG] Permissions not loaded, fetching user role...');
        try {
            const { role, permissionRecord } = await api.fetchUserRole(state.session.id, state.session.user.id);
            setState({
                permissions: {
                    currentRole: role,
                    isLoading: false,
                    permissionRecord: permissionRecord
                }
            });
            console.log('[Presentation DEBUG] Permissions loaded:', { role, permissionRecord });
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
    // console.log('[Presentation DEBUG] Registered plan sync callback');

    // Fetch tasks for this project if not already loaded (critical for comment-task linking)
    // This ensures comment-created tasks are visible when page is refreshed or link is shared
    const projectId = state.session.id;
    if (projectId && !state.tasks.byProject.has(projectId)) {
        console.log('[Presentation DEBUG] Tasks not loaded for project, fetching...');
        try {
            const tasks = await api.fetchTasks(projectId);
            if (Array.isArray(tasks)) {
                // Update tasks.all map
                tasks.forEach(task => {
                    state.tasks.all.set(task.id, task);
                });
                // Update tasks.byProject map
                state.tasks.byProject.set(projectId, tasks);
                console.log(`[Presentation DEBUG] Loaded ${tasks.length} tasks for project ${projectId}`);

                // IMPORTANT: After tasks are loaded, restore comment-to-task links from session storage
                // This applies SourceCommentId to task objects so the UI shows linked tasks correctly
                loadCommentTaskLinks();
            }
        } catch (error) {
            console.error('[Presentation DEBUG] Error fetching tasks:', error);
            // Non-blocking - comments will still render, just without task links
        }
    } else {
        console.log('[Presentation DEBUG] Tasks already loaded for project:', projectId);
        // Even if tasks were already loaded, restore comment-to-task links
        loadCommentTaskLinks();
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

    // Initialize accordions and generate summaries
    initializeAccordions();

    // Show modal
    modal.classList.add('active');
    modal.style.display = 'flex';
    document.body.classList.add('modal-open');
    document.body.classList.add('presentation-active');
    document.documentElement.classList.add('presentation-active');
    // Remove early-loading optimization class now that presentation is properly initialized
    document.body.classList.remove('presentation-loading');
    document.documentElement.classList.remove('presentation-loading');
    document.addEventListener('keydown', handleKeyDown);

    // Show drag buckets (grayed out initially, colorize on drag)
    if (dragBucketsEl) {
        console.log('[Presentation DEBUG] Showing drag buckets (grayed out)');
        // Reset any inline styles that might have been set when hiding
        dragBucketsEl.style.display = '';
        dragBucketsEl.style.visibility = '';
        dragBucketsEl.classList.add('buckets-shown');
        // Debug: Log the bucket element state after adding class
        const computedStyle = window.getComputedStyle(dragBucketsEl);
        console.log('[Presentation DEBUG] Bucket container after adding buckets-shown:', {
            classList: Array.from(dragBucketsEl.classList),
            display: computedStyle.display,
            visibility: computedStyle.visibility,
            opacity: computedStyle.opacity,
            zIndex: computedStyle.zIndex,
            position: computedStyle.position,
            boundingRect: dragBucketsEl.getBoundingClientRect()
        });
        // Debug: Check parent element's overflow and position
        const parentEl = dragBucketsEl.parentElement;
        if (parentEl) {
            const parentStyle = window.getComputedStyle(parentEl);
            console.log('[Presentation DEBUG] Bucket parent element:', {
                id: parentEl.id,
                overflow: parentStyle.overflow,
                overflowX: parentStyle.overflowX,
                overflowY: parentStyle.overflowY,
                position: parentStyle.position,
                zIndex: parentStyle.zIndex,
                display: parentStyle.display
            });
        }

        // DEBUG: Check left and right zones with their children
        const leftZone = dragBucketsEl.querySelector('.drag-zone-left');
        const rightZone = dragBucketsEl.querySelector('.drag-zone-right');
        if (leftZone) {
            const leftStyle = window.getComputedStyle(leftZone);
            console.log('[Presentation DEBUG] Left zone at showPresentationView:', {
                display: leftStyle.display,
                visibility: leftStyle.visibility,
                opacity: leftStyle.opacity,
                position: leftStyle.position,
                left: leftStyle.left,
                top: leftStyle.top,
                transform: leftStyle.transform,
                pointerEvents: leftStyle.pointerEvents,
                childrenCount: leftZone.children.length,
                boundingRect: leftZone.getBoundingClientRect()
            });
        } else {
            console.warn('[Presentation DEBUG] Left zone NOT FOUND at showPresentationView');
        }
        if (rightZone) {
            const rightStyle = window.getComputedStyle(rightZone);
            console.log('[Presentation DEBUG] Right zone at showPresentationView:', {
                display: rightStyle.display,
                visibility: rightStyle.visibility,
                opacity: rightStyle.opacity,
                position: rightStyle.position,
                right: rightStyle.right,
                top: rightStyle.top,
                transform: rightStyle.transform,
                pointerEvents: rightStyle.pointerEvents,
                childrenCount: rightZone.children.length,
                boundingRect: rightZone.getBoundingClientRect()
            });
        } else {
            console.warn('[Presentation DEBUG] Right zone NOT FOUND at showPresentationView');
        }

        // Debug: Check individual buckets
        if (dragBucketArchive) {
            const archiveStyle = window.getComputedStyle(dragBucketArchive);
            console.log('[Presentation DEBUG] Archive bucket:', {
                display: archiveStyle.display,
                opacity: archiveStyle.opacity,
                left: archiveStyle.left,
                position: archiveStyle.position,
                boundingRect: dragBucketArchive.getBoundingClientRect()
            });
        }
        if (dragBucketCompleted) {
            const completedStyle = window.getComputedStyle(dragBucketCompleted);
            console.log('[Presentation DEBUG] Completed bucket:', {
                display: completedStyle.display,
                opacity: completedStyle.opacity,
                right: completedStyle.right,
                position: completedStyle.position,
                boundingRect: dragBucketCompleted.getBoundingClientRect()
            });
        }
        if (dragBucketReactions) {
            const reactionsStyle = window.getComputedStyle(dragBucketReactions);
            console.log('[Presentation DEBUG] Reactions bucket:', {
                display: reactionsStyle.display,
                opacity: reactionsStyle.opacity,
                right: reactionsStyle.right,
                position: reactionsStyle.position,
                boundingRect: dragBucketReactions.getBoundingClientRect()
            });
        }
    } else {
        console.log('[Presentation DEBUG] dragBucketsEl not found when opening modal');
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

    log('Presentation', 'Itinerary view rendered successfully');
}

export function hidePresentationView() {
    if (!modal) return;

    // Unregister sync callback when closing presentation view
    unregisterSyncCallback('presentation');
    // console.log('[Presentation DEBUG] Unregistered plan sync callback');

    // Stop the background animation
    stopPresentationBackgroundAnimation();

    // Hide collaborators modal if open
    hideCollaboratorsModal();

    // Cleanup drag-drop functionality
    cleanupItemDragDrop();

    // Hide drag buckets and related elements - comprehensive cleanup
    if (dragBucketsEl) {
        console.log('[Presentation DEBUG] Hiding drag buckets');
        dragBucketsEl.classList.remove('buckets-shown');
        dragBucketsEl.classList.remove('drag-active');
        dragBucketsEl.classList.remove('radial-mode'); // Remove radial mode class
        // Explicitly set visibility to ensure elements don't leak through
        dragBucketsEl.style.display = 'none';
        dragBucketsEl.style.visibility = 'hidden';
    }

    // Hide radial menu and clean up
    if (radialMenuContainer) {
        radialMenuContainer.classList.remove('radial-active');
        radialMenuActive = false;
        cleanupRadialEventListeners();
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
    modal.style.display = 'none';
    document.body.classList.remove('modal-open');
    document.body.classList.remove('presentation-active');
    document.documentElement.classList.remove('presentation-active');
    document.removeEventListener('keydown', handleKeyDown);

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
    // console.log('[Accordion DEBUG] setupPresentationEventListeners called');
    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot setup event listeners - DOM elements not available');
        // console.error('[Accordion DEBUG] ensureDOMElements failed in setupPresentationEventListeners');
        return;
    }
    // console.log('[Accordion DEBUG] ensureDOMElements succeeded in setupPresentationEventListeners');

    // Listen for user login/logout events to update the account button and collaborators
    document.addEventListener('userLoggedIn', handlePresentationUserLogin);
    document.addEventListener('userLoggedOut', updatePresentationAccountButton);

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

    // Presentation header hamburger button (opens WTF Plans panel)
    if (presentationBackBtn) {
        presentationBackBtn.addEventListener('click', () => {
            updateUrl({ view: null });
            hidePresentationView();
            // Open WTF Plans panel after closing presentation view
            showWtfPlansPanel();
        });
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

    // Handle component comments interactions
    console.log('[Events DEBUG] Adding handleComponentCommentsClick listener to itineraryItemsListEl');
    itineraryItemsListEl.addEventListener('click', handleComponentCommentsClick);
    itineraryItemsListEl.addEventListener('keydown', handleComponentCommentsKeydown);
    itineraryItemsListEl.addEventListener('change', handleCommentImageInputChange);

    // Handle task status button clicks on items
    console.log('[Events DEBUG] Adding handleTaskStatusClick listener to itineraryItemsListEl:', itineraryItemsListEl);
    itineraryItemsListEl.addEventListener('click', handleTaskStatusClick);

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

    // Collaborators add/share button - copies shareable link
    if (collaboratorsAddShareBtn) {
        collaboratorsAddShareBtn.addEventListener('click', () => {
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
                    'Pricing Type': source.PricingType || source.pricingType || 'per person',
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
                aiRecords.push(record);
            });
        } else if (aiData.Name || aiData.name) {
            // Single AI result
            const record = buildAIRecord(aiData, `ai-presentation-${timestamp}-0`, searchTerm);
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
                    'Pricing Type': 'per person',
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
    const card = document.createElement('div');
    card.className = 'presentation-result-card';
    card.dataset.recordId = record.id;
    if (isAI) {
        card.dataset.isAi = 'true';
    }

    const fields = record.fields;

    // Fetch image using the multi-tier approach (website scraping, logo, etc.)
    let imageUrl = '';
    try {
        const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
        if (imageUrls && imageUrls.length > 0) {
            imageUrl = imageUrls[0];
        }
    } catch (e) {
        console.warn('Failed to fetch image for presentation card:', record.id, e);
    }

    const name = fields.Name || 'Unnamed Item';
    // Use centralized getRecordPrice for consistent price handling across all views
    const price = getRecordPrice(record);
    const category = fields.Category || '';

    // Check if already in plan (check cart.items, cart.lockedItems, and likedItemIds)
    const isInPlan = state.cart.lockedItems.has(record.id) ||
                     state.cart.items.has(record.id) ||
                     state.session.user.likedItemIds.has(record.id);

    card.innerHTML = `
        <div class="presentation-result-card-image${isAI ? ' ai-item' : ''}" style="${imageUrl ? `background-image: url('${imageUrl}')` : ''}"></div>
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
    `;

    // Click on card (not button) opens detail modal
    card.addEventListener('click', (e) => {
        if (e.target.closest('.presentation-quick-add-btn')) return;
        handleCardClick(record, isAI);
    });

    // Quick add button handler
    const quickAddBtn = card.querySelector('.presentation-quick-add-btn');
    quickAddBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleQuickAdd(record, quickAddBtn, isAI);
    });

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
