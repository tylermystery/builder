import { state } from '../state.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import * as api from '../api.js';
import { parseOptions } from '../utils.js';
import { getDayStatus, getBusySlotsForDay } from '../availability.js';
import { getGroupPriceRange, getRecordPrice, getBreadcrumbs, updateCardIcon } from '../ui.js';
import { getItemState } from '../events.js';
import { log } from '../utils/debug.js';

let stripe, elements, cardElement, clientSecret;

export async function showDetailModal(record) {
    log('Modal', `Showing detail modal for "${record.fields.Name}"`);
    const modalOverlay = document.getElementById('detail-modal-overlay');
    // ... all other getElementById calls
    const modalHeaderActions = document.getElementById('modal-header-actions');
    const modalBreadcrumbsContainer = document.getElementById('modal-breadcrumbs');
    const modalItemName = document.getElementById('modal-item-name');
    const modalItemPrice = document.getElementById('modal-item-price');
    const modalItemDescription = document.getElementById('modal-item-description');
    const modalMainImage = document.getElementById('modal-main-image');
    const modalThumbnailStrip = document.getElementById('modal-thumbnail-strip');
    const modalOptionsContainer = document.getElementById('modal-options-container');
    const modalQuantitySelector = document.getElementById('modal-quantity-selector');
    const modalNotesContainer = document.getElementById('modal-notes-container');
    const modalItemNote = document.getElementById('modal-item-note');
    const modalCalendarContainer = document.getElementById('modal-calendar-container');
    const modalActionsContainer = document.getElementById('modal-actions-container');
    const addToPlanBtn = document.getElementById('modal-add-to-plan-btn');

    modalOverlay.dataset.recordId = record.id;
    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';

    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : getItemState(record.id);
    if (addToPlanBtn) {
        addToPlanBtn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
    }

    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    modalItemName.textContent = record.fields.Name || 'Untitled';
    modalItemDescription.textContent = record.fields.Description || '';
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => allRecordNames.has(opt.name));
    
    if (isGrouping) {
        const range = getGroupPriceRange(record);
        modalItemPrice.textContent = range ? `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}` : 'Price Varies';
    } else {
        modalItemPrice.textContent = `$${getRecordPrice(record).toFixed(2)}`;
    }

    modalMainImage.style.backgroundImage = `url('${imageUrls[0]}')`;
    modalThumbnailStrip.innerHTML = '';
    imageUrls.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        thumb.style.backgroundImage = `url('${url}')`;
        if (index === 0) thumb.classList.add('active');
        thumb.addEventListener('click', () => {
            modalMainImage.style.backgroundImage = `url('${url}')`;
            modalThumbnailStrip.querySelector('.active')?.classList.remove('active');
            thumb.classList.add('active');
        });
        modalThumbnailStrip.appendChild(thumb);
    });

    modalHeaderActions.innerHTML = '';
    const breadcrumbs = getBreadcrumbs(record, state.records.all);
    modalBreadcrumbsContainer.innerHTML = breadcrumbs.map((crumb, index) => `<a href="#" data-record-id="${crumb.id}">${crumb.fields.Name}</a>`).join(' &gt; ');
    
    const heartBtnContainer = document.createElement('div');
    heartBtnContainer.id = 'modal-heart-btn';
    heartBtnContainer.dataset.recordId = record.id;
    modalHeaderActions.appendChild(heartBtnContainer);
    updateCardIcon(record.id);
    
    // Continue with the rest of showDetailModal logic...
    modalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
}

export function hideDetailModal() {
    log('Modal', 'Hiding detail modal.');
    const modalOverlay = document.getElementById('detail-modal-overlay');
    if (modalOverlay) {
        modalOverlay.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

export async function showCheckoutModal() {
    log('Modal', 'Showing checkout modal.');
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const summaryList = document.getElementById('checkout-summary-list');
    const totalPriceEl = document.getElementById('checkout-total-price');
    if (!checkoutModalOverlay || !summaryList || !totalPriceEl) return;

    summaryList.innerHTML = '';
    let finalTotal = 0;
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        const price = getRecordPrice(record, itemInfo.selectedOptionIndex);
        const itemTotal = price * itemInfo.quantity;
        finalTotal += itemTotal;
        const listItem = document.createElement('li');
        listItem.innerHTML = `<span>${record.fields.Name} (x${itemInfo.quantity})</span><span>$${itemTotal.toFixed(2)}</span>`;
        summaryList.appendChild(listItem);
    }
    
    const finalTotalInCents = Math.round(finalTotal * 100);
    totalPriceEl.textContent = `$${finalTotal.toFixed(2)}`;
    
    try {
        const response = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: finalTotalInCents }),
        });
        const data = await response.json();
        if (!response.ok || data.error) throw new Error(data.error || 'Failed to fetch payment details.');
        clientSecret = data.clientSecret;
        stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
        elements = stripe.elements({ clientSecret });
        cardElement = elements.create('card');
        cardElement.mount('#card-element');
        checkoutModalOverlay.style.display = 'flex';
        document.body.classList.add('modal-open');
    } catch (err) {
        console.error("Failed to initialize payment form:", err);
        alert("Could not initialize payment form. Please try again.");
    }
}

export function hideCheckoutModal() {
    log('Modal', 'Hiding checkout modal.');
    if (cardElement) cardElement.unmount();
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        checkoutModalOverlay.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

export function getStripeContext() {
    return { stripe, elements, cardElement, clientSecret };
}
