// In: events.js (REPLACE THE ENTIRE FILE)

import { state, setState } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { applyFiltersAndSort } from './filtering.js';
import { log, setDebugMode } from './utils/debug.js';
import { AVAILABILITY_STATUS, getDayStatus, checkAvailability, getRangeStatus } from './availability.js';
import { debounce, updateUrl } from './utils.js';
import { sendMessage, initializeSessionChat } from './chat.js';
import { showItineraryModal, setupItineraryEventListeners } from './components/itinerary.js';
import { updateMobileBarAvailability } from './ui.js';
import { showUserModal } from './auth.js';
import * as backgroundEngine from './components/backgroundEngine.js'; 
import { updateProcessingFeeDisplay } from './components/modal.js';

let mainDatePicker = null;
let saveTimeout = null;
let saveShareBtn = null;
let categoryFiltersContainer = null;
let subcategoryFiltersContainer = null;

// --- NEW FUNCTION: Progress Logic (Cleaned) ---
function updateProgressForAction(actionName) {
    let weight = 0.0;
    // Define weights based on action commitment
    switch (actionName) {
        case 'add-to-plan':
            weight = 0.05; // Major Positive
            break;
        case 'remove-from-plan':
            weight = -0.05; // Major Negative
            break;
        case 'like':
            weight = 0.015; // Medium Positive
            break;
        case 'unlike':
            weight = -0.015; // Medium Negative
            break; 
        case 'increase-qty':
        case 'option-change':
            weight = 0.005; // Minor Positive
            break;
        case 'decrease-qty':
            weight = -0.005; // Minor Negative
            break;
        case 'view-detail':
        case 'filter-change':
            weight = 0.002; // Tiny Positive boost for engagement
            break;
        default: 
            weight = 0.0;
    }
    if (weight !== 0.0) {
        backgroundEngine.updateProgress(weight);
    }
}
// --- END NEW FUNCTION ---

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
            const tooltipContent = `<div style="text-align: left;"><strong>${dateRangeString}</strong><hr style="margin: 2px 0 5px;"><span>${statusIcon} ${record.fields.Name}: ${rangeStatus.reason}</span></div>`;
            tippy(icon, { content: tooltipContent, allowHTML: true, placement: 'top', arrow: true });
            icon.title = rangeStatus.reason;
            icon.textContent = statusIcon;
        }
    }
}

// --- MODIFIED: handlePaymentFormSubmit for Stripe Payment Element and Fee ---
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

    // Get the Stripe context and Elements object stored on the modal overlay
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const stripeElements = checkoutModalOverlay?.stripeElements; 
    const stripe = ui.getStripeContext().stripe; // Retrieve stripe instance
    
    if (!stripe || !stripeElements) { 
        cardErrors.textContent = 'Payment system is not initialized. Please close and reopen the checkout window.';
        submitBtn.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
        return;
    }
    
    try {
        // --- STEP 1: Recalculate and update the intent for the final charge amount (base + tip + fee) ---
        // We rely on the core logic here, which will also update the stripeElements object with the new clientSecret
        const finalTotal = parseFloat(document.getElementById('full-total-price').dataset.total || 0);
        const amountReceived = state.session.user.amountReceived || 0;
        const totalDue = finalTotal - amountReceived;
        
        // This logic calculates the amount before the fee, including deposit/full choice
        let baseAmountToCharge = totalDue;
        const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
        
        if (amountReceived === 0) {
            const shopSettings = state.stores.all.find(s => s.id === state.ui.activeShopId)?.fields;
            if (shopSettings?.PaymentOptions === 'DepositOrFull' && choice === 'full') {
                 baseAmountToCharge = finalTotal;
            } else {
                 baseAmountToCharge = finalTotal * 0.35;
            }
        }
        
        const tipAmount = parseFloat(document.getElementById('tip-amount').value) || 0;
        const finalAmountToChargeBeforeFee = baseAmountToCharge + tipAmount;

        const amountInCentsBeforeFee = Math.round(finalAmountToChargeBeforeFee * 100);
        if (amountInCentsBeforeFee < 50) {
            throw new Error("Final amount is too low to process.");
        }

        // We call updateProcessingFeeDisplay one last time to ensure a fresh clientSecret reflecting the exact amount + tip + fee is generated and applied to the elements.
        await updateProcessingFeeDisplay(); 
        
        // 2. Submit Payment Element to collect payment method details
        const { error: submitError } = await stripeElements.submit();
        if (submitError) {
             throw new Error(submitError.message);
        }

        // 3. Extract the final clientSecret from the latest intent created by updateProcessingFeeDisplay
        // This is a direct fetch since the clientSecret is not exposed globally by the Payment Element
        const intentResponse = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: amountInCentsBeforeFee }),
        });

        if (!intentResponse.ok) throw new Error('Could not refresh payment intent.');
        const paymentIntentData = await intentResponse.json();
        const clientSecret = paymentIntentData.clientSecret;
        
        // 4. Confirm the Payment Intent with the Elements object
        const customerName = document.getElementById('customer-name').value;
        const customerEmail = document.getElementById('customer-email').value;
        
        const { error, paymentIntent } = await stripe.confirmPayment({
            elements: stripeElements, // Use the Elements object for confirmation
            clientSecret: clientSecret,
            confirmParams: {
                // Return URL is necessary for asynchronous payment methods (PayPal, ACH, etc.)
                return_url: `${window.location.origin}/`, 
                payment_method_data: {
                    billing_details: {
                        name: customerName, 
                        email: customerEmail 
                    }
                }
            },
            redirect: 'if_required', // Handles redirection for off-session payments
        });

        if (error) {
            console.error('Stripe Payment Confirmation Error:', error);
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
        } else {
             log('Events', `Payment status is ${paymentIntent.status}. No immediate action needed if user was redirected.`);
        }
    } catch (err) {
        log('Events', `Stripe payment error: ${err.message}`);
        cardErrors.textContent = err.message;
        submitBtn.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
    }
}
// --- END MODIFIED handlePaymentFormSubmit ---

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
    });

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

    // --- START CONSOLIDATED BUTTON GENERATION (Same as before) ---
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
    // --- END CONSOLIDATED BUTTON GENERATION ---

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
        
        // PROGRESS: Apply small boost for navigating/exploring
        updateProgressForAction('filter-change');

        applyFiltersAndSort(imageCache);
    });

    safeAddEventListener('subcategory-filters', 'click', (e) => {
        if (e.target.classList.contains('subcategory-filter-btn')) {
            e.target.classList.toggle('active');
            const activeSubcats = Array.from(document.querySelectorAll('#subcategory-filters .filter-btn.active'))
                                     .map(btn => btn.dataset.filter);
            updateUrl({ subcategory: activeSubcats.join(',') || null });
            // PROGRESS: Apply small boost for navigating/exploring
            updateProgressForAction('filter-change');
            applyFiltersAndSort(imageCache);
        }
    });

    safeAddEventListener('status-filter', 'change', () => {
        updateProgressForAction('filter-change');
        applyFiltersAndSort(imageCache)
    });
    safeAddEventListener('name-filter', 'input', debounce(() => {
        updateProgressForAction('filter-change');
        applyFiltersAndSort(imageCache)
    }, 300));
    safeAddEventListener('headcount-custom', 'input', debounce(() => {
        updateProgressForAction('filter-change');
        applyFiltersAndSort(imageCache)
    }, 300));
    safeAddEventListener('headcount-filter', 'change', (e) => {
        document.getElementById('headcount-custom').style.display = (e.target.value === 'custom') ? 'block' : 'none';
        updateProgressForAction('filter-change');
        applyFiltersAndSort(imageCache);
    });
    safeAddEventListener('location-filter', 'change', () => {
        updateProgressForAction('filter-change');
        applyFiltersAndSort(imageCache);
    });
    safeAddEventListener('budget-filter', 'change', () => {
        updateProgressForAction('filter-change');
        applyFiltersAndSort(imageCache);
    });
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
        updateProgressForAction('filter-change'); // Small boost for starting fresh
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
            updateProgressForAction('filter-change');
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
        updateProgressForAction('filter-change');
    });

    safeAddEventListener('header-event-name', 'change', (e) => {
        if (state.ui.isInitializing) return;
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
        updateProgressForAction('filter-change');
    });
    safeAddEventListener('header-goals', 'change', (e) => {
        if (state.ui.isInitializing) return;
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
        updateProgressForAction('filter-change');
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
                    updateProgressForAction('add-to-plan'); // RSVP is a major commitment
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
            const carousel = document.getElementById('favorites-carousel');
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
        }
        else if (heartIcon) {
            e.stopPropagation();
            backgroundEngine.addEnergy(); // Add energy on heart click
            const recordId = heartIcon.closest('[data-record-id]')?.dataset.recordId;
            if (!recordId) return;
    
            let likedBeforeClick;
            if (state.session.user.isAuthenticated) {
                likedBeforeClick = state.session.user.likedItemIds.has(recordId);
            } else {
                const tempLikes = new Set(JSON.parse(localStorage.getItem('tempLikes') || '[]'));
                likedBeforeClick = tempLikes.has(recordId);
            }

            console.log(`[Events] Heart icon clicked for record: ${recordId}. Was liked: ${likedBeforeClick}`);
    
            if (state.session.user.isAuthenticated) {
                try {
                    heartIcon.style.pointerEvents = 'none';
                    const result = await api.toggleUserLike(recordId);
                    
                    if (result.success) {
                        if (result.liked) {
                            state.session.user.likedItemIds.add(recordId);
                            updateProgressForAction('like');
                        } else {
                            state.session.user.likedItemIds.delete(recordId);
                            updateProgressForAction('unlike');
                        }
                        ui.updateCardIcon(recordId);
                        if (document.getElementById('liked-items-filter-btn')?.classList.contains('active')) {
                            applyFiltersAndSort(imageCache);
                        }
                    } else {
                         ui.showToast('Could not update like status. Please try again.');
                    }
                } catch (error) {
                    log('Events', `Error toggling like: ${error.message}`);
                    ui.showToast(`Error: ${error.message}`);
                } finally {
                    heartIcon.style.pointerEvents = 'auto';
                }
            } else {
                log('Events', `Guest toggling temporary like for item ${recordId}.`);
                let tempLikes = [];
                try {
                    tempLikes = JSON.parse(localStorage.getItem('tempLikes') || '[]');
                } catch (e) {
                     console.error('Error parsing tempLikes from localStorage:', e);
                     localStorage.removeItem('tempLikes'); tempLikes = [];
                }
                const tempLikesSet = new Set(tempLikes);
                
                if (tempLikesSet.has(recordId)) {
                    tempLikesSet.delete(recordId); 
                    updateProgressForAction('unlike');
                } else {
                    tempLikesSet.add(recordId);
                    updateProgressForAction('like');
                    ui.showLoginPromptForLikes();
                }

                localStorage.setItem('tempLikes', JSON.stringify(Array.from(tempLikesSet)));
                ui.updateCardIcon(recordId);

                if (document.getElementById('liked-items-filter-btn')?.classList.contains('active')) {
                      applyFiltersAndSort(imageCache);
                 }
            }
        }
        
        else if (addToPlanBtn) {
            e.stopPropagation();
            const recordId = addToPlanBtn.closest('[data-record-id]')?.dataset.recordId;
            if (!recordId) return;

            backgroundEngine.addEnergy(); // Existing energy boost
            updateProgressForAction('add-to-plan'); // PROGRESS: Major positive boost

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

            updateProgressForAction('remove-from-plan'); // PROGRESS: Major negative weight
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

            updateProgressForAction('unlike'); // PROGRESS: Treat as un-hearting
            await ui.updateIdeasCarousel();
            triggerSave();
        } else if (card && !e.target.closest('.quantity-selector, .heart-icon, .add-to-plan-btn')) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (!record) return;

            if (record.fields['Item Type'] === 'Grouping') {
                 // Existing grouping logic...
                 // PROGRESS: Treat category/group navigation as a filter change
                 updateProgressForAction('filter-change');
                 const groupName = record.fields.Name;
                 const groupNameLower = groupName.toLowerCase();
                 const parentName = record.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];

                 // --- NEW REDIRECT LOGIC ---
                 const linkedStore = state.stores.all.find(s => s.fields.Name === groupName);
                 if (!parentName && linkedStore) {
                     log('Events', `Grouping "${groupName}" matches a Store name. Redirecting to store.`);
                     window.location.href = `/?shopId=${linkedStore.id}`;
                     return; // Stop further execution
                 }
                 // --- END NEW REDIRECT LOGIC ---

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
                updateProgressForAction('view-detail'); // PROGRESS: Slight boost for detail viewing
            }
        } else if (lockedItemCard && !e.target.closest('.demote-locked-item-btn, .edit-btn')) {
            const recordId = lockedItemCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                ui.showDetailModal(record);
                updateProgressForAction('view-detail'); // PROGRESS: Slight boost for detail viewing
            }
        } else if (ideaItem && !e.target.closest('.add-to-plan-btn, .remove-btn')) {
            const recordId = ideaItem.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
             if (record) {
                ui.showDetailModal(record);
                updateProgressForAction('view-detail'); // PROGRESS: Slight boost for detail viewing
             }
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
            const oldValue = parseInt(ui.getItemState(recordId).quantity, 10);
            const newValue = parseInt(target.value, 10);
            updates.quantity = newValue;
            // PROGRESS: Check for increase or decrease
            if (newValue > oldValue) {
                updateProgressForAction('increase-qty');
            } else if (newValue < oldValue) {
                updateProgressForAction('decrease-qty');
            }
        } else if (target.matches('#modal-item-note')) {
            updates.note = target.value;
            // PROGRESS: Slight boost for adding a note
            if (updates.note.trim().length > 0) updateProgressForAction('filter-change');
        } else if (e.detail?.selectedOptionIndex !== undefined) {
             updates.selectedOptionIndex = e.detail.selectedOptionIndex;
             updateProgressForAction('option-change'); // PROGRESS: Option change boost
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
            updateProgressForAction('filter-change');
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
            updateProgressForAction('filter-change'); // Small boost for starting a chat
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
