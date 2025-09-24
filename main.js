// In main.js
import { state, setState } from './state.js';
import { CONSTANTS } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { getStoredSessions } from './session.js';
import { log } from './utils/debug.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS, getCombinedPlanStatus } from './availability.js';
import { debounce } from './utils.js';
import { initializeEventListeners, updateSaveShareButton, initializeChatEventListeners } from './events.js';
import { initializeChat } from './chat.js';
import { setupAuthEventListeners, updateUserProfileIcon } from './auth.js';

const imageCache = new Map();
let mainDatePicker = null;

async function updateHeaderCalendarAvailability() {
    log('Main', 'Updating header calendar availability based on favorited items.');
    const allBusyTimes = [];
    const favoriteItems = state.cart.items;
    
    for (const [recordId] of favoriteItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record && record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]) {
            const busyTimes = await api.fetchCalendarForRecord(record);
            allBusyTimes.push(...busyTimes);
        }
    }
    
    if (mainDatePicker) {
        mainDatePicker.clear();
        mainDatePicker.config.onDayCreate = (dObj, dStr, fp, dayElem) => {
            const day = dayElem.dateObj;
            let status = AVAILABILITY_STATUS.FULL;
            
            let hasLeadTimeConflict = false;
            for (const [recordId] of favoriteItems.entries()) {
                const record = state.records.all.find(r => r.id === recordId);
                const leadTimeDays = record?.fields?.[CONSTANTS.FIELD_NAMES.LEAD_TIME] || 0;
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const leadTimeCutoff = new Date(today.getTime() + leadTimeDays * 24 * 60 * 60 * 1000);
                if (day < leadTimeCutoff) {
                    hasLeadTimeConflict = true;
                    break;
                }
            }
            if (hasLeadTimeConflict) {
                status = AVAILABILITY_STATUS.NONE;
            } else {
                const dayStart = new Date(day);
                dayStart.setHours(0, 0, 0, 0);
                const dayEnd = new Date(day);
                dayEnd.setHours(23, 59, 59, 999);
                const busyPeriods = allBusyTimes.filter(busy => {
                    const busyStart = new Date(busy.start);
                    const busyEnd = new Date(busy.end);
                    return busyStart <= dayEnd && busyEnd >= dayStart;
                });
                if (busyPeriods.length > 0) {
                    const totalMinutes = 24 * 60;
                    let busyMinutes = 0;
                    busyPeriods.forEach(busy => {
                        const start = new Date(Math.max(busy.start, dayStart));
                        const end = new Date(Math.min(busy.end, dayEnd));
                        const minutes = (end - start) / (1000 * 60);
                        busyMinutes += minutes;
                    });
                    const availablePercentage = ((totalMinutes - busyMinutes) / totalMinutes) * 100;
                    if (availablePercentage <= 50) {
                        status = AVAILABILITY_STATUS.NONE;
                    } else {
                        status = AVAILABILITY_STATUS.PARTIAL;
                    }
                }
            }
            
            if (status === AVAILABILITY_STATUS.FULL) {
                dayElem.classList.add('available-full');
            } else if (status === AVAILABILITY_STATUS.PARTIAL) {
                dayElem.classList.add('available-partial');
            } else {
                dayElem.classList.add('unavailable');
            }
        };
        mainDatePicker.redraw();
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

    // --- NEW, SMARTER SHOP SELECTION LOGIC ---
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
    // --- END OF NEW LOGIC ---

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
        
        let shopSettings = {
            shopType: activeShop.fields.ShopType || 'Events',
            enabledFilters: activeShop.fields.EnabledFilters || ['Date & Time', 'Headcount', 'Location', 'Subcategories'],
            paymentOptions: activeShop.fields.PaymentOptions || 'DepositOnly',
            terms: activeShop.fields.TermsAndConditions || 'Default terms and conditions text.',
            cartLabels: {}
        };
        try {
            shopSettings.cartLabels = JSON.parse(activeShop.fields.CartLabels);
        } catch (e) {
            console.warn('Could not parse CartLabels JSON, using defaults.');
        }

        ui.applyCartLabels(shopSettings.cartLabels);
        
        const { mainDatePicker, eventPlanDatePicker } = initializeEventListeners(imageCache, window.flatpickr, shopSettings);
        
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
                setState({ session: { ...state.session, user: { ...state.session.user, ...data.user, isAuthenticated: true } } });
        
                if (data.user && data.user.email.toLowerCase().endsWith('@tylersmysterytours.com')) {
                    const cleanUrl = new URL(window.location);
                    cleanUrl.searchParams.delete('loginToken');
                    window.history.replaceState({}, document.title, cleanUrl.toString());
                    window.location.href = '/dashboard.html';
                    return; 
                }
        
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('loginToken');
                window.history.replaceState({}, document.title, cleanUrl.toString());
        
                // Refresh the UI to show the user is logged in
                updateUserProfileIcon();
        
            } catch (error) {
                alert(`Sign-in failed: ${error.message}`);
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('loginToken');
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
        initializeChat();
        setupAuthEventListeners();
        updateUserProfileIcon();
        
        state.ui.isInitializing = false;
        log('Main', 'Initialization complete.');

        const finalUrlParams = new URLSearchParams(window.location.search);
        const itemIdToOpen = finalUrlParams.get('openItem');
        if (itemIdToOpen) {
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
