// REPLACE THE ENTIRE CONTENTS OF: components/itinerary.js

import { state } from '../state.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { updateUrl, getRecordPrice } from '../utils.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { log } from '../utils/debug.js';
import { triggerSave } from '../events.js';

const Sortable = window.Sortable;

const itineraryModal = document.getElementById('itinerary-modal-overlay');
const lockedItemsContainer = document.getElementById('itinerary-locked-items');
const favoritedItemsContainer = document.getElementById('itinerary-favorited-items');
const closeBtn = document.getElementById('itinerary-close-btn');

let lockedSortable, favoritedSortable;

export function setupItineraryEventListeners() {
    log('Itinerary', 'Initializing Itinerary with SortableJS.');
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
            ui.updateCardIcon(state.records.all.find(r => r.id === evt.item.dataset.recordId).id);
            ui.updateFavoritesCarousel();
            ui.updateTotalCost();
            ui.updateEventPlanSection();
            ui.updateEventPlanDateDisplay();
            ui.updateLockedItemStatusIcons();
            triggerSave();
        }
    });

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
            ui.updateCardIcon(state.records.all.find(r => r.id === evt.item.dataset.recordId).id);
            ui.updateFavoritesCarousel();
            ui.updateTotalCost();
            ui.updateEventPlanSection();
            ui.updateEventPlanDateDisplay();
            ui.updateLockedItemStatusIcons();
            triggerSave();
        }
    });

    closeBtn.addEventListener('click', () => {
        updateUrl({ view: null });
        hideItineraryModal();
    });
    itineraryModal.addEventListener('click', (e) => {
        if (e.target === itineraryModal) {
            updateUrl({ view: null });
            hideItineraryModal();
        }
    });
}

export function showItineraryModal() {
    updateUrl({ view: 'itinerary' });
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

export function renderItineraryHeader() {
    document.getElementById('itinerary-event-name').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || 'My Awesome Event';
    document.getElementById('itinerary-goals').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
}

export async function renderItinerary() {
    // --- DEBUG STATEMENT ---
    log('Itinerary', 'Checking user object on render:', state.session.user);

    log('Itinerary', 'Rendering itinerary items.');
    lockedItemsContainer.innerHTML = '';
    favoritedItemsContainer.innerHTML = '';
    if (state.cart.lockedItems.size === 0) {
        lockedItemsContainer.innerHTML = `<p class="description">Drag items from Ideas here to add them to your plan.</p>`;
    }
    if (state.cart.items.size === 0) {
        favoritedItemsContainer.innerHTML = `<p class="description">Favorite items from the catalog to add them here.</p>`;
    }

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const itemElement = await createItineraryItem(record, itemInfo, 'locked');
            if (itemElement) lockedItemsContainer.appendChild(itemElement);
        }
    }

    for (const [recordId, itemInfo] of state.cart.items.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const itemElement = await createItineraryItem(record, itemInfo, 'favorite');
            if (itemElement) favoritedItemsContainer.appendChild(itemElement);
        }
    }

    lockedItemsContainer.addEventListener('change', (e) => {
        if (e.target.classList.contains('price-override-input')) {
            const recordId = e.target.closest('.itinerary-item').dataset.recordId;
            const newPrice = parseFloat(e.target.value);
            if (!isNaN(newPrice)) {
                ui.updateLockedItemState(recordId, { overridePrice: newPrice });
                ui.updateTotalCost();
                ui.updateEventPlanSection();
                triggerSave();
            }
        }
    });

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
            ui.updateEventPlanSection();
            triggerSave();
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
            ui.updateEventPlanSection();
            triggerSave();
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
            triggerSave();
        });
    });
}

async function createItineraryItem(record, itemInfo, type) {
    const fields = record.fields;
    const itemElement = document.createElement('div');
    itemElement.className = `itinerary-item ${type === 'locked' ? 'locked' : 'favorite'}`;
    itemElement.dataset.recordId = record.id;
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    
    const options = ui.parseOptions(fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const selectedOption = options[itemInfo.selectedOptionIndex];

    const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
    let priceHtml;

    if (state.session.user.isOwner && type === 'locked') {
        priceHtml = `
            <div class="price-editor">
                <label>Price:</label>
                <input type="number" class="price-override-input" value="${price.toFixed(2)}" step="0.01" />
            </div>`;
    } else {
        priceHtml = `<div class="price-display">$${price.toFixed(2)}</div>`;
    }
    
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
        ${priceHtml}
        ${quantitySelector}
        <div class="locked-item-actions">
            <button class="remove-btn" title="Remove">×</button>
        </div>
    `;
    if (type === 'locked') {
        const editBtn = document.createElement('button');
        editBtn.className = 'edit-btn';
        editBtn.textContent = 'Edit';
        itemElement.querySelector('.locked-item-actions').prepend(editBtn);
        editBtn.addEventListener('click', () => {
            log('Itinerary Item', `Edit button clicked. Opening detail modal for "${fields.Name}".`);
            ui.showDetailModal(record);
        });
    }

    return itemElement;
}
