// In: main.js
// Action: REPLACE THE ENTIRE FILE

console.log('[MODULE DEBUG] main.js module starting to load...', performance.now().toFixed(2) + 'ms');

import { state, setState } from './state.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { log } from './utils/debug.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, getCombinedPlanStatus } from './availability.js';
import { debounce, updateUrl, extractRecordIdFromPath, loadStripe, findStoreBySlugOrId, storeSlug, getShopUrlParam, decodeSelections } from './utils.js';
import { initializeEventListeners, updateSaveShareButton, initializeChatEventListeners, openChatWidget } from './events.js';
import { initializeSessionChat } from './chat.js';
import { setupCalendarEventListeners } from './components/calendarView.js';
import { setupAuthEventListeners, updateUserProfileIcon, initializeBiometricAuth, showBiometricSetupPromptIfNeeded, updateBiometricManagementUI, showUserModal } from './auth.js';
import * as backgroundEngine from './components/backgroundEngine.js';
import fluidEffect from './components/effects/fluid.js';
import { showReceiptModal } from './components/receipt.js';
import { updateFooter } from './components/footer.js';
import { initializeProjectsDashboard, updateProjectsData, showProjectsLoading } from './components/projectsDashboard.js';
import { initializeWtfPlansPanel, syncWtfPlansPanelWithUrl, refreshWtfPlansData, isWtfPlansPanelOpen, trackRecentPlan } from './components/wtfPlansPanel.js';
import { initializeForumPanel, syncForumPanelWithUrl } from './components/forumPanel.js';
import { loadPublicIdeasForStore } from './components/publicCatalog.js';
import { applyCloudinaryTransform, getBaseCloudinaryUrl } from './utils/imageOptimizer.js';
import { loadTempIterations, loadTempReactions } from './components/refinementHandler.js';

console.log('[MODULE DEBUG] main.js all imports resolved successfully.', performance.now().toFixed(2) + 'ms');
const imageCache = new Map();
window.imageCache = imageCache;

window.applyFiltersAndSort = applyFiltersAndSort;
window.showReceiptModal = showReceiptModal;

// ─── Invite Flow: Process pending invite after login ────────────────
async function handlePendingInvite() {
    const pendingInviteStr = sessionStorage.getItem('pendingInvite');
    if (!pendingInviteStr) return;

    try {
        const pendingInvite = JSON.parse(pendingInviteStr);
        const { sessionId: inviteSessionId, role: inviteRole } = pendingInvite;

        // Only process if we have a valid session and authenticated user
        if (!inviteSessionId || !state.session.user?.isAuthenticated || !state.session.user?.id) {
            log('Main', 'handlePendingInvite: Missing session or user, skipping.');
            return;
        }

        log('Main', `Processing pending invite: session=${inviteSessionId}, role=${inviteRole}, user=${state.session.user.id}`);

        // Create the permission record with the invited role
        const role = inviteRole || 'editor';
        await api.createPermissionRecord(inviteSessionId, state.session.user.id, role);
        log('Main', `Permission record created: ${role} for user ${state.session.user.id} on session ${inviteSessionId}`);

        // Show welcome toast
        const planName = state.eventDetails?.combined?.get?.('eventName') || state.eventDetails?.combined?.get?.('Event Name') || 'the plan';
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        ui.showToast(`Welcome! You've joined "${planName}" as ${roleLabel}.`, 6000, 'success');

        // Clear the pending invite
        sessionStorage.removeItem('pendingInvite');

    } catch (error) {
        console.error('[Main] Error processing pending invite:', error);
        sessionStorage.removeItem('pendingInvite');
    }
}

// ─── Offline Mode Banner Management ────────────────────────────────
function _setupOfflineBanner() {
    api.onAirtableStatusChange((isOnline) => {
        const banner = document.getElementById('airtable-offline-banner');
        if (!banner) return;

        if (isOnline) {
            // Airtable came back online
            const pendingCount = api.getPendingWriteCount();
            if (pendingCount > 0) {
                banner.querySelector('#offline-banner-text').textContent =
                    'Reconnected! Syncing your changes...';
                banner.style.background = 'linear-gradient(90deg, #4caf50, #388e3c)';
                // Auto-hide after sync
                setTimeout(() => {
                    if (api.getPendingWriteCount() === 0) {
                        banner.style.display = 'none';
                    }
                }, 5000);
            } else {
                banner.querySelector('#offline-banner-text').textContent =
                    'Reconnected to data service.';
                banner.style.background = 'linear-gradient(90deg, #4caf50, #388e3c)';
                setTimeout(() => { banner.style.display = 'none'; }, 3000);
            }
        } else {
            // Airtable is offline
            banner.querySelector('#offline-banner-text').textContent =
                'Data service temporarily unavailable \u2014 showing cached catalog data.';
            banner.style.background = 'linear-gradient(90deg, #ff9800, #f57c00)';
            banner.style.display = '';
            _updateQueueBadge();
        }
    });
}

function _updateQueueBadge() {
    const badge = document.getElementById('offline-banner-queue');
    if (!badge) return;
    const count = api.getPendingWriteCount();
    if (count > 0) {
        badge.textContent = `(${count} pending save${count > 1 ? 's' : ''})`;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
}
// ────────────────────────────────────────────────────────────────────

// Expose cache diagnostics for debugging from browser console
window.debugAirtableCache = () => {
    const info = api.getCacheInfo();
    console.log('[AirtableCache] Current status:', info);
    return info;
};

window.debugICalAvailability = () => {
    console.log('=== ICAL AVAILABILITY DEBUG DUMP ===');
    const busyTimesMap = state.calendar.busyTimes;
    console.log(`Cached URLs: ${busyTimesMap.size}`);
    busyTimesMap.forEach((times, url) => {
        console.log(`  URL: ${url}`);
        console.log(`  ${times.length} busy times: ${JSON.stringify(times)}`);
    });
    console.log(`Locked items: ${state.cart.lockedItems.size}`);
    state.cart.lockedItems.forEach((info, id) => {
        const record = state.records.all.find(r => r.id === id);
        const name = record?.fields?.Name || id;
        const icalUrl = record?.fields?.['iCal URL'] || 'NONE';
        const cached = busyTimesMap.get(icalUrl);
        console.log(`  "${name}": iCal=${icalUrl !== 'NONE' ? 'YES' : 'NO'}, cached=${cached ? cached.length : 'NO'}, date=${info?.itemDate || 'none'}`);
    });
    const planDate = state.eventDetails.combined.get('date');
    console.log(`Plan date: ${planDate || 'NONE'}`);
    console.log('=== END ICAL DEBUG ===');
    return { busyTimesCache: Object.fromEntries(busyTimesMap), lockedItems: Object.fromEntries(state.cart.lockedItems) };
};

/**
 * Handles the return from a Stripe ACH payment redirect (Financial Connections).
 * After Stripe redirects the user back, the URL contains payment_success=true,
 * payment_intent, payment_intent_client_secret, and redirect_status.
 * This function retrieves the PaymentIntent to check its status and records the payment.
 */
async function handlePaymentRedirectReturn() {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentSuccess = urlParams.get('payment_success');
    const clientSecret = urlParams.get('payment_intent_client_secret');
    const redirectStatus = urlParams.get('redirect_status');

    if (paymentSuccess !== 'true' || !clientSecret) {
        return false; // Not a payment return
    }

    console.log('[ACH REDIRECT] Payment redirect return detected.', {
        hasClientSecret: !!clientSecret,
        redirectStatus,
        paymentIntentParam: urlParams.get('payment_intent')
    });

    // Clean the URL immediately to prevent re-processing on refresh
    const cleanUrl = new URL(window.location);
    cleanUrl.searchParams.delete('payment_success');
    cleanUrl.searchParams.delete('payment_intent');
    cleanUrl.searchParams.delete('payment_intent_client_secret');
    cleanUrl.searchParams.delete('redirect_status');
    window.history.replaceState({}, document.title, cleanUrl.toString());

    // Retrieve saved payment context from localStorage
    let pendingCtx = null;
    try {
        const raw = localStorage.getItem('pendingPaymentContext');
        if (raw) {
            pendingCtx = JSON.parse(raw);
            console.log('[ACH REDIRECT] Retrieved pending payment context:', {
                sessionId: pendingCtx.sessionId,
                paymentType: pendingCtx.paymentType,
                ageMs: Date.now() - pendingCtx.timestamp
            });
        }
    } catch (e) {
        console.warn('[ACH REDIRECT] Could not parse pending payment context:', e);
    }

    // Clean up localStorage
    try { localStorage.removeItem('pendingPaymentContext'); } catch (e) { /* ignore */ }

    // Expire context older than 30 minutes
    if (pendingCtx && (Date.now() - pendingCtx.timestamp > 30 * 60 * 1000)) {
        console.warn('[ACH REDIRECT] Pending payment context is too old, ignoring.');
        pendingCtx = null;
    }

    try {
        // Initialize Stripe to retrieve the PaymentIntent
        if (!window.Stripe) {
            console.log('[ACH REDIRECT] Loading Stripe.js...');
            await loadStripe();
        }
        const stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);

        console.log('[ACH REDIRECT] Retrieving PaymentIntent from client secret...');
        const { paymentIntent, error } = await stripe.retrievePaymentIntent(clientSecret);

        if (error) {
            console.error('[ACH REDIRECT] Error retrieving PaymentIntent:', error);
            alert('We could not verify your payment status. Please check your payment history or contact support.');
            return true;
        }

        console.log('[ACH REDIRECT] PaymentIntent retrieved:', {
            id: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            paymentMethodType: paymentIntent.payment_method?.type || 'unknown'
        });

        if (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing') {
            const isACHProcessing = paymentIntent.status === 'processing';
            const amountPaid = paymentIntent.amount / 100;

            log('Main', isACHProcessing
                ? `ACH payment redirect return - processing. Amount: $${amountPaid}`
                : `Payment redirect return - succeeded. Amount: $${amountPaid}`);

            // Track community fund chip-in if context is available
            if (pendingCtx?.chipIn) {
                const ci = pendingCtx.chipIn;
                api.upsertCommunityFund(ci.itemId, ci.itemName, ci.amount, ci.goalAmount, ci.storeId)
                    .then(() => log('Main', `Community fund tracked from redirect: $${ci.amount.toFixed(2)}`))
                    .catch(err => console.warn('[ACH REDIRECT] Failed to track community fund:', err));

                try {
                    const donationKey = `donation_fund_${ci.itemId}`;
                    let localData = { raised: 0, contributors: 0 };
                    const stored = localStorage.getItem(donationKey);
                    if (stored) localData = JSON.parse(stored);
                    localData.raised = (localData.raised || 0) + ci.amount;
                    localData.contributors = (localData.contributors || 0) + 1;
                    localStorage.setItem(donationKey, JSON.stringify(localData));
                } catch (e) { /* storage full, ignore */ }
            }

            // Record the payment in the session's payment history
            const paymentNote = isACHProcessing
                ? `ACH Bank Transfer on ${new Date().toLocaleDateString()} (processing)`
                : `Stripe Payment on ${new Date().toLocaleDateString()}`;
            const newPayment = {
                amount: amountPaid,
                date: new Date().toISOString(),
                note: paymentNote
            };

            const currentHistory = state.session.user.paymentHistory || [];
            // Guard against double-recording: check if a payment with same amount was already recorded in the last 5 minutes
            const recentDuplicate = currentHistory.find(p => {
                const timeDiff = Math.abs(new Date(p.date).getTime() - Date.now());
                return p.amount === amountPaid && timeDiff < 5 * 60 * 1000;
            });

            if (recentDuplicate) {
                console.log('[ACH REDIRECT] Payment already recorded (duplicate guard). Skipping recording.');
            } else {
                const updatedPaymentHistory = [...currentHistory, newPayment];
                await api.updatePaymentHistory(state.session.id, updatedPaymentHistory);

                state.session.user.paymentHistory = updatedPaymentHistory;
                state.session.user.amountReceived = updatedPaymentHistory.reduce((sum, p) => sum + p.amount, 0);

                ui.updateTotalCost();
                console.log('[ACH REDIRECT] Payment recorded successfully. New total received:', state.session.user.amountReceived);
            }

            // Show a success notification to the user
            const successMessage = isACHProcessing
                ? 'Bank payment submitted! ACH transfers typically take 2-4 business days to complete.'
                : 'Payment successful! Your payment has been processed.';

            // Create a brief toast notification
            const toast = document.createElement('div');
            toast.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#28a745;color:white;padding:16px 24px;border-radius:8px;z-index:100000;font-size:15px;box-shadow:0 4px 12px rgba(0,0,0,0.3);text-align:center;max-width:90vw;';
            toast.textContent = successMessage;
            document.body.appendChild(toast);
            setTimeout(() => { toast.remove(); }, isACHProcessing ? 8000 : 5000);

        } else if (paymentIntent.status === 'requires_payment_method') {
            console.warn('[ACH REDIRECT] Payment failed - requires new payment method. Status:', paymentIntent.status);
            alert('Your bank payment could not be completed. Please try again with a different payment method.');
        } else if (paymentIntent.status === 'requires_action') {
            console.warn('[ACH REDIRECT] Payment requires additional action. Status:', paymentIntent.status);
            alert('Your bank payment requires additional verification. Please check your bank or email for instructions.');
        } else {
            console.warn('[ACH REDIRECT] Unexpected PaymentIntent status after redirect:', paymentIntent.status);
            alert(`Payment status: ${paymentIntent.status}. If you believe this is an error, please contact support.`);
        }

        return true; // We handled a payment return

    } catch (err) {
        console.error('[ACH REDIRECT] Error handling payment redirect return:', err);
        alert('An error occurred while verifying your payment. Please check your payment history or contact support.');
        return true;
    }
}

/**
 * Waits for the deferred CSS to be fully loaded AND applied
 * Returns a promise that resolves when CSS is ready, or after a timeout
 * @param {number} maxWait - Maximum time to wait in milliseconds (default: 500ms)
 * @returns {Promise<{loaded: boolean, rulesApplied: boolean, reason: string}>}
 */
function waitForDeferredCss(maxWait = 500) {
    return new Promise((resolve) => {
        // Check if any deferred.css link has rel="stylesheet" (meaning it's loaded)
        const checkCssLoaded = () => {
            const links = document.querySelectorAll('link[href*="deferred.css"]');
            return Array.from(links).some(link => link.rel === 'stylesheet');
        };

        // Check if CSS rules are actually accessible (CSS is parsed)
        const checkCssRulesAccessible = () => {
            try {
                const sheets = document.styleSheets;
                for (let i = 0; i < sheets.length; i++) {
                    const sheet = sheets[i];
                    if (sheet.href && sheet.href.includes('deferred.css')) {
                        const rules = sheet.cssRules || sheet.rules;
                        return rules && rules.length > 0;
                    }
                }
            } catch (e) {
                return false;
            }
            return false;
        };

        // Check if styles are actually applied to key elements
        const checkStylesApplied = () => {
            const eventPlanPanel = document.getElementById('event-plan-panel');
            if (eventPlanPanel) {
                const bg = window.getComputedStyle(eventPlanPanel).backgroundColor;
                // deferred.css sets rgba(255, 255, 255, 0.7) for the frosted glass effect
                return bg && (bg.includes('rgba(255') || bg.includes('rgb(255'));
            }
            return false;
        };

        // Already loaded and rules applied
        const isLoaded = checkCssLoaded();
        const rulesAccessible = checkCssRulesAccessible();
        const stylesApplied = checkStylesApplied();

        if (isLoaded && rulesAccessible) {
            resolve({ loaded: true, rulesApplied: rulesAccessible, reason: 'already-loaded' });
            return;
        }

        const startTime = performance.now();

        // Set up MutationObserver to watch for rel attribute change
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes' && mutation.attributeName === 'rel') {
                    if (checkCssLoaded()) {
                        // Wait a tiny bit for browser to parse the CSS
                        setTimeout(() => {
                            const rulesNow = checkCssRulesAccessible();
                            observer.disconnect();
                            resolve({ loaded: true, rulesApplied: rulesNow, reason: 'mutation-observer' });
                        }, 20);
                        return;
                    }
                }
            }
        });

        // Observe all deferred.css link elements
        const links = document.querySelectorAll('link[href*="deferred.css"]');
        links.forEach(link => observer.observe(link, { attributes: true }));

        // Fallback: poll at short intervals
        const pollInterval = setInterval(() => {
            if (checkCssLoaded() && checkCssRulesAccessible()) {
                clearInterval(pollInterval);
                observer.disconnect();
                resolve({ loaded: true, rulesApplied: true, reason: 'polling' });
            }
        }, 10);

        // Timeout fallback - don't wait forever
        setTimeout(() => {
            clearInterval(pollInterval);
            observer.disconnect();
            const loaded = checkCssLoaded();
            const rulesApplied = checkCssRulesAccessible();
            if (!loaded || !rulesApplied) {
                console.warn('[CSS-WAIT] Timed out waiting for deferred CSS');
            }
            resolve({ loaded, rulesApplied, reason: 'timeout' });
        }, maxWait);
    });
}

function syncUiWithUrl() {
    const params = new URLSearchParams(window.location.search);
    console.log('[SYNC-URL DEBUG] syncUiWithUrl called. URL params:', Object.fromEntries(params.entries()));
    console.log('[SYNC-URL DEBUG] state.records.all.length:', state.records.all.length, 'state.cart.lockedItems.size:', state.cart.lockedItems.size);

    // Support both query param (?openItem=recXYZ) and pretty URL (/item/slug-recXYZ)
    let openItemId = params.get('openItem');
    if (!openItemId) {
        // Check for pretty URL format
        openItemId = extractRecordIdFromPath(window.location.pathname);
    }

    const view = params.get('view');
    let categoryFilter = params.get('category');

    // Shareable checkout deep-link params (see writeCheckoutUrlState in modal.js):
    //   action=rapidpay|chipin  → open that flow on the item, with...
    //   qty / opts              → ...the sharer's quantity and option selections.
    //   action=checkout         → open the plan checkout for the loaded session.
    const checkoutAction = params.get('action');
    const checkoutQty = params.get('qty');
    const checkoutOpts = params.get('opts');

    // --- Auto-select first category when store has categories and no category is selected ---
    // This applies only when:
    // 1. No category is selected (categoryFilter is null/undefined)
    // 2. No special view is active (plan, likes, categories, packages, etc.)
    // 3. No item modal is being opened
    // 4. The active store has categories defined in its Items field
    const specialViews = ['plan', 'likes', 'categories', 'packages', 'my-sessions', 'rsvp-events', 'present', 'itinerary', 'tasks'];
    const isSpecialView = view && specialViews.includes(view);
    const isLandingPage = !categoryFilter && !isSpecialView && !openItemId;

    if (isLandingPage && state.ui.activeShopId) {
        const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
        if (activeShop && activeShop.fields && activeShop.fields.Items && activeShop.fields.Items.length > 0) {
            // Get the first category from the store's Items field
            const storeItemIds = Array.isArray(activeShop.fields.Items)
                ? activeShop.fields.Items
                : activeShop.fields.Items.split(',').map(id => id.trim());

            // Find the first valid category (Grouping record)
            const firstCategoryId = storeItemIds.find(id => id.startsWith('rec'));
            if (firstCategoryId) {
                const firstCategoryRecord = state.records.all.find(r => r.id === firstCategoryId && r.fields['Item Type'] === 'Grouping');
                if (firstCategoryRecord && firstCategoryRecord.fields.Name) {
                    const firstCategoryName = firstCategoryRecord.fields.Name;
                    log('Main', `Store has categories - auto-selecting first category: "${firstCategoryName}"`);

                    // Update URL with the first category (using replaceState to avoid adding to history)
                    const url = new URL(window.location);
                    url.searchParams.set('category', firstCategoryName);
                    history.replaceState({}, '', url.toString());

                    // Update categoryFilter for the rest of this function
                    categoryFilter = firstCategoryName;
                }
            }
        }
    }

    // DEBUG: Log URL sync entry point with CSS state
    const isDirectModalAccess = !!openItemId && !document.querySelector('#detail-modal-overlay.active');

    // Close any open overlays first
    console.log('[SYNC-URL DEBUG] Closing open overlays (hideDetailModal, hideItineraryModal, hidePresentationView)...');
    try {
        ui.hideDetailModal();
        console.log('[SYNC-URL DEBUG] hideDetailModal completed.');
    } catch (e) {
        console.error('[SYNC-URL DEBUG] hideDetailModal FAILED:', e.message, e.stack);
    }
    try {
        ui.hideItineraryModal();
    } catch (e) {
        console.error('[SYNC-URL DEBUG] hideItineraryModal FAILED:', e.message, e.stack);
    }
    try {
        ui.hidePresentationView();
    } catch (e) {
        console.error('[SYNC-URL DEBUG] hidePresentationView FAILED:', e.message, e.stack);
    }

    // Sync WTF Plans panel state with URL (for browser back/forward navigation)
    syncWtfPlansPanelWithUrl(params);

    // Sync Forum Panel state with URL (for browser back/forward navigation)
    syncForumPanelWithUrl(params);

    // --- Sync 'My Plan'/'My Likes' Button Active State ---
    const categoryFilters = document.getElementById('category-filters');
    if (categoryFilters) {
        categoryFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        let buttonToActivate;

        if (view === 'plan') {
            buttonToActivate = document.getElementById('plan-filter-btn');
        } else if (view === 'likes') {
            buttonToActivate = document.getElementById('menu-likes-btn');
        } else if (categoryFilter) {
            buttonToActivate = categoryFilters.querySelector(`.filter-btn[data-filter="${categoryFilter}"]`);
        }
        // No else - on landing page with no category set, no button should be active
        // This allows carousels to show all store categories

        if (buttonToActivate) {
            buttonToActivate.classList.add('active');
        }
    }

    // Skip catalog rendering when in presentation view to expedite loading
    // The presentation view is a standalone page that doesn't need the catalog background
    if (view !== 'present') {
        // Re-apply filters based on the URL
        if (typeof applyFiltersAndSort === 'function') {
            applyFiltersAndSort(imageCache);
        } else {
             console.error("applyFiltersAndSort is not defined or imported correctly.");
        }
    }

    // --- Handle opening modals/views based on URL ---
    // For direct modal URL access, wait for deferred CSS before showing modal
    const handleModalOrViewFromUrl = async () => {
        console.log('[SYNC-URL DEBUG] handleModalOrViewFromUrl called. view:', view, 'openItemId:', openItemId);
        if (view === 'present') {
            console.log('[SYNC-URL DEBUG] Opening presentation view...');

            // Detect if user came from viewer page via "Join Collab" link
            const streamParam = params.get('stream');
            if (streamParam === 'live') {
                console.log('[SYNC-URL DEBUG] User joined from viewer page — setting joinedFromViewer flag');
                setState({
                    stream: {
                        ...state.stream,
                        joinedFromViewer: true
                    }
                });
                // Remove stream=live from URL to prevent re-triggering on refresh
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('stream');
                history.replaceState({}, '', cleanUrl.toString());
            }

            ui.showPresentationView('ideas');
        } else if (view === 'itinerary') {
            ui.showItineraryModal();
        } else if (view === 'account-phone') {
            // Direct link to account popup with phone sign-in section expanded (for Twilio verification)
            showUserModal({ section: 'phone' });
            log('Main', 'Opened account modal with phone section for direct link (Twilio)');
        } else if (view === 'account') {
            // Direct link to account popup (general account access)
            showUserModal();
            log('Main', 'Opened account modal for direct link');
        } else if (openItemId) {
            // Wait for deferred CSS before showing modal on direct URL access
            // This prevents styling issues where the page behind the modal looks broken
            const cssResult = await waitForDeferredCss(1500);

            const recordToOpen = state.records.all.find(r => r.id === openItemId);
            if (recordToOpen) {
                if (!cssResult.loaded || !cssResult.rulesApplied) {
                    // Force a layout recalculation by triggering a reflow
                    document.body.offsetHeight;
                    // Give a bit more time for CSS to settle before showing modal
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
                await ui.showDetailModal(recordToOpen);

                // Shared Rapid Pay / Chip In deep link: restore the sharer's
                // selections + quantity, then open the matching checkout flow.
                if (checkoutAction === 'rapidpay' || checkoutAction === 'chipin') {
                    try {
                        await ui.applyCheckoutDeepLink({
                            action: checkoutAction,
                            qty: checkoutQty,
                            selections: decodeSelections(checkoutOpts),
                        });
                    } catch (e) {
                        console.warn('[SYNC-URL] Failed to apply checkout deep link:', e?.message);
                    }
                }
            } else {
                console.warn(`Record ID ${openItemId} not found in state.records.all (${state.records.all.length} records loaded)`);
            }
        } else if (checkoutAction === 'checkout') {
            // Shared plan-checkout deep link: open the plan checkout once the
            // session has loaded and the plan actually has items. An empty plan
            // just lands on the plan (no forced modal).
            if (state.cart.lockedItems.size > 0) {
                try {
                    const shopSettings = ui.getShopSettings();
                    ui.showCheckoutModal(shopSettings);
                } catch (e) {
                    console.warn('[SYNC-URL] Failed to open plan checkout from deep link:', e?.message);
                }
            } else {
                log('Main', 'action=checkout deep link, but plan has no items — skipping checkout modal.');
            }
        }
    };

    // Small initial delay for DOM to stabilize, then handle modal/view
    setTimeout(handleModalOrViewFromUrl, 100);
}


async function initialize() {
    console.log('[INIT DEBUG] ========== APP INITIALIZATION STARTED ==========');
    console.log('[INIT DEBUG] URL:', window.location.href);
    console.log('[INIT DEBUG] Timestamp:', performance.now().toFixed(2) + 'ms');
    log('Main', '1. Initialization started.');

    // Early detection of presentation mode for optimized initialization
    const isDirectModalUrl = window.location.pathname.includes('/item/') ||
                             new URLSearchParams(window.location.search).has('openItem');
    const urlParamsEarly = new URLSearchParams(window.location.search);
    const isInPresentationMode = urlParamsEarly.get('view') === 'present';
    console.log('[INIT DEBUG] Mode detection:', { isDirectModalUrl, isInPresentationMode, view: urlParamsEarly.get('view'), session: urlParamsEarly.get('session') });
    if (isInPresentationMode) {
        log('Main', 'Presentation mode detected - optimizing initialization for faster load');
    }

    console.log('[INIT DEBUG] Checking ui module exports...');
    console.log('[INIT DEBUG] ui.initStateHelpers:', typeof ui.initStateHelpers);
    console.log('[INIT DEBUG] ui.renderRecords:', typeof ui.renderRecords);
    console.log('[INIT DEBUG] ui.showDetailModal:', typeof ui.showDetailModal);
    console.log('[INIT DEBUG] ui.hideDetailModal:', typeof ui.hideDetailModal);
    console.log('[INIT DEBUG] ui.showPresentationView:', typeof ui.showPresentationView);
    console.log('[INIT DEBUG] ui.hidePresentationView:', typeof ui.hidePresentationView);
    console.log('[INIT DEBUG] ui.updateEventPlanSection:', typeof ui.updateEventPlanSection);
    console.log('[INIT DEBUG] ui.toggleLoading:', typeof ui.toggleLoading);
    console.log('[INIT DEBUG] ui.showGroupDetailModal:', typeof ui.showGroupDetailModal);
    console.log('[INIT DEBUG] ui.createInteractiveCard:', typeof ui.createInteractiveCard);
    ui.initStateHelpers({ getItemState: ui.getItemState });

     document.addEventListener('userLoggedIn', () => {
         log('Main', "'userLoggedIn' event caught, reapplying filters and reinitializing chat.");

         // Process any pending invite (Phase 1b: auto-associate invitee with plan)
         handlePendingInvite();

         // Skip catalog operations if in presentation mode
         const currentUrlParams = new URLSearchParams(window.location.search);
         const currentlyInPresentation = currentUrlParams.get('view') === 'present';

         if (!currentlyInPresentation && typeof applyFiltersAndSort === 'function') {
              applyFiltersAndSort(imageCache);
         }
         // Update all heart icons to reflect the newly loaded liked items
         if (!currentlyInPresentation) {
             const recordIds = Array.from(document.querySelectorAll('.event-card[data-record-id]')).map(card => card.dataset.recordId);
             if (recordIds.length > 0) ui.batchUpdateCardIcons(recordIds);
         }
         if (typeof initializeSessionChat === 'function') {
            log('Main', 'User logged in, re-initializing session chat with new user info.');
            initializeSessionChat();
         }

         // Show biometric setup prompt if user hasn't set it up yet
         showBiometricSetupPromptIfNeeded();
         updateBiometricManagementUI();

         // Fetch project hierarchy for the logged-in user
         if (state.session.user.isAuthenticated && state.session.user.id) {
             log('Main', 'User logged in, fetching project hierarchy...');
             showProjectsLoading();
             api.fetchProjectHierarchy(state.session.user.id).then(projects => {
                 updateProjectsData(projects);
                 log('Main', `Project hierarchy loaded: ${projects.length} projects`);
             }).catch(err => {
                 console.error('Failed to fetch project hierarchy:', err);
             });

             // Show authenticated-only menu buttons
             const menuSessionsBtn = document.getElementById('menu-sessions-btn');
             const menuProjectsBtn = document.getElementById('menu-projects-btn');
             if (menuSessionsBtn) menuSessionsBtn.style.display = 'flex';
             if (menuProjectsBtn) menuProjectsBtn.style.display = 'flex';

             // Refresh WTF Plans panel data if it's open, so newly associated plans appear
             if (isWtfPlansPanelOpen()) {
                 console.log('[LOGIN-ASSOC] WTF Plans panel is open, refreshing data...');
                 refreshWtfPlansData().then(() => {
                     console.log('[LOGIN-ASSOC] WTF Plans panel data refreshed after login.');
                 }).catch(err => {
                     console.error('[LOGIN-ASSOC] Failed to refresh WTF Plans data:', err);
                 });
             }
         }
     });

    document.addEventListener('planCreated', () => {
        log('Main', 'New plan created.');
        console.log(`[PLAN-CREATED] New plan created. Session ID: ${state.session.id}, User: ${state.session.user.id}`);
        // Track in localStorage so it persists in the plan list across page loads
        trackRecentPlan(state.session.id);
        // Refresh WTF Plans panel data if open so the new plan appears in the list
        if (isWtfPlansPanelOpen()) {
            console.log('[PLAN-CREATED] WTF Plans panel is open, refreshing data...');
            refreshWtfPlansData().catch(err => {
                console.error('[PLAN-CREATED] Failed to refresh WTF Plans data:', err);
            });
        }
    });
    document.addEventListener('sessionReady', async () => {
        console.log('[SESSION-READY] ========== EVENT HANDLER START ==========');
        console.log(`[SESSION-READY] Session: ${state.session.id}, Items: ${state.cart.items.size}, Locked: ${state.cart.lockedItems.size}`);
        log('Main', '"sessionReady" event received, re-initializing session chat.');

        // Track in localStorage so this plan persists in the plan list
        trackRecentPlan(state.session.id);

        // Handle ACH/bank payment redirect return (from Financial Connections flow)
        // This must run after session is loaded so we can record the payment to the session.
        try {
            const wasPaymentReturn = await handlePaymentRedirectReturn();
            if (wasPaymentReturn) {
                console.log('[SESSION-READY] Payment redirect return was handled.');
            }
        } catch (err) {
            console.error('[SESSION-READY] Error in payment redirect handler:', err);
        }

        // Check if we're in presentation view - skip catalog-related updates if so
        const urlParams = new URLSearchParams(window.location.search);
        const currentView = urlParams.get('view');
        const isInPresentationView = currentView === 'present';

        if (typeof initializeSessionChat === 'function') {
             console.log('[SESSION-READY] Initializing session chat...');
             initializeSessionChat();
        } else {
             console.error('[SESSION-READY] ❌ initializeSessionChat is not defined');
             console.error("initializeSessionChat is not defined or imported correctly.");
        }

        // Only update catalog-related UI components when NOT in presentation view
        if (!isInPresentationView) {
            console.log('[SESSION-READY] Updating UI components...');
            ui.updateHeader();
            ui.updateEventPlanSection();
            ui.updateIdeasCarousel();
            ui.updateTotalCost();
            ui.updateEventPlanDateDisplay(); // Ensure date display is updated after session loads

            const recordIds = Array.from(document.querySelectorAll('.event-card[data-record-id]')).map(card => card.dataset.recordId);
            if (recordIds.length > 0) ui.batchUpdateCardIcons(recordIds);

            // Verify no duplicate items after a short delay to ensure DOM updates complete
            setTimeout(() => {
                ui.verifyNoDuplicateItems();
            }, 100);
        } else {
            console.log('[SESSION-READY] In presentation view - skipping catalog UI updates');
        }

        console.log('[SESSION-READY] ========== EVENT HANDLER END ==========');
    });

    ui.toggleLoading(true);
    try {
        console.log('[INIT DEBUG] ========== FETCHING INITIAL DATA ==========');
        console.log('[INIT DEBUG] Calling api.fetchAllStores and api.fetchAllRecords...');

        // Retry wrapper for initial data fetch — Airtable can return transient 500 errors
        let stores, records;
        const maxInitRetries = 1;
        for (let initAttempt = 0; initAttempt <= maxInitRetries; initAttempt++) {
            try {
                const fetchStart = performance.now();
                [stores, records] = await Promise.all([api.fetchAllStores(), api.fetchAllRecords()]);
                const fetchEnd = performance.now();
                console.log(`[INIT DEBUG] Data fetched in ${(fetchEnd - fetchStart).toFixed(0)}ms: ${stores.length} stores, ${records.length} records`);
                if (initAttempt > 0) {
                    console.log(`[INIT DEBUG] ✅ Succeeded on initialization attempt ${initAttempt + 1}`);
                }
                break; // success
            } catch (fetchError) {
                if (initAttempt < maxInitRetries) {
                    const retryDelay = 3000 * (initAttempt + 1);
                    console.warn(`[INIT DEBUG] ⚠️ Data fetch failed (attempt ${initAttempt + 1}/${maxInitRetries + 1}). Retrying in ${retryDelay}ms...`, fetchError.message);
                    const loadingMsg = document.getElementById('loading-message');
                    if (loadingMsg) {
                        loadingMsg.textContent = `Connection issue — retrying (${initAttempt + 1}/${maxInitRetries + 1})...`;
                    }
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                    continue;
                }
                throw fetchError; // exhausted retries
            }
        }

        log('Main', `Fetched ${stores.length} stores and ${records.length} records.`);

        // Prioritize AI-generated Rankings over default profiles
        // Rankings field contains AI profiler determined rankings from Gemini
        records.forEach(record => {
            const isProfileableItem = record.fields['Item Type'] === 'Bookable Item' || record.fields['Item Type'] === 'Event';

            if (isProfileableItem) {
                // If item has AI-generated Rankings, use that as the AI_Profile
                if (record.fields.Rankings && !record.fields.AI_Profile) {
                    record.fields.AI_Profile = record.fields.Rankings;
                    log('Main', `Applied AI-generated Rankings to AI_Profile for: ${record.fields.Name}`);
                }
                // If item has both, prefer Rankings (AI-generated) over existing AI_Profile if Rankings has AI source
                else if (record.fields.Rankings && record.fields.AI_Profile) {
                    try {
                        const rankingsProfile = JSON.parse(record.fields.Rankings);
                        // If Rankings has AI source, it should take precedence
                        if (rankingsProfile.profileSource && rankingsProfile.profileSource.includes('ai_')) {
                            record.fields.AI_Profile = record.fields.Rankings;
                            log('Main', `Updated AI_Profile with newer AI-generated Rankings for: ${record.fields.Name}`);
                        }
                    } catch (e) {
                        // If Rankings can't be parsed, keep existing AI_Profile
                    }
                }
            }
        });

        // Overlay saved Visual Scene Builder photos onto published events so the
        // scene a planner built becomes the event's main image everywhere it renders
        // (catalog cards, detail modal, RSVP lists). fetchImagesForRecord treats
        // _customImages as the highest-priority source. Best-effort: a failure here
        // must never block the catalog from loading.
        try {
            const eventCovers = await api.fetchEventCoverImages();
            if (eventCovers && Object.keys(eventCovers).length > 0) {
                let applied = 0;
                records.forEach(record => {
                    if (record.fields?.['Item Type'] !== 'Event') return;
                    const coverUrl = eventCovers[record.id];
                    // Don't clobber an event that already carries custom images.
                    const hasCustom = Array.isArray(record.fields._customImages) && record.fields._customImages.length > 0;
                    if (coverUrl && !hasCustom) {
                        record.fields._customImages = [{ url: coverUrl, isSceneImage: true }];
                        applied++;
                    }
                });
                log('Main', `Applied scene main photos to ${applied} published event(s).`);
            }
        } catch (coverErr) {
            console.warn('[INIT DEBUG] Could not apply event scene photos:', coverErr);
        }

        setState({
            stores: { all: stores },
            records: { all: records }
        });
        console.log('[INIT DEBUG] State updated with stores and records. state.records.all.length:', state.records.all.length, 'state.stores.all.length:', state.stores.all.length);
        log('Main', `Fetched ${stores.length} stores and ${records.length} items. Applied AI-generated Rankings where available.`);

        // Show offline banner if data came from local cache
        if (!api.isAirtableOnline()) {
            const banner = document.getElementById('airtable-offline-banner');
            if (banner) banner.style.display = '';
            const cacheInfo = api.getCacheInfo();
            console.log('[INIT DEBUG] ⚠️ Running in OFFLINE MODE with cached data:', cacheInfo);
            const loadingMsg = document.getElementById('loading-message');
            if (loadingMsg) {
                loadingMsg.textContent = 'Loaded from cache — some data may be outdated.';
            }
        }

    } catch (error) {
        console.error("Failed to load initial store/item data:", error);
        const isServerError = error.message && error.message.includes('500');
        const retrySeconds = 20;
        document.getElementById('loading-message').innerHTML = `
            <div style='color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 20px; text-align: center; max-width: 500px; margin: 0 auto;'>
                <p style='margin: 0 0 15px 0; font-weight: bold;'>Unable to Load Catalog</p>
                <p style='margin: 0 0 15px 0;'>${isServerError
                    ? 'The data service is temporarily unavailable (server error). This usually resolves on its own.'
                    : 'We couldn\'t connect to load the event catalog. Please check your internet connection.'
                }</p>
                <p id='retry-countdown' style='margin: 0 0 15px 0; font-size: 13px; color: #555;'>Auto-retrying in <span id='retry-timer'>${retrySeconds}</span>s...</p>
                <button onclick="window.location.reload()" style='background-color: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;'>Retry Now</button>
            </div>
        `;
        // Auto-retry countdown
        let remaining = retrySeconds;
        const countdownInterval = setInterval(() => {
            remaining--;
            const timerEl = document.getElementById('retry-timer');
            if (timerEl) timerEl.textContent = remaining;
            if (remaining <= 0) {
                clearInterval(countdownInterval);
                window.location.reload();
            }
        }, 1000);
        ui.toggleLoading(true);
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    let shopId = urlParams.get('shopId');
    const shopSlug = urlParams.get('shop');
    let activeShop = null;

    // CRITICAL FIX: Restore authentication state from JWT BEFORE loading session
    // This prevents the "collaborator or store owner" error on page reload
    const jwt = localStorage.getItem('jwt');
    if (jwt) {
        try {
            const payload = JSON.parse(atob(jwt.split('.')[1]));
            if (payload.exp * 1000 > Date.now()) {
                setState({
                    session: {
                        ...state.session,
                        user: {
                            ...state.session.user,
                            isAuthenticated: true,
                            id: payload.userId,
                            name: payload.name,
                            email: payload.email,
                            isOwner: payload.isOwner,
                            ownedStoreId: payload.ownedStoreId || null,
                            ownerDashboardId: payload.ownerDashboardId || null
                        }
                    }
                });
                log('Main', `User authenticated via JWT (early init): ${payload.userId}, isOwner: ${payload.isOwner}, ownedStoreId: ${payload.ownedStoreId}`);
            } else {
                localStorage.removeItem('jwt');
                log('Main', 'Existing JWT expired (early init).');
            }
        } catch (e) {
            localStorage.removeItem('jwt');
            console.error("[Main] Failed to parse existing JWT (early init):", e);
        }
    }

    if (shopId) {
        activeShop = state.stores.all.find(s => s.id === shopId);
        log('Main', `Shop ID found in URL: ${shopId}. Found shop: ${!!activeShop}`);
    } else if (shopSlug) {
        activeShop = findStoreBySlugOrId(shopSlug, state.stores.all);
        log('Main', `Shop slug found in URL: ${shopSlug}. Found shop: ${!!activeShop}`);
    }

    if (sessionId) {
         log('Main', `Session ID found in URL: ${sessionId}. Loading session...`);
         await api.loadSessionFromAirtable(sessionId);
         if (!activeShop && state.session.storeId) {
              activeShop = state.stores.all.find(s => s.id === state.session.storeId);
              log('Main', `Determined shop from loaded session: ${state.session.storeId}. Found shop: ${!!activeShop}`);
         }

        // Load unauthenticated user's temp iterations/reactions from localStorage (Decision 4)
        if (!state.session.user.isAuthenticated) {
            loadTempIterations();
            loadTempReactions();
        }

        // --- Phase 1b: Invite flow handling ---
        // Support both new tokenized invites and legacy plaintext invites
        const inviteToken = urlParams.get('invite_token');
        const isLegacyInvite = urlParams.get('invite') === 'true';
        const inviteEmail = urlParams.get('email');
        const inviteRole = urlParams.get('role');

        if (inviteToken) {
            // New tokenized invite flow — validate token server-side
            log('Main', `Tokenized invite link detected. Token: ${inviteToken.substring(0, 8)}...`);

            (async () => {
                try {
                    const resp = await fetch('/api/validate-invite-token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token: inviteToken })
                    });
                    const result = await resp.json();

                    if (!resp.ok) {
                        log('Main', `Invite token validation failed: ${result.error}`);
                        ui.showToast(result.error || 'Invalid invite link.', 5000, 'error');
                        // Clean token from URL
                        const cleanUrl = new URL(window.location.href);
                        cleanUrl.searchParams.delete('invite_token');
                        history.replaceState({}, '', cleanUrl.toString());
                        return;
                    }

                    // Token is valid — store invite info for post-login processing
                    sessionStorage.setItem('pendingInvite', JSON.stringify({
                        sessionId: result.sessionId,
                        email: result.email || '',
                        role: result.role || 'editor'
                    }));

                    // If we're not on the right session, redirect
                    if (result.sessionId && result.sessionId !== sessionId) {
                        window.location.href = `/?session=${result.sessionId}`;
                        return;
                    }

                    if (!state.session.user.isAuthenticated) {
                        // Pre-fill sign-in email
                        if (result.email) {
                            const signinEmailInput = document.getElementById('signin-email');
                            if (signinEmailInput) signinEmailInput.value = result.email;
                            localStorage.setItem('lastSignInEmail', result.email);
                        }
                        const planName = result.sessionName || state.session.name || 'a plan';
                        const inviter = result.inviterName || 'Someone';
                        log('Main', `Tokenized invitee landing: prompting auth for plan "${planName}"`);
                        setTimeout(() => {
                            showUserModal();
                            const signinMessage = document.getElementById('signin-message');
                            if (signinMessage) {
                                signinMessage.style.color = '#667eea';
                                signinMessage.textContent = `${inviter} invited you to collaborate on "${planName}"! Sign in to join.`;
                            }
                        }, 800);
                    } else {
                        log('Main', 'Tokenized invitee already authenticated, processing invite...');
                        handlePendingInvite();
                    }
                } catch (err) {
                    console.error('[Main] Error validating invite token:', err);
                    ui.showToast('Could not validate invite link. Please try again.', 5000, 'error');
                }
                // Clean token from URL
                const cleanUrl = new URL(window.location.href);
                cleanUrl.searchParams.delete('invite_token');
                history.replaceState({}, '', cleanUrl.toString());
            })();

        } else if (isLegacyInvite) {
            // Legacy invite flow (backwards compatibility for any in-flight emails)
            log('Main', `Legacy invite link detected. Email: ${inviteEmail}, Role: ${inviteRole}`);

            if (inviteEmail || inviteRole) {
                sessionStorage.setItem('pendingInvite', JSON.stringify({
                    sessionId: sessionId,
                    email: inviteEmail || '',
                    role: inviteRole || 'editor'
                }));
            }

            if (!state.session.user.isAuthenticated) {
                if (inviteEmail) {
                    const signinEmailInput = document.getElementById('signin-email');
                    if (signinEmailInput) signinEmailInput.value = inviteEmail;
                    localStorage.setItem('lastSignInEmail', inviteEmail);
                }
                const planName = state.session.name || state.eventDetails?.combined?.get?.('Event Name') || 'a plan';
                log('Main', `Legacy invitee landing: prompting auth for plan "${planName}"`);
                setTimeout(() => {
                    showUserModal();
                    const signinMessage = document.getElementById('signin-message');
                    if (signinMessage) {
                        signinMessage.style.color = '#667eea';
                        signinMessage.textContent = `You've been invited to collaborate! Sign in with your email to join.`;
                    }
                }, 800);
            } else {
                log('Main', 'Legacy invitee already authenticated, processing invite...');
                handlePendingInvite();
            }

            const cleanUrl = new URL(window.location.href);
            cleanUrl.searchParams.delete('invite');
            cleanUrl.searchParams.delete('email');
            cleanUrl.searchParams.delete('role');
            history.replaceState({}, '', cleanUrl.toString());
        }
    }

    if (!activeShop) {
        const lastVisitedShopId = localStorage.getItem('lastVisitedShopId');
        if (lastVisitedShopId) {
            activeShop = state.stores.all.find(s => s.id === lastVisitedShopId);
             log('Main', `Using last visited shop from localStorage: ${lastVisitedShopId}. Found shop: ${!!activeShop}`);
        }
    }

    if (!activeShop) {
        activeShop = state.stores.all.find(r => r.fields.Name === "Tyler's Mystery Tours");
         log('Main', `Falling back to default shop 'Tyler's Mystery Tours'. Found shop: ${!!activeShop}`);
    }

    if (activeShop) {
        // CRITICAL FIX: Explicitly preserve currentProgress when setting activeShopId
        const uiUpdate = {
            ...state.ui,
            activeShopId: activeShop.id,
            // Ensure currentProgress maintains its default value of 0.3
            currentProgress: state.ui.currentProgress !== undefined ? state.ui.currentProgress : 0.3
        };
        setState({ ui: uiUpdate });
        localStorage.setItem('lastVisitedShopId', activeShop.id);
        log('Main', `Active Shop set to: ${activeShop.fields.Name} (ID: ${activeShop.id})`);

        // Load this store's public community ideas and merge them into the
        // catalog as "Public Idea" status records. Fire-and-forget so it never
        // blocks the main catalog from rendering.
        loadPublicIdeasForStore(activeShop.id);

        document.title = `${activeShop.fields.Name} WTFun`;

        if (!state.session.id) {
            // Skip auto-session creation when landing on a direct /item/ share URL.
            // Why: the visitor is just viewing a shared item; auto-creating a session
            // injects ?session=... into the URL, which pollutes share links and can
            // make recipients inherit the original sharer's plan id.
            const isDirectItemUrl = window.location.pathname.startsWith('/item/');
            if (isDirectItemUrl) {
                log('Main', 'Direct item URL detected — skipping auto-session creation to keep share URL clean.');
            } else if (api.isAirtableOnline()) {
                log('Main', 'No session ID found, creating new session for guest chat...');
                await api.saveSessionToAirtable();
            } else {
                log('Main', 'No session ID found, but Airtable is offline — skipping session creation.');
            }
        }

        const titleElement = document.getElementById('main-shop-title');
        if (titleElement) {
            const shopTitleField = activeShop.fields['Shop Title'] || activeShop.fields.Name;
            const titles = shopTitleField.split('|').map(t => t.trim()).filter(Boolean);
            const displayTitle = titles.length > 0 ? titles[0] : 'Shop'; 

            const shopTypeLabelField = activeShop.fields['Shop Type Label'] || 'Shop'; 
            const labels = shopTypeLabelField.split('|').map(t => t.trim()).filter(Boolean);
            const displayLabel = labels.length > 0 ? labels[0] : 'Shop'; 

            titleElement.innerHTML = `${displayTitle} <sup>${displayLabel}</sup><button id="shop-switcher-trigger" style="background:none; border:none; color:transparent; cursor:pointer; font-size: 1em; vertical-align: super;">s</button>`;

            titleElement.style.cursor = 'pointer';
            titleElement.addEventListener('click', (e) => {
                if (e.target.id !== 'shop-switcher-trigger') {
                    // Navigate to top level catalog without reloading (avoids creating new session)
                    const newUrl = `${window.location.pathname}?${getShopUrlParam(activeShop.id, state.stores.all)}`;
                    history.pushState({}, '', newUrl);
                    syncUiWithUrl();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    log('Main', `Navigated to top level catalog for shop: ${activeShop.id}`);
                }
            });
            const switcherTrigger = document.getElementById('shop-switcher-trigger');
            if (switcherTrigger) switcherTrigger.addEventListener('click', () => ui.showShopSwitcher());

            // WTF button in hamburger menu
            const menuWtfBtn = document.getElementById('menu-wtf-btn');
            const hamburgerMenuDropdown = document.getElementById('hamburger-menu-dropdown');
            if (menuWtfBtn) {
                menuWtfBtn.addEventListener('click', () => {
                    if (hamburgerMenuDropdown) hamburgerMenuDropdown.style.display = 'none';
                    ui.showShopSwitcher();
                });
            }

            // Groups button in hamburger menu — opens this store's groups
            // directory (public groups for everyone; publishers also get the
            // create/manage tools there). Scoped to the active shop.
            const menuGroupsBtn = document.getElementById('menu-groups-btn');
            if (menuGroupsBtn) {
                menuGroupsBtn.addEventListener('click', () => {
                    if (hamburgerMenuDropdown) hamburgerMenuDropdown.style.display = 'none';
                    const shopId = (activeShop && activeShop.id)
                        || state.ui.activeShopId
                        || localStorage.getItem('lastVisitedShopId')
                        || '';
                    window.location.href = `/groups.html?storeId=${encodeURIComponent(shopId)}`;
                });
            }
        }
        
        const existingFavicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (existingFavicon) existingFavicon.remove();
        
        const logoTag = activeShop.fields.LogoTag;
        if (logoTag) {
            const imageUrls = await api.fetchImagesByTags(logoTag);
            if (imageUrls && imageUrls.length > 0) {
                // Logos get a dedicated render path (separate from event imagery):
                // start from the base Cloudinary asset so we are not stuck with the
                // shared c_fill/f_jpg transform (which crops and flattens transparency),
                // then render with c_limit (preserve aspect ratio) + f_png (preserve alpha).
                // e_background_removal standardizes every store's logo onto a transparent
                // background. A store can opt out by setting a truthy LogoKeepBackground
                // field in Airtable (e.g. for an already-clean logo or one mis-cut by the AI).
                const baseLogoUrl = getBaseCloudinaryUrl(imageUrls[0]);
                const keepBackground = !!activeShop.fields.LogoKeepBackground;
                const removeBg = keepBackground ? '' : 'e_background_removal/';

                const faviconTransform = `${removeBg}c_limit,w_64,f_png`;
                const headerTransform = `${removeBg}c_limit,h_100,f_png,q_auto`;
                // Fallbacks (no background removal) so a logo never disappears if the
                // e_background_removal transform fails for a particular asset.
                const headerFallback = applyCloudinaryTransform(baseLogoUrl, 'c_limit,h_100,f_png,q_auto');

                const favicon = document.createElement('link');
                favicon.rel = 'icon';
                favicon.href = applyCloudinaryTransform(baseLogoUrl, faviconTransform);
                document.head.appendChild(favicon);
                const headerLogo = document.createElement('img');
                headerLogo.src = applyCloudinaryTransform(baseLogoUrl, headerTransform);
                if (!keepBackground) {
                    headerLogo.addEventListener('error', function onLogoError() {
                        headerLogo.removeEventListener('error', onLogoError);
                        headerLogo.src = headerFallback;
                    });
                }
                headerLogo.alt = `${activeShop.fields.Name} Logo`;
                headerLogo.loading = 'eager'; // Logo should load immediately
                headerLogo.fetchPriority = 'high'; // Prioritize logo loading

                const logoContainer = document.getElementById('shop-logo-container');
                if (logoContainer) {
                    logoContainer.innerHTML = '';
                    logoContainer.appendChild(headerLogo);
                } else {
                    const headerLeft = document.getElementById('header-left');
                    if (headerLeft) headerLeft.prepend(headerLogo);
                }
            }
        }

        const shopSettings = {
            shopType: activeShop.fields.ShopType || 'Events',
            enabledFilters: activeShop.fields.EnabledFilters || ['Date & Time', 'Headcount', 'Location', 'Subcategories'],
            paymentOptions: activeShop.fields.PaymentOptions || 'DepositOnly',
            terms: activeShop.fields.TermsAndConditions || 'Default terms and conditions text.',
            cartLabels: {}
        };
        try {
            shopSettings.cartLabels = JSON.parse(activeShop.fields.CartLabels || '{}');
        } catch (e) { console.warn('Could not parse CartLabels JSON, using defaults.'); }

        // Skip catalog-specific UI setup in presentation mode
        if (!isInPresentationMode) {
            const marqueeContainer = document.getElementById('marquee-banner-container');
            const marqueeTextElement = document.getElementById('marquee-text');

            if (marqueeContainer && marqueeTextElement) {
                const marqueeContent = activeShop.fields['Marquee Text'] || activeShop.fields.Description || '';

                if (marqueeContent.trim()) {
                    marqueeTextElement.textContent = marqueeContent;

                    const textLength = marqueeContent.length;
                    const duration = Math.min(60, Math.max(10, textLength / 15));
                    marqueeTextElement.style.animationDuration = `${duration}s`;

                    marqueeContainer.style.display = 'block';
                    log('Main', `Marquee activated with text (duration: ${duration}s).`);
                } else {
                    marqueeContainer.style.display = 'none';
                    log('Main', 'Marquee has no content, keeping it hidden.');
                }
            } else {
                console.warn('Marquee container or text element not found.');
            }
        }
        ui.applyCartLabels(shopSettings.cartLabels);
        console.log('[INIT DEBUG] Calling initializeEventListeners...');
        initializeEventListeners(imageCache, window.flatpickr, shopSettings);
        console.log('[INIT DEBUG] initializeEventListeners completed.');
        _setupOfflineBanner();

        // Skip footer update in presentation mode (footer not visible)
        if (!isInPresentationMode) {
            // Update footer with store details
            updateFooter(activeShop);
        }

        // Note: JWT authentication is now handled earlier in initialization (before session load)
        // to prevent the "collaborator or store owner" race condition error

        const loginToken = urlParams.get('token');
        if (loginToken) {
             log('Main', 'Magic link token found in URL, verifying...');
            try {
                const response = await fetch('/api/auth-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ token: loginToken })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Token verification failed');

                await _handleSuccessfulLogin(data); 
                 log('Main', 'Magic link verification successful.');

                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('token');
                window.history.replaceState({}, document.title, cleanUrl.toString());

            } catch (error) {
                console.error(`Sign-in via token failed: ${error.message}`);
                alert(`Sign-in failed: ${error.message}`);
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('token');
                window.history.replaceState({}, document.title, cleanUrl.toString());
                 handleSignOut(); 
            }
        
        } else if (state.session.user.isAuthenticated && state.session.user.likedItemIds.size === 0) {
            log('Main', 'User authenticated by JWT, but no likes found. Fetching full user data from /api/update-user-prefs?action=get-user-data...');
            const storedJwt = localStorage.getItem('jwt');
            try {
                const response = await fetch('/api/update-user-prefs?action=get-user-data', {
                    method: 'GET',
                    headers: { 'Authorization': `Bearer ${storedJwt}` }
                });
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Failed to fetch user data (Status: ${response.status})`);
                }
                const userData = await response.json();
                if (userData.likedItemIds) {
                    setState({
                        session: {
                            ...state.session,
                            user: {
                                ...state.session.user,
                                likedItemIds: new Set(userData.likedItemIds),
                                rsvps: new Set(userData.rsvpdItemIds || [])
                            }
                        }
                    });
                    log('Main', `Successfully fetched and set ${userData.likedItemIds.length} liked items and ${userData.rsvpdItemIds?.length || 0} RSVPs.`);
                    const recordIds = Array.from(document.querySelectorAll('.event-card[data-record-id]')).map(card => card.dataset.recordId);
                    if (recordIds.length > 0) ui.batchUpdateCardIcons(recordIds);
                }
            } catch (error) {
                console.error('[Main] Error fetching user data on reload:', error);
            }
        } else {
            log('Main', 'User state restored or not authenticated.');
        }

        if (sessionId && state.session.id !== sessionId) {
              log('Main', `Session ID ${sessionId} detected, loading session data now.`);
              await api.loadSessionFromAirtable(sessionId);
        } else if (state.session.id) {
             log('Main', `Session ${state.session.id} already loaded or initiated.`);
             if (typeof initializeSessionChat === 'function') {
                 initializeSessionChat();
             }

             // Only update catalog-related UI if NOT in presentation view
             const viewParam = urlParams.get('view');
             if (viewParam !== 'present') {
                 ui.updateHeader();
                 ui.updateEventPlanSection();
                 ui.updateIdeasCarousel();
                 ui.updateTotalCost();

                 // Verify no duplicate items after a short delay
                 setTimeout(() => {
                     ui.verifyNoDuplicateItems();
                 }, 100);
             } else {
                 log('Main', 'In presentation view - skipping catalog UI updates during init');
             }
        } else {
             log('Main', 'No active session ID found (this should not happen after the guest-session fix).');
        }


        let defaultFilterValue = activeShop.fields.DefaultStatusFilter || 'Available';
        if (defaultFilterValue === 'Show All') defaultFilterValue = 'all';
        const statusFilterEl = document.getElementById('status-filter');
        if (statusFilterEl) statusFilterEl.value = defaultFilterValue;

        ui.toggleLoading(false);
        updateSaveShareButton();
        initializeChatEventListeners();
        setupAuthEventListeners();

        // Skip calendar and projects dashboard setup in presentation mode
        if (!isInPresentationMode) {
            setupCalendarEventListeners();
            initializeProjectsDashboard(); // Initialize projects dashboard panel
        }

        initializeBiometricAuth(); // Initialize biometric/passkey authentication
        initializeWtfPlansPanel(); // Initialize WTF Plans panel
        initializeForumPanel(); // Initialize Forum Panel
        updateUserProfileIcon();

        // If user is already authenticated, fetch their projects (skip in presentation mode)
        if (state.session.user.isAuthenticated && state.session.user.id && !isInPresentationMode) {
            log('Main', 'User already authenticated, fetching project hierarchy...');
            api.fetchProjectHierarchy(state.session.user.id).then(projects => {
                updateProjectsData(projects);
                log('Main', `Project hierarchy loaded: ${projects.length} projects`);
            }).catch(err => {
                console.error('Failed to fetch project hierarchy:', err);
            });

            // Show authenticated-only menu buttons
            const menuSessionsBtn = document.getElementById('menu-sessions-btn');
            const menuProjectsBtn = document.getElementById('menu-projects-btn');
            if (menuSessionsBtn) menuSessionsBtn.style.display = 'flex';
            if (menuProjectsBtn) menuProjectsBtn.style.display = 'flex';
        }

        console.log('[INIT DEBUG] Calling syncUiWithUrl...');
        syncUiWithUrl();
        console.log('[INIT DEBUG] syncUiWithUrl completed.');
        window.addEventListener('popstate', syncUiWithUrl);

        setState({ ui: { ...state.ui, isInitializing: false }});
        console.log('[INIT DEBUG] isInitializing set to false.');

        // Skip main catalog background in presentation mode (presentation has its own background)
        if (!isInPresentationMode) {
            // Initialize background animation immediately so it loads first
            console.log('[INIT DEBUG] Initializing background engine...');
            backgroundEngine.initBackgroundEngine();
            console.log('[INIT DEBUG] Background engine initialized, loading fluid effect...');
            backgroundEngine.loadEffect(fluidEffect, null);
            console.log('[INIT DEBUG] Fluid effect loaded.');
        } else {
            console.log('[INIT DEBUG] Skipping background engine (presentation mode).');
        }

        console.log('[INIT DEBUG] ========== APP INITIALIZATION COMPLETE ==========');
        log('Main', 'Initialization complete.');

    } else {
        console.error("CRITICAL: Could not determine an active shop. Catalog cannot be displayed.");
        document.getElementById('loading-message').innerHTML = `
            <div style='color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 20px; text-align: center; max-width: 500px; margin: 0 auto;'>
                <p style='margin: 0 0 15px 0; font-weight: bold;'>Shop Not Found</p>
                <p style='margin: 0 0 15px 0;'>We couldn't find a valid event shop to display. Please contact support or try again.</p>
                <button onclick="window.location.href='/'" style='background-color: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px; margin-right: 10px;'>Go Home</button>
                <button onclick="window.location.reload()" style='background-color: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;'>Retry</button>
            </div>
        `;
        ui.toggleLoading(true); 
    }
}

window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled Promise Rejection:', event.reason);
});


initialize(); // Start the application
