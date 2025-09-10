// FILE: events.js
/*
* Version: 4.9.4
* Last Modified: 2025-09-09
* Changelog:
* v4.9.4 - 2025-09-09
* - Fixed category/subcategory bug by correctly parsing options from the category record.
* - Ensured search functionality operates on the correct data set.
* v4.9.3 - 2025-09-09
* - Updated `events.js` to integrate with the new `itinerary.js` modal logic.
* - `itinerary-btn` now correctly shows the full-screen itinerary modal.
* v4.9.2 - 2025-09-09
* - Fixed bug where Airtable 'Date' field would not accept date range array.
* - Corrected a TypeError in `updateTotalCost` by fixing the property access.
* - Ensured page title updates correctly with the event name.
* - Fixed `ui.checkAvailability is not a function` error in the itinerary module.
* v4.9.1 - 2025-09-09
* - Implemented dynamic availability for locked-in items and the event plan date.
* - Synced the detail modal calendar with the event plan date.
* - Updated event handlers for adding/removing items to trigger an availability refresh.
* v4.9.0 - 2025-09-09
* - Finalized itinerary builder functionality with live editing and date sync.
* v4.8.9 - 2025-09-09
* - Added functionality to open the new itinerary builder modal.
* v4.8.8 - 2025-09-09
* - Fixed SyntaxError: Corrected import of getItemState from events.js to ui.js.
* - Added functionality for carousel navigation buttons.
* v4.8.7 - 2025-09-08
* - Corrected a ReferenceError by providing flatpickr as a global object to the event listeners.
* v4.8.6 - 2025-09-08
* - Added functionality to update the header calendar based on favorited items.
* v4.8.5 - 2025-09-02
* - Added initial localStorage clear to mitigate FILE_ERROR_NO_SPACE.
* v4.8.4 - 2025-09-02
* - Added debug logging for initialization steps.
* v4.8.3 - 2025-09-02
* - Continue initialization if session loading fails due to storage errors.
* v4.8.2 - 2025-09-02
* - Added retry logic for fetchAllRecords to handle transient errors.
* v4.8.1 - 2025-09-02
* - Added storage error handling during initialization.
*/
import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as ui from './ui.js';
import * as api from './api.js';
import { applyFiltersAndSort } from './filtering.js';
import { log, setDebugMode } from './utils/debug.js';
import { AVAILABILITY_STATUS, getDayStatus, checkAvailability } from './availability.js';
import { debounce } from './utils.js';
import { showItineraryModal } from './components/itinerary.js';

let mainDatePicker = null;
let saveTimeout = null;
const saveShareBtn = document.getElementById('save-share-btn');
const categoryFiltersContainer = document.getElementById('category-filters');
const subcategoryFiltersContainer = document.getElementById('subcategory-filters');
let currentStore = null;

function getCurrentCategoryRecord() {
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

// FIX: Add the 'export' keyword to make this function available to other modules
export function triggerSave() {
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

// Fix: Accept flatpickr as a parameter
export function initializeEventListeners(imageCache, flatpickr) {
    let debugEnabled = false;
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) element.addEventListener(event, handler);
        else console.warn(`Element with ID "${selector}" not found.`);
    };

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
    
    // --- UPDATED: Logic for Store and Categories ---
    currentStore = state.records.all.find(r => r.fields.Name === "Tyler's Mystery Tours");
    if (currentStore) {
        // FIX: The line below is no longer needed as the store title is now static HTML
        // document.getElementById('store-display').textContent = currentStore.fields.Name;
        const categories = ui.parseOptions(currentStore.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
        // FIX: Create buttons instead of dropdown options
        categories.forEach((cat, index) => {
            const button = document.createElement('button');
            button.className = 'filter-btn category-filter-btn';
            button.dataset.filter = cat.name.toLowerCase();
            button.textContent = cat.name;
            if (index === 0) {
                button.classList.add('active'); // Select the first category by default
            }
            categoryFiltersContainer.appendChild(button);
        });
        // Call to update subcategories based on the default selected category
        updateSubcategoryButtons();
    }
    
    // FIX: Remove the old dropdown event listener and add a new one for buttons
    // safeAddEventListener('category-filter-dropdown', 'change', () => {
    //     updateSubcategoryButtons();
    //     applyFiltersAndSort(imageCache);
    // });
    safeAddEventListener('category-filters', 'click', (e) => {
        if (e.target.classList.contains('category-filter-btn')) {
            categoryFiltersContainer.querySelectorAll('.category-filter-btn').forEach(btn => btn.classList.remove('active'));
            e.target.classList.add('active');
            updateSubcategoryButtons();
            applyFiltersAndSort(imageCache);
        }
    });
    // END FIX

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
        // --- UPDATED: Reset logic for new category/subcategory structure
        if (currentStore) {
            const categories = ui.parseOptions(currentStore.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
            const firstCategoryBtn = categoryFiltersContainer.querySelector(`.category-filter-btn[data-filter="${categories[0]?.name.toLowerCase()}"]`);
            if (firstCategoryBtn) {
                categoryFiltersContainer.querySelectorAll('.category-filter-btn').forEach(btn => btn.classList.remove('active'));
                firstCategoryBtn.classList.add('active');
            }
            updateSubcategoryButtons();
        }
        document.querySelectorAll('#subcategory-filters .subcategory-filter-btn.active').forEach(btn => {
            btn.classList.remove('active');
        });
        // --- END UPDATED
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
            if (selectedDates.length > 0) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                triggerSave();
                await updateAllCardAvailabilityIcons();
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                triggerSave();
                await updateAllCardAvailabilityIcons();
            }
        },
    });
    const dateFilterGroup = document.getElementById('date-filter-group');
    if (dateFilterGroup) {
        dateFilterGroup.addEventListener('click', (e) => {
            const button = e.target.closest('[data-date-quick]');
            if (!button || !mainDatePicker) return;
            const quickAction = button.dataset.dateQuick;
            let startDate = new Date();
            let endDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            endDate.setHours(23, 59, 59, 999);
            switch (quickAction) {
                case 'tomorrow':
                    startDate.setDate(startDate.getDate() + 1);
                    endDate.setDate(endDate.getDate() + 1);
                    break;
                case 'this-week':
                    const dayOfWeek = startDate.getDay();
                    const daysUntilSaturday = 6 - dayOfWeek;
                    endDate.setDate(startDate.getDate() + daysUntilSaturday);
                    break;
                case 'next-2-weeks':
                    endDate.setDate(startDate.getDate() + 14);
                    break;
            }
            mainDatePicker.setDate([startDate, endDate], true);
        });
    }

    safeAddEventListener('header-event-name', 'change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        triggerSave();
    });
    safeAddEventListener('header-goals', 'change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        triggerSave();
    });
    safeAddEventListener('payment-form', 'submit', async (e) => {
        e.preventDefault();
        const { stripe, cardElement, clientSecret } = ui.getStripeContext();
        if (!stripe || !cardElement || !clientSecret) return;
        const { error } = await stripe.confirmCardPayment(clientSecret, {
            payment_method: {
                card: cardElement,
                billing_details: {
                    name: document.getElementById('customer-name').value,
                    email: document.getElementById('customer-email').value,
                },
            },
        });
        const cardErrors = document.getElementById('card-errors');
        if (error) cardErrors.textContent = error.message;
        else {
            cardErrors.textContent = '';
            alert('Payment successful! Your event is booked.');
            ui.hideCheckoutModal();
        }
    });
    safeAddEventListener('checkout-close-btn', 'click', ui.hideCheckoutModal);
    safeAddEventListener('checkout-modal-overlay', 'click', (e) => {
        if (e.target.id === 'checkout-modal-overlay') {
            ui.hideCheckoutModal();
        }
    });
    window.addEventListener('beforeunload', (e) => {
        if (state.ui.saveState === 'MODIFIED' || state.ui.saveState === 'SAVING') {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    });
    document.body.addEventListener('click', async (e) => {
        const card = e.target.closest('.event-card');
        const heartIcon = e.target.closest('.heart-icon');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const addToPlanBtn = e.target.closest('.add-to-plan-btn, #modal-add-to-plan-btn');
        const favoriteItem = e.target.closest('.favorite-item');
        const removeBtn = favoriteItem?.querySelector('.remove-btn');
        const demoteBtn = e.target.closest('.demote-locked-item-btn');
        const editBtn = e.target.closest('.edit-btn');
        const checkoutBtn = e.target.closest('#checkout-btn');
        const optionBtn = e.target.closest('.option-btn');
        const parentLink = e.target.closest('.parent-link');
        const heartIconModal = e.target.closest('#modal-heart-btn');
        const lockedItemCard = e.target.closest('.locked-item-card');

        if (saveShareBtn) {
            navigator.clipboard.writeText(window.location.href).then(() => {
                const originalText = saveShareBtn.textContent;
                saveShareBtn.textContent = 'Copied!';
                setTimeout(() => { saveShareBtn.textContent = originalText; }, 1500);
            });
        } else if (checkoutBtn) {
            ui.showCheckoutModal();
        } else if (heartIcon || heartIconModal) {
            e.stopPropagation();
            const recordId = (heartIcon || heartIconModal).closest('[data-record-id]').dataset.recordId;
            const isLocked = state.cart.lockedItems.has(recordId);
            if (isLocked) {
                const itemInfo = state.cart.lockedItems.get(recordId);
                state.cart.lockedItems.delete(recordId);
                state.cart.items.set(recordId, itemInfo);
                await ui.updateEventPlanSection();
            } else {
                if (state.cart.items.has(recordId)) {
                    state.cart.items.delete(recordId);
                } else {
                    ui.updateItemState(recordId, {});
                }
            }
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
            ui.updateTotalCost();
            if (state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE)) {
                await ui.updateLockedItemStatusIcons();
                await ui.updateEventPlanDateDisplay();
            }
            triggerSave();
        } else if (addToPlanBtn) {
            e.stopPropagation();
            const container = addToPlanBtn.closest('[data-record-id]');
            const recordId = container.dataset.recordId;
            const mode = container.dataset.mode;
            let itemInfo;
            if (mode === 'edit-locked') {
                const quantityInput = document.querySelector('#modal-quantity-selector .quantity-input');
                const selectedOptionEl = document.querySelector('#modal-options-container .option-btn.selected');
                const noteInput = document.getElementById('modal-item-note');
                itemInfo = {
                    quantity: quantityInput ?
                        parseInt(quantityInput.value, 10) : 1,
                    selectedOptionIndex: selectedOptionEl ?
                        parseInt(selectedOptionEl.dataset.optionIndex, 10) : 0,
                    note: noteInput ?
                        noteInput.value.trim() : ''
                };
                ui.updateLockedItemState(recordId, itemInfo);
            } else {
                itemInfo = ui.getItemState(recordId);
                state.cart.lockedItems.set(recordId, itemInfo);
                state.cart.items.delete(recordId);
            }
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
            await ui.updateEventPlanSection();
            ui.updateTotalCost();
            if (state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE)) {
                await ui.updateEventPlanDateDisplay();
                await ui.updateLockedItemStatusIcons();
            }
            triggerSave();
            if (container.id === 'detail-modal-overlay') {
                ui.hideDetailModal();
            }
        } else if (demoteBtn) {
            e.stopPropagation();
            const lockedItemCard = demoteBtn.closest('.locked-item-card');
            if (!lockedItemCard) return;
            const recordId = lockedItemCard.dataset.recordId;
            const itemInfo = state.cart.lockedItems.get(recordId);
            state.cart.lockedItems.delete(recordId);
            state.cart.items.set(recordId, itemInfo);
            ui.updateCardIcon(recordId);
            await ui.updateEventPlanSection();
            await debounce(ui.updateFavoritesCarousel, 300)();
            ui.updateTotalCost();
            if (state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE)) {
                await ui.updateEventPlanDateDisplay();
                await ui.updateLockedItemStatusIcons();
            }
            triggerSave();
        } else if (removeBtn && e.target === removeBtn) {
            e.stopPropagation();
            const recordId = favoriteItem.dataset.recordId;
            state.cart.items.delete(recordId);
            ui.updateCardIcon(recordId);
            await debounce(ui.updateFavoritesCarousel, 300)();
            if (state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE)) {
                await ui.updateEventPlanDateDisplay();
            }
            triggerSave();
        } else if (lockedItemCard) { // New condition for clicking on a locked-in item card
            const recordId = lockedItemCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        } else if (optionBtn) {
            const childName = optionBtn.dataset.childName;
            if (childName) {
                const childRecord = state.records.all.find(r => r.fields.Name === childName);
                if (childRecord) ui.showDetailModal(childRecord);
            } else {
                const modalOptionsContainer = optionBtn.closest('#modal-options-container');
                if (modalOptionsContainer) {
                    modalOptionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
                    optionBtn.classList.add('selected');
                    const newIndex = parseInt(optionBtn.dataset.optionIndex, 10);
                    optionBtn.dispatchEvent(new CustomEvent('change', {
                        bubbles: true,
                        detail: { selectedOptionIndex: newIndex }
                    }));
                }
            }
        } else if (parentLink) {
            const parentName = parentLink.dataset.parentName;
            const parentRecord = state.records.all.find(r => r.id === parentName);
            if (parentRecord) ui.showDetailModal(parentRecord);
        } else if (card) {
            const interactiveElements = e.target.closest('.card-action-btn, .quantity-selector, .parent-link, .availability-btn');
            if (!interactiveElements) {
                const recordId = card.dataset.recordId;
                const record = state.records.all.find(r => r.id === recordId);
                if (record) ui.showDetailModal(record);
            }
        } else if (favoriteItem) {
            const interactiveElements = e.target.closest('.add-to-plan-btn, .remove-btn');
            if (!interactiveElements) {
                const recordId = favoriteItem.dataset.recordId;
                const record = state.records.all.find(r => r.id === recordId);
                if (record) ui.showDetailModal(record);
            }
        }
    });
    document.body.addEventListener('change', (e) => {
        const target = e.target;
        const modal = document.getElementById('detail-modal-overlay');
        const container = target.closest('[data-record-id]');
        const isInModal = modal && modal.style.display === 'flex' && modal.contains(target);
        const isEditLockedMode = isInModal && modal.dataset.mode === 'edit-locked';
        if (!container) return;
        const recordId = container.dataset.datasetrecordId;
        let updates = {};
        if (target.matches('.quantity-input')) {
            updates.quantity = parseInt(target.value, 10);
        } else if (target.matches('.configure-options')) {
            updates.selectedOptionIndex = parseInt(target.value, 10);
        } else if (target.matches('.item-note, #modal-item-note')) {
            updates.note = target.value;
        } else if (target.matches('.option-btn')) {
            if (e.detail?.selectedOptionIndex !== undefined) {
                updates.selectedOptionIndex = e.detail.selectedOptionIndex;
            }
        }
        if (Object.keys(updates).length > 0) {
            if (isEditLockedMode) {
                ui.updateLockedItemState(recordId, updates);
                if (state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE)) {
                    ui.updateEventPlanDateDisplay();
                    ui.updateLockedItemStatusIcons();
                }
            } else {
                ui.updateItemState(recordId, updates);
                triggerSave();
                debounce(ui.updateFavoritesCarousel, 300)();
            }
        }
    });

    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) {
        const handleEventNameChange = () => {
            const newName = eventNameInput.value.trim();
            if (newName === '') {
                eventNameInput.value = 'Event Name';
            }
            state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, newName);
            ui.updateHeader();
            triggerSave();
        };

        eventNameInput.addEventListener('blur', handleEventNameChange);
        eventNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleEventNameChange();
            }
        });
    }

    const eventPlanDatePicker = flatpickr("#event-date-picker", {
        dateFormat: "M j, Y",
        onChange: async (selectedDates) => {
            if (selectedDates.length > 0) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates[0].toISOString());
                ui.updateEventPlanDateDisplay();
                ui.updateLockedItemStatusIcons();
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
                ui.updateEventPlanDateDisplay();
                ui.updateLockedItemStatusIcons();
            }
            triggerSave();
        }
    });
    
    // Add event listener for the Itinerary button
    safeAddEventListener('itinerary-btn', 'click', () => {
        log('Events', 'Itinerary button clicked, showing modal.');
        showItineraryModal();
    });

    return { mainDatePicker, eventPlanDatePicker };
}
