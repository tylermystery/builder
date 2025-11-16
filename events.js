// REPLACE THE ENTIRE CONTENTS of events.js

import { state, setState } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { applyFiltersAndSort } from './filtering.js';
import { log, setDebugMode } from './utils/debug.js';
import { AVAILABILITY_STATUS, getDayStatus, checkAvailability, getRangeStatus } from './availability.js';
import { debounce, updateUrl, loadFlatpickr, getTempLikes, setTempLikes } from './utils.js';
import { sendMessage, initializeSessionChat } from './chat.js';
import { showItineraryModal, setupItineraryEventListeners } from './components/itinerary.js';
import { updateMobileBarAvailability } from './ui.js';
import { showUserModal } from './auth.js';
import { addEnergy, updateProgress } from './components/backgroundEngine.js';

let mainDatePicker = null;
let saveTimeout = null;
let saveShareBtn = null;
let aiSearchController = null;

function loadMoreRecords(imageCache) {
    if (state.ui.isLoadingMore) return;
    const start = state.ui.recordsCurrentlyDisplayed;
    const end = start + RECORDS_PER_LOAD;
    const recordsToLoad = state.records.filtered.slice(start, end);
    if (recordsToLoad.length > 0) {
        state.ui.isLoadingMore = true;
        ui.renderRecords(recordsToLoad, imageCache, true).then(() => {
            state.ui.recordsCurrentlyDisplayed += recordsToLoad.length;
            state.ui.isLoadingMore = false;
        });
    }
}

export function updateSaveShareButton() {
    if (!saveShareBtn) return;
    switch (state.ui.saveState) {
        case 'MODIFIED':
            saveShareBtn.textContent = 'Changes pending...';
            saveShareBtn.disabled = true;
            saveShareBtn.dataset.tooltip = 'Saving your changes automatically...';
            break;
        case 'SAVING':
            saveShareBtn.textContent = '⚙️ Saving...';
            saveShareBtn.disabled = true;
            saveShareBtn.dataset.tooltip = 'Saving your changes...';
            break;
        case 'SAVED':
            saveShareBtn.textContent = '🔗 Copy Link';
            const hasContent = state.cart.items.size > 0 || state.cart.lockedItems.size > 0 || state.eventDetails.combined.size > 0;
            saveShareBtn.disabled = !hasContent;
            saveShareBtn.dataset.tooltip = !hasContent ? 'Add items or details to enable sharing' : 'Copy a shareable link to this plan';
            break;
    }
}

export function triggerSave() {
    if (state.ui.isInitializing) return;
    clearTimeout(saveTimeout);
    state.ui.saveState = 'MODIFIED';
    updateSaveShareButton();
    saveTimeout = setTimeout(async () => {
        state.ui.saveState = 'SAVING';
        updateSaveShareButton();
        const success = await api.saveSessionToAirtable();
        if (success) {
            state.ui.saveState = 'SAVED';
            updateSaveShareButton();
        }
    }, 1500);
}

export async function updateAllCardAvailabilityIcons() {
    console.log('[updateAllCardAvailabilityIcons] Called');
    console.log('[updateAllCardAvailabilityIcons] mainDatePicker:', mainDatePicker);
    console.log('[updateAllCardAvailabilityIcons] mainDatePicker?.selectedDates:', mainDatePicker?.selectedDates);
    
    const allAvailabilityBtns = document.querySelectorAll('.availability-btn');
    console.log('[updateAllCardAvailabilityIcons] Found .availability-btn elements:', allAvailabilityBtns.length);
    
    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) {
        console.log('[updateAllCardAvailabilityIcons] No date range selected, setting all icons to calendar emoji');
        document.querySelectorAll('.availability-btn').forEach(icon => {
            if (icon._tippy) icon._tippy.destroy();
            icon.title = 'Select a date range to check availability';
            icon.textContent = '📅';
            console.log('[updateAllCardAvailabilityIcons] Set icon to 📅:', icon);
        });
        return;
    }
    const startDate = mainDatePicker.selectedDates[0];
    const requestedEnd = mainDatePicker.selectedDates[1];
    console.log('[updateAllCardAvailabilityIcons] Date range selected:', startDate, 'to', requestedEnd);
    
    const cards = document.querySelectorAll('.event-card');
    console.log('[updateAllCardAvailabilityIcons] Found event cards:', cards.length);
    
    for (const card of cards) {
        const recordId = card.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        
        const busyTimes = await api.fetchCalendarForRecord(record);
        const rangeStatus = getRangeStatus(startDate, requestedEnd, record, busyTimes);
        const icon = card.querySelector('.availability-btn');
        console.log('[updateAllCardAvailabilityIcons] Card recordId:', recordId, 'icon found:', !!icon, 'status:', rangeStatus.status);
        if (icon) {
            if (icon._tippy) icon._tippy.destroy();
            let statusIcon;
            switch (rangeStatus.status) {
                case AVAILABILITY_STATUS.FULL: statusIcon = '✅'; break;
                case AVAILABILITY_STATUS.PARTIAL: statusIcon = '🟠'; break;
                case AVAILABILITY_STATUS.NONE: statusIcon = '❌'; break;
                default: statusIcon = '📅';
            }
            
            const dateRangeString = `${startDate.toLocaleDateString()} - ${requestedEnd.toLocaleDateString()}`;
            const tooltipContent = `<div style="text-align: left;"><strong>${dateRangeString}</strong><hr style="margin: 2px 0 5px;"><span>${statusIcon} ${record.fields.Name}: ${rangeStatus.reason}</span></div>`;
            tippy(icon, { content: tooltipContent, allowHTML: true, placement: 'top', arrow: true });
            icon.title = rangeStatus.reason;
            icon.textContent = statusIcon;
        }
    }
}

async function handlePaymentFormSubmit(event) {
    event.preventDefault();
    log('Events', 'Payment form submitted.');

    const submitBtn = document.getElementById('payment-submit-btn');
    const buttonText = submitBtn.querySelector('.button-text');
    const spinner = submitBtn.querySelector('.spinner');
    const cardErrors = document.getElementById('card-errors');
    cardErrors.textContent = '';

    submitBtn.disabled = true;
    buttonText.style.display = 'none';
    spinner.style.display = 'inline';

    const { stripe, elements } = ui.getStripeContext();
    
    if (!stripe || !elements) {
        cardErrors.textContent = 'Payment system is not initialized. Please close and reopen the checkout window.';
        submitBtn.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
        return;
    }
    
    try {
        const customerName = document.getElementById('customer-name').value;
        const customerEmail = document.getElementById('customer-email').value;

        const { error, paymentIntent } = await stripe.confirmPayment({
            elements,
            confirmParams: {
                return_url: `${window.location.origin}${window.location.pathname}?payment_success=true`,
                payment_method_data: {
                    billing_details: {
                        name: customerName,
                        email: customerEmail,
                    },
                },
            },
            redirect: 'if_required', 
        });

        if (error) {
            if (error.type === "card_error" || error.type === "validation_error") {
                throw new Error(error.message);
            } else {
                console.error('Stripe confirmPayment error:', error);
                throw new Error("An unexpected error occurred during payment. Please try again.");
            }
        }

        if (paymentIntent.status === 'succeeded') {
            log('Events', 'Payment succeeded.');
            const amountPaid = paymentIntent.amount / 100;
            
            const newPayment = {
                amount: amountPaid,
                date: new Date().toISOString(),
                note: `Stripe Payment on ${new Date().toLocaleDateString()}`
            };
            const updatedPaymentHistory = [...state.session.user.paymentHistory, newPayment];
            
            await api.updatePaymentHistory(state.session.id, updatedPaymentHistory);

            state.session.user.paymentHistory = updatedPaymentHistory;
            state.session.user.amountReceived = updatedPaymentHistory.reduce((sum, p) => sum + p.amount, 0);

            ui.updateTotalCost();
            document.getElementById('payment-form').style.display = 'none';
            document.getElementById('checkout-summary-details').style.display = 'none';
            document.querySelector('.checkout-total-deposit-section').style.display = 'none';
            
            const feeRow = document.querySelector('.processing-fee-row');
            const totalRow = document.querySelector('.final-total-row');
            const divider = document.querySelector('.total-divider');
            if(feeRow) feeRow.style.display = 'none';
            if(totalRow) totalRow.style.display = 'none';
            if(divider) divider.style.display = 'none';
            
            document.querySelector('.terms-and-conditions').style.display = 'none';
            document.getElementById('payment-success-message').style.display = 'block';

            setTimeout(() => { ui.hideCheckoutModal(); }, 4000);
        }
    } catch (err) {
        log('Events', `Stripe payment error: ${err.message}`);
        cardErrors.textContent = err.message;
        submitBtn.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
    }
}

async function handleProactiveAISearch(searchTerm, imageCache) {
    if (aiSearchController) {
        aiSearchController.abort();
    }
    aiSearchController = new AbortController();
    const signal = aiSearchController.signal;

    const catalogContainer = document.getElementById('catalog-container');
    if (!catalogContainer) return;

    const ghostRecord = {
        id: `ai-search-${Date.now()}`,
        fields: {
            Name: `Searching for "${searchTerm}"...`,
            Description: "Our AI is looking for this item in the Bay Area...",
            Price: 0,
            'Item Type': 'Bookable Item',
            ServiceType: 'Partner Activity',
            Status: 'Available'
        }
    };
    
    const ghostCard = await ui.createInteractiveCard(ghostRecord, [], imageCache);
    ghostCard.id = "ai-ghost-card";
    ghostCard.style.opacity = "0.5";
    ghostCard.style.pointerEvents = "none";
    
    catalogContainer.innerHTML = '';
    catalogContainer.appendChild(ghostCard);

    try {
        log('Events', 'WORKAROUND: Simulating Proactive AI search for:', searchTerm);
        await new Promise(res => setTimeout(res, 1500)); 
        if (signal.aborted) return;

        const webData = {
            Name: `[DUMMY] ${searchTerm}`,
            Description: "This is a dummy item. The real AI-parsed description will go here.",
            Price: Math.floor(Math.random() * 100) + 10,
            ServiceType: "Partner Activity"
        };
        
        log('Events', 'Proactive AI Parse Success:', webData);
        
        const customId = `custom-${Date.now()}`;
        
        const liveRecord = {
            id: customId,
            fields: {
                Name: webData.Name,
                Description: webData.Description,
                Price: webData.Price,
                ServiceType: webData.ServiceType,
                'Item Type': 'Bookable Item',
                Status: 'Available',
                Rankings: JSON.stringify({
                    "profileSource": "ai_v1_dummy_profile",
                    "Pillars": { "Activities": 10, "Food/Drink": 0, "Venue": 0, "Extras": 0 },
                    "Vibe": { "Energy": 8, "Relaxation": 2, "Formality": 3, "Novelty": 9 },
                    "Intellect": { "Creative": 5, "Analytical": 5 },
                    "Physicality": { "Intensity": 5, "Accessibility": 5 },
                    "Tags": [searchTerm.toLowerCase(), "dummy", "partner activity"]
                }),
                Options: null, 'Parent Item': null, 'Pricing Type': 'per person', 
                'Headcount min': null, 'Media Tags': null, 'Curated Images': null, 
                Subcategories: null, 'iCal URL': null, 'Lead Time (days)': null, 
                RSVPs: null, Date: null, 'Chat Enabled': false, Duration: null, 
                Capacity: null, 'Location Details': null, 'Additional Information': null
            }
        };
        
        state.records.all.push(liveRecord);

        const finalCard = await ui.createInteractiveCard(liveRecord, [], imageCache);
        
        const addToPlanBtn = finalCard.querySelector('.add-to-plan-btn');
        if (addToPlanBtn) {
            addToPlanBtn.textContent = 'Add to Plan';
            addToPlanBtn.disabled = false;
            
            const newBtn = addToPlanBtn.cloneNode(true);
            addToPlanBtn.parentNode.replaceChild(newBtn, addToPlanBtn);

            newBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                log('Events', `Adding AI-parsed item: ${customId}`);
                
                state.cart.lockedItems.set(customId, {
                    quantity: 1,
                    selectedOptionIndex: 0,
                    note: `Added via AI search for: "${searchTerm}"`
                });

                // Add progress for AI-sourced item
                updateProgress(0.0002);

                ui.updateEventPlanSection();
                ui.updateTotalCost();
                triggerSave();
                
                newBtn.textContent = 'Update Plan';
                newBtn.disabled = true;
            });
        }

        catalogContainer.innerHTML = '';
        catalogContainer.appendChild(finalCard);

    } catch (err) {
        if (err.name === 'AbortError') {
            log('Events', 'AI search aborted by new search.');
            return;
        }
        log('Events', `Proactive AI parse error: ${err.message}`);
        catalogContainer.innerHTML = `<p style='text-align: center;'>Could not find "${searchTerm}". Please try a different name or URL.</p>`;
    } finally {
        aiSearchController = null;
    }
}


export function initializeEventListeners(imageCache, flatpickr, shopSettings) {
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) element.addEventListener(event, handler);
        else console.warn(`Element with ID "${selector}" not found.`);
    };

    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    if (window.innerWidth < 1000) {
        leftSidebar?.classList.add('collapsed');
        rightSidebar?.classList.add('collapsed');
    }

    safeAddEventListener('mobile-filter-trigger', 'click', () => {
        if (window.innerWidth < 1000) {
            leftSidebar?.classList.toggle('collapsed');
        }
    });
    safeAddEventListener('mobile-view-plan-btn', 'click', () => {
        const isCurrentlyCollapsed = rightSidebar?.classList.contains('collapsed');
        rightSidebar?.classList.toggle('collapsed');

        if (isCurrentlyCollapsed) {
            setTimeout(() => {
                rightSidebar?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 50);
        } else {
            document.getElementById('catalog-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    saveShareBtn = document.getElementById('save-share-btn');
    let debugEnabled = false;

    const betaTrigger = document.getElementById('beta-trigger');
    if (betaTrigger) {
        betaTrigger.addEventListener('click', () => {
            debugEnabled = !debugEnabled;
            setDebugMode(debugEnabled);
            log('Debug', `Debug mode is now ${debugEnabled ? 'ON' : 'OFF'}.`);
        });
    }

    let scrollTimeout;
    window.addEventListener('scroll', () => {
        if (scrollTimeout) return;
        scrollTimeout = setTimeout(() => {
            const buffer = 300;
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - buffer && !state.ui.isLoadingMore) {
                loadMoreRecords(imageCache);
            }
            scrollTimeout = null;
        }, 100);
    });

    // --- START CONSOLIDATED BUTTON GENERATION --
    const categoryFiltersRoot = document.getElementById('category-filters'); 
    if (categoryFiltersRoot) { 
        const planFilterBtn = document.createElement('button');
        planFilterBtn.className = 'filter-btn';
        planFilterBtn.id = 'plan-filter-btn';
        planFilterBtn.textContent = '⭐ My Plan';
        planFilterBtn.addEventListener('click', () => {
            document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
            planFilterBtn.classList.add('active');
            updateUrl({ category: null, subcategory: null, view: 'plan' });
            applyFiltersAndSort(imageCache);
        });
        categoryFiltersRoot.appendChild(planFilterBtn);

        const categoriesBtn = document.createElement('button');
        categoriesBtn.className = 'filter-btn';
        categoriesBtn.id = 'categories-filter-btn';
        categoriesBtn.textContent = '📂 Categories';
        categoriesBtn.addEventListener('click', () => {
            document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
            categoriesBtn.classList.add('active');
            updateUrl({ category: null, subcategory: null, view: 'categories' });
            applyFiltersAndSort(imageCache);
        });
        categoryFiltersRoot.appendChild(categoriesBtn);

        const allButton = document.createElement('button');
        allButton.className = 'filter-btn category-filter-btn active'; // Default to active
        allButton.dataset.filter = 'all';
        allButton.textContent = 'All';
        allButton.addEventListener('click', () => {
            document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
            allButton.classList.add('active');
            updateUrl({ category: null, subcategory: null, view: null });
            applyFiltersAndSort(imageCache);
        });
        categoryFiltersRoot.appendChild(allButton);

    }  else {
        console.warn("Could not find #category-filters container to add 'My Plan'/'My Likes' buttons.");
    }
    // --- END CONSOLIDATED BUTTON GENERATION --

    // --- START HEADER USER FILTER BUTTONS ---
    const likedItemsHeaderBtn = document.getElementById('liked-items-header-btn');
    const mySessionsHeaderBtn = document.getElementById('my-sessions-header-btn');
    const rsvpEventsHeaderBtn = document.getElementById('rsvp-events-header-btn');

    if (likedItemsHeaderBtn) {
        likedItemsHeaderBtn.style.display = 'block';
        likedItemsHeaderBtn.addEventListener('click', () => {
            updateUrl({ category: null, subcategory: null, view: 'likes' });
            applyFiltersAndSort(imageCache);
        });
    }

    if (mySessionsHeaderBtn) {
        mySessionsHeaderBtn.style.display = state.session.user.isAuthenticated ? 'block' : 'none';
        mySessionsHeaderBtn.addEventListener('click', () => {
            if (!state.session.user.isAuthenticated) {
                showUserModal();
                return;
            }
            updateUrl({ category: null, subcategory: null, view: 'my-sessions' });
            applyFiltersAndSort(imageCache);
        });
    }

    if (rsvpEventsHeaderBtn) {
        rsvpEventsHeaderBtn.style.display = state.session.user.isAuthenticated ? 'block' : 'none';
        rsvpEventsHeaderBtn.addEventListener('click', () => {
            if (!state.session.user.isAuthenticated) {
                showUserModal();
                return;
            }
            updateUrl({ category: null, subcategory: null, view: 'rsvp-events' });
            applyFiltersAndSort(imageCache);
        });
    }
    // --- END HEADER USER FILTER BUTTONS ---

    const toggleFilter = (elementId, settingName) => {
        const container = document.getElementById(elementId)?.parentElement;
        if (container) {
            if (elementId === 'subcategory-filters') {
                container.style.display = 'none';
            } else {
                container.style.display = shopSettings.enabledFilters.includes(settingName) ? 'flex' : 'none';
            }
        }
    };

    toggleFilter('subcategory-filters', 'Subcategories'); 
    toggleFilter('date-filter-group', 'Date & Time');
    toggleFilter('headcount-filter', 'Headcount');
    toggleFilter('location-filter', 'Location');
    toggleFilter('budget-filter', 'Budget');

    safeAddEventListener('status-filter', 'change', () => applyFiltersAndSort(imageCache));
    
    safeAddEventListener('name-filter', 'input', debounce((e) => {
        const searchTerm = e.target.value.trim();
        
        if (aiSearchController) {
            aiSearchController.abort(); 
        }
        
        applyFiltersAndSort(imageCache);
        
        if (state.records.filtered.length === 0 && searchTerm.length > 2) {
            log('Events', 'No local results, triggering proactive AI search.');
            
            const hasOtherFilters = 
                document.getElementById('status-filter').value !== 'Available' ||
                document.getElementById('headcount-filter').value !== 'any' ||
                document.getElementById('location-filter').value !== 'any' ||
                document.getElementById('budget-filter').value !== 'any' ||
                (new URLSearchParams(window.location.search).get('category') !== null);
            
            if (!hasOtherFilters) {
                handleProactiveAISearch(searchTerm, imageCache);
            }
        }
    
        
    }, 300)); 
    
    safeAddEventListener('clear-search-btn', 'click', () => {
        handleFilterChipClear({ 
            target: document.querySelector('#filter-chip-container .filter-chip[data-filter-type="name-filter"] button') 
        });
        document.getElementById('name-filter').blur(); 
    });
    safeAddEventListener('headcount-custom', 'input', debounce(() => applyFiltersAndSort(imageCache), 300));
    safeAddEventListener('headcount-filter', 'change', (e) => {
        document.getElementById('headcount-custom').style.display = (e.target.value === 'custom') ? 'block' : 'none';
        applyFiltersAndSort(imageCache);
    });
    safeAddEventListener('location-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('budget-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('sort-by', 'change', () => applyFiltersAndSort(imageCache));

    safeAddEventListener('reset-filters-btn', 'click', () => {
        updateUrl({ category: null, subcategory: null, view: null });
        
        const allButton = document.querySelector('#category-filters .filter-btn[data-filter="all"]');
        if (allButton) {
            document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
            allButton.classList.add('active');
        }

        document.getElementById('name-filter').value = '';
        document.getElementById('status-filter').value = 'Available';
        document.getElementById('headcount-filter').selectedIndex = 0;
        document.getElementById('headcount-custom').value = '';
        document.getElementById('headcount-custom').style.display = 'none';
        document.getElementById('location-filter').selectedIndex = 0;
        document.getElementById('budget-filter').selectedIndex = 0;
        document.getElementById('sort-by').selectedIndex = 0;
        if (mainDatePicker) mainDatePicker.clear();
        applyFiltersAndSort(imageCache);
    });

    // Lazy load Flatpickr when date filter is focused
    const dateFilterInput = document.getElementById('date-filter');
    if (dateFilterInput) {
        dateFilterInput.addEventListener('focus', async function initializeDatePicker() {
            if (!mainDatePicker) {
                try {
                    log('Events', 'Loading Flatpickr dynamically...');
                    await loadFlatpickr();
                    
                    if (!window.flatpickr) {
                        throw new Error('Flatpickr not available after loading');
                    }
                    
                    mainDatePicker = window.flatpickr("#date-filter", {
                        mode: "range",
                        dateFormat: "M j, Y",
                        onChange: async (selectedDates) => {
                            if (state.ui.isInitializing) return;
                            if (selectedDates.length > 0) {
                                if (selectedDates.length === 2) {
                                    selectedDates[1].setHours(23, 59, 59, 999);
                                }
                                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                                triggerSave();
                                await updateAllCardAvailabilityIcons();
                            } else {
                                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                                triggerSave();
                                await updateAllCardAvailabilityIcons();
                                await updateMobileBarAvailability();
                            }
                        },
                    });
                    log('Events', 'Date filter picker initialized successfully');
                } catch (error) {
                    log('Events', `Error initializing date picker: ${error.message}`);
                    console.error('Flatpickr initialization error:', error);
                }
            }
        }, { once: true });
    }

    safeAddEventListener('date-filter-group', 'click', async (e) => {
        const quickButton = e.target.closest('[data-date-quick]');
        if (!quickButton) return;
        
        if (!mainDatePicker) {
            try {
                log('Events', 'Loading Flatpickr for quick select button...');
                await loadFlatpickr();
                
                if (!window.flatpickr) {
                    throw new Error('Flatpickr not available after loading');
                }
                
                mainDatePicker = window.flatpickr("#date-filter", {
                    mode: "range",
                    dateFormat: "M j, Y",
                    onChange: async (selectedDates) => {
                        if (selectedDates.length === 2) {
                            selectedDates[1].setHours(23, 59, 59, 999);
                            state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                            triggerSave();
                            await updateAllCardAvailabilityIcons();
                        } else {
                            state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                            triggerSave();
                            await updateAllCardAvailabilityIcons();
                            await updateMobileBarAvailability();
                        }
                    },
                });
                log('Events', 'Date filter picker initialized from quick select');
            } catch (error) {
                log('Events', `Error initializing date picker: ${error.message}`);
                console.error('Flatpickr initialization error:', error);
                return;
            }
        }
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let startDate = new Date(today);
        let endDate = new Date(today);
        const quickFilterType = quickButton.dataset.dateQuick;
        switch (quickFilterType) {
            case 'tomorrow':
                startDate.setDate(today.getDate() + 1);
                endDate.setDate(today.getDate() + 1);
                break;
            case 'this-week':
                endDate.setDate(today.getDate() + (6 - today.getDay()));
                break;
            case 'next-2-weeks':
                endDate.setDate(today.getDate() + 14);
                break;
        }
        mainDatePicker.setDate([startDate, endDate], true);
    });

    safeAddEventListener('header-event-name', 'change', (e) => {
        console.log('[Events] ========== EVENT NAME CHANGE ==========');
        console.log('[Events] isInitializing:', state.ui.isInitializing);
        if (state.ui.isInitializing) return;
        const hadValue = state.eventDetails.combined.has(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
        const newValue = e.target.value.trim();
        console.log('[Events] hadValue:', hadValue, 'newValue:', newValue);
        if (newValue && !hadValue) {
            console.log('[Events] Adding event name, calling updateProgress(0.0001)');
            updateProgress(0.0001); // Adding event name progresses
        } else if (!newValue && hadValue) {
            console.log('[Events] Removing event name, calling updateProgress(-0.0001)');
            updateProgress(-0.0001); // Removing event name regresses
        }
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
        console.log('[Events] ========== EVENT NAME CHANGE COMPLETE ==========');
    });
    
    safeAddEventListener('header-goals', 'change', (e) => {
        if (state.ui.isInitializing) return;
        const hadValue = state.eventDetails.combined.has(CONSTANTS.DETAIL_TYPES.GOALS);
        const newValue = e.target.value.trim();
        if (newValue && !hadValue) {
            updateProgress(0.0001); // Adding goals progresses
        } else if (!newValue && hadValue) {
            updateProgress(-0.0001); // Removing goals regresses
        }
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
        if (document.getElementById('sort-by').value === 'recommended') {
            applyFiltersAndSort(imageCache);
        }
    });

    document.body.addEventListener('click', async (e) => {
        if (state.ui.isInitializing) return;

        const card = e.target.closest('.event-card');
        const heartIcon = e.target.closest('.heart-icon');
        const rsvpBtn = e.target.closest('.rsvp-btn');
        const ideaItem = e.target.closest('.favorite-item');
        const removeIdeaBtn = ideaItem?.querySelector('.remove-btn');
        const checkoutBtn = e.target.closest('#checkout-btn');
        const lockedItemCard = e.target.closest('.locked-item-card');
        const demoteBtn = e.target.closest('.demote-locked-item-btn');
        const parentLink = e.target.closest('.parent-link');
        const presentBtn = e.target.closest('.present-btn');
        const carouselNav = e.target.closest('.carousel-nav');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const breadcrumbLink = e.target.closest('.breadcrumb-link');
        const addToPlanBtn = e.target.closest('.add-to-plan-btn, #modal-add-to-plan-btn');

        const healthSuggestionBtn = e.target.closest('.health-suggestion-btn');

        if (healthSuggestionBtn) {
            e.stopPropagation();
            const categoryToFilter = healthSuggestionBtn.dataset.categoryFilter;
            
            log('Events', `Health suggestion clicked. Filtering for: ${categoryToFilter}`);
            
            updateUrl({ category: categoryToFilter, subcategory: null, view: null });
            applyFiltersAndSort(imageCache);
            
            document.getElementById('catalog-area')?.scrollIntoView({ behavior: 'smooth' });
        }
        
        else if (saveShareBtn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            }).catch(err => {
                console.error('Failed to copy link:', err);
                ui.showToast('Failed to copy link.');
            });
        } else if (breadcrumbLink) {
            e.preventDefault();
            const filterValue = breadcrumbLink.dataset.filter;
            if (filterValue === 'all') {
                updateUrl({ category: null, subcategory: null, view: null });
            } else {
                updateUrl({ category: filterValue, subcategory: null, view: null });
            }
            applyFiltersAndSort(imageCache);
        } else if (checkoutBtn) {
            ui.showCheckoutModal(shopSettings);
        } else if (rsvpBtn) {
            e.stopPropagation();
            if (!state.session.user.isAuthenticated) {
                showUserModal();
                return;
            }
            const cardEl = rsvpBtn.closest('.event-card') || rsvpBtn.closest('[data-record-id]');
            const recordId = cardEl?.dataset.recordId;
            if (!recordId) return;

            const rsvpType = rsvpBtn.dataset.rsvpType || 'yes';
            const wasActive = rsvpBtn.classList.contains('active');

            rsvpBtn.disabled = true;
            const originalText = rsvpBtn.innerHTML;
            rsvpBtn.textContent = 'Saving...';
            
            try {
                let updatedRecord;
                if (wasActive) {
                    updatedRecord = await api.updateRsvpForEvent(recordId, state.session.user.id, null);
                } else {
                    updatedRecord = await api.updateRsvpForEvent(recordId, state.session.user.id, rsvpType);
                }
                
                if (updatedRecord) {
                    const recordIndex = state.records.all.findIndex(r => r.id === recordId);
                    if (recordIndex > -1) state.records.all[recordIndex] = updatedRecord;
                    
                    if (document.getElementById('detail-modal-overlay')?.classList.contains('active')) {
                        ui.showDetailModal(updatedRecord);
                    }
                } else {
                    throw new Error('RSVP update failed.');
                }
            } catch (error) {
                console.error("RSVP Error:", error);
                ui.showToast(`RSVP Error: ${error.message}`);
                rsvpBtn.innerHTML = originalText;
                rsvpBtn.disabled = false;
            }
        } else if (presentBtn) {
            const listType = presentBtn.dataset.listType;
            updateUrl({ view: 'present' });
            ui.showPresentationView(listType);
        } else if (carouselNav) {
            const carousel = document.getElementById('ideas-carousel'); 
            if (carousel) {
                const scrollAmount = 300;
                const direction = carouselNav.classList.contains('right') ? 1 : -1;
                carousel.scrollBy({ left: scrollAmount * direction, behavior: 'smooth' });
            }
        } else if (parentLink) {
            e.stopPropagation();
            const parentName = parentLink.dataset.parentName;
            if (parentName) {
                const parentRecord = state.records.all.find(r => r.fields.Name === parentName);
                if (parentRecord) {
                    const parentFilterName = parentName.toLowerCase(); 
                    updateUrl({ category: parentFilterName, subcategory: null, view: null });
                    applyFiltersAndSort(imageCache);
                    
                    if (document.getElementById('detail-modal-overlay')?.classList.contains('active')) {
                        updateUrl({ openItem: null });
                        ui.hideDetailModal();
                    }
                }
            }
        } else if (heartIcon) {
            e.stopPropagation();
            addEnergy(); 
            const recordId = heartIcon.closest('[data-record-id]')?.dataset.recordId;
            if (!recordId) return;
    
            console.log(`[Events] Heart icon clicked for record: ${recordId}`); 
    
            if (state.session.user.isAuthenticated) {
                console.log(`[Events] User is authenticated (ID: ${state.session.user.id}). Current liked IDs:`, new Set(state.session.user.likedItemIds));
                try {
                    heartIcon.style.pointerEvents = 'none';
                    heartIcon.style.opacity = '0.6';
                    heartIcon.style.transform = 'scale(0.9)';
                    
                    console.log(`[Events] Calling api.toggleUserLike for ${recordId}...`);
                    const result = await api.toggleUserLike(recordId);
                    console.log(`[Events] api.toggleUserLike response for ${recordId}:`, result);
    
                    if (result.success) {
                        let actionTaken = '';
                        if (result.liked) {
                            state.session.user.likedItemIds.add(recordId);
                            actionTaken = 'liked';
                            log('Events', `User liked item ${recordId}.`);
                        } else {
                            state.session.user.likedItemIds.delete(recordId);
                            actionTaken = 'unliked';
                            log('Events', `User unliked item ${recordId}.`);
                        }
                        console.log(`[Events] State updated. Action: ${actionTaken}. New liked IDs:`, new Set(state.session.user.likedItemIds));
                        console.log(`[Events] Calling ui.updateCardIcon for ${recordId}...`);
                        ui.updateCardIcon(recordId);
                        console.log(`[Events] ui.updateCardIcon finished for ${recordId}.`);
    
                        if (document.getElementById('liked-items-filter-btn')?.classList.contains('active')) {
                            console.log('[Events] \"My Likes\" filter active, reapplying filters...');
                            applyFiltersAndSort(imageCache);
                        }
                    } else {
                         console.error(`[Events] API toggle failed but returned success=false for ${recordId}. Response:`, result);
                         ui.showToast('Could not update like status. Please try again.');
                    }
                } catch (error) {
                    console.error(`[Events] Error during api.toggleUserLike for ${recordId}:`, error);
                    log('Events', `Error toggling like: ${error.message}`);
                    ui.showToast(`Error: ${error.message}`);
                } finally {
                    heartIcon.style.pointerEvents = 'auto';
                    heartIcon.style.opacity = '';
                    heartIcon.style.transform = '';
                    console.log(`[Events] Re-enabled pointer events for heart icon ${recordId}.`);
                }
            } else {
                 console.log('[Events] User is logged out. Handling temporary like.');
                log('Events', `Guest toggling temporary like for item ${recordId}.`);
                const tempLikesSet = getTempLikes();
                let currentlyLiked = false;
                if (tempLikesSet.has(recordId)) {
                    tempLikesSet.delete(recordId); 
                    currentlyLiked = false;
                     console.log(`[Events] Removed ${recordId} from temporary likes.`);
                } else {
                    tempLikesSet.add(recordId); 
                    currentlyLiked = true;
                     console.log(`[Events] Added ${recordId} to temporary likes.`);
                }
                setTempLikes(tempLikesSet);
                log('Events', `Temporary likes updated: ${Array.from(tempLikesSet).join(', ')}`);
                 console.log(`[Events] Calling ui.updateCardIcon for ${recordId} (logged out)...`);
                ui.updateCardIcon(recordId);
                 console.log(`[Events] ui.updateCardIcon finished for ${recordId} (logged out).`);
                if (currentlyLiked) {
                     console.log(`[Events] Showing login prompt because item ${recordId} was liked.`);
                     ui.showLoginPromptForLikes();
                }
                if (document.getElementById('liked-items-filter-btn')?.classList.contains('active')) {
                      console.log('[Events] \"My Likes\" filter active, reapplying filters (logged out)...');
                      applyFiltersAndSort(imageCache);
                 }
            }
        }
        
        else if (addToPlanBtn) {
            console.log('[Events] ========== ADD TO PLAN CLICKED ==========');
            e.stopPropagation();
            const recordId = addToPlanBtn.closest('[data-record-id]')?.dataset.recordId;
            console.log('[Events] recordId:', recordId);
            if (!recordId) return;

            addEnergy();

            if (state.cart.lockedItems.has(recordId)) {
                console.log('[Events] Item already in plan, skipping');
                if (document.getElementById('detail-modal-overlay')?.classList.contains('active')) {
                    updateUrl({ openItem: null });
                    ui.hideDetailModal();
                }
                return;
            }

            let itemInfo;
            const modalOverlay = document.getElementById('detail-modal-overlay');
            if (modalOverlay?.classList.contains('active') && modalOverlay.dataset.recordId === recordId) {
                const quantity = parseInt(document.querySelector('#modal-quantity-selector .quantity-input')?.value, 10) || 1;
                const selectedOptionIndex = parseInt(document.querySelector('#modal-options-container .option-btn.selected')?.dataset.optionIndex, 10) || 0;
                const note = document.getElementById('modal-item-note')?.value || '';
                itemInfo = { quantity, selectedOptionIndex, note };
                updateUrl({ openItem: null });
                ui.hideDetailModal();
            } else {
                itemInfo = ui.getItemState(recordId);
            }

            console.log('[Events] itemInfo:', itemInfo);
            state.cart.lockedItems.set(recordId, itemInfo);
            state.cart.items.delete(recordId);

            // Add progress for adding item to plan (scaled by quantity)
            const progressDelta = 0.0002 * (itemInfo.quantity || 1);
            console.log('[Events] Calling updateProgress with delta:', progressDelta);
            updateProgress(progressDelta);
            console.log('[Events] updateProgress called');

            ui.updateCardIcon(recordId);
            ui.updateCardButtonText(recordId, true);
            await ui.updateIdeasCarousel();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            await updateAllCardAvailabilityIcons();
            updateMobileBarAvailability();
            triggerSave();
        } else if (demoteBtn) {
            console.log('[Events] ========== DEMOTE CLICKED ==========');
            e.stopPropagation();
            const recordId = demoteBtn.closest('[data-record-id]')?.dataset.recordId;
            console.log('[Events] recordId:', recordId);
            if (!recordId || !state.cart.lockedItems.has(recordId)) return;

            const itemInfo = state.cart.lockedItems.get(recordId);
            console.log('[Events] itemInfo:', itemInfo);
            state.cart.lockedItems.delete(recordId);
            state.cart.items.set(recordId, itemInfo);

            // Regress progress when demoting item from plan
            const progressDelta = -0.0002 * (itemInfo.quantity || 1);
            console.log('[Events] Calling updateProgress with delta:', progressDelta);
            updateProgress(progressDelta);
            console.log('[Events] updateProgress called');

            ui.updateCardIcon(recordId);
            ui.updateCardButtonText(recordId, false);
            await ui.updateEventPlanSection();
            await ui.updateIdeasCarousel();
            ui.updateTotalCost();
            updateMobileBarAvailability();
            triggerSave();
        } else if (removeIdeaBtn && e.target === removeIdeaBtn) {
            e.stopPropagation();
            const recordId = ideaItem.dataset.recordId;
            if (!recordId || !state.cart.items.has(recordId)) return;

            const itemInfo = state.cart.items.get(recordId);
            state.cart.items.delete(recordId);

            // Regress progress when removing item from ideas
            updateProgress(-0.0001 * (itemInfo?.quantity || 1));

            await ui.updateIdeasCarousel();
            triggerSave();
        } else if (e.target.closest('.availability-btn')) {
            e.stopPropagation();
            const calendarBtn = e.target.closest('.availability-btn');
            const card = calendarBtn.closest('.event-card');
            if (!card) return;
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) return;
            
            ui.showDetailModal(record);
            
            setTimeout(() => {
                const modalCalendar = document.getElementById('modal-calendar-container');
                if (modalCalendar && modalCalendar.style.display !== 'none') {
                    modalCalendar.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            }, 300);
        } else if (card && !e.target.closest('.quantity-selector, .heart-icon, .add-to-plan-btn')) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) return;
            
            if (record.id.startsWith('ai-search-')) {
                return;
            }
            
            // Handle session tile clicks - navigate to that session
            if (record.isSession && record.sessionData) {
                const currentShopId = state.ui.activeShopId;
                window.location.href = `${window.location.pathname}?session=${record.id}&shopId=${currentShopId}`;
                return;
            }

            if (record.fields['Item Type'] === 'Grouping') {
                 const groupName = record.fields.Name;
                 const groupNameLower = groupName.toLowerCase();
                 const parentName = record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];

                 // Small progress for browsing categories
                 updateProgress(0.00002);

                 if (!parentName) {
                     updateUrl({ category: groupNameLower, subcategory: null, view: null });
                 } else {
                     const parentNameLower = parentName.toLowerCase();
                     updateUrl({ category: parentNameLower, subcategory: groupNameLower, view: null });
                 }
                 applyFiltersAndSort(imageCache);

            } else {
                // Small progress for viewing item details
                updateProgress(0.00001);
                ui.showDetailModal(record);
            }
        } else if (lockedItemCard && !e.target.closest('.demote-locked-item-btn, .edit-btn')) {
            const recordId = lockedItemCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        } else if (ideaItem && !e.target.closest('.add-to-plan-btn, .remove-btn')) {
            const recordId = ideaItem.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
             if (record) ui.showDetailModal(record);
        }
    }); // End of body click listener

    document.body.addEventListener('change', (e) => {
        if (state.ui.isInitializing) return;
        const target = e.target;
        const container = target.closest('[data-record-id]');
        if (!container) return;
        const recordId = container.dataset.recordId;
        const isLocked = state.cart.lockedItems.has(recordId);
        const isInIdeas = state.cart.items.has(recordId);
        let updates = {};
        
        // Track old quantity for progress calculation
        let oldQuantity = 0;
        if (target.matches('.quantity-input')) {
            const currentState = isLocked ? state.cart.lockedItems.get(recordId) : state.cart.items.get(recordId);
            oldQuantity = currentState?.quantity || 1;
            updates.quantity = parseInt(target.value, 10);
        } else if (target.matches('#modal-item-note')) {
            updates.note = target.value;
        } else if (e.detail?.selectedOptionIndex !== undefined) {
             updates.selectedOptionIndex = e.detail.selectedOptionIndex;
        }
        
        if (Object.keys(updates).length > 0) {
            // Calculate progress based on quantity changes
            if (updates.quantity !== undefined && updates.quantity !== oldQuantity) {
                const quantityDelta = updates.quantity - oldQuantity;
                updateProgress(0.0001 * quantityDelta);
            }
            
            if (isLocked) {
                ui.updateLockedItemState(recordId, updates);
                ui.updateEventPlanSection();
                ui.updateTotalCost();
            } else {
                ui.updateItemState(recordId, updates);
                if (!isInIdeas && target.matches('.quantity-input')) {
                    ui.updateIdeasCarousel();
                }
            }
            triggerSave();
        }
    });
    
    // Lazy load Flatpickr when event date picker is focused
    let eventPlanDatePicker = null;
    const eventDateInput = document.getElementById('event-date-picker');
    if (eventDateInput) {
        eventDateInput.addEventListener('focus', async function initializeEventDatePicker() {
            if (!eventPlanDatePicker) {
                try {
                    log('Events', 'Loading Flatpickr dynamically for event date picker...');
                    await loadFlatpickr();
                    
                    if (!window.flatpickr) {
                        throw new Error('Flatpickr not available after loading');
                    }
                    
                    eventPlanDatePicker = window.flatpickr("#event-date-picker", {
                        dateFormat: "M j, Y",
                        onChange: async (selectedDates) => {
                            if (state.ui.isInitializing) return;
                            if (selectedDates.length > 0) {
                                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates[0].toISOString());
                                updateProgress(0.00015);
                            } else {
                                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                                updateProgress(-0.00015);
                            }
                            await ui.updateEventPlanDateDisplay();
                            await ui.updateLockedItemStatusIcons();
                            await updateMobileBarAvailability();
                            triggerSave();
                        }
                    });
                    log('Events', 'Event date picker initialized successfully');
                } catch (error) {
                    log('Events', `Error initializing event date picker: ${error.message}`);
                    console.error('Flatpickr initialization error:', error);
                }
            }
        }, { once: true });
    }
    
    safeAddEventListener('itinerary-btn', 'click', () => {
        log('Events', 'Itinerary button clicked, showing modal.');
        showItineraryModal();
    });
    
    ui.setupPresentationEventListeners();
    safeAddEventListener('payment-form', 'submit', handlePaymentFormSubmit);

    setupItineraryEventListeners();

    return { mainDatePicker, eventPlanDatePicker };
}

export function initializeChatEventListeners() {
    const messageForm = document.getElementById('message-form');
    const messageInput = document.getElementById('message-input');
    if (messageForm) {
        messageForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const message = messageInput.value;
            if (message.trim() === '') return;
            sendMessage(message);
            messageInput.value = '';
        });
    }

    const chatToggleButton = document.getElementById('chat-toggle-button');
    const chatWidgetContainer = document.getElementById('chat-widget-container');
    function toggleChatWindow(forceClose = false) {
        if (chatWidgetContainer) {
            if (forceClose) {
                chatWidgetContainer.classList.remove('chat-open');
            } else {
                chatWidgetContainer.classList.toggle('chat-open');
            }
        }
    }

    if (chatToggleButton) {
        chatToggleButton.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleChatWindow();
        });
    }

    document.addEventListener('click', (event) => {
        const remainOpenCheckbox = document.getElementById('chat-remain-open-checkbox');
        if (chatWidgetContainer && !chatWidgetContainer.contains(event.target) && chatWidgetContainer.classList.contains('chat-open')) {
            if (!remainOpenCheckbox || !remainOpenCheckbox.checked) {
                toggleChatWindow(true);
            }
        }
    });
}

export function openChatWidget(andKeepOpen = false) {
    const chatWidgetContainer = document.getElementById('chat-widget-container');
    if (chatWidgetContainer) {
        chatWidgetContainer.classList.add('chat-open');
        if (andKeepOpen) {
            const remainOpenCheckbox = document.getElementById('chat-remain-open-checkbox');
            if (remainOpenCheckbox) {
                remainOpenCheckbox.checked = true;
            }
        }
    }
}

// And add the handleFilterChipClear function to the end of events.js
function handleFilterChipClear(e) {
    // This is a dummy function to route the click back to ui.js logic 
    // to prevent deep import dependency issues. It requires ui.js to be loaded.
    if (typeof ui.handleFilterChipClear === 'function') {
        ui.handleFilterChipClear(e);
    } else {
         // Fallback for non-chip clearing
        document.getElementById('name-filter').value = '';
        window.applyFiltersAndSort(window.imageCache);
    }
}
