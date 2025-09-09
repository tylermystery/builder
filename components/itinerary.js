// FILE: components/itinerary.js
import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';
import { debounce } from '../utils.js';
import Sortable from 'https://cdn.jsdelivr.net/npm/sortablejs@1.15.0/modular/sortable.core.esm.js';

let itineraryModalOverlay;
let itineraryLockedItemsList;
let itineraryFavoritedItemsList;
let mainDatePicker;

function createItineraryItemCard(record, itemInfo, isLocked) {
    const itemCard = document.createElement('div');
    itemCard.className = isLocked ? 'itinerary-item locked-item-card' : 'itinerary-item favorite-item-card';
    itemCard.dataset.recordId = record.id;

    const thumbnail = document.createElement('img');
    thumbnail.className = 'locked-item-thumbnail';
    // Use an existing function to fetch images
    api.fetchImagesForRecord(record, state.records.all, new Map()).then(images => {
        thumbnail.src = images.imageUrls?.[0] || 'https://res.cloudinary.com/daedqizre/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg';
    });

    const details = document.createElement('div');
    details.className = 'locked-item-details';
    details.innerHTML = `<p class="locked-item-name">${record.fields.Name}</p>`;
    
    // Add notes from state if they exist
    if (itemInfo.note) {
        details.innerHTML += `<textarea class="itinerary-item-note" placeholder="Add a note...">${itemInfo.note}</textarea>`;
    } else if (isLocked) {
        details.innerHTML += `<textarea class="itinerary-item-note" placeholder="Add a note..."></textarea>`;
    }
    
    // Add quantity selector and availability icon
    const actions = document.createElement('div');
    actions.className = 'locked-item-actions';
    const quantitySelector = `
        <div class="quantity-selector">
            <button class="quantity-btn minus">-</button>
            <input type="number" class="quantity-input" value="${itemInfo.quantity}" min="1">
            <button class="quantity-btn plus">+</button>
        </div>`;
    actions.innerHTML += quantitySelector;
    
    // Add edit/remove buttons based on item type
    if (isLocked) {
        actions.innerHTML += `
            <div class="itinerary-actions">
                <span class="availability-icon">📅</span>
                <button class="edit-btn">Edit</button>
                <button class="demote-locked-item-btn" title="Remove from Plan">Unsave</button>
            </div>
        `;
    } else {
        actions.innerHTML += `
            <div class="itinerary-actions">
                <span class="availability-icon">📅</span>
                <button class="action-btn add-to-plan-btn" title="Add to Plan">+</button>
                <button class="action-btn remove-btn" title="Remove">×</button>
            </div>
        `;
    }

    itemCard.appendChild(thumbnail);
    itemCard.appendChild(details);
    itemCard.appendChild(actions);

    return itemCard;
}

async function renderItinerary() {
    log('Itinerary', 'Rendering itinerary view with live data.');
    itineraryLockedItemsList.innerHTML = '';
    itineraryFavoritedItemsList.innerHTML = '';
    
    const selectedDateRange = state.eventDetails.combined.get('date');
    const hasDateRange = selectedDateRange && selectedDateRange.length === 2;
    
    // Helper function to render a list of items
    const renderList = async (listElement, itemMap, isLocked) => {
        for (const [id, itemInfo] of itemMap.entries()) {
            const record = state.records.all.find(r => r.id === id);
            if (!record) continue;
            
            const itemCard = createItineraryItemCard(record, itemInfo, isLocked);
            listElement.appendChild(itemCard);
            
            // Check and update availability icon
            if (hasDateRange) {
                const availabilityIcon = itemCard.querySelector('.availability-icon');
                if (availabilityIcon) {
                    const busyTimes = await api.fetchCalendarForRecord(record);
                    const isAvailable = ui.checkAvailability(new Date(selectedDateRange[0]), new Date(selectedDateRange[1]), busyTimes);
                    availabilityIcon.textContent = isAvailable ? '✅' : '❌';
                }
            }
        }
    };

    // Render locked items
    await renderList(itineraryLockedItemsList, state.cart.lockedItems, true);

    // Render favorited items
    await renderList(itineraryFavoritedItemsList, state.cart.items, false);
}

function initializeSortable() {
    log('Itinerary', 'Initializing SortableJS for drag-and-drop.');
    
    // Sortable for the "Your Event Plan" column
    new Sortable(itineraryLockedItemsList, {
        group: {
            name: 'shared',
            put: ['shared']
        },
        animation: 150,
        onEnd: function (evt) {
            log('Itinerary', 'Drag-and-drop ended on locked items list.');
            const fromList = evt.from.id;
            const toList = evt.to.id;
            const itemRecordId = evt.item.dataset.recordId;
            const oldIndex = evt.oldIndex;
            const newIndex = evt.newIndex;
            
            // Handle reordering within the locked items list
            if (fromList === toList) {
                const newLockedItems = Array.from(state.cart.lockedItems.entries());
                const [removed] = newLockedItems.splice(oldIndex, 1);
                newLockedItems.splice(newIndex, 0, removed);
                state.cart.lockedItems = new Map(newLockedItems);
            }
            // Handle moving an item from "Ideas" to "Plan"
            else if (fromList === 'itinerary-favorited-items' && toList === 'itinerary-locked-items') {
                const itemInfo = state.cart.items.get(itemRecordId);
                state.cart.items.delete(itemRecordId);
                const newLockedItems = Array.from(state.cart.lockedItems.entries());
                newLockedItems.splice(newIndex, 0, [itemRecordId, itemInfo]);
                state.cart.lockedItems = new Map(newLockedItems);
            }
            ui.updateEventPlanSection();
            ui.updateFavoritesCarousel();
            // Assuming triggerSave is exposed or imported
            // triggerSave();
        },
    });

    // Sortable for the "Your Ideas" column
    new Sortable(itineraryFavoritedItemsList, {
        group: {
            name: 'shared',
            put: ['shared']
        },
        animation: 150,
        onEnd: function (evt) {
            log('Itinerary', 'Drag-and-drop ended on favorited items list.');
            const fromList = evt.from.id;
            const toList = evt.to.id;
            const itemRecordId = evt.item.dataset.recordId;
            const oldIndex = evt.oldIndex;

            // Handle moving an item from "Plan" to "Ideas"
            if (fromList === 'itinerary-locked-items' && toList === 'itinerary-favorited-items') {
                const itemInfo = state.cart.lockedItems.get(itemRecordId);
                state.cart.lockedItems.delete(itemRecordId);
                state.cart.items.set(itemRecordId, itemInfo);
                ui.updateEventPlanSection();
                ui.updateFavoritesCarousel();
                ui.updateCardIcon(itemRecordId);
                // Assuming triggerSave is exposed or imported
                // triggerSave();
            }
        },
    });
}

function initListeners() {
    document.getElementById('itinerary-close-btn').addEventListener('click', hideItineraryModal);
    
    // Event listeners for the header inputs
    document.getElementById('itinerary-event-name').addEventListener('change', (e) => {
        state.eventDetails.combined.set('eventName', e.target.value);
        ui.updateHeader();
        // triggerSave();
    });
    
    document.getElementById('itinerary-goals').addEventListener('change', (e) => {
        state.eventDetails.combined.set('goals', e.target.value);
        ui.updateHeader();
        // triggerSave();
    });

    // Event listener for item notes and quantity
    document.getElementById('itinerary-modal-overlay').addEventListener('change', (e) => {
        const target = e.target;
        const itemCard = target.closest('.itinerary-item');
        if (!itemCard) return;
        const recordId = itemCard.dataset.recordId;
        
        let updates = {};
        if (target.matches('.quantity-input')) {
            updates.quantity = parseInt(target.value, 10);
        } else if (target.matches('.itinerary-item-note')) {
            updates.note = target.value;
        }

        if (Object.keys(updates).length > 0) {
            if (itemCard.classList.contains('locked-item-card')) {
                ui.updateLockedItemState(recordId, updates);
            } else {
                ui.updateItemState(recordId, updates);
            }
            // triggerSave();
        }
    });

    // Handle clicks on item action buttons
    document.getElementById('itinerary-modal-overlay').addEventListener('click', (e) => {
        const target = e.target;
        const itemCard = target.closest('.itinerary-item');
        if (!itemCard) return;
        const recordId = itemCard.dataset.recordId;
        const record = state.records.all.find(r => r.id === recordId);
        
        if (target.matches('.edit-btn')) {
            ui.showDetailModal(record);
        } else if (target.matches('.demote-locked-item-btn')) {
            const itemInfo = state.cart.lockedItems.get(recordId);
            state.cart.lockedItems.delete(recordId);
            state.cart.items.set(recordId, itemInfo);
            ui.updateEventPlanSection();
            ui.updateFavoritesCarousel();
            ui.updateCardIcon(recordId);
            renderItinerary();
            // triggerSave();
        } else if (target.matches('.add-to-plan-btn')) {
            const itemInfo = state.cart.items.get(recordId);
            state.cart.lockedItems.set(recordId, itemInfo);
            state.cart.items.delete(recordId);
            ui.updateEventPlanSection();
            ui.updateFavoritesCarousel();
            ui.updateCardIcon(recordId);
            renderItinerary();
            // triggerSave();
        } else if (target.matches('.remove-btn')) {
            state.cart.items.delete(recordId);
            ui.updateCardIcon(recordId);
            ui.updateFavoritesCarousel();
            renderItinerary();
            // triggerSave();
        }
    });
}

export function showItineraryModal() {
    itineraryModalOverlay.classList.add('active');
    itineraryModalOverlay.style.display = 'flex';
    renderItinerary();
    document.body.classList.add('modal-open');
    log('Itinerary', 'Itinerary modal shown.');
}

export function hideItineraryModal() {
    itineraryModalOverlay.classList.remove('active');
    setTimeout(() => {
        itineraryModalOverlay.style.display = 'none';
        document.body.classList.remove('modal-open');
        log('Itinerary', 'Itinerary modal hidden.');
    }, 300);
}

export function initItinerary() {
    itineraryModalOverlay = document.getElementById('itinerary-modal-overlay');
    itineraryLockedItemsList = document.getElementById('itinerary-locked-items');
    itineraryFavoritedItemsList = document.getElementById('itinerary-favorited-items');
    
    initListeners();
    initializeSortable();
    log('Itinerary', 'Itinerary module initialized.');
}
