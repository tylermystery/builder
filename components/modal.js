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

// --- NEW GLOBAL: HTML for the Processing Fee Line Item ---
const PROCESSING_FEE_ROW_HTML = `<div class="total-row processing-fee-row" style="display: none;"><span>Processing Fee:</span><span id="processing-fee-cost">$0.00</span></div>`;
// This helper function safely inserts the fee row into the DOM
(function insertProcessingFeeRow() {
    const section = document.querySelector('.checkout-total-deposit-section');
    if (section) {
        section.insertAdjacentHTML('afterbegin', PROCESSING_FEE_ROW_HTML);
    }
})();
// --- END NEW GLOBAL ---

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

// In: components/modal.js (REPLACING ONLY updateProcessingFeeDisplay)

// ... existing code in components/modal.js ...

// --- MODIFIED FUNCTION: Fetches the fee from the server and updates the UI (Fee is returned in cents) ---
export async function updateProcessingFeeDisplay() {
    const fullTotalEl = document.getElementById('full-total-price');
    const finalTotal = parseFloat(fullTotalEl?.dataset.total || 0); // Total BEFORE tip/fee
    const tipAmount = parseFloat(document.getElementById('tip-amount')?.value) || 0;
    const amountReceived = state.session.user.amountReceived || 0;
    
    // Determine base amount due (Deposit vs. Full)
    const totalDueBeforeFee = finalTotal - amountReceived;
    let amountToChargeBeforeFee = totalDueBeforeFee;
    const isFirstPayment = amountReceived === 0;

    if (isFirstPayment) {
        const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
        const isFullPayment = currentShopSettings.paymentOptions === 'DepositOrFull' && choice === 'full';

        if (!isFullPayment) {
             // 35% Deposit
             amountToChargeBeforeFee = finalTotal * 0.35;
        } else {
             // Full Amount
             amountToChargeBeforeFee = finalTotal;
        }
    }
    
    // Add tip to the amount to charge
    amountToChargeBeforeFee += tipAmount;

    const amountInCentsBeforeFee = Math.round(amountToChargeBeforeFee * 100);
    
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const elements = checkoutModalOverlay?.stripeElements;
    
    // --- FIX: Read the selected payment type by waiting for the result of elements.getElement().getValue()
    // NOTE: This call is the key to getting the live selected payment method type.
    let selectedPaymentMethod = 'card'; // Default fallback
    if (elements) {
         try {
             // We must await getValue() because it interacts with the Stripe iframe
             const valueResult = await elements.getElement('payment').getValue();
             if (valueResult.value?.type) {
                 selectedPaymentMethod = valueResult.value.type;
             }
         } catch (e) {
             log('Stripe', 'Failed to get live payment method type, defaulting to card.', e);
         }
    }
    log('Stripe', `Recalculating fee for method type: ${selectedPaymentMethod}`);
    // --- END FIX ---

    try {
        // We only proceed if the amount is valid 
        if (amountInCentsBeforeFee <= 0) {
            document.getElementById('processing-fee-cost').textContent = `$0.00`;
            document.querySelector('.processing-fee-row').style.display = 'none';
            document.getElementById('deposit-price').textContent = `$0.00`;
            return;
        }

        // Step 1: Request the fee calculation and a NEW clientSecret from the server
        const intentResponse = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                amount: amountInCentsBeforeFee, 
                paymentMethodType: selectedPaymentMethod // Now sends the live selected type
            }),
        });
        if (!intentResponse.ok) throw new Error('Fee calculation failed.');
        const paymentIntentData = await intentResponse.json();
        const feeInCents = paymentIntentData.processingFeeInCents;
        const clientSecret = paymentIntentData.clientSecret;
        const fee = feeInCents / 100;

        // Step 2: Update the UI with the fee
        const feeEl = document.getElementById('processing-fee-cost');
        const feeRowEl = document.querySelector('.processing-fee-row');
        
        if (fee > 0) {
            feeEl.textContent = `$${fee.toFixed(2)}`;
            feeRowEl.style.display = 'flex';
        } else {
            feeRowEl.style.display = 'none';
        }

        // Step 3: Update the Final Due amount (including the fee)
        const totalDueWithFee = amountToChargeBeforeFee + fee;
        document.getElementById('deposit-price').textContent = `$${totalDueWithFee.toFixed(2)}`;
        
        // Step 4: Update the existing Stripe Elements instance with the new Client Secret
        if (elements && clientSecret) {
            elements.update({ clientSecret: clientSecret });
        }

    } catch (err) {
        console.error('Failed to update processing fee:', err);
        // Fallback if API fails: try to reset UI cleanly
        const fee = 0; 
        document.getElementById('processing-fee-cost').textContent = `$${fee.toFixed(2)}`;
        document.querySelector('.processing-fee-row').style.display = 'none';
        document.getElementById('deposit-price').textContent = `$${amountToChargeBeforeFee.toFixed(2)}`;
    }
}
// --- END MODIFIED FUNCTION ---

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
        modalBreadcrumbs: document.getElementById('modal-breadcrumbs'),
        modalAdditionalDetails: document.getElementById('modal-additional-details')
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
    const detailSpecs = [
        { fieldName: 'Duration', label: 'Duration' },
        { fieldName: 'Capacity', label: 'Capacity' },
        { fieldName: 'Location Details', label: 'Location Info' },
        { fieldName: 'Additional Information', label: 'Good to Know' },
    ];

    console.log('[showDetailModal] Called for item:', record.id);
    log('Modal', `Showing detail modal for \"${record.fields.Name}\"`);
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
    const modalAdditionalDetails = document.getElementById('modal-additional-details');
    const addToPlanBtn = document.getElementById('modal-add-to-plan-btn');

    console.log('[hideDetailModal] Called.');
    const closeBtn = document.getElementById('modal-close-btn');
    closeBtn.onclick = closeDetailModal;
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

    if (modalAdditionalDetails) {
        modalAdditionalDetails.innerHTML = '';
        const fragment = document.createDocumentFragment();
        let hasRankings = false;
        const rankingsHtmlParts = [];

        console.log('[Modal Debug] Record Fields:', record.fields);

        // 1. Process standard details
        console.log('[Modal Debug] Processing Standard Details...');
        detailSpecs.forEach(spec => {
            const value = record.fields[spec.fieldName];
            console.log(`[Modal Debug]   - Checking Field: "${spec.fieldName}", Found Value:`, value);
            if (value) {
                console.log(`[Modal Debug]     -> Adding "${spec.label}" to modal.`);
                const detailItem = document.createElement('div');
                detailItem.className = 'detail-item';
                detailItem.innerHTML = `
                    <span class="detail-label">${spec.label}</span>
                    <span class="detail-value">${String(value).replace(/\n/g, '<br>')}</span>
                `;
                fragment.appendChild(detailItem);
            } else {
                 console.log(`[Modal Debug]     -> Skipping "${spec.label}" (no value).`);
            }
        });

        // 2. Process Rankings from JSON field
        console.log('[Modal Debug] Processing JSON Rankings...');
        const rankingsJsonString = record.fields['Rankings'];
        console.log(`[Modal Debug]   - Found Rankings JSON String:`, rankingsJsonString);
        if (rankingsJsonString) {
            try {
                const rankingsObject = JSON.parse(rankingsJsonString);
                console.log(`[Modal Debug]   - Parsed Rankings Object:`, rankingsObject);

                for (const label in rankingsObject) {
                    if (Object.hasOwnProperty.call(rankingsObject, label)) {
                        const value = rankingsObject[label];
                        console.log(`[Modal Debug]     - Checking Ranking: "${label}", Value:`, value, `(Type: ${typeof value})`);

                        if (typeof value === 'number' && value > 0) {
                            hasRankings = true;
                            const stars = '★'.repeat(value) + '☆'.repeat(Math.max(0, 5 - value));
                            rankingsHtmlParts.push(`
                                <div class="ranking-item">
                                    <span class="ranking-label">${label}:</span>
                                    <span class="ranking-stars">${stars}</span>
                                </div>
                            `);
                            console.log(`[Modal Debug]       -> Added ranking: ${label}`);
                        } else {
                             console.log(`[Modal Debug]       -> Skipped ranking: ${label} (value not positive number).`);
                        }
                    }
                }
            } catch (error) {
                console.error(`[Modal Debug] Error parsing Rankings JSON for item ${record.id}:`, error);
                console.error(`[Modal Debug] Invalid JSON string was:`, rankingsJsonString);
                const errorItem = document.createElement('div');
                errorItem.className = 'detail-item';
                errorItem.innerHTML = `<span class="detail-label">Rankings</span><span class="detail-value" style="color: red;">Error loading rankings</span>`;
                fragment.appendChild(errorItem);
            }
        } else {
             console.log('[Modal Debug]   - No Rankings JSON string found.');
        }

        // 3. Append rankings container if any rankings were successfully processed
        if (hasRankings) {
            console.log('[Modal Debug] Appending ranking container to fragment.');
            const rankingContainer = document.createElement('div');
            rankingContainer.className = 'ranking-list detail-item';
            rankingContainer.innerHTML = `
                <span class="detail-label">Rankings</span>
                ${rankingsHtmlParts.join('')}
            `;
            fragment.appendChild(rankingContainer);
        } else {
             console.log('[Modal Debug] No valid rankings found to display.');
        }

        modalAdditionalDetails.appendChild(fragment);
        console.log('[Modal Debug] Finished populating #modal-additional-details.');
    } else {
        console.error('[Modal Debug] CRITICAL: #modal-additional-details element not found!');
    }

    const rawOptions = parseOptions(record.fields[CONSTANTS.FIELD_NAMES.OPTIONS]);
    const allRecordNames = new Set(state.records.all.map(r => r.fields.Name));
    const isGrouping = rawOptions.some(opt => allRecordNames.has(opt.name));

    const pricingType = record.fields[CONSTANTS.FIELD_NAMES.PRICING_TYPE];
    const pricingTypeHTML = pricingType ? `<span class="pricing-type"> / ${pricingType.toLowerCase()}</span>` : '';

    if (isGrouping) {
        const range = getGroupPriceRange(record);
        modalItemPrice.innerHTML = (range && typeof range.min === 'number') ? (range.min === range.max ? `$${range.min.toFixed(2)}` : `$${range.min.toFixed(2)} - $${range.max.toFixed(2)}`) : 'Price Varies';
    } else {
        const price = getRecordPrice(record, itemState.selectedOptionIndex);
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
            optionButton.addEventListener('click', (e) => {
                e.stopPropagation();
                const childName = e.currentTarget.dataset.childName;
                const childRecord = state.records.all.find(r => r.fields.Name === childName);
                if (childRecord) {
                    log('Modal', `Navigating from option to item: ${childName}`);
                    showDetailModal(childRecord);
                } else {
                    log('Modal', `Could not find record for child option: ${childName}`);
                }
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
                const newPrice = getRecordPrice(record, newIndex);
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

    // --- Calendar Initialization (with conditional display) ---
    modalCalendarContainer.innerHTML = '';
    const iCalUrl = record.fields[CONSTANTS.FIELD_NAMES.ICAL_URL];

    if (iCalUrl) {
        modalCalendarContainer.style.display = 'block';
        log('Modal', `iCal URL found for ${record.id}, initializing calendar.`);

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
    } else {
        modalCalendarContainer.style.display = 'none';
        log('Modal', `No iCal URL for ${record.id}, hiding calendar.`);
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
    const closeBtn = document.getElementById('modal-close-btn');
    closeBtn.onclick = null;
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
}

// --- MODIFIED: showCheckoutModal for Payment Element (Initial Intent Fetch Moved to Start) ---
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

    // Dynamically set the total cost label based on payment history
    const totalLabel = document.getElementById('checkout-total-label');
    if (totalLabel) {
        if (state.session.user.amountReceived > 0) {
            totalLabel.textContent = 'Total Final Cost:';
        } else {
            totalLabel.textContent = 'Total Estimated Cost:';
        }
    }

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

        const price = itemInfo.overridePrice ?? getRecordPrice(record, itemInfo.selectedOptionIndex);

        const itemTotal = price * itemInfo.quantity;
        finalTotal += itemTotal;
        const listItem = document.createElement('li');
        
        let noteHtml = '';
        if (itemInfo.note && itemInfo.note.trim() !== '') {
            noteHtml = `<small class="checkout-summary-note">Note: ${itemInfo.note}</small>`;
        }
        
        listItem.innerHTML = `
            <div class="summary-item-details">
                <span class="summary-item-name">${record.fields.Name} (x${itemInfo.quantity})</span>
                ${noteHtml}
            </div>
            <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
        `;
        summaryList.appendChild(listItem);
    }

    summaryDetailsEl.appendChild(summaryList);

    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    fullTotalEl.dataset.total = finalTotal;
    if (currentShopSettings.paymentOptions === 'DepositOrFull' && state.session.user.amountReceived === 0) {
        paymentChoiceContainer.style.display = 'block';
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.addEventListener('change', updateProcessingFeeDisplay);
        });
    } else {
        paymentChoiceContainer.style.display = 'none';
    }

    if (termsContainer && currentShopSettings.terms) {
        termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${currentShopSettings.terms.replace(/\n/g, '<br>')}</p>`;
    }

    // --- CRITICAL FIX START: Check if plan is empty BEFORE initializing Stripe ---
    if (finalTotal <= 0) {
        log('Modal', 'Checkout plan is empty, showing modal placeholder.');
        document.getElementById('payment-form').style.display = 'none';
        document.querySelector('.checkout-total-deposit-section').style.display = 'none';
        document.querySelector('.terms-and-conditions').style.display = 'none';
        
        // Show an alternative message if needed, e.g., "Please add items to your plan."
        summaryDetailsEl.innerHTML = '<p style="text-align: center; color: #dc3545;">Please add items to your locked plan before checking out.</p>';

        checkoutModalOverlay.classList.add('active');
        setTimeout(() => { checkoutModalOverlay.style.display = 'flex'; }, 0);
        document.body.classList.add('modal-open');

        // Prevent Stripe initialization errors on $0 total
        return; 
    }
    // --- CRITICAL FIX END ---


    // --- NEW LOGIC: Initialize Stripe Elements with a REAL initial Client Secret ---
    try {
        // 1. Calculate initial amount before fee
        const amountReceived = state.session.user.amountReceived || 0;
        const totalDue = finalTotal - amountReceived;
        let amountInCentsBeforeFee = Math.round(totalDue * 100);
        
        // 2. Fetch the FIRST Payment Intent (This includes the first fee calculation and real client secret)
        const intentResponse = await fetch('/api/create-payment-intent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                amount: amountInCentsBeforeFee, 
                paymentMethodType: 'card' // Default to card for initial intent calculation
            }),
        });
        if (!intentResponse.ok) {
             const errorData = await intentResponse.json();
             throw new Error(`Failed to create Payment Intent: ${errorData.error}`);
        }
        const paymentIntentData = await intentResponse.json();
        const clientSecret = paymentIntentData.clientSecret;

        // 3. Initialize Stripe Elements with the REAL Client Secret
        stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
        const elements = stripe.elements({ clientSecret, appearance: { theme: 'stripe' } }); 
        
        const cardElementContainer = document.getElementById('card-element');
        if (cardElementContainer) cardElementContainer.innerHTML = '';
        
        // 4. Create and mount the unified Payment Element
        const paymentElement = elements.create('payment');
        paymentElement.mount('#card-element');
        
        // 5. Store elements instance and update display
        checkoutModalOverlay.stripeElements = elements;
        checkoutModalOverlay.paymentElement = paymentElement;
        
        // 6. This recalculates the fee and total due based on the initial default state (no tip, deposit vs full)
        // We know this will succeed now because we have the real clientSecret and the amount is > 0.
        await updateProcessingFeeDisplay(); 

        // 7. Attach listener to trigger fee recalculation if user changes Tip or Payment Choice
        tipAmountInput.addEventListener('input', updateProcessingFeeDisplay);
        
        // --- IMPORTANT FIX: Listen to the Stripe Element change event ---
        // This event fires when the user selects a different payment method (e.g., switches to ACH).
        paymentElement.on('change', () => updateProcessingFeeDisplay()); 
        // --- END FIX ---
        
        // 8. Final UI show
        document.getElementById('payment-form').style.display = 'block';
        document.querySelector('.checkout-total-deposit-section').style.display = 'block';
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
// --- END MODIFIED showCheckoutModal ---

export function hideCheckoutModal() {
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    if (checkoutModalOverlay) {
        if (checkoutModalOverlay.removeEventListenerOnClick) {
            checkoutModalOverlay.removeEventListenerOnClick();
        }
        document.getElementById('tip-amount')?.removeEventListener('input', updateProcessingFeeDisplay);
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.removeEventListener('change', updateProcessingFeeDisplay);
        });
        // Note: The Payment Element's 'change' listener is removed when the element instance is garbage collected.

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
    // We now rely on the stripeElements being stored on the overlay for submission
    const elements = document.getElementById('checkout-modal-overlay')?.stripeElements;
    return { stripe, elements };
}
