// REPLACE THE ENTIRE CONTENTS of events.js

import { state, setState } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { applyFiltersAndSort } from './filtering.js';
import { log, setDebugMode } from './utils/debug.js';
import { AVAILABILITY_STATUS, getDayStatus, checkAvailability, getRangeStatus } from './availability.js';
import { debounce, updateUrl, loadFlatpickr, getTempLikes, setTempLikes, getEffectiveMinQuantity } from './utils.js';
import { sendMessage, initializeSessionChat, initializeRecentChatsListeners, updateCurrentSessionName, toggleRecentChats } from './chat.js';
import { showItineraryModal, setupItineraryEventListeners } from './components/itinerary.js';
import { updateMobileBarAvailability } from './ui.js';
import { showUserModal } from './auth.js';
import { addEnergy, updateProgress } from './components/backgroundEngine.js';
import { showReceiptModal } from './components/receipt.js';
import { showProjectsPanel, hideProjectsPanel } from './components/projectsDashboard.js';
import { initializeProjectSelector, wasLongPress, resetLongPress } from './components/projectSelector.js';
import { broadcastItemAdded, broadcastItemRemoved } from './utils/realtimeUpdates.js';

let mainDatePicker = null;
let saveTimeout = null;
let saveShareBtn = null;
let aiSearchController = null;

export function getMainDatePicker() {
    return mainDatePicker;
}

/**
 * Handler for when Union Machine Works is added to the plan
 * Adjusts all items back to their last attempted quantity (if below minimum)
 */
function handleUmwAddition() {
    let adjustedItems = [];

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        // Skip UMW itself
        if (record.fields.Name && record.fields.Name.includes("Union Machine Works")) continue;

        const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const lastAttempted = itemInfo.lastAttemptedQuantity || itemInfo.quantity;

        // If this item was forced to minimum and user wanted less, restore their original request
        if (airtableMin > 1 && itemInfo.quantity === airtableMin && lastAttempted < airtableMin) {
            itemInfo.quantity = lastAttempted;
            state.cart.lockedItems.set(recordId, itemInfo);
            adjustedItems.push(record.fields.Name);
        }
    }

    if (adjustedItems.length > 0) {
        ui.showEventPlanNotification(`Headcounts reduced to quantity requested per Union Machine Works inclusion in plan.`);
        // Update UI
        ui.updateEventPlanSection();
        ui.updateTotalCost();
    }
}

/**
 * Handler for when Union Machine Works is removed from the plan
 * Adjusts all items to meet minimum requirements
 */
function handleUmwRemoval() {
    let adjustedItems = [];

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;

        // If this item is now below minimum, adjust it
        if (airtableMin > 1 && itemInfo.quantity < airtableMin) {
            // Store current as last attempted before adjusting
            itemInfo.lastAttemptedQuantity = itemInfo.quantity;
            itemInfo.quantity = airtableMin;
            state.cart.lockedItems.set(recordId, itemInfo);
            adjustedItems.push(record.fields.Name);
        }
    }

    if (adjustedItems.length > 0) {
        ui.showEventPlanNotification(`Headcount adjusted to min per Union Machine Works removal.`);
        // Update UI
        ui.updateEventPlanSection();
        ui.updateTotalCost();
    }
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
                // Translate common Stripe errors to user-friendly messages
                let userMessage = error.message;
                if (error.code === 'card_declined') {
                    userMessage = "Your card was declined. Please try another payment method.";
                } else if (error.code === 'insufficient_funds') {
                    userMessage = "Insufficient funds. Please use a different card.";
                } else if (error.code === 'expired_card') {
                    userMessage = "Your card has expired. Please use a different card.";
                } else if (error.code === 'incorrect_cvc') {
                    userMessage = "The security code (CVC) is incorrect. Please check and try again.";
                } else if (error.code === 'processing_error') {
                    userMessage = "An error occurred while processing your card. Please try again.";
                }
                throw new Error(userMessage);
            } else {
                console.error('Stripe confirmPayment error:', error);
                throw new Error("An unexpected error occurred during payment. Please try again or contact support.");
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
    // DEBUG: Initial layout state on page load
    console.group('[DEBUG] Initial Layout State - Page Load');
    console.log('Window width:', window.innerWidth);
    console.log('Window height:', window.innerHeight);

    const mainContent = document.querySelector('.main-content');
    const searchBarContainer = document.getElementById('search-bar-container');
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');
    const catalogArea = document.getElementById('catalog-area');
    const filterControls = document.getElementById('filter-controls');

    console.log('\n=== DOM Element Order (in .main-content) ===');
    if (mainContent) {
        Array.from(mainContent.children).forEach((child, index) => {
            console.log(`  ${index}: #${child.id || 'no-id'} (tag: ${child.tagName})`);
        });
    }

    console.log('\n=== CSS Grid Layout ===');
    if (mainContent) {
        const mainStyles = getComputedStyle(mainContent);
        console.log('Main Content computed styles:', {
            display: mainStyles.display,
            gridTemplateColumns: mainStyles.gridTemplateColumns,
            gridTemplateRows: mainStyles.gridTemplateRows,
            gap: mainStyles.gap
        });
    }

    console.log('\n=== Search Bar Container ===');
    if (searchBarContainer) {
        const searchStyles = getComputedStyle(searchBarContainer);
        console.log('Search Bar Container:', {
            display: searchStyles.display,
            position: searchStyles.position,
            gridColumn: searchStyles.gridColumn,
            gridRow: searchStyles.gridRow,
            order: searchStyles.order,
            top: searchStyles.top,
            zIndex: searchStyles.zIndex
        });
    } else {
        console.warn('#search-bar-container NOT FOUND in DOM');
    }

    console.log('\n=== Left Sidebar (#left-sidebar) ===');
    if (leftSidebar) {
        const leftStyles = getComputedStyle(leftSidebar);
        console.log('Left Sidebar:', {
            display: leftStyles.display,
            position: leftStyles.position,
            gridColumn: leftStyles.gridColumn,
            gridRow: leftStyles.gridRow,
            order: leftStyles.order,
            maxHeight: leftStyles.maxHeight,
            opacity: leftStyles.opacity,
            classes: leftSidebar.className
        });
    }

    console.log('\n=== Right Sidebar (#right-sidebar) ===');
    if (rightSidebar) {
        const rightStyles = getComputedStyle(rightSidebar);
        console.log('Right Sidebar:', {
            display: rightStyles.display,
            position: rightStyles.position,
            gridColumn: rightStyles.gridColumn,
            gridRow: rightStyles.gridRow,
            order: rightStyles.order
        });
    }

    console.log('\n=== Catalog Area (#catalog-area) ===');
    if (catalogArea) {
        const catalogStyles = getComputedStyle(catalogArea);
        console.log('Catalog Area:', {
            display: catalogStyles.display,
            position: catalogStyles.position,
            gridColumn: catalogStyles.gridColumn,
            gridRow: catalogStyles.gridRow,
            order: catalogStyles.order
        });
    }

    console.log('\n=== Filter Controls (#filter-controls) ===');
    if (filterControls) {
        const filterStyles = getComputedStyle(filterControls);
        console.log('Filter Controls:', {
            display: filterStyles.display,
            position: filterStyles.position,
            width: filterStyles.width,
            height: filterStyles.height,
            parentElement: filterControls.parentElement?.id || 'no-parent-id'
        });
    }
    console.groupEnd();

    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) element.addEventListener(event, handler);
        else console.warn(`Element with ID "${selector}" not found.`);
    };

    if (window.innerWidth < 1000) {
        leftSidebar?.classList.add('collapsed');
        rightSidebar?.classList.add('collapsed');
    }

    // New filter toggle button handler (replaces old mobile-filter-trigger)
    const filterToggleBtn = document.getElementById('filter-toggle-btn');
    if (filterToggleBtn) {
        filterToggleBtn.addEventListener('click', () => {
            const isExpanded = filterToggleBtn.getAttribute('aria-expanded') === 'true';
            filterToggleBtn.setAttribute('aria-expanded', !isExpanded);
            leftSidebar?.classList.toggle('collapsed');

            // DEBUG: Log layout information when filter toggle is clicked
            console.group('[DEBUG] Filter Toggle Layout Info');
            console.log('Window width:', window.innerWidth);
            console.log('Filter toggle aria-expanded:', !isExpanded);
            console.log('Left sidebar collapsed:', leftSidebar?.classList.contains('collapsed'));

            // Log computed styles for key elements
            const mainContent = document.querySelector('.main-content');
            const searchBarContainer = document.getElementById('search-bar-container');
            const filterControls = document.getElementById('filter-controls');
            const catalogArea = document.getElementById('catalog-area');

            if (mainContent) {
                const mainStyles = getComputedStyle(mainContent);
                console.log('Main Content:', {
                    display: mainStyles.display,
                    gridTemplateColumns: mainStyles.gridTemplateColumns,
                    gridTemplateRows: mainStyles.gridTemplateRows,
                    gap: mainStyles.gap
                });
            }

            if (searchBarContainer) {
                const searchStyles = getComputedStyle(searchBarContainer);
                console.log('Search Bar Container:', {
                    position: searchStyles.position,
                    top: searchStyles.top,
                    gridColumn: searchStyles.gridColumn,
                    order: searchStyles.order,
                    display: searchStyles.display
                });
            }

            if (leftSidebar) {
                const leftStyles = getComputedStyle(leftSidebar);
                console.log('Left Sidebar:', {
                    display: leftStyles.display,
                    maxHeight: leftStyles.maxHeight,
                    opacity: leftStyles.opacity,
                    order: leftStyles.order,
                    gridColumn: leftStyles.gridColumn
                });
            }

            if (filterControls) {
                const filterStyles = getComputedStyle(filterControls);
                console.log('Filter Controls:', {
                    display: filterStyles.display,
                    position: filterStyles.position,
                    width: filterStyles.width,
                    height: filterStyles.height
                });
            }

            if (catalogArea) {
                const catalogStyles = getComputedStyle(catalogArea);
                console.log('Catalog Area:', {
                    order: catalogStyles.order,
                    gridColumn: catalogStyles.gridColumn,
                    width: catalogStyles.width
                });
            }

            // Log DOM order
            console.log('DOM Order of children in .main-content:');
            mainContent?.childNodes.forEach((child, index) => {
                if (child.nodeType === 1) { // Element nodes only
                    console.log(`  ${index}: #${child.id || 'no-id'} (${child.className})`);
                }
            });
            console.groupEnd();
        });
    }

    // Show/hide clear search button based on input value
    const nameFilterInput = document.getElementById('name-filter');
    const clearSearchBtn = document.getElementById('clear-search-btn');
    if (nameFilterInput && clearSearchBtn) {
        nameFilterInput.addEventListener('input', () => {
            clearSearchBtn.style.display = nameFilterInput.value.trim() ? 'block' : 'none';
        });
        // Initialize visibility on page load
        clearSearchBtn.style.display = nameFilterInput.value.trim() ? 'block' : 'none';
    }

    // Legacy mobile-filter-trigger (kept for backwards compatibility)
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
    // Passive event listener for better scroll performance
    window.addEventListener('scroll', () => {
        if (scrollTimeout) return;
        scrollTimeout = setTimeout(() => {
            const buffer = 300;
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - buffer && !state.ui.isLoadingMore) {
                loadMoreRecords(imageCache);
            }
            scrollTimeout = null;
        }, 100);
    }, { passive: true });

    // --- START CONSOLIDATED BUTTON GENERATION --
    const categoryFiltersRoot = document.getElementById('category-filters');
    if (categoryFiltersRoot) {
        const activeShop = state.stores.all.find(s => s.id === state.ui.activeShopId);
        const hasStoreCategories = activeShop && activeShop.fields && activeShop.fields.Items && activeShop.fields.Items.length > 0;

        if (hasStoreCategories) {
            const itemRecordIds = Array.isArray(activeShop.fields.Items)
                ? activeShop.fields.Items
                : activeShop.fields.Items.split(',').map(id => id.trim());
            
            let firstCategoryButton = true;
            itemRecordIds.forEach(recordId => {
                if (!recordId.startsWith('rec')) return;
                
                const categoryRecord = state.records.all.find(r => r.id === recordId);
                if (categoryRecord && categoryRecord.fields && categoryRecord.fields.Name) {
                    const categoryName = categoryRecord.fields.Name;
                    const categoryBtn = document.createElement('button');
                    categoryBtn.className = 'filter-btn category-filter-btn';
                    const normalizedCategoryName = categoryName.toLowerCase().replace(/\s+/g, ' ');
                    categoryBtn.dataset.filter = normalizedCategoryName;
                    categoryBtn.textContent = categoryName;

                    if (firstCategoryButton) {
                        categoryBtn.classList.add('active');
                        firstCategoryButton = false;
                    }

                    categoryBtn.addEventListener('click', () => {
                        document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
                        categoryBtn.classList.add('active');
                        updateUrl({ category: normalizedCategoryName, subcategory: null, view: null });
                        applyFiltersAndSort(imageCache);
                    });
                    categoryFiltersRoot.appendChild(categoryBtn);
                }
            });
        } else {
            const allButton = document.createElement('button');
            allButton.className = 'filter-btn category-filter-btn active';
            allButton.dataset.filter = 'all';
            allButton.textContent = 'All';
            allButton.addEventListener('click', () => {
                document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
                allButton.classList.add('active');
                updateUrl({ category: null, subcategory: null, view: null });
                applyFiltersAndSort(imageCache);
            });
            categoryFiltersRoot.appendChild(allButton);
        }

    }  else {
        console.warn("Could not find #category-filters container to add category buttons.");
    }
    // --- END CONSOLIDATED BUTTON GENERATION --

    // --- START HAMBURGER MENU NAVIGATION BUTTONS ---
    const hamburgerMenuBtn = document.getElementById('hamburger-menu-btn');
    const hamburgerMenuDropdown = document.getElementById('hamburger-menu-dropdown');
    const menuCatalogBtn = document.getElementById('menu-catalog-btn');
    const menuPlanBtn = document.getElementById('menu-plan-btn');
    const menuLikesBtn = document.getElementById('menu-likes-btn');
    const menuSessionsBtn = document.getElementById('menu-sessions-btn');

    // Toggle hamburger dropdown on button click
    if (hamburgerMenuBtn && hamburgerMenuDropdown) {
        hamburgerMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = hamburgerMenuDropdown.style.display === 'block';
            hamburgerMenuDropdown.style.display = isVisible ? 'none' : 'block';
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!hamburgerMenuBtn.contains(e.target) && !hamburgerMenuDropdown.contains(e.target)) {
                hamburgerMenuDropdown.style.display = 'none';
            }
        });
    }

    if (menuCatalogBtn) {
        menuCatalogBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            updateUrl({ category: null, subcategory: null, view: null });
            applyFiltersAndSort(imageCache);
        });
    }

    if (menuPlanBtn) {
        menuPlanBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            updateUrl({ category: null, subcategory: null, view: 'plan' });
            applyFiltersAndSort(imageCache);
        });
    }

    if (menuLikesBtn) {
        menuLikesBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            updateUrl({ category: null, subcategory: null, view: 'likes' });
            applyFiltersAndSort(imageCache);
        });
    }

    if (menuSessionsBtn) {
        menuSessionsBtn.style.display = state.session.user.isAuthenticated ? 'flex' : 'none';
        menuSessionsBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            if (!state.session.user.isAuthenticated) {
                showUserModal();
                return;
            }
            updateUrl({ category: null, subcategory: null, view: 'my-sessions' });
            applyFiltersAndSort(imageCache);
        });
    }

    // My Projects button handler
    const menuProjectsBtn = document.getElementById('menu-projects-btn');
    if (menuProjectsBtn) {
        menuProjectsBtn.style.display = state.session.user.isAuthenticated ? 'flex' : 'none';
        menuProjectsBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            if (!state.session.user.isAuthenticated) {
                showUserModal();
                return;
            }
            // Show the projects panel
            showProjectsPanel();
        });
    }

    // Quick Plan button handler - opens the quick plan modal
    const quickPlanBtn = document.getElementById('quick-plan-btn');
    const quickPlanModalOverlay = document.getElementById('quick-plan-modal-overlay');
    const quickPlanCloseBtn = document.getElementById('quick-plan-close-btn');
    const quickPlanIdeaInput = document.getElementById('quick-plan-idea-input');
    const quickPlanSubmitBtn = document.getElementById('quick-plan-submit-btn');
    const quickPlanError = document.getElementById('quick-plan-error');

    if (quickPlanBtn && quickPlanModalOverlay) {
        quickPlanBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            quickPlanModalOverlay.classList.add('active');
            if (quickPlanIdeaInput) {
                quickPlanIdeaInput.value = '';
                quickPlanIdeaInput.focus();
            }
            if (quickPlanError) {
                quickPlanError.style.display = 'none';
            }
        });
    }

    // Close quick plan modal
    if (quickPlanCloseBtn && quickPlanModalOverlay) {
        quickPlanCloseBtn.addEventListener('click', () => {
            quickPlanModalOverlay.classList.remove('active');
        });
    }

    // Close quick plan modal when clicking outside
    if (quickPlanModalOverlay) {
        quickPlanModalOverlay.addEventListener('click', (e) => {
            if (e.target === quickPlanModalOverlay) {
                quickPlanModalOverlay.classList.remove('active');
            }
        });
    }

    // Quick Plan form submission
    if (quickPlanSubmitBtn && quickPlanIdeaInput && quickPlanModalOverlay) {
        quickPlanSubmitBtn.addEventListener('click', async () => {
            const idea = quickPlanIdeaInput.value.trim();

            // Debug: Log quick plan submission start
            if (window.debugLog) {
                window.debugLog('[QUICK-PLAN] Starting quick plan submission', { ideaLength: idea.length, ideaPreview: idea.substring(0, 50) }, 'info');
            }

            if (!idea) {
                if (window.debugLog) {
                    window.debugLog('[QUICK-PLAN] Validation failed: empty idea', null, 'error');
                }
                if (quickPlanError) {
                    quickPlanError.textContent = 'Please enter a plan idea.';
                    quickPlanError.style.display = 'block';
                }
                return;
            }

            // Hide error and show loading state
            if (quickPlanError) {
                quickPlanError.style.display = 'none';
            }
            quickPlanSubmitBtn.classList.add('loading');
            quickPlanSubmitBtn.disabled = true;

            if (window.debugLog) {
                window.debugLog('[QUICK-PLAN] Calling /api/create-quick-plan...', { idea: idea }, 'info');
            }

            try {
                const response = await fetch('/api/create-quick-plan', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ idea: idea })
                });

                if (window.debugLog) {
                    window.debugLog('[QUICK-PLAN] API response received', { status: response.status, ok: response.ok }, 'info');
                }

                const result = await response.json();

                if (window.debugLog) {
                    window.debugLog('[QUICK-PLAN] API response parsed', {
                        success: result.success,
                        newPlanId: result.newPlanId,
                        error: result.error || null
                    }, result.success ? 'success' : 'error');
                }

                if (!response.ok || !result.success) {
                    throw new Error(result.error || 'Failed to create plan');
                }

                // Success - close modal and navigate to the new plan
                quickPlanModalOverlay.classList.remove('active');
                quickPlanIdeaInput.value = '';

                // Navigate to the new plan using URL parameters
                if (result.newPlanId) {
                    if (window.debugLog) {
                        window.debugLog('[QUICK-PLAN] Navigating to new plan', { planId: result.newPlanId }, 'success');
                    }
                    updateUrl({ category: null, subcategory: null, view: 'plan', session: result.newPlanId });
                    applyFiltersAndSort(imageCache);

                    // Debug: Start polling for enrichment results
                    if (window.debugLog) {
                        window.debugLog('[QUICK-PLAN] Plan created - background enrichment triggered. Watch for AI enrichment results...', null, 'info');
                        // Poll for enrichment completion by watching for plan data updates
                        startQuickPlanEnrichmentPolling(result.newPlanId);
                    }
                }
            } catch (error) {
                console.error('Quick Plan error:', error);
                if (window.debugLog) {
                    window.debugLog('[QUICK-PLAN] Error creating plan', { error: error.message }, 'error');
                }
                if (quickPlanError) {
                    quickPlanError.textContent = error.message || 'Something went wrong. Please try again.';
                    quickPlanError.style.display = 'block';
                }
            } finally {
                quickPlanSubmitBtn.classList.remove('loading');
                quickPlanSubmitBtn.disabled = false;
            }
        });

        // Allow Enter key to submit (Shift+Enter for new line)
        quickPlanIdeaInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                quickPlanSubmitBtn.click();
            }
        });
    }

    /**
     * Poll for enrichment results after quick plan creation
     * This helps debug whether the AI enrichment is completing successfully
     * @param {string} planId - The new plan ID to poll for
     */
    window.startQuickPlanEnrichmentPolling = async function(planId) {
        if (!window.debugLog) return;

        window.debugLog('[QUICK-PLAN] Starting enrichment polling', { planId }, 'info');

        let attempts = 0;
        const maxAttempts = 15; // Poll for up to 30 seconds
        const pollInterval = 2000; // Poll every 2 seconds

        const poll = async () => {
            attempts++;
            window.debugLog(`[QUICK-PLAN] Enrichment poll attempt ${attempts}/${maxAttempts}`, { planId }, 'info');

            try {
                const response = await fetch(`/api/get-project?id=${planId}`);
                if (response.ok) {
                    const project = await response.json();

                    // Check if enrichment fields are populated (AI sets Plan_Type, Date, Goals, etc.)
                    const hasEnrichment = project.Plan_Type ||
                                          project.Date ||
                                          project['Guest Count'] ||
                                          project.Location ||
                                          (project.Goals && project.Goals !== project.Name);

                    window.debugLog('[QUICK-PLAN] Project data fetched', {
                        name: project.Name,
                        planType: project.Plan_Type || '(not set)',
                        date: project.Date || '(not set)',
                        goals: project.Goals ? project.Goals.substring(0, 100) : '(not set)',
                        guestCount: project['Guest Count'] || '(not set)',
                        location: project.Location || '(not set)',
                        hasEnrichment
                    }, hasEnrichment ? 'success' : 'data');

                    if (hasEnrichment) {
                        window.debugLog('[QUICK-PLAN] AI Enrichment completed!', {
                            extractedFields: {
                                name: project.Name,
                                type: project.Plan_Type,
                                date: project.Date,
                                goals: project.Goals,
                                guestCount: project['Guest Count'],
                                location: project.Location
                            }
                        }, 'success');
                        return; // Stop polling
                    }

                    if (attempts >= maxAttempts) {
                        window.debugLog('[QUICK-PLAN] Max polling attempts reached - enrichment may still be in progress or failed', null, 'error');
                        return; // Stop polling
                    }

                    // Continue polling
                    setTimeout(poll, pollInterval);
                } else {
                    window.debugLog('[QUICK-PLAN] Project fetch failed', { status: response.status }, 'error');
                    if (attempts < maxAttempts) {
                        setTimeout(poll, pollInterval);
                    }
                }
            } catch (error) {
                window.debugLog('[QUICK-PLAN] Enrichment poll error', { error: error.message }, 'error');
                if (attempts < maxAttempts) {
                    setTimeout(poll, pollInterval);
                }
            }
        };

        // Start polling after a short delay to give the backend time to start enrichment
        setTimeout(poll, 1500);
    };

    const menuRecentChatsBtn = document.getElementById('menu-recent-chats-btn');
    if (menuRecentChatsBtn) {
        menuRecentChatsBtn.addEventListener('click', () => {
            hamburgerMenuDropdown.style.display = 'none';
            // Open the chat widget and expand the recent chats dropdown
            openChatWidget(true);
            // Use setTimeout to ensure the chat widget is visible before toggling
            setTimeout(() => {
                toggleRecentChats(true);
            }, 100);
        });
    }
    // --- END HAMBURGER MENU NAVIGATION BUTTONS ---

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
        const initializeDatePicker = async () => {
            if (!mainDatePicker) {
                try {
                    log('Events', 'Loading Flatpickr dynamically...');
                    await loadFlatpickr();
                    
                    if (!window.flatpickr) {
                        throw new Error('Flatpickr not available after loading');
                    }
                    
                    if (typeof window.flatpickr !== 'function') {
                        throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
                    }
                    
                    mainDatePicker = window.flatpickr(dateFilterInput, {
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
                    
                    // Store the flatpickr instance on the input element
                    dateFilterInput._flatpickr = mainDatePicker;
                    
                    // Open the calendar after initialization
                    mainDatePicker.open();
                    
                    log('Events', 'Date filter picker initialized successfully');
                } catch (error) {
                    log('Events', `Error initializing date picker: ${error.message}`);
                    console.error('Flatpickr initialization error:', error);
                }
            } else {
                // If already initialized, just open it
                mainDatePicker.open();
            }
        };
        
        dateFilterInput.addEventListener('focus', initializeDatePicker);
    }

    safeAddEventListener('date-filter-group', 'click', async (e) => {
        const quickButton = e.target.closest('[data-date-quick]');
        if (!quickButton) return;
        
        const dateFilterInput = document.getElementById('date-filter');
        if (!dateFilterInput) return;
        
        if (!mainDatePicker) {
            try {
                log('Events', 'Loading Flatpickr for quick select button...');
                await loadFlatpickr();
                
                if (!window.flatpickr) {
                    throw new Error('Flatpickr not available after loading');
                }
                
                if (typeof window.flatpickr !== 'function') {
                    throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
                }
                
                mainDatePicker = window.flatpickr(dateFilterInput, {
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
                
                // Store the flatpickr instance on the input element
                dateFilterInput._flatpickr = mainDatePicker;
                
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
        if (state.ui.isInitializing) return;
        const hadValue = state.eventDetails.combined.has(CONSTANTS.DETAIL_TYPES.EVENT_NAME);
        const newValue = e.target.value.trim();
        if (newValue && !hadValue) {
            updateProgress(0.0001); // Adding event name progresses
        } else if (!newValue && hadValue) {
            updateProgress(-0.0001); // Removing event name regresses
        }
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);

        // Update the plan name in the recent chats list
        updateCurrentSessionName(e.target.value);

        triggerSave();
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
        const receiptLink = e.target.closest('.receipt-link, .receipt-btn');
        const openToEditBtn = e.target.closest('.open-to-edit-btn');
        const editEventBtn = e.target.closest('.edit-event-btn');
        const addPackageBtn = e.target.closest('.add-package-btn');

        const healthSuggestionBtn = e.target.closest('.health-suggestion-btn');

        // Handle "Add Package to Plan" button - Decision 6: populate locked items and ideas
        if (addPackageBtn) {
            e.stopPropagation();
            const recordId = addPackageBtn.dataset.recordId || addPackageBtn.closest('[data-record-id]')?.dataset.recordId;
            if (!recordId) return;

            addEnergy();

            const packageRecord = state.records.all.find(r => r.id === recordId);
            if (!packageRecord || packageRecord.fields['Item Type'] !== 'Package') {
                ui.showToast('Package not found');
                return;
            }

            // Fetch package contents from linked session
            let packageContents = { includedItems: [], addOnItems: [], tiers: [] };
            const linkedSessionId = packageRecord.fields['LinkedSession'] ? packageRecord.fields['LinkedSession'][0] : null;

            if (linkedSessionId) {
                try {
                    const linkedSession = await api.fetchSessionById(linkedSessionId);
                    if (linkedSession && linkedSession.fields['Items with Variations']) {
                        const sessionData = JSON.parse(linkedSession.fields['Items with Variations']);

                        // Extract locked items as included items
                        const includedItems = [];
                        for (const [id, info] of Object.entries(sessionData.lockedInItems || {})) {
                            includedItems.push({
                                id,
                                quantity: info.quantity || 1,
                                options: info.selections || null,
                                locked: true
                            });
                        }

                        // Extract ideas as add-on items
                        const addOnItems = [];
                        for (const [id, info] of Object.entries(sessionData.ideasItems || {})) {
                            addOnItems.push({
                                id,
                                quantity: info.quantity || 1,
                                options: info.selections || null
                            });
                        }

                        packageContents = {
                            includedItems,
                            addOnItems,
                            tiers: sessionData.packageMetadata?.tiers || []
                        };
                    }
                } catch (e) {
                    console.warn('[Events] Could not fetch linked session for package', recordId, e);
                }
            }

            const includedItems = packageContents.includedItems || [];
            const addOnItems = packageContents.addOnItems || [];

            // Get selected tier if any
            const packageCard = addPackageBtn.closest('.package-card');
            const selectedTierBtn = packageCard?.querySelector('.tier-btn.selected');
            const selectedTierIndex = selectedTierBtn ? parseInt(selectedTierBtn.dataset.tierIndex, 10) : 0;

            log('Events', `Adding package ${packageRecord.fields.Name} to plan`);
            log('Events', `Package has ${includedItems.length} included items and ${addOnItems.length} add-ons`);

            // Add all included items to lockedItems (Event Plan)
            let addedCount = 0;
            for (const itemRef of includedItems) {
                const itemId = itemRef.id || itemRef;
                const itemRecord = state.records.all.find(r => r.id === itemId);

                if (itemRecord && !state.cart.lockedItems.has(itemId)) {
                    const itemInfo = {
                        quantity: itemRef.quantity || 1,
                        selectedOptionIndex: itemRef.options?.group0 || 0,
                        selections: itemRef.options || {},
                        note: `From package: ${packageRecord.fields.Name}`,
                        packageId: recordId,
                        packageLocked: itemRef.locked !== false // Locked items from package
                    };

                    // Enforce effective minimum quantity
                    const effectiveMin = getEffectiveMinQuantity(itemRecord);
                    if (itemInfo.quantity < effectiveMin) {
                        itemInfo.quantity = effectiveMin;
                    }

                    state.cart.lockedItems.set(itemId, itemInfo);
                    state.cart.items.delete(itemId); // Remove from ideas if present
                    addedCount++;
                    log('Events', `Added included item ${itemRecord.fields.Name} to locked items`);
                }
            }

            // Add all add-on items to ideas (Save for Later section)
            let addOnCount = 0;
            for (const itemRef of addOnItems) {
                const itemId = itemRef.id || itemRef;
                const itemRecord = state.records.all.find(r => r.id === itemId);

                if (itemRecord && !state.cart.lockedItems.has(itemId) && !state.cart.items.has(itemId)) {
                    const itemInfo = {
                        quantity: itemRef.quantity || 1,
                        selectedOptionIndex: itemRef.options?.group0 || 0,
                        selections: itemRef.options || {},
                        note: `Add-on from package: ${packageRecord.fields.Name}`,
                        packageId: recordId,
                        isPackageAddOn: true
                    };

                    state.cart.items.set(itemId, itemInfo);
                    addOnCount++;
                    log('Events', `Added add-on item ${itemRecord.fields.Name} to ideas`);
                }
            }

            // Store package metadata in session for reference
            if (!state.session.activePackages) {
                state.session.activePackages = new Map();
            }
            state.session.activePackages.set(recordId, {
                name: packageRecord.fields.Name,
                tierIndex: selectedTierIndex,
                addedAt: new Date().toISOString()
            });

            // Update progress
            const progressDelta = 0.0005 * (addedCount + addOnCount);
            updateProgress(progressDelta);

            // Update all UI
            ui.updateCardIcon(recordId);
            await ui.updateIdeasCarousel();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            await updateAllCardAvailabilityIcons();
            await ui.updateLockedItemStatusIcons();
            updateMobileBarAvailability();

            // Show success notification
            const notification = `Added package "${packageRecord.fields.Name}": ${addedCount} items to plan` +
                (addOnCount > 0 ? `, ${addOnCount} add-ons available in Ideas` : '');
            ui.showEventPlanNotification(notification);

            triggerSave();
            return;
        }

        // Handle "Edit Event" button for events that already have a linked session
        if (editEventBtn) {
            e.stopPropagation();
            const sessionId = editEventBtn.dataset.sessionId;
            if (!sessionId) {
                ui.showToast('Session not found');
                return;
            }

            log('Events', `Navigating to edit existing session ${sessionId}`);
            const currentShopId = state.ui.activeShopId;
            window.location.href = `${window.location.pathname}?session=${sessionId}&shopId=${currentShopId}`;
            return;
        }

        // Handle "Open to Edit" button for unaffiliated events
        if (openToEditBtn) {
            e.stopPropagation();
            const eventId = openToEditBtn.dataset.eventId;
            if (!eventId) return;

            const eventRecord = state.records.all.find(r => r.id === eventId);
            if (!eventRecord) {
                ui.showToast('Event not found');
                return;
            }

            // Show loading state
            openToEditBtn.disabled = true;
            const originalText = openToEditBtn.textContent;
            openToEditBtn.textContent = 'Creating Plan...';

            try {
                // Create a new session from this event
                const newSession = await api.createSessionFromEvent(
                    eventId,
                    eventRecord,
                    state.ui.activeShopId,
                    state.session.user.id
                );

                if (newSession && newSession.id) {
                    log('Events', `Created session ${newSession.id} from event ${eventId}, redirecting...`);

                    // Update the event record locally to reflect the new linked session
                    eventRecord.fields.LinkedSession = [newSession.id];

                    // Redirect to the new session for editing
                    const currentShopId = state.ui.activeShopId;
                    window.location.href = `${window.location.pathname}?session=${newSession.id}&shopId=${currentShopId}`;
                } else {
                    throw new Error('Failed to create session');
                }
            } catch (error) {
                console.error('Error creating session from event:', error);
                ui.showToast(`Error: ${error.message}`);
                openToEditBtn.disabled = false;
                openToEditBtn.textContent = originalText;
            }
            return;
        }

        if (receiptLink) {
            e.preventDefault();
            e.stopPropagation();
            const paymentIndex = parseInt(receiptLink.dataset.paymentIndex, 10);
            if (!isNaN(paymentIndex)) {
                showReceiptModal(paymentIndex);
            }
        } else if (healthSuggestionBtn) {
            e.stopPropagation();
            const categoryToFilter = healthSuggestionBtn.dataset.categoryFilter;
            const normalizedCategory = categoryToFilter.toLowerCase().replace(/\s+/g, ' ');
            
            log('Events', `Health suggestion clicked. Filtering for: ${categoryToFilter}`);
            
            updateUrl({ category: normalizedCategory, subcategory: null, view: null });
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
                const normalizedFilter = filterValue.toLowerCase().replace(/\s+/g, ' ');
                updateUrl({ category: normalizedFilter, subcategory: null, view: null });
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
                    const parentFilterName = parentName.toLowerCase().replace(/\s+/g, ' '); 
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

            // Check if this is Union Machine Works being added
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) return;

            const isUmwBeingAdded = record.fields.Name && record.fields.Name.includes("Union Machine Works");

            // Store whether UMW was in plan BEFORE this addition
            const wasUmwInPlan = Array.from(state.cart.lockedItems.keys()).some(id => {
                const lockedRecord = state.records.all.find(r => r.id === id);
                return lockedRecord && lockedRecord.fields.Name && lockedRecord.fields.Name.includes("Union Machine Works");
            });

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
                const note = document.getElementById('modal-item-note')?.value || '';

                // Extract selections from option groups
                const selections = {};
                const optionGroups = document.querySelectorAll('#modal-options-container .option-group');
                if (optionGroups.length > 0) {
                    optionGroups.forEach((group) => {
                        const groupIndex = group.dataset.groupIndex;
                        const selectedBtn = group.querySelector('.option-btn.selected');
                        if (selectedBtn && groupIndex !== undefined) {
                            selections[`group${groupIndex}`] = parseInt(selectedBtn.dataset.optionIndex, 10) || 0;
                        }
                    });
                } else {
                    // Legacy: single flat list of options
                    const selectedBtn = document.querySelector('#modal-options-container .option-btn.selected');
                    if (selectedBtn) {
                        const selectedOptionIndex = parseInt(selectedBtn.dataset.optionIndex, 10) || 0;
                        selections['group0'] = selectedOptionIndex;
                    }
                }

                // Compute legacy selectedOptionIndex from selections for backward compatibility
                let selectedOptionIndex = 0;
                if (Object.keys(selections).length > 0) {
                    // For now, use the first group's selection as the legacy index
                    selectedOptionIndex = selections['group0'] || 0;
                }

                itemInfo = { quantity, selectedOptionIndex, selections, note };
                updateUrl({ openItem: null });
                ui.hideDetailModal();
            } else {
                itemInfo = ui.getItemState(recordId);
            }

            // Store the last attempted quantity
            const lastAttemptedQuantity = itemInfo.quantity || 1;
            itemInfo.lastAttemptedQuantity = lastAttemptedQuantity;

            // Enforce effective minimum quantity
            const effectiveMin = getEffectiveMinQuantity(record);
            const airtableMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
            let quantityToSave = itemInfo.quantity || 1;

            // Check if UMW is in plan NOW (after potential addition)
            let isUmwInPlanNow = wasUmwInPlan || isUmwBeingAdded;

            if (quantityToSave < effectiveMin) {
                quantityToSave = effectiveMin;
                // Only show notification if UMW is NOT in the plan (off-site event)
                if (!isUmwInPlanNow && airtableMin > 1) {
                    ui.showEventPlanNotification(`Quantity adjusted to minimum (${effectiveMin}) for off-site event.`);
                } else if (isUmwInPlanNow && airtableMin > 1) {
                    // UMW is in plan, show different message
                    ui.showEventPlanNotification(`Headcount permitted below minimum as on-site at Union Machine Works.`);
                }
            }

            // Update itemInfo with enforced quantity
            itemInfo.quantity = quantityToSave;

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
            await ui.updateLockedItemStatusIcons();
            updateMobileBarAvailability();

            // If UMW was just added, check all other items and adjust their quantities
            if (isUmwBeingAdded && !wasUmwInPlan) {
                handleUmwAddition();
            }

            // Phase 5: Broadcast the item addition to collaborators
            broadcastItemAdded(recordId, record.fields?.Name || 'Item');

            triggerSave();
        } else if (demoteBtn) {
            console.log('[Events] ========== DEMOTE CLICKED ==========');
            e.stopPropagation();
            const recordId = demoteBtn.closest('[data-record-id]')?.dataset.recordId;
            console.log('[Events] recordId:', recordId);
            if (!recordId || !state.cart.lockedItems.has(recordId)) return;

            // Check if this is Union Machine Works being removed
            const record = state.records.all.find(r => r.id === recordId);
            const isUmwBeingRemoved = record && record.fields.Name && record.fields.Name.includes("Union Machine Works");

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
            await updateAllCardAvailabilityIcons();
            await ui.updateLockedItemStatusIcons();
            updateMobileBarAvailability();

            // If UMW was just removed, check all other items and adjust their quantities
            if (isUmwBeingRemoved) {
                handleUmwRemoval();
            }

            // Phase 5: Broadcast the item removal to collaborators
            broadcastItemRemoved(recordId, record?.fields?.Name || 'Item');

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
        } else if (card && !e.target.closest('.quantity-selector, .heart-icon, .add-to-plan-btn, .availability-btn')) {
            const recordId = card.dataset.recordId;

            // First try to find in state.records.all
            let record = state.records.all.find(r => r.id === recordId);

            // If not found in all, check state.records.filtered (for session tiles, etc.)
            if (!record) {
                record = state.records.filtered.find(r => r.id === recordId);
            }

            if (!record) {
                return;
            }

            if (record.id.startsWith('ai-search-')) {
                return;
            }

            // Handle session tile clicks - load session into event plan panel and chat
            if (record.isSession && record.sessionData) {
                log('Events', `Loading session from My Sessions view: ${record.id}`);

                // Update URL with session parameter and clear the my-sessions view
                updateUrl({ session: record.id, view: null, category: null, subcategory: null });

                // Load the session data (this will fire sessionReady event when complete)
                api.loadSessionFromAirtable(record.id).catch(err => {
                    log('Events', `Failed to load session: ${err.message}`);
                });

                // Refresh the catalog view to show items instead of sessions list
                applyFiltersAndSort(imageCache);

                return;
            }

            if (record.fields['Item Type'] === 'Grouping') {
                 const groupName = record.fields.Name;
                 const groupNameLower = groupName.toLowerCase().replace(/\s+/g, ' ');
                 const parentName = record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];

                 // Small progress for browsing categories
                 updateProgress(0.00002);

                 if (!parentName) {
                     updateUrl({ category: groupNameLower, subcategory: null, view: null });
                 } else {
                     const parentNameLower = parentName.toLowerCase().replace(/\s+/g, ' ');
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
        } else if (e.detail?.selections !== undefined) {
            // New: Handle selections object from option groups
            updates.selections = e.detail.selections;
            // Also update legacy selectedOptionIndex for backward compatibility
            if (Object.keys(e.detail.selections).length > 0) {
                updates.selectedOptionIndex = e.detail.selections['group0'] || 0;
            }
        } else if (e.detail?.selectedOptionIndex !== undefined) {
            // Legacy: Handle single selectedOptionIndex
            updates.selectedOptionIndex = e.detail.selectedOptionIndex;
            // Also create selections object for new format
            updates.selections = { group0: e.detail.selectedOptionIndex };
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
        const initializeEventDatePicker = async () => {
            if (!eventPlanDatePicker) {
                try {
                    log('Events', 'Loading Flatpickr dynamically for event date picker...');
                    await loadFlatpickr();
                    
                    if (!window.flatpickr) {
                        throw new Error('Flatpickr not available after loading');
                    }
                    
                    if (typeof window.flatpickr !== 'function') {
                        throw new Error(`Flatpickr is not a function, got type: ${typeof window.flatpickr}`);
                    }

                    // Clear placeholder text before initializing flatpickr to avoid parse errors
                    if (eventDateInput.value === 'Select a date') {
                        eventDateInput.value = '';
                    }

                    eventPlanDatePicker = window.flatpickr(eventDateInput, {
                        dateFormat: "M j, Y",
                        onChange: async (selectedDates) => {
                            if (state.ui.isInitializing) return;
                            if (selectedDates.length > 0) {
                                const isoDate = selectedDates[0].toISOString();
                                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, isoDate);
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
                    
                    // Store the flatpickr instance on the input element
                    eventDateInput._flatpickr = eventPlanDatePicker;
                    
                    // Open the calendar after initialization
                    eventPlanDatePicker.open();
                    
                    log('Events', 'Event date picker initialized successfully');
                } catch (error) {
                    log('Events', `Error initializing event date picker: ${error.message}`);
                    console.error('Flatpickr initialization error:', error);
                }
            } else {
                // If already initialized, just open it
                eventPlanDatePicker.open();
            }
        };
        
        eventDateInput.addEventListener('focus', initializeEventDatePicker);
    }
    
    safeAddEventListener('itinerary-btn', 'click', () => {
        log('Events', 'Itinerary button clicked, showing modal.');
        showItineraryModal();
    });
    
    ui.setupPresentationEventListeners();
    safeAddEventListener('payment-form', 'submit', handlePaymentFormSubmit);

    setupItineraryEventListeners();

    // Phase 5: Initialize project selector for "Add to Project" functionality
    initializeProjectSelector();

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

    // Initialize recent chats listeners
    initializeRecentChatsListeners();
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
