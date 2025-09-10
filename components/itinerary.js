// FILE: components/itinerary.js
import Sortable from 'sortablejs';
import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';

let itineraryModal = null;
let lockedSortable = null;
let favoritedSortable = null;

function renderItineraryItem(record, itemInfo, containerId) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = 'itinerary-item';
    itemElement.dataset.recordId = record.id;
    itemElement.dataset.containerId = containerId;

    const options = ui.parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    let optionName = '';
    if (itemInfo.selectedOptionIndex != null && options[itemInfo.selectedOptionIndex]) {
        optionName = options[itemInfo.selectedOptionIndex].name;
    }
    const price = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);
    const total = price * itemInfo.quantity;

    itemElement.innerHTML = `
        <img src="https://res.cloudinary.com/${CONSTANTS.CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_60,h_60/ww71meppejsewxsxr4x7.jpg" class="locked-item-thumbnail" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${optionName ? `<p class="locked-item-option">${optionName}</p>` : ''}
            <p class="locked-item-pricing">Qty ${itemInfo.quantity} @ $${price.toFixed(2)} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="edit-btn" title="Edit Item">Edit</button>
            <button class="remove-btn" title="Remove Item">×</button>
        </div>
    `;
    return itemElement;
}

export function renderItineraryHeader() {
    const eventNameInput = document.getElementById('itinerary-event-name');
    const goalsInput = document.getElementById('itinerary-goals');
    const dateInput = document.getElementById('itinerary-date-picker');

    eventNameInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';

    const savedDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (savedDate) {
        dateInput.value = savedDate;
    }
}

export function renderItinerary() {
    log('Itinerary', 'Rendering itinerary modal content.');
    const lockedItemsContainer = document.getElementById('itinerary-locked-items');
    const favoritedItemsContainer = document.getElementById('itinerary-favorited-items');
    if (!lockedItemsContainer || !favoritedItemsContainer) return;

    lockedItemsContainer.innerHTML = '';
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            lockedItemsContainer.appendChild(renderItineraryItem(record, itemInfo, 'locked'));
        }
    }

    favoritedItemsContainer.innerHTML = '';
    for (const [recordId, itemInfo] of state.cart.items.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            favoritedItemsContainer.appendChild(renderItineraryItem(record, itemInfo, 'favorited'));
        }
    }

    if (lockedSortable) lockedSortable.destroy();
    if (favoritedSortable) favoritedSortable.destroy();

    lockedSortable = new Sortable(lockedItemsContainer, {
        group: 'shared',
        animation: 150,
        onEnd: (evt) => {
            log('Itinerary', 'Drag event ended in locked items container.');
            const fromContainer = evt.from.id;
            const toContainer = evt.to.id;
            const recordId = evt.item.dataset.recordId;
            const itemInfo = state.cart.lockedItems.get(recordId) || state.cart.items.get(recordId);

            if (fromContainer === 'itinerary-favorited-items' && toContainer === 'itinerary-locked-items') {
                state.cart.items.delete(recordId);
                state.cart.lockedItems.set(recordId, itemInfo);
                ui.updateCardIcon(recordId);
                ui.updateEventPlanSection();
                ui.updateFavoritesCarousel();
                ui.updateTotalCost();
                log('Itinerary', `Locked in item: ${recordId}`);
            }
        }
    });

    favoritedSortable = new Sortable(favoritedItemsContainer, {
        group: 'shared',
        animation: 150,
        onEnd: (evt) => {
            log('Itinerary', 'Drag event ended in favorited items container.');
            const fromContainer = evt.from.id;
            const toContainer = evt.to.id;
            const recordId = evt.item.dataset.recordId;
            const itemInfo = state.cart.lockedItems.get(recordId) || state.cart.items.get(recordId);
            
            if (fromContainer === 'itinerary-locked-items' && toContainer === 'itinerary-favorited-items') {
                state.cart.lockedItems.delete(recordId);
                state.cart.items.set(recordId, itemInfo);
                ui.updateCardIcon(recordId);
                ui.updateEventPlanSection();
                ui.updateFavoritesCarousel();
                ui.updateTotalCost();
                log('Itinerary', `Demoted item: ${recordId}`);
            }
        }
    });
}

export function initItinerary() {
    itineraryModal = document.getElementById('itinerary-modal-overlay');
    if (itineraryModal) {
        document.getElementById('itinerary-close-btn').addEventListener('click', hideItineraryModal);
        // Add listener for breadcrumbs
        itineraryModal.addEventListener('click', (e) => {
            if (e.target.closest('.parent-link')) {
                e.preventDefault();
                const parentName = e.target.closest('.parent-link').dataset.parentName;
                log('Itinerary', `Clicked breadcrumb to parent: ${parentName}`);
                const parentRecord = state.records.all.find(r => r.fields.Name === parentName);
                if (parentRecord) {
                    ui.showDetailModal(parentRecord);
                }
            }
        });
    }
}

export function showItineraryModal() {
    if (itineraryModal) {
        renderItineraryHeader();
        renderItinerary();
        itineraryModal.classList.add('active');
        document.body.classList.add('modal-open');
        log('Itinerary', 'Itinerary modal shown.');
    }
}

export function hideItineraryModal() {
    if (itineraryModal) {
        itineraryModal.classList.remove('active');
        document.body.classList.remove('modal-open');
        log('Itinerary', 'Itinerary modal hidden.');
    }
}
