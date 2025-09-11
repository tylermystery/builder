// FILE: components/modal.js
// FILE: components/modal.js
import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import { parseOptions } from '../utils.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS } from '../availability.js';
import { log } from '../utils/debug.js';
let stripe, elements, cardElement, clientSecret;
function getBreadcrumbs(record) {
    const breadcrumbs = [];
    let current = record;
    while (current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM]) {
        const parentName = current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
        breadcrumbs.unshift(parentName);
        current = state.records.all.find(r => r.fields.Name === parentName);
        if (!current) break;
    }
    return breadcrumbs;
}
function resetModalState() {
    const modalItemName = document.getElementById('modal-item-name');
    const modalItemPrice = document.getElementById('modal-item-price');
    const modalItemDescription = document.getElementById('modal-item-description');
    const modalMainImage = document.getElementById('modal-main-image');
    const modalThumbnailStrip = document.getElementById('modal-thumbnail-strip');
    const modalOptionsContainer = document.getElementById('modal-options-container');
    const modalQuantitySelector = document.getElementById('modal-quantity-selector');
    const modalItemNote = document.getElementById('modal-item-note');
    const modalCalendarContainer = document.getElementById('modal-calendar-container');
    const modalBreadcrumbs = document.getElementById('modal-breadcrumbs');
    modalItemName.textContent = '';
    modalItemPrice.textContent = '';
    modalItemDescription.textContent = '';
    modalMainImage.style.backgroundImage = '';
    modalThumbnailStrip.innerHTML = '';
    modalOptionsContainer.innerHTML = '';
    modalQuantitySelector.innerHTML = '';
    modalItemNote.value = '';
    modalCalendarContainer.innerHTML = '';
    modalBreadcrumbs.innerHTML = '';
    log('Modal', 'Reset modal state.');
}
export async function showDetailModal(record) {
    log('Modal', `Showing detail modal for "${record.fields.Name}"`);
    const modalOverlay = document.getElementById('detail-modal-overlay');
    const modalHeaderActions = document.getElementById('modal-header-actions');
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
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalBreadcrumbs = document.getElementById('modal-breadcrumbs');
    const addToPlanBtn = document.getElementById('modal-add-to-plan-btn');
    resetModalState();
    modalOverlay.dataset.recordId = record.id;
    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';
    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getMainGetItemState()(record.id);
    if (addToPlanBtn) {
        addToPlanBtn.textContent = isLocked ?
            'Update Plan' : 'Add to Plan';
        addToPlanBtn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
    }
    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    modalItemName.textContent = record.fields.Name || 'Untitled';
    modalItemDescription.textContent = record.fields.Description || '';
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => allRecordNames.has(opt.name));
    if (isGrouping) {
        const range = ui.getGroupPriceRange(record);
        if (range && typeof range.min === 'number' && typeof range.max === 'number') {
            modalItemPrice.textContent = range.min === range.max ?
                `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`;
        } else {
            modalItemPrice.textContent = 'Price Varies';
        }
    } else {
        const price = ui.getRecordPrice(record, itemState.selectedOptionIndex);
        modalItemPrice.textContent = typeof price === 'number' ? `$${price.toFixed(2)}` : 'N/A';
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
    const breadcrumbs = getBreadcrumbs(record);
    if (breadcrumbs.length > 0) {
        modalBreadcrumbs.innerHTML = breadcrumbs.map(name => `<a class="parent-link" data-parent-name="${name}" title="Go to ${name}">${name}</a>`).join(' > ');
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
        if (opt.price !== null) {
            priceModText = `$${opt.price.toFixed(2)}`;
        } else if (opt.priceChange !== null) {
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
                modalItemDescription.textContent = opt.description || record.fields.Description || '';
                const newPrice = ui.getRecordPrice(record, newIndex);
                modalItemPrice.textContent = typeof newPrice === 'number' ?
                    `$${newPrice.toFixed(2)}` : 'N/A';
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
    const busyTimes = await api.fetchCalendarForRecord(record);
    const calendarInstance = window.flatpickr(modalCalendarContainer, {
        inline: true,
        showMonths: 1,
        disable: [(date) => {
            const status = getDayStatus(date, busyTimes, record);
            return status.status === AVAILABILITY_STATUS.NONE;
        }],
        onDayCreate: function (dObj, dStr, fp, dayElem) {
            const day = dayElem.dateObj;
            const status = getDayStatus(day, busyTimes, record);
            let className = '';
            let tooltip = status.reason;
            if (status.status === AVAILABILITY_STATUS.FULL) {
                className = 'available-full';
            } else if (status.status === AVAILABILITY_STATUS.PARTIAL) {
                className = 'available-partial';
                tooltip = `${status.reason}\nAvailable slots: ${getAvailableSlotsForDay(day, busyTimes) || 'None'}`;
            } else {
                className = 'unavailable';
            }
            dayElem.classList.add(className);
            dayElem.setAttribute('data-tippy-content', tooltip);
        },
        onReady: function () {
            tippy('.flatpickr-day', {
                content: reference => reference.getAttribute('data-tippy-content'),
                placement: 'top',
                theme: 'light',
                allowHTML: true,
            });
        },
        onChange: (selectedDates) => {
            if (selectedDates.length > 0) {
                const eventDateInput = document.getElementById('event-date-picker');
                if (eventDateInput && eventDateInput._flatpickr) {
                    eventDateInput._flatpickr.setDate(selectedDates[0], true);
                }
            }
        }
    });
    const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
    if (eventDate) {
        calendarInstance.setDate(new Date(eventDate), true);
    }
    modalOverlay.classList.add('active');
    setTimeout(() => {
        modalOverlay.style.display = 'flex';
        // FIX: Add a null check before trying to focus the button
        const modalCloseBtn = document.getElementById('modal-close-btn');
        if (modalCloseBtn) modalCloseBtn.focus();
        log('Modal', 'Detail modal shown, focused close button.');
    }, 0);
    document.body.classList.add('modal-open');
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', hideDetailModal);
    }
}
export function hideDetailModal() {
    const modalOverlay = document.getElementById('detail-modal-overlay');
    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        setTimeout(() => {
            modalOverlay.style.display = 'none';
            resetModalState();
            const closeBtn = document.getElementById('modal-close-btn');
            // FIX: Remove the event listener to prevent memory leaks
            if (closeBtn) {
                closeBtn.removeEventListener('click', hideDetailModal);
            }
            document.getElementById('header-event-name').focus();
            log('Modal', 'Detail modal hidden, focused header title.');
        }, 300);
        document.body.classList.remove('modal-open');
    }
}
export async function showCheckoutModal() {
    log('Modal', 'Showing checkout modal.');
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const fullTotalEl = document.getElementById('full-total-price');
    const depositEl = document.getElementById('deposit-price');
    const checkoutCloseBtn = document.getElementById('checkout-close-btn');
    const summaryDetailsEl = document.getElementById('checkout-summary-details');
    if (!checkoutModalOverlay || !fullTotalEl || !depositEl || !summaryDetailsEl) {
        log('Modal', 'Error: Missing elements for checkout modal.');
        return;
    }
    // Clear previous summary and totals
    summaryDetailsEl.innerHTML = '';
    fullTotalEl.textContent = '$0.00';
    depositEl.textContent = '$0.00';
    let finalTotal = 0;
    const summaryList = document.createElement('ul');
    // Sum up the total cost from locked items
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
    summaryDetailsEl.appendChild(summaryList);
    // Calculate the 35% deposit
    const depositAmount = finalTotal * 0.35;
    const depositInCents = Math.round(depositAmount * 100);
    // Update the display
    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    depositEl.textContent = `$${depositAmount.toFixed(2)}`;
    try {
        const response = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount: depositInCents }),
        });
        if (!response.ok) {
            throw new Error('Network error: Could not connect to payment server.');
        }
        const data = await response.json();
        if (data.error) {
            throw new Error(data.error);
        }
        clientSecret = data.clientSecret;
        stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
        elements = stripe.elements({ clientSecret });
        const cardElementContainer = document.getElementById('card-element');
        if (cardElementContainer) cardElementContainer.innerHTML = '';
        cardElement = elements.create('card');
        cardElement.mount('#card-element');
        checkoutModalOverlay.classList.add('active');
        setTimeout(() => {
            checkoutModalOverlay.style.display = 'flex';
            checkoutCloseBtn.focus();
            log('Modal', 'Checkout modal shown, focused close button.');
        }, 0);
        document.body.classList.add('modal-open');
    } catch (err) {
        console.error("Failed to initialize payment form:", err);
        log('Modal', `Failed to initialize payment form: ${err.message}`);
        alert(`Could not initialize payment form: ${err.message}. Please try again later.`);
        hideCheckoutModal();
    }
}
export function hideCheckoutModal() {
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        checkoutModalOverlay.classList.remove('active');
        setTimeout(() => {
            checkoutModalOverlay.style.display = 'none';
            log('Modal', 'Checkout modal hidden.');
        }, 300);
        document.body.classList.remove('modal-open');
    }
}
export function getStripeContext() {
    return { stripe, elements, cardElement, clientSecret };
}
