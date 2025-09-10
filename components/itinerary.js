// FILE: components/itinerary.js
import { state } from '../state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';

// Get the SortableJS library from the global scope
const Sortable = window.Sortable;

const itineraryModal = document.getElementById('itinerary-modal-overlay');
const lockedItemsContainer = document.getElementById('itinerary-locked-items');
const favoritedItemsContainer = document.getElementById('itinerary-favorited-items');
const closeBtn = document.getElementById('itinerary-close-btn');

let lockedSortable, favoritedSortable;

// FIX: Renamed function to be more descriptive and avoid re-initialization issues.
export function setupItineraryEventListeners() {
    log('Itinerary', 'Initializing Itinerary with SortableJS.');

    // Initialize SortableJS for the locked-in items column
    lockedSortable = new Sortable(lockedItemsContainer, {
        group: 'shared', // Allows items to be moved between lists
        animation: 150,
        // FIX: Provide a single class name to avoid InvalidCharacterError
        ghostClass: 'itinerary-item-ghost',
        onEnd: function(evt) {
            log('Itinerary', 'Drag ended in locked items list.');
            if (evt.from.id === evt.to.id) {
                // Reorder locked items if moved within the same list
                const newOrder = lockedSortable.toArray();
                const newLockedItems = new Map();
                newOrder.forEach(recordId => {
                    if (state.cart.lockedItems.has(recordId)) {
                        newLockedItems.set(recordId, state.cart.lockedItems.get(recordId));
                    }
                });
                state.cart.lockedItems = newLockedItems;
            } else {
                // Item moved from favorites to locked
                const recordId = evt.item.dataset.recordId;
                if (state.cart.items.has(recordId)) {
                    const itemInfo = state.cart.items.get(recordId);
                    state.cart.items.delete(recordId);
                    state.cart.lockedItems.set(recordId, itemInfo);
                }
            }
            ui.updateCardIcon(state.records.all.find(r => r.id === evt.item.dataset.recordId).id);
            ui.updateFavoritesCarousel();
            ui.updateTotalCost();
            ui.updateEventPlanSection();
            ui.updateEventPlanDateDisplay();
            ui.updateLockedItemStatusIcons();
        }
    });

    // Initialize SortableJS for the favorited items column
    favoritedSortable = new Sortable(favoritedItemsContainer, {
        group: 'shared',
        animation: 150,
        // FIX: Provide a single class name to avoid InvalidCharacterError
        ghostClass: 'itinerary-item-ghost',
        onEnd: function(evt) {
            log('Itinerary', 'Drag ended in favorites items list.');
            // Item moved from locked to favorites
            if (evt.from.id !== evt.to.id) {
                const recordId = evt.item.dataset.recordId;
                if (state.cart.lockedItems.has(recordId)) {
                    const itemInfo = state.cart.lockedItems.get(recordId);
                    state.cart.lockedItems.delete(recordId);
                    state.cart.items.set(recordId, itemInfo);
                }
            }
            ui.updateCardIcon(state.records.all.find(r => r.id === evt.item.dataset.recordId).id);
            ui.updateFavoritesCarousel();
            ui.updateTotalCost();
            ui.updateEventPlanSection();
            ui.updateEventPlanDateDisplay();
            ui.updateLockedItemStatusIcons();
        }
    });

    // FIX: This event listener is now a permanent part of the setup
    closeBtn.addEventListener('click', hideItineraryModal);
    itineraryModal.addEventListener('click', (e) => {
        if (e.target === itineraryModal) {
            hideItineraryModal();
        }
    });
}

export function showItineraryModal() {
    log('Itinerary', 'Showing itinerary modal.');
    // FIX: Render the itinerary content here, before showing the modal.
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

export function renderItineraryHeader() {
    document.getElementById('itinerary-event-name').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'My Awesome Event';
    document.getElementById('itinerary-goals').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
}

export async function renderItinerary() {
    log('Itinerary', 'Rendering itinerary items.');
    lockedItemsContainer.innerHTML = '';
    favoritedItemsContainer.innerHTML = '';

    if (state.cart.lockedItems.size === 0) {
        lockedItemsContainer.innerHTML = `<p class="description">Drag items from Ideas here to add them to your plan.</p>`;
    }
    if (state.cart.items.size === 0) {
        favoritedItemsContainer.innerHTML = `<p class="description">Favorite items from the catalog to add them here.</p>`;
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

    // Add event listeners for live editing
    document.querySelectorAll('.itinerary-item .quantity-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const recordId = e.target.closest('.itinerary-item').dataset.recordId;
            const newQuantity = parseInt(e.target.value, 10);
            if (e.target.closest('#itinerary-locked-items')) {
                ui.updateLockedItemState(recordId, { quantity: newQuantity });
            } else {
                ui.updateItemState(recordId, { quantity: newQuantity });
            }
            ui.updateTotalCost();
        });
    });

    document.querySelectorAll('.itinerary-item-note').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            const recordId = e.target.closest('.itinerary-item').dataset.recordId;
            const newNote = e.target.value;
            if (e.target.closest('#itinerary-locked-items')) {
                ui.updateLockedItemState(recordId, { note: newNote });
            } else {
                ui.updateItemState(recordId, { note: newNote });
            }
        });
    });

    document.querySelectorAll('.itinerary-item .remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const recordId = e.target.closest('.itinerary-item').dataset.recordId;
            state.cart.lockedItems.delete(recordId);
            ui.updateTotalCost();
            ui.updateEventPlanSection();
            ui.updateFavoritesCarousel();
            e.target.closest('.itinerary-item').remove();
        });
    });
}

// Helper function to create an individual itinerary item element
async function createItineraryItem(record, itemInfo, type) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = `itinerary-item ${type === 'locked' ? 'locked' : 'favorite'}`;
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
            <textarea class="itinerary-item-note" placeholder="Add a note...">${itemInfo.note}</textarea>
        </div>
        ${quantitySelector}
        <div class="locked-item-actions">
            <button class="remove-btn" title="Remove">×</button>
        </div>
    `;
    
    // Add edit button only for locked items
    if (type === 'locked') {
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.textContent = 'Edit';
        itemElement.querySelector('.locked-item-actions').prepend(editBtn);
        editBtn.addEventListener('click', () => {
            ui.showDetailModal(record);
        });
    }

    return itemElement;
}
