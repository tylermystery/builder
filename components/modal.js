// In components/modal.js
import { state } from '../state.js';
import * as ui from '../ui.js';
import * as api from '../api.js';
import { CONSTANTS, STRIPE_PUBLISHABLE_KEY } from '../config.js';
import { parseOptions } from '../utils.js';
import { getDayStatus, getAvailableSlotsForDay, AVAILABILITY_STATUS } from '../availability.js';
import { log } from '../utils/debug.js';

let stripe;
let currentShopSettings = {}; // Module-level variable to hold settings

// --- Helper function to update the checkout total display ---
function updateCheckoutDisplay() {
    const finalTotal = parseFloat(document.getElementById('full-total-price').dataset.total || 0);
    const amountReceived = state.session.user.amountReceived || 0;
    const totalDue = finalTotal - amountReceived;
    
    // Check payment choice
    const choice = document.querySelector('input[name="paymentChoice"]:checked')?.value || 'deposit';
    let baseAmountToCharge = totalDue; // Default for remaining balance
    
    if (amountReceived === 0) { // This is the first payment
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

// ... (getBreadcrumbs and resetModalState functions remain unchanged) ...
function getBreadcrumbs(record) { /* ... same as before ... */ }
function resetModalState() { /* ... same as before ... */ }

// ... (showDetailModal and hideDetailModal functions remain unchanged) ...
export async function showDetailModal(record, startPhotoIndex = 0) { /* ... same as before ... */ }
export function hideDetailModal() { /* ... same as before ... */ }


export async function showCheckoutModal(shopSettings) {
    currentShopSettings = shopSettings; // Store settings for use by helpers
    log('Modal', 'Showing checkout modal.');
    const checkoutModalOverlay = document.getElementById('checkout-modal-overlay');
    const fullTotalEl = document.getElementById('full-total-price');
    const depositEl = document.getElementById('deposit-price');
    const checkoutCloseBtn = document.getElementById('checkout-close-btn');
    const summaryDetailsEl = document.getElementById('checkout-summary-details');
    const tipAmountInput = document.getElementById('tip-amount');
    const paymentChoiceContainer = document.getElementById('payment-choice-container');
    const termsContainer = document.querySelector('.terms-and-conditions');

    if (!checkoutModalOverlay) return;

    if (checkoutCloseBtn) checkoutCloseBtn.addEventListener('click', hideCheckoutModal);
    
    // Reset UI
    summaryDetailsEl.innerHTML = '';
    tipAmountInput.value = '';

    // Build summary list
    let finalTotal = 0;
    const summaryList = document.createElement('ul');
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

    fullTotalEl.textContent = `$${finalTotal.toFixed(2)}`;
    fullTotalEl.dataset.total = finalTotal;

    // Show/hide payment options based on shop settings
    if (currentShopSettings.paymentOptions === 'DepositOrFull' && state.session.user.amountReceived === 0) {
        paymentChoiceContainer.style.display = 'block';
        document.querySelectorAll('input[name="paymentChoice"]').forEach(radio => {
            radio.addEventListener('change', updateCheckoutDisplay);
        });
    } else {
        paymentChoiceContainer.style.display = 'none';
    }

    // Update terms
    if (termsContainer && currentShopSettings.terms) {
        termsContainer.innerHTML = `<h4>Simplified Terms</h4><p>${currentShopSettings.terms.replace(/\n/g, '<br>')}</p>`;
    }

    // Initial display update
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
            checkoutCloseBtn.focus();
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
