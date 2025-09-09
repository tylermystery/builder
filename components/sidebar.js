import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { parseOptions } from '../utils.js';
import { log } from '../utils/debug.js';
import { getDayStatus, AVAILABILITY_STATUS } from '../availability.js';

async function createFavoriteCardElement(record, itemInfo, imageCache) {
    const fields = record.fields;
    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item`;
    itemCard.dataset.recordId = record.id;
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
    itemCard.style.backgroundImage = `url('${imageUrls[0] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`}')`;
    const price = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);
    const tooltipContent = `
        <strong>${fields.Name || 'Untitled'}</strong>
        <br>
        <small>${fields.Description || 'No description.'}</small>
        <br>
        <strong>Price: $${price.toFixed(2)}</strong>
    `;
    itemCard.innerHTML = `
        <div class="card-actions">
            <button class="action-btn add-to-plan-btn" title="Add to Plan">+</button>
            <button class="action-btn remove-btn" title="Remove">×</button>
        </div>
        <div class="favorite-item-overlay"
            data-tippy-content="${tooltipContent.replace(/"/g, '&quot;')}"
        >
            <span class="favorite-item-name">${fields.Name || 'Untitled'}</span>
        </div>
    `;

    tippy(itemCard.querySelector('.favorite-item-overlay'), {
        content: tooltipContent,
        allowHTML: true,
        placement: 'top',
        theme: 'light',
    });
    return itemCard;
}

async function createLockedInItemElement(record, itemInfo) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = 'locked-item-card';
    itemElement.dataset.recordId = record.id;

    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let optionName = '';
    if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
        optionName = options[itemInfo.selectedOptionIndex].name;
    }

    const price = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);
    const total = price * itemInfo.quantity;
    itemElement.innerHTML = `
        <img src="${imageUrls[0] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`}" class="locked-item-thumbnail" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${optionName ? `<p class="locked-item-option">${optionName}</p>` : ''}
            <p class="locked-item-pricing">Qty ${itemInfo.quantity} @ $${price.toFixed(2)} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="edit-btn">Edit</button>
            <button class="demote-locked-item-btn" title="Remove from Plan">Unsave</button>
        </div>
    `;
    return itemElement;
}

export async function updateEventPlanSection() {
    log('Sidebar', 'Updating event plan panel.');
    const container = document.getElementById('cart-items-container');
    if (!container) return;
    container.innerHTML = '';
    if (state.cart.lockedItems.size === 0) {
        container.innerHTML = `<p style="font-size: 0.9em; color: #6c757d;">No items locked in yet.</p>`;
        return;
    }
    const orderedIds = state.cart.orderedLockedItems;
    if (orderedIds.length > 0) {
        orderedIds.forEach(recordId => {
            const itemInfo = state.cart.lockedItems.get(recordId);
            const record = state.records.all.find(r => r.id === recordId);
            if (record && itemInfo) {
                const itemElement = createLockedInItemElement(record, itemInfo);
                container.appendChild(itemElement);
            }
        });
    } else {
        for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const itemElement = createLockedInItemElement(record, itemInfo);
                container.appendChild(itemElement);
            }
        }
    }
}

export async function updateFavoritesCarousel() {
    log('Sidebar', `Updating favorites carousel with ${state.cart.items.size} items.`);
    const favoritesSection = document.getElementById('favorites-section');
    const favoritesCarousel = document.getElementById('favorites-carousel');
    if (!favoritesSection || !favoritesCarousel) return;
    if (state.cart.items.size === 0) {
        favoritesSection.style.display = 'none';
        return;
    }
    favoritesSection.style.display = 'block';
    favoritesCarousel.innerHTML = '';
    const imageCache = new Map();
    for (const [recordId, itemInfo] of state.cart.items.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            try {
                const card = await createFavoriteCardElement(record, itemInfo, imageCache);
                if (card) favoritesCarousel.appendChild(card);
            } catch (error) {
                console.error(`Failed to create favorite card for ${record.fields.Name}:`, error);
            }
        }
    }
    updateTotalCost();
}

export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.title = eventName || 'Event Builder';
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) eventNameInput.value = eventName;
    
    const goalsInput = document.getElementById('header-goals');
    if (goalsInput) goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
}

export function updateTotalCost() {
    const totalCostEl = document.getElementById('total-cost');
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    if (!totalCostEl) return;

    let total = 0;
    const allItems = state.cart.lockedItems;
    allItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;
        const unitPrice = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] ? parseInt(record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN]) : 1;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, headcountMin);
        const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE]?.toLowerCase();
        let itemCost;
        if (pricingType === 'per hour' || pricingType === CONSTANTS.PRICING_TYPES.PER_GUEST) {
            itemCost = unitPrice * effectiveQuantity;
        } else {
            itemCost = unitPrice;
        }
        total += itemCost;
    });
    totalCostEl.textContent = `$${total.toFixed(2)}`;

    const isPlanEmpty = total === 0;
    if (checkoutBtn) {
        checkoutBtn.disabled = isPlanEmpty;
    }
    if (saveShareBtn) {
        if (isPlanEmpty) {
            saveShareBtn.disabled = true;
        } else if (state.ui.saveState === 'SAVED') {
            saveShareBtn.disabled = false;
        }
    }
}

// New function to update and populate the itinerary modal
export function updateItineraryModal() {
    log('Sidebar', 'Updating itinerary modal.');
    
    // Populate header fields from state
    const eventNameInput = document.getElementById('itinerary-event-name');
    const goalsInput = document.getElementById('itinerary-goals');
    const datePickerInput = document.getElementById('itinerary-date-picker');
    
    eventNameInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'My Awesome Event';
    goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
    
    // Sync header changes back to state and main view
    eventNameInput.addEventListener('change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        document.getElementById('header-event-name').value = e.target.value;
        document.title = e.target.value || 'Event Builder';
        log('Sidebar', `Updated event name to: ${e.target.value}`);
    });
    
    goalsInput.addEventListener('change', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        document.getElementById('header-goals').value = e.target.value;
        log('Sidebar', `Updated goals to: ${e.target.value}`);
    });
    
    // Init Flatpickr for itinerary date picker if not already
    if (!datePickerInput._flatpickr) {
        flatpickr(datePickerInput, {
            mode: 'single', // Simplified to single day for now
            dateFormat: 'Y-m-d',
            onChange: (selectedDates) => {
                if (selectedDates.length === 1) {
                    state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates);
                    // Sync to main date picker
                    const mainDatePicker = document.getElementById('date-filter')._flatpickr;
                    if (mainDatePicker) {
                        mainDatePicker.setDate(selectedDates, true);
                    }
                    updateItineraryItemAvailability(selectedDates);
                    log('Sidebar', `Updated date to: ${selectedDates[0]}`);
                }
            }
        });
    }
    
    // Set current date from state if available
    const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (savedDate && Array.isArray(savedDate) && savedDate.length >= 1) {
        datePickerInput._flatpickr.setDate(savedDate, true);
    }
    
    // Populate locked items column
    const lockedList = document.getElementById('itinerary-locked-items');
    lockedList.innerHTML = '';
    state.cart.orderedLockedItems.forEach(recordId => {
        const itemInfo = state.cart.lockedItems.get(recordId);
        const record = state.records.all.find(r => r.id === recordId);
        if (record && itemInfo) {
            const itemEl = createItineraryItemElement(record, itemInfo, true);
            lockedList.appendChild(itemEl);
        }
    });
    if (state.cart.lockedItems.size > 0 && state.cart.orderedLockedItems.length === 0) {
        state.cart.lockedItems.forEach((itemInfo, recordId) => {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const itemEl = createItineraryItemElement(record, itemInfo, true);
                lockedList.appendChild(itemEl);
                state.cart.orderedLockedItems.push(recordId);
            }
        });
    }
    
    // Populate favorited items column
    const favoritedList = document.getElementById('itinerary-favorited-items');
    favoritedList.innerHTML = '';
    state.cart.items.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const itemEl = createItineraryItemElement(record, itemInfo, false);
            favoritedList.appendChild(itemEl);
        }
    });
    
    // Init Sortable.js for both lists
    new Sortable(lockedList, {
        group: 'itinerary',
        animation: 150,
        ghostClass: 'ghost',
        onEnd: (evt) => handleItineraryDragEnd(evt)
    });
    
    new Sortable(favoritedList, {
        group: 'itinerary',
        animation: 150,
        ghostClass: 'ghost',
        onEnd: (evt) => handleItineraryDragEnd(evt)
    });
    
    // Update availability if date is set
    const currentDates = datePickerInput._flatpickr?.selectedDates || [];
    if (currentDates.length > 0) {
        updateItineraryItemAvailability(currentDates);
    }
}

// Helper to create an itinerary item element
function createItineraryItemElement(record, itemInfo, isLocked) {
    const fields = record.fields;
    const options = parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const optionName = options[itemInfo.selectedOptionIndex]?.name || '';
    const price = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);
    const total = price * itemInfo.quantity;
    
    const itemEl = document.createElement('div');
    itemEl.className = 'itinerary-item';
    itemEl.dataset.recordId = record.id;
    itemEl.innerHTML = `
        <img src="${fields[CONSTANTS.FIELD_NAMES.IMAGE_URL] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_50,h_50/ww71meppejsewxsxr4x7.jpg`}" alt="${fields.Name}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 4px;">
        <div style="flex-grow: 1;">
            <strong>${fields.Name}</strong>
            ${optionName ? `<p>${optionName}</p>` : ''}
            <div class="quantity-selector" style="display: flex; align-items: center; gap: 5px; margin: 5px 0;">
                <label style="font-size: 0.8em;">Qty:</label>
                <input type="number" class="quantity-input" value="${itemInfo.quantity}" min="1" style="width: 50px; text-align: center;">
                <span>@ $${price.toFixed(2)} = <strong class="item-total">$${total.toFixed(2)}</strong></span>
            </div>
            <div class="item-note-section" style="margin-top: 5px;">
                <label style="font-size: 0.8em;">Note:</label>
                <textarea class="item-note" placeholder="Add a note..." style="width: 100%; height: 60px; font-size: 0.8em; resize: vertical;">${itemInfo.note || ''}</textarea>
            </div>
            <div class="availability-status" style="font-size: 0.8em; color: gray;">Availability: Loading...</div>
        </div>
        <div class="locked-item-actions" style="margin-left: auto;">
            ${isLocked ? `<button class="edit-btn" style="font-size: 0.8em; padding: 4px 8px;">Edit</button>` : ''}
            <button class="remove-btn" style="background: none; border: none; font-size: 1.5em; cursor: pointer;">×</button>
        </div>
    `;
    
    // Add event listeners for editing
    const quantityInput = itemEl.querySelector('.quantity-input');
    const noteTextarea = itemEl.querySelector('.item-note');
    const totalSpan = itemEl.querySelector('.item-total');
    
    quantityInput.addEventListener('change', (e) => {
        const newQty = parseInt(e.target.value, 10) || 1;
        if (isLocked) {
            ui.updateLockedItemState(record.id, { quantity: newQty });
        } else {
            ui.updateItemState(record.id, { quantity: newQty });
        }
        const newTotal = price * newQty;
        totalSpan.textContent = `$${newTotal.toFixed(2)}`;
        updateTotalCost();
        log('Sidebar', `Updated quantity for ${record.id} to ${newQty}`);
    });
    
    noteTextarea.addEventListener('change', (e) => {
        const newNote = e.target.value;
        if (isLocked) {
            ui.updateLockedItemState(record.id, { note: newNote });
        } else {
            ui.updateItemState(record.id, { note: newNote });
        }
        log('Sidebar', `Updated note for ${record.id} to ${newNote}`);
    });
    
    // Add remove handler
    const removeBtn = itemEl.querySelector('.remove-btn');
    removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isLocked) {
            state.cart.lockedItems.delete(record.id);
            state.cart.orderedLockedItems = state.cart.orderedLockedItems.filter(id => id !== record.id);
            ui.updateEventPlanSection();
        } else {
            state.cart.items.delete(record.id);
            ui.updateFavoritesCarousel();
        }
        updateItineraryModal();
        ui.updateCardIcon(record.id);
        log('Sidebar', `Removed item ${record.id} from ${isLocked ? 'locked' : 'favorited'} list`);
    });
    
    // Edit button (optional, since inline editing is always on)
    if (isLocked) {
        const editBtn = itemEl.querySelector('.edit-btn');
        editBtn.addEventListener('click', () => {
            log('Sidebar', `Edit mode toggled for locked item: ${record.id}`);
        });
    }
    
    return itemEl;
}

// Handle drag-and-drop events
function handleItineraryDragEnd(evt) {
    const itemEl = evt.item;
    const recordId = itemEl.dataset.recordId;
    const fromList = evt.from.id === 'itinerary-locked-items' ? 'locked' : 'favorited';
    const toList = evt.to.id === 'itinerary-locked-items' ? 'locked' : 'favorited';
    
    if (fromList === toList) {
        if (fromList === 'locked') {
            state.cart.orderedLockedItems = Array.from(evt.to.children).map(child => child.dataset.recordId);
            log('Sidebar', `Reordered locked items: ${state.cart.orderedLockedItems.join(', ')}`);
            ui.updateEventPlanSection();
        }
        return;
    }
    
    const itemInfo = state.cart[fromList === 'locked' ? 'lockedItems' : 'items'].get(recordId);
    if (!itemInfo) return;
    
    if (toList === 'locked') {
        state.cart.items.delete(recordId);
        state.cart.lockedItems.set(recordId, itemInfo);
        state.cart.orderedLockedItems.push(recordId);
        ui.updateCardIcon(recordId);
        ui.updateFavoritesCarousel();
        ui.updateEventPlanSection();
    } else {
        state.cart.lockedItems.delete(recordId);
        state.cart.items.set(recordId, itemInfo);
        state.cart.orderedLockedItems = state.cart.orderedLockedItems.filter(id => id !== recordId);
        ui.updateCardIcon(recordId);
        ui.updateFavoritesCarousel();
        ui.updateEventPlanSection();
    }
    
    updateItineraryModal();
    log('Sidebar', `Moved item ${recordId} from ${fromList} to ${toList}`);
}

// Update item availability based on selected date
export async function updateItineraryItemAvailability(selectedDates) {
    if (!selectedDates || selectedDates.length < 1) return;
    
    const checkDate = selectedDates[0]; // Single day for simplicity
    
    const items = document.querySelectorAll('.itinerary-item');
    for (const itemEl of items) {
        const recordId = itemEl.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        
        let busyTimes = state.calendar.busyTimes.get(record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]);
        if (!busyTimes) {
            busyTimes = await api.fetchCalendarForRecord(record);
            state.calendar.busyTimes.set(record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL], busyTimes);
        }
        
        const statusObj = getDayStatus(checkDate, busyTimes, record);
        const statusEl = itemEl.querySelector('.availability-status');
        let icon = '', color = '';
        switch (statusObj.status) {
            case AVAILABILITY_STATUS.FULL:
                icon = '✅'; color = 'green';
                break;
            case AVAILABILITY_STATUS.PARTIAL:
                icon = '🟠'; color = 'orange';
                break;
            case AVAILABILITY_STATUS.NONE:
                icon = '❌'; color = 'red';
                break;
        }
        statusEl.innerHTML = `Availability: ${icon} ${statusObj.reason}`;
        statusEl.style.color = color;
        log('Sidebar', `Updated availability for ${record.id}: ${statusObj.status}`);
    }
}
