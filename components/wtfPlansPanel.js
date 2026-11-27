// FILE: components/wtfPlansPanel.js
// WTF Plans Panel - Master view for all user's plans, RSVPs, favorites, and projects
// Similar UX to chat lists with sorting by most recent

import { state, setState } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import { getTempLikes, updateUrl, getShopUrlParam } from '../utils.js';
import { showDetailModal } from './modal.js';
import { CONSTANTS } from '../config.js';
import { registerSyncCallback, getPlanSummary } from '../utils/planStateSync.js';
import { getOpenConversationSnapshot, readSavedOpenConversations, describeOpenCounts } from '../utils/openConversations.js';

// Filter types for the WTF Plans panel
export const WTF_PLAN_TYPES = {
    ALL: 'all',
    PLANS: 'plans',      // Sessions successfully shared (1+ collaborators or has RSVPs)
    DRAFTS: 'drafts',    // Sessions not yet shared (only creator, no RSVPs)
    RSVPS: 'rsvps',      // Public events and guest invites
    FAVORITES: 'favorites', // Liked items
    PROJECTS: 'projects',   // Projects/sessions owned
    SHARED: 'shared',       // Plans the user opened via a link but never created/edited
    STORE: 'store',         // Plans made for the user's store (store owners only)
    ARCHIVED: 'archived'    // Archived plans (hidden everywhere else until restored)
};

// Local state for the panel
let wtfPlansData = {
    plans: [],      // Shared plans (has collaborators or RSVPs)
    drafts: [],     // Unshared plans (only creator)
    rsvps: [],
    favorites: [],
    projects: [],
    shared: [],     // Plans shared with the user that they haven't created or edited
    store: [],      // Store plans (store owners) that aren't the owner's personal plans
    archived: []    // Archived plans (restorable from the Archived filter)
};
let currentFilter = WTF_PLAN_TYPES.PLANS;
let isLoading = false;

// "Shared with me" is part of Plans now. Old links/history that ask for it open Plans.
function normalizeFilter(filter) {
    return filter === WTF_PLAN_TYPES.SHARED ? WTF_PLAN_TYPES.PLANS : filter;
}

// Collaborative plans show a handshake; ones someone else created also say "from <name>".
const SHARED_PLAN_ICON = '🤝';
const creatorNames = new Map(); // userId -> display name (cached across renders)

/** Who created a plan (live data for the open plan, saved activity otherwise). */
function getPlanCreatorId(plan, isCurrentSession) {
    if (isCurrentSession) {
        return state.session.planActivity?.createdBy || (state.session.loadedCollaborators || [])[0] || null;
    }
    return getPlanActivity(plan)?.createdBy || (plan?.fields?.Collaborators || [])[0] || null;
}

/** Look up names for creators of other people's plans, then re-render once they arrive. */
async function loadCreatorNames() {
    const me = state.session.user.isAuthenticated ? state.session.user.id : null;
    if (!me) return;
    const ids = new Set();
    for (const plan of [...wtfPlansData.plans, ...wtfPlansData.shared]) {
        const id = getPlanCreatorId(plan, plan.id === state.session.id);
        if (id && id !== me && typeof id === 'string' && id.startsWith('rec') && !creatorNames.has(id)) ids.add(id);
    }
    if (ids.size === 0) return;
    try {
        const names = await api.fetchUserNamesByIds([...ids]);
        names.forEach((name, id) => creatorNames.set(id, name));
        if (names.size > 0 && isWtfPlansPanelOpen() && !isLoading) renderWtfPlansList();
    } catch { /* names are a nicety; the list still works without them */ }
}

// Multi-select state (long-press a plan or use "Select" to archive/delete several)
const SELECTABLE_PLAN_TYPES = new Set(['plan', 'draft', 'shared', 'store', 'archived']);
const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 10;

let selectMode = false;
let bulkActionInProgress = false;
let suppressNextClick = false;
const selectedPlans = new Map(); // id -> list item


// ---- localStorage-backed recent plans tracking ----
const RECENT_PLANS_KEY = 'wtf_recent_plan_ids';
const MAX_RECENT_PLANS = 50;

/**
 * Get recently visited/created plan session IDs from localStorage
 * @returns {string[]} Array of session IDs (most recent first)
 */
function getRecentPlanIds() {
    try {
        const raw = localStorage.getItem(RECENT_PLANS_KEY);
        if (!raw) return [];
        const ids = JSON.parse(raw);
        return Array.isArray(ids) ? ids : [];
    } catch {
        return [];
    }
}

/**
 * Track a plan session ID in localStorage so it persists across page loads.
 * Moves the ID to the front if already present.
 * @param {string} sessionId - The session ID to track
 */
export function untrackRecentPlan(sessionId) {
    if (!sessionId) return;
    try {
        const ids = getRecentPlanIds().filter(id => id !== sessionId);
        localStorage.setItem(RECENT_PLANS_KEY, JSON.stringify(ids));
    } catch (e) {
        console.warn('[WTF-PLANS] Could not update recent plans in localStorage:', e);
    }
}

/** True when the user chose "Leave Plan" on this plan. */
function hasLeftPlan(plan, userId) {
    if (!userId) return false;
    try {
        const raw = plan?.fields?.['Items with Variations'];
        if (!raw || !raw.includes('leftCollaborators')) return false;
        const left = JSON.parse(raw).leftCollaborators;
        return Array.isArray(left) && left.includes(userId);
    } catch {
        return false;
    }
}

export function trackRecentPlan(sessionId) {
    if (!sessionId) return;
    try {
        let ids = getRecentPlanIds();
        // Remove if already present (will re-add at front)
        ids = ids.filter(id => id !== sessionId);
        ids.unshift(sessionId);
        // Cap the list
        if (ids.length > MAX_RECENT_PLANS) ids = ids.slice(0, MAX_RECENT_PLANS);
        localStorage.setItem(RECENT_PLANS_KEY, JSON.stringify(ids));
        console.log(`[WTF-PLANS] Tracked recent plan: ${sessionId} (total tracked: ${ids.length})`);
    } catch (e) {
        console.warn('[WTF-PLANS] Could not persist recent plan to localStorage:', e);
    }
}

// ---- Plan activity helpers (creator / editors / last edited) ----
const planActivityCache = new WeakMap();

// Plans the signed-in user took part in by chatting: sessionId -> ISO time of their latest
// message. Loaded from their messages with the list, and updated live when they send one.
let chatParticipation = new Map();
let chatParticipationUserId = null;
const MAX_PARTICIPATION_FETCH = 40;

function hasChatParticipation(planId) {
    const userId = state.session.user.isAuthenticated ? state.session.user.id : null;
    return !!(userId && chatParticipationUserId === userId && chatParticipation.has(planId));
}

/**
 * Read the `planActivity` block stored in a plan's session JSON.
 * @param {Object} plan - Session record
 * @returns {Object|null} { createdBy, editors, lastEditedAt, lastEditedBy } or null
 */
function getPlanActivity(plan) {
    if (!plan || typeof plan !== 'object') return null;
    if (planActivityCache.has(plan)) return planActivityCache.get(plan);
    let activity = null;
    try {
        const raw = plan.fields?.['Items with Variations'];
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && parsed.planActivity && typeof parsed.planActivity === 'object') {
                activity = parsed.planActivity;
            }
        }
    } catch {
        activity = null;
    }
    planActivityCache.set(plan, activity);
    return activity;
}

/**
 * Whether the user created or edited this plan (i.e. it is "theirs").
 * Plans saved before edit tracking fall back to the first collaborator being the creator.
 */
function isPersonalPlan(plan, userId) {
    if (!userId) return true;
    // Chatting in a plan is taking part in it, so it belongs in the user's own list.
    if (hasChatParticipation(plan.id)) return true;
    const activity = getPlanActivity(plan);
    if (activity) {
        if (activity.createdBy === userId) return true;
        if (Array.isArray(activity.editors) && activity.editors.includes(userId)) return true;
        if (activity.createdBy) return false;
    }
    const collaborators = plan.fields?.Collaborators || [];
    return collaborators[0] === userId;
}

/** Whether a plan belongs to the store the current user owns. */
function isOwnedStorePlan(plan) {
    const user = state.session.user;
    if (!user.isOwner || !user.ownedStoreId) return false;
    const stores = plan.fields?.Stores || [];
    return Array.isArray(stores) ? stores.includes(user.ownedStoreId) : stores === user.ownedStoreId;
}

/** Timestamp used for sorting/"time ago": last edit, falling back to creation. */
function getPlanActivityTime(plan) {
    const edited = getPlanActivity(plan)?.lastEditedAt || plan.createdTime;
    const chatted = hasChatParticipation(plan.id) ? chatParticipation.get(plan.id) : null;
    if (!chatted) return edited;
    if (!edited) return chatted;
    return Date.parse(chatted) > Date.parse(edited) ? chatted : edited;
}

/**
 * Normalize a date value to YYYY-MM-DD format for consistent display
 * @param {*} dateValue - Date in various formats (string, Date, array)
 * @returns {string|null} - Date in YYYY-MM-DD format or null if invalid
 */
function normalizeDateToYYYYMMDD(dateValue) {
    if (!dateValue) return null;

    try {
        // Handle arrays (eventDetails sometimes stores dates as arrays)
        const rawDate = Array.isArray(dateValue) ? dateValue[0] : dateValue;
        if (!rawDate) return null;

        // If it's already in YYYY-MM-DD format, return as-is
        if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
            return rawDate;
        }

        // Parse the date and extract YYYY-MM-DD
        const dateObj = new Date(rawDate);
        if (isNaN(dateObj.getTime())) {
            return null;
        }

        // Format as YYYY-MM-DD
        return dateObj.toISOString().split('T')[0];
    } catch (e) {
        console.warn('Could not normalize date:', dateValue, e);
        return null;
    }
}

/**
 * Build a plan item from the current live session state
 * @returns {Object|null} Plan item representing current session, or null if no session active
 */
function buildCurrentSessionItem() {
    const currentSessionId = state.session.id;
    if (!currentSessionId) return null;

    // Get live plan summary from state
    const summary = getPlanSummary();

    // Calculate total items in the locked plan
    const lockedItemsCount = state.cart.lockedItems.size;

    // Get event details from live state
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
    const eventDateRaw = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);

    // Normalize the date to YYYY-MM-DD format for consistent display
    const eventDate = normalizeDateToYYYYMMDD(eventDateRaw);

    return {
        type: 'plan',
        id: currentSessionId,
        name: eventName || 'Current Plan',
        date: eventDate,
        createdTime: new Date().toISOString(), // Use now to sort to top
        itemCount: lockedItemsCount,
        totalCost: summary.subtotal || 0,
        icon: '📋',
        // Live count once this plan's messages/tasks are loaded, otherwise the saved snapshot
        openConversations: getOpenConversationSnapshot() ||
            readSavedOpenConversations({ openConversations: state.session.openConversationsSnapshot }),
        isCurrentSession: true, // Flag to identify this as the live session
        data: {
            id: currentSessionId,
            fields: {
                Name: eventName || 'Current Plan',
                Date: eventDate,
                Items: Array(lockedItemsCount).fill(null), // Placeholder for count
                TotalCost: summary.subtotal
            },
            createdTime: new Date().toISOString()
        }
    };
}

/**
 * Initialize the WTF Plans panel
 * Sets up event listeners for filters, close button, and overlay
 */
export function initializeWtfPlansPanel() {
    log('WtfPlansPanel', 'Initializing WTF Plans panel...');

    const panel = document.getElementById('wtf-plans-panel');
    const closeBtn = document.getElementById('wtf-plans-panel-close');
    const overlay = document.getElementById('wtf-plans-panel-overlay');
    const filterBtns = document.querySelectorAll('.wtf-plans-filter-btn');

    // Close button handler
    if (closeBtn) {
        closeBtn.addEventListener('click', hideWtfPlansPanel);
    }

    // Overlay click handler (close panel)
    if (overlay) {
        overlay.addEventListener('click', hideWtfPlansPanel);
    }

    // Browse Catalog button handler (navigates back to catalog view)
    const browseCatalogBtn = document.getElementById('wtf-plans-browse-catalog-btn');
    if (browseCatalogBtn) {
        browseCatalogBtn.addEventListener('click', () => {
            log('WtfPlansPanel', 'Browse Catalog clicked — navigating to catalog view');
            document.body.dataset.workspaceSurface = 'center';
            document.dispatchEvent(new CustomEvent('workspace-surface-changed'));
            // Remove the view=present param to exit presentation mode
            updateUrl({ view: null });
            // Dispatch a custom event that presentation.js can listen for to hide itself
            // This avoids circular imports while cleanly exiting presentation view
            document.dispatchEvent(new CustomEvent('navigateToCatalog'));
        });
    }

    // Filter button handlers
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const filter = btn.dataset.filter;
            setWtfPlansFilter(filter);

            // Update active state
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            closeMoreMenu();
        });
    });

    initMoreMenu();

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.body.classList.contains('workspace-ready') && panel && panel.classList.contains('open')) {
            hideWtfPlansPanel();
        }
    });

    // Register for plan state sync to update the current session in the list in real-time
    registerSyncCallback('wtfPlansPanel', handlePlanStateSync);

    // The user sent a message in a plan: it is theirs now, even before the list re-fetches.
    window.addEventListener('plan-participation', (event) => {
        const { sessionId, userId, at } = event.detail || {};
        if (!sessionId || !userId) return;
        if (chatParticipationUserId !== userId) {
            chatParticipation = new Map();
            chatParticipationUserId = userId;
        }
        const isNew = !chatParticipation.has(sessionId);
        chatParticipation.set(sessionId, at || new Date().toISOString());
        trackRecentPlan(sessionId);
        if (isNew && isWtfPlansPanelOpen() && !isLoading) {
            // Move it out of "Shared with me" without waiting for a re-fetch.
            for (const key of ['shared', 'store']) {
                const idx = wtfPlansData[key].findIndex(p => p.id === sessionId);
                if (idx === -1) continue;
                const [plan] = wtfPlansData[key].splice(idx, 1);
                (isPlanShared(plan, userId) ? wtfPlansData.plans : wtfPlansData.drafts).push(plan);
            }
            renderWtfPlansList();
        }
    });

    // Keep the open plan's chat/task count current while the list is showing.
    // Re-render only when that number actually changes.
    let lastLiveOpenKey = null;
    window.addEventListener('open-conversations-updated', () => {
        const live = getOpenConversationSnapshot();
        const key = live ? `${state.session.id}:${live.chats}:${live.tasks}` : null;
        if (!key || key === lastLiveOpenKey) return;
        lastLiveOpenKey = key;
        if (isWtfPlansPanelOpen() && !isLoading) renderWtfPlansList();
    });

    initPlanSelection();

    log('WtfPlansPanel', 'WTF Plans panel initialized.');
}

/**
 * Handle plan state sync events to update the current session in the list
 * @param {string} changeType - Type of change
 * @param {Object} summary - Plan summary data
 * @param {Object} changeData - Additional change data
 */
function handlePlanStateSync(changeType, summary, changeData) {
    // Only re-render if the panel is open
    const panel = document.getElementById('wtf-plans-panel');
    if (!panel || !panel.classList.contains('open')) {
        return;
    }

    log('WtfPlansPanel', `Received sync event: ${changeType}`, summary);

    // Re-render the list to show updated current session data
    renderWtfPlansList();
}

/**
 * Show the WTF Plans panel with slide-in animation
 * Fetches data if authenticated
 * @param {Object} options - Options for showing the panel
 * @param {boolean} options.skipPushState - If true, don't push to browser history (used by popstate handler)
 * @param {string} options.filter - Optional filter to set (used when restoring from URL)
 */
export async function showWtfPlansPanel(options = {}) {
    const { skipPushState = false } = options;
    const filter = options.filter ? normalizeFilter(options.filter) : null;
    const panel = document.getElementById('wtf-plans-panel');
    const overlay = document.getElementById('wtf-plans-panel-overlay');
    const isPresentationActive = document.body.classList.contains('presentation-active');

    console.log('[PRES-MENU DEBUG] showWtfPlansPanel called:', {
        panelExists: !!panel,
        overlayExists: !!overlay,
        isPresentationActive,
        panelCurrentDisplay: panel?.style.display,
        panelComputedDisplay: panel ? getComputedStyle(panel).display : 'N/A',
        panelComputedZIndex: panel ? getComputedStyle(panel).zIndex : 'N/A',
        options
    });

    document.dispatchEvent(new CustomEvent('workspace-panel-opening', { detail: { surface: 'left', panel: 'plans' } }));
    if (panel) {
        panel.style.display = 'flex';
        // Trigger reflow for animation
        panel.offsetHeight;
        panel.classList.add('open');

        // Show/hide Browse Catalog button based on whether we're in presentation view
        const browseCatalogBar = panel.querySelector('.wtf-plans-browse-catalog-bar');
        if (browseCatalogBar) {
            browseCatalogBar.style.display = isPresentationActive ? 'block' : 'none';
        }

        // Debug: check if display was actually applied (CSS !important can override inline styles)
        const computedDisplay = getComputedStyle(panel).display;
        const computedZIndex = getComputedStyle(panel).zIndex;
        const computedTransform = getComputedStyle(panel).transform;
        console.log('[PRES-MENU DEBUG] Panel after style.display=flex:', {
            inlineDisplay: panel.style.display,
            computedDisplay,
            computedZIndex,
            computedTransform,
            hasOpenClass: panel.classList.contains('open'),
            boundingRect: panel.getBoundingClientRect(),
            displayOverridden: computedDisplay === 'none',
        });
        if (computedDisplay === 'none') {
            console.error('[PRES-MENU DEBUG] CRITICAL: Panel display is "none" after setting inline style! A CSS rule with !important is overriding the panel visibility. Check for "body.presentation-active #wtf-plans-panel { display: none !important }" in stylesheets.');
        }
    } else {
        console.error('[PRES-MENU DEBUG] #wtf-plans-panel element NOT FOUND in DOM');
    }

    if (overlay) {
        overlay.classList.add('visible');
        console.log('[PRES-MENU DEBUG] Overlay after adding visible class:', {
            computedDisplay: getComputedStyle(overlay).display,
            computedZIndex: getComputedStyle(overlay).zIndex,
        });
    }

    // Add wtfPlans=open to URL for browser history support (unless restoring from popstate)
    if (!skipPushState) {
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('wtfPlans', 'open');
        if (filter) {
            currentUrl.searchParams.set('wtfFilter', filter);
        }
        window.history.pushState({ wtfPlans: 'open' }, '', currentUrl.toString());
        log('WtfPlansPanel', 'Pushed wtfPlans=open to history');
    }

    // Set filter if specified (from URL restore)
    if (filter && Object.values(WTF_PLAN_TYPES).includes(filter)) {
        currentFilter = filter;
        // Update active state on filter buttons
        const filterBtns = document.querySelectorAll('.wtf-plans-filter-btn');
        filterBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
    }

    // Fetch data
    await loadWtfPlansData();

    log('WtfPlansPanel', 'WTF Plans panel opened.');
}

/**
 * Hide the WTF Plans panel with slide-out animation
 * @param {Object} options - Options for hiding the panel
 * @param {boolean} options.skipPushState - If true, don't push to browser history (used when navigating to a plan)
 */
export function hideWtfPlansPanel(options = {}) {
    exitSelectMode();
    closeMoreMenu();
    const { skipPushState = false } = options;
    const panel = document.getElementById('wtf-plans-panel');
    const overlay = document.getElementById('wtf-plans-panel-overlay');

    console.log('[PRES-MENU DEBUG] hideWtfPlansPanel called:', {
        panelExists: !!panel,
        panelHasOpenClass: panel?.classList.contains('open'),
        isPresentationActive: document.body.classList.contains('presentation-active'),
    });

    if (panel) {
        panel.classList.remove('open');
        // Wait for animation to complete before hiding
        setTimeout(() => {
            if (!panel.classList.contains('open')) {
                panel.style.display = 'none';
            }
        }, 300);
    }

    if (overlay) {
        overlay.classList.remove('visible');
    }

    // Remove wtfPlans param from URL (unless we're navigating to a plan which will push its own state)
    if (!skipPushState) {
        const currentUrl = new URL(window.location.href);
        if (currentUrl.searchParams.has('wtfPlans')) {
            currentUrl.searchParams.delete('wtfPlans');
            currentUrl.searchParams.delete('wtfFilter');
            window.history.pushState({}, '', currentUrl.toString());
            log('WtfPlansPanel', 'Removed wtfPlans from URL');
        }
    }

    log('WtfPlansPanel', 'WTF Plans panel closed.');
}

/**
 * Toggle the WTF Plans panel visibility
 */
export function toggleWtfPlansPanel() {
    const panel = document.getElementById('wtf-plans-panel');
    if (panel && panel.classList.contains('open')) {
        hideWtfPlansPanel();
    } else {
        showWtfPlansPanel();
    }
}

/**
 * Set the current filter and re-render the list
 * @param {string} filter - One of WTF_PLAN_TYPES values
 */
export function setWtfPlansFilter(filter) {
    currentFilter = normalizeFilter(filter);
    renderWtfPlansList();
    log('WtfPlansPanel', `Filter set to: ${filter}`);
}

/**
 * Load all WTF Plans data from various sources
 */
async function loadWtfPlansData() {
    const container = document.getElementById('wtf-plans-list-container');
    if (!container) return;

    console.log(`[WTF-PLANS] ========== loadWtfPlansData START ==========`);

    // Show loading state
    isLoading = true;
    const isAuthenticated = state.session.user.isAuthenticated;
    const userId = state.session.user.id;
    console.log(`[WTF-PLANS] isAuthenticated: ${isAuthenticated}, userId: ${userId}, currentSessionId: ${state.session.id}`);
    container.innerHTML = `<div class="wtf-plans-loading">${isAuthenticated ? 'Loading your plans...' : 'Loading upcoming events...'}</div>`;

    try {
        const userId = state.session.user.id;

        // Fetch data in parallel where possible
        const dataPromises = [];
        let allUserPlans = [];
        let recentPlansFromStorage = [];

        // Plans/Collabs (sessions user is collaborator on)
        if (isAuthenticated && userId) {
            dataPromises.push(
                api.fetchPlansForUser(userId, true)
                    .then(plans => { allUserPlans = plans || []; })
                    .catch(err => {
                        console.error('Error fetching plans:', err);
                        allUserPlans = [];
                    })
            );

            // Plans the user chatted in (their messages are the record of taking part)
            dataPromises.push(
                api.fetchChatParticipation(userId)
                    .then(map => {
                        chatParticipation = map instanceof Map ? map : new Map();
                        chatParticipationUserId = userId;
                    })
                    .catch(err => {
                        console.error('[WTF-PLANS] Error fetching chat participation:', err);
                    })
            );

            // Projects (using project hierarchy)
            dataPromises.push(
                api.fetchProjectHierarchy(userId)
                    .then(projects => { wtfPlansData.projects = projects || []; })
                    .catch(err => {
                        console.error('Error fetching projects:', err);
                        wtfPlansData.projects = [];
                    })
            );
        } else {
            allUserPlans = [];
            wtfPlansData.projects = [];
        }

        // Always fetch recently-tracked plans from localStorage
        // This ensures plans the user visited/created persist across page loads
        const recentIds = getRecentPlanIds()
            .filter(id => id !== state.session.id); // Exclude current session (handled by buildCurrentSessionItem)
        if (recentIds.length > 0) {
            // Limit to 20 IDs per Airtable request to stay within formula length limits
            const idsToFetch = recentIds.slice(0, 20);
            dataPromises.push(
                api.fetchSessionsByIds(idsToFetch)
                    .then(sessions => { recentPlansFromStorage = sessions || []; })
                    .catch(err => {
                        console.error('[WTF-PLANS] Error fetching recent plans from localStorage IDs:', err);
                        recentPlansFromStorage = [];
                    })
            );
        }

        // Wait for API calls
        await Promise.all(dataPromises);

        // Merge recent localStorage plans with fetched user plans (avoid duplicates)
        const fetchedPlanIds = new Set(allUserPlans.map(p => p.id));
        const mergedFromStorage = recentPlansFromStorage.filter(p => !fetchedPlanIds.has(p.id));
        if (mergedFromStorage.length > 0) {
            console.log(`[WTF-PLANS] Adding ${mergedFromStorage.length} recently-tracked plan(s) not in user's fetched plans`);
            allUserPlans = [...allUserPlans, ...mergedFromStorage];
        }

        // Plans the user chatted in but that are missing from their collaborator plans
        // (e.g. joining the plan failed when they opened it): fetch them too.
        if (isAuthenticated && userId && chatParticipationUserId === userId && chatParticipation.size > 0) {
            const haveIds = new Set(allUserPlans.map(p => p.id));
            const missingIds = [...chatParticipation.entries()]
                .filter(([id]) => !haveIds.has(id) && id !== state.session.id)
                .sort((a, b) => String(b[1] || '').localeCompare(String(a[1] || '')))
                .slice(0, MAX_PARTICIPATION_FETCH)
                .map(([id]) => id);
            if (missingIds.length > 0) {
                const batches = [];
                for (let i = 0; i < missingIds.length; i += 20) batches.push(missingIds.slice(i, i + 20));
                const results = await Promise.all(batches.map(ids => api.fetchSessionsByIds(ids).catch(() => [])));
                const extra = results.flat().filter(p => p && !haveIds.has(p.id));
                if (extra.length > 0) {
                    console.log(`[WTF-PLANS] Adding ${extra.length} plan(s) the user chatted in`);
                    allUserPlans = [...allUserPlans, ...extra];
                }
            }
        }

        // Separate plans into shared (promoted) vs drafts based on collaborator count and RSVPs
        // A plan is "shared" if it has:
        // 1. More than 1 collaborator (creator + at least 1 other), OR
        // 2. Has RSVPs on its linked event
        // Plans the user created/edited are "theirs" (Plans/Drafts). Store plans they didn't
        // make go to the Store filter; anything else they merely opened goes to Shared with me.
        wtfPlansData.plans = [];
        wtfPlansData.drafts = [];
        wtfPlansData.shared = [];
        wtfPlansData.store = [];
        wtfPlansData.archived = [];

        const signedInUserId = isAuthenticated ? userId : null;
        // Plans the user left are gone from their lists; archived plans only show under Archived.
        allUserPlans = allUserPlans.filter(plan => {
            if (plan.id !== state.session.id && hasLeftPlan(plan, signedInUserId)) return false;
            if (plan.fields?.Archived) {
                wtfPlansData.archived.push(plan);
                return false;
            }
            return true;
        });
        allUserPlans.forEach(plan => {
            if (!isPersonalPlan(plan, signedInUserId)) {
                if (isOwnedStorePlan(plan)) {
                    wtfPlansData.store.push(plan);
                } else {
                    wtfPlansData.shared.push(plan);
                }
                return;
            }
            const isShared = isPlanShared(plan, userId);
            if (isShared) {
                wtfPlansData.plans.push(plan);
            } else {
                wtfPlansData.drafts.push(plan);
            }
        });
        console.log(`[WTF-PLANS] Not personal: ${wtfPlansData.shared.length} shared with me, ${wtfPlansData.store.length} store plans`);
        log('WtfPlansPanel', `Separated ${allUserPlans.length} plans: ${wtfPlansData.plans.length} shared, ${wtfPlansData.drafts.length} drafts`);
        console.log(`[WTF-PLANS] Plans breakdown: ${wtfPlansData.plans.length} shared, ${wtfPlansData.drafts.length} drafts (from ${allUserPlans.length} total)`);
        wtfPlansData.plans.forEach((p, i) => console.log(`[WTF-PLANS]   Shared ${i+1}: "${p.fields?.Name}" (${p.id})`));
        wtfPlansData.drafts.forEach((p, i) => console.log(`[WTF-PLANS]   Draft ${i+1}: "${p.fields?.Name}" (${p.id})`));

        // RSVPs - filter from records (events user has RSVP'd to)
        // For non-authenticated users, show upcoming public events they can browse/RSVP to
        if (isAuthenticated && userId) {
            wtfPlansData.rsvps = state.records.all.filter(record => {
                if (record.fields['Item Type'] !== 'Event') return false;
                const rsvpYes = record.fields.RSVPs || [];
                const rsvpMaybe = record.fields.RSVPMaybe || [];
                const rsvpNo = record.fields.RSVPNo || [];
                return rsvpYes.includes(userId) || rsvpMaybe.includes(userId) || rsvpNo.includes(userId);
            });
        } else {
            // For non-authenticated users, show upcoming public events
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            wtfPlansData.rsvps = state.records.all.filter(record => {
                if (record.fields['Item Type'] !== 'Event') return false;
                const eventDate = record.fields.Date;
                if (!eventDate) return false;
                // Only show events that are today or in the future
                const eventDateObj = new Date(eventDate + 'T00:00:00');
                return eventDateObj >= today;
            });
        }

        // Favorites - get liked items
        let likedIds = new Set();
        if (isAuthenticated) {
            likedIds = state.session.user.likedItemIds || new Set();
        } else {
            likedIds = getTempLikes();
        }
        wtfPlansData.favorites = state.records.all.filter(record => likedIds.has(record.id));

        isLoading = false;
        loadCreatorNames();
        console.log(`[WTF-PLANS] ========== loadWtfPlansData END (rendering ${wtfPlansData.plans.length + wtfPlansData.drafts.length} plans/drafts, ${wtfPlansData.rsvps.length} rsvps, ${wtfPlansData.favorites.length} favorites) ==========`);
        renderWtfPlansList();

    } catch (error) {
        console.error('Error loading WTF Plans data:', error);
        isLoading = false;
        container.innerHTML = '<div class="wtf-plans-empty">Error loading your plans. Please try again.</div>';
    }
}

/**
 * Check if a plan is considered "shared" (promoted from draft)
 * A plan is shared if it has at least 1 collaborator besides the creator OR has RSVPs
 * @param {Object} plan - The plan record from Airtable
 * @param {string} currentUserId - The current user's ID
 * @returns {boolean} - True if the plan is shared
 */
function isPlanShared(plan, currentUserId) {
    const collaborators = plan.fields?.Collaborators || [];

    // Check if there are collaborators beyond the creator
    // A plan with only the creator (or empty) is a draft
    // A plan with 2+ collaborators, OR 1 collaborator who isn't the creator, is shared
    const hasOtherCollaborators = collaborators.length > 1 ||
        (collaborators.length === 1 && collaborators[0] !== currentUserId);

    if (hasOtherCollaborators) {
        return true;
    }

    // Check if the plan has a linked event with RSVPs
    const linkedItemId = plan.fields?.LinkedItem;
    if (linkedItemId) {
        // Find the linked event in records
        const linkedEvent = state.records.all.find(record =>
            record.id === linkedItemId ||
            (Array.isArray(linkedItemId) && linkedItemId.includes(record.id))
        );

        if (linkedEvent) {
            const rsvpYes = linkedEvent.fields?.RSVPs || [];
            const rsvpMaybe = linkedEvent.fields?.RSVPMaybe || [];
            // If anyone has RSVP'd (yes or maybe), the plan is shared
            if (rsvpYes.length > 0 || rsvpMaybe.length > 0) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Refresh the WTF Plans data
 */
export async function refreshWtfPlansData() {
    await loadWtfPlansData();
}

/**
 * Parse Items with Variations JSON to extract item count and total cost
 * @param {Object} plan - The plan record from Airtable
 * @returns {Object} - { itemCount, totalCost }
 */
function parsePlanItemsData(plan) {
    let itemCount = 0;
    let totalCost = 0;
    let openConversations = null;

    try {
        const itemsWithVariations = plan.fields?.['Items with Variations'];
        if (itemsWithVariations) {
            const parsed = JSON.parse(itemsWithVariations);
            const lockedInItems = parsed.lockedInItems || {};
            openConversations = readSavedOpenConversations(parsed);

            // Count locked items
            itemCount = Object.keys(lockedInItems).length;

            // Calculate total cost from locked items
            Object.entries(lockedInItems).forEach(([recordId, itemInfo]) => {
                const record = state.records.all.find(r => r.id === recordId);
                if (!record) return;

                // Get price - use override price if available, otherwise record price
                let unitPrice = itemInfo.overridePrice;
                if (unitPrice == null) {
                    unitPrice = parseFloat(record.fields?.Price) || 0;
                }

                const quantity = parseFloat(itemInfo.quantity) || 1;
                totalCost += unitPrice * quantity;
            });
        }
    } catch (e) {
        console.warn('Could not parse Items with Variations for plan:', plan.id, e);
    }

    return { itemCount, totalCost, openConversations };
}

/**
 * Get all items combined and sorted by most recent
 * @returns {Array} - Combined and sorted items
 */
function getCombinedItems() {
    let items = [];
    const currentSessionId = state.session.id;
    const currentSessionItem = buildCurrentSessionItem();
    const currentUserId = state.session.user.isAuthenticated ? state.session.user.id : null;
    const showAll = currentFilter === WTF_PLAN_TYPES.ALL;

    // Work out which section the live (currently open) session belongs to.
    // Live activity wins: once the user edits the open plan it is theirs immediately,
    // even before the list data is re-fetched.
    let currentSessionCategory = 'draft';
    if (currentSessionItem) {
        const findIn = list => list.find(p => p.id === currentSessionId);
        const fetched = findIn(wtfPlansData.plans) || findIn(wtfPlansData.drafts) ||
            findIn(wtfPlansData.shared) || findIn(wtfPlansData.store);
        const live = state.session.planActivity;
        const liveIsMine = !!(currentUserId && ((live && (live.createdBy === currentUserId ||
            (Array.isArray(live.editors) && live.editors.includes(currentUserId)))) ||
            hasChatParticipation(currentSessionId)));

        if (findIn(wtfPlansData.plans)) currentSessionCategory = 'plan';
        else if (findIn(wtfPlansData.drafts)) currentSessionCategory = 'draft';
        else if (findIn(wtfPlansData.store)) currentSessionCategory = 'store';
        else if (findIn(wtfPlansData.shared)) currentSessionCategory = 'shared';
        // New, not-yet-fetched sessions default to draft

        if (liveIsMine && (currentSessionCategory === 'shared' || currentSessionCategory === 'store')) {
            currentSessionCategory = (fetched && isPlanShared(fetched, currentUserId)) ? 'plan' : 'draft';
        }
        if (state.session.archived) currentSessionCategory = 'archived';
    }

    const CATEGORY_META = {
        plan: { filter: WTF_PLAN_TYPES.PLANS, icon: SHARED_PLAN_ICON, untitled: 'Untitled Plan' },
        draft: { filter: WTF_PLAN_TYPES.DRAFTS, icon: '📝', untitled: 'Untitled Draft' },
        // Shared-with-me plans are merged into Plans
        shared: { filter: WTF_PLAN_TYPES.PLANS, icon: SHARED_PLAN_ICON, untitled: 'Untitled Plan' },
        store: { filter: WTF_PLAN_TYPES.STORE, icon: '🏪', untitled: 'Untitled Plan' },
        archived: { filter: WTF_PLAN_TYPES.ARCHIVED, icon: '🗄️', untitled: 'Untitled Plan' }
    };

    const addSessionList = (list, type) => {
        const meta = CATEGORY_META[type];
        // "All" shows Plans (including shared with me) and drafts; store plans keep their own filter.
        const inAll = type === 'plan' || type === 'draft' || type === 'shared';
        if (!(currentFilter === meta.filter || (showAll && inAll))) return;

        list.forEach(plan => {
            // Skip the current session - the live version is added below
            if (currentSessionId && plan.id === currentSessionId) return;
            const { itemCount, totalCost, openConversations } = parsePlanItemsData(plan);
            items.push({
                openConversations,
                type,
                id: plan.id,
                name: plan.fields?.Name || meta.untitled,
                date: plan.fields?.Date,
                createdTime: plan.createdTime,
                activityTime: getPlanActivityTime(plan),
                itemCount,
                totalCost,
                icon: meta.icon,
                creatorId: getPlanCreatorId(plan, false),
                data: plan
            });
        });
    };

    addSessionList(wtfPlansData.plans, 'plan');
    addSessionList(wtfPlansData.drafts, 'draft');
    addSessionList(wtfPlansData.shared, 'shared');
    addSessionList(wtfPlansData.store, 'store');
    addSessionList(wtfPlansData.archived, 'archived');

    // The open plan always appears in "All" (it's what the user is looking at) and in its own section
    if (currentSessionItem) {
        const meta = CATEGORY_META[currentSessionCategory];
        if (showAll || currentFilter === meta.filter) {
            items.push({ ...currentSessionItem, type: currentSessionCategory, icon: meta.icon, creatorId: getPlanCreatorId(null, true) });
        }
    }

    // Add RSVPs (for authenticated users) or Upcoming Events (for non-authenticated)
    if (showAll || currentFilter === WTF_PLAN_TYPES.RSVPS) {
        const isAuthenticated = state.session.user.isAuthenticated;
        const userId = state.session.user.id;

        wtfPlansData.rsvps.forEach(event => {
            let rsvpStatus = '';
            if (isAuthenticated && userId) {
                if ((event.fields.RSVPs || []).includes(userId)) rsvpStatus = 'Going';
                else if ((event.fields.RSVPMaybe || []).includes(userId)) rsvpStatus = 'Maybe';
                else if ((event.fields.RSVPNo || []).includes(userId)) rsvpStatus = 'Not Going';
            } else {
                // For non-authenticated users, show as "Upcoming" public event
                rsvpStatus = 'Upcoming';
            }

            items.push({
                type: 'rsvp',
                id: event.id,
                name: event.fields?.Name || 'Untitled Event',
                date: event.fields?.Date,
                time: event.fields?.Time,
                createdTime: event.createdTime,
                rsvpStatus: rsvpStatus,
                icon: '🎟️',
                isPublicEvent: !isAuthenticated, // Flag to indicate this is shown as a public event preview
                data: event
            });
        });
    }

    // Add Favorites
    if (showAll || currentFilter === WTF_PLAN_TYPES.FAVORITES) {
        wtfPlansData.favorites.forEach(item => {
            items.push({
                type: 'favorite',
                id: item.id,
                name: item.fields?.Name || 'Untitled Item',
                createdTime: item.createdTime,
                price: item.fields?.Price,
                category: item.fields?.Categories,
                icon: '❤️',
                data: item
            });
        });
    }

    // Add Projects - only sessions not already listed in any plan section
    if (showAll || currentFilter === WTF_PLAN_TYPES.PROJECTS) {
        const knownIds = getKnownSessionIds();
        wtfPlansData.projects.forEach(project => {
            if (knownIds.has(project.id)) return;
            if (currentSessionId && project.id === currentSessionId) return;

            items.push({
                type: 'project',
                id: project.id,
                name: project.fields?.Name || 'Untitled Project',
                date: project.fields?.Date,
                createdTime: project.createdTime,
                activityTime: getPlanActivityTime(project),
                icon: '📁',
                data: project
            });
        });
    }

    // Sort: current session first, public events by upcoming date, everything else by
    // most recent activity (last edit for plans, creation time otherwise)
    items.sort((a, b) => {
        if (a.isCurrentSession) return -1;
        if (b.isCurrentSession) return 1;

        if (a.isPublicEvent && b.isPublicEvent) {
            const dateA = a.date ? new Date(a.date + 'T00:00:00') : new Date(9999, 11, 31);
            const dateB = b.date ? new Date(b.date + 'T00:00:00') : new Date(9999, 11, 31);
            return dateA - dateB; // Soonest first
        }

        const dateA = new Date(a.activityTime || a.createdTime || a.date || 0);
        const dateB = new Date(b.activityTime || b.createdTime || b.date || 0);
        return dateB - dateA; // Most recent first
    });

    return items;
}

/** IDs of every session already shown in a plan section (used to de-dupe projects). */
function getKnownSessionIds() {
    return new Set([
        ...wtfPlansData.plans,
        ...wtfPlansData.drafts,
        ...wtfPlansData.shared,
        ...wtfPlansData.store,
        ...wtfPlansData.archived
    ].map(p => p.id));
}

/**
 * Render the WTF Plans list
 */
function renderWtfPlansList() {
    const container = document.getElementById('wtf-plans-list-container');
    if (!container) return;

    if (isLoading) {
        container.innerHTML = '<div class="wtf-plans-loading">Loading your plans...</div>';
        return;
    }

    const items = getCombinedItems();

    // Update counts (and Shared/Store filter visibility) even when this filter is empty
    updateFilterCounts();

    // Selection only keeps plans that are still showing (e.g. after switching filters).
    const visible = new Map(items.filter(isSelectablePlanItem).map(i => [i.id, i]));
    for (const id of [...selectedPlans.keys()]) {
        if (visible.has(id)) selectedPlans.set(id, visible.get(id));
        else selectedPlans.delete(id);
    }
    updateSelectionUi();

    if (items.length === 0) {
        const emptyMessage = getEmptyMessage();
        container.innerHTML = `<div class="wtf-plans-empty">${emptyMessage}</div>`;
        return;
    }

    container.innerHTML = '';

    items.forEach(item => {
        const itemEl = createWtfPlanItem(item);
        container.appendChild(itemEl);
    });
}

/**
 * Get appropriate empty message based on filter
 * @returns {string} - Empty state message
 */
function getEmptyMessage() {
    const isAuthenticated = state.session.user.isAuthenticated;

    // For non-authenticated users, show different messages based on filter
    if (!isAuthenticated) {
        switch (currentFilter) {
            case WTF_PLAN_TYPES.RSVPS:
                return 'No upcoming public events right now. Check back soon!';
            case WTF_PLAN_TYPES.FAVORITES:
                return 'Sign in to save your favorites.';
            case WTF_PLAN_TYPES.PLANS:
            case WTF_PLAN_TYPES.DRAFTS:
            case WTF_PLAN_TYPES.PROJECTS:
            case WTF_PLAN_TYPES.SHARED:
            case WTF_PLAN_TYPES.STORE:
            case WTF_PLAN_TYPES.ARCHIVED:
                return 'Sign in to see your plans and projects.';
            default:
                return 'Sign in to see your plans, RSVPs, and favorites.';
        }
    }

    switch (currentFilter) {
        case WTF_PLAN_TYPES.PLANS:
            return 'No shared plans yet. Invite someone to a plan, or open one shared with you, to see it here! Plans only you are on are under ••• → Drafts.';
        case WTF_PLAN_TYPES.DRAFTS:
            return 'No drafts. Create a new plan to get started!';
        case WTF_PLAN_TYPES.RSVPS:
            return 'No RSVPs yet. Browse events and RSVP!';
        case WTF_PLAN_TYPES.FAVORITES:
            return 'No favorites yet. Heart items you love!';
        case WTF_PLAN_TYPES.PROJECTS:
            return 'No projects yet. Create your first project!';
        case WTF_PLAN_TYPES.SHARED:
            return 'No plans shared with you yet. Plans you open from a link show up here until you edit them.';
        case WTF_PLAN_TYPES.STORE:
            return 'No store plans yet. Plans customers make for your store show up here.';
        case WTF_PLAN_TYPES.ARCHIVED:
            return 'No archived plans. Plans you archive from the plan menu show up here, ready to restore.';
        default:
            return 'Nothing here yet. Start planning something fun!';
    }
}

/** "from <name>" when someone else created the plan; empty for the user's own plans. */
function getFromLabel(item) {
    const me = state.session.user.isAuthenticated ? state.session.user.id : null;
    const creatorId = item.creatorId;
    if (!me || !creatorId || creatorId === me) return '';
    const name = creatorNames.get(creatorId);
    return name ? `from ${name}` : '';
}

/**
 * Create a single WTF Plan item element
 * @param {Object} item - The item data
 * @returns {HTMLElement} - The item element
 */
function createWtfPlanItem(item) {
    const itemEl = document.createElement('div');
    itemEl.className = 'wtf-plans-item';
    if (item.isCurrentSession) {
        itemEl.classList.add('current-session');
    }
    if (item.type === 'draft') {
        itemEl.classList.add('draft-item');
    }
    itemEl.dataset.itemId = item.id;
    itemEl.dataset.itemType = item.type;

    // Build preview text based on type
    let preview = '';
    switch (item.type) {
        case 'plan':
        case 'shared': {
            const dateStr = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : 'No date';
            const from = getFromLabel(item);
            preview = item.type === 'plan'
                ? `${from ? from + ' • ' : ''}${item.itemCount} items • ${dateStr} • $${(item.totalCost || 0).toFixed(2)}`
                : `${from || 'Shared with you'} • ${item.itemCount} items • ${dateStr}`;
            break;
        }
        case 'draft':
            const draftDateStr = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : 'No date';
            preview = `Draft • ${item.itemCount} items • ${draftDateStr}`;
            break;
        case 'rsvp':
            const eventDate = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : 'TBD';
            preview = `${item.rsvpStatus} • ${eventDate}${item.time ? ' ' + item.time : ''}`;
            break;
        case 'favorite':
            const price = item.price ? `$${parseFloat(item.price).toFixed(2)}` : '';
            preview = [item.category, price].filter(Boolean).join(' • ') || 'Saved item';
            break;
        case 'project':
            const projDate = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : '';
            preview = projDate || 'Project';
            break;
        case 'store':
            const otherDateStr = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : 'No date';
            preview = `Store plan • ${item.itemCount} items • ${otherDateStr}`;
            break;
        case 'archived':
            const archivedDateStr = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : 'No date';
            preview = `Archived • ${item.itemCount} items • ${archivedDateStr}`;
            break;
    }

    // Format time ago (last edit when known) - show "Now" for current session
    const timeAgo = item.isCurrentSession ? 'Now' : formatTimeAgo(item.activityTime || item.createdTime);

    // Show "Editing" indicator for current session
    const currentBadge = item.isCurrentSession ? '<span class="wtf-plans-current-badge">Editing</span>' : '';

    // Open chats/tasks (saved snapshot for other plans, live for the open one)
    const openCounts = item.openConversations;
    const openTitle = openCounts?.total > 0 ? describeOpenCounts({ ...openCounts, comments: 0 }) : '';
    const openBadge = openCounts?.total > 0
        ? `<button type="button" class="wtf-plans-open-badge" title="${escapeHtml(openTitle)} — open the plan chat" aria-label="${escapeHtml(openTitle)}. Open the plan chat"><span aria-hidden="true">💬</span><span class="wtf-plans-open-count">${openCounts.total}</span></button>`
        : '';

    itemEl.innerHTML = `
        <span class="wtf-plans-item-check" aria-hidden="true">✓</span>
        <div class="wtf-plans-item-icon">${item.icon}</div>
        <div class="wtf-plans-item-content">
            <div class="wtf-plans-item-name">${escapeHtml(item.name)}${currentBadge}</div>
            <div class="wtf-plans-item-preview">${escapeHtml(preview)}</div>
        </div>
        ${openBadge}
        ${item.type === 'archived' ? '<button type="button" class="wtf-plans-restore-btn" title="Restore this plan to your lists">Restore</button>' : ''}
        <div class="wtf-plans-item-time">${timeAgo}</div>
    `;

    const selectable = isSelectablePlanItem(item);
    if (selectable) {
        itemEl.classList.add('selectable');
        attachLongPress(itemEl, item);
    }
    applyItemSelectionState(itemEl, item);

    // Click handler (in selection mode a click ticks/unticks the plan instead of opening it)
    itemEl.addEventListener('click', (e) => {
        if (suppressNextClick) {
            suppressNextClick = false;
            e.preventDefault();
            return;
        }
        if (selectMode) {
            if (selectable) togglePlanSelection(item, itemEl);
            return;
        }
        handleWtfPlanItemClick(item);
    });
    itemEl.addEventListener('keydown', (e) => {
        if (!selectMode || !selectable) return;
        if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            togglePlanSelection(item, itemEl);
        }
    });
    itemEl.querySelector('.wtf-plans-open-badge')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectMode) return;
        openPlanChat(item);
    });
    itemEl.querySelector('.wtf-plans-restore-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (selectMode) return;
        restoreArchivedPlan(item, e.currentTarget);
    });

    return itemEl;
}

/**
 * Restore an archived plan (un-check "Archived") and move it back into the user's lists.
 */
async function restoreArchivedPlan(item, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Restoring…'; }
    const ok = await api.setSessionArchived(item.id, false);
    if (!ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Restore'; }
        alert('Could not restore this plan. Please try again.');
        return;
    }
    const idx = wtfPlansData.archived.findIndex(p => p.id === item.id);
    const plan = idx >= 0 ? wtfPlansData.archived.splice(idx, 1)[0] : item.data;
    if (plan) {
        if (plan.fields) delete plan.fields.Archived;
        const userId = state.session.user.isAuthenticated ? state.session.user.id : null;
        if (!isPersonalPlan(plan, userId)) {
            (isOwnedStorePlan(plan) ? wtfPlansData.store : wtfPlansData.shared).push(plan);
        } else {
            (isPlanShared(plan, userId) ? wtfPlansData.plans : wtfPlansData.drafts).push(plan);
        }
    }
    if (item.id === state.session.id) {
        state.session.archived = false;
        window.dispatchEvent(new CustomEvent('plan-archived-changed', { detail: { sessionId: item.id, archived: false } }));
    }
    renderWtfPlansList();
}

/**
 * Open a plan and surface its plan chat (from the open chat/task badge).
 */
function openPlanChat(item) {
    if (item.isCurrentSession) {
        document.dispatchEvent(new CustomEvent('workspace-show-plan'));
        import('./unifiedChatPanel.js').then(m => m.openUCPConversations(null)).catch(() => {});
        return;
    }
    const wtfPlansUrl = new URL(window.location.href);
    wtfPlansUrl.searchParams.set('wtfPlans', 'open');
    wtfPlansUrl.searchParams.set('wtfFilter', currentFilter);
    window.history.replaceState({ wtfPlans: 'open', filter: currentFilter }, '', wtfPlansUrl.toString());

    const sessionUrl = new URL(window.location.href);
    sessionUrl.searchParams.set('session', item.id);
    sessionUrl.searchParams.set('view', 'present');
    sessionUrl.searchParams.set('openChat', 'plan');
    sessionUrl.searchParams.delete('category');
    window.location.href = sessionUrl.toString();
}

/**
 * Handle click on a WTF Plan item
 * Uses pushState to ensure browser back/forward navigation works correctly
 * @param {Object} item - The clicked item
 */
function handleWtfPlanItemClick(item) {
    log('WtfPlansPanel', `Clicked ${item.type}: ${item.name} (${item.id})`);

    // Navigation replaces the center while retaining the plans rail.
    if (item.isCurrentSession) {
        document.dispatchEvent(new CustomEvent('workspace-show-plan'));
        return;
    }

    switch (item.type) {
        case 'plan':
        case 'draft':
        case 'project':
        case 'shared':
        case 'store':
        case 'archived':
            // Navigate to session using pushState for proper browser history
            // First, ensure the wtfPlans state is in history so back button returns to it
            const wtfPlansUrl = new URL(window.location.href);
            wtfPlansUrl.searchParams.set('wtfPlans', 'open');
            wtfPlansUrl.searchParams.set('wtfFilter', currentFilter);
            // Replace current URL with wtfPlans state (this is the state we want to return to on back)
            window.history.replaceState({ wtfPlans: 'open', filter: currentFilter }, '', wtfPlansUrl.toString());

            // Now push the new session URL with presentation view as default
            const sessionUrl = new URL(window.location.href);
            sessionUrl.searchParams.set('wtfPlans', 'open');
            sessionUrl.searchParams.set('wtfFilter', currentFilter);
            sessionUrl.searchParams.set('session', item.id);
            sessionUrl.searchParams.set('view', 'present'); // Default to presentation view
            sessionUrl.searchParams.delete('category');
            // Use location.href for session navigation as it requires full reload to load session data
            window.location.href = sessionUrl.toString();
            break;

        case 'rsvp':
        case 'favorite':
            // Open item detail modal
            const record = item.data;
            if (record) {
                // First, ensure the wtfPlans state is in history so back button returns to it
                const wtfPanelUrl = new URL(window.location.href);
                wtfPanelUrl.searchParams.set('wtfPlans', 'open');
                wtfPanelUrl.searchParams.set('wtfFilter', currentFilter);
                window.history.replaceState({ wtfPlans: 'open', filter: currentFilter }, '', wtfPanelUrl.toString());

                // Then show the modal (which will push its own URL state)
                showDetailModal(record);
            } else {
                // Fallback: navigate with openItem param
                const wtfUrl = new URL(window.location.href);
                wtfUrl.searchParams.set('wtfPlans', 'open');
                wtfUrl.searchParams.set('wtfFilter', currentFilter);
                window.history.replaceState({ wtfPlans: 'open', filter: currentFilter }, '', wtfUrl.toString());

                const itemUrl = new URL(window.location.href);
                itemUrl.searchParams.set('wtfPlans', 'open');
                itemUrl.searchParams.set('wtfFilter', currentFilter);
                itemUrl.searchParams.set('openItem', item.id);
                window.location.href = itemUrl.toString();
            }
            break;
    }
}

/**
 * Update filter button counts
 */
function updateFilterCounts() {
    const allBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="all"]');
    const plansBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="plans"]');
    const draftsBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="drafts"]');
    const rsvpsBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="rsvps"]');
    const favoritesBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="favorites"]');
    const projectsBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="projects"]');
    const sharedBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="shared"]');
    const storeBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="store"]');
    const archivedBtn = document.querySelector('.wtf-plans-filter-btn[data-filter="archived"]');

    // Shared/Store filters only make sense for signed-in users (Store: store owners only)
    const user = state.session.user;
    if (sharedBtn) sharedBtn.style.display = 'none'; // merged into Plans
    if (storeBtn) storeBtn.style.display = (user.isAuthenticated && user.isOwner && user.ownedStoreId) ? '' : 'none';
    if (archivedBtn) archivedBtn.style.display = user.isAuthenticated ? '' : 'none';

    const planCount = wtfPlansData.plans.length + wtfPlansData.shared.length;
    const draftCount = wtfPlansData.drafts.length;
    const rsvpCount = wtfPlansData.rsvps.length;
    const favoriteCount = wtfPlansData.favorites.length;

    // Projects that aren't already listed in a plan section
    const knownIds = getKnownSessionIds();
    const projectCount = wtfPlansData.projects.filter(p => !knownIds.has(p.id)).length;

    const totalCount = planCount + draftCount + rsvpCount + favoriteCount + projectCount;

    if (allBtn) updateButtonCount(allBtn, totalCount);
    if (plansBtn) updateButtonCount(plansBtn, planCount);
    if (draftsBtn) updateButtonCount(draftsBtn, draftCount);
    if (rsvpsBtn) updateButtonCount(rsvpsBtn, rsvpCount);
    if (favoritesBtn) updateButtonCount(favoritesBtn, favoriteCount);
    if (projectsBtn) updateButtonCount(projectsBtn, projectCount);
    if (storeBtn) updateButtonCount(storeBtn, wtfPlansData.store.length);
    if (archivedBtn) updateButtonCount(archivedBtn, wtfPlansData.archived.length);
}

/**
 * Update count badge on a filter button
 * @param {HTMLElement} btn - The button element
 * @param {number} count - The count
 */
function updateButtonCount(btn, count) {
    let badge = btn.querySelector('.wtf-plans-count');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wtf-plans-count';
        btn.appendChild(badge);
    }
    badge.textContent = count > 0 ? count : '';
    badge.style.display = count > 0 ? 'inline' : 'none';
}

/**
 * Format a timestamp as relative time
 * @param {string} timestamp - ISO timestamp
 * @returns {string} - Formatted time string
 */
function formatTimeAgo(timestamp) {
    if (!timestamp) return '';

    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;

    return time.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Check if the WTF Plans panel is currently open
 * @returns {boolean} - True if the panel is open
 */
export function isWtfPlansPanelOpen() {
    const panel = document.getElementById('wtf-plans-panel');
    return panel && panel.classList.contains('open');
}

/**
 * Sync the WTF Plans panel state with the URL
 * Called by syncUiWithUrl in main.js to handle browser back/forward navigation
 * @param {URLSearchParams} params - The current URL search params
 */
export function syncWtfPlansPanelWithUrl(params) {
    const shouldBeOpen = params.get('wtfPlans') === 'open';
    const filter = normalizeFilter(params.get('wtfFilter') || WTF_PLAN_TYPES.PLANS);
    const isOpen = isWtfPlansPanelOpen();

    if (shouldBeOpen && !isOpen) {
        // URL says panel should be open, but it's closed - open it
        log('WtfPlansPanel', 'syncWtfPlansPanelWithUrl: Opening panel from URL state');
        showWtfPlansPanel({ skipPushState: true, filter });
    } else if (!shouldBeOpen && isOpen) {
        // URL says panel should be closed, but it's open - close it
        log('WtfPlansPanel', 'syncWtfPlansPanelWithUrl: Closing panel from URL state');
        hideWtfPlansPanel({ skipPushState: true });
    } else if (shouldBeOpen && isOpen && filter !== currentFilter) {
        // Panel is open but filter needs updating
        log('WtfPlansPanel', `syncWtfPlansPanelWithUrl: Updating filter to ${filter}`);
        currentFilter = filter;
        const filterBtns = document.querySelectorAll('.wtf-plans-filter-btn');
        filterBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        renderWtfPlansList();
    }
}


// ---- Multi-select: long-press a plan (or use "Select") to archive or delete several ----

function isSelectablePlanItem(item) {
    return !!(item && item.id && SELECTABLE_PLAN_TYPES.has(item.type) && state.session.user.isAuthenticated);
}

function initPlanSelection() {
    document.getElementById('wtf-plans-select-toggle')?.addEventListener('click', () => {
        closeMoreMenu();
        if (selectMode) exitSelectMode();
        else enterSelectMode();
    });
    document.getElementById('wtf-plans-select-cancel')?.addEventListener('click', exitSelectMode);
    document.getElementById('wtf-plans-bulk-archive')?.addEventListener('click', handleBulkArchive);
    document.getElementById('wtf-plans-bulk-delete')?.addEventListener('click', handleBulkDelete);

    // Escape leaves selection mode first (before anything else closes the panel).
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !selectMode || bulkActionInProgress) return;
        if (document.querySelector('.confirm-dialog-overlay')) return;
        e.stopImmediatePropagation();
        exitSelectMode();
    }, true);
}

function enterSelectMode(initialItem = null) {
    if (!state.session.user.isAuthenticated) {
        alert('Please sign in to manage your plans.');
        return;
    }
    selectMode = true;
    if (initialItem && isSelectablePlanItem(initialItem)) selectedPlans.set(initialItem.id, initialItem);
    refreshAllItemSelectionStates();
    updateSelectionUi();
}

function exitSelectMode() {
    if (!selectMode && selectedPlans.size === 0) return;
    selectMode = false;
    selectedPlans.clear();
    refreshAllItemSelectionStates();
    updateSelectionUi();
}

function togglePlanSelection(item, itemEl) {
    if (bulkActionInProgress) return;
    if (selectedPlans.has(item.id)) selectedPlans.delete(item.id);
    else selectedPlans.set(item.id, item);
    applyItemSelectionState(itemEl, item);
    updateSelectionUi();
}

function applyItemSelectionState(itemEl, item) {
    const selectable = isSelectablePlanItem(item);
    const selected = selectMode && selectable && selectedPlans.has(item.id);
    itemEl.classList.toggle('selected', selected);
    if (selectMode && selectable) {
        itemEl.setAttribute('role', 'checkbox');
        itemEl.setAttribute('aria-checked', selected ? 'true' : 'false');
        itemEl.tabIndex = 0;
    } else {
        itemEl.removeAttribute('role');
        itemEl.removeAttribute('aria-checked');
        itemEl.removeAttribute('tabindex');
    }
}

function refreshAllItemSelectionStates() {
    const container = document.getElementById('wtf-plans-list-container');
    if (!container) return;
    container.querySelectorAll('.wtf-plans-item').forEach(el => {
        const id = el.dataset.itemId;
        const type = el.dataset.itemType;
        applyItemSelectionState(el, selectedPlans.get(id) || { id, type });
    });
}

function updateSelectionUi() {
    const panel = document.getElementById('wtf-plans-panel');
    const toggle = document.getElementById('wtf-plans-select-toggle');
    const bar = document.getElementById('wtf-plans-select-bar');
    const countEl = document.getElementById('wtf-plans-select-count');
    const archiveBtn = document.getElementById('wtf-plans-bulk-archive');
    const deleteBtn = document.getElementById('wtf-plans-bulk-delete');

    if (toggle) {
        const signedIn = state.session.user.isAuthenticated;
        toggle.style.display = signedIn ? '' : 'none';
        const divider = document.getElementById('wtf-plans-select-divider');
        if (divider) divider.style.display = signedIn ? '' : 'none';
        toggle.textContent = selectMode ? 'Done selecting' : 'Select plans';
        toggle.classList.toggle('active', selectMode);
    }
    panel?.classList.toggle('wtf-plans-selecting', selectMode);
    if (bar) bar.hidden = !selectMode;

    const items = [...selectedPlans.values()];
    const count = items.length;
    if (countEl) countEl.textContent = count === 0 ? 'Tap plans to select' : `${count} selected`;

    const allArchived = count > 0 && items.every(i => i.type === 'archived');
    if (archiveBtn) {
        archiveBtn.textContent = allArchived ? 'Restore' : 'Archive';
        archiveBtn.disabled = count === 0 || bulkActionInProgress;
    }
    if (deleteBtn) deleteBtn.disabled = count === 0 || bulkActionInProgress;
}

/** Long-press (touch or mouse) a plan row to start selecting, with that plan ticked. */
function attachLongPress(itemEl, item) {
    let timer = null;
    let startX = 0;
    let startY = 0;

    const cancel = () => {
        if (timer) clearTimeout(timer);
        timer = null;
        itemEl.classList.remove('long-pressing');
    };

    itemEl.addEventListener('pointerdown', (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        if (e.target.closest('button')) return;
        if (selectMode || bulkActionInProgress) return;
        startX = e.clientX;
        startY = e.clientY;
        cancel();
        itemEl.classList.add('long-pressing');
        timer = setTimeout(() => {
            timer = null;
            itemEl.classList.remove('long-pressing');
            suppressNextClick = true;
            // Clear the flag if no click follows (e.g. touch ended off the row).
            setTimeout(() => { suppressNextClick = false; }, 800);
            try { navigator.vibrate?.(15); } catch (err) { /* not supported */ }
            enterSelectMode(item);
        }, LONG_PRESS_MS);
    });
    itemEl.addEventListener('pointermove', (e) => {
        if (!timer) return;
        if (Math.abs(e.clientX - startX) > LONG_PRESS_MOVE_TOLERANCE ||
            Math.abs(e.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) cancel();
    });
    itemEl.addEventListener('pointerup', cancel);
    itemEl.addEventListener('pointerleave', cancel);
    itemEl.addEventListener('pointercancel', cancel);
    // Stop the browser's own long-press menu on touch devices while we handle the press.
    itemEl.addEventListener('contextmenu', (e) => {
        if (timer || suppressNextClick || selectMode) e.preventDefault();
    });
}

/** Whether the signed-in user created this plan (same rules as the plan menu). */
function isSelectedPlanCreatedByMe(item) {
    const userId = state.session.user.isAuthenticated ? state.session.user.id : null;
    if (!userId) return false;
    if (item.isCurrentSession || item.id === state.session.id) {
        const createdBy = state.session.planActivity?.createdBy || (state.session.loadedCollaborators || [])[0] || null;
        if (!createdBy) return !!state.session.isOwned;
        return createdBy === userId;
    }
    const plan = item.data;
    const createdBy = getPlanActivity(plan)?.createdBy || (plan?.fields?.Collaborators || [])[0] || null;
    return !!createdBy && createdBy === userId;
}

function pluralPlans(n) {
    return `${n} plan${n === 1 ? '' : 's'}`;
}

function showBulkConfirm(title, message, confirmText, isDanger) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog-overlay';
        const dialog = document.createElement('div');
        dialog.className = 'confirm-dialog';
        dialog.setAttribute('role', 'alertdialog');
        dialog.innerHTML = `
            <h4>${escapeHtml(title)}</h4>
            <p>${escapeHtml(message)}</p>
            <div class="confirm-dialog-actions">
                <button type="button" class="btn-cancel">Cancel</button>
                <button type="button" class="btn-confirm ${isDanger ? '' : 'btn-primary'}">${escapeHtml(confirmText)}</button>
            </div>
        `;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        const done = (result) => {
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
            resolve(result);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.stopImmediatePropagation(); done(false); }
        };
        document.addEventListener('keydown', onKey, true);
        dialog.querySelector('.btn-cancel').addEventListener('click', () => done(false));
        dialog.querySelector('.btn-confirm').addEventListener('click', () => done(true));
        overlay.addEventListener('click', (e) => { if (e.target === overlay) done(false); });
        dialog.querySelector('.btn-cancel').focus();
    });
}

function showBulkToast(message, variant = 'success') {
    import('../ui.js').then(m => m.showToast(message, 4000, variant)).catch(() => alert(message));
}

function setBulkBusy(busy, label) {
    bulkActionInProgress = busy;
    const countEl = document.getElementById('wtf-plans-select-count');
    updateSelectionUi();
    if (busy && countEl && label) countEl.textContent = label;
}

/** Remove a plan from every cached list; returns the plan record if it was found. */
function takePlanFromLists(id) {
    let found = null;
    for (const key of ['plans', 'drafts', 'shared', 'store', 'archived', 'projects']) {
        const idx = wtfPlansData[key].findIndex(p => p.id === id);
        if (idx !== -1) {
            const [plan] = wtfPlansData[key].splice(idx, 1);
            found = found || plan;
        }
    }
    return found;
}

/** Put a restored plan back into the right list (same rules as the Restore button). */
function placeRestoredPlan(plan) {
    if (!plan) return;
    if (plan.fields) delete plan.fields.Archived;
    const userId = state.session.user.isAuthenticated ? state.session.user.id : null;
    if (!isPersonalPlan(plan, userId)) {
        (isOwnedStorePlan(plan) ? wtfPlansData.store : wtfPlansData.shared).push(plan);
    } else {
        (isPlanShared(plan, userId) ? wtfPlansData.plans : wtfPlansData.drafts).push(plan);
    }
}

function currentStoreQuery() {
    return state.ui.activeShopId ? getShopUrlParam(state.ui.activeShopId, state.stores.all) : '';
}

async function handleBulkArchive() {
    if (bulkActionInProgress || selectedPlans.size === 0) return;
    const items = [...selectedPlans.values()];
    const restoring = items.every(i => i.type === 'archived');
    const targets = restoring ? items : items.filter(i => i.type !== 'archived');
    if (targets.length === 0) return;

    if (!restoring) {
        const skipped = items.length - targets.length;
        const confirmed = await showBulkConfirm(
            `Archive ${pluralPlans(targets.length)}?`,
            `${targets.length === 1 ? 'This plan' : 'These plans'} will be hidden from everyone's plan lists. Links keep working, and you can restore them anytime from Archived.` +
                (skipped ? ` ${pluralPlans(skipped)} already archived will be left as is.` : ''),
            'Archive',
            false
        );
        if (!confirmed) return;
    }

    setBulkBusy(true, restoring ? 'Restoring…' : 'Archiving…');
    const succeeded = [];
    let failed = 0;
    try {
        if (restoring) {
            for (const item of targets) {
                if (await api.setSessionArchived(item.id, false)) succeeded.push(item);
                else failed++;
            }
        } else {
            // Airtable accepts up to 10 records per request; batch so we know which ones landed.
            for (let i = 0; i < targets.length; i += 10) {
                const batch = targets.slice(i, i + 10);
                const result = await api.archiveSessionsBulk(batch.map(t => t.id));
                if (result.success === batch.length) succeeded.push(...batch);
                else failed += batch.length;
            }
        }
    } finally {
        setBulkBusy(false);
    }

    for (const item of succeeded) {
        const plan = takePlanFromLists(item.id) || item.data;
        if (restoring) {
            placeRestoredPlan(plan);
        } else if (plan) {
            plan.fields = plan.fields || {};
            plan.fields.Archived = true;
            wtfPlansData.archived.push(plan);
        }
        if (item.id === state.session.id) {
            state.session.archived = !restoring;
            window.dispatchEvent(new CustomEvent('plan-archived-changed', {
                detail: { sessionId: item.id, archived: state.session.archived }
            }));
        }
    }

    exitSelectMode();
    renderWtfPlansList();

    const verb = restoring ? 'restored' : 'archived';
    if (failed === 0) {
        showBulkToast(restoring
            ? `${pluralPlans(succeeded.length)} restored.`
            : `${pluralPlans(succeeded.length)} archived. Find ${succeeded.length === 1 ? 'it' : 'them'} under Archived.`);
    } else {
        showBulkToast(`${pluralPlans(succeeded.length)} ${verb}; ${pluralPlans(failed)} couldn't be ${verb}. Please try again.`, 'error');
    }
}

async function handleBulkDelete() {
    if (bulkActionInProgress || selectedPlans.size === 0) return;
    const user = state.session.user;
    if (!user.isAuthenticated || !user.id) {
        alert('Please sign in to manage your plans.');
        return;
    }
    const items = [...selectedPlans.values()];
    const toDelete = items.filter(isSelectedPlanCreatedByMe);
    const toLeave = items.filter(i => !isSelectedPlanCreatedByMe(i));
    const includesCurrent = items.some(i => i.id === state.session.id);

    const parts = [];
    if (toDelete.length) {
        parts.push(`${pluralPlans(toDelete.length)} you created will be permanently deleted, along with everything in ${toDelete.length === 1 ? 'it' : 'them'}, for every collaborator. This can't be undone.`);
    }
    if (toLeave.length) {
        parts.push(`${pluralPlans(toLeave.length)} shared with you will be left instead: ${toLeave.length === 1 ? 'it' : 'they'}'ll be removed from your lists but not deleted for anyone else, and you can rejoin by opening the link.`);
    }
    if (includesCurrent) parts.push('This includes the plan you have open, so you\'ll be moved off it.');
    if (toDelete.length) parts.push('To just hide plans, archive them instead.');

    const title = toDelete.length && toLeave.length
        ? `Delete ${pluralPlans(toDelete.length)} and leave ${pluralPlans(toLeave.length)}?`
        : toDelete.length
            ? `Permanently delete ${pluralPlans(toDelete.length)}?`
            : `Leave ${pluralPlans(toLeave.length)}?`;
    const confirmText = toDelete.length ? 'Delete Permanently' : 'Leave';

    const confirmed = await showBulkConfirm(title, parts.join(' '), confirmText, true);
    if (!confirmed) return;

    setBulkBusy(true, toDelete.length ? 'Deleting…' : 'Leaving…');
    const deleted = [];
    const left = [];
    let failed = 0;
    try {
        for (let i = 0; i < toDelete.length; i += 10) {
            const batch = toDelete.slice(i, i + 10);
            const result = await api.deleteSessionsBulk(batch.map(t => t.id));
            if (result.success === batch.length) deleted.push(...batch);
            else failed += batch.length;
        }
        for (const item of toLeave) {
            if (await api.leaveSession(item.id, user.id)) left.push(item);
            else failed++;
        }
    } finally {
        setBulkBusy(false);
    }

    for (const item of [...deleted, ...left]) {
        takePlanFromLists(item.id);
        untrackRecentPlan(item.id);
    }

    const removedCurrent = [...deleted, ...left].some(i => i.id === state.session.id);
    const summary = [
        deleted.length ? `${pluralPlans(deleted.length)} deleted` : '',
        left.length ? `${pluralPlans(left.length)} left` : ''
    ].filter(Boolean).join(', ');

    if (removedCurrent) {
        if (failed > 0) alert(`${summary || 'Nothing changed'}; ${pluralPlans(failed)} couldn't be removed. Please try again.`);
        const query = currentStoreQuery();
        const currentWasDeleted = deleted.some(i => i.id === state.session.id);
        if (currentWasDeleted) {
            // Same as deleting the open plan from its menu: start a fresh plan.
            const newSessionId = await api.createNewSession(state.ui.activeShopId, user.id, 'New Plan');
            if (newSessionId) {
                window.location.href = `${window.location.pathname}?session=${newSessionId}${query ? `&${query}` : ''}`;
                return;
            }
        }
        window.location.href = `${window.location.pathname}${query ? `?${query}` : ''}`;
        return;
    }

    exitSelectMode();
    renderWtfPlansList();

    if (failed === 0) showBulkToast(`${summary}.`);
    else showBulkToast(`${summary ? summary + '; ' : ''}${pluralPlans(failed)} couldn't be removed. Please try again.`, 'error');
}

// ---- "•••" menu in the filter row ----

function closeMoreMenu() {
    const menu = document.getElementById('wtf-plans-more-menu');
    const btn = document.getElementById('wtf-plans-more-btn');
    if (!menu || menu.hidden) return;
    menu.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
}

function initMoreMenu() {
    const btn = document.getElementById('wtf-plans-more-btn');
    const menu = document.getElementById('wtf-plans-more-menu');
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const opening = menu.hidden;
        menu.hidden = !opening;
        btn.setAttribute('aria-expanded', opening ? 'true' : 'false');
        if (opening) {
            const first = [...menu.querySelectorAll('.wtf-plans-more-item')].find(el => el.style.display !== 'none');
            first?.focus();
        }
    });

    // Close on outside click or Escape (Escape here wins over closing the panel).
    document.addEventListener('click', (e) => {
        if (!menu.hidden && !e.target.closest('.wtf-plans-more')) closeMoreMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || menu.hidden) return;
        e.stopImmediatePropagation();
        closeMoreMenu();
        btn.focus();
    }, true);
}
