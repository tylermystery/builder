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
const PROCESSING_FEE_ROW_HTML = `<div class=\"total-row processing-fee-row\" style=\"display: none;\"><span>Processing Fee:</span><span id=\"processing-fee-cost\">$0.00</span></div>`;
// This helper function safely inserts the fee row into the DOM
(function insertProcessingFeeRow() {
    const section = document.querySelector('.checkout-total-deposit-section');
    if (section) {
        section.insertAdjacentHTML('afterbegin', PROCESSING_FEE_ROW_HTML);
    }
})();
// --- END NEW GLOBAL ---\n
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

// --- MODIFIED FUNCTION: Fetches the fee from the server and updates the UI (Fee is returned in cents) ---
export async function updateProcessingFeeDisplay() {
    const fullTotalEl = document.getElementById('full-total-price');
    const finalTotal = parseFloat(fullTotalEl?.dataset.total || 0); // Read the current (recalculated) total from the element
    const tipAmount = parseFloat(document.getElementById('tip-amount')?.value) || 0;
    const amountReceived = state.session.user.amountReceived || 0;
    
    // Determine base amount due (Deposit vs. Full)
    const totalDueBeforeFee = finalTotal - amountReceived;
    let amountToChargeBeforeFee = totalDueBeforeFee;
    const isFirstPayment = amountReceived === 0;

    // --- NEW LOGIC: If balance is paid, allow only tip payment/adjustment ---
    if (totalDueBeforeFee <= 0) {
        amountToChargeBeforeFee = tipAmount; // Only charge the tip amount
        document.getElementById('deposit-label').textContent = 'Additional Payment/Tip:';
    } else if (isFirstPayment) {
    // --- Existing logic for deposit/full choice ---
        const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
        const isFullPayment = currentShopSettings.paymentOptions === 'DepositOrFull' && choice === 'full';

        if (!isFullPayment) {
             // 35% Deposit
             amountToChargeBeforeFee = finalTotal * 0.35;
             document.getElementById('deposit-label').textContent = '35% Deposit Due:';
        } else {
             // Full Amount
             amountToChargeBeforeFee = finalTotal;
             document.getElementById('deposit-label').textContent = 'Full Amount Due:';
        }
    } else {
        // Remaining Balance Due
        document.getElementById('deposit-label').textContent = 'Remaining Balance Due:';
    }
    
    // Add tip to the amount to charge
    amountToChargeBeforeFee += tipAmount;

    const amountInCentsBeforeFee = Math.round(amountToChargeBeforeFee * 100);
    
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const elements = checkoutModalOverlay?.stripeElements;
    
    // --- CRITICAL FIX START: Reliably get the selected payment method type ---
    let selectedPaymentMethod = 'card'; // Default fallback
    if (elements) {
         try {
             // Use getValue() to pull the current payment method type selected by the user.
             const paymentElement = elements.getElement('payment');
             const valueResult = await paymentElement.getValue();
             if (valueResult.value?.type) {
                 selectedPaymentMethod = valueResult.value.type;
             }
         } catch (e) {
             log('Stripe', 'Warning: Could not get live payment method type from Stripe Element, defaulting to card.', e);
         }
    }
    log('Stripe', `Recalculating fee for method type: ${selectedPaymentMethod}`);
    // --- CRITICAL FIX END ---

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
                paymentMethodType: selectedPaymentMethod 
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
        // Fallback logic
        const fee = 0; 
        document.getElementById('processing-fee-cost').textContent = `$${fee.toFixed(2)}`;
        document.querySelector('.processing-fee-row').style.display = 'none';
        document.getElementById('deposit-price').textContent = `$${amountToChargeBeforeFee.toFixed(2)}`;
    }
}
// --- END MODIFIED FUNCTION ---


function getBreadcrumbs(record) {
// ... (omitted for brevity)
}

function resetModalState() {
// ... (omitted for brevity)
}

export async function showDetailModal(record, startPhotoIndex = 0) {
// ... (omitted for brevity)
}

export function hideDetailModal() {
// ... (omitted for brevity)
}

// --- MODIFIED: showCheckoutModal for Post-Payment Summary Logic ---
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
    const paymentForm = document.getElementById('payment-form');
    const paymentSuccessMessage = document.getElementById('payment-success-message');
    const checkoutTotalDepositSection = document.querySelector('.checkout-total-deposit-section');


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
    
    // 1. RE-CALCULATE FINAL TOTAL & RENDER SUMMARY LIST
    summaryDetailsEl.innerHTML = '';
    tipAmountInput.value = '';
    let finalTotal = 0;
    const summaryList = document.createElement('ul');
    const paymentHistoryList = document.createElement('ul');
    paymentHistoryList.innerHTML = '<h4>Payment History</h4>';

    for (const [recordId, itemInfo] of state.cart.lockedItems.entries()) {
        const record = state.records.all.find(r => r.id === recordId);
        if (!record) continue;

        const itemState = state.cart.lockedItems.get(recordId) || {};
        const price = itemState.overridePrice ?? getRecordPrice(record, itemState.selectedOptionIndex);
        const itemTotal = price * (itemState.quantity || 1);
        finalTotal += itemTotal;
        
        const listItem = document.createElement('li');
        let noteHtml = '';
        if (itemState.note && itemState.note.trim() !== '') {
            noteHtml = `<small class="checkout-summary-note">Note: ${itemState.note}</small>`;
        }
        listItem.innerHTML = `
            <div class="summary-item-details">
                <span class="summary-item-name">${record.fields.Name} (x${itemState.quantity || 1})</span>
                ${noteHtml}
            </div>
            <span class="summary-item-price">$${itemTotal.toFixed(2)}</span>
        `;
        summaryList.appendChild(listItem);
    }
    summaryDetailsEl.appendChild(summaryList);
    
    // Populate Payment History
    const paymentHistory = state.session.user.paymentHistory || [];
    paymentHistory.forEach(p => {
        const date = new Date(p.date).toLocaleDateString();
        const historyItem = document.createElement('li');
        historyItem.innerHTML = `
            <div class="summary-item-details">
                <span class="summary-item-name">${p.note}</span>
                <small>${date}</small>
            </div>
            <span class="summary-item-price paid-amount">+$${p.amount.toFixed(2)}</span>
        `;
        paymentHistoryList.appendChild(historyItem);
    });

    // Update the DOM element with the now-calculated total
    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    fullTotalEl.dataset.total = finalTotal;

    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = finalTotal - amountReceived;
    const isPlanEmpty = finalTotal <= 0;
    const isFullyPaid = totalDue <= 0.009;


    // Dynamically set the total cost label
    const totalLabel = document.getElementById('checkout-total-label');
    if (totalLabel) {
        totalLabel.textContent = isFullyPaid ? 'Total Plan Cost:' : 'Total Estimated Cost:';
    }

    if (termsContainer && currentShopSettings.terms) {
        termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${currentShopSettings.terms.replace(/\n/g, '<br>')}</p>`;
    }


    // 2. CHECKOUT LOGIC FLOW CONTROL

    if (isPlanEmpty) {
        log('Modal', 'Checkout plan is empty, showing modal placeholder.');
        // Hide payment form/controls and show message
        paymentForm.style.display = 'none';
        checkoutTotalDepositSection.style.display = 'none';
        summaryDetailsEl.innerHTML = '<p style="text-align: center; color: #dc3545;">Please add items to your locked plan before checking out.</p>';
        paymentSuccessMessage.style.display = 'none';
        
    } else if (isFullyPaid) {
        log('Modal', 'Plan is fully paid, showing payment history and additional tip option.');
        // Display payment history
        summaryDetailsEl.appendChild(paymentHistoryList);
        
        // Hide payment choice (deposit/full)
        paymentChoiceContainer.style.display = 'none';
        
        // Ensure tip section is set up for ADDITIONAL PAYMENT
        const tipRow = document.querySelector('.tip-row');
        tipRow.style.display = 'flex'; 

        // Change the main section to accommodate tip/extra payment
        paymentForm.style.display = 'block'; // Keep the form visible for tip/extra payment
        paymentSuccessMessage.style.display = 'none';

        // Update the form's total display fields manually
        document.getElementById('deposit-label').textContent = 'Additional Payment/Tip:';
        tipAmountInput.placeholder = '$0.00';
        tipAmountInput.value = '';

        // Recalculate display amount based only on tip for initial load
        await updateProcessingFeeDisplay(); 

    } else {
        log('Modal', 'Plan has balance due, proceeding to payment initialization.');
        
        // Display payment choice if applicable
        if (currentShopSettings.paymentOptions === 'DepositOrFull' && amountReceived === 0) {
            paymentChoiceContainer.style.display = 'block';
        } else {
            paymentChoiceContainer.style.display = 'none';
        }
        
        paymentForm.style.display = 'block';
        checkoutTotalDepositSection.style.display = 'block';
        paymentSuccessMessage.style.display = 'none';


        // 3. Initialize Stripe Elements
        try {
            const totalDue = finalTotal - amountReceived;
            let amountInCentsBeforeFee = Math.round(totalDue * 100);
            
            // 3.1. Fetch the FIRST Payment Intent
            const intentResponse = await fetch('/api/create-payment-intent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    amount: amountInCentsBeforeFee, 
                    paymentMethodType: 'card' // Initial default
                }),
            });
            if (!intentResponse.ok) {
                 const errorData = await intentResponse.json();
                 throw new Error(`Failed to create Payment Intent: ${errorData.error}`);
            }
            const paymentIntentData = await intentResponse.json();
            const clientSecret = paymentIntentData.clientSecret;

            // 3.2. Initialize Stripe
            stripe = window.Stripe(STRIPE_PUBLISHABLE_KEY);
            const elements = stripe.elements({ clientSecret, appearance: { theme: 'stripe' } }); 
            
            const cardElementContainer = document.getElementById('card-element');
            if (cardElementContainer) cardElementContainer.innerHTML = '';
            
            // 3.3. Create and mount the unified Payment Element
            const paymentElement = elements.create('payment');
            paymentElement.mount('#card-element');
            
            // 3.4. Store elements instance and update display
            checkoutModalOverlay.stripeElements = elements;
            checkoutModalOverlay.paymentElement = paymentElement;
            
            // 3.5. Calculate initial fee and final payment amount.
            await updateProcessingFeeDisplay(); 

            // 3.6. Attach listeners
            tipAmountInput.addEventListener('input', updateProcessingFeeDisplay);
            paymentElement.on('change', () => updateProcessingFeeDisplay()); 
            
        } catch (err) {
            console.error("Failed to initialize payment form:", err);
            alert(`Could not initialize payment form: ${err.message}. Please try again later.`);
            hideCheckoutModal();
            return;
        }
    }

    // Final UI show
    checkoutModalOverlay.classList.add('active');
    setTimeout(() => {
        checkoutModalOverlay.style.display = 'flex';
        if(checkoutCloseBtn) checkoutCloseBtn.focus();
    }, 0);
    document.body.classList.add('modal-open');
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
