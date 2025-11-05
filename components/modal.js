// REPLACE THE ENTIRE CONTENTS of events.js

import { state, setState } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { applyFiltersAndSort } from './filtering.js';
import { log, setDebugMode } from './utils/debug.js';
import { calculateMissingCategories, buildGoalBucket } from '../availability.js';
import { debounce, updateUrl } from './utils.js';
import { sendMessage, initializeSessionChat } from './chat.js';
import { showItineraryModal, setupItineraryEventListeners } from './components/itinerary.js';
import { updateMobileBarAvailability } from './ui.js';
import { showUserModal } from './auth.js';
import { addEnergy } from './components/backgroundEngine.js';

let mainDatePicker = null;
let saveTimeout = null;
let saveShareBtn = null;
let categoryFiltersContainer = null;
let subcategoryFiltersContainer = null;
let aiSearchController = null; // --- ADDED THIS LINE ---

function getCurrentCategoryRecord() {
    if (!categoryFiltersContainer) return null;
    const selectedCategoryButton = categoryFiltersContainer.querySelector('.filter-btn.active');
    if (!selectedCategoryButton || selectedCategoryButton.dataset.filter === 'all' || selectedCategoryButton.id === 'plan-filter-btn') {
        return null;
    }
    return state.records.all.find(record => record.fields.Name === selectedCategoryButton?.textContent);
}

function getAvailableSubcategories(categoryRecord) {
    if (!categoryRecord) {
        return [];
    }
    const subcategoryOptions = ui.parseOptions(categoryRecord.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    return subcategoryOptions.map(option => option.name).sort();
}

export function updateSubcategoryButtons() {
    if (!subcategoryFiltersContainer) return;
    subcategoryFiltersContainer.innerHTML = '';
    const categoryRecord = getCurrentCategoryRecord();
    const subcategories = getAvailableSubcategories(categoryRecord);
    subcategories.forEach(subcat => {
        const button = document.createElement('button');
        button.className = 'filter-btn subcategory-filter-btn';
        button.dataset.filter = subcat.toLowerCase();
        button.textContent = subcat;
        subcategoryFiltersContainer.appendChild(button);
    });
}

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
    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) {
        document.querySelectorAll('.availability-btn').forEach(icon => {
            if (icon._tippy) icon._tippy.destroy();
            icon.title = 'Select a date range to check availability';
            icon.textContent = '📅';
        });
        return;
    }
    const startDate = mainDatePicker.selectedDates[0];
    const requestedEnd = mainDatePicker.selectedDates[1];
    const cards = document.querySelectorAll('.event-card');
    for (const card of cards) {
        const recordId = card.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        
        const busyTimes = await api.fetchCalendarForRecord(record);
        const rangeStatus = getRangeStatus(startDate, requestedEnd, record, busyTimes);
        const icon = card.querySelector('.availability-btn');
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
            const tooltipContent = `<div style=\"text-align: left;\"><strong>${dateRangeString}</strong><hr style=\"margin: 2px 0 5px;\"><span>${statusIcon} ${record.fields.Name}: ${rangeStatus.reason}</span></div>`;
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

    const { stripe, cardElement } = ui.getStripeContext();
    if (!stripe || !cardElement) {
        cardErrors.textContent = 'Payment system is not initialized. Please close and reopen the checkout window.';
        submitBtn.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
        return;
    }
    
    try {
        const finalTotal = parseFloat(document.getElementById('full-total-price').dataset.total || 0);
        const amountReceived = state.session.user.amountReceived || 0;
        const totalDue = finalTotal - amountReceived;
        const isFirstPayment = amountReceived === 0;
        const baseAmountToCharge = isFirstPayment ? (finalTotal * 0.35) : totalDue;
        const tipAmount = parseFloat(document.getElementById('tip-amount').value) || 0;
        const finalAmountToCharge = baseAmountToCharge + tipAmount;
        const finalAmountInCents = Math.round(finalAmountToCharge * 100);
        if (finalAmountInCents < 50) {
            throw new Error("Final amount is too low to process.");
        }

        const intentResponse = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: finalAmountInCents }),
        });
        if (!intentResponse.ok) throw new Error('Could not create payment intent.');
        const paymentIntentData = await intentResponse.json();
        const clientSecret = paymentIntentData.clientSecret;
        const customerName = document.getElementById('customer-name').value;
        const customerEmail = document.getElementById('customer-email').value;
        const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
            payment_method: {
                card: cardElement,
                billing_details: { name: customerName, email: customerEmail },
            },
        });
        if (error) {
            throw new Error(error.message);
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

// --- V2.1: REPLACE THIS ENTIRE FUNCTION ---
/**
 * Triggers a "ghost card" and dummy AI parse when a search yields no local results.
 * @param {string} searchTerm The user's search query.
 * @param {Map} imageCache The global imageCache.
 */
async function handleProactiveAISearch(searchTerm, imageCache) {
    if (aiSearchController) {
        aiSearchController.abort();
    }
    aiSearchController = new AbortController();
    const signal = aiSearchController.signal;

    const catalogContainer = document.getElementById('catalog-container');
    if (!catalogContainer) return;

    // 1. Inject the "Ghost Card" (Loading State)
    const ghostRecord = {
        id: `ai-search-${Date.now()}`, // Temporary ID
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
        // --- START V2.1: DUMMY DATA WORKAROUND ---
        log('Events', 'WORKAROUND: Simulating Proactive AI search for:', searchTerm);
        await new Promise(res => setTimeout(res, 1500)); // Simulate network delay
        if (signal.aborted) return;

        // This is the fake data the "API" (process-weblink.js) would return
        const webData = {
            Name: `[DUMMY] ${searchTerm}`,
            Description: "This is a dummy item. The real AI-parsed description will go here.",
            Price: Math.floor(Math.random() * 100) + 10,
            ServiceType: "Partner Activity"
        };
        // --- END V2.1 DUMMY ---

        // (The real code would be:)
        // const response = await fetch('/api/process-weblink', { ... });
        // const webData = await response.json();
        // ...
        
        log('Events', 'Proactive AI Parse Success:', webData);
        
        const customId = `custom-${Date.now()}`;
        
        // --- V2.1: This is the KEY "INTERMIXING" LOGIC --
        // Create a "record" object that mimics a real Airtable record
        const liveRecord = {
            id: customId,
            fields: {
                Name: webData.Name,
                Description: webData.Description,
                Price: webData.Price,
                ServiceType: webData.ServiceType,
                'Item Type': 'Bookable Item',
                Status: 'Available',
                // --- V2.1: SIMULATE THE AI PROFILING ---
                // In a real scenario, we'd call /api/profile-item
                // For now, we'll inject a DUMMY profile.
                Rankings: JSON.stringify({
                    "profileSource": "ai_v1_dummy_profile",
                    "Pillars": { "Activities": 10, "Food/Drink": 0, "Venue": 0, "Extras": 0 },
                    "Vibe": { "Energy": 8, "Relaxation": 2, "Formality": 3, "Novelty": 9 },
                    "Intellect": { "Creative": 5, "Analytical": 5 },
                    "Physicality": { "Intensity": 5, "Accessibility": 5 },
                    "Tags": [searchTerm.toLowerCase(), "dummy", "partner activity"]
                }),
                // Add "null" placeholders for safety
                Options: null, 'Parent Item': null, 'Pricing Type': 'per person', 
                'Headcount min': null, 'Media Tags': null, 'Curated Images': null, 
                Subcategories: null, 'iCal URL': null, 'Lead Time (days)': null, 
                RSVPs: null, Date: null, 'Chat Enabled': false, Duration: null, 
                Capacity: null, 'Location Details': null, 'Additional Information': null
            }
        };
        
        // (The *real* code would call our new function:)
        // try {
        //    log('Events', `Calling /api/profile-item for new item ${customId}`);
        //    const profileResponse = await fetch('/api/profile-item', {
        //        method: 'POST',
        //        headers: { 'Content-Type': 'application/json' },
        //        body: JSON.stringify({ recordId: customId }) // (This assumes customId exists in Airtable)
        //    });
        //    const profileData = await profileResponse.json();
        //    liveRecord.fields.Rankings = JSON.stringify(profileData.profile);
        // } catch (profileError) {
        //    log('Events', `Could not profile new item: ${profileError.message}`);
        // }
        // --- END V2.1 ---
        
        state.records.all.push(liveRecord);

        // 4. Create the *real* card and replace the ghost card
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

                ui.updateEventPlanSection();
                ui.updateTotalCost();
                triggerSave();
                
                newBtn.textContent = 'In Plan';
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
// --- END V2.1 REPLACEMENT ---


export function initializeEventListeners(imageCache, flatpickr, shopSettings) {
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) element.addEventListener(event, handler);
        else console.warn(`Element with ID \"${selector}\" not found.`);
    };

    safeAddEventListener('my-plans-dropdown', 'change', (e) => {
        const dropdown = e.target;
        const selectedId = dropdown.value;
        if (selectedId === 'new') {
            const currentShopId = state.ui.activeShopId;
            window.location.href = `${window.location.pathname}?shopId=${currentShopId}`;
        } else if (selectedId) {
            window.location.href = `${window.location.pathname}?session=${selectedId}`;
        }
    });

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
    categoryFiltersContainer = document.getElementById('category-filters');
    subcategoryFiltersContainer = document.getElementById('subcategory-filters');
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
    if (categoryFiltersContainer) {
        categoryFiltersContainer.innerHTML = ''; 
    } else {
        console.error("CRITICAL: Cannot find '#category-filters' container. Filter buttons will not be added.");
    }

    if (categoryFiltersContainer) { 
        const planFilterBtn = document.createElement('button');
        planFilterBtn.className = 'filter-btn';
        planFilterBtn.id = 'plan-filter-btn';
        planFilterBtn.textContent = '⭐ My Plan';
        categoryFiltersContainer.appendChild(planFilterBtn);

        const likesFilterBtn = document.createElement('button');
        likesFilterBtn.className = 'filter-btn';
        likesFilterBtn.id = 'liked-items-filter-btn';
        likesFilterBtn.textContent = '❤️ My Likes';
        categoryFiltersContainer.appendChild(likesFilterBtn);

        const allButton = document.createElement('button');
        allButton.className = 'filter-btn category-filter-btn'; 
        allButton.dataset.filter = 'all';
        allButton.textContent = 'All';
        categoryFiltersContainer.appendChild(allButton);

        const currentStore = state.stores.all.find(r => r.id === state.ui.activeShopId);
        if (currentStore && Array.isArray(currentStore.fields.Items)) {
            const categoryRecordIds = currentStore.fields.Items;
            const categories = categoryRecordIds
                .map(id => state.records.all.find(record => record.id === id && record.fields['Item Type'] === 'Grouping' && !record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]))
                .filter(Boolean);

            categories.sort((a, b) => (a.fields.Name || '').localeCompare(b.fields.Name || ''));

            categories.forEach((catRecord) => {
                const button = document.createElement('button');
                button.className = 'filter-btn category-filter-btn';
                button.dataset.filter = catRecord.fields.Name.toLowerCase();
                button.textContent = catRecord.fields.Name;
                categoryFiltersContainer.appendChild(button);
            });
        }
    } 
    // --- END CONSOLIDATED BUTTON GENERATION --

    const toggleFilter = (elementId, settingName) => {
        const container = document.getElementById(elementId)?.parentElement;
        if (container) {
            container.style.display = shopSettings.enabledFilters.includes(settingName) ? 'flex' : 'none';
        }
    };

    toggleFilter('subcategory-filters', 'Subcategories');
    toggleFilter('date-filter-group', 'Date & Time');
    toggleFilter('headcount-filter', 'Headcount');
    toggleFilter('location-filter', 'Location');
    toggleFilter('budget-filter', 'Budget');

    safeAddEventListener('category-filters', 'click', (e) => {
        const planFilterBtn = document.getElementById('plan-filter-btn');
        const likesFilterBtn = document.getElementById('liked-items-filter-btn');
        const clickedBtn = e.target.closest('.filter-btn');

        if (!clickedBtn || !categoryFiltersContainer) return; 

        const isPlanFilterClick = clickedBtn.id === 'plan-filter-btn';
        const isLikesFilterClick = clickedBtn.id === 'liked-items-filter-btn';

        categoryFiltersContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
        clickedBtn.classList.add('active');

        if (isPlanFilterClick) {
            updateUrl({ category: null, subcategory: null, view: 'plan' });
            updateSubcategoryButtons();
        } else if (isLikesFilterClick) {
            updateUrl({ category: null, subcategory: null, view: 'likes' });
            updateSubcategoryButtons();
        } else {
            const newCategory = clickedBtn.dataset.filter === 'all' ? null : clickedBtn.dataset.filter;
            updateUrl({ category: newCategory, subcategory: null, view: null });
            updateSubcategoryButtons();
        }

        applyFiltersAndSort(imageCache);
    });

    safeAddEventListener('subcategory-filters', 'click', (e) => {
        if (e.target.classList.contains('subcategory-filter-btn')) {
            e.target.classList.toggle('active');
            const activeSubcats = Array.from(document.querySelectorAll('#subcategory-filters .filter-btn.active'))
                                     .map(btn => btn.dataset.filter);
            updateUrl({ subcategory: activeSubcats.join(',') || null });
            applyFiltersAndSort(imageCache);
        }
    });

    safeAddEventListener('status-filter', 'change', () => applyFiltersAndSort(imageCache));
    
    // --- THIS IS THE MODIFIED LISTENER (V2.1) ---
    safeAddEventListener('name-filter', 'input', debounce((e) => {
        const searchTerm = e.target.value.trim();
        
        if (aiSearchController) {
            aiSearchController.abort(); // Cancel any pending AI search
        }
        
        // --- V2.1: ALWAYS apply filters (sort will handle the search) ---
        applyFiltersAndSort(imageCache);
        // --- END V2.1 ---
        
        // This is the trigger
        if (state.records.filtered.length === 0 && searchTerm.length > 2) {
            log('Events', 'No local results, triggering proactive AI search.');
            
            // Check if any other filters are active
            const hasOtherFilters = 
                document.getElementById('status-filter').value !== 'Available' ||
                document.getElementById('headcount-filter').value !== 'any' ||
                document.getElementById('location-filter').value !== 'any' ||
                document.getElementById('budget-filter').value !== 'any' ||
                document.querySelector('#category-filters .filter-btn:not([data-filter=\"all\"]).active') ||
                document.querySelector('#subcategory-filters .filter-btn.active');
            
            if (!hasOtherFilters) {
                // Only run AI search if *only* the name filter is active
                handleProactiveAISearch(searchTerm, imageCache);
            }
        }
    }, 300)); // 300ms debounce
    // --- END MODIFICATION --
    
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
        const allButton = categoryFiltersContainer?.querySelector('.category-filter-btn[data-filter=\"all\"]');
        if (allButton) {
            categoryFiltersContainer?.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
            allButton.classList.add('active');
        }
        updateSubcategoryButtons();
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

    mainDatePicker = flatpickr("#date-filter", {
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

    safeAddEventListener('date-filter-group', 'click', (e) => {
        const quickButton = e.target.closest('[data-date-quick]');
        if (!quickButton || !mainDatePicker) return;
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
        if (state.ui.isInitializing) return;
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
    });
    // --- V2.1: APPLY FILTERS ON GOAL CHANGE ---
    safeAddEventListener('header-goals', 'change', (e) => {
        if (state.ui.isInitializing) return;
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
        // Re-apply filters if "Recommended" sort is active
        if (document.getElementById('sort-by').value === 'recommended') {
            applyFiltersAndSort(imageCache);
        }
    });
    // --- END V2.1 ---

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

        // --- ADD THIS NEW \"ELSE IF\" BLOCK ---\
        const healthSuggestionBtn = e.target.closest('.health-suggestion-btn');

        if (healthSuggestionBtn) {
            e.stopPropagation();
            const categoryToFilter = healthSuggestionBtn.dataset.categoryFilter;
            
            log('Events', `Health suggestion clicked. Filtering for: ${categoryToFilter}`);
            
            // Find the matching category button in the filter list
            const categoryButton = document.querySelector(`#category-filters .filter-btn[data-filter=\"${categoryToFilter}\"]`);
            
            if (categoryButton) {
                // Programmatically click the button
                categoryButton.click(); 
            }
            
            // Scroll to the top of the catalog to show the results
            document.getElementById('catalog-area')?.scrollIntoView({ behavior: 'smooth' });
        }
        // --- END NEW BLOCK ---\

        if (saveShareBtn) {
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
            const targetButton = document.querySelector(`#category-filters .filter-btn[data-filter=\"${filterValue}\"]`);
            if (targetButton) {
                targetButton.click();
            }
        } else if (checkoutBtn) {
            ui.showCheckoutModal(shopSettings);
        } else if (rsvpBtn) {
            e.stopPropagation();
            if (!state.session.user.isAuthenticated) {
                showUserModal();
                return;
            }
            const cardEl = rsvpBtn.closest('.event-card');
            const recordId = cardEl?.dataset.recordId;
            if (!recordId) return;

            rsvpBtn.disabled = true;
            rsvpBtn.textContent = 'Saving...';
            try {
                const updatedRecord = await api.addRsvpToEvent(recordId, state.session.user.id);
                if (updatedRecord) {
                    rsvpBtn.textContent = "You're Going! ✅";
                    const recordIndex = state.records.all.findIndex(r => r.id === recordId);
                    if (recordIndex > -1) state.records.all[recordIndex] = updatedRecord;
                } else {
                    throw new Error('RSVP update failed.');
                }
            } catch (error) {
                console.error("RSVP Error:", error);
                ui.showToast(`RSVP Error: ${error.message}`);
                rsvpBtn.textContent = 'Error!';
                setTimeout(() => {
                    rsvpBtn.textContent = 'RSVP';
                    rsvpBtn.disabled = false;
                }, 2000);
            }
        } else if (presentBtn) {
            const listType = presentBtn.dataset.listType;
            updateUrl({ view: 'present' });
            ui.showPresentationView(listType);
        } else if (carouselNav) {
            const carousel = document.getElementById('ideas-carousel'); // Changed ID from favorites-carousel
            if (carousel) {
                const scrollAmount = 300;
                const direction = carouselNav.classList.contains('right') ? 1 : -1;
                carousel.scrollBy({ left: scrollAmount * direction, behavior: 'smooth' });
            }
        } else if (parentLink) {
            e.stopPropagation();
            const parentName = parentLink.dataset.parentName;
            if (parentName) {
                const targetButton = [...document.querySelectorAll('#category-filters .filter-btn, #subcategory-filters .filter-btn')]
                                     .find(btn => btn.textContent === parentName);
                if (targetButton) {
                    const isCategory = !!targetButton.closest('#category-filters');
                    if (isCategory) {
                        targetButton.click();
                    } else {
                        document.querySelectorAll('#subcategory-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
                        targetButton.classList.add('active');
                        updateUrl({ subcategory: targetButton.dataset.filter });
                        applyFiltersAndSort(imageCache);
                    }
                    if (document.getElementById('detail-modal-overlay')?.classList.contains('active')) {
                        updateUrl({ openItem: null });
                        ui.hideDetailModal();
                    }
                }
            }
    // --- CORRECTLY PLACED HEART ICON LOGIC --
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
                     console.log(`[Events] Re-enabled pointer events for heart icon ${recordId}.`);
                }
            } else {
                 console.log('[Events] User is logged out. Handling temporary like.');
                log('Events', `Guest toggling temporary like for item ${recordId}.`);
                let tempLikes = [];
                try {
                    tempLikes = JSON.parse(localStorage.getItem('tempLikes') || '[]');
                } catch (e) {
                     console.error('Error parsing tempLikes from localStorage:', e);
                     localStorage.removeItem('tempLikes'); tempLikes = [];
                }
                const tempLikesSet = new Set(tempLikes);
                let currentlyLiked = false;
                if (tempLikesSet.has(recordId)) {
                    tempLikesSet.delete(recordId); currentlyLiked = false;
                     console.log(`[Events] Removed ${recordId} from temporary likes.`);
                } else {
                    tempLikesSet.add(recordId); currentlyLiked = true;
                     console.log(`[Events] Added ${recordId} to temporary likes.`);
                }
                localStorage.setItem('tempLikes', JSON.stringify(Array.from(tempLikesSet)));
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
        // --- END HEART ICON LOGIC --
        
        else if (addToPlanBtn) {
            e.stopPropagation();
            const recordId = addToPlanBtn.closest('[data-record-id]')?.dataset.recordId;
            if (!recordId) return;

            addEnergy();

            if (state.cart.lockedItems.has(recordId)) {
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

            state.cart.lockedItems.set(recordId, itemInfo);
            state.cart.items.delete(recordId);

            ui.updateCardIcon(recordId);
            await ui.updateIdeasCarousel();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            updateMobileBarAvailability();
            triggerSave();
        } else if (demoteBtn) {
            e.stopPropagation();
            const recordId = demoteBtn.closest('[data-record-id]')?.dataset.recordId;
            if (!recordId || !state.cart.lockedItems.has(recordId)) return;

            const itemInfo = state.cart.lockedItems.get(recordId);
            state.cart.lockedItems.delete(recordId);
            state.cart.items.set(recordId, itemInfo);

            ui.updateCardIcon(recordId);
            await ui.updateEventPlanSection();
            await ui.updateIdeasCarousel();
            ui.updateTotalCost();
            updateMobileBarAvailability();
            triggerSave();
        } else if (removeIdeaBtn && e.target === removeIdeaBtn) {
            e.stopPropagation();
            const recordId = ideaItem.dataset.recordId;
            if (!recordId || !state.cart.items.has(recordId)) return;

            state.cart.items.delete(recordId);

            await ui.updateIdeasCarousel();
            triggerSave();
        } else if (card && !e.target.closest('.quantity-selector, .heart-icon, .add-to-plan-btn')) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) return;
            
            // --- This check prevents clicking the \"ghost card\" ---\
            if (record.id.startsWith('ai-search-')) {
                return;
            }
            // --- End check ---\

            if (record.fields['Item Type'] === 'Grouping') {
                 const groupName = record.fields.Name;
                 const groupNameLower = groupName.toLowerCase();
                 const parentName = record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];

                 if (!parentName) {
                     updateUrl({ category: groupNameLower, subcategory: null, view: null });
                     if (categoryFiltersContainer) {
                         categoryFiltersContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                         categoryFiltersContainer.querySelector(`.filter-btn[data-filter=\"${groupNameLower}\"]`)?.classList.add('active');
                     }
                     updateSubcategoryButtons();
                 } else {
                     const parentNameLower = parentName.toLowerCase();
                     updateUrl({ category: parentNameLower, subcategory: groupNameLower, view: null });
                     if (categoryFiltersContainer) {
                         categoryFiltersContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                         categoryFiltersContainer.querySelector(`.filter-btn[data-filter=\"${parentNameLower}\"]`)?.classList.add('active');
                     }
                     updateSubcategoryButtons();
                     if (subcategoryFiltersContainer) {
                         subcategoryFiltersContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                         subcategoryFiltersContainer.querySelector(`.filter-btn[data-filter=\"${groupNameLower}\"]`)?.classList.add('active');
                     }
                 }
                 applyFiltersAndSort(imageCache);

            } else {
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
        let updates = {};
        if (target.matches('.quantity-input')) {
            updates.quantity = parseInt(target.value, 10);
        } else if (target.matches('#modal-item-note')) {
            updates.note = target.value;
        } else if (e.detail?.selectedOptionIndex !== undefined) {
             updates.selectedOptionIndex = e.detail.selectedOptionIndex;
        }
        if (Object.keys(updates).length > 0) {
            if (isLocked) {
                ui.updateLockedItemState(recordId, updates);
                ui.updateEventPlanSection();
                ui.updateTotalCost();
            } else {
                ui.updateItemState(recordId, updates);
            }
            triggerSave();
        }
    });
    const eventPlanDatePicker = flatpickr("#event-date-picker", {
        dateFormat: "M j, Y",
        onChange: async (selectedDates) => {
            if (state.ui.isInitializing) return;
            if (selectedDates.length > 0) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates[0].toISOString());
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
            }
            await ui.updateEventPlanDateDisplay();
            await ui.updateLockedItemStatusIcons();
            await updateMobileBarAvailability();
            triggerSave();
        }
    });
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
