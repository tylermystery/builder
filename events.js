// REPLACE THE ENTIRE CONTENTS OF: events.js

import { state, setState } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { applyFiltersAndSort } from './filtering.js';
import { log, setDebugMode } from './utils/debug.js';
import { AVAILABILITY_STATUS, getDayStatus, checkAvailability, getRangeStatus } from './availability.js';
import { debounce, updateUrl } from './utils.js'; // <-- MODIFIED IMPORT
import { sendMessage, initializeSessionChat } from './chat.js';
import { showItineraryModal, setupItineraryEventListeners } from './components/itinerary.js';
import { updateMobileBarAvailability } from './ui.js';
import { showUserModal } from './auth.js';


let mainDatePicker = null;
let saveTimeout = null;
let saveShareBtn = null;
let categoryFiltersContainer = null;
let subcategoryFiltersContainer = null;

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

function updateSubcategoryButtons() {
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

            // --- THIS IS THE FIX ---
            // Create a new payment object and add it to the history
            const newPayment = {
                amount: amountPaid,
                date: new Date().toISOString(),
                note: `Stripe Payment on ${new Date().toLocaleDateString()}`
            };
            const updatedPaymentHistory = [...state.session.user.paymentHistory, newPayment];

            // Call the new API function to update Airtable
            await api.updatePaymentHistory(state.session.id, updatedPaymentHistory);

            // Update the local state
            state.session.user.paymentHistory = updatedPaymentHistory;
            state.session.user.amountReceived = updatedPaymentHistory.reduce((sum, p) => sum + p.amount, 0);
            // --- END FIX ---

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

export function initializeEventListeners(imageCache, flatpickr, shopSettings) {
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) element.addEventListener(event, handler);
        else console.warn(`Element with ID "${selector}" not found.`);
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
    const currentStore = state.stores.all.find(r => r.id === state.ui.activeShopId);
    const planFilterBtn = document.createElement('button');
    planFilterBtn.className = 'filter-btn';
    planFilterBtn.id = 'plan-filter-btn';
    planFilterBtn.textContent = '⭐ My Plan';
    if (categoryFiltersContainer) {
        categoryFiltersContainer.prepend(planFilterBtn);
    }

    if (currentStore && Array.isArray(currentStore.fields.Items)) {
        const categoryRecordIds = currentStore.fields.Items;
        const categories = categoryRecordIds.map(id => state.records.all.find(record => record.id === id)).filter(Boolean);
        const allButton = document.createElement('button');
        allButton.className = 'filter-btn category-filter-btn active';
        allButton.dataset.filter = 'all';
        allButton.textContent = 'All';
        categoryFiltersContainer.appendChild(allButton);
        categories.forEach((catRecord) => {
            const button = document.createElement('button');
            button.className = 'filter-btn category-filter-btn';
            button.dataset.filter = catRecord.fields.Name.toLowerCase();
            button.textContent = catRecord.fields.Name;
            categoryFiltersContainer.appendChild(button);
        });
        updateSubcategoryButtons();
    } else {
        const allButton = document.createElement('button');
        allButton.className = 'filter-btn category-filter-btn active';
        allButton.dataset.filter = 'all';
        allButton.textContent = 'All';
        categoryFiltersContainer.appendChild(allButton);
    }

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
        const clickedBtn = e.target.closest('.filter-btn');

        if (!clickedBtn) return;

        const isPlanFilterClick = clickedBtn.id === 'plan-filter-btn';

        // <-- NEW URL LOGIC -->
        if (isPlanFilterClick) {
            updateUrl({ category: null, subcategory: null, view: 'plan' });
        } else {
            const newCategory = clickedBtn.dataset.filter === 'all' ? null : clickedBtn.dataset.filter;
            updateUrl({ category: newCategory, subcategory: null, view: null });
        }
        // <-- END NEW URL LOGIC -->

        categoryFiltersContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));

        if (isPlanFilterClick) {
            planFilterBtn.classList.add('active');
            updateSubcategoryButtons();
        } else {
            if (planFilterBtn) {
                planFilterBtn.classList.remove('active');
            }
            clickedBtn.classList.add('active');
            updateSubcategoryButtons();
        }

        applyFiltersAndSort(imageCache);
    });

    safeAddEventListener('subcategory-filters', 'click', (e) => {
        if (e.target.classList.contains('subcategory-filter-btn')) {
            e.target.classList.toggle('active');
            // <-- NEW URL LOGIC -->
            const activeSubcats = Array.from(document.querySelectorAll('#subcategory-filters .filter-btn.active'))
                                     .map(btn => btn.dataset.filter);
            updateUrl({ subcategory: activeSubcats.join(',') || null });
            // <-- END NEW URL LOGIC -->
            applyFiltersAndSort(imageCache);
        }
    });

    safeAddEventListener('status-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('name-filter', 'input', debounce(() => applyFiltersAndSort(imageCache), 300));
    safeAddEventListener('headcount-custom', 'input', debounce(() => applyFiltersAndSort(imageCache), 300));
    safeAddEventListener('headcount-filter', 'change', (e) => {
        document.getElementById('headcount-custom').style.display = (e.target.value === 'custom') ? 'block' : 'none';
        applyFiltersAndSort(imageCache);
    });
    safeAddEventListener('location-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('budget-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('sort-by', 'change', () => applyFiltersAndSort(imageCache));

    safeAddEventListener('reset-filters-btn', 'click', () => {
        // <-- NEW URL LOGIC -->
        updateUrl({ category: null, subcategory: null, view: null });
        // <-- END NEW URL LOGIC -->
        const allButton = categoryFiltersContainer.querySelector('.category-filter-btn[data-filter="all"]');
        if (allButton) {
            categoryFiltersContainer.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
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
    safeAddEventListener('header-goals', 'change', (e) => {
        if (state.ui.isInitializing) return;
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
    });

    document.body.addEventListener('click', async (e) => {
        // Prevent default for anchor tags used as buttons
        if (e.target.tagName === 'A' && e.target.getAttribute('href') === '#') {
            e.preventDefault();
        }

        if (state.ui.isInitializing) return;

        // --- Define potential click targets ---
        const card = e.target.closest('.event-card');
        const heartIcon = e.target.closest('.heart-icon');
        const rsvpBtn = e.target.closest('.rsvp-btn');
        const favoriteItem = e.target.closest('.favorite-item');
        const removeBtn = favoriteItem?.querySelector('.remove-btn'); // Specifically target remove on favorites
        const checkoutBtn = e.target.closest('#checkout-btn');
        const lockedItemCard = e.target.closest('.locked-item-card');
        const demoteBtn = e.target.closest('.demote-locked-item-btn'); // Specific button within locked item
        const editBtn = e.target.closest('.locked-item-card .edit-btn'); // Specific button within locked item
        const parentLink = e.target.closest('.parent-link');
        const presentBtn = e.target.closest('.present-btn');
        const carouselNav = e.target.closest('.carousel-nav');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const breadcrumbLink = e.target.closest('.breadcrumb-link');
        const addToPlanBtn = e.target.closest('.add-to-plan-btn, #modal-add-to-plan-btn');

        // --- Handle click targets with priority ---

        if (saveShareBtn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            });
            return; // Stop processing
        }

        if (breadcrumbLink) {
            log('Events - Breadcrumb', 'Breadcrumb link clicked.'); // DEBUG
            const filterValue = breadcrumbLink.dataset.filter;
            log('Events - Breadcrumb', `Attempting to find filter button with data-filter="${filterValue}"`); // DEBUG
            // Ensure we only look within category filters for breadcrumbs
            const targetButton = document.querySelector(`#category-filters .filter-btn[data-filter="${filterValue}"]`);
            if (targetButton) {
                log('Events - Breadcrumb', `Found category button "${targetButton.textContent}". Clicking it.`); // DEBUG
                targetButton.click();
            } else {
                log('Events - Breadcrumb', `WARN: No category filter button found for data-filter="${filterValue}".`); // DEBUG
            }
            return; // Stop processing
        }

        if (checkoutBtn) {
            ui.showCheckoutModal(shopSettings); // Assuming shopSettings is accessible here
            return; // Stop processing
        }

        if (rsvpBtn) {
            e.stopPropagation();
            if (!state.session.user.isAuthenticated) {
                showUserModal();
                return;
            }
            const cardEl = rsvpBtn.closest('.event-card');
            const recordId = cardEl.dataset.recordId;
            rsvpBtn.disabled = true;
            rsvpBtn.textContent = 'Saving...';
            const updatedRecord = await api.addRsvpToEvent(recordId, state.session.user.id);
            if (updatedRecord) {
                rsvpBtn.textContent = "You're Going! ✅";
                const recordIndex = state.records.all.findIndex(r => r.id === recordId);
                if (recordIndex > -1) {
                    state.records.all[recordIndex] = updatedRecord;
                }
            } else {
                rsvpBtn.textContent = 'Error!';
                setTimeout(() => {
                    rsvpBtn.textContent = 'RSVP';
                    rsvpBtn.disabled = false;
                }, 2000);
            }
            return; // Stop processing (async but action complete)
        }

        if (presentBtn) {
            const listType = presentBtn.dataset.listType;
            ui.showPresentationView(listType);
            return; // Stop processing
        }

        if (carouselNav) {
            const carousel = document.getElementById('favorites-carousel');
            if (carousel) {
                const scrollAmount = 300;
                const direction = carouselNav.classList.contains('right') ? 1 : -1;
                carousel.scrollBy({ left: scrollAmount * direction, behavior: 'smooth' });
            }
            return; // Stop processing
        }

        if (parentLink) {
            e.stopPropagation();
            log('Events - Parent Link (Modal)', 'Parent link inside modal clicked.'); // DEBUG
            const parentName = parentLink.dataset.parentName;
            log('Events - Parent Link (Modal)', `Searching for filter button matching parent name: "${parentName}"`); // DEBUG
            if (parentName) {
                const targetButton = [...document.querySelectorAll('#category-filters .filter-btn, #subcategory-filters .filter-btn')]
                                      .find(btn => btn.textContent === parentName);
                if (targetButton) {
                    const isCategory = !!targetButton.closest('#category-filters');
                    log('Events - Parent Link (Modal)', `Found button "${targetButton.textContent}". Is Category: ${isCategory}`); // DEBUG
                    if (isCategory) {
                        log('Events - Parent Link (Modal)', 'Handling as Category click.'); // DEBUG
                        targetButton.click();
                    } else {
                        log('Events - Parent Link (Modal)', 'Handling as Subcategory click (activating only this one).'); // DEBUG
                        document.querySelectorAll('#subcategory-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
                        targetButton.classList.add('active');
                        const activeSubcats = [targetButton.dataset.filter];
                        updateUrl({ subcategory: activeSubcats.join(',') || null });
                        applyFiltersAndSort(imageCache); // Make sure imageCache is accessible
                    }
                    if (document.getElementById('detail-modal-overlay').classList.contains('active')) {
                        log('Events - Parent Link (Modal)', 'Closing modal after handling parent link.'); // DEBUG
                        updateUrl({ openItem: null });
                        ui.hideDetailModal(); // Use hide, not close, as URL is already updated
                    }
                } else {
                    log('Events - Parent Link (Modal)', `WARN: No filter button found matching parent name "${parentName}".`); // DEBUG
                }
            } else {
                log('Events - Parent Link (Modal)', 'WARN: Parent link clicked, but data-parent-name attribute was empty.'); // DEBUG
            }
            return; // Stop processing
        }


        if (heartIcon) {
            e.stopPropagation();
            const recordId = heartIcon.closest('[data-record-id]').dataset.recordId;
            if (!state.cart.lockedItems.has(recordId)) {
                if (state.cart.items.has(recordId)) {
                    state.cart.items.delete(recordId);
                } else {
                    ui.updateItemState(recordId, {});
                }
                ui.updateCardIcon(recordId);
                await debounce(ui.updateFavoritesCarousel, 300)();
                triggerSave();
            }
            return; // Stop processing
        }

        if (addToPlanBtn) {
            e.stopPropagation();
            const recordId = addToPlanBtn.closest('[data-record-id]').dataset.recordId;
            if (state.cart.lockedItems.has(recordId)) {
                 // If already locked, likely the "Update Plan" button in modal - just close it
                 if (document.getElementById('detail-modal-overlay').classList.contains('active')) {
                     ui.closeDetailModal(); // Use the safe close function
                 }
                return; // Stop processing
            }
            const itemInfo = ui.getItemState(recordId);
            state.cart.lockedItems.set(recordId, itemInfo);
            state.cart.items.delete(recordId);
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            updateMobileBarAvailability();
            triggerSave();
            // Close modal if add button was clicked inside it
            if (addToPlanBtn.id === 'modal-add-to-plan-btn') {
                ui.closeDetailModal(); // Use the safe close function
            }
            return; // Stop processing
        }

        if (demoteBtn) {
            e.stopPropagation();
            const recordId = demoteBtn.closest('[data-record-id]').dataset.recordId;
            if (state.cart.lockedItems.has(recordId)) {
                const itemInfo = state.cart.lockedItems.get(recordId);
                state.cart.lockedItems.delete(recordId);
                state.cart.items.set(recordId, itemInfo);
                ui.updateCardIcon(recordId);
                await ui.updateEventPlanSection();
                await ui.updateFavoritesCarousel();
                ui.updateTotalCost();
                updateMobileBarAvailability();
                triggerSave();
            }
            return; // Stop processing
        }

        // Handle remove button specifically on favorite items
        if (removeBtn && e.target === removeBtn) {
            e.stopPropagation();
            const recordId = favoriteItem.dataset.recordId;
            state.cart.items.delete(recordId);
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
            triggerSave();
            return; // Stop processing
        }

        // --- General Card/Item Clicks (Lower Priority) ---

        if (card && !e.target.closest('.quantity-selector, .add-to-plan-btn, .heart-icon, .rsvp-btn')) {
            log('Events - Card Click', 'General card click detected.'); // DEBUG
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);

            if (record && record.fields['Item Type'] === 'Grouping') {
                log('Events - Card Click', `Grouping card clicked: "${record.fields.Name}"`); // DEBUG
                const categoryName = record.fields.Name;
                // Find a matching button in either the main category or subcategory filters
                const targetButton = [...document.querySelectorAll('#category-filters .filter-btn, #subcategory-filters .filter-btn')]
                                      .find(btn => btn.textContent === categoryName);

                if (targetButton) {
                    log('Events - Card Click', `Found target filter button for "${categoryName}". Clicking it.`); // DEBUG
                    targetButton.click();
                } else {
                    // Log if no matching button was found - this indicates a potential mismatch
                    log('Events - Card Click', `WARN: No filter button found for grouping "${categoryName}". Cannot filter.`); // DEBUG
                }
                // Groupings never open modal directly now

            } else if (record) {
                log('Events - Card Click', `Bookable/Event card clicked: "${record.fields.Name}". Opening modal.`); // DEBUG
                ui.showDetailModal(record);
            } else {
                log('Events - Card Click', `WARN: Clicked card, but record not found for ID: ${recordId}`); // DEBUG
            }
            return; // Stop processing
        }


        // Handle clicks on locked items in the sidebar (but not edit/demote buttons)
        if (lockedItemCard && !editBtn && !demoteBtn) {
             const recordId = lockedItemCard.dataset.recordId;
             const record = state.records.all.find(r => r.id === recordId);
             if (record) ui.showDetailModal(record);
            return; // Stop processing
        }

        // Handle clicks on favorite items in carousel (but not add/remove buttons)
        if (favoriteItem && !e.target.closest('.add-to-plan-btn, .remove-btn')) {
            const recordId = favoriteItem.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
            return; // Stop processing
        }

        // If no specific target matched above, do nothing.
    });

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
