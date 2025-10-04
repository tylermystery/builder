// REPLACE THE ENTIRE CONTENTS OF: components/modal.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import { parseOptions, updateUrl, getGroupPriceRange, getRecordPrice } from '../utils.js'; // <-- UPDATED
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS } from '../availability.js';
import { log } from '../utils/debug.js';
import { initializeItemChat } from '../chat.js';

let stripe;
let currentShopSettings = {};
const modalOverlay = document.getElementById('detail-modal-overlay');
let currentItemChatRecordId = null;

// --- THIS IS THE FIX ---
// The manual close actions now trigger history.back()
// which will fire popstate and let syncUiWithUrl handle the UI update.
function handleEscapeKey(event) {
    if (event.key === 'Escape') {
        history.back();
    }
}

function handleOverlayClick(event) {
    if (event.target === modalOverlay) {
        history.back();
    }
}
// --- END FIX ---

function updateCheckoutDisplay() {
    const finalTotal = parseFloat(document.getElementById('full-total-price').dataset.total || 0);
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = finalTotal - amountReceived;
    const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
    let baseAmountToCharge = totalDue;
    if (amountReceived === 0) {
        if (currentShopSettings.paymentOptions === 'DepositOrFull' && choice === 'full') {
            baseAmountToCharge = finalTotal;
            document.getElementById('deposit-label').textContent = 'Full Amount Due:';
        } else {
            baseAmountToCharge = finalTotal * 0.35;
            document.getElementById('deposit-label').textContent = '35% Deposit Due:';
        }
    } else {
        document.getElementById('deposit-label').textContent = 'Remaining Balance Due:';
    }
    const tipAmount = parseFloat(document.getElementById('tip-amount').value) || 0;
    const finalAmountToCharge = baseAmountToCharge + tipAmount;
    document.getElementById('deposit-price').textContent = `$${finalAmountToCharge.toFixed(2)}`;
}

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
    const elements = {
        modalItemName: document.getElementById('modal-item-name'),
        modalItemPrice: document.getElementById('modal-item-price'),
        modalItemDescription: document.getElementById('modal-item-description'),
        modalMainImage: document.getElementById('modal-main-image'),
        modalThumbnailStrip: document.getElementById('modal-thumbnail-strip'),
        modalOptionsContainer: document.getElementById('modal-options-container'),
        modalQuantitySelector: document.getElementById('modal-quantity-selector'),
        modalItemNote: document.getElementById('modal-item-note'),
        modalCalendarContainer: document.getElementById('modal-calendar-container'),
        modalBreadcrumbs: document.getElementById('modal-breadcrumbs')
    };
    for (const key in elements) {
        if (elements[key]) {
            if (key === 'modalItemNote') elements[key].value = '';
            else if (key === 'modalMainImage') elements[key].style.backgroundImage = '';
            else elements[key].innerHTML = '';
        }
    }
    log('Modal', 'Reset modal state.');
}

export async function showDetailModal(record, startPhotoIndex = 0) {
    console.log('[showDetailModal] Called for item:', record.id);
    log('Modal', `Showing detail modal for "${record.fields.Name}"`);
    updateUrl({ openItem: record.id });
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
    const modalBreadcrumbs = document.getElementById('modal-breadcrumbs');
    const addToPlanBtn = document.getElementById('modal-add-to-plan-btn');

    console.log('[hideDetailModal] Called.');
    const closeBtn = document.getElementById('modal-close-btn');
    closeBtn.onclick = () => history.back(); // Use onclick to replace any old listener
    modalOverlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleEscapeKey);

    resetModalState();
    modalOverlay.dataset.recordId = record.id;
    currentItemChatRecordId = record.id;
    
    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';
    
    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getItemState(record.id);
    if (addToPlanBtn) {
        addToPlanBtn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
        addToPlanBtn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
    }

    const { imageUrls } = await api.fetchImagesForRecord(record, state.records.all, new Map());
    modalItemName.textContent = record.fields.Name || 'Untitled';
    modalItemDescription.textContent = record.fields.Description || '';
    
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => allRecordNames.has(opt.name));

    const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeHTML = pricingType ? `<span class="pricing-type"> / ${pricingType.toLowerCase()}</span>` : '';

    if (isGrouping) {
        const range = getGroupPriceRange(record); // <-- UPDATED
        modalItemPrice.innerHTML = (range && typeof range.min === 'number') ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
    } else {
        const price = getRecordPrice(record, itemState.selectedOptionIndex); // <-- UPDATED
        modalItemPrice.innerHTML = (typeof price === 'number' ? `$${price.toFixed(2)}` : 'N/A') + pricingTypeHTML;
    }

    let currentPhotoIndex = startPhotoIndex;
    modalMainImage.style.backgroundImage = `url('${imageUrls[currentPhotoIndex]}')`;
    modalThumbnailStrip.innerHTML = '';
    imageUrls.forEach((url, index) => {
        const thumb = document.createElement('div');
        thumb.className = 'thumbnail-img';
        thumb.style.backgroundImage = `url('${url}')`;
        if (index === currentPhotoIndex) thumb.classList.add('active');
        thumb.addEventListener('click', () => {
            currentPhotoIndex = index;
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
                const newPrice = getRecordPrice(record, newIndex); // <-- UPDATED
                modalItemPrice.innerHTML = (typeof newPrice === 'number' ? `$${newPrice.toFixed(2)}` : 'N/A') + pricingTypeHTML;
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
    
    ui.updateCardIcon(record.id);
    
    modalOverlay.classList.add('active');
    modalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');
    setTimeout(() => {
        const chatContainer = document.getElementById('modal-chat-container');
        const isChatEnabledOnItem = record.fields['Chat Enabled'] || false;
        log('Modal Chat Init', {
            isAuthenticated: state.session.user.isAuthenticated,
            isChatEnabledOnItem: isChatEnabledOnItem,
            chatContainerExists: !!chatContainer,
            user: state.session.user
        });
        if (state.session.user.isAuthenticated && chatContainer && isChatEnabledOnItem) {
            log('Modal', 'All conditions met. Initializing item chat.');
            chatContainer.style.display = 'flex';
            initializeItemChat(record.id);
        } else {
            log('Modal', 'Hiding chat. Reason:', {
                isAuthenticated: state.session.user.isAuthenticated,
                isChatEnabledOnItem: isChatEnabledOnItem,
                chatContainerExists: !!chatContainer
            });
            if (chatContainer) {
                chatContainer.style.display = 'none';
            }
        }
    }, 0);
}

export function hideDetailModal() {
    console.log('[hideDetailModal] Called.');
    // --- THIS IS THE FIX ---
    // This function now ONLY handles the UI. It no longer touches the URL.
    const closeBtn = document.getElementById('modal-close-btn');
    closeBtn.onclick = null; // Remove the listener
    modalOverlay.removeEventListener('click', handleOverlayClick);
    document.removeEventListener('keydown', handleEscapeKey);
    if (currentItemChatRecordId) {
        log('Chat', `Closing item chat for recordId: ${currentItemChatRecordId}`);
        currentItemChatRecordId = null;
    }

    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        setTimeout(() => {
            modalOverlay.style.display = 'none';
            resetModalState();
        }, 300);
        document.body.classList.remove('modal-open');
    }
    // --- END FIX ---
}

export async function showCheckoutModal(shopSettings) {
    currentShopSettings = shopSettings;
    log('Modal', 'Showing checkout modal.');
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const fullTotalEl = document.getElementById('full-total-price');
    const checkoutCloseBtn = document.getElementById('checkout-close-btn');
    const summaryDetailsEl = document.getElementById('checkout-summary-details');
    const tipAmountInput = document.getElementById('tip-amount');
    const paymentChoiceContainer = document.getElementById('payment-choice-container');
    const termsContainer = document.querySelector('.terms-and-conditions');

    if (!checkoutModalOverlay) return;

    const handleOverlayClick = (e) => {
        if (e.target === checkoutModalOverlay) {
            hideCheckoutModal();
        }
    };
    checkoutModalOverlay.addEventListener('click', handleOverlayClick);
    
    checkoutModalOverlay.removeEventListenerOnClick = () => {
        checkoutModalOverlay.removeEventListener('click', handleOverlayClick);
    };

    if (checkoutCloseBtn) checkoutCloseBtn.addEventListener('click', hideCheckoutModal);
    
    summaryDetailsEl.innerHTML = '';
    tipAmountInput.value = '';
    let finalTotal = 0;
    const summaryList = document.createElement('ul');
    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;
        const price = getRecordPrice(record, itemInfo.selectedOptionIndex); // <-- UPDATED
        const itemTotal = price * itemInfo.quantity;
        finalTotal += itemTotal;
        const listItem = document.createElement('li');
        listItem.innerHTML = `<span>${record.fields.Name} (x${itemInfo.quantity})</span><span>$${itemTotal.toFixed(2)}</span>`;
        summaryList.appendChild(listItem);
    }
    summaryDetailsEl.appendChild(summaryList);

    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    fullTotalEl.dataset.total = finalTotal;
    if (currentShopSettings.paymentOptions === 'DepositOrFull' && state.session.user.amountReceived === 0) {
        paymentChoiceContainer.style.display = 'block';
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.addEventListener('change', updateCheckoutDisplay);
        });
    } else {
        paymentChoiceContainer.style.display = 'none';
    }

    if (termsContainer && currentShopSettings.terms) {
        termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${currentShopSettings.terms.replace(/\n/g, '<br>')}</p>`;
    }

    updateCheckoutDisplay();
    tipAmountInput.addEventListener('input', updateCheckoutDisplay);
    
    try {
        stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
        const elements = stripe.elements();
        const cardElementContainer = document.getElementById('card-element');
        if (cardElementContainer) cardElementContainer.innerHTML = '';
        const cardElement = elements.create('card');
        cardElement.mount('#card-element');
        checkoutModalOverlay.cardElement = cardElement;
        checkoutModalOverlay.classList.add('active');
        setTimeout(() => {
            checkoutModalOverlay.style.display = 'flex';
            if(checkoutCloseBtn) checkoutCloseBtn.focus();
        }, 0);
        document.body.classList.add('modal-open');
    } catch (err) {
        console.error("Failed to initialize payment form:", err);
        alert(`Could not initialize payment form: ${err.message}. Please try again later.`);
        hideCheckoutModal();
    }
}

export function hideCheckoutModal() {
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        if (checkoutModalOverlay.removeEventListenerOnClick) {
            checkoutModalOverlay.removeEventListenerOnClick();
        }
        document.getElementById('tip-amount')?.removeEventListener('input', updateCheckoutDisplay);
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.removeEventListener('change', updateCheckoutDisplay);
        });
        checkoutModalOverlay.classList.remove('active');
        setTimeout(() => {
            const checkoutCloseBtn = document.getElementById('checkout-close-btn');
            if (checkoutCloseBtn) {
                checkoutCloseBtn.removeEventListener('click', hideCheckoutModal);
            }
            checkoutModalOverlay.style.display = 'none';
            log('Modal', 'Checkout modal hidden.');
        }, 300);
        document.body.classList.remove('modal-open');
    }
}

export function getStripeContext() {
    const cardElement = document.getElementById('checkout-modal-overlay')?.cardElement;
    return { stripe, cardElement };
}
