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
async function populateUserPlans(userId) {
    if (userId) {
        const plans = await api.fetchPlansForUser(userId);
        ui.populateMyPlansDropdown(plans);
    } else {
        ui.populateMyPlansDropdown([]);
    }
}

function syncUiWithUrl() {
    console.log('[syncUiWithUrl] Fired. Current URL:', window.location.href);
    const params = new URLSearchParams(window.location.search);
    const category = params.get('category');
    const subcategories = params.get('subcategory')?.split(',');
    const openItemId = params.get('openItem');
    const view = params.get('view');
    console.log('[syncUiWithUrl] Parsed params:', { view, category, subcategories, openItemId });

    ui.hideDetailModal();
    ui.hideItineraryModal();
    ui.hidePresentationView();

    const categoryFilters = document.getElementById('category-filters');
    categoryFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (view === 'plan') {
        document.getElementById('plan-filter-btn')?.classList.add('active');
    } else if (category) {
        document.querySelector(`#category-filters .filter-btn[data-filter="${category}"]`)?.classList.add('active');
    } else {
        document.querySelector(`#category-filters .filter-btn[data-filter="all"]`)?.classList.add('active');
    }
    
    const subcategoryFilters = document.getElementById('subcategory-filters');
    subcategoryFilters.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
    if (subcategories) {
        subcategories.forEach(subcat => {
            subcategoryFilters.querySelector(`.filter-btn[data-filter="${subcat}"]`)?.classList.add('active');
        });
    }

    applyFiltersAndSort(imageCache);
    
    setTimeout(() => {
        if (view === 'present') {
            ui.showPresentationView('favorites');
        } else if (view === 'itinerary') {
            ui.showItineraryModal();
        } else if (openItemId) {
            const recordToOpen = state.records.all.find(r => r.id === openItemId);
            
            if (recordToOpen) {
                ui.showDetailModal(recordToOpen);
            }
        }
    }, 100);
}


async function initialize() {
    log('Main', '1. Initialization started.');
    ui.initStateHelpers({ getItemState: ui.getItemState });
    document.addEventListener('planCreated', () => {
        if (state.session.user.isAuthenticated) {
            populateUserPlans(state.session.user.id);
        }
    });
    document.addEventListener('sessionReady', () => {
        log('Main', '"sessionReady" event received, re-initializing session chat.');
        initializeSessionChat();
    });
    ui.toggleLoading(true);
    try {
        const [stores, records] = await Promise.all([api.fetchAllStores(), api.fetchAllRecords()]);
        state.stores.all = stores;
        state.records.all = records;
    } catch (error) {
        console.error("Failed to load initial data:", error);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}.</p>`;
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionId = urlParams.get('session');
    let shopId = urlParams.get('shopId');
    let activeShop = null;
    if (shopId) {
        activeShop = state.stores.all.find(s => s.id === shopId);
    }
    if (!activeShop && sessionId) {
        await api.loadSessionFromAirtable(sessionId);
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
        activeShop = state.stores.all.find(r => r.fields.Name === "Tyler's Mystery Tours");
    }

    if (activeShop) {
        state.ui.activeShopId = activeShop.id;
        localStorage.setItem('lastVisitedShopId', activeShop.id);
        const titleElement = document.getElementById('main-shop-title');
        titleElement.innerHTML = `${activeShop.fields.Name} <sup>Shop</sup><button id="shop-switcher-trigger" style="background:none; border:none; color:transparent; cursor:pointer; font-size: 1em; vertical-align: super;">s</button>`;
        titleElement.style.cursor = 'pointer';
        titleElement.addEventListener('click', (e) => {
            if (e.target.id !== 'shop-switcher-trigger') {
                window.location.href = `/?shopId=${activeShop.id}`;
            }
        });
        document.getElementById('shop-switcher-trigger').addEventListener('click', () => {
            ui.showShopSwitcher();
        });

// REPLACE the favicon/logo logic block in: main.js

        // --- NEW FAVICON & HEADER LOGO LOGIC START ---
        // Remove any existing favicon to prevent conflicts
        const existingFavicon = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
        if (existingFavicon) {
            existingFavicon.remove();
        }

        // Check if the active shop has a LogoTag field
        const logoTag = activeShop.fields.LogoTag;
        if (logoTag) {
            // Use the existing API function to fetch the image URL from Cloudinary by its tag
            const imageUrls = await api.fetchImagesByTags(logoTag);
            if (imageUrls && imageUrls.length > 0) {
                const logoUrl = imageUrls[0];

                // 1. Set the Favicon (browser tab icon)
                const favicon = document.createElement('link');
                favicon.rel = 'icon';
                favicon.href = logoUrl.replace('/upload/', '/upload/c_scale,w_32/'); // 32x32px version
                document.head.appendChild(favicon);

                // 2. Set the Header Logo (on-page icon)
                const headerLogo = document.createElement('img');
                headerLogo.src = logoUrl.replace('/upload/', '/upload/h_50,c_scale/'); // 50px height version
                headerLogo.alt = `${activeShop.fields.Name} Logo`;
                headerLogo.style.height = '50px'; // INCREASED height
                headerLogo.style.marginRight = '15px'; // ADJUSTED margin for spacing
                
                const headerLeft = document.getElementById('header-left');
                if (headerLeft) {
                    headerLeft.prepend(headerLogo); // MOVED logo to the left of the title
                }
            }
        }
        // --- NEW FAVICON & HEADER LOGO LOGIC END ---
        
        // --- THIS IS THE FIX ---
        // The 'let' keyword is removed from the second declaration of shopSettings.
        const shopSettings = {
            shopType: activeShop.fields.ShopType || 'Events',
            enabledFilters: activeShop.fields.EnabledFilters || ['Date & Time', 'Headcount', 'Location', 'Subcategories'],
            paymentOptions: activeShop.fields.PaymentOptions || 'DepositOnly',
            terms: activeShop.fields.TermsAndConditions || 'Default terms and conditions text.',
            cartLabels: {}
        };
        try {
            shopSettings.cartLabels = JSON.parse(activeShop.fields.CartLabels);
        } catch (e) { console.warn('Could not parse CartLabels JSON, using defaults.'); }
        ui.applyCartLabels(shopSettings.cartLabels);
        initializeEventListeners(imageCache, window.flatpickr, shopSettings);
        
        const jwt = localStorage.getItem('jwt');
        if (jwt) {
            try {
                const payload = JSON.parse(atob(jwt.split('.')[1]));
                if (payload.exp * 1000 > Date.now()) {
                    setState({ 
                        session: { ...state.session, user: { ...state.session.user, isAuthenticated: true, id: payload.userId, name: payload.name, email: payload.email } }
                    });
                } else {
                    localStorage.removeItem('jwt');
                }
            } catch (e) {
                localStorage.removeItem('jwt');
                console.error("Failed to parse JWT:", e);
            }
        }
        
        await populateUserPlans(state.session.user.id);
        const loginToken = urlParams.get('token');
        if (loginToken) {
            try {
                const response = await fetch('/api/auth-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                     body: JSON.stringify({ token: loginToken })
                });
                const data = await response.json();
                if (!response.ok) throw new Error(data.error);
                
                localStorage.setItem('jwt', data.token);
                setState({ 
                    session: { 
                        ...state.session, 
                        user: { ...state.session.user, ...data.user, isAuthenticated: true, isOwner: data.ownerData.isOwner, ownerDashboardId: data.ownerData.ownerDashboardId } 
                    } 
                });
                if (sessionId) {
                    await api.associateSessionWithUser(sessionId, data.user.id);
                }
                await populateUserPlans(data.user.id);
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('token');
                window.history.replaceState({}, document.title, cleanUrl.toString());
                updateUserProfileIcon();
            } catch (error) {
                alert(`Sign-in failed: ${error.message}`);
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('token');
                window.history.replaceState({}, document.title, cleanUrl.toString());
            }
        }

        if (sessionId && !state.session.id) {
            await api.loadSessionFromAirtable(sessionId);
        }

        if (state.session.id) {
            ui.updateHeader();
            ui.updateEventPlanSection();
            ui.updateTotalCost();
        }

        let defaultFilterValue = activeShop.fields.DefaultStatusFilter || 'Available';
        if (defaultFilterValue === 'Show All') {
            defaultFilterValue = 'all';
        }
        document.getElementById('status-filter').value = defaultFilterValue;

        ui.toggleLoading(false);
        ui.updateFavoritesCarousel();
        updateSaveShareButton();
        
        initializeChatEventListeners();
        initializeSessionChat();
        setupAuthEventListeners();
        updateUserProfileIcon();
        
        syncUiWithUrl();
        window.addEventListener('popstate', syncUiWithUrl);

        state.ui.isInitializing = false;
        log('Main', 'Initialization complete.');
        
    } else {
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error: Could not find a valid shop to display.</p>`;
    }
}

initialize();
