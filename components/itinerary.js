// FILE: components/itinerary.js
import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';
import { triggerSave } from '../events.js';
import { debounce } from '../utils.js';

const Sortable = window.Sortable;
const itineraryModal = document.getElementById('itinerary-modal-overlay');
const lockedItemsContainer = document.getElementById('itinerary-locked-items');
const favoritedItemsContainer = document.getElementById('itinerary-favorited-items');
const closeBtn = document.getElementById('itinerary-close-btn');

let lockedSortable, favoritedSortable, itineraryDatePicker;

/**
 * Initializes all event listeners for the itinerary modal, including SortableJS and header inputs.
 */
export function setupItineraryEventListeners() {
    log('Itinerary', 'Initializing Itinerary with SortableJS.');
    
    // SortableJS for the "Event Plan" (locked) items column
    lockedSortable = new Sortable(lockedItemsContainer, {
        group: 'shared',
        animation: 150,
        ghostClass: 'itinerary-item-ghost',
        onEnd: function(evt) {
            log('Itinerary', 'Drag ended in locked items list.');
            if (evt.from.id === evt.to.id) {
                const newOrder = lockedSortable.toArray();
                const newLockedItems = new Map();
                newOrder.forEach(recordId => {
                    if (state.cart.lockedItems.has(recordId)) {
                        newLockedItems.set(recordId, state.cart.lockedItems.get(recordId));
                    }
                });
                state.cart.lockedItems = newLockedItems;
            } else {
                const recordId = evt.item.dataset.recordId;
                if (state.cart.items.has(recordId)) {
                    const itemInfo = state.cart.items.get(recordId);
                    state.cart.items.delete(recordId);
                    state.cart.lockedItems.set(recordId, itemInfo);
                }
            }
            ui.updateAllUI();
            triggerSave();
        }
    });

    // SortableJS for the "Ideas" (favorited) items column
    favoritedSortable = new Sortable(favoritedItemsContainer, {
        group: 'shared',
        animation: 150,
        ghostClass: 'itinerary-item-ghost',
        onEnd: function(evt) {
            log('Itinerary', 'Drag ended in favorites items list.');
            if (evt.from.id !== evt.to.id) {
                const recordId = evt.item.dataset.recordId;
                if (state.cart.lockedItems.has(recordId)) {
                    const itemInfo = state.cart.lockedItems.get(recordId);
                    state.cart.lockedItems.delete(recordId);
                    state.cart.items.set(recordId, itemInfo);
                }
            }
            ui.updateAllUI();
            triggerSave();
        }
    });

    // Listeners for the modal itself and the close button
    closeBtn.addEventListener('click', hideItineraryModal);
    itineraryModal.addEventListener('click', (e) => {
        if (e.target === itineraryModal) {
            hideItineraryModal();
        }
    });

    // --- NEW: Event listeners for header inputs to sync changes ---
    const debouncedSave = debounce(triggerSave, 500);

    document.getElementById('itinerary-event-name').addEventListener('input', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.EVENT_NAME, e.target.value);
        ui.updateHeader();
        debouncedSave();
    });

    document.getElementById('itinerary-goals').addEventListener('input', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GOALS, e.target.value);
        ui.updateHeader();
        debouncedSave();
    });

    document.getElementById('itinerary-guest-count').addEventListener('input', (e) => {
        state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.GUEST_COUNT, e.target.value);
        ui.updateTotalCost(); // Recalculate cost based on new headcount
        debouncedSave();
    });

    itineraryDatePicker = flatpickr("#itinerary-date-picker", {
        enableTime: true,
        dateFormat: "M j, Y h:i K",
        onChange: (selectedDates) => {
            if (selectedDates.length > 0) {
                state.eventDetails.combined.set(CONSTANTS.DETAIL_TYPES.DATE, selectedDates.map(d => d.toISOString()));
            } else {
                state.eventDetails.combined.delete(CONSTANTS.DETAIL_TYPES.DATE);
            }
            ui.updateEventPlanDateDisplay(); // Syncs the main sidebar date
            triggerSave();
        }
    });
}

export function showItineraryModal() {
    log('Itinerary', 'Showing itinerary modal.');
    renderItinerary();
    renderItineraryHeader();
    itineraryModal.classList.add('active');
    itineraryModal.style.display = 'flex';
    document.body.classList.add('modal-open');
}

export function hideItineraryModal() {
    log('Itinerary', 'Hiding itinerary modal.');
    itineraryModal.classList.remove('active');
    setTimeout(() => {
        itineraryModal.style.display = 'none';
    }, 300);
    document.body.classList.remove('modal-open');
}

/**
 * Renders the data in the header of the itinerary modal from the global state.
 */
export function renderItineraryHeader() {
    document.getElementById('itinerary-event-name').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.getElementById('itinerary-goals').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
    document.getElementById('itinerary-guest-count').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GUEST_COUNT) || '';
    
    const dateValue = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (dateValue && itineraryDatePicker) {
        itineraryDatePicker.setDate(dateValue.map(d => new Date(d)), false);
    } else if (itineraryDatePicker) {
        itineraryDatePicker.clear();
    }
}

export async function renderItinerary() {
    log('Itinerary', 'Rendering itinerary items.');
    lockedItemsContainer.innerHTML = '';
    favoritedItemsContainer.innerHTML = '';
    
    if (state.cart.lockedItems.size === 0) {
        lockedItemsContainer.innerHTML = `<p class="description">Drag items from Ideas here to add them to your plan.</p>`;
    }
    if (state.cart.items.size === 0) {
        favoritedItemsContainer.innerHTML = `<p class="description">Drag items from the Event Plan here to unsave them.</p>`;
    }

    // Render locked items
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const itemElement = await createItineraryItem(record, itemInfo, 'locked');
            if (itemElement) lockedItemsContainer.appendChild(itemElement);
        }
    }

    // Render favorited items
    for (const [recordId, itemInfo] of state.cart.items.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const itemElement = await createItineraryItem(record, itemInfo, 'favorite');
            if (itemElement) favoritedItemsContainer.appendChild(itemElement);
        }
    }

    // Add event listeners for live editing of item details within the modal
    document.querySelectorAll('.itinerary-item .quantity-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const recordId = e.target.closest('.itinerary-item').dataset.recordId;
            const newQuantity = parseInt(e.target.value, 10);
            if (e.target.closest('#itinerary-locked-items')) {
                ui.updateLockedItemState(recordId, { quantity: newQuantity });
            } else {
                ui.updateItemState(recordId, { quantity: newQuantity });
            }
            ui.updateAllUI();
            triggerSave();
        });
    });

    document.querySelectorAll('.itinerary-item-note').forEach(textarea => {
        textarea.addEventListener('input', debounce((e) => {
            const recordId = e.target.closest('.itinerary-item').dataset.recordId;
            const newNote = e.target.value;
            if (e.target.closest('#itinerary-locked-items')) {
                ui.updateLockedItemState(recordId, { note: newNote });
            } else {
                ui.updateItemState(recordId, { note: newNote });
            }
            ui.updateEventPlanSection(); // Only sidebar needs this update
            triggerSave();
        }, 500));
    });

    document.querySelectorAll('.itinerary-item .remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const recordId = e.target.closest('.itinerary-item').dataset.recordId;
            if (state.cart.lockedItems.has(recordId)) {
                state.cart.lockedItems.delete(recordId);
            } else if (state.cart.items.has(recordId)) {
                state.cart.items.delete(recordId);
            }
            e.target.closest('.itinerary-item').remove();
            ui.updateAllUI();
            triggerSave();
        });
    });
}

/**
 * Creates an individual item element for the itinerary/ideas columns.
 * @param {object} record The Airtable record object.
 * @param {object} itemInfo The state information for the item.
 * @param {string} type 'locked' or 'favorite'.
 * @returns {Promise<HTMLElement>} The created DOM element.
 */
async function createItineraryItem(record, itemInfo, type) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = `itinerary-item ${type}`;
    itemElement.dataset.recordId = record.id;
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    
    const options = ui.parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const selectedOption = options[itemInfo.selectedOptionIndex];
    const quantitySelector = `
        <div class="quantity-selector">
            <label>Qty:</label>
            <input type="number" class="quantity-input" value="${itemInfo.quantity}" min="1">
        </div>
    `;

    itemElement.innerHTML = `
        <img src="${imageUrls[0]}" class="locked-item-thumbnail" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${selectedOption ? `<p class="locked-item-option">${selectedOption.name}</p>` : ''}
            <textarea class="itinerary-item-note" placeholder="Add a note...">${itemInfo.note || ''}</textarea>
        </div>
        ${quantitySelector}
        <div class="locked-item-actions">
            <button class="remove-btn" title="Remove">×</button>
        </div>
    `;

    // Add an edit button that opens the detail modal
    const editBtn = document.createElement('button');
    editBtn.className = 'edit-btn';
    editBtn.textContent = 'Edit';
    itemElement.querySelector('.locked-item-actions').prepend(editBtn);
    editBtn.addEventListener('click', () => {
        ui.showDetailModal(record);
    });

    return itemElement;
}
