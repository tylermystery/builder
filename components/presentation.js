/**
 * Presentation View — Orchestrator
 *
 * Thin orchestrator that manages the presentation view lifecycle:
 *   - show/hide lifecycle
 *   - DOM element caching (via presState)
 *   - Module initialization and dependency injection wiring
 *   - Event listener setup (delegating to feature modules)
 *   - Plan sync coordination
 *
 * All feature logic lives in extracted modules under presentation/.
 * Phase 6 of the Presentation View Architecture Overhaul.
 */

import { state, setState, getRecordById, getAggregateReactions } from '../state.js';
import * as api from '../api.js';
import { CONSTANTS, EMOJI_TIERS, REACTION_SCORES, computeDemocraticAverage } from '../config.js';
import { updateUrl, getRecordPrice, parseOptions, flattenOptionGroups } from '../utils.js';
import { log } from '../utils/debug.js';
import { getCurrentUser, sendMessage as sendChatMessage } from '../chat.js';
import { triggerSave } from '../events.js';
import { showDetailModal, showGroupDetailModal, showCheckoutModal, getShopSettings } from './modal.js';
import { showWtfPlansPanel } from './wtfPlansPanel.js';
import { registerSyncCallback, unregisterSyncCallback } from '../utils/planStateSync.js';
import { showUserModal } from '../auth.js';
import { showToast } from '../ui.js';
import { applyCloudinaryTransform } from '../utils/imageOptimizer.js';
import { getComponentMessageReactions } from './forumPanel.js';
import { initializeToastNotifications } from './toastNotifications.js';
import { initializeUnifiedChatPanel, showUnifiedChatPanel, hideUnifiedChatPanel, setUCPGetCurrentUser, setUCPSendMessage } from './unifiedChatPanel.js';
import { initVitalityUI, cleanupVitalityUI, refreshFlowLines } from '../vitality/vitalityUI.js';
import { requestVitalityRecalc, recalculateVitality } from '../vitality/vitalityEngine.js';
import { openActionMenu, closeActionMenu, isActionMenuOpen, registerActionHandler } from './actionMenu.js';

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

// Phase 5 extracted modules
import * as reactions from './presentation/reactions.js';

// Phase 6 extracted modules
import * as presState from './presentation/presState.js';
import * as headerSummary from './presentation/headerSummary.js';

// Task status constants (re-exported from taskStatusManagement)
const { ELEMENT_TASK_STATUS, TASK_STATUS_CONFIG } = taskStatusManagement;

// Item images cache — proxied from itemRendering for modules that reference it
const itemImagesCache = {
    get: (...a) => itemRendering.getItemImagesCache().get(...a),
    set: (...a) => itemRendering.getItemImagesCache().set(...a),
    has: (...a) => itemRendering.getItemImagesCache().has(...a),
    clear: () => itemRendering.getItemImagesCache().clear()
};


// ============================================
// Plan Sync Handler
// ============================================

async function handlePlanSyncUpdate(changeType, summary, changeData) {
    switch (changeType) {
        case 'itemAdded':
        case 'itemRemoved':
        case 'itemUpdated':
            await itemRendering.renderAllItems();
            headerSummary.generateItemsSummary();
            headerSummary.updatePresentationHeaderTotal();
            headerSummary.updatePlanSummaryDashboard();
            break;
        case 'dateChanged':
            headerSummary.renderEventHeader();
            headerSummary.generateHeaderSummary();
            break;
        case 'detailsChanged':
        case 'fullRefresh':
        case 'sessionLoaded':
            headerSummary.renderEventHeader();
            await itemRendering.renderAllItems();
            initializeAccordions();
            headerSummary.updatePresentationHeaderTotal();
            headerSummary.updatePlanSummaryDashboard();
            break;
        default:
    }
}


// ============================================
// DOM Initialization & Module Wiring
// ============================================

function ensureDOMElements() {
    if (presState.getModal()) return true; // Already initialized

    // Cache all DOM element references via centralized state module
    if (!presState.cacheDOMElements()) {
        return false;
    }

    // Pass drag-drop bucket elements to dragAndDrop module
    dragAndDrop.setElements(presState.getDragDropElements());

    // --- Initialize all extracted modules with their dependencies ---

    backgroundEngine.init({
        getState: () => state,
        getModal: () => presState.getModal()
    });

    collaboratorsModule.init({
        updateAccountButton: () => headerSummary.updatePresentationAccountButton(),
        elements: presState.getCollaboratorsElements()
    });

    reactionRankings.init({
        getState: () => state,
        getItemReactionCount: reactions.getItemReactionCount,
        getItemReactionScore: reactions.getItemReactionScore,
    });

    accordions.init({
        getModal: () => presState.getModal(),
        getToggleAllBtn: () => presState.getSearchElements().presentationToggleAllBtn,
    });

    planFocus.init({
        renderPresentationHeader: () => headerSummary.renderPresentationHeader(),
        renderEventHeader: () => headerSummary.renderEventHeader(),
        escapeHtml: (text) => presentationChat.escapeHtml(text),
        elements: presState.getPlanFocusElements()
    });

    voiceCommandsUI.init({
        elements: presState.getVoiceCommandElements()
    });

    // Phase 2 modules
    emojiPicker.init({
        getReactionScore: reactions.getReactionScore,
        renderReactions: reactions.renderReactions,
        updateItemEmojiIndicator: reactions.updateItemEmojiIndicator,
        updateReactionZoneSummary: (recordId) => reactionSummaryBar.updateReactionZoneSummary(recordId),
        updateEventEmojiIndicator: reactions.updateEventEmojiIndicator,
        getPresentationChatChannel: () => presentationChat.getChannel(),
    });

    sentimentPopup.init({
        getItemReactionScore: reactions.getItemReactionScore,
        getItemReactionCount: reactions.getItemReactionCount,
        getItemSummaryEmoji: reactions.getItemSummaryEmoji,
    });

    searchModal.init({
        elements: presState.getSearchElements(),
        toggleAllItemAccordions: accordions.toggleAllItemAccordions,
        toggleArchivedItems: () => itemRendering.toggleArchivedItems(),
        toggleCompletedItems: () => itemRendering.toggleCompletedItems(),
        renderAllItems: () => itemRendering.renderAllItems(),
    });

    // Phase 3 modules
    presentationChat.init({
        elements: presState.getChatElements(),
        getAccordionState: accordions.getAccordionState,
        renderReactions: reactions.renderReactions,
        updateItemEmojiIndicator: reactions.updateItemEmojiIndicator,
        updateReactionZoneSummary: (recordId) => reactionSummaryBar.updateReactionZoneSummary(recordId),
        updateEventEmojiIndicator: reactions.updateEventEmojiIndicator,
        updateLiveStreamToolbarUI: () => liveStreamToolbar.updateLiveStreamToolbarUI(),
        updatePresentationLiveBadge: () => liveStreamToolbar.updatePresentationLiveBadge(),
        spawnHostReactionOverlay: (emoji) => liveStreamToolbar.spawnHostReactionOverlay(emoji),
        loadComponentComments: (componentId) => componentComments.loadComponentComments(componentId),
        updateCommentReactionsDisplay: (commentEl, _reactions) => componentComments.updateCommentReactionsDisplay(commentEl, _reactions),
    });

    componentComments.init({
        getRecordById,
        escapeHtml: presentationChat.escapeHtml,
        addImageToItemCarousel: (recordId, imageUrl) => itemRendering.addImageToItemCarousel(recordId, imageUrl),
        addPresentationMessageToUI: presentationChat.addPresentationMessageToUI,
        getChannel: () => presentationChat.getChannel(),
        getChatMessagesEl: () => presState.getChatElements().chatMessagesEl,
        saveCommentTaskLink: (commentId, taskId) => taskStatusManagement.saveCommentTaskLink(commentId, taskId),
    });

    liveStreamToolbar.init({
        elements: presState.getLiveStreamElements(),
        getChannel: () => presentationChat.getChannel(),
    });

    // Phase 4A modules — shared dependency bundle
    const phase4ADeps = {
        getState: () => state,
        getRecordById,
        getAggregateReactions,
        getRecordPrice,
        parseOptions,
        flattenOptionGroups,
        computeDemocraticAverage,
        api,
        escapeHtml: (text) => presentationChat.escapeHtml(text),
        showToast,
        showDetailModal,
        showGroupDetailModal,
        applyCloudinaryTransform,
        getCurrentUser,
        selectEmoji: (recordId, emoji) => emojiPicker.selectEmoji(recordId, emoji),
        getItemReactionCount: reactions.getItemReactionCount,
        getItemSummaryEmoji: reactions.getItemSummaryEmoji,
        getItemReactionScore: reactions.getItemReactionScore,
        getComponentMessageReactions,
        isItemCombinedSource: (id) => mergeSystem.isItemCombinedSource(id),
        getCombinedSources: (id) => mergeSystem.getCombinedSources(id),
        getCombinedHybridData: (id) => mergeSystem.getCombinedHybridData(id),
        getItemGroup: (id) => mergeSystem.getItemGroup(id),
        getElementTaskStatus: (type, id) => taskStatusManagement.getElementTaskStatus(type, id),
        renderTaskStatusButton: (type, id) => taskStatusManagement.renderTaskStatusButton(type, id),
        TASK_STATUS_CONFIG,
        ELEMENT_TASK_STATUS,
        EMOJI_TIERS,
        REACTION_SCORES,
        reactionRankings,
        componentComments,
        planFocus,
        triggerSave,
        openGroupDetailModal: (groupId) => mergeSystem.openGroupDetailModal(groupId),
        dissolveGroup: (groupId) => mergeSystem.dissolveGroup(groupId),
        uncombineAll: (targetId) => mergeSystem.uncombineAll(targetId),
        requestVitalityRecalc,
        recalculateVitality,
        refreshFlowLines,
        showUnifiedChatPanel,
        openConversationForItem: (recordId) => cardInteractions.openConversationForItem(recordId),
        getItineraryItemsListEl: () => presState.getItineraryItemsListEl(),
        updatePresentationHeaderTotal: () => headerSummary.updatePresentationHeaderTotal(),
        itemImagesCache,
        hidePresentationView,
        onAfterRenderAllItems: () => {
            cardInteractions.initializeCompactCardClicks();
            reactionSummaryBar.initializeReactionZones();
            reactionRankings.renderReactionsSummary();
            reactions.updateEventEmojiIndicator();
            dragAndDrop.initializeItemDragDrop().catch(err => {
                console.error('[Presentation] initializeItemDragDrop error:', err);
            });
            dragAndDrop.initializeRadialMenu();
            dragAndDrop.attachRadialMenuListeners();
            registerActionHandler(dragAndDrop.handleActionMenuAction);
            headerSummary.updatePlanSummaryDashboard();
            setTimeout(() => { recalculateVitality(); }, 0);
        },
    };

    itemRendering.init(phase4ADeps);
    reactionSummaryBar.init(phase4ADeps);
    cardInteractions.init(phase4ADeps);
    itemActions.init({
        ...phase4ADeps,
        renderAllItems: () => itemRendering.renderAllItems(),
        generateItemsSummary: () => headerSummary.generateItemsSummary(),
        updatePlanSummaryDashboard: () => headerSummary.updatePlanSummaryDashboard(),
    });

    // Phase 5: Reactions module
    reactions.init({
        reactionRankings,
        getChannel: () => presentationChat.getChannel(),
        updateReactionZoneSummary: (recordId) => reactionSummaryBar.updateReactionZoneSummary(recordId),
        showExpandedEmojiPicker: (recordId, anchorEl) => emojiPicker.showExpandedEmojiPicker(recordId, anchorEl),
    });

    // Phase 4B: Drag-and-drop system
    dragAndDrop.init({
        getState: () => state,
        getItineraryItemsListEl: () => presState.getItineraryItemsListEl(),
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
        renderAllItems: () => itemRendering.renderAllItems(),
        generateItemsSummary: () => headerSummary.generateItemsSummary(),
        updatePresentationHeaderTotal: () => headerSummary.updatePresentationHeaderTotal(),
        scheduleRenderAllItems: () => itemRendering.scheduleRenderAllItems(),
        getRecordPrice,
        itemImagesCache,
        getItineraryItemsListEl: () => presState.getItineraryItemsListEl(),
        elements: presState.getPendingMergeElements() || {}
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

    // Phase 6: Header summary module
    headerSummary.init({
        renderTaskStatusButton: (type, id) => taskStatusManagement.renderTaskStatusButton(type, id),
        escapeHtml: (text) => presentationChat.escapeHtml(text),
        getPresState: () => presState,
        renderCollaborators: () => collaboratorsModule.renderCollaborators(),
        getPresentationChatPusher: () => presentationChat.getPusher(),
        initializePresentationChat: () => presentationChat.initializePresentationChat(),
    });

    log('Presentation', 'DOM elements initialized for itinerary view');
    return true;
}


// ============================================
// Accordion wrapper (combines module + summary generation)
// ============================================

function initializeAccordions() {
    accordions.initializeAccordions();
    headerSummary.generateHeaderSummary();
    headerSummary.generateItemsSummary();
}


// ============================================
// Lifecycle: Show / Hide
// ============================================

function handleKeyDown(e) {
    if (e.key === 'Escape') {
        updateUrl({ view: null });
        hidePresentationView();
    }
}

export async function showPresentationView(listType, startRecordId = null) {
    log('Presentation', 'Showing itinerary presentation');

    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot show presentation view - DOM elements not available');
        return;
    }

    const modal = presState.getModal();

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
            console.error('[Presentation] Error loading permissions:', error);
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

    // Initialize the Universal Vitality UI system
    initVitalityUI();

    // Fetch tasks for this project if not already loaded
    const projectId = state.session.id;
    if (projectId && !state.tasks.byProject.has(projectId)) {
        try {
            const tasks = await api.fetchTasks(projectId);
            if (Array.isArray(tasks)) {
                tasks.forEach(task => {
                    state.tasks.all.set(task.id, task);
                });
                state.tasks.byProject.set(projectId, tasks);
                taskStatusManagement.loadCommentTaskLinks();
                window.dispatchEvent(new CustomEvent('tasks-state-updated'));
            }
        } catch (error) {
            console.error('[Presentation] Error fetching tasks:', error);
        }
    } else {
        taskStatusManagement.loadCommentTaskLinks();
        window.dispatchEvent(new CustomEvent('tasks-state-updated'));
    }

    // Mark that catalog will need rendering when exiting presentation view
    presState.setCatalogNeedsRender(true);

    // Clear image cache and comments cache for fresh load
    itemImagesCache.clear();
    componentComments.getCache().clear();

    // Load task statuses from session state
    taskStatusManagement.loadElementTaskStatuses();

    // Render presentation header
    headerSummary.renderPresentationHeader();

    // Initialize click handler for sentiment popup on emoji indicator
    sentimentPopup.initializeEventEmojiClickHandler();

    // Update the running total cost in the header
    headerSummary.updatePresentationHeaderTotal();

    // Render all sections
    headerSummary.renderEventHeader();
    collaboratorsModule.renderCollaborators();
    await rsvpSection.renderRsvpSection();
    await itemRendering.renderAllItems();

    // Render goal chips in header and set up regenerate button
    planFocus.renderGoalChips();
    planFocus.initializeHandlers();

    // Initialize accordions and generate summaries
    initializeAccordions();

    // Update the plan summary dashboard
    headerSummary.updatePlanSummaryDashboard();

    // Show modal — let CSS handle display via .active class
    document.body.classList.remove('presentation-loading');
    document.documentElement.classList.remove('presentation-loading');

    modal.classList.add('active');
    modal.style.display = '';
    document.body.classList.add('modal-open');
    document.body.classList.add('presentation-active');
    document.documentElement.classList.add('presentation-active');

    document.addEventListener('keydown', handleKeyDown);

    // Show drag buckets
    dragAndDrop.activateBuckets();

    // Start the background animation
    backgroundEngine.startAnimation();

    // Load comment counts in background (non-blocking)
    componentComments.loadAllCommentCounts();

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
    mergeSystem.initializeMergeDialogListeners();

    // Initialize live stream toolbar
    liveStreamToolbar.initializeLiveStreamToolbar();

    // If user joined from the viewer page, show stream strip in viewer mode
    if (state.stream.joinedFromViewer) {
        log('Presentation', 'User joined from viewer page — showing stream strip in viewer mode');
        liveStreamToolbar.updateLiveStreamToolbarUI();
    }

    log('Presentation', 'Itinerary view rendered successfully');
}

export function hidePresentationView() {
    const modal = presState.getModal();
    if (!modal) return;

    // Unregister sync callback
    unregisterSyncCallback('presentation');

    // Clean up Vitality UI
    cleanupVitalityUI();

    // Clean up live stream toolbar
    liveStreamToolbar.cleanupLiveStreamToolbar();

    // Reset joinedFromViewer flag
    if (state.stream.joinedFromViewer) {
        setState({ stream: { ...state.stream, joinedFromViewer: false } });
    }

    // Hide the Unified Chat Panel
    hideUnifiedChatPanel();

    // Stop the background animation
    backgroundEngine.stopAnimation();

    // Hide collaborators modal if open
    collaboratorsModule.hideCollaboratorsModal();

    // Cleanup drag-drop functionality
    dragAndDrop.cleanup();

    // Exit merge mode if active
    mergeSystem.exitMergeMode();

    // Close action menu if open
    if (isActionMenuOpen()) {
        closeActionMenu();
    }

    modal.classList.remove('active');
    modal.style.display = '';
    document.body.classList.remove('modal-open');
    document.body.classList.remove('presentation-active');
    document.documentElement.classList.remove('presentation-active');
    document.removeEventListener('keydown', handleKeyDown);

    // Trigger catalog render if needed
    if (presState.getCatalogNeedsRender() && typeof window.applyFiltersAndSort === 'function') {
        log('Presentation', 'Triggering catalog render after exiting presentation view');
        setTimeout(() => {
            window.applyFiltersAndSort(window.imageCache);
        }, 50);
        presState.setCatalogNeedsRender(false);
    }
}


// ============================================
// Event Listener Setup
// ============================================

export function setupPresentationEventListeners() {
    if (!ensureDOMElements()) {
        console.error('[Presentation] Cannot setup event listeners - DOM elements not available');
        return;
    }

    const modal = presState.getModal();
    const closeBtn = presState.getCloseBtn();
    const itineraryItemsListEl = presState.getItineraryItemsListEl();
    const presentationBackBtn = presState.getPresentationBackBtn();
    const collaboratorsAddShareBtn = presState.getCollaboratorsAddShareBtn();
    const presentationAccountBtn = presState.getPresentationAccountBtn();
    const collaboratorsModalClose = presState.getCollaboratorsModalClose();
    const collaboratorsModal = presState.getCollaboratorsModal();

    // Listen for user login/logout events
    document.addEventListener('userLoggedIn', () => headerSummary.handlePresentationUserLogin());
    document.addEventListener('userLoggedOut', () => headerSummary.updatePresentationAccountButton());

    // Listen for navigateToCatalog event
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

    // Presentation header hamburger button (opens WTF Plans panel)
    if (presentationBackBtn) {
        presentationBackBtn.addEventListener('click', () => {
            showWtfPlansPanel();
        });
    }

    // Presentation header total button (opens checkout modal)
    const presentationHeaderTotalBtn = document.getElementById('presentation-header-total');
    if (presentationHeaderTotalBtn) {
        presentationHeaderTotalBtn.addEventListener('click', () => {
            if (presentationHeaderTotalBtn.textContent.trim()) {
                const shopSettings = getShopSettings();
                showCheckoutModal(shopSettings);
            }
        });
    }

    // Handle accordion header clicks
    const scrollContainer = modal.querySelector('.presentation-itinerary-scroll');
    if (scrollContainer) {
        scrollContainer.addEventListener('click', (e) => {
            let accordionHeader = e.target.closest('.itinerary-accordion-header');
            if (!accordionHeader) {
                accordionHeader = e.target.closest('.sub-accordion-header');
            }
            if (!accordionHeader) return;

            // Don't trigger accordion on interactive elements inside
            if (e.target.closest('button') || e.target.closest('a') || e.target.closest('input')) return;

            const section = accordionHeader.dataset.section;
            if (section) {
                accordions.toggleAccordion(section);
            }
        });
    }

    // Delegated click handlers on itinerary items list
    itineraryItemsListEl.addEventListener('click', (e) => cardInteractions.handleThumbnailClick(e));
    itineraryItemsListEl.addEventListener('click', reactions.handleReactionClick);
    itineraryItemsListEl.addEventListener('click', accordions.handleItemAccordionClick);
    itineraryItemsListEl.addEventListener('click', (e) => cardInteractions.handleItemClick(e));
    itineraryItemsListEl.addEventListener('click', (e) => cardInteractions.handleExpandButtonClick(e));
    itineraryItemsListEl.addEventListener('click', (e) => cardInteractions.handleSuggestionClick(e));

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
    itineraryItemsListEl.addEventListener('click', (e) => componentComments.handleComponentCommentsClick(e));
    itineraryItemsListEl.addEventListener('keydown', (e) => componentComments.handleComponentCommentsKeydown(e));
    itineraryItemsListEl.addEventListener('change', (e) => componentComments.handleCommentImageInputChange(e));

    // Handle task status button clicks on items
    itineraryItemsListEl.addEventListener('click', (e) => taskStatusManagement.handleTaskStatusClick(e));

    // Handle group dissolved events from modal
    window.addEventListener('groupDissolved', async (e) => {
        log('Presentation', `Group dissolved from modal: ${e.detail?.groupId}`);
        await itemRendering.renderAllItems();
        headerSummary.generateItemsSummary();
        headerSummary.updatePresentationHeaderTotal();
        triggerSave();
    });

    // Handle individual item removed from group via modal
    window.addEventListener('groupItemRemoved', async (e) => {
        log('Presentation', `Item removed from group via modal: ${e.detail?.recordId} from ${e.detail?.groupId}`);
        await itemRendering.renderAllItems();
        headerSummary.generateItemsSummary();
        headerSummary.updatePresentationHeaderTotal();
        triggerSave();
    });

    // Handle task status button clicks on event details (date, goals, etc.)
    const headerAccordionContent = modal.querySelector('.itinerary-header .itinerary-accordion-content');
    if (headerAccordionContent) {
        headerAccordionContent.addEventListener('click', (e) => taskStatusManagement.handleTaskStatusClick(e));
        headerAccordionContent.addEventListener('click', (e) => rsvpSection.handleRsvpClick(e, modal));
    }

    // Also add RSVP click handler to the RSVP section directly
    const rsvpSectionEl = document.getElementById('presentation-rsvp-section');
    if (rsvpSectionEl) {
        rsvpSectionEl.addEventListener('click', (e) => rsvpSection.handleRsvpClick(e, modal));
    }

    // Collaborators add/share button
    if (collaboratorsAddShareBtn) {
        collaboratorsAddShareBtn.addEventListener('click', () => {
            if (state.session.user.isAuthenticated) {
                collaboratorsModule.showInviteModal();
            } else {
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

    // Account button — opens user profile modal
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
