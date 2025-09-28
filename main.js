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

// --- NEW HELPER FUNCTION ---
async function populateUserPlans(userId) {
    // --- DEBUG ---
    console.log(`[DEBUG] populateUserPlans: Called for userId '${userId}'.`);
    if (userId) {
        const plans = await api.fetchPlansForUser(userId);
        // --- DEBUG ---
        console.log(`[DEBUG] populateUserPlans: Received ${plans.length} plans from API. Passing to UI.`);
        ui.populateMyPlansDropdown(plans);
    } else {
        // --- DEBUG ---
        console.log('[DEBUG] populateUserPlans: No userId, skipping fetch and render.');
    }
}

async function initialize() {
    log('Main', '1. Initialization started.');
    ui.initStateHelpers({ getItemState: ui.getItemState });
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
        
        // ... (rest of shop setup is the same)
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
        let shopSettings = {
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
                    await populateUserPlans(payload.userId); // Fetch plans for JWT user
                } else {
                    localStorage.removeItem('jwt');
                }
            } catch (e) {
                localStorage.removeItem('jwt');
                console.error("Failed to parse JWT:", e);
            }
        }
        
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
                
                // After login, associate session and fetch plans
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
        applyFiltersAndSort(imageCache);
        ui.updateFavoritesCarousel();
        updateSaveShareButton();
        
        initializeChatEventListeners();
        initializeSessionChat();
        setupAuthEventListeners();
        updateUserProfileIcon();
        
        state.ui.isInitializing = false;
        log('Main', 'Initialization complete.');

        const finalUrlParams = new URLSearchParams(window.location.search);
        const viewMode = finalUrlParams.get('view');
        const itemIdToOpen = finalUrlParams.get('openItem');
        const totalItems = state.cart.items.size + state.cart.lockedItems.size;

        if (viewMode === 'present') {
            if (totalItems > 0) {
                ui.showPresentationView('favorites');
                openChatWidget(true);
            }
        } else if (!itemIdToOpen && totalItems >= 3) {
            ui.showPresentationView('favorites');
        } else if (itemIdToOpen) {
            const recordToOpen = state.records.all.find(r => r.id === itemIdToOpen);
            if (recordToOpen) {
                const photoIndex = parseInt(finalUrlParams.get('photo'), 10) || 0;
                setTimeout(() => { ui.showDetailModal(recordToOpen, photoIndex); }, 100);
            }
        }
    } else {
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error: Could not find a valid shop to display.</p>`;
    }
}

initialize();
