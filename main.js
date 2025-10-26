// FILE: main.js (REPLACE ENTIRE FILE)

import { state, setState } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { log } from './utils/debug.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, getCombinedPlanStatus } from './availability.js';
import { debounce, updateUrl } from './utils.js'; // Added updateUrl import
// Corrected import line below:
import { initializeEventListeners, updateSaveShareButton, initializeChatEventListeners, openChatWidget, updateSubcategoryButtons } from './events.js'; // Added updateSubcategoryButtons here
import { initializeSessionChat } from './chat.js';
import { setupAuthEventListeners, updateUserProfileIcon } from './auth.js';

const imageCache = new Map();

// Make imageCache accessible (consider if a better pattern exists, e.g., passing via init)
window.imageCache = imageCache; // Simple global access for now

async function populateUserPlans(userId) {
    // Check if ui.populateMyPlansDropdown exists before calling
    if (typeof ui.populateMyPlansDropdown === 'function') {
        if (userId) {
            const plans = await api.fetchPlansForUser(userId);
            ui.populateMyPlansDropdown(plans); //
        } else {
            ui.populateMyPlansDropdown([]); //
        }
    } else {
        console.error("ui.populateMyPlansDropdown is not defined or imported correctly.");
    }
}


// Ensure applyFiltersAndSort is accessible globally or passed correctly
// Make applyFiltersAndSort accessible (consider if a better pattern exists)
window.applyFiltersAndSort = applyFiltersAndSort;


function syncUiWithUrl() {
    console.log('[syncUiWithUrl] Fired. Current URL:', window.location.href); //
    const params = new URLSearchParams(window.location.search); //
    const category = params.get('category'); //
    const subcategories = params.get('subcategory')?.split(','); //
    const openItemId = params.get('openItem'); //
    const view = params.get('view'); //
    console.log('[syncUiWithUrl] Parsed params:', { view, category, subcategories, openItemId }); //

    // Close any open overlays first
    ui.hideDetailModal(); //
    ui.hideItineraryModal(); //
    ui.hidePresentationView(); //

    // --- Sync Category/View Buttons ---
    const categoryFilters = document.getElementById('category-filters'); //
    if (categoryFilters) { // Add safety check
        categoryFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active')); //

        // Determine which main filter button should be active
        if (view === 'plan') {
            document.getElementById('plan-filter-btn')?.classList.add('active'); //
        } else if (view === 'likes') {
            document.getElementById('liked-items-filter-btn')?.classList.add('active'); //
        } else if (category) {
            document.querySelector(`#category-filters .filter-btn[data-filter="${category}"]`)?.classList.add('active'); //
        } else {
            // Default to 'All' if no specific view or category is set
            document.querySelector(`#category-filters .filter-btn[data-filter="all"]`)?.classList.add('active'); //
        }
    }

    // --- Sync Subcategory Buttons ---
    const subcategoryFilters = document.getElementById('subcategory-filters'); //
     if (subcategoryFilters) { // Add safety check
         // Make sure subcategories are generated based on the active category first
         // Check if updateSubcategoryButtons is defined before calling
         if (typeof updateSubcategoryButtons === 'function') {
              updateSubcategoryButtons(); // Ensure correct subcats are visible
         } else {
              console.error("updateSubcategoryButtons is not defined or imported correctly.");
         }


         subcategoryFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active')); //
         if (subcategories && view !== 'plan' && view !== 'likes') { // Only apply subcat selection if not in special views
             subcategories.forEach(subcat => {
                 subcategoryFilters.querySelector(`.filter-btn[data-filter="${subcat}"]`)?.classList.add('active'); //
             });
         }
     }

    // Re-apply filters based on the synced UI state
    // Check if applyFiltersAndSort is defined before calling
    if (typeof applyFiltersAndSort === 'function') {
        applyFiltersAndSort(imageCache); //
    } else {
         console.error("applyFiltersAndSort is not defined or imported correctly.");
    }

    // --- Handle opening modals/views based on URL ---
    // Use setTimeout to allow filters to apply and DOM to update first
    setTimeout(() => { //
        if (view === 'present') {
            ui.showPresentationView('ideas'); // Changed from 'favorites'
        } else if (view === 'itinerary') {
            ui.showItineraryModal(); //
        } else if (openItemId) {
            const recordToOpen = state.records.all.find(r => r.id === openItemId); //
            if (recordToOpen) {
                ui.showDetailModal(recordToOpen); //
            } else {
                console.warn(`[syncUiWithUrl] Record ID ${openItemId} not found in state.records.all.`);
                // Optionally remove invalid openItem param from URL
                // updateUrl({ openItem: null });
            }
        }
        // No specific action needed for view=likes or view=plan here, applyFiltersAndSort handles the main content area
    }, 100); // Small delay
}


async function initialize() {
    log('Main', '1. Initialization started.'); //
    ui.initStateHelpers({ getItemState: ui.getItemState }); //

    // Add listener for custom event 'userLoggedIn' to refresh plans
     document.addEventListener('userLoggedIn', () => {
         log('Main', "'userLoggedIn' event caught, repopulating user plans.");
         populateUserPlans(state.session.user.id);
         // Optionally refresh other UI elements that depend on logged-in state
         // e.g., re-apply filters if "My Likes" might change visibility
         if (typeof applyFiltersAndSort === 'function') {
              applyFiltersAndSort(imageCache);
         }
     });

    document.addEventListener('planCreated', () => { //
        if (state.session.user.isAuthenticated) { //
            populateUserPlans(state.session.user.id); //
        }
    });
    document.addEventListener('sessionReady', () => { //
        log('Main', '"sessionReady" event received, re-initializing session chat.'); //
        // Check if initializeSessionChat is defined before calling
        if (typeof initializeSessionChat === 'function') {
             initializeSessionChat(); //
        } else {
             console.error("initializeSessionChat is not defined or imported correctly.");
        }

        // Update UI elements that depend on session data *after* it's loaded
        ui.updateHeader();
        ui.updateEventPlanSection();
        ui.updateIdeasCarousel(); // Renamed from updateFavoritesCarousel
        ui.updateTotalCost();
        // Update liked icons for all visible cards now that session user state (likedItemIds) might be ready
        document.querySelectorAll('.event-card[data-record-id]').forEach(card => {
             ui.updateCardIcon(card.dataset.recordId);
        });
    });

    ui.toggleLoading(true); //
    try {
        // Fetch stores and items data first
        const [stores, records] = await Promise.all([api.fetchAllStores(), api.fetchAllRecords()]); //
        // Immediately update state with essential catalog data
        setState({ // Use setState for potential reactivity
            stores: { all: stores },
            records: { all: records }
        });
        log('Main', `Fetched ${stores.length} stores and ${records.length} items.`);

    } catch (error) {
        console.error("Failed to load initial store/item data:", error); //
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please refresh.</p>`; //
        ui.toggleLoading(true); // Keep loading indicator on error
        return; // Stop initialization
    }

    const urlParams = new URLSearchParams(window.location.search); //
    const sessionId = urlParams.get('session'); //
    let shopId = urlParams.get('shopId'); //
    let activeShop = null;

    // --- Determine Active Shop (Simplified Logic) ---
    // Priority: shopId URL param -> sessionId -> localStorage -> Default ('Tyler's Mystery Tours')
    if (shopId) {
        activeShop = state.stores.all.find(s => s.id === shopId); //
        log('Main', `Shop ID found in URL: ${shopId}. Found shop: ${!!activeShop}`);
    }

    // Load session *before* determining shop from session, as session load might set state.session.storeId
    if (sessionId) {
         log('Main', `Session ID found in URL: ${sessionId}. Loading session...`);
         await api.loadSessionFromAirtable(sessionId); // This sets state.session.storeId if found
         // Check again for shop based on loaded session's storeId ONLY if activeShop wasn't set by URL param
         if (!activeShop && state.session.storeId) {
              activeShop = state.stores.all.find(s => s.id === state.session.storeId);
              log('Main', `Determined shop from loaded session: ${state.session.storeId}. Found shop: ${!!activeShop}`);
         }
    }

    if (!activeShop) {
        const lastVisitedShopId = localStorage.getItem('lastVisitedShopId'); //
        if (lastVisitedShopId) {
            activeShop = state.stores.all.find(s => s.id === lastVisitedShopId); //
             log('Main', `Using last visited shop from localStorage: ${lastVisitedShopId}. Found shop: ${!!activeShop}`);
        }
    }

    if (!activeShop) {
        // Fallback to default shop name
        activeShop = state.stores.all.find(r => r.fields.Name === "Tyler's Mystery Tours"); //
         log('Main', `Falling back to default shop 'Tyler's Mystery Tours'. Found shop: ${!!activeShop}`);
    }
    // --- End Shop Determination ---

    if (activeShop) {
        // Update state with active shop ID
        setState({ ui: { ...state.ui, activeShopId: activeShop.id }}); //
        localStorage.setItem('lastVisitedShopId', activeShop.id); //
        log('Main', `Active Shop set to: ${activeShop.fields.Name} (ID: ${activeShop.id})`);

        // --- Initialize UI based on Shop ---
        const titleElement = document.getElementById('main-shop-title'); //
        if (titleElement) {
            titleElement.innerHTML = `${activeShop.fields.Name} <sup>Shop</sup><button id="shop-switcher-trigger" style="background:none; border:none; color:transparent; cursor:pointer; font-size: 1em; vertical-align: super;">s</button>`; //
            titleElement.style.cursor = 'pointer'; //
            titleElement.addEventListener('click', (e) => { //
                if (e.target.id !== 'shop-switcher-trigger') { //
                    // Reset URL to shop base, clearing session/view params
                    window.location.href = `${window.location.pathname}?shopId=${activeShop.id}`; //
                }
            });
            const switcherTrigger = document.getElementById('shop-switcher-trigger'); //
            if (switcherTrigger) switcherTrigger.addEventListener('click', () => ui.showShopSwitcher()); //
        }

        // Favicon/Logo Logic (existing, ensure it runs correctly)
        const existingFavicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]'); //
        if (existingFavicon) existingFavicon.remove(); //
        const logoTag = activeShop.fields.LogoTag; //
        if (logoTag) {
            const imageUrls = await api.fetchImagesByTags(logoTag); //
            if (imageUrls && imageUrls.length > 0) {
                const logoUrl = imageUrls[0]; //
                const favicon = document.createElement('link'); //
                favicon.rel = 'icon'; //
                favicon.href = logoUrl.replace('/upload/', '/upload/c_scale,w_32/'); //
                document.head.appendChild(favicon); //
                const headerLogo = document.createElement('img'); //
                headerLogo.src = logoUrl.replace('/upload/', '/upload/h_50,c_scale/'); //
                headerLogo.alt = `${activeShop.fields.Name} Logo`; //
                const headerLeft = document.getElementById('header-left'); //
                if (headerLeft) headerLeft.prepend(headerLogo); //
            }
        }

        // --- Shop Settings & Event Listeners ---
        const shopSettings = { //
            shopType: activeShop.fields.ShopType || 'Events', //
            enabledFilters: activeShop.fields.EnabledFilters || ['Date & Time', 'Headcount', 'Location', 'Subcategories'], //
            paymentOptions: activeShop.fields.PaymentOptions || 'DepositOnly', //
            terms: activeShop.fields.TermsAndConditions || 'Default terms and conditions text.', //
            cartLabels: {} //
        };
        try { //
            shopSettings.cartLabels = JSON.parse(activeShop.fields.CartLabels || '{}'); // Add default empty object
        } catch (e) { console.warn('Could not parse CartLabels JSON, using defaults.'); } //

        ui.applyCartLabels(shopSettings.cartLabels); //
        initializeEventListeners(imageCache, window.flatpickr, shopSettings); // Initialize main event listeners


        // --- Authentication & User State ---
        // Check for existing JWT first
        const jwt = localStorage.getItem('jwt'); //
        let initialUserId = null;
        if (jwt) {
            try {
                const payload = JSON.parse(atob(jwt.split('.')[1])); //
                if (payload.exp * 1000 > Date.now()) { // Check expiration
                    // Fetch liked items separately if needed or rely on auth-verify/social payload
                    // For now, just set basic auth state. Liked items loaded below or via login sync.
                    setState({ //
                        session: { ...state.session, user: { ...state.session.user, isAuthenticated: true, id: payload.userId, name: payload.name, email: payload.email, isOwner: payload.isOwner } }
                    });
                    initialUserId = payload.userId;
                     log('Main', `User authenticated via existing JWT: ${initialUserId}`);
                     // We need the liked items NOW if the user is already logged in
                     // Assuming liked items are NOT in basic JWT payload, fetch them if needed via auth functions
                     // OR ensure auth-verify/social functions are always called if token exists?
                     // Let's assume auth-verify/social will provide likes. If token is valid but from old session, likes might be missing.
                     // A dedicated fetchUserLikes might be safer here.
                     // Simplification: Rely on auth functions to provide likes. If JWT exists but no likes, they might appear slightly delayed.

                } else {
                    localStorage.removeItem('jwt'); //
                     log('Main', 'Existing JWT expired.');
                }
            } catch (e) {
                localStorage.removeItem('jwt'); //
                console.error("Failed to parse existing JWT:", e); //
            }
        }

        // Handle magic link token verification (this also loads user data including likes)
        const loginToken = urlParams.get('token'); //
        if (loginToken) {
             log('Main', 'Magic link token found in URL, verifying...');
            try {
                const response = await fetch('/api/auth-verify', { //
                    method: 'POST', //
                    headers: { 'Content-Type': 'application/json' }, //
                     body: JSON.stringify({ token: loginToken }) //
                });
                const data = await response.json(); //
                if (!response.ok) throw new Error(data.error || 'Token verification failed'); //

                // Use the dedicated login handler which includes like sync
                await _handleSuccessfulLogin(data); // This now handles state update, JWT storage, like sync
                 log('Main', 'Magic link verification successful.');

                // Clean token from URL
                const cleanUrl = new URL(window.location); //
                cleanUrl.searchParams.delete('token'); //
                window.history.replaceState({}, document.title, cleanUrl.toString()); //
                // UI updates are handled by _handleSuccessfulLogin

            } catch (error) {
                console.error(`Sign-in via token failed: ${error.message}`); //
                alert(`Sign-in failed: ${error.message}`); //
                const cleanUrl = new URL(window.location); //
                cleanUrl.searchParams.delete('token'); //
                window.history.replaceState({}, document.title, cleanUrl.toString()); //
                 // Ensure user state is reset if login fails mid-process
                 handleSignOut(); // Use sign out to reset state cleanly
            }
// --- THIS IS THE MODIFIED BLOCK ---
        } else if (state.session.user.isAuthenticated && state.session.user.likedItemIds.size === 0) {
            // User authenticated by JWT, but likes weren't loaded. Fetch them now.
            log('Main', 'User authenticated by JWT, but no likes found. Fetching likes from /api/update-user-prefs?action=get-user-data...');
            try {
                // Call the *existing* endpoint with a GET request and query parameter
                const response = await fetch('/api/update-user-prefs?action=get-user-data', {
                    method: 'GET', // Use GET
                    headers: { 'Authorization': `Bearer ${jwt}` } // Use the existing JWT
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
                                likedItemIds: new Set(userData.likedItemIds)
                            }
                        }
                    });
                    log('Main', `Successfully fetched and set ${userData.likedItemIds.length} liked items.`);
                    // Now that likes are loaded, update all visible card icons
                    document.querySelectorAll('.event-card[data-record-id]').forEach(card => {
                        ui.updateCardIcon(card.dataset.recordId);
                    });
                }
            } catch (error) {
                console.error('Failed to fetch user data on reload:', error.message);
                // Don't block the app, just log the error. Likes will be out of sync.
            }
        // --- END MODIFIED BLOCK ---
        }

        // --- Post-Auth Initialization ---
        await populateUserPlans(state.session.user.id); // Populate plans based on final auth state

        // Load session data *after* potential authentication and shop determination
        // If sessionId was in URL but loadSession wasn't called yet (because shopId took precedence)
        if (sessionId && state.session.id !== sessionId) {
              log('Main', `Session ID ${sessionId} detected, loading session data now.`);
              await api.loadSessionFromAirtable(sessionId); //
        } else if (state.session.id) {
             log('Main', `Session ${state.session.id} already loaded or initiated.`);
             // Ensure UI reflects loaded session data even if load didn't happen in this exact sequence
             ui.updateHeader(); //
             ui.updateEventPlanSection(); //
             ui.updateIdeasCarousel(); // Renamed
             ui.updateTotalCost(); //
        } else {
             log('Main', 'No active session ID found.');
             // Clear any potential stale plan UI if no session is active
             ui.updateHeader();
             ui.updateEventPlanSection();
             ui.updateIdeasCarousel();
             ui.updateTotalCost();
        }


        // Set default status filter from shop settings
        let defaultFilterValue = activeShop.fields.DefaultStatusFilter || 'Available'; //
        if (defaultFilterValue === 'Show All') defaultFilterValue = 'all'; //
        const statusFilterEl = document.getElementById('status-filter'); //
        if (statusFilterEl) statusFilterEl.value = defaultFilterValue; //

        // --- Final UI Setup ---
        ui.toggleLoading(false); //
        // ui.updateIdeasCarousel(); // Called within sessionReady or after session load now
        updateSaveShareButton(); //

        initializeChatEventListeners(); //
        // initializeSessionChat(); // Called within sessionReady now
        setupAuthEventListeners(); //
        updateUserProfileIcon(); //

        syncUiWithUrl(); // Sync UI with URL parameters
        window.addEventListener('popstate', syncUiWithUrl); // Handle browser back/forward

        setState({ ui: { ...state.ui, isInitializing: false }}); // Mark initialization complete
        log('Main', 'Initialization complete.'); //

    } else {
        console.error("CRITICAL: Could not determine an active shop. Catalog cannot be displayed."); //
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error: Could not find a valid shop to display. Please check configuration.</p>`; //
        ui.toggleLoading(true); // Keep loading shown
    }
}

// Global error handler (optional but helpful)
window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled Promise Rejection:', event.reason);
    // Optionally show a generic error message to the user
    // ui.showToast('An unexpected error occurred. Please try refreshing the page.');
});


initialize(); // Start the application
