import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import { parseOptions } from '../utils.js';
import { getDayStatus } from '../availability.js';
import { log } from '../utils/debug.js';


let stripe, elements, cardElement, clientSecret;

export async function showDetailModal(record) {
    log('Modal', `Showing detail modal for "${record.fields.Name}"`);
    const modalOverlay = document.getElementById('detail-modal-overlay');
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

    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getMainGetItemState()(record.id);
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
        const range = ui.getGroupPriceRange(record);
        modalItemPrice.textContent = range ? `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}` : 'Price Varies';
    } else {
        modalItemPrice.textContent = `$${ui.getRecordPrice(record).toFixed(2)}`;
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
    
    // REPAIRED: This section restores the breadcrumbs/parent link display.
    modalHeaderActions.innerHTML = '';
    modalBreadcrumbsContainer.innerHTML = '';
    const breadcrumbs = ui.getBreadcrumbs(record, state.records.all);
    if (breadcrumbs.length > 0) {
        breadcrumbs.forEach((crumb, index) => {
            const crumbLink = document.createElement('a');
            crumbLink.href = '#';
            crumbLink.textContent = crumb.fields.Name;
            crumbLink.dataset.parentName = crumb.fields.Name; // Use dataset for event listener
            crumbLink.classList.add('parent-link');
            modalBreadcrumbsContainer.appendChild(crumbLink);
            if (index < breadcrumbs.length - 1) {
                const separator = document.createElement('span');
                separator.textContent = ' > ';
                modalBreadcrumbsContainer.appendChild(separator);
            }
        });
    }
    
    const heartBtnContainer = document.createElement('div');
    heartBtnContainer.id = 'modal-heart-btn';
    heartBtnContainer.dataset.recordId = record.id;
    modalHeaderActions.appendChild(heartBtnContainer);
    ui.updateCardIcon(record.id);

    modalOptionsContainer.innerHTML = '';
    rawOptions.forEach((opt, index) => {
        const optionButton = document.createElement('button');
        optionButton.className = 'option-btn';
        optionButton.dataset.optionIndex = index;
        if (itemState.selectedOptionIndex === index) {
            optionButton.classList.add('selected');
        }
        
        let priceModText = '';
        if (opt.price != null) {
            priceModText = `$${opt.price.toFixed(2)}`;
        } else if (opt.priceChange != null) {
            priceModText = `${opt.priceChange >= 0 ? '+' : ''}$${opt.priceChange.toFixed(2)}`;
        }
        
        optionButton.innerHTML = `${opt.name} <span class="price-mod">${priceModText}</span>`;

        if (allRecordNames.has(opt.name)) {
            optionButton.dataset.childName = opt.name;
        } else {
             optionButton.addEventListener('click', (e) => {
                modalOptionsContainer.querySelectorAll('.option-btn').forEach(btn => btn.classList.remove('selected'));
                e.currentTarget.classList.add('selected');
                const newIndex = parseInt(e.currentTarget.dataset.optionIndex, 10);
                e.currentTarget.dispatchEvent(new CustomEvent('change', {
                    bubbles: true,
                    detail: { selectedOptionIndex: newIndex }
                }));
                modalItemDescription.textContent = opt.description || record.fields.Description;
            });
        }
        modalOptionsContainer.appendChild(optionButton);
    });

    if (!isGrouping) {
        modalActionsContainer.style.display = 'block';
        modalNotesContainer.style.display = 'block';
        modalItemNote.value = itemState.note;
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        modalQuantitySelector.innerHTML = `<div class="quantity-selector" data-record-id="${record.id}"><button class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${itemState.quantity}" min="${headcountMin}"><button class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;
        const plusBtn = modalQuantitySelector.querySelector('.plus');
        const minusBtn = modalQuantitySelector.querySelector('.minus');
        const input = modalQuantitySelector.querySelector('input');
        plusBtn.addEventListener('click', () => { input.stepUp(); input.dispatchEvent(new Event('change', { bubbles: true })); });
        minusBtn.addEventListener('click', () => { input.stepDown(); input.dispatchEvent(new Event('change', { bubbles: true })); });
    } else {
        modalActionsContainer.style.display = 'none';
        modalNotesContainer.style.display = 'none';
        modalQuantitySelector.innerHTML = '';
    }

    modalCalendarContainer.innerHTML = '';
    flatpickr(modalCalendarContainer, {
        inline: true,
        onDayCreate: function(dObj, dStr, fp, dayElem) {
            const day = dayElem.dateObj;
            const status = getDayStatus(day, [], record);
        }
    });

    modalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
}

export function hideDetailModal() {
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

        const price = ui.getRecordPrice(record, itemInfo.selectedOptionIndex);
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
        if (!response.ok || data.error) {
            throw new Error(data.error || 'Failed to fetch payment details.');
        }

        clientSecret = data.clientSecret;

        stripe = Stripe(STRIPE_PUBLISHABLE_KEY);
        elements = stripe.elements({ clientSecret });
        const cardElementContainer = document.getElementById('card-element');
        if(cardElementContainer) cardElementContainer.innerHTML = '';
        
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
    if (cardElement) {
        cardElement.unmount();
    }
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        checkoutModalOverlay.style.display = 'none';
        document.body.classList.remove('modal-open');
    }
}

export function getStripeContext() {
    return { stripe, elements, cardElement, clientSecret };
}

