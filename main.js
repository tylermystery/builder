// FILE: main.js
/*
 * Version: 5.0.0
 * Last Modified: 2025-09-21
 * * Changelog:
 * v5.0.0 - 2025-09-21
 * - Implemented multi-store functionality by reading a `shopId` from the URL.
 * - App now fetches from the new `Stores` table in Airtable.
 * - Defaults to "Tyler's Mystery Tours" if no `shopId` is specified.
 * - Dynamically generates the main title and a hidden "s" button to open a shop switcher modal.
 * v4.9.4 - 2025-09-19
 * - Automatically checks the "Keep open" checkbox when the chat is first opened in presentation view.
 */
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
    log('Main', '3. State helpers initialized.');

    ui.toggleLoading(true);
    log('Main', '4. Loading UI toggled on.');
    try {
        // Fetch both stores and catalog items at the same time
        const [stores, records] = await Promise.all([
            api.fetchAllStores(),
            api.fetchAllRecords()
        ]);
        state.stores.all = stores;
        state.records.all = records;
        log('Main', `5. Fetched ${state.stores.all.length} stores and ${state.records.all.length} records.`);
    } catch (error) {
        console.error("Failed to load initial data:", error);
        log('Main', `7. Failed to load initial data: ${error.message}`);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        return;
    }

    // --- UPDATED LOGIC: DETERMINE ACTIVE SHOP FROM STORES TABLE ---
    const urlParams = new URLSearchParams(window.location.search);
    let shopId = urlParams.get('shopId');
    let activeShop = null;

    if (shopId) {
        activeShop = state.stores.all.find(r => r.id === shopId);
    }

    // If no valid shopId is found, default to "Tyler's Mystery Tours" from the Stores table
    if (!activeShop) {
        activeShop = state.stores.all.find(r => r.fields.Name === "Tyler's Mystery Tours");
    }
    
    if (activeShop) {
        state.ui.activeShopId = activeShop.id;
        log('Main', `Active shop set to: ${activeShop.fields.Name} (ID: ${activeShop.id})`);
        
        const titleElement = document.getElementById('main-shop-title');
        titleElement.innerHTML = `${activeShop.fields.Name} Shop<button id="shop-switcher-trigger" style="background:none; border:none; color:transparent; cursor:pointer; font-size: 1em; vertical-align: super;">s</button>`;
        
        document.getElementById('shop-switcher-trigger').addEventListener('click', () => {
            ui.showShopSwitcher();
        });
    } else {
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error: Could not find a valid shop to display. "Tyler's Mystery Tours" might be missing from your Stores table.</p>`;
        return;
    }
    // --- END UPDATED LOGIC ---

    // --- HANDLE AUTOMATIC SIGN-IN FROM JWT ---
    const jwt = localStorage.getItem('jwt');
    if (jwt) {
        try {
            // A simple way to check expiry without a full library
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
                            email: payload.email 
                        }
                    }
                });
                log('Main', `Auto sign-in successful for ${payload.name}`);
            } else {
                localStorage.removeItem('jwt');
                log('Main', 'Removed expired JWT.');
            }
        } catch (e) {
            localStorage.removeItem('jwt');
            console.error("Failed to parse JWT:", e);
        }
    }
    
    const sessionId = urlParams.get('session');
    const loginToken = urlParams.get('loginToken');

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
                    user: { ...state.session.user, ...data.user, isAuthenticated: true }
                }
            });
            // Clean the token from the URL
            const cleanUrl = new URL(window.location);
            cleanUrl.searchParams.delete('loginToken');
            window.history.replaceState({}, document.title, cleanUrl.toString());
        } catch (error) {
            alert(`Sign-in failed: ${error.message}`);
            const cleanUrl = new URL(window.location);
            cleanUrl.searchParams.delete('loginToken');
            window.history.replaceState({}, document.title, cleanUrl.toString());
        }
    }
    
    log('Main', `8. Session ID from URL: ${sessionId || 'none'}`);
    const { mainDatePicker, eventPlanDatePicker } = initializeEventListeners(imageCache, window.flatpickr);
    log('Main', '9. Event listeners initialized.');
    
    ui.setupItineraryEventListeners();
    if (sessionId) {
        try {
            await api.loadSessionFromAirtable(sessionId);
            log('Main', '10. Session loaded successfully.');
            ui.updateHeader();
            ui.updateEventPlanSection();
            ui.updateTotalCost();
            log('Main', '11. Updated header, event plan, and total cost.');
            const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
            if (savedDate && eventPlanDatePicker) {
                eventPlanDatePicker.setDate(savedDate, true);
                log('Main', '12. Set saved date in event plan date picker.');
            }
        } catch (error) {
            console.error("Failed to load session:", error);
            log('Main', `13. Failed to load session: ${error.message}`);
            if (error.message.includes('FILE_ERROR_NO_SPACE')) {
                console.warn('Clearing local storage due to storage error.');
                log('Main', '14. Clearing local storage due to storage error.');
                localStorage.clear();
            }
            state.session.isOwned = true;
            log('Main', '15. Set session as owned due to load failure.');
        }
    } else {
        state.session.isOwned = true;
        log('Main', '16. No session ID, set session as owned.');
    }
    ui.toggleLoading(false);
    log('Main', '17. Loading UI toggled off.');
    document.getElementById('status-filter').value = 'Available';
    log('Main', '18. Set status filter to Available.');

    log('Main', '19. Applying initial filters and rendering...');
    applyFiltersAndSort(imageCache);
    ui.updateFavoritesCarousel();
    updateSaveShareButton();
    log('Main', '20. Filters applied, favorites and share button updated.');

    await updateHeaderCalendarAvailability();
    log('Main', '21. Header calendar updated.');

    initializeChatEventListeners();
    initializeChat();
    setupAuthEventListeners();
    updateUserProfileIcon();
    log('Main', '22. Chat initialized.');

    state.ui.isInitializing = false;
    log('Main', '23. Initialization complete, ready for user interaction.');

    const finalUrlParams = new URLSearchParams(window.location.search);
    if (finalUrlParams.get('view') === 'present') {
        log('Main', 'URL indicates to start in presentation view.');
        const storageKey = `session-viewed-${state.session.id}`;
        if (!localStorage.getItem(storageKey)) {
            log('Main', 'First time in presentation view for this session, opening chat.');
            const chatWidgetContainer = document.getElementById('chat-widget-container');
            if (chatWidgetContainer) {
                chatWidgetContainer.classList.add('chat-open');
                document.getElementById('chat-remain-open-checkbox').checked = true;
            }
            localStorage.setItem(storageKey, 'true');
        }
        
        const listToShow = state.cart.items.size > 0 ? 'favorites' : 'locked';
        if (state.cart.items.size > 0 || state.cart.lockedItems.size > 0) {
            setTimeout(() => ui.showPresentationView(listToShow), 100);
        }
    }
}

initialize();
