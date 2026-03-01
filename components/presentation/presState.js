/**
 * Presentation State
 * Centralized module-level state for the presentation view orchestrator.
 * Manages cached DOM element references and transient flags that persist
 * for the lifetime of the presentation view.
 *
 * Extracted from presentation.js — Phase 6 modularization.
 */

// --- Flags ---
let _catalogNeedsRender = false;

// --- Core layout elements ---
let modal = null;
let closeBtn = null;
let summaryEventNotesEl = null;
let summaryEventDateEl = null;
let collaboratorsListEl = null;
let itineraryItemsListEl = null;

// --- Presentation header elements ---
let presentationBackBtn = null;
let presentationLogoContainer = null;
let presentationShopTitle = null;
let presentationEventLabel = null;

// --- Collaborators modal elements ---
let collaboratorsModal = null;
let collaboratorsModalClose = null;
let collaboratorsModalList = null;
let presentationAccountBtn = null;
let collaboratorsAddShareBtn = null;

// --- Accordion summary elements ---
let headerSummaryEl = null;
let itemsSummaryEl = null;

// --- Floating chat button (legacy) ---
let floatingChatBtn = null;

// --- Live stream toolbar elements ---
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
let hostReactionOverlay = null;

// --- Chat elements ---
let chatMessagesEl = null;
let presentationMessageInput = null;
let presentationMessageForm = null;
let presentationUserNameInput = null;
let presentationWhosHereCount = null;
let presentationWhosHereList = null;

// --- Search modal elements ---
let presentationAddBtn = null;
let presentationToggleAllBtn = null;
let presentationSearchModal = null;
let presentationSearchClose = null;
let presentationSearchInput = null;
let presentationSearchClear = null;
let presentationSearchResults = null;
let presentationRefinementChips = null;
let presentationBrowseCategories = null;

// --- Merge staging ---
let _pendingMergeElements = null;

// --- Plan focus elements ---
let planFocusSuggestionEl = null;
let goalChipsContainerEl = null;


// ============================
// Getters
// ============================

export function getModal() { return modal; }
export function getCloseBtn() { return closeBtn; }
export function getSummaryEventNotesEl() { return summaryEventNotesEl; }
export function getSummaryEventDateEl() { return summaryEventDateEl; }
export function getCollaboratorsListEl() { return collaboratorsListEl; }
export function getItineraryItemsListEl() { return itineraryItemsListEl; }

export function getPresentationBackBtn() { return presentationBackBtn; }
export function getPresentationLogoContainer() { return presentationLogoContainer; }
export function getPresentationShopTitle() { return presentationShopTitle; }
export function getPresentationEventLabel() { return presentationEventLabel; }

export function getCollaboratorsModal() { return collaboratorsModal; }
export function getCollaboratorsModalClose() { return collaboratorsModalClose; }
export function getCollaboratorsModalList() { return collaboratorsModalList; }
export function getPresentationAccountBtn() { return presentationAccountBtn; }
export function getCollaboratorsAddShareBtn() { return collaboratorsAddShareBtn; }

export function getHeaderSummaryEl() { return headerSummaryEl; }
export function getItemsSummaryEl() { return itemsSummaryEl; }

export function getFloatingChatBtn() { return floatingChatBtn; }

export function getLiveStreamElements() {
    return {
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
    };
}

export function getChatElements() {
    return {
        chatMessagesEl,
        presentationMessageInput,
        presentationMessageForm,
        presentationUserNameInput,
        presentationWhosHereCount,
        presentationWhosHereList,
        floatingChatBtn,
        modal,
    };
}

export function getSearchElements() {
    return {
        presentationAddBtn,
        presentationToggleAllBtn,
        presentationSearchModal,
        presentationSearchClose,
        presentationSearchInput,
        presentationSearchClear,
        presentationSearchResults,
        presentationRefinementChips,
        presentationBrowseCategories,
    };
}

export function getCollaboratorsElements() {
    return {
        collaboratorsListEl,
        collaboratorsModal,
        collaboratorsModalClose,
        collaboratorsModalList,
        collaboratorsAddShareBtn,
        presentationAccountBtn,
    };
}

export function getPlanFocusElements() {
    return {
        planFocusSuggestionEl,
        goalChipsContainerEl,
    };
}

export function getPendingMergeElements() { return _pendingMergeElements; }

// --- Flags ---
export function getCatalogNeedsRender() { return _catalogNeedsRender; }
export function setCatalogNeedsRender(v) { _catalogNeedsRender = v; }


// ============================
// Bulk initialization
// ============================

/**
 * Cache all DOM element references. Called once by the orchestrator's ensureDOMElements().
 * Returns false if the critical modal element is missing.
 */
export function cacheDOMElements() {
    if (modal) return true; // Already initialized

    modal = document.getElementById('presentation-modal-overlay');
    closeBtn = document.getElementById('presentation-close-btn');
    summaryEventNotesEl = document.getElementById('summary-event-notes');
    summaryEventDateEl = document.getElementById('summary-event-date');
    collaboratorsListEl = document.getElementById('itinerary-collaborators-list');
    itineraryItemsListEl = document.getElementById('itinerary-items-list');

    // Presentation header
    presentationBackBtn = document.getElementById('presentation-back-btn');
    presentationLogoContainer = document.getElementById('presentation-logo-container');
    presentationShopTitle = document.getElementById('presentation-shop-title');
    presentationEventLabel = document.getElementById('presentation-event-label');

    // Plan focus
    planFocusSuggestionEl = document.getElementById('plan-focus-suggestion');
    goalChipsContainerEl = document.getElementById('goal-chips-container');

    // Collaborators modal
    collaboratorsModal = document.getElementById('collaborators-modal');
    collaboratorsModalClose = document.getElementById('collaborators-modal-close');
    collaboratorsModalList = document.getElementById('collaborators-modal-list');
    presentationAccountBtn = document.getElementById('presentation-account-btn');
    collaboratorsAddShareBtn = document.getElementById('collaborators-add-share-btn');

    // Floating chat button (legacy)
    floatingChatBtn = document.getElementById('presentation-floating-chat-btn');

    // Accordion summary
    headerSummaryEl = document.getElementById('header-summary');
    itemsSummaryEl = document.getElementById('items-summary');

    // Search modal
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
    const _dragBucketsEl = document.getElementById('presentation-drag-buckets');
    // Move drag buckets to body level for proper fixed positioning
    if (_dragBucketsEl && _dragBucketsEl.parentElement !== document.body) {
        document.body.appendChild(_dragBucketsEl);
    }

    // Merge mode elements
    const _mergeModeOverlay = document.getElementById('merge-mode-overlay');
    const _mergeModeBanner = document.getElementById('merge-mode-banner');
    const _mergeSelectFab = document.getElementById('merge-select-fab');
    const _mergeOptionsDialog = document.getElementById('merge-options-dialog');

    _pendingMergeElements = {
        mergeModeOverlay: _mergeModeOverlay,
        mergeModeBanner: _mergeModeBanner,
        mergeSelectFab: _mergeSelectFab,
        mergeOptionsDialog: _mergeOptionsDialog,
        mergeDialogSourceName: document.getElementById('merge-source-name'),
        mergeDialogTargetName: document.getElementById('merge-target-name')
    };

    // Live stream toolbar
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
    hostReactionOverlay = document.getElementById('host-reaction-overlay');

    // Chat elements
    chatMessagesEl = document.getElementById('presentation-chat-messages');
    presentationMessageInput = document.getElementById('presentation-message-input');
    presentationMessageForm = document.getElementById('presentation-message-form');
    presentationUserNameInput = document.getElementById('presentation-user-name-input');
    presentationWhosHereCount = document.getElementById('presentation-whos-here-count');
    presentationWhosHereList = document.getElementById('presentation-whos-here-list');

    if (!modal) {
        console.error('[Presentation] Modal element #presentation-modal-overlay not found in DOM');
        return false;
    }

    return true;
}

/**
 * Returns the drag-drop bucket DOM element references for passing to dragAndDrop.setElements().
 */
export function getDragDropElements() {
    return {
        dragBucketsEl: document.getElementById('presentation-drag-buckets'),
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
    };
}

/**
 * Returns voice command DOM elements for passing to voiceCommandsUI.init().
 */
export function getVoiceCommandElements() {
    return {
        liveTranscriptionBtn: document.getElementById('live-toggle-transcription'),
        liveCaptionsBar: document.getElementById('live-captions-bar'),
        liveCaptionsText: document.getElementById('live-captions-text'),
        liveCaptionsStatusText: document.getElementById('live-captions-status-text'),
        liveCaptionsStatus: document.getElementById('live-captions-status'),
        voiceCommandToast: document.getElementById('voice-command-toast'),
        voiceCommandToastTitle: document.getElementById('voice-command-toast-title'),
        voiceCommandToastDesc: document.getElementById('voice-command-toast-desc'),
        voiceCommandToastCountdown: document.getElementById('voice-command-toast-countdown'),
        voiceCommandToastProgress: document.getElementById('voice-command-toast-progress'),
        voiceCommandUndoBtn: document.getElementById('voice-command-undo-btn'),
    };
}
