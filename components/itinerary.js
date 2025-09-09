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
        details.innerHTML += `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>`;
    }
    
    // Add actions based on item type
    const actions = document.createElement('div');
    actions.className = 'locked-item-actions';
    if (isLocked) {
        actions.innerHTML = `<button class="edit-btn">Edit</button>
                             <button class="demote-locked-item-btn" title="Remove from Plan">Unsave</button>`;
    } else {
        actions.innerHTML = `<button class="action-btn add-to-plan-btn" title="Add to Plan">+</button>
                             <button class="action-btn remove-btn" title="Remove">×</button>`;
    }

    itemCard.appendChild(thumbnail);
    itemCard.appendChild(details);
    itemCard.appendChild(actions);

    return itemCard;
}

function renderItinerary() {
    log('Itinerary', 'Rendering itinerary view.');
    itineraryLockedItemsList.innerHTML = '';
    itineraryFavoritedItemsList.innerHTML = '';

    // Render locked items
    const lockedRecords = Array.from(state.cart.lockedItems.keys())
        .map(id => state.records.all.find(r => r.id === id))
        .filter(Boolean);

    if (lockedRecords.length > 0) {
        lockedRecords.forEach(record => {
            const itemInfo = state.cart.lockedItems.get(record.id);
            itineraryLockedItemsList.appendChild(createItineraryItemCard(record, itemInfo, true));
        });
    }

    // Render favorited items
    const favoritedRecords = Array.from(state.cart.items.keys())
        .map(id => state.records.all.find(r => r.id === id))
        .filter(Boolean);

    if (favoritedRecords.length > 0) {
        favoritedRecords.forEach(record => {
            const itemInfo = state.cart.items.get(record.id);
            itineraryFavoritedItemsList.appendChild(createItineraryItemCard(record, itemInfo, false));
        });
    }
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
                const [movedItem] = state.cart.lockedItems.entries();
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
            triggerSave(); // Function from events.js, needs to be imported or exposed
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
                triggerSave(); // Function from events.js, needs to be imported or exposed
            }
        },
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
    
    document.getElementById('itinerary-close-btn').addEventListener('click', hideItineraryModal);
    
    initializeSortable();
    log('Itinerary', 'Itinerary module initialized.');
}
