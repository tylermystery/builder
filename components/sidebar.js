// FILE: components/sidebar.js
import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, CLOUDINARY_CLOUD_NAME } from '../config.js';
import { parseOptions } from '../utils.js';
import { log } from '../utils/debug.js';

async function createFavoriteCardElement(record, itemInfo, imageCache) {
    const fields = record.fields;
    const itemCard = document.createElement('div');
    itemCard.className = `favorite-item lazy-load`; // Add lazy-load class
    itemCard.dataset.recordId = record.id;
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, imageCache);
    
    // Set the image URL in a data attribute instead of the background style
    itemCard.dataset.bgImage = imageUrls[0] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`;

    const price = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);
    const tooltipContent = `
        <strong>${fields.Name || 'Untitled'}</strong><br>
        <small>${fields.Description || 'No description.'}</small><br>
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

    // Use data-src for the img tag and add the lazy-load class
    itemElement.innerHTML = `
        <img class="locked-item-thumbnail lazy-load" data-src="${imageUrls[0] || `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/c_fill,g_auto,w_600,h_520/ww71meppejsewxsxr4x7.jpg`}" alt="${fields.Name}">
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

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (record) {
            const itemElement = await createLockedInItemElement(record, itemInfo);
            container.appendChild(itemElement);
        }
    }
    // Tell the UI module to observe the new lazy-load images
    ui.observeLazyImages(container);
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
    // Tell the UI module to observe the new lazy-load images
    ui.observeLazyImages(favoritesCarousel);
    updateTotalCost();
}
// ... (rest of the file remains the same)
export function updateHeader() {
    const eventName = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.EVENT_NAME) || '';
    document.title = eventName || 'Event Builder';
    const eventNameInput = document.getElementById('header-event-name');
    if (eventNameInput) eventNameInput.value = eventName;
    
    const goalsInput = document.getElementById('header-goals');
    if(goalsInput) goalsInput.value = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.GOALS) || '';
}

export function updateTotalCost() {
    const subtotalCostEl = document.getElementById('subtotal-cost');
    const amountPaidCostEl = document.getElementById('amount-paid-cost');
    const amountPaidRowEl = document.querySelector('.amount-paid-row');
    const totalDividerEl = document.querySelector('.total-divider');
    const totalCostEl = document.getElementById('total-cost');
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');

    if (!totalCostEl || !subtotalCostEl || !amountPaidCostEl || !amountPaidRowEl) return;

    let subtotal = 0;
    state.cart.lockedItems.forEach((itemInfo, recordId) => {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) return;
        const unitPrice = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);
        if (isNaN(unitPrice)) return;
        const effectiveQuantity = Math.max(parseInt(itemInfo.quantity) || 1, record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1);
        const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE]?.toLowerCase();
        let itemCost = (pricingType === 'per hour' || pricingType === CONSTANTS.PRICING_TYPES.PER_GUEST) ? unitPrice * effectiveQuantity : unitPrice;
        subtotal += itemCost;
    });

    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = subtotal - amountReceived;

    subtotalCostEl.textContent = `$${subtotal.toFixed(2)}`;
    totalCostEl.textContent = `$${totalDue.toFixed(2)}`;

    if (amountReceived > 0) {
        amountPaidCostEl.textContent = `-$${amountReceived.toFixed(2)}`;
        amountPaidRowEl.style.display = 'flex';
        totalDividerEl.style.display = 'block';
        if (checkoutBtn) checkoutBtn.textContent = 'Pay Remainder';
    } else {
        amountPaidRowEl.style.display = 'none';
        totalDividerEl.style.display = 'none';
        if (checkoutBtn) checkoutBtn.textContent = 'Reserve';
    }

    const isPlanEmpty = subtotal === 0;
    const isFullyPaid = totalDue <= 0;

    if (checkoutBtn) {
        checkoutBtn.disabled = isPlanEmpty || isFullyPaid;
    }
    if (saveShareBtn) {
        saveShareBtn.disabled = isPlanEmpty && state.ui.saveState !== 'SAVING';
    }
}

export function displayReservedStatus() {
    const checkoutBtn = document.getElementById('checkout-btn');
    const saveShareBtn = document.getElementById('save-share-btn');
    const totalBreakdown = document.getElementById('total-breakdown');

    if (totalBreakdown) {
        totalBreakdown.innerHTML = '<span style="color: #28a745; font-weight: bold; font-size: 1.4em;">✅ Event Reserved</span>';
    }
    if (checkoutBtn) {
        checkoutBtn.style.display = 'none';
    }
    if (saveShareBtn) {
        saveShareBtn.disabled = false;
    }
}
