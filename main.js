// In: main.js
// Action: REPLACE THE ENTIRE FILE

// --- DEBUG ---
console.log('[main.js] 0. File execution started.');
// --- DEBUG ---

import { state, setState } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { log } from './utils/debug.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, getCombinedPlanStatus } from './availability.js';
import { debounce, updateUrl } from './utils.js';
import { initializeEventListeners, updateSaveShareButton, initializeChatEventListeners, openChatWidget } from './events.js'; 
import { initializeSessionChat } from './chat.js';
import { setupCalendarEventListeners } from './components/calendarView.js'; 

// --- DEBUG ---
console.log('[main.js] 1. Importing auth.js...');
// --- DEBUG ---
import { setupAuthEventListeners, updateUserProfileIcon } from './auth.js';
// --- DEBUG ---
console.log('[main.js] 2. Successfully imported auth.js.');
// --- DEBUG ---

import * as backgroundEngine from './components/backgroundEngine.js'; 
// --- DEBUG ---
console.log('[main.js] 3. Importing fluidEffect.js...'); 
// --- DEBUG ---
import fluidEffect from './components/effects/fluid.js'; 
// --- DEBUG ---
console.log('[main.js] 4. Successfully imported fluidEffect.js.'); 
// --- DEBUG ---


const imageCache = new Map();
window.imageCache = imageCache; 

window.applyFiltersAndSort = applyFiltersAndSort;


function syncUiWithUrl() {
    console.log('[syncUiWithUrl] Fired. Current URL:', window.location.href);
    const params = new URLSearchParams(window.location.search);
    const openItemId = params.get('openItem');
    const view = params.get('view');
    console.log('[syncUiWithUrl] Parsed params:', { view, openItemId });

    // Close any open overlays first
    ui.hideDetailModal();
    ui.hideItineraryModal();
    ui.hidePresentationView();

    // --- Sync 'My Plan'/'My Likes' Button Active State ---
    const categoryFilters = document.getElementById('category-filters');
    if (categoryFilters) {
        categoryFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        let buttonToActivate;
        if (view === 'plan') {
            buttonToActivate = document.getElementById('plan-filter-btn');
        } else if (view === 'likes') {
            buttonToActivate = document.getElementById('liked-items-filter-btn');
        } else {
            buttonToActivate = categoryFilters.querySelector('.filter-btn[data-filter="all"]');
        }
        if (buttonToActivate) buttonToActivate.classList.add('active');
    }

    // Re-apply filters based on the URL
    if (typeof applyFiltersAndSort === 'function') {
        applyFiltersAndSort(imageCache);
    } else {
         console.error("applyFiltersAndSort is not defined or imported correctly.");
    }

    // --- Handle opening modals/views based on URL ---
    setTimeout(() => {
        if (view === 'present') {
            ui.showPresentationView('ideas'); 
        } else if (view === 'itinerary') {
            ui.showItineraryModal();
        } else if (openItemId) {
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
    // --- DEBUG ---
    console.log('[main.js] 5. initialize() function called.');
    // --- DEBUG ---
    log('Main', '1. Initialization started.');
    ui.initStateHelpers({ getItemState: ui.getItemState });

     document.addEventListener('userLoggedIn', () => {
         log('Main', "'userLoggedIn' event caught, reapplying filters and reinitializing chat.");
         if (typeof applyFiltersAndSort === 'function') {
              applyFiltersAndSort(imageCache);
         }
         // Update all heart icons to reflect the newly loaded liked items
         const recordIds = Array.from(document.querySelectorAll('.event-card[data-record-id]')).map(card => card.dataset.recordId);
         if (recordIds.length > 0) ui.batchUpdateCardIcons(recordIds);
         if (typeof initializeSessionChat === 'function') {
            log('Main', 'User logged in, re-initializing session chat with new user info.');
            initializeSessionChat(); 
         }
     });

    document.addEventListener('planCreated', () => {
        log('Main', 'New plan created.');
    });
    document.addEventListener('sessionReady', () => {
        log('Main', '"sessionReady" event received, re-initializing session chat.');
        if (typeof initializeSessionChat === 'function') {
             initializeSessionChat();
        } else {
             console.error("initializeSessionChat is not defined or imported correctly.");
        }

        ui.updateHeader();
        ui.updateEventPlanSection();
        ui.updateIdeasCarousel(); 
        ui.updateTotalCost();
        const recordIds = Array.from(document.querySelectorAll('.event-card[data-record-id]')).map(card => card.dataset.recordId);
        if (recordIds.length > 0) ui.batchUpdateCardIcons(recordIds);
    });

    ui.toggleLoading(true);
    try {
        const [stores, records] = await Promise.all([api.fetchAllStores(), api.fetchAllRecords()]);

        const DEFAULT_V21_PROFILE = JSON.stringify({
            "profileSource": "system_default_v21",
            "Pillars": { "Activities": 8, "Food/Drink": 0, "Venue": 0, "Extras": 0 },
            "Vibe": { "Energy": 7, "Relaxation": 3, "Formality": 2, "Novelty": 6 },
            "Intellect": { "Creative": 5, "Analytical": 5 },
            "Physicality": { "Intensity": 5, "Accessibility": 5 },
            "Tags": ["active", "default", "testing", "generic", "fun"]
        });

        records.forEach(record => {
            if (!record.fields.AI_Profile && (record.fields['Item Type'] === 'Bookable Item' || record.fields['Item Type'] === 'Event')) {
                record.fields.AI_Profile = DEFAULT_V21_PROFILE;
            }
            if (record.fields.AI_Profile && record.fields.Rankings) {
                 record.fields.Rankings = null;
            }
        });

        setState({ 
            stores: { all: stores },
            records: { all: records }
        });
        log('Main', `Fetched ${stores.length} stores and ${records.length} items. Applied default AI profiles.`);

    } catch (error) {
        console.error("Failed to load initial store/item data:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please refresh.</p>`;
        ui.toggleLoading(true); 
        return; 
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    let shopId = urlParams.get('shopId');
    let activeShop = null;

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
        setState({ ui: { ...state.ui, activeShopId: activeShop.id }});
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
                    window.location.href = `${window.location.pathname}?shopId=${activeShop.id}`;
                }
            });
            const switcherTrigger = document.getElementById('shop-switcher-trigger');
            if (switcherTrigger) switcherTrigger.addEventListener('click', () => ui.showShopSwitcher());

            const parentCollectiveTrigger = document.getElementById('parent-collective-trigger');
            if (parentCollectiveTrigger) parentCollectiveTrigger.addEventListener('click', () => {
                ui.showShopSwitcher();
            });
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
                favicon.href = logoUrl.replace('/upload/', '/upload/c_scale,w_32/');
                document.head.appendChild(favicon);
                const headerLogo = document.createElement('img');
                headerLogo.src = logoUrl.replace('/upload/', '/upload/h_50,c_scale/');
                headerLogo.alt = `${activeShop.fields.Name} Logo`;
                
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
        ui.applyCartLabels(shopSettings.cartLabels); 
        initializeEventListeners(imageCache, window.flatpickr, shopSettings); 

        console.log('[Main] ========== JWT CHECK START ==========');
        console.log('[Main] Checking for stored JWT in localStorage...');
        const jwt = localStorage.getItem('jwt');
        console.log('[Main] JWT found in localStorage:', !!jwt);
        if (jwt) {
            console.log('[Main] JWT (first 20 chars):', jwt.substring(0, 20) + '...');
        }
        let initialUserId = null;
        if (jwt) {
            console.log('[Main] Attempting to parse JWT...');
            try {
                const payload = JSON.parse(atob(jwt.split('.')[1]));
                console.log('[Main] JWT parsed successfully');
                console.log('[Main] JWT payload:', payload);
                console.log('[Main] JWT expiration:', new Date(payload.exp * 1000));
                console.log('[Main] Current time:', new Date());
                console.log('[Main] JWT valid:', payload.exp * 1000 > Date.now());
                if (payload.exp * 1000 > Date.now()) {
                    console.log('[Main] JWT is valid, setting user state...'); 
                    setState({
                        session: { ...state.session, user: { ...state.session.user, isAuthenticated: true, id: payload.userId, name: payload.name, email: payload.email, isOwner: payload.isOwner } }
                    });
                    initialUserId = payload.userId;
                    console.log('[Main] User state updated from JWT');
                    console.log('[Main] User ID:', initialUserId);
                    console.log('[Main] User name:', payload.name);
                    console.log('[Main] User email:', payload.email);
                    console.log('[Main] User isOwner:', payload.isOwner);
                    console.log('[Main] User isAuthenticated:', state.session.user.isAuthenticated);
                    console.log('[Main] User likedItemIds.size:', state.session.user.likedItemIds.size);
                     log('Main', `User authenticated via existing JWT: ${initialUserId}`);
                } else {
                    console.log('[Main] JWT expired, removing from localStorage...');
                    localStorage.removeItem('jwt');
                     log('Main', 'Existing JWT expired.');
                }
            } catch (e) {
                console.error('[Main] ========== JWT PARSE ERROR ==========');
                console.error('[Main] Error parsing JWT:', e);
                console.error('[Main] Error message:', e.message);
                console.error('[Main] Error stack:', e.stack);
                localStorage.removeItem('jwt');
                console.error("[Main] Failed to parse existing JWT:", e);
                console.error('[Main] ========== JWT PARSE ERROR END ==========');
            }
        } else {
            console.log('[Main] No JWT found in localStorage');
        }
        console.log('[Main] ========== JWT CHECK END ==========');

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
            console.log('[Main] ========== JWT RELOAD USER DATA DEBUG START ==========');
            console.log('[Main] User is authenticated but has no liked items loaded');
            console.log('[Main] User ID:', state.session.user.id);
            console.log('[Main] User name:', state.session.user.name);
            console.log('[Main] User email:', state.session.user.email);
            log('Main', 'User authenticated by JWT, but no likes found. Fetching full user data from /api/update-user-prefs?action=get-user-data...');
            console.log('[Main] Current user state:', state.session.user);
            console.log('[Main] Current liked items size:', state.session.user.likedItemIds.size);
            try {
                console.log('[Main] Fetching user data with JWT...');
                console.log('[Main] Request URL: /api/update-user-prefs?action=get-user-data');
                const response = await fetch('/api/update-user-prefs?action=get-user-data', {
                    method: 'GET', 
                    headers: { 'Authorization': `Bearer ${jwt}` } 
                });
                console.log('[Main] Fetch response status:', response.status);
                console.log('[Main] Fetch response ok:', response.ok);
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || `Failed to fetch user data (Status: ${response.status})`);
                }
                const userData = await response.json();
                console.log('[Main] ========== RECEIVED USER DATA ==========');
                console.log('[Main] Full user data:', JSON.stringify(userData, null, 2));
                console.log('[Main] User ID from API:', userData.id);
                console.log('[Main] User name from API:', userData.name);
                console.log('[Main] User email from API:', userData.email);
                console.log('[Main] Liked items from API:', userData.likedItemIds);
                console.log('[Main] Liked items count:', userData.likedItemIds?.length || 0);
                console.log('[Main] RSVP items from API:', userData.rsvpdItemIds);
                console.log('[Main] RSVP items count:', userData.rsvpdItemIds?.length || 0);
                if (userData.likedItemIds) {
                    console.log('[Main] Updating state with liked items...');
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
                    console.log('[Main] Updated liked items in state:', Array.from(state.session.user.likedItemIds));
                    console.log('[Main] Updated RSVP items in state:', Array.from(state.session.user.rsvps));
                    console.log('[Main] Updating card icons...');
                    const recordIds = Array.from(document.querySelectorAll('.event-card[data-record-id]')).map(card => card.dataset.recordId);
                    console.log('[Main] Found', recordIds.length, 'cards to update');
                    if (recordIds.length > 0) ui.batchUpdateCardIcons(recordIds);
                    console.log('[Main] Card icons updated');
                } else {
                    console.log('[Main] No liked items in user data response');
                }
            } catch (error) {
                console.error('[Main] ========== USER DATA FETCH ERROR ==========');
                console.error('[Main] Error fetching user data on reload:', error);
                console.error('[Main] Error message:', error.message);
                console.error('[Main] Error stack:', error.stack);
                console.error('[Main] ========== USER DATA FETCH ERROR END ==========');
            }
            console.log('[Main] ========== JWT RELOAD USER DATA DEBUG END ==========');
        } else {
            console.log('[Main] ========== USER STATE AFTER JWT CHECK ==========');
            console.log('[Main] User authenticated:', state.session.user.isAuthenticated);
            console.log('[Main] User ID:', state.session.user.id);
            console.log('[Main] User name:', state.session.user.name);
            console.log('[Main] Liked items size:', state.session.user.likedItemIds.size);
            console.log('[Main] Will NOT fetch user data (either not authenticated or already has liked items)');
            console.log('[Main] ========== USER STATE AFTER JWT CHECK END ==========');
        }

        if (sessionId && state.session.id !== sessionId) {
              log('Main', `Session ID ${sessionId} detected, loading session data now.`);
              await api.loadSessionFromAirtable(sessionId);
        } else if (state.session.id) {
             log('Main', `Session ${state.session.id} already loaded or initiated.`);
             if (typeof initializeSessionChat === 'function') {
                 initializeSessionChat();
             }
             ui.updateHeader();
             ui.updateEventPlanSection();
             ui.updateIdeasCarousel(); 
             ui.updateTotalCost();
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
        setupCalendarEventListeners(); 
        updateUserProfileIcon();

        syncUiWithUrl(); 
        window.addEventListener('popstate', syncUiWithUrl); 

        setState({ ui: { ...state.ui, isInitializing: false }}); 
        log('Main', 'Initialization complete.');

        // --- DEBUG ---
        console.log('[main.js] 6. Calling backgroundEngine.initBackgroundEngine().');
        // --- DEBUG ---
        backgroundEngine.initBackgroundEngine(); 
        
        // --- THIS IS THE FIX ---
        // --- DEBUG ---
        console.log('[main.js] 7. Calling backgroundEngine.loadEffect(fluidEffect, null).'); 
        // --- DEBUG ---
        backgroundEngine.loadEffect(fluidEffect, null); 
        // --- END FIX ---
        // --- DEBUG ---
        console.log('[main.js] 8. End of initialize() function.');
        // --- DEBUG ---

    } else {
        console.error("CRITICAL: Could not determine an active shop. Catalog cannot be displayed.");
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error: Could not find a valid shop to display. Please check configuration.</p>`;
        ui.toggleLoading(true); 
    }
}

window.addEventListener('unhandledrejection', function(event) {
    console.error('Unhandled Promise Rejection:', event.reason);
});


initialize(); // Start the application
