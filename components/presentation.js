// Debug flag: set to true (or window.__PRES_DEBUG__) for verbose logging in hot paths
const PRES_DEBUG = typeof window !== 'undefined' && window.__PRES_DEBUG__;

console.log('[MODULE DEBUG] presentation.js module starting to load...', performance.now().toFixed(2) + 'ms');

import { state, setState, getRecordById, invalidateRecordsIndex, getAggregateReactions } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, EMOJI_REACTIONS, EMOJI_CATEGORIES, EMOJI_TIERS, REACTION_SCORES, getModalZIndex, computeDemocraticAverage } from '../config.js';
import { updateUrl, getRecordPrice, parseOptions, flattenOptionGroups } from '../utils.js';
import { log } from '../utils/debug.js';
import { getCurrentUser, sendMessage as sendChatMessage, getReplyingToMessage, clearReplyState } from '../chat.js';
import { triggerSave } from '../events.js';
import { showDetailModal, showGroupDetailModal, showCheckoutModal, getShopSettings } from './modal.js';
// Shader import moved to presentation/backgroundEngine.js
import { showWtfPlansPanel } from './wtfPlansPanel.js';
// calendarExport imports moved to presentation/rsvpSection.js
import { updateEventPlanSection, updateIdeasCarousel } from './sidebar.js';
import { syncPlanState, registerSyncCallback, unregisterSyncCallback } from '../utils/planStateSync.js';
import { showUserModal } from '../auth.js';
import { showToast } from '../ui.js';
import { applyCloudinaryTransform } from '../utils/imageOptimizer.js';
import { resizeImageForUpload } from '../utils/imageResizer.js';
import { refreshForumData, onNewItemReceived, getComponentMessageReactions } from './forumPanel.js';
import { initializeToastNotifications, handlePusherEvent as handleToastPusherEvent } from './toastNotifications.js';
import { initializeUnifiedChatPanel, showUnifiedChatPanel, hideUnifiedChatPanel, setUCPGetCurrentUser, setUCPSendMessage, updateUCPVideoArea, updateUCPLiveBadge, isUCPFullscreen, updateFocusBarUI, populateFocusSelect, applyRemoteFocusItem, applyRemotePin } from './unifiedChatPanel.js';
import { initVitalityUI, cleanupVitalityUI, refreshFlowLines } from '../vitality/vitalityUI.js';
import { requestVitalityRecalc, recalculateVitality } from '../vitality/vitalityEngine.js';
import { openActionMenu, closeActionMenu, isActionMenuOpen, registerActionHandler } from './actionMenu.js';
import * as liveStream from './liveStream.js';
import * as voiceCommands from './voiceCommands.js';

// Phase 1 extracted modules
import * as backgroundEngine from './presentation/backgroundEngine.js';
import * as rsvpSection from './presentation/rsvpSection.js';
import * as collaboratorsModule from './presentation/collaborators.js';
import * as reactionRankings from './presentation/reactionRankings.js';
import * as accordions from './presentation/accordions.js';
import * as planFocus from './presentation/planFocus.js';
import * as voiceCommandsUI from './presentation/voiceCommandsUI.js';

// Phase 2 extracted modules
import * as emojiPicker from './presentation/emojiPicker.js';
import * as sentimentPopup from './presentation/sentimentPopup.js';
import * as searchModal from './presentation/searchModal.js';

// Phase 3 extracted modules
import * as presentationChat from './presentation/presentationChat.js';
import * as componentComments from './presentation/componentComments.js';
import * as liveStreamToolbar from './presentation/liveStreamToolbar.js';

// Phase 4A extracted modules
import * as itemRendering from './presentation/itemRendering.js';
import * as reactionSummaryBar from './presentation/reactionSummaryBar.js';
import * as cardInteractions from './presentation/cardInteractions.js';
import * as itemActions from './presentation/itemActions.js';

console.log('[MODULE DEBUG] presentation.js imports resolved successfully.', performance.now().toFixed(2) + 'ms');

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
// Collaborator DOM elements (cached here, passed to collaborators module via init)
let collaboratorsListEl = null;
let itineraryItemsListEl = null;

// Presentation header elements
let presentationBackBtn = null;
let presentationLogoContainer = null;
let presentationShopTitle = null;
let presentationEventLabel = null;
// Note: presentationHeaderShareBtn removed - share merged into collaborators add/share button

// Collaborators modal elements (carousel removed, using inline list instead)
// Collaborators modal elements (cached here, passed to collaborators module via init)
let collaboratorsModal = null;
let collaboratorsModalClose = null;
let collaboratorsModalList = null;
let presentationAccountBtn = null;
let collaboratorsAddShareBtn = null;

// Accordion summary elements
let headerSummaryEl = null;
let itemsSummaryEl = null;

// Floating chat button (no longer used but kept for cleanup)
// Floating chat button (no longer used but kept for cleanup)
let floatingChatBtn = null;

// Reactions summary DOM element
// reactionsSummaryEl moved to reactionRankings module

// v3.8: Live stream toolbar DOM element references — moved to presentation/liveStreamToolbar.js
// Only keeping references that are still needed in ensureDOMElements() for caching and passing
let liveStreamToolbarEl = null;
let liveGoLiveBtn = null;
let liveStreamControls = null;
let liveToggleAudioBtn = null;
let liveToggleVideoBtn = null;
let liveEndStreamBtn = null;
let liveCopyLinkBtn = null;
let liveViewerCountEl = null;
let liveAudioIcon = null;
let liveVideoIcon = null;
let liveVideoStrip = null;
let liveLocalVideoEl = null;
let liveRemoteVideosEl = null;
let liveVideoStripToggle = null;
let presentationLiveBadge = null;

// v3.8 Phase 6: Floating reaction overlay — passed to liveStreamToolbar module
let hostReactionOverlay = null;

// --- Item images cache moved to presentation/itemRendering.js ---
// Access via itemRendering.getItemImagesCache()
// Local alias for remaining references in this file:
const itemImagesCache = { get: (...a) => itemRendering.getItemImagesCache().get(...a), set: (...a) => itemRendering.getItemImagesCache().set(...a), has: (...a) => itemRendering.getItemImagesCache().has(...a), clear: () => itemRendering.getItemImagesCache().clear() };

// Track accordion state via extracted module — access via accordions.getAccordionState()

// Pusher instance moved to presentation/presentationChat.js
// Expose a function for other modules (e.g. modal.js) to broadcast reaction updates via Pusher
window.broadcastReactionUpdate = function(recordId, itemReactions, userId) {
    const channel = presentationChat.getChannel();
    if (!channel) {
        console.log('[REACTIONS-DEBUG] broadcastReactionUpdate: no Pusher channel available');
        return;
    }
    const reactionsObj = {};
    itemReactions.forEach((emojiData, odUserId) => {
        if (emojiData instanceof Set) {
            reactionsObj[odUserId] = Array.from(emojiData);
        } else {
            reactionsObj[odUserId] = emojiData;
        }
    });
    console.log(`[REACTIONS-DEBUG] broadcastReactionUpdate via Pusher: recordId="${recordId}"`, JSON.stringify(reactionsObj));
    channel.trigger('client-item-reaction-update', {
        recordId,
        reactions: reactionsObj,
        userId
    });
};

// Chat elements (cached here, passed to presentationChat module via init)
let chatMessagesEl = null;
let presentationMessageInput = null;
let presentationMessageForm = null;
let presentationUserNameInput = null;
let presentationWhosHereCount = null;
let presentationWhosHereList = null;

// Search modal elements (cached here, passed to searchModal module via init)
let presentationAddBtn = null;
let presentationToggleAllBtn = null;
let presentationSearchModal = null;
let presentationSearchClose = null;
let presentationSearchInput = null;
let presentationSearchClear = null;
let presentationSearchResults = null;
let presentationRefinementChips = null;
let presentationBrowseCategories = null;

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

// Plan focus elements (cached here, passed to planFocus module via init)
let planFocusSuggestionEl = null;
let goalChipsContainerEl = null;
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

// --- Show/hide state moved to presentation/itemRendering.js ---

// --- Background Engine moved to presentation/backgroundEngine.js ---

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

    // v3.8: Live stream toolbar DOM elements
    liveStreamToolbarEl = document.getElementById('live-stream-toolbar');
    liveGoLiveBtn = document.getElementById('live-go-live-btn');
    liveStreamControls = document.getElementById('live-stream-controls');
    liveToggleAudioBtn = document.getElementById('live-toggle-audio');
    liveToggleVideoBtn = document.getElementById('live-toggle-video');
    liveEndStreamBtn = document.getElementById('live-end-stream');
    liveCopyLinkBtn = document.getElementById('live-copy-link');
    liveViewerCountEl = document.getElementById('live-viewer-count');
    liveAudioIcon = document.getElementById('live-audio-icon');
    liveVideoIcon = document.getElementById('live-video-icon');
    liveVideoStrip = document.getElementById('live-video-strip');
    liveLocalVideoEl = document.getElementById('live-local-video');
    liveRemoteVideosEl = document.getElementById('live-remote-videos');
    liveVideoStripToggle = document.getElementById('live-video-strip-toggle');
    presentationLiveBadge = document.getElementById('presentation-live-badge');

    // v3.8 Phase 4: Voice command UI elements — cached and passed to voiceCommandsUI module
    const liveTranscriptionBtn = document.getElementById('live-toggle-transcription');
    const liveCaptionsBar = document.getElementById('live-captions-bar');
    const liveCaptionsText = document.getElementById('live-captions-text');
    const liveCaptionsStatusText = document.getElementById('live-captions-status-text');
    const liveCaptionsStatus = document.getElementById('live-captions-status');
    hostReactionOverlay = document.getElementById('host-reaction-overlay');
    const voiceCommandToast = document.getElementById('voice-command-toast');
    const voiceCommandToastTitle = document.getElementById('voice-command-toast-title');
    const voiceCommandToastDesc = document.getElementById('voice-command-toast-desc');
    const voiceCommandToastCountdown = document.getElementById('voice-command-toast-countdown');
    const voiceCommandToastProgress = document.getElementById('voice-command-toast-progress');
    const voiceCommandUndoBtn = document.getElementById('voice-command-undo-btn');

    // Initialize extracted modules with their DOM elements and dependencies
    backgroundEngine.init({ getState: () => state, getModal: () => modal });

    collaboratorsModule.init({
        updateAccountButton: updatePresentationAccountButton,
        elements: {
            collaboratorsListEl,
            collaboratorsModal,
            collaboratorsModalClose,
            collaboratorsModalList,
            collaboratorsAddShareBtn,
            presentationAccountBtn,
        }
    });

    reactionRankings.init({
        getState: () => state,
        getItemReactionCount,
        getItemReactionScore,
    });

    accordions.init({
        getModal: () => modal,
        getToggleAllBtn: () => presentationToggleAllBtn,
    });

    planFocus.init({
        renderPresentationHeader,
        renderEventHeader,
        escapeHtml,
        elements: {
            planFocusSuggestionEl,
            goalChipsContainerEl,
        }
    });

    voiceCommandsUI.init({
        elements: {
            liveTranscriptionBtn,
            liveCaptionsBar,
            liveCaptionsText,
            liveCaptionsStatusText,
            liveCaptionsStatus,
            voiceCommandToast,
            voiceCommandToastTitle,
            voiceCommandToastDesc,
            voiceCommandToastCountdown,
            voiceCommandToastProgress,
            voiceCommandUndoBtn,
        }
    });

    // Phase 2 extracted modules
    emojiPicker.init({
        getReactionScore,
        renderReactions,
        updateItemEmojiIndicator,
        updateReactionZoneSummary,
        updateEventEmojiIndicator,
        getPresentationChatChannel: () => presentationChat.getChannel(),
    });

    sentimentPopup.init({
        getItemReactionScore,
        getItemReactionCount,
        getItemSummaryEmoji,
    });

    searchModal.init({
        elements: {
            presentationAddBtn,
            presentationToggleAllBtn,
            presentationSearchModal,
            presentationSearchClose,
            presentationSearchInput,
            presentationSearchClear,
            presentationSearchResults,
            presentationRefinementChips,
            presentationBrowseCategories,
        },
        toggleAllItemAccordions: accordions.toggleAllItemAccordions,
        toggleArchivedItems,
        toggleCompletedItems,
        renderAllItems,
    });

    // Phase 3 extracted modules
    presentationChat.init({
        elements: {
            chatMessagesEl,
            presentationMessageInput,
            presentationMessageForm,
            presentationUserNameInput,
            presentationWhosHereCount,
            presentationWhosHereList,
            floatingChatBtn,
            modal,
        },
        getAccordionState: accordions.getAccordionState,
        renderReactions,
        updateItemEmojiIndicator,
        updateReactionZoneSummary,
        updateEventEmojiIndicator,
        updateLiveStreamToolbarUI: () => liveStreamToolbar.updateLiveStreamToolbarUI(),
        updatePresentationLiveBadge: () => liveStreamToolbar.updatePresentationLiveBadge(),
        spawnHostReactionOverlay: (emoji) => liveStreamToolbar.spawnHostReactionOverlay(emoji),
        loadComponentComments: (componentId) => componentComments.loadComponentComments(componentId),
        updateCommentReactionsDisplay: (commentEl, reactions) => componentComments.updateCommentReactionsDisplay(commentEl, reactions),
    });

    componentComments.init({
        getRecordById,
        escapeHtml: presentationChat.escapeHtml,
        addImageToItemCarousel,
        addPresentationMessageToUI: presentationChat.addPresentationMessageToUI,
        getChannel: () => presentationChat.getChannel(),
        getChatMessagesEl: () => chatMessagesEl,
        saveCommentTaskLink,
    });

    liveStreamToolbar.init({
        elements: {
            liveStreamToolbar: liveStreamToolbarEl,
            liveGoLiveBtn,
            liveStreamControls,
            liveToggleAudioBtn,
            liveToggleVideoBtn,
            liveEndStreamBtn,
            liveCopyLinkBtn,
            liveViewerCountEl,
            liveAudioIcon,
            liveVideoIcon,
            liveVideoStrip,
            liveLocalVideoEl,
            liveRemoteVideosEl,
            liveVideoStripToggle,
            presentationLiveBadge,
            hostReactionOverlay,
        },
        getChannel: () => presentationChat.getChannel(),
    });

    // Phase 4A module initialization
    const phase4ADeps = {
        getState: () => state,
        getRecordById,
        getAggregateReactions,
        getRecordPrice,
        parseOptions,
        flattenOptionGroups,
        computeDemocraticAverage,
        api,
        escapeHtml,
        showToast,
        showDetailModal,
        showGroupDetailModal,
        applyCloudinaryTransform,
        getCurrentUser,
        selectEmoji,
        getItemReactionCount,
        getItemSummaryEmoji,
        getItemReactionScore,
        getComponentMessageReactions,
        isItemCombinedSource,
        getCombinedSources,
        getCombinedHybridData,
        getItemGroup,
        getElementTaskStatus,
        renderTaskStatusButton,
        TASK_STATUS_CONFIG,
        ELEMENT_TASK_STATUS,
        EMOJI_TIERS,
        REACTION_SCORES,
        reactionRankings,
        componentComments,
        planFocus,
        triggerSave,
        openGroupDetailModal,
        dissolveGroup,
        uncombineAll,
        requestVitalityRecalc,
        recalculateVitality,
        refreshFlowLines,
        showUnifiedChatPanel,
        openConversationForItem,
        getItineraryItemsListEl: () => itineraryItemsListEl,
        updatePresentationHeaderTotal,
        onAfterRenderAllItems: () => {
            // Post-render hooks delegated back from itemRendering.renderAllItems()
            initializeCompactCardClicks();
            initializeReactionZones();
            reactionRankings.renderReactionsSummary();
            updateEventEmojiIndicator();
            initializeItemDragDrop();
            initializeRadialMenu();
            attachRadialMenuListeners();
            registerActionHandler(handleActionMenuAction);
            updatePlanSummaryDashboard();
            setTimeout(() => { recalculateVitality(); }, 0);
        },
    };

    itemRendering.init(phase4ADeps);
    reactionSummaryBar.init(phase4ADeps);
    cardInteractions.init(phase4ADeps);
    itemActions.init({
        ...phase4ADeps,
        renderAllItems,
        generateItemsSummary,
        updatePlanSummaryDashboard,
    });

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
    collaboratorsModule.renderCollaborators();

    // Re-initialize the presentation chat with the new authenticated identity
    // This reconnects to Pusher with the real user ID and name
    if (presentationChat.getPusher()) {
        await presentationChat.initializePresentationChat();
    }
}


// --- RSVP moved to presentation/rsvpSection.js ---
// Delegate calls: rsvpSection.renderRsvpSection(), rsvpSection.handleRsvpClick()

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

    // Multi-emoji model: sum all emoji scores across all users
    let score = 0;
    reactions.forEach((emojiData) => {
        const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
        for (const emoji of emojis) {
            score += getReactionScore(emoji);
        }
    });
    return score;
}

// Get reaction count for an item (hierarchical: includes variations + comments)
function getItemReactionCount(recordId) {
    const aggregateReactions = getAggregateReactions(recordId);
    if (!aggregateReactions || aggregateReactions.size === 0) return 0;
    // Count total individual reactions across all users
    let count = 0;
    aggregateReactions.forEach((emojiData) => {
        const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
        count += emojis.size;
    });
    // Also count comment reactions
    try {
        const commentReactions = getComponentMessageReactions(recordId);
        if (commentReactions && commentReactions.size > 0) {
            commentReactions.forEach((emojiData) => {
                const emojis = emojiData instanceof Set ? emojiData : new Set([emojiData]);
                count += emojis.size;
            });
        }
    } catch (e) { /* comment reactions may not be available during early init */ }
    return count;
}

/**
 * Get a hierarchical summary emoji for an item, incorporating:
 * 1. Direct reactions on the item
 * 2. Reactions on variations/options (via compound keys like recordId::*)
 * 3. Reactions from comment threads linked to this item (via componentId)
 * Returns the emoji whose score is closest to the combined democratic average.
 * @param {string} recordId - The item record ID
 * @returns {string} A single emoji closest to the democratic average score, or empty string if none
 */
function getItemSummaryEmoji(recordId) {
    // Step 1: Get aggregate reactions across direct + variations (compound keys)
    const aggregateReactions = getAggregateReactions(recordId);

    // Step 2: Merge in comment/thread reactions linked to this item
    let commentReactionsMerged = false;
    try {
        const commentReactions = getComponentMessageReactions(recordId);
        if (commentReactions && commentReactions.size > 0) {
            for (const [userId, emojiSet] of commentReactions) {
                if (!aggregateReactions.has(userId)) aggregateReactions.set(userId, new Set());
                const userSet = aggregateReactions.get(userId);
                for (const emoji of emojiSet) userSet.add(emoji);
            }
            commentReactionsMerged = true;
        }
    } catch (e) {
        // getComponentMessageReactions may not be available during early init
        console.log(`[SUMMARY-DEBUG] getItemSummaryEmoji(${recordId}): comment reactions unavailable (${e.message})`);
    }

    if (!aggregateReactions || aggregateReactions.size === 0) {
        return '';
    }

    const { summaryEmoji, democraticAverage, userCount, totalReactions } = computeDemocraticAverage(aggregateReactions);
    console.log(`[SUMMARY-DEBUG] getItemSummaryEmoji(${recordId}): hierarchical summary → ${summaryEmoji} (avg: ${democraticAverage.toFixed(2)}, ${userCount} users, ${totalReactions} reactions, commentsIncluded: ${commentReactionsMerged})`);
    return summaryEmoji || '💬';
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
    console.log(`[SUMMARY-DEBUG] updateItemEmojiIndicator(${recordId}): summaryEmoji=${summaryEmoji}, reactionCount=${reactionCount}`);

    if (summaryEmoji && reactionCount > 0) {
        emojiIndicator.innerHTML = `<span class="emoji-indicator-emoji">${summaryEmoji}</span>${reactionCount > 1 ? `<span class="emoji-indicator-count">${reactionCount}</span>` : ''}`;
        emojiIndicator.style.display = 'inline-flex';
        emojiIndicator.classList.add('has-reactions');
        emojiIndicator.classList.remove('no-reactions');
        // Update tooltip with ranking info
        const tooltip = reactionRankings.getItemRankingTooltip(recordId);
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
 * Calculate the plan-level emoji by averaging all item hierarchical summary scores.
 * Uses getAggregateReactions (which includes variations) + comment reactions per item,
 * then averages those per-item democratic averages for the plan-level score.
 * @returns {{emoji: string, count: number, totalReactions: number, averageScore: number}} Plan emoji data
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
        // Use hierarchical aggregate (direct + variations)
        const aggregateReactions = getAggregateReactions(recordId);

        // Also merge in comment reactions
        try {
            const commentReactions = getComponentMessageReactions(recordId);
            if (commentReactions && commentReactions.size > 0) {
                for (const [userId, emojiSet] of commentReactions) {
                    if (!aggregateReactions.has(userId)) aggregateReactions.set(userId, new Set());
                    const userSet = aggregateReactions.get(userId);
                    for (const emoji of emojiSet) userSet.add(emoji);
                }
            }
        } catch (e) { /* comment reactions may not be available */ }

        if (!aggregateReactions || aggregateReactions.size === 0) return;

        const { democraticAverage, totalReactions } = computeDemocraticAverage(aggregateReactions);

        if (totalReactions > 0) {
            componentAverages.push(democraticAverage);
            totalReactionCount += totalReactions;
        }
    });

    // No components with reactions
    if (componentAverages.length === 0) {
        console.log(`[SUMMARY-DEBUG] getEventSummaryEmoji: no items with reactions across ${allItemIds.length} plan items`);
        return { emoji: '', count: 0, totalReactions: 0, averageScore: 0 };
    }

    // Calculate the average of all component averages (plan-level average)
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

    console.log(`[SUMMARY-DEBUG] getEventSummaryEmoji: ${componentAverages.length}/${allItemIds.length} items with reactions, planAvg: ${eventAverageScore.toFixed(2)} → ${closestEmoji}, ${totalReactionCount} total reactions`);
    return {
        emoji: closestEmoji || '💬',
        count: componentAverages.length,
        totalReactions: totalReactionCount,
        averageScore: eventAverageScore
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

    const { emoji, count, totalReactions, averageScore } = getEventSummaryEmoji();
    console.log(`[SUMMARY-DEBUG] updateEventEmojiIndicator: emoji=${emoji}, count=${count}, totalReactions=${totalReactions}, avgScore=${averageScore?.toFixed(2) || 'N/A'}`);

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

// --- Emoji Picker moved to presentation/emojiPicker.js ---
// Delegated functions:
function showExpandedEmojiPicker(recordId, anchorElement) {
    emojiPicker.showExpandedEmojiPicker(recordId, anchorElement);
}
function closeExpandedEmojiPicker() {
    emojiPicker.closeExpandedEmojiPicker();
}
function selectEmoji(recordId, emoji) {
    emojiPicker.selectEmoji(recordId, emoji);
}

// --- Sentiment Popup moved to presentation/sentimentPopup.js ---
// Delegated functions:
function initializeEventEmojiClickHandler() {
    sentimentPopup.initializeEventEmojiClickHandler();
}

// --- Sentiment Analysis Popup moved to presentation/sentimentPopup.js ---

// --- Emoji Picker handlers moved to presentation/emojiPicker.js ---

function renderReactions(recordId, reactionContainer) {
    const currentUser = getCurrentUser();
    let allReactions = state.session.reactions.get(recordId);
    if (!(allReactions instanceof Map)) {
        allReactions = new Map();
    }
    // Get current user's emoji set
    const currentUserEmojiSet = allReactions.get(currentUser.id);

    // Quick reaction buttons (8 most common)
    const buttonsHTML = EMOJI_REACTIONS.map(emoji => {
        // Check if this emoji is in the user's set
        const isSelected = currentUserEmojiSet instanceof Set
            ? currentUserEmojiSet.has(emoji)
            : currentUserEmojiSet === emoji;
        return `<button class="reaction-btn ${isSelected ? 'selected' : ''}" data-emoji="${emoji}" data-record-id="${recordId}">${emoji}</button>`;
    }).join('');

    // More button to open full picker
    const moreButtonHTML = `<button class="reaction-btn reaction-more-btn" data-record-id="${recordId}" title="More reactions">+</button>`;

    // Summary showing who reacted (simplified - just names and emojis)
    let summaryHTML = '';
    if (allReactions.size > 0) {
        summaryHTML = Array.from(allReactions.entries()).map(([userId, emojiData]) => {
            const name = state.session.userProfiles.get(userId) || 'A User';
            const emojiStr = emojiData instanceof Set ? Array.from(emojiData).join('') : emojiData;
            return `<span class="reaction-user">${name}: ${emojiStr}</span>`;
        }).join('');
    }

    reactionContainer.innerHTML = `
        <div class="reaction-bar-buttons">${buttonsHTML}${moreButtonHTML}</div>
        <div class="reaction-info-row">
            <div class="reaction-summary-display">${summaryHTML || 'Tap an emoji to share your reaction'}</div>
        </div>
    `;
}

// --- Item Rendering moved to presentation/itemRendering.js ---
// Delegated functions:
function createMediaCarousel(images, recordId) { return itemRendering.createMediaCarousel(images, recordId); }
function getSelectedOptionsDisplay(record, itemInfo) { return itemRendering.getSelectedOptionsDisplay(record, itemInfo); }
function generateItemSummary(record, itemInfo, type) { return itemRendering.generateItemSummary(record, itemInfo, type); }
async function renderItineraryItem(item, index) { return itemRendering.renderItineraryItem(item, index); }
function getCompactCardSourceType(recordId, record) { return itemRendering.getCompactCardSourceType(recordId, record); }
async function renderCompactCard(item) { return itemRendering.renderCompactCard(item); }
async function renderCompactGroupCard(group) { return itemRendering.renderCompactGroupCard(group); }
function scheduleRenderAllItems() { itemRendering.scheduleRenderAllItems(); }
async function renderAllItems() { return itemRendering.renderAllItems(); }

// --- Card Interactions moved to presentation/cardInteractions.js ---
function initializeCompactCardClicks() { cardInteractions.initializeCompactCardClicks(); }

// --- Reaction Summary Bar moved to presentation/reactionSummaryBar.js ---
// Delegated functions:
function initializeReactionZones() { reactionSummaryBar.initializeReactionZones(); }
function updateReactionZoneSummary(recordId) { reactionSummaryBar.updateReactionZoneSummary(recordId); }
function buildModalRSBPanel(recordId) { return reactionSummaryBar.buildModalRSBPanel(recordId); }
function refreshRSBPanel(panel, recordId) { reactionSummaryBar.refreshRSBPanel(panel, recordId); }

function openConversationForItem(recordId) {
    showUnifiedChatPanel();
    const commentSection = document.querySelector(`.component-comments-section[data-component-id="${recordId}"]`);
    if (commentSection) {
        const body = commentSection.querySelector(`.component-comments-body[data-component-id="${recordId}"]`);
        if (body && body.style.display === 'none') {
            body.style.display = '';
            const toggle = commentSection.querySelector('.component-comments-toggle');
            if (toggle) toggle.classList.add('expanded');
        }
        commentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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

// --- Item Actions moved to presentation/itemActions.js ---
// Delegated functions:
async function archiveItem(recordId) { return itemActions.archiveItem(recordId); }
async function completeItem(recordId) { return itemActions.completeItem(recordId); }
async function setItemAsGoal(recordId) { return itemActions.setItemAsGoal(recordId); }
async function moveToIdeas(recordId) { return itemActions.moveToIdeas(recordId); }
async function lockItem(recordId) { return itemActions.lockItem(recordId); }
async function demoteItem(recordId) { return itemActions.demoteItem(recordId); }
async function deleteItem(recordId) { return itemActions.deleteItem(recordId); }
async function addReactionToItem(recordId, emoji) { return itemActions.addReactionToItem(recordId, emoji); }
async function addQuickCommentToItem(recordId, comment) { return itemActions.addQuickCommentToItem(recordId, comment); }
async function openCustomCommentDialog(recordId) { return itemActions.openCustomCommentDialog(recordId); }

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

// --- Live Stream Toolbar moved to presentation/liveStreamToolbar.js ---

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

// --- Status toggles moved to presentation/itemRendering.js ---
function updateStatusToggles(archivedCount, completedCount) { itemRendering.updateStatusToggles(archivedCount, completedCount); }
function toggleArchivedItems() { itemRendering.toggleArchivedItems(); }
function toggleCompletedItems() { itemRendering.toggleCompletedItems(); }

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

// --- Reaction Rankings moved to presentation/reactionRankings.js ---
// Delegate calls: reactionRankings.calculateReactionRankings(), .getItemRankingTooltip(), .renderReactionsSummary(), etc.

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

// --- Presentation Chat moved to presentation/presentationChat.js ---
// Delegated functions for internal call sites:
function escapeHtml(text) {
    return presentationChat.escapeHtml(text);
}
function addPresentationMessageToUI(sender, message, isSent, timestamp, senderId, options = {}) {
    return presentationChat.addPresentationMessageToUI(sender, message, isSent, timestamp, senderId, options);
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
 * Update plan metrics displayed across the UI:
 * - Team count in the people container badge
 * - Vitality emoji is updated by the vitality system (vitalityUI.js)
 */
function updatePlanSummaryDashboard() {
    // --- Team count (in people container badge) ---
    const teamCount = state.session.userProfiles?.size || 0;
    const teamCountNumber = document.getElementById('team-count-number');
    if (teamCountNumber) {
        teamCountNumber.textContent = teamCount || 1; // At least the current user
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

// --- Accordions moved to presentation/accordions.js ---
// Delegate calls: accordions.toggleAccordion(), .toggleItemAccordion(), .toggleAllItemAccordions(), .handleItemAccordionClick(), .initializeAccordions()

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
    // Delegate accordion state setup to the extracted module
    accordions.initializeAccordions();

    // Generate all summaries (these stay in presentation.js — not part of accordion feature)
    generateHeaderSummary();
    generateItemsSummary();
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

function addImageToItemCarousel(recordId, imageUrl) { itemRendering.addImageToItemCarousel(recordId, imageUrl); }

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
    console.log(`[REACTIONS-DEBUG] handleReactionClick: recordId="${recordId}", emoji="${emoji}", userId="${currentUser.id}"`);

    if (!state.session.reactions.has(recordId)) {
        state.session.reactions.set(recordId, new Map());
    }

    const itemReactions = state.session.reactions.get(recordId);

    // Multi-emoji model: each user has a Set of emojis
    let userEmojiSet = itemReactions.get(currentUser.id);
    if (!(userEmojiSet instanceof Set)) {
        userEmojiSet = userEmojiSet ? new Set([userEmojiSet]) : new Set();
    }

    // Toggle: if emoji already in set, remove it; otherwise add it
    if (userEmojiSet.has(emoji)) {
        userEmojiSet.delete(emoji);
    } else {
        userEmojiSet.add(emoji);
    }

    // Clean up empty sets, otherwise store the updated set
    if (userEmojiSet.size === 0) {
        itemReactions.delete(currentUser.id);
    } else {
        itemReactions.set(currentUser.id, userEmojiSet);
    }

    // Re-render reactions for this item
    const reactionContainer = document.querySelector(`.itinerary-item-reactions[data-record-id="${recordId}"]`);
    if (reactionContainer) {
        renderReactions(recordId, reactionContainer);
    }

    // Update the emoji indicator next to item name
    updateItemEmojiIndicator(recordId);

    // Update the reactions summary
    reactionRankings.renderReactionsSummary();

    // Update the reaction zone summary on compact cards
    updateReactionZoneSummary(recordId);

    // Update the event-level emoji indicator
    updateEventEmojiIndicator();

    // Broadcast item reaction update via Pusher for real-time sync
    const _chatChannel = presentationChat.getChannel();
    if (_chatChannel) {
        // Convert Map<userId, Set<emoji>> to object for Pusher transmission
        const reactionsObj = {};
        itemReactions.forEach((emojiData, odUserId) => {
            if (emojiData instanceof Set) {
                reactionsObj[odUserId] = Array.from(emojiData);
            } else {
                reactionsObj[odUserId] = emojiData;
            }
        });
        _chatChannel.trigger('client-item-reaction-update', {
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

// --- Component Comments moved to presentation/componentComments.js ---
// Delegated functions for event listener delegation:
function handleComponentCommentsClick(e) {
    componentComments.handleComponentCommentsClick(e);
}
function handleComponentCommentsKeydown(e) {
    componentComments.handleComponentCommentsKeydown(e);
}
function handleCommentImageInputChange(e) {
    componentComments.handleCommentImageInputChange(e);
}
function loadAllCommentCounts() {
    componentComments.loadAllCommentCounts();
}
function loadComponentComments(componentId) {
    return componentComments.loadComponentComments(componentId);
}
function getTimeAgo(date) {
    return componentComments.getTimeAgo(date);
}

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
    componentComments.getCache().clear();

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
    collaboratorsModule.renderCollaborators();
    await rsvpSection.renderRsvpSection(); // Render RSVP buttons and list for events
    await renderAllItems();

    // Vitality recalculation is now handled inside renderAllItems() itself
    // via a setTimeout(0) call that fires after innerHTML is set, ensuring
    // cards are in the DOM when applyCardPulses() queries for them.

    // Render goal chips in header and set up regenerate button
    planFocus.renderGoalChips();
    planFocus.initializeHandlers();

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
    backgroundEngine.startAnimation();

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

    // v3.8: Initialize live stream toolbar
    liveStreamToolbar.initializeLiveStreamToolbar();

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

    // v3.8: Clean up live stream toolbar
    liveStreamToolbar.cleanupLiveStreamToolbar();

    // Hide the Unified Chat Panel
    hideUnifiedChatPanel();

    // Stop the background animation
    backgroundEngine.stopAnimation();

    // Hide collaborators modal if open
    collaboratorsModule.hideCollaboratorsModal();

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
            backgroundEngine.resize();
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
                accordions.toggleAccordion(section);
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
    itineraryItemsListEl.addEventListener('click', accordions.handleItemAccordionClick);

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
        headerAccordionContent.addEventListener('click', (e) => rsvpSection.handleRsvpClick(e, modal));
    }

    // Also add RSVP click handler to the RSVP section directly (in case it's outside accordion content)
    const rsvpSectionEl = document.getElementById('presentation-rsvp-section');
    if (rsvpSectionEl) {
        rsvpSectionEl.addEventListener('click', (e) => rsvpSection.handleRsvpClick(e, modal));
    }

    // Note: shareBtn removed - share functionality now in collaborators add/share button

    // Collaborators add/share button - opens invite modal for authenticated users, copies link for guests
    if (collaboratorsAddShareBtn) {
        collaboratorsAddShareBtn.addEventListener('click', () => {
            if (state.session.user.isAuthenticated) {
                // Open invite modal for authenticated users
                collaboratorsModule.showInviteModal();
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
        collaboratorsModalClose.addEventListener('click', collaboratorsModule.hideCollaboratorsModal);
    }

    // Close collaborators modal on backdrop click
    if (collaboratorsModal) {
        collaboratorsModal.addEventListener('click', (e) => {
            if (e.target === collaboratorsModal) {
                collaboratorsModule.hideCollaboratorsModal();
            }
        });
    }

    // Search modal event listeners
    searchModal.setupSearchModalEventListeners();
}

// --- Search Modal moved to presentation/searchModal.js ---
// Delegated functions for internal call sites:
function openSearchModal() {
    searchModal.openSearchModal();
}
function closeSearchModal() {
    searchModal.closeSearchModal();
}

// Export the search modal functions for external use if needed
export { openSearchModal as openPresentationSearchModal, closeSearchModal as closePresentationSearchModal };
