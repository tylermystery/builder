// FILE: components/wtfPlansPanel.js
// WTF Plans Panel - Master view for all user's plans, RSVPs, favorites, and projects
// Similar UX to chat lists with sorting by most recent

import { state, setState } from '../state.js';
import { log } from '../utils/debug.js';
import * as api from '../api.js';
import { getTempLikes, updateUrl } from '../utils.js';
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
    STORE: 'store'          // Plans made for the user's store (store owners only)
};

// Local state for the panel
let wtfPlansData = {
    plans: [],      // Shared plans (has collaborators or RSVPs)
    drafts: [],     // Unshared plans (only creator)
    rsvps: [],
    favorites: [],
    projects: [],
    shared: [],     // Plans shared with the user that they haven't created or edited
    store: []       // Store plans (store owners) that aren't the owner's personal plans
};
let currentFilter = WTF_PLAN_TYPES.ALL;
let isLoading = false;

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
    return getPlanActivity(plan)?.lastEditedAt || plan.createdTime;
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
        });
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.body.classList.contains('workspace-ready') && panel && panel.classList.contains('open')) {
            hideWtfPlansPanel();
        }
    });

    // Register for plan state sync to update the current session in the list in real-time
    registerSyncCallback('wtfPlansPanel', handlePlanStateSync);

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
    const { skipPushState = false, filter = null } = options;
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
    currentFilter = filter;
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

        const signedInUserId = isAuthenticated ? userId : null;
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
        const liveIsMine = !!(currentUserId && live && (live.createdBy === currentUserId ||
            (Array.isArray(live.editors) && live.editors.includes(currentUserId))));

        if (findIn(wtfPlansData.plans)) currentSessionCategory = 'plan';
        else if (findIn(wtfPlansData.drafts)) currentSessionCategory = 'draft';
        else if (findIn(wtfPlansData.store)) currentSessionCategory = 'store';
        else if (findIn(wtfPlansData.shared)) currentSessionCategory = 'shared';
        // New, not-yet-fetched sessions default to draft

        if (liveIsMine && (currentSessionCategory === 'shared' || currentSessionCategory === 'store')) {
            currentSessionCategory = (fetched && isPlanShared(fetched, currentUserId)) ? 'plan' : 'draft';
        }
    }

    const CATEGORY_META = {
        plan: { filter: WTF_PLAN_TYPES.PLANS, icon: '📋', untitled: 'Untitled Plan' },
        draft: { filter: WTF_PLAN_TYPES.DRAFTS, icon: '📝', untitled: 'Untitled Draft' },
        shared: { filter: WTF_PLAN_TYPES.SHARED, icon: '👥', untitled: 'Untitled Plan' },
        store: { filter: WTF_PLAN_TYPES.STORE, icon: '🏪', untitled: 'Untitled Plan' }
    };

    const addSessionList = (list, type) => {
        const meta = CATEGORY_META[type];
        // "All" only shows the user's own plans; shared/store plans live in their own filters.
        const inAll = type === 'plan' || type === 'draft';
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
                data: plan
            });
        });
    };

    addSessionList(wtfPlansData.plans, 'plan');
    addSessionList(wtfPlansData.drafts, 'draft');
    addSessionList(wtfPlansData.shared, 'shared');
    addSessionList(wtfPlansData.store, 'store');

    // The open plan always appears in "All" (it's what the user is looking at) and in its own section
    if (currentSessionItem) {
        const meta = CATEGORY_META[currentSessionCategory];
        if (showAll || currentFilter === meta.filter) {
            items.push({ ...currentSessionItem, type: currentSessionCategory, icon: meta.icon });
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
        ...wtfPlansData.store
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
                return 'Sign in to see your plans and projects.';
            default:
                return 'Sign in to see your plans, RSVPs, and favorites.';
        }
    }

    switch (currentFilter) {
        case WTF_PLAN_TYPES.PLANS:
            return 'No shared plans yet. Share a plan with someone to see it here!';
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
        default:
            return 'Nothing here yet. Start planning something fun!';
    }
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
            const dateStr = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : 'No date';
            preview = `${item.itemCount} items • ${dateStr} • $${(item.totalCost || 0).toFixed(2)}`;
            break;
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
        case 'shared':
        case 'store':
            const otherDateStr = item.date ? new Date(item.date + 'T00:00:00').toLocaleDateString() : 'No date';
            preview = `${item.type === 'shared' ? 'Shared with you' : 'Store plan'} • ${item.itemCount} items • ${otherDateStr}`;
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
        <div class="wtf-plans-item-icon">${item.icon}</div>
        <div class="wtf-plans-item-content">
            <div class="wtf-plans-item-name">${escapeHtml(item.name)}${currentBadge}</div>
            <div class="wtf-plans-item-preview">${escapeHtml(preview)}</div>
        </div>
        ${openBadge}
        <div class="wtf-plans-item-time">${timeAgo}</div>
    `;

    // Click handler
    itemEl.addEventListener('click', () => handleWtfPlanItemClick(item));
    itemEl.querySelector('.wtf-plans-open-badge')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlanChat(item);
    });

    return itemEl;
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

    // Shared/Store filters only make sense for signed-in users (Store: store owners only)
    const user = state.session.user;
    if (sharedBtn) sharedBtn.style.display = user.isAuthenticated ? '' : 'none';
    if (storeBtn) storeBtn.style.display = (user.isAuthenticated && user.isOwner && user.ownedStoreId) ? '' : 'none';

    const planCount = wtfPlansData.plans.length;
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
    if (sharedBtn) updateButtonCount(sharedBtn, wtfPlansData.shared.length);
    if (storeBtn) updateButtonCount(storeBtn, wtfPlansData.store.length);
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
    const filter = params.get('wtfFilter') || WTF_PLAN_TYPES.ALL;
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
