// In: main.js
// Action: REPLACE THE ENTIRE FILE

console.log('[MODULE DEBUG] main.js module starting to load...', performance.now().toFixed(2) + 'ms');

import { state, setState } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { log } from './utils/debug.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, getCombinedPlanStatus } from './availability.js';
import { debounce, updateUrl, extractRecordIdFromPath } from './utils.js';
import { initializeEventListeners, updateSaveShareButton, initializeChatEventListeners, openChatWidget } from './events.js';
import { initializeSessionChat } from './chat.js';
import { setupCalendarEventListeners } from './components/calendarView.js';
import { setupAuthEventListeners, updateUserProfileIcon, initializeBiometricAuth, showBiometricSetupPromptIfNeeded, updateBiometricManagementUI, showUserModal } from './auth.js';
import * as backgroundEngine from './components/backgroundEngine.js';
import fluidEffect from './components/effects/fluid.js';
import { showReceiptModal } from './components/receipt.js';
import { updateFooter } from './components/footer.js';
import { initializeProjectsDashboard, updateProjectsData, showProjectsLoading } from './components/projectsDashboard.js';
import { initializeWtfPlansPanel, syncWtfPlansPanelWithUrl } from './components/wtfPlansPanel.js';
import { initializeForumPanel, syncForumPanelWithUrl } from './components/forumPanel.js';
import { applyCloudinaryTransform } from './utils/imageOptimizer.js';

console.log('[MODULE DEBUG] main.js all imports resolved successfully.', performance.now().toFixed(2) + 'ms');
const imageCache = new Map();
window.imageCache = imageCache;

window.applyFiltersAndSort = applyFiltersAndSort;
window.showReceiptModal = showReceiptModal;

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
                ui.showDetailModal(recordToOpen);
            } else {
                console.warn(`Record ID ${openItemId} not found in state.records.all (${state.records.all.length} records loaded)`);
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
         }
     });

    document.addEventListener('planCreated', () => {
        log('Main', 'New plan created.');
    });
    document.addEventListener('sessionReady', () => {
        console.log('[SESSION-READY] ========== EVENT HANDLER START ==========');
        console.log(`[SESSION-READY] Session: ${state.session.id}, Items: ${state.cart.items.size}, Locked: ${state.cart.lockedItems.size}`);
        log('Main', '"sessionReady" event received, re-initializing session chat.');

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
        const fetchStart = performance.now();
        const [stores, records] = await Promise.all([api.fetchAllStores(), api.fetchAllRecords()]);
        const fetchEnd = performance.now();
        console.log(`[INIT DEBUG] Data fetched in ${(fetchEnd - fetchStart).toFixed(0)}ms: ${stores.length} stores, ${records.length} records`);
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

        setState({
            stores: { all: stores },
            records: { all: records }
        });
        console.log('[INIT DEBUG] State updated with stores and records. state.records.all.length:', state.records.all.length, 'state.stores.all.length:', state.stores.all.length);
        log('Main', `Fetched ${stores.length} stores and ${records.length} items. Applied AI-generated Rankings where available.`);

    } catch (error) {
        console.error("Failed to load initial store/item data:", error);
        document.getElementById('loading-message').innerHTML = `
            <div style='color: #721c24; background-color: #f8d7da; border: 1px solid #f5c6cb; border-radius: 4px; padding: 20px; text-align: center; max-width: 500px; margin: 0 auto;'>
                <p style='margin: 0 0 15px 0; font-weight: bold;'>Unable to Load Catalog</p>
                <p style='margin: 0 0 15px 0;'>We couldn't connect to load the event catalog. Please check your internet connection and try again.</p>
                <button onclick="window.location.reload()" style='background-color: #007bff; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-size: 14px;'>Retry</button>
            </div>
        `;
        ui.toggleLoading(true);
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    let shopId = urlParams.get('shopId');
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
    }

    if (sessionId) {
         log('Main', `Session ID found in URL: ${sessionId}. Loading session...`);
         await api.loadSessionFromAirtable(sessionId);
         if (!activeShop && state.session.storeId) {
              activeShop = state.stores.all.find(s => s.id === state.session.storeId);
              log('Main', `Determined shop from loaded session: ${state.session.storeId}. Found shop: ${!!activeShop}`);
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

        if (!state.session.id) {
            log('Main', 'No session ID found, creating new session for guest chat...');
            await api.saveSessionToAirtable(); 
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
                    const newUrl = `${window.location.pathname}?shopId=${activeShop.id}`;
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
        }
        
        const existingFavicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (existingFavicon) existingFavicon.remove();
        
        const logoTag = activeShop.fields.LogoTag;
        if (logoTag) {
            const imageUrls = await api.fetchImagesByTags(logoTag);
            if (imageUrls && imageUrls.length > 0) {
                const logoUrl = imageUrls[0];
                const favicon = document.createElement('link');
                favicon.rel = 'icon';
                favicon.href = applyCloudinaryTransform(logoUrl, 'c_scale,w_32');
                document.head.appendChild(favicon);
                const headerLogo = document.createElement('img');
                headerLogo.src = applyCloudinaryTransform(logoUrl, 'h_50,c_scale,f_auto,q_auto');
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
