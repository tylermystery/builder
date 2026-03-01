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

// Phase 4B extracted modules
import * as dragAndDrop from './presentation/dragAndDrop.js';
import * as mergeSystem from './presentation/mergeSystem.js';
import * as taskStatusManagement from './presentation/taskStatusManagement.js';

console.log('[MODULE DEBUG] presentation.js imports resolved successfully.', performance.now().toFixed(2) + 'ms');

// --- Task status constants moved to presentation/taskStatusManagement.js ---
const { ELEMENT_TASK_STATUS, TASK_STATUS_CONFIG } = taskStatusManagement;

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
// --- Drag-and-drop state moved to presentation/dragAndDrop.js ---
// --- Merge mode state moved to presentation/mergeSystem.js ---
let _pendingMergeElements = null;

// Plan focus elements (cached here, passed to planFocus module via init)
let planFocusSuggestionEl = null;
let goalChipsContainerEl = null;

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

    // Drag-drop bucket elements — collected here, passed to dragAndDrop module via setElements()
    const _dragBucketsEl = document.getElementById('presentation-drag-buckets');

    // CRITICAL: Move drag buckets to body level for proper fixed positioning
    // Fixed positioning doesn't work correctly when inside transformed/positioned ancestors
    if (_dragBucketsEl && _dragBucketsEl.parentElement !== document.body) {
        document.body.appendChild(_dragBucketsEl);
    }

    dragAndDrop.setElements({
        dragBucketsEl: _dragBucketsEl,
        dragBucketGoal: document.getElementById('drag-bucket-goal'),
        dragBucketIdeas: document.getElementById('drag-bucket-ideas'),
        dragBucketLock: document.getElementById('drag-bucket-lock'),
        dragBucketMerge: document.getElementById('drag-bucket-merge'),
        dragBucketArchive: document.getElementById('drag-bucket-archive'),
        dragBucketDelete: document.getElementById('drag-bucket-delete'),
        dragBucketReactions: document.getElementById('drag-bucket-reactions'),
        dragBucketQuickComment: document.getElementById('drag-bucket-quick-comment'),
        dragBucketCustomComment: document.getElementById('drag-bucket-custom-comment'),
        dragBucketCompleted: document.getElementById('drag-bucket-completed'),
        dragMergeIndicator: document.getElementById('drag-merge-indicator'),
        dragActionTooltip: document.getElementById('drag-action-tooltip'),
        radialMenuContainer: document.getElementById('radial-menu-container')
    });

    // Merge mode elements — collected here, passed to mergeSystem module via init()
    const _mergeModeOverlay = document.getElementById('merge-mode-overlay');
    const _mergeModeBanner = document.getElementById('merge-mode-banner');
    const _mergeSelectFab = document.getElementById('merge-select-fab');
    const _mergeOptionsDialog = document.getElementById('merge-options-dialog');

    console.log('[MERGE DEBUG] ── DOM INIT: Merge element caching ──');
    console.log('[MERGE DEBUG]   mergeModeOverlay:', _mergeModeOverlay ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   mergeModeBanner:', _mergeModeBanner ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   mergeSelectFab:', _mergeSelectFab ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   mergeOptionsDialog:', _mergeOptionsDialog ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   dragBucketMerge:', document.getElementById('drag-bucket-merge') ? '✅ FOUND' : '❌ NOT FOUND');
    console.log('[MERGE DEBUG]   dragMergeIndicator:', document.getElementById('drag-merge-indicator') ? '✅ FOUND' : '❌ NOT FOUND');
    if (_mergeModeOverlay) {
        console.log('[MERGE DEBUG]   overlay parent:', _mergeModeOverlay.parentElement?.id || _mergeModeOverlay.parentElement?.tagName || 'UNKNOWN');
        console.log('[MERGE DEBUG]   overlay inDOM:', document.body.contains(_mergeModeOverlay));
    }
    if (_mergeModeBanner) {
        console.log('[MERGE DEBUG]   banner parent:', _mergeModeBanner.parentElement?.id || _mergeModeBanner.parentElement?.tagName || 'UNKNOWN');
    }

    // Store merge elements for passing to mergeSystem.init() later
    _pendingMergeElements = {
        mergeModeOverlay: _mergeModeOverlay,
        mergeModeBanner: _mergeModeBanner,
        mergeSelectFab: _mergeSelectFab,
        mergeOptionsDialog: _mergeOptionsDialog,
        mergeDialogSourceName: document.getElementById('merge-source-name'),
        mergeDialogTargetName: document.getElementById('merge-target-name')
    };

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

    // Phase 4B: Drag-and-drop system
    dragAndDrop.init({
        getState: () => state,
        getItineraryItemsListEl: () => itineraryItemsListEl,
        isActionMenuOpen,
        openActionMenu,
        closeActionMenu,
        registerActionHandler,
        refreshFlowLines,
        triggerSave,
        log,
        showToast,
        getRecordById,
        getItemGroup: (id) => mergeSystem.getItemGroup(id),
        enterMergeMode: (id) => mergeSystem.enterMergeMode(id),
        executeMergeByZone: (s, t, z) => mergeSystem.executeMergeByZone(s, t, z),
        setItemAsGoal: (id) => itemActions.setItemAsGoal(id),
        moveToIdeas: (id) => itemActions.moveToIdeas(id),
        lockItem: (id) => itemActions.lockItem(id),
        archiveItem: (id) => itemActions.archiveItem(id),
        deleteItem: (id) => itemActions.deleteItem(id),
        completeItem: (id) => itemActions.completeItem(id),
        addReactionToItem: (id, emoji) => itemActions.addReactionToItem(id, emoji),
        addQuickCommentToItem: (id, comment) => itemActions.addQuickCommentToItem(id, comment),
        openCustomCommentDialog: (id) => itemActions.openCustomCommentDialog(id)
    });

    // Phase 4B: Merge system
    mergeSystem.init({
        getState: () => state,
        getRecordById,
        api,
        showToast,
        triggerSave,
        log,
        escapeHtml: (text) => presentationChat.escapeHtml(text),
        applyCloudinaryTransform,
        getCurrentUser,
        showGroupDetailModal,
        renderAllItems,
        generateItemsSummary,
        updatePresentationHeaderTotal,
        scheduleRenderAllItems,
        getRecordPrice,
        itemImagesCache,
        getItineraryItemsListEl: () => itineraryItemsListEl,
        elements: _pendingMergeElements || {}
    });

    // Phase 4B: Task status management
    taskStatusManagement.init({
        getState: () => state,
        getRecordById,
        api,
        showToast,
        triggerSave,
        log,
        escapeHtml: (text) => presentationChat.escapeHtml(text),
        getCurrentUser,
        applyCloudinaryTransform,
        getTimeAgo: (date) => componentComments.getTimeAgo(date)
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

// --- Drag-and-drop system moved to presentation/dragAndDrop.js ---
async function loadSortableJS() { return dragAndDrop.loadSortableJS ? dragAndDrop.loadSortableJS() : null; }
async function initializeItemDragDrop() { return dragAndDrop.initializeItemDragDrop(); }

// --- Merge system moved to presentation/mergeSystem.js ---
function initializeCombinedSourcesToggles() { mergeSystem.initializeCombinedSourcesToggles(); }

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

// --- Merge system moved to presentation/mergeSystem.js ---
function enterMergeMode(sourceRecordId) { mergeSystem.enterMergeMode(sourceRecordId); }
function exitMergeMode() { mergeSystem.exitMergeMode(); }
function initializeMergeDialogListeners() { mergeSystem.initializeMergeDialogListeners(); }
function isItemCombinedSource(recordId) { return mergeSystem.isItemCombinedSource(recordId); }
function getCombinedTarget(sourceRecordId) { return mergeSystem.getCombinedTarget(sourceRecordId); }
function getCombinedSources(targetRecordId) { return mergeSystem.getCombinedSources(targetRecordId); }
function getCombinedHybridData(targetRecordId) { return mergeSystem.getCombinedHybridData(targetRecordId); }
function getItemGroup(recordId) { return mergeSystem.getItemGroup(recordId); }
function openGroupDetailModal(groupId) { mergeSystem.openGroupDetailModal(groupId); }
async function uncombineSource(sourceId, targetId) { return mergeSystem.uncombineSource(sourceId, targetId); }
async function uncombineAll(targetId) { return mergeSystem.uncombineAll(targetId); }
async function removeFromGroup(recordId, groupId) { return mergeSystem.removeFromGroup(recordId, groupId); }
async function dissolveGroup(groupId) { return mergeSystem.dissolveGroup(groupId); }
function getSourcesFromEntry(entry) { return mergeSystem.getSourcesFromEntry(entry); }
function closeMergeDialog() { mergeSystem.closeMergeDialog(); }

// --- Status toggles moved to presentation/itemRendering.js ---
function updateStatusToggles(archivedCount, completedCount) { itemRendering.updateStatusToggles(archivedCount, completedCount); }
function toggleArchivedItems() { itemRendering.toggleArchivedItems(); }
function toggleCompletedItems() { itemRendering.toggleCompletedItems(); }

// --- Drag-and-drop system moved to presentation/dragAndDrop.js ---
function updateItemOrder() { dragAndDrop.updateItemOrder(); }
function cleanupItemDragDrop() { dragAndDrop.cleanupItemDragDrop(); }

// --- Reaction Rankings moved to presentation/reactionRankings.js ---
// Delegate calls: reactionRankings.calculateReactionRankings(), .getItemRankingTooltip(), .renderReactionsSummary(), etc.

// --- Task status management moved to presentation/taskStatusManagement.js ---
function getElementTaskStatus(elementType, elementId) { return taskStatusManagement.getElementTaskStatus(elementType, elementId); }
function setElementTaskStatus(elementType, elementId, status) { return taskStatusManagement.setElementTaskStatus(elementType, elementId, status); }
function saveElementTaskStatuses() { taskStatusManagement.saveElementTaskStatuses(); }
function loadElementTaskStatuses() { taskStatusManagement.loadElementTaskStatuses(); }
function saveCommentTaskLink(commentId, taskId) { taskStatusManagement.saveCommentTaskLink(commentId, taskId); }
function loadCommentTaskLinks() { taskStatusManagement.loadCommentTaskLinks(); }
function getLinkedTaskId(commentId) { return taskStatusManagement.getLinkedTaskId(commentId); }
function updateElementTaskStatusUI(elementType, elementId, status) { taskStatusManagement.updateElementTaskStatusUI(elementType, elementId, status); }
function renderTaskStatusButton(elementType, elementId) { return taskStatusManagement.renderTaskStatusButton(elementType, elementId); }
function showTaskStatusPicker(button) { taskStatusManagement.showTaskStatusPicker(button); }
function showTaskDetailPopup(elementType, elementId, elementName) { taskStatusManagement.showTaskDetailPopup(elementType, elementId, elementName); }
function createTaskFromComment(commentId, commentContent, componentId) { return taskStatusManagement.createTaskFromComment(commentId, commentContent, componentId); }

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

// --- Task status management moved to presentation/taskStatusManagement.js ---
function handleTaskStatusClick(e) { taskStatusManagement.handleTaskStatusClick(e); }

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
    dragAndDrop.activateBuckets();

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

    // Cleanup drag-drop functionality (handles all element hiding, radial cleanup, etc.)
    dragAndDrop.cleanup();

    // Exit merge mode if active
    exitMergeMode();

    // Close action menu and clean up old radial state
    if (isActionMenuOpen()) {
        console.log('[PRES-MENU DEBUG] Closing action menu on presentation deactivation');
        closeActionMenu();
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
