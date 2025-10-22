// REPLACE THE ENTIRE CONTENTS OF: main.js

import { state, setState } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { log } from './utils/debug.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, getCombinedPlanStatus } from './availability.js';
import { debounce } from './utils.js';
import { initializeEventListeners, updateSaveShareButton, initializeChatEventListeners, openChatWidget } from './events.js';
import { initializeSessionChat } from './chat.js';
import { setupAuthEventListeners, updateUserProfileIcon } from './auth.js';

const imageCache = new Map();
// Removed populateUserPlans function

function syncUiWithUrl() {
    console.log('[syncUiWithUrl] Fired. Current URL:', window.location.href);
    const params = new URLSearchParams(window.location.search);
    const category = params.get('category');
    const subcategories = params.get('subcategory')?.split(',');
    const openItemId = params.get('openItem');
    const view = params.get('view');
    console.log('[syncUiWithUrl] Parsed params:', { view, category, subcategories, openItemId });

    // Close any open modals first
    ui.hideDetailModal();
    ui.hideItineraryModal();
    ui.hidePresentationView();

    const categoryFilters = document.getElementById('category-filters');
    if (categoryFilters) { // Add safety check
        categoryFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        if (view === 'plan') {
            document.getElementById('plan-filter-btn')?.classList.add('active');
        } else if (category) {
            categoryFilters.querySelector(`.filter-btn[data-filter="${category}"]`)?.classList.add('active');
        } else {
            categoryFilters.querySelector(`.filter-btn[data-filter="all"]`)?.classList.add('active');
        }
    }
    
    const subcategoryFilters = document.getElementById('subcategory-filters');
    if (subcategoryFilters) { // Add safety check
        subcategoryFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        if (subcategories) {
            subcategories.forEach(subcat => {
                subcategoryFilters.querySelector(`.filter-btn[data-filter="${subcat}"]`)?.classList.add('active');
            });
        }
    }

    applyFiltersAndSort(imageCache);
    
    // Use setTimeout to ensure the DOM has updated from applyFiltersAndSort before opening modals
    setTimeout(() => {
        if (view === 'present') {
            ui.showPresentationView('favorites'); // Assuming default start is 'favorites'
        } else if (view === 'itinerary') {
            ui.showItineraryModal();
        } else if (openItemId) {
            const recordToOpen = state.records.all.find(r => r.id === openItemId);
            if (recordToOpen) {
                ui.showDetailModal(recordToOpen);
            } else {
                console.warn(`Record with ID ${openItemId} not found for modal.`);
            }
        }
    }, 100); // Small delay might be needed depending on rendering complexity
}


async function initialize() {
    log('Main', '1. Initialization started.');
    ui.initStateHelpers({ getItemState: ui.getItemState });
    
    // Listen for custom events dispatched by other modules
    document.addEventListener('planCreated', () => {
        log('Main', '"planCreated" event received.');
        if (state.session.user.isAuthenticated) {
            // Refetch user plans when a new one is created by the current user
            api.fetchPlansForUser(state.session.user.id).then(plans => {
                // Update state and UI (assuming fetchPlans returns simple {id, name} array)
                const simplePlans = plans.map(p => ({ id: p.id, name: p.fields.Name }));
                setState({ session: { ...state.session, user: { ...state.session.user, associatedSessions: simplePlans } } });
                ui.populateMyPlansDropdown(); // Corrected call
            });
        }
    });
    document.addEventListener('sessionReady', () => {
        log('Main', '"sessionReady" event received, re-initializing session chat.');
        initializeSessionChat();
        ui.updateEventPlanDateDisplay(); // Update date display when session is ready
        ui.updateLockedItemStatusIcons(); // Update icons when session is ready
        ui.updateMobileBarAvailability(); // Update mobile bar when session ready
    });
     document.addEventListener('userLoggedIn', () => {
        log('Main', '"userLoggedIn" event received.');
        ui.populateMyPlansDropdown(); // Corrected call
        // Re-initialize chat if needed (might already happen via sessionReady)
        initializeSessionChat(); 
    });
     document.addEventListener('userSignedOut', () => { // Assuming handleSignOut dispatches this
        log('Main', '"userSignedOut" event received.');
        ui.populateMyPlansDropdown(); // Corrected call
    });

    ui.toggleLoading(true);
    try {
        const [stores, records] = await Promise.all([api.fetchAllStores(), api.fetchAllRecords()]);
        // Filter out records without a Name field early
        state.stores.all = stores.filter(s => s.fields && s.fields.Name);
        state.records.all = records.filter(r => r.fields && r.fields.Name);
        log('Main', `Fetched ${state.stores.all.length} stores and ${state.records.all.length} records.`);
    } catch (error) {
        console.error("Failed to load initial data:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try refreshing.</p>`;
        return; // Stop initialization on critical data fetch failure
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    let shopId = urlParams.get('shopId');
    let activeShop = null;

    // Determine active shop (priority: shopId param > session store > localStorage > default)
    if (shopId) {
        activeShop = state.stores.all.find(s => s.id === shopId);
    }
    if (!activeShop && sessionId) {
        // Load session data FIRST to potentially get the storeId
        await api.loadSessionFromAirtable(sessionId); // This sets state.session.storeId if found
        if (state.session.storeId) {
            activeShop = state.stores.all.find(s => s.id === state.session.storeId);
        }
    }
    if (!activeShop) {
        const lastVisitedShopId = localStorage.getItem('lastVisitedShopId');
        if (lastVisitedShopId) {
            activeShop = state.stores.all.find(s => s.id === lastVisitedShopId);
        }
    }
    if (!activeShop) {
        // Fallback to a default shop if none found (adjust name as needed)
        activeShop = state.stores.all.find(r => r.fields.Name === "Tyler's Mystery Tours"); 
    }

    if (activeShop) {
        state.ui.activeShopId = activeShop.id;
        localStorage.setItem('lastVisitedShopId', activeShop.id);
        log('Main', `Active Shop set: ${activeShop.fields.Name} (ID: ${activeShop.id})`);

        const titleElement = document.getElementById('main-shop-title');
        // Update title and add shop switcher trigger
        if (titleElement) {
             titleElement.innerHTML = `${activeShop.fields.Name} <sup>Shop</sup><button id="shop-switcher-trigger" style="background:none; border:none; color:transparent; cursor:pointer; font-size: 1em; vertical-align: super;">s</button>`;
             titleElement.style.cursor = 'pointer';
            
            // Add click listener for title (excluding the 's' button)
            titleElement.addEventListener('click', (e) => {
                if (e.target.id !== 'shop-switcher-trigger') {
                    // Navigate to base URL for this shop, clearing session/item params
                    window.location.href = `${window.location.pathname}?shopId=${activeShop.id}`;
                }
            });
            // Add listener for the switcher trigger itself
            const switcherTrigger = document.getElementById('shop-switcher-trigger');
            if (switcherTrigger) {
                switcherTrigger.addEventListener('click', (e) => {
                    e.stopPropagation(); // Prevent title click listener
                    ui.showShopSwitcher();
                });
            }
        } else {
             console.error("Element with ID 'main-shop-title' not found.");
        }


        // --- FAVICON & HEADER LOGO LOGIC START ---
        const existingFavicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (existingFavicon) existingFavicon.remove();

        const logoTag = activeShop.fields.LogoTag;
        if (logoTag) {
            try {
                const imageUrls = await api.fetchImagesByTags(logoTag);
                if (imageUrls && imageUrls.length > 0) {
                    const logoUrl = imageUrls[0];

                    const favicon = document.createElement('link');
                    favicon.rel = 'icon';
                    favicon.href = logoUrl.replace('/upload/', '/upload/c_scale,w_32/');
                    document.head.appendChild(favicon);

                    const headerLogo = document.createElement('img');
                    headerLogo.src = logoUrl.replace('/upload/', '/upload/h_50,c_scale/');
                    headerLogo.alt = `${activeShop.fields.Name} Logo`;
                    headerLogo.style.maxHeight = '50px'; // Ensure logo respects header height
                    
                    const headerLeft = document.getElementById('header-left');
                    if (headerLeft) {
                        // Remove existing logo if present before adding new one
                        const existingLogo = headerLeft.querySelector('img');
                        if(existingLogo) existingLogo.remove();
                        headerLeft.prepend(headerLogo);
                    }
                }
            } catch (error) {
                console.error("Failed to load shop logo:", error);
            }
        }
        // --- FAVICON & HEADER LOGO LOGIC END ---
        
        // --- Shop Settings Processing ---
        const shopSettings = {
            shopType: activeShop.fields.ShopType || 'Events',
            enabledFilters: activeShop.fields.EnabledFilters || ['Date & Time', 'Headcount', 'Location', 'Subcategories'], // Default filters
            paymentOptions: activeShop.fields.PaymentOptions || 'DepositOnly',
            terms: activeShop.fields.TermsAndConditions || 'Default terms and conditions apply.', // Provide a default
            cartLabels: {}
        };
        try {
            // Safely parse JSON, provide default object if parsing fails or field is empty
            shopSettings.cartLabels = JSON.parse(activeShop.fields.CartLabels || '{}');
        } catch (e) { 
            console.warn('Could not parse CartLabels JSON for shop, using defaults.', e);
            shopSettings.cartLabels = {}; // Ensure it's an object
        }
        ui.applyCartLabels(shopSettings.cartLabels);
        
        // Initialize event listeners AFTER shop settings are processed
        initializeEventListeners(imageCache, window.flatpickr, shopSettings);
        
        // --- Authentication Check ---
        const jwt = localStorage.getItem('jwt');
        if (jwt) {
            try {
                const payload = JSON.parse(atob(jwt.split('.')[1]));
                if (payload.exp * 1000 > Date.now()) {
                     // Fetch associated sessions when restoring login from JWT
                    const userPlans = await api.fetchPlansForUser(payload.userId);
                    const simplePlans = userPlans.map(p => ({ id: p.id, name: p.fields.Name }));
                    setState({ 
                        session: { ...state.session, user: { ...state.session.user, isAuthenticated: true, id: payload.userId, name: payload.name, email: payload.email, isOwner: payload.isOwner, associatedSessions: simplePlans } }
                    });
                     log('Main', 'User authenticated via JWT.');
                } else {
                    localStorage.removeItem('jwt'); // Token expired
                    log('Main', 'JWT expired, user logged out.');
                }
            } catch (e) {
                localStorage.removeItem('jwt'); // Invalid token
                console.error("Failed to parse JWT:", e);
            }
        }
        
        ui.populateMyPlansDropdown(); // *** Corrected call *** Populate based on initial auth state
        
        // Handle magic link token verification if present
        const loginToken = urlParams.get('token');
        if (loginToken) {
            try {
                const response = await fetch('/api/auth-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ token: loginToken })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error || 'Token verification failed');
                
                localStorage.setItem('jwt', data.token);
                // The response from auth-verify now includes associatedSessions
                setState({ 
                    session: { 
                        ...state.session, 
                        user: { ...state.session.user, ...data.user, isAuthenticated: true, isOwner: data.ownerData.isOwner, ownerDashboardId: data.ownerData.ownerDashboardId } 
                    } 
                });
                 log('Main', 'User authenticated via magic link.');
                
                // Associate session if user just logged in via link on a specific session page
                if (sessionId) {
                    await api.associateSessionWithUser(sessionId, data.user.id);
                }
                
                ui.populateMyPlansDropdown(); // *** Corrected call *** Repopulate with fetched plans
                
                // Clean token from URL
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('token');
                window.history.replaceState({}, document.title, cleanUrl.toString());
                updateUserProfileIcon();
                
                // Optionally show a success message
                ui.showToast('Successfully signed in!', 3000);
                 document.dispatchEvent(new CustomEvent('userLoggedIn')); // Ensure event fires

            } catch (error) {
                alert(`Sign-in failed: ${error.message}`);
                // Clean token from URL even on failure
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('token');
                window.history.replaceState({}, document.title, cleanUrl.toString());
            }
        }

        // Load session data if sessionId exists but wasn't loaded during shop detection
        if (sessionId && !state.session.id) {
            await api.loadSessionFromAirtable(sessionId);
        }

        // Update UI elements based on loaded session (if any)
        if (state.session.id) {
            log('Main', `Session ${state.session.id} loaded.`);
            ui.updateHeader(); // Update event name/goals input fields
            ui.updateEventPlanSection(); // Render locked items
            ui.updateTotalCost(); // Calculate costs
        }

        // Apply default status filter from shop settings
        let defaultFilterValue = activeShop.fields.DefaultStatusFilter || 'Available';
        if (defaultFilterValue === 'Show All') {
            defaultFilterValue = 'all';
        }
        const statusFilterEl = document.getElementById('status-filter');
        if(statusFilterEl) statusFilterEl.value = defaultFilterValue;

        // Final UI updates and event listener setup
        ui.toggleLoading(false);
        ui.updateFavoritesCarousel();
        updateSaveShareButton(); // Reflect initial save state
        
        initializeChatEventListeners();
        initializeSessionChat(); // Initialize based on current session state
        setupAuthEventListeners();
        updateUserProfileIcon(); // Reflect initial auth state
        
        // Sync UI with URL parameters (filters, modals, views) AFTER everything else is ready
        syncUiWithUrl();
        window.addEventListener('popstate', syncUiWithUrl); // Listen for back/forward navigation

        state.ui.isInitializing = false;
        log('Main', 'Initialization complete.');
        
    } else {
        // Handle case where no valid shop could be determined
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error: Could not find a valid shop to display. Please check the URL or contact support.</p>`;
        console.error("CRITICAL: No active shop could be determined.");
    }
}

// Start the application
initialize();
