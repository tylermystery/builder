// PASTE THIS ENTIRE CODE INTO: events.js

import { state, setState } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { applyFiltersAndSort } from './filtering.js';
import { log, setDebugMode } from './utils/debug.js';
import { AVAILABILITY_STATUS, getDayStatus, checkAvailability, getRangeStatus } from './availability.js';
import { debounce } from './utils.js';
import { sendMessage, initializeSessionChat } from './chat.js';
import { showItineraryModal, setupItineraryEventListeners } from './components/itinerary.js';
import { updateMobileBarAvailability } from './ui.js';

let mainDatePicker = null;
let saveTimeout = null;
let saveShareBtn = null;
let categoryFiltersContainer = null;
let subcategoryFiltersContainer = null;

function getCurrentCategoryRecord() {
    if (!categoryFiltersContainer) return null;
    const selectedCategoryButton = categoryFiltersContainer.querySelector('.filter-btn.active');
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
            const newTotalAmountReceived = amountReceived + amountPaid;
            let note = state.session.user.amountReceivedNote || '';
            note += `\nPayment of $${amountPaid.toFixed(2)} received on ${new Date().toLocaleDateString()}.`;

            await api.updateSessionAmountReceived(state.session.id, newTotalAmountReceived, note.trim());
            state.session.user.amountReceived = newTotalAmountReceived;
            state.session.user.amountReceivedNote = note.trim();
            ui.updateTotalCost();
            document.getElementById('payment-form').style.display = 'none';
            document.getElementById('checkout-summary-details').style.display = 'none';
            document.querySelector('.checkout-total-deposit-section').style.display = 'none';
            document.querySelector('.terms-and-conditions').style.display = 'none';
            document.getElementById('payment-success-message').style.display = 'block';

            ui.displayReservedStatus();
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

    // --- REVISED Mobile Listeners ---
    const leftSidebar = document.getElementById('left-sidebar');
    const rightSidebar = document.getElementById('right-sidebar');

    // On mobile, collapse panels by default
    if (window.innerWidth < 1000) {
        leftSidebar?.classList.add('collapsed');
        rightSidebar?.classList.add('collapsed');
    }

    // Listener for the NEW filter trigger (the h3)
    safeAddEventListener('mobile-filter-trigger', 'click', () => {
        if (window.innerWidth < 1000) { // Only enable this behavior on mobile
            leftSidebar?.classList.toggle('collapsed');
        }
    });

    // REVISED listener for the mobile plan button
    safeAddEventListener('mobile-view-plan-btn', 'click', () => {
        const isCollapsing = !rightSidebar?.classList.contains('collapsed');
        rightSidebar?.classList.toggle('collapsed');
        
        if (isCollapsing) {
            // On collapse, scroll to the top of the catalog
            document.getElementById('catalog-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
            // On expand, scroll down to the plan
            setTimeout(() => {
                rightSidebar?.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 50);
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
        if (e.target.classList.contains('category-filter-btn')) {
            categoryFiltersContainer.querySelectorAll('.category-filter-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            updateSubcategoryButtons();
            applyFiltersAndSort(imageCache);
        }
    });
    safeAddEventListener('subcategory-filters', 'click', (e) => {
        if (e.target.classList.contains('subcategory-filter-btn')) {
            e.target.classList.toggle('active');
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
        const allButton = categoryFiltersContainer.querySelector('.category-filter-btn[data-filter="all"]');
        if (allButton) {
            categoryFiltersContainer.querySelectorAll('.category-filter-btn').forEach(btn => btn.classList.remove('active'));
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
        if (state.ui.isInitializing) return;
        const card = e.target.closest('.event-card');
        const heartIcon = e.target.closest('.heart-icon');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const addToPlanBtn = e.target.closest('.add-to-plan-btn, #modal-add-to-plan-btn');
        const favoriteItem = e.target.closest('.favorite-item');
        const removeBtn = favoriteItem?.querySelector('.remove-btn');
        const checkoutBtn = e.target.closest('#checkout-btn');
        const lockedItemCard = e.target.closest('.locked-item-card');
        const demoteBtn = e.target.closest('.demote-locked-item-btn');
        const parentLink = e.target.closest('.parent-link');
        const presentBtn = e.target.closest('.present-btn');
        const carouselNav = e.target.closest('.carousel-nav');
        if (saveShareBtn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            });
        } else if (checkoutBtn) {
            ui.showCheckoutModal(shopSettings);
        } else if (presentBtn) {
            const listType = presentBtn.dataset.listType;
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
                const targetButton = Array.from(document.querySelectorAll('#category-filters .filter-btn')).find(btn => btn.textContent === parentName);
                if (targetButton) {
                    targetButton.click();
                    if (document.getElementById('detail-modal-overlay').classList.contains('active')) {
                        ui.hideDetailModal();
                    }
                }
            }
        } else if (heartIcon) {
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
        } else if (addToPlanBtn) {
            e.stopPropagation();
            const recordId = addToPlanBtn.closest('[data-record-id]').dataset.recordId;
            if (state.cart.lockedItems.has(recordId)) {
                ui.hideDetailModal();
                return;
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
        } else if (demoteBtn) {
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
        } else if (removeBtn && e.target === removeBtn) {
            e.stopPropagation();
            const recordId = favoriteItem.dataset.recordId;
            state.cart.items.delete(recordId);
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
            triggerSave();
        } else if (card && !e.target.closest('.quantity-selector')) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        } else if (lockedItemCard) {
            const recordId = lockedItemCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        } else if (favoriteItem && !e.target.closest('.add-to-plan-btn, .remove-btn')) {
            const recordId = favoriteItem.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        }
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

    setupItineraryEventListeners(); // This will attach the listeners for the itinerary modal
    
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
