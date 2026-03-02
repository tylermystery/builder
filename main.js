// In: main.js
// Action: REPLACE THE ENTIRE FILE

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
import { setupAuthEventListeners, updateUserProfileIcon, initializeBiometricAuth, showBiometricSetupPromptIfNeeded, updateBiometricManagementUI } from './auth.js';
import * as backgroundEngine from './components/backgroundEngine.js';
import fluidEffect from './components/effects/fluid.js';
import { showReceiptModal } from './components/receipt.js';
import { updateFooter } from './components/footer.js';
import { initializeProjectsDashboard, updateProjectsData, showProjectsLoading } from './components/projectsDashboard.js';
import { initializeWtfPlansPanel, syncWtfPlansPanelWithUrl } from './components/wtfPlansPanel.js';
import { applyCloudinaryTransform } from './utils/imageOptimizer.js';


const imageCache = new Map();
window.imageCache = imageCache; 

window.applyFiltersAndSort = applyFiltersAndSort;
window.showReceiptModal = showReceiptModal;


function syncUiWithUrl() {
    const params = new URLSearchParams(window.location.search);

    // Support both query param (?openItem=recXYZ) and pretty URL (/item/slug-recXYZ)
    let openItemId = params.get('openItem');
    if (!openItemId) {
        // Check for pretty URL format
        openItemId = extractRecordIdFromPath(window.location.pathname);
    }

    const view = params.get('view');

    // Close any open overlays first
    ui.hideDetailModal();
    ui.hideItineraryModal();
    ui.hidePresentationView();

    // Sync WTF Plans panel state with URL (for browser back/forward navigation)
    syncWtfPlansPanelWithUrl(params);

    // --- Sync 'My Plan'/'My Likes' Button Active State ---
    const categoryFilters = document.getElementById('category-filters');
    if (categoryFilters) {
        categoryFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        let buttonToActivate;
        let categoryFilter = params.get('category');

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
    setTimeout(() => {
        if (view === 'present') {
            ui.showPresentationView('ideas');
        } else if (view === 'itinerary') {
            ui.showItineraryModal();
        } else if (openItemId) {
            // DEBUG: Check CSS loading state before showing modal
            console.log('[syncUiWithUrl DEBUG] About to show modal for:', openItemId, {
                deferredCssLoaded: !!document.querySelector('link[href*="deferred.css"][rel="stylesheet"]'),
                criticalStyleElements: document.querySelectorAll('style').length,
                documentReadyState: document.readyState
            });

            const recordToOpen = state.records.all.find(r => r.id === openItemId);
            if (recordToOpen) {
                ui.showDetailModal(recordToOpen);
            } else {
                console.warn(`[syncUiWithUrl] Record ID ${openItemId} not found in state.records.all.`);
            }
        }
    }, 100); // Small delay
}


async function initialize() {
    log('Main', '1. Initialization started.');

    // Early detection of presentation mode for optimized initialization
    const urlParamsEarly = new URLSearchParams(window.location.search);
    const isInPresentationMode = urlParamsEarly.get('view') === 'present';
    if (isInPresentationMode) {
        log('Main', 'Presentation mode detected - optimizing initialization for faster load');
    }

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
        console.log('[MAIN DEBUG] ========== FETCHING INITIAL DATA ==========');
        const [stores, records] = await Promise.all([api.fetchAllStores(), api.fetchAllRecords()]);
        console.log('[MAIN DEBUG] Fetched stores:', stores.length);
        console.log('[MAIN DEBUG] Fetched records:', records.length);

        // Log packages specifically
        const packages = records.filter(r => r.fields['Item Type'] === 'Package');
        console.log('[MAIN DEBUG] Packages in fetched records:', packages.length);
        if (packages.length > 0) {
            console.log('[MAIN DEBUG] Package details:', packages.map(p => ({
                id: p.id,
                name: p.fields.Name,
                itemType: p.fields['Item Type'],
                status: p.fields.Status,
                linkedSession: p.fields.LinkedSession
            })));
        } else {
            console.log('[MAIN DEBUG] NO PACKAGES FOUND in fetched records');
        }

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
        log('Main', `Fetched ${stores.length} stores and ${records.length} items. Applied AI-generated Rankings where available.`);

        // Debug: Verify packages are in state
        const packagesInState = state.records.all.filter(r => r.fields['Item Type'] === 'Package');
        console.log('[MAIN DEBUG] Packages in state after setState:', packagesInState.length);
        console.log('[MAIN DEBUG] ========== INITIAL DATA FETCH COMPLETE ==========');

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
        initializeEventListeners(imageCache, window.flatpickr, shopSettings);

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

        syncUiWithUrl();
        window.addEventListener('popstate', syncUiWithUrl);

        setState({ ui: { ...state.ui, isInitializing: false }});

        // Skip main catalog background in presentation mode (presentation has its own background)
        if (!isInPresentationMode) {
            // Initialize background animation immediately so it loads first
            backgroundEngine.initBackgroundEngine();
            backgroundEngine.loadEffect(fluidEffect, null);
        }

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
