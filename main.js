// FILE: main.js
/*
 * Version: 5.0.1 (Debug)
 * Last Modified: 2025-09-21
 * * Changelog:
 * v5.0.1 - Added deep logging to inspect raw data fetched from Airtable at initialization.
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
        const [stores, records] = await Promise.all([
            api.fetchAllStores(),
            api.fetchAllRecords()
        ]);
        state.stores.all = stores;
        state.records.all = records;

        // --- NEW DEBUG STATEMENTS ---
        console.log("--- RAW DATA FROM AIRTABLE ---");
        console.log(`[Main] Fetched ${state.stores.all.length} stores. Sample store record:`, state.stores.all.length > 0 ? state.stores.all[0] : "No stores found.");
        console.log(`[Main] Fetched ${state.records.all.length} catalog items. Sample item record:`, state.records.all.length > 0 ? state.records.all[0] : "No items found.");
        console.log("------------------------------");
        // --- END DEBUG STATEMENTS ---

    } catch (error) {
        console.error("Failed to load initial data:", error);
        log('Main', `7. Failed to load initial data: ${error.message}`);
        document.getElementById('loading-message').innerHTML = `<p style='color:red;'>Error loading catalog: ${error.message}. Please try again later.</p>`;
        return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    let shopId = urlParams.get('shopId');
    let activeShop = null;

    if (shopId) {
        activeShop = state.stores.all.find(r => r.id === shopId);
    }

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

    const jwt = localStorage.getItem('jwt');
    if (jwt) {
        try {
            const payload = JSON.parse(atob(jwt.split('.')[1]));
            if (payload.exp * 1000 > Date.now()) {
                setState({ 
                    session: { ...state.session, user: { ...state.session.user, isAuthenticated: true, id: payload.userId, name: payload.name, email: payload.email } }
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
            setState({ session: { ...state.session, user: { ...state.session.user, ...data.user, isAuthenticated: true } } });
            
            // --- START: MODIFIED SECTION ---
            // After successful login, check the user's email domain
            if (data.user && data.user.email.toLowerCase().endsWith('@tylersmysterytours.com')) {
                // If it's a TMT email, redirect to the new personal dashboard
                const cleanUrl = new URL(window.location);
                cleanUrl.searchParams.delete('loginToken');
                // First set the clean URL, then redirect.
                window.history.replaceState({}, document.title, cleanUrl.toString());
                window.location.href = '/dashboard.html'; // Redirect to the new page
                return; // Stop further execution of this function
            }
            // --- END: MODIFIED SECTION ---

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
