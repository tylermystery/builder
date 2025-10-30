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

// REPLACE the entire initialize function in: main.js

async function initialize() {
    log('Main', '1. Initialization started.'); //
    ui.initStateHelpers({ getItemState: ui.getItemState }); //

// REPLACE the 'userLoggedIn' listener in: main.js

     document.addEventListener('userLoggedIn', () => {
         log('Main', "'userLoggedIn' event caught, repopulating user plans and chat."); //
         populateUserPlans(state.session.user.id);
         if (typeof applyFiltersAndSort === 'function') {
              applyFiltersAndSort(imageCache);
         }
         // --- CHAT FIX: Re-initialize chat to update user name ---
         if (typeof initializeSessionChat === 'function') {
            log('Main', 'User logged in, re-initializing session chat with new user info.');
            initializeSessionChat(); 
         }
         // --- END CHAT FIX ---
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
    if (shopId) {
        activeShop = state.stores.all.find(s => s.id === shopId); //
        log('Main', `Shop ID found in URL: ${shopId}. Found shop: ${!!activeShop}`);
    }

    if (sessionId) {
         log('Main', `Session ID found in URL: ${sessionId}. Loading session...`);
         await api.loadSessionFromAirtable(sessionId); // This sets state.session.storeId if found
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
        activeShop = state.stores.all.find(r => r.fields.Name === "Tyler's Mystery Tours"); //
         log('Main', `Falling back to default shop 'Tyler's Mystery Tours'. Found shop: ${!!activeShop}`);
    }
    // --- End Shop Determination ---

    if (activeShop) {
        setState({ ui: { ...state.ui, activeShopId: activeShop.id }}); //
        localStorage.setItem('lastVisitedShopId', activeShop.id); //
        log('Main', `Active Shop set to: ${activeShop.fields.Name} (ID: ${activeShop.id})`);

        // --- CHAT FIX: Ensure guests have a session ID on load ---
        if (!state.session.id) {
            log('Main', 'No session ID found, creating new session for guest chat...');
            await api.saveSessionToAirtable(); // This will create an ID and fire 'sessionReady'
        }
        // --- END CHAT FIX ---

        // --- Initialize UI based on Shop ---
        const titleElement = document.getElementById('main-shop-title'); //
        if (titleElement) {
            // --- Get Main Title ---
            const shopTitleField = activeShop.fields['Shop Title'] || activeShop.fields.Name;
            const titles = shopTitleField.split('|').map(t => t.trim()).filter(Boolean);
            const displayTitle = titles.length > 0 ? titles[0] : 'Shop'; // Default main title

            // --- Get Superscript Label ---
            const shopTypeLabelField = activeShop.fields['Shop Type Label'] || 'Shop'; // Default superscript
            const labels = shopTypeLabelField.split('|').map(t => t.trim()).filter(Boolean);
            const displayLabel = labels.length > 0 ? labels[0] : 'Shop'; // Use first label or default

            // --- Set innerHTML with both dynamic parts ---
            titleElement.innerHTML = `${displayTitle} <sup>${displayLabel}</sup><button id="shop-switcher-trigger" style="background:none; border:none; color:transparent; cursor:pointer; font-size: 1em; vertical-align: super;">s</button>`;

            // Keep existing event listeners
            titleElement.style.cursor = 'pointer'; //
            titleElement.addEventListener('click', (e) => { //
                if (e.target.id !== 'shop-switcher-trigger') { //
                    window.location.href = `${window.location.pathname}?shopId=${activeShop.id}`; //
                }
            });
            const switcherTrigger = document.getElementById('shop-switcher-trigger'); //
            if (switcherTrigger) switcherTrigger.addEventListener('click', () => ui.showShopSwitcher()); //
        }
        
        const existingFavicon = document.querySelector('link[rel=\"icon\"], link[rel=\"shortcut icon\"]'); //
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

        // --- Shop Settings & Event Listeners ---\
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

// --- NEW MARQUEE LOGIC START ---
        const marqueeContainer = document.getElementById('marquee-banner-container');
        const marqueeTextElement = document.getElementById('marquee-text');

        if (marqueeContainer && marqueeTextElement) {
            // Prioritize 'Marquee Text' field, fall back to 'Description', else empty
            const marqueeContent = activeShop.fields['Marquee Text'] || activeShop.fields.Description || '';

            if (marqueeContent.trim()) { // Check if there's actual text
                marqueeTextElement.textContent = marqueeContent; // Set the text

                // Optional: Adjust speed based on text length for better readability
                const textLength = marqueeContent.length;
                // Simple formula: ~15 chars per second, minimum 10s, max 60s duration
                const duration = Math.min(60, Math.max(10, textLength / 15));
                marqueeTextElement.style.animationDuration = `${duration}s`;

                marqueeContainer.style.display = 'block'; // Make the banner visible
                log('Main', `Marquee activated with text (duration: ${duration}s).`);
            } else {
                marqueeContainer.style.display = 'none'; // Keep hidden if no text
                log('Main', 'Marquee has no content, keeping it hidden.');
            }
        } else {
            console.warn('Marquee container or text element not found.');
        }
        // --- NEW MARQUEE LOGIC END ---

        ui.applyCartLabels(shopSettings.cartLabels); // Existing line
        initializeEventListeners(imageCache, window.flatpickr, shopSettings); // Existing line

        // --- Authentication & User State ---
        const jwt = localStorage.getItem('jwt'); //
        let initialUserId = null;
        if (jwt) {
            try {
                const payload = JSON.parse(atob(jwt.split('.')[1])); //
                if (payload.exp * 1000 > Date.now()) { // Check expiration
                    setState({ //
                        session: { ...state.session, user: { ...state.session.user, isAuthenticated: true, id: payload.userId, name: payload.name, email: payload.email, isOwner: payload.isOwner } }\
                    });
                    initialUserId = payload.userId;
                     log('Main', `User authenticated via existing JWT: ${initialUserId}`);
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

                await _handleSuccessfulLogin(data); // This now handles state update, JWT storage, like sync
                 log('Main', 'Magic link verification successful.');

                const cleanUrl = new URL(window.location); //
                cleanUrl.searchParams.delete('token'); //
                window.history.replaceState({}, document.title, cleanUrl.toString()); //

            } catch (error) {
                console.error(`Sign-in via token failed: ${error.message}`); //
                alert(`Sign-in failed: ${error.message}`); //
                const cleanUrl = new URL(window.location); //
                cleanUrl.searchParams.delete('token'); //
                window.history.replaceState({}, document.title, cleanUrl.toString()); //
                 handleSignOut(); // Use sign out to reset state cleanly
            }
        
        // --- THIS IS THE CORRECTED BLOCK ---
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
        // --- END CORRECTED BLOCK ---
        }

        // --- Post-Auth Initialization ---
        await populateUserPlans(state.session.user.id); // Populate plans based on final auth state

        if (sessionId && state.session.id !== sessionId) {
              log('Main', `Session ID ${sessionId} detected, loading session data now.`);
              await api.loadSessionFromAirtable(sessionId); //
        } else if (state.session.id) {
             log('Main', `Session ${state.session.id} already loaded or initiated.`);
             // --- CHAT FIX: Manually trigger sessionReady if session was already loaded by URL ---
             // This ensures chat initializes even if loadSessionFromAirtable was skipped
             if (typeof initializeSessionChat === 'function') {
                 initializeSessionChat();
             }
             // --- END CHAT FIX ---
             ui.updateHeader(); //
             ui.updateEventPlanSection(); //
             ui.updateIdeasCarousel(); // Renamed
             ui.updateTotalCost(); //
        } else {
             log('Main', 'No active session ID found (this should not happen after the guest-session fix).');
        }


        // Set default status filter from shop settings
        let defaultFilterValue = activeShop.fields.DefaultStatusFilter || 'Available'; //
        if (defaultFilterValue === 'Show All') defaultFilterValue = 'all'; //
        const statusFilterEl = document.getElementById('status-filter'); //
        if (statusFilterEl) statusFilterEl.value = defaultFilterValue; //

        // --- Final UI Setup ---\
        ui.toggleLoading(false); //
        updateSaveShareButton(); //
        initializeChatEventListeners(); //
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
