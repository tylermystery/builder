// REPLACE THE ENTIRE CONTENTS of main.js

import { state, setState } from './state.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { initializeEventListeners, initializeChatEventListeners } from './events.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY, PUSHER_KEY, PUSHER_CLUSTER } from './config.js';
import { updateUrl, getUrlParams } from './utils.js';
import { log, setDebugMode } from './utils/debug.js';
// --- THIS IS THE FIX ---
// Removed `getAvailableSlotsForDay` which does not exist
import { AVAILABILITY_STATUS, getDayStatus, checkAvailability, getRangeStatus } from './availability.js';
// --- END FIX ---
import { initializePusher } from './pusher.js';
import { initializeAuth, showUserModal } from './auth.js';
import * as backgroundEngine from './components/backgroundEngine.js';
import * as fluidEffect from './components/effects/fluid.js';

let flatpickr;
let shopSettings = {
    enabledFilters: ['Date & Time', 'Headcount', 'Location', 'Budget', 'Subcategories'],
    paymentOptions: 'DepositOrFull',
    terms: '35% deposit is non-refundable. Full payment due 14 days prior. Cancellations within 14 days forfeit full amount. All sales are final.'
};

async function initialize(sessionId, shopId, urlParams) {
    log('main.js', '5. initialize() function called.');
    state.ui.isInitializing = true;
    setState({ 
        session: { ...state.session, id: sessionId, shopId: shopId },
        ui: { ...state.ui, activeShopId: shopId }
    });
    
    // Set up auth listeners
    initializeAuth(shopId);

    // Initialize Stripe.js
    if (window.Stripe) {
        state.stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
    } else {
        console.error("Stripe.js not loaded. Payment functionality will be disabled.");
    }
    
    // Initialize Pusher
    if (window.Pusher) {
        state.pusher = initializePusher(PUSHER_KEY, PUSHER_CLUSTER, sessionId);
    } else {
        console.error("Pusher.js not loaded. Real-time features will be disabled.");
    }

    try {
        const [stores, records] = await Promise.all([
            api.fetchAllStores(), 
            api.fetchAllRecords()
        ]);

        const allRecordNames = new Set(records.map(r => r.fields.Name));
        records.forEach(record => {
            if (record.fields['Item Type'] === 'Grouping' && !record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]) {
                const subcategories = (record.fields[CONSTANTS.FIELD_NAMES.OPTIONS] || '')
                    .split(',')
                    .map(s => s.trim())
                    .filter(s => allRecordNames.has(s));
                if (subcategories.length > 0) {
                    record.fields.Subcategories = subcategories.join(',');
                }
            }
        });

        setState({ 
            stores: { all: stores },
            records: { all: records } 
        });
        log('Main', `Fetched ${stores.length} stores and ${records.length} records.`);

        let sessionData = null;
        if (sessionId.startsWith('rec')) {
            sessionData = await api.loadSessionFromAirtable(sessionId);
        } else if (sessionId.startsWith('shared-')) {
            sessionData = await api.loadSessionFromShareId(sessionId);
            if (sessionData && sessionData.id) {
                state.session.id = sessionData.id;
                updateUrl({ session: sessionData.id });
            }
        }
        
        if (sessionData) {
            log('Main', 'Successfully loaded session data from Airtable.');
            setState({ 
                eventDetails: { ...state.eventDetails, ...sessionData.eventDetails },
                cart: { ...state.cart, ...sessionData.cart }
            });
        } else if (sessionId.startsWith('rec')) {
            log('Main', 'Session ID provided but not found, clearing session.');
            updateUrl({ session: null });
        }
    } catch (error) {
        console.error("Initialization error:", error);
        ui.showToast(`Error initializing: ${error.message}`, 'error');
    }

    const { mainDatePicker, eventPlanDatePicker } = initializeEventListeners(new Map(), flatpickr, shopSettings);
    initializeChatEventListeners();
    
    await ui.initializeUi(mainDatePicker, eventPlanDatePicker, urlParams);
    
    // Final UI updates
    ui.updateHeader();
    await ui.updateEventPlanSection();
    await ui.updateIdeasCarousel();
    ui.updateTotalCost();
    ui.updateUserPlansDropdown();
    
    state.ui.isInitializing = false;
    log('main.js', '6. Calling backgroundEngine.initBackgroundEngine().');
    backgroundEngine.initBackgroundEngine();

    // Load the background effect
    log('main.js', '7. Calling backgroundEngine.loadEffect(fluidEffect, null).');
    backgroundEngine.loadEffect(fluidEffect, null);

    log('main.js', '8. End of initialize() function.');
} // End of initialize()

// --- Application Entry Point ---
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = getUrlParams();
    const sessionId = urlParams.session || `local-${new Date().getTime()}`;
    const shopId = urlParams.shopId || CONSTANTS.DEFAULT_SHOP_ID; // Use default if none provided
    
    // Apply debug mode if specified
    if (urlParams.debug) {
        setDebugMode(urlParams.debug === 'true');
    }

    try {
        await initialize(sessionId, shopId, urlParams);
    } catch (error) {
        console.error("A critical error occurred during initialization:", error);
        // Display a full-page error to the user
        document.body.innerHTML = `
            <div style="padding: 40px; text-align: center; font-family: sans-serif;">
                <h1>Oops! Something went wrong.</h1>
                <p>We're having trouble loading the event builder. Please try refreshing the page.</p>
                <p style="color: #666; font-size: 0.8em;">Error: ${error.message}</p>
            </div>
        `;
    }
});
