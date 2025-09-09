// FILE: components/itinerary.js
import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { log } from '../utils/debug.js';
import { getDayStatus, AVAILABILITY_STATUS } from '../availability.js';
import { debounce } from '../utils.js';

let itineraryModal = null;
let lockedItemsList = null;
let favoritedItemsList = null;

export function initItinerary() {
    log('Itinerary', 'Initializing itinerary module.');
    itineraryModal = document.getElementById('itinerary-modal-overlay');
    lockedItemsList = document.getElementById('itinerary-locked-items');
    favoritedItemsList = document.getElementById('itinerary-favorited-items');
    const itineraryCloseBtn = document.getElementById('itinerary-close-btn');

    if (itineraryCloseBtn) {
        itineraryCloseBtn.addEventListener('click', hideItineraryModal);
    }
    
    // Listen for changes in the header date picker
    const eventDatePicker = document.getElementById('event-date-picker');
    if (eventDatePicker && eventDatePicker._flatpickr) {
        eventDatePicker._flatpickr.config.onChange.push(() => {
            if (itineraryModal.classList.contains('active')) {
                renderItinerary();
            }
        });
    }

    setupDragAndDrop();
}

export function showItineraryModal() {
    log('Itinerary', 'Showing itinerary modal.');
    itineraryModal.classList.add('active');
    itineraryModal.style.display = 'flex';
    document.body.classList.add('modal-open');
    renderItinerary();
}

export function hideItineraryModal() {
    log('Itinerary', 'Hiding itinerary modal.');
    itineraryModal.classList.remove('active');
    setTimeout(() => {
        itineraryModal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
}

export async function renderItinerary() {
    if (!lockedItemsList || !favoritedItemsList) return;
    
    log('Itinerary', 'Rendering itinerary items.');
    lockedItemsList.innerHTML = '';
    favoritedItemsList.innerHTML = '';

    const selectedDateISO = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    const selectedDate = selectedDateISO ? new Date(selectedDateISO) : null;
    
    // Render locked items
    if (state.cart.lockedItems.size === 0) {
        lockedItemsList.innerHTML = `<p class="description">No items in your plan yet. Drag items from the Ideas list to add them.</p>`;
    } else {
        const lockedItemIds = Array.from(state.cart.lockedItems.keys());
        for (const recordId of lockedItemIds) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const itemInfo = state.cart.lockedItems.get(recordId);
                const itemElement = await createItineraryItemElement(record, itemInfo, selectedDate);
                lockedItemsList.appendChild(itemElement);
            }
        }
    }
    
    // Render favorited items
    if (state.cart.items.size === 0) {
        favoritedItemsList.innerHTML = `<p class="description">No ideas yet. Find items in the catalog and click the heart icon to add them here!</p>`;
    } else {
        const favoritedItemIds = Array.from(state.cart.items.keys());
        for (const recordId of favoritedItemIds) {
            const record = state.records.all.find(r => r.id === recordId);
            if (record) {
                const itemInfo = state.cart.items.get(recordId);
                const itemElement = await createItineraryItemElement(record, itemInfo, selectedDate, false);
                favoritedItemsList.appendChild(itemElement);
            }
        }
    }
}

export function renderItineraryHeader() {
    const eventNameInput = document.getElementById('itinerary-event-name');
    const goalsInput = document.getElementById('itinerary-goals');
    const datePickerInput = document.getElementById('itinerary-date-picker');

    if (eventNameInput) {
        eventNameInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'My Awesome Event';
    }
    if (goalsInput) {
        goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
    }
    const date = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (date && datePickerInput && datePickerInput._flatpickr) {
        datePickerInput._flatpickr.setDate(new Date(date), true);
    }

    eventNameInput.addEventListener('change', debounce((e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        ui.updateHeader();
    }, 500));
    goalsInput.addEventListener('change', debounce((e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
    }, 500));
}

async function createItineraryItemElement(record, itemInfo, selectedDate, isLocked = true) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = 'itinerary-item';
    itemElement.dataset.recordId = record.id;
    itemElement.draggable = true;

    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    const options = ui.parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let optionName = '';
    if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
        optionName = options[itemInfo.selectedOptionIndex].name;
    }
    const price = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);
    const total = price * itemInfo.quantity;
    
    let statusIconHTML = '';
    if (selectedDate && record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL]) {
        const busyTimes = await api.fetchCalendarForRecord(record);
        const dayStatus = await getDayStatus(selectedDate, busyTimes, record);
        let iconChar = '';
        let iconClass = '';
        switch (dayStatus.status) {
            case AVAILABILITY_STATUS.FULL:
                iconChar = '✅';
                iconClass = 'available-full';
                break;
            case AVAILABILITY_STATUS.PARTIAL:
                iconChar = '🟠';
                iconClass = 'available-partial';
                break;
            case AVAILABILITY_STATUS.NONE:
                iconChar = '❌';
                iconClass = 'unavailable';
                break;
        }
        statusIconHTML = `<span class="locked-item-status-icon ${iconClass}" title="${dayStatus.reason}">${iconChar}</span>`;
    }

    let actionsHTML = '';
    if (isLocked) {
        actionsHTML = `
            <div class="locked-item-actions">
                ${statusIconHTML}
                <button class="demote-locked-item-btn" title="Return to Ideas">💡</button>
            </div>
        `;
    } else {
         actionsHTML = `
            <div class="locked-item-actions">
                <button class="add-to-plan-btn" title="Add to Plan">+</button>
                <button class="remove-btn" title="Remove">×</button>
            </div>
        `;
    }
    

    itemElement.innerHTML = `
        <img src="${imageUrls[0] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`}" class="locked-item-thumbnail" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${optionName ? `<p class="locked-item-option">${optionName}</p>` : ''}
            ${isLocked ? `<p class="locked-item-pricing">Qty ${itemInfo.quantity} @ $${price.toFixed(2)} = <strong>$${total.toFixed(2)}</strong></p>` : ''}
            ${isLocked ? `<textarea class="itinerary-item-note" placeholder="Add a note...">${itemInfo.note || ''}</textarea>` : ''}
        </div>
        ${actionsHTML}
    `;

    if(isLocked) {
        const quantityInput = itemElement.querySelector('.quantity-input');
        if(quantityInput) {
            quantityInput.addEventListener('change', debounce((e) => {
                ui.updateLockedItemState(record.id, { quantity: parseInt(e.target.value, 10) });
                ui.updateTotalCost();
            }, 500));
        }

        const noteInput = itemElement.querySelector('.itinerary-item-note');
        if(noteInput) {
            noteInput.addEventListener('change', debounce((e) => {
                ui.updateLockedItemState(record.id, { note: e.target.value });
            }, 500));
        }
    }


    return itemElement;
}


function setupDragAndDrop() {
    if (!window.Sortable) {
        console.error("Sortable.js is not loaded.");
        return;
    }
    
    // Sortable list for the Event Plan
    new Sortable(lockedItemsList, {
        group: 'shared',
        animation: 150,
        ghostClass: 'ghost',
        onEnd: function (evt) {
            const item = evt.item;
            const recordId = item.dataset.recordId;
            const itemInfo = state.cart.items.get(recordId) || state.cart.lockedItems.get(recordId);

            // Item moved from Ideas to Event Plan
            if (evt.to === lockedItemsList && evt.from === favoritedItemsList) {
                state.cart.items.delete(recordId);
                state.cart.lockedItems.set(recordId, itemInfo);
                ui.updateCardIcon(recordId);
                ui.updateTotalCost();
                ui.updateEventPlanDateDisplay();
                ui.updateLockedItemStatusIcons();
            }
            
            // Reordering items within the Event Plan
            const newOrder = Array.from(lockedItemsList.children).map(child => child.dataset.recordId);
            const newLockedItems = new Map(newOrder.map(id => [id, state.cart.lockedItems.get(id)]));
            state.cart.lockedItems = newLockedItems;
        }
    });

    // Sortable list for Ideas
    new Sortable(favoritedItemsList, {
        group: 'shared',
        animation: 150,
        ghostClass: 'ghost',
        onAdd: function (evt) {
            const item = evt.item;
            const recordId = item.dataset.recordId;
            const itemInfo = state.cart.lockedItems.get(recordId);

            // Item moved from Event Plan to Ideas
            if (evt.to === favoritedItemsList) {
                state.cart.lockedItems.delete(recordId);
                state.cart.items.set(recordId, itemInfo);
                ui.updateCardIcon(recordId);
                ui.updateTotalCost();
                ui.updateEventPlanDateDisplay();
                ui.updateLockedItemStatusIcons();
            }
        }
    });

    lockedItemsList.addEventListener('click', (e) => {
        const card = e.target.closest('.itinerary-item');
        if (card) {
            const recordId = card.dataset.recordId;
            const record = state.records.all.find(r => r.id === recordId);
            if(record) {
                ui.showDetailModal(record);
            }
        }
    });
}
