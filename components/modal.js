// REPLACE THE ENTIRE CONTENTS OF: components/modal.js

import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import { parseOptions, updateUrl, getGroupPriceRange, getRecordPrice } from '../utils.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS } from '../availability.js';
import { log } from '../utils/debug.js';
import { initializeItemChat } from '../chat.js';

let stripe;
let currentShopSettings = {};
const modalOverlay = document.getElementById('detail-modal-overlay');
let currentItemChatRecordId = null;

// --- Helper function to update modal price display ---
function updateModalPriceDisplay(record, optionIndex, currentQuantity) {
    const modalItemPrice = document.getElementById('modal-item-price');
    if (!modalItemPrice || !record || !record.fields) return; // Safety checks

    const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const unitPrice = getRecordPrice(record, optionIndex); // Get current unit price

    let priceHTML = '';
    // Use Number.isFinite to check for valid numbers, allowing 0 price
    if (headcountMin > 1 && currentQuantity <= headcountMin && Number.isFinite(unitPrice) && unitPrice >= 0) {
        // Show minimum total price ONLY if quantity is AT OR BELOW the minimum (and price is valid)
        const minimumTotalPrice = unitPrice * headcountMin;
        const pluralTypeLabel = pricingType && pricingType.toLowerCase().includes('guest') ? 'guests' : 'items';
        priceHTML = `$${minimumTotalPrice.toFixed(2)} <span class="pricing-type">minimum for ${headcountMin} ${pluralTypeLabel}</span>`;
    } else if (Number.isFinite(unitPrice) && unitPrice >= 0) {
        // Show unit price if no minimum OR quantity is ABOVE minimum (and price is valid)
        const pricingTypeHTML = pricingType ? `<span class="pricing-type"> / ${pricingType.toLowerCase()}</span>` : '';
        priceHTML = `$${unitPrice.toFixed(2)}${pricingTypeHTML}`;
    } else {
        priceHTML = 'N/A'; // Fallback for invalid price
    }
    modalItemPrice.innerHTML = priceHTML;
}
// --- End Helper ---


function closeDetailModal() {
    updateUrl({ openItem: null });
    hideDetailModal();
}

function handleEscapeKey(event) {
    if (event.key === 'Escape') {
        closeDetailModal();
    }
}

function handleOverlayClick(event) {
    if (event.target === modalOverlay) {
        closeDetailModal();
    }
}

function updateCheckoutDisplay() {
    const fullTotalEl = document.getElementById('full-total-price');
    const finalTotal = parseFloat(fullTotalEl.dataset.total || 0);
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = Math.max(0, finalTotal - amountReceived); // Ensure total due isn't negative

    const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
    let baseAmountToCharge = totalDue; // Default to remaining balance if already paid deposit
    const depositLabel = document.getElementById('deposit-label');
    const depositPrice = document.getElementById('deposit-price');
    const paymentChoiceContainer = document.getElementById('payment-choice-container');

    if (amountReceived === 0) { // First payment
        if (currentShopSettings.paymentOptions === 'DepositOrFull') {
             paymentChoiceContainer.style.display = 'block'; // Show choices only on first payment if allowed
             if (choice === 'full') {
                 baseAmountToCharge = finalTotal;
                 depositLabel.textContent = 'Full Amount Due Today:';
             } else {
                 baseAmountToCharge = finalTotal * 0.35; // Calculate deposit
                 depositLabel.textContent = '35% Deposit Due Today:';
             }
         } else { // DepositOnly shops or subsequent payments
            paymentChoiceContainer.style.display = 'none';
            baseAmountToCharge = finalTotal * 0.35; // Always calculate deposit on first payment for DepositOnly
            depositLabel.textContent = '35% Deposit Due Today:';
        }
    } else { // Subsequent payments
        paymentChoiceContainer.style.display = 'none'; // No choices after first payment
        depositLabel.textContent = 'Remaining Balance Due:';
        baseAmountToCharge = totalDue; // Charge the rest
    }

    const tipAmount = parseFloat(document.getElementById('tip-amount').value) || 0;
    const finalAmountToCharge = baseAmountToCharge + tipAmount;

    depositPrice.textContent = (finalAmountToCharge >= 0.50) ? `$${finalAmountToCharge.toFixed(2)}` : '$0.00';

    const submitBtn = document.getElementById('payment-submit-btn');
    if (submitBtn) {
        submitBtn.disabled = finalAmountToCharge < 0.50;
    }
}


function getBreadcrumbs(record) {
    const breadcrumbs = [];
    let current = record;
    let safetyCounter = 0;
    while (current && current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM] && safetyCounter < 10) {
        const parentName = current.fields[CONSTANTS.FIELD_NAMES.PARENT_ITEM];
        breadcrumbs.unshift(parentName);
        current = state.records.all.find(r => r.fields.Name === parentName);
        if (!current) break;
        safetyCounter++;
    }
    return breadcrumbs;
}


function resetModalState() {
    const elementsToClear = [
        'modal-item-name', 'modal-item-price', 'modal-item-description',
        'modal-thumbnail-strip', 'modal-options-container',
        'modal-quantity-selector', 'modal-calendar-container', 'modal-breadcrumbs'
    ];
    elementsToClear.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });

    const elementsToResetValue = ['modal-item-note'];
    elementsToResetValue.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    const imageEl = document.getElementById('modal-main-image');
    if (imageEl) imageEl.style.backgroundImage = '';

    const actionsContainer = document.getElementById('modal-actions-container');
    if (actionsContainer) actionsContainer.style.display = 'block';
    const notesContainer = document.getElementById('modal-notes-container');
    if (notesContainer) notesContainer.style.display = 'block';

    log('Modal', 'Reset modal state.');
}


export async function showDetailModal(record, startPhotoIndex = 0) {
    console.log('[showDetailModal] Called for item:', record.id);
    log('Modal', `Showing detail modal for "${record.fields.Name}"`);
    updateUrl({ openItem: record.id });

    // --- Get DOM Elements ---
    const modalHeaderActions = document.getElementById('modal-header-actions');
    const modalItemName = document.getElementById('modal-item-name');
    const modalItemPrice = document.getElementById('modal-item-price'); // Keep reference for helper
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
    const closeBtn = document.getElementById('modal-close-btn');

    // --- Event Listeners ---
    closeBtn.removeEventListener('click', closeDetailModal);
    modalOverlay.removeEventListener('click', handleOverlayClick);
    document.removeEventListener('keydown', handleEscapeKey);
    closeBtn.addEventListener('click', closeDetailModal);
    modalOverlay.addEventListener('click', handleOverlayClick);
    document.addEventListener('keydown', handleEscapeKey);

    // --- Reset & Setup ---
    resetModalState();
    modalOverlay.dataset.recordId = record.id;
    currentItemChatRecordId = record.id;

    const isLocked = state.cart.lockedItems.has(record.id);
    modalOverlay.dataset.mode = isLocked ? 'edit-locked' : 'edit-favorite';
    const itemState = isLocked ? state.cart.lockedItems.get(record.id) : ui.getItemState(record.id);

    if (addToPlanBtn) {
        addToPlanBtn.textContent = isLocked ? 'Update Plan' : 'Add to Plan';
        addToPlanBtn.dataset.tooltip = isLocked ? 'Update plan with changes' : 'Add to plan';
        addToPlanBtn.disabled = false;
    }

    // --- Image Loading ---
    let imageUrls = [];
    try {
        const imageData = await api.fetchImagesForRecord(record, state.records.all, new Map());
        imageUrls = imageData.imageUrls || [];
    } catch (error) {
        console.error("Failed to fetch images for modal:", error);
    }

    // --- Basic Info ---
    modalItemName.textContent = record.fields.Name || 'Untitled';
    modalItemDescription.textContent = record.fields.Description || '';

    // --- Price (Initial Display) ---
    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => allRecordNames.has(opt.name));
    const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
    const initialQuantity = Math.max(itemState.quantity || 1, headcountMin); // Determine initial quantity

    if (isGrouping) {
        const range = getGroupPriceRange(record);
        modalItemPrice.innerHTML = (range && typeof range.min === 'number')
            ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`)
            : 'Price Varies';
    } else {
        // Call helper for initial price display
        updateModalPriceDisplay(record, itemState.selectedOptionIndex, initialQuantity);
    }

    // --- Image Gallery Display ---
    let currentPhotoIndex = startPhotoIndex < imageUrls.length ? startPhotoIndex : 0;
    if (imageUrls.length > 0) {
        modalMainImage.style.backgroundImage = `url('${imageUrls[currentPhotoIndex]}')`;
        modalThumbnailStrip.innerHTML = '';
        imageUrls.forEach((url, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'thumbnail-img';
            thumb.style.backgroundImage = `url('${url}')`;
            if (index === currentPhotoIndex) thumb.classList.add('active');
            thumb.addEventListener('click', () => {
                currentPhotoIndex = index;
                modalMainImage.style.backgroundImage = `url('${imageUrls[index]}')`;
                modalThumbnailStrip.querySelector('.thumbnail-img.active')?.classList.remove('active');
                thumb.classList.add('active');
            });
            modalThumbnailStrip.appendChild(thumb);
        });
    } else {
        modalMainImage.style.backgroundImage = '';
        modalThumbnailStrip.innerHTML = '<p>No images available.</p>';
    }

    // --- Breadcrumbs & Header Actions ---
    modalHeaderActions.innerHTML = '';
    const breadcrumbs = getBreadcrumbs(record);
    modalBreadcrumbs.innerHTML = breadcrumbs.length > 0
        ? breadcrumbs.map(name => `<a href="#" class="parent-link" data-parent-name="${name}" title="Go to ${name}">${name}</a>`).join(' &gt; ')
        : '';

    const heartBtnContainer = document.createElement('div');
    heartBtnContainer.id = 'modal-heart-btn';
    heartBtnContainer.dataset.recordId = record.id;
    modalHeaderActions.appendChild(heartBtnContainer);

    // --- Options ---
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
        optionButton.innerHTML = `${opt.name} ${priceModText}`;

        const linkedRecord = state.records.all.find(r => r.fields.Name === opt.name && r.id !== record.id);

        if (linkedRecord) {
            optionButton.dataset.linkedRecordId = linkedRecord.id;
            optionButton.addEventListener('click', (e) => {
                e.stopPropagation();
                log('Modal', `Option clicked, linking to item: ${linkedRecord.fields.Name}`);
                closeDetailModal();
                setTimeout(() => showDetailModal(linkedRecord), 50);
            });
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

                // Get current quantity from the input inside the modal
                const quantityInput = modalQuantitySelector.querySelector('.quantity-input');
                // Use headcountMin as fallback if input not found (e.g., during initial setup)
                const currentModalQuantity = quantityInput ? parseInt(quantityInput.value, 10) : headcountMin;
                // Update price display using the helper
                updateModalPriceDisplay(record, newIndex, currentModalQuantity);
            });
        }
        modalOptionsContainer.appendChild(optionButton);
    });

    // --- Quantity & Notes ---
    if (!isGrouping) {
        modalActionsContainer.style.display = 'block';
        modalNotesContainer.style.display = 'block';
        modalItemNote.value = itemState.note;

        // Use initialQuantity determined earlier for the input value
        modalQuantitySelector.innerHTML = `<div class="quantity-selector" data-record-id="${record.id}"><button class="quantity-btn minus" aria-label="Decrease quantity">-</button><input type="number" class="quantity-input" value="${initialQuantity}" min="${headcountMin}"><button class="quantity-btn plus" aria-label="Increase quantity">+</button></div>`;

        const plusBtn = modalQuantitySelector.querySelector('.plus');
        const minusBtn = modalQuantitySelector.querySelector('.minus');
        const input = modalQuantitySelector.querySelector('input');

        if (plusBtn && minusBtn && input) {
            plusBtn.addEventListener('click', () => { input.stepUp(); input.dispatchEvent(new Event('change', { bubbles: true })); });
            minusBtn.addEventListener('click', () => { input.stepDown(); input.dispatchEvent(new Event('change', { bubbles: true })); });

            // Add change listener to quantity input to update price display
            input.addEventListener('change', (e) => {
                const currentModalQuantity = parseInt(e.target.value, 10);
                // Find currently selected option index
                const selectedOptionBtn = modalOptionsContainer.querySelector('.option-btn.selected');
                const currentOptionIndex = selectedOptionBtn ? parseInt(selectedOptionBtn.dataset.optionIndex, 10) : (itemState.selectedOptionIndex || 0); // Use state as fallback

                // Enforce minimum value visually (browser might handle this via min attr, but belt-and-suspenders)
                 const min = parseInt(e.target.min, 10);
                 if (currentModalQuantity < min) {
                     e.target.value = min;
                     // Update price based on the corrected minimum quantity
                     updateModalPriceDisplay(record, currentOptionIndex, min);
                 } else {
                    // Update price display based on current option and NEW valid quantity
                    updateModalPriceDisplay(record, currentOptionIndex, currentModalQuantity);
                 }
                 // Ensure the state update event still bubbles up from events.js listener
                 e.target.dispatchEvent(new CustomEvent('change', { bubbles: true }));
            });
        }
    } else {
        modalActionsContainer.style.display = 'none';
        modalNotesContainer.style.display = 'none';
        modalQuantitySelector.innerHTML = '';
    }

    // --- Calendar ---
    modalCalendarContainer.innerHTML = '';
    let calendarInstance = null;
    try {
        const busyTimes = await api.fetchCalendarForRecord(record);
        calendarInstance = window.flatpickr(modalCalendarContainer, {
            inline: true,
            showMonths: 1,
            disable: [(date) => getDayStatus(date, busyTimes, record).status === AVAILABILITY_STATUS.NONE],
            onDayCreate: (dObj, dStr, fp, dayElem) => {
                const day = dayElem.dateObj;
                const status = getDayStatus(day, busyTimes, record);
                let className = status.status === AVAILABILITY_STATUS.FULL ? 'available-full'
                              : status.status === AVAILABILITY_STATUS.PARTIAL ? 'available-partial'
                              : 'unavailable';
                let tooltip = status.status === AVAILABILITY_STATUS.PARTIAL
                              ? `${status.reason}\nAvailable slots: ${getAvailableSlotsForDay(day, busyTimes) || 'None'}`
                              : status.reason;
                dayElem.classList.add(className);
                dayElem.setAttribute('data-tippy-content', tooltip);
            },
            onReady: (selectedDates, dateStr, instance) => {
                tippy(instance.calendarContainer.querySelectorAll('.flatpickr-day[data-tippy-content]'), {
                    content: ref => ref.getAttribute('data-tippy-content'),
                    placement: 'top', theme: 'light', allowHTML: true,
                });
            },
            onChange: (selectedDates) => {
                if (selectedDates.length > 0) {
                    const eventDateInput = document.getElementById('event-date-picker');
                    if (eventDateInput?._flatpickr) {
                        eventDateInput._flatpickr.setDate(selectedDates[0], true);
                    }
                }
            }
        });
        const eventDate = state.eventDetails.combined.get(CONSTANTS.DETAIL_TYPES.DATE);
        if (eventDate) {
            try {
                const dateToSet = Array.isArray(eventDate) ? new Date(eventDate[0]) : new Date(eventDate);
                if (!isNaN(dateToSet.getTime())) calendarInstance.setDate(dateToSet, false);
            } catch (e) { console.warn("Could not parse event date for modal calendar:", eventDate); }
        }
    } catch (error) {
        console.error("Failed to initialize calendar:", error);
        modalCalendarContainer.innerHTML = '<p>Could not load availability calendar.</p>';
    }

    // --- Final UI Updates & Display ---
    ui.updateCardIcon(record.id);
    modalOverlay.classList.add('active');
    modalOverlay.style.display = 'flex';
    document.body.classList.add('modal-open');

    // --- Initialize Chat (Deferred) ---
    setTimeout(() => {
        const chatContainer = document.getElementById('modal-chat-container');
        const isChatEnabledOnItem = record.fields['Chat Enabled'] || false;
        if (state.session.user.isAuthenticated && chatContainer && isChatEnabledOnItem) {
            chatContainer.style.display = 'flex';
            initializeItemChat(record.id);
        } else if (chatContainer) {
            chatContainer.style.display = 'none';
        }
    }, 0);
}


export function hideDetailModal() {
    console.log('[hideDetailModal] Called.');
    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) closeBtn.removeEventListener('click', closeDetailModal);
    if (modalOverlay) modalOverlay.removeEventListener('click', handleOverlayClick);
    document.removeEventListener('keydown', handleEscapeKey);

    if (currentItemChatRecordId) {
        log('Chat', `Closing item chat for recordId: ${currentItemChatRecordId}`);
        currentItemChatRecordId = null;
    }

    if (modalOverlay) {
        modalOverlay.classList.remove('active');
        const handleTransitionEnd = () => {
             modalOverlay.style.display = 'none';
             resetModalState();
             modalOverlay.removeEventListener('transitionend', handleTransitionEnd);
        };
        modalOverlay.addEventListener('transitionend', handleTransitionEnd);
        setTimeout(() => {
             if (modalOverlay.style.display !== 'none') {
                 modalOverlay.style.display = 'none';
                 resetModalState();
                 modalOverlay.removeEventListener('transitionend', handleTransitionEnd);
             }
        }, 350);
        document.body.classList.remove('modal-open');
    }
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
    const totalLabel = document.getElementById('checkout-total-label');
    const paymentForm = document.getElementById('payment-form');
    const successMessage = document.getElementById('payment-success-message');
    const cardErrors = document.getElementById('card-errors');

    if (!checkoutModalOverlay || !summaryDetailsEl || !fullTotalEl || !tipAmountInput || !paymentChoiceContainer || !paymentForm || !successMessage || !cardErrors) {
        console.error("One or more checkout modal elements not found.");
        return;
    }

    // Reset UI state
    paymentForm.style.display = 'block';
    successMessage.style.display = 'none';
    cardErrors.textContent = '';
    document.getElementById('customer-name').value = state.session.user.name || '';
    document.getElementById('customer-email').value = state.session.user.email || '';

    if (totalLabel) {
        totalLabel.textContent = (state.session.user.amountReceived > 0) ? 'Total Final Cost:' : 'Total Estimated Cost:';
    }

    const handleCheckoutOverlayClick = (e) => {
        if (e.target === checkoutModalOverlay) hideCheckoutModal();
    };
    checkoutModalOverlay.removeEventListener('click', handleCheckoutOverlayClick);
    checkoutModalOverlay.addEventListener('click', handleCheckoutOverlayClick);
    checkoutModalOverlay._eventListener = handleCheckoutOverlayClick;

    if (checkoutCloseBtn) {
        checkoutCloseBtn.removeEventListener('click', hideCheckoutModal);
        checkoutCloseBtn.addEventListener('click', hideCheckoutModal);
    }

    summaryDetailsEl.innerHTML = '';
    tipAmountInput.value = '';
    let finalTotal = 0;
    const summaryList = document.createElement('ul');
    summaryList.id = 'checkout-summary-list';

    if (!(state.cart.lockedItems instanceof Map)) {
        console.error("state.cart.lockedItems is not a Map in showCheckoutModal");
        return;
    }

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record || !record.fields) continue;

        const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);
        const headcountMin = record.fields[CONSTANTS.FIELD_NAMES.HEADCOUNT_MIN] || 1;
        const effectiveQuantity = Math.max(itemInfo.quantity || 1, headcountMin);
        const validPrice = typeof price === 'number' && !isNaN(price) ? price : 0;
        const itemTotal = validPrice * effectiveQuantity;
        finalTotal += itemTotal;
        const listItem = document.createElement('li');

        let noteHtml = '';
        if (itemInfo.note && itemInfo.note.trim() !== '') {
            const sanitizedNote = itemInfo.note.replace(/</g, "&lt;").replace(/>/g, "&gt;");
            noteHtml = `<small class="checkout-summary-note">Note: ${sanitizedNote}</small>`;
        }

        listItem.innerHTML = `
            <div class="summary-item-details">
                <span class="summary-item-name">${record.fields.Name} (x${effectiveQuantity})</span>
                ${noteHtml}
            </div>
            <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
        `;
        summaryList.appendChild(listItem);
    }

    summaryDetailsEl.appendChild(summaryList);

    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    fullTotalEl.dataset.total = finalTotal;

    const paymentRadios = document.querySelectorAll('input[name="paymentChoice"]');
    paymentRadios.forEach(radio => {
        radio.removeEventListener('change', updateCheckoutDisplay);
        radio.addEventListener('change', updateCheckoutDisplay);
        if (radio.value === 'deposit') radio.checked = true;
    });

    if (termsContainer && currentShopSettings.terms) {
        const sanitizedTerms = currentShopSettings.terms.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, '<br>');
        termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${sanitizedTerms}</p>`;
        termsContainer.style.display = 'block';
    } else if (termsContainer) {
         termsContainer.style.display = 'none';
    }

    tipAmountInput.removeEventListener('input', updateCheckoutDisplay);
    tipAmountInput.addEventListener('input', updateCheckoutDisplay);

    updateCheckoutDisplay();

    try {
        stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
        const elements = stripe.elements();
        const cardElementContainer = document.getElementById('card-element');
        if (cardElementContainer) cardElementContainer.innerHTML = '';

        const cardElement = elements.create('card');
        cardElement.mount('#card-element');
        checkoutModalOverlay.cardElement = cardElement;

        checkoutModalOverlay.style.display = 'flex';
        setTimeout(() => {
             checkoutModalOverlay.classList.add('active');
             if(checkoutCloseBtn) checkoutCloseBtn.focus();
        }, 10);
        document.body.classList.add('modal-open');

    } catch (err) {
        console.error("Failed to initialize Stripe payment form:", err);
        alert(`Could not initialize payment form: ${err.message}. Please try again later.`);
        hideCheckoutModal();
    }
}


export function hideCheckoutModal() {
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        if (checkoutModalOverlay._eventListener) {
            checkoutModalOverlay.removeEventListener('click', checkoutModalOverlay._eventListener);
            delete checkoutModalOverlay._eventListener;
        }
        const checkoutCloseBtn = document.getElementById('checkout-close-btn');
        if (checkoutCloseBtn) {
            checkoutCloseBtn.removeEventListener('click', hideCheckoutModal);
        }
        document.getElementById('tip-amount')?.removeEventListener('input', updateCheckoutDisplay);
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.removeEventListener('change', updateCheckoutDisplay);
        });

        checkoutModalOverlay.classList.remove('active');
        const handleTransitionEnd = () => {
             checkoutModalOverlay.style.display = 'none';
             log('Modal', 'Checkout modal hidden.');
             checkoutModalOverlay.removeEventListener('transitionend', handleTransitionEnd);
        };
        checkoutModalOverlay.addEventListener('transitionend', handleTransitionEnd);

        setTimeout(() => {
             if (checkoutModalOverlay.style.display !== 'none') {
                 checkoutModalOverlay.style.display = 'none';
                 log('Modal', 'Checkout modal hidden (timeout fallback).');
                 checkoutModalOverlay.removeEventListener('transitionend', handleTransitionEnd);
             }
        }, 350);

        document.body.classList.remove('modal-open');
    }
}


export function getStripeContext() {
    const cardElement = document.getElementById('checkout-modal-overlay')?.cardElement;
    return { stripe, cardElement };
}
