import { state } from '../state.js';
import { CONSTANTS } from '../config.js';
import * as api from '../api.js';
import { parseOptions } from '../utils.js';
import { getRecordPrice } from '../ui.js';
import { createFavoriteCardElement } from './card.js';
import { log } from '../utils/debug.js';

async function createLockedInItemElement(record, itemInfo) {
    log('Sidebar', `Creating locked item element for "${record.fields.Name}"`);
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
    const price = getRecordPrice(record, itemInfo.selectedOptionIndex);
    const total = price * itemInfo.quantity;
    itemElement.innerHTML = `
        <img src="${imageUrls[0]}" class="locked-item-thumbnail" alt="${fields.Name}">
        <div class="locked-item-details">
            <p class="locked-item-name">${fields.Name}</p>
            ${optionName ? `<p class="locked-item-option">${optionName}</p>` : ''}
            <p class="locked-item-pricing">Qty ${itemInfo.quantity} @ $${price.toFixed(2)} = <strong>$${total.toFixed(2)}</strong></p>
            ${itemInfo.note ? `<p class="locked-item-note"><em>Note: ${itemInfo.note}</em></p>` : ''}
        </div>
        <div class="locked-item-actions">
            <button class="edit-btn">Edit</button>
            <button class="remove-locked-item-btn" title="Remove from Plan">×</button>
        </div>
    `;
    return itemElement;
}

export async function updateEventPlanPanel() {
    log('Sidebar', 'Updating event plan panel.');
    const container = document.getElementById('cart-items-container');
    if (!container) return;
    container.innerHTML = '';
    if (state.cart.lockedItems.size === 0) {
        container.innerHTML = `<p style="font-size: 0.9em; color: #6c757d;">No items locked in yet.</p>`;
        return;
    }
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const itemElement = await createLockedInItemElement(record, itemInfo);
            container.appendChild(itemElement);
        }
    }
}

export async function updateFavoritesCarousel() {
    log('Sidebar', 'Updating favorites carousel.');
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
            const card = await createFavoriteCardElement(record, itemInfo, false, imageCache);
            if (card) favoritesCarousel.appendChild(card);
        }
    }
    updateTotalCost();
}

export function updateCardIcon(recordId) {
    log('Sidebar', `Updating card icon for record ID: ${recordId}`);
    const isLocked = state.cart.lockedItems.has(recordId);
    const isHearted = state.cart.items.has(recordId);
    const heartSVG = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"></path></svg>`;
    const checkSVG = `<svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"></path></svg>`;
    document.querySelectorAll(`.event-card[data-record-id="${recordId}"] .heart-icon, #modal-heart-btn[data-record-id="${recordId}"]`).forEach(icon => {
        if (isLocked) {
            icon.className = 'heart-icon locked';
            icon.innerHTML = checkSVG;
        } else if (isHearted) {
            icon.className = 'heart-icon hearted';
            icon.innerHTML = heartSVG;
        } else {
            icon.className = 'heart-icon';
            icon.innerHTML = heartSVG;
        }
    });
}

export function updateHeader() {
    log('Sidebar', 'Updating header.');
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.title = eventName || 'Event Builder';
    document.getElementById('header-event-name').value = eventName;
    document.getElementById('header-goals').value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
}

export function updateTotalCost() {
    log('Sidebar', 'Updating total cost.');
    const totalCostEl = document.getElementById('total-cost');
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    if (!totalCostEl) return;
    let total = 0;
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;
        const unitPrice = getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1);
        total += unitPrice * effectiveQuantity;
    });
    totalCostEl.textContent = `$${total.toFixed(2)}`;
    if(checkoutBtn) checkoutBtn.disabled = total === 0;
    if(saveShareBtn) saveShareBtn.disabled = total === 0;
}
