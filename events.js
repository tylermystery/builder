import { state } from './state.js';
import { CONSTANTS, RECORDS_PER_LOAD } from './config.js';
import * as api from './api.js';
import * as ui from './ui.js';
import { applyFiltersAndSort } from './filtering.js';
import { getDayStatus, checkAvailability, AVAILABILITY_STATUS } from './availability.js';
import { setDebugMode } from './utils/debug.js';

// Note: tippy.js is loaded globally via a CDN in index.html

// These variables are now scoped to the events module
let mainDatePicker = null;
let saveTimeout;
const saveShareBtn = document.getElementById('save-share-btn');

// --- UTILITY & HELPER FUNCTIONS ---

function debounce(func, delay = 300) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
}

export function getItemState(recordId) {
    const record = state.records.all.find(r => r.id === recordId);
    if (!record) return null;

    const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const defaultState = {
        quantity: headcountMin,
        selectedOptionIndex: 0,
        note: ''
    };
    return state.cart.items.get(recordId) || defaultState;
}

function updateItemState(recordId, updates) {
    if (!state.records.all.find(r => r.id === recordId)) return;
    
    if (!state.cart.items.has(recordId)) {
        state.cart.items.set(recordId, getItemState(recordId));
    }
    
    const currentState = state.cart.items.get(recordId);
    const newState = { ...currentState, ...updates };
    state.cart.items.set(recordId, newState);
    
    ui.updateFavoritesCarousel();
    triggerSave();
}

function updateLockedItemState(recordId, updates) {
    if (!state.cart.lockedItems.has(recordId)) return;
    
    const currentState = state.cart.lockedItems.get(recordId);
    const newState = { ...currentState, ...updates };
    state.cart.lockedItems.set(recordId, newState);
    
    ui.updateEventPlanPanel();
    ui.updateTotalCost();
    triggerSave();
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
            break;
        case 'SAVING':
            saveShareBtn.textContent = '⚙️ Saving...';
            saveShareBtn.disabled = true;
            break;
        case 'SAVED':
            saveShareBtn.textContent = '🔗 Copy Link';
            saveShareBtn.disabled = state.cart.lockedItems.size === 0;
            break;
    }
}

function triggerSave() {
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

async function updateAllCardAvailabilityIcons() {
    if (!mainDatePicker || mainDatePicker.selectedDates.length < 2) return;
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
            if (dayStatus === AVAILABILITY_STATUS.NONE || !isAvailable) {
                statusIcon = '❌'; statusText = 'Unavailable';
            } else if (dayStatus === AVAILABILITY_STATUS.PARTIAL) {
                statusIcon = '🟠'; statusText = 'Partially Available';
            } else {
                statusIcon = '✅'; statusText = 'Fully Available';
            }
            const dateString = startDate.toLocaleDateString();
            const tooltipContent = `<div style="text-align: left;"><strong>${dateString}</strong><hr style="margin: 2px 0 5px;"><span>${statusIcon} ${record.fields.Name}: ${statusText}</span></div>`;
            tippy(icon, { content: tooltipContent, allowHTML: true, placement: 'top', arrow: true });
            icon.title = statusText;
        }
    }
}


// --- INITIALIZER ---

export function initializeEventListeners(imageCache) {
    let debugEnabled = false;
    const betaTrigger = document.getElementById('beta-trigger');
    if (betaTrigger) {
        betaTrigger.addEventListener('click', () => {
            debugEnabled = !debugEnabled;
            setDebugMode(debugEnabled);
        });
    }  
    const safeAddEventListener = (selector, event, handler) => {
        const element = document.getElementById(selector);
        if (element) element.addEventListener(event, handler);
        else console.warn(`Element with ID "${selector}" not found.`);
    };

    let scrollTimeout;
    window.addEventListener('scroll', () => {
        if (scrollTimeout) return;
        scrollTimeout = setTimeout(() => {
            const buffer = 300;
            if ((window.innerHeight + window.scrollY) >= document.body.offsetHeight - buffer) {
                loadMoreRecords(imageCache);
            }
            scrollTimeout = null;
        }, 100);
    });

    const categoryFilters = document.getElementById('category-filters');
    if (categoryFilters) {
        categoryFilters.addEventListener('click', (e) => {
            if (e.target.classList.contains('category-filter-btn')) {
                e.target.classList.toggle('active');
                applyFiltersAndSort(imageCache);
            }
        });
    }

    safeAddEventListener('status-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('name-filter', 'input', debounce(() => applyFiltersAndSort(imageCache)));
    safeAddEventListener('headcount-custom', 'input', debounce(() => applyFiltersAndSort(imageCache)));
    safeAddEventListener('headcount-filter', 'change', (e) => {
        document.getElementById('headcount-custom').style.display = (e.target.value === 'custom') ? 'block' : 'none';
        applyFiltersAndSort(imageCache);
    });
    safeAddEventListener('location-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('budget-filter', 'change', () => applyFiltersAndSort(imageCache));
    safeAddEventListener('sort-by', 'change', () => applyFiltersAndSort(imageCache));

    safeAddEventListener('reset-filters-btn', 'click', () => {
        document.querySelectorAll('#category-filters .category-filter-btn.active').forEach(btn => {
            btn.classList.remove('active');
        });
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
        onClose: (selectedDates) => {
            if (selectedDates.length === 2) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
                triggerSave();
                updateAllCardAvailabilityIcons();
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
                    const dayOfWeek = startDate.getDay(); // 0=Sun, 6=Sat
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

    window.addEventListener('beforeunload', (e) => {
        if (state.ui.saveState === 'MODIFIED' || state.ui.saveState === 'SAVING') {
            e.preventDefault();
            e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        }
    });

    document.body.addEventListener('click', async (e) => {
        if (e.target.matches('#detail-modal-overlay, #modal-close-btn')) { ui.hideDetailModal(); return; }
        if (e.target.matches('#checkout-modal-overlay, #checkout-close-btn')) { ui.hideCheckoutModal(); return; }
        
        const card = e.target.closest('.event-card');
        const heartIcon = e.target.closest('.heart-icon:not(.locked)');
        const saveShareBtn = e.target.closest('#save-share-btn');
        const addToPlanBtn = e.target.closest('.add-to-plan-btn, #modal-add-to-plan-btn');
        const favoriteItem = e.target.closest('.favorite-item');
        const removeBtn = favoriteItem?.querySelector('.remove-btn');
        const editBtn = e.target.closest('.edit-btn');
        const removeLockedItemBtn = e.target.closest('.remove-locked-item-btn');
        const checkoutBtn = e.target.closest('#checkout-btn');

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
            if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
            } else {
                updateItemState(recordId, {});
            }
            ui.updateCardIcon(recordId);
            await ui.updateFavoritesCarousel();
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
                    quantity: quantityInput ? parseInt(quantityInput.value, 10) : 1,
                    selectedOptionIndex: selectedOptionEl ? parseInt(selectedOptionEl.dataset.optionIndex, 10) : 0,
                    note: noteInput ? noteInput.value.trim() : ''
                };
                updateLockedItemState(recordId, itemInfo);
            } else {
                itemInfo = getItemState(recordId);
                state.cart.lockedItems.set(recordId, itemInfo);
                state.cart.items.delete(recordId);
            }
            
            ui.updateCardIcon(recordId);
            await ui.updateFavoritesCarousel();
            await ui.updateEventPlanPanel();
            ui.updateTotalCost();
            triggerSave();
            
            if (container.id === 'detail-modal-overlay') {
                ui.hideDetailModal();
            }
        } else if (editBtn) {
            const lockedItemCard = editBtn.closest('.locked-item-card');
            if (!lockedItemCard) return;
            const recordId = lockedItemCard.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        } else if (removeLockedItemBtn) {
             const lockedItemCard = removeLockedItemBtn.closest('.locked-item-card');
             if (!lockedItemCard) return;
             const recordId = lockedItemCard.dataset.recordId;
             state.cart.lockedItems.delete(recordId);
             ui.updateCardIcon(recordId);
             await ui.updateEventPlanPanel();
             ui.updateTotalCost();
             triggerSave();
        } else if (removeBtn && e.target === removeBtn) {
            e.stopPropagation();
            const recordId = favoriteItem.dataset.recordId;
            state.cart.items.delete(recordId);
            ui.updateCardIcon(recordId);
            await ui.updateFavoritesCarousel();
            triggerSave();
        } else if (favoriteItem) {
            const recordId = favoriteItem.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        } else if (card) {
            if (e.target.closest('.options-selector, .quantity-selector, .parent-link, .item-note, .heart-icon, .add-to-plan-btn')) return;
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if (record) ui.showDetailModal(record);
        }
    });

    document.body.addEventListener('change', (e) => {
        const target = e.target;
        const modal = document.getElementById('detail-modal-overlay');
        const container = target.closest('[data-record-id]');
        
        const isInModal = modal.style.display === 'flex' && modal.contains(target);
        const isEditLockedMode = isInModal && modal.dataset.mode === 'edit-locked';
        
        if (!container) return;
        const recordId = container.dataset.recordId;
        
        let updates = {};
        if (target.matches('.quantity-input')) {
            updates.quantity = parseInt(target.value, 10);
        } else if (target.matches('.configure-options')) {
            updates.selectedOptionIndex = parseInt(target.value, 10);
        } else if (target.matches('.item-note, #modal-item-note')) {
            updates.note = target.value;
        } else if (target.matches('.option-btn')) {
            if(e.detail?.selectedOptionIndex !== undefined) {
                 updates.selectedOptionIndex = e.detail.selectedOptionIndex;
            }
        }
        
        if (Object.keys(updates).length > 0) {
            if (isEditLockedMode) {
                updateLockedItemState(recordId, updates);
            } else {
                updateItemState(recordId, updates);
            }
        }
    });

    return mainDatePicker;
}
