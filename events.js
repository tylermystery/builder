// FILE: events.js
/*
* Version: 5.0.6
* Last Modified: 2025-09-12
* Changelog:
* v5.0.6 - 2025-09-12
* - Reverted the main body click listener to the last known-good architecture from v5.0.3 to restore core functionality.
* - Added a new 'else if' condition to the restored listener to specifically handle clicks on '.itinerary-item' elements, fixing the modal bug.
* - Re-implemented the date-quick-filter button functionality.
*/
import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { applyFiltersAndSort } from './filtering.js';
import { log, setDebugMode } from './utils/debug.js';
import { AVAILABILITY_STATUS, getDayStatus, checkAvailability } from './availability.js';
import { debounce } from './utils.js';
import { sendMessage } from './chat.js';

let mainDatePicker = null;
let saveTimeout = null;
let currentStore = null;
let saveShareBtn = null;
let categoryFiltersContainer = null;
let subcategoryFiltersContainer = null;
let scrollTimeout = null;

// --- (All functions from getCurrentCategoryRecord to handlePaymentFormSubmit remain unchanged) ---
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
        const dayStatus = getDayStatus(startDate, busyTimes, record);
        const isAvailable = checkAvailability(startDate, requestedEnd, busyTimes);
        const icon = card.querySelector('.availability-btn');
        if (icon) {
            if (icon._tippy) icon._tippy.destroy();
            let statusIcon, statusText;
            if (dayStatus.status === AVAILABILITY_STATUS.NONE || !isAvailable) {
                statusIcon = '❌';
                statusText = dayStatus.reason;
            } else if (dayStatus.status === AVAILABILITY_STATUS.PARTIAL) {
                statusIcon = '🟠';
                statusText = 'Partially Available';
            } else {
                statusIcon = '✅';
                statusText = 'Fully Available';
            }
            const dateString = startDate.toLocaleDateString();
            const tooltipContent = `<div style="text-align: left;"><strong>${dateString}</strong><hr style="margin: 2px 0 5px;"><span>${statusIcon} ${record.fields.Name}: ${statusText}</span></div>`;
            tippy(icon, { content: tooltipContent, allowHTML: true, placement: 'top', arrow: true });
            icon.title = statusText;
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
    const { stripe, elements, cardElement, clientSecret } = ui.getStripeContext();
    if (!stripe || !elements || !cardElement || !clientSecret) {
        cardErrors.textContent = 'Payment system is not initialized. Please close and reopen the checkout window.';
        submitBtn.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
        return;
    }
    const customerName = document.getElementById('customer-name').value;
    const customerEmail = document.getElementById('customer-email').value;
    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
            card: cardElement,
            billing_details: { name: customerName, email: customerEmail },
        },
    });
    if (error) {
        cardErrors.textContent = error.message;
        log('Events', `Stripe payment error: ${error.message}`);
        submitBtn.disabled = false;
        buttonText.style.display = 'inline';
        spinner.style.display = 'none';
    } else if (paymentIntent.status === 'succeeded') {
        log('Events', 'Payment succeeded.');
        document.getElementById('payment-form').style.display = 'none';
        document.getElementById('checkout-summary-details').style.display = 'none';
        document.querySelector('.checkout-total-deposit-section').style.display = 'none';
        document.querySelector('.terms-and-conditions').style.display = 'none';
        document.getElementById('payment-success-message').style.display = 'block';
        ui.displayReservedStatus();
        setTimeout(() => {
            ui.hideCheckoutModal();
        }, 4000);
    }
}


export function initializeEventListeners(imageCache, flatpickr) {
    saveShareBtn = document.getElementById('save-share-btn');
    categoryFiltersContainer = document.getElementById('category-filters');
    subcategoryFiltersContainer = document.getElementById('subcategory-filters');
    let debugEnabled = false;
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) element.addEventListener(event, handler);
        else console.warn(`Element with ID "${selector}" not found.`);
    };

    // ... (keep betaTrigger, window.scroll, category setup, and all filter listeners the same) ...
    const betaTrigger = document.getElementById('beta-trigger');
    if (betaTrigger) {
        betaTrigger.addEventListener('click', () => {
            debugEnabled = !debugEnabled;
            setDebugMode(debugEnabled);
            log('Debug', `Debug mode is now ${debugEnabled ? 'ON' : 'OFF'}.`);
        });
    }

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
    
    currentStore = state.records.all.find(r => r.fields.Name === "Tyler's Mystery Tours");
    if (currentStore) {
        const categories = ui.parseOptions(currentStore.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        const allButton = document.createElement('button');
        allButton.className = 'filter-btn category-filter-btn active';
        allButton.dataset.filter = 'all';
        allButton.textContent = 'All';
        categoryFiltersContainer.appendChild(allButton);
        categories.forEach((cat) => {
            const button = document.createElement('button');
            button.className = 'filter-btn category-filter-btn';
            button.dataset.filter = cat.name.toLowerCase();
            button.textContent = cat.name;
            categoryFiltersContainer.appendChild(button);
        });
        updateSubcategoryButtons();
    }
    
    safeAddEventListener('category-filters', 'click', (e) => {
        if (e.target.classList.contains('category-filter-btn')) {
            document.querySelectorAll('#category-filters .filter-btn').forEach(btn => btn.classList.remove('active'));
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
        const allButton = categoryFiltersContainer.querySelector('.filter-btn[data-filter="all"]');
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
        enableTime: true,
        dateFormat: "M j, Y h:i K",
        onChange: async (selectedDates) => {
            if (state.ui.isInitializing) return;
            if (selectedDates.length > 0) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                triggerSave();
                await updateAllCardAvailabilityIcons();
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                triggerSave();
                await updateAllCardAvailabilityIcons();
            }
            ui.updateItineraryModalHeader();
        },
    });

    const dateFilterGroup = document.getElementById('date-filter-group');
    if (dateFilterGroup) {
        dateFilterGroup.addEventListener('click', (e) => {
            const quickButton = e.target.closest('.filter-btn[data-date-quick]');
            if (quickButton) {
                const today = new Date();
                today.setHours(9, 0, 0, 0); // Start events at 9am
                let startDate = new Date(today);
                let endDate = new Date(today);
                endDate.setHours(17, 0, 0, 0); // End events at 5pm
                switch (quickButton.dataset.dateQuick) {
                    case 'tomorrow':
                        startDate.setDate(today.getDate() + 1);
                        endDate.setDate(today.getDate() + 1);
                        break;
                    case 'this-week':
                        startDate.setDate(today.getDate() + 1);
                        endDate.setDate(today.getDate() + 7);
                        break;
                    case 'next-2-weeks':
                        startDate.setDate(today.getDate() + 1);
                        endDate.setDate(today.getDate() + 14);
                        break;
                }
                mainDatePicker.setDate([startDate, endDate], true);
            }
        });
    }

    safeAddEventListener('header-event-name', 'change', (e) => {
        if (state.ui.isInitializing) return;
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
        ui.updateItineraryModalHeader();
    });
    safeAddEventListener('header-goals', 'change', (e) => {
        if (state.ui.isInitializing) return;
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
        ui.updateItineraryModalHeader();
    });

    // --- FIX: Reverted to the last known-good click handler architecture and extended it ---
    document.body.addEventListener('click', async (e) => {
        if (state.ui.isInitializing) return;
        
        const card = e.target.closest('.event-card');
        const heartIcon = e.target.closest('.heart-icon');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const addToPlanBtn = e.target.closest('.add-to-plan-btn, #modal-add-to-plan-btn');
        const favoriteItem = e.target.closest('.favorite-item');
        const removeBtnInFavorite = favoriteItem?.querySelector('.remove-btn');
        const checkoutBtn = e.target.closest('#checkout-btn');
        const lockedItemCard = e.target.closest('.locked-item-card');
        const demoteBtn = e.target.closest('.demote-locked-item-btn');
        const itineraryItem = e.target.closest('.itinerary-item'); // New target

        if (saveShareBtn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            });
        } else if (checkoutBtn) {
            ui.showCheckoutModal();
        } else if (heartIcon) {
            e.stopPropagation();
            const recordId = heartIcon.closest('[data-record-id]').dataset.recordId;
            const isLocked = state.cart.lockedItems.has(recordId);
            if (!isLocked) {
                if (state.cart.items.has(recordId)) {
                    state.cart.items.delete(recordId);
                } else {
                    ui.updateItemState(recordId, {});
                }
                ui.updateAllUI(recordId);
                triggerSave();
            }
        } else if (addToPlanBtn) {
            e.stopPropagation();
            const recordId = addToPlanBtn.closest('[data-record-id]').dataset.recordId;
            const isLocked = state.cart.lockedItems.has(recordId);
            if (isLocked) {
                ui.hideDetailModal();
                return;
            }
            const itemInfo = ui.getItemState(recordId);
            state.cart.lockedItems.set(recordId, itemInfo);
            state.cart.items.delete(recordId);
            ui.updateAllUI(recordId);
            triggerSave();
        } else if (demoteBtn) {
            e.stopPropagation();
            const recordId = demoteBtn.closest('[data-record-id]').dataset.recordId;
            if (state.cart.lockedItems.has(recordId)) {
                const itemInfo = state.cart.lockedItems.get(recordId);
                state.cart.lockedItems.delete(recordId);
                state.cart.items.set(recordId, itemInfo);
                ui.updateAllUI(recordId);
                triggerSave();
            }
        } else if (removeBtnInFavorite && e.target === removeBtnInFavorite) {
            e.stopPropagation();
            const recordId = favoriteItem.dataset.recordId;
            state.cart.items.delete(recordId);
            ui.updateAllUI(recordId);
            triggerSave();
        } 
        else if (card) {
            const isQuantityClick = e.target.closest('.quantity-selector');
            if (!isQuantityClick) {
                const recordId = card.dataset.recordId;
                const record = state.records.all.find(r => r.id === recordId);
                if (record) ui.showDetailModal(record);
            }
        } 
        else if (lockedItemCard) {
            const recordId = lockedItemCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        }
        // --- NEW: Add handler for itinerary items, checking it wasn't a remove button click ---
        else if (itineraryItem && !e.target.closest('.remove-btn')) {
             const recordId = itineraryItem.dataset.recordId;
             const record = state.records.all.find(r => r.id === recordId);
             if (record) ui.showDetailModal(record);
        }
        else if (favoriteItem) {
            const interactiveElements = e.target.closest('.add-to-plan-btn, .remove-btn');
            if (!interactiveElements) {
                const recordId = favoriteItem.dataset.recordId;
                const record = state.records.all.find(r => r.id === recordId);
                if (record) ui.showDetailModal(record);
            }
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
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, [selectedDates[0].toISOString()]);
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
            }
            await ui.updateEventPlanDateDisplay();
            await ui.updateLockedItemStatusIcons();
            triggerSave();
            ui.updateItineraryModalHeader();
        }
    });
    safeAddEventListener('itinerary-btn', 'click', () => {
        log('Events', 'Event Plan button clicked, showing Canvas page.');
        ui.showCanvasPage(); // Use the new full-page canvas function
    });
    safeAddEventListener('payment-form', 'submit', handlePaymentFormSubmit);

    return { mainDatePicker, eventPlanDatePicker };
}

export function initializeChatEventListeners() {
    // ... (This function is unchanged) ...
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
        if (chatWidgetContainer && !chatWidgetContainer.contains(event.target) && chatWidgetContainer.classList.contains('chat-open')) {
            toggleChatWindow(true);
        }
    });
}
